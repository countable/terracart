// Visible-time growth. Saved cells are overlays; generated seeds remain deterministic.
(function (root) {
  'use strict';
  const CONFIG = Object.freeze({ intervalMs: 20000, maxFrameMs: 100, maxCells: 128 });
  const DIRECTIONS = [[0,-1],[1,0],[0,1],[-1,0]];
  function visible(scene, p) {
    if (!(scene.viewSize > 0)) return false;
    const a = viewAnchorWorldM(scene), scale = CELL_PX / scene.cellM;
    return Math.hypot((p.x-a.x)*scale, (p.y-a.y)*scale) <= scene.viewSize / 2;
  }
  function live(scene, p) {
    return !p.picked && !p.burned && !(scene.save.picked || []).includes(p.id)
      && !(scene.save.burnedObjects || []).includes(p.id)
      && !root.HomeVariant?.contains(scene,p.x,p.y) && !root.HomeVariant?.discardedAt(scene,p.x,p.y);
  }
  function seat(scene, x, y, street) {
    const W = root.WorldGen, at = worldMetersToTileCell(scene,x,y);
    const e = W.tileCache.get(W.tileKey(at.tx,at.ty));
    if (!e || e.status !== 'ready' || e.depth > 0) return null;
    const N = e.cellsPerEdge, ix = at.ix, iy = at.iy, i = iy*N+ix;
    if (street && root.StreetVariants?.placementOwner(e, N)?.(ix, iy) !== street) return null;
    if ((e.zone?.coverage || e.zone?.idx)?.[i] || e.zone?.under?.present?.[i] || e.zone?.under?.[i]) return null;
    if (!W.isSpawnCell(e.grid,N,N,ix,iy,W.spawnOptsOf(e),'hazard') || W.isRoadTerrain(e.grid[i]) || e.roadMask?.[i]) return null;
    if (root.HomeVariant?.contains(scene,x,y) || root.HomeVariant?.discardedAt(scene,x,y)) return null;
    let occupied = false;
    for (const prop of ['objects','wildplants']) W.forEachItemInBox(e,prop,x-scene.cellM/2,y-scene.cellM/2,x+scene.cellM/2,y+scene.cellM/2,o => {
      if (Math.abs(o.x-x)<scene.cellM/2 && Math.abs(o.y-y)<scene.cellM/2) occupied = true;
    });
    for (const key of ['barricades','furniture','fires','fruittrees','scarecrows'])
      if ((scene.save[key] || []).some(o => Math.abs(o.x-x)<scene.cellM/2 && Math.abs(o.y-y)<scene.cellM/2)) occupied = true;
    return occupied ? null : {e,ix,iy};
  }
  function tick(scene, dt) {
    if (scene.depth || !scene.save || !(dt > 0) || !(scene.viewSize > 0)) return;
    const W = root.WorldGen, save = scene.save;
    save.creepingVines ||= []; save.vineGrowth ||= {};
    const a = viewAnchorWorldM(scene), radius = scene.viewSize/2/CELL_PX*scene.cellM;
    const lo = worldMetersToTileCell(scene,a.x-radius,a.y-radius), hi = worldMetersToTileCell(scene,a.x+radius,a.y+radius);
    const colonies = new Map(), colonyStreets = new Map();
    for (let ty=lo.ty;ty<=hi.ty;ty++) for (let tx=lo.tx;tx<=hi.tx;tx++) {
      const e = W.tileCache.get(W.tileKey(tx,ty));
      if (!e || e.status !== 'ready' || e.depth > 0) continue;
      // Rehydrate only once per regenerated tile and save, including cut records so
      // a cleared cell cannot be immediately reclaimed by a neighbouring vine.
      if (e._vineSave !== save) {
        e._vineSave = save;
        const ids = new Set(e.wildplants.map(p=>p.id));
        for (const p of save.creepingVines) {
          const at = worldMetersToTileCell(scene,p.x,p.y);
          if (at.tx===tx && at.ty===ty && !ids.has(p.id)) e.wildplants.push({...p});
        }
      }
      W.forEachItemInBox(e,'wildplants',a.x-radius,a.y-radius,a.x+radius,a.y+radius,p=>{
        if (!p._creepingVine) return;
        const id = p._vineColony || p.id;
        if (p._street) colonyStreets.set(id, p._street);
        if (!live(scene,p) || !visible(scene,p)) return;
        if (!colonies.has(id)) colonies.set(id,[]);
        colonies.get(id).push(p);
      });
    }
    let changed = false;
    for (const [id, sources] of colonies) {
      const state = save.vineGrowth[id] ||= {elapsedMs:0,count:1};
      if (state.count >= CONFIG.maxCells) continue;
      state.elapsedMs += Math.min(CONFIG.maxFrameMs,dt*1000);
      changed = true; // Shared save debounce also flushes this clock on pagehide.
      if (state.elapsedMs < CONFIG.intervalMs) continue;
      state.elapsedMs %= CONFIG.intervalMs;
      // Stable rotating frontier prevents one arm from monopolising growth.
      const ordered = sources.sort((a,b)=>a.id.localeCompare(b.id));
      let grown = false;
      for (let n=0;n<ordered.length && !grown;n++) {
        const source = ordered[(n+state.count)%ordered.length];
        for (let d=0;d<4;d++) {
          const [dx,dy] = DIRECTIONS[(d+state.count)%4];
          const cell = worldMetersToAbsCell(scene,source.x,source.y);
          const {x,y} = absCellCenterMeters(scene,cell.cellIX+dx,cell.cellIY+dy);
          if (!visible(scene,{x,y})) continue;
          const street = source._street || colonyStreets.get(id);
          const target = seat(scene,x,y,street); if (!target) continue;
          const p = W.makeWildplant('creeping_vine',x,y,`${id}:growth:${state.count}`,{
            _creepingVine:true,_vineColony:id,_plantArt:'creeping_vine',_ix:target.ix,_iy:target.iy,
            ...(street ? {_street:street} : {})});
          target.e.wildplants.push(p); save.creepingVines.push({...p}); state.count++;
          grown = changed = true; break;
        }
      }
    }
    if (changed && typeof persistSave === 'function') persistSave(save);
  }
  root.CreepingVines = Object.freeze({CONFIG,tick,visible,seat});
})(typeof window !== 'undefined' ? window : globalThis);
