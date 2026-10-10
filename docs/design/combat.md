# Combat, energy and Home

Detail doc for damage, energy, timed effects, pets and Home. The root
`CLAUDE.md` owns the overview; read this before changing combat or survival
mechanics.

## Combat, energy and Home

- A Residential Thief uses the roster's `hitAndRun` contract: after a landed
  player blow, take up to the configured coin amount through the normal purse
  writer, toast the amount actually taken, and record the generated enemy ID
  in `save.enemyRaids`. It flees thereafter, including after reloads. An empty
  purse still spends the one hit; a warded, downed or fully prevented blow
  does not. The ordinary damage/armour path remains the only damage writer.

- Giant reapers belong exclusively to the awakened Old Stones temple challenge,
  never ambient churchyard or building encounters. Visiting the awakened temple
  opens a seven-cell marble platform on floor +1 and pauses the surface. Its
  reaper uses the shared roster's health, damage and attack interval; player
  attacks use equipped gear and incoming damage uses armour mitigation.
  The floor ends at the platform edge. Walking beyond it returns to the surface
  without a reward; entering again starts a fresh trial. Grove temple platforms
  share this fall behavior. Awakening remains permanent and winning grants the
  temple gift only once, even after re-entry or reload.

- Confusing mushroom gas refreshes the shared `confused` condition to five
  seconds on contact, preserving any longer confusion already active. A single
  outdoor puff carries 0.3 mass: natural diffusion and the thin-gas threshold
  limit it to the source and four neighbours, dissipating in about five seconds
  (at most about ten seconds of confusion from that puff). Overlapping or repeated
  puffs can extend exposure; sources can puff again after eight seconds. Gas
  spreads to cardinal neighbours once per foreground second; rock, masonry and
  intact stronghold walls block it. Thin gas disappears only when its connected
  region reaches open terrain beyond the loaded area; sealed rooms conserve it.
  Unloaded cells retain their share, and inconclusive bounded enclosure searches
  preserve gas. Fields and emitter cooldowns are session-local, separated by
  depth and paused while that depth is inactive.

- Mushroom Grove residents are provoked-only (`EnemyHabitats.PROVOKED_ONLY`):
  until provoked they count among `standDown` in `wanderCreatures` — no chase,
  puff or blow, at the player or a neighbour. A player-side or peer blow
  provokes the one struck; picking or starting to chop one of the grove's own
  mushrooms provokes every resident seated in that same zone anchor. The flag
  is session state, so a reload calms the grove. Cave mushrooms stay hostile.

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
- An elite has a rank, a row of `Combat.ELITE_RANKS`: a plain elite (2×
  HP and damage, 1.5× pace, white circle), possessed (3×, 1.4× an elite's
  pace, red) and ascendant (4×, blue, summons a plain copy of its basic form
  every 5 s into fixed slots through the shared `enemySummon`, replacing the
  row's own support ability); possessed and ascendant are each 5% of
  elites. The rank is rolled off the creature's id when
  `WorldGen.makeCreature` makes a shiny foe, so every player meets the same
  one; bounty follows `powerMul`. Possessed and ascendant bend the space
  around them (rendering.md). A new rank is a row, never a branch
  (`test/node/elite_ranks.test.js`).
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
  `RoadSafety.DRAIN_PER_SECOND` drains a surface player whose feet remain in
  the night-time MD/LG kerb buffer. `RoadSafety.drainPips` drops a partial pip
  on exit; app.js spends each whole pip through `_losePlayerEnergy` and the
  shared drain roll-up.
- A TIMED CONSUMABLE is a `CONSUMABLE_SPEC` row with `buff` (its `Buffs.KINDS`
  row) and `used` (its dialog): app.js `_useTimedBuff` is its one user,
  `Buffs.extend` its one writer (a second dose is banked on the first's end,
  never reset or refused), `TIMED_BUFF_HOOKS` its only side effects. A tome is
  the row's `tome` column (`_readTome`); an "every foe in sight" spell is a
  `CAST_ROWS` row (`_castOnFoes`); the slot guard is `_selectedConsumable`,
  the spend `_spendScroll` / `_consumeSelected`. Never a hand-written handler.
- KNOCKBACK has one owner, `Whirlwinds.impulse` / `pushStep`: a whirlwind's
  contact (grassy ground only, surface only) and the T1 Scroll of Wind
  (`CAST_ROWS.wind_scroll`: every foe in reach takes 5 and is blown
  `pushCells` away on any ground the enemy gate allows, at any depth). A push
  plays out at the depth it began on; a level change cancels it.
- SPELL SLOTS: each tome rests on its own `cooldownMs` (`save.tomeMagicCd`;
  `TOME_COOLDOWN_MS`, one hour, unless its row names another), and a tome may
  be read while at most the worn amulet's tier of tomes rest (`Gear.spellSlots`
  = 1 + tier). `_tomeWait` is the one gate; nowhere waives it, Home included.
  The amulet is forged like the staff: its tier's gem (`gemForTier`) × tier,
  plus one bar.
