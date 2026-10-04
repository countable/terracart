// Mystic Reefs extend visually into nearby water without repainting its terrain.
// Coral is ground scenery; finite finds retain ordinary object/save mechanics.
(function (root) {
  'use strict';
  function* dressSteps(ctx) {
    const WG = root.WorldGen, V = root.ZoneVariants;
    const { field, zoneDress: out, N, tx, ty, grid } = ctx;
    if (!field || !out) return out;
    const coverage = field.coverage || field.idx;
    if (!coverage) return out;
    // The dressing frame (WorldGen.dressFrame): the tile's cells in frame
    // metres and the occupancy this pass claims into. The coverage is flat,
    // so a cell is its index here: `at(i)` unpacks it.
    const f = WG.dressFrame(ctx), opts = ctx.spawnOpts, occupied = f.occ, at = f.cellXY;
    const landOpts = { ...opts, occupied }, waterOpts = { ...landOpts, waterOnly: true };
    const position = i => { const c = at(i); return { x: f.cx(c.ix), y: f.cy(c.iy) }; };
    const d2 = (i, j) => { const a = at(i), b = at(j); return (a.ix - b.ix) ** 2 + (a.iy - b.iy) ** 2; };
    const score = (i, salt) => fnv1a(`${tx}|${ty}|${i}|${salt}`);
    const allowed = (i, water, cls) => { const c = at(i); return WG.isSpawnCell(grid, N, N, c.ix, c.iy, water ? waterOpts : landOpts, cls); };
    const states = (field.anchors || []).map((a, ai) => ({ a, ai, variant: V.pick(a), cells: [] }))
      .filter(s => s.variant.id === 'mystic_reef' && s.variant.reef);
    const bySlot = new Map(states.map(s => [s.ai + 1, s]));
    for (let i = 0; i < coverage.length; i++) {
      if ((i & 511) === 0) yield 'reef shore coverage';
      bySlot.get(coverage[i])?.cells.push(i);
    }
    states.sort((a,b) => a.a.key - b.a.key);
    out.corals ||= [];
    const coralCells = new Set(), waterOwners = new Map();
    const neighbours = function* (i) {
      const { ix: x, iy: y } = at(i);
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx,ny=y+dy;
        if(nx>=0&&ny>=0&&nx<N&&ny<N) yield ny*N+nx;
      }
    };
    for (const s of states) {
      const config=s.variant.reef, salt=`reef|${s.a.key}`;
      const extra={ zoneKind:'beach',zoneVariant:'mystic_reef',zoneAnchor:s.a.key };
      // Tide generation reserves every potential pickup cell, including the
      // inactive majority. These ground pickups do not obstruct standing on
      // the shore; only water-seat occupancy blocks reef scenery/rewards.
      const shoreOpts={...landOpts,occupied:null};
      const shore=s.cells.filter(i => { const c = at(i); return grid[i] !== WG.T.WATER
        && WG.isSpawnCell(grid,N,N,c.ix,c.iy,shoreOpts,'reward'); });
      const queue=[], depths=new Map();
      for(const i of shore) for(const next of neighbours(i)) {
        if(grid[next]!==WG.T.WATER || depths.has(next) || !allowed(next,true,'minor')) continue;
        depths.set(next,1);queue.push(next);
      }
      for(let head=0;head<queue.length;head++) {
        if((head&127)===0) yield 'reef water footprint';
        const i=queue[head],d=depths.get(i);
        if(d>=config.waterReachCells) continue;
        for(const next of neighbours(i)) {
          if(grid[next]!==WG.T.WATER || depths.has(next) || !allowed(next,true,'minor')) continue;
          depths.set(next,d+1);queue.push(next);
        }
      }
      const water=[];
      for(const i of queue) {
        if(waterOwners.has(i)) continue;
        waterOwners.set(i,s.a.key);water.push(i);
        if(u01(score(i,'coral')) >= config.coralDensity) continue;
        coralCells.add(i);
        const c = at(i);
        out.corals.push({ id:WG.cellId('reef_coral',tx,ty,c.ix,c.iy), ...position(i), ...extra,
          _ix:c.ix,_iy:c.iy,variant:config.coralFrames[score(i,'coral_art')%config.coralFrames.length] });
      }
      if(!s.a.owned) continue;
      // All chests remain within base shore reach. Scenery can continue farther
      // out, but treasure never asks the player to walk into the water.
      const reaches = i => shore.some(j => d2(i, j) <= config.chestShoreReachCells**2);
      const amongCoral = i => water.some(j => j!==i && coralCells.has(j) && d2(i, j) <= 4);
      const candidates=water.filter(i=>allowed(i,true,'reward')&&reaches(i)&&amongCoral(i))
        .sort((a,b)=>score(a,salt+'chest')-score(b,salt+'chest')||a-b);
      const seats=[], approaches=new Set();
      for(const i of candidates) {
        if(seats.length>=config.chestTiers.length) break;
        if(seats.some(j=>d2(i, j) < config.chestSpacingCells**2)) continue;
        const tier=config.chestTiers[seats.length], p=position(i), c=at(i);
        out.objects.push(WG.makeObject('chest',p.x,p.y,WG.cellId(`reef_chest_${s.a.key}`,tx,ty,c.ix,c.iy),
          {...extra,zoneLayer:'reef_find',_ix:c.ix,_iy:c.iy,poiClass:'vista',vista:`reef${tier}`,name:'Reef treasure'}));
        const approach=shore.find(j=>d2(i, j) <= config.chestShoreReachCells**2);
        approaches.add(approach);
        seats.push(i);occupied.add(i);coralCells.delete(i);
      }
      const dry=s.cells.filter(i=>grid[i]!==WG.T.WATER&&!approaches.has(i)&&allowed(i,false,'minor'))
        .sort((a,b)=>score(a,salt+'ore')-score(b,salt+'ore')||a-b);
      const ore=config.landOre;
      for(let n=0;n<ore.count;n++) {
        const m=V.materials[ore.materials[n%ore.materials.length]];
        const i=dry.find(cell=>allowed(cell,false,m.spawnClass));
        if(i==null) continue;
        const p=position(i), c=at(i);
        out.objects.push(WG.makeObject(m.kind,p.x,p.y,WG.cellId(`reef_ore_${s.a.key}`,tx,ty,c.ix,c.iy),
          {...extra,zoneLayer:'reef_ore',_ix:c.ix,_iy:c.iy,deposit:m.deposit,yieldTier:m.yieldTier,
            requiredTier:m.requiredTier,_zoneObjectFrame:m._zoneObjectFrame,rockVariant:root.SpriteLayout?.[m.rockVariant] || 3}));
        occupied.add(i);
      }
      // Park-shore anchors have no POI chest to become the site's daily
      // shrine. Give only those owner sites one ordinary shrine on free dry
      // ground, after protecting treasure approaches and the finite ore budget.
      const nexus = out.nexus?.find(n => n.zoneAnchor === s.a.key && n.zoneVariant === s.variant.id && n.zoneKind === s.a.kind);
      const hasShrine = !!nexus?.poiId || out.objects.some(o =>
        o.kind === 'grove_shrine' && o.zoneAnchor === s.a.key && o.zoneVariant === s.variant.id);
      if (!hasShrine && s.variant.shrineFrame != null) {
        const i = dry.find(cell => allowed(cell, false, 'reward'));
        if (i != null) {
          const p = position(i), c = at(i), id = WG.cellId(`reef_shrine_${s.a.key}`, tx, ty, c.ix, c.iy);
          out.objects.push(WG.makeObject('grove_shrine', p.x, p.y, id, {
            ...extra, zoneLayer: 'shrine', _ix: c.ix, _iy: c.iy,
            _zoneObjectFrame: s.variant.shrineFrame,
            shrineKind: root.Shrines.kindForZoneVariant(s.variant.id)
          }));
          occupied.add(i);
          if (nexus) nexus.poiId = id;
        }
      }
    }
    out.corals=out.corals.filter(o=>coralCells.has(o._iy*N+o._ix));
    return out;
  }
  root.ReefLayout={dressSteps};
})(typeof window !== 'undefined' ? window : globalThis);
