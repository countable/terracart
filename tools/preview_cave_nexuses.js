#!/usr/bin/env node
// Review schematic driven by shipping placement, catalog and encounter tables.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { addEventListener() {} }; ctx.window = ctx; vm.createContext(ctx);
for (const name of ['util', 'items', 'zone_variant_data', 'terrain', 'zone_variants', 'worldgen', 'underground', 'cave_areas']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
}
const { WorldGen: W, CaveAreas: C } = ctx;
const N = 64, cy = 32, cx = 32, ty = 91001, tileEdgeM = N * W.CELL_M;
const variants = ['spring_cave', 'goblin_warrens', 'mushroom_cavern', 'gemstone_cavern', 'mine_tunnels'];
const names = ['Spring Cave', 'Goblin Warrens', 'Mushroom Cavern', 'Gemstone Cavern', 'Mine Tunnels'];
const rows = [];
function fixture(kind, depth, setup) {
  let tx, anchor;
  for (tx = 5000; tx < 15000; tx++) {
    anchor = { kind: kind === 'mine_tunnels' ? 'quarry' : 'grove', owned: true,
      gx: tx * 4096 + (cx + .5) * 64, gy: ty * 4096 + (cy + .5) * 64,
      lx: (cx + .5) * 64, ly: (cy + .5) * 64, upm: tileEdgeM / 4096 };
    if (C.select(anchor, depth) === kind) break;
  }
  if (tx === 15000) throw new Error('Cannot find selected fixture ' + kind);
  const frame = W.tileFrame({ cellsPerEdge: N }, tx, ty, tileEdgeM);
  const original = new Uint8Array(N * N).fill(W.T.PARK);
  const surface = { cellsPerEdge: N, grid: original.slice(), baseGrid: original.slice(),
    genObjects: [], objects: [], zone: { anchors: [anchor], coverage: new Uint16Array(N * N).fill(1),
      caveSource: { grid: original, spawnWhy: new Uint16Array(N * N), objects: [], wildplants: [] } } };
  const grid = new Uint8Array(N * N).fill(depth === 2 ? W.T.CAVE_WALL : W.T.CAVE_FLOOR);
  // Mine seats may decorate only existing routes: use a pre-existing pair of
  // intersecting passages, with solid rock everywhere else.
  if (kind === 'mine_tunnels') {
    grid.fill(W.T.CAVE_WALL);
    for (let y = 21; y <= 43; y++) for (let x = 21; x <= 43; x++)
      if (Math.abs(x - cx) <= 2 || Math.abs(y - cy) <= 2) grid[y * N + x] = W.T.CAVE_FLOOR;
  }
  if (depth === 2 && kind !== 'mine_tunnels')
    for (let x = 0; x <= cx; x++) grid[cy * N + x] = W.T.CAVE_FLOOR;
  const input = { surface, grid, N, tx, ty, tileEdgeM, depth, objects: [], occupied: new Set(),
    spawnWhy: new Uint16Array(N * N) };
  const landmark = (kind, dx, dy) => {
    const ix = cx + dx, iy = cy + dy;
    const o = { kind, id: 'preview-' + kind, ...frame.centre(ix, iy), _ix: ix, _iy: iy };
    input.objects.push(o); input.occupied.add(iy * N + ix);
    for (let y = iy - 1; y <= iy + 1; y++) for (let x = ix - 1; x <= ix + 1; x++) grid[y * N + x] = W.T.CAVE_FLOOR;
    return o;
  };
  if (setup) setup(input, landmark);
  const before = grid.slice(), plan = C.plan(input), plants = [];
  C.apply(plan, grid, input.objects, plants, input.occupied);
  return { kind, depth, input, before, grid, plan, objects: input.objects, plants };
}
for (const depth of [1, 2]) for (const kind of variants) {
  const row = fixture(kind, depth);
  if (row.plan.areas.length !== 1) throw new Error(kind + ' D' + depth + ': ' + JSON.stringify(row.plan.diagnostics));
  row.title = names[variants.indexOf(kind)] + ' / level ' + depth;
  row.description = kind === 'mine_tunnels' ? 'Deposits follow existing passages. Surrounding stone is preserved.'
    : depth === 2 ? 'The chamber opens eligible underlying grove ground before ordinary cave dressing.'
    : 'An authored region reserves its floor and approaches before ordinary cave dressing.';
  rows.push(row);
}
const protectedRow = fixture('mushroom_cavern', 2, (input, landmark) => {
  landmark('staircase', 0, 5); landmark('chest', 5, 0);
  for (const [dx, dy, terrain, why] of [[4, 4, W.T.BUILDING, 0], [-4, -4, W.T.PARK, W.SPAWN_WHY.FARMLAND],
    [4, -4, W.T.PARK, W.SPAWN_WHY.GOLF], [-4, 4, W.T.ROAD, W.SPAWN_WHY.ROAD]]) {
    const i = (cy + dy) * N + cx + dx;
    input.surface.zone.caveSource.grid[i] = terrain;
    input.surface.zone.caveSource.spawnWhy[i] = why;
    input.spawnWhy[i] = why & W.SPAWN_WHY_ALL_FLOORS;
    input.grid[i] = W.T.CAVE_WALL;
  }
});
protectedRow.title = 'Protected evidence / level 2';
protectedRow.description = 'Original building, road, farmland and golf evidence remains protected even when the visible surface was repainted. Existing stairs and chest retain their approaches.';
rows.push(protectedRow);
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
function draw(row) {
  const cell = 22, half = 12, side = (half * 2 + 1) * cell;
  const marks = new Map(row.objects.concat(row.plants).map(o => {
    const p = W.tileFrame({ cellsPerEdge: N }, row.input.tx, row.input.ty, tileEdgeM).cellOf(o.x, o.y);
    return [p.iy * N + p.ix, o];
  }));
  const enemies = new Map((row.plan.encounters || []).map(o => {
    const p = W.tileFrame({ cellsPerEdge: N }, row.input.tx, row.input.ty, tileEdgeM).cellOf(o.x, o.y);
    return [p.iy * N + p.ix, o];
  }));
  let svg = `<svg viewBox="0 0 ${side} ${side}" role="img" aria-label="${esc(row.title)} generated layout">`;
  for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
    const i = (cy + dy) * N + cx + dx, x = (dx + half) * cell, y = (dy + half) * cell;
    const why = row.input.surface.zone.caveSource.spawnWhy[i], terrain = row.grid[i];
    const color = why ? '#733d46' : terrain === W.T.WATER ? '#397b92' : terrain === W.T.CAVE_WALL ? '#666e72'
      : row.plan.reserved.has(i) ? '#48493b' : '#232a2b';
    const o = marks.get(i), enemy = enemies.get(i);
    let label = o?.crop === 'mushroom' ? 'm' : o?.kind === 'mineralrock' ? (o.deposit ? '◆' : '●')
      : o?.kind === 'grove_shrine' ? '✦' : o?.kind === 'chest' ? (o.barrel ? 'B' : 'C') : o?.kind === 'staircase' ? 'S' : o ? '•' : '';
    if (enemy) label = 'E';
    const title = [dx + ',' + dy, terrain === W.T.CAVE_WALL ? 'stone' : terrain === W.T.WATER ? 'water' : 'floor',
      row.plan.reserved.has(i) ? 'reserved' : '', o?.crop || o?.kind || '', o?.deposit || '', o?.shrineKind || '', enemy?.kind || '', why ? 'excluded source' : ''].filter(Boolean).join(' / ');
    svg += `<g><title>${esc(title)}</title><rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${color}" stroke="#151b1c" stroke-width=".5"/>`;
    if (label) svg += `<text x="${x + cell/2}" y="${y + 16}" text-anchor="middle" font-size="15" font-family="system-ui" fill="${enemy ? '#f59c89' : o?.deposit ? '#b1e1f5' : o?.crop ? '#d9b2e7' : '#edd9a5'}">${label}</text>`;
    svg += '</g>';
  }
  return svg + '</svg>';
}
function counts(row) {
  const kinds = (row.plan.encounters || []).reduce((all, o) => { all[o.kind] = (all[o.kind] || 0) + 1; return all; }, {});
  const deposits = row.plan.objects.filter(o => o.kind === 'mineralrock').reduce((all, o) => {
    const key = o.deposit || (o.yieldTier ? 'ore tier ' + o.yieldTier : 'plain stone');
    all[key] = (all[key] || 0) + 1; return all;
  }, {});
  return { kinds, deposits, harvest: row.plan.wildplants.length,
    barrels: row.plan.objects.filter(o => o.barrel).length,
    shrines: row.plan.objects.filter(o => o.kind === 'grove_shrine').length,
    caches: row.objects.filter(o => o.kind === 'chest' && !o.barrel).length,
    rooms: row.plan.areas.reduce((n, area) => n + (area.roomCount || 0), 0) };
}
const summary = rows.map(row => {
  const c = counts(row), list = record => Object.entries(record).map(([key, count]) => count + ' ' + key.replaceAll('_', ' ')).join(', ') || '—';
  return `<tr><th>${esc(row.title)}</th><td>${row.plan.reserved.size}</td><td>${c.rooms || '—'}</td><td>${esc(list(c.kinds))}</td><td>${esc(list(c.deposits))}</td><td>${c.harvest}</td><td>${c.barrels}</td><td>${c.shrines}</td><td>${c.caches}</td></tr>`;
}).join('');
const cards = rows.map(row => `<section><h2>${esc(row.title)}</h2><p>${esc(row.description)}</p>${draw(row)}<p class="status">${esc(row.plan.diagnostics.map(d => d.status + (d.reason ? ': ' + d.reason : '')).join(', '))}</p><dl><div><dt>Reserved cells</dt><dd>${row.plan.reserved.size}</dd></div><div><dt>Objects</dt><dd>${row.plan.objects.length}</dd></div><div><dt>Mushrooms</dt><dd>${row.plan.wildplants.length}</dd></div><div><dt>Encounter seats</dt><dd>${row.plan.encounters?.length || 0}</dd></div></dl></section>`).join('\n');
const output = path.resolve(process.argv[2] || '/tmp/cave-nexuses-preview.html');
fs.writeFileSync(output, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cave nexus placement review</title><style>*{box-sizing:border-box}body{margin:0;padding:30px;background:#151b1c;color:#e9ede7;font:16px/1.5 system-ui}main{max-width:1700px;margin:auto}h1{font-size:38px;margin:0}header p{max-width:1000px;color:#bdc8c1}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:28px}section{background:#202728;border:1px solid #394142;border-radius:12px;padding:18px}h2{font-size:20px;margin:0}section>p{font-size:13px;color:#bdc8c1;min-height:60px}svg{display:block;width:100%;height:auto}.status{font-family:monospace;min-height:0}dl{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}dt{font-size:10px;color:#9ea9a2}dd{margin:0;font-size:20px}table{border-collapse:collapse;width:100%;font-size:12px;margin-top:28px}th,td{padding:10px;border:1px solid #394142;text-align:left}caption{text-align:left;padding:12px;color:#bdc8c1}.table{overflow:auto}.legend{display:flex;flex-wrap:wrap;gap:18px;font-size:13px}@media(max-width:1100px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.cards{grid-template-columns:1fr}body{padding:16px}section>p{min-height:0}}</style><main><header><h1>Cave nexus placement review</h1><p>All five authored regions on cave levels 1 and 2. These are schematic layouts from the shipping <code>CaveAreas.plan</code> and <code>apply</code> functions, using the shared item catalog and deterministic selection. Each square is one game cell; hover for details. Encounter seats are shown for review, including enemies that are hidden during play.</p><p>Synthetic source fixtures isolate each region. This is a placement review, not an in-game screenshot. The protected-source case checks overlapping immutable evidence.</p></header><div class="legend"><span>m Mushroom</span><span>● Mineable rock</span><span>◆ Gem</span><span>✦ Shrine</span><span>E Enemy seat</span><span>C Existing cache</span><span>B Barrel</span><span>S Stairs</span><span>Blue: water</span><span>Grey: stone</span><span>Red: excluded source</span></div><div class="table"><table><caption>Finite placement budgets generated for these fixtures. Combat loot follows the shared enemy reward tables; each listed enemy can be defeated once per region and depth.</caption><thead><tr><th>Region</th><th>Usable cells</th><th>Rooms</th><th>Enemies</th><th>Deposits</th><th>Harvests</th><th>Barrels</th><th>Shrines</th><th>Existing caches</th></tr></thead><tbody>${summary}</tbody></table></div><div class="cards">${cards}</div></main></html>`);
console.log(output);
for (const row of rows) console.log(`${row.title}: ${row.plan.reserved.size} cells, ${row.plan.objects.length} objects, ${row.plan.encounters?.length || 0} encounters`);
