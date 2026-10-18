# Dialogs, feedback and teaching

Detail doc for dialogs, story delivery, statuses shown to the player, and
teaching copy. The root `CLAUDE.md` owns the overview; read this before
changing dialogue, story panels, books, toasts or status presentation.

## Dialogs, feedback and teaching

- DOM inventory, shop, toast and gear icons share `assets/Icons/dom-atlas.png`.
  `renderItemIcon` and `gearIconHTML` retain the original sheet/frame selection,
  adding the atlas offset; baked `ITEM_DATA_URLS` still take priority. The atlas
  uses a content-hashed URL, and delayed prewarming fetches it once rather than
  every gear tier separately. A new unpacked sheet falls back to its original
  URL until regeneration. Phaser world textures keep their existing sources.
  After changing item/gear art or catalogs, run
  `node tools/build-dom-icon-atlas.cjs` (Python 3 + Pillow), then the normal
  cache-bust generator. `node tools/build-dom-icon-atlas.cjs --check` checks
  pixel-for-pixel source parity; `node test/dom-icon-atlas.cjs` verifies every
  catalogued item and gear tier's CSS frame at multiple display sizes.

- Shop recipes use compact rows, selector spacing and a shared ingredient/count
  heading so shortfalls and receipts fit with the actions as artwork contracts.

- Rewards converted to coins show only the coin reward in dialogs and toasts,
  without naming the replaced item or explaining the conversion.

- All game text uses the system sans stack in `--font-ui` (`index.html`) and
  its canvas counterpart `FONT_UI_STACK` (`src/util.js`): `-apple-system`,
  `BlinkMacSystemFont`, `"Segoe UI"`, `Roboto`, `"Noto Sans"`, `Ubuntu`, `Cantarell`,
  `system-ui`, `Tahoma`, `"Liberation Sans"`, `Arial`, `sans-serif`, in that order.
  Use `var(--font-ui)` for DOM text and `phaserFontUI()` / `FONT_UI_STACK` for Phaser
  text, including books, speaker names, compass letters and decorative glyphs.
  Do not add serif or monospace overrides. Numeric counters use tabular figures.
  Never hand Phaser a `font:` shorthand string with this stack: Phaser cuts the
  family at its first comma, the canvas rejects the broken shorthand and draws
  the text at its own 10px regular, so the size in the string never shows.
  Toast tiers (`TOAST_TIER`) all set bold 10px for that reason.

- Reward acknowledgments and safety reminders use an explicit OK button;
  tapping the body or backdrop does not dismiss them. Dragon Spirit messages
  and confirmations use the NPC portrait layout with a dedicated transparent,
  80×80 pixel-art Dragon Spirit head-and-neck portrait (`assets/portraits/dragon_spirit.png`).
  Short informational help and NPC conversations use floating ivory speech
  bubbles with the participant's portrait. They point to the HUD control or
  speaking character: below sources in the top half of the viewport, above
  sources in the bottom half. NPC anchors follow heading, zoom and viewport size.
  Got it dismisses immediately; after two seconds, a tap anywhere dismisses
  informational bubbles without passing the tap to the world. Explicit choices
  still require a response. The main menu, shops, story paintings and book list
  retain their mechanical panels.
  The original tall spirit painting remains available for scene art.
  Energy, distance and memories HUD help use this Spirit portrait and speech bubble.
  Energy briefly explains refills and capacity; distance reports true restored
  roads and the next treasure threshold, with scenic bonuses kept separate.
  Dragon Spirit and NPC bubbles place the portrait beside the speaker name.
  Dialogue headers join name and role with a comma ("Tilly, Wanderer").
  Spoken copy and response controls sit below that header inside the bubble.
  The first earned green coin opens its own `coin_first` scene painting before
  revealing the money readout; its raised star matches the compact currency icon.
  Digging an X opens a treasure acknowledgment headed “X marks the spot” with
  its own `treasure_dig` painting. The find is claimed and its single reward paid
  before the card appears; OK acknowledges the reward without granting it again.
  Great X marks and underground finds keep their existing reward pools and bonuses.
  Container paintings follow the visible container, not the reward: crates use
  `treasure_crate`, barrels use `treasure_barrel`, and ordinary chests use
  `chest_t1` through `chest_t7` for their source tier. Only a glow inside hints at the contents; the reward card
  names the actual find as “Item name × quantity”, with its tier badge on the
  next line. When the find has a description (`Rewards.desc`: the item's
  `ITEM_EFFECTS` line or the gear blurb) the card splits: the find on the left,
  the description on the right. Barrels, clay pots and T1 crates show item
  acknowledgments only when the item is not currently carried; already-carried
  items use the small viewport loot toast. Check ownership before granting the
  reward, not the discovery history. Bag-full take/leave choices still appear.
  Empty pots and barrels retain their brief smash feedback; their coins use a toast.

