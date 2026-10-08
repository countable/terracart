// Shallow cave overlays use generated surface evidence, never restored streets
// or player-dug floors. Each OSM segment owns its theme and shrine roll.
(function (root) {
  'use strict';
  const PATHS = new Set(['path', 'footway', 'track', 'pedestrian', 'cycleway', 'steps']);
  const STREETS = new Set(['minor', 'street', 'service']);
  const THEMES = ['root_passage', 'seep_passage', 'miners_way', 'warren_run', 'gemstone_path'];
  function hash(text) {
    let h = 2166136261;
    for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  const roll = key => hash(key) / 4294967296;
  function gem(depth, key) {
    const rows = typeof GEM_DEPOSITS === 'undefined' ? []
      : [...new Map(Object.values(GEM_DEPOSITS).map(g => [g.item, g])).values()];
    const eligible = rows.filter(g => g.yieldTier <= depth);
    if (!eligible.length) return null;
    // Ordinary low gems favor quartz 3:1; themed pockets use the same finite pool.
    const pool = eligible.flatMap(g => g.yieldTier === 1 ? [g, g, g] : [g]);
    const g = pool[hash(key) % pool.length];
    return { deposit: g.item, yieldTier: g.yieldTier, requiredTier: g.requiredTier };
  }
  function surfaceData(surface) {
    const source = surface.zone?.caveSource || surface.caveSource;
    return { grid: source?.grid || surface.baseGrid || surface.grid,
      why: source?.spawnWhy || surface.spawnWhy, zone: surface.zone };
  }
  function allowed(data, i, street = false, cls = 'minor') {
    const W = root.WorldGen, t = data.grid[i], bits = data.why?.[i] || 0;
    const ignored = street ? W.SPAWN_WHY.TERRAIN | W.SPAWN_WHY.ROAD : 0;
    // Suppressed land stays suppressed even where small streets carve rock.
    if ((bits & ~ignored) || !(W.isWalkable(t) || (street && t === W.T.ROAD))
      || t === W.T.WATER || t === W.T.PIER) return false;
    if (!data.gateGrid) {
      data.gateGrid = data.grid.slice(); data.gateWhy = Uint16Array.from(data.why || new Uint16Array(data.grid.length));
      for (let j = 0; j < data.grid.length; j++) if (data.grid[j] === W.T.ROAD) {
        data.gateGrid[j] = W.T.CAVE_FLOOR;
        data.gateWhy[j] &= ~(W.SPAWN_WHY.TERRAIN | W.SPAWN_WHY.ROAD);
      }
    }
    const N = Math.sqrt(data.grid.length);
    return W.isSpawnCell(data.gateGrid, N, N, i % N, Math.floor(i / N), { spawnWhy: data.gateWhy }, cls);
  }
  function segmentKey(id, a, b) {
    const points = [a, b].map(p => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`).sort();
    return `underground-route/${id ?? 'geometry'}/${points.join('/')}`;
  }
  function project(surface, grid, N, tx, ty, tileEdgeM, depth) {
    const W = root.WorldGen, data = surfaceData(surface), cellM = tileEdgeM / N;
    const routes = [], routeAt = new Map(), lane = new Set(), streetCells = new Set();
    const out = { routes, routeAt, lane, streetCells, data, depth, N, tx, ty, tileEdgeM };
    // Street mirroring is a floor-profile flag (WorldGen.FLOOR_PROFILES),
    // not a depth literal: floors that opt in project surface routes down.
    if (!root.WorldGen.floorProfile?.(depth)?.streetMirror) return out;
    for (const layer of surface.layers || []) {
      if (layer.name !== 'transportation') continue;
      const scale = tileEdgeM / (layer.extent || 4096);
      for (const f of layer.features || []) {
        const tags = f.tags || {}, path = PATHS.has(tags.class), street = STREETS.has(tags.class);
        if ((!path && !street) || f.type !== 2 || tags.access === 'private' || tags.access === 'no'
          || tags.service === 'driveway' || tags.service === 'parking_aisle'
          || tags.brunnel === 'bridge' || tags.bridge === 'yes') continue;
        for (const [lineIndex, line] of (f.geom || []).entries()) for (let k = 1; k < line.length; k++) {
          let a = { x: tx * tileEdgeM + line[k - 1].x * scale, y: ty * tileEdgeM + line[k - 1].y * scale };
          let b = { x: tx * tileEdgeM + line[k].x * scale, y: ty * tileEdgeM + line[k].y * scale };
          if (a.x > b.x || (a.x === b.x && a.y > b.y)) [a, b] = [b, a];
          const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
          if (!len2) continue;
          const key = segmentKey(f.id, a, b), id = `${key}/${depth}`;
          const owner = { x: tx * tileEdgeM + line[0].x * scale, y: ty * tileEdgeM + line[0].y * scale };
          const routeKey = f.id != null ? `underground-way/${f.id}/${lineIndex}/${depth}` : id;
          const rec = { id, key, routeKey, owner, street, theme: street && roll(`${routeKey}/bone-gallery`) < .25 ? 'bone_gallery' : THEMES[hash(`${routeKey}/theme`) % THEMES.length], cells: [],
            midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
          const width = street ? Math.max(cellM, W.roadOverlayWidthM(tags) / 2) + cellM * 2 : cellM * 2.5;
          const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - tx * tileEdgeM - width) / cellM));
          const x1 = Math.min(N - 1, Math.floor((Math.max(a.x, b.x) - tx * tileEdgeM + width) / cellM));
          const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - ty * tileEdgeM - width) / cellM));
          const y1 = Math.min(N - 1, Math.floor((Math.max(a.y, b.y) - ty * tileEdgeM + width) / cellM));
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const i = y * N + x, wx = tx * tileEdgeM + (x + .5) * cellM, wy = ty * tileEdgeM + (y + .5) * cellM;
            const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / len2));
            const distance = Math.hypot(wx - a.x - t * dx, wy - a.y - t * dy);
            if (distance > width || !allowed(data, i, street)) continue;
            if (street && data.grid[i] === W.T.ROAD) grid[i] = W.T.CAVE_FLOOR;
            if (street && grid[i] === W.T.CAVE_FLOOR) streetCells.add(i);
            if (grid[i] !== W.T.CAVE_FLOOR) continue;
            rec.cells.push(i);
            const prev = routeAt.get(i);
            if (!prev || id < prev.id) routeAt.set(i, rec);
            if (distance <= cellM * .6 || t < .04 || t > .96) lane.add(i);
          }
          if (rec.cells.length) routes.push(rec);
        }
      }
    }
    routes.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }
  function decorate(plan, grid, objects, wildplants, occupied) {
    const W = root.WorldGen, { N, tx, ty, tileEdgeM, depth, data } = plan, cellM = tileEdgeM / N;
    const profile = W.floorProfile(depth);
    if (!profile.streetMirror) return;
    const index = o => Math.floor((o.y - ty * tileEdgeM) / cellM) * N + Math.floor((o.x - tx * tileEdgeM) / cellM);
    const keyAt = i => `${tx}/${ty}/${i % N}/${Math.floor(i / N)}/${depth}`;
    const reserved = new Set(plan.lane), approaches = new Set();
    for (const o of objects) if (o.kind === 'staircase' || o.kind === 'chest') {
      const i = index(o), x = i % N, y = Math.floor(i / N);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (x + dx >= 0 && x + dx < N && y + dy >= 0 && y + dy < N) {
          const cell = (y + dy) * N + x + dx;
          reserved.add(cell); approaches.add(cell);
        }
    }
    // Keep generated centre lanes open; remove only ordinary dressing, never stairs/finds.
    for (let k = objects.length - 1; k >= 0; k--) if (objects[k].kind === 'mineralrock' && !objects[k].caveArea && reserved.has(index(objects[k]))) {
      occupied.delete(index(objects[k])); objects.splice(k, 1);
    }
    const coverage = data.zone?.coverage || data.zone?.idx;
    const gemstoneRegion = i => {
      const anchor = data.zone?.anchors?.[(coverage?.[i] || 0) - 1];
      if (!anchor || anchor.kind !== 'grove') return false;
      return roll(`underground/${anchor.key ?? `${anchor.gx},${anchor.gy}`}/${depth}/gemstone`) < (profile.streetGems?.region || 0);
    };
    for (const o of objects) {
      if (o.kind !== 'mineralrock' || o.caveArea) continue;
      const i = index(o), route = plan.routeAt.get(i), street = plan.streetCells.has(i);
      if (!allowed(data, i, street) || reserved.has(i)) continue;
      const key = keyAt(i), themed = route?.theme === 'gemstone_path' || gemstoneRegion(i);
      const bonus = street || data.grid[i] === W.T.SAND || data.grid[i] === W.T.COMMERCIAL;
      const ordinary = !coverage?.[i] && roll(`${key}/gem`) < (profile.streetGems?.ordinary || 0) * (bonus ? 2 : 1);
      if ((themed && roll(`${key}/pocket`) < .6) || ordinary) {
        const deposit = gem(depth, `${key}/gem-kind`);
        if (deposit) { delete o.caveVariant; Object.assign(o, deposit, { depth }); }
      }
    }
    const put = (i, kind, id, props = {}) => {
      occupied.add(i);
      const o = { kind, x: tx * tileEdgeM + (i % N + .5) * cellM,
        y: ty * tileEdgeM + (Math.floor(i / N) + .5) * cellM, id, depth, ...props };
      objects.push(o); return o;
    };
    for (const w of wildplants) occupied.add(index(w));
    // Own a route at its source geometry endpoint. Buffered/clipped pieces whose
    // first point lies outside this tile cannot mint a second shrine.
    // Bone galleries own a compact cluster and one strong level-appropriate
    // defender. Caches are passable floor finds, so may line the centre lane;
    // stairs, treasure approaches, and existing seats remain clear.
    plan.boneGuards = [];
    const boneSeen = new Set();
    for (const r of plan.routes) {
      if (!r.street || r.theme !== 'bone_gallery' || boneSeen.has(r.routeKey)) continue;
      boneSeen.add(r.routeKey);
      if (Math.floor(r.owner.x / tileEdgeM) !== tx || Math.floor(r.owner.y / tileEdgeM) !== ty) continue;
      const cells = new Set(plan.routes.filter(other => other.routeKey === r.routeKey).flatMap(other => other.cells));
      const seats = [...cells].filter(i => grid[i] === W.T.CAVE_FLOOR && allowed(data, i, true, 'minor') && !occupied.has(i)
        && (!reserved.has(i) || plan.lane.has(i)) && plan.routeAt.get(i)?.routeKey === r.routeKey
        && !approaches.has(i));
      if (seats.length < 4) continue;
      const centre = seats[hash(`${r.routeKey}/bone-centre`) % seats.length];
      const distance = i => Math.hypot(i % N - centre % N, Math.floor(i / N) - Math.floor(centre / N));
      seats.sort((a, b) => distance(a) - distance(b) || a - b);
      const cluster = seats.filter(i => distance(i) <= 4).slice(0, 7);
      if (cluster.length < 4) continue;
      const pool = root.EnemySpawns.caveRows(depth);
      const maxTier = Math.max(...pool.map(row => row.tier));
      const strongest = pool.filter(row => row.tier === maxTier).sort((a, b) => b.hp * b.dmg - a.hp * a.dmg);
      if (!strongest.length) continue;
      const row = strongest[0];
      const guardIndex = cluster.findIndex(i => allowed(data, i, true, creatureSpawnClass(row.id)));
      if (guardIndex < 0) continue;
      const guardSeat = cluster.splice(guardIndex, 1)[0];
      for (const i of cluster) put(i, 'bone_cache', `underground/${keyAt(i)}/bone-cache`, { undergroundTheme: 'bone_gallery' });
      {
        occupied.add(guardSeat);
        plan.boneGuards.push({ id: `${r.routeKey}/bone-guard`, kind: row.id, shiny: !!row.eliteEligible,
          x: tx * tileEdgeM + (guardSeat % N + .5) * cellM,
          y: ty * tileEdgeM + (Math.floor(guardSeat / N) + .5) * cellM });
      }
    }
    const seen = new Set();
    for (const r of plan.routes) {
      if (seen.has(r.routeKey)) continue; seen.add(r.routeKey);
      if (Math.floor(r.owner.x / tileEdgeM) !== tx || Math.floor(r.owner.y / tileEdgeM) !== ty
        || roll(`${r.routeKey}/shrine`) >= .5) continue;
      const cells = new Set(plan.routes.filter(other => other.routeKey === r.routeKey).flatMap(other => other.cells));
      const seats = [...cells].filter(i => !reserved.has(i) && !occupied.has(i) && allowed(data, i, r.street, 'attractor') && plan.routeAt.get(i)?.routeKey === r.routeKey);
      seats.sort((a, b) => hash(`${r.routeKey}/seat/${keyAt(a)}`) - hash(`${r.routeKey}/seat/${keyAt(b)}`));
      if (seats.length) put(seats[0], 'grove_shrine', `${r.routeKey}/shrine`, { shrineKind: 'wayfarer_post' });
    }
    for (const [i, r] of plan.routeAt) {
      if (occupied.has(i) || reserved.has(i)) continue;
      const key = keyAt(i), street = plan.streetCells.has(i);
      if (street && roll(`${key}/hazard`) < .10) {
        const kind = ['inactive_poison_vent', 'stalagmites', 'ground_hole'][hash(`${key}/hazard-kind`) % 3];
        put(i, kind, `underground/${key}/${kind}`, { active: false });
      } else if (r.theme === 'gemstone_path' && roll(`${key}/gem-pocket`) < .12) {
        const deposit = gem(depth, `${key}/pocket-kind`);
        if (deposit) put(i, 'mineralrock', `underground/${key}/gem`, deposit);
      } else if (r.theme === 'miners_way' && roll(`${key}/ore-pocket`) < .08) {
        put(i, 'mineralrock', `underground/${key}/ore`, { yieldTier: 2, requiredTier: 1 });
      } else if (r.theme === 'warren_run' && roll(`${key}/stores`) < .06) {
        put(i, 'chest', `underground/${key}/barrel`, { barrel: true });
      } else if (r.theme === 'seep_passage' && !street && roll(`${key}/pool`) < .12) {
        // Side pools never replace the through lane. Keep the bank accessible.
        grid[i] = W.T.WATER; occupied.add(i);
      } else if (r.theme === 'root_passage' && roll(`${key}/mushroom`) < .08) {
        wildplants.push({ kind: 'wildplant', crop: 'mushroom', x: tx * tileEdgeM + (i % N + .5) * cellM,
          y: ty * tileEdgeM + (Math.floor(i / N) + .5) * cellM,
          id: `underground/${key}/mushroom`, _ix: i % N, _iy: Math.floor(i / N), _cave: true });
        occupied.add(i);
      }
    }
  }
  root.Underground = { THEMES, STREET_THEMES: [...THEMES, 'bone_gallery'], project, decorate, gem, surfaceData, allowed, segmentKey };
})(typeof window !== 'undefined' ? window : globalThis);
