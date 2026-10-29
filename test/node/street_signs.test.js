(function () {
test('street signs: posts follow vector edges without snapping their feet to cell centres', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    const sign = {rec:{halfW:4},x:103,y:107,nx:Math.cos(angle),ny:Math.sin(angle)};
    const seats = StreetSigns.edgeSeats(sign, 7);
    seats.forEach((seat, i) => {
      const distance = (seat.x-sign.x)*sign.nx + (seat.y-sign.y)*sign.ny;
      assert.truthy(Math.abs(distance - (i ? -5.4 : 5.4)) < 1e-9);
      assert.eq(seat.ix, Math.floor(seat.x/7));
      assert.eq(seat.iy, Math.floor(seat.y/7));
    });
  }
});
test('street signs: directions describe only actual junction geometry', () => {
  const index = {mvtToM:1, lines:[
    {key:'a',variant:'hedgerow',line:[{x:100,y:100},{x:300,y:100}]},
    {key:'b',variant:'thorny',line:[{x:100,y:100},{x:100,y:300}]},
    {key:'far',variant:'pilgrim',line:[{x:900,y:900},{x:900,y:1200}]},
  ]};
  const sign = StreetSigns.candidates(index).find(s=>s.rec.key==='a');
  assert.truthy(sign.directions.some(d=>d.direction==='East'&&d.variant==='hedgerow'));
  assert.truthy(sign.directions.some(d=>d.direction==='South'&&d.variant==='thorny'));
  assert.falsy(sign.directions.some(d=>d.variant==='pilgrim'));
  const reversed = {...index,lines:index.lines.map(r=>({...r,line:r.line.slice().reverse()}))};
  assert.eq(JSON.stringify(StreetSigns.candidates(reversed).find(s=>s.rec.key==='a').directions),JSON.stringify(sign.directions));
});
test('street signs: a board points along its road in the overhead projection', () => {
  const near = (a, b, msg) => assert.truthy(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
  const tilt = 0.5;
  const east = StreetSigns.boardPose(StreetSigns.vector('East'), tilt);
  near(east.angle, 0, 'east lies along screen right'); near(east.length, 1, 'at full length');
  const north = StreetSigns.boardPose(StreetSigns.vector('North'), tilt);
  near(north.angle, -Math.PI / 2, 'north points screen up'); near(north.length, tilt, 'foreshortened');
  near(StreetSigns.boardPose(StreetSigns.vector('South'), tilt).angle, Math.PI / 2, 'south points screen down');
  near(Math.abs(StreetSigns.boardPose(StreetSigns.vector('West'), tilt).angle), Math.PI, 'west points screen left');
  const ne = StreetSigns.boardPose(StreetSigns.vector('Northeast'), tilt);
  near(ne.angle, Math.atan2(-tilt, 1), 'a diagonal flattens toward the horizontal');
  near(ne.length, Math.hypot(1, tilt) / Math.SQRT2, 'between the two lengths');
  assert.eq(StreetSigns.vector('Nowhere'), null, 'only compass headings have a board');
  // Heading-up turns the heading before the projection: with north drawn to
  // the right, a north board lies along screen right at full length.
  const turned = { _headingUp: true, gpsM: { x: 0, y: 0 }, mapRot: Math.PI / 2 };
  const v = StreetSigns.vector('North'), t = HeadingUp.toScreenVec(turned, v.x, v.y);
  const pose = StreetSigns.boardPose(t, tilt);
  near(pose.angle, 0, 'north board follows the turned map'); near(pose.length, 1, 'and is no longer foreshortened');
});
test('street signs: boards hang from the top of the post, every heading above the plinth', () => {
  const { post } = StreetSigns.ART;
  assert.eq(StreetSigns.boardPitch(1), 5); assert.eq(StreetSigns.boardPitch(2), 5);
  assert.eq(StreetSigns.boardPitch(8), 4); assert.eq(StreetSigns.boardPitch(30), 2);
  for (const n of [1, 2, 4, 8, 12]) {
    assert.eq(StreetSigns.boardRow(0, n), post.topRow, `${n} boards: the first hangs at the top`);
    assert.lte(StreetSigns.boardRow(n - 1, n), post.lastRow, `${n} boards: the last stays above the plinth`);
    for (let i = 1; i < n; i++) assert.gt(StreetSigns.boardRow(i, n), StreetSigns.boardRow(i - 1, n), 'rows descend');
  }
  // The renderer derives each board's pivot from the post's own seat.
  const sign = { kind: 'roadsign', id: 'sign_1', x: 10, y: 20, _street: 'trade',
    directions: [{ direction: 'North', title: 'A' }, { direction: 'East', title: 'B' }, { direction: 'Nowhere', title: 'C' }] };
  const boards = Render.roadSignBoards({ o: sign, dx: 3, dy: 4 });
  assert.eq(boards.length, 2, 'one board per compass heading');
  assert.eq(boards.map(b => b.o.kind).join(), 'roadsign_board,roadsign_board');
  assert.eq(boards.map(b => b.dx + ',' + b.dy).join('|'), '3,4|3,4', 'boards share the sign\'s cell');
  assert.truthy(Render.roadSignBoards({ o: sign, dx: 0, dy: 0 })[0].o === boards[0].o, 'board records keep their identity');
  const seat = Render.roadSignPostSeat();
  assert.eq(seat.footFromCentre, 5 * StreetSigns.ART.scale, 'the standing-art contact: five source px up');
  const top = seat.dyPx - post.fh / 2 * StreetSigns.ART.scale;
  const dy0 = Render.roadSignBoardDy(boards[0].o), dy1 = Render.roadSignBoardDy(boards[1].o);
  assert.truthy(dy0 > top && dy1 > dy0 && dy1 < 0, 'pivots sit below the post top and above the cell centre');
  assert.eq(Render.roadSignBoardDy(boards[0].o), seat.dyPx + (post.topRow - post.fh / 2) * StreetSigns.ART.scale);
  // The pose hook: pooled scale stays, rotation and stretch come from the pose.
  const sprite = { scaleX: 1.6, scaleY: 1.6, rotation: 0,
    setRotation(r) { this.rotation = r; return this; }, setScale(x, y) { this.scaleX = x; this.scaleY = y; return this; } };
  Render.poseRoadSignBoard(sprite, boards[0].o, {});
  assert.truthy(Math.abs(sprite.rotation + Math.PI / 2) < 1e-9, 'the north board points up');
  assert.truthy(Math.abs(sprite.scaleX - 0.8) < 1e-9 && sprite.scaleY === 1.6, 'and is half as long');
});
test('street signs: the baked post fills its frame foot and the board tips east', () => {
  const start = TEXTURES_SRC.indexOf('function makeRoadSignTextures(');
  const end = TEXTURES_SRC.indexOf('// Procedural "pot of gold"', start);
  const bakeStart = TEXTURES_SRC.indexOf('function bakeCanvas(');
  const bakeEnd = TEXTURES_SRC.indexOf('\n}\n', bakeStart) + 3;
  const bake = new Function('StreetSigns', TEXTURES_SRC.slice(bakeStart, bakeEnd) + TEXTURES_SRC.slice(start, end)
    + '; return makeRoadSignTextures;')(StreetSigns);
  const images = new Map();
  const scene = { textures: {
    exists: key => images.has(key),
    createCanvas(key, w, h) {
      const pixels = new Map(); images.set(key, { w, h, pixels });
      const ctx = { fillStyle: '', fillRect(x, y, rw, rh) {
        for (let cy = y; cy < y + rh; cy++) for (let cx = x; cx < x + rw; cx++) {
          assert.truthy(cx >= 0 && cy >= 0 && cx < w && cy < h, `${key}: paint inside the frame`);
          pixels.set(`${cx},${cy}`, this.fillStyle);
        }
      } };
      return { getContext: () => ctx, refresh() {} };
    },
  } };
  bake(scene); bake(scene);
  const { post, board } = StreetSigns.ART;
  const p = images.get('roadsign_post'), b = images.get('roadsign_board');
  assert.eq(p.w + 'x' + p.h, post.fw + 'x' + post.fh); assert.eq(b.w + 'x' + b.h, board.fw + 'x' + board.fh);
  const centre = post.poleX + post.poleW / 2;
  assert.truthy(p.pixels.has(`${centre - 1},${post.fh - 1}`) && p.pixels.has(`${centre},${post.fh - 1}`), 'the plinth reaches the frame bottom');
  assert.truthy(p.pixels.has(`${centre},${post.topRow}`) && p.pixels.has(`${centre},${post.lastRow}`), 'the pole spans every board row');
  const mid = (board.fh - 1) / 2;
  assert.truthy(b.pixels.has(`${board.tipX},${mid}`), 'the tip is on the centre line');
  assert.falsy(b.pixels.has(`${board.tipX},${mid - 1}`) || b.pixels.has(`${board.tipX},${mid + 1}`), 'and is one pixel');
  assert.truthy(b.pixels.has(`0,${mid - 2}`) && b.pixels.has(`0,${mid + 2}`) && !b.pixels.has(`0,${mid - 3}`), 'the shaft pivots at the post end');
  assert.truthy([...b.pixels.keys()].every(k => Number(k.split(',')[0]) <= board.tipX), 'nothing past the tip');
});
test('street lamps: approved silhouettes retain restoration and suppression rules', () => {
  assert.eq(StreetLights.forVariant('hedgerow'),'hanging_lantern');
  assert.eq(StreetLights.forVariant('pilgrim'),'fire_pedestal');
  assert.eq(StreetLights.forVariant('poison_path'),'green_orb');
  assert.eq(StreetLights.forVariant('golden_path'),'paired_candles');
  assert.eq(StreetLights.forVariant('burned'),'flame_pillar');
  assert.eq(StreetLights.forVariant('fire_path'),'upright_flame');
  assert.truthy(StreetLights.ART.paired_candles.rise < StreetLights.ART.flame_pillar.rise, 'low candles emit nearer the ground than the standing pillar');
  for(const key of Object.keys(StreetLights.ART)) {
    assert.eq(StreetLights.key({_streetArt:key,lit:true}),'street_decor_'+key);
    assert.eq(StreetLights.key({_streetArt:key,lit:false}),'street_decor_'+key);
    assert.eq(StreetLights.key({_streetArt:key,lit:false,suppressed:true}),'rogue_lamp_unlit');
    let tint=null; StreetLights.after({setTint:n=>tint=n,clearTint:()=>tint=null},{_streetArt:key,lit:false});
    assert.truthy(tint);StreetLights.after({clearTint:()=>tint=null},{_streetArt:key,lit:true});assert.eq(tint,null);
  }
});
})();