- The compass header aligns menu, a memories/books window and compact distance meter
  capped at 84 pixels wide beside a 72-pixel energy dial at the top right. The menu is
  46 pixels tall; the shared memories/books window gives these controls more room. A 26-pixel coin with a cast shadow and its
  white inline count sit at the far right, with a seven-pixel gap below the energy dial. The tutorial
  floats inside the upper map as a Dragon Spirit portrait and speech bubble. Equal responsive
  gaps separate all four top widgets, with matching 8-pixel outer margins. The simulated-GPS control sits 20 CSS pixels above its
  ordinary stick baseline. The carving stays visible beneath navigation, with a
  darker graphite recess behind the inventory and a soft outer-edge fade.
  The energy dial shows current / maximum energy centred in its bottom half,
  below the needle, and uses the shared silver texture with contrasting warm grey reflection bands;
  close-contact socket shadows and compact recessed category glyphs seat the controls in
  the chassis. Neutral pewter faces and rims match the carved background while
  controls retain brighter text and icons. The fade excludes
  the circular map aperture. The compass rim is a fine gold celestial inlay: a shallow, flourished north
  triangle, larger embossed cardinal letters with brighter fittings and dark drop shadows, small gold beads at the four
  45-degree diagonals, and eight engraved intermediate 22.5-degree marks
  contained in the band. The rim follows compass heading while all four
  letters counterrotate to stay upright. `assets/ui/compass/gold-rim.svg`
  owns the band and engravings; transparent `gold-fittings.png` sprites supply
  sculpted metal ornaments with broad raised edges and curled flourishes.
  E/S/W letters are 1 pt smaller than their original scale; north retains its larger type. The gold overlay
  sits outside the silver chassis dimming and uses the controls' brightness,
  with warmer saturation to match their gold. Its letter seats match the HUD CSS.

- The four opening panes show the compass discovery, dragon-war dream,
  house awakening, then the ruined street. Each has two aligned paintings:
  hold the first for 1.5 seconds, crossfade once over 1.2 seconds, and keep
  the second frame. The dragon dream instead keeps alternating between its
  two paintings while open, so the heads and flames continue moving after
  the camera push ends. Discovery and the dream are borderless fullscreen panels.
  Awakening says “The compass shows you are in a strange house.” with a
  “Go Outside” button and uses the living-silver compass story sheet, as does the ruined street and subsequent narrative. Paintings
  remain uncropped with readable copy below. The dream retains its eight-second camera push and
  immediately available wake-up button. Reduced-motion mode shows the first frame without
  zoom or crossfade.

