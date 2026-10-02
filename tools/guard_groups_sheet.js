#!/usr/bin/env node
// GUARD GROUPS — the design sheet (src/lairs.js GROUPS). Emits ONE self-contained
// HTML page: every authored garrison, at every building tier it may hold,
// arranged about a footprint by the SAME seatPolar / seat-try rule the game
// seats it with (Lairs.groupLayout), drawn with the game's own sprites,
// palettes, tints and scales (SpriteLayout.creatureArt, the roster's `palette`
// through assets.js's recolorEnemyPixels), plus each member's roster stats and
// the paces the same change doubled. Nothing here is typed twice: the tables
// are read out of the modules, the sheets are embedded from assets/.
//
//   node tools/guard_groups_sheet.js --out /path/to/guard-groups.html
//
// Pure node: the four modules it needs load into a bare vm context (the test
// harness's trick, test/node/run.js) — no browser, no Phaser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : null;

// ── Load the game's tables ───────────────────────────────────────────────────
const ctx = { console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, WeakMap, Symbol, Error,
  Infinity, NaN, isNaN, parseInt, parseFloat, Uint8Array, Uint32Array, Float32Array, Int32Array, Date, RegExp,
  performance: { now: () => Date.now() }, setTimeout: () => 0, clearTimeout() {},
  document: { visibilityState: 'visible', addEventListener() {} }, addEventListener() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['enemy_roster.js', 'sprite_layout.js', 'util.js', 'lairs.js']) {
  vm.runInContext(read('src/' + f), ctx, { filename: f });
}
// The world's own rng (worldgen.js makeRng), lifted as text so the preview's
// stream is the game's. The review salt is 0 outside the map-review tool.
const wgSrc = read('src/worldgen.js');
const rngSrc = /function makeRng\(seed\) \{[\s\S]*?\n  \}\n/.exec(wgSrc);
if (!rngSrc) throw new Error('worldgen.js makeRng not found');
vm.runInContext(`var _reviewSalt = 0; ${rngSrc[0]} globalThis.WorldGen = { makeRng };`, ctx);
// assets.js's recolour, lifted the same way, for the page to run on the sheets.
const recolorSrc = /function recolorEnemyPixels\(pixels, palette\) \{[\s\S]*?\n\}\n/.exec(read('src/assets.js'));
if (!recolorSrc) throw new Error('assets.js recolorEnemyPixels not found');

const { Lairs, EnemyRoster, SpriteLayout } = ctx;

// ── The footprints a sheet shows, by tier (cells; a cell is 7 m) ─────────────
const TIER_NAMES = { 9: 'wrecked house', 11: 'fort', 12: 'castle' };
const FOOTPRINTS = { 9: { halfW: 1.5, halfH: 1.5 }, 11: { halfW: 2.5, halfH: 2 }, 12: { halfW: 4, halfH: 3.5 } };

// ── Kinds: stats and sprite geometry ─────────────────────────────────────────
const pngDims = (p) => { const b = fs.readFileSync(path.join(ROOT, p)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const kinds = {}, sheets = {};
for (const g of Object.values(Lairs.GROUPS)) {
  for (const m of g.members) {
    if (kinds[m.kind]) continue;
    const row = EnemyRoster.get(m.kind), art = SpriteLayout.creatureArt(m.kind);
    const sheetRow = EnemyRoster.get(art.sheet);
    if (!sheetRow) throw new Error(`${m.kind}: sheet ${art.sheet} is no roster row`);
    const sheetPath = sheetRow.art.path;
    if (!sheets[art.sheet]) {
      const dims = pngDims(sheetPath);
      sheets[art.sheet] = { path: sheetPath, w: dims.w, h: dims.h, fw: art.fw, fh: art.fh,
        palette: sheetRow.palette || null,
        data: 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, sheetPath)).toString('base64') };
    }
    const mv = row.movement;
    kinds[m.kind] = {
      name: row.name, tier: row.tier, hp: row.hp, armor: row.armor, dmg: row.dmg, range: row.range,
      attack: row.attackType, interval: row.damageIntervalSeconds, speed: mv.speedMetersPerSecond, pattern: mv.pattern,
      eliteEligible: !!row.eliteEligible, ability: row.ability || null, flies: Lairs.flies(m.kind),
      sheet: art.sheet, frame: art.directions?.down?.idle?.[0] ?? 0,
      scale: SpriteLayout.creatureScale(m.kind), tint: SpriteLayout.creatureTint(m.kind),
      alpha: SpriteLayout.creatureAlpha ? SpriteLayout.creatureAlpha(m.kind) : (art.alpha ?? 1),
    };
  }
}

