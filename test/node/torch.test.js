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
const app = SCENE_SRC;

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
  assert.eq(it.kind, 'supply', 'kind — the Use button and the rarity class key off it');
  assert.eq(it.baseTier, 1, 'baseTier — T1, the cave staple');
  assert.eq(BASE_TIER.torch, 1, 'BASE_TIER row');
  assert.eq(PRICES.torch, 5, 'price (one wood crafts it, so it stays low)');
  assert.lt(PRICES.torch, PRICES.rope, 'cheaper than the rope');
  assert.truthy(ITEM_EFFECTS.torch, 'a narrative item description');
  assert.truthy(/flame|dark/i.test(ITEM_EFFECTS.torch), 'the description hints through firelight');
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
  assert.eq(Lighting.TORCH_RADIUS_MUL, CONSUMABLE_SPEC.torch.radiusMul,
    'the player-light radius multiplier comes from the consumable owner');
  assert.truthy(/const TORCH_RADIUS_MUL = CONSUMABLE_SPEC\.torch\.radiusMul;/.test(LIGHTING_SRC),
    'lighting derives rather than retyping it');
  assert.eq(Lighting.radiusCells('handtorch'), Lighting.radiusCells('player') * Lighting.TORCH_RADIUS_MUL,
    'the torch radius IS the player radius × TORCH_RADIUS_MUL — one derivation, not a second number');
  assert.eq(T.colour, P.colour, 'the same colour as the player\'s own light');
  assert.eq(P.colour, 0xffffff, 'which is white');
  assert.gt(T.peak, 0, 'a real cookie');
  assert.gt(T.flicker, 0, 'it is a flame: it breathes');
  assert.gt(Lighting.radiusCells('handtorch'), Lighting.radiusCells('trailer'), 'and it throws further than Home');
  // The player row's radius is the ramp's extent — the viewport's half-
  // diagonal plus the past-corner margin.
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
  assert.truthy(/if \(!inRange\(scene, dx, dy, kind, halfM\)\) return kind;/.test(LIGHTING_SRC),
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
  assert.truthy(/collectFires\(scene, ax, ay, halfM\);\n\s*collectLamps\(scene, ax, ay, halfM\);\n\s*collectPlayer\(scene, ax, ay, halfM, now\);/.test(draw),
    'collectPlayer runs in draw(), after the fires and the street lamps');
  // The ramp is painted in the static layer draw() lays first (directly, or
  // baked and copied while it holds — paintStaticLayer either way).
  const stat = LIGHTING_SRC.slice(LIGHTING_SRC.indexOf('function paintStaticLayer('), LIGHTING_SRC.indexOf('function blitStatic('));
  assert.truthy(/ctx\.drawImage\(player\.canvas,/.test(stat) && /paintStaticLayer\(/.test(draw),
    'the ramp is still drawn — the torch adds to it');
  const pk = LIGHTING_SRC.slice(LIGHTING_SRC.indexOf('function playerKind('), LIGHTING_SRC.indexOf('function beginFrame('));
  assert.falsy(/depth/.test(pk), 'playerKind never asks the depth — a torch lights on the surface too (the sun only dims it)');
  assert.eq(Lighting.playerKind(scene({ depth: 0, isTorchActive: () => true })), 'handtorch', 'lit on the surface too');
});

// ── app.js: the timer, the readout, the Use button ─────────────────────────
test('torch: its three-minute runtime is the row\'s, read at the use', () => {
  assert.eq(CONSUMABLE_SPEC.torch.durationMs, 3 * 60 * 1000, 'three minutes');
  assert.eq(CONSUMABLE_SPEC.torch.buff, 'torch', 'a timed buff row: _useTimedBuff lights it');
  assert.falsy(/TORCH_MS/.test(app), 'no duration alias in the scene');
});

test('torch: lighting it runs for the row\'s length, extending from the current end, in memory only', () => {
  // _useTimedBuff lifted and RUN: two torches a second apart burn six minutes.
  const lift = (name) => {
    const start = app.indexOf('\n  ' + name + '('), end = app.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start, `found ${name}`);
    const tables = ['SUMMON_HOOK', 'TIMED_BUFF_HOOKS'].map(t => app.match(new RegExp('\\nconst ' + t + ' = \\{[\\s\\S]*?\\n\\};'))[0]).join('\n');
    return new Function(tables + '\nreturn ({' + app.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  };
  const titles = [];
  const s = { save: { inv: [{ id: 'torch', count: 3 }], selSlot: 0 }, _torchUntil: 0,
    isTorchActive() { return (this._torchUntil ?? 0) > Date.now(); },
    showMessageModal: ({ title }) => titles.push(title), buildInventoryDOM() {} };
  for (const name of ['_useTimedBuff', '_selectedConsumable', '_spendScroll', '_consumeSelected', '_finishInventoryChange']) s[name] = lift(name);
  const T0 = 1_700_000_000_000, old = Date.now; let now = T0; Date.now = () => now;
  try {
    assert.truthy(s._useTimedBuff('torch'), 'lit');
    assert.eq(s._torchUntil, T0 + CONSUMABLE_SPEC.torch.durationMs, 'burns the row\'s three minutes');
    now = T0 + 1000;
    assert.truthy(s._useTimedBuff('torch'), 'lit again');
    assert.eq(s._torchUntil, T0 + 2 * CONSUMABLE_SPEC.torch.durationMs,
      'extends from the LATER of now and the current end — a second torch is never wasted');
    assert.eq(s.save.inv[0].count, 1, 'two spent');
    assert.eq(titles.join('|'), '🔥 You light the Torch|🔥 You light another Torch', 'the title knows a torch was burning');
  } finally { Date.now = old; }
  assert.falsy(/shortDuration/.test(JSON.stringify(titles)), 'the story leaves time to the live torch readout');
  assert.truthy(/\n  isTorchActive\(\) \{\n    return \(this\._torchUntil \?\? 0\) > Date\.now\(\);\n  \}/.test(app),
    'isTorchActive is the timer test');
  assert.falsy(/save\.(_)?torchUntil|torchUntil: /.test(app), 'never on the save — a refresh puts it out');
});

test('torch: its readout is a chip of the status row (Buffs.KINDS), via shortDuration', () => {
  assert.eq(Buffs.KINDS.torch.scene, '_torchUntil', 'the row reads the in-memory timer');
  const now = Date.now();
  const rows = Buffs.active({}, { _torchUntil: now + 5000 }, now);
  assert.eq(rows.map(r => r.id).join(','), 'torch', 'lit: one row');
  assert.eq(rows[0].remainingMs, 5000, 'with the time left');
  assert.eq(Buffs.active({}, { _torchUntil: now }, now).length, 0, 'out: no row');
  assert.falsy(/torchTimerText/.test(app), 'no label of its own — the status row shows it');
  assert.truthy(/for \(const b of Buffs\.active\(this\.save, this\)\)/.test(app), 'the status row reads the table');
  assert.truthy(/`\$\{b\.name\} · \$\{shortDuration\(b\.remainingMs\)\}`/.test(app), 'the wait is shortDuration');
});

test('torch: the Light confirmation distinguishes fresh and renewed flame', () => {
  const row = CONSUMABLE_SPEC.torch;
  assert.eq(row.buff, 'torch', '→ the torch buff row');
  assert.eq(row.verb, 'Light', 'the button reads Light');
  const now = Date.now();
  const lit = row.get({ isTorchActive: () => true, _torchUntil: now + 30_000 }, row);
  const dark = row.get({ isTorchActive: () => false, _torchUntil: now }, row);
  assert.truthy(/feeds.*already/.test(lit), 'a burning torch receives fresh flame');
  assert.truthy(/opens the dark/.test(dark), 'an unlit torch opens the dark');
  assert.falsy(/\d/.test(lit + dark), 'exact durations stay out of confirmation prose');
});
test('torch: the sun outshines it on the surface — full by night, TORCH_DAY_FLOOR at noon', () => {
  const F = Lighting.TORCH_DAY_FLOOR;
  assert.truthy(F > 0 && F < 0.5, 'a faint hint of the torch survives full day');
  assert.eq(Lighting.torchStrength(0, 0), 1, 'surface, night: full');
  assert.eq(Lighting.torchStrength(0, 1), F, 'surface, noon: the floor');
  const dusk = Lighting.torchStrength(0, 0.5);
  assert.truthy(dusk > F && dusk < 1, 'dusk sits between');
  assert.eq(Lighting.torchStrength(1, 1), 1, 'underground there is no sun');
  assert.eq(Lighting.torchStrength(3, 0), 1);
});

test('torch: the collector stamps the dimmed strength as the entry alpha', () => {
  const w = globalThis.window, old = w.__DAYLIGHT;
  w.__DAYLIGHT = 1;
  try {
    const noon = scene({ depth: 0, isTorchActive: () => true });
    Lighting.beginFrame(noon);
    Lighting.collectPlayer(noon, 103, 196, HALF_M);
    assert.eq(noon._lights[0].a, Lighting.TORCH_DAY_FLOOR, 'noon on the surface: the floor');
    w.__DAYLIGHT = 0;
    const night = scene({ depth: 0, isTorchActive: () => true });
    Lighting.beginFrame(night);
    Lighting.collectPlayer(night, 103, 196, HALF_M);
    assert.eq(night._lights[0].a, undefined, 'night: full strength, no alpha');
    w.__DAYLIGHT = 1;
    const cave = scene({ depth: 2, isTorchActive: () => true });
    Lighting.beginFrame(cave);
    Lighting.collectPlayer(cave, 103, 196, HALF_M);
    assert.eq(cave._lights[0].a, undefined, 'a cave ignores the sun');
  } finally { if (old === undefined) delete w.__DAYLIGHT; else w.__DAYLIGHT = old; }
});

})();
