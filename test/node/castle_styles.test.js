(function () {
  test('castle materials: restoration preserves identity and restores light across every material', () => {
    const luma = c => ((c >> 16) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114);
    for (const id of CastleStyles.ids) {
      const lit = CastleStyles.get(id), old = CastleStyles.get(id, false);
      assert.eq(lit.id, old.id);
      assert.eq(lit.towerFrame, old.towerFrame);
      assert.gt(luma(lit.floor), luma(old.floor) * 1.06, `${id}: floor still signals condition`);
      assert.gt(luma(old.floor), luma(old.stone.BODY) + 20, `${id}: floor contrasts with masonry`);
      for (const [a, b] of [...Object.keys(lit.stone).map(k => [lit.stone[k], old.stone[k]]), ...Object.keys(lit.wood).map(k => [lit.wood[k], old.wood[k]])]) {
        assert.gt(luma(a), luma(b) * 1.12, `${id}: condition stays visible`);
        assert.gte(luma(b), luma(a) * 0.78, `${id}: unclaimed stone remains readable`);
      }
    }
  });
  test('castle materials: broken columns stay sparse, deterministic and inside ruin courts', () => {
    const ring = [0, 0, 50, 0, 50, 80, 0, 80], cell = 10;
    const columns = CastleStyles.columnSites('ruin', ring, cell);
    assert.gte(columns.length, 3, 'a five by eight court has a few columns');
    assert.lte(columns.length, 5, 'the court remains open');
    assert.eq(JSON.stringify(columns), JSON.stringify(CastleStyles.columnSites('ruin', [...ring], cell)),
      'reloaded geometry produces identical decoration');
    for (const p of columns) {
      assert.gte(p.x, cell * 0.8); assert.lte(p.x, 50 - cell * 0.8);
      assert.gte(p.y, cell * 0.8); assert.lte(p.y, 80 - cell * 0.8);
      assert.includes([12, 16, 20], p.height);
      for (const q of columns) if (q !== p) assert.gte(Math.hypot(p.x - q.x, p.y - q.y), cell * 1.3);
    }
    for (const id of ['citadel', 'bastion', 'archive']) assert.eq(CastleStyles.columnSites(id, ring, cell).length, 0);
    assert.eq(CastleStyles.columnSites('ruin', [0, 0, 10, 0, 10, 80, 0, 80], cell).length, 0,
      'narrow courts keep their passage clear');
    const concave = [0, 0, 80, 0, 80, 20, 20, 20, 20, 80, 0, 80];
    for (const p of CastleStyles.columnSites('ruin', concave, cell)) {
      assert.truthy(p.x < 20 || p.y < 20, 'no columns in an L-shaped courtyard notch');
    }
  });
  test('castle materials: stable identity selects four families, with an unguarded bastion', () => {
    const found = new Set();
    for (let i = 0; i < 50; i++) {
      const key = `castle_${i}`;
      const first = CastleStyles.get(key);
      assert.eq(first, CastleStyles.get(key), 'material descriptor is reused');
      assert.eq(first.id, CastleStyles.variantFor(key), 'tower and wall choose identical family');
      found.add(first.id);
    }
    assert.eq(found.size, 4);
    for (const id of ['bastion', 'ruin', 'archive']) assert.eq(CastleStyles.get(id).guards, false);
    assert.eq(CastleStyles.get('citadel').guards, true);
    assert.eq(CastleStyles.get('citadel').questType, null);
    assert.eq(CastleStyles.get('bastion').questType, 'kill');
    assert.eq(CastleStyles.get('ruin').questType, 'hunt');
    assert.eq(CastleStyles.get('archive').questType, 'deliver');
    assert.eq(CastleStyles.get('citadel').name, 'Citadel');
    assert.eq(CastleStyles.ids.includes('mended'), false);
  });
})();


test('castle materials: Archive quest variety preserves the four existing style assignments', () => {
  const jobs = new Set();
  assert.eq(CastleStyles.ids.length, 4);
  for (let i = 0; i < 200; i++) {
    const key = 'castle_' + i;
    let hash = 0x811c9dc5;
    for (const ch of key) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193);
    const expected = ['citadel', 'ruin', 'bastion', 'archive'][(hash >>> 0) % 4];
    assert.eq(CastleStyles.variantFor(key), expected, 'historical castle hash is unchanged');
    const verb = CastleStyles.questTypeFor(key, expected);
    assert.eq(verb, CastleStyles.questTypeFor(key, expected), 'stable on reload');
    if (expected === 'archive') jobs.add(verb);
    else assert.eq(verb, CastleStyles.get(expected).questType);
  }
  assert.eq([...jobs].sort().join(), 'deliver,luxury', 'real generated Archives reach both jobs');
});