- Potion of Flight lasts one minute, timed by the Flight buff. `Conditions.flying`
  skips harmful floor contact (including holes, flames and traps), while gases,
  attacks and existing conditions still affect the flyer. A second dose adds a minute.
  Naturally flying enemies carry `permanentBuffs: ['flight']` on their roster row.
  `SpriteLayout.creatureAirborne` inherits that flag for variants and summoned
  wraiths and includes airborne fauna; the same `Conditions.flying` gate covers
  them without saving an infinite potion expiry or showing an infinite countdown.
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
  the body back toward its GPS target at walking pace for at most
  `CONFUSED_RECOVER_MS`; then ordinary following (catch-up ramp, far snap)
  resumes, since walking pace never catches a walking player. Enemy puffs retain their normal duration;
  confusing gas supplies a five-second override to the same condition.
  Mushroom monsters only start and complete a puff shot when the target is at
  least one cell away. Closing that gap cancels the wind-up; their weak melee
  against an already confused target keeps its own close-range rule.
- Melee strikes resolve individually in the combat tick, using the shared scene
  cooldown and a fresh reach/allegiance check each time. They never enter the
  work queue or hold movement. Ordinary work retains priority over auto-melee.
  A live hostile in melee reach pauses automatic fire from the selected ranged
  weapon throughout close combat, including between swings. Close attacks use
  the selected melee weapon, or an owned sword/bare hands while a ranged weapon
  stays selected. Ranged fire resumes when melee reach clears; paused fire spends
  no ammunition or energy, and already launched shots keep flying.
- Death cancels current work without completion or refund, clears the swing and
  staff charge, and blocks new melee and ranged attacks. Revival does not resume
  the cancelled job. Already launched projectiles continue their flight.
- Eating a raw mushroom applies three seconds of confusion through the shared
  condition, preserving any longer confusion already active.
- Job costs use `spendEnergy`; passive restoration pauses while `working`
  (work wheel or rest hold). Walking drains and enemy blows are not jobs.