- The living-silver chassis uses the approved neutral-silver mechanical bearing
  artwork (`assets/ui/compass/compass-bearing.webp`) in `css/compass_hud.css`.
  The background is width-fitted at a -15px vertical offset; the live map,
  aperture masks, and gold compass rim shift up 5 CSS pixels together.
  Radial brackets support the main circle, with engraved scales behind both
  the upper instruments and joystick. Legacy endcaps and their baked shine
  are hidden on the live chassis; dialog and opening art retain their own rails.
  Layout publishes CSS-pixel `--compass-map-top` and `--compass-map-size`;
  modal sheets use game-pixel `--map-top`. Existing controls retain their
  listeners beneath analog energy, shared books/memories display, true-north needle
  and closed module shutters. `tools/compass-hud-harness.html` previews active
  and closed states against a frozen sandbox. Opening wake/street sheets use
  an inert face made from the same slices before the game scene exists.
  The approved consolidated reference uses odometer wheels above two separate
  knowledge readouts, with gold controls and neutral silver passive surfaces.
  The current compact layout joins those readouts into one glass window with
  smaller icons/numerals and an unused-memory badge on the star. Each half
  retains its own tap action, accessible name, and independent dormant shutter.
  `css/compass_inventory.css` seats eight square keys with small stamped-in category symbols on
  plungers above a shared rail. Category page one has Seeds, Produce, Pets,
  Relics, Magic and Supplies, then a spacer and Next at the right edge. Page
  two has Previous at the left edge, Furniture, Armour and Ores, then four
  inert spacers. Navigation uses ordinary silver keys; only the selected
  category and detent glow gold. Category paging is scene-local and leaves
  the selected category, held stack and five-item page unchanged. Selecting
  a category, boot settlement, a new-stack pickup and first acquisition of an
  armour slot reveal its category page.
  Mirrorable furniture exposes a contextual Flip control; held orientation is
  transient and resets when the selected item changes. Small
  square item controls share one dark-glass window fitted to five slots and their
  gaps; the window stays snug when sort or paging controls are absent. It retains a physical sort lever,
  a mechanical pager rocker with broad upper/lower touch faces around an ivory count
  window, and an integrated name/action plate. The upper face selects the previous
  page; the lower face selects the next page. The description plate
  appears only for a selected item or piece of gear; empty categories show no plate. Contextual actions
  retain their existing semantics. The dormant inventory cover occupies the lower
  inventory window until the first item activates it; it has no close control.
  Inactive-module Spirit dialogs explain how to power up that specific module;
  distance uses the shared 200-metre threshold, and spirit walking remains opt-in.
  Reference atlas crops live alongside their provenance in `assets/ui/compass/`.
  Engravings retain their aspect ratio rather than stretching to viewport height.
  Body-level loading, opening-story, help, and location dialogs use the shared
  phone gutters, including their backdrops; they never span desktop margins.
  The dragon header reserves its full 750:220 aspect ratio at the phone-panel width;
  its chrome stays above scene paintings and loading mosaics without cropping the head.
  Sheets have no duplicate metal side rails or border: the outer compass housing
  supplies that frame. Painted sheets mask the dragon rail along its lower silver silhouette so
  the image fills the space beneath the ornament without its dark backing; scene artwork preserves its approved 4:3 composition. Painted sheets reserve a separate
  content area below the image for useful category headings; painted stories omit
  the generic “Story” label.
  The modal gate publishes the final sheet edge in viewport pixels so silver
  shoulders remain visible above scaled sheets without covering their controls.
  It clips the header readouts at that edge too; story sheets rise above the
  coin indicator, using its measured position across phone and desktop scaling.
  Dismissible sheets expose a fixed close control using the same cancellation
  callback and input arming as their backdrop. Offer dialogs close through
  `closeModal(reason)`: leaving or an enemy hit releases deferred book reads
  after removal, while acceptance and tab transitions retain pending work.
  Required acknowledgments omit
  it. The menu actuator remains visible and depressed while its sheet is open.
  Gold zoom plungers sit just below the map window in a silver rack; the gold
  direction lock occupies the upper-left corner of the compass. These controls
  live outside Phaser’s scaled wrapper and yield to modal sheets. The lock
  depresses while engaged. Unselected inventory items have no individual border;
  the selected item retains its gold outline. Empty inventory cells are disabled
  and never highlighted or counted as another page. Tap a selected stack again
  to put it away. `Inventory.add` and `Inventory.remove` preserve the selected
  stack through array compaction; consuming that stack clears the hand.
  The energy dial has one lightning-bolt needle for current energy, equal
  red/yellow/green thirds, and a maximum-energy numeral on the right.
  Dormant inscriptions use invented geometric glyphs at a shared size; their
  accessible names and Spirit explanations still identify the module in English.

- Compass shine is disabled in the live HUD: its script and stylesheet are not
  loaded, so it installs no reflection layers, animation loop, or tilt listeners.
  The baked emission assets and `CompassShine` implementation remain available
  for the development prototype.

- Starter guidance is a floating Dragon Spirit portrait with a compact, pale
  speech bubble on the upper map. Each step gives one spoken instruction;
  completion briefly acknowledges it in the same bubble. Only the dismiss
  button intercepts taps. Modal dialogs hide it, reduced-motion preferences
  stop its float, and the menu can restore dismissed guidance. Tutorial steps
  grant no bonus coins; ordinary loot and sales retain their own rewards.

- The money area stays blank until an earned coin queues its first-coin story.
  Starting funds do not unlock it. The story waits behind other interactions;
  successful presentation records `storySeen['coin:first']` and reveals the coin
  and count permanently, including after spending or reloading. A pending
  introduction survives spending and reloads; older saves unlock on their next
  earned coin.