// ── The cards: every group at every tier it may hold ─────────────────────────
const cards = [];
for (const [name, g] of Object.entries(Lairs.GROUPS)) {
  for (const tier of g.tiers) {
    const fp = FOOTPRINTS[tier];
    const layout = Lairs.groupLayout(name, tier, fp.halfW, fp.halfH, 1);
    const members = g.members.map((m) => ({ kind: m.kind, n: Lairs.memberCount(m, tier), place: m.place,
      elite: !!m.elite, aggroCells: m.aggroCells ?? null, proximityCells: m.proximityCells ?? null, band: m.band || null }));
    const core = Lairs.CORE_SEATED_TIERS.has(tier);
    cards.push({ name, tier, tierName: TIER_NAMES[tier], label: g.label, story: g.story, minT: g.minT || 0, coastal: !!g.coastal,
      footprint: fp, core, lairR: core ? layout.coreR : layout.ringR, ringR: layout.ringR, coreR: layout.coreR,
      aggroCells: core ? Lairs.LAIR_CORE_AGGRO_CELLS : Lairs.LAIR_AGGRO_CELLS,
      members, seats: layout.seats, total: layout.seats.length, planned: Lairs.expandGroup(name, tier).length });
  }
}

// ── The paces the same change doubled (Oct 2026) — the old figures beside the
// row's current ones. The old numbers live nowhere else now, so they are the
// change record here.
const OLD_PACE = { goblin: 3.5, goblin_archer: 2.8, goblin_trapper: 2.7, farmer_goblin: 2.2, club_goblin: 2.5,
  spear_goblin: 1.8, archer_goblin: 2, bomb_goblin: 2.6, orc: 1.5, orc_mage: 1.5, orc_shaman: 1.5, bat: 5.5, vampire_bat: 6 };
const paces = Object.entries(OLD_PACE).map(([id, was]) => ({ id, name: EnemyRoster.get(id).name, was,
  now: EnemyRoster.get(id).movement.speedMetersPerSecond }));

const DATA = { cards, kinds, sheets, paces,
  consts: { ceiling: 10, groupRate: Lairs.GROUP_RATE, easyCap: 2, liveMax: Lairs.LAIR_LIVE_MAX, leash: Lairs.LAIR_LEASH_CELLS,
    aggro: Lairs.LAIR_AGGRO_CELLS, coreAggro: Lairs.LAIR_CORE_AGGRO_CELLS, cellM: 7, tierNames: TIER_NAMES } };

