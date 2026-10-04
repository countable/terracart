// FAUNA SEAT POOLS: _seatFaunaOnFavouriteGround builds every species'
// favourite-ground pool in ONE pass over the tile (a per-cell species mask)
// instead of a full-grid scan per species with a closure per ground — the
// bulk of a tile's spawn pass. The draws read the pools by index, so the
// pools must come out exactly as the old scans left them (ascending cells,
// the same grounds present, the same p per species). This pins the shipping
// method against the old algorithm, kept verbatim below, over randomised
// tiles carrying every kind of ground at once.
(() => {
  const FAUNA_ATTRACT_TRIES = 12;
  const oldSeat = function _seatFaunaOnFavouriteGround(entry, tx, ty, N, cellM, genGrid, spawnOpts, creatures, pestFree, unseated, blocked) {
    const moved = {};
    if (!creatures || (!creatures.length && !(unseated && unseated.length))) return moved;
    const SV = (typeof StreetVariants !== 'undefined') ? StreetVariants : null;
    const Z = (typeof Zones !== 'undefined') ? Zones : null;
    const BA = (typeof BIOME_ATTRACTS !== 'undefined') ? BIOME_ATTRACTS : null;
    // The grounds present on this tile, as [p, test(i)] per species.
    const want = {};
    const add = (attracts, test) => {
      if (!attracts) return;
      for (const [sp, p] of Object.entries(attracts)) (want[sp] || (want[sp] = [])).push({ p, test });
    };
    const marks = entry.streetMarks;
    if (SV && marks) {
      // Only present street grounds contribute a probability. An absent
      // Pilgrim's Way must not strengthen another zone's weaker crow pull.
      const present = new Set(marks);
      for (const row of SV.STREET_VARIANTS) if (row.attracts && present.has(row.code)) {
        add(row.attracts, (i) => marks[i] === row.code);
      }
    }
    // WALKING-PATH LAMPS: the cells beside every lamp a footway / path /
    // cycleway stands (Streets.PATH_LAMP_ATTRACTS — the cats, moved here from
    // Lantern Row). Every GENERATED lamp, lit or not: where an animal sits is
    // the same for every player, and restoration is per-save.
    const lampCells = this._pathLampCells ? this._pathLampCells(entry, tx, ty, N) : null;
    if (lampCells && lampCells.size && typeof Streets !== 'undefined' && Streets.PATH_LAMP_ATTRACTS) {
      add(Streets.PATH_LAMP_ATTRACTS, (i) => lampCells.has(i));
    }
    const zf = entry.zone;
    if (zf && zf.anchors && (zf.coverage || zf.idx)) {
      const coverage = zf.coverage || zf.idx;
      const groups = new Map();
      for (const owner of new Set(coverage)) {
        const anchor = zf.anchors[owner - 1];
        if (!anchor) continue;
        // An explicit empty affinity is intentional: it must not inherit the
        // old grove/churchyard defaults. Terrain and street pulls still apply.
        const row = anchor.variant
          ? (typeof ZoneVariants !== 'undefined' && ZoneVariants.byId(anchor.variant))
          : Z && Z.ZONE_KINDS[anchor.kind];
        if (!row || !row.attracts) continue;
        if (!groups.has(row)) groups.set(row, new Set());
        groups.get(row).add(owner);
      }
      // Group matching variants so the cell scan scales with variant count,
      // not every POI in a dense neighbourhood.
      for (const [row, owners] of groups) add(row.attracts, (i) => owners.has(coverage[i]));
    }
    if (BA) {
      const under = zf && zf.under;
      for (const code of Object.keys(BA)) {
        const c = +code;
        add(BA[code], (i) => (Z ? Z.landAt(genGrid, under, i) : genGrid[i]) === c);
      }
    }
    // Only species the tile actually spawned; p = 1 first (the dogs keep the
    // seats they had with an empty `taken`), then FAUNA_ORDER.
    const order = (typeof FAUNA_ORDER !== 'undefined' ? FAUNA_ORDER : []).slice();
    for (const sp of Object.keys(want)) if (!order.includes(sp)) order.push(sp);
    const pOf = (sp) => Math.max(...want[sp].map((g) => g.p));
    const has = (sp) => creatures.some((c) => c && c.kind === sp) || !!(unseated && unseated.some((c) => c && c.kind === sp));
    const species = order.filter((sp) => want[sp] && has(sp))
      .sort((a, b) => (pOf(b) >= 1) - (pOf(a) >= 1));
    if (!species.length) return moved;
    const taken = new Set();
    const NN = N * N;
    for (const sp of species) {
      const grounds = want[sp];
      const p = pOf(sp);
      const pool = [];
      for (let i = 0; i < NN; i++) {
        const owner = entry.zone && (entry.zone.coverage || entry.zone.idx)?.[i];
        if (owner) {
          const a = entry.zone.anchors[owner - 1];
          const row = a && (a.variant ? ZoneVariants.byId(a.variant) : Zones.ZONE_KINDS[a.kind]);
          if (row?.attracts?.[sp] > 0) pool.push(i);
        } else for (const g of grounds) if (g.test(i)) { pool.push(i); break; }
      }
      if (!pool.length) continue;
      const rng = WorldGen.makeRng(fnv1a(`${sp}s|${tx},${ty}`));
      const pest = (sp === 'slime' || sp === 'crow') ? pestFree : null;
      const spClass = creatureSpawnClass(sp);
      const seatOpts = spClass === 'fauna' || spClass === 'fastFauna'
        ? { ...spawnOpts, occupied: null } : spawnOpts;
      const free = (idx) => {
        if (taken.has(idx) || (blocked && blocked.has(idx)) || !BiomeProfiles.faunaAllows(sp, genGrid[idx])) return false;
        const cx = idx % N, cy = (idx / N) | 0;
        if (pest && pest.has(cx, cy)) return false;
        // The seat rule for anything alive: its own spawn class.
        return WorldGen.isSpawnCell(genGrid, N, N, cx, cy, seatOpts, spClass);
      };
      const seatOn = (c) => {
        let k = -1, at = -1;
        for (let a = 0; a < FAUNA_ATTRACT_TRIES; a++) {
          k = Math.floor(rng() * pool.length);
          if (free(pool[k])) { at = pool[k]; break; }
        }
        // A whole-species pull walks on along the ground from its last draw.
        if (at < 0 && p >= 1 && k >= 0) {
          for (let j = 1; j < pool.length; j++) {
            const idx = pool[(k + j) % pool.length];
            if (free(idx)) { at = idx; break; }
          }
        }
        if (at < 0) return false;
        taken.add(at);
        c.x = tx * this.tileEdgeM + ((at % N) + 0.5) * cellM;
        c.y = ty * this.tileEdgeM + (((at / N) | 0) + 0.5) * cellM;
        moved[sp] = (moved[sp] || 0) + 1;
        return true;
      };
      for (const c of creatures) {
        if (!c || c.kind !== sp) continue;
        if (p < 1 && rng() >= p) continue;
        seatOn(c);
      }
      if (p >= 1 && unseated) {
        for (const c of unseated) if (c && c.kind === sp && seatOn(c)) creatures.push(c);
      }
    }
    return moved;
  };
  const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const T = Object.values(WorldGen.T).filter((v) => typeof v === 'number');
  const streetCodes = StreetVariants.STREET_VARIANTS.map((r) => r.code);
  const zoneRows = ZoneVariants.rows;
  const kinds = Object.keys(Zones.ZONE_KINDS);
  const species = [...FAUNA_ORDER, 'rabbit', 'crab'];
  const build = (seed, N) => {
    const r = rngOf(seed);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const NN = N * N;
    const grid = new Uint8Array(NN);
    for (let i = 0; i < NN; i++) grid[i] = r() < 0.3 ? WorldGen.T.WASTELAND : pick(T);
    const entry = {};
    if (r() < 0.8) {
      const marks = new Uint8Array(NN);
      for (let i = 0; i < NN; i++) if (r() < 0.3) marks[i] = pick(streetCodes);
      entry.streetMarks = marks;
    }
    if (r() < 0.8) {
      const anchors = [];
      const nA = 1 + Math.floor(r() * 6);
      for (let a = 0; a < nA; a++) {
        anchors.push(r() < 0.6 ? { kind: pick(kinds), variant: pick(zoneRows).id } : { kind: pick(kinds) });
      }
      const coverage = new Uint16Array(NN);
      for (let i = 0; i < NN; i++) if (r() < 0.5) coverage[i] = Math.floor(r() * (nA + 2));
      const under = new Uint8Array(NN);
      under.present = new Uint8Array(NN);
      for (let i = 0; i < NN; i++) {
        if (r() < 0.2) under[i] = r() < 0.5 ? WorldGen.T.WASTELAND : pick(T);
        if (r() < 0.1) under.present[i] = 1;
      }
      entry.zone = r() < 0.5 ? { anchors, coverage, under } : { anchors, idx: coverage, under: r() < 0.5 ? under : null };
    }
    const lamps = new Set();
    if (r() < 0.6) for (let k = 0; k < NN / 20; k++) lamps.add(Math.floor(r() * NN));
    const creatures = [];
    const unseated = [];
    for (const sp of species) {
      if (r() < 0.2) continue;
      const n = Math.floor(r() * 20);
      for (let k = 0; k < n; k++) creatures.push({ id: `${sp}_${k}`, kind: sp, x: -1, y: -1 });
      if (r() < 0.3) unseated.push({ id: `${sp}_u`, kind: sp, x: NaN, y: NaN });
    }
    const blocked = new Set();
    for (let k = 0; k < NN / 30; k++) blocked.add(Math.floor(r() * NN));
    const spawnWhy = new Uint16Array(NN);
    const opts = { spawnWhy, occupied: new Set() };
    const pest = r() < 0.5 ? { has: (x, y) => x < 5 && y < 5 } : null;
    return { N, grid, entry, lamps, creatures, unseated, blocked, opts, pest };
  };
  const run = (fn, seed, N) => {
    const f = build(seed, N);
    const scene = Object.assign(new SceneCreatures(), { tileEdgeM: N * 7, _pathLampCells: () => f.lamps });
    const moved = fn.call(scene, f.entry, 3, 4, N, 7, f.grid, f.opts, f.creatures, f.pest, f.unseated, f.blocked);
    return JSON.stringify({ moved, creatures: f.creatures });
  };
  test('fauna seat pools: the one-pass pools seat every animal where the per-species scans did', () => {
    const proto = SceneCreatures.prototype._seatFaunaOnFavouriteGround;
    let movedAny = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const N = 24 + (seed % 3) * 13;
      const a = run(oldSeat, seed, N), b = run(proto, seed, N);
      assert.eq(b, a, `seed ${seed}: seats differ from the old algorithm`);
      movedAny += Object.keys(JSON.parse(a).moved).length;
    }
    assert.gt(movedAny, 40, 'the fixtures actually move animals');
  });
  test('fauna seat pools: attracted park crows leave space around birds and interactables', () => {
    const N = 16, cellM = 7, grid = new Uint8Array(N * N).fill(WorldGen.T.PARK);
    const mask = new Uint8Array(N * N).fill(1), occupied = new Set();
    for (let y = 0; y < N; y++) occupied.add(y * N + 7);
    const entry = { scenic:{shore:{mask}},
      streetMarks:new Uint8Array(N*N).fill(StreetVariants.VARIANT_BY_ID.pilgrim.code),
      zone:{coverage:new Uint16Array(N * N),
      anchors:[{kind:'beach',variant:'pirate_cove'}]} };
    const scene = Object.assign(new SceneCreatures(), {tileEdgeM:N * cellM});
    const run = () => {
      const creatures = Array.from({length:300}, (_,n) => ({id:`crow_${n}`,kind:'crow',x:-100,y:-100}));
      creatures.push({id:'resident',kind:'crow',x:3.5 * cellM,y:3.5 * cellM});
      const moved = scene._seatFaunaOnFavouriteGround(entry,0,0,N,cellM,grid,{occupied},creatures,null,[],new Set());
      return {creatures,moved};
    };
    const a = run(), b = run();
    assert.eq(JSON.stringify(a), JSON.stringify(b), 'stable landings across rebuilds');
    assert.eq(a.creatures.length,301,'failed attraction retains every animal');
    const landed = a.creatures.filter(c => c.id !== 'resident' && c.x >= 0);
    assert.gt(landed.length,0,'park still attracts crows');
    assert.lt(landed.length,70,'crowding limits arrivals without deleting birds');
    const seat = c => [Math.floor(c.x/cellM),Math.floor(c.y/cellM)];
    for (let i=0;i<landed.length;i++) {
      const [x,y]=seat(landed[i]);
      assert.falsy(occupied.has(y*N+x),'no landing on a beach interactable');
      assert.gt(Math.max(Math.abs(x-3),Math.abs(y-3)),1,'existing shore bird keeps breathing room');
      for(let j=0;j<i;j++) {
        const [px,py]=seat(landed[j]);
        assert.gt(Math.max(Math.abs(x-px),Math.abs(y-py)),1,'new landings are not adjacent');
      }
    }
  });
  test('fauna attraction: nexus permits only its authored species over global terrain and street pulls', () => {
    const N=16, cellM=7, grid=new Uint8Array(N*N).fill(WorldGen.T.PARK);
    const scene=Object.assign(new SceneCreatures(),{tileEdgeM:N*cellM});
    const entry={ streetMarks:new Uint8Array(N*N).fill(StreetVariants.VARIANT_BY_ID.pilgrim.code),
      zone:{coverage:new Uint16Array(N*N).fill(1),anchors:[{kind:'beach',variant:'pirate_cove'}]} };
    const crows=Array.from({length:100},(_,i)=>({kind:'crow',id:`c${i}`,x:-1,y:-1}));
    scene._seatFaunaOnFavouriteGround(entry,0,0,N,cellM,grid,{},crows,null,[],new Set());
    assert.truthy(crows.every(c=>c.x===-1),'empty pirate affinity refuses global birds');
    const authored=ZoneVariants.rows.find(r=>Object.values(r.attracts||{}).some(p=>p>0));
    const species=Object.keys(authored.attracts).find(sp=>authored.attracts[sp]>0);
    entry.zone.anchors[0]={kind:authored.zone,variant:authored.id};
    const fauna=Array.from({length:100},(_,i)=>({kind:species,id:`f${i}`,x:-1,y:-1}));
    scene._seatFaunaOnFavouriteGround(entry,0,0,N,cellM,grid,{},fauna,null,[],new Set());
    assert.truthy(fauna.some(c=>c.x>=0),'explicit row attraction can enter its nexus');
  });
  test('fauna attraction: authored groves and walking-path lamps respect habitat restrictions', () => {
    const N=12, cellM=7, scene=Object.assign(new SceneCreatures(),{tileEdgeM:N*cellM,
      _pathLampCells:()=>new Set(Array.from({length:N*N},(_,i)=>i))});
    for (const [kind,terrain,allowed] of [['deer',WorldGen.T.PARK,false],['deer',WorldGen.T.FOREST,true],
      ['cat',WorldGen.T.WASTELAND,false],['cat',WorldGen.T.GRASS,true]]) {
      const grid=new Uint8Array(N*N).fill(terrain);
      const entry=kind==='deer'?{zone:{coverage:new Uint16Array(N*N).fill(1),anchors:[{kind:'grove'}]}}:{};
      const animals=Array.from({length:80},(_,i)=>({kind,id:`${kind}${i}`,x:-1,y:-1}));
      scene._seatFaunaOnFavouriteGround(entry,0,0,N,cellM,grid,{spawnWhy:new Uint16Array(N*N)},animals,null,[],new Set());
      assert.eq(animals.some(c=>c.x>=0),allowed,`${kind} attracted onto terrain ${terrain}`);
    }
  });
})();
