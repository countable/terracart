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
// wanderCreatures the two wards are ORed once per tick into `unnoticed`, and
// every hostile-interest branch reads that rather than `shadowed` alone: the
// leech, the monster's hit and arrow, the struck slime's charge, and both
// stalk branches, each falling back to the aimless wander.
//
// combat.js loads headlessly so the predicate runs for real; wanderCreatures
// needs Phaser, so its wiring is pinned as source text (APP_JS_SRC) the way
// home_ward.test.js pins the Home ward.

(function () {
const app = APP_JS_SRC;

// The method body: an inner brace is indented deeper than two spaces, so the
// first "\n  }\n" after the header closes the method (the zero_energy_lockout
// slice, same trick).
function methodBody(name) {
  const a = app.indexOf(`  ${name}(`);
  assert.truthy(a > 0, `found ${name} in app.js`);
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

test('downed: isUnnoticed ORs the two wards, and wanderCreatures reads it once per tick', () => {
  // The OR lives on the SCENE, not in the sim loop, because the picture reads
  // it too: _updatePlayerAura fades the body on the same expression (see the
  // ghost test below). One state, two reasons, both sides.
  const pred = methodBody('isUnnoticed');
  assert.truthy(
    /return this\.isShadowActive\(\) \|\| Combat\.playerDowned\(this\.save\.energy\);/.test(pred),
    'the Shadow Powder ward ORed with the downed test, off the LIVE bar');
  const body = methodBody('wanderCreatures');
  assert.truthy(/const unnoticed = this\.isUnnoticed\(\);/.test(body),
    'wanderCreatures reads it once per tick, not per creature');
});

test('downed: every hostile-interest branch reads `unnoticed`, never `shadowed`', () => {
  const code = codeOnly(methodBody('wanderCreatures'));
  // The sim loop no longer names `shadowed` at all — it holds only the ORed
  // state. Any branch reading the powder alone is one the collapse ward would
  // silently miss, so re-introducing the name here is the bug.
  assert.eq((code.match(/shadowed/g) || []).length, 0,
    'the Shadow Powder is never read on its own inside the sim loop');
  // The five branches, by the expression each is gated on.
  const gates = [
    // The `!homeWard` half of these three became `!standDown` when the lair
    // guards learned to give up and walk home: same lane, one more reason
    // (Home's ward, or a garrison that is not hunting you).
    [/c\.kind === 'slime' && !isTame && !unnoticed && !standDown/, 'the slime leech'],
    [/isMonster\(c\.kind\) && !unnoticed && !standDown/, "the monster's hit and arrow"],
    [/const charging = !isTame && !standDown && !unnoticed && slimeCharging\(c\)/,
     "the struck slime's charge"],
    [/!unnoticed && Math\.random\(\) < 0\.5 && distToPlayer/, "the slime's meander"],
    [/if \(!unnoticed && distToPlayer > 0\.5 \* this\.cellM\)/, "the monsters' stalk"],
  ];
  for (const [re, what] of gates) {
    assert.truthy(re.test(code), `${what} is gated on unnoticed`);
  }
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
  assert.truthy(
    /return Combat\.playerDowned\(this\.save\.energy\) \? 0 : this\.playerFeetNudgeY;/.test(dy),
    'one expression: 0 while down, the standing nudge otherwise');
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

test('downed: the pursuit gate and the damage guard are the SAME expression', () => {
  // Three places a foe reaches the player; each guards with the predicate the
  // pursuit gate is built from, so "cannot be hurt" and "is not hunted" can
  // never drift apart into a foe chasing someone it may not bite.
  const wander = methodBody('wanderCreatures');
  const leech = wander.indexOf("c._nextStealT = now + 1000;");
  const melee = wander.indexOf('c._nextStealT = now + MONSTER_HIT_MS;');
  assert.truthy(leech > 0 && melee > 0, 'found both melee cooldown stamps');
  for (const [at, what] of [[leech, "the slime's leech"], [melee, "the monster's melee"]]) {
    assert.truthy(/if \(!Combat\.playerDowned\(before\)\) \{/.test(wander.slice(at, at + 220)),
      `${what} refuses a downed player through Combat.playerDowned`);
  }
  const arrow = methodBody('_shotHitsPlayer');
  assert.truthy(/if \(Combat\.playerDowned\(before\) \|\| !\(shot\.damage > 0\)\) return false;/.test(arrow),
    "an arrow already in flight lands for nothing on a downed player");
});
})();
