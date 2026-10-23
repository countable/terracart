(() => {
  function scene() {
    const list = [];
    return { _headingUp: true, depth: 0, mapRot: 0,
      buildingWallContainer: { add(g) { list.push(g); } },
      add: { graphics() { return { visible: true, clears: 0, triangles: [], color: 0,
        clear() { this.clears++; this.triangles.length = 0; return this; },
        fillStyle(c, alpha = 1) { this.color = c; this.alpha = alpha; return this; },
        fillTriangle(...points) { this.triangles.push({ color: this.color, alpha: this.alpha, points }); return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; } }; } }, list };
  }
  const segment = { ax: 10, ay: 20, bx: 42, by: 20,
    height: 6, thickness: 3.6, face: 1, top: 2, dark: 3 };
  function build(s, spec = segment) {
    const group = WallPerspective.begin(s, 'tiled');
    WallPerspective.addSegment(s, 'tiled', spec);
    WallPerspective.finish(s, 'tiled');
    return group;
  }
  function close(a, b, message) { assert.lt(Math.abs(a - b), 1e-8, message); }

  test('wall perspective: short and angled palisade intervals keep square third-cell posts', () => {
    for(const [ax,ay,bx,by] of [[0,0,4,0],[0,0,8,8],[20,10,20,42]]){
      const s=scene(),group=WallPerspective.begin(s,'polygon');
      WallPerspective.palisade(s,'polygon',{ax,ay,bx,by});
      const block=group.blocks[0];
      assert.eq(block.points.length,4,'four true square corners');
      block.points.forEach((p,i)=>{const q=block.points[(i+1)%4];close(Math.hypot(q.x-p.x,q.y-p.y),32/3,'equal square sides at arbitrary headings');});
      close(block.top,48,'one and a half cells including the point');
      for(const angle of [0,Math.PI/4,Math.PI,Math.PI*1.5]){s.mapRot=angle;WallPerspective.update(s);assert.truthy(group.gfx.triangles.every(t=>t.points.every(Number.isFinite)));}
    }
  });

  test('wall perspective: ramparts fade only after their faces fully cover the player', () => {
    const s=scene();s.save={};let feet={x:25,y:25};
    s.playerScreen=()=>feet;s.player={visible:true,x:25,y:25,displayWidth:16,displayHeight:24,originX:.5,originY:1};
    const group=WallPerspective.begin(s,'polygon');
    group.building={key:'castle',footprint:[{x:0,y:0},{x:60,y:0},{x:60,y:60},{x:0,y:60}],anchor:{x:30,y:40}};
    WallPerspective.addSegment(s,'polygon',{...segment,ay:40,by:40,height:32,toothWidth:5,toothHeight:3});
    WallPerspective.finish(s,'polygon');
    assert.truthy(group.gfx.triangles.length,'walls are drawn');
    assert.truthy(group.gfx.triangles.every(t=>t.alpha===1),'footprint entry and partially covered body stay opaque');
    const blocks=group.blocks;
    feet={x:25,y:32};s.player.x=25;s.player.y=32;WallPerspective.update(s);
    assert.truthy(group.gfx.triangles.every(t=>t.alpha===.5),'fully covering walls and teeth share half opacity');
    const clears=group.gfx.clears;
    feet={x:26,y:33};s.player.x=26;s.player.y=33;WallPerspective.update(s);
    assert.eq(group.gfx.clears,clears,'movement while fully covered does not repaint');
    feet={x:25,y:23};s.player.x=25;s.player.y=23;WallPerspective.update(s);
    assert.truthy(group.gfx.triangles.every(t=>t.alpha===1),'exposing the head restores opacity while still inside footprint');
    feet={x:100,y:100};s.player.x=100;s.player.y=100;WallPerspective.update(s);
    assert.truthy(group.gfx.triangles.every(t=>t.alpha===1),'leaving keeps opacity at a fixed heading');
    assert.eq(group.blocks,blocks,'retained wall geometry survives');
  });

  test('wall perspective: connected walls and teeth ink only upward at every heading', () => {
    const s=scene(),group=build(s,{...segment,toothWidth:5,toothHeight:3});
    for(const angle of [0,.7,Math.PI,Math.PI*1.5]){
      s.mapRot=angle;WallPerspective.update(s);
      const triangles=group.gfx.triangles,ink=triangles.filter(t=>t.color===BuildingLowPoly.LOOK.ink),fill=triangles.filter(t=>t.color!==BuildingLowPoly.LOOK.ink);
      assert.gt(ink.length,0,'opaque wall silhouette');
      assert.eq(ink.length,fill.length,'one offset per visible face');
      assert.truthy(triangles.slice(0,ink.length).every(t=>t.color===BuildingLowPoly.LOOK.ink),'entire connected silhouette precedes its fills');
      for(const triangle of ink){
        const shifted=triangle.points.map((v,j)=>v+(j%2?Math.cos(angle):Math.sin(angle))*BuildingLowPoly.LOOK.inkPx);
        assert.truthy(fill.some(t=>t.points.every((v,j)=>Math.abs(v-shifted[j])<1e-8)),
          'each ink triangle is exactly one screen pixel above a filled face');
      }
    }
  });

  test('wall perspective: wall height projects vertically at every compass octant', () => {
    const s = scene(), group = build(s), block = group.blocks[0];
    for (let step = 0; step <= 8; step++) {
      s.mapRot = step * Math.PI / 4;
      WallPerspective.update(s);
      const c = Math.cos(s.mapRot), sin = Math.sin(s.mapRot);
      for (let j = 0; j < block.projected.length; j += 4) {
        const v = block.projected, dx = v[j + 2] - v[j], dy = v[j + 3] - v[j + 1];
        close(c * dx - sin * dy, 0, 'top shares the foot screen x');
        close(sin * dx + c * dy, -6, 'height is constant and points screen up');
      }
    }
  });

  test('wall perspective: only camera-facing prism faces draw for either winding', () => {
    for (const reverse of [false, true]) {
      const s = scene();
      const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }, { x: 0, y: 5 }];
      if (reverse) points.reverse();
      const group = WallPerspective.begin(s, 'polygon');
      WallPerspective.prism(s, 'polygon', points, 0, 6, { face: 1, top: 2, dark: 3 });
      for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        s.mapRot = angle;
        WallPerspective.update(s);
        const faces = group.gfx.triangles.filter(t => t.color === 1);
        assert.eq(faces.length, angle === Math.PI / 4 ? 4 : 2, 'one face on axis, two diagonally');
        for (let i = 0; i < faces.length; i += 2) {
          const p = faces[i].points;
          const screenDx = Math.cos(angle) * (p[2] - p[0]) - Math.sin(angle) * (p[3] - p[1]);
          assert.lt(screenDx * (reverse ? -1 : 1), 0, 'visible face normal points toward viewer');
        }
        assert.eq(group.gfx.triangles.filter(t => t.color === 2).length, 2, 'cap remains filled');
      }
    }
  });

  test('wall perspective: fixed heading reuses geometry and command buffer', () => {
    const s = scene(), group = build(s), block = group.blocks[0], projected = block.projected;
    const clears = group.gfx.clears;
    for (let i = 0; i < 20; i++) WallPerspective.update(s);
    assert.eq(group.gfx.clears, clears, 'stationary frames do not repaint');
    WallPerspective.offset(s, 'tiled', 4, -7);
    WallPerspective.update(s);
    assert.eq(group.gfx.clears, clears, 'panning translates the retained graphics');
    assert.eq(group.gfx.x, 4); assert.eq(group.gfx.y, -7);
    s.mapRot = 0.7; WallPerspective.update(s);
    assert.eq(group.gfx.clears, clears + 1, 'one repaint for changed heading');
    assert.eq(group.blocks[0], block, 'block is retained');
    assert.eq(block.projected, projected, 'vertex buffer is retained');
  });

  test('wall perspective: mode and depth transitions hide walls and empty rebuild removes stale faces', () => {
    const s = scene(), group = build(s);
    s._headingUp = false; WallPerspective.update(s);
    assert.eq(group.gfx.visible, false);
    s._headingUp = true; s.depth = 1; WallPerspective.update(s);
    assert.eq(group.gfx.visible, false);
    s.depth = 0; WallPerspective.update(s);
    assert.eq(group.gfx.visible, true);
    WallPerspective.begin(s, 'tiled'); WallPerspective.finish(s, 'tiled');
    assert.eq(group.blocks.length, 0); assert.eq(group.gfx.triangles.length, 0);
    assert.eq(s.list.length, 1, 'rebuild reuses background graphics');
  });

  test('wall perspective: tiled ramparts preserve dimensions and damaged merlon gaps', () => {
    const s = scene(), group = build(s, { ...segment, merlons: 4,
      toothWidth: 6, toothHeight: 2, missing: [1, 2] });
    const teeth = group.blocks.filter(b => b.bottom === 6);
    assert.eq(teeth.length, 2, 'only intact endpoint teeth remain');
    for (const tooth of teeth) {
      close(tooth.top - tooth.bottom, 2);
      close(Math.hypot(tooth.points[1].x - tooth.points[0].x,
        tooth.points[1].y - tooth.points[0].y), 6);
      close(Math.hypot(tooth.points[2].x - tooth.points[1].x,
        tooth.points[2].y - tooth.points[1].y), 3.6);
    }
    close(teeth[0].points[0].x, 10); close(teeth[1].points[1].x, 42);
  });

  test('wall perspective: connected tile segments have identical ground and raised seams', () => {
    const s = scene(), group = WallPerspective.begin(s, 'tiled');
    WallPerspective.addSegment(s, 'tiled', segment);
    WallPerspective.addSegment(s, 'tiled', { ...segment, ax: 42, bx: 74 });
    for (const angle of [0, 0.4, 1.7, 3.8, 5.4]) {
      s.mapRot = angle; WallPerspective.update(s);
      const a = group.blocks.find(b => b.order === 0).projected;
      const b = group.blocks.find(b => b.order === 1).projected;
      for (let k = 0; k < 4; k++) {
        close(a[4 + k], b[k], 'outer seam joins at both elevations');
        close(a[8 + k], b[12 + k], 'inner seam joins at both elevations');
      }
    }
  });

  test('wall perspective: reversed view reverses local wall ordering without moving crowns below bodies', () => {
    const s = scene(), group = WallPerspective.begin(s, 'tiled');
    WallPerspective.addSegment(s, 'tiled', segment);
    WallPerspective.addSegment(s, 'tiled', { ...segment, ay: 60, by: 60,
      merlons: 1, toothWidth: 6, toothHeight: 2 });
    WallPerspective.finish(s, 'tiled');
    assert.eq(group.blocks[0].y, 21.8);
    s.mapRot = Math.PI; WallPerspective.update(s);
    assert.eq(group.blocks[0].y, 61.8);
    assert.eq(group.blocks[1].bottom, 6, 'rear wall crown follows its own body');
    assert.eq(group.blocks[2].bottom, 0, 'nearer wall body follows the rear crown');
  });
  test('wall perspective: nearby taller wall occludes a rear crown using actual building heights', () => {
    const s = scene(), group = WallPerspective.begin(s, 'polygon');
    WallPerspective.addSegment(s, 'polygon', { ...segment,
      merlons: 1, toothWidth: 6, toothHeight: 2 });
    WallPerspective.addSegment(s, 'polygon', { ...segment,
      ay: 22, by: 22, height: 7, thickness: 1, face: 7, top: 8 });
    WallPerspective.finish(s, 'polygon');
    const crown = group.blocks.findIndex(b => b.bottom === 6);
    const nearer = group.blocks.findIndex(b => b.colors.face === 7);
    assert.lt(crown, nearer, 'nearer 7px wall paints over the rear 6px wall crown');
    assert.eq(group.blocks[crown].support, group.blocks[0].support,
      'crown and supporting body share retained ordering metadata');
    s.mapRot = Math.PI; WallPerspective.update(s);
    assert.eq(group.blocks[0].colors.face, 7, 'turning reverses wall ordering');
    assert.eq(group.blocks[group.blocks.length - 1].bottom, 6,
      'crown still follows its own body after turning');
  });
  test('wall perspective: padded culling drops distant perimeter but retains raised edge geometry', () => {
    const s = Object.assign(scene(), { viewLeft: 0, viewTop: 0, viewSize: 352 });
    const group = WallPerspective.begin(s, 'polygon');
    WallPerspective.addSegment(s, 'polygon', { ...segment,
      ax: -2000, bx: 2000, ay: -1000, by: -1000 });
    assert.eq(group.blocks.length, 0, 'distant city-sized perimeter allocates no retained blocks');
    WallPerspective.addSegment(s, 'polygon', { ...segment,
      ax: -2000, bx: 2000, ay: 100, by: 100 });
    assert.lt(group.blocks.length, 20, 'long crossing edge retains only nearby sections');
    const nearby = group.blocks.length;
    const edgeY = s.viewSize + CELL_PX * 2 + segment.height - 1;
    WallPerspective.addSegment(s, 'polygon', { ...segment, ay: edgeY, by: edgeY });
    assert.eq(group.blocks.length, nearby + 1, 'height extends the retained pad beyond the ground bound');
    WallPerspective.prism(s, 'polygon', [{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 30, y: 30 }],
      0, 6, { face: 1, top: 2, dark: 3 });
    assert.eq(group.blocks.length, nearby + 2, 'nearby polygon join remains visible');
    WallPerspective.finish(s, 'polygon');
    assert.lt(0, group.gfx.triangles.length, 'retained geometry still renders');
  });
  test('wall perspective: tiled cache compares exact scratch inputs and snapshots only on changes', () => {
    const s = scene();
    const types = new Int8Array([12, 12, 0]), owners = new Int32Array([1, 1, 0]);
    const unclaimed = new Uint8Array([1, 1, 0]), synthetic = new Uint8Array([1, 1, 0]);
    const phases = new Float32Array([0, 0, 0]);
    const dirty = key => Render.tiledWallsDirty(s, key, types, owners, unclaimed, synthetic, phases);
    assert.eq(dirty('cell|bands|mode|viewport'), true);
    let frame = s._tiledWallFrame;
    for (let i = 0; i < 10; i++) {
      s.mapRot = i * 0.1;
      assert.eq(dirty('cell|bands|mode|viewport'), false, 'compass frames retain tiled geometry');
      assert.eq(s._tiledWallFrame, frame, 'no replacement snapshots on clean frames');
    }
    for (const array of [types, owners, unclaimed, synthetic, phases]) {
      array[0] += 1;
      assert.eq(dirty('cell|bands|mode|viewport'), true, 'each exact ring input invalidates');
      assert.eq(dirty('cell|bands|mode|viewport'), false, 'new input stabilizes immediately');
      frame = s._tiledWallFrame;
    }
    owners[0] += 1; owners[1] -= 1;
    assert.eq(dirty('cell|bands|mode|viewport'), true, 'equal-sum ownership changes cannot collide');
    assert.eq(dirty('new-cell|bands|mode|viewport'), true, 'projection key changes rebuild');
    s._tiledWallFrame = null;
    assert.eq(dirty('new-cell|bands|mode|viewport'), true, 'mode/depth invalidation rebuilds on return');
  });

  test('wall perspective: a per-wall group draws one world-sorted part per block, anchored at its sort point', () => {
    // Home's interior without the low-poly path: the prism walls used to be
    // one graphics object in the wall container, UNDER the player's container,
    // so the player drew over every wall in front of them (owner, Oct 2026).
    const s = scene(); s.save = {}; s.depth = 0;
    s.viewCenterX = 100; s.viewCenterY = 100; s.cellM = 6; s.gpsM = { x: 0, y: 0 };
    s.startWorldM = { x: 400, y: 800 }; s.playerM = { x: 6, y: 12 }; s.mapZoom = 1; s.viewSize = 200;
    let feet = { x: 30, y: 10 }; s.playerScreen = () => feet;
    s.player = { visible: true, x: 30, y: 10, displayWidth: 16, displayHeight: 24, originX: .5, originY: 1 };
    const group = WallPerspective.begin(s, 'home');
    group.perWall = true;
    WallPerspective.addSegment(s, 'home', { ...segment, bx: 74 });   // 64 px long: two sections
    WallPerspective.finish(s, 'home');
    assert.eq(group.blocks.length, 2); assert.eq(group.parts.length, 2);
    assert.truthy(group.parts.every(p => p.visible && p._worldGeometry && p.triangles.length), 'each block drew into a visible part of its own');
    assert.eq(group.gfx.triangles.length, 0, 'the group graphics stays empty');
    // No outline inside (owner, Oct 2026): a part's own ink over its
    // neighbour left black seams, and the dark mask outside is edge enough.
    const inkColour = BuildingLowPoly.LOOK.ink;
    assert.truthy(group.parts.every(p => p.triangles.every(t => t.color !== inkColour)), 'the wall parts draw no ink');
    assert.falsy(group.inkPart, 'and no ink part');
    assert.truthy(group.parts.every(p => s.list.includes(p)), 'parts join the scene\'s containers');
    // North-up the baseline is horizontal: the sort point is the baseline's
    // point in the player's column, clamped to the section.
    close(group.parts[0]._huAnchor.x, 30); close(group.parts[0]._huAnchor.y, 20);
    close(group.parts[1]._huAnchor.x, 42); close(group.parts[1]._huAnchor.y, 20);
    feet = { x: 60, y: 10 }; s.player.x = 60; WallPerspective.update(s);
    close(group.parts[0]._huAnchor.x, 42, 'the first section clamps to its end'); close(group.parts[1]._huAnchor.x, 60);
    const pieces = WallPerspective.worldPieces(s);
    assert.eq(pieces.length, 2);
    assert.truthy(pieces.every((p, i) => p.sprite === group.parts[i] && p.rank === 1 && Number.isFinite(p.groundY)), 'pieces for the shared world sort');
    close(pieces[1].groundY, 812 + (20 - 100) * 6 / CELL_PX);
    // Back to one graphics object: the parts hide and the group draws again.
    group.perWall = false; WallPerspective.update(s);
    assert.truthy(group.parts.every(p => !p.visible), 'parts hidden'); assert.truthy(group.gfx.triangles.length, 'the group graphics draws');
    assert.eq(WallPerspective.worldPieces(s).length, 0);
    group.perWall = true; WallPerspective.update(s); WallPerspective.clear(s, 'home');
    assert.truthy(group.parts.every(p => !p.visible) && !group.perWall, 'clear hides the parts');
    assert.truthy(/zList\.push\(\.\.\.WallPerspective\.worldPieces\(scene\)\)/.test(RENDER_SRC), 'the frame\'s world sort takes them');
    // Home and retail occupancy exercise this integration behaviorally in
    // building_overlay.test.js; keep this test focused on the wall sorter.
  });
  test('cave walls: retained geometry follows mining and depth, while rotation keeps its atlas', () => {
    const s = scene(); s.depth = 2; s._headingUp = false;
    Object.assign(s, { startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      viewCenterX: 0, viewCenterY: 0, cellM: 6, mapZoom: 1 });
    const prepare = FloorWallMaterials.prepare, atlas = { key: 'floor-wall-l2' };
    const lavaAtlas = { key: 'floor-wall-l6' };
    FloorWallMaterials.prepare = (_, depth) => depth === 6 ? lavaAtlas : atlas;
    try {
      const cells = [{ x: 0, y: 0, ax: 100, ay: 200, mask: 13 },
        { x: 32, y: 0, ax: 101, ay: 200, mask: 7 }];
      Render.drawCaveWalls(s, cells);
      const group = s._wallPerspective.cave, block = group.blocks[0];
      assert.eq(group.blocks.length, 2);
      assert.eq(group.atlas, atlas);
      assert.truthy(group.gfx.visible, 'north-up underground uses the same geometry');
      assert.eq(WallPerspective.worldPieces(s).length, 2, 'walls join the actor sort underground');
      assert.eq(block.materialFaces.length, 8, 'three exposed sides plus cap; shared face omitted');
      for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
        s.mapRot = angle; Render.drawCaveWalls(s, cells, -4, -7);
        assert.truthy(group.blocks.includes(block), 'heading and sub-cell movement retain blocks');
        assert.eq(group.atlas, atlas);
        for (let j = 0; j < block.projected.length; j += 4) {
          const v = block.projected, dx = v[j+2] - v[j], dy = v[j+3] - v[j+1];
          close(Math.cos(angle)*dx - Math.sin(angle)*dy, 0);
          close(Math.sin(angle)*dx + Math.cos(angle)*dy, -19);
        }
      }
      const firstPart = group.parts[0];
      s.depth = 6; Render.drawCaveWalls(s, cells);
      assert.eq(group.parts[0], firstPart, 'floor changes reuse draw targets');
      assert.truthy(group.parts.every(p => p._wallAtlas === lavaAtlas), 'all parts switch to lava');
      s.depth = 2; Render.drawCaveWalls(s, cells);
      assert.truthy(group.parts.every(p => p._wallAtlas === atlas), 'returning restores the cave atlas');
      Render.drawCaveWalls(s, [{ ...cells[0], mask: 15 }]);
      assert.eq(group.blocks.length, 1, 'mining removes a block');
      assert.eq(group.blocks[0].materialFaces.length, 10, 'mining exposes the new edge');
      s.depth = 0; WallPerspective.update(s);
      assert.truthy(group.parts.every(p => !p.visible), 'leaving underground hides every part');
      assert.eq(WallPerspective.worldPieces(s).length, 0);
      Render.drawCaveWalls(s, []);
      assert.eq(group.blocks.length, 0);
    } finally { FloorWallMaterials.prepare = prepare; }
  });
})();
