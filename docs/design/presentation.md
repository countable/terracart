# Dialogs, feedback and teaching

Detail doc for dialogs, story delivery, statuses shown to the player, and
teaching copy. The root `CLAUDE.md` owns the overview; read this before
changing dialogue, story panels, books, toasts or status presentation.

## Dialogs, feedback and teaching

- Dungeon arrival splashes select their story ID through
  `WorldGen.floorProfile(depth).arrivalStory`; presentation owns the copy and
  art, while the existing story ledger owns one-time delivery.

- Feedback is visual; there is no vibration setting or device vibration.
- Developer → Item cheats searches the full item catalog by name. Each tap
  grants one through the inventory path, preserving bag limits and saving it.
  Books are read after closing the picker. Switching teleport cities enables
  the GPS stick before reloading, including a switch back Home.
- Developer → Spawn enemies searches `Combat.enemyKinds()` by name. Each tap
  adds one ordinary enemy on loaded walkable ground near the view edge in
  the active depth. These debug spawns last for the session.

- Daily sites share `Macros.visitKindForObject` and `beginDailyVisit` / `dailyVisit`.
  Claim the UTC-day ledger only when the benefit is granted; cancellation must
  leave the visit available. Keep presentation, light and effects in the owning
  row. Ambient site light persists after a visit; the availability pulse does not.
  Successful visits show their story painting each time. `tools/idols.html`
  reads the same rows for the design sheet.
- Dialogs use `makeModalShell` with a kind, which supplies a scene painting.
  Generate paintings with `tools/gen_story_art.js`'s `scene()` composition:
  portrait, subject above, quiet copy zone below. The shell handles overflow
  with its band layout. Painted headers use a label without emoji/`kindIcon`.
- Paired story paintings must use actual image references. Establish the
  introduction first, then edit that image for the completed action; preserve
  object designs, materials and booth identity. After-use panels zoom in on
  the transaction object (bed, book, gift, payment or equipment), with only
  cropped hands when needed. Keep faces and full booth views in introductions.
  Text-only style prompts are insufficient for continuity. Booth scenes use
  the introductions' painterly realism, subdued light and reserved expressions;
  avoid chibi proportions and celebratory smiles.
- Before memory 30, art and dialogue may foreshadow the survivor's past but
  must not reveal it. `MemoryStory` gates Act 2 on the first tower and nine
  lifetime memories; that tower is abandoned at 21. Its memory-30 reveal
  happens only at the second tower (restoration index 25 or later): both the
  wizard and survivor are dragons; the survivor was his Warmonger. Keep earlier
  scenes ambiguous; most paintings need no hint. Reuse existing art for this arc.
- Format every visible wait with `shortDuration`; UTC-day gates pair it with
  `msToNextUtcDay`. A timed gate needs a visible wait. A wait a CHARACTER
  SAYS uses `spokenDuration` ("a day"), the same ladder in words.
- Neighbour talk (`NPC.dialogue`, `MemoryStory.npcDialogue`) is PAGES: spoken
  words in curly quotes, an action in `<em>` on its own line, HTML body, a
  second panel only when the first is full (an array of pages; `interact`
  shows them with Next). Survivors speak the bible's words: the Breaking,
  fifty years, Mending Lane, the wizard the old folk call Tim; the hood is
  looked at, never asked about twice.
- Map messages fit `MAP_MSG_MAX` (30 characters) per rendered line, including
  interpolations. Cut copy or use a modal; do not interpolate unbounded POI names.
