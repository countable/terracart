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
      const inPoly = (x,y,ps) => {
        let inside=false;
        for(let i=0,j=ps.length-1;i<ps.length;j=i++) {
          const [xi,yi]=ps[i],[xj,yj]=ps[j];
          if((yi>y)!=(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
        }
        return inside;
      };
      for(let y=-17;y<=17;y++) for(let x=-17;x<=17;x++) {
        const px=x*32+331,py=y*32+170;
        const type=layout.ground.patch_polygons.some(p=>inPoly(px/2,py/2,p))?4:1;
        e.grid[(cy+y)*N+cx+x]=type;
        grid.push({x,y,type,groundType:type});
      }
      for(const [i,p] of layout.objects.entries()) {
        const [px,py]=p.seat.map(v=>v*2);
        e.objects.push({
          id:'village-'+p.kind+'-'+i,kind:p.kind,...p.properties,
          ...world((px-315)/32,(py-180)/32),tx:pc.tx,ty:pc.ty,
          _ix:Math.floor(cx+(px-315)/32),_iy:Math.floor(cy+(py-180)/32),
          studyAsset:p.asset,studyOffset:[(p.top_left[0]-p.seat[0])*2,(p.top_left[1]-p.seat[1])*2],
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
          entry.objects = entry.objects.filter((o) => String(o.id).startsWith('village-'));
        s._lastBorderIX = NaN;
        s._lastBorderIY = NaN;
        s._roadGeomKey = null;
        s._buildingGeomKey = null;
        s.drawCells();
        window.__villageGround?.();
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