- `Pets` owns individual pet records in `save.released` (`pet: true`), including
  carried animals. Every animal and enemy has a FAVOURITE (`favouriteItems`,
  items.js: an animal's `ANIMAL_FOOD`, else an enemy's roster-tier gem from
  `GEM_DEPOSITS`, never typed per row); the Potion of Taming (T7, loot only;
  thrown, a minute of charm) is every one's favourite too
  (`UNIVERSAL_FAVOURITE`, read in `animalLikesFood`). The Sugar Potion (T2,
  two berries at Home) is the cheap half: offered, thrown or set out, it lands
  the `calm` status (`Combat.calm`, animals only) and the animal does not
  bolt, flee a blow or run from the net while it holds. Giving a wild one its favourite starts
  a catch attempt (`Pets.catchMs`: current HP × 2 at the net's tool rate)
  while it flees for the edge of reach; no attack runs and it is no one's
  enemy until the attempt ends. A refused item is never consumed. Story foes
  are not catchable (`Pets.catchable`). Only one pet per species, including
  baby/shiny variants. Hunting game (deer, crows) with an empty hand is apart.
  Use `Pets.carry/deploy/release`, never inventory stacks or id prefixes, for
  ownership. Stats, tint, accessories, growth and recovery stay on that record.
  Pet shops sell accessories. Eggs hatch wild babies that use the same gate.
  Feeding a shiny chicken yields a separate Shiny Egg stack. After 500 m of
  real GPS walking, it hatches a non-shiny green dragon baby; its favourite
  food is meat. Regular eggs still hatch shiny domestic babies. Each egg type
  incubates one egg at a time, with independent saved distance and GPS sessions;
  hatching or losing one type never spends the other's progress.
- Home light, rest and ward share `HOME_R` and surface-only `homeWorldPos()`;
  campfires use `FIRE_REST_R`. Home wards steer enemies away from Home and suppress bites.
  Do not merge this with campfires' refused-target-cell ward, which would trap
  enemies inside Home's ring.

Tests: `combat`, `armor`, `energy_int`, `downed_pursuit`, `rest_work`, `home_ward`,
`pet_pickup`.

## Boss encounters

- Every boss fight is one routine: a row of `BossEncounters.KINDS`
  (`src/boss_encounters.js`) — today the citadel's garrison and the serpent a
  Serpent Idol raises. A trigger starts a record (`start`, kept in the kind's
  `store` on the save); it is live for the row's `durationMs` of wall time.
- It RESETS — the foes despawn, their defeats are forgotten, and the trigger
  can be used again later — when its clock runs out, or when the player who
  started it (`own`) goes down or leaves its floor (`abandon`). A battle
  adopted from another player (multiplayer) is not theirs to end. The scene
  side is `_tickBossEncounters` (`src/scene_boss.js`), every frame; each live
  fight shows its clock as a status-row chip.
- WINNING spends the trigger for good: a citadel is claimed; the idol is
  consumed and leaves a T4 boss chest (`chestThemeFor` → the `boss` theme:
  equipment or a unique relic), kept as `save.bossChests` until opened.
- THE SERPENT: one creature per piece (`serpent_head` / `_body` / `_tail`
  roster rows, `boss: 'serpent'`), moved and biting only by its encounter's
  tick, never `rosterEnemyMove`. The head snakes about the player within the
  row's `leashCells`; the coils and tail tip follow its trail. Each coil
  touching the player bites for the row's `dmg` once a `damageIntervalSeconds`
  through `foeBlowLands`. Only coils can be struck (the head and tail are
  `untargetable`, read by `Combat.isConcealed`); a slain coil shortens it, and
  with only head and tail left it dies. Body and gait numbers are the
  `KINDS.serpent` row. The Serpent Idol is the road ladder's fourth prize, alone
  (`Trail.FIXED_PRIZES`), `progressionOnly` (no loot pool or sale), and cannot
  be raised on the Major-and-Medium road group's kerb or junctions.
- SHARED: once one player starts a boss fight, every nearby player is in it.
  A citadel battle travels as `battle` frames (below). A serpent's starter
  drives its head and sends the pose as `boss` frames every `feedMs`; a
  nearby player adopts the fight (`_adoptSerpent`: same key, start and piece
  ids, `own: false`) and their copy follows the feed, while its coils, trail
  and bites run on their device. The coils are shared enemies only while a
  save holds the fight live (`EnemySpawns.isSharedId`), so hits and kills land
  on every copy. Every player who sees it die gets their own hoard; only the
  starter's idol is spent. When the feed has been silent for `staleMs` (the
  starter won, reset or walked away) the adopted copy resets.

Tests: `boss_encounters`, `castle_quest_flow`, `lairs`, `trail`, server `test.js`.

## Shared enemies (multiplayer)

- Nearby players fight the same enemies: `src/multiplayer.js` sends this
  client's own-side damage (`Combat.isSharedHit`: player, pet, charmed ally,
  the player's claimed turrets) as a fraction of the foe's max HP. With an
  upgraded relay, one nearby client publishes environmental and enemy-on-enemy
  damage too; other copies gate those replicated blows before HP or combat
  side effects. Own-side hits remain independent on every client. Kills carry
  an authoritative `k: 1`. Each client still runs its own enemy AI.
  World-derived enemies use `enemyMovementRandom`
  for movement decisions: enemy ID plus independent named decision counters
  seed idle headings, avoidance, roadside jitter, retreat, psychosis, bat
  flights and burrowing. Unrelated RNG calls and other creatures cannot alter
  those choices. Counters advance at the existing decision points and restart
  when a creature is recreated; different targets, terrain, simulation timing
  or frozen intervals can still diverge. Private creatures retain their RNG.
  The wire protocol lives atop `server/index.js`.
