// Declarative zone layouts share the ordinary spawn gate and save ledgers.
// Pattern coordinates belong to the anchor grid, never the observing tile.
(function (root) {
  'use strict';
  const EXT = 4096;
  function* dressSteps(ctx) {
    const WG = root.WorldGen, V = root.ZoneVariants, Z = root.Zones;
    const out = { objects: [], wildplants: [], traps: [], guards: [], lairs: [], slowCells: new Map(), nexus: [], diagnostics: [] };
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
      const rec = { anchorKey: a.key, variant: variant.id, eligible: 0, placed: 0, findsRequested: a.owned ? variant.finds.count : 0,
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
      if (!owns(s, ix, iy)) return false;
      // Scenic shore sand is finalized after coverage; keep late sand out
      // of ordinary grove motifs too. Beach roses require vegetated ground.
      if (grid[iy * N + ix] === WG.T.SAND && s.variant.id === 'shellwater_strand' && material === 'rose') return false;
      const m = V.materials[material];
      if (!m) return false;
      const cls = m.recordType === 'enemy' && typeof root.creatureSpawnClass === 'function'
        ? root.creatureSpawnClass(m.kind) : m.spawnClass;
      if (!WG.isSpawnCell(grid, N, N, ix, iy, opts, cls)) return false;
      return m.recordType !== 'surface_trap' || !!(root.Traps && root.Traps.isTrapGround(grid, opts.roadClass, N, N, ix, iy, field.under, opts.roadMask));
    };
    const place = (s, ix, iy, material, layer, id) => {
      let m = V.materials[material];
      if (!allowed(s, ix, iy, material)) {
        if (!m || !m.fallback || !allowed(s, ix, iy, m.fallback)) return null;
        material = m.fallback; m = V.materials[material];
      }
      const i = iy * N + ix, [x, y] = position(ix, iy);
      const extra = { zone: s.a.kind, zoneVariant: s.variant.id, zoneLayer: layer, _ix: ix, _iy: iy };
      const look = s.variant.materialLooks && s.variant.materialLooks[material];
      if (m.kind === 'wildplant' && (look || m._plantArt)) extra._plantArt = look || m._plantArt;
      else if (look) extra._objectArt = look;
      const prefix = m.recordType === 'enemy' ? 'zp' : m.kind === 'wildplant' ? (layer === 'background' ? 'wpf' : 'wz')
        : ({ tree: 'ztree', fruittree: 'ft', mineralrock: 'mrz', headstone: 'hs', tar: 'tar' }[m.kind] || 'zt');
      id = id || WG.cellId(prefix, tx, ty, ix, iy);
      let record;
      if (m.recordType === 'surface_trap') { record = { id, x, y, ...extra }; out.traps.push(record); }
      else if (m.recordType === 'enemy') {
        // Pattern enemies share the ordinary guard/caught pipeline, but each
        // repeated seat owns its stable cell id rather than a finite-find id.
        record = { kind: m.kind, id, x, y, homeX: x, homeY: y, stationary: m.kind === 'plant', ...extra };
        out.guards.push(record);
      }
      else if (m.kind === 'wildplant') { record = WG.makeWildplant(m.crop, x, y, id, extra); out.wildplants.push(record); }
      else {
        if (m.species) extra.species = m.species;
        if (m.kind === 'tree') {
          extra.variant = 1;
          if (m.size) extra.size = m.size;
        }
        if (m.deposit) extra.deposit = m.deposit;
        if (m.yieldTier != null) extra.yieldTier = m.yieldTier;
        if (m.requiredTier != null) extra.requiredTier = m.requiredTier;
        if (m.rockVariant) extra.rockVariant = root.SpriteLayout ? root.SpriteLayout[m.rockVariant] : 3;
        record = WG.makeObject(m.kind, x, y, id, extra); out.objects.push(record);
        if (m.kind === 'tar') out.slowCells.set(i, 'tar');
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
    // A wreck is still the beach's one daily POI. Reserve its entire dry
    // footprint and approach before finite finds, guards and background fill.
    for (const s of states) {
      if (!s.chest || s.variant.id !== 'pirate_cove') continue;
      const extent = root.SpriteLayout.SHIPWRECK_SHRINE_ART.extentCells;
      const radius = Math.floor(extent / 2), original = s.poi.slice();
      const originalIndex = original[1] * N + original[0];
      const free = new Set(occ); free.delete(originalIndex);
      const shrineOpts = { ...opts, occupied: free };
      const [ax, ay] = V.rotate(0, -radius - 1, s.rotation);
      const footprint = (x, y) => {
        const cells = [];
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          const ix = x + dx, iy = y + dy;
          if (!owns(s, ix, iy) || grid[iy * N + ix] !== WG.T.SAND
              || !WG.isSpawnCell(grid, N, N, ix, iy, shrineOpts, 'minor')) return null;
          cells.push(iy * N + ix);
        }
        const ix = x + ax, iy = y + ay;
        if (!owns(s, ix, iy) || grid[iy * N + ix] !== WG.T.SAND
            || !WG.isSpawnCell(grid, N, N, ix, iy, shrineOpts, 'minor')) return null;
        cells.push(iy * N + ix);
        return cells;
      };
      let seat = original, reserved = footprint(...seat), distance = reserved ? 0 : Infinity;
      if (!reserved) for (let n = 0; n < s.cells.length; n++) {
        if ((n & 255) === 0) yield 'shipwreck footprint fallback';
        const i = s.cells[n], x = i % N, y = Math.floor(i / N);
        const d = (x - original[0]) ** 2 + (y - original[1]) ** 2;
        if (d >= distance) continue;
        const candidate = footprint(x, y);
        if (candidate) { seat = [x, y]; reserved = candidate; distance = d; }
      }
      if (!reserved) { s.rec.shortfalls.push('shrine:shipwreck'); continue; }
      const [x, y] = position(...seat);
      Object.assign(s.chest, { x, y, _ix: seat[0], _iy: seat[1],
        _shrineArt: 'shipwreck', _shrineExtentCells: extent });
      s.poi = seat; s.shipwreck = true;
      // Retain a clear old seat when relocating; only the existing POI moves.
      s.clear.add(originalIndex);
      for (const i of reserved) { occ.add(i); s.clear.add(i); }
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
                || !WG.isSpawnCell(grid, N, N, x, y, opts, cls)) continue;
            ix = x; iy = y; bestDistance = distance;
          }
          if (ix < 0) { s.rec.shortfalls.push(`guard:${n}`); continue; }
          const [x, y] = position(ix, iy), [homeX, homeY] = position(target[0], target[1]);
          out.guards.push({ kind, id: `zg_${a.kind}_${a.gx}_${a.gy}_${n}`, x, y, homeX, homeY,
            zone: a.kind, zoneVariant: v.id, stationary: kind === 'plant',
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
          s.chest.zone = a.kind; s.chest.zoneLayer = 'shrine';
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
      out.nexus.push({ kind: a.kind, aspect: v.id, variant: v.id, chestId: s.chest && s.chest.kind === 'chest' ? s.chest.id : null, poiId: s.chest ? s.chest.id : null, pieces: s.rec.placed });
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
          const o = place(s, ix, iy, material, 'background');
          background[o ? 'placed' : 'blocked']++;
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
  function dress(ctx) { const it = dressSteps(ctx); let r; do { r = it.next(); } while (!r.done); return r.value; }
  root.ZoneDressing = { dressSteps, dress };
})(typeof globalThis !== 'undefined' ? globalThis : this);
