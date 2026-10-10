// NOTHING HUNTS A BODY.
//
// At zero energy the player has collapsed: coords.js's reachRadiusM returns 0
// (no cell is tappable, nothing can be swung at), and all three places a foe
// reaches the player — the surface slime's leech, a cave monster's melee, a
// goblin archer's arrow — already refuse to take a point off an empty bar. A
// hostile that keeps stalking one is therefore chasing a body it is forbidden
// to bite: it parks on the wreck and, on hard mode (where nothing but Home
// lifts the bar off zero), escorts the player the whole way home.
//
// So a downed player is NOT THERE to be hunted, exactly as a Shadow Powder
// makes them. `Combat.playerDowned` is the one expression, and it is read on
// BOTH sides — the gate that drops the pursuit and the guard that refuses the
// damage — so a foe can never be chasing a player it cannot hurt. In
// wanderCreatures the wards are ORed per creature into `unnoticed`, and
// every hostile-interest branch reads that rather than `shadowed` alone: the
// leech, the monster's hit and arrow, the struck slime's charge, and both
// stalk branches, each falling back to the aimless wander.
//
// combat.js loads headlessly so the predicate runs for real; wanderCreatures
// needs Phaser, so its wiring is pinned as source text the way
// home_ward.test.js pins the Home ward — wanderCreatures is the SceneCreatures
// mixin's (scene_creatures.js), the rest app.js's, so both.

(function () {
const app = SCENE_SRC;

// The method body: an inner brace is indented deeper than two spaces, so the
// first "\n  }\n" after the header closes the method (the zero_energy_lockout
// slice, same trick).
function methodBody(name) {
  const a = app.indexOf(`  ${name}(`);
  assert.truthy(a > 0, `found ${name} in app.js / scene_creatures.js`);
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(b > a, `found the end of ${name}`);
  return app.slice(a, b);
}
// Source with every comment line dropped — what the code actually reads.
const codeOnly = (src) => src.split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n');

test('downed: an empty bar is down, and so is a bar that is not a number', () => {
  assert.truthy(Combat.playerDowned(0), 'zero energy is down');
  assert.truthy(Combat.playerDowned(-1), 'and nothing below it is up again');
  assert.truthy(Combat.playerDowned(undefined), 'a missing bar reads as down');
  assert.truthy(Combat.playerDowned(NaN), 'so does a NaN bar — the `> 0` guards it replaces did too');
  assert.falsy(Combat.playerDowned(1), 'one point of energy is still standing');
  assert.falsy(Combat.playerDowned(0.5), 'and so is half of one');
});

test('downed: isUnnoticed preserves safety wards alongside each monster’s Moss awareness', () => {
  // The OR lives on the SCENE, not in the sim loop, because the picture reads
  // it too: _updatePlayerAura fades the body on the same expression (see the
  // ghost test below). One state, two reasons, both sides.
  const pred = methodBody('isUnnoticed');
  assert.truthy(
    /return this\.isShadowActive\(\) \|\| moss \|\| Combat\.playerDowned\(this\.save\.energy\) \|\| this\.isTooFast\(\);/.test(pred),
    'the Shadow Powder ward ORed with the downed test, off the LIVE bar, and the passenger gate (a third reason, one lane)');
  const body = methodBody('wanderCreatures');
  assert.truthy(/const unnoticed = this\.isUnnoticed\(c\);/.test(body),
    'wanderCreatures reads the awareness of each creature');
});

test('downed: every hostile-interest branch reads `unnoticed`, never `shadowed`', () => {
  const code = codeOnly(methodBody('wanderCreatures'));
  // The sim loop no longer names `shadowed` at all — it holds only the ORed
  // state. Any branch reading the powder alone is one the collapse ward would
  // silently miss, so re-introducing the name here is the bug.
  assert.eq((code.match(/shadowed/g) || []).length, 0,
    'the Shadow Powder is never read on its own inside the sim loop');
  // The branches, by the expression each is gated on. `standDown` joins
  // `unnoticed` (Home's ward, or a garrison that is not hunting you): same
  // lane, one more reason.
  const gates = [
    [/rosterEnemyAttack\(this, c, rosterRow, now, px, py, unnoticed \|\| standDown, enemyDt\)/, "every roster foe's blow, arrow and snare"],
    [/\(npcTarget \? NPC\.isDormant\(npcTarget\) : unnoticed\) \|\| standDown,\s*routed \|\| \(kerbTurn && !c\.lair\), lairState, enemyDt\)/, "every roster foe's stalk"],
    [/\(npcTarget \? NPC\.isDormant\(npcTarget\) : unnoticed\) \|\| kerbTurn, warded, pace\)/, "the ghost's rush"],
  ];
  for (const [re, what] of gates) {
    assert.truthy(re.test(code), `${what} is gated on unnoticed`);
  }
  // The roster mover and attack read the foe's own sight through the one
  // helper (Combat.seesPlayer) beside `inactive` — never a lane of their own.
  assert.truthy(/const attentive = !inactive && \(creatureTarget \|\| npcTarget \|\| !Combat\.playerDowned\(scene\.save\.energy\)\)\s*&& inTerritory && \(creatureTarget \|\| npcTarget \|\| Combat\.seesPlayer\(c\.kind, dist, scene\.cellM, scene\.save\)\);/.test(CREATURE_AI_SRC),
    'the attack is attentive only to a player it can see and who is not down');
  assert.truthy(/let sees = !inactive && \(creatureTarget\s*\? dist <= Combat\.sightCells\(c\.kind\) \* scene\.cellM\s*: Combat\.seesPlayer\(c\.kind, dist, scene\.cellM, scene\.save\)\);/.test(CREATURE_AI_SRC),
    'and the mover stalks only what it sees');
});

