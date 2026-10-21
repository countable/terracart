// Authored study input, adapted from the reproducible capture fixture.
window.createRAFixture = (layout) => {

      const s = __scene;



      s._tickHomeZoom = () => {};
      s._setRestZoom(1, 1);
      s.mapZoom = 1;
      s._applyMapZoom();
      window.__renderScaleCap = 1;
      window.__onGameScaleChange?.();
      BuildingOverlay.setEnabled(s, false);
      s.ensureStarterTrailerObject = () => {};
      s.ensureStarterShopId = () => {};
      const pc = s.playerToWorldCell(),
        e = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty)),
        N = e.cellsPerEdge,
        cm = e.tileEdgeM / N,
        cx = Math.floor(N / 2),
        cy = Math.floor(N / 2);
      const world = (x, y) => ({
        x: pc.tx * e.tileEdgeM + (cx + x) * cm,
        y: pc.ty * e.tileEdgeM + (cy + y + 0.8125) * cm,
      });
      for (const entry of WorldGen.tileCache.values()) {
        entry.grid.fill(1);
        entry.objects = [];
        entry.wildplants = [];
        entry.creatures = [];
        entry.layers = [];
        entry.buildingShapes = [];
        entry.owners.fill(0);
        entry.zone = null;
        entry.zoneDress = null;
        entry.scenic = null;
        entry.scenicDress = null;
        entry.streetIndex = null;
        entry.streetDress = null;
        entry.streetArea = null;
        entry.extraTreasures = [];
        entry.parkingTreasures = [];
        entry.coinDrops = [];
        entry.traps = [];
        entry.streetLairs = [];
        entry.treasure = null;
        entry.streetGround = null;
        entry.roadUnder = {};
        entry.pathUnder = {};
        entry.slowCells = null;
        entry.streetMarks = null;
        entry._objectIndex = null;
        entry._preCullLights = null;
      }
      const grid = [];
      const trees = [];
      const inPoly = (x, y, ps) => {
        let inside = false;
        for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
          const [xi, yi] = ps[i],
            [xj, yj] = ps[j];
          if (yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      };
      const pond = layout.pond.outline.map((p) => {
        let [x, y] = p.map((v) => v * 2);
        if (y >= 170 && y <= 285 && x > 540) x -= 24;
        if (y > 285 && x > 480) x -= 24;
        return [x, y];
      });
      const paths = layout.ground.patch_polygons.map((poly) =>
        poly.map((p) => p.map((v) => v * 2)),
      );
      // The two lower worn strips follow the reference's long, tapering bends.
      // A shortened two-by-two vertex footprint reads as a diamond garden bed.
      paths[paths.length - 2] = [
        [324, 352], [364, 362], [348, 390], [322, 416], [301, 468],
        [263, 474], [260, 451], [287, 403], [305, 373],
      ];
      paths[paths.length - 1] = [
        [182, 388], [221, 405], [219, 475], [181, 466], [188, 430],
      ];
      // Explicit authored vertices refine the polygon seed without changing props.
      const vertexOverrides = new Map((layout.vertex_overrides || []).map(v =>
        [v.x + ',' + v.y, v.groundType]));
      for (let y = -17; y <= 17; y++)
        for (let x = -17; x <= 17; x++) {
          const px = x * 32 + 336,
            py = y * 32 + 240;
          let type = 1;
          if (paths.some((p) => inPoly(px, py, p))) type = 4;
          if (inPoly(px, py, pond)) type = 3;
          if (vertexOverrides.has(x + ',' + y)) type = vertexOverrides.get(x + ',' + y);
          // A deck is an overlay, not a wider water polygon. Keep its original ground.
          const groundType = type;
          if (px >= 416 && px < 512 && py >= 288 && py < 352) type = 23;
          e.grid[(cy + y) * N + cx + x] = type;
          grid.push({ x, y, type, groundType });
        }
      for (const tree of layout.trees) {
        const [px, py] = tree.seat.map((v) => v * 2),
          x = (px - 320) / 32,
          y = (py - 250) / 32;
        e.objects.push({
          id: 'jungle-tree-' + trees.length,
          kind: 'tree',
          variant: 3,
          size: 'large',
          species: 'maple',
          ...world(x, y),
          tx: pc.tx,
          ty: pc.ty,
          _ix: Math.floor(cx + x),
          _iy: Math.floor(cy + y),
          jungleIndex: tree.crop[0] / 64,
          jungleOffset: [
            (tree.top_left[0] - tree.seat[0]) * 2,
            (tree.top_left[1] - tree.seat[1]) * 2,
          ],
        });
        trees.push({ x, y });
      }
      for (const l of layout.lamps) {
        const [px, py] = l.base.map((v) => v * 2);
        e.objects.push({
          id: 'jungle-lamp-' + px,
          kind: 'torch',
          ...world((px - 320) / 32, (py - 250) / 32),
          tx: pc.tx,
          ty: pc.ty,
        });
      }
      for (let i = 0; i < layout.small_rocks.length; i++) {
        const [px, py] = layout.small_rocks[i].map((v) => v * 2);
        e.objects.push({
          id: 'jungle-rock-' + i,
          kind: 'mineralrock',
          variant: 0,
          ...world((px - 320) / 32, (py - 250) / 32),
          tx: pc.tx,
          ty: pc.ty,
          jungleRock: i === 4 ? 'big' : i === 3 ? 'mid' : 'tiny',
        });
      }
      for (let i = 0; i < layout.ground_marks.length; i++) {
        const [px, py] = layout.ground_marks[i].center;
        e.objects.push({
          id: 'jungle-leaf-' + i, kind: 'jungle_leaf', jungleLeaf: i,
          ...world((px * 2 - 320) / 32, (py * 2 - 250) / 32),
          tx: pc.tx, ty: pc.ty,
        });
      }
      for (const o of e.objects)
        if (o.kind === 'tree') while (isShiny(o.id, SHINY_RATE.tree)) o.id += 'x';
      const p = world(0, 0);
      s.playerM = { x: p.x - s.startWorldM.x, y: p.y - s.startWorldM.y };
      s.peekM = { x: 0, y: 0 };
      s.syncMoveTarget?.();
      s.save.planted = [];
      s.save.fires = [];
      s.save.furniture = [];
      s.save.floorTiles = [];
      s.save.firepit = null;
      s.save.chopped = [];
      s.save.spent = [];
      s._streetLamps = [];
      window.__fixture = { originCell: (() => { const a=tileCellToAbs(s,pc.tx,pc.ty,cx,cy);return {x:a.cellIX,y:a.cellIY}; })(), grid, objects: e.objects.map((o) => ({ ...o })), cellM: cm, layout };
      window.__draw = () => {
        for (const entry of WorldGen.tileCache.values())
          entry.objects = entry.objects.filter((o) => String(o.id).startsWith('jungle-'));
        s._lastBorderIX = NaN;
        s._lastBorderIY = NaN;
        s._roadGeomKey = null;
        s._buildingGeomKey = null;
        s.drawCells();
        window.__jungleGround?.();
        s.drawRoadGeometry();
        s.drawBuildingGeometry();
        s.drawObjects();
        BuildingLowPoly.clear(s);
        s.buildingGeomContainer?.setVisible(false);
        s.buildingWallContainer?.setVisible(false);
        s.towerPool?.forEach((o) => o.setVisible(false));
        for (const key of [
          'fogContainer',
          'atmosGroundGfx',
          'atmosRimGfx',
          'reachGfx',
          'auraContainer',
          'fxContainer',
          'sparkContainer',
          'labelContainer',
          'letterContainer',
          '_sandboxLabels',
          'ghostGlowContainer',
          'tierGfx',
          'enemyHealthGfx',
          '_workProgressGfx',


          'playerHalo',
          'gpsGhost',
          'blightAura',
          'facingGfx',
          'facingChevronGfx',
          'projGfx',
          'swordSwingGfx',
          'boltContainer',
        ]) {
          s[key]?.setVisible?.(false);
          s[key]?.image?.setVisible?.(false);
        }
        s.creaturePool?.forEach((o) => o.setVisible(false));
        document
          .querySelectorAll('.game-modal,[id$="-modal"],#story,#howto,#bootload,#safety-card')
          .forEach((e) => (e.style.display = 'none'));
      };
      __draw();
      return __fixture;
};