// ── The page ─────────────────────────────────────────────────────────────────
const html = `<title>Guard Groups</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@500;700&family=Public+Sans:ital,wght@0,400;0,600;1,400&display=swap">
<style>
/* Layout: a short brief, then one card per group and tier in a wrapping grid —
   the arena (the game's own sprites about a footprint) on top, the roster
   below — and the pace table at the end. Moss and stone, with rust for the
   one thing that matters in each card: the elite. */
:root {
  --bg: #eef0e6; --panel: #f7f8f2; --fg: #1f2419; --muted: #5c6453; --line: #cfd5c3;
  --accent: #4f7a3a; --accent-ink: #ffffff; --elite: #ba6724; --stone: #8a8f84;
  --grass: #a9b98a; --grass2: #9eae7f; --roof: #8c6a4c; --wall: #b9ad98; --water: #7fa6b8; --sand: #d9c99a;
  --ring: #3f5a33; --notice: #ba6724;
  --display: 'Pixelify Sans', 'Courier New', monospace;
  --body: 'Public Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #141a14; --panel: #1c231b; --fg: #e3e8d8; --muted: #a2ab96; --line: #33402f;
  --accent: #8dc06a; --accent-ink: #10190f; --elite: #e08a4a; --stone: #6e746a;
  --grass: #3e5236; --grass2: #364a2f; --roof: #6b4f38; --wall: #7c7362; --water: #3d6577; --sand: #8a7d58;
  --ring: #b9cfa5; --notice: #e08a4a; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #141a14; --panel: #1c231b; --fg: #e3e8d8; --muted: #a2ab96; --line: #33402f;
  --accent: #8dc06a; --accent-ink: #10190f; --elite: #e08a4a; --stone: #6e746a;
  --grass: #3e5236; --grass2: #364a2f; --roof: #6b4f38; --wall: #7c7362; --water: #3d6577; --sand: #8a7d58;
  --ring: #b9cfa5; --notice: #e08a4a; color-scheme: dark; }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 var(--body); margin: 0; }
.wrap { max-width: 1180px; margin: 0 auto; padding-block: 28px 56px; padding-inline: 16px; }
h1, h2, h3 { font-family: var(--display); font-weight: 700; letter-spacing: 0.01em; text-wrap: balance; margin: 0; }
h1 { font-size: clamp(34px, 6vw, 54px); line-height: 1; }
h2 { font-size: 26px; margin-top: 44px; }
h3 { font-size: 20px; }
.lede { max-width: 66ch; color: var(--muted); margin: 14px 0 0; }
.lede b { color: var(--fg); font-weight: 600; }
.legend { display: flex; flex-wrap: wrap; gap: 10px 18px; margin: 18px 0 0; padding: 0; list-style: none; color: var(--muted); font-size: 13px; }
.legend li { display: flex; align-items: center; gap: 8px; }
.sw { width: 22px; height: 0; border-top: 3px solid var(--ring); border-radius: 2px; }
.sw.notice { border-top-style: dashed; border-top-color: var(--notice); }
.sw.roof { height: 12px; border: 0; background: var(--roof); outline: 2px solid var(--wall); }
.sw.star { border: 0; width: auto; color: var(--elite); font-family: var(--display); font-size: 16px; line-height: 1; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 18px; margin-top: 22px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.card header { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.tier { font: 600 11px/1 var(--body); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-ink); background: var(--accent); padding: 5px 8px; border-radius: 4px; white-space: nowrap; }
.tier.coastal { background: var(--water); }
.arena { width: 100%; aspect-ratio: 1; max-width: 100%; border-radius: 8px; display: block; image-rendering: pixelated; background: var(--grass); }
.story { margin: 0; color: var(--muted); font-style: italic; }
.members { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.members li { display: grid; grid-template-columns: 44px 1fr; gap: 10px; align-items: center; border-top: 1px solid var(--line); padding-top: 8px; }
.members canvas { width: 44px; height: 44px; image-rendering: pixelated; display: block; }
.members .who { font-weight: 600; }
.members .who .n { font-family: var(--display); color: var(--accent); margin-right: 4px; font-size: 17px; }
.members .who .el { color: var(--elite); font-weight: 600; }
.members .stat { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.note { font-size: 13px; color: var(--muted); margin: 0; }
.note b { color: var(--fg); font-weight: 600; }
table { border-collapse: collapse; width: 100%; max-width: 640px; margin-top: 16px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
th { font: 600 11px/1.4 var(--body); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
td.num { text-align: right; }
td .up { color: var(--accent); font-weight: 600; }
td .cap { color: var(--elite); font-weight: 600; }
.tablewrap { overflow-x: auto; }
.rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 14px 28px; margin: 18px 0 0; padding: 0; list-style: none; }
.rules li { color: var(--muted); font-size: 14px; }
.rules li b { color: var(--fg); font-weight: 600; display: block; margin-bottom: 2px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
<div class="wrap">
  <h1>Guard Groups</h1>
  <p class="lede">The authored garrisons a held ruin may take in place of its plain roll (<b>src/lairs.js GROUPS</b>): a wrecked house's are small and ring its walls, a castle's are the big ones and start inside the keep. One card per group, seated about its footprint by the game's own placement rule, drawn with the game's own sprites, at 1.6× their size against the ground so they read here. A cell is 7 m. The player's reach is about 2.5 cells.</p>
  <ul class="legend">
    <li><span class="sw roof"></span> the footprint (roof and walls)</li>
    <li><span class="sw"></span> the seating ring, or the knot inside a keep</li>
    <li><span class="sw notice"></span> the notice ring: the garrison hunts once you cross it</li>
    <li><span class="sw star">✦</span> an elite: twice the pool and the blow, an elite's drop</li>
  </ul>
  <div class="grid" id="cards"></div>

  <h2>How a group fights</h2>
  <ul class="rules" id="rules"></ul>

  <h2>Paces doubled the same day</h2>
  <p class="lede">Every goblin and orc row runs at twice its old figure. The bats would have cleared the wild speed ceiling, so they sit on it instead.</p>
  <div class="tablewrap"><table id="paces"><thead><tr><th>Kind</th><th class="num">Was</th><th class="num">Now</th><th>m/s</th></tr></thead><tbody></tbody></table></div>
</div>
<script>
${recolorSrc[0]}
const DATA = ${JSON.stringify(DATA)};
const PX = 2;                       // device pixels per CSS pixel the arenas are drawn at
const CELL_PX = 24;                 // CSS pixels per cell in an arena (the game draws 32 at scale 1)
// Sprites are drawn larger than their map size relative to a cell (the game
// draws a 16px body at 1.5× on a 32px cell), or a runt is eight pixels here.
const SPRITE_BOOST = 1.6;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const painted = new Map();          // sheet → recoloured, tinted canvas (per tint)
const images = new Map();
function image(sheet) {
  if (!images.has(sheet)) images.set(sheet, new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(sheet)); im.src = DATA.sheets[sheet].data;
  }));
  return images.get(sheet);
}
async function sheetFor(kindId) {
  const k = DATA.kinds[kindId], key = k.sheet + ':' + k.tint;
  if (painted.has(key)) return painted.get(key);
  const im = await image(k.sheet), s = DATA.sheets[k.sheet];
  const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const px = g.getImageData(0, 0, s.w, s.h);
  if (s.palette) recolorEnemyPixels(px.data, s.palette);
  const rgb = [(k.tint >> 16) & 255, (k.tint >> 8) & 255, k.tint & 255];
  if (k.tint !== 0xffffff) for (let i = 0; i < px.data.length; i += 4) for (let ch = 0; ch < 3; ch++) px.data[i + ch] = Math.round(px.data[i + ch] * rgb[ch] / 255);
  g.putImageData(px, 0, 0);
  painted.set(key, c);
  return c;
}
// Draw one creature with its feet at (x, y) CSS px, at the game's scale × mul.
async function drawKind(ctx, kindId, x, y, mul, alpha) {
  const k = DATA.kinds[kindId], s = DATA.sheets[k.sheet], sheet = await sheetFor(kindId);
  const cols = Math.floor(s.w / s.fw), sx = (k.frame % cols) * s.fw, sy = Math.floor(k.frame / cols) * s.fh;
  const w = s.fw * k.scale * mul, h = s.fh * k.scale * mul;
  const lift = k.flies ? 6 * mul : 0;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (k.flies) { ctx.globalAlpha = 0.25; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y, w * 0.22, h * 0.09, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = (alpha ?? 1) * (k.alpha ?? 1);
  ctx.drawImage(sheet, sx, sy, s.fw, s.fh, x - w / 2, y - h - lift, w, h);
  ctx.restore();
  return { w, h };
}
function ring(ctx, cx, cy, r, color, dash, width) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 1.5; if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}
async function drawCard(card, canvas) {
  // Cells across the arena: just past the farthest seat, never under eleven.
  const maxR = Math.max(card.ringR, ...card.seats.map((s) => Math.hypot(s.x, s.y)));
  const span = Math.max(11, Math.ceil(2 * (maxR + 1.6)));
  const sizeCss = canvas.clientWidth || 340;
  canvas.width = sizeCss * PX; canvas.height = sizeCss * PX;
  const ctx = canvas.getContext('2d');
  ctx.scale(PX, PX);
  const cellPx = sizeCss / span, mul = cellPx / 32;
  const cx = sizeCss / 2, cy = sizeCss / 2;
  const at = (x, y) => [cx + x * cellPx, cy + y * cellPx];
  // Ground: a faint cell grid; the shore for a coastal group.
  ctx.fillStyle = css('--grass'); ctx.fillRect(0, 0, sizeCss, sizeCss);
  ctx.fillStyle = css('--grass2');
  for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) if ((x + y) % 2) ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
  if (card.coastal) {
    ctx.fillStyle = css('--sand'); ctx.fillRect(0, sizeCss * 0.72, sizeCss, sizeCss * 0.28);
    ctx.fillStyle = css('--water'); ctx.fillRect(0, sizeCss * 0.86, sizeCss, sizeCss * 0.14);
  }
  // The footprint: walls and roof.
  const [fx, fy] = at(-card.footprint.halfW, -card.footprint.halfH);
  const fw = card.footprint.halfW * 2 * cellPx, fh = card.footprint.halfH * 2 * cellPx;
  ctx.fillStyle = css('--wall'); ctx.fillRect(fx, fy, fw, fh);
  ctx.fillStyle = css('--roof'); ctx.fillRect(fx + 3, fy + 3, fw - 6, fh - 6);
  ctx.strokeStyle = css('--wall'); ctx.lineWidth = 1;
  for (let yy = fy + 9; yy < fy + fh - 3; yy += 6) { ctx.beginPath(); ctx.moveTo(fx + 3, yy); ctx.lineTo(fx + fw - 3, yy); ctx.stroke(); }
  // The seating ring (or the knot) and the garrison's notice ring, measured
  // from the ring's edge as guardState measures it.
  ring(ctx, cx, cy, card.lairR * cellPx, css('--ring'), [4, 4], 1.25);
  ring(ctx, cx, cy, (card.lairR + card.aggroCells) * cellPx, css('--notice'), [6, 5], 1.5);
  // A member's own notice ring (the decoy's, the orcs') beside it.
  for (const m of card.members) {
    if (m.aggroCells != null && m.aggroCells !== card.aggroCells) ring(ctx, cx, cy, (card.lairR + m.aggroCells) * cellPx, css('--notice'), [2, 5], 1);
  }
  // Seats, drawn by ground line so nearer bodies overlap farther ones.
  const seats = card.seats.slice().sort((a, b) => a.y - b.y);
  for (const s of seats) {
    const [x, y] = at(s.x, s.y);
    const k = DATA.kinds[s.kind];
    const dormant = s.proximityCells != null;
    const { w, h } = await drawKind(ctx, s.kind, x, y, mul * SPRITE_BOOST, dormant ? 0.8 : 1);
    if (s.elite) {
      ctx.save(); ctx.fillStyle = css('--elite'); ctx.font = (14 * Math.max(0.8, mul * 1.6)) + 'px "Pixelify Sans", monospace';
      ctx.textAlign = 'center'; ctx.fillText('✦', x, y - h - (k.flies ? 6 * mul * SPRITE_BOOST : 0) - 3); ctx.restore();
    }
    if (s.proximityCells != null) ring(ctx, x, y - h / 2, s.proximityCells * cellPx, css('--notice'), [1, 4], 0.8);
  }
  // Scale bar: five cells.
  ctx.save(); ctx.strokeStyle = css('--fg'); ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(10, sizeCss - 12); ctx.lineTo(10 + 5 * cellPx, sizeCss - 12); ctx.stroke();
  ctx.font = '600 10px "Public Sans", sans-serif'; ctx.fillStyle = css('--fg'); ctx.fillText('5 cells · 35 m', 10, sizeCss - 17); ctx.restore();
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const PLACE = { ring: 'round the walls', core: 'at the heart of the keep', floor: 'about the floor', front: 'inside the front wall', behind: 'inside the back wall', cloud: 'over the ruin' };
async function build() {
  const grid = document.getElementById('cards');
  const jobs = [];
  for (const card of DATA.cards) {
    const c = el('article', 'card');
    const head = el('header');
    head.append(el('h3', null, card.label));
    head.append(el('span', 'tier' + (card.coastal ? ' coastal' : ''), (card.coastal ? 'shore ' : '') + card.tierName));
    c.append(head);
    const canvas = el('canvas', 'arena'); canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', card.label + ' at a ' + card.tierName + ': ' + card.members.map(m => m.n + ' ' + DATA.kinds[m.kind].name).join(', '));
    c.append(canvas);
    c.append(el('p', 'story', card.story));
    const ul = el('ul', 'members');
    for (const m of card.members) {
      const k = DATA.kinds[m.kind];
      const li = el('li');
      const thumb = el('canvas'); thumb.width = 44 * PX; thumb.height = 44 * PX; li.append(thumb);
      jobs.push((async () => { const g = thumb.getContext('2d'); g.scale(PX, PX); await drawKind(g, m.kind, 22, 40, 1, 1); })());
      const who = el('div');
      const line = el('div', 'who'); line.append(el('span', 'n', m.n + '×'), document.createTextNode(k.name + ' '));
      if (m.elite) line.append(el('span', 'el', '✦ elite'));
      who.append(line);
      const hp = m.elite ? k.hp * 2 : k.hp, dmg = m.elite ? k.dmg * 2 : k.dmg;
      const bits = ['T' + k.tier, hp + ' hp', dmg + ' dmg / ' + k.interval + ' s', k.speed + ' m/s', PLACE[m.place]];
      if (m.aggroCells != null) bits.push('notices at ' + m.aggroCells + ' cells');
      if (m.proximityCells != null) bits.push('dormant until ' + m.proximityCells + ' cells');
      if (k.ability && k.ability.type === 'split') bits.push('divides when struck, down to ' + k.ability.minHp + ' hp');
      if (k.attack === 'projectile') bits.push('shoots from ' + k.range + ' cells');
      who.append(el('div', 'stat', bits.join(' · ')));
      li.append(who); ul.append(li);
    }
    c.append(ul);
    const notes = [];
    if (card.minT > 0) notes.push('Strong ruins only (strength ≥ ' + card.minT + ').');
    if (card.planned !== card.total) notes.push(card.total + ' of ' + card.planned + ' seats found on this open ground.');
    notes.push('Easy wakes the first ' + DATA.consts.easyCap + '.');
    const p = el('p', 'note'); p.innerHTML = notes.join(' '); c.append(p);
    grid.append(c);
    jobs.push(drawCard(card, canvas));
  }
  const rules = document.getElementById('rules');
  const rc = DATA.consts;
  for (const [b, t] of [
    ['A share of held ruins', 'A wrecked house takes a group ' + Math.round(rc.groupRate[9] * 100) + '% of the time it is held, a castle ' + Math.round(rc.groupRate[12] * 100) + '%; a fort never does. The rest roll the plain garrison. Which group is the ruin\\'s own draw: the same ambush for every player.'],
    ['A house\\'s or a castle\\'s', 'A wreck\\'s groups are one or two (a flock at most) and sit round or over its walls, as its slimes do. A castle\\'s are the big ones and start inside the keep like every castle garrison: walking past is safe, walking in is the fight.'],
    ['Notice and leash', 'A garrison holds its seats until you cross its notice ring (' + rc.aggro + ' cells past a wreck\\'s ring, ' + rc.coreAggro + ' past a keep\\'s knot), hunts you to ' + rc.leash + ' cells from the ruin, then walks home. A member can be told its own ring: the decoy\\'s is long, the orcs\\' short.'],
    ['Dormant ghosts', 'A ghost member hangs over the roof and does nothing until you are within its proximity. Then the whole burst rises at once; its three-minute life starts there. A torch, a lit lamp or daylight burns it.'],
    ['The splitting slime', 'Struck, it keeps half its health and steps a cell to one side; a twin with the other half rises a cell to the other side. It stops dividing when a half would fall under its floor, so the pool is conserved and the whole lineage pays one slime\\'s bounty.'],
    ['Elites', 'An elite member is stamped outright: twice the pool, twice the blow, the elite\\'s drop. Minions roll the ordinary one-in-twenty like any guard.'],
    ['The cap', 'At most ' + rc.liveMax + ' guards stand around the player at once; a horde takes fifteen of them. Easy mode wakes only the first ' + rc.easyCap + ' of any garrison, so member order puts the head of the group first.'],
  ]) { const li = el('li'); li.append(el('b', null, b), document.createTextNode(t)); rules.append(li); }
  const tb = document.querySelector('#paces tbody');
  for (const p of DATA.paces) {
    const tr = el('tr');
    tr.append(el('td', null, p.name));
    const was = el('td', 'num', String(p.was)); tr.append(was);
    const now = el('td', 'num'); const capped = p.now < p.was * 2 - 1e-9;
    now.append(el('span', capped ? 'cap' : 'up', String(p.now))); tr.append(now);
    tr.append(el('td', null, capped ? 'held at the ' + rc.ceiling + ' m/s ceiling' : '×2'));
    tb.append(tr);
  }
  await Promise.all(jobs);
}
let redrawT = null;
function redrawAll() { document.querySelectorAll('.arena').forEach((cv, i) => drawCard(DATA.cards[i], cv)); }
window.addEventListener('resize', () => { clearTimeout(redrawT); redrawT = setTimeout(redrawAll, 150); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll);
new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.fonts?.ready.then(() => build());
</script>
`;
if (OUT) { fs.writeFileSync(OUT, html); console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB, ${cards.length} cards, ${Object.keys(kinds).length} kinds)`); }
else process.stdout.write(html);
