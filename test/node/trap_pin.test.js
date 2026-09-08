// Trap pin + first-tool-action stories.
//
// TRAP PIN: walking onto a hidden trap springs it, and the jaw holds the
// body for 3 s — _tickTraps stamps `this._pinnedUntil = performance.now() +
// 3000` on first contact, and update() gates the WHOLE movement block
// (_steerManual / _driftHome / _steerTarget / _followStep) on it, so the
// inputs die with the body (no walking energy drain while clamped). When the
// pin expires, update() clears it and fires the 'trap_free' story splash
// once per save. The bite, the bleed, the pain flash and the cell pops are
// exactly as they were — the pin is a gate on movement, nothing else.
//
// STORIES: the first trap ever ('trap') and the first action of each tool
// type ('tool:till' … 'tool:shoot') go through _storySplashOnce, the same
// story ledger as the delivery/shiny/castle moments (story_splashes.test.js),
// so each fires once per save and a busy screen just asks again next time.
// interact.js hooks call `scene._toolActionStory?.(action)` at ACTION START —
// after the energy spend, as the wheel spins up or the shot is loosed — so a
// dry tap tells no story.
//
// app.js can't load headlessly, so _tickTraps, _toolActionStory and the
// gated movement block are lifted out of APP_JS_SRC and run for real on stub
// scenes (the story_splashes / home_ward idiom); the call sites are pinned
// as source text. The art stems are checked against the real PNGs via
// pngDims, same as story_splashes.test.js.