- Living-silver compass circuits persist their active state and pending
  one-time Dragon Spirit notices in `save.compassModules`. Inventory activates
  on the first item or gear, books on the first book obtained, memories on the
  first discovery/memory. Spending cannot close an activated circuit. Distance
  activates after 200 m of accepted movement; joystick activation requires
  **Enable spirit walking** in its spirit dialog. Closed controls explain low
  power. Activation notices use Dragon Spirit speech bubbles anchored to the
  awakened control, with **Got it** immediately available and tap-anywhere
  dismissal after two seconds. They wait behind stories and dialogs, present
  one at a time, and are claimed when shown so reloads cannot repeat them. Existing ownership seeds circuits
  quietly when upgrading an older save.

- The inventory pet menu's **View info** opens an individual pet card with a
  128px portrait, description, current/max HP and damage per hit. Stats use
  `Combat.maxHp`, `Combat.petBlow` and `Pets.stats`, including accessories and
  individual bonuses. Converted enemies use their main sprite as the portrait.
  Successful catches open this card immediately with **Close**; the first-pet
  story stays queued until the card closes. Inventory cards use **Back**.
  Feeding PetNip from this menu or directly on the map opens the standard
  `talk` speech dialog with a pleased response and the permanent max-HP gain.
  It shows the pet's 128px portrait, or a 128px main sprite for converted enemies.

- Character portraits use `CharacterPortraits` and transparent 80×80 cells
  from the generated 4×4 sheets (320×320 atlases) in `assets/portraits/`.
  NPC identity follows `SpriteLayout.npcSheet` for each role and culture; Tilly has a housed variant.
  Dialogue passes `portrait` to the modal shell. Panel dialogs keep the face
  and shoulders at 128px above text that uses pages when necessary; speech
  bubbles (`talk`, `spirit`) draw the cell 1:1 at `CharacterPortraits.CELL_PX`
  (80px) beside the speaker name. Both use pixelated scaling for chunky
  pixels. Portraits have no background plate or rounded clipping.
  A neighbour speaking opens on the `talk` kind (`NPC.speech`): the header is
  the speaker's name beside a 💬 chat bubble, the title line is their role —
  never the generic `note` scroll.
  Scene paintings continue to use `art` and the full scene layout. The
  white-haired newcomer’s first conversation uses `story_ayo_arrival`; later
  conversations use her portrait, without revealing her name or identity.

- Interrupted startup script downloads show a recovery screen and retry the
  whole page at most twice per tab, preserving script order and saved progress.
  Offline startup waits for connectivity; exhausted retries offer **Try again**.
  Successful map startup resets this budget. Runtime exceptions remain visible
  as diagnostics and do not trigger automatic reloads. Versioned scripts only
  fall back to an exact cached version, never an older incompatible module. Linked local stylesheets use the same
  content-hashed URLs and worker generation as scripts, and are installed in
  the offline resource cache; CSS-only changes invalidate the shell too. Local game servers must also
  serve the checkout’s root `sw.js` as JavaScript; mounting only `index.html`
  and asset directories leaves persistent caching disabled.
  `node test/load-performance-browser.cjs [base URL]` checks cold/warm chapel
  startup, worker control, and offline cached art. Network-panel entries include
  cached resources; compare transferred bytes and time to playable as well as count.

- Dungeon arrival splashes select their story ID through
  `WorldGen.floorProfile(depth).arrivalStory`; presentation owns the copy and
  art, while the existing story ledger owns one-time delivery.

- A story dialog pauses the fight: while one is open (`_storyDialogOpen` —
  kinds `story`, `note`, `talk`, `memory`, `spirit`, and the `#story` / `#howto` overlays) the
  player takes no damage (`Conditions.setDialogShield`, read through
  `damageImmune`), hostiles hold still, and the player's body stops following
  its movement target. GPS fixes still arrive; following resumes after dismissal.
  Opening any modal releases the held movement stick so a hidden pointer cannot
  keep steering. Shops, trades and other dialogs
  do not pause; a foe's blow still closes a shop.
  Message dismissal refreshes this shield from the remaining dialogs before
  running its callback, so consequences such as fall damage apply after the
  story closes while potion immunity remains effective.
- The revival storyboard (`_reviveStoryboard`) tells of being carried home,
  so it plays only when the GPS fix is near Home too (`_gpsNearHome`,
  `HomeArea.NEAR_M`), not just a body stick-walked into Home's ring; otherwise
  it stays unmarked for the next revival.