- Statuses, buffs and timers on the player live in ONE place: the status
  row under the top HUD (`_syncStatusRow`, `STATUS_ROW_CSS`), one chip per
  row of `Conditions.DEFINITIONS` (poison, burning, a trap's pin) and of `Buffs.KINDS`
  (`src/buffs.js`: a potion, powder, torch, coffee, the bike, the compass, a
  shrine boon — its expiry field, word and ink). A new timed effect is a
  row there; never a label over the player or a chip of its own.
  `Buffs.extend(save, scene, id, ms)` is the one writer of a row's expiry
  (max(now, until) + ms — a second dose extends, never resets or refuses). A status
  LANDING announces itself from those tables (`_announceStatuses`: the body
  flicks the row's ink, the word pops on the cell) — never at the writer. A
  creature's status (sleep, charm, frost, fear, psychosis) is a row of
  `Combat.STATUS_LOOKS` and one `Combat.flagStatus` call at its applier;
  render.js flicks and pops it through `_popCreatureText`.
- Map numbers use toast tiers: `_popEnergy(delta, { ix, iy })` for energy,
  `_popCellNumber` for other cell amounts, `_popDamageNumber` for foes. Name the
  affected cell; body changes default to the player. Body damage calls
  `_flashPlayerHit` when it lands, independently of popup throttling.
- A repeat offer (an offer with `repeat`: a stall counter, the smelter,
  Home Sell / Craft) reopens over the map, hiding its own toasts. The
  confirmation lives in the dialog: an explicit `receipt` line, or else
  the `flashLoot` / `flash` toasts its accept raised, captured by
  `showOfferModal` and reprinted as the reopened dialog's status line.
  Never add a second confirmation surface for a repeat offer.
- Book stories use direct firsthand excerpts in quotation marks. Occasional
  narrator asides sit outside the quotation in italics (`bookPageHTML`), usually
  one short sentence. Vary length, format, mood and author voice across books;
  use `BOOK_VOLUMES` for named volumes and consistent author voices, and reserve
  humor for some passages. Scholars can quote any page early: foreshadow without
  revealing the player’s identity or the wizard’s secret. Preserve approved
  excerpts and keep `ITEM_GUIDE_TIPS` as the owner of shared item parables. Authors
  describe their world, not interface elements such as work circles or health bars.
- Story delivery separates required, ordered canon from optional, asynchronous
  lore (docs/design/story.txt, ACT STRUCTURE). Memory and restoration are independent
  progress tracks; required events join them through prerequisites and world
  context. A painted panel can carry either layer. Lore never blocks canon.
- Story panels use a direct second-person narrator focused on the current
  experience: what happens, what the Hood notices, and how people respond.
  Keep them to one or two short sentences with occasional sensory detail.
  Avoid clever observations, implied lessons, and explanations of the Hood's
  thoughts. State emotions plainly when they matter. Preserve story beats and
  useful facts without early revelations. Do not assume the player's time of
  day or weather. Books and spoken dialogue retain their separate voices.
- Story panels, books and item descriptions carry at most one useful fact,
  told through the world, physical sensations or a character's voice. Hint at
  the advantage and leave exact effects for discovery. Confirmations state
  the choice and direct outcome concisely; keep prices and required quantities
  clear. Exact mechanics belong in brief action feedback or dedicated Stats,
  derived from owning constants. Keep safety and technical recovery instructions
  direct. Preserve `PLAY_TIPS` order for saved reading progress; secret uses
  stay out of public item descriptions (sapphire taming stays in the closing riddle).
- Numeric tiers are internal jargon. Player-facing item and shop quality uses
  the shared rarity badge names (Basic, Common, etc.) and their colors, never
  labels such as "Shop tier 1" or "T4".
- Loot identity by place uses per-context `favourite`; general frequency uses
  `dropWeight`.
- A neighbour's talk is its ROLE, a row of `NPC.CULTURES[culture].roles` with a
  label in every `NPC.LABELS` culture and a branch in `NPC.dialogue` that reads
  an owning ledger (restoration, lamps), never a count of its own. A zone's
  story in a resident's voice is the `keeper` column of `Zones.ZONE_KINDS`.
  The story neighbours by the trailer (`NPC.STORY_ROLES`, seated by
  `Starter.placeSafeAreaWarden`) arrive by the memory ledger (`minMemories`
  per role, re-run from `_bankDiscovery` and
  `NPC.tickArrivals`) and speak through `MemoryStory.npcDialogue` by act; a
  new story voice is a role there, not a new placer or dialog path. Ordinary
  residents are drawn in full by `NPC.spawn` but seated by `NPC.arrivals`:
  they return with memories to Home's ring or a restored house, off screen;
  a named zone's keeper stays. The warden's home plea is a tap, never a splash.

Tests: `scene_art`, `duration_notation`, `copy_voice`, `energy_pop`, `hit_flash`,
`item_descriptions`, `books`, `story_neighbours`, `buffs`.
