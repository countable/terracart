# Combat, energy and Home

Detail doc for damage, energy, timed effects, pets and Home. The root
`CLAUDE.md` owns the overview; read this before changing combat or survival
mechanics.

## Combat, energy and Home

- Confusing mushroom gas refreshes the shared `confused` condition to five
  seconds on contact, preserving any longer confusion already active. Gas
  spreads to cardinal neighbours once per foreground second; rock, masonry and
  intact stronghold walls block it. Thin gas disappears only when its connected
  region reaches open terrain beyond the loaded area; sealed rooms conserve it.
  Unloaded cells retain their share, and inconclusive bounded enclosure searches
  preserve gas. Fields and emitter cooldowns are session-local, separated by
  depth and paused while that depth is inactive.

- Spiders use the roster's `web` attack from two to four cells away, after a visible
  wind-up, aimed at the cell occupied when aiming began. The silk travels to
  that fixed cell, then spreads over it. Coming closer than two cells cancels
  a pending shot. It replaces their bite and poison.
- `SpiderWebs` owns the silk flight, cell contact and 24-hour ground lifetime.
  Flight advances by at most 100 ms per frame, preserving its dodge window
  after a stall; saved ground webs still expire in wall time.
  Entering a web paralyzes any body (player, enemy, pet or neighbour) for six
  seconds through the shared paralysis status. Standing there does not refresh
  the hold; leaving and entering again does. Webs are not consumed by contact.

- Timed followers use `Companions.KINDS` and its shared lifecycle; register
  movement/targeting in `SpriteLayout.CREATURE_BEHAVIOUR` and reuse the pet
  combat lane. Persist contract expiry and any durable health state, not live
  map instances. Test reload, tile replacement and expiry when adding a kind.
- `combat.js` owns foe HP for melee, projectiles and pets. Damage derives from
  `TOOL_DURATION_MS`; tune that or monster HP, not an extra combat multiplier.
  Game animals (crow/deer) are not enemies or projectile targets; released
  slime pets are never targets.
- Route incoming damage through `Combat.playerDamage` and armour mitigation,
  including per-hit arrow bundles. A shield potion halves the raw blow before
  armour; difficulty multiplies the mitigated blow after armour. Armour reduces
  blows rather than increasing maximum energy.
- `Energy.set` is the only runtime energy writer (current-save normalization is exempt).
  Accumulate fractional per-frame gains/losses before banking whole pips.
- A TIMED CONSUMABLE is a `CONSUMABLE_SPEC` row with `buff` (its `Buffs.KINDS`
  row) and `used` (its dialog): app.js `_useTimedBuff` is its one user,
  `Buffs.extend` its one writer (a second dose is banked on the first's end,
  never reset or refused), `TIMED_BUFF_HOOKS` its only side effects. A tome is
  the row's `tome` column (`_readTome`); an "every foe in sight" spell is a
  `CAST_ROWS` row (`_castOnFoes`); the slot guard is `_selectedConsumable`,
  the spend `_spendScroll` / `_consumeSelected`. Never a hand-written handler.
- Potion of Flight lasts one minute, timed by the Flight buff. `Conditions.flying`
  skips harmful floor contact (including holes, flames and traps), while gases,
  attacks and existing conditions still affect the flyer. A second dose adds a minute.
- Hostile interest checks use `unnoticed` (shadowed or downed); stalking adds
  sight range through `unseen`. Traps check `Combat.playerDowned` directly:
  concealment does not stop them. Downed players have no reach and are not hunted.
- A status effect is a row of `Conditions.DEFINITIONS` (poison, burning, a trap's pin): the
  player's condition, a foe's (`Combat.ignite` / `burnTick` read the same row),
  the HUD chip and the body tint all derive from it. A new status is a row
  there, never a timer, colour or label of its own.
- Confusion chooses a random compass heading and turn direction, then forces
  circular wandering along that rotating heading. Collision, holds and speed
  caps still apply. Device headings keep sampling privately; expiry or cure
  restores the latest real heading (or the prior movement fallback) and eases
  the body back toward its GPS target. Enemy puffs retain their normal duration;
  confusing gas supplies a five-second override to the same condition.
  Mushroom monsters only start and complete a puff shot when the target is at
  least one cell away. Closing that gap cancels the wind-up; their weak melee
  against an already confused target keeps its own close-range rule.
- Melee strikes resolve individually in the combat tick, using the shared scene
  cooldown and a fresh reach/allegiance check each time. They never enter the
  work queue or hold movement. Ordinary work retains priority over auto-melee.
- Death cancels current work without completion or refund, clears the swing and
  staff charge, and blocks new melee and ranged attacks. Revival does not resume
  the cancelled job. Already launched projectiles continue their flight.
- Eating a raw mushroom applies three seconds of confusion through the shared
  condition, preserving any longer confusion already active.
- Job costs use `spendEnergy`; passive restoration pauses while `working`
  (work wheel or rest hold). Walking drains and enemy blows are not jobs.
- `Pets` owns individual pet records in `save.released` (`pet: true`), including
  carried animals. Favourite feeding prepares one wild animal; catching it
  completes the bond. Only one pet per species, including baby/shiny variants.
  Use `Pets.carry/deploy/release`, never inventory stacks or id prefixes, for
  ownership. Stats, tint, accessories, growth and recovery stay on that record.
  Pet shops sell accessories. Eggs hatch wild babies that use the same gate.
- Home light, rest and ward share `HOME_R` and surface-only `homeWorldPos()`;
  campfires use `FIRE_REST_R`. Home wards steer enemies away from Home and suppress bites.
  Do not merge this with campfires' refused-target-cell ward, which would trap
  enemies inside Home's ring.

Tests: `combat`, `armor`, `energy_int`, `downed_pursuit`, `rest_work`, `home_ward`,
`pet_pickup`.