- The normal third road card rolls 20% boots, 20% gear or a unique relic,
  and 60% magic. Both equipment branches share a cap of one tier per 10,000
  cumulative banked road metres, up to T7. Before T1, both shares become magic;
  owned boots at the cap also redirect their share to magic. The general gear
  pool includes boots and uses normal duplicate cash-outs.
- The third road reward offers a wooden pick in the magic/equipment card slot
  when the player has no pick. Owning any pick tier keeps the normal roll;
  cash and seed/supply choices remain, and only the selected card is granted.
- Feedback is visual; there is no vibration setting or device vibration.
- `RoadSafety` owns the two location warnings. The first night entry into the
  MD/LG kerb buffer shows `road:night` once per save through the story ledger.
  Standing on a majority-covered MD/LG road cell shows the dismissable road
  safety card once per UTC day through `safety:roadstand`. Both use the shared
  `safety_phone` painting and direct safety copy.
- Developer → Item cheats searches the full item catalog by name. Each tap
  grants one through the inventory path, preserving bag limits and saving it.
  Books are read after closing the picker. Switching teleport cities enables
  the GPS stick before reloading, including a switch back Home.
- Developer → Spawn enemies searches `Combat.enemyKinds()` by name. Each tap
  adds one ordinary enemy on loaded walkable ground near the view edge in
  the active depth. These debug spawns last for the session.

- Use **shrine** for daily activations and **idol** for boss-summoning items.
  Shrine names and visit copy use this distinction; existing internal IDs remain stable.
- Daily sites share `Macros.visitKindForObject` and `beginDailyVisit` / `dailyVisit`.
  Claim the UTC-day ledger only when the benefit is granted; cancellation must
  leave the visit available. Keep presentation, light and effects in the owning
  row. Ambient site light persists after a visit; the availability pulse does not.
  Successful visits show their story painting each time. `tools/idols.html`
  reads the same rows for the design sheet.
- Home, workbenches and brewing share `_presentRecipePicker` for discovery,
  selection, capacity and paging, above `_presentRecipeOffer` transactions.
  `HOME_RECIPES.station` keeps Home's Craft tab limited to the starter-known
  workbench (three Wood and one Rubble). Every former Home recipe, including
  the starter-known Spear, belongs at a placed workbench. Tapping a workbench
  opens its recipe picker directly, indoors or outdoors, with a ghost Pick up
  control at the top right and no Home Sell tab. Recheck the station before
  spending and reopen the same workbench and selected recipe after crafting.
  Show each ingredient's
  held and required quantities, its shortfall in text, and a visible reason
  when Craft is disabled. Keep the chosen recipe after crafting and refresh
  counts and the existing receipt. Recipe selection never spends ingredients;
  acceptance still rechecks unlocks, bag room, and ingredients before spending.
- The Book Club is a lending catalog shared across scholars. Keep total/free
  credit visible above the shelf, with one complete tome per page; All tomes and On loan filters
  support preparing spells and returning them. Each row shows its effect,
  credit cost, borrowed/owned counts, and an explicit unlock or affordability
  reason. Borrow and Return update the catalog in place with one receipt;
  no confirmation chain or auto-selection of a spell. Inventory labels mark
  borrowed quantities. Returns at any Book Club preserve spell cooldowns.
- Magic Shops have Shop / Brew tabs at every shop tier. Brew lists only learned
  recipes, using the same ingredient counts and picker as workbench crafting, plus a
  fixed coin fee. An empty list says "Once you find a potion, you can brew it here."
  Keep the selected recipe after brewing and recheck discovery, bag room,
  ingredients and coins before spending either resource.
- Dialog content and buttons appear immediately, without timed input blocking
  or delayed button reveals.
