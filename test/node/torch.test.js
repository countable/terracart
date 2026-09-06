// THE TORCH WIDENS THE FALLOFF, NOT THE PLATEAU.
//
// A Torch is a T1 consumable: light it (Use button → confirm → useTorch) and
// for TORCH_MS the player's own light reaches TORCH_RADIUS_MUL times as far.
// Three things have to hold for that to be the lightmap's kind of light:
//
//   1. It is a ROW of Lighting.KINDS (`torch`), DERIVED from the `player`
//      row — its radius is the player's × TORCH_RADIUS_MUL, its colour the
//      player's — and the collector emits it for the player, culling at
//      halfM + the torch's own radius, while scene.isTorchActive() is true.
//      Light ADDS: the ramp is still drawn, the torch cookie stamps on top.
//   2. It never touches the reach plateau: cellInReach, reachRadiusM and the
//      profile's `lit` level know nothing about it, so the tap gate can't
//      widen with the flame.
//   3. Its wait is shortDuration, in memory only (a refresh puts it out), and
//      lighting a second one EXTENDS from the current end.
//
// lighting.js loads headlessly, so 1 and 2 run for real on a scene stub the
// way lighting.test.js does; app.js needs Phaser, so its side is pinned as
// source text in the style of rope.test.js.

(function () {
const app = APP_JS_SRC;

function scene(over) {
  return Object.assign({
    depth: 1,
    cellM: 5,
    startWorldM: { x: 100, y: 200 }, playerM: { x: 3, y: -4 }, originPx: { x: 0, y: 0 },
    mPerPx: 10, feetOffsetM: 0, cellsPerTile: 512,
    save: { energy: 100, maxEnergy: 100, fires: [] },
    _atmos: { dim: 0x1a2a1e },
    isClaimedKey: () => false,
  }, over);
}
const HALF_M = (11 / 2 + 1) * 5;   // drawObjects' halfM at cellM 5

// ── Registry ────────────────────────────────────────────────────────────────
test('torch: a T1 consumable with a price, an effect line and a Book tip', () => {
  const it = ITEM_BY_ID.torch;
  assert.truthy(it, 'torch is registered');
  assert.eq(it.name, 'Torch');
  assert.eq(it.kind, 'consumable', 'kind — the Use button and the rarity class key off it');
  assert.eq(it.baseTier, 1, 'baseTier — T1, the cave staple');
  assert.eq(BASE_TIER.torch, 1, 'BASE_TIER row');
  assert.eq(PRICES.torch, 15, 'price');
  assert.lt(PRICES.torch, PRICES.rope, 'cheaper than the rope');
  assert.truthy(/^Use /.test(ITEM_EFFECTS.torch || ''), 'an ITEM_EFFECTS line that starts "Use"');
  assert.truthy(/light/i.test(ITEM_EFFECTS.torch), 'and says it is light');
  assert.falsy('icon' in it, 'no emoji icon field (QC_RULES §1)');
  // What the torch does is on the torch (its ✦ line); no Book tip repeats it.
  assert.falsy(PLAY_TIPS.some(t => /\bTorch\b/.test(t)), 'no Book tip restates the item');
});

test('torch: two-table icon rule — MINERAL_ICON_SHEET → ICON_SHEETS → a real 16×16 PNG', () => {
  const src = MINERAL_ICON_SHEET.torch;
  assert.truthy(src, 'MINERAL_ICON_SHEET.torch');
  assert.eq(src.sheet, 'icon_torch');
  assert.eq(src.frame, 0, 'single-frame icon');
  const row = app.match(new RegExp(`\\n  ${src.sheet}:\\s*\\{ url: '([^']+)',\\s*cols: (\\d+),\\s*srcW: (\\d+),\\s*srcH: (\\d+) \\}`));
  assert.truthy(row, `ICON_SHEETS has a '${src.sheet}' row (else the icon falls through to Crops.png)`);
  assert.eq(row[1], 'assets/Icons/Items/Torch.png');
  const dims = pngDims(row[1]);
  assert.truthy(dims, `${row[1]} exists and is a PNG`);
  assert.eq(dims.w, 16, 'a 16px frame');
  assert.eq(dims.h, 16);
  assert.eq(dims.w, Number(row[3]), 'srcW matches the file');
  assert.eq(dims.h, Number(row[4]), 'srcH matches the file');
  assert.eq(Number(row[2]), 1, 'one column');
});

// ── The light row: derived from the player's ──────────────────────────────
test('torch: a KINDS row, TORCH_RADIUS_MUL player radii of the player\'s own white', () => {
  const P = Lighting.KINDS.player, T = Lighting.KINDS.handtorch;
  assert.truthy(P, 'the player has a row');
  assert.truthy(T, 'and so does the torch');
  assert.eq(Lighting.TORCH_RADIUS_MUL, 2, 'twice the player\'s radius');
  assert.eq(Lighting.radiusCells('handtorch'), Lighting.radiusCells('player') * Lighting.TORCH_RADIUS_MUL,
    'the torch radius IS the player radius × TORCH_RADIUS_MUL — one derivation, not a second number');
  assert.eq(T.colour, P.colour, 'the same colour as the player\'s own light');
  assert.eq(P.colour, 0xffffff, 'which is white');
  assert.gt(T.peak, 0, 'a real cookie');
  assert.gt(T.flicker, 0, 'it is a flame: it breathes');
  assert.gt(Lighting.radiusCells('handtorch'), Lighting.radiusCells('trailer'), 'and it throws further than Home');
  // The player row's radius is the ramp's extent — the viewport's half-
  // diagonal plus the past-corner margin — the same number draw() used to
  // compute for rMax.
  const near = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(`${m}: ${a} vs ${b}`); };
  near(Lighting.radiusCells('player'), Math.hypot(VIEW_CELLS, VIEW_CELLS) / 2 + Lighting.PLAYER_RAMP_PAST_CORNER_CELLS,
    'the player row is the ramp');
  assert.truthy(/const rMax = radiusCells\('player'\) \* CELL_PX;/.test(LIGHTING_SRC),
    'draw() reads the ramp\'s extent off the row, not a second copy of the maths');
  assert.truthy(/const white = KINDS\.player\.colour;/.test(LIGHTING_SRC), 'and the ramp\'s colour');
});

test('torch: the collector emits `torch` for the player while it burns, `player` otherwise', () => {
  const s = scene({ isTorchActive: () => false });
  assert.eq(Lighting.playerKind(s), 'player', 'no torch: the player row');
  assert.eq(Lighting.sourceKind(s, { kind: 'player' }), 'player', 'sourceKind answers for the player too');
  Lighting.beginFrame(s);
  assert.eq(Lighting.collectPlayer(s, 103, 196, HALF_M), 'player');
  assert.eq(s._lights.length, 0, 'the ramp IS the player row: no cookie on top of it');

  const t = scene({ isTorchActive: () => true });
  assert.eq(Lighting.playerKind(t), 'handtorch', 'lit: the torch row');
  assert.eq(Lighting.sourceKind(t, { kind: 'player' }), 'handtorch');
  Lighting.beginFrame(t);
  // The anchor is the player plus a peek of (2, -3) m: the light is measured
  // from the anchor, like every world-drawn thing, so it slides with the peek.
  assert.eq(Lighting.collectPlayer(t, 103 + 2, 196 - 3, HALF_M), 'handtorch');
  assert.eq(t._lights.length, 1, 'one torch');
  assert.eq(t._lights[0].kind, 'handtorch');
  assert.eq(t._lights[0].dx, -2, 'at the feet, in anchor metres');
  assert.eq(t._lights[0].dy, 3);
  assert.eq(Lighting.playerKind(scene()), 'player', 'a scene with no isTorchActive at all is unlit');
  assert.eq(Lighting.collectPlayer(scene(), 0, 0, HALF_M), 'player');
});

test('torch: the cull pads by the torch\'s own radius', () => {
  // The player can't be off-screen, but the rule is the rule: the collector
  // asks inRange with the torch row, and that row's radius is what pads it.
  const R = Lighting.radiusCells('handtorch') * 5;
  const far = scene({ isTorchActive: () => true, playerM: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 } });
  Lighting.beginFrame(far);
  Lighting.collectPlayer(far, HALF_M + R - 1, 0, HALF_M);
  assert.eq(far._lights.length, 1, 'a torch a torch-radius off the anchor still lights the edge');
  Lighting.beginFrame(far);
  Lighting.collectPlayer(far, HALF_M + R + 1, 0, HALF_M);
  assert.eq(far._lights.length, 0, 'past its own radius it is dropped');
  assert.truthy(/if \(inRange\(scene, dx, dy, kind, halfM\)\) scene\._lights\.push\(\{ kind, dx, dy, id: PLAYER_OBJ\.id \}\);/.test(LIGHTING_SRC),
    'the push goes through inRange with the row the player lit as');
});

