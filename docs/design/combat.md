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
  share this fall behavior, except the hidden way, which is walked on the sky
  floor ([floors](floors.md#sky-floor-depth--1)). Awakening remains permanent and winning grants the
  temple gift only once, even after re-entry or reload.

- Confusing gas scales each `confused` dose with local density: a full
  0.3-density puff applies five seconds; thinner gas applies proportionally less,
  denser gas applies longer doses up to the shared 60-second condition cap,
  preserving any longer active confusion.
  A single outdoor puff carries 0.3 mass: natural diffusion and the thin-gas threshold
  limit it to the source and four neighbours, dissipating in about ten seconds
  (at most about ten seconds of confusion from that puff). Overlapping or repeated
  puffs can extend exposure; sources can puff again after sixteen seconds. Gas
  spreads to cardinal neighbours and removes thin cells once every two foreground
  seconds. Contact still refreshes conditions each second; rock, masonry and
  intact stronghold walls block it. Every gas cell disappears completely below
  the shared 0.025 density threshold, including sealed rooms and unloaded boundaries. Walls and unloaded
  cells still block diffusion; denser trapped gas remains until it can thin.
  Fields and emitter cooldowns are session-local, separated by depth and paused while that depth is inactive.

- Poison, Fire, Paralysis and Confusion Paths place seeded geysers on safe
  verges. They use `EnvironmentHazards`' existing warning and eruption cycles:
  poison, paralysis and confusion release their matching gas; fire ignites its
  cell and adjacent suitable ground. Loaded nearby seats retain their clocks;
  eviction restarts them inactive, and other depths never run the surface seats.
  These authored hazards keep the shared safety exclusions and cannot erupt
  beneath a newly placed structure. Gas from successive eruptions can overlap
  in narrow passages as it diffuses and thins. They never enter the ambient crater roll
  or the save, and path-authored seats survive Nexus ambient suppression.

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
  Spider Path also lays permanent seeded ground webs: these use the same
  contact and rendering rules, but never expire or enter the shot-web save list.
  Entering a web paralyzes any body (player, enemy, pet or neighbour) for six
  seconds through the shared paralysis status. Standing there does not refresh
  the hold; leaving and entering again does. Webs are not consumed by contact.

- Timed followers use `Companions.KINDS` and its shared lifecycle; register
  movement/targeting in `SpriteLayout.CREATURE_BEHAVIOUR` and reuse the pet
  combat lane. Persist contract expiry and any durable health state, not live
  map instances. Test reload, tile replacement and expiry when adding a kind.
- Splitting slimes divide reactively on a blow. Only healing and summoning
  abilities use the support cadence; splitting never replaces their normal
  melee attack.
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
- Every player-credited elite kill pays one of the monster row's three
  `eliteDrops`: ordinary elites roll 70% / 20% / 10%, Possessed always give
  the second entry, and Ascendant always give the third. Rank guarantees live
  in `Combat.ELITE_RANKS.dropIndex`. The first kill also banks its memory.
  Equipment targets monster tier + 1 (maximum T7), rounded down to a supported
  slot tier. Fixed items use that tier's chest quantity budget; consumable
  signatures can add one through their row's `qtyBonus`. About half the entries
  come from other categories, including food, seeds, ores and unique relics.
  The 10% slot commonly holds a thematic unique relic, always quantity one.
  Same-tier or weaker equipment and already-carried unique relics become cash
  at half the drop's list price, checked again when a unique is awarded.
  Drops never reroll or climb above the authored tier. Depth and luck do not
  change signature odds or tiers. The ordinary kill bounty is separate.
- `combat.js` owns foe HP for melee, projectiles and pets. Damage derives from
  `TOOL_DURATION_MS`; tune that or monster HP, not an extra combat multiplier.
  Game animals (every wild animal: `SpriteLayout.isGame`) are not enemies or
  projectile targets; released slime pets are never targets.
- Route incoming damage through `Combat.playerDamage` and armour mitigation,
  including per-hit arrow bundles. A shield potion halves the raw blow before
  armour; difficulty multiplies the mitigated blow after armour. Armour reduces
  blows rather than increasing maximum energy. Stoneskin adds its consumable
  row's armour bonus to that same pool, including traps, potion blasts and
  ongoing damage packets. Its potion is drunk through the shared timed-buff
  action. Raw and grilled salmon lend both Grip and Stoneskin for the fish
  regeneration duration; each extends the existing buff without stacking its
  strength. A refused meal grants neither effect.
- `Energy.set` is the only runtime energy writer (current-save normalization is exempt).
  Accumulate fractional per-frame gains/losses before banking whole pips.
  `RoadSafety.DRAIN_PER_SECOND` drains a surface player whose feet remain in
  the night-time MD/LG kerb buffer, excluding walking-path footprints and its roadside-path side through
  `WorldGen.nightZoneBits`. `RoadSafety.drainPips` drops a partial pip
  on exit; app.js spends each whole pip through `_losePlayerEnergy` and the
  shared drain roll-up.
- A TIMED CONSUMABLE is a `CONSUMABLE_SPEC` row with `buff` (its `Buffs.KINDS`
  row) and `used` (its dialog): app.js `_useTimedBuff` is its one user,
  `Buffs.extend` its one writer (a second dose is banked on the first's end,
  never reset or refused), `TIMED_BUFF_HOOKS` its only side effects. A tome is
  the row's `tome` column (`_readTome`); an "every foe in sight" spell is a
  `CAST_ROWS` row (`_castOnFoes`); the slot guard is `_selectedConsumable`,
  the spend `_spendScroll` / `_consumeSelected`. Never a hand-written handler.
- Lantern (saved item id `evertorch`) is a T6 timed supply: two hours of blue light, with expiry
  saved through `Buffs.evertorch`. Another extends that expiry. Ordinary
  Torches keep their short, scene-local timer; either flame ignites melee foes.
- KNOCKBACK has one owner, `Whirlwinds.impulse` / `pushStep`: a whirlwind's
  contact (GRASS, PITCH and SCHOOL cells only, surface only) and the T1 Scroll of Wind
  (`CAST_ROWS.wind_scroll`: every foe in reach takes 5 and is blown
  `pushCells` away on any ground the enemy gate allows, at any depth). A push
  plays out at the depth it began on; a level change cancels it.
- THE MOONBEAM (T6 `moonbeam_scroll`, its own `useMoonbeamScroll`): the
  `moonbeam` Buffs row runs eight seconds (a second reading extends it). While
  it runs, `_moonbeamSegment` lays an instant beam `rangeCells` out along the
  facing, cut short at cave rock, and `_tickMoonbeam` burns `dps` a second
  (bypassing armour) into every foe within `widthCells` of it —
  `Combat.beamHits` keeps them all, so it pierces. Held while attacks are
  blocked, under the shadow's truce or while downed; the draw reads the same
  segment.
- LIFESTEAL is one rule, `Combat.lifestealHeal(fraction, dealt, target)`: a
  share of what a blow took, nothing from a `Combat.isUndead` target (the
  roster's `undead` column, inherited through `baseKind`). A bat's row
  `lifesteal` feeds it through `Combat.feed`, past its max (`foeBlowLands`
  and a charmed bat's bite); the Vampire Ring (`UNIQUE_JEWELRY.vampire_ring`,
  `jewelryMeleeLifesteal`) returns 20% of a melee blow as banked whole energy,
  capped at the bar.
- BOOK CLUB LENDING: lifetime Books collected provide one reusable credit
  each. The existing value-ordered tome shelf unlocks one new title every
  three Books; unlocks do not repeat. Each borrowed copy reserves its item
  tier plus two credits. Borrow as many copies as credit and bag capacity
  allow; returning one removes that copy and releases its reserved credit.
  All scholars share `save.scholarLoans`. Older permanent copies stay owned
  outside this ledger. Borrowed copies cannot be sold, bartered, donated or
  burned. The model updates inventory and loans together before one save.
  Returns never reset cooldowns or release resting spell slots; duplicate
  copies share their tome type's cooldown. Lending capacity chooses which
  spells travel with the player; the existing spell-slot gate still controls
  casting. The first tome unlocks before it becomes affordable.
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
  An `orbit_swoop` flier flies eased legs round its target and swoops every
  few; a row's `movement.erratic` block (the bats, and the hive bee that
  shares the bat's row) lets the orbit turn about (`reverseChance`), spreads
  the advance (`angleSpread`) and bows each leg sideways (`jinkCells`), the
  bow budgeted so the peak pace stays under the row's speed
  (`creature_ai.js` `enemyBatMove`). The bow rides the multiplayer flight
  snapshot as an optional vector; a peer without it flies the leg straight.
  `SpriteLayout.creatureAirborne` inherits that flag for variants and summoned
  wraiths and includes airborne fauna; the same `Conditions.flying` gate covers
  them without saving an infinite potion expiry or showing an infinite countdown.
- Hostile interest checks use `unnoticed` (shadowed or downed); stalking adds
  sight range through `unseen`. SIGHT is `Combat.seesTarget` over
  `Visibility.sightCover`: cave rock (FULL) hides the target outright; PARTIAL
  cover hides it fully too — trees past the sapling art, bushes, hedges, short
  walls and large rocks marked `sightBlocking: true` between them, or the
  target standing IN a CONCEALING cell (a bush, a hedge, a mid-to-large tree)
  while the viewer is not directly adjacent — except within HEARING
  (`Visibility.HEAR_CELLS`, 2 cells), where a foe notices what it cannot see.
  Ordinary rocks give no cover. The same rules hide actors from the player
  (`Visibility.hidden`: anything behind partial cover, or concealed in a cell
  more than one away, is undrawn and cannot be targeted; scenery goes only
  behind FULL cover); the X-Ray Ring (`Gear.hasXRay`) sees through all but
  FULL cover. Cover cancels an attack wind-up when sight is lost.
- THE LAST SIGHTING: a roster foe remembers where it last saw the player
  (`c._lastSeen`); on losing sight it walks there and searches until
  `LAST_SEEN_MS` after that look, then idles. Guards (`enemyGuardState`) lose
  interest through FULL cover and through PARTIAL cover past hearing, and walk
  back to their seats.
- AMBUSHERS (`isAmbusher`: a roster row's `ambush` — the thief, now also in
  COMMERCIAL ground — or a `Lairs.GROUPS` member's — the hedged lane's runts)
  wait in the nearest concealing cell (`Visibility.concealingCellNear`: a
  garrison's seat moves there, `lurkSeat`; a roamer walks to one near home,
  `lurkSpot`), notice only within hearing until they spring (`ambushSprings`,
  a burst of leaves), and return to the same hide once they give up. A bush or
  hedge with any live foe on its cell wiggles on `LURK_BUSH_BEAT` (render.js
  `Render.foeCells`), the nest bush's wiggle on a quicker beat.
  Traps check `Combat.playerDowned` directly:
  concealment does not stop them. Downed players have no reach and are not hunted.
- A status effect is a row of `Conditions.DEFINITIONS` (poison, burning, a trap's pin): the
  player's condition, a foe's (`Combat.ignite` / `burnTick` read the same row),
  the HUD chip and the body tint all derive from it. A new status is a row
  there, never a timer, colour or label of its own. BLINDED (a ghost's touch,
  its roster row's `condition`) carries `lightMul`: `Conditions.lightMul`
  halves the base reach before Inner Light upgrade steps (`reachRadiusM`,
  never under one cell), the light ramp's and a carried torch's radius
  (`Lighting.playerLightMul`) and the player's own light levels (the
  profile's ramp `edge` and plateau `lit`, `Lighting.dimSight`) for fifteen
  seconds; the world's ambient floor is untouched.
- Tapping a well within reach clears every harmful condition through
  `Conditions.clearDebuffs`, including burning and a trap's pin. Positive
  buffs survive; the well costs no item or energy and remains reusable.
- Confusion chooses a random compass heading and turn direction, with a slow
  rotation held for a complete circle before choosing another turn. Its share
  of movement increases linearly with the remaining duration: five seconds
  gives the compass 25% and player intent 75%; ten seconds splits control
  equally; at twenty seconds or more the compass fully takes over. As the
  timer falls, keyboard, stick and GPS steering recover gradually. Collision,
  holds and walking-speed caps still apply. Device headings keep sampling privately; expiry or cure
  restores the latest real heading (or the prior movement fallback) and eases
  the body back toward its GPS target at walking pace for at most
  `CONFUSED_RECOVER_MS`; then ordinary following (catch-up ramp, far snap)
  resumes, since walking pace never catches a walking player. Enemy puffs retain their normal duration;
  confusing gas supplies its density-scaled duration to the same condition.
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
- A poisonberry (wild teal-berried bush, forest and wetland) is the same
  `CONSUMABLE_SPEC` condition lane: eaten, the player takes `poison`; offered
  to an enemy or a pet (`feedsFoe`), that creature takes it through
  `Combat.poison`, the Poison Flask's call. The berry is spent either way.
- A stinging wild plant (`WILDPLANT_RULES` `sting`: the nettle, 7 energy,
  "Ouch!") hurts as it is picked: a bare-handed blow through
  `Combat.playerDamage` with no armour, so mode and the damage shield apply.
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
  bolt, flee a blow or run from the net while it holds. A golden berry
  (`CONSUMABLE_SPEC.goldenberry.charmsFoe`) offered to an enemy lands the
  `charm` status through `Combat.applyCharm` for `charmFeedMs`: a minute less
  the kind's tier squared in seconds (a runt 59 s, a T3 goblin 51 s, never
  below zero); a wild animal takes the calm of the same length. A charmed body
  reads as calm (`Combat.isCalm`), so it does not flee the net either. Giving a wild one its favourite starts
  a catch attempt (`Pets.catchMs`: current HP × 2 at the net's tool rate)
  while it flees for the edge of reach; no attack runs and it is no one's
  enemy until the attempt ends. A refused item is never consumed. Story foes
  and `untameable` kinds (the crow: hunted for its feather, never a pet; old
  saves drop a kept one) are not catchable (`Pets.catchable`). Only one pet per species, including
  baby/shiny variants. Every wild animal is GAME unless its row opts out
  (`SpriteLayout.isGame`: not a foe, an ally, a companion kind, the villager
  or the story's dragon): a tap with nothing or a non-food in hand hunts it on
  the net wheel, its favourite in hand catches it, plant produce feeds a
  producer, and other food is refused. A hunt pays the row's `drop` (deer,
  chicken, cow and horse: meat; rabbit: pelt; crow: feather; the rest:
  nothing) — livestock fed its favourite is caught alive instead. A
  roster kind is never game: it is fought, or (the crab, the gull, the raven)
  caught.
  Use `Pets.carry/deploy/release`, never inventory stacks or id prefixes, for
  ownership. Stats, tint, accessories, growth and recovery stay on that record.
  Pet shops sell accessories. Eggs hatch wild babies that use the same gate.
  PetNip is accepted by every owned pet through `Pets.likes/feed`, but cannot
  catch wildlife. Its item `petFood.maxHp` permanently adds to the individual's
  saved HP bonus and fills that new capacity without healing old wounds or
  interrupting knockout recovery. It does not count as a favourite meal.
  Feeding a shiny chicken yields a separate Shiny Egg stack. After 500 m of
  real GPS walking, it hatches a non-shiny green dragon baby; its favourite
  food is meat. Regular eggs still hatch shiny domestic babies. Each egg type
  incubates one egg at a time, with independent saved distance and GPS sessions;
  hatching or losing one type never spends the other's progress.
- Magic Shop brewing uses `BREW_RECIPES` in items.js. Each batch consumes the
  recipe's ingredients and fixed coin fee for one potion. Finding its output in
  the wild unlocks a recipe through `homeRecipeLocked`; buying or brewing never
  unlocks one. Antidote, Hardworking, Grip, Healing, Stoneskin, Blight, Shielding
  and Shrinking are brewable; Revival and Resurrection remain unbrewable.
  Healing uses berries and onions; Blight uses Marigolds and Meat;
  Shielding uses Starflowers and Milk. Shrinking
  uses two Mango and four coins, an intentional exception to same-tier inputs
  and the otherwise conservative recipe economics. Sugar Potion retains its
  workbench recipe. Growth Powder is crafted at a workbench from three Nettles
  and five Long Grass after finding the powder in the wild. Brewing does not change potion effects.
- Home light and ward retain `HOME_R` and surface-only `homeWorldPos()`.
  Home rest uses `isRestingAtHome`: the player's owned Home building cells
  and their four edge-sharing neighbours, never corner-only contact. Ownership
  is checked across tile seams; other houses and caves do not qualify.
  Campfires use `FIRE_REST_R`. Home wards steer enemies away from Home and suppress bites.
  Do not merge this with campfires' refused-target-cell ward, which would trap
  enemies inside Home's ring. Campfires burn for 24 real hours, including offline
  time (`Campfires.active`, saved `litAt`). After expiry their smoking pits give
  no rest, ward, light or burning contact; flint relights them for another day.
- Fire slimes resist burning and fireball damage through their roster row. Each accepted cell
  exit lights the cell left behind through `GroundFire`, including while
  wandering or retreating. The occupied destination stays unlit until they
  leave it. These flames use normal ground-fire duration, spread and fuel
  rules, and can relight expired cells. Fire immunity also permits crossing
  burning ground and campfire hearths without fire avoidance.
- A lit campfire's hearth (`FIRE_TOUCH_CELLS`, where it sets a body burning) is
  fire to susceptible grounded movers — enemies, lair guards, pets, fauna and
  NPCs — through the same `fireStepAllowed` that holds bodies out of burning
  ground: no step or hop enters it, a body already in it may walk out, and a
  chasing foe sidesteps around it when a jog fits. This is separate from the
  warmth-ring ward (`FIRE_REST_R`), which turns back only entry-level kinds.
- Home rest adds an expected 0.1 energy per second per current luxury point
  to the base full-bar-in-50-seconds rate. `Furniture.restBonus` random-rounds
  each elapsed interval (floor plus a fractional Bernoulli draw); base healing
  retains its fractional bank. Both pass through `_accrueRestEnergy` and
  `Energy.set`. Work/settling pauses, the energy cap, hard-mode quarter-bar
  revival and independent campfire recovery keep their existing rules.
  Luxury milestones at 4/16/36/64/100 each bank one real memory once per save,
  with the normal immediate full heal and lifetime story progression. Pickup
  cannot remove or repeat an earned memory.
- A housed neighbour's luxury also determines their help (`NPCBenefits`).
  Tilly waters dry, immature surface crops within 15 cells of her house for
  one minute per luxury point, followed by an hour's rest. She walks to a crop
  or a cardinal neighbour through the NPC spawn gate and shared character
  movement sweep; blocked crops are skipped, and she walks home afterwards.
  Only foreground simulation waters crops: loading a save never backfills work.
  Tilly's loaded-home chores continue beyond the player's normal 12-cell
  creature simulation bubble, so she can reach the full crop radius and return
  while the player stays home; other distant creatures remain frozen.
  Actual watering records today's UTC date so talking to Tilly or visiting her
  house can report, “Hey, I watered your crops today.” Other housed neighbours
  offer daily gifts on a visit or conversation: Bryn gives Wood, Maud Apples,
  Edda Flowers, Orrin Rock, and other residents Berries, one per luxury point.
  Gifts reset by UTC day without accumulating missed days. A partly full bag
  retains today's uncollected portion; successful collection fixes today's
  allowance so furniture changes cannot repeat a gift.
- The Quilted Cot restores all missing energy through `_restoreEnergy` and
  `Energy.set`, with no coin or daily-use cost. It works only on an owned Home
  building cell and refuses full energy or `_zeroEnergyLocked()`, both before
  sleeping and when the shared sleep fade commits. The Inn uses that same fade
  with its existing paid, once-per-day transaction. Washing Tub clears only
  `Conditions` debuffs; buffs, energy, food cooldown and terrain remain unchanged.
- Home is `save.starterShopId`: the player's house, placed by `_placeHome`
  centred one cell north of the player (`HomeArea.WAGON_OFFSET` — the anchor
  keeps the save's old name) so they start in its doorway row, with an empty
  firepit two cells due south of its centre (one behind the player)
  (`FIREPIT_OFFSET`, `save.homeFirepit`; flint lights a fire in it). When a
  street faces the door (`_homeNearestStreet`), the pit instead stands out
  front between the door and that street, the same two cells past the
  doorstep or closer, never on the road (`HomeArea.firepitCellsToward`). With
  no street there and the player outside the house when the pit is placed, it
  goes between them and the house, else behind them on that side
  (`HomeArea.playerSideFirepitCells`); it is never placed on the player's own
  cell. The first
  valid device-compass reading unlocks placement once per save
  (`homeCompassDetected`); `homeFirepitPending` waits for Home and the surface
  if the reading arrives earlier. With no reading after
  `FIREPIT_COMPASS_GRACE_MS` on the surface (desktop, no motion permission) the
  pit is placed anyway, on the same cell. A pit cell on water, a pier or a
  road falls back to the nearest suitable cell one, then two, cells out from
  the player (`HomeArea.firepitCandidates`), so a new game always gets its pit
  when one fits. Later headings and reloads do not move it.
  Home's footing sweep (`clearHomeFooting`) removes generated objects and
  wild plants whose footprint touches the doorstep 3×3 or the pit, and any
  tree up to `HomeArea.FIREPIT_CANOPY_CELLS` due south of the pit, whose
  canopy would stand over the fire; saved and player-owned things stay.
  This step-over prop sits at its cell centre, with its ring, fire, smoke and
  step-up footprint sharing that anchor. On the first compass reading, older
  saved rings move to this southern cell too; a matching surface fire follows
  the ring and retains its state. Cave fires at the same coordinates are
  unaffected.
  The house is `HomeArea.HOUSE`: a 2×2 footprint around the anchor cell
  (`inHouse`), stamped into the built tile by `_stampHomeFootprint` as
  building cells under Home's id with a polygon ring and a doorway on the
  wall facing the player at placement (`doorSide`, saved as
  `starterTrailer.door`), so the spawn gate, the tap zone and the overlay see
  a building; "Move Home here" lifts it again (`_unstampHomeFootprint`).
  Standing on one of its cells is being inside (`homeInside`; `homeInterior`
  hands the ring to the renderer — see [rendering](rendering.md)). Older saves
  may still have an adopted house as Home; it keeps its own footprint and is
  drawn the same way. Home adopts a nearby building as-is or needs a clear
  2×2 site. `clearHomeFooting` clears incidental clutter while preserving
  neighbouring buildings and saved furniture; moving Home leaves furniture
  at its saved world cells and recomputes its indoor membership.


Tests: `combat`, `armor`, `energy_int`, `downed_pursuit`, `rest_work`, `home_ward`,
`pet_pickup`.

## Boss encounters

- Every boss fight is one routine: a row of `BossEncounters.KINDS`
  (`src/boss_encounters.js`) — today the citadel's garrison and the serpent a
  Serpent Idol raises. A trigger starts a record (`start`, kept in the kind's
  `store` on the save); it is live for the row's `durationMs` of wall time.
- A citadel's garrison wakes only once its Fight is accepted, and its guards
  (`castle` set) skip the keep's quiet notice ring: `Lairs.guardState` hunts
  the player anywhere within `LAIR_LEASH_CELLS` of the keep's walls, so the
  garrison pours out of the keep at once.
- Any lair guard struck by the player's side (`_damageEnemy`) is set hunting
  wherever its notice ring is, so a ranged blow is answered; the leash still
  ends the chase.
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
  row's `leashCells`, cycling through eight seconds each of viewport roaming,
  circling the player, and charging through the player's position. Roaming and
  circling use 3.9 m/s; charges use 1.6 times that pace and commit to a target
  that the player can dodge. The saved encounter clock preserves the phase
  across reloads; shared copies follow the owner's poses. Coils and tail follow its trail,
  spaced one display pixel closer than 0.55 cells at the standard cell scale. Trail samples
  accumulate distance from a fixed anchor while the live head moves, so turns
  remain in the path at every frame rate. Each coil touching the player bites
  for the row's `dmg` (4 base damage) once a `damageIntervalSeconds`
  through `foeBlowLands`. Only coils can be struck (the head and tail are
  `untargetable`, read by `Combat.isConcealed`); a slain coil shortens it, and
  with only head and tail left it dies. Body and gait numbers are the
  `KINDS.serpent` row. The Serpent Idol is the road ladder's fifth prize, alone
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
  The wire protocol lives atop `server/index.js`. Browser and relay share
  snapshot fields, limits and validation in `src/enemy_protocol.js`; bat flight
  includes the optional `jx`/`jy` bow vector as well as its endpoints.
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
  shared `EnemyProtocol` constants and cleaner for wire limits.
- A received hit is source `Combat.PEER_SOURCE`: it goes through
  `_damageEnemy` with `exact` damage (no armour or potion shield twice), shows
  its number, never splits a slime and is never sent on. A peer's kill goes
  through `resolveDefeat`, which marks it in `save.caught` and pays nothing,
  unless this client's own side hit it within `Multiplayer.ASSIST_MS`
  (`Multiplayer.assisted`): an assist spawns the kill's loot here too (coin,
  drop, elite or treasure roll) but no ledger credit — `KILL_LEDGERS` hear
  only of own kills, so `Macros.slainByPlayer` stays false.
- Only world-shared creatures take part (`EnemySpawns.isSharedId`): a positive
  mark stamped where world-derived creatures are made, including authored
  cave encounters and bone-gallery guards. Client and relay ID validation
  accepts their persistent delimiters so saved defeats retain their identities.
  Clock-, random- or serial-minted creatures (ghosts, fished slimes, pest deer, guild foes, dev
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
