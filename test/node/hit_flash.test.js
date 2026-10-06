// The body FLINCHES when it is hit.
//
// A blow on the player (the slime's leech, a monster's melee, an arrow
// striking in _shotHitsPlayer) flicks the character red for HIT_FLASH_MS and
// buzzes the phone, at the instant it lands. It is NOT tied to the throttled
// "−N⚡" pop, which rolls a second of bites into one number. Two channels,
// because setTint is a no-op under Phaser's Canvas fallback: the sprite tint
// AND the halo's red texture, which is a plain image and reads everywhere.
// app.js can't load headlessly, so this is pinned as source text.

(function () {
// The leech, the melee and a ghost's touch land in wanderCreatures
// (scene_creatures.js); the arrow and the rest in app.js. Counted across both.
const app = SCENE_SRC;

test('hit flash: every drain on the body flinches at the instant it lands, with what it cost', () => {
  // Contact damage banks through ONE method, which flinches after the loss
  // is banked with the actual points taken, so a graze can throw a shorter
  // burst than the worst hit in the game (Particles.dmgSpeedScale).
  const lose = app.match(/\n  _losePlayerEnergy\(dmg, [^)]*\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(lose, '_losePlayerEnergy exists');
  const loss = new Function('dmg', 'options', 'const { closeShop = false } = options || {};\n' + lose[1]);
  const hits = [];
  const scene = { save: { energy: 100 }, _flashPlayerHit: n => hits.push(n),
    _warnIfTiring: () => {}, _closeShopOnHit: () => {} };
  assert.eq(loss.call(scene, 2.5), 2);
  assert.eq(loss.call(scene, 2.5), 3);
  assert.eq(scene.save.energy, 95);
  assert.eq(hits.join(','), '2,3', 'fractional incoming damage flashes exactly the banked pips');
  const sites = app.match(/this\._losePlayerEnergy\(/g) || [];
  assert.eq(sites.length, 3, 'standing on a sprung trap, standing in lava, walking through thorns or spikes (the arrow lands through foeBlowLands)');
  // Every foe's CONTACT — its melee and aura, a slime trail, a ghost's touch,
  // a hunted deer's butt, a thrown Blight — lands through the one writer in
  // creature_ai.js (foeBlowLands), which banks it through the same method.
  assert.truthy(/const lost = scene\._losePlayerEnergy\(dmg, \{ closeShop: true \}\);/.test(CREATURE_AI_SRC), 'foeBlowLands banks through it');
  assert.eq((CREATURE_AI_SRC.match(/scene\._losePlayerEnergy\(/g) || []).length, 1, 'once');
  const walking = app.match(/\n  _tickWalkHazards\(dt, x0, y0, x1, y1\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(walking && /this\._losePlayerEnergy\(pips\)/.test(walking[1]),
    'thorns and spikes use the same immediate hit flash');
  const arrow = app.match(/\n  _shotHitsPlayer\(shot\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(arrow && /foeBlowLands\(this, shot\._sourceGuard, Combat\.incomingProjectileDamage\(this\.save, shot\.damage, shot\.hits\)/.test(arrow[1]),
    'the arrow lands through the one blow writer, which banks through it');
  // …and the trap's BITE, which lands through the pain effect rather than in
  // that shape, because it carries the rim pulse and the shake with it.
  const pain = app.match(/\n  _painFlash\(dmg\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(pain && /this\._flashPlayerHit\(dmg\);/.test(pain[1]),
    'a trap springing flinches the body too — it is the biggest single hit there is');
});

test('hit flash: it is a flinch, not the throttled pop', () => {
  const m = app.match(/\n  _flashPlayerHit\(dmg\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_flashPlayerHit exists');
  assert.truthy(/this\._hitFlashUntilT = performance\.now\(\) \+ HIT_FLASH_MS;/.test(m[1]), 'arms a deadline');
  const ms = app.match(/const HIT_FLASH_MS = (\d+);/);
  assert.truthy(ms, 'HIT_FLASH_MS is a plain number');
  assert.inRange(Number(ms[1]), 80, 300, 'short: a flick, not a state');
  // Not from the throttled roll-ups.
  assert.falsy(/_popEnergy\(-drained[\s\S]{0,200}_flashPlayerHit/.test(app), 'not from the slime pop');
  assert.falsy(/_popEnergy\(-hit[\s\S]{0,200}_flashPlayerHit/.test(app), 'not from the monster pop');
});

test('hit flash: the aura shows it on BOTH channels, and it wins over the states', () => {
  const m = app.match(/\n  _updatePlayerAura\(\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_updatePlayerAura exists');
  const body = m[1];
  assert.truthy(/const hit = hitLeft > 0;/.test(body), 'reads the deadline');
  // A status on the body (the first active row of Conditions.DEFINITIONS)
  // joins the states that paint the aura; the hit still wins over all of them.
  assert.truthy(/Object\.keys\(Conditions\.DEFINITIONS\)/.test(body), 'the status tint comes off the table');
  assert.truthy(/if \(hit \|\| flicked \|\| spent \|\| far \|\| status\) \{/.test(body), 'a hit lights the aura on its own');
  assert.truthy(/if \(hit\) \{\s*\n\s*tint = HIT_FLASH_TINT;/.test(body), 'the tint channel, and it wins');
  // A status landing (_flashPlayerStatus) flicks the body in its own colour
  // — under the hit, over the empty-bar and far-from-GPS states.
  assert.truthy(/\} else if \(flicked\) \{\s*\n\s*tint = this\._statusFlashTint;\s*\n\s*\} else if \(spent\) \{/.test(body),
    'the status flick sits between the hit and the states');
  assert.truthy(/const key = \(hit \|\| spent\) \? 'halo_red' : 'halo_dark';/.test(body),
    'the halo channel — the red texture, which reads without WebGL');
  assert.truthy(/const alpha = hit \? 0\.2 \+ 0\.6 \* \(hitLeft \/ HIT_FLASH_MS\)/.test(body),
    'the halo decays over the flash');
});


})();

(function () {
// The leech, the melee and a ghost's touch land in wanderCreatures
// (scene_creatures.js); the arrow and the rest in app.js. Counted across both.
const app = SCENE_SRC;
test('hit flash: a FOE\'s blow closes an open shop dialog — a trap\'s does not', () => {
  const sites = app.match(/this\._losePlayerEnergy\([^)]*\{ closeShop: true \}\)/g) || [];
  assert.eq(sites.length, 0, 'no blow of the scene\'s own: the arrow goes through foeBlowLands like every other');
  assert.truthy(/foeBlowLands\(this, shot\._sourceGuard/.test(app), 'the arrow closes it through the one blow writer');
  assert.truthy(/scene\._losePlayerEnergy\(dmg, \{ closeShop: true \}\)/.test(CREATURE_AI_SRC),
    'and so does every contact through the one blow writer (foeBlowLands: melee, the deer, a ghost, an aura)');
  const lose = app.match(/\n  _losePlayerEnergy\(dmg, [^)]*\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(/if \(closeShop\) this\._closeShopOnHit\(\);/.test(lose[1]), 'only when the caller asks — a trap does not');
  const m = app.match(/\n  _closeShopOnHit\(\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m && /\.game-modal\[data-kind="shop"\]/.test(m[1]), 'it finds shop dialogs by kind');
  assert.truthy(/if \(typeof kind === 'string'\) wrap\.dataset\.kind = kind;/.test(SCENE_SRC), 'makeModalShell stamps the kind');
  const flash = app.match(/\n  _flashPlayerHit\(dmg\) \{([\s\S]*?)\n  \}\n/);
  assert.falsy(/_closeShopOnHit/.test(flash[1]), 'not from the shared flinch a trap also uses');
});
})();