- Dialogs use `makeModalShell` with a kind, which supplies a default scene
  painting unless the caller supplies a character `portrait` or `art: false`.
  Generate paintings with `tools/gen_story_art.js`'s `scene()` composition:
  4:3, with a complete scene and no baked dark text area. Paintings fit the
  full width, anchored at the top without stretching. The image begins at the
  window top behind the fixed silver dragon rail. Approved 4:3 paintings keep
  their full height; longer copy paginates below them. All story paintings use
  a full-width 4:3 frame, cropping legacy art without stretching. Opening
  panels three and four share this layout; the first two stay immersive.
  Other dialogs with legacy squares begin at
  90% of panel width and can shorten to 70%; legacy portraits can shorten to
  the rail height plus eight pixels. `tools/art_thumbs.js` bakes `ART_ASPECTS`
  alongside aspect-preserving thumbnails, so this layout is ready before the
  full painting loads.
  Copy follows directly below, with comfortable side padding and the specific
  title offset down four pixels. Painted stories omit the generic “Story” label;
  useful shop/event categories sit with the copy below the image. The Build
  chooser uses a vertically scrolling card grid with a compact painting and
  a fixed price/action footer; it never paginates. Selected cards expose their
  pressed state to assistive technology. Other dialogs do not scroll.
  Copy and actions occupy a separate `.modal-copy` viewport;
  long content uses Previous/Next pages at its original text size, with whole
  controls. The one exception is the ☰ menu (`makeModalShell` `scroll`): a
  list thumbed through, it scrolls as one and is never paged. The saved
  games ("Load game") and the developer tools ("Developer") are pages of the
  menu (`_openMenuPage`): a second scrolling dialog with a Back row, its
  markup moved out of the hidden `#menu-pages` holder and home again. Content, expanded details, image loads, fonts and viewport changes
  trigger fitting again. Art and loading mosaics share the same crop.
  Framed opening stories without titles keep their separate 14-pixel rail gap.
  `css/compass_panels.css` seats this same shell as a mechanical sheet that
  slides up from the compass and extends to the viewport floor without a
  bottom border. Open sheets shade the exposed map and upper HUD with a dark
  mask beneath the panel; the mask does not intercept input.
  Shop/trade, story/event and conversation kinds carry distinct
  category headings; controls retain simple gold faces. Safe-area padding and
  pagination keep actions reachable. Reduced motion skips the slide. The
  `spirit` kind is the Dragon Spirit voice used by dormant module controls.
- The modal HUD gate also covers the isolated upper-temple scene. Its scene
  flag keeps inventory, movement pads and the objective hidden until shutdown,
  even when no DOM dialog is open; a reward dialog keeps the gate after exit.
  Shutdown reapplies the current camera scale to the paused surface before
  resuming it, so a viewport resize during a trial also fits the return map.
- Consumables may select a painting through `art`; timed buffs reuse it after
  use unless `used.art` overrides it. Dragon Powder uses `event_dragon_powder`
  only for the completed transformation. Lighting or relighting a Torch uses
  `torch_light`, a close-up of the flame catching.
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
- A new game opens close on Home (`HomeArea.INTRO`): the house fills the top
  half with the player in its doorway, held while Home is placed or a dialog
  is up, then a beat, then a slow pull back to the normal view. A finger on
  the map ends it early. Home's sign, "Home", is
  hidden until that beat and types itself out once per session; the cold
  firepit beside the door wisps smoke (`FIREPIT_SMOKE`).
- Map messages fit `MAP_MSG_MAX` (30 characters) per rendered line, including
  interpolations. Cut copy or use a modal; do not interpolate unbounded POI names.