test('torch: the plateau is untouched — reach, the profile and the tap gate ignore the flame', () => {
  const dark = scene({ isTorchActive: () => false }), lit = scene({ isTorchActive: () => true });
  assert.eq(reachRadiusM(lit), reachRadiusM(dark), 'reachRadiusM does not widen');
  assert.eq(cellInReach(lit, 3, 0), cellInReach(dark, 3, 0), 'cellInReach is the same test');
  const pd = Lighting.profile(dark), pl = Lighting.profile(lit);
  for (const k of ['ambient', 'edge', 'lit', 'litColour', 'farA']) assert.eq(pl[k], pd[k], `profile.${k} is torch-blind`);
  assert.falsy(/isTorchActive|torch/i.test(LIGHTING_SRC.slice(LIGHTING_SRC.indexOf('function profile('), LIGHTING_SRC.indexOf('function playerCookieAlpha('))),
    'profile() never asks about the torch');
  // draw() collects it beside the fires, and still draws the ramp.
  const draw = LIGHTING_SRC.slice(LIGHTING_SRC.indexOf('function draw(scene, ax, ay, halfM)'));
  assert.truthy(/collectFires\(scene, ax, ay, halfM\);\n\s*collectPlayer\(scene, ax, ay, halfM\);/.test(draw),
    'collectPlayer runs in draw(), after the fires');
  assert.truthy(/ctx\.drawImage\(player\.canvas,/.test(draw), 'the ramp is still drawn — the torch adds to it');
  const pk = LIGHTING_SRC.slice(LIGHTING_SRC.indexOf('function playerKind('), LIGHTING_SRC.indexOf('function beginFrame('));
  assert.falsy(/depth/.test(pk), 'playerKind never asks the depth — a torch by night on the surface is fine, and free');
  assert.eq(Lighting.playerKind(scene({ depth: 0, isTorchActive: () => true })), 'handtorch', 'lit on the surface too');
});

// ── app.js: the timer, the readout, the Use button ─────────────────────────
test('torch: TORCH_MS is three minutes, derived from MINUTE_MS', () => {
  assert.truthy(/\nconst TORCH_MS = 3 \* MINUTE_MS;/.test(app), 'TORCH_MS = 3 * MINUTE_MS');
});

test('torch: useTorch lights it for TORCH_MS, extending from the current end, in memory only', () => {
  const m = app.match(/\n  useTorch\(\) \{\n([\s\S]*?)\n  \}\n/);
  assert.truthy(m, 'useTorch() exists');
  const body = m[1];
  assert.truthy(/sel\.id !== 'torch'/.test(body), 'only a selected torch');
  assert.truthy(/this\._torchUntil = Math\.max\(now, this\._torchUntil \?\? 0\) \+ TORCH_MS;/.test(body),
    'extends from the LATER of now and the current end — a second torch is never wasted');
  assert.truthy(/return this\._finishConsumable\(/.test(body), 'consumed through the shared finisher (consume, persist, rebuild, modal)');
  assert.truthy(/shortDuration\(this\._torchUntil - now\)/.test(body), 'the modal says how long it now burns, via shortDuration');
  assert.truthy(/\n  isTorchActive\(\) \{\n    return \(this\._torchUntil \?\? 0\) > Date\.now\(\);\n  \}/.test(app),
    'isTorchActive is the timer test');
  assert.falsy(/save\.(_)?torchUntil|torchUntil: /.test(app), 'never on the save — a refresh puts it out');
});

test('torch: the readout beside the dragon\'s and the shadow\'s, via shortDuration, hidden when out', () => {
  assert.truthy(/this\.torchTimerText = this\.add\.text\(/.test(app), 'a torchTimerText label');
  const upd = app.match(/if \(this\.isTorchActive\(\)\) \{\n([\s\S]*?)\n    \} else if \(this\.torchTimerText\.visible\) \{\n\s*this\.torchTimerText\.setVisible\(false\);/);
  assert.truthy(upd, 'refreshed in update(), hidden once out');
  assert.truthy(/\.setText\(shortDuration\(this\._torchUntil - Date\.now\(\)\)\)/.test(upd[1]), 'the wait is shortDuration');
  assert.truthy(/const stacked = \(dragonActive \? 1 : 0\) \+ \(shadowActive \? 1 : 0\);/.test(upd[1]),
    'stacked above whichever of the other two are showing');
});

test('torch: the Use button row — confirm dialog → useTorch, and the `get` line says a second one adds', () => {
  const m = app.match(/\n      torch: \{([\s\S]*?)\},\n(?=      sapphire:)/);
  assert.truthy(m, 'a torch row in the CONSUMABLE table');
  const row = m[1];
  assert.truthy(/method: 'useTorch'/.test(row), '→ useTorch');
  assert.truthy(/verb: 'Light'/.test(row), 'the button reads Light');
  assert.truthy(/get: \(\) => \(this\.isTorchActive\(\)/.test(row), '`get` is a function that asks whether one burns');
  assert.truthy(/adds \$\{shortDuration\(TORCH_MS\)\} to the \$\{shortDuration\(this\._torchUntil - Date\.now\(\)\)\} still burning/.test(row),
    'with one lit, the line says the new one ADDS to what is left');
  assert.truthy(/for \$\{shortDuration\(TORCH_MS\)\}/.test(row), 'otherwise, how long it burns — shortDuration, never a bare number');
});
})();
