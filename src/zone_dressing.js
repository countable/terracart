// Declarative zone layouts share the ordinary spawn gate and save ledgers.
// Pattern coordinates belong to the anchor grid, never the observing tile.
(function (root) {
  'use strict';
  const EXT = 4096;
  const WRECK_CHEST_TIER = 3;
  // Claim hulls before scenic rewards and street dressing can spend their sand.
  // Direct/sandbox callers use the same reservation pass during dressing.
  function* reserveWrecksSteps(ctx) {
    const WG = root.WorldGen, V = root.ZoneVariants;
    const { N, tx, ty, tileEdgeM, grid, field } = ctx;
    const reservations = new Map(), coverage = field?.coverage || field?.idx;
    if (!coverage) return reservations;
    const opts = ctx.spawnOpts, occ = opts.occupied;
    const step = tileEdgeM / N, ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    for (let ai = 0; ai < field.anchors.length; ai++) {
      const a = field.anchors[ai];
      if (!a.owned || a.generated || V.pick(a).id !== 'pirate_cove') continue;
      let chest = !a.parkShore && (ctx.chests || []).find(o => o.kind === 'chest' && o._poiAt === `${a.lx},${a.ly}`);
      const synthetic = !chest;
      if (!chest) chest = { x: ox + a.lx * tileEdgeM / EXT, y: oy + a.ly * tileEdgeM / EXT };
      const extent = root.SpriteLayout.SHIPWRECK_SHRINE_ART.extentCells;
      const radius = Math.floor(extent / 2);
      const original = [Math.floor((chest.x - ox) / step), Math.floor((chest.y - oy) / step)];
      const originalIndex = original[1] * N + original[0];
      const free = new Set(occ); if (!synthetic) free.delete(originalIndex);
      const shrineOpts = { ...opts, occupied: free };
      const [ax, ay] = V.rotate(0, -radius - 1, V.rotation(a));
      const footprint = (x, y) => {
        const cells = [];
        const eligible = (ix, iy) => ix >= 0 && iy >= 0 && ix < N && iy < N
          && coverage[iy * N + ix] === ai + 1 && !ctx.tideSeats?.has(iy * N + ix)
          && grid[iy * N + ix] === WG.T.SAND
          && WG.isSpawnCell(grid, N, N, ix, iy, shrineOpts, 'minor');
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (!eligible(x + dx, y + dy)) return null;
          cells.push((y + dy) * N + x + dx);
        }
        if (!eligible(x + ax, y + ay)) return null;
        cells.push((y + ay) * N + x + ax);
        return cells;
      };
      let seat = original, reserved = footprint(...seat), distance = reserved ? 0 : Infinity;
      if (!reserved) for (let i = 0; i < coverage.length; i++) {
        if ((i & 255) === 0) yield 'shipwreck footprint fallback';
        if (coverage[i] !== ai + 1) continue;
        const x = i % N, y = Math.floor(i / N), d = (x - original[0]) ** 2 + (y - original[1]) ** 2;
        if (d >= distance) continue;
        const candidate = footprint(x, y);
        if (candidate) { seat = [x, y]; reserved = candidate; distance = d; }
      }
      if (!reserved) continue;
      Object.assign(chest, { x: ox + (seat[0] + 0.5) * step, y: oy + (seat[1] + 0.5) * step,
        _ix: seat[0], _iy: seat[1], _shrineArt: 'shipwreck', _shrineExtentCells: extent });
      for (const i of reserved) occ.add(i);
      reservations.set(a.key, { seat, reserved, originalIndex, synthetic });
    }
    return reservations;
  }
  function* dressSteps(ctx) {
    const WG = root.WorldGen, V = root.ZoneVariants, Z = root.Zones;
    const out = { objects: [], wildplants: [], traps: [], guards: [], treasures: [], lairs: [], slowCells: new Map(), nexus: [], diagnostics: [] };
    const field = ctx && ctx.field;
    if (!field || !WG || !V) return out;
    const { N, tx, ty, tileEdgeM, grid } = ctx, coverage = field.coverage || field.idx;
    if (!coverage) return out;
    const opts = ctx.spawnOpts || (ctx.spawnOpts = {}), occ = opts.occupied || (opts.occupied = new Set());
    const initialOccupied = new Set(occ);
    const step = tileEdgeM / N, ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const position = (ix, iy) => [ox + (ix + 0.5) * step, oy + (iy + 0.5) * step];
    const chests = new Map();
    for (const chest of ctx.chests || []) if (chest.kind === 'chest' && chest._poiAt) chests.set(chest._poiAt, chest);
    const states = (field.anchors || []).map((a, ai) => {
      const variant = V.pick(a), unit = WG.CELL_M / (a.upm || N * WG.CELL_M / EXT);
      const gx = a.originGX == null ? a.gx : a.originGX, gy = a.originGY == null ? a.gy : a.originGY;
      const ownerX = Math.floor(gx / EXT), ownerY = Math.floor(gy / EXT);
      const originX = ownerX * EXT + (Math.floor((gx - ownerX * EXT) / unit) + 0.5) * unit;
      const originY = ownerY * EXT + (Math.floor((gy - ownerY * EXT) / unit) + 0.5) * unit;
      const chest = a.owned && !a.parkShore && !a.generated && !variant.generated ? chests.get(`${a.lx},${a.ly}`) : null;
      const local = (x, y) => [Math.floor((x - tx * EXT) * N / EXT), Math.floor((y - ty * EXT) * N / EXT)];
      let poi = local(originX, originY);
      if (chest) poi = [Math.floor((chest.x - ox) / step), Math.floor((chest.y - oy) / step)];
      const source = local(a.gx, a.gy);
      const indoor = typeof ctx.insideBuilding === 'function' ? ctx.insideBuilding(a)
        : !!(source[0] >= 0 && source[1] >= 0 && source[0] < N && source[1] < N
          && WG.isBuildingTerrain && WG.isBuildingTerrain(grid[source[1] * N + source[0]]));
      const rec = { anchorKey: a.key, zoneVariant: variant.id, eligible: 0, placed: 0, findsRequested: a.owned ? variant.finds.count : 0,
        background: { planned: 0, placed: 0, occupied: 0, blocked: 0, reserved: 0 },
        findsPlaced: 0, guardsRequested: a.owned ? (variant.guards.count || 0) : 0, guardsPlaced: 0, shortfalls: [] };
      out.diagnostics.push(rec);
      return { a, ai, variant, unit, originX, originY, rotation: V.rotation(a), chest, poi, indoor, cells: [], rec,
        clear: new Set(), poiSlots: new Map(), connections: new Map(), findCells: [] };
    });
    for (let iy = 0; iy < N; iy++) {
      if ((iy & 15) === 0) yield 'zone variant coverage';
      for (let ix = 0; ix < N; ix++) {
        const i = iy * N + ix, s = states[coverage[i] - 1];
        if (!s) continue;
        s.cells.push(i);
        if (WG.isSpawnCell(grid, N, N, ix, iy, opts, 'minor')) s.rec.eligible++;
      }
    }
    const owns = (s, ix, iy) => ix >= 0 && iy >= 0 && ix < N && iy < N && coverage[iy * N + ix] === s.ai + 1
      && !(s.a.kind === 'grove' && grid[iy * N + ix] === WG.T.SAND);
    const allowed = (s, ix, iy, material) => {
      if (!owns(s, ix, iy) || ctx.tideSeats?.has(iy * N + ix)) return false;
      // Scenic shore sand is finalized after coverage; keep late sand out
      // of ordinary grove motifs too. Beach roses require vegetated ground.
      if (grid[iy * N + ix] === WG.T.SAND && s.variant.id === 'shellwater_strand' && material === 'rose') return false;
      const m = V.materials[s.variant.materialReplacements?.[material] || material];
      if (!m) return false;
      if (m.recordType === 'enemy' && root.BiomeProfiles && !root.BiomeProfiles.faunaAllows(m.kind, grid[iy * N + ix])) return false;
      const cls = m.recordType === 'enemy' && typeof root.creatureSpawnClass === 'function'
        ? root.creatureSpawnClass(m.kind) : m.spawnClass;
      if (!WG.isSpawnCell(grid, N, N, ix, iy, opts, cls)) return false;
      return m.recordType !== 'surface_trap' || !!(root.Traps && root.Traps.isTrapGround(grid, opts.roadClass, N, N, ix, iy, field.under, opts.roadMask));
    };
    const place = (s, ix, iy, material, layer, id) => {
      material = s.variant.materialReplacements?.[material] || material;
      let m = V.materials[material];
      if (!allowed(s, ix, iy, material)) {
        if (!m || !m.fallback || !allowed(s, ix, iy, m.fallback)) return null;
        material = s.variant.materialReplacements?.[m.fallback] || m.fallback; m = V.materials[material];
      }
      const i = iy * N + ix, [x, y] = position(ix, iy);
      const extra = { zoneKind: s.a.kind, zoneVariant: s.variant.id, zoneLayer: layer, _ix: ix, _iy: iy };
      const frames = s.variant.materialFrames?.[material];
      if (frames?.length) extra._zoneObjectFrame = frames[Math.floor(Z.cellU01(tx * N + ix, ty * N + iy, 0x2416) * frames.length)];
      else if (m._zoneObjectFrame != null) extra._zoneObjectFrame = m._zoneObjectFrame;
      const look = s.variant.materialLooks && s.variant.materialLooks[material];
      if (m.kind === 'wildplant' && (look || m._plantArt)) extra._plantArt = look || m._plantArt;
      else if (look) extra._objectArt = look;
      const prefix = m.recordType === 'enemy' ? 'zp' : m.kind === 'wildplant' ? (layer === 'background' ? 'wpf' : 'wz')
        : ({ tree: 'ztree', fruittree: 'ft', mineralrock: 'mrz', headstone: 'hs', tar: 'tar' }[m.kind] || 'zt');
      id = id || WG.cellId(prefix, tx, ty, ix, iy);
      let record;
      if (m.recordType === 'treasure') { record = { id, x, y, ...extra }; out.treasures.push(record); }
      else if (m.recordType === 'surface_trap') { record = { id, x, y, ...extra }; out.traps.push(record); }
      else if (m.recordType === 'enemy') {
        // Pattern enemies share the ordinary guard/caught pipeline, but each
        // repeated seat owns its stable cell id rather than a finite-find id.
        record = { kind: m.kind, id, x, y, homeX: x, homeY: y, stationary: m.kind === 'plant', ...extra };
        if (m.kind === 'wurm') {
          // Share the site's candidate seats; the live AI checks clearance
          // again before emerging because placed objects can change later.
          s.burrowCells ||= s.cells.filter(i => allowed(s, i % N, Math.floor(i / N), material))
            .map(i => { const [x, y] = position(i % N, Math.floor(i / N)); return { x, y }; });
          record.burrowCells = s.burrowCells;
          // Authored roaming enemies use the same Home and starter-amnesty
          // gate as ambient surface foes, measured from their original seat.
          record._surfaceSpawn = { x, y, tx, ty, cx: ix, cy: iy };
        }
        out.guards.push(record);
      }
      else if (m.kind === 'wildplant') { record = WG.makeWildplant(m.crop, x, y, id, extra); out.wildplants.push(record); }
      else {
        if (m.tierSeed != null) extra.tierSeed = m.tierSeed;
        if (m.fixedLoot) extra.fixedLoot = { ...m.fixedLoot };
        if (m.quarryCrate) extra.quarryCrate = true;
        if (m.barrelStyle) extra.barrelStyle = m.barrelStyle;
        if (m.barrel) extra.barrel = true;   // a generated barrel (loot.js isBarrel)
        if (m.species) extra.species = m.kind === 'fruittree' && m.species === 'apple'
          ? WG.fruitTreeSpecies(WG.cellHash(tx, ty, ix, iy)) : m.species;
        if (m.kind === 'tree') {
          extra.variant = 1;
          if (m.size) extra.size = m.size;
        }
        if (m.kind === 'stronghold_wall') extra.variant = s.quarryPlan.wallFrames.get(i);
        if (m.deposit) extra.deposit = m.deposit;
        if (m.yieldTier != null) extra.yieldTier = m.yieldTier;
        if (m.requiredTier != null) extra.requiredTier = m.requiredTier;
        if (m.rockVariant) extra.rockVariant = root.SpriteLayout ? root.SpriteLayout[m.rockVariant] : 3;
        record = WG.makeObject(m.kind, x, y, id, extra); out.objects.push(record);
        if (m.kind === 'tar' || m.kind === 'stakes') out.slowCells.set(i, m.kind);
      }
      occ.add(i); s.rec.placed++;
      return record;
    };
    const offsetCell = (s, dx, dy) => {
      const [rx, ry] = V.rotate(dx, dy, s.rotation);
      return [Math.floor((s.originX + rx * s.unit - tx * EXT) * N / EXT), Math.floor((s.originY + ry * s.unit - ty * EXT) * N / EXT)];
    };
    const motifAt = (s, ix, iy) => {
      // Generated footprints may merge or acquire a different centre as lane
      // geometry changes. Their scatter belongs to the geographic tile/cell.
      if (s.fittedBackground) return s.fittedBackground.get(iy * N + ix) || null;
      if (s.quarryPlan) return s.quarryPlan.background.get(iy * N + ix) || null;
      if (s.a.generated || s.variant.generated) return V.sample(s.variant, ix, iy,
        `generated|${s.a.generated || s.variant.generated}|${tx}|${ty}`);
      const dx = Math.round((tx * EXT + (ix + 0.5) * EXT / N - s.originX) / s.unit);
      const dy = Math.round((ty * EXT + (iy + 0.5) * EXT / N - s.originY) / s.unit);
      const [u, v] = V.inverseRotate(dx, dy, s.rotation), p = V.poiOrigin(s.variant);
      return V.sample(s.variant, u + p[0], v + p[1], s.a.key);
    };
    // Distance then cell order provides deterministic union-wide fallbacks.
    // Finite rewards belong only to the tile owning the original anchor.
    function* findSeat(s, ix, iy, material) {
      if (allowed(s, ix, iy, material)) return [ix, iy];
      let best = null, distance = Infinity;
      for (let n = 0; n < s.cells.length; n++) {
        if ((n & 255) === 0) yield 'zone find fallback';
        const i = s.cells[n], x = i % N, y = Math.floor(i / N), d = (x - ix) ** 2 + (y - iy) ** 2;
        if (d < distance && allowed(s, x, y, material)) { distance = d; best = [x, y]; }
      }
      return best;
    }
    const wrecks = ctx.wreckReservations || (yield* reserveWrecksSteps(ctx));
    for (const s of states) {
      if (!s.a.owned || s.variant.id !== 'pirate_cove') continue;
      const wreck = wrecks.get(s.a.key);
      if (!wreck) { s.rec.shortfalls.push('shrine:shipwreck'); continue; }
      s.poi = wreck.seat; s.shipwreck = true;
      if (wreck.synthetic) {
        const [x, y] = position(...s.poi);
        s.chest = WG.makeObject('chest', x, y, `wreck_shrine_${V.identity(s.a)}`,
          { zoneAnchor: s.a.key, _ix: s.poi[0], _iy: s.poi[1], _shrineArt: 'shipwreck',
            _shrineExtentCells: root.SpriteLayout.SHIPWRECK_SHRINE_ART.extentCells });
        out.objects.push(s.chest);
      }
      s.clear.add(wreck.originalIndex);
      out.reservedCells = out.reservedCells || new Set();
      for (const i of wreck.reserved) { occ.add(i); s.clear.add(i); out.reservedCells.add(i); }
      // One ordinary, one-time chest sits inside the hull beside its daily POI.
      // The wreck art faces a fixed direction, regardless of the shoreline.
      // Seat near the back of the front cell, inside the open hull, while
      // retaining a separate occupied cell from the daily shrine.
      const ix = s.poi[0], iy = s.poi[1] + 1, [x, y] = position(ix, iy - 0.45);
      out.objects.push(WG.makeObject('chest', x, y, `wreck_chest_${s.a.gx}_${s.a.gy}`,
        { tierSeed: WRECK_CHEST_TIER, zoneKind: s.a.kind, zoneVariant: s.variant.id,
          zoneLayer: 'wreck', _ix: ix, _iy: iy }));
    }
    for (const s of states) {
      if (s.a.kind === 'beach' && s.a.orientationSource === 'unresolved') s.rec.shortfalls.push('orientation:shoreline');
      if (!s.variant.quarryLayout) continue;
      // Fit surviving foundation walls around the authoritative spawn gate
      // and authored occupancy; no wall is placed through a house.
      const eligible = [];
      for (let n = 0; n < s.cells.length; n++) {
        if ((n & 255) === 0) yield 'quarry usable footprint';
        const i = s.cells[n];
        const usable = s.variant.id === 'quarry-stronghold'
          ? allowed(s, i % N, Math.floor(i / N), 'stone')
          : WG.isSpawnCell(grid, N, N, i % N, Math.floor(i / N), opts, 'minor');
        if (usable) eligible.push(i);
      }
      s.quarryPlan = yield* root.QuarryLayout.planSteps({ ...s, cells: eligible }, {N, tx, ty});
      const plan = s.quarryPlan;
      for (const i of plan.clear) s.clear.add(i);
      s.rec.landmarks = plan.landmarks;
      out.reservedCells = out.reservedCells || new Set();
      const entrances = yield* root.QuarryLayout.entrancesSteps(s, { ...ctx, spawnOpts: opts, reservedCells: out.reservedCells });
      out.objects.push(...entrances);
      s.rec.placed += entrances.length;
      if (s.a.owned && s.variant.entrances && entrances.length < root.QuarryLayout.entranceCount(s))
        s.rec.shortfalls.push('entrance:no-safe-seat');
      if (s.a.clipped) s.rec.shortfalls.push('layout:incomplete-source-strip-mine');
      for (const [layer, entries] of [['find',plan.finds], ['guard',plan.guards]]) {
        for (let n = 0; n < entries.length; n++) {
          const {i, material} = entries[n];
          const seat = layer === 'find' ? yield* findSeat(s, i % N, Math.floor(i / N), material)
            : [i % N, Math.floor(i / N)];
          const record = seat && place(s, seat[0], seat[1], material, layer,
            `zq_${s.variant.id}_${s.a.gx}_${s.a.gy}_${layer}_${n}`);
          if (record) {
            s.clear.add(seat[1] * N + seat[0]);
            if (layer === 'find') s.rec.findsPlaced++; else s.rec.guardsPlaced++;
          } else s.rec.shortfalls.push(`${layer}:${n}`);
        }
      }
      for (let n = s.rec.findsPlaced; n < s.rec.findsRequested; n++) {
        const reason = `find:${n}`; if (!s.rec.shortfalls.includes(reason)) s.rec.shortfalls.push(reason);
      }
      for (let n = s.rec.guardsPlaced; n < s.rec.guardsRequested; n++) {
        const reason = `guard:${n}`; if (!s.rec.shortfalls.includes(reason)) s.rec.shortfalls.push(reason);
      }
      for (const i of plan.hazards) {
        const ix = i % N, iy = Math.floor(i / N);
        if (!WG.isSpawnCell(grid, N, N, ix, iy, opts, 'minor')) continue;
        const [x, y] = position(ix, iy);
        grid[i] = WG.T.CAVE_LAVA;
        out.objects.push(WG.makeObject('lava_vent', x, y, WG.cellId('qlava', tx, ty, ix, iy),
          {zoneKind:'quarry', zoneVariant:s.variant.id, zoneLayer:'hazard', _ix:ix, _iy:iy}));
        occ.add(i);
      }
    }
    for (const s of states) {
      yield 'zone finite finds';
      const { a, variant: v } = s;
      // A generated quarry has no POI or composition origin to reserve.
      if (a.generated || v.generated) continue;
      for (const target of V.findOffsets(v, a.R / WG.CELL_M)) {
        const desired = offsetCell(s, target.dx, target.dy);
        let seat = desired;
        if (a.owned) {
          seat = yield* findSeat(s, desired[0], desired[1], target.material);
          if (seat) {
            place(s, seat[0], seat[1], target.material, 'find', `zf_${a.kind}_${a.gx}_${a.gy}_${target.id}`);
            s.rec.findsPlaced++;
          } else s.rec.shortfalls.push(`find:${target.id}`);
        }
        if (seat) s.findCells.push(seat);
      }
      if (a.owned && ['guard_find', 'guard_poi'].includes(v.guards.mode)) {
        for (let n = 0; n < v.guards.count; n++) {
          const target = v.guards.mode === 'guard_poi' ? s.poi : s.findCells[n % s.findCells.length], off = v.guards.offsetCells[n % v.guards.offsetCells.length];
          const [dx, dy] = V.rotate(off[0], off[1], s.rotation);
          const choices = v.guards.choices;
          const kind = choices ? choices[fnv1a(`zone-guard|${V.identity(a)}|${n}`) % choices.length]
            : (v.guards.kinds || [v.guards.kind])[n % (v.guards.kinds || [v.guards.kind]).length];
          const cls = typeof root.creatureSpawnClass === 'function' ? root.creatureSpawnClass(kind) : 'enemy';
          if (!target) { s.rec.shortfalls.push(`guard:${n}`); continue; }
          const desiredX = target[0] + dx, desiredY = target[1] + dy;
          // Keep the declared seat when possible. A blocked seat can move at
          // most two cells, still beside its find and inside eligible coverage.
          // Distance then row/column order makes the fallback replay identically.
          let ix = -1, iy = -1, bestDistance = Infinity;
          for (let sy = -2; sy <= 2; sy++) for (let sx = -2; sx <= 2; sx++) {
            const distance = sx * sx + sy * sy, x = desiredX + sx, y = desiredY + sy;
            if (distance > 4 || distance >= bestDistance || !owns(s, x, y)
                || (root.BiomeProfiles && !root.BiomeProfiles.faunaAllows(kind, grid[y * N + x]))
                || !WG.isSpawnCell(grid, N, N, x, y, opts, cls)) continue;
            ix = x; iy = y; bestDistance = distance;
          }
          if (ix < 0) { s.rec.shortfalls.push(`guard:${n}`); continue; }
          const [x, y] = position(ix, iy), [homeX, homeY] = position(target[0], target[1]);
          out.guards.push({ kind, id: `zg_${a.kind}_${a.gx}_${a.gy}_${n}`, x, y, homeX, homeY,
            zoneKind: a.kind, zoneVariant: v.id, stationary: kind === 'plant',
            ...(v.guards.proximityCells ? { proximityCells: v.guards.proximityCells } : {}), _ix: ix, _iy: iy });
          occ.add(iy * N + ix); s.rec.guardsPlaced++;
        }
      }
      if (s.chest) {
        s.chest.zoneVariant = v.id; delete s.chest._chestLook;
        if (a.kind === 'grove' || a.kind === 'beach') {
          // The park's place becomes its daily shrine, keeping its name,
          // stable POI identity and settled seat at the composition's centre.
          s.chest.kind = 'grove_shrine';
          s.chest.zoneKind = a.kind; s.chest.zoneLayer = 'shrine';
          if (v.shrineFrame != null) s.chest._zoneObjectFrame = v.shrineFrame;
          // A shrine kind (src/shrines.js) lends its boon in place of the gift.
          const shrineKind = s.shipwreck ? null : root.Shrines && root.Shrines.kindForZoneVariant(v.id);
          if (shrineKind) s.chest.shrineKind = shrineKind;
          delete s.chest.zoneNexus;
        } else s.chest.zoneNexus = a.kind;
      }
      // Outdoor slots touch the POI. Buildings use the wider table pattern.
      const pattern = s.indoor && v.poi.whenInsideBuilding ? v.poi.whenInsideBuilding : v.poi;
      if (owns(s, s.poi[0], s.poi[1])) s.clear.add(s.poi[1] * N + s.poi[0]);
      for (const slot of s.shipwreck ? [] : pattern.slots || []) {
        const [dx, dy] = V.rotate(slot.at[0], slot.at[1], s.rotation), ix = s.poi[0] + dx, iy = s.poi[1] + dy;
        if (owns(s, ix, iy)) s.poiSlots.set(iy * N + ix, slot.material);
      }
      yield* connectionSteps(s, opts, N, WG, motifAt);
      for (const [i, material] of s.poiSlots) place(s, i % N, Math.floor(i / N), material, 'poi');
      for (const [i, material] of s.connections) if (!s.poiSlots.has(i)) place(s, i % N, Math.floor(i / N), material, 'connection');
      // A churchyard or tar yard keeps its chest; its shrine kind stands
      // beside it on the first free ring cell (Zones.SHRINE_SEAT_R, N first,
      // clockwise), after the POI pattern and before the background fill.
      // Owner's tile only.
      const standKind = s.chest && s.chest.kind === 'chest' && a.owned && root.Shrines
        && root.Shrines.kindForZoneVariant(v.id);
      if (standKind) {
        let seated = false;
        for (let r = 1; r <= Z.SHRINE_SEAT_R && !seated; r++) for (const [ux, uy] of Z.RING_ORDER) {
          const ix = s.poi[0] + ux * r, iy = s.poi[1] + uy * r;
          if (!owns(s, ix, iy) || !WG.isSpawnCell(grid, N, N, ix, iy, opts, 'attractor')) continue;
          const [x, y] = position(ix, iy);
          out.objects.push(WG.makeObject('grove_shrine', x, y, WG.cellId('zsh', tx, ty, ix, iy),
            { zoneKind: a.kind, zoneVariant: v.id, shrineKind: standKind, _ix: ix, _iy: iy }));
          occ.add(iy * N + ix); s.clear.add(iy * N + ix); seated = true;
          break;
        }
        if (!seated) s.rec.shortfalls.push('shrine:' + standKind);
      }
      out.nexus.push({ zoneAnchor: a.key, zoneKind: a.kind, zoneVariant: v.id, chestId: s.chest && s.chest.kind === 'chest' ? s.chest.id : null, poiId: s.chest ? s.chest.id : null, pieces: s.rec.placed });
    }
    // Generated sites have no POI to turn into a shrine. Their optional
    // altar belongs to the complete source site, after its finite rewards
    // and entrances have claimed their seats, never to a clipped fragment.
    for (const s of states) {
      const { a, variant: v } = s;
      if (!(a.generated || v.generated) || !a.owned || a.clipped || !(v.shrineChance > 0)) continue;
      const identity = V.identity(a), shrineKind = root.Shrines?.kindForZoneVariant(v.id);
      if (!shrineKind || fnv1a(`zone-shrine|${identity}`) / 4294967296 >= v.shrineChance) continue;
      let seat = -1, rank = Infinity;
      for (let n = 0; n < s.cells.length; n++) {
        if ((n & 255) === 0) yield 'generated zone shrine';
        const i = s.cells[n], ix = i % N, iy = Math.floor(i / N);
        const fixed = s.quarryPlan?.shrineSeat;
        if (v.quarryLayout === 'crater' && (i !== fixed || !s.quarryPlan.hazards.every(j => grid[j] === WG.T.CAVE_LAVA))) continue;
        if ((s.clear.has(i) && i !== fixed) || s.poiSlots.has(i) || s.connections.has(i)
            || s.quarryPlan?.background.has(i) || ctx.tideSeats?.has(i)
            || ctx.poiPadCells?.has(i) || out.reservedCells?.has(i)
            || !WG.isSpawnCell(grid, N, N, ix, iy, opts, 'attractor')) continue;
        const score = Z.cellU01(tx * N + ix, ty * N + iy, 0xe6be2);
        if (score < rank || (score === rank && i < seat)) { seat = i; rank = score; }
      }
      if (seat < 0) { s.rec.shortfalls.push('shrine:' + shrineKind); continue; }
      const ix = seat % N, iy = Math.floor(seat / N), [x, y] = position(ix, iy);
      out.objects.push(WG.makeObject('grove_shrine', x, y, `zsh_${identity}`,
        { zoneKind: a.kind, zoneVariant: v.id, zoneLayer: 'shrine', shrineKind, _ix: ix, _iy: iy }));
      occ.add(seat); s.clear.add(seat); s.rec.placed++;
    }
    // Fit a bounded composition as a whole instead of clipping its stones
    // individually against a building. Only complete owner-local sites may
    // choose a new centre: a neighbouring tile cannot observe this occupancy.
    for (const s of states) {
      const b = s.variant.background, a = s.a;
      if (!b.fitToGround || b.type !== 'concentric_rings' || !a.owned) continue;
      const lx = a.gx - tx * EXT, ly = a.gy - ty * EXT;
      const extent = a.R * (1 + Z.EDGE_JITTER) / a.upm;
      if (!(extent >= 0) || lx - extent < 0 || ly - extent < 0
          || lx + extent >= EXT || ly + extent >= EXT
          || s.cells.some(i => i % N === 0 || i % N === N - 1 || i < N || i >= N * (N - 1))) continue;
      const radii = b.stoneRings.map(r => r.radiusCells).sort((a, b) => b - a);
      const innerRadius = radii[radii.length - 1];
      if (b.fitToGround.compactRadiusCells < innerRadius) radii.push(b.fitToGround.compactRadiusCells);
      const geometryOpts = { ...opts, occupied: initialOccupied };
      const diskFree = (cx, cy, radius, gateOpts) => {
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > (radius + 0.5) ** 2) continue;
          const x = cx + dx, y = cy + dy;
          if (!owns(s, x, y) || ctx.tideSeats?.has(y * N + x)
              || !WG.isSpawnCell(grid, N, N, x, y, gateOpts, 'minor')) return false;
        }
        return true;
      };
      const original = offsetCell(s, 0, 0);
      // Existing authored aisles/finds are intentional gaps in an otherwise
      // unobstructed garden. Keep those layouts and their cell identities.
      if (diskFree(...original, radii[0], geometryOpts)) continue;
      const candidates = s.cells.map(i => [i % N, Math.floor(i / N)]);
      candidates.sort((a, b) => (a[0] - original[0]) ** 2 + (a[1] - original[1]) ** 2
        - (b[0] - original[0]) ** 2 - (b[1] - original[1]) ** 2 || a[1] - b[1] || a[0] - b[0]);
      s.fittedBackground = new Map();
      s.rec.layout = { mode: 'no_fit' };
      search: for (const radius of radii) {
        let slots = b.slots.filter(slot => Math.hypot(slot.at[0] - b.centerCell[0],
          slot.at[1] - b.centerCell[1]) <= Math.max(radius, innerRadius) + 0.5);
        if (radius < innerRadius) {
          const compact = new Map();
          for (const slot of slots) {
            const at = slot.at.map((v, axis) => b.centerCell[axis] + Math.round((v - b.centerCell[axis]) * radius / innerRadius));
            if (!compact.has(at.join(','))) compact.set(at.join(','), { at, material: slot.material });
          }
          slots = [...compact.values()];
        }
        for (let n = 0; n < candidates.length; n++) {
          if ((n & 63) === 0) yield 'zone composition fit';
          const [cx, cy] = candidates[n];
          if (!diskFree(cx, cy, radius, opts)) continue;
          const plan = new Map();
          for (const slot of slots) {
            const [dx, dy] = V.rotate(slot.at[0] - b.centerCell[0], slot.at[1] - b.centerCell[1], s.rotation);
            const x = cx + dx, y = cy + dy, i = y * N + x;
            if (s.clear.has(i) || s.poiSlots.has(i) || s.connections.has(i) || !allowed(s, x, y, slot.material)) break;
            plan.set(i, slot.material);
          }
          if (plan.size !== slots.length) continue;
          s.fittedBackground = plan;
          s.rec.layout = { mode: 'adapted', center: [cx, cy], radiusCells: radius };
          break search;
        }
      }
      // A narrow church frontage cannot hold a circle. Try one complete
      // straight bed beside the building, keeping its intervening cells free.
      const bed = b.fitToGround.narrowBed;
      if (!s.fittedBackground.size && bed) {
        let best = null;
        const nearBuilding = (x, y) => [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => {
          for (let d = 1; d <= bed.spacingCells; d++) {
            const bx = x + dx * d, by = y + dy * d;
            if (bx >= 0 && by >= 0 && bx < N && by < N && WG.isBuildingTerrain(grid[by * N + bx])) return true;
          }
          return false;
        });
        for (let n = 0; n < candidates.length; n++) {
          if ((n & 63) === 0) yield 'zone frontage fit';
          const [cx, cy] = candidates[n];
          for (const [dx, dy] of [[1,0],[0,1]]) {
            const cells = [];
            for (let k = 0; k <= (bed.maxStones - 1) * bed.spacingCells; k++) {
              const x = cx + dx * k, y = cy + dy * k, i = y * N + x;
              if (!allowed(s, x, y, 'stone') || !nearBuilding(x, y)
                  || s.clear.has(i) || s.poiSlots.has(i) || s.connections.has(i)) break;
              cells.push(i);
            }
            const count = Math.floor((cells.length - 1) / bed.spacingCells) + 1;
            if (count < bed.minStones || (best && count <= best.count)) continue;
            best = { cells, count, center: [cx, cy], axis: dx ? 'x' : 'y' };
          }
        }
        if (best) {
          const sequence = b.stoneRings[0].sequence;
          for (let n = 0; n < best.count; n++) {
            const i = best.cells[n * bed.spacingCells], material = sequence[n % sequence.length];
            s.fittedBackground.set(i, material);
          }
          s.rec.layout = { mode: 'border', center: best.center, axis: best.axis, stones: best.count };
        }
      }
      if (!s.fittedBackground.size) s.rec.shortfalls.push('layout:no-complete-composition');
    }
    // Recheck joins against final reservations and material gates, after
    // finite finds and other authored objects have claimed their cells.
    for (const s of states) {
      if (s.variant.id !== 'quarry-stronghold' || !s.quarryPlan?.landmarks.some(m => m.kind === 'foundation')) continue;
      const plan = s.quarryPlan;
      const walls = new Set([...plan.background.keys()].filter(i =>
        ['stone','stronghold_wall'].includes(plan.background.get(i)) && !s.clear.has(i) && !s.poiSlots.has(i) && !s.connections.has(i)
        && !occ.has(i) && allowed(s, i % N, Math.floor(i / N), 'stone')));
      plan.wallFrames.clear();
      for (const i of walls) {
        const frame = root.QuarryLayout.wallFrameAt(walls, i, N);
        plan.background.set(i, frame == null ? 'stone' : 'stronghold_wall');
        if (frame != null) plan.wallFrames.set(i, frame);
      }
    }
    // Authored water treasure occupies only the first water cell off eligible
    // shore. Keep both the water reward and its walkable approach out of exclusions.
    for (const s of states) {
      const config = s.variant.shoreTreasure;
      if (!s.a.owned || !config) continue;
      const candidates = new Set(), waterOpts = { ...opts, waterOnly: true };
      const shoreOpts = { ...opts, occupied: null };
      for (const i of s.cells) {
        if ((i & 255) === 0) yield 'beach water treasure';
        const x = i % N, y = Math.floor(i / N);
        if (!WG.isSpawnCell(grid, N, N, x, y, shoreOpts, 'reward')) continue;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = x + dx, ny = y + dy;
          const j = ny * N + nx;
          const owner = states[coverage[j] - 1]?.a;
          const sameSite = owner && owner.gx === s.a.gx && owner.gy === s.a.gy && owner.key === s.a.key;
          if ((!coverage[j] || coverage[j] === s.ai + 1 || sameSite)
              && WG.isSpawnCell(grid, N, N, nx, ny, waterOpts, 'reward')) candidates.add(j);
        }
      }
      const seats = [], ranked = [...candidates].sort((a,b) =>
        Z.cellU01(tx * N + a % N, ty * N + Math.floor(a / N), 0xb34c)
        - Z.cellU01(tx * N + b % N, ty * N + Math.floor(b / N), 0xb34c) || a - b);
      for (const i of ranked) {
        if (seats.length >= config.count) break;
        const ix = i % N, iy = Math.floor(i / N);
        if (!WG.isSpawnCell(grid, N, N, ix, iy, waterOpts, 'reward')
            || seats.some(j => (ix-j%N)**2 + (iy-Math.floor(j/N))**2 < config.spacingCells**2)) continue;
        const [x,y] = position(ix,iy);
        out.objects.push(WG.makeObject('chest', x, y, WG.cellId(`shore_chest_${s.a.key}`,tx,ty,ix,iy),
          { tierSeed: config.tier, zone: s.a.kind, zoneVariant: s.variant.id, zoneAnchor: s.a.key,
            zoneLayer: 'shore_find', _ix: ix, _iy: iy }));
        occ.add(i); seats.push(i);
      }
    }
    // Small finite accents belong to the source anchor, not every repeating
    // motif. Keep authored paths, foundation cells and existing objects clear.
    for (const s of states) {
      if (!s.a.owned || !s.variant.decorations?.length) continue;
      const candidates = s.cells.filter(i => !s.clear.has(i) && !s.poiSlots.has(i)
        && !s.connections.has(i) && !s.quarryPlan?.background.has(i))
        .sort((a, b) => Z.cellU01(tx * N + a % N, ty * N + Math.floor(a / N), 0xdec0)
          - Z.cellU01(tx * N + b % N, ty * N + Math.floor(b / N), 0xdec0) || a - b);
      for (const decoration of s.variant.decorations) {
        let remaining = decoration.count;
        for (const i of candidates) {
          if (!remaining) break;
          if (!allowed(s, i % N, Math.floor(i / N), decoration.material)) continue;
          if (place(s, i % N, Math.floor(i / N), decoration.material, 'decoration')) remaining--;
        }
      }
    }
    const ground = { graves: 0, rocks: 0, fill: 0 };
    for (let iy = 0; iy < N; iy++) {
      if ((iy & 7) === 0) yield 'zone variant pattern rows';
      for (let ix = 0; ix < N; ix++) {
        const i = iy * N + ix, s = states[coverage[i] - 1];
        if (s) {
          const material = motifAt(s, ix, iy);
          if (!material) continue;
          const background = s.rec.background;
          background.planned++;
          // Composition replaces the nominal motif; initial occupancy records
          // competing spawns separately from this generator's finds and guards.
          if (s.clear.has(i) || s.poiSlots.has(i) || s.connections.has(i)
              || (occ.has(i) && !initialOccupied.has(i))) { background.reserved++; continue; }
          if (initialOccupied.has(i)) { background.occupied++; continue; }
          // Roll only beneath actual ordinary stones, including clipped sites.
          // Check the treasure gate before the rock claims the shared cell.
          const canBury = material === 'stone' && s.variant.buriedTreasureChance > 0
            && allowed(s, ix, iy, 'treasure_x');
          const o = place(s, ix, iy, material, 'background');
          background[o ? 'placed' : 'blocked']++;
          if (o && canBury && fnv1a(`${o.id}|buried-treasure`) / 4294967296 < s.variant.buriedTreasureChance) {
            out.treasures.push({ id: `${o.id}_treasure`, x: o.x, y: o.y,
              zoneKind: s.a.kind, zoneVariant: s.variant.id, zoneLayer: 'buried_find',
              _ix: ix, _iy: iy, coverRockId: o.id });
            s.rec.findsRequested++; s.rec.findsPlaced++;
          }
          if (o) { if (o.kind === 'headstone') ground.graves++; else if (o.kind === 'mineralrock') ground.rocks++; else if (o.kind === 'wildplant') ground.fill++; }
        } else if (ctx.fringe) {
          // Preserve unnamed parks' sparse fringe without assigning rewards.
          const fr = ctx.fringe, d = fr.edgeM[i];
          if (!(d > 0 && d <= Z.FRINGE_FILL_M) || !fr.park[i]) continue;
          const p = Z.FRINGE_FILL_P * (1 - d / Z.FRINGE_FILL_M);
          if (Z.cellU01(tx * N + ix, ty * N + iy, 0xf1a9e501) >= p || !WG.isSpawnCell(grid, N, N, ix, iy, opts, 'minor')) continue;
          const park = fr.parks[fr.park[i] - 1], character = root.BiomeProfiles && root.BiomeProfiles.parkCharacter(park.character);
          const [x, y] = position(ix, iy);
          out.wildplants.push(WG.makeWildplant(character && character.filler || 'longgrass', x, y, WG.cellId('wpf', tx, ty, ix, iy), { fringe: true }));
          occ.add(i); ground.fill++;
        }
      }
    }
    stampHedges(out.wildplants, N);
    out.ground = ground;
    if (ctx.fringe) {
      const chars = {};
      for (const park of ctx.fringe.parks) chars[park.character] = (chars[park.character] || 0) + 1;
      out.fringe = { painted: ctx.fringe.painted, parks: ctx.fringe.parks.length, chars };
    }
    return out;
  }
  // Connections alter only this generator's background. Roads cut the route;
  // a grid lane retains the continuous boundaries requested in its table.
  function* connectionSteps(s, opts, N, WG, motifAt) {
    const c = s.variant.connection;
    if (!c) return;
    const cells = new Set(s.cells), owns = (x, y) => x >= 0 && y >= 0 && x < N && y < N && cells.has(y * N + x);
    for (const target of s.findCells) {
      const dx = target[0] - s.poi[0], dy = target[1] - s.poi[1], length = Math.max(Math.abs(dx), Math.abs(dy));
      const px = Math.abs(dx) >= Math.abs(dy) ? 0 : 1, py = px ? 0 : 1, spacing = c.spacingCells || 3;
      for (let n = 1; n < length; n++) {
        if ((n & 63) === 0) yield 'zone connecting motif';
        let x = Math.round(s.poi[0] + dx * n / length), y = Math.round(s.poi[1] + dy * n / length);
        if (!owns(x, y)) continue;
        const i = y * N + x;
        // ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): GEOMETRY,
        // not the gate — this only decides where the connecting avenue's
        // WALK stops (never crossing a road), same as trapGroundKind's own
        // road clearance. Whether a marker actually gets PLACED on any cell
        // this walk visits is `allowed()`/`place()` above, which always
        // calls WG.isSpawnCell — the gate proper.
        if ((opts.roadMask && opts.roadMask[i]) || (WG.inMajorBuffer && WG.inMajorBuffer(opts.roadClass, N, x, y))) break;
        const shape = c.shape;
        if (shape === 'clear_aisle' || shape === 'aligned_ring_gaps' || shape === 'follow_grid_lane') {
          if (!c.preserveLines || !motifAt(s, x, y)) s.clear.add(i);
          if (shape !== 'aligned_ring_gaps' && !(c.material && n % spacing === 0)) continue;
          if (shape === 'aligned_ring_gaps') { x += px; y += py; }
        }
        if (n % spacing || !c.material) continue;
        const side = Math.floor(n / spacing) % 2 ? 1 : -1;
        let points;
        if (shape === 'paired_markers' || shape === 'avenue') points = [[x + px, y + py], [x - px, y - py]];
        else if (shape === 'alternating_markers') points = [[x + px * side, y + py * side]];
        else if (shape === 'offset_row' || shape === 'broken_row') {
          if (shape === 'broken_row' && Math.floor(n / spacing) % 3 === 0) continue;
          const shift = n > length / 2 ? 1 : 0; points = [[x + px * shift, y + py * shift]];
        } else points = [[x, y]];
        for (const [mx, my] of points) if (owns(mx, my)) s.connections.set(my * N + mx, c.material);
      }
    }
  }
  function hedgeGroup(p) {
    return p.crop === 'shrub' && ['formal_garden', 'hedge_garden'].includes(p.zoneVariant) ? p.zoneVariant : null;
  }
  function stampHedges(plants, N) {
    const groups = new Map();
    for (const p of plants) {
      if (!hedgeGroup(p)) continue;
      if (!groups.has(p.zoneVariant)) groups.set(p.zoneVariant, []);
      groups.get(p.zoneVariant).push(p);
    }
    for (const group of groups.values()) {
      const cells = new Set(group.map(p => p._iy * N + p._ix));
      for (const p of group) {
        const frame = root.QuarryLayout.wallFrameAt(cells, p._iy * N + p._ix, N);
        p._plantArt = frame == null ? 'zone_hedge_single' : 'zone_hedge';
        if (frame != null) p._hedgeFrame = frame;
        else delete p._hedgeFrame;
      }
    }
  }
  function dress(ctx) { const it = dressSteps(ctx); let r; do { r = it.next(); } while (!r.done); return r.value; }
  root.ZoneDressing = { dressSteps, dress, reserveWrecksSteps, WRECK_CHEST_TIER, stampHedges, hedgeGroup };
})(typeof globalThis !== 'undefined' ? globalThis : this);