- Statuses, buffs and timers on the player live in ONE place: the status
  row (`_syncStatusRow`, `STATUS_ROW_CSS`; under the top HUD, or on the
  compass skin's footer plate left of the joystick, `css/compass_hud.css`,
  where it never covers the round map), one chip per
  row of `Conditions.DEFINITIONS` (poison, burning, a trap's pin) and of `Buffs.KINDS`
  (`src/buffs.js`: a potion, powder, torch, coffee, the bike, the compass, a
  shrine boon — its expiry field, word and ink). A new timed effect is a
  row there; never a label over the player or a chip of its own.
  `Buffs.extend(save, scene, id, ms)` is the one writer of a row's expiry
  (max(now, until) + ms — a second dose extends, never resets or refuses). A status
  LANDING announces itself from those tables (`_announceStatuses`: the body
  flicks the row's ink, the word pops on the cell) — never at the writer.
  Food energy and condition notices stay separate; the food receipt must not
  repeat the condition announcement. A creature's status (sleep, charm, frost,
  fear, psychosis) is a row of
  `Combat.STATUS_LOOKS` and one `Combat.flagStatus` call at its applier;
  render.js flicks and pops it through `_popCreatureText`.
- Bearings on the map rim are rows of `MARKERS` (app.js). Each row's slot
  holds a list of marks, so any number of them show at once: several
  neighbours' directions, telescope finds, maps and the Pairy together. Writers
  add with `Buffs.withMark`: a mark on the same target replaces or extends,
  a new target adds a mark, and nothing refuses or clears another mark.
  The starter ladder's bearing (`STARTER_MARK`) is the same labelled dot,
  aimed per step by `_starterGuidanceGoal` rather than stored as marks.
- Map numbers use toast tiers: `_popEnergy(delta, { ix, iy })` for energy,
  `_popCellNumber` for other cell amounts, `_popDamageNumber` for foes. Name the
  affected cell; body changes default to the player. Body damage calls
  `_flashPlayerHit` when it lands, independently of popup throttling.
- A repeat offer (an offer with `repeat`: a stall counter, the smelter,
  Home Sell / Craft, a workbench) reopens over the map, hiding its own toasts. The
  confirmation lives in the dialog: an explicit `receipt` line, or else
  the `flashLoot` / `flash` toasts its accept raised, captured by
  `showOfferModal` and reprinted as the reopened dialog's status line.
  Never add a second confirmation surface for a repeat offer. Stories earned
  during an accept use the ceremony queue with `defer: true`: the gate tick
  waits for the refreshed shop to close. Duplicate keyed requests must also
  respect deferral rather than draining during the remove/remount gap.
- The Books read list remains a full mechanical panel with three entries per
  page. Reading or rereading a book puts live dark serif text, paged when
  needed, on `assets/art/book_page.webp`,
  a full-height illustrated half-book beneath the silver dragon rail.
  `bookPage: true` selects this surface without changing the shared `book_read`
  painting used elsewhere. Closing a reread returns to the same shelf page.
- Book stories use direct firsthand excerpts in quotation marks. Occasional
  narrator asides sit outside the quotation in italics (`bookPageHTML`), usually
  one short sentence. Vary length, format, mood and author voice across books;
  use `BOOK_VOLUMES` for named volumes and consistent author voices, and reserve
  humor for some passages. Scholars can quote any page early: foreshadow without
  revealing the player’s identity or the wizard’s secret. Preserve approved
  excerpts and keep `ITEM_GUIDE_TIPS` as the owner of shared item parables. Authors
  describe their world, not interface elements such as work circles or health bars.
- Every temple awakening and every temple trial win names the condition it
  met as a `Condition met:` line: the awakening story's body (the enemy count,
  or the shrine spirit for an enemy-free park), the gift card's `sub`, and a
  repeat win's note. Trial conditions are `TemplePuzzles.WIN_CONDITIONS` rows,
  passed through `Temples.complete(scene, o, condition)`.
- Story delivery separates required, ordered canon from optional, asynchronous
  lore (docs/design/story.txt, ACT STRUCTURE). Memory and restoration are independent
  progress tracks; required events join them through prerequisites and world
  context. A painted panel can carry either layer. Lore never blocks canon.
- Unprompted panels never interrupt an interaction. A memory, a story
  ceremony (`intro`, `prize`, `story` in `_enqueueCeremony`), a pet's first
  story, the fire breath and Maud's greeting wait behind the STORY HOLD
  (`_storyHeld`, asked through `MemoryStory.storyHeld`): a dialog is open, or
  the player tapped anything but the stick in the last `STORY_IDLE_MS`.
  Walking does not hold. The 📜 badge on the map's corner counts what waits
  (`_pendingStoryCount`); idling or tapping it starts a RUN that shows them in
  order, and only a tap outside a dialog ends it. A panel answering the
  player's own act (a receipt, a Book read, a neighbour's talk) asks only
  `_dialogOpen`. A new deferred lane asks the hold and adds to the count.
- The first road-repair panel shows the Hood working alone: “You Start Fixing
  The Roads” / “They are the arteries of civilization.” It keeps the existing
  50 m threshold and two-second delay. Neighbours enter the story at the first
  reward, headed “The survivors are watching”; later rewards use the thank-you
  heading. The first repair and first gift remain separate moments.