test('castle growth: contact masks are deterministic, translation-stable and bounded', () => {
  const points=[{x:0,y:0},{x:280,y:0},{x:280,y:110},{x:0,y:110}];
  const layout={points,towers:[],keep:null};
  const patches=CastleStyles.growthPatches('bastion',layout);
  assert.eq(JSON.stringify(patches),JSON.stringify(CastleStyles.growthPatches('bastion',layout)));
  const moved=CastleStyles.growthPatches('bastion',{...layout,points:points.map(p=>({x:p.x+391,y:p.y-217}))});
  assert.eq(moved.length,patches.length);
  for(let i=0;i<patches.length;i++)for(let j=0;j<patches[i].length;j++){
    assert.lt(Math.abs(moved[i][j].x-391-patches[i][j].x),1e-7);
    assert.lt(Math.abs(moved[i][j].y+217-patches[i][j].y),1e-7);
  }
  const area=key=>CastleStyles.growthPatches(key,layout).reduce((sum,ring)=>sum+Math.abs(ring.reduce((a,p,i)=>{
    const q=ring[(i+1)%ring.length];return a+p.x*q.y-q.x*p.y;
  },0))/2,0);
  assert.gt(area('bastion'),area('archive'),'Bastion vegetation spreads farther into its court');
  assert.gt(area('archive'),area('citadel'),'Citadel keeps only sparse contact growth');
  const archive=CastleStyles.growthPatches('archive',layout);
  assert.truthy(archive.every(ring=>ring.every(p=>p.x<=19||p.x>=261||p.y<=19||p.y>=91)),
    'without a keep, Archive growth remains at its edges rather than stamping the open center');
  const huge=Array.from({length:64},(_,i)=>({x:100000*Math.cos(i*Math.PI/32),y:100000*Math.sin(i*Math.PI/32)}));
  const complex=CastleStyles.growthPatches('bastion',{points:huge,towers:huge.map(p=>({points:points.map(q=>({x:q.x+p.x,y:q.y+p.y}))})),keep:null});
  assert.lte(complex.length,2048,'large footprints cannot create unbounded ground painting work');
  assert.truthy(complex.every(ring=>ring.length===4),'leaf clusters have bounded four-point paths');
  assert.truthy(complex.every(ring=>ring.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));
});

(function () {
  function context(width = 600, height = 600) {
    const calls = [], clips = [];
    let path = [];
    return { canvas: { width, height }, calls, clips, saves: 0,
      save() { this.saves++; }, restore() { this.saves--; },
      beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
      closePath() {}, rect(x, y, w, h) { path.push([x, y], [x + w, y + h]); },
      clip(rule) { clips.push({ rule, points: path.slice() }); },
      fillRect(x, y, w, h) { calls.push({ color: this.fillStyle, x, y, w, h }); },
    };
  }
  const rectangle = [{ x: 40, y: 40 }, { x: 280, y: 40 }, { x: 280, y: 220 }, { x: 40, y: 220 }];
  test('castle carpets: family patterns retain geometry through restoration and camera pans', () => {
    const patterns = new Set();
    for (const family of ['citadel', 'bastion', 'archive']) {
      const lit = context(), old = context(), moved = context();
      assert.truthy(CastleStyles.paintInteriorCarpet(lit, rectangle, [], family, true, 0, 0));
      CastleStyles.paintInteriorCarpet(old, rectangle, [], family, false, 0, 0);
      const shift = { x: 31, y: 19 };
      CastleStyles.paintInteriorCarpet(moved, rectangle.map(p => ({ x: p.x + shift.x, y: p.y + shift.y })),
        [], family, true, shift.x, shift.y);
      assert.eq(lit.calls.length, old.calls.length);
      assert.eq(lit.calls.length, moved.calls.length);
      assert.truthy(lit.calls.some((p, i) => p.color !== old.calls[i].color), 'condition changes textile colours');
      for (let i = 0; i < lit.calls.length; i++) {
        const p = lit.calls[i], q = moved.calls[i], r = old.calls[i];
        assert.lt(Math.abs(q.x - shift.x - p.x), 1e-7);
        assert.lt(Math.abs(q.y - shift.y - p.y), 1e-7);
        assert.eq(q.w, p.w); assert.eq(q.h, p.h);
        assert.eq(r.x, p.x); assert.eq(r.y, p.y); assert.eq(r.w, p.w); assert.eq(r.h, p.h);
      }
      assert.eq(lit.saves, 0, 'canvas state is restored');
      const border = lit.calls[0];
      assert.gt(border.x, rectangle[0].x);assert.gt(border.y, rectangle[0].y);
      assert.lt(border.x + border.w, rectangle[2].x);assert.lt(border.y + border.h, rectangle[2].y);
      patterns.add(JSON.stringify(lit.calls.slice(4).map(({ w, h }) => [w, h])));
    }
    assert.eq(patterns.size, 3, 'families have distinct textile motifs');
  });
  test('castle carpets: concave rooms and courtyard holes clip the rug, with bounded work for huge sites', () => {
    const room = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 100 },
      { x: 100, y: 100 }, { x: 100, y: 240 }, { x: 0, y: 240 }];
    const hole = [{ x: 20, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 50 }, { x: 20, y: 50 }];
    const ctx = context();
    CastleStyles.paintInteriorCarpet(ctx, room, [hole], 'archive', true);
    assert.eq(ctx.clips[0].rule, 'evenodd');
    assert.eq(JSON.stringify(ctx.clips[0].points), JSON.stringify([...room, ...hole].map(p => [p.x, p.y])),
      'the real ring and courtyard clip precede every carpet fill');
    assert.eq(ctx.saves, 0);
    const huge = context();
    CastleStyles.paintInteriorCarpet(huge, rectangle.map(p => ({ x: p.x * 10000, y: p.y * 10000 })), [], 'citadel', true);
    assert.lte(huge.calls.length, 4, 'offscreen rooms do not generate hidden motif work');
    const covering = context();
    CastleStyles.paintInteriorCarpet(covering, [{ x: -1e6, y: -1e6 }, { x: 1e6, y: -1e6 },
      { x: 1e6, y: 1e6 }, { x: -1e6, y: 1e6 }], [], 'citadel', true);
    assert.lte(covering.calls.length, 4500, 'visible motifs are bounded independently of building size');
    assert.truthy(covering.calls.every(p => [p.x, p.y, p.w, p.h].every(Number.isFinite)));
    const tiny = context();
    assert.falsy(CastleStyles.paintInteriorCarpet(tiny, rectangle.map(p => ({ x: p.x / 20, y: p.y / 20 })), [], 'citadel', true));
    assert.eq(tiny.calls.length, 0, 'very narrow rooms retain their bare stone floor');
  });
})();