- Event-driven synchronization is negotiated with `enemySync: 1` in hello,
  welcome and peer presence. The lowest eligible capable relay ID in the
  enemy's simulation range publishes its state; castle candidates must share
  the battle. A publisher's hit includes position, HP, target and movement
  state. A hit from another client queues a publisher reply. Existing `seen`
  requests obtain live snapshots as well as deaths, including after joining,
  reconnecting/resuming and loading a tile. There is no added position
  heartbeat. The repeated seen scan also repairs missed replies.
- Upgraded hits carry a page-session origin and cumulative normalized damage
  total, scoped to depth, enemy ID and castle battle generation. Receivers
  apply only unseen damage, so retries and reordering do not multiply blows.
  Snapshot vectors preserve damage not yet observed by the publisher, including
  simultaneous local strikes. Unacknowledged own evidence retries with bounded
  pacing; ledgers survive reconnect and ordinary tile recreation. HP and
  position snapshots require the current publisher, life and a newer sequence;
  they cannot resurrect a defeated enemy. Peer kills still use the ordinary
  defeat path and assist rules.
- Positions and movement endpoints use absolute world pixels; movement timers
  use relative durations. Snapshots include deterministic decision counters,
  hop timing, bat flight, lunge and burrow phases. Errors within 0.1 cell are
  tolerated; larger corrections blend over 400 ms, with errors above three
  cells corrected at once when the destination is safe. Local loaded-terrain
  and creature movement checks can refuse a correction. Corrections do not
  create traversed-path damage or traps.
- `damage` carries cumulative retries and world blows so legacy clients do
  not apply those as repeated own-side deltas. A relay without the capability
  retains the previous own-side-only protocol. Full synchronization requires
  upgraded clients and relay. Evidence, pending replies and snapshots are
  bounded; an oversized complete damage vector suppresses the snapshot rather
  than sending a partial vector that could double-count damage. See the client
  constants and relay cleaners for wire limits.
- A received hit is source `Combat.PEER_SOURCE`: it goes through
  `_damageEnemy` with `exact` damage (no armour or potion shield twice), shows
  its number, never splits a slime and is never sent on. A peer's kill goes
  through `resolveDefeat`, which marks it in `save.caught` and pays nothing,
  unless this client's own side hit it within `Multiplayer.ASSIST_MS`
  (`Multiplayer.assisted`): an assist spawns the kill's loot here too (coin,
  drop, elite or treasure roll) but no ledger credit — `KILL_LEDGERS` hear
  only of own kills, so `Macros.slainByPlayer` stays false.
- Only world-shared creatures take part (`EnemySpawns.isSharedId`): a positive
  mark stamped where world-derived creatures are made. Clock-, random- or
  serial-minted creatures (ghosts, fished slimes, pest deer, guild foes, dev
  spawns and story encounters) stay local. Splitting species stay local in
  full, including the original body, which represents just one private half
  after splitting. A citadel guard is shared only while the asking save's
  battle for its castle is live
  (`isSharedId(c, save)`), because its defeat expires with the battle.
- Late arrivals learn deaths through `seen` → `dead`. Loaded shared enemies,
  including hidden garrisons, are announced in batches of 32 at most once a
  second and retried after ten seconds. Oldest announcements go first, so
  large groups finish and already connected players meeting later reconcile.
  Changing depth resets the scan. A peer whose `save.caught` holds an ID
  answers everyone near after a jitter; duplicate suppression includes depth.
- A hit received before its tile loads or while another depth is active waits
  up to 30 seconds; an authoritative death waits up to five minutes. The
  connection keeps at most 512 deferred enemy records. On loading, the shared
  creature predicate is checked before applying anything; private and tame
  bodies are never affected. Repeated scans recover deaths after these limits.