(function () {
const app = APP_JS_SRC;
const ix = INTERACT_SRC;

const lift = (src, sig, what) => {
  const start = src.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : src.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${what}`);
  return src.slice(start + 1, end + 4);
};

const TICK_SRC = lift(app, '_tickTraps(dt) {', '_tickTraps');
const STORY_SRC = lift(app, '_storySplashOnce(key, { art, title, body, okLabel } = {}) {',
  '_storySplashOnce');
const TOOL_SRC = lift(app, '_toolActionStory(action) {', '_toolActionStory');

// The gated movement block inside update(): from the pin gate to the closing
// brace of its else. Run for real below with (stick, vx, vy, speedMul, dt).
const MOVE_SRC = (() => {
  const a = app.indexOf('if (performance.now() < (this._pinnedUntil || 0)) {');
  const mark = 'this._followStep(dt);\n    }';
  const b = a < 0 ? -1 : app.indexOf(mark, a);
  assert.truthy(a > 0 && b > a, 'found the trap-pin movement gate in update()');
  return app.slice(a, b + mark.length);
})();
const moveStep = new Function('stick', 'vx', 'vy', 'speedMul', 'dt', MOVE_SRC);

const tickMethods = new Function(`return {\n${TICK_SRC}\n};`)();
const storyMethods = new Function(`return {\n${STORY_SRC},\n${TOOL_SRC}\n};`)();

const TRAP_STEMS = ['trap_jaw', 'trap_free'];
const TOOL_STEMS = ['tool_till', 'tool_chop', 'tool_dig', 'tool_water',
                    'tool_catch', 'tool_sword', 'tool_shoot'];

// ── The pin, as source ────────────────────────────────────────────────────
test('trap pin: the spring branch stamps _pinnedUntil 3 s out', () => {
  const spring = TICK_SRC.indexOf('if (Traps.spring(this.save, trap.id)) {');
  const ret = TICK_SRC.indexOf('return;', spring);
  const branch = TICK_SRC.slice(spring, ret);
  assert.truthy(spring > 0 && ret > spring, 'found the first-contact branch');
  assert.truthy(/this\._pinnedUntil = performance\.now\(\) \+ 3000;/.test(branch),
    'first contact pins the body for 3000 ms');
  assert.truthy(/this\._storySplashOnce\('trap', \{[\s\S]{0,200}art: 'trap_jaw'/.test(branch),
    'the first trap ever splashes with the trap_jaw banner');
  // The existing behaviour is untouched: the pin is added, nothing removed.
  assert.truthy(/this\._painFlash\(spent\)/.test(branch), 'the pain flash is still there');
  assert.truthy(/this\._popEnergy\(-spent, \{ ix, iy, label: '🪤 trap' \}\)/.test(branch),
    'the bite still pops its real number on the trap cell');
  assert.truthy(/if \(typeof persistSave === 'function'\) persistSave\(this\.save\);/.test(branch),
    'the reveal is still persisted at once');
});

test('trap pin: the movement block is gated on the pin, all four steps together', () => {
  assert.truthy(/if \(performance\.now\(\) < \(this\._pinnedUntil \|\| 0\)\) \{/.test(app),
    'update() reads the pin');
  for (const step of ['this._steerManual(stick.x, stick.y, dt);',
                      'this._driftHome(dt);',
                      'this._steerTarget(vx, vy, speedMul, dt);',
                      'this._followStep(dt);']) {
    assert.truthy(MOVE_SRC.includes(step), `${step} sits inside the gate`);
  }
  const clear = MOVE_SRC.indexOf('this._pinnedUntil = 0;');
  const splash = MOVE_SRC.indexOf("this._storySplashOnce('trap_free', {");
  assert.truthy(clear > 0 && splash > clear, 'an expired pin clears, then tells the story');
  assert.truthy(/art: 'trap_free'/.test(MOVE_SRC.slice(splash, splash + 400)),
    'the freed splash carries the trap_free banner');
});

// ── The pin, run for real ─────────────────────────────────────────────────
function pinScene() {
  const calls = { steer: 0, drift: 0, target: 0, follow: 0, splashes: [] };
  const scene = {
    save: {},
    _steerManual: () => { calls.steer++; },
    _driftHome: () => { calls.drift++; },
    _steerTarget: () => { calls.target++; },
    _followStep: () => { calls.follow++; },
    _storySplashOnce: (key, opts) => { calls.splashes.push([key, opts]); return true; },
  };
  return { scene, calls };
}

test('trap pin (behaviour): while pinned, no movement step runs', () => {
  const { scene, calls } = pinScene();
  scene._pinnedUntil = performance.now() + 3000;
  for (let i = 0; i < 10; i++) moveStep.call(scene, { x: 1, y: 0 }, 0, 0, 1, 16);
  assert.eq(calls.steer, 0, 'no steering while clamped');
  assert.eq(calls.drift, 0, 'no drift home while clamped');
  assert.eq(calls.target, 0, 'no keyboard steer while clamped');
  assert.eq(calls.follow, 0, 'no follow step while clamped');
  assert.eq(calls.splashes.length, 0, 'and no freed splash yet');
});

test('trap pin (behaviour): expiry clears the pin, fires trap_free once, and movement resumes', () => {
  const { scene, calls } = pinScene();
  scene._pinnedUntil = performance.now() - 1;   // just expired
  moveStep.call(scene, null, 0, 0, 1, 16);
  assert.eq(scene._pinnedUntil, 0, 'the pin cleared itself');
  assert.eq(calls.splashes.length, 1, 'the freed splash fired');
  assert.eq(calls.splashes[0][0], 'trap_free', 'it is the trap_free story');
  assert.eq(calls.splashes[0][1].art, 'trap_free', 'carrying the trap_free banner');
  assert.eq(calls.drift, 1, 'the drift home ran again');
  assert.eq(calls.follow, 1, 'the follow step ran again');
  // The next frames: movement keeps running, the splash does not re-fire.
  moveStep.call(scene, null, 0, 0, 1, 16);
  moveStep.call(scene, { x: 0, y: 1 }, 0, 0, 1, 16);
  assert.eq(calls.splashes.length, 1, 'trap_free fires once per pin, not per frame');
  assert.eq(calls.steer, 1, 'steering is live again');
  assert.eq(calls.follow, 3, 'and keeps following');
});

// ── The trap spring, run for real ─────────────────────────────────────────
function trapScene() {
  const scene = {
    save: { energy: 100 },
    startWorldM: { x: 0, y: 0 },
    originPx: { x: 0, y: 0 },
    cellsPerTile: 16,
    _trapCellKey: '0_0_3_4',
    _trapHere: { id: 'trap_a', x: 15, y: 20 },
    _tickTraps: tickMethods._tickTraps,
    _storySplashOnce: storyMethods._storySplashOnce,
    playerToWorldCell: () => ({ tx: 0, ty: 0, cx: 3, cy: 4 }),
    playerScreen: () => null,
    _painFlash: () => {},
    _popEnergy: () => {},
    _warnIfTiring: () => {},
    flash: () => {},
    modals: [],
    showMessageModal(opts) { this.modals.push(opts); },
  };
  return scene;
}

test('trap pin (behaviour): first contact sets the pin ~3 s out and splashes once per save', () => {
  const s = trapScene();
  const realPersist = globalThis.persistSave;
  globalThis.persistSave = () => {};
  try {
    const t0 = performance.now();
    s._tickTraps(16);
    assert.truthy(s._pinnedUntil >= t0 + 2990 && s._pinnedUntil <= t0 + 3010,
      `_pinnedUntil is ~3000 ms out (got ${s._pinnedUntil - t0})`);
    assert.eq(s.save.storySeen.trap, 1, 'the trap story is banked in the ledger');
    assert.eq(s.modals.length, 1, 'the splash modal opened');
    assert.eq(s.modals[0].art, 'trap_jaw', 'with the trap_jaw banner');
    // A SECOND, different trap springs: the pin re-stamps, the story does not.
    s._pinnedUntil = 0;
    s._trapHere = { id: 'trap_b', x: 30, y: 40 };
    s._tickTraps(16);
    assert.truthy(s._pinnedUntil >= performance.now() + 2990, 'the new trap pins again');
    assert.eq(s.modals.length, 1, 'but the trap splash fires once per save');
  } finally {
    globalThis.persistSave = realPersist;
  }
});

// ── The tool-action stories ───────────────────────────────────────────────
const TOOL_TABLE = (() => {
  const m = TOOL_SRC.match(/TOOL_STORIES = \{([\s\S]*?)\n    \};/);
  assert.truthy(m, 'the TOOL_STORIES table exists');
  const rows = {};
  for (const r of m[1].matchAll(/(\w+): *\{ art: '(tool_\w+)',\s*title: '([^']+)'/g)) {
    rows[r[1]] = { art: r[2], title: r[3] };
  }
  return rows;
})();

test('tool stories: the table has all 7 actions, each with its banner', () => {
  const want = { till: 'tool_till', chop: 'tool_chop', dig: 'tool_dig',
                 water: 'tool_water', catch: 'tool_catch', sword: 'tool_sword',
                 shoot: 'tool_shoot' };
  assert.eq(Object.keys(TOOL_TABLE).sort().join(','),
            Object.keys(want).sort().join(','), 'exactly the 7 actions');
  for (const [action, stem] of Object.entries(want)) {
    assert.eq(TOOL_TABLE[action].art, stem, `${action} carries ${stem}`);
  }
});

test('tool stories: interact.js hooks fire at action start, one per call site', () => {
  const hook = (action, anchor, what, after = true) => {
    const call = `scene._toolActionStory?.('${action}');`;
    const c = ix.indexOf(call);
    const a = ix.indexOf(anchor);
    assert.truthy(c > 0, `${what} calls ${call}`);
    assert.truthy(a > 0, `found ${what}'s anchor`);
    assert.eq(ix.indexOf(call, c + 1), -1, `${what} hooks ${action} exactly once`);
    if (after) assert.truthy(c < a, `${what}: the story fires as the action STARTS`);
    else assert.truthy(c > a, `${what}: the story fires after the anchor`);
    return { c, a };
  };
  hook('till', "scene.startWorkProgress(cwmx, cwmy, () => {\n      scene.tilledSet.add(cellKey);",
       'the till wheel');
  hook('dig', 'scene.digCaveWall(cell.tx, cell.ty, cell.ix, cell.iy, cellIX, cellIY);',
       'the pick wheel');
  hook('catch', 'scene.startCatchProgress(victim, catchMs,', 'the catch wheel');
  // The melee story hooks startCombat in app.js - the ONE lane both the
  // tapped swing (interact.js) and the sword auto-engage (_combatTick) flow
  // through. NOT the hunt wheel: that one is the bug net's, and a shipped
  // pin refuses a weapon slot anywhere near it (interact_tap.test.js).
  const sc = app.indexOf('startCombat(victim, opts = {}) {');
  const swordCall = app.indexOf("this._toolActionStory('sword');");
  assert.truthy(sc > 0 && swordCall > sc && swordCall < sc + 600,
    "the 'sword' story fires as startCombat spins the melee wheel up");
  assert.falsy(ix.includes("_toolActionStory?.('sword')"),
    'and the hunt wheel stays clean of weapon slots');
  // The watering story goes AFTER waterOne — a watering that actually
  // happened, not a dry tap on an already-watered plant.
  hook('water', 'Crops.waterOne(save, p, save.relics)', 'the watering', false);
  // The chop story is the axe alone: rockfruit debris gathers free, by hand.
  assert.truthy(/if \(reqRelic === 'axe'\) scene\._toolActionStory\?\.\('chop'\);\n        scene\.startWorkProgress\(wp\.x, wp\.y, award/.test(ix),
    "the wildplant wheel hooks 'chop' only when the work needs the axe");
});

test('tool stories: the auto-fire hooks the first shot loosed, not the cadence', () => {
  const push = app.indexOf('this._shots.push(shot);');
  const call = app.indexOf("this._toolActionStory('shoot');");
  assert.truthy(push > 0 && call > push && call < push + 400,
    "the 'shoot' story fires where the arrow actually flies");
});

test('tool stories (behaviour): each action splashes once under its own ledger key', () => {
  const modals = [];
  const scene = {
    save: {},
    showMessageModal: (opts) => modals.push(opts),
    _storySplashOnce: storyMethods._storySplashOnce,
    _toolActionStory: storyMethods._toolActionStory,
  };
  const realPersist = globalThis.persistSave;
  globalThis.persistSave = () => {};
  try {
    for (const action of ['till', 'chop', 'dig', 'water', 'catch', 'sword', 'shoot']) {
      scene._toolActionStory(action);
    }
    assert.eq(modals.length, 7, 'all 7 splashes opened');
    assert.eq(scene.save.storySeen['tool:till'], 1, 'ledger key tool:till');
    assert.eq(scene.save.storySeen['tool:shoot'], 1, 'ledger key tool:shoot');
    assert.eq(modals[0].art, 'tool_till', 'till carries its banner');
    assert.eq(modals[6].art, 'tool_shoot', 'shoot carries its banner');
    // Replays are refused.
    for (const action of ['till', 'shoot']) scene._toolActionStory(action);
    assert.eq(modals.length, 7, 'a seen action never replays');
    // An unknown action is a silent no-op, not a crash.
    scene._toolActionStory('juggle');
    assert.eq(modals.length, 7, 'an unknown action tells no story');
  } finally {
    globalThis.persistSave = realPersist;
  }
});

// ── The art files exist ───────────────────────────────────────────────────
test('trap pin + tool stories: every new art stem exists as a PNG in assets/art/', () => {
  for (const stem of [...TRAP_STEMS, ...TOOL_STEMS]) {
    const dims = pngDims(`assets/art/${stem}.png`);
    assert.truthy(dims, `assets/art/${stem}.png exists and is a PNG`);
  }
});
})();