test('downed: the body FADES on the same expression the hunt drops', () => {
  // A ghost is exactly as unhuntable as it looks: the fade may not be a
  // second, looser test, or the picture would promise a stealth the AI is not
  // honouring (and a `_stealthed` flag beside it would be the duplication the
  // whole `unnoticed` lane exists to avoid).
  const aura = methodBody('_updatePlayerAura');
  assert.truthy(/const ghost = this\.isUnnoticed\(\) \? UNNOTICED_ALPHA : 1;/.test(aura),
    'the aura asks isUnnoticed, never isShadowActive or the bar');
  assert.truthy(/this\.player\.setAlpha\(ghost\);/.test(aura), 'the body fades');
  assert.truthy(/this\.playerShadow\?\.setAlpha\(/.test(aura),
    'and its contact shadow fades with it');
  const a = app.match(/const UNNOTICED_ALPHA = ([\d.]+);/);
  assert.truthy(a, 'UNNOTICED_ALPHA is a plain number');
  assert.inRange(Number(a[1]), 0.25, 0.6,
    'ghostly, but still steerable — you walk home in this on hard mode');
  // ALPHA, not tint: the empty-tank red and the far-from-GPS dim own the tint
  // channel and are warnings the player still needs while down.
  assert.falsy(/UNNOTICED_ALPHA[\s\S]{0,80}setTint/.test(app), 'the fade never touches the tint');
});

test('downed: the body LIES DOWN, a quarter turn onto its front', () => {
  // The fade says "less there"; the pose says "not standing". A body that is
  // upright in the picture while the reach is 0, no foe takes an interest and
  // no trap springs under it is the picture lying about the state.
  assert.truthy(/const PLAYER_DOWNED_ROTATION = Math\.PI \/ 2;/.test(app),
    'the collapse turn is a named constant, and exactly a quarter turn');
  assert.truthy(/\.setRotation\(this\.playerBodyRotation\(\)\)/.test(app),
    'the sprite is turned by the accessor, never by a literal at the call site');
});

test('downed: the collapse seats the body\'s MIDSECTION where its feet were', () => {
  // Standing, the sprite's centre rides playerFeetNudgeY above the fix so the
  // visible FEET land on it (feet_anchor.test.js). Lying down, the midsection
  // is on that point instead — which is a drop of exactly the nudge it stood
  // up by, so the pose needs no second constant to seat it.
  const dy = methodBody('playerBodyDy');
  const bodyDy = new Function('Combat', `return { ${dy}\n} };`)(Combat).playerBodyDy;
  const pose = { save: { energy: 100 }, playerFeetNudgeY: -9, _obstacleStep: { liftPx: 8 } };
  assert.eq(bodyDy.call(pose), -17, 'standing body rides the support');
  pose.save.energy = 0;
  assert.eq(bodyDy.call(pose), 0, 'collapsed body stays on the ground even on an obstacle');
  const rot = methodBody('playerBodyRotation');
  assert.truthy(/Combat\.playerDowned\(this\.save\.energy\)/.test(rot),
    'the turn reads the same predicate as the seat, so the two cannot disagree');
});

test('downed: everything hung on the body\'s centre goes down WITH it', () => {
  // The nudge is the STANDING answer to "where is the body's centre?" — so
  // anything that keeps reading it directly stays a body-length up in the air
  // over the collapsed sprite. The empty-tank halo is the sharpest case: it is
  // the warning that shows precisely while the player is down.
  const aura = methodBody('_updatePlayerAura');
  assert.truthy(/this\.playerHalo[\s\S]{0,200}setPosition\(ps\.x, ps\.y \+ this\.playerBodyDy\(\)\)/.test(aura),
    'the halo sits on the body centre through the accessor');
  assert.falsy(/playerFeetNudgeY/.test(aura), 'and never on the standing nudge');
  // In update() the same answer is taken ONCE into a local and shared by the
  // sprite and every label over its head. (update() is far too long for
  // methodBody's brace trick, so this is the span from the projection down to
  // the footprint trail — the sprite seat, the three powder countdowns and the
  // facing arrow, i.e. everything in the frame measured off the body centre.)
  const upd = (() => {
    const a = app.indexOf('    const pScreen = this.playerScreen();');
    const b = app.indexOf('// Footprint trail.', a);
    assert.truthy(a > 0 && b > a, 'found the body-placement span of update()');
    return app.slice(a, b);
  })();
  assert.truthy(/const bodyDy = this\.playerBodyDy\(\);/.test(upd), 'read once per frame');
  assert.truthy(/this\.player\?\.setPosition\(pScreen\.x, pScreen\.y \+ bodyDy\)/.test(upd),
    'the sprite is seated on it');
  assert.falsy(/pScreen\.y \+ this\.playerFeetNudgeY/.test(upd),
    'no label, arrow or sprite in update() is left on the standing nudge');
});

test('downed: pursuit and incoming damage agree on whether the player is down', () => {
  const wander = methodBody('wanderCreatures');
  // Every foe's blow is rosterEnemyAttack's (creature_ai.js): its melee lane
  // and its aura both pass the shared incoming-damage guard; the deer's butt
  // in the sim loop does too.
  const attack = CREATURE_AI_SRC.slice(CREATURE_AI_SRC.indexOf('function rosterEnemyAttack('),
    CREATURE_AI_SRC.indexOf('\n}\n', CREATURE_AI_SRC.indexOf('function rosterEnemyAttack(')));
  assert.truthy(/foeBlowLands\(scene, c, raw, \{ condition: /.test(attack)
    && /const dmg = mitigated \? raw : Combat\.incomingDamage\(scene\.save, raw\);/.test(CREATURE_AI_SRC),
    "the foe's melee uses the shared incoming damage guard (through the one blow writer)");
  assert.truthy(/Combat\.playerDamageRate\(/.test(attack), 'and so does the aura');
  const arrow = methodBody('_shotHitsPlayer');
  assert.truthy(/Combat\.incomingProjectileDamage\(this\.save, shot\.damage/.test(arrow),
    'an arrow already in flight uses the same damage guard');
  for (const energy of [undefined, NaN, -1, 0, 1, 100]) {
    assert.eq(Combat.incomingDamage({ energy }, 10) === 0, Combat.playerDowned(energy),
      'damage and pursuit agree, including missing or corrupt energy');
  }
});
})();