- A street variant tells its story once, on the feet's first entry
  (`_tickStreetFeet`). After that its map line (`StreetVariants` row `flash`)
  pops when a street of that kind enters the lit reach (`_tickStreetSight`,
  on its nearest lit cell) or the feet step onto it, on one per-story
  `STREET_FLASH_GAP_MS` clock.
  Medium roads tell the Old Trade Road story; large roads tell the Ancient
  Highway story. Their identities come from the mapped road class and have
  separate first-visit records, without assigning a street variant. The
  existing Old Trade Road record remains valid for returning players.
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
  they return with memories to a restored house, off screen, or — until one
  is assigned them — wait just outside Home's ring, beyond a stroll of the door
  (`homeWaitBand`);
  a named zone's keeper stays. The warden's home plea is a tap, never a splash.
  The stranger (Ayo in human form) is such a role, flagged `transient` so a
  talk never houses her; the lane's gossip about her is one extra page per
  neighbour per round (`MemoryStory.STRANGER_RUMOURS`, recorded in
  `save.memoryStory.strangerRumours`), not a line of its own.

Tests: `scene_art`, `duration_notation`, `copy_voice`, `energy_pop`, `hit_flash`,
`item_descriptions`, `books`, `story_neighbours`, `stranger`, `buffs`.

## Furniture

Placed furniture opens a dismissible `makeModalShell` panel with its 32×64 world
frame shown at exactly 4× above its name, rarity badge and description. The
portrait preserves the placed orientation; the category badge keeps the item icon.
The main action uses the catalog ability label: Wash, Sleep, Reflect or Plant.
Wash clears harmful conditions; Reflect opens a compact ten-swatch colour picker;
Plant explains how to select a seed and tap the pot. Abilities recheck the owned
Home cell at commitment; outdoor use refuses. Mirrorable pieces also offer Flip there; Pick up is a
ghost control in a separate top-right row. Flip saves the placed orientation and
updates the map and portrait. Pickup checks bag capacity and accepted quantity
before removing the placement, then refreshes inventory and persists explicitly.

Indoors, Home shows its current luxury as a white number above its sign. The
score updates immediately, separately from Home's introductory typing, and
fades when it overlaps the player.

Old Archive Court's existing style deterministically selects delivery or luxury
jobs without changing castle style assignment. The luxury card is titled
“A respectable address”, with “We don't admit rabble here!” beneath it: reach
16 luxury in the active Home for 60 coins. Opening, progress events and claiming
reread current luxury; placement does not accumulate quest progress. A decrease
before claiming blocks completion. Castle ownership stays permanent after claim.

Bed and Inn share `_presentSleep`: show the furniture frame or Inn booth art,
fade the camera to black, run the source transaction exactly once, then fade
back. `cameraBlackout` also supplies teleport's camera transition, without owning
its particles or movement guard. Headless scenes commit immediately. Bed sleep
rechecks the placed record, owned Home cell, lockout and missing energy at black.
Inn sleep retains payment, daily-use and failure checks; only success queues its
receipt. Both persist after the transaction.

## Schoolyard tile game

Schoolyard field flags start a round when walked onto. The HUD shows score,
seconds remaining, and an eastward shift countdown. Colored inset outlines
preview the next pattern, which wraps east by one tile every three seconds.
Blue gives one point per accumulated second on blue; red subtracts three per
accumulated second on red. Purple gives five immediately, then becomes blue
until the next shift. Pulsing brightness does not change a tile's scoring.
Rounds stop at 30 seconds of active play; dialogs, background tabs and being
downed pause the clock. Leaving the surface cancels the round. Final scores
remain visible until another round starts; leave and re-enter the flag cell to
replay. These scores are local minigame scores, not inventory currency.

### Home-bound memory events

Memory discoveries still bank immediately, but their queued narrative panels wait
until the player returns inside Home's surface ring. Pending memories survive
reload and are consumed only when acknowledged. The story badge counts them
only inside that ring (`_pendingStoryCount` asks `MemoryStory.atHome`), so it
never offers a panel the drain would refuse. Deliberately opened NPC and
wizard conversations remain tied to their own locations.

Home luxury thresholds 4/16/36/64/100 each bank one real memory once per save,
titled Living like a Neighbour / Craftsperson / Merchant / Noble / Monarch.
These domestic panels use the same Home ring, story hold and acknowledgement
queue as other memories. If the reward reaches a numbered story scene, its
domestic panel is followed by that scene without a second memory reward;
tower gates remain unchanged. Pickup and Home moves never remove earned milestones.

Maud's rescue unlocks at six lifetime memories, then waits for a home visit.
Her encounter is seated around Home, never around the travelling player; her
archer still obeys the normal Home ward and spawn gate. Existing remote rescue
placements move home without resetting rescue progress or granting a second gift.
