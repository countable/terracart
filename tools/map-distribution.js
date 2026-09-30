// ── WORLD PER TILE ──────────────────────────────────────────────────────────
// Builds the fixture tiles with the game's own code (the map review's
// recipe: MVT.decodeTile → WorldGen.rasterizeTile → MapScene.prototype.
// spawnInTile on a light scene) and COUNTS what landed. Nothing here is a
// copy of a game rule: terrain names come from WorldGen.T, the variants from
// StreetVariants.STREET_VARIANTS, zone kinds from Zones.ZONE_KINDS, chest
// looks from loot.js chestLook, ambient traps from Traps.spawnSurface at each
// mode's Difficulty.PROFILES trapCountMul, plus seated authored encounters.
// The original fixture block plus downtown centres for the other review cities.
const W_CITIES = {
  kelowna: { name: 'Kelowna', centre: [2754, 5566] },
  vancouver: { name: 'Vancouver', lat: 49.28, lon: -123.12 },
  seattle: { name: 'Seattle', lat: 47.6062, lon: -122.3321 },
  berlin: { name: 'Berlin', lat: 52.52, lon: 13.405 },
};
const wCity = () => W_CITIES[$('wCity').value];
function wTileList() {
  const city = wCity(), n = 1 << WorldGen.Z;
  const [cx, cy] = city.centre || [Math.floor((city.lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(city.lat * Math.PI / 180) + 1 / Math.cos(city.lat * Math.PI / 180)) / Math.PI) / 2 * n)];
  return Array.from({ length: 9 }, (_, i) => [cx + i % 3 - 1, cy + Math.floor(i / 3) - 1]);
}
const wRaw = { tiles: null, source: '', errors: [] };
const wZones = { ref: undefined, inIndex: false, previewing: false };
// src/scenic.js before index.html loads it: loaded by this page once (see wBuild).
const wScenic = { tried: false, previewing: false };
async function wTileBytes(tx, ty) {
  const r = await fetch(`../test/fixtures/${tx}_${ty}.pbf`).catch(() => null);
  if (r && r.ok) return { b: new Uint8Array(await r.arrayBuffer()), src: 'fixture' };
  // Use the game's current tile URL resolution, retry and cache behavior.
  const { bytes, fromCache } = await WorldGen.fetchTileBytes(tx, ty);
  return { b: new Uint8Array(bytes), src: fromCache ? 'cached' : 'live' };
}
const wTick = () => new Promise((r) => setTimeout(r, 0));
const wNames = () => Object.fromEntries(Object.entries(WorldGen.T).map(([k, v]) => [v, k]));
const f1 = (v) => (v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const wPct = (v) => (v * 100).toFixed(v < 0.01 && v > 0 ? 2 : 1) + '%';

function wScene(EDGE, home, midTy) {
  const s = Object.create(MapScene.prototype);
  Object.assign(s, {
    tileEdgeM: EDGE, depth: 0, save: {}, startWorldM: home, playerM: { x: 0, y: 0 },
    mPerPx: EDGE / WorldGen.TILE_PX,
    originPx: { x: home.x / (EDGE / WorldGen.TILE_PX), y: home.y / (EDGE / WorldGen.TILE_PX) },
    cellM: WorldGen.CELL_M, cellsForRow: WorldGen.cellsPerEdgeForTile,
    cellPx: 32, feetOffsetM: 0, peekM: { x: 0, y: 0 },
    _popEnergy() {}, _crowRaids: [], flash() {}, flashLoot() {},
  });
  s.cellsPerTile = WorldGen.cellsPerEdgeForTile(midTy);
  return s;
}

// One tile's numbers. `e` is the built entry (rasterize + spawnInTile).
function wMeasure(e, EDGE, errors) {
  const N = e.cellsPerEdge, NN = N * N, T = WorldGen.T;
  const BAND = WorldGen.ROAD_CLASS_MAJOR_BAND || 1, VERGE = WorldGen.ROAD_CLASS_MAJOR_VERGE || 2;
  const m = { tile: `${e.tx}/${e.ty}`, N, cells: NN, terrain: {}, errors: [] };
  const grid = e.grid, gen = e.baseGrid || e.grid;
  for (let i = 0; i < NN; i++) m.terrain[grid[i]] = (m.terrain[grid[i]] || 0) + 1;
  m.wasteland = T.WASTELAND != null ? (m.terrain[T.WASTELAND] || 0) / NN : null;
  let mask = 0, band = 0, verge = 0;
  for (let i = 0; i < NN; i++) {
    if (e.roadMask && e.roadMask[i]) mask++;
    if (e.roadClass) { if (e.roadClass[i] & BAND) band++; if (e.roadClass[i] & VERGE) verge++; }
  }
  let bandit = 0;
  const BANDIT = WorldGen.ROAD_CLASS_BANDIT_VERGE || 0;
  if (BANDIT && e.roadClass) for (let i = 0; i < NN; i++) if (e.roadClass[i] & BANDIT) bandit++;
  m.mask = e.roadMask ? mask / NN : null;
  m.band = e.roadClass ? band / NN : null;
  m.verge = e.roadClass ? verge / NN : null;
  m.bandit = (e.roadClass && BANDIT) ? bandit / NN : null;
  // Street guard posts by tier (wagon / close / barricade / burned / tar), and
  // the fauna the attractor lane moved (entry.faunaAttracted).
  m.posts = {};
  for (const L of (e.streetLairs || [])) m.posts[L.tier] = (m.posts[L.tier] || 0) + 1;
  m.attracted = Object.assign({}, e.faunaAttracted || {});
  const cellOf = (p) => {
    const ix = Math.floor((p.x - e.tx * EDGE) / (EDGE / N)), iy = Math.floor((p.y - e.ty * EDGE) / (EDGE / N));
    return (ix >= 0 && iy >= 0 && ix < N && iy < N) ? iy * N + ix : -1;
  };
  const where = (i) => i < 0 ? 'off tile'
    : (e.roadClass && (e.roadClass[i] & VERGE)) ? 'major verge'
    : (T.WASTELAND != null && gen[i] === T.WASTELAND) ? 'wasteland'
    : (T.WASTELAND != null && grid[i] === T.WASTELAND) ? 'wasteland' : 'other';
  // Traps, both modes, off the tile's own spawn options.
  m.traps = {}; m.danger = null;
  if (typeof Traps !== 'undefined' && Traps.spawnSurface && typeof Difficulty !== 'undefined') {
    if (Traps.tileDanger) m.danger = Traps.tileDanger(e.tx, e.ty);
    for (const mode of [Difficulty.EASY, Difficulty.HARD]) {
      try {
        const list = Traps.spawnSurface(gen, e.roadClass, N, N, e.tx, e.ty, EDGE, e._ambientSpawnOpts || e._spawnOpts || {},
          Difficulty.PROFILES[mode].trapCountMul, e.zone && e.zone.under);
        // Runtime has already resolved authored seats against landmarks and
        // each other. Preserve that accepted set, as the mode relay does;
        // counting raw dressing would include traps rejected for collisions.
        const cells = new Set(list.map(t => t._iy * N + t._ix));
        for (const t of e.traps || []) {
          const cell = t._iy * N + t._ix;
          if ((!t.zoneVariant && !t._street) || cells.has(cell)) continue;
          list.push(t);
          cells.add(cell);
        }
        const at = {};
        for (const t of list) {
          const ground = Traps.trapGroundKind(gen, e.roadClass, N, N, t._ix, t._iy, e.zone && e.zone.under, e.roadMask);
          const place = t._street ? 'street encounter' : t.zoneVariant ? 'zone encounter'
            : t._ix < 0 || t._iy < 0 || t._ix >= N || t._iy >= N ? 'off tile'
            : ground === 1 ? 'pathside' : ground === 2 ? 'park edge' : 'other';
          at[place] = (at[place] || 0) + 1;
        }
        m.traps[mode] = { n: list.length, at };
      } catch (err) { m.errors.push(`traps ${mode}: ${err.message}`); }
    }
  }
  // Dogs (the bandit roads' other reason).
  const dogs = (e.creatures || []).filter((c) => c.kind === 'dog');
  m.dogs = dogs.length; m.dogsVerge = dogs.filter((d) => where(cellOf(d)) === 'major verge').length;
  // Objects: the tile's own plus the zone dressing when spawnInTile has not
  // laid it yet (dedupe by id either way).
  const seen = new Set(), objs = [], plants = [];
  const zd = e.zoneDress || null;
  for (const o of [...(e.objects || []), ...((zd && zd.objects) || [])]) { if (o && !seen.has(o.id)) { seen.add(o.id); objs.push(o); } }
  for (const w of [...(e.wildplants || []), ...((zd && zd.wildplants) || [])]) { if (w && !seen.has(w.id)) { seen.add(w.id); plants.push(w); } }
  // Rocks.
  const rocks = objs.filter((o) => o.kind === 'mineralrock');
  const isPlain = (o) => o.caveVariant != null || (o.yieldTier || 1) <= 1;
  m.rocks = { all: rocks.length, plain: rocks.filter(isPlain).length, ore: rocks.filter((o) => !isPlain(o)).length,
    street: rocks.filter((o) => o._street).length, zone: rocks.filter((o) => o.zone).length };
  // Streets.
  m.streets = null;
  const si = e.streetIndex;
  if (si && si.lines && typeof StreetVariants !== 'undefined') {
    const ext = si.extent || 4096, mPerU = EDGE / ext;
    const keys = {}, len = {};
    for (const r of si.lines) {
      if (!r.size) continue;
      const v = r.variant || '(plain)';
      (keys[r.size] = keys[r.size] || {});
      (keys[r.size][v] = keys[r.size][v] || new Set()).add(r.key);
      let L = 0;
      for (let k = 1; k < r.line.length; k++) {
        const a = r.line[k - 1], b = r.line[k], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (mx < 0 || my < 0 || mx > ext || my > ext) continue;   // tile square only
        L += Math.hypot(b.x - a.x, b.y - a.y) * mPerU;
      }
      (len[r.size] = len[r.size] || {});
      len[r.size][v] = (len[r.size][v] || 0) + L;
      if (r.rocks) { (keys.rockKeys = keys.rockKeys || new Set()).add(r.key); }
    }
    m.streets = { keys, len, closes: (si.closes || []).length };
  }
  const dress = e.streetDress;
  m.dress = {};
  if (dress) {
    for (const o of dress.objects || []) m.dress[o.kind] = (m.dress[o.kind] || 0) + 1;
    for (const w of dress.wildplants || []) m.dress['plant: ' + w.crop] = (m.dress['plant: ' + w.crop] || 0) + 1;
    if (dress.treasures) m.dress['buried hoard'] = dress.treasures.length;
  }
  // Chests.
  const chests = objs.filter((o) => o.kind === 'chest' && !(o.depth > 0));
  m.chests = { n: chests.length, look: {}, tier: {}, bus: 0, wagon: 0, nexus: 0, macro: {} };
  for (const c of chests) {
    let look = '?';
    try { look = (typeof chestLook === 'function') ? chestLook(c).texKey : '?'; } catch (err) { look = 'error'; }
    m.chests.look[look] = (m.chests.look[look] || 0) + 1;
    const t = (typeof chestTier === 'function') ? chestTier(c) : 0;
    if (c.zoneNexus) m.chests.nexus++;
    m.chests.tier['T' + t] = (m.chests.tier['T' + t] || 0) + 1;
    if (c.poiClass === 'bus') m.chests.bus++;
    if (c.banditStop) m.chests.wagon++;
    let mk = null;
    try { mk = (typeof chestLook === 'function' && chestLook(c).macro) ? chestLook(c).macro.kind : null; } catch (err) { mk = null; }
    if (mk) m.chests.macro[mk] = (m.chests.macro[mk] || 0) + 1;
  }
  // Slow ground and zone props.
  const byKind = (k) => objs.filter((o) => o.kind === k);
  m.tar = { zone: byKind('tar').filter((o) => o.zone).length, street: byKind('tar').filter((o) => !o.zone).length };
  m.stakes = byKind('stakes').length;
  m.headstones = byKind('headstone').length;
  m.shrines = objs.filter((o) => /shrine/.test(o.kind) && o.zone).length;
  // Parks: occupancy of PARK cells (anything standing), the characters of the
  // tile's park polygons, the fringe band and its filler (Zones.groundSteps'
  // tallies on the zone dressing), and the churchyards per anchor.
  const held = new Set();
  for (const o of [...objs, ...plants]) { const i = cellOf(o); if (i >= 0) held.add(i); }
  let parkCells = 0, parkHeld = 0;
  for (let i = 0; i < NN; i++) if (grid[i] === T.PARK) { parkCells++; if (held.has(i)) parkHeld++; }
  const fr = (zd && zd.fringe) || null, gr = (zd && zd.ground) || null;
  let fringeCells = 0;
  if (e.zone && e.zone.under) for (let i = 0; i < NN; i++) if (e.zone.under[i] && !(e.zone.idx && e.zone.idx[i])) fringeCells++;
  const stonesOwned = e.zone ? (e.zone.reach || []).filter((a) => a.kind === 'stones' && a.owned) : [];
  m.parks = { cells: parkCells, held: parkHeld, chars: (fr && fr.chars) || {}, polys: fr ? fr.parks : 0,
    fringeCells, fill: gr ? gr.fill : 0, graves: gr ? gr.graves : 0, chRocks: gr ? gr.rocks : 0,
    ghostAnchors: stonesOwned.filter((a) => a.ghosts).length, stonesAnchors: stonesOwned.length };
  // Zones.
  m.zone = null;
  if (typeof Zones !== 'undefined' && 'zone' in e) {
    const z = e.zone, codes = Zones.zoneTerrains ? Zones.zoneTerrains() : [];
    const halo = {};
    for (const kind of Object.keys(Zones.ZONE_KINDS || {})) {
      const code = Zones.terrainOf ? Zones.terrainOf(kind) : null;
      halo[kind] = code != null ? (m.terrain[code] || 0) : 0;
    }
    const anchors = (z && z.anchors) || [];
    const cells = {};
    if (z && z.idx) for (let i = 0; i < NN; i++) if (z.idx[i]) { const a = anchors[z.idx[i] - 1]; if (a) cells[a.kind] = (cells[a.kind] || 0) + 1; }
    m.zone = {
      anchors: anchors.map((a) => ({ kind: a.kind, R: a.R, owned: !!a.owned, aspect: a.aspect, key: a.key })),
      halo, cells, codes,
      nexus: ((zd && zd.nexus) || []).map((n) => ({ kind: n.kind, aspect: n.aspect, pieces: n.pieces })),
      lairs: ((zd && zd.lairs) || []).length,
    };
  }
  return m;
}

async function wBuild() {
  const st = $('wStatus');
  if (!wRaw.tiles) {
    st.textContent = 'fetching tiles…';
    wRaw.tiles = []; wRaw.errors = []; const srcs = new Set();
    for (const [tx, ty] of wTileList()) {
      const got = await wTileBytes(tx, ty).catch(error => { wRaw.errors.push(`Tile ${tx}/${ty}: ${error.message}`); return null; });
      if (got) { wRaw.tiles.push({ tx, ty, layers: MVT.decodeTile(got.b) }); srcs.add(got.src); }
    }
    wRaw.source = [...srcs].join(' + ') || 'none';
  }
  if (!wRaw.tiles.length) { $('wErrors').textContent = wRaw.errors.join('\n'); throw new Error('No tiles loaded for ' + wCity().name); }
  // INFLUENCE ZONES before index.html loads them: worldgen asks
  // `typeof Zones` at call time, so loading src/zones.js here previews the
  // shipping rule; unticking hides it again for a before/after.
  if (wZones.ref === undefined) {
    wZones.inIndex = typeof Zones !== 'undefined';
    wZones.ref = wZones.inIndex ? Zones : null;
    if (!wZones.inIndex) {
      const ok = await fetch('../src/zones.js', { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok).catch(() => false);
      if (ok) {
        await new Promise((res) => { const sc = document.createElement('script'); sc.src = '../src/zones.js?' + Date.now(); sc.onload = res; sc.onerror = res; document.head.appendChild(sc); });
        wZones.ref = typeof Zones !== 'undefined' ? Zones : null;
        if (wZones.ref) $('wZonesL').style.display = '';
      }
    }
  }
  if (!wZones.inIndex) {
    if (wZones.ref && $('wZonesPreview').checked) globalThis.Zones = wZones.ref; else delete globalThis.Zones;
  }
  wZones.previewing = !wZones.inIndex && typeof Zones !== 'undefined';
  // SCENIC PLACES (src/scenic.js) the same way: worldgen asks `typeof Scenic`
  // at call time, so loading it here previews the scopes, vista chests and the
  // tide line in the value rows below before index.html carries the tag.
  if (!wScenic.tried) {
    wScenic.tried = true;
    if (typeof Scenic === 'undefined') {
      const ok = await fetch('../src/scenic.js', { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok).catch(() => false);
      if (ok) {
        await new Promise((res) => { const sc = document.createElement('script'); sc.src = '../src/scenic.js?' + Date.now(); sc.onload = res; sc.onerror = res; document.head.appendChild(sc); });
        wScenic.previewing = typeof Scenic !== 'undefined';
      }
    }
  }
  const mid = wRaw.tiles[Math.floor(wRaw.tiles.length / 2)];
  const EDGE = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(mid.ty));
  // Home far off the block: no starting area, no softwood overlay, no home
  // rings in any count.
  const home = { x: (mid.tx + 60.5) * EDGE, y: (mid.ty + 60.5) * EDGE };
  if (typeof HomeArea !== 'undefined') HomeArea.setOrigin(home.x, home.y);
  WorldGen.tileCache.clear();
  const scene = wScene(EDGE, home, mid.ty);
  const entries = [], errors = [...wRaw.errors];
  for (const { tx, ty, layers } of wRaw.tiles) {
    st.textContent = `rasterizing ${tx}/${ty}…`; await wTick();
    try {
      const N = WorldGen.cellsPerEdgeForTile(ty);
      const r = WorldGen.rasterizeTile(layers, N, tx, ty, EDGE);
      const entry = Object.assign({ tx, ty, cellsPerEdge: N, tileEdgeM: EDGE, layers }, r);
      WorldGen.tileCache.set(WorldGen.tileKey(tx, ty), entry);
      entries.push(entry);
    } catch (err) { errors.push(`rasterize ${tx}/${ty}: ${err.message}`); console.error(err); }
  }
  const ms = [];
  for (const e of entries) {
    st.textContent = `spawning ${e.tx}/${e.ty}…`; await wTick();
    try { scene.spawnInTile(e, e.tx, e.ty); } catch (err) { errors.push(`spawnInTile ${e.tx}/${e.ty}: ${err.message}`); console.error(err); }
    try { const m = wMeasure(e, EDGE); ms.push(m); errors.push(...m.errors.map((x) => `${m.tile} ${x}`)); }
    catch (err) { errors.push(`measure ${e.tx}/${e.ty}: ${err.message}`); console.error(err); }
  }
  WorldGen.tileCache.clear();
  return { ms, errors, EDGE, source: wRaw.source, entries };
}

function wRender(w) {
  const { ms, errors, EDGE } = w, n = ms.length;
  const T = WorldGen.T, names = wNames();
  const sum = (f) => ms.reduce((a, m) => a + (f(m) || 0), 0);
  const totalCells = sum(m => m.cells);
  const shareOfCells = f => sum(m => (f(m) || 0) * m.cells) / (totalCells || 1);
  const scope = `${wCity().name} roaming area · ${n} of 9 tiles · ~${(n * EDGE * EDGE / 1e6).toFixed(1)} km² (${w.source})`;
  $('wScope').textContent = `Scope: ${scope}. Mode for spawnInTile: ${typeof Difficulty !== 'undefined' ? Difficulty.mode() : '?'}; traps are rolled for both modes.`
    + (wZones.previewing ? ' Influence zones: PREVIEW — src/zones.js loaded by this page, not yet by index.html.' : '')
    + (wScenic.previewing ? ' Scenic places: PREVIEW — src/scenic.js loaded by this page, not yet by index.html.' : '');
  $('wErrors').textContent = errors.length ? `${errors.length} error(s) — the game code may be mid-edit:\n` + errors.join('\n') : '';
  if (!n) return;
  const E = typeof Difficulty !== 'undefined' ? Difficulty.EASY : 'easy', H = typeof Difficulty !== 'undefined' ? Difficulty.HARD : 'hard';
  const tr = (m, mode) => (m.traps[mode] ? m.traps[mode].n : 0);
  const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${label}</span></div>`;
  const zoneHaloShare = (m) => m.zone ? Object.values(m.zone.halo).reduce((a, b) => a + b, 0) / m.cells : 0;
  $('wKpis').innerHTML = [
    T.WASTELAND != null ? kpi(wPct(shareOfCells((m) => m.wasteland)), 'wasteland terrain') : '',
    kpi(wPct(shareOfCells((m) => m.mask)), 'road mask (no spawns)'),
    ms[0].band != null ? kpi(wPct(shareOfCells((m) => m.band)), 'major band') : '',
    ms[0].verge != null ? kpi(wPct(shareOfCells((m) => m.verge)), 'major verge') : '',
    kpi(f1(sum((m) => tr(m, E))) + ' / ' + f1(sum((m) => tr(m, H))), `traps ${E} / ${H}`),
    kpi(f1(sum((m) => m.rocks.all)), 'rocks'),
    kpi(f1(sum((m) => m.chests.n)), 'surface chests'),
    ms.some((m) => m.zone) ? kpi(wPct(shareOfCells(zoneHaloShare)), 'zone halo terrain') : '',
  ].join('') + `<div class="kpi" style="border:0;background:none"><span class="scope">${scope}</span></div>`;

  // Cell-weighted shares for the full loaded area.
  const terrain = {};
  for (const m of ms) for (const [code, cells] of Object.entries(m.terrain)) terrain[code] = (terrain[code] || 0) + cells;
  const zoneCodes = new Set(ms.find(m => m.zone)?.zone.codes || []);
  const rowsT = Object.entries(terrain).map(([code, cells]) => ({ code: +code, name: names[code] || code, share: cells / totalCells }))
    .sort((a, b) => b.share - a.share);
  const keep = rowsT.filter((row, i) => i < 14 || row.code === T.WASTELAND || zoneCodes.has(row.code));
  for (const code of zoneCodes) if (!terrain[code]) keep.push({ code, name: names[code] || code, share: 0 });
  const rest = rowsT.filter(row => !keep.includes(row));
  $('wTerrainScope').textContent = `Share of all cells in the loaded roaming area. ${scope}.`;
  table($('wTerrain'), ['terrain', 'area share'], keep.map(row =>
    `<tr><td>${row.name}${row.code === T.WASTELAND || zoneCodes.has(row.code) ? ' <span style="color:var(--gold)">★</span>' : ''}</td>${barCell(row.share)}</tr>`)
    .concat(rest.length ? [`<tr><td class="dim">(${rest.length} other codes)</td>${barCell(rest.reduce((a, row) => a + row.share, 0))}</tr>`] : []));

  $('wRoadScope').textContent = `Share of all cells in the roaming area. Mask = road cells with no spawns; band / verge = major-road coverage.`;
  const roadRows = [['road mask', m => m.mask], ['major band', m => m.band], ['major verge', m => m.verge], ['bandit verge', m => m.bandit]];
  if (T.WASTELAND != null) roadRows.push(['wasteland terrain', m => m.wasteland]);
  table($('wRoad'), ['layer', 'area share'], roadRows.filter(([, f]) => f(ms[0]) != null).map(([label, f]) =>
    `<tr><td>${label}</td>${barCell(shareOfCells(f))}</tr>`));

  // Traps by where they sit.
  const places = ['street encounter', 'zone encounter', 'pathside', 'park edge', 'other', 'off tile'];
  $('wTrapScope').textContent = `Total traps across the roaming area, both modes; ${scope}. Includes seated street and zone encounters; only ambient traps scale with mode.`;
  table($('wTraps'), ['mode', 'total traps', ...places, 'total dogs', 'dogs on verge'], [E, H].map((mode) => {
    const tot = ms.reduce((a, m) => a + tr(m, mode), 0) || 1;
    return `<tr><td>${mode} (×${typeof Difficulty !== 'undefined' ? Difficulty.PROFILES[mode].trapCountMul : '?'})</td><td>${f1(sum((m) => tr(m, mode)))}</td>`
      + places.map((p) => { const k = ms.reduce((a, m) => a + ((m.traps[mode] && m.traps[mode].at[p]) || 0), 0); return `<td>${k ? wPct(k / tot) : '<span class="dim">0</span>'}</td>`; }).join('')
      + `<td>${f1(sum((m) => m.dogs))}</td><td>${wPct(ms.reduce((a, m) => a + m.dogsVerge, 0) / (ms.reduce((a, m) => a + m.dogs, 0) || 1))}</td></tr>`;
  }));

  // Street variants.
  if (typeof StreetVariants !== 'undefined' && ms.some((m) => m.streets)) {
    const SV = StreetVariants;
    const sizes = [...new Set(SV.STREET_VARIANTS.map((r) => r.size))];
    const rows = [];
    for (const size of sizes) {
      const ids = [...SV.STREET_VARIANTS.filter((r) => r.size === size).map((r) => r.id), '(plain)'];
      const all = new Set(), per = {};
      for (const id of ids) per[id] = new Set();
      let lenTot = 0; const lenBy = {};
      for (const m of ms) {
        const k = (m.streets && m.streets.keys[size]) || {};
        for (const id of ids) for (const key of k[id] || []) { per[id].add(key); all.add(key); }
        for (const [id, L] of Object.entries((m.streets && m.streets.len[size]) || {})) { lenBy[id] = (lenBy[id] || 0) + L; lenTot += L; }
      }
      for (const id of ids) {
        const row = SV.VARIANT_BY_ID[id];
        rows.push(`<tr><td>${size}</td><td class="l">${id}${row ? ` <span class="dim">(${row.rung}, base ${wPct(row.share)})</span>` : ''}</td>`
          + `<td>${per[id].size}</td><td>${all.size ? wPct(per[id].size / all.size) : '—'}</td>`
          + `<td>${lenTot ? wPct((lenBy[id] || 0) / lenTot) : '—'}</td><td>${f1(lenBy[id] || 0)} m</td></tr>`);
      }
    }
    $('wStreetScope').textContent = 'Distinct streets across the roaming area; streets crossing internal tile boundaries count once. Length is the total within the area.';
    table($('wStreets'), ['size', 'variant', 'distinct streets', 'share of size', 'length share', 'total length'], rows);
    const rockKeys = new Set(), minorKeys = new Set();
    for (const m of ms) {
      for (const k of (m.streets && m.streets.keys.rockKeys) || []) rockKeys.add(k);
      for (const s of Object.entries((m.streets && m.streets.keys.minor) || {}).filter(([id]) => id !== 'hedgerow').map(([, s]) => s)) for (const k of s) minorKeys.add(k);
    }
    $('wStreetExtra').innerHTML = `Rock-lined minor streets: <b>${rockKeys.size}</b> of ${minorKeys.size} non-hedgerow minor streets `
      + `(<b>${minorKeys.size ? wPct(rockKeys.size / minorKeys.size) : '—'}</b>; target ROCK_STREET_SHARE ${wPct(SV.ROCK_STREET_SHARE)}), distinct over ${n} tiles. `
      + `Hedgerow closes: <b>${ms.reduce((a, m) => a + (m.streets ? m.streets.closes : 0), 0)}</b> across the area. `
      + `Bus stops: <b>${f1(sum((m) => m.chests.bus))}</b>, of which broken wagons (major road): <b>${f1(sum((m) => m.chests.wagon))}</b>.`;
    const dk = [...new Set(ms.flatMap((m) => Object.keys(m.dress)))].sort();
    table($('wDress'), ['street dressing piece', 'total'], dk.map((k) => {
      const t = ms.reduce((a, m) => a + (m.dress[k] || 0), 0);
      return `<tr><td>${k}</td><td>${t}</td></tr>`;
    }).concat(dk.length ? [] : ['<tr><td class="dim">no street dressing in this area</td><td></td></tr>']));
  } else {
    $('wStreetScope').textContent = 'StreetVariants / entry.streetIndex not present in this build.';
  }

  // Rocks.
  $('wRockScope').textContent = `mineralrock objects after spawnInTile (+ zone dressing), ${scope}. Plain = the stone-paying rock (no ore yieldTier > 1).`;
  const rk = [['all rocks', (m) => m.rocks.all], ['plain', (m) => m.rocks.plain], ['ore (yieldTier ≥ 2)', (m) => m.rocks.ore],
    ['street-lined (_street)', (m) => m.rocks.street], ['zone nexus rocks', (m) => m.rocks.zone]];
  table($('wRocks'), ['rocks', 'total', 'share'], rk.map(([label, f]) =>
    `<tr><td>${label}</td><td>${sum(f).toLocaleString()}</td><td>${wPct(sum(f) / (sum(m => m.rocks.all) || 1))}</td></tr>`));

  // Chests.
  $('wChestScope').textContent = `Surface chests by chestLook texture and chestTier (the tier every player sees${typeof ZONE_NEXUS_TIER_BONUS === 'number' ? `, nexus +${ZONE_NEXUS_TIER_BONUS}` : ''}), ${scope}.`;
  const agg = (key) => { const o = {}; for (const m of ms) for (const [k, v] of Object.entries(m.chests[key])) o[k] = (o[k] || 0) + v; return o; };
  const totC = ms.reduce((a, m) => a + m.chests.n, 0) || 1;
  const lookRows = Object.entries(agg('look')).sort((a, b) => b[1] - a[1]);
  table($('wChestLook'), ['look', 'total', 'share'], lookRows.map(([k, v]) => `<tr><td>${k.replace('_', ' ')}</td><td>${v.toLocaleString()}</td>${barCell(v / totC)}</tr>`));
  const tierRows = Object.entries(agg('tier')).sort();
  table($('wChestTier'), ['tier', 'total', 'share'], tierRows.map(([k, v]) => `<tr><td>${k}</td><td>${v.toLocaleString()}</td>${barCell(v / totC)}</tr>`));
  const macro = agg('macro');
  $('wChestExtra').innerHTML = `Zone nexus chests: <b>${f1(sum((m) => m.chests.nexus))}</b>. `
    + (Object.keys(macro).length ? 'POI macro kinds: ' + Object.entries(macro).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(', ') + '.' : '<span class="dim">No POI macro kinds on chests in this build.</span>');

  // Zones.
  const zs = ms.filter((m) => m.zone);
  if (typeof Zones === 'undefined') {
    $('wZoneScope').textContent = wZones.ref ? 'Zones preview is unticked: this build is the world without influence zones.'
      : 'No Zones module in this build (src/zones.js not found).';
    $('wZones').innerHTML = ''; $('wZoneExtra').innerHTML = '';
  } else if (!zs.length) {
    $('wZoneScope').textContent = 'Zones is loaded but no tile entry carries a zone field (the rasterizer is not wiring it yet).';
    $('wZones').innerHTML = ''; $('wZoneExtra').innerHTML = '';
  } else {
    $('wZoneScope').textContent = `Distinct zone anchors reaching the roaming area; anchors crossing internal tile boundaries count once. Owned anchors originate inside the area. Halo = cells repainted to zone terrain. ${scope}.`;
    const kinds = Object.keys(Zones.ZONE_KINDS);
    table($('wZones'), ['kind', 'terrain', 'row R', 'distinct anchors', 'owned anchors', 'avg R (m)', 'field cells', 'halo cells', 'halo share'], kinds.map(kind => {
      const anchors = new Map();
      for (const m of zs) for (const anchor of m.zone.anchors.filter(a => a.kind === kind)) {
        const existing = anchors.get(anchor.key);
        anchors.set(anchor.key, { ...anchor, owned: anchor.owned || existing?.owned });
      }
      const all = [...anchors.values()];
      const halo = sum(m => m.zone?.halo[kind]);
      return `<tr><td>${kind}</td><td>${Zones.ZONE_KINDS[kind].terrain}</td><td>${Zones.ZONE_KINDS[kind].R} m</td><td>${all.length}</td><td>${all.filter(a => a.owned).length}</td>`
        + `<td>${all.length ? f1(all.reduce((total, a) => total + a.R, 0) / all.length) : '—'}</td>`
        + `<td>${sum(m => m.zone?.cells[kind]).toLocaleString()}</td><td>${halo.toLocaleString()}</td><td>${wPct(halo / totalCells)}</td></tr>`;
    }));
    const asp = {};
    for (const m of zs) for (const x of m.zone.nexus) { const k = `${x.kind}: ${x.aspect}`; asp[k] = asp[k] || { n: 0, p: 0 }; asp[k].n++; asp[k].p += x.pieces; }
    const extra = Object.entries(asp).sort().map(([k, v]) => `<tr><td>nexus ${k}</td><td>${v.n}</td><td>${f1(v.p / v.n)} pieces</td></tr>`);
    const tot = (f) => ms.reduce((a, m) => a + f(m), 0);
    extra.push(`<tr><td>headstones</td><td>${tot((m) => m.headstones)}</td><td></td></tr>`);
    extra.push(`<tr><td>tar pits (zone)</td><td>${tot((m) => m.tar.zone)}</td><td></td></tr>`);
    extra.push(`<tr><td>tar (burned rows) · stakes</td><td>${tot((m) => m.tar.street)} · ${tot((m) => m.stakes)}</td><td></td></tr>`);
    extra.push(`<tr><td>grove shrines</td><td>${tot((m) => m.shrines)}</td><td></td></tr>`);
    extra.push(`<tr><td>tar-yard garrisons (lairs)</td><td>${tot((m) => m.zone ? m.zone.lairs : 0)}</td><td></td></tr>`);
    // Parks and churchyards (Zones.fringeSteps / groundSteps).
    const pk = (f) => tot((m) => (m.parks ? f(m.parks) : 0));
    const chars = {};
    for (const m of ms) for (const [k, v] of Object.entries((m.parks && m.parks.chars) || {})) chars[k] = (chars[k] || 0) + v;
    extra.push(`<tr><td>park polygons by character</td><td>${pk((p) => p.polys)}</td><td>${Object.entries(chars).sort().map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</td></tr>`);
    extra.push(`<tr><td>park occupancy (PARK cells holding anything)</td><td>${pk((p) => p.held)} / ${pk((p) => p.cells)}</td><td>${wPct(pk((p) => p.held) / (pk((p) => p.cells) || 1))}</td></tr>`);
    extra.push(`<tr><td>park fringe band cells · filler</td><td>${pk((p) => p.fringeCells)} · ${pk((p) => p.fill)}</td><td></td></tr>`);
    extra.push(`<tr><td>graves (headstones) / church or cemetery owned</td><td>${pk((p) => p.graves)} / ${pk((p) => p.ghostAnchors)}</td><td>${f1(pk((p) => p.graves) / (pk((p) => p.ghostAnchors) || 1))} each (grave cells may sit in a neighbour's tile)</td></tr>`);
    extra.push(`<tr><td>churchyard rocks / place of worship owned</td><td>${pk((p) => p.chRocks)} / ${pk((p) => p.stonesAnchors)}</td><td>${f1(pk((p) => p.chRocks) / (pk((p) => p.stonesAnchors) || 1))} each</td></tr>`);
    table($('wZoneExtra'), ['nexus / props', 'area total', 'details'], extra);
  }
}

// ── VALUE BY TYPE ────────────────────────────────────────────────────────
// What each placement actually PAYS, off the same tiles wBuild() just
// rasterized + spawned. Every value is pickReward, sampled and valued the
// way describe() (above) does — list price, items.js itemValue / gear.js
// gearPrice — never a retyped number. Recurring rows pay again at their own
// cadence and are shown PER DAY: a crate or a barrel (interactables.js
// restocks) once every loot.js crateRestoreDays(o) UTC days, the chapel's
// alms, a grove shrine's gift, the pot of gold's burst (loot.js potCoinsFor —
// its density on the tile), the bike rack, the macro stalls and the
// guildhall's board once a day. Every other chest (trunks — public art
// included — wagons, zone-nexus chests) and a headstone hoard pay once per
// save (interactables.js isSpent). Gate spawn points and notice boards are
// counted (a foe a day; one Book page once). Feature-detects every module it
// reads, so it renders '(not available)' before a module lands rather than
// throwing.
const WVALUE_N_SAMPLES = 60; // modest — this runs on every "Rebuild tiles"
function wValueByType(entries) {
  const canChest = typeof pickReward === 'function' && typeof chestLook === 'function'
    && typeof chestTier === 'function' && typeof chestThemeFor === 'function' && typeof POI_CATEGORY !== 'undefined';
  if (!canChest) return null;
  const emptySave = { relics: {}, armor: {}, inv: [], money: 0 };
  const evCache = new Map();
  function ev(context, opts, treasureGrant = false) {
    const key = context + '|' + JSON.stringify(opts || null) + '|' + treasureGrant;
    if (evCache.has(key)) return evCache.get(key);
    let sum = 0;
    for (let i = 0; i < WVALUE_N_SAMPLES; i++) {
      const reward = pickReward(context, emptySave, Math.random, opts);
      if (treasureGrant && reward?.kind === 'item' && isLowTierSeed(reward.id)) reward.qty += LOW_TIER_SEED_QTY_BONUS;
      sum += describe(reward).value;
    }
    const avg = sum / WVALUE_N_SAMPLES;
    evCache.set(key, avg);
    return avg;
  }
  function standDiscount(id) {
    if (!id || typeof PRICES === 'undefined' || typeof ShopsMath === 'undefined' || !ShopsMath.standPrice) return 0;
    const listPrice = Math.max(1, PRICES[id] ?? 1);
    return listPrice - ShopsMath.standPrice(emptySave, listPrice);
  }
  // One smash of a barrel at `count` of its kind: loot.js BARREL_LOOT's
  // expectation, valued at list price, times the chance it is not empty.
  function barrelEV(count) {
    const total = BARREL_LOOT.reduce((s, r) => s + r.w, 0);
    let full = 0;
    for (const r of BARREL_LOOT) {
      const v = r.kind === 'coin' ? (r.min + r.max) / 2
        : (r.ids || [r.id]).reduce((s, id) => s + (itemValue(id) || 0), 0) / (r.ids || [r.id]).length;
      full += (r.w / total) * v;
    }
    return (1 - barrelEmptyP(count)) * full;
  }

  const rows = new Map(); // label -> { count, oneTimeSum, recurringSum, cadence }
  const bump = (label, cadence, value) => {
    const r = rows.get(label) || { count: 0, oneTimeSum: 0, recurringSum: 0, cadence };
    r.count++;
    if (cadence === 'recurring') r.recurringSum += value; else r.oneTimeSum += value;
    if (cadence !== r.cadence) r.cadence = 'both';
    rows.set(label, r);
  };

  for (const e of entries) {
    for (const o of e.objects || []) {
      if (o && o.kind === 'infoboard') bump('Notice board (one Book page)', 'one-time', 0);
      if (o && o.kind === 'gatepost') bump('Gate post (2 per spawn point)', 'one-time', 0);
      // A viewpoint's scope (src/scenic.js): its daily gift (Scenic.VISTA_CONTEXT).
      if (o && o.kind === 'vista_scope' && typeof Scenic !== 'undefined') {
        bump('Viewpoint scope (daily gift)', 'recurring', ev(Scenic.VISTA_CONTEXT, undefined, true));
      }
    }
    // THE TIDE LINE (src/scenic.js): each waterline pickup lies there on a day
    // with its tideP; a pick is a shell, driftwood (wood) or — rarely — a
    // bottle (one roll of Scenic.BOTTLE_CONTEXT). Per day, per tile.
    if (typeof Scenic !== 'undefined') {
      const tideP = (e.wildplants || []).filter((w) => w && w.tide).reduce((s, w) => s + (w.tideP || 0), 0);
      if (tideP > 0) {
        const pick = Scenic.TIDE_BOTTLE_P * ev(Scenic.BOTTLE_CONTEXT, undefined, true)
          + Scenic.TIDE_DRIFTWOOD_P * (itemValue('wood') || 0)
          + (1 - Scenic.TIDE_BOTTLE_P - Scenic.TIDE_DRIFTWOOD_P) * (itemValue('shell') || 0);
        bump('Tide line (daily pickups)', 'recurring', tideP * pick);
      }
    }
    const chests = (e.objects || []).filter((o) => o && o.kind === 'chest' && !(o.depth > 0));
    for (const o of chests) {
      let look; try { look = chestLook(o); } catch (err) { continue; }
      if (look.coin) { bump('Pot of gold (coin burst, daily)', 'recurring', potCoinsFor(o.poiDensity)); continue; }
      if (look.bike) { bump('Bike rack (speed loan, daily)', 'recurring', 0); continue; }
      if (look.barrel) { bump('Barrel (per day)', 'recurring', barrelEV(o.poiDensity) / crateRestoreDays(o)); continue; }
      if (look.macro) {
        const kind = look.macro.kind;
        if (kind === 'chapel' && typeof Macros !== 'undefined' && Macros.chapelRollTier) {
          const val = ev('chest:' + chestThemeForPoi(o.poiClass), { tier: Macros.chapelRollTier(o), depth: o.depth || 0 });
          bump('Chapel (daily alms)', 'recurring', val);
        } else if (kind === 'guildhall' && typeof Macros !== 'undefined' && typeof Combat !== 'undefined' && Combat.enemyBounty) {
          const rung = Macros.BOUNTY_LADDER[0], nFoes = Math.min(Macros.BOUNTY_MAX_FOES, 1);
          const wage = (rung.reduce((s, k) => s + Combat.enemyBounty(k, 0), 0) / rung.length) * nFoes;
          const pay = Math.max(1, Math.round(wage * Macros.BOUNTY_MATCH));
          bump('Guildhall bounty (T0 weapon)', 'recurring', Math.round(wage) + pay);
        } else if (typeof Macros !== 'undefined') {
          const stockFn = kind === 'apothecary' ? Macros.apothecaryStock
            : kind === 'sundries' ? Macros.sundriesStock
            : kind === 'scriptorium' ? Macros.scriptoriumStock : null;
          if (stockFn) {
            const ids = stockFn.length ? stockFn(o) : stockFn();
            const discount = (ids || []).reduce((s, id) => s + standDiscount(id), 0);
            const label = kind === 'apothecary' ? 'Apothecary (potion discount)' : kind === 'sundries' ? 'Sundries (supply discount)' : 'Scriptorium (book discount)';
            bump(label, 'recurring', discount);
          }
        }
        continue;
      }
      if (look.stand) {
        if (typeof produceStandFor === 'function') {
          const stand = produceStandFor(o);
          if (stand) bump('Market stall (produce discount)', 'recurring', standDiscount(stand.item));
        }
        continue;
      }
      // Trunk / crate / wagon: a plain consumable chest.
      const cat = POI_CATEGORY[o.poiClass] || '(uncategorised)';
      const tier = chestTier(o);
      const val = (o.crate || o.fixedLoot) ? 0 : ev('chest:' + chestThemeFor(o), { tier, depth: o.depth || 0 });
      const isCrate = (typeof restocks === 'function') ? restocks(o) : (look.box && !look.wagon);
      if (isCrate) bump('Crate (tier-1 POI chest, per day)', 'recurring', val / crateRestoreDays(o));
      else if (look.wagon) bump('Wagon (bandit stop)', 'one-time', val);
      else bump('Trunk chest — T' + tier, 'one-time', val);
      if (o.zoneNexus) bump('Zone-nexus chest (bonus tier)', isCrate ? 'recurring' : 'one-time', val);
      // SCENIC chests (src/scenic.js — the o.vista stamp, loot.js chestVistaTier):
      // a viewpoint's grail, and one chest per scenic stretch of path.
      if (o.vista === 'grail') bump('Viewpoint grail chest', 'one-time', val);
      else if (o.vista) bump('Vista chest (scenic stretch)', 'one-time', val);
    }
    // Headstones + grove shrines live in zoneDress.objects, not e.objects
    // (same split wMeasure reads above).
    const zd = e.zoneDress;
    if (zd && zd.objects && typeof Zones !== 'undefined') {
      for (const zo of zd.objects) {
        if (zo.kind === 'headstone' && Zones.headstoneHoards && Zones.headstoneHoards(zo.id)) {
          bump('Headstone hoard', 'one-time', ev(Zones.HEADSTONE_CONTEXT || 'chest:lowtier', { tier: Zones.HEADSTONE_TIER || 1, depth: 0 }, true));
        } else if (zo.kind === 'grove_shrine') {
          bump('Grove shrine (daily gift)', 'recurring', ev(Zones.SHRINE_CONTEXT || 'treasure:shrine', undefined, true));
        }
      }
    }
  }
  return rows;
}

const WVALUE_ORDER = [
  (k) => k === 'Crate (tier-1 POI chest, per day)',
  (k) => k === 'Barrel (per day)',
  (k) => k.startsWith('Trunk chest — '),
  (k) => k === 'Wagon (bandit stop)',
  (k) => k === 'Zone-nexus chest (bonus tier)',
  (k) => k === 'Headstone hoard',
  (k) => k === 'Notice board (one Book page)',
  (k) => k === 'Gate post (2 per spawn point)',
  (k) => k === 'Pot of gold (coin burst, daily)',
  (k) => k === 'Bike rack (speed loan, daily)',
  (k) => k === 'Chapel (daily alms)',
  (k) => k === 'Grove shrine (daily gift)',
  (k) => k === 'Viewpoint grail chest',
  (k) => k === 'Vista chest (scenic stretch)',
  (k) => k === 'Viewpoint scope (daily gift)',
  (k) => k === 'Tide line (daily pickups)',
  (k) => k === 'Market stall (produce discount)',
  (k) => k === 'Apothecary (potion discount)',
  (k) => k === 'Sundries (supply discount)',
  (k) => k === 'Scriptorium (book discount)',
  (k) => k === 'Guildhall bounty (T0 weapon)',
];
function wRenderValueByType(entries, n, source) {
  const scopeEl = $('wValueScope'), el = $('wValue'), noteEl = $('wValueNote');
  let rows;
  try { rows = wValueByType(entries); }
  catch (err) { scopeEl.textContent = 'value by type failed: ' + err.message; el.innerHTML = ''; noteEl.textContent = ''; console.error(err); return; }
  if (!rows) { scopeEl.textContent = 'chestLook / chestTier / pickReward not available in this build.'; el.innerHTML = ''; noteEl.textContent = ''; return; }
  scopeEl.textContent = `Totals across ${n} ${wCity().name} ${source === 'fixture' ? 'fixture' : source + '-fetched'} tiles — `
    + `Monte-Carlo pickReward (${WVALUE_N_SAMPLES} samples per distinct context/tier/depth), valued at list price.`;
  const used = new Set(), ordered = [];
  for (const pred of WVALUE_ORDER) {
    const matched = [...rows.keys()].filter((k) => !used.has(k) && pred(k)).sort((a, b) => rows.get(b).count - rows.get(a).count);
    for (const k of matched) { ordered.push(k); used.add(k); }
  }
  for (const k of rows.keys()) if (!used.has(k)) ordered.push(k);
  table(el, ['type', 'total count', 'one-time area value', 'recurring area value / day', 'value / visit'],
    ordered.map((label) => {
      const r = rows.get(label);
      const oneTime = r.cadence === 'recurring' ? '—' : fmt$(r.oneTimeSum);
      const recurring = r.cadence === 'one-time' ? '—' : fmt$(r.recurringSum);
      const visit = r.count ? fmt$((r.oneTimeSum + r.recurringSum) / r.count) : '—';
      return `<tr><td class="l">${label}</td><td>${r.count.toLocaleString()}</td><td>${oneTime}</td><td>${recurring}</td><td>${visit}</td></tr>`;
    }));
  noteEl.textContent = 'Recurring rows are per day: a crate or barrel’s take divided by its restock days. Values use the selected city’s current placements and sampled game rewards.';
}

let wBusy = false;
async function worldPerTile() {
  if (wBusy) return; wBusy = true;
  const st = $('wStatus'), t0 = performance.now();
  $('wGo').disabled = $('wCity').disabled = true;
  document.documentElement.dataset.mapDistributionReady = 'false';
  try {
    if (typeof MapScene === 'undefined' || !MapScene.prototype.spawnInTile) throw new Error('MapScene.spawnInTile not defined (app.js failed to load?)');
    const w = await wBuild();
    if (w) {
      wRender(w);
      wRenderValueByType(w.entries, w.ms.length, w.source);
      st.textContent = `${wCity().name}: built ${w.ms.length} of 9 tiles in ${((performance.now() - t0) / 1000).toFixed(1)}s (${w.source})`;
    }
    window.__worldStats = w;
    document.documentElement.dataset.mapDistributionReady = w?.ms.length ? 'true' : 'error';
  } catch (e) {
    document.documentElement.dataset.mapDistributionReady = 'error';
    st.textContent = 'world build failed: ' + e.message + ' — the game code may be mid-edit';
    console.error(e);
  } finally { wBusy = false; $('wGo').disabled = $('wCity').disabled = false; }
}
$('wGo').onclick = worldPerTile;
$('wZonesPreview').onchange = worldPerTile;

function wSelectCity() {
  wRaw.tiles = null;
  for (const id of ['wScope', 'wKpis', 'wErrors', 'wValueScope', 'wValueNote']) $(id).textContent = '';
  document.querySelectorAll('#world table').forEach(el => el.replaceChildren());
  const city = wCity(), url = new URL(location.href);
  url.searchParams.set('city', $('wCity').value); history.replaceState(null, '', url);
  $('wMap').href = city.centre ? 'map-review.html' : `map-review.html?lat=${city.lat}&lon=${city.lon}&r=1`;
  return worldPerTile();
}
$('wCity').onchange = wSelectCity;
(async () => {
  try {
    $('wGo').disabled = $('wCity').disabled = true;
    await loadGame();
    const city = new URLSearchParams(location.search).get('city');
    if (W_CITIES[city]) $('wCity').value = city;
    await wSelectCity();
  } catch (error) {
    $('wStatus').textContent = 'Could not load map distribution: ' + error.message;
    document.documentElement.dataset.mapDistributionReady = 'error';
    console.error(error);
  }
})();
