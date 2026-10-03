// A STATUS ANNOUNCES ITSELF when it lands — on the player and on a creature.
//
// Player: _announceStatuses (app.js, every frame from _tickConditions) reads
// the two owning tables — Conditions.DEFINITIONS (a row newly active) and
// Buffs.KINDS (an expiry newly set or pushed out) — and for each landing
// calls _flashPlayerStatus: the body flicks the row's own colour for
// Combat.STATUS_FLASH_MS (the aura's `flicked` channel) and the row's word
// pops on the player's cell (_popCellNumber). No call at any writer.
// Creature: every applier (Combat.applySleep / applyCharm / applyPsychosis /
// ignite, PotionEffects.apply, the frost and fear in app.js) calls
// Combat.flagStatus with its look (Combat.STATUS_LOOKS, or the Conditions /
// Buffs row); render.js drawCreatures flicks the body and pops the word
// through _popCreatureText — the damage number's lane.
(function () {
const app = SCENE_SRC;
const T0 = 1_700_000_000_000;

test('status looks: one table of word and ink, the burn and the buffs borrowed from theirs', () => {
  for (const [id, look] of Object.entries(Combat.STATUS_LOOKS)) {
    assert.truthy(typeof look.label === 'string' && look.label.length > 0 && look.label.length <= 10, `${id}: a short word`);
    assert.truthy(/^#[0-9a-f]{6}$/.test(look.color), `${id}: an ink`);
  }
  assert.eq(Combat.STATUS_LOOKS.frozen.color, '#' + FROZEN_TINT.toString(16).padStart(6, '0'), 'frozen wears the ice the body holds');
  const burn = Combat.statusLook('burning');
  assert.eq(burn.label, Conditions.DEFINITIONS.burning.label, 'a burn is the Conditions row');
  assert.eq(burn.color, Conditions.DEFINITIONS.burning.ink);
  assert.eq(Combat.statusLook('sleep'), Combat.STATUS_LOOKS.sleep);
  assert.eq(Combat.statusLook('nothing'), null);
  assert.inRange(Combat.STATUS_FLASH_MS, 200, 800, 'a flick, not a state');
  // The marker that stays over a sleeper's or an ally's head reads the same inks.
  const c = { id: 'm', kind: 'goblin', _sleepUntil: T0 + 1, _charmUntil: 0 };
  assert.eq(Render.flowerStatusMarker(c, T0).color, Combat.STATUS_LOOKS.sleep.color);
  c._charmUntil = T0 + 1; c._sleepUntil = 0;
  assert.eq(Render.flowerStatusMarker(c, T0).color, Combat.STATUS_LOOKS.charm.color);
  assert.falsy(/'#bcdfff'|'#ff91b8'/.test(RENDER_SRC), 'render.js keeps no ink of its own for them');
});

test('status looks: flagStatus arms the flick and queues the word once', () => {
  const c = { id: 'f', kind: 'goblin' };
  assert.eq(Combat.statusFlashTint(c, 1000), null);
  assert.truthy(Combat.flagStatus(c, Combat.STATUS_LOOKS.fear, 1000));
  assert.eq(Combat.statusFlashTint(c, 1000), 0xc77dff, 'the look\'s ink as a tint');
  assert.eq(Combat.statusFlashTint(c, 1000 + Combat.STATUS_FLASH_MS - 1), 0xc77dff);
  assert.eq(Combat.statusFlashTint(c, 1000 + Combat.STATUS_FLASH_MS), null, 'and then it has passed');
  assert.eq(c._statusPop.label, 'Fear'); assert.eq(c._statusPop.color, '#c77dff'); assert.eq(c._statusPop.atT, 1000);
  assert.falsy(Combat.flagStatus(null, Combat.STATUS_LOOKS.fear));
  assert.falsy(Combat.flagStatus(c, null));
});

test('status looks: every creature applier flags its look', () => {
  const foe = () => ({ id: 'g', kind: 'goblin', x: 0, y: 0 });
  let c = foe(); Combat.applySleep(c, T0);
  assert.eq(c._statusPop?.label, 'Sleep');
  c = foe(); Combat.applyCharm(c, T0);
  assert.eq(c._statusPop?.label, 'Charm');
  c = foe(); Combat.applyPsychosis(c, 5000, 1000);
  assert.eq(c._statusPop?.label, 'Psychosis');
  // A FRESH burn says so; being re-stoked by exposure does not say it again.
  c = foe(); assert.truthy(Combat.ignite(c, 1000, 'fire'));
  assert.eq(c._statusPop?.label, Conditions.DEFINITIONS.burning.label);
  c._statusPop = null;
  assert.falsy(Combat.ignite(c, 1500, 'fire'));
  assert.eq(c._statusPop, null, 'already alight: no second word');
  // A thrown potion's buff wears the Buffs row that reads the same field.
  const scene = { save: { energy: 100, caught: [] }, cellM: 10, startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 } };
  c = foe(); assert.truthy(PotionEffects.apply(scene, c, 'speed_potion', T0));
  assert.eq(c._statusPop?.label, Buffs.KINDS.speed.name);
  assert.eq(c._statusPop?.color, Buffs.KINDS.speed.color);
  c = foe(); PotionEffects.apply(scene, c, 'giant_potion', T0);
  assert.eq(c._statusPop?.label, Buffs.KINDS.giant.name);
  c = foe(); PotionEffects.apply(scene, c, 'vigor_potion', T0);
  assert.eq(c._statusPop, undefined, 'healing is not a status');
  // The frost (the powder and the magic trap's hold) and fear in app.js.
  const frost = app.match(/\n  useFrostPowder\(\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/c\._frozenUntil = until;[\s\S]{0,200}Combat\.flagStatus\(c, Combat\.STATUS_LOOKS\.frozen\);/.test(frost), 'frost powder flags frozen');
  const trap = app.match(/\n  _tickMagicTraps\(\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/c\._frozenUntil = Math\.max\(c\._frozenUntil \|\| 0, until\);[\s\S]{0,200}Combat\.flagStatus\(c, Combat\.STATUS_LOOKS\.frozen\);/.test(trap), 'the magic trap\'s hold flags frozen');
  const fear = app.match(/\n  useFearScroll\(\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/Combat\.flagStatus\(c, Combat\.STATUS_LOOKS\.fear, now\);/.test(fear), 'fear flags fear');
});

test('status looks: drawCreatures flicks the body over every state and pops the word once, never late', () => {
  const body = RENDER_SRC.match(/    const chilled = Combat\.isChilled\(c, Date\.now\(\)\);[\s\S]*?Render\.setShine\(s, [^;]+;/);
  assert.truthy(body, 'live creature tint block exists');
  const paint = new Function('c', 's', 'performance', 'Date', 'Combat', 'Conditions',
    'FROZEN_TINT', 'SHINY_TINT', 'npcArt', 'creatureTint', 'Render', 'scene', body[0]);
  const draw = (c, now, scene) => {
    const sprite = { tint: null, setTint(t) { this.tint = t; }, setTintFill() {} };
    paint(c, sprite, { now: () => now }, { now: () => now }, Combat, Conditions,
      FROZEN_TINT, SHINY_TINT, null, () => 0x123456, { setShine() {} }, scene);
    return sprite.tint;
  };
  const pops = [];
  const scene = { _popCreatureText: (c, text, color) => pops.push({ id: c.id, text, color }) };
  const c = { id: 'ice', kind: 'goblin', _frozenUntil: 10 ** 9, shiny: true };
  Combat.flagStatus(c, Combat.STATUS_LOOKS.frozen, 1000);
  assert.eq(draw(c, 1100, scene), FROZEN_TINT, 'the flick in the status\'s ink wins over ice and sheen');
  assert.eq(pops.length, 1); assert.eq(pops[0].text, 'Chilled'); assert.eq(pops[0].color, Combat.STATUS_LOOKS.frozen.color);
  assert.eq(c._statusPop, null, 'the word is queued once');
  assert.eq(draw(c, 1200, scene), FROZEN_TINT);
  assert.eq(pops.length, 1, 'and popped once');
  assert.eq(draw(c, 1000 + Combat.STATUS_FLASH_MS, scene), FROZEN_TINT, 'the flick passes; the ice stays (the same ink here)');
  const d = { id: 'late', kind: 'goblin' };
  Combat.flagStatus(d, Combat.STATUS_LOOKS.sleep, 1000);
  assert.eq(draw(d, 5000, scene), 0x123456, 'first drawn long after it landed (off screen then)');
  assert.eq(pops.length, 1, 'a stale word is dropped, not popped late');
  assert.eq(d._statusPop, null);
  const e = { id: 'now', kind: 'goblin' };
  Combat.flagStatus(e, Combat.STATUS_LOOKS.psychosis, 2000);
  assert.eq(draw(e, 2010, scene), 0xc6ff4d);
  assert.eq(pops[1].text, 'Psychosis');
  assert.eq(draw(e, 2010, {}), 0xc6ff4d, 'a scene with no pop lane (headless) still paints');
  // The damage number is the same lane in its "-N" dress.
  assert.truthy(/\n  _popDamageNumber\(c, amount\) \{\n    return this\._popCreatureText\(c, `-\$\{amount\}`, UI_DANGER_INK\);/.test(app));
});

test('status announce: the player\'s landings are read off the two tables, first pass silent', () => {
  const body = app.match(/\n  _announceStatuses\(\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(body, '_announceStatuses exists');
  const slack = Number(app.match(/const STATUS_EXTEND_SLACK_MS = (\d+);/)[1]);
  const announce = new Function('Conditions', 'Buffs', 'STATUS_EXTEND_SLACK_MS', body[1]);
  const realNow = Date.now;
  Date.now = () => T0;
  try {
    const flashes = [];
    const scene = { save: { energy: 100 }, _flashPlayerStatus: (label, color) => flashes.push({ label, color }) };
    const run = () => announce.call(scene, Conditions, Buffs, slack);
    // Loaded with a potion running and a poison on: stock is taken, nothing announced.
    scene.save.speedPotionUntil = T0 + 30_000;
    Conditions.apply(scene.save, 'poison', T0);
    run();
    assert.eq(flashes.length, 0, 'the first pass only takes stock');
    run();
    assert.eq(flashes.length, 0, 'still running: not news');
    // A burn lands: its row's word and ink.
    Conditions.apply(scene.save, 'burning', T0);
    run();
    assert.eq(flashes.length, 1);
    assert.eq(flashes[0].label, Conditions.DEFINITIONS.burning.label);
    assert.eq(flashes[0].color, Conditions.DEFINITIONS.burning.ink);
    // A second Speed on top of the first pushes the expiry out: announced.
    scene.save.speedPotionUntil = T0 + 60_000;
    run();
    assert.eq(flashes.length, 2); assert.eq(flashes[1].label, Buffs.KINDS.speed.name); assert.eq(flashes[1].color, Buffs.KINDS.speed.color);
    // Rewritten to (near) the same deadline: not news.
    scene.save.speedPotionUntil = T0 + 60_000 + slack;
    run();
    assert.eq(flashes.length, 2);
    // A new buff — the torch, an in-memory scene timer — lands.
    scene._torchUntil = T0 + 10_000;
    run();
    assert.eq(flashes.length, 3); assert.eq(flashes[2].label, Buffs.KINDS.torch.name);
    // Expired and cured: nothing; back again later: announced again.
    scene.save.speedPotionUntil = 0; scene._torchUntil = 0;
    Conditions.cure(scene.save, 'burning');
    run();
    assert.eq(flashes.length, 3);
    Conditions.apply(scene.save, 'burning', T0);
    run();
    assert.eq(flashes.length, 4);
  } finally { Date.now = realNow; }
  // Driven from the condition tick, ahead of the status row.
  const tick = app.match(/\n  _tickConditions\(\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/this\._announceStatuses\(\);\s*\n\s*this\._syncStatusRow\(\);/.test(tick), 'every frame, before the row');
  // _applyCondition keeps no flash of its own for the word (poison keeps its lesson).
  const apply = app.match(/\n  _applyCondition\(id\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.falsy(/flashAtPlayer/.test(apply), 'the announcement is the one word');
  assert.truthy(/poisonLearned/.test(apply), 'the Antidote lesson stays');
});

test('status announce: _flashPlayerStatus flicks the body in the row\'s ink and pops the word on the player\'s cell', () => {
  const body = app.match(/\n  _flashPlayerStatus\(label, color\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(body, '_flashPlayerStatus exists');
  const flash = new Function('label', 'color', 'Combat', 'performance', 'playerReachCell', body[1]);
  const pops = [];
  const scene = { startWorldM: {}, originPx: {}, _popCellNumber: (...a) => pops.push(a) };
  flash.call(scene, 'Poison', '#d9b1ff', Combat, { now: () => 5000 }, () => ({ cellIX: 3, cellIY: 4 }));
  assert.eq(scene._statusFlashUntilT, 5000 + Combat.STATUS_FLASH_MS, 'the foe\'s flick length');
  assert.eq(scene._statusFlashTint, 0xd9b1ff);
  assert.eq(pops.length, 1);
  assert.eq(pops[0].join('|'), 'Poison|#d9b1ff|3|4', 'the word, in its ink, on the player\'s cell');
  // Before the camera exists the word still pops, at the toast's default seat.
  const bare = { _popCellNumber: (...a) => pops.push(a) };
  flash.call(bare, 'Speed', '#9fe8ff', Combat, { now: () => 5000 }, () => { throw new Error('not asked'); });
  assert.eq(pops[1][2], undefined);
  // The aura reads the flick between the hit and the states.
  const aura = app.match(/\n  _updatePlayerAura\(\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/const flicked = \(this\._statusFlashUntilT \|\| 0\) > nowMs;/.test(aura));
  assert.truthy(/\} else if \(flicked\) \{\s*\n\s*tint = this\._statusFlashTint;/.test(aura));
});
})();