- Damage and kill frames share a rolling 12-frame-per-second client budget.
  Burst kills take priority and queue until sent. All enemy channels, including
  battle and targeting announcements, also share a rolling 20-frame budget.
  The relay allows 20 enemy frames per second, 32 IDs per seen/dead frame,
  and a bounded 4096-byte payload, enough for a full batch of its longest
  legal IDs.
- Castle battles are shared. A live battle is broadcast as `battle` (castle
  key and start) at once and every `Multiplayer.BATTLE_MS`; a nearby save
  with no battle there and the castle unclaimed adopts the SAME start
  (`Houses.adoptCitadelBattle`; the key must pass `Houses.isCitadelKey`), and
  two starts merge to the earlier. One start means one deadline, so every
  participant's `_expireCitadelBattles` undoes the guards' deaths at the same
  wall-clock instant. A guard's hit, kill or `dead` answer moves only between
  players whose last battle frames name the same start
  (`Multiplayer.battleShared`), which also keeps a save that has claimed the
  castle (and so kept its guards dead) from killing another player's guards.
- The claim stays per save: `resolveDefeat` asks `_checkCitadelClaims` for
  every fallen garrison guard, a peer's kill included, so each participant who
  sees every guard down during its live battle claims the castle in its own
  save. The claim is a fact about the castle, not kill credit: no
  `KILL_LEDGERS` row hears of a peer's kill.
- Shared targeting: every device simulates every enemy, so a shared foe picks
  the same player on all of them (`Multiplayer.enemyTarget`). Candidates are
  the local player and nearby peers at the same depth, inside the foe's sight
  (its row's `visionCells`, capped at the sim bubble, less the player's
  published gear cut `v`) and with no `TARGET_FLAGS` bit set (downed, hidden —
  the scene's `isUnnoticed` lane, in the kerb buffer, inside Home's or a
  claimed castle's ward ring, by a campfire). The nearest wins; candidates
  within `TARGET_TIE_CELLS` of it tie and the lowest relay id takes it
  (`pickTarget`). A held target stays until it stops being a candidate (with
  `TARGET_KEEP_CELLS` of sight slack) or another is nearer by more than
  `TARGET_STICKY_CELLS`. Offline, alone, or for an unshared foe the rule
  returns null and today's single-player logic runs unchanged.
- A pick or switch is announced as `aggro` (≤ `AGGRO_MAX_PER_S`); receivers
  adopt it, and hold it until that player stops being a candidate. Two
  announcements for one foe inside `AGGRO_TIE_MS` resolve to the lower pid;
  later ones replace earlier ones.
- A foe whose target is a peer rides the `npcTarget` lane with a peer body:
  it stalks the peer's last fix, a garrison measures `guardState` from the
  peer, and the local kerb does not turn it. `rosterEnemyAttack` hands a peer
  body to `peerFeint` before anything else, so the copy only faces and swings:
  no damage, condition, theft, shot, web, trap or blast happens on this
  device. The peer's own device runs the same foe at them through
  `Combat.playerDamage` as ever. Position corrections arrive on damage and
  snapshot requests; movement between those events remains local.
- Presence frames publish `e` (energy over `Energy.maxEnergy`), `g`
  (`TARGET_FLAGS`) and `v`. A peer below full energy wears the enemy health
  bar (`_drawEnemyHealthBar`) under its name tag; at full it shows none.

- Zone encounter groups share their highest observed party-size input through
  repeated `group` frames (`EnemyHabitats.scaleEncounters`; limits and stickiness
  in [generation](generation.md)). Given the same generated tile, devices with
  different nearby-player counts converge on the same deterministic extras
  and elite upgrades. Groups scale only after the tile's base spawn finishes.
  Hits or deaths for an extra not made yet wait in the bounded deferred queue;
  scaling runs before that queue is applied. Repeated count announcements
  recover missed messages, while a live group's count never shrinks.

Tests: `multiplayer_hits`, `multiplayer_shared`, `multiplayer_state_sync`,
`multiplayer_damage_routes`, `enemy_movement_determinism`, `server/test.js`.
Measurements: `tools/multiplayer-drift.js`, `tools/multiplayer-health-drift.js`
and `tools/multiplayer-sync-drift.js` (controlled headless fixtures, not browser
or production-network performance).
