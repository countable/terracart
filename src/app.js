// Dragon Hood — gameplay layer on top of MVT-driven world.
// - Mobile-sized Phaser canvas (390x844). VIEW_CELLS-wide viewport of CELL_M (7 m) cells.
// - Real GPS (Geolocation API) if available + permitted; WASD fallback.
// - Tap player to lock/unlock GPS snap.
// - Random creatures spawn in grass/farmland cells (seeded per tile).
// - Tap creature → catch (added to farm). Tap ground with seed selected → plant.
// - Inventory bottom bar shows starter items; tap to select.

// Home — 3586 Athalmer Rd, Kelowna BC. The default world origin and where the
// satextract DeepForest trees live.
const HOME_LON = -119.47870;
const HOME_LAT = 49.85438;
// Teleport presets — well-mapped suburban areas to showcase OSM features
// (trees, street furniture, etc.). Counts are mapped natural=tree nodes within
// ~300 m, measured against Overpass on 2026-05-29. Edit this table to add/
// remove destinations; index.html builds the menu from window.TELEPORT_PRESETS.
// A preset relocates the world origin (START_LON/LAT) on reload and disables
// GPS for the session so the player stays at the chosen spot.
const TELEPORT_PRESETS = {
  home:     { name: 'Home (Kelowna)',   lon: HOME_LON,    lat: HOME_LAT   },
  paloalto: { name: 'Palo Alto, CA',    lon: -122.1500,   lat: 37.4222    },
  seattle:  { name: 'Seattle (Ballard)',lon: -122.3840,   lat: 47.6680    },
  munich:   { name: 'Munich, Germany',  lon: 11.6100,     lat: 48.1520    },
};
// Active teleport override (set by the menu, persisted in localStorage). Read
// once at load so the entire projection initializes for the chosen latitude.
let _teleportOverride = null;
try {
  const raw = localStorage.getItem('terracart.teleport');
  if (raw) {
    const o = JSON.parse(raw);
    if (o && Number.isFinite(o.lon) && Number.isFinite(o.lat)) _teleportOverride = o;
  }
} catch { /* malformed override → ignore, fall back to home/GPS */ }
// Per-save FROZEN home origin. Set once from the first GPS fix on a brand-new
// save (see startGps), then used as the world projection origin forever — so
// each save is anchored at the player's real location instead of a hardcoded
// city. Read here at module load (before the scene builds the projection) so
// the whole world initialises at the saved home. initSaves() points SAVE_KEY
// at the active slot; loadSave() then reads that slot's data. A teleport
// override still wins (it's an explicit relocation).
let _saveHome = null;
try {
  if (typeof initSaves === 'function') initSaves();
  const _sv = (typeof loadSave === 'function') ? loadSave() : null;
  if (_sv && _sv.home && Number.isFinite(_sv.home.lat) && Number.isFinite(_sv.home.lon)) {
    _saveHome = _sv.home;
  }
} catch { /* no saved home → fall back to teleport / HOME */ }
const START_LON = _teleportOverride ? _teleportOverride.lon : (_saveHome ? _saveHome.lon : HOME_LON);
const START_LAT = _teleportOverride ? _teleportOverride.lat : (_saveHome ? _saveHome.lat : HOME_LAT);
// Expose the preset table + active override so index.html can build the menu.
if (typeof window !== 'undefined') {
  window.TELEPORT_PRESETS = TELEPORT_PRESETS;
  window.TELEPORT_ACTIVE = _teleportOverride;
}
const VIEW_CELLS = 11;
const CELL_PX = 32;
// How far above the restored stretch the street counter sits. Just over half a
// cell, so the number clears the carriageway it belongs to without floating
// off into the cell above it.
const STREET_COUNTER_LIFT_PX = Math.round(CELL_PX * 0.6);
// Road ceremonies carry the survivors' thanks; progress stays on the road counter.
const TRAIL_PRIZE_HEADER = 'Thank you for repairing the roads!';
// The line under a road prize's card: who gave it, in one sentence. Shared by
// the single-reward ceremony and the card the pick opens for the kept gift.
const TRAIL_PRIZE_THANKS = 'Your neighbours thank you for repairing the road and hand you a gift.';
// The first repaired stretch introduces the neighbours who leave gifts.
const TRAIL_INTRO_TITLE = 'The survivors are watching';
// The tail of both "Without a tool" stories (_barehandWorkStory): the joke
// that carries the hint — a tool would be the easier way.
const BAREHAND_STORY_ASIDE = ' (but to be honest tools would be much less tiring!)';
const trailIntroBody = (playerClass) =>
  'You clear the rubble from the road. A survivor watches from a doorway, then brings you a gift.';
// …but not on the same beat as the repair. The first stretch to come back
// under a new player is a flash, a scatter of chips and a counter on the
// street itself, and a dialog opening over the top of that covers the very
// thing it is there to explain — the player reads "you start repairing the
// roads" having seen nothing happen. So the greeting waits this long and
// arrives to explain a moment the player has just watched. Long enough to
// outlast the repair's own beat (STREET_SHINE_MS, the blast's clock), short
// enough to still read as part of it.
const TRAIL_INTRO_DELAY_MS = 2000;
// …and not on the FIRST stretch either. One reach of street coming back is a
// single flash; a greeting that says "you clear the rubble from the road"
// over that one moment lands before the player has seen the repair as a
// thing they are doing. So the greeting waits until this much road is truly
// restored (Trail.restoredMetres — the road chip's own number, so the dialog
// and the chip agree on what has been repaired): one reach of street (five
// cells, 35 m, under the player's own feet) and a couple more cells along
// it, so the second flash is already in the player's eye — and still well
// short of the first prize (Trail.goalFor(0, …), 200 m or a runner's 100 m):
// the greeting is what introduces the neighbours who leave gifts, so it must
// land before the first gift does (trail.test.js pins both bounds). Tuned by
// feel (owner, Oct 2026): 60 m read as too long a wait, 40 m as too soon;
// it is not a milestone, only a beat past the first stretch.
const TRAIL_INTRO_MIN_M = 50;
// How long a stretch of street has to stay IN SIGHT — inside the lit reach,
// continuously — before it is rebuilt. Walking past a street at the edge of
// the bubble no longer harvests it in the frame it clips: the metres you bank
// are the ones you actually spent a moment beside. Leave the reach and the
// clock restarts from zero (Streets.createSight drops a key's whole history
// when it goes empty); the same reset covers the auto-walk home, which is the
// character moving itself and never the player looking.
const PATH_STONE_DWELL_MS = 3000;
// ONE ROAD AT A TIME: within each window this long, the restore sweep pays
// only the single way that restored the most (_oneRoadPay) — two parallel
// streets (or a street and its drawn pavement) come back together but pay as
// one. A dwell long, so a parallel way ripening a few frames behind its
// neighbour still falls in the same window.
const ONE_ROAD_WINDOW_MS = PATH_STONE_DWELL_MS;
// A RESTORATION'S BLAST (_blastAt): the flash a stretch coming back throws, in
// cells. Inherited at 2.5 from the old per-pebble flash — one stone lighting
// up — but a sweep restores a whole STRETCH and fires once for all of it, and
// at that radius the moment read as an explosion on a street the player was
// only walking along. Repairing a road is steady work, not a detonation: the
// flash is a nod, and the chips, the sparks and the setts pulling themselves
// back together carry the rest of it.
const BLAST_STONE_R_CELLS = 1.5;
// The white SHINE that ran down a stretch the instant it was rebuilt, in ms.
// Its OWN clock, not Lighting.BLAST_MS (900 — every OTHER blast in the
// game, a house included, still uses that default): a street repair reads as
// a slower, more deliberate "coming together" than a house's — this is the
// moment the player has been standing still for two seconds to earn, and a
// sub-second flash undersold it. _blastAt is handed this length explicitly
// (durationMs) at the one call site that uses it, so the lightmap flash runs
// on the street's own longer beat instead of borrowing the generic default.
// 2.4× the old 900 ms. It outlives the shine it was named for: with the run
// switched off (below) this is what the length of the moment now means.
const STREET_SHINE_MS = 2200;
// How bright that shine starts. Well under full white: opaque white at trunk
// road widths whited out the carriageway every time a sweep landed.
//
// SWITCHED OFF (Sep 2026), the twin of the dwell preview's own switch above:
// a white run over the new carriageway is the same glow arriving one beat
// LATER than the preview's, and between them the whole repair was announced
// in light rather than in stone. What is left is the material — the flash's
// nod, the chips, the sparks and the gather — so the moment reads as the
// street being put back rather than lit up.
// ZERO IS THE SWITCH, exactly as STREET_PREVIEW_ALPHA is: the ripen pass
// stops recording runs and the live pass stops walking them, so putting 0.4
// back is the whole of turning it on again. Nothing about the restoration
// itself is touched — the stretch comes back on the same beat, unshone.
const STREET_SHINE_ALPHA = 0;
// THE GATHER's sink: how many points to spread `_ripenStreets`'s stonegather
// burst across the LONGEST newly-restored piece (_streetSpreadPts), so the
// setts visibly pull together along the whole stretch rather than converging
// on one dot of it. Six reads as "the length", not "a row of six pebbles" —
// particles.js deals stonegather's own count round-robin across them, so
// raising this thins how many land on each point rather than adding more
// particles overall.
const GATHER_SPREAD_POINTS = 6;
// THE STREET LAMPS. A restored street lights its own way: one glowing cobble
// every Streets.lampSpacingM() metres of rebuilt carriageway (its own
// constant, LAMP_SPACING_M — deliberately NOT the treasure ladder's rung, so
// an ordinary block shorter than a rung still qualifies). Where they stand is
// generated from the way's geometry and never stored (streets.js); the lamp
// itself is baked art (RoadOverlay.paintLamp) and the light it throws after
// dark is Lighting.KINDS.cobble, on the same point — lifted off it to the
// LANTERN, which is where a lamp burns (RoadOverlay.LAMP_LANTERN_RISE_CELLS).
const STREET_LAMP_TEX = 'street_lamp';
// …and ONE BAKE PER GLOW COLOUR, never per lamp. A lamp sheds its street's
// colour (StreetVariants.lampGlowFor off the street index — the same value
// Lighting.collectLamps throws, carried on the lamp entry as `glow`), so the
// baked art is keyed by that colour: the default UI_LAMP_GLOW keeps the plain
// STREET_LAMP_TEX key it always had, any other glow is `street_lamp@#rrggbb`.
// The handful of theme colours is the whole store, however many lamps.
function streetLampTexKey(glow) {
  const g = (typeof glow === 'string') ? glow.toLowerCase() : '';
  return (!g || g === String(UI_LAMP_GLOW).toLowerCase()) ? STREET_LAMP_TEX : `${STREET_LAMP_TEX}@${g}`;
}
// WHERE THE ART SITS ON THE POINT. The baked lamp STANDS on its point: its
// plinth, its shadow and its pool of glow are all on the square's ground line
// (RoadOverlay.LAMP_GROUND_FRAC), which is below the middle because a lamp is
// mostly post — so the sprite's origin is that line rather than its centre,
// and the lamp stands on the point rather than hovering a post's height over
// it. The light lighting.js stamps is on that same one point, lifted to the
// lantern the way the art rises to it (see the note at RoadOverlay.paintLamp).
// The dark cobble is a stone LYING on the point and keeps a centred origin;
// one RENDER_SPEC row draws both arts, so the origin is picked per lamp beside
// the texture (render.js RENDER_SPEC._streetlamp).
const STREET_LAMP_ORIGIN_Y =
  (typeof RoadOverlay !== 'undefined' && RoadOverlay.LAMP_GROUND_FRAC) || 0.62;
// …and then a nudge, by eye: the seated lamp read as standing a hair proud of
// the verge it is on, so the POST is drawn a few screen pixels lower — three,
// until the base still sat a shade low in its cell and the whole art came up
// two (to one); now nudged back down 2px, to three, having read a shade high
// again. The ART alone moves. The lamp's POINT does not — the verge offset that
// stands it clear of the carriageway (STREET_LAMP_R_CELLS → Streets.lampOffsetM)
// and the light lighting.js stamps on that point are both unmoved, which is why
// this is a draw offset on the sprite (RENDER_SPEC._streetlamp's dyPx) and not a
// shift of LAMP_GROUND_FRAC: moving the art's own ground line would take the
// baked pool of glow and the plinth's footprint down with it and re-open the
// question of where the lamp actually stands. The dark cobble keeps its seat
// — it LIES on the point, and a stone in the road has nothing to stand proud
// of.
const STREET_LAMP_DY_PX = 3;
// Unrestored streets carry a SNAPPED-OFF lamp post: the same casting as the
// lit lamp (RoadOverlay.paintBrokenLamp — its plinth, base and a column broken
// off below the lantern, in weathered metal, no glass and no glow), baked at
// runtime into STREET_LAMP_BROKEN_TEX exactly as the lit lamp is baked for
// its glow (_ensureBrokenLampTex beside _ensureStreetLampTex), and drawn at
// the same size, on the same ground line, with the same nudge — so the lamp
// that lights is visibly the lamp that stood broken. Until Oct 2026 the dark
// lamp was a 16 px frame of the old cobble sheet at a quarter the size and
// 57% alpha: a smudge beside the lit one (owner's call).
const STREET_LAMP_BROKEN_TEX = 'street_lamp_broken';
// THE SITE'S FOOTPRINT. RoadOverlay.LAMP_DARK_CELLS is the width the old
// cobble stone drew at, and it is still what RoadOverlay.LAMP_SITE_R_CELLS
// (the verge offset every lamp is placed by, and the cells rasterization
// reserves) is derived from — so every lamp stands exactly where it always
// has. It sizes no art any more; it is kept as a placement constant only.
const STREET_LAMP_DARK_CELLS = RoadOverlay.LAMP_DARK_CELLS;
// THE LAMP STANDS ON THE VERGE, and this is the art's own footprint radius in
// cells — what _streetLampsForTile adds to half the carriageway
// (Streets.lampOffsetM) so the art just touches the band's edge instead of
// standing in the traffic. It is the WIDEST of the two arts one lamp can
// wear, because either of them may be the one showing: the baked lamp's
// plinth (RoadOverlay.LAMP_FOOT_R_CELLS) and the dark cobble a lamp draws
// before it lights (STREET_LAMP_DARK_CELLS, a full width, so half it).
// Deriving it from the sizes the draw pass actually uses is what keeps a lamp
// touching the kerb when either art is resized.
const STREET_LAMP_R_CELLS = Math.max(
  ((typeof RoadOverlay !== 'undefined' && RoadOverlay.LAMP_FOOT_R_CELLS) || 0.204),
  STREET_LAMP_DARK_CELLS.road / 2,
  STREET_LAMP_DARK_CELLS.path / 2);
// How faint the DWELL PREVIEW gets at its fullest — the ghost of the clean
// carriageway creeping in under the player while the dwell runs. It was well
// under half (0.55), because the preview is a promise, not the thing: at the
// instant it completes the restored canvas takes over at RESTORED_ALPHA (0.92)
// and the step up is what reads as "done".
//
// SWITCHED OFF (Sep 2026) to see the restoration without it: the glow ramping
// in ahead of the repair announced every stretch a second and a half before
// anything happened to it, so the blast — the moment the street actually
// comes back — landed on ground the eye had already been told about. (The
// shine that followed the blast is switched off too now, for the same reason
// one beat later; see STREET_SHINE_ALPHA above.)
// ZERO IS THE SWITCH: the whole preview hangs off this one number (the live
// pass skips the block, and its own gate would drop the runs anyway), so
// putting 0.55 back is the whole of turning it on again. The dwell itself is
// untouched — a stretch still ripens after PATH_STONE_DWELL_MS in sight; it
// just does it unannounced.
const STREET_PREVIEW_ALPHA = 0;
// The preview's COLOUR — the pale street ink (UI_STREET_INK), never the
// finished road's own near-black. A growing wash of RESTORED_ROAD_COLOR over
// the dilapidated band reads as a stain creeping in, not as work being primed:
// the same ink the counter and the chips are drawn in is what says "this is
// the restoration material arriving", so it's lit rather than darkened (the
// street lamp is deliberately NOT this ink — see UI_LAMP_GLOW in util.js).
// The shine that followed it (below, switched off now) was stroked in flat
// white for the same reason — nothing about the live pass should read as a
// shadow.
const STREET_PREVIEW_COLOR = parseInt(UI_STREET_INK.slice(1), 16);
// The counter pops at most this often. A wide reach walked along a street
// restores metres on nearly every frame, and a "137/200 m" re-drawn sixty
// times a second is a flicker rather than a readout. The ladder still banks
// every frame — only the toast waits.
// How far a street restore's blast and counter trail the restore itself —
// two loop steps at FPS_LIMIT, so the emitter and the toast's text texture
// land on neither the restore's frame nor the overlay repaint after it. See
// _afterRestoreBeat.
const RESTORE_FX_DELAY_MS = 70;
// How long a restored wreck gathers itself (the road's `stonegather`) before
// the blast and the Restored! card. See _afterWreckGather.
const WRECK_GATHER_MS = 1000;
const STREET_COUNTER_MIN_MS = 1000;
// A BUILDING'S BLAST: how far past the footprint's own half-diagonal the flash
// reaches, in cells. Two, so the light clears the roof and the street either
// side of it — a restored house is the biggest thing the player has done all
// session and it should read from across the block.
const BLAST_HOUSE_PAD_CELLS = 2;
const WALK_M_S = 1.4;
// SLOW GOING: the most the body may cover per second while its feet are on a
// Burned Row's tar pit or iron stakes (see _bodyHold) — a little under the
// walk, so the body drops behind a walking fix and the catch-up ramp
// (FOLLOW_RAMP_M) brings it back once it is off the patch.
const SLOW_BODY_M_S = 1.2;
// A variant street's map line (StreetVariants row `flash`) repeats no more
// often than this per street kind, after its story has been told.
const STREET_FLASH_GAP_MS = 60000;
// TIRED WALK: how far the walk CYCLE's pace sags once energy drops below
// Lighting.LOW_ENERGY_FRAC (30%) — 1 = full frameRate at the threshold, and
// this is the FLOOR it eases toward at 0 energy (_playDirected). It reads
// Lighting.lowEnergyFrac(this) — the same 0..1 "how tired" weight the reach
// tint's alpha uses — so the animation drags in exact step with the red
// flush, never as two separate readings of the same bar. This does NOT touch
// WALK_M_S: the body still covers ground at its usual pace, only the legs
// visibly labour to do it.
const WALK_TIRED_SLOW_MUL = 0.5;
// Auto-walk catch-up ramp (see _followStep): metres of body-to-target gap that
// buy one extra × of walk pace. The body chases at (1 + dist / this) × walk,
// capped at DEBUG_SPEED_MUL, so a small gap is closed at a stroll and a big one
// at a run. It was one CELL (7 m) per ×, which put full speed 63 m out — most
// of GPS_SNAP_M, so an ordinary walking fix landing 20-30 m ahead was chased at
// half pace and the character spent the whole gap visibly behind the player.
// 4 m per × reaches the cap at 36 m instead, which is inside the range a real
// fix actually lands at. Not a cell multiple on purpose: this measures GPS lag,
// which has nothing to do with the grid.
const FOLLOW_RAMP_M = 4;
// DETOUR COMMITMENT (see _detourDir): once the body picks a side to walk round
// a wall, it keeps that side for as long as it keeps jogging, and this long
// after the last jog. Re-reading the side every frame made the body vibrate
// behind a one-cell rock: the first sidestep flips the target's lean. Long enough to see a half-cell jog through
// against the follow step pulling it back toward the line; short enough that
// the next wall along gets a fresh choice.
const DETOUR_COMMIT_MS = 1000;
// ─── The peek drag (see the PEEK DRAG block on the scene) ────────────────────
// Maximum with a carried telescope, in cells. Three cells is a
// little over half the 5.5-cell half-view: enough to see what the frame was
// cutting off without the character leaving the map, and far inside the loaded
// 3×3 tile neighbourhood every world pass scans.
const PEEK_MAX_CELLS = 3;
// Screen pixels a pointer must travel before it stops being a tap and becomes a
// drag. Below this a finger that rolled a little on the way down still taps the
// thing it landed on; above it nothing is tapped, however the drag ends.
const PEEK_DRAG_SLOP_PX = 8;
// Spring-back time constant once the finger lifts. An exponential ease, so this
// is the 1/e time rather than a duration — the camera is home (sub-pixel) in
// about 3× this.
const PEEK_RETURN_MS = 90;
// Surface GPS gap (metres) past which a fix PLACES the body instead of being
// walked off. The body chases the GPS target at up to DEBUG_SPEED_MUL × walk
// pace (14 m/s), which comfortably keeps up with a real walk or a slow drive;
// anything beyond this is a vehicle trip or a backgrounded tab catching up —
// travel the player never made on foot, so walking it back would be a
// minutes-long trek across terrain they aren't on any more. 200 m is roughly
// 15 s of that chase, and about three screens of the 11-cell view.
// Underground is exempt: down there the body mines its way to the target no
// matter how far, and a snap would drop the player inside solid rock.
const GPS_SNAP_M = 200;
// The SNAP's own cut — a placement past GPS_SNAP_M moves the body somewhere
// the player never walked, so it earns a transition rather than the world
// just resetting under them mid-frame: a small burst where they're standing,
// a fade to black, the placement itself hidden behind it, then a fade back in
// on the result. TELEPORT_FADE_OUT_MS + TELEPORT_FADE_IN_MS is the whole cut,
// 2000 ms — long enough to read as a trip rather than a flicker, short enough
// that it's over before the player wonders what happened. See _teleportCut.
const TELEPORT_FADE_OUT_MS = 700;
const TELEPORT_FADE_IN_MS = 1300;
// Backoff for re-fetching a 3x3 tile block that came back short (see
// _scheduleTileRetry). The floor clears WorldGen's own per-tile failure
// backoff (TILE_RETRY_MS, 3 s) so a retry isn't answered from it, and the cap
// keeps a genuinely offline session down to one attempt a minute rather than
// hammering a host that isn't answering.
// How long a neighbouring tile's build will wait for an idle moment before
// going ahead anyway (see _whenIdle). Long enough that a player actively
// walking and tapping keeps the thread, short enough that the ring is all in
// well before they could walk out of the centre tile.
// How many coins a pot of gold bursts into is its DENSITY on its tile
// (loot.js potCoinsFor off POT_COINS_BY_DENSITY: a lone ATM 30, one of 50 on
// the tile 3, one of 150+ a single coin). The scatter search widens until it
// can seat them (see _coinBurstInteract) — a burst that came back short was
// the search giving up, never the reward being small. Up to
// COIN_BURST_NEAR_PLAYER of them (a quarter of the burst at most, so a
// one-coin burst lands by the pot) land around the player's own feet
// (within COIN_BURST_NEAR_R cells), so a burst always puts coins in reach —
// whatever the ground around the pot itself is like.
const COIN_BURST_NEAR_PLAYER = 3;
// WHERE A COIN MAY LIE: where the SHARED SPAWN RULE says (WorldGen.isSpawnCell
// — walkable, off the road band, under nothing, and on residential ground only
// near a public anchor), on the player's SIDE of any major road (sameSideAs).
// A burst's SCATTER round the pot is a timed reward — an 'attractor' spawn
// (OPEN ground only: never by a house, a school or a major road's kerb); the
// few coins at the player's own feet are 'minor' (the player is already
// there). Both are per-player, so both read the live private-ground veto
// (WorldGen.privateVetoAt — fences, private areas; none when the fetch fails).
// SAFETY: a coin never lies on a road or in a yard (the strongest "run into the
// street" push the safety audit found), and it waits COIN_BURST_LIFE_MS.
// How long a burst's coins wait for you. No timed reward is shorter than ten
// minutes: nothing is worth hurrying across a street for.
const COIN_BURST_LIFE_MS = 10 * 60 * 1000;
const COIN_BURST_NEAR_R = 2;
// THE SHOWER (_rainOver): how many cells above the ground each rain burst
// starts, and the most bursts one soak scatters (the 20 m rainberry disc is
// ~26 cells; a bigger radius still stops here).
const RAIN_DROP_CELLS = 4;
const RAIN_MAX_POINTS = 32;
// THE SAFETY CARDS (_showSafetyCard): what each reminder says, and when it
// comes back. Kept here as data so the copy is one table. The opening
// (LAUNCH) message is NOT here: it IS the loading screen (index.html
// #bootload › #safety, owner, Sep 2026 — read while the wagon packs, and
// acknowledged by the Go to my location tap), so these are the two REMINDERS.
const SAFETY_RESUME_GAP_MS = 5 * 60 * 1000;   // back after 5+ minutes away
const SAFETY_DUSK_DAYLIGHT = 0.5;             // Lighting.daylight: the sun on the horizon
const SAFETY_TICK_MS = 30000;                 // how often dusk is asked
const SAFETY_CARDS = {
  resume: { title: '⚠ LOOK UP',
    lines: ['Welcome back. Check your surroundings before you walk on.',
      'Out of reach? Use the stick — never the street.'] },
  dusk: { title: '⚠ IT IS GETTING DARK',
    lines: ['Stay on lit pavements and paths, and be seen.',
      'Out of reach? Use the stick — never the street.'] },
};
// A HEADS-UP BUZZ (wanderCreatures): the phone vibrates when a hostile that
// is taking an interest comes within SAFETY_FOE_BUZZ_CELLS of the feet, at
// most once per SAFETY_FOE_BUZZ_GAP_MS — so a player whose eyes are on the
// street still learns something is coming. The save's haptics switch mutes it.
const SAFETY_FOE_BUZZ_CELLS = 5;
const SAFETY_FOE_BUZZ_GAP_MS = 20000;
const SAFETY_FOE_BUZZ = [70, 60, 70];
// Save fields written by the passes that run BEFORE a home is captured — the
// starter crate anchor, the guaranteed soil plot and the starter-home
// provision. Every one of them is DERIVED from the projection origin and is
// rebuilt from scratch at a new one, so none of them commits the save to the
// origin it was built at.
//
// They are cleared together by the capture path and skipped together by
// _worldPlaced(), off this one list, because the bug was exactly the two
// disagreeing: the 2-minute safety net freezes the crate anchor at the default
// origin, and _setStarterCratesAt places the trail, which carves the plot and
// provisions the home. Only starterCratesAt was treated as provisional, so the
// net's own side effects made _worldPlaced() true within a frame of it firing —
// and the very next GPS fix, the one the net had deliberately stayed armed for,
// was thrown away. A player whose first fix took over two minutes (a cold
// start indoors, a new install, a permission dialog left sitting) was anchored
// at the default map for good, with their crates, Home and objective arrow a
// city away and no warning under ORIGIN_STRANDED_M.
const PROVISIONAL_ORIGIN_KEYS = ['starterCratesAt', 'starterPlotAt', 'starterHome', 'starterPondAt'];
const W = 352, H = 844;   // 352 = VIEW_CELLS × CELL_PX → map view fills the canvas edge-to-edge with no horizontal padding

// ── Dev knobs on the URL ─────────────────────────────────────────────
// For A/B runs of the load profile (☰ › Load profile) on the phone that is
// actually slow — two runs of the same walk, one number changed:
//   ?fps=N     cap the game loop at N steps/s (0 = the display's own rate)
//   ?rscale=N  cap the canvas backing store at N× the logical grid
// Read once at load; a PWA launch carries no query, so neither can stick.
function urlNumParam(name) {
  if (typeof location === 'undefined') return null;
  const m = new RegExp('[?&]' + name + '=(-?[0-9.]+)').exec(location.search || '');
  return m ? Number(m[1]) : null;
}
// The loop's own cadence. Phaser steps at the display's refresh rate by
// default — 60 on most phones, 90 or 120 on many recent ones — and a GPS
// walker whose body takes most of a second to cross a cell has nothing that
// needs a step every 8 ms. Every pass in _updateTimed, the lightmap upload
// and the GPU's fill all scale with the step count, so this cap is the
// single biggest CPU/battery lever the game has. Phaser still takes a rAF
// every vsync and skips the step until the cap's interval has accumulated
// (TimeStep.stepLimitFPS in vendor/phaser.js), so `delta` stays honest and
// nothing time-based (tweens, anims, the peek spring) changes speed.
// Device preference: opt in before Phaser allocates its FX framebuffer pool.
const GRAPHICS_FX_ENABLED = (() => {
  try { return localStorage.getItem('terracart.graphicsFX') === '1'; }
  catch { return false; }
})();
const FPS_LIMIT_DEFAULT = 30;
const FPS_LIMIT = (() => { const v = urlNumParam('fps'); return v == null ? FPS_LIMIT_DEFAULT : Math.max(0, v); })();
// What Phaser is actually handed. stepLimitFPS sums the rAF deltas and steps
// once the sum reaches 1000 / limit, then drops the remainder — so a cap that
// is an exact multiple of the vsync (30 on a 60 Hz display: two 16.67 ms
// frames sum to 33.33 against a 33.33 gate) fires on the second frame or the
// third as the float falls, and the first phone profile measured ~23 steps/s
// under a "30" cap. One fps of slack puts the gate a millisecond under the
// two-frame sum, so it fires on the second frame every time: 30/s on a 60,
// 90 or 120 Hz display alike. ?fps=0 stays 0 — no cap.
const PHASER_FPS_LIMIT = FPS_LIMIT > 0 ? FPS_LIMIT + 1 : 0;
if (typeof window !== 'undefined') window.__renderScaleCap = urlNumParam('rscale');

// ── Canvas resolution ─────────────────────────────────────────────────
// W × H is the LOGICAL grid — the coordinate system every other line in this
// codebase thinks in. It is NOT the canvas's pixel count.
//
// The backing store and camera use the same scale, capped at 2 game pixels
// per logical pixel. Full DPR-3 rendering allocated 1179×2826 on a 393px
// phone, including the offscreen part of the logical box. The cap reduces
// that to 704×1688 (64% fewer pixels) and bounds render targets on resize.
// CSS still lays out the same game grid; pointer coordinates divide by the
// camera scale. High-DPR phones trade some geometric sharpness for memory.
const RENDER_SCALE_MAX = 2;
// Never below 1 — a viewport narrower than 352 CSS px still gets the full
// logical grid rather than a canvas coarser than the one it replaced.
function renderScale() {
  const css = window.__gameCssScale || 1;      // published by index.html fitGame
  const dpr = window.devicePixelRatio || 1;
  // ?rscale=N (see urlNumParam) lowers the cap for one run — the A/B that
  // tells GPU fill from main-thread cost, which no JS timer can measure.
  const cap = window.__renderScaleCap > 0 ? clamp(window.__renderScaleCap, 1, RENDER_SCALE_MAX) : RENDER_SCALE_MAX;
  return clamp(css * dpr, 1, cap);
}
// Live value: read by the pointer conversion below and re-applied on resize.
// A `let` because devicePixelRatio changes when a window moves between
// monitors and fitGame's scale changes on every resize and rotation.
let RENDER_SCALE = renderScale();
// Point a camera at the logical grid. Origin (0,0) makes Phaser's camera
// matrix a PURE scale — with the default 0.5 origin the same result needs a
// compensating scroll of (W/2)(1-zoom), a second number to keep in sync for no
// gain. Scroll stays 0, so logical (x, y) is device (x·RENDER_SCALE, ···).
function applyRenderScale(cam) {
  cam.originX = 0;
  cam.originY = 0;
  cam.setScroll(0, 0).setZoom(RENDER_SCALE);
}
// The dialog frame (STORY_MODAL_GROW_PX, the scene-art ART_* constants) and
// the MODAL_KINDS table live in modal_shell.js with the shell that reads them.

// ── Toast style ────────────────────────────────────────────────────────────
// One dark chip for every in-world message, and one four-step type scale. The
// old code had #000a, #000c and rgba(0,0,0,.6) for what was meant to be the
// same chip, and 12 / 16 / 22 / 26px picked independently per call site.
//
// The four tiers are the distinctions worth keeping:
//   note    — "that didn't work", small status. Lands where the player TAPPED
//             so it stays attached to the thing they touched. No pop: a status
//             message that animates in reads as more important than it is.
//             The only tier with NO chip (bg: null) — it sits ON the map at
//             the tapped cell, and a dark box there hides the thing the
//             message is about. A drop shadow lifts it off the ground instead.
//   sub     — a second line under a fanfare. Fades rather than pops so it
//             doesn't compete with the headline it belongs to.
//   gain    — "you got something". Centred, pops in, can carry an icon.
//   fanfare — jackpot / shiny. Biggest, keeps its own chip colour, overshoots
//             and settles, and stacks ABOVE a gain (hence the depth gap).
//   cell    — a NUMBER ON THE CELL it belongs to: "+N⚡" / "−N⚡" on the tilled
//             plot, the felled tree or the player's own cell for a rest tick
//             or a slime's leech (_popEnergy), "+1" on the cell a coin was
//             picked from (_popCellNumber). No chip, like a note, because it
//             sits on the map over the very thing it is about; but it is bold,
//             STROKED and drop-shadowed, because that thing can be any ground
//             at all (a road, a snowfield, a lit plot) and the number has to
//             read against every one of them. Short and quick: a job pays one,
//             a rest ticks one a second, and they must not pile up.
//   damage  — the "-N" over a foe as a hit lands (_popDamageNumber). The cell
//             tier's dress at the health bar's scale (it sits ON the bar, so it
//             is the smallest text on the map) and the cell tier's stroke and
//             shadow, because a foe stands on any ground too; quicker still,
//             since a melee wheel lands one every beat, and it does not stack
//             (a scatter of its own keeps back-to-back hits apart).
//
// dy is the offset from the viewport centre, and the ladder of values is what
// lets a gain and a fanfare fired in the same moment stack instead of overlap.
const TOAST_BG = '#000c';
const TOAST_TIER = {
  // pad here buys no visible chip — it stops Phaser cropping the shadow's
  // blur at the glyph bounds, which is what makes an un-chipped Text look
  // like its shadow has a straight edge cut through it.
  note:    { font: '12px',      stroke: 0, pad: 6,  padY: 4, depth: 100, dy:  -70,
             bg: null, shadow: { offsetX: 1, offsetY: 1, blur: 4 },
             pop: 0,   hold: 1300, fade: 700, rise: 30 },
  cell:    { font: 'bold 13px', stroke: 2, pad: 6,  padY: 4, depth: 100, dy:  -70,
             bg: null, shadow: { offsetX: 1, offsetY: 2, blur: 3 },
             pop: 90, popScale: 0.7, hold: 700, fade: 500, rise: 14, ease: 'Sine.In' },
  damage:  { font: 'bold 11px', stroke: 3, pad: 6,  padY: 4, depth: 96,  dy:  -70,
             bg: null, shadow: { offsetX: 1, offsetY: 2, blur: 3 },
             pop: 90, popScale: 0.7, hold: 90, fade: 520, rise: 13, ease: 'Sine.Out' },
  sub:     { font: 'bold 16px', stroke: 3, pad: 8,  padY: 3, depth: 110, dy: -142,
             pop: 0,   fadeIn: 240, hold: 1800, fade: 700, rise: 60, ease: 'Sine.In' },
  gain:    { font: 'bold 22px', stroke: 3, pad: 10, padY: 5, depth: 101, dy:  -90,
             pop: 140, popScale: 0.6, hold: 1440, fade: 700, rise: 50, ease: 'Sine.In' },
  fanfare: { font: 'bold 26px', stroke: 4, pad: 14, padY: 6, depth: 110, dy: -150,
             pop: 220, popScale: 0.2, overshoot: 1.1, hold: 1800, fade: 700, rise: 60,
             ease: 'Sine.In' },
};

// Inventory category tabs (the top bar of the two-bar bottom HUD). The order
// here is the on-screen left→right order. The table itself (INV_CATS /
// INV_CAT_BY_KEY / invCatForItem) is a map over item KINDS, so it lives with
// the catalog in items.js.
// Slot draw order within each gear tab (owned slots only are rendered).
const INV_RELIC_ORDER = ['pickaxe', 'axe', 'sword', 'dagger', 'lance', 'bow', 'musket', 'staff', 'watering_can', 'hoe', 'net', 'fishing_rod', 'bag'];
const INV_ARMOR_ORDER = ['helmet', 'chestplate', 'leggings', 'boots'];
// Only the active weapon auto-engages or auto-fires in _combatTick;
// the others sit inert until switched to (the Equip button under the Relics
// tab — syncEquipButton — or obtaining/forging a new one — see Gear.equip).
// Melee needs no weapon at all: bare hands auto-engage like a sword whenever
// no ranged weapon is equipped (Gear.meleeActive).
const WEAPON_SLOTS = Gear.WEAPON_SLOTS;

// Where fauna may NEVER step (WATER / buildings / roads / cave wall) is
// Combat.faunaBlocksCell, beside the creatures it governs.
//
// The MONSTER table is Combat's too — Combat.MONSTERS / Combat.monster(kind) —
// with the giants and the cave doubling derived there, registered at load. It
// lived here until Sep 2026, which meant combat.js could only answer about a
// real foe once app.js had booted and handed the table over, and every
// headless test of one ran on a copy lifted out of this file by regex.

// The trapper's interval and wind-up live on its enemy roster row. A laid
// snare may occupy a point on the approach up to this many cells beyond the
// row's preferred distance; the AI still acquires targets at declared range.
const TRAPPER_LAY_SLACK_CELLS = 2;
// THE MAGIC TRAP (traps.js MAGIC TRAP note): what it does to the enemy that
// steps on it, both DERIVED —
//   the HOLD is one staff beat (Combat.fireIntervalMs('staff'), 5 s): long
//   enough that the slowest weapon the player owns lands a shot on a foe that
//   cannot step out of the line. It is the Frost Powder's freeze
//   (c._frozenUntil) — one lane, a second reason.
//   the DAMAGE is one tier-2 bow shot (Combat.shotDamage at the item's own
//   BASE_TIER): the trap is a tier-2 weapon that fires once.
const MAGIC_TRAP_HOLD_MS = Combat.fireIntervalMs('staff');
function magicTrapDamage() {
  return Combat.shotDamage({ bow: { tier: BASE_TIER.magic_trap } }, 'bow');
}
// How often the trap scan runs. Foes step on a multi-second beat, so ten
// times a second can never miss one crossing a cell.
const MAGIC_TRAP_TICK_MS = 100;

// What a kill pays — enemyBounty, MONSTER_TREASURE_CHANCE,
// ELITE_TREASURE_CONTEXT and eliteRollBonus — is Combat's, derived from the
// same HP pool the fight drains (Combat.ENEMY_COIN_PER_HP).

// What a tame pet hunts is its row's `prey` in SpriteLayout.CREATURE_BEHAVIOUR
// (still a hoisted Set, so wanderCreatures' per-step scan allocates nothing) —
// beside what else that kind does, rather than in a pair of consts here that
// only the one scan could find.
// The creature-AI helpers (slime gait, flee / stalk pacing, ghosts, monster
// rout and wander-off, wardTrip) live in src/creature_ai.js, loaded before this file.
// ── The doorstep greeter ─────────────────────────────────────────────────────
// Where the mode's guaranteed creatures are seated around the starting trailer
// (`_placeHomeGreeter`). WHAT is seated, HOW FAR out and in WHICH DIRECTIONS
// are all the mode's to say — `homeGreeter` / `homeGreeterCells` /
// `homeGreeterDirs`, one row in the difficulty table (easy: one chicken close
// by; hard: a slime on each side, well out). These are the PLACER's own limits,
// and they hold whatever the row asks for.
// Chebyshev cells throughout, so every band here is a square ring.
// The floor keeps a greeter off the player's own cell and out of the trailer's
// doorway — a creature spawned underfoot would be on top of the player before
// the first frame drew.
const HOME_GREETER_MIN_CELLS = 2;
// The ceiling is the sim bubble: past it a creature is frozen at its seat (see
// CREATURE_SIM_CELLS), so a greeter out there would be a statue until the
// player walked at it — which is not a greeting. Derived, never retyped, so
// widening the bubble takes the ring's ceiling out with it.
const HOME_GREETER_MAX_CELLS = CREATURE_SIM_CELLS;
// How far off its ideal seat a greeter may be nudged to find legal ground —
// around a road band, a pond, a sprite already standing there. Small on
// purpose: a direction the tile cannot seat within this is left empty rather
// than filled by a creature that has wandered into some other direction's
// arc. The ceiling above still clamps the result.
const HOME_GREETER_SLACK_CELLS = 2;
// The compass points `homeGreeterDirs` names, as cell offsets. The name is
// what goes in the creature's id, so a seat the player dealt with stays dealt
// with per direction (save.caught is checked by id).
const HOME_GREETER_DIR_VEC = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
// ── Home is pest-free until the first harvest ────────────────────────────
// A slime sits on your crops and drains SLIME_LEECH_ENERGY a second, a crow eats the
// crop outright, and the opening session is the one stretch a player has
// nothing to answer either with: no weapon, no relic, an empty bag and a
// ladder telling them to stand still and till. Meeting a pest there is not a
// fight, it is the tutorial being interrupted — so until the save's FIRST
// CROP IS HARVESTED (save.hasHarvested, stamped at the harvest site in
// interact.js) the fauna spawner seats no slime and no crow anywhere near the
// starting anchor. It is a spawn rule, not a cull: the same number of each
// spawn per tile, they just land outside the home area (the count is
// preserved by retrying the cell, see tryPlace), and the rest of the map is
// as it always was — walk a couple of hundred metres and there they are.
//
// Baked into the tile at build time, so a tile built during the grace period
// keeps its clear home area until it is rebuilt: no pest pops into being at
// the player's feet the moment the first crop comes in.
//
// Chebyshev radius of the amnesty, in cells. The starter home's own ring
// reaches 16 (HomeArea.RING_MAX_CELLS) and the relic chest sits at 11, so this
// covers everything the opening asks a player to walk to, plus a few cells
// so a pest isn't spawned right on the edge of it.
const PEST_FREE_CELLS = 20;
// The starter stash (_scatterStarterStash): one crate per entry, scattered in
// the resource ring around home — past the trail and the soil plot, inside
// the ring of trees and rocks (HomeArea RING_MIN..RING_MAX, 6..16) — so it is
// found while gathering rather than handed over at the door.
const STARTER_STASH = [
  { id: 'book', qty: 1 }, { id: 'book', qty: 1 }, { id: 'book', qty: 1 }, { id: 'book', qty: 1 },
  { id: 'rope', qty: 1 }, { id: 'trap_disarm_kit', qty: 1 },
];
const STARTER_STASH_R_CELLS = [8, 16];
// How long a wounded enemy keeps its floating health bar after the last hit.
// A bow shot lands from clear across the screen, so without this the only
// feedback for a hit would be the foe eventually vanishing — but a bar that
// never faded would clutter a cave full of monsters you shot once.
const ENEMY_HEALTH_RING_MS = 4000;
// Damage numbers are throttled per foe: a fight can land more than one blow in
// a moment (a melee swing and an arrow arriving together, a piercing bolt
// crossing a pack), so damage accumulates between beats and pops as one
// rounded number rather than stacking overlapping labels on the same bar.
// Nothing is lost to the throttle — the kill blow flushes whatever it held.
// The melee wheel lands whole blows at Combat.MELEE_INTERVAL_MS, slower than
// this beat, so each pops on its own.
const DMG_POPUP_BEAT_MS = 500;
// The tool drawn in the middle of a work wheel (_setWorkProgressIcon). Near
// full strength so the tier's colour reads — it is the only thing on the
// wheel that says WHICH tool you are swinging — but a touch under 1 so the
// sprite being worked still shows through, as the ring's own alphas do.
const WORK_TOOL_ALPHA = 0.85;
// Screen-px lift on a drawn shot. Shots fly between FOOT positions (the anchor
// every creature and the player use), so without this they'd skim the ground
// under the bodies they hit.
const SHOT_DRAW_LIFT_PX = 10;
// How far to the side of the body the staff's next bolt charges (_drawStaffCharge).
const STAFF_CHARGE_HAND_DX = 7;
// The staff bolt's glow (_boltGlowKey): the baked texture's edge, in px, and
// how many of the bolt's recent positions its comet trail keeps, how far
// apart (in cells — distance, not frames, so the tail is the same length at
// any frame rate). The sparks a
// bolt throws off a foe it passes through are in the bolt's own colour.
const BOLT_GLOW_TEX_PX = 64;
const BOLT_TRAIL_N = 8;
const BOLT_TRAIL_STEP_CELLS = 0.12;   // trail points this far apart: ~a cell of comet
// A shiny turret's arrow of light (Combat.turretShot `shiny`): the halo's
// radius on the head, in px, off the same glow texture; the trailing one is
// smaller and fainter (_drawShots).
const SHINY_ARROW_GLOW_PX = 9;
// A shot's colour by tier: the relic's MATERIAL colour (MATERIAL_TIERS
// .color), the slot's own for a tier the table lacks. One answer for the
// bow's arrow and the staff's bolt, stamped on the shot where it is loosed
// and read by the staff's charging orb, so the orb and the bolt it becomes
// are the same colour.
function shotTierColour(slot, tier) {
  const c = TIER_BY_NUM[tier]?.color;
  return c != null ? c : Combat.SHOT[slot].color;
}
// The arrow leaves a few pixels below its own variant's visible crown.
// SHOT_DRAW_LIFT_PX is its final lift at the target (see _drawShots).
// How often the set of on-screen turrets is re-scanned while enemies are on
// screen. Turrets don't move, and the objects list of nine tiles is far too
// long to walk every frame.
const TURRET_SCAN_MS = 300;
// Crows ignore potato crops — they won't notice, orbit, land on, or eat them.
// The rule (and its crop set) now lives in crops.js; this stays as a free-
// function alias because the crow pest logic calls it bare in several spots.
function raiderEatsCrop(p) { return Crops.raiderEats(p); }

// --- Debug ---
// WASD and arrow keys move the player at DEBUG_SPEED_MUL × walk speed when DEBUG is true.
// Must default false: the keyboard takeover this gates (see the WASD block in
// update() and the SPACE/T/F bindings below) latches GPS off for the rest of
// the session on the first keypress it sees, so shipping it live meant any
// GPS-tracked session with a keyboard attached (a Chromebook, a Bluetooth
// keyboard case) could have the player silently auto-walk off toward wherever
// a stray key sent them instead of their real position, with no way back but
// a reload. Flip it locally for desktop testing.
const DEBUG = false;
const DEBUG_SPEED_MUL = 10;
// Dragon Powder is not a movement mode — it's a stat buff wearing a dragon
// sprite. For its minute the player walks as if they had boots at this
// tier (one past Frost, see items.js steerSpeedMul / steerEnergyCost) and hits
// twice as hard (interact.js). The Speed potion stands in a tier higher still.
// Straying from your real position, in cells. Inside this ring stick walking is
// cheap (you're pottering around the spot you're actually standing on) and the
// character reads normally; outside it the walk costs full price and the
// character darkens the further out they get.
// Fog of war: how much of the starting neighbourhood is known ground before
// the player has walked a step. See _revealStarterTrail — the onboarding trail
// is a sightline chain (walk to the crate you can see, and the next is in
// view), and the walk's own 3-cell reveal cannot carry that on a fresh save.
//
// HOME is the player's own block, which they are not discovering: the tutorial
// pocket _placeStarterTrail clears and curates (CLEAR_R = HomeArea.POCKET_CELLS)
// AND the first ring of scenery seated just outside it, so the trees and rocks
// ringing the opening screen are lit rather than sitting under the wash.
//
// It is ONE CELL PAST WHAT THE PLAYER CAN SEE, and that is the whole rule:
// the viewport is VIEW_CELLS (11) across with the player in the middle, so
// sight reaches 5 cells and the fog starts at 6 — visible at the corners of
// the opening screen, a step away on every axis. Derived from VIEW_CELLS, not
// picked: floor(VIEW_CELLS / 2) + 1, kept as a literal only because the node
// harness lifts these constants out of the source text (test/node/run.js).
// It was 10 until Sep 2026 — nearly two screens of free map, so a new save
// opened with no fog anywhere in frame and the feature only announced itself
// several streets from home. Anything BELOW 6 is the other bug: the reveal
// stops short of the rendered frame and the player spawns inside a ring of
// wash around their own house (both bounds are pinned in fog.test.js).
// TRAIL is the margin around each crate and the relic chest, wide enough that
// a crate reads as sitting on ground rather than punched out of the dark, and
// narrow enough that the map still opens up by being walked rather than by
// spawning — it is what carries the sightline chain now that HOME does not.
const HOME_REVEAL_CELLS = 6;
const TRAIL_REVEAL_CELLS = 5;
// How close a road or path has to pass to the starting anchor for the supply
// crates to be laid along its shoulder instead of spread down the walk to the
// relic chest (see _placeStarterTrail). The objective chip literally says
// "supply crates were left along the road nearby", so when there IS a road
// nearby, the crates keep its word. 6 cells (~40 m) is "very near": the kerb
// is in view from the doorstep, so the trail still starts with a crate the
// player can see.
const NEAR_ROAD_CELLS = 6;
// THE FISHING POND (see _carveStarterPond). A 2x2 of open water carved TWO
// SCREENS out from Home — POND_MIN_CELLS is 2 × VIEW_CELLS (11), pinned by
// starter_pond.test.js — so it sits past the relic chest (one screen) and the
// starter ring (16), something to find on the second outing rather than part
// of the opening screen. The band widens to POND_MAX_CELLS so a spawn whose
// two-screen ring is all street or floor still gets one. When a POI chest
// stands in the band, the pond seats within POND_POI_CELLS of it, so the walk
// to the shop or the park is the walk to the water.
const POND_MIN_CELLS = 22;
const POND_MAX_CELLS = 30;
const POND_POI_CELLS = 3;
const NEAR_GPS_CELLS = 3;
// The body takes a hit: how long the character flicks red (_flashPlayerHit /
// _updatePlayerAura) and what red. Short — it is a flinch, not a state; the
// empty-tank aura is the state, and it pulses on its own clock.
const HIT_FLASH_MS = 160;
const HIT_FLASH_TINT = 0xff5a5a;
// A buff's expiry must move by more than this for _announceStatuses to call
// it landed again (a timer rewritten to the same deadline is not news).
const STATUS_EXTEND_SLACK_MS = 1000;
// UNNOTICED: how far the body fades while nothing can perceive it (scene
// isUnnoticed — a Shadow Powder's minute, or collapsed on an empty bar). Low
// enough to read as a ghost at a glance, high enough to keep the character
// legible against dark ground: you still have to steer this thing, and on hard
// mode a downed player walks the whole way home wearing it.
const UNNOTICED_ALPHA = 0.42;
// The contact shadow's own alpha, which the ghost fade multiplies so the body
// and the mark it casts fade TOGETHER — a solid shadow under a translucent
// character reads as a render bug rather than as a ghost. Two levels because a
// flying dragon has left the ground (_applyDragonSkin sizes it to match).
const PLAYER_SHADOW_ALPHA = 0.34;
const PLAYER_SHADOW_ALPHA_FLYING = 0.20;
const NEAR_GPS_COST_MUL = 0.2;      // 80% off inside the ring
// How big a bite the stick walk takes when it bites. The per-cell cost
// (steerEnergyCost, boots-scaled) is banked fractionally and spent in LUMPS
// of this many pips rather than one pip at a time — bare-handed that is 2⚡
// every 2 cells instead of 1⚡ every cell, so the bar steps in a figure the
// player can read at a glance and the throttled pop has something to say when
// it fires. The rate per cell is untouched: this is the GRAIN of the drain,
// not its price, and dividing the same cost into fewer, bigger debits is the
// whole point — a one-pip trickle under a 1200ms pop window reads as the bar
// fraying rather than as travel costing something.
const STEER_DRAIN_LUMP = 2;
// FOOTPRINT TRAIL geometry (the dots dropped behind a walking player).
//
// The dots were round and 3px, dropped dead on the body's centreline — one
// track of pebbles, which read as a dotted line rather than as somebody having
// walked past. These four numbers turn them into prints: smaller, oval, laid
// along the step, and alternating either side of the line of travel like a
// real pair of feet.
//
// The stance is MEASURED, not picked: in the cyan farmer's 16px frame
// (SpriteLayout.PLAYER_ART.farmer — the base sheet every save starts on) the
// two feet sit at x 5–6 and 9–10 on the bottom art row of the front pose,
// i.e. ±2px either side of the art's midline. Scaled by playerScale at draw
// time, that is where the sprite's own feet are, so a print lands under the
// foot that made it.
const FOOT_DOT_R = 3 * 0.7;          // was a flat 3px circle — 30% smaller now
const FOOT_DOT_LONG = FOOT_DOT_R * 1.15;   // semi-axis ALONG the step…
const FOOT_DOT_ACROSS = FOOT_DOT_R * 0.8;  // …and across it: a slight oval, not a slot
const FOOT_STANCE_HALF_ART_PX = 2;   // half the sprite's stance, in frame px
// THE BASE ART. The player's frame, feet and scale are facts about the cyan
// farmer's sheet, read off the one table that owns its layout
// (SpriteLayout.PLAYER_ART.farmer) rather than copied here: how far its
// visible FEET sit below the centre of its frame in TEXTURE px (footDrop),
// its frame edge (fh) and the scale it is drawn at. playerFeetNudgeY
// multiplies the drop by playerScale, which is what keeps the feet on the
// GPS fix; a calling or the bicycle swaps in its own row's numbers
// (_syncPlayerSkin). The head stands half the frame plus the feet drop
// above the fix.
const PLAYER_FEET_DROP_PX = SpriteLayout.PLAYER_ART.farmer.footDrop;
const PLAYER_FRAME_PX = SpriteLayout.PLAYER_ART.farmer.fh;
const PLAYER_ART_SCALE = SpriteLayout.PLAYER_ART.farmer.scale;
// THE COLLAPSE POSE. At zero energy the player is not standing: the reach is 0,
// nothing hunts them, no trap springs under them (Combat.playerDowned — the one
// expression all of that reads). A body that is upright in the picture while
// every rule treats it as down is the picture lying, so the sprite lies down
// too — a quarter turn onto its front, where it fell.
//
// Phaser rotation is CLOCKWISE-positive and turns about the sprite's own
// centre, so a quarter turn pitches the walker head-first onto the face it has
// been showing the camera and lays it head to the screen-right. That is the
// whole of the pose's shape; where it SITS is the other half, and the two are
// one lane — playerBodyDy(), which the body, its halo and the labels over its
// head all read. Standing, the sprite's centre rides playerFeetNudgeY above the
// fix so the FEET land on it (see PLAYER_FEET_DROP_PX); collapsed, the body is
// on the ground with its MIDSECTION on that same point — which is a drop of
// exactly the nudge it stood up by, so the pose costs no second constant.
const PLAYER_DOWNED_ROTATION = Math.PI / 2;
// Where an energy pop hangs (_popEnergy). On a cell that isn't the player's,
// its bottom clears the cell's TOP EDGE by ENERGY_POP_LIFT_PX. On the player's
// own cell the player's head is in the way, so it clears the HEAD by the same
// margin instead: the head is half the frame plus the feet drop above the fix
// (the feet ARE the fix — see playerFeetNudgeY), at the scale the base art is
// drawn, so this is derived from the art, not tuned to it.
const ENERGY_POP_LIFT_PX = 4;
const ENERGY_POP_HEAD_PX = Math.round((PLAYER_FRAME_PX / 2 + PLAYER_FEET_DROP_PX) * PLAYER_ART_SCALE) + ENERGY_POP_LIFT_PX;
// How long the stick must sit idle before the character walks itself home.
//
// This is a DEBOUNCE, not a pause — it exists so lifting a thumb to reposition
// it doesn't send the character trotting back the instant you let go. Long
// enough that stopping to look around, line up a tap, or shift your grip is
// simply standing still; short enough that a player who has genuinely finished
// walking isn't left waiting on a character that won't come back.
//
// It has been both too long and too short. At 3000 ms it read as the character
// ignoring you. Chasing that, it went to 700 ms and then 500 ms, which is a
// hair-trigger: players nudge themselves along in short pushes, and every beat
// between pushes started a return, so the character was forever leaning back
// against the direction of travel. 5000 ms is the number playtesting settled
// on — past the longest natural gap between two deliberate stick pushes, so the
// walk home only ever starts when the player has actually stopped.
//
// The timer only decides when the return BEGINS, and it begins gently: the
// speed eases in over WALK_HOME_RAMP_MS below rather than switching on at full
// pace, so even a push that lands just after the timer expires gives up almost
// no ground. That ramp is what keeps a longer debounce from feeling like a
// cliff in the other direction.
const WALK_HOME_IDLE_MS = 5000;
// How long the walk home takes to reach full pace once it starts. Squared, so
// the first fraction of a second is nearly stationary — that is what stops an
// interrupted nudge from reading as the character fighting you — and the last
// stretch is at normal walking speed.
const WALK_HOME_RAMP_MS = 1100;
// The walk home is a little BRISKER than a stick walk. The player has already
// stopped and is watching the character close a gap they didn't ask for frame
// by frame, so the return should read as purposeful, not as the same stroll
// that opened it — but it is still a walk (the too-far case below places the
// body outright), so it stays well under the 2× that would read as running.
// Multiplies the stick pace (walk × boots) once the ramp is at full.
const WALK_HOME_SPEED_MUL = 1.5;
// ...and how long before the walk home SHOWS ITSELF (_drawWalkHomeHint). The
// hint is deliberately quieter than the walk: a player who has just let go of
// the stick knows perfectly well what the character is doing, so the lead line
// stays out of the way until the stick has been untouched for this long.
//
// It has to stay LONGER than the walk's own delay (or the lead line appears
// before there's a walk to lead) but not so much longer that it never shows:
// a typical return is over in a couple of seconds, so a hint that waits much
// past the walk's start only ever appears on very long journeys home. Tracks
// WALK_HOME_IDLE_MS — it is that plus a beat and a half.
const WALK_HOME_HINT_IDLE_MS = 6500;
// Runtime names derive from items.js's CONSUMABLE_SPEC, the one owner read by
// gameplay, item copy and the Drink / Use button.
const REACH_POTION_MS = CONSUMABLE_SPEC.reach_potion.durationMs;
// The SHARED tome-button lock: reading any tome locks every tome's button
// for an hour (food's eat lock is Energy's 10 s). Each tome's own magic
// cooldown is CONSUMABLE_SPEC[id].cooldownMs, scaled to the spell's power.
const TOME_COOLDOWN_MS = 60 * 60 * 1000;
// A tome's spell is HALF its potion's: half the duration for timed effects,
// half the damage or restore for instant ones. The potion stays the strong,
// one-shot form; the tome is the weaker spell you keep.
const TOME_EFFECT_MUL = 0.5;
const TOME_THUNDER_DMG = Math.floor(THUNDER_DMG * TOME_EFFECT_MUL);
const TOME_HEALING_ENERGY = Math.floor(HEALING_POTION_ENERGY * TOME_EFFECT_MUL);
const SPEED_POTION_MS = CONSUMABLE_SPEC.speed_potion.durationMs;
const SHIELD_POTION_MS = CONSUMABLE_SPEC.shielding_potion.durationMs;
const DRAGON_POWDER_MS = CONSUMABLE_SPEC.dragon_powder.durationMs;
const SHADOW_POWDER_MS = CONSUMABLE_SPEC.shadow_powder.durationMs;
const GROWTH_POWDER_R_M = CONSUMABLE_SPEC.growth_powder.radiusM;
const FROST_POWDER_MS = CONSUMABLE_SPEC.frost_powder.durationMs;
const PSYCHOSIS_POWDER_MS = CONSUMABLE_SPEC.psychosis_powder.durationMs;
// The Scroll of Thunder's flash (readThunderScroll) — long enough to read as
// lightning, short enough not to blind the next tap. Its damage is items.js
// THUNDER_DMG, beside the ✦ line that quotes it.
const THUNDER_FLASH_MS = 350;
// Potion of Blight: for BLIGHT_MS a round aura on the ground around the
// player hurts every ENEMY whose centre is inside BLIGHT_R_CELLS cells of the
// feet, BLIGHT_DPS HP a second (_tickBlightAura). A plain Euclidean radius on
// purpose — it is a smooth circle, not the per-cell reach staircase — and the
// baked 'aura_blight' texture is drawn exactly that wide, so the edge the
// player sees is the edge that bites.
const BLIGHT_MS = CONSUMABLE_SPEC.blight_potion.durationMs;
const BLIGHT_R_CELLS = CONSUMABLE_SPEC.blight_potion.radiusCells;
const BLIGHT_DPS = CONSUMABLE_SPEC.blight_potion.damagePerSecond;
// SHOP_CHARM_MS (the Flowers charm) lives in items.js beside the Flowers ✦
// line that quotes it.
const DRAGON_WALK_COST_TIER = CONSUMABLE_SPEC.dragon_powder.movementTier;
const SPEED_POTION_WALK_COST_TIER = CONSUMABLE_SPEC.speed_potion.movementTier;
// Coffee: unlike Dragon Powder / the Speed potion (which OVERRIDE the walking
// tier used for stick-walking to a fixed high number), coffee is a common
// crop, not a rare potion — so it just gives a caffeine buzz of
// COFFEE_BOOT_BOOST tiers for 3 minutes, stacking additively on top of
// whatever tier is already in play (worn boots, Dragon, or the Speed
// potion), capped at the same ceiling those top out at so a coffee can't
// out-tier the rarest buff. The number is TWO — the comment said "+1 tier"
// for a while after the constant went to 2, and so did the item-effect line
// the player reads (items.js ITEM_EFFECTS); both quote the constant now.
const COFFEE_BOOT_BOOST = CONSUMABLE_SPEC.coffee.speedTierBoost;
const COFFEE_BUFF_MS = CONSUMABLE_SPEC.coffee.durationMs;
// Torch: how long one burns (useTorch). Lighting another while one burns
// extends from the current end, so a bag of them is one long light.
const TORCH_MS = CONSUMABLE_SPEC.torch.durationMs;
// Tap diagnostics (interact.js _tapDiag): when on, a canvas tap that produces no
// visible action flashes WHY (out-of-bounds / busy wheel / nothing here), to
// debug "taps randomly stop working". On by default in DEBUG builds; force on
// anywhere with ?debugtaps in the URL. Set window.DEBUG_TAPS = false to silence.
if (typeof window !== 'undefined') {
  window.DEBUG_TAPS = DEBUG || /[?&]debugtaps\b/.test(location.search || '');
}

// --- Tap reach. There is no reach constant in this file. ---
// Every non-fauna target is hit-tested against its OWN CELL (interact.js
// findItemInTapCell / sameAbsCell) — the old per-target tap-precision radii
// that lived here are gone, because any disk wide enough to cover its own cell
// also spilled into the neighbouring ones. Creatures use a drawn-sprite box
// (interact.js, off SpriteLayout.creatureTapSpanPx) — they move and aren't
// cell-bound. The "too far" gate is ONE rule, interact.js tooFar →
// coords.js cellInReach: is the cell lit? — measured from the player's reach
// CELL with reachRadiusM (reachCells × cellM + 1 m), the same expressions the
// lightmap plateau paints, so any cell shown lit is tappable.

// The one wording for "that would not fit". It is raised from two places —
// the deferred flash after an addToInv rejection, and the buy modal refusing a
// purchase — and they had drifted into 'bag full' and 'Bag full', the same
// sentence twice in two registers. A Bag relic is what fixes it, so the line
// names the fix rather than just the wall.
const BAG_FULL_MSG = 'Bag full — sell or eat first.';
// flashShiny's default headline — and the one that earns the first-shiny story card.
const SHINY_FIND_TITLE = '✨ SHINY FIND ✨';
// Fort slot machine (presentFortSlots): what can be a prize, and the reels'
// animation — a flicker every FORT_SLOT_TICK_MS, the first reel stopping at
// FORT_SLOT_FIRST_STOP_MS and each next one FORT_SLOT_STOP_GAP_MS later.
const FORT_SLOT_KINDS = ['seed', 'produce', 'magic', 'supply', 'mineral'];
const FORT_SLOT_EXCLUDE = new Set(['book']);   // a Book reads itself on pickup
const FORT_SLOT_TICK_MS = 70;
const FORT_SLOT_FIRST_STOP_MS = 700;
const FORT_SLOT_STOP_GAP_MS = 450;
// The machine's STAR symbol (ShopsMath's wild): the small gold star of the
// pickup sheet — frame 115, beside the memory's bigger star (116) —
// so a star on the reel reads as the memory's little cousin, not the memory.
const FORT_SLOT_STAR_FRAME = 115;
// The jackpot fanfare OVER A DIALOG (flashJackpot's DOM form): the canvas
// toast can't be seen through a DOM modal, so while one is open the same
// banner is set in HTML above it — larger than the canvas one (26px), since a
// dialog is what it has to out-shout — seated this far down the map square
// (over the dialog's header, clear of its body), with the same star burst.
const DOM_FANFARE_PX = 34;
const DOM_FANFARE_Y_FRAC = 0.16;
const DOM_FANFARE_SPARKS = 14;
// The other line every player meets constantly: an action they cannot afford.
// It was a bare lowercase fragment at three call sites — the stick, the cave
// dig and the shared spendEnergy gate — and it named the STATE without the
// remedy, so a player at 1⚡ was told "too tired" and left to work out that
// energy comes back from food, from their own home, and from a campfire. Three
// words longer, and it is the whole answer.
const TOO_TIRED_MSG = 'Too tired — eat or rest.';

// What the Eat button wears while the bite cooldown holds (Energy.canEat, ten
// seconds between mouthfuls — see syncEatButton). The ready face is the HUD's
// success green (UI_GREEN on a #4a8c4a edge); these are that same pair drained
// toward the chrome, so the waiting button reads as the SAME control counting
// down rather than a different, disabled one. Deliberately not the control
// gold: in this palette gold means "a thing you press", which is exactly what
// this is not for the next few seconds.
const EAT_COOLING_INK  = '#6f8f74';
const EAT_COOLING_EDGE = '#37522f';

const COLORS = {
  // Ground HSL saturation +0.1, lightness -0.1 after palette review.
  // POST-APOCALYPTIC FARM PALETTE. The world is a neighbourhood going back to
  // seed: sun-bleached, dust-blown, overgrown rather than landscaped. Every
  // ground tone is pulled toward khaki / olive / grey-brown, and saturation is
  // kept low so the eye reads the world as backdrop.
  //
  // YELLOW IS RESERVED FOR PLAYER INTERACTION — menus, buttons, the stick,
  // money, loot. No terrain may claim it, or the one colour that means "you
  // can touch this" turns into scenery. That is why sand, the paths, the
  // farmland mud, the plank floors and tilled soil all sit in grey-brown and
  // olive here rather than golds.
  0: 0x7b8d4e,  // grass — dry meadow khaki-green (was a fresh lawn green)
  1: 0x546540,  // forest — deep desaturated olive
  2: 0xcab48b,  // sand — pale grit; was a golden tan, the worst yellow offender
  3: 0x4f8a97,  // water — murky standing teal, not swimming-pool blue
  4: 0x908353,  // farmland — dull olive-brown mud
  5: 0xa69779,  // residential — dirty concrete
  6: 0x8ea253,  // park — unmown, going to seed
  7: 0x312a24,  // road — asphalt with dust blown over it
  8: 0xa08a67,  // path — a worn grey dust track
  // Building footprints: halfway between original and approved recolour.
  9: 0x9b4a3d,  // building — small house: weathered red brick (Sep 2026: redder, a touch more contrast)
  10: 0x958664, // rock
  11: 0x9e7e50, // building_med — weathered grey-brown plank floor
  12: 0x6b7988, // building_large — civic / castle floor (mid slate; carries a subtle cobble overlay (drawCastleFloorTex), kept darker than the LIGHT rampart walls)
  13: 0x23201b, // road_lg (motorway/trunk/primary) — darkest
  14: 0x2a261f, // road_md (secondary/tertiary)
  // --- Subtype splits — each tile fits into one of three base biomes ---
  15: 0x8c985c, // SCHOOL       (GRASSLAND) — schoolyard: greyer, patchier turf than the meadow around it
  16: 0xa39b84, // COMMERCIAL   (ROCKY)     — grimy floor tile
  17: 0xa68c6d, // INDUSTRIAL   (ROCKY)     — same hue, rust-dusted
  18: 0xa28f64, // PLAYGROUND   (GRASSLAND) — rotting mulch
  19: 0x78884a, // PITCH        (GRASSLAND) — pitch markings long gone
  20: 0x2f462e, // WETLAND      (FOREST)    — dim swampy green
  21: 0x6f833f, // GOLF         (GRASSLAND) — fairway reverting to scrub
  22: 0x6a7844, // ORCHARD      (FOREST)    — olive
  // PIER (transportation:pier OSM lines, painted as T.PIER=23 in worldgen).
  // Base cell colour is the water tone — the wooden plank sprite from
  // Objects/Wilderness/Bridge Beach.png is drawn on top via the cobblePool
  // (see render.js PIER_FRAME). The water peeks through any plank-art alpha
  // so the cell still reads as "walkway over water".
  23: 0x4f8a97, // PIER         (WATER base) — plank sprite overlays on top
  // --- Underground cave biome (depth > 0) ---
  24: 0x5b4f40, // CAVE_FLOOR — packed earth/stone floor (walkable)
  25: 0x332e26, // CAVE_WALL  — near-black solid rock (surface buildings/roads/water)
  26: 0x78240f, // CAVE_LAVA  — molten rock under the buildings on WorldGen.LAVA_DEPTH
  // WASTELAND (27) — unclassified landuse (railway yards, brownfield,
  // neighbourhood outlines). Plays as residential; looks like the abandoned
  // scrub it is: residential's dirty concrete pulled toward dusty khaki.
  27: 0xa9985d, // WASTELAND  — dusty grey-ochre scrub
  // INFLUENCE ZONES (src/zones.js) — the halo a park / church / fuel yard
  // paints over the lot and commercial ground around it.
  28: 0x687143, // GROVE       — forest-depth yellow-olive sward
  29: 0x827080, // CHURCHYARD  — earthy heather-purple among the stones
  31: 0x6f6b55, // TAR_YARD    — dark oily ground
  // UNMAPPED (30) — render-only: render.js stamps this on cells whose map tile
  // hasn't loaded yet (never appears in a tile's grid). Dark fog, deliberately
  // darker than every real biome so "beyond the charted world" reads as the
  // same visual language as the distance dim; textures.js drives the animated
  // survey-line shimmer over it (BIOME_TEX[30]).
  30: 0x2b2926,
};

// Which ground takes a hoe — NON_TILLABLE / isTillable / isTillableCell — is
// a terrain-code table, and lives with the catalog in items.js.
// Building interior cells — small house, fort, civic slab. Not a rest spot:
// resting is Home's ring (HOME_R) or a campfire's, and nothing else. Read by
// interact.js; Home stopped needing it when its rest became a radius.
const BUILDING_TYPES = new Set([9, 11, 12]);
// Resting AT Home (the starter trailer / adopted home shop) fills the bar in
// this many seconds. YOUR OWN PLACE IS THE ONLY BUILDING THAT RESTS YOU: every
// building cell would otherwise make a town one continuous rest spot. A campfire (FIRE_FULL_REST_S)
// covers the out-in-the-wild case; going home covers the rest. Like the fire,
// it rests you anywhere inside its ring (HOME_R) — the doorstep is where the
// player actually stands.
// Both rates PAUSE while a work wheel runs (see the `working` gate in
// update()): a job done from the doorstep costs its energy on the bar, and
// the rest earns it back only once the wheel has cleared.
const HOME_FULL_REST_S = 50;
// A SIT-DOWN IS A PAUSE, AND THE PAUSE OUTLASTS THE JOB. Pausing the rests
// for the wheel alone was not enough: the starter tree and rock are seated
// 4–5 cells from the trailer (HomeArea.TOKEN_MIN_CELLS..POCKET_CELLS), inside
// Home's ring from anywhere the player can reach them, and the instant a
// bare-handed 9⚡ chop or dig cleared, the rest resumed at 2⚡/s and had the
// whole price back on the bar four and a half seconds later — "mining and
// chopping took no energy", the till bug one lane over. So `working` in update() is ALSO
// true for REST_SETTLE_S after the last moment the player was working: every
// frame a wheel is up, and every spend through spendEnergy (a plant, a
// harvest, a placed rock, the auto-mine's dig), each pushes _restHoldUntil
// out (_holdRest). The rests resume only once the player has done nothing
// for that long — which is what sitting down IS. It is one hold, not a flag
// per job, so the next wheel starter and the next spend inherit it.
// What it is NOT: a stick walk's per-cell drain is travel, not a job (it is
// what the stamina pays for, items.js steerEnergyCost), and a blow from a foe
// is the world's doing — neither holds the rest, so arriving Home by stick or
// wounded rests you the moment you cross the ring.
const REST_SETTLE_S = 10;
// Resting near a lit campfire (burned from a coal on bare ground) refills the
// bar outdoors, but slowly — a full bar in 6 min (slower than any building).
// The trade-off: a fire also repels slimes nearby, so it makes a safe, slow
// recovery spot out in the wild. See the fire-warmth block in update().
const FIRE_FULL_REST_S = 360;
// A CLAIMED castle no longer trades relics — it's the player's own — and
// instead its castellan offers ONE favour per Houses.CASTLE_SERVICE_MS, twelve
// hours (save.castleServiceClaimed[key] holds when it was last used):
// REST, a flat lump of CASTLE_REST_ENERGY handed over on arrival rather than a
// rest rate like the ones above (the castle is somewhere you travel to, so
// the payoff should land the moment you get there), or COLLECT, a flat tax
// take in gold. Small enough either way that it can't replace food or
// sleeping at Home — twice a day is a courtesy for the walk, not an income.
const CASTLE_REST_ENERGY = 35;   // a flat 35⚡ (was a tenth of the bar until Sep 2026)
// What a house says when the feet walk through it (_houseMutter). Each line
// fits MAP_MSG_MAX.
const HOUSE_WRECK_MUTTERS = ["It's a fixer upper.", 'Something here smells.', 'Needs a little TLC.'];
// What the Hood grunts when a job STARTS with nothing in hand (_barehandMutter,
// owner's copy, Oct 2026). The bare-handed rung of the tool ladder
// (toolDurationMs: 9 s against a Wood tool's 3) is the slow way, and the grunt
// is the hint — one line per job, cycling, on the job's own cell. Only the
// three WORK tools (BAREHAND_MUTTER_TOOLS, the same three _barehandWorkStory
// tells of) grunt: a bare-handed catch or fight is the normal way of those.
const BAREHAND_MUTTERS = ['Oof!', 'Ghhhh!', 'Need tools!'];
const BAREHAND_MUTTER_TOOLS = ['axe', 'pickaxe', 'hoe'];
const HOUSE_RESTORED_MUTTERS = ['Eek!', 'Why hello there.', 'Thanks for fixing my house!',
  'Welcome back!', 'Can I offer some tea?'];
const FIRE_REST_R = 3;   // cells — must be within this of a fire to warm up
// Standing IN the hearth, not by it: within this of a campfire's point sets
// any body BURNING (Conditions.DEFINITIONS.burning;
// _tickFireTouch here and SceneFire._tickUnitFire for other units). Under a cell,
// so the warmth ring (FIRE_REST_R) stays safe ground.
const FIRE_TOUCH_CELLS = 0.6;
// HOME IS A CAMPFIRE YOU OWN, and this is its ONE radius — the light it
// throws, the ring it rests you in, and the ring an enemy turns and walks out
// of. Three effects, one number, for the reason the campfire's warmth and the
// campfire's light are one number: Lighting.KINDS.trailer resolves its
// radiusCells to HOME_R at call time exactly as the fire's row resolves to
// FIRE_REST_R, so "stand in the light" is "stand in the warmth" is "stand
// where nothing will bite you", and no two of them can drift apart.
// It is WIDER than the fire's ring (and rests far faster, HOME_FULL_REST_S)
// because a fire is the field expedient and Home is the place you built.
// What Home has that a fire hasn't is the shop: the trade panel is a TAP on
// the building, not an effect of the ring, and is untouched by any of this.
const HOME_R = 4;   // cells — Home's light / rest / ward ring

// Time-since-tab-close that grants the FULL energy bar back (1h, pro-rated
// linearly) now lives with the offline-rest formula in energy.js as
// Energy.OFFLINE_FULL_REST_MS.

// Chest tiers are not rolled: a chest's tier is its tile's QUOTA SEAT —
// worldgen.js seedChestTiers stamps `tierSeed` on each tile's best-ranked
// POIs (a small pyramid of T5..T2 seats; everything else T1), read by
// loot.js › chestTier (chestBaseTier; an unseeded chest is the unstamped T2).
// It rises one tier per CHEST_TIER_DEPTH_STEP cave levels down for the POI's
// underground mirrors (worldgen.js caveChestsFrom; capped by chestTierMaxFor;
// lowtier street furniture never goes down, loot.js chestMirrorsUnderground)
// and one for a zone's nexus. That tier — the look and gem render.js draws from it, and the
// chestTierMod curve in rarity.js the loot rolls on — is the WORLD's: every
// player sees, and is paid by, the same chest on the same street (CLAUDE.md
// "Every player sees the SAME generated world"). Home decides nothing about
// it (the old Home rings are gone). Only the roll
// itself is random.


// Relic slots the spawn treasure chest (see _placeStarterRelicChest) can hand
// out. Every one of these ships art in the `1. Wood` tier folder, which is what
// makes a WOODEN relic of it drawable. Unique jewelry is carried inventory,
// not gear, so it never enters this starter-slot table. Audited against the
// shipped PNGs in test/node/starter_relic.test.js.
const STARTER_RELIC_SLOTS = ['pickaxe', 'axe', 'hoe', 'fishing_rod', 'watering_can', 'net', 'sword', 'bow', 'staff'];
// Wood — the first rung of MATERIAL_TIERS. The chest is a bootstrap, not a
// jackpot: it makes the player's first swing 2.25× quicker and leaves every finer
// tier to be bought, forged or looted.
const STARTER_RELIC_TIER = 1;

// ── Icon-sheet loading indicator + prewarm ──────────────────────────────────
// Modal item/gear icons are <span>s that CSS-clip a sheet PNG via
// background-image. A sheet that isn't in the browser cache yet paints
// NOTHING for the whole fetch — on a slow line the treasure ceremony opened
// on seconds of blank space where the reward should be. IconNet fixes that
// twice over:
//   1. INDICATOR — renderItemIcon / gearIconHTML tag any icon whose sheet
//      isn't known-loaded with .icon-loading (a soft pulsing plate holding
//      the icon's footprint; CSS in index.html) + data-iconsrc. A single
//      MutationObserver spots those spans as modals insert them, probes the
//      URL with an Image(), and strips the plate from every span showing
//      that sheet the moment it decodes. Probe and background-image share
//      the HTTP cache, so the swap is atomic — no double fetch.
//   2. PREWARM — a few seconds after boot (deliberately after the map tiles
//      have had first claim on the connection) every modal-only sheet is
//      trickled into the cache two at a time, so by the first chest the
//      plate never shows at all. ~110 small PNGs, idle bandwidth only.
const IconNet = {
  _loaded: new Set(),    // URLs known decoded + cached this session
  _loading: new Map(),   // URL → [afterFns] while a probe is in flight
  ready(url) { return this._loaded.has(url); },
  // Probe `url`; when it settles (load OR error — a 404 must not pulse
  // forever), mark it, clear the placeholder from every current span showing
  // it, then run `after` (the prewarm queue's pump).
  probe(url, after) {
    if (this._loaded.has(url)) { after?.(); return; }
    const waiters = this._loading.get(url);
    if (waiters) { if (after) waiters.push(after); return; }
    this._loading.set(url, after ? [after] : []);
    const img = new Image();
    const settle = () => {
      const fns = this._loading.get(url) || [];
      this._loading.delete(url);
      this._loaded.add(url);
      try {
        document.querySelectorAll('.px-icon.icon-loading').forEach((el) => {
          if (el.dataset.iconsrc === url) el.classList.remove('icon-loading');
        });
      } catch (_) { /* headless / detached DOM */ }
      for (const fn of fns) fn();
    };
    img.onload = settle;
    img.onerror = settle;
    img.src = url;
  },
  // Watch the whole document for freshly inserted pending icons — modals are
  // built as HTML strings in a dozen call sites, so one observer here beats
  // a scan call in every one of them. Modals appear a few times a minute at
  // most; the per-mutation work is a matches/querySelectorAll pair.
  observe() {
    if (this._obs || typeof MutationObserver === 'undefined' || !document.body) return;
    this._obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (!n || n.nodeType !== 1) continue;
          const els = n.matches?.('.px-icon[data-iconsrc]')
            ? [n]
            : (n.querySelectorAll ? n.querySelectorAll('.px-icon[data-iconsrc]') : []);
          for (const el of els) {
            const url = el.dataset.iconsrc;
            if (this._loaded.has(url)) el.classList.remove('icon-loading');
            else this.probe(url);
          }
        }
      }
    });
    this._obs.observe(document.body, { childList: true, subtree: true });
  },
  // Trickle a URL list into the cache, two fetches in flight at a time so a
  // burst of ~60 requests can't compete with tile loads or gameplay.
  prewarm(urls) {
    const queue = urls.filter((u) => u && !this._loaded.has(u) && !this._loading.has(u));
    let idx = 0, active = 0;
    const pump = () => {
      while (active < 2 && idx < queue.length) {
        active++;
        this.probe(queue[idx++], () => { active--; pump(); });
      }
    };
    pump();
  },
};
if (typeof document !== 'undefined' && document.body) IconNet.observe();

// ── Item icon sheet table ───────────────────────────────────────────────────
// PNG sheet metadata for renderItemIcon's CSS-clip icons. Module scope so
// IconNet's prewarmer can enumerate every sheet URL (and so the table isn't
// rebuilt on every icon render). Adding a new icon sheet is one entry here
// plus a row in MINERAL_ICON_SHEET (items.js) — a hardcoded if-else here once
// silently fell through to Crops.png for any unknown sheet, so a request like
// { sheet: 'gems', frame: 4 } rendered as rainberry stage 4.
// The memories chip's rule (app.js _buildMemoriesChip). It lives here, not in
// index.html, because the chip is built from JS: the box restates the shared
// top-row chip box (#menu summary, #energy, #money) off the same --hud-chip-*
// variables, the rim is the control rim (--ctl-rim) because the chip is
// tappable, and body.modal-open dims it with its neighbours.
const MEMORIES_CHIP_CSS = `
#memories {
  box-sizing: border-box; position: relative;
  height: var(--hud-chip-h); padding: 0 6px;
  border: var(--hud-chip-rim) solid var(--chrome-rim); border-radius: 8px;
  display: flex; flex-direction: row; align-items: center; gap: 5px;
  background: var(--chrome-scuff), var(--chrome-panel); color: var(--gold);
  font: 700 14px ui-monospace, monospace;
  box-shadow: var(--chrome-lip), var(--chrome-lift), var(--chrome-key);
  text-shadow: 0 1px 0 #000;
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  pointer-events: auto; cursor: pointer; user-select: none;
}
#memories .mem-ico { width: 18px; height: 18px; image-rendering: pixelated; pointer-events: none; }
#memories .mem-unspent {
  position: absolute; top: -7px; right: -7px;
  min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
  border-radius: 8px; background: var(--gold); color: #3a3322;
  font: 700 10px/16px ui-monospace, monospace; text-align: center; text-shadow: none;
  box-shadow: var(--chrome-key); pointer-events: none;
}
body.modal-open #memories { opacity: 0.25; pointer-events: none; }
`;
// The ROAD chip (_buildRoadChip): the road-repair ladder at a glance — a tiny
// SVG strip of road that IS the progress bar (worn asphalt, repaved from the
// left as metres bank toward the next prize — the CURRENT rung only), with the
// TOTAL road restored in small type under it (Trail.totalMetres through
// Trail.distanceLabel: 1.5km, 26km). Same shared
// chip box as the memories chip beside it.
// The STATUS ROW (_buildStatusRow / _syncStatusRow): statuses, buffs and
// timers as small chips in a right-aligned column under the top HUD row —
// the money / energy row's own anchor, one chip height plus a gap down. Each
// chip's ink and bg come from its owning row (Conditions.DEFINITIONS,
// Buffs.KINDS); only a row with an action accepts pointer events.
// Dimmed with the HUD chips while a dialog is up, hidden with them while the
// page boots. While the objective chip shows, _syncStatusRow seats the row
// under it instead (an inline top).
const STATUS_ROW_CSS = `
#status-row {
  position: fixed;
  top: calc(8px + env(safe-area-inset-top, 0px) + var(--hud-chip-h) + 6px);
  right: calc(var(--phone-right, 0px) + 10px);
  display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
  z-index: 7; pointer-events: none;
}
#status-row .status-chip {
  white-space: nowrap; padding: 3px 7px; border-radius: 6px;
  font: 700 11px ui-monospace, monospace;
  text-shadow: 0 1px 0 #000;
  box-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
#status-row button.status-chip {
  pointer-events: auto; cursor: pointer; border: 1px solid currentColor;
  min-height: 32px; padding: 6px 10px;
}
body.modal-open #status-row { opacity: 0.25; }
body.modal-open #status-row button.status-chip { pointer-events: none; }
body.booting #status-row { visibility: hidden; }
`;
const ROAD_CHIP_CSS = `
#roadchip {
  box-sizing: border-box; position: relative;
  height: var(--hud-chip-h); padding: 0 5px;
  border: var(--hud-chip-rim) solid var(--ctl-rim); border-radius: 8px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  background: var(--chrome-scuff), var(--chrome-panel); color: #e8e2d6;
  font: 700 9px ui-monospace, monospace;
  box-shadow: var(--chrome-lip), var(--chrome-lift), var(--chrome-key);
  text-shadow: 0 1px 0 #000;
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  pointer-events: auto; cursor: pointer; user-select: none;
}
#roadchip svg { display: block; width: 40px; height: 12px; pointer-events: none; }
#roadchip .road-num { line-height: 1; white-space: nowrap; pointer-events: none; opacity: 0.85; }
body.modal-open #roadchip { opacity: 0.25; pointer-events: none; }
`;
// The BOOKS chip (_buildBookChip): the Book pages read so far, as the memories
// chip's twin — the Book's icon and a count (play_tips.js bookPagesRead). A
// tap lists those pages to read again (_showBooksRead); owner's call, Oct
// 2026, so the course is something you can go back to, not a thing that
// scrolls past once.
const BOOK_CHIP_CSS = `
#bookchip {
  box-sizing: border-box; position: relative;
  height: var(--hud-chip-h); padding: 0 6px;
  border: var(--hud-chip-rim) solid var(--chrome-rim); border-radius: 8px;
  display: flex; flex-direction: row; align-items: center; gap: 5px;
  background: var(--chrome-scuff), var(--chrome-panel); color: var(--gold);
  font: 700 14px ui-monospace, monospace;
  box-shadow: var(--chrome-lip), var(--chrome-lift), var(--chrome-key);
  text-shadow: 0 1px 0 #000;
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  pointer-events: auto; cursor: pointer; user-select: none;
}
#bookchip .book-ico { width: 18px; height: 18px; image-rendering: pixelated; pointer-events: none; }
body.modal-open #bookchip { opacity: 0.25; pointer-events: none; }
`;
// The strip itself: a worn band with a dim broken centre line, and over it the
// same road repaved (light band, bright dashes, kerb lines) clipped to the
// fraction done — updateRoadChipDOM moves only the clip rect's width.
const ROAD_CHIP_W = 40;
const ROAD_CHIP_SVG =
  `<svg viewBox="0 0 ${ROAD_CHIP_W} 12" aria-hidden="true">`
  + '<defs><clipPath id="roadchip-clip"><rect class="road-clip" x="0" y="0" width="0" height="12"/></clipPath></defs>'
  + `<rect x="0.5" y="1.5" width="${ROAD_CHIP_W - 1}" height="9" rx="2" fill="#26211a" stroke="#000" stroke-opacity="0.6"/>`
  + `<line x1="3" y1="6" x2="${ROAD_CHIP_W - 3}" y2="6" stroke="#4d4538" stroke-width="1" stroke-dasharray="3 3"/>`
  + '<g clip-path="url(#roadchip-clip)">'
  +   `<rect x="0.5" y="1.5" width="${ROAD_CHIP_W - 1}" height="9" rx="2" fill="#7a7160"/>`
  +   `<line x1="1" y1="2.5" x2="${ROAD_CHIP_W - 1}" y2="2.5" stroke="#e8e2d6" stroke-opacity="0.7" stroke-width="1"/>`
  +   `<line x1="1" y1="9.5" x2="${ROAD_CHIP_W - 1}" y2="9.5" stroke="#e8e2d6" stroke-opacity="0.7" stroke-width="1"/>`
  +   `<line x1="3" y1="6" x2="${ROAD_CHIP_W - 3}" y2="6" stroke="#fff6d8" stroke-width="1.2" stroke-dasharray="3 3"/>`
  + '</g></svg>';

const ICON_SHEETS = {
  giant_mushroom: { url: 'assets/Icons/Items/GiantMushroom.png', cols: 1, srcW: 16, srcH: 16 },
  icon_field_scope: { url: 'assets/Icons/Items/field_scope.png', cols: 1, srcW: 16, srcH: 16 },
  icon_orb: { url: 'assets/Icons/Items/orb.png', cols: 1, srcW: 16, srcH: 16 },
  icon_goblet: { url: 'assets/Icons/Items/goblet.png', cols: 1, srcW: 16, srcH: 16 },
  icon_lucky_key: { url: 'assets/Icons/Items/lucky_key.png', cols: 1, srcW: 16, srcH: 16 },
  icon_wood_shield: { url: 'assets/Icons/Items/wood_shield.png', cols: 1, srcW: 16, srcH: 16 },
  icon_metal_shield: { url: 'assets/Icons/Items/metal_shield.png', cols: 1, srcW: 16, srcH: 16 },
  icon_gold_shield: { url: 'assets/Icons/Items/gold_shield.png', cols: 1, srcW: 16, srcH: 16 },
  icon_smiths_guild_badge: { url: 'assets/Icons/Items/smiths_guild_badge.png', cols: 1, srcW: 16, srcH: 16 },
  icon_marketeers_guild_badge: { url: 'assets/Icons/Items/marketeers_guild_badge.png', cols: 1, srcW: 16, srcH: 16 },
  icon_traders_guild_badge: { url: 'assets/Icons/Items/traders_guild_badge.png', cols: 1, srcW: 16, srcH: 16 },

  crops:       { url: 'assets/Objects/Approved/crops.png',                       cols: 9,  srcW: 144, srcH: 256 },
  springcrops: { url: 'assets/Objects/Approved/springcrops.png',                cols: 14, srcW: 224, srcH: 128 },
  gems:        { url: 'assets/Icons/RPG icons/Extras/Gemstones.png',    cols: 7,  srcW: 112, srcH: 64  },
  icon_flint_shard:   { url: 'assets/Icons/RPG icons/Extras/Coal.png',         cols: 2,  srcW: 32,  srcH: 32  },
  // Bars + ores — 256×64, 16 cols × 4 rows of 16×16. Row 0 left-to-right
  // is the bar tier ladder: copper, iron, gold, platinum, crimson, frost
  // (frames 0..5). MINERAL_ICON_SHEET maps each bar id to its frame.
  // Without this entry, every bar fell through to crops.png frame 0 and
  // rendered as a grass sprout in smith trade modals.
  bars:        { url: 'assets/Icons/RPG icons/Extras/Bars and ores.png', cols: 16, srcW: 256, srcH: 64 },
  // Animal produce — 32×16 (2 frames). frame 0 = standalone item.
  icon_egg:    { url: 'assets/Icons/Food Icons/Chicken Egg.png',        cols: 2,  srcW: 32,  srcH: 16  },
  icon_milk:   { url: 'assets/Icons/Food Icons/Small Cow Milk.png',     cols: 2,  srcW: 32,  srcH: 16  },
  // Orchard fruit — 32×16 each (frame 0 = whole fruit).
  icon_apple:   { url: 'assets/Icons/Food Icons/Apple.png',             cols: 2,  srcW: 32,  srcH: 16  },
  icon_cherry:  { url: 'assets/Icons/Food Icons/Cherry.png',            cols: 2,  srcW: 32,  srcH: 16  },
  icon_worldpeach:   { url: 'assets/Icons/Food Icons/Peach.png',             cols: 2,  srcW: 32,  srcH: 16  },
  icon_mango:   { url: 'assets/Icons/Food Icons/Mango.png',             cols: 2,  srcW: 32,  srcH: 16  },
  icon_apricot: { url: 'assets/Icons/Food Icons/Apricot.png',           cols: 2,  srcW: 32,  srcH: 16  },
  icon_banana:  { url: 'assets/Icons/Food Icons/Banana.png',            cols: 2,  srcW: 32,  srcH: 16  },
  icon_orange:  { url: 'assets/Icons/Food Icons/Orange.png',            cols: 2,  srcW: 32,  srcH: 16  },
  icon_coconut: { url: 'assets/Icons/Food Icons/Coconut.png',           cols: 2,  srcW: 32,  srcH: 16  },
  // Fish — 64×16 (4 frames). No dedicated minnow art — reuse the
  // smallmouth bass icon (same family, just smaller fiction).
  icon_minnow:     { url: 'assets/Icons/Fish/Sea/Smallmouth Bass.png',    cols: 4, srcW: 64, srcH: 16 },
  icon_bass:       { url: 'assets/Icons/Fish/River/Large Mouth Bass.png', cols: 4, srcW: 64, srcH: 16 },
  icon_trout:      { url: 'assets/Icons/Fish/River/Tiger Trout.png',      cols: 4, srcW: 64, srcH: 16 },
  icon_salmon:     { url: 'assets/Icons/Fish/Sea/Salmon.png',             cols: 4, srcW: 64, srcH: 16 },
  icon_goldenfish: { url: 'assets/Icons/Fish/River/Golden Fish.png',      cols: 4, srcW: 64, srcH: 16 },
  // Consumables + wilderness drops.
  icon_thunder_scroll: { url: 'assets/Icons/Items/ThunderScroll.png', cols: 1, srcW: 16, srcH: 16 },
  icon_raven_scroll: { url: 'assets/Icons/Items/RavenScroll.png', cols: 1, srcW: 16, srcH: 16 },
  icon_bones_scroll: { url: 'assets/Icons/Items/SkeletonScroll.png', cols: 1, srcW: 16, srcH: 16 },
  icon_wraith_scroll: { url: 'assets/Icons/Items/WraithScroll.png', cols: 1, srcW: 16, srcH: 16 },
  icon_taming_potion:    { url: 'assets/Icons/Items/Honey.png',                      cols: 1,  srcW: 16,  srcH: 16 },
  icon_magic_hammer: { url: 'assets/Icons/Items/MagicHammer.png',             cols: 1,  srcW: 16,  srcH: 16 },
  icon_book:     { url: 'assets/Icons/RPG icons/Extras/Books.png',           cols: 15, srcW: 240, srcH: 64 },
  // Potion of Reach — single 16×16 glowing-flask icon (hand-drawn).
  icon_potion:   { url: 'assets/Icons/Items/Potion_light.png?v=1',           cols: 1,  srcW: 16,  srcH: 16 },
  // Flask-style potions sheet (Potions.png): 5 cols × 7 rows of 16×16.
  // Row 2: frame 11=green (healing), 12=red (speed), 13=purple (shield).
  icon_potions:  { url: 'assets/Icons/Items/Potions.png?v=1',                cols: 5,  srcW: 80,  srcH: 112 },
  icon_rings:    { url: 'assets/Icons/RPG icons/Extras/Rings.png',        cols: 6,  srcW: 96,  srcH: 64 },
  icon_amulets:  { url: 'assets/Icons/RPG icons/Extras/Amulet.png',       cols: 6,  srcW: 96,  srcH: 64 },
  icon_throwing_spear:    { url: 'assets/Icons/Items/Spear.png', cols: 2, srcW: 32, srcH: 16 },
  icon_javelin:  { url: 'assets/Icons/Items/Spear.png', cols: 2, srcW: 32, srcH: 16 },
  // Rope — single 16×16 coiled-rope icon (hand-drawn, like the honey jar).
  icon_rope:     { url: 'assets/Icons/Items/Rope.png',                       cols: 1,  srcW: 16,  srcH: 16 },
  // Torch — single 16×16 stick-and-flame icon (hand-drawn, like the rope).
  icon_torch:    { url: 'assets/Icons/Items/Torch.png',                      cols: 1,  srcW: 16,  srcH: 16 },
  icon_kit:      { url: 'assets/Icons/Items/TrapDisarmKit.png',             cols: 1,  srcW: 16, srcH: 16 },
  icon_magic_trap: { url: 'assets/Icons/Items/MagicTrap.png',                cols: 1,  srcW: 16, srcH: 16 },
  icon_meat:     { url: 'assets/Icons/Food Icons/Beef.png',                  cols: 2,  srcW: 32,  srcH: 32 },
  // The campfire's dishes — one 16px frame per items.js COOKED_FOODS row,
  // baked from each raw icon by tools/cook_icons.js (ImageMagick).
  icon_cooked:   { url: 'assets/Icons/Food Icons/Cooked.png',
    cols: Object.keys(COOKED_FOODS).length, srcW: 16 * Object.keys(COOKED_FOODS).length, srcH: 16 },
  icon_pelt:     { url: 'assets/Icons/Food Icons/Black rabbit Fur.png',      cols: 2,  srcW: 32,  srcH: 16 },
  icon_feather:  { url: 'assets/Icons/RPG icons/Extras/Chicken feather.png', cols: 9,  srcW: 144, srcH: 32 },
  // Beach pickup — 48×64 = 3×4 of 16×16, only the top row shell art (see
  // CROP_SPRITE.shell). Frame 0 is the canonical cowrie, the inventory icon.
  shell_sheet:   { url: 'assets/Icons/Fish/Sea/Creatures/Shell.png',         cols: 3,  srcW: 48,  srcH: 64 },
  // Same rustic prop sheet as the map: grass frame 10, mushroom frame 35.
  // Other frames retain their existing art.
  props:         { url: 'assets/Objects/Approved/props.png',               cols: 22, srcW: 352, srcH: 192 },
  // 7_Pickup_Items — 224×160, 14×10 of 16×16. Frame 88 (row 6 col 4)
  // is the brown leather boot used as the fishing-junk inventory icon.
  pickup:        { url: 'assets/Objects/Pickup_Items.png',                   cols: 14, srcW: 224, srcH: 160 },
  // wood — 48×16, 3 frames. MINERAL_ICON_SHEET.wood points here. In
  // practice wood always renders via the baked ITEM_DATA_URLS snapshot
  // (which alpha-keys the white bg), so this entry is a fallback: if the
  // bake ever fails it renders wood (white bg and all) instead of
  // silently falling through to SHEETS.crops → a grass sprout.
  wood:          { url: 'assets/Objects/Wilderness/wood.png',                cols: 3,  srcW: 48,  srcH: 16 },
};

class MapScene extends Phaser.Scene {
  constructor() { super('map'); }

  preload() {
    this._endPreload = window.__boot?.begin('phaser preload (asset fetches)');
    // Boot loading overlay (index.html #bootload). Asset fetches are the long
    // pole of a cold boot, so the Phaser loader's own progress drives the bar:
    // 0→0.85 here, 0.9 as create() builds the world, 1 on the first update()
    // frame (which fades the overlay out and hands off to the in-world
    // unmapped-tile shimmer for whatever tiles are still loading).
    this.load.on('progress', (p) => window.__bootStatus?.(p * 0.85, 'Unpacking supplies…'));
    // EVERY texture comes from the ASSETS catalog (assets.js) — the character,
    // the world sprites, the creature sheets, the icons. Nothing is loaded by
    // hand here: Phaser's loader keeps the FIRST config queued for a key, so a
    // manual load.spritesheet here shadowed the catalog's framing (the chicken
    // rendered as four when it did), and a duplicate registered every onLoad
    // handler twice. Add a texture to assets.js, not here. Without this loop
    // every reference in render.js / renderItemIcon falls back to the
    // __MISSING texture — visible as broken grey blocks for deer / rabbit
    // / mineralrock / etc., and item icons that should be sprites silently
    // resolve to Crops.png frame 0.
    if (typeof ASSETS !== 'undefined') {
      for (const [key, a] of Object.entries(ASSETS)) {
        if (this.textures.exists(key)) continue;
        if (a.kind === 'spritesheet') {
          this.load.spritesheet(key, a.path, { frameWidth: a.frameWidth, frameHeight: a.frameHeight });
        } else if (a.kind === 'image') {
          this.load.image(key, a.path);
        }
        if (a.onLoad) {
          const tag = a.kind === 'spritesheet'
            ? `filecomplete-spritesheet-${key}` : `filecomplete-image-${key}`;
          this.load.once(tag, () => a.onLoad(this));
        }
      }
    }
    // ONE RETRY PER FAILED ASSET. A cold boot fetches the whole catalog at
    // once — and right after a deploy the service worker's new shell cache is
    // empty, so every sheet goes to the network in one burst. A single request
    // that dies there comes back as the worker's 504, and a sheet that never
    // loaded is not just a grey block: an animation built from it has NO
    // FRAMES, and playing it throws in Phaser's getFirstTick ("undefined is
    // not an object (evaluating 't.currentFrame.duration')" — the whole boot
    // dies on the player's idle-down). So a failed catalog file is queued
    // again, once, with a cache-busting query so it cannot be answered by the
    // same failed lookup. The key (and so the filecomplete-* onLoad hook, and
    // everything that draws by it) is unchanged. create() still guards the
    // animations against a sheet that fails twice (_createAnim).
    const retried = new Set();
    this.load.on('loaderror', (file) => {
      const a = typeof ASSETS !== 'undefined' ? ASSETS[file.key] : null;
      if (!a || retried.has(file.key)) return;
      retried.add(file.key);
      const url = a.path + (a.path.includes('?') ? '&' : '?') + 'retry=1';
      console.warn(`asset ${file.key} failed to load; retrying once`);
      if (a.kind === 'spritesheet') {
        this.load.spritesheet(file.key, url, { frameWidth: a.frameWidth, frameHeight: a.frameHeight });
      } else if (a.kind === 'image') {
        this.load.image(file.key, url);
      }
    });
    // Relic / armor icons (7 tiers × 7 slots + extras) are NOT preloaded — they
    // only ever appear inside DOM modals via `<img src="${gearAssetPath(...)}">`,
    // so the browser fetches each one on demand and caches it. Eagerly loading
    // ~50 PNGs at startup blocked the splash screen for several seconds.
  }

  // Has this save written anything into the world yet? Each of these is a
  // coordinate in the origin's own metre frame (metres = z=14 px × mPerPx,
  // and mPerPx is fixed at the origin's latitude), so the moment one exists
  // the origin is load bearing and can no longer move under it.
  _worldPlaced() {
    const sv = this.save;
    // PROVISIONAL_ORIGIN_KEYS are deliberately NOT in this list: they are the
    // starter kit the pre-capture passes lay down, all of it re-derived at the
    // new origin after the reload. Counting them let the safety net disarm the
    // capture it had just stayed armed for — see PROVISIONAL_ORIGIN_KEYS.
    //
    // What IS here is what the PLAYER committed: a Home adopted onto a real
    // house (or a trailer dropped under them — both need a GPS fix, so they
    // can only exist once capture has already resolved), and ground they have
    // tilled or planted, which is stored as cells in this origin's own frame.
    return !!(sv.starterShopId || sv.starterTrailer
      || (sv.tilled && sv.tilled.length) || (sv.planted && sv.planted.length));
  }

  // === HUD help, haptics ===
  // (Tile loading lives in scene_geo.js › ensureTilesAround.)
  // What the ⚡ chip does when tapped (UX audit §20): "how do I refill this?"
  // is the obvious gesture and it did nothing. Says where energy comes from,
  // and how much this save's armor allows.
  showEnergyHelp() {
    const cur = Math.floor(this.save.energy ?? 0), max = this.getMaxEnergy();
    const { wrap, box, mount, mkBtn } = this.makeModalShell('energy-help',
      { textAlign: 'left', onClose: () => {}, kind: 'energy' });
    const h = document.createElement('div');
    h.style.cssText = 'font:700 14px ui-monospace,monospace;color:var(--green);'
      + 'margin-bottom:8px;text-align:center;';
    h.textContent = `${cur} / ${max}`;   // the kind header already says ENERGY
    box.appendChild(h);
    const body = document.createElement('div');
    body.style.cssText = 'font:12px/1.5 ui-monospace,monospace;color:#ddd;';
    body.innerHTML =
      'Energy pays for tilling, chopping, mining and walking off the GPS.<br><br>'
      + '• <b>Eat</b> — select any food in the bag and use the Eat button.<br>'
      + '• <b>Rest</b> — it refills slowly on its own over time.<br>'
      + '• <b>Taste</b> — every new food eaten for the first time raises the '
      + 'cap by one, for good (currently ' + max + ').<br><br>'
      + 'Armour does not lengthen this bar — it soaks the damage attacks take '
      + 'off it.';
    box.appendChild(body);
    const close = mkBtn('Got it');
    close.style.marginTop = '12px';
    close.style.width = '100%';
    close.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(close);
    mount();
  }

  // Short vibration on tap outcomes. An outdoor phone game in sunlight can't
  // rely on a 12px flash label alone (UX audit §18), so a tap that lands and a
  // tap that's rejected feel different. Off is remembered in the save; the API
  // is absent on desktop and iOS Safari, hence the optional call.
  haptic(ms) {
    if (this.save?.haptics === false) return;
    try { navigator.vibrate?.(ms); } catch (_) {}
  }
  hapticOk()     { this.haptic(15); }
  hapticReject() { this.haptic(40); }
  hapticHit()    { this.haptic(25); }   // between the two: not a pickup, not a refusal

  // `reason` is the failure as the tile path reported it ("HTTP 504",
  // "Failed to fetch", "offline"), shown in the banner so a report from a
  // phone says WHICH of the three things this banner covers happened — a
  // host that answered, a radio that didn't, or a browser that thinks it is
  // offline — instead of the same seven words for all of them.
  showBanner(on, reason) {
    this.banner.style.display = on ? 'block' : 'none';
    if (on) {
      const why = reason ? String(reason).replace(/^tile \S+ /, '').slice(0, 40) : '';
      this._bannerText = "can't reach the map" + (why ? ` (${why})` : '') + ' — tap to retry';
      this.banner.textContent = this._bannerText;
    }
    // Wire tap-to-retry once: drop the failed tiles so the next ensureTiles
    // refetches them rather than serving the cached failure.
    if (on && !this.banner._retryWired) {
      this.banner._retryWired = true;
      this.banner.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const [k, t] of WorldGen.tileCache) if (t && t.status !== 'ready') WorldGen.tileCache.delete(k);
        this.banner.textContent = 'retrying…';
        this.ensureTilesAround?.().finally?.(() => {
          // The pass's own settle() has already re-run showBanner with the
          // fresh outcome; only restore the text it chose.
          this.banner.textContent = this._bannerText || "can't reach the map — tap to retry";
        });
      });
    }
  }

  playerToWorldCell() {
    // playerM is the LOCAL frame (zero = startWorldM), so it converts through
    // coords.js' local half — same arithmetic, one place. cx / cy are on the
    // tile's OWN grid (its row's cell count).
    const { x: wx, y: wy } = localMetersToTilePx(this, this.playerM.x, this.playerM.y);
    return tilePxToTileCellF(this, wx, wy);
  }

  // The player's absolute cell (coords.js encoding) — what Fog, _popEnergy and
  // every save key take. Never pc.tx * N + floor(pc.cx) by hand: N is per row.
  playerAbsCell() {
    const pc = this.playerToWorldCell();
    return tileCellToAbs(this, pc.tx, pc.ty, Math.floor(pc.cx), Math.floor(pc.cy));
  }

  // Fog's view of the per-row grid (fog.js stays WorldGen-free).
  _fogGeom() {
    return {
      rowCells: (ty) => rowCells(this, ty),
      absToTile: (ax, ay) => absCellToTile(this, ax, ay),
      offset: (ax, ay, dx, dy) => absCellOffset(this, ax, ay, dx, dy),
    };
  }

  // Fog of war — mark the ground under and around the player as explored.
  //
  // Called every frame before drawCells, and free on all but a handful of them:
  // Fog.reveal bails immediately unless the player has changed CELL, which is
  // once per 7 m walked. Only when something is genuinely newly revealed does
  // it touch the save (persistSave already coalesces writes at 500 ms) or move
  // Fog.revision, which is the renderer's dirty gate.
  //
  // Underground has no fog (see the fog pass in render.js), so don't record a
  // cave walk as surface exploration — the cave's cell indices are the SURFACE
  // ones, and revealing them would hand the player the map above them.
  _revealFog() {
    if (this.depth !== 0) return;
    const { cellIX: ix, cellIY: iy } = this.playerAbsCell();
    if (!Fog.reveal(ix, iy)) return;
    // Persist on a 10 s throttle, not per revealed cell. Continuous walking
    // reveals a new cell every second or two, and each persistSave lands a
    // full-save JSON.stringify + synchronous localStorage.setItem on the main
    // thread 500 ms later — a per-cell hitch that grew with save size (the
    // fog blobs themselves make the save bigger every tile explored). Fog's
    // in-memory masks are the truth between flushes; the visibilitychange
    // hidden-branch does an unconditional flush so backgrounding/closing the
    // tab never loses more than the walk since the last one, and any OTHER
    // persistSave caller in that window at worst stores fog that's 10 s stale.
    const nowT = performance.now();
    if (this._fogPersistT && nowT - this._fogPersistT < 10000) return;
    this._fogPersistT = nowT;
    Fog.flush(this.save);
    persistSave(this.save);
  }

  // ── Traps ─────────────────────────────────────────────────────────────────
  // Two costs, one cell. Walking onto a HIDDEN trap springs it: it is revealed
  // for good (save.sprungTraps — the only thing about a trap that is ever
  // stored) and takes Traps.STEP_ENERGY in one bite, with the pain effect.
  // Staying on the sprung one bleeds Traps.STAND_ENERGY_PER_S — faster than any
  // passive rest can refill, so waiting it out is never the answer and stepping
  // off is.
  //
  // THE CAMERA IS NOT THE PLAYER (CLAUDE.md). Both gates read
  // playerToWorldCell() — the feet — never the peek-aware view anchor: a drag
  // must not spring a trap the body is nowhere near, and must not spare the
  // body the one it is standing in.
  //
  // The trap under the player is memoised on the cell key, so the walk of the
  // tile's trap list happens once per cell crossed (about once per 7 m) rather
  // than every frame. The memo is deliberately NOT taken when the tile isn't
  // cached yet — otherwise a trap would be missed for as long as the player
  // stood on the cell they arrived at while it streamed in.
  //
  // A BODY DOES NOT STEP. At zero energy the player has collapsed (CLAUDE.md:
  // NOTHING HUNTS A BODY) — the reach is 0, nothing can be tapped or swung at,
  // and all three ways a foe reaches them refuse to take a point off an empty
  // bar. A snare under one is that same state arriving for a different reason:
  // springing it would spend the trap FOR GOOD (save.sprungTraps is written the
  // instant it fires) on a player it can charge nothing for, and on hard —
  // where only Home lifts the bar off zero — the long walk home would clear
  // every trap it crossed for free. So the whole tick stands down, both costs
  // with it.
  //
  // `Combat.playerDowned`, NOT `isUnnoticed()`: a Shadow Powder hides you from
  // whatever takes an INTEREST in you, and iron jaws take none — a powder must
  // not walk you through a minefield.
  // ── THE STREET UNDER THE FEET ─────────────────────────────────────────────
  // One read per feet-cell change (playerToWorldCell — never the camera
  // anchor): the tile's street marks (StreetVariants.dress) and its MAJOR band
  // (entry.roadClass) say which street this is, and the first entry onto each
  // variant — and onto an old trade road — tells its story once per save
  // (_storySplashOnce, keyed and painted by the row's `story` stem); a later
  // entry after being off it for STREET_FLASH_GAP_MS gets its map line. The
  // same cell says whether a Burned Row's tar pit or iron stakes are under
  // the body: `_slowHere`, which _bodyHold reads as the SLOW reason.
  _tickStreetFeet() {
    if ((this.depth || 0) !== 0 || typeof StreetVariants === 'undefined' || !this.startWorldM) {
      this._slowHere = null;
      this._streetStoryHere = null;
      return;
    }
    const pc = this.playerToWorldCell();
    const lix = Math.floor(pc.cx), liy = Math.floor(pc.cy);
    const key = `${pc.tx}_${pc.ty}_${lix}_${liy}`;
    if (key === this._streetFeetKey) return;
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
    if (!entry || !entry._spawned) { this._slowHere = null; return; }   // retry next frame
    this._streetFeetKey = key;
    const N = entry.cellsPerEdge;
    if (!(N > 0) || lix < 0 || liy < 0 || lix >= N || liy >= N) return;
    const i = liy * N + lix;
    const ps = this.playerScreen ? this.playerScreen() : null;
    const say = (msg) => this.flash(msg, ps ? ps.x : undefined,
      ps ? ps.y - ENERGY_POP_HEAD_PX - 22 : undefined);
    // SLOW: first contact with a patch says so; standing on it again later
    // does too (it is a hazard, not a story).
    const was = this._slowHere;
    this._slowHere = (entry.slowCells && entry.slowCells.get(i)) || null;
    if (this._slowHere === 'stakes') {
      const picked = new Set(this.save.picked || []);
      const standing = (entry.objects || []).some(o => o.kind === 'stakes' && !picked.has(o.id)
        && SpawnOwnership.tileCells(this, entry, o, pc.tx, pc.ty).includes(i));
      if (!standing) this._slowHere = null;
    }
    const fireCell = tileCellToAbs(this, pc.tx, pc.ty, lix, liy);
    const fire = this.save.groundFire?.[GroundFire.key(this.depth || 0, fireCell.cellIX, fireCell.cellIY)];
    if (this._slowHere === 'tar' && fire && !GroundFire.active(fire, Date.now())) this._slowHere = null;
    if (this._slowHere && !was) {
      say(this._slowHere === 'tar' ? 'Tar drags at your feet.' : 'Iron stakes. Slow going.');
    }
    // THE ZONE: an influence zone's CORE under the feet (src/zones.js — the
    // tile's field, one Uint8 read) tells its kind's story once per save, and
    // a later entry gets its map line on the street's gap. It outranks the
    // street's story on the same step (a zone is the rarer place).
    const zone = (typeof Zones !== 'undefined') ? Zones.at(entry, lix, liy) : null;
    const zrow = (zone && Zones.inCore(zone)) ? Zones.ZONE_KINDS[zone.kind] : null;
    if (zrow && zrow.story !== this._zoneStoryHere) {
      this._zoneStoryHere = zrow.story;
      const seenZ = this.save.storySeen && this.save.storySeen[zrow.story];
      if (!seenZ) {
        this._storySplashOnce(zrow.story, { art: zrow.art || zrow.story, title: zrow.title, body: zrow.body });
        return;
      }
      const lastZ = (this._streetFlashAt = this._streetFlashAt || {});
      const nowZ = performance.now();
      if (nowZ - (lastZ[zrow.story] || -Infinity) >= STREET_FLASH_GAP_MS) {
        lastZ[zrow.story] = nowZ;
        say(zrow.flash);
      }
    } else if (!zone) {
      this._zoneStoryHere = null;
    }
    // THE STORY: which street is this?
    const code = entry.streetMarks ? entry.streetMarks[i] : 0;
    let row = code ? StreetVariants.variantByCode(code) : null;
    if (!row && entry.roadClass && (entry.roadClass[i] & WorldGen.ROAD_CLASS_MAJOR_BAND)) {
      row = StreetVariants.BANDIT_STORY;
    }
    if (!row) { this._streetStoryHere = null; return; }
    if (row.story === this._streetStoryHere) return;
    this._streetStoryHere = row.story;
    const seen = this.save.storySeen && this.save.storySeen[row.story];
    if (!seen) {
      this._storySplashOnce(row.story, { art: row.art || row.story, title: row.title, body: row.body });
      return;
    }
    const last = (this._streetFlashAt = this._streetFlashAt || {});
    const now = performance.now();
    if (now - (last[row.story] || -Infinity) < STREET_FLASH_GAP_MS) return;
    last[row.story] = now;
    say(row.flash);
  }

  // ── What holds the BODY back from the fix ─────────────────────────────────
  // ONE gate for movement holds and terrain speed caps (read by update()):
  //   pinned — a trap's jaw holds the body still (the `pinned` row of
  //            Conditions.DEFINITIONS, set by _tickTraps).
  //   stun   — a jellyfish sting holds the same body gate for five seconds.
  //   capMS  — the feet are on a Burned Row's tar pit or iron stakes
  //            (_tickStreetFeet's `_slowHere`): the body may advance toward
  //            the target at no more than SLOW_BODY_M_S, so it falls behind
  //            the GPS fix and catches up, on the ordinary follow ramp, once
  //            off the patch. Tap-to-walk, the stick and the keyboard all
  //            move the TARGET, so all of them obey it. No damage, no save.
  //            (A downed body does not walk anyway.)
  _bodyHold() {
    const pinned = Conditions.active(this.save, 'pinned');
    const slow = this._walkHazardSlow ? this._walkHazardSlow() : this._slowHere;
    // An Ember Altar's boon (src/shrines.js 'surefoot') frees the feet like the dragon.
    let capMS = (!pinned && slow && !this._dragonActive
      && !Shrines.leverActive(this.save, 'surefoot')) ? SLOW_BODY_M_S : null;
    for (const c of this._foeBodies || []) {
      const contact = EnemyRoster.get(c.kind)?.contactSlow;
      if (!contact || !Combat.isEnemy(c) || (this.save.caught || []).includes(c.id) || !this.playerM || !this.startWorldM) continue;
      if (Math.hypot(c.x - this.startWorldM.x - this.playerM.x, c.y - this.startWorldM.y - this.playerM.y)
          <= contact.radiusCells * this.cellM) {
        capMS = Math.min(capMS ?? Infinity, WALK_M_S * contact.speedMul);
      }
    }
    const held = pinned || Conditions.active(this.save, 'jellyfish_stun');
    const balancing = typeof ObstacleStep !== 'undefined' && ObstacleStep.speedMul(this._obstacleStep) < 1;
    return { pinned: held, capMS, slowed: !held && (capMS > 0 || balancing) };

  }

  _tickTraps(dt) {
    if (typeof Traps === 'undefined' || !this.startWorldM || !this.originPx) return;
    // The memo goes down with the tick, so the cell is read fresh the moment
    // the bar lifts: a player revived on top of a hidden trap steps on it then.
    if (Combat.playerDowned(this.save.energy)) {
      this._trapCellKey = null;
      this._trapHere = null;
      this._trapDrainAccum = 0;
      this._trapDrainPop = 0;
      return;
    }
    const pc = this.playerToWorldCell();
    const lix = Math.floor(pc.cx), liy = Math.floor(pc.cy);
    const key = `${pc.tx}_${pc.ty}_${lix}_${liy}`;
    if (key !== this._trapCellKey) {
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
      if (!entry || !entry.traps) { this._trapHere = null; return; }   // retry next frame
      this._trapCellKey = key;
      const found = Traps.trapAt(entry, lix, liy);
      // A disarmed trap (Trap Disarm Kit) is gone for good — never bites,
      // never bleeds, and never draws (see render.js). trapAt still finds
      // the record (it's a pure function of the tile), so the disarm has to
      // be checked here rather than removed from entry.traps itself.
      // isTrapDisarmed: a goblin's LAID snare keeps that on the record, not
      // the save (traps.js) — one question for both.
      this._trapHere = (found && Traps.isTrapDisarmed(this.save, found)) ? null : found;
      // Stepping off ends the bleed: no partial second carries to the next trap.
      this._trapDrainAccum = 0;
      this._trapDrainPop = 0;
    }
    const trap = this._trapHere;
    if (!trap) return;
    // A goblin's snare EXPIRES (Traps.LAID_LIFE_MS) — and is disarmed on its
    // record — under a player who may still be standing on the cell the memo
    // was taken for; a snare that is gone stops biting then, not at the next
    // cell crossed.
    if (trap._laid && !Traps.isLive(trap, Date.now())) { this._trapHere = null; return; }
    // The cell the numbers land on — an ABSOLUTE cell, which is what _popEnergy
    // wants (it is the trap's own cell, which is also the player's).
    const { cellIX: ix, cellIY: iy } = tileCellToAbs(this, pc.tx, pc.ty, lix, liy);

    // First contact. spring() returns false for one already recorded, so this
    // branch runs exactly once per trap however long the player stands on it.
    // springTrap: a laid snare springs on its record and mints no save id.
    if (Traps.springTrap(this.save, trap)) {
      const before = this.save.energy ?? 0;
      // The raw trap is shared. Combat.playerDamage applies the receiving
      // player's Hard penalty after boots mitigate both bite and bleed.
      // A laid snare bites at its trapper's power (Traps.trapPower — an
      // elite's snare bites harder); a generated trap at 1.
      // Only boots protect against traps; apply their soak before banking pips.
      const bite = Traps.STEP_ENERGY * Difficulty.get().trapBiteMul * Traps.trapPower(trap);
      Energy.set(this.save, before - (Conditions.damageImmune(this.save) ? 0 : Combat.playerDamage(bite, { boots: this.save.armor?.boots })));
      const spent = before - this.save.energy;
      this._painFlash(spent);
      // Say the real number: an empty bar loses nothing, so nothing is popped —
      // the toast below is what tells the player what happened either way.
      if (spent > 0) this._popEnergy(-spent, { ix, iy, label: '🪤 trap' });
      this._warnIfTiring(before);
      if (this.updateEnergyDOM) this.updateEnergyDOM();
      const ps = this.playerScreen ? this.playerScreen() : null;
      const bleed = +Combat.playerDamage(Traps.STAND_ENERGY_PER_S * Traps.trapPower(trap), { boots: this.save.armor?.boots }).toFixed(1);
      this.flash(`🪤 a trap! −${bleed}⚡/s — step off`,
        ps ? ps.x : undefined, ps ? ps.y - ENERGY_POP_HEAD_PX - 22 : undefined);
      // The reveal has to survive a reload, so it is written now rather than
      // waiting on some later caller's persist.
      if (typeof persistSave === 'function') persistSave(this.save);
      // TRAP PIN: the jaw clamps your leg - the body holds while the world
      // waits. The `pinned` row of Conditions.DEFINITIONS owns how long;
      // update() skips the whole movement block while it holds (_bodyHold —
      // no walking, so no walking energy drain while clamped), and
      // _tickConditions tells the "pried free" story when it runs out.
      Conditions.apply(this.save, 'pinned');
      // The FIRST trap a save ever springs tells its story. A busy screen
      // returns false unmarked (see the story ledger), so the next trap asks
      // again rather than burning the moment - that is correct, not a bug.
      this._storySplashOnce('trap', {
        art: 'trap_jaw',
        title: 'A trap!',
        body: 'Iron jaws snap around your leg. You are trapped!',
      });
      return;   // the bite is this frame's cost; the bleed starts on the next
    }

    // Still standing on a sprung one. Float accumulator → whole pips, the same
    // shape the passive rests use, so a fractional per-frame drain doesn't
    // churn save.energy and the DOM every frame.
    this._trapDrainAccum = (this._trapDrainAccum || 0)
      + Combat.playerDamage(Traps.STAND_ENERGY_PER_S * Traps.trapPower(trap), { boots: this.save.armor?.boots }) * dt;
    const pips = Math.floor(this._trapDrainAccum);
    if (pips > 0) {
      this._trapDrainAccum -= pips;
      const before = this.save.energy ?? 0;
      if (before > 0) {
        this._trapDrainPop = (this._trapDrainPop || 0) + this._losePlayerEnergy(pips);
      }
    }
    // One throttled pop for everything the trap has taken this window — the
    // slime-leech roll-up, for the same reason: a number a second stacks into
    // an unreadable column.
    const now = performance.now();
    if (this._trapDrainPop > 0 && now - (this._lastTrapFlashT || 0) > 1200) {
      this._lastTrapFlashT = now;
      const drained = this._trapDrainPop;
      this._trapDrainPop = 0;
      this._popEnergy(-drained, { ix, iy, label: '🪤 trap' });
      if (typeof persistSave === 'function') persistSave(this.save);
    }
  }

  // ── Lava ──────────────────────────────────────────────────────────────────
  // Surface crater vents and WorldGen.LAVA_DEPTH building rock are lava
  // (T.CAVE_LAVA): walkable, and it burns Combat.LAVA_DMG_PER_S energy a
  // second for as long as the FEET are in it (playerToWorldCell — never the
  // camera anchor). Lava owns an environmental damage lane because the ground,
  // not a foe, deals it: fire resistance reduces it; mode, shield and armour
  // do not. A float
  // accumulator banks whole pips through _losePlayerEnergy (Energy.set, the hit
  // flinch); one throttled pop names the cell, and the burn leaves shop dialogs
  // open. Stands down on an empty bar (Combat.playerDowned — being upright,
  // not being noticed; a Shadow Powder does not cool lava).
  _tickLava(dt) {
    if ((this.depth !== 0 && this.depth !== WorldGen.LAVA_DEPTH) || !this.startWorldM
        || Combat.playerDowned(this.save.energy)) {
      this._lavaAccum = 0;
      return;
    }
    const pc = this.playerToWorldCell();
    const lix = Math.floor(pc.cx), liy = Math.floor(pc.cy);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
    const N = entry && entry.cellsPerEdge;
    if (!entry || !entry.grid || lix < 0 || liy < 0 || lix >= N || liy >= N
        || entry.grid[liy * N + lix] !== WorldGen.T.CAVE_LAVA) {
      this._lavaAccum = 0;   // stepping out ends the burn: no partial second carries
      return;
    }
    const { cellIX: ix, cellIY: iy } = tileCellToAbs(this, pc.tx, pc.ty, lix, liy);
    this._lavaAccum = (this._lavaAccum || 0) + Combat.LAVA_DMG_PER_S * dt;
    this._ignitePlayer();   // and the burn outlasts the step out (Conditions `burning`)
    const pips = Math.floor(this._lavaAccum);
    if (pips > 0) {
      this._lavaAccum -= pips;
      const damage = Conditions.fireDamage(this.save, pips);
      this._lavaPop = (this._lavaPop || 0) + this._losePlayerEnergy(damage);
    }
    const now = performance.now();
    if (this._lavaPop > 0 && now - (this._lastLavaFlashT || 0) > 1200) {
      this._lastLavaFlashT = now;
      const burned = this._lavaPop;
      this._lavaPop = 0;
      this._popEnergy(-burned, { ix, iy, label: '🔥 lava' });
      if (typeof persistSave === 'function') persistSave(this.save);
    }
  }

  // Sharp obstacles hurt on entry and throughout contact, including pauses.
  // Exact intervals catch briefly crossed cells; overlapping props count once.
  // Fractional mitigated damage carries between frames.
  _walkHazardCell(tx, ty, cx, cy) {
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry?._spawned) return 0;
    const c = tileCellToAbs(this, tx, ty, cx, cy);
    const p = absCellCenterMeters(this, c.cellIX, c.cellIY);
    const half = (entry.tileEdgeM || this.tileEdgeM) / entry.cellsPerEdge / 2;
    const picked = setOf(this.save.picked), chopped = setOf(this.save.chopped);
    const burned = setOf(this.save.burnedObjects);
    let rate = 0;
    for (const list of ['objects', 'wildplants']) {
      WorldGen.forEachItemInBox(entry, list, p.x - half, p.y - half, p.x + half, p.y + half, o => {
        if (!isWalkHazard(o) || o.chopped || picked.has(o.id) || chopped.has(o.id) || burned.has(o.id)) return;
        const oc = worldMetersToAbsCell(this, o.x, o.y);
        if (oc.cellIX === c.cellIX && oc.cellIY === c.cellIY) rate = Math.max(rate, walkHazardDamageRate(o));
      });
    }
    return rate;
  }

  _walkHazardSlow() {
    if (this._slowHere === 'tar') return true;
    if (!this.startWorldM) return false;
    const p = this.playerToWorldCell();
    if (this._walkHazardCell(p.tx, p.ty, Math.floor(p.cx), Math.floor(p.cy)) >= CHARRED_SPIKE_DAMAGE_PER_S) return true;
    // Ordinary stakes keep their old slowdown without the charred spikes' damage.
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(p.tx, p.ty));
    if (!entry?._spawned) return false;
    const i = Math.floor(p.cy) * entry.cellsPerEdge + Math.floor(p.cx);
    if (entry.slowCells?.get(i) !== 'stakes') return false;
    const cleared = new Set([...(this.save.picked || []), ...(this.save.burnedObjects || [])]);
    return (entry.objects || []).some(o => o.kind === 'stakes' && o._street !== 'burned'
      && !cleared.has(o.id) && SpawnOwnership.tileCells(this, entry, o, p.tx, p.ty).includes(i));
  }

  // Time-weighted contact damage rate for any moving body, in world metres.
  _walkHazardExposure(x0, y0, x1, y1, visit) {
    if (!this.startWorldM) return 0;
    if (x0 === x1 && y0 === y1) {
      const p = worldMetersToTileCell(this, x0, y0);
      const rate = this._walkHazardCell(p.tx, p.ty, p.ix, p.iy);
      if (rate > 0) visit?.(`${p.tx},${p.ty},${p.ix},${p.iy}`, 0, 1, rate);
      return rate;
    }
    const a = worldMetersToTilePx(this, x0, y0), b = worldMetersToTilePx(this, x1, y1);
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!(length > 0)) return 0;
    // Mercator tile rows can have different cell counts, so split there
    // before traversing each row's own grid (as ground-fire trails do).
    const cuts = [0, 1], T = WorldGen.TILE_PX;
    if (dy !== 0) {
      for (let row = Math.floor(Math.min(a.y, b.y) / T) + 1; row * T < Math.max(a.y, b.y); row++) {
        cuts.push((row * T - a.y) / dy);
      }
    }
    cuts.sort((u, v) => u - v);
    let exposed = 0;
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i];
      const ty = Math.floor((a.y + dy * (lo + hi) / 2) / T);
      const n = this.cellsForRow ? this.cellsForRow(ty) : this.cellsPerTile;
      const line = [lo, hi].map(t => ({ x: a.x + dx * t, y: a.y + dy * t - ty * T }));
      const rates = new Map();
      Streets.reachIntervals(line, 1, T / n, (ix, iy) => {
        const tx = Math.floor(ix / n);
        const rate = this._walkHazardCell(tx, ty, ix - tx * n, iy);
        if (rate > 0) rates.set(`${ix},${iy}`, rate);
        return false;
      });
      if (visit) {
        for (const [key, rate] of rates) {
          const [ix, iy] = key.split(',').map(Number), tx = Math.floor(ix / n);
          const intervals = Streets.reachIntervals(line, 1, T / n, (x, y) => x === ix && y === iy);
          for (const [start, end] of intervals) {
            if (end > start) visit(`${tx},${ty},${ix - tx * n},${iy}`, lo + start / length, lo + end / length, rate);
          }
        }
      }
      for (const rate of new Set(rates.values())) {
        const intervals = Streets.reachIntervals(line, 1, T / n,
          (ix, iy) => rates.get(`${ix},${iy}`) === rate);
        for (const [start, end] of intervals) exposed += rate * (end - start) / length;
      }
    }
    return exposed;
  }

  _tickWalkHazards(dt, x0, y0, x1, y1) {
    if (!this.startWorldM || !(dt > 0)) return;
    const contacts = [];
    this._walkHazardExposure(x0, y0, x1, y1, (key, start, end, rate) => contacts.push({ key, start, end, rate }));
    contacts.sort((a, b) => a.start - b.start);
    let previous = this._walkHazardHere || null, end = 0, damage = 0;
    for (const contact of contacts) {
      if (contact.start > end + 1e-9) previous = null;
      if (previous !== contact.key) damage += Combat.incomingDamage(this.save, WALK_HAZARD_ENTRY_DAMAGE);
      damage += Combat.incomingDamage(this.save, contact.rate) * (contact.end - contact.start) * dt;
      previous = contact.key;
      end = contact.end;
    }
    this._walkHazardHere = end >= 1 - 1e-9 ? previous : null;
    if (Combat.playerDowned(this.save.energy) || Conditions.damageImmune(this.save)) {
      this._walkHazardAccum = 0;
      return;
    }
    this._walkHazardAccum = (this._walkHazardAccum || 0) + damage;
    const pips = Math.floor(this._walkHazardAccum + 1e-9);
    if (pips > 0) {
      this._walkHazardAccum = Math.max(0, this._walkHazardAccum - pips);
      const lost = this._losePlayerEnergy(pips);
      if (lost > 0) {
        this._popEnergy(-lost);
        persistSave(this.save);
      }
    }
  }

  // ── The goblin trapper's snares ───────────────────────────────────────────
  // A trapper (Combat.monsterLays) that has noticed the player lays a snare
  // at its declared attack interval on an EMPTY cell on the line between them
  // (Traps.layPoints — midpoint first, never either body's own cell), up to
  // Traps.LAID_MAX live snares of its own at once. The cell must pass
  // Traps.canLay (walkable on the live grid, off the drawn road, under no
  // seated object, no trap already there) and hold none of the player's
  // Magic Traps. The snare itself is the ordinary trap (Traps.layTrap →
  // entry.laidTraps), so _tickTraps bites and bleeds on it exactly as on a
  // generated one, and a Trap Disarm Kit shuts it. Called from
  // wanderCreatures behind the same `unnoticed` / `standDown` gates the blows
  // sit behind. `now` is the loop's performance clock (the cadence); a
  // snare's expiry is wall-clock, like every other expiry on a record.
  _trapperLay(c, now, px, py) {
    if (typeof Traps === 'undefined') return;
    if (c._nextLayT && now < c._nextLayT) return;
    const m = Combat.monster(c.kind);
    const layIntervalMs = m.damageIntervalSeconds * 1000;
    const dist = Math.hypot(px - c.x, py - c.y);
    if (dist > ((m?.range || 1) + TRAPPER_LAY_SLACK_CELLS) * this.cellM) return;
    const wall = Date.now();
    const pc = this.playerToWorldCell();
    // The 3×3 ring of tiles round the player's feet: the trapper is inside
    // the sim bubble, so every cell on the line to the player is in here.
    const ring = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const e = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx + dx, pc.ty + dy));
        if (e) { Traps.pruneLaid(e, wall); ring.push(e); }
      }
    }
    if (Traps.laidOut(ring, c.id, wall) >= Traps.LAID_MAX) {
      c._nextLayT = now + layIntervalMs;
      return;
    }
    const same = (a, b) => a.tx === b.tx && a.ty === b.ty && a.ix === b.ix && a.iy === b.iy;
    const mine = this.cellAt(px, py), own = this.cellAt(c.x, c.y);
    const half = this.cellM / 2;
    const magic = PlacedFloor.forDepth(this.save.magicTraps, this.depth || 0);
    for (const p of Traps.layPoints(c.x, c.y, px, py, this.cellM)) {
      const cell = this.cellAt(p.x, p.y);
      if (!cell.loaded || same(cell, mine) || same(cell, own)) continue;
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
      if (!Traps.canLay(entry, cell.ix, cell.iy)) continue;
      const cc = absCellCenterMeters(this, cell.cellIX, cell.cellIY);
      if (magic.some(t => Math.abs(t.x - cc.x) < half && Math.abs(t.y - cc.y) < half)) continue;
      // The snare bites with its trapper's power (its elite factor), like
      // every other blow a guard lands — Traps.trapPower reads it back.
      Traps.layTrap(entry, cell.tx, cell.ty, entry.tileEdgeM || this.tileEdgeM,
        cell.ix, cell.iy, c.id, wall, this.depth || 0, Combat.powerMul(c));
      c._nextLayT = now + layIntervalMs;
      return;
    }
    // Nowhere on the line will take one (rock, road, the player too close):
    // look again in a second rather than on every frame.
    c._nextLayT = now + 1000;
  }

  // ── The player's Magic Traps ──────────────────────────────────────────────
  // Every MAGIC_TRAP_TICK_MS: the first ENEMY (Combat.isEnemy — never game,
  // never a pet, never the player) standing on the cell of an armed trap on
  // this level is HELD for MAGIC_TRAP_HOLD_MS — the Frost Powder's own
  // c._frozenUntil, with its hop pinned where it stands — and takes
  // magicTrapDamage() through _damageEnemy with source 'player': the player
  // set the trap, so a trap kill is a player kill (bounty, drop, quest tick).
  // The trap is spent — spliced out of save.magicTraps, which also takes its
  // light off the lightmap (Lighting.collectMagicTraps) — and the save
  // persists. Cells are compared as ABSOLUTE cells (worldMetersToAbsCell), the
  // way every tap and every placed thing is.
  _tickMagicTraps() {
    const list = this.save && this.save.magicTraps;
    if (!list || !list.length || !this.startWorldM) return;
    const now = performance.now();
    if (now - (this._magicTrapT || 0) < MAGIC_TRAP_TICK_MS) return;
    this._magicTrapT = now;
    let armed = null;
    for (const t of PlacedFloor.forDepth(list, this.depth || 0)) {
      const a = worldMetersToAbsCell(this, t.x, t.y);
      (armed || (armed = new Map())).set(cellKeyFromAbsCell(a.cellIX, a.cellIY), t);
    }
    if (!armed) return;
    const caughtSet = setOf(this.save.caught);
    const pc = this.playerToWorldCell();
    const hits = [];
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, (c) => {
      if (!Combat.isEnemy(c) || caughtSet.has(c.id)) return;
      const a = worldMetersToAbsCell(this, c.x, c.y);
      const key = cellKeyFromAbsCell(a.cellIX, a.cellIY);
      const t = armed.get(key);
      if (!t) return;
      armed.delete(key);                   // one foe per trap
      hits.push({ t, c, ix: a.cellIX, iy: a.cellIY });
    });
    if (!hits.length) return;
    const until = Date.now() + MAGIC_TRAP_HOLD_MS;
    for (const { t, c, ix, iy } of hits) {
      const i = list.indexOf(t);
      if (i >= 0) list.splice(i, 1);
      c._frozenUntil = Math.max(c._frozenUntil || 0, until);
      c._startX = c._targetX = c.x;
      c._startY = c._targetY = c.y;
      Combat.flagStatus(c, Combat.STATUS_LOOKS.frozen);
      this._damageEnemy(c, magicTrapDamage(), 'player');
      const at = this._cellToastAt(ix, iy, CELL_PX);
      this.flash('✨ Magic trap sprung', at.x, at.y);
    }
    persistSave(this.save);
  }

  // THE PAIN EFFECT — what being bitten looks like. Two things on top of the
  // body's own flinch, each on its own side of the reduced-motion line:
  //   • a red pulse around the map's rim — the vignette's construction (nested
  //     1px rings, since Phaser Graphics has no gradient) in the danger red,
  //     faded out by one tween. A fade, not a flicker, so it stays on under
  //     reduced motion: something has to mark the hit for a player who has
  //     turned the rest off;
  //   • a short camera shake, which is motion and is the one piece suppressed.
  // Depth 92: above the vignette (90) and below the work wheel (95), and
  // unmasked like both of them — it is UI about the body, not a world layer.
  _painFlash(dmg) {
    // The BODY's own channel first — the red flick + haptic buzz + blood
    // burst every other blow on the player uses (_flashPlayerHit). The rest
    // of this method is what a trap adds on top of that: it is the biggest
    // single hit in the game, so it also reaches the edges of the screen.
    this._flashPlayerHit(dmg);
    if (!this.add || !this.tweens || this.viewLeft == null) return;
    const g = this.add.graphics().setDepth(92);
    const x0 = this.viewLeft, y0 = this.viewTop, size = this.viewSize;
    const RINGS = 12;
    for (let i = 0; i < RINGS; i++) {
      // Quadratic falloff inward, like the vignette's own soft ramp, so the
      // red reads as blood at the edges of vision rather than as a red frame.
      const a = 0.55 * (1 - i / RINGS) ** 2;
      // The UI's own danger red (util.js), not a second one picked here.
      g.lineStyle(1, parseInt(UI_DANGER.slice(1), 16), a);
      g.strokeRect(x0 + i + 0.5, y0 + i + 0.5, size - i * 2 - 1, size - i * 2 - 1);
    }
    this.tweens.add({
      targets: g, alpha: 0, duration: 420, ease: 'Sine.In',
      onComplete: () => g.destroy(),
    });
    if (!this._reducedMotion) {
      try { this.cameras.main.shake(160, 0.006); } catch (_) { /* no camera in a stub scene */ }
    }
  }

  // Debug (☰ › Developer › "Road IDs"): what the vector tiles actually hand us
  // per street, so the street-restoration key can be chosen against real
  // data rather than guessed. For the 3×3 tiles around the player it reports,
  // per `transportation` line feature: the MVT feature id (the decoder reads
  // one; nothing has ever checked it is non-zero), whether an id repeats
  // across tiles (a way clipped into pieces keeping its id) or within one
  // (Planetiler merging same-attribute lines), how many pieces are multi-line
  // (merged), and a sample of features with class / vertices / length. The
  // same numbers for `transportation_name`, whose ids may differ. Copyable via
  // the #errbar overlay, like dumpTileDebug — there is no console on a phone.
  debugRoadIds() {
    const out = [];
    try {
      const { tx, ty } = this.playerToWorldCell();
      const cache = WorldGen.tileCache;
      const tiles = [];
      eachTile3x3(tx, ty, (itx, ity) => {
        const key = WorldGen.tileKey(itx, ity);
        const entry = cache && cache.get(key);
        if (entry && entry.layers) tiles.push({ key, entry });
      });
      out.push(`tiles loaded around player: ${tiles.length}/9 (walk a bit if fewer)`);
      const seenIn = new Map();       // id -> Set(tileKey)
      const report = (layerName) => {
        let feats = 0, withId = 0, multiLine = 0, verts = 0, lenM = 0;
        const perTileIds = new Map();  // tileKey -> Map(id -> count)
        const classes = new Map();
        const sample = [];
        for (const { key, entry } of tiles) {
          const edgeM = entry.tileEdgeM || 0;
          const idsHere = new Map();
          perTileIds.set(key, idsHere);
          for (const l of entry.layers) {
            if (l.name !== layerName) continue;
            const mvtToM = edgeM / (l.extent || 4096);
            for (const f of l.features) {
              if (f.type !== 2 || !f.geom) continue;
              feats++;
              const id = f.id || 0;
              if (id) {
                withId++;
                idsHere.set(id, (idsHere.get(id) || 0) + 1);
                if (!seenIn.has(id)) seenIn.set(id, new Set());
                seenIn.get(id).add(key);
              }
              if (f.geom.length > 1) multiLine++;
              const cls = (f.tags && f.tags.class) || '-';
              classes.set(cls, (classes.get(cls) || 0) + 1);
              let fl = 0, fv = 0;
              for (const line of f.geom) {
                fv += line.length;
                for (let i = 1; i < line.length; i++) {
                  fl += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y) * mvtToM;
                }
              }
              verts += fv; lenM += fl;
              if (sample.length < 10) {
                const a = f.geom[0][0], b = f.geom[f.geom.length - 1].slice(-1)[0];
                sample.push(`  ${key} id=${id} ${cls}${f.tags && f.tags.subclass ? '/' + f.tags.subclass : ''}`
                  + ` lines=${f.geom.length} verts=${fv} len=${Math.round(fl)}m`
                  + ` (${a.x},${a.y})→(${b.x},${b.y})${f.tags && f.tags.name ? ' "' + f.tags.name + '"' : ''}`);
              }
            }
          }
        }
        // Ids shared by 2+ tiles (a way's pieces keep their id across seams),
        // and ids repeated INSIDE a tile (two features, one id).
        let crossTile = 0, dupInTile = 0;
        for (const [, set] of seenIn) if (set.size > 1) crossTile++;
        for (const [, m] of perTileIds) for (const [, n] of m) if (n > 1) dupInTile++;
        out.push('', `[${layerName}] line features: ${feats}, with non-zero id: ${withId}`
          + ` (${feats ? Math.round(100 * withId / feats) : 0}%)`);
        out.push(`  distinct ids: ${seenIn.size}, ids seen in 2+ tiles: ${crossTile}, ids repeated within a tile: ${dupInTile}`);
        out.push(`  multi-line (merged) features: ${multiLine}, vertices: ${verts}, total length: ${(lenM / 1000).toFixed(1)} km`);
        const top = [...classes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([c, n]) => `${c}:${n}`).join(' ');
        out.push(`  classes: ${top}`);
        out.push('  sample:');
        out.push(...(sample.length ? sample : ['  (none)']));
        seenIn.clear();
      };
      report('transportation');
      report('transportation_name');
      // Was this tile served from the network or the IndexedDB cache? A stale
      // cached tile could carry a different build's ids than a fresh one.
      const me = tiles.find(t => t.key === WorldGen.tileKey(tx, ty));
      out.push('', `player tile: ${WorldGen.tileKey(tx, ty)} edge=${me ? Math.round(me.entry.tileEdgeM) : '?'}m`);
    } catch (e) {
      out.push('', 'ERROR: ' + (e && e.stack || e));
    }
    const text = out.join('\n');
    try { console.log('[roadids]\n' + text); } catch (_) {}
    if (window.showError) window.showError('ROAD IDS (copy me)', text);
  }

  // === Starter-area wrappers ===
  // (Per-tile spawning lives in scene_creatures.js › spawnInTile.)
  // Starter-area setup — see Starter.starterTrailAnchor (src/starter.js).
  _starterTrailAnchor() { return Starter.starterTrailAnchor(this); }

  // Starter-area setup — see Starter.pestFreeZone (src/starter.js).
  _pestFreeZone(tx, ty) { return Starter.pestFreeZone(this, tx, ty); }

  // Starter-area setup — see Starter.setStarterCratesAt (src/starter.js).
  _setStarterCratesAt(x, y) { return Starter.setStarterCratesAt(this, x, y); }

  // Starter-area setup — see Starter.placeStarterTrail (src/starter.js).
  _placeStarterTrail(entry, tx, ty) { return Starter.placeStarterTrail(this, entry, tx, ty); }

  // Starter-area setup — see Starter.scatterStarterStash (src/starter.js).
  _scatterStarterStash(entry, tx, ty, spawnIX, spawnIY, usedSeats) { return Starter.scatterStarterStash(this, entry, tx, ty, spawnIX, spawnIY, usedSeats); }

  // Starter-area setup — see Starter.revealStarterTrail (src/starter.js).
  _revealStarterTrail(entry, tx, ty, spawnIX, spawnIY) { return Starter.revealStarterTrail(this, entry, tx, ty, spawnIX, spawnIY); }

  // Starter-area setup — see Starter.placeStarterRelicChest (src/starter.js).
  _placeStarterRelicChest(entry, tx, ty, spawnIX, spawnIY, usedSeats, seatWant) { return Starter.placeStarterRelicChest(this, entry, tx, ty, spawnIX, spawnIY, usedSeats, seatWant); }

  // Starter-area setup — see Starter.carveStarterPlot (src/starter.js).
  _carveStarterPlot(entry, tx, ty, spawnIX, spawnIY, usedSeats) { return Starter.carveStarterPlot(this, entry, tx, ty, spawnIX, spawnIY, usedSeats); }

  // Starter-area setup — see Starter.carveStarterPond (src/starter.js).
  _carveStarterPond(entry, tx, ty) { return Starter.carveStarterPond(this, entry, tx, ty); }

  // Starter-area setup — see Starter.paintPond (src/starter.js).
  _paintPond(entry, tx, ty, cx, cy) { return Starter.paintPond(this, entry, tx, ty, cx, cy); }

  // Starter-area setup — see Starter.carveStarterPondAround (src/starter.js).
  _carveStarterPondAround() { return Starter.carveStarterPondAround(this); }

  // Starter-area setup — see Starter.starterHomeObject (src/starter.js).
  _starterHomeObject(rec) { return Starter.starterHomeObject(this, rec); }

  // Starter-area setup — see Starter.starterHomeWildplant (src/starter.js).
  _starterHomeWildplant(rec) { return Starter.starterHomeWildplant(this, rec); }

  // Starter-area setup — see Starter.starterHomeStream (src/starter.js).
  _starterHomeStream(entry, rec) { return Starter.starterHomeStream(this, entry, rec); }

  // Starter-area setup — see Starter.provisionStarterHome (src/starter.js).
  _provisionStarterHome(entry, tx, ty, spawnIX, spawnIY, usedSeats) { return Starter.provisionStarterHome(this, entry, tx, ty, spawnIX, spawnIY, usedSeats); }

  // Dark-outlined, solid-filled arrow triangle for facing and guidance.
  _drawArrowTriangle(g, tx, ty, blx, bly, brx, bry, outlineAlpha, fillColor) {
    g.lineStyle(2, 0x000000, outlineAlpha);
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(blx, bly);
    g.lineTo(brx, bry);
    g.closePath();
    g.strokePath();
    g.fillStyle(fillColor, 1);
    g.fillTriangle(tx, ty, blx, bly, brx, bry);
  }

  // One footprint: a slight oval, long axis along the step that made it,
  // sitting under the foot that made it rather than on the body's centreline.
  // The lateral shift is the sprite's own half-stance (see
  // FOOT_STANCE_HALF_ART_PX) taken perpendicular to the step and signed by
  // fp.side, so consecutive prints fall either side of the line of travel and
  // the pair straddles it — this is NOT a feet offset of the kind the ground
  // marks used to carry (see feet_anchor.test.js): the two sides cancel, and
  // the track's centreline is still the point the body walked through.
  //
  // Graphics has no rotated-ellipse fill, so the oval is a polygon — 14 points
  // is smooth at this size (a 4px-wide shape), and cheap: at most 5 prints are
  // alive at once.
  _fillFootprint(g, cx, cy, fp) {
    const { ux, uy } = fp;                  // every print carries its step
    const px = -uy, py = ux;                // perpendicular to it
    const off = FOOT_STANCE_HALF_ART_PX * this.playerScale * fp.side;
    const ox = cx + px * off, oy = cy + py * off;
    const pts = [];
    const N = 14;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const a = Math.cos(t) * FOOT_DOT_LONG, b = Math.sin(t) * FOOT_DOT_ACROSS;
      pts.push({ x: ox + ux * a + px * b, y: oy + uy * a + py * b });
    }
    g.fillPoints(pts, true);
  }

  // Edge compass: an arrow parked on the rim of the viewport pointing at a
  // world-space target. The delivery waypoint and starter-crate trail share
  // it, so the ring geometry
  // lives here once instead of being re-derived (identically) at each site.
  // Returns the distance to the target in metres so callers can decide when
  // "close enough" retires their arrow.
  //
  // Draws NOTHING for a target already inside the viewport (see below). That
  // is deliberately here and not at the call sites: it is a fact about what an
  // edge compass is for, not a policy any one caller owns, and the callers'
  // own retire rules (the delivery waypoint's 1.2 cells, the starter arrow's
  // 1.5) are about clearing their STATE, which still happens on their own
  // terms. The return value is unchanged either way, so that logic is
  // untouched.
  _drawEdgeCompass(targetWX, targetWY, fillColor, outlineAlpha = 0.85) {
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    const dxM = targetWX - pWX, dyM = targetWY - pWY;
    const mag = Math.hypot(dxM, dyM);
    if (!(mag > 0.001)) return mag;
    const ux = dxM / mag, uy = dyM / mag;
    const dist = Math.min(this.viewSize / 2 - 18, 140);
    // An edge compass is for a target you CANNOT SEE. Once the target's own
    // cell is inside the masked map rect, the arrow stops being a bearing and
    // becomes clutter parked on the world — and because it parks on a FIXED
    // ring (dist, ~4.4 cells) while the target slides in toward it, the two
    // meet: the compass triangle lands squarely on the first supply crate on the
    // opening screen, hiding the very thing it is pointing at, and pointing
    // past it. Reproduced at 390×844, 360×640 and 768×1024 on a fresh save.
    //
    // Half a cell of inset so a target sitting right on the mask edge — drawn
    // half-clipped, easy to miss — still gets its arrow.
    //
    // "Can I see it?" is a question about the SCREEN, so it's asked of the
    // camera anchor (a peek drag can bring the target into view without the
    // player having moved a step); the arrow itself is a bearing from the body,
    // so it rings the player wherever they now are on screen.
    const ts = this.worldMetersToScreen(targetWX, targetWY);
    const sx = ts.x - this.viewCenterX;
    const sy = ts.y - this.viewCenterY;
    const half = this.viewSize / 2 - CELL_PX / 2;
    if (Math.abs(sx) <= half && Math.abs(sy) <= half) return mag;
    const ps = this.playerScreen();
    const tipX = ps.x + ux * dist, tipY = ps.y + uy * dist;
    // Perpendicular to the bearing gives the triangle's base.
    const pxN = -uy, pyN = ux;
    const back = 14, halfW = 7;
    this._drawArrowTriangle(this.facingGfx, tipX, tipY,
      tipX - ux * back + pxN * halfW, tipY - uy * back + pyN * halfW,
      tipX - ux * back - pxN * halfW, tipY - uy * back - pyN * halfW,
      outlineAlpha, fillColor);
    return mag;
  }

  // Small, persistent bearings sit on the visible map rim, including while
  // their target is on screen. Intersect the ray with the rectangle so diagonal
  // bearings reach the edge too, and keep the whole dot inside the mask.
  _drawEdgeDot(targetWX, targetWY, fillColor) {
    const dx = targetWX - this.startWorldM.x - this.playerM.x;
    const dy = targetWY - this.startWorldM.y - this.playerM.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.001) return;
    const inset = 5;
    const left = Math.max(0, this.viewLeft) + inset;
    const right = Math.min(W, this.viewLeft + this.viewSize) - inset;
    const top = Math.max(0, this.viewTop) + inset;
    const bottom = Math.min(H, this.viewTop + this.viewSize) - inset;
    if (left >= right || top >= bottom) return;
    const ps = this.playerScreen();
    const x = Math.max(left, Math.min(right, ps.x));
    const y = Math.max(top, Math.min(bottom, ps.y));
    const tx = dx > 0 ? (right - x) / dx : dx < 0 ? (left - x) / dx : Infinity;
    const ty = dy > 0 ? (bottom - y) / dy : dy < 0 ? (top - y) / dy : Infinity;
    const t = Math.min(tx, ty);
    const px = x + dx * t, py = y + dy * t;
    this.facingGfx.fillStyle(0x000000, 0.85);
    this.facingGfx.fillCircle(px, py, 4);
    this.facingGfx.fillStyle(fillColor, 1);
    this.facingGfx.fillCircle(px, py, 3);
  }

  _drawTrackedEdgeDot(key, color) {
    const marker = this.save[key];
    if (!marker) return;
    if (Date.now() >= marker.until) {
      delete this.save[key];
      persistSave(this.save);
      return;
    }
    if (marker.depth !== (this.depth || 0)) return;
    // World lookups need not run at render cadence; moving targets refresh
    // twice per second while the edge projection still follows every frame.
    const now = Date.now();
    const memo = (this._edgeDotTargets ||= {});
    if (memo[key]?.marker !== marker || now - memo[key].at >= 500) {
      memo[key] = { marker, at: now, target: this._telescopeTrackedTarget(marker) };
    }
    const target = memo[key].target;
    if (!target) {
      delete this.save[key];
      persistSave(this.save);
      return;
    }
    this._drawEdgeDot(target.x, target.y, color);
  }

  // The nearest starter supply crate the player has not opened yet, or null.
  // The crate trail (see _placeStarterTrail) is seeded along the road out to
  // 15 cells, but the viewport is only VIEW_CELLS across — so most of the
  // trail spawns off-screen, and without a bearing the "follow the breadcrumbs"
  // onboarding is unfollowable. Ids are stamped `chest_start_*` at placement,
  // which is what distinguishes them from ordinary POI chests.
  //
  // SUPPLY CRATES FIRST, the relic chest LAST. The relic chest carries the
  // same stamp but is not a crate: it sits a screen out, and on the kerb /
  // ring fallbacks in _placeStarterTrail not necessarily the way the crates
  // went. Plain nearest-first sent the arrow to it whenever the player stood
  // nearer it than the crates — "it pointed south but the crates were east".
  // The chest is the trail's END, so it is the target only once no supply
  // crate is left unopened.
  _nearestStarterCrate() {
    const opened = setOf(this.save.opened);
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    let crate = null, crateD2 = Infinity, chest = null, chestD2 = Infinity;
    for (const e of WorldGen.tileCache.values()) {
      // The starter chests of each tile, derived once (util.js derivedObjects)
      // rather than picked out of every cached tile's every object on each ask.
      for (const o of derivedObjects(e, '_starterChests', (o) => o.kind === 'chest' && !!o.id && String(o.id).startsWith('chest_start_'))) {
        if (opened.has(o.id)) continue;
        const dx = o.x - pWX, dy = o.y - pWY;
        const d2 = dx * dx + dy * dy;
        if (o.crate) { if (d2 < crateD2) { crateD2 = d2; crate = o; } }
        else if (d2 < chestD2) { chestD2 = d2; chest = o; }
      }
    }
    return crate || chest;
  }

  // Where the green starter arrow points for the ACTIVE ladder step: the space
  // the chip is actually talking about, not a generic breadcrumb.
  //
  //   chest   → nearest unopened starter crate (the relic chest included)
  //   till    → the carved 2x2 starter plot
  //   plant   → the tilled-but-empty soil — or the crates while the bag holds
  //             no seed, since the seeds are in them (nearest crate first)
  //   restore → the nearest wreck — or the crates while the bag can't pay the
  //             restore cost, since the materials are in them
  //   harvest → the nearest crop the player planted
  //   sell    → Home (selling only happens there)
  //
  // Falling back to the crates for every step pointed the arrow at the relic
  // chest, a screen away, while the chip asked for soil/crop/wreck/house near
  // spawn (the crates pack into the first cells, TRAIL_SPAN). Each
  // unresolvable target still falls back to the crates, which remain worth
  // collecting.
  _starterGuidanceGoal(step) {
    const sv = this.save;
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    const nearest = (pts) => {
      let best = null, bestD2 = Infinity;
      for (const p of pts) {
        if (!p || !Number.isFinite(p.x)) continue;
        const dx = p.x - pWX, dy = p.y - pWY, d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = p; }
      }
      return best;
    };
    // starterPlotAt is the top-left cell centre; aim at the 2x2's middle.
    const plotMiddle = () => (sv.starterPlotAt && Number.isFinite(sv.starterPlotAt.x))
      ? { x: sv.starterPlotAt.x + this.cellM / 2, y: sv.starterPlotAt.y + this.cellM / 2 }
      : null;
    switch (step.event) {
      case 'till':
        return plotMiddle() || this._nearestStarterCrate();
      case 'plant': {
        // An empty seed pocket means the crates are the step's real errand —
        // the nearest one is seeded first (STARTER_LOOT's order of need).
        const hasSeed = (sv.inv || []).some(s =>
          s && (s.count || 0) > 0 && ITEM_BY_ID[s.id]?.kind === 'seed');
        if (!hasSeed) return this._nearestStarterCrate() || plotMiddle();
        // The soil the chip says to tap: tilled cells nothing is planted in.
        const plantedCells = new Set((sv.planted || []).map(p => {
          const c = worldMetersToAbsCell(this, p.x, p.y);
          return cellKeyFromAbsCell(c.cellIX, c.cellIY);
        }));
        const open = [];
        for (const key of (this.tilledSet || [])) {
          if (plantedCells.has(key)) continue;
          const [ix, iy] = key.split('_').map(Number);
          open.push(absCellCenterMeters(this, ix, iy));
        }
        return nearest(open) || plotMiddle() || this._nearestStarterCrate();
      }
      case 'restore': {
        // While the bag can't pay a wreck's flat restore price and crates
        // remain unopened, the materials are in the crates — point there.
        const cost = this._wreckRestoreCost(null);
        if (Inventory.count(sv, cost.id) < cost.qty) {
          const crate = this._nearestStarterCrate();
          if (crate) return crate;
        }
        const wrecks = [];
        for (const e of WorldGen.tileCache.values()) {
          for (const o of (e.objects || [])) {
            if (this._isHouseWreck(o)) wrecks.push(o);
          }
        }
        return nearest(wrecks) || this._nearestStarterCrate();
      }
      case 'harvest':
        return nearest(sv.planted || []) || this._nearestStarterCrate();
      case 'sell': {
        // Home is the trailer at the frozen trail anchor; startWorldM until a
        // home capture moved it (same resolution rule as _pestFreeZone).
        const a = (sv.starterCratesAt && Number.isFinite(sv.starterCratesAt.x))
          ? sv.starterCratesAt : this.startWorldM;
        return (a && Number.isFinite(a.x)) ? { x: a.x, y: a.y } : this._nearestStarterCrate();
      }
      default:
        return this._nearestStarterCrate();
    }
  }

  // === Tick ===
  update(_, dtMs) {
    const _uB = window.__boot;
    if (!_uB) return this._updateTimed(_, dtMs);
    // A STILL step: the body hasn't moved since the last one and the camera
    // is on it. Most of a session is this — standing at a plot, reading a
    // dialog — and it is where an unconditional pass wastes the most, so the
    // profile reports these apart from the walking steps (the render tick
    // reads the same flag).
    const _pm = this.playerM, _pk = this.peekM;
    const _still = !!_pm && this._boot_lastPX === _pm.x && this._boot_lastPY === _pm.y
      && !(_pk && (_pk.x || _pk.y));
    if (_pm) { this._boot_lastPX = _pm.x; this._boot_lastPY = _pm.y; }
    this._boot_still = _still;
    const _ut0 = performance.now();
    try {
      return this._updateTimed(_, dtMs);
    } finally {
      const _dt = performance.now() - _ut0;
      _uB.tick('update (all)', _dt);
      if (_still) _uB.tick('update @still', _dt);
      // Border/road/building/fog layers all rebuild on the same frame the
      // player crosses a cell boundary (drawCells sets _boot_crossing from
      // its own borderDirty — see render.js). A second tick under a
      // different label, using the SAME measured span, separates those
      // periodic hitches from steady-state frames instead of averaging them
      // into invisibility.
      if (this._boot_crossing) _uB.tick('update @crossing', _dt);
    }
  }

  _updateTimed(_, dtMs) {
    // The whole per-frame body runs inside a try/catch — INCLUDING the boot
    // and modal-gate prologue, which used to sit before the try and was the
    // one per-frame stretch where a throw could still kill the loop. Phaser's
    // RAF driver reschedules the NEXT frame only AFTER this callback returns
    // (see RequestAnimationFrame.step in vendor/phaser.js), so a single
    // uncaught throw in here would permanently kill the game loop — frozen
    // render plus a dead input plugin, i.e. "the UI stops accepting taps."
    // Swallowing a bad frame keeps the loop (and taps) alive; _reportLoopError
    // surfaces the error so the underlying cause stays diagnosable on a phone.
    try {
    // First frame = the world is on screen. The boot overlay itself now waits
    // on the initial tile load rather than this frame (see create() /
    // _bootOverlayGone) — this flag only times the icon prewarm below.
    if (!this._bootStatusDone) {
      this._bootStatusDone = true;
      // Prewarm the modal-only icon sheets once the boot rush is over — 4s
      // gives the first map tiles and Phaser's own assets first claim on the
      // connection. See IconNet for why (treasure-modal icons were blank for
      // the whole first-fetch on slow lines).
      if (!window.__TEST_MODE) {
        setTimeout(() => { this._prewarmModalIcons(); this._prewarmFx(); }, 4000);
      }
    }
    // Keep body.modal-open honest. The MutationObserver in
    // _installModalPadGate misses an overlay that is REMOVED from the document
    // (the story and safety cards are), and a latched class hides the entire
    // bottom HUD. This is only a backstop for that case, and the sync forces a
    // style/layout flush (getClientRects on every .game-modal), so it runs on
    // a ~10-step throttle rather than every step — a removed overlay
    // un-latches within ~330 ms at the FPS_LIMIT cadence, which the eye
    // reads as instant.
    this._modalGateTick = (this._modalGateTick || 0) + 1;
    if (this._modalGateTick % 10 === 0) {
      this._syncModalGate?.();
      this._drainBadgeStories();
      this._lowHealthStory();
      this._firstSaleStory();
      DragonStory.drain(this);
      StoryEncounters.tick(this, Date.now());
      NPC.tickArrivals(this, Date.now());
    }
    const dt = dtMs / 1000;
    this._tickConditions();
    // Spring the peek camera home (no-op unless a drag just ended). FIRST, so
    // every projection below — and every draw pass this frame — reads one
    // settled camera position rather than two.
    this._tickPeek(dt);
    // Everything drawn AT the player rather than at a world position rides
    // this: the camera is normally on them, so it's the viewport centre, but a
    // peek drag slides them across the map like anything else standing on it.
    // playerScreen() is the GROUND point (feet-on-the-fix, the same point the
    // body's world position projects to); the contact shadow sits a pixel
    // under it, the offset it was created with.
    this._syncPlayerSkin();
    const pScreen = this.playerScreen();
    // …and the body's own centre rides bodyDy above that ground point: the
    // feet nudge while it is standing, 0 once it has collapsed onto its front
    // (playerBodyDy / PLAYER_DOWNED_ROTATION). Everything measured from the
    // sprite's centre below reads this local rather than the nudge, so the
    // whole body — labels included — goes down with it.
    const bodyDy = this.playerBodyDy();
    this.player?.setPosition(pScreen.x, pScreen.y + bodyDy)
      .setRotation(this.playerBodyRotation());
    this.playerShadow?.setPosition(pScreen.x, pScreen.y - 1);
    // Dragon powder is a 1-minute timed buff (this._dragonUntil, in-memory —
    // NOT persisted, so a refresh ends it), not a movement MODE:
    // a dragon walks the same way everyone walks, just with tier-8 boots' speed and energy efficiency (DRAGON_WALK_COST_TIER, see _walkRelics) and double damage. All the
    // edge does is swap the sprite skin
    const dragonActive = this.isDragonActive();
    if (this._dragonBuffActive !== dragonActive) {
      this._dragonBuffActive = dragonActive;
      this._applyDragonSkin(dragonActive);
    }
    // Potion of Blight: the aura itself on the ground point (a ground mark
    // sits on the fix — no body nudge); its countdown is a chip of the
    // status row under the HUD (Buffs.KINDS, _syncStatusRow).
    if (this.isBlightActive()) {
      // A slow breath in alpha only: the SIZE never moves, because the size
      // is the damage radius.
      const breath = 0.5 + 0.5 * Math.sin((performance.now() / 1000 / 1.6) * Math.PI * 2);
      const d = 2 * BLIGHT_R_CELLS * CELL_PX;
      this.blightAura
        .setDisplaySize(d, d)
        .setPosition(pScreen.x, pScreen.y)
        .setAlpha(0.8 + 0.2 * breath)
        .setVisible(true);
    } else if (this.blightAura.visible) {
      this.blightAura.setVisible(false);
    }
    // Action recovery lives on its Eat / Throw button, separate from status
    // effects. Each ticker skips work unless its selected item needs a change.
    this._tickEatButton();
    this._tickThrowButton();
    let vx = 0, vy = 0;
    let speedMul = 1;
    // Keyboard movement (WASD / arrow keys) is a manual takeover — any
    // non-zero vx/vy here means the player is driving themselves, so latch
    // off GPS for the rest of the session (see disableGpsForSession). The
    // movement STICK is not a takeover: it walks you off the GPS while the
    // GPS keeps tracking you (see _steerManual / _manualOffsetM). That latch
    // must never be reachable outside DEBUG builds — bound unconditionally, a
    // stray keydown on a real GPS-tracked session (an attached keyboard, a
    // Chromebook) would silently strand the player off their real position
    // with no way back but a reload, which reads as "the character sometimes
    // auto-walks somewhere other than the GPS target."
    if (DEBUG) {
      const k = this.keys;
      let wasd = false;
      if (k.A.isDown) { vx -= 1; wasd = true; }
      if (k.D.isDown) { vx += 1; wasd = true; }
      if (k.W.isDown) { vy -= 1; wasd = true; }
      if (k.S.isDown) { vy += 1; wasd = true; }
      // WASD and arrow keys move at the same speed: DEBUG_SPEED_MUL × walk
      // speed for fast debug travel. Kept in sync so the two keyboard
      // schemes feel identical.
      if (wasd) speedMul = DEBUG_SPEED_MUL;
      if (k.LEFT.isDown)  { vx -= 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.RIGHT.isDown) { vx += 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.UP.isDown)    { vy -= 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.DOWN.isDown)  { vy += 1; speedMul = DEBUG_SPEED_MUL; }
      if (vx || vy) this.disableGpsForSession();
    }
    if (this._fastWalk) speedMul = 25;
    this._stepDebugGps(dt);
    // The movement stick — always on screen, always live.
    const stick = (this._movePadHeld && this.joystickVec) ? this.joystickVec : null;
    // ONE movement model, at every depth and under every buff (see
    // _steerTarget / _followStep): inputs and GPS fixes move a free-flying
    // TARGET, and the opaque body — still this.playerM, so the camera and the
    // reach/tap origin stay on it — walks toward it. Underground it mines
    // through any wall in the way; on the surface nothing blocks, so it's a
    // plain walk toward the target.
    // TRAP PIN: the jaw clamps your leg - the body holds while the world
    // waits. The whole movement block is gated, so the inputs die with the
    // body: no steering, no drift home, no follow step, and no walking
    // energy drain while clamped. The pin is a status row (Conditions
    // `pinned`); its expiry story lives in _tickConditions.
    // The gate is _bodyHold: the pin above, and SLOW (tar / stakes) as its
    // second reason — a cap on the follow step rather than a hold.
    const bodyHold = this._bodyHold();
    if (bodyHold.pinned) {
      // Held still, but sharp ground continues hurting.
      const x = this.startWorldM.x + this.playerM.x, y = this.startWorldM.y + this.playerM.y;
      this._tickWalkHazards(dt, x, y, x, y);
    } else if (Conditions.active(this.save, 'confused')) {
      const x = this.startWorldM.x + this.playerM.x, y = this.startWorldM.y + this.playerM.y;
      this._confusedStep(dt, bodyHold.capMS);
      this._tickWalkHazards(dt, x, y, this.startWorldM.x + this.playerM.x, this.startWorldM.y + this.playerM.y);
    } else {
      if (this._confusedLoop) { this._confusedLoop = null; this._confusedRecover = true; }
      if ((stick && (stick.x || stick.y)) || vx || vy) this._confusedRecover = false;
      // Stick → walk yourself off the GPS (costs stamina, boots-scaled).
      if (stick && (stick.x || stick.y)) this._steerManual(stick.x, stick.y, dt);
      // Stick idle for a few seconds → walk back to where you really are.
      else this._driftHome(dt);
      // Keyboard → steer the target directly, free, no offset.
      this._steerTarget(vx, vy, speedMul, dt);
      const walkX = this.playerM.x, walkY = this.playerM.y;
      const walkSeconds = this._followStep(dt, bodyHold.capMS);
      this._tickWalkHazards(walkSeconds ?? dt, this.startWorldM.x + walkX, this.startWorldM.y + walkY,
        this.startWorldM.x + this.playerM.x, this.startWorldM.y + this.playerM.y);
      if (walkSeconds < dt) {
        const x = this.startWorldM.x + this.playerM.x, y = this.startWorldM.y + this.playerM.y;
        this._tickWalkHazards(dt - walkSeconds, x, y, x, y);
      }
    }
    // One throttled flash for the stick-walking drain banked in _steerManual,
    // same shape as the slime-leech / monster-hit roll-ups below (1200ms, one
    // pop for the whole window rather than one per energy pip). Lives here
    // rather than inside _steerManual because that method only runs on a
    // frame the stick is actually held — this runs every frame, so a drag
    // that lets go mid-window still gets its pop instead of losing the
    // remainder silently.
    if (this._steerDrainAccum > 0 && performance.now() - (this._lastSteerFlashT || 0) > 1200) {
      this._lastSteerFlashT = performance.now();
      const drained = this._steerDrainAccum;
      this._steerDrainAccum = 0;
      this._popEnergy(-drained);
      if (typeof persistSave === 'function') persistSave(this.save);
    }

    // Exhaustion underground: hit 0 energy below the surface and you black out
    // and wake up top-side. Guarded so the modal fires once, and skipped in
    // tests (which drive energy directly and don't want a DOM modal).
    //
    // `_passingOut` alone is not enough: it resets when the modal is dismissed
    // but passing out restores no energy, so the gate would refire next frame
    // (an underground blackout lands you at 0 on the surface, and on hard the
    // zero-energy lockout (_zeroEnergyLocked) refuses food/campfire/offline
    // rest, so only Home lifts energy off 0) halving the purse every frame.
    // `save.exhausted` is a second latch that outlives the modal: once tripped
    // it blocks BOTH gates until energy recovers above 0 (Home, a Crow Feather),
    // so a single dry spell costs the purse exactly once.
    //   THE LATCH LIVES IN THE SAVE (`save.exhausted`), not on the scene: a
    // refresh on an empty bar would otherwise charge the half-purse again. The
    // pass-out persists it alongside the money it took.
    if (this.save.exhausted && (this.save.energy ?? 0) > 0) {
      this.save.exhausted = false;
      persistSave(this.save);
    }
    if (this.depth > 0 && (this.save.energy ?? 0) <= 0
        && !this._passingOut && !this.save.exhausted && !window.__TEST_MODE) {
      this.save.exhausted = true;
      this._passOutToSurface();
    }
    // Hard mode only: the surface is not risk-free either. Running the tank
    // dry up top costs the same half-purse penalty as the underground
    // blackout (_passOutOnSurface) — easy mode's surface stays exactly as it
    // was, a hard stop with no cost (see the "too tired" flashes elsewhere).
    if (this.depth === 0 && Difficulty.isHard() && (this.save.energy ?? 0) <= 0
        && !this._passingOut && !this.save.exhausted && !window.__TEST_MODE) {
      this.save.exhausted = true;
      this._passOutOnSurface();
    }

    // (Underground rock-wall collision is handled per-frame inside
    // _followStep, which steps the body toward the target and mines any wall
    // in the way — see the target-follow branch above.)

    // GPS ghost: where you REALLY are, whenever the character isn't standing
    // there. One cell of slack keeps it off screen for ordinary GPS jitter (a
    // fix wanders a few metres while you stand still) so it appears only when
    // the stick has genuinely walked you off your position. At EVERY depth:
    // a descent GPS-mirrors the world coordinates (changeDepth), so underground
    // the fix is still the point over your head that the dig has wandered off
    // from, and it is the one ground marker the map keeps — the walk target
    // itself (this._targetM) draws nothing, see the gpsGhost block in create().
    if (this.gpsM) {
      const rdx = this.gpsM.x - this.playerM.x;
      const rdy = this.gpsM.y - this.playerM.y;
      if ((rdx * rdx + rdy * rdy) > this.cellM ** 2) {
        const g = worldMetersToScreen(this,
          this.startWorldM.x + this.gpsM.x,
          this.startWorldM.y + this.gpsM.y);
        this.gpsGhost.setPosition(Math.round(g.x), Math.round(g.y)).setVisible(true);
      } else {
        this.gpsGhost.setVisible(false);
      }
    } else if (this.gpsGhost.visible) {
      this.gpsGhost.setVisible(false);
    }
    this._drawWalkHomeHint(dt);
    this._updateWalkHomeCountdown();
    this._updatePlayerAura();

    // SaveSession samples the wall clock on its own cadence. Its lifecycle
    // flush forces an exact timestamp before the tab hides or closes.
    SaveSession.touch();
    this._tickShrineRegen(dt);
    this._tickFishRegen();

    // Resting AT HOME slowly fills the bar. Float accumulator avoids per-frame
    // integer churn — we only bump save.energy + refresh the DOM when a whole
    // pip has accrued. Test mode skips this so deterministic test runs don't
    // see energy creep.
    //
    // HOME ONLY: Home is a ring (HOME_R), the same shape as the campfire's below.
    if (!window.__TEST_MODE) {
      const pWX = this.startWorldM.x + this.playerM.x;
      const pWY = this.startWorldM.y + this.playerM.y;
      // Home rests you anywhere inside its ring, the way a campfire does —
      // no building-cell test, so the synthetic trailer (which paints no cell
      // at all) and an adopted house work by the one rule. See HOME_R.
      const atHome = this.isRestingAtHome(pWX, pWY);
      const maxE = this.getMaxEnergy();
      // WORKING IS NOT RESTING. A work wheel (till / chop / mine / cast / a
      // fight) suspends both rests below. The starter trailer is dropped under
      // the player at spawn and the starter plot is carved two cells from it,
      // inside reach from the trailer's own cell — so a new player's first
      // till ran with the Home rest ticking at 2⚡/s under a 2.25 s wheel
      // that had cost 2⚡, and the bar read the same number before and after
      // ("tilling takes no energy"). And the wheel alone was not enough: a
      // rest that resumed the moment it cleared had a bare-handed 9⚡ chop
      // back on the bar four and a half seconds later ("mining and chopping
      // took no energy"). So a wheel up on any frame, or a spend (spendEnergy), holds
      // the rests for REST_SETTLE_S past it — the player has to actually stop
      // before Home earns a job's price back. See REST_SETTLE_S.
      const restNow = performance.now();
      if (this._workProgress) this._holdRest(restNow);
      const working = !!this._workProgress || restNow < (this._restHoldUntil ?? 0);
      // Carried regeneration jewelry rides the passive-rest accumulator and
      // its working pause. The faster amulet wins; the two never stack.
      const jewelryRegenMs = jewelryRegenIntervalMs(this.save);
      if (!working && Number.isFinite(jewelryRegenMs) && (this.save.energy ?? 0) < maxE) {
        this._accrueRestEnergy('_jewelryAccrueE', dt * 1000 / jewelryRegenMs, maxE);
      } else {
        this._jewelryAccrueE = 0;
      }
      // WALKING THROUGH IS NOT A REST (owner, Sep 2026): the trailer sits
      // where the player passes a dozen times a session, and every pass
      // popped "+N⚡" over their head. The energy still banks from the first
      // frame (the bar shows it); the SPLASH waits until the feet have been
      // in the ring for REST_SETTLE_S — the same settling the wheel gets —
      // and a pass that never settles says nothing, on the way out either.
      if (atHome) { if (this._homeSinceT == null) this._homeSinceT = restNow; }
      else this._homeSinceT = null;
      const settledHome = atHome && restNow - this._homeSinceT >= REST_SETTLE_S * 1000;
      // Hard mode's zero-energy lockout (_zeroEnergyLocked): the trailer
      // doesn't trickle you back up from empty — arriving there puts you
      // straight at a quarter bar (Energy.REVIVE_FRAC; a Crow Feather eaten
      // in the field gives less, see REVIVE_ITEM_FRAC). A campfire is NOT the trailer, so its rest below stays
      // blocked until that floor is crossed.
      const locked = this._zeroEnergyLocked();
      if (atHome && locked) {
        const beforeE = this.save.energy ?? 0;
        Energy.set(this.save, Energy.reviveLevel(maxE));
        this._restAccrueE = 0;
        const gainedE = this.save.energy - beforeE;
        if (gainedE > 0) this._splashEnergyGain(gainedE);
        if (this.updateEnergyDOM) this.updateEnergyDOM();
        persistSave(this.save);
        // The first time Home stands a downed player back up, the villagers'
        // part in it is told (the REVIVAL STORYBOARD). Home only: a Crow
        // Feather or a revival potion is the player's own doing.
        if (gainedE > 0) this._reviveStoryboard();
      } else if (atHome && !working && (this.save.energy ?? 0) < maxE) {
        this._accrueRestEnergy('_restAccrueE', maxE * (dt / HOME_FULL_REST_S), maxE, !settledHome);
      } else {
        // Stopped resting — flush any unsplashed accumulation so the last few
        // points of a short rest still register. (A quiet pass through Home
        // banked none to flush — see _accrueRestEnergy's `quiet`.)
        if (this._restSplashAccum > 0) {
          this._splashEnergyGain(this._restSplashAccum);
          this._restSplashAccum = 0;
        }
        this._restAccrueE = 0;
      }
      // Campfire warmth: standing within FIRE_REST_R cells of a lit fire slowly
      // restores energy — the same accumulator trick as the home rest, but it
      // works out in the wild and is slower (FIRE_FULL_REST_S). Independent of
      // the home rest above; a fire can't sit on a building cell so the two
      // rarely overlap. ONE REST, TWO REASONS: `fireside` is a lit fire OR a
      // viewpoint's scope (src/scenic.js — a place to sit, on the fire's own
      // ring and rate; it wards nothing, so it is only a reason HERE).
      if ((this.save.energy ?? 0) < maxE) {
        const fireside = this._nearAny('fires', pWX, pWY, FIRE_REST_R) || this._nearVista(pWX, pWY, FIRE_REST_R);
        if (!working && !locked && fireside) {
          this._accrueRestEnergy('_fireAccrueE', maxE * (dt / FIRE_FULL_REST_S), maxE);
        } else {
          this._fireAccrueE = 0;
        }
      }
      // Streets come back by SIGHT, not by footfall: a stretch of road or
      // footpath that has been inside the player's lit reach for
      // PATH_STONE_DWELL_MS is rebuilt. The scan half memoises on the reach
      // cell, so a frame spent standing still costs one string compare plus a
      // walk of the small in-sight map.
      this._sweepStreets();
      // …and the LIVING LAMPS the feet just came by: a visit flares a lit
      // lamp and pays the ladder for how dim it had got (_visitStreetLamps).
      this._visitStreetLamps(Date.now());
      // …and a house the feet walk through mutters (_houseMutter).
      this._houseMutter();
    }

    // Facing-direction indicator: yellow triangle arrow at the player's head,
    // pointing in the compass heading (or last movement, as fallback). It
    // rides the player's head at every depth.
    this.facingGfx.clear();
    const fmag = Math.hypot(this.facing.x, this.facing.y);
    if (fmag > 0.001) {
      const fx = this.facing.x / fmag, fy = this.facing.y / fmag;
      // perpendicular for the base of the triangle
      const px = -fy, py = fx;
      // Arrow geometry, all measured from the anchor point so the whole shape
      // scales about it. SCALE 0.85 = 15% smaller than the sizes it was drawn
      // at before (tip 22 / base 14 / halfW 6).
      const SCALE = 0.85;
      const tip = 22 * SCALE; // distance from anchor to arrow tip
      const base = 14 * SCALE; // distance from anchor to arrow base midpoint
      const halfW = 6 * SCALE; // half-width of the base
      // Head offset: how far ABOVE the sprite's centre the arrow is anchored.
      // 0 sits it on the centre, negative nudges it below — it rode 2px high
      // once, and now sits 1px under centre, where it lines up with the art.
      const HEAD_DY = -1;
      // The sprite's centre is its ground point plus bodyDy (the feet are on
      // the point and the body rises above it — until it collapses onto it).
      const cx = pScreen.x, cy = pScreen.y + bodyDy - HEAD_DY;
      const tx = cx + fx * tip, ty = cy + fy * tip;
      const blx = cx + fx * base + px * halfW, bly = cy + fy * base + py * halfW;
      const brx = cx + fx * base - px * halfW, bry = cy + fy * base - py * halfW;
      this._drawArrowTriangle(this.facingGfx, tx, ty, blx, bly, brx, bry, 0.85, 0xffd24a);
    }

    // Footprint trail. Each ~2m the player moves, fade existing dots by 10%
    // and drop a fresh one AT THE PLAYER'S CURRENT FEET. Starting alpha is 0.45
    // so the freshest dot reads as a soft press rather than ink.
    {
      const bodyM = this.playerM;
      const lp = this._lastFootprintM;
      const dx = bodyM.x - lp.x, dy = bodyM.y - lp.y;
      // First GPS fix can jump hundreds of meters from playerM=(0,0); skip the
      // single huge step so the inaugural footprint isn't dropped at world
      // origin. 200m = ~13 cells, well outside any normal walking gait.
      const tooFar = dx * dx + dy * dy > 200 * 200;
      if (tooFar) {
        this._lastFootprintM = { x: bodyM.x, y: bodyM.y };
      } else if (dx * dx + dy * dy >= 2 * 2) {
        for (const fp of this.footprints) fp.alpha *= 0.8;
        // Freeze the STEP onto the print: which way it went (unit vector —
        // world axes are the screen's, so this is also its screen direction)
        // and which foot made it, alternating. Both are recorded at drop time
        // rather than read from the player each frame, because a print is a
        // mark left in the ground: turning around must not swivel the ones
        // already behind you.
        const n = Math.hypot(dx, dy) || 1;
        this._footSide = -(this._footSide || 1);
        this.footprints.push({
          x: bodyM.x, y: bodyM.y, alpha: 0.45,
          ux: dx / n, uy: dy / n, side: this._footSide,
        });
        // Cap at 5 so the trail stays short — the 20%/step fade alone would
        // keep ~11 dots alive before they drop below visibility.
        if (this.footprints.length > 5) this.footprints.splice(0, this.footprints.length - 5);
        this._lastFootprintM = { x: bodyM.x, y: bodyM.y };
      }
      // Dots pressed into the GROUND, so they project like any other world
      // point (worldMetersToScreen → the camera anchor) and slide with a peek.
      // The body's world point IS its feet (feet-on-the-fix), so each dot
      // goes on the projected point with no anchor offset — the same point
      // the contact shadow sits on. Redrawn only when a dot's drawn position
      // or ink moves (a step, a fade, a peek): standing still, the same five
      // 14-gons were rebuilt every step.
      const prints = [];
      let printKey = '';
      for (const fp of this.footprints) {
        const s2 = this.worldMetersToScreen(fp.x + this.startWorldM.x,
                                            fp.y + this.startWorldM.y);
        const sx2 = Math.round(s2.x), sy2 = Math.round(s2.y);
        prints.push(sx2, sy2);
        printKey += `${sx2},${sy2},${fp.alpha},${fp.ux},${fp.uy},${fp.side};`;
      }
      if (printKey !== this._footprintKey) {
        this._footprintKey = printKey;
        this.footprintGfx.clear();
        this.footprints.forEach((fp, i) => {
          this.footprintGfx.fillStyle(0x000000, fp.alpha);
          this._fillFootprint(this.footprintGfx, prints[2 * i], prints[2 * i + 1], fp);
        });
      }
    }

    // Pairy marks its chest in cyan until opened or its food effect expires.
    if (this.pairyCompass) {
      const opened = setOf(this.save.opened);
      const expired = Date.now() >= this.pairyCompass.until;
      const claimed = opened.has(this.pairyCompass.targetId)
        || dayLedgerAges(this.save).get(this.pairyCompass.targetId) === 0;
      if (expired || claimed) {
        this.pairyCompass = null;
      } else {
        this._drawEdgeDot(this.pairyCompass.x, this.pairyCompass.y, 0x45e5ff);
      }
    }

    this._drawTrackedEdgeDot('telescopeCompass', 0xffd24a);
    this._drawTrackedEdgeDot('wayfarerCompass', 0x4488ff);

    // A map keeps its original level and expires by wall clock, including reloads.
    const treasure = this.save.treasureCompass;
    if (treasure && Date.now() < treasure.until && treasure.depth === (this.depth || 0)
        && !setOf(this.save.opened).has(treasure.targetId)
        && dayLedgerAges(this.save).get(treasure.targetId) !== 0) {
      this._drawEdgeDot(treasure.x, treasure.y, 0xff5555);
    }

    // Delivery waypoint — a solid WHITE arrow at the viewport edge pointing at
    // the house the player picked from the delivery menu (openDeliveryMenu).
    // Cleared once the player arrives or the house has been fed.
    if (this.deliveryCompass) {
      const satisfied = Delivery.isSatisfied(this.save, { id: this.deliveryCompass.id });
      const pWX = this.startWorldM.x + this.playerM.x;
      const pWY = this.startWorldM.y + this.playerM.y;
      const mag = Math.hypot(this.deliveryCompass.x - pWX, this.deliveryCompass.y - pWY);
      if (satisfied || mag < this.cellM * 1.2) {
        this.deliveryCompass = null;
      } else {
        this._drawEdgeCompass(this.deliveryCompass.x, this.deliveryCompass.y, 0xffffff, 0.9);
      }
    }

    // Starter guidance — a LIGHT-GREEN arrow toward whatever the ACTIVE ladder
    // step actually wants, shown only while the first-session ladder is
    // running. Green is the tutorial's colour: the chip's step tag, the
    // step-complete toast and this arrow all wear --green (#a7ffb0), so
    // everything the ladder owns reads as one system — and the arrow can't be
    // confused with the gold facing triangle on the player.
    //
    // The target is PER-STEP (see _starterGuidanceGoal): the crates while the
    // chip says to open one, the carved plot for "Break ground", and the
    // tilled soil / the nearest wreck / the crop / Home for the steps that
    // happen at those places. (The crates pack into the first cells of the walk,
    // TRAIL_SPAN, so a crate fallback pointed away from the tap the chip asked for.)
    //
    // Retires itself the moment the ladder finishes or is dismissed, and stops
    // pointing once the player is on top of the target (it is in reach by
    // then, and the arrow would only cover the sprite).
    if (this.depth === 0 && typeof Quests !== 'undefined' && !Quests.starterHidden(this.save)) {
      const step = Quests.starterCurrent(this.save);
      // Memoise the goal on a 500 ms clock. _starterGuidanceGoal walks every
      // object in every cached tile (crates, wrecks) — fine as a tap-time
      // query, far too heavy per frame, and it ran per frame for the entire
      // tutorial. The goal only moves when the player acts or walks; half a
      // second of arrow staleness is imperceptible.
      const gNow = performance.now();
      if (!this._starterGoalMemo || gNow - this._starterGoalMemo.t > 500 ||
          this._starterGoalMemo.event !== (step && step.event)) {
        this._starterGoalMemo = {
          t: gNow,
          event: step && step.event,
          goal: step ? this._starterGuidanceGoal(step) : null,
        };
      }
      const goal = this._starterGoalMemo.goal;
      if (goal) {
        const pWX = this.startWorldM.x + this.playerM.x;
        const pWY = this.startWorldM.y + this.playerM.y;
        if (Math.hypot(goal.x - pWX, goal.y - pWY) > this.cellM * 1.5) {
          this._drawEdgeCompass(goal.x, goal.y, 0xa7ffb0, 0.9);
        }
      }
    }

    if (!this._lastCheckM ||
        Math.hypot(this.playerM.x - this._lastCheckM.x, this.playerM.y - this._lastCheckM.y) > 20) {
      this._lastCheckM = { ...this.playerM };
      window.__boot?.mark('walked 20m — checking tiles');
      this.ensureTilesAround().catch(() => {});
    }

    // Watering + harvesting are still tap-driven. STAGE ADVANCEMENT, however,
    // auto-fires once the per-stage hold has elapsed since the last watering —
    // including for plants that grew while the player was away (offscreen,
    // app closed, tab backgrounded). Cheap: O(plants), tick once a second.
    this._lastGrowthTick = this._lastGrowthTick || 0;
    if (performance.now() - this._lastGrowthTick > 1000) {
      this._lastGrowthTick = performance.now();
      this.advanceGrowth();
    }

    // DERELICT LAIRS — the ruins are hard mode's; the STREET structures (a
    // a barricade, a café's hoard — lairs.js ALWAYS_AWAKE_TIERS)
    // are held in every mode, so the pass runs in both and `buildings` says
    // which ruins it may wake. Wake the garrisons of ruins the player
    // has come near and sleep the ones they have left behind (src/lairs.js owns
    // every number). Throttled: the wake ring stands 4 cells outside the sleep
    // ring, which is ~20 seconds of walking, so half a second between passes
    // has margin to spare and this never runs on the ~30 frames between.
    //   Measured from the FEET, never the camera anchor — a peek drag must not
    // wake a ruin the player has not walked to (CLAUDE.md's camera rule).
    //   Surface only: buildingShapes is a surface tile's data, and the world is
    // GPS-mirrored, so a cave level must not wake the ruins above it.
    if (typeof Lairs !== 'undefined' &&
        (this.depth || 0) === 0 && !window.__TEST_MODE &&
        performance.now() - (this._lastLairT || 0) > 500) {
      this._lastLairT = performance.now();
      const lairHome = this._starterTrailAnchor();
      if (lairHome) {
        const pc = this.playerToWorldCell();
        const ring = [];
        eachTile3x3(pc.tx, pc.ty, (tx, ty) => {
          const e = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
          if (e) ring.push({ entry: e, tx, ty });
        });
        // Wounds survive a sleep/wake cycle. In memory only, like every other
        // creature's _hp (combat.js) — this covers walking out of the wake ring
        // and back, not a reload, so a guard you softened up is still softened
        // up when you come round the corner again.
        this._lairHp = this._lairHp || new Map();
        Lairs.stepResidency(ring, {
          cellM: this.cellM,
          tileEdgeM: this.tileEdgeM,
          playerM: { x: this.startWorldM.x + this.playerM.x,
                     y: this.startWorldM.y + this.playerM.y },
          homeM: lairHome,
          isClaimed: (key) => this.isClaimedKey(key),
          caughtSet: setOf(this.save.caught),
          hpMemo: this._lairHp,
          // A gate's guard re-rises each UTC day (lairs.js DAILY_TIERS).
          dayKey: utcDayKey(),
          buildings: !!Difficulty.get().derelictLairs,
        });
      }
    }

    this.wanderCreatures();
    // Fight tick — bow/staff auto-fire, shots in flight, sword auto-engage.
    // Runs AFTER the creatures have moved (so shots resolve against where the
    // foes actually are this frame) and BEFORE the wheel, which is where melee
    // damage lands.
    this._combatTick(dt);
    this._tickBlightAura();
    Companions.tickAll(this);
    // Did we just walk onto a trap, or are we still standing on one? Runs
    // beside the fog reveal because it asks the same question — which cell are
    // the player's FEET in — and answers it the same way (playerToWorldCell,
    // never the camera anchor: a peek drag must not spring a trap two cells
    // away, nor stop one under you from biting).
    this._tickTraps(dt);
    // …and is a guildhall bounty's pack still about (its leash)?
    this._tickGuildBounty();
    this._tickSafetyReminders();
    // …and which STREET are the feet on — a variant's first-entry story, and
    // whether tar or stakes are slowing the body (the same feet cell).
    this._tickStreetFeet();
    // …and is the player standing in lava (the lava level only)?
    this._tickLava(dt);
    // …or in a campfire?
    this._tickFireTouch();
    this._tickGroundFire();
    // …and did an enemy just walk onto one of the player's Magic Traps?
    this._tickMagicTraps();
    this._revealFog();
    this.drawCells();
    this.drawRoadGeometry();
    this.drawBuildingGeometry();
    if (typeof Multiplayer !== 'undefined') Multiplayer.tick(this);
    this.drawObjects();
    this._drawWorkProgress();
    this.updateHUD();
    } catch (e) {
      this._reportLoopError(e);
    }
  }

  // Funnel for exceptions thrown inside update(). Keeps the Phaser loop alive
  // (an escaped throw would stop the RAF reschedule and freeze the game + kill
  // input) while still surfacing the error: throttled console.error plus a
  // brief on-screen banner, since DevTools isn't reachable on a phone.
  _reportLoopError(e) {
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (this._lastLoopErrAt && now - this._lastLoopErrAt < 3000) return;   // throttle a per-frame storm
    this._lastLoopErrAt = now;
    try { console.error('update() frame error (loop kept alive):', e); } catch (_) {}
    try {
      const msg = (e && (e.message || e.toString())) || 'frame error';
      const stack = (e && e.stack) || '';
      // Prefer the copyable error overlay (index.html) so the full message +
      // stack can be read/copied on a phone. Fall back to the transient
      // #banner flash only if the overlay isn't wired up.
      if (typeof window !== 'undefined' && typeof window.showError === 'function') {
        window.showError(`⚠ ${msg}`, stack);
      } else {
        const b = document.getElementById('banner');
        if (b) {
          b.textContent = `⚠ ${msg}`.slice(0, 80);
          b.style.display = 'block';
          clearTimeout(this._loopErrBannerT);
          this._loopErrBannerT = setTimeout(() => { b.style.display = 'none'; }, 4000);
        }
      }
    } catch (_) { /* never let error reporting itself throw */ }
  }

  // Scan save.planted and bump stage on any watered crop whose stage hold
  // (Crops.stageHoldMs — depends on crop) has elapsed. After each advance the crop needs re-watering, so
  // a single tick advances each plant by at most one stage; a long-idle
  // plant catches up over subsequent waterings, not all at once.
  advanceGrowth() {
    const advanced = [];
    if (!Crops.advanceGrowth(this.save, Date.now(), advanced)) return;
    persistSave(this.save);
    // Leaf flecks off each plant that grew — _burstAtWorld drops the ones
    // outside the viewport, which on a 15-minute hold is most of them.
    for (const p of advanced) this._burstAtWorld('sprout', p.x, p.y);
  }

  // ── COMBAT ───────────────────────────────────────────────────────────────
  // Per-frame fight tick: pick up the enemies on screen, let the ACTIVE bow or
  // staff loose its shots (the bow along the compass, the staff at the nearest
  // foe — Combat.shotHeading), fly the shots already out, and —
  // unless a bow or staff is in hand — engage the nearest foe without being
  // asked, sword or bare hands alike. Only one of sword/bow/staff
  // (save.activeWeapon) acts on its own here at a time; the rest sit inert
  // until switched to. The maths (what
  // counts as an enemy, damage per shot, shot flight) all lives in combat.js;
  // this method is the scene glue.
  _combatTick(dt) {
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    const now = performance.now();
    // "On screen" = inside the drawn viewport, measured as a box rather than a
    // radius because the viewport IS a box: a foe in the corner is visible and
    // must count. Half a cell of margin so one stepping in at the edge starts
    // drawing fire the moment it appears rather than a cell later.
    const halfSpanM = (VIEW_CELLS / 2 + 0.5) * this.cellM;
    const enemies = [], charmedAllies = [];
    const potionTargets = this._shots.some(shot => shot.potionId) ? [] : null;
    const explosiveTargets = this._shots.some(shot => !shot.hostile && shot.blastRadiusM > 0) ? [] : null;
    // 3×3 neighbourhood + memoised caught-Set: this runs every frame, and the
    // all-tiles forEachItem with a per-creature Array.includes was an
    // O(cached-creatures × caught) scan that grew with every tile walked.
    // Cheap box cull first, membership test last.
    const caughtSet = setOf(this.save.caught);
    const pcTick = this.playerToWorldCell();
    WorldGen.forEachItemNear('creatures', pcTick.tx, pcTick.ty, (c) => {
      // A blast can catch foes just beyond the viewport; auto-fire still
      // uses only the visible list below.
      if (explosiveTargets && !caughtSet.has(c.id) && Combat.isEnemy(c)) explosiveTargets.push(c);
      if (Math.abs(c.x - px) > halfSpanM || Math.abs(c.y - py) > halfSpanM) return;
      if (caughtSet.has(c.id) || c._surfaceInactive) return;
      if (potionTargets) potionTargets.push(c);
      if (Combat.isCharmed(c)) { charmedAllies.push(c); return; }
      if (!Combat.isEnemy(c)) return;
      enemies.push(c);
    });

    DragonStory.tick(this, now, px, py, enemies);
    const relics = Gear.effectiveRelics(this.save);
    const activeWeapon = Gear.activeWeapon(this.save);
    // The player's attack multiplier (_attackMul — Dragon Powder's ×2, the
    // off-GPS third), the same one the melee wheel reads.
    const dmgMul = this._attackMul();

    // ── Bow / staff: one shot a second ──────────────────────────────────────
    // The BOW does not home and does not pick a target: the arrow goes where
    // you are facing, so aiming is turning. The STAFF picks: its bolt is
    // loosed straight at the nearest enemy inside its range, whatever way the
    // body faces, and holds fire (spending no energy) while the nearest is
    // still out of reach. Which is which lives in Combat.SHOT[slot].aim and
    // is resolved by Combat.shotHeading, so this loop never has to know.
    // Firing is gated on an enemy being on screen — otherwise every walk
    // across town would be trailing arrows.
    // Only the ACTIVE weapon fires (save.activeWeapon) — an owned-but-inactive
    // bow or staff sits quiet, exactly like an owned-but-inactive sword doesn't
    // auto-engage below.
    // The staff's next bolt CHARGES by the hand between shots (_drawShots):
    // 0 → 1 over its beat, read off the same clock that fires it. Null (no
    // orb) while nothing is on screen to shoot at or the staff isn't in hand.
    this._staffCharge = null;
    // …and only while one stands within the reach plus a cell
    // (Combat.rangedTriggerM): a foe further off on screen draws no fire.
    // The Shadow Powder is a truce, not a flank: while it hides the player,
    // the cadence holds its fire too. The else-branch re-arms, so the first
    // arrow flies the instant the shadow lifts.
    const rangedArmed = !this.isShadowActive()
      && Combat.anyEnemyWithin(px, py, enemies, Combat.rangedTriggerM(reachCells(this), this.cellM));
    if (rangedArmed) {
      for (const slot of Combat.RANGED_SLOTS) {
        if (!relics[slot] || activeWeapon !== slot) continue;
        const due = this._nextShotT[slot];
        if (due == null) {
          // First sighting this weapon has been active for: arm the cadence
          // (the next pass fires it — only one ranged slot is ever active, so
          // there is no stagger between them).
          this._nextShotT[slot] = now;
          continue;
        }
        if (slot === 'staff') {
          this._staffCharge = Math.max(0, Math.min(1,
            1 - (due - now) / (Combat.fireIntervalMs(slot) * Combat.playerAttackIntervalMul(this.save))));
        }
        if (now < due) continue;
        // Where this shot goes — the compass for the bow, the line to the
        // nearest foe in range for the staff. Resolved BEFORE the energy is
        // spent: a staff whose nearest foe is still beyond its range keeps
        // both its energy and its cadence (left due, so it fires the instant
        // one steps in).
        // The staff's range is the player's own reach plus a cell (Combat's
        // rangeCellsFor) — the live one, so it tightens underground with the
        // ring it is derived from. Handed to the spawn below as well, so the
        // bolt flies exactly as far as the check that loosed it.
        const reach = reachCells(this);
        const heading = Combat.shotHeading(slot, px, py, this.facing, enemies, this.cellM, reach);
        if (!heading) continue;
        // The staff draws energy per bolt (Combat.SHOT.staff.energyCost — the
        // price of its pierce + double punch). No energy → no bolt, SILENTLY:
        // an auto-firing weapon must not spam "too tired" (spendEnergy only
        // flashes when handed coordinates). The cadence is left due, so the
        // first bolt after a meal fires immediately.
        const eCost = Combat.SHOT[slot].energyCost || 0;
        // The bow's AMMO (Combat.SHOT.bow.ammo): no wood in the bag, no arrow.
        // Said ONCE per dry spell, at the player, then silent until wood is
        // back — an auto-firing weapon must not flash every beat.
        const ammo = Combat.SHOT[slot].ammo;
        if (ammo && (ammo.currency ? (this.save.money || 0) : Inventory.count(this.save, ammo.id)) < 1) {
          if (!this._ammoDryWarned) {
            this._ammoDryWarned = true;
            const ps = this.playerScreen();
            this.flash(`Out of ${ammo.currency ? 'coins' : itemName(ammo.id)} — ${slot} idle`, ps.x, ps.y + this.playerBodyDy());
          }
          continue;
        }
        if (eCost && !this.spendEnergy(eCost)) continue;
        // A Speed hall shortens the beat (Combat.trainingIntervalMul); the
        // shot keeps its damage, so speed is more shots, not bigger ones.
        this._nextShotT[slot] = now + Combat.fireIntervalMs(slot) * Combat.playerAttackIntervalMul(this.save);
        if (slot === 'staff') this._staffCharge = 0;
        // The tier sizes the shot too (a staff bolt grows with it — both its
        // sweep and its drawn dot, stamped on the shot by spawnShot).
        const shot = Combat.spawnShot(slot, px, py, heading, this.cellM,
                                      Combat.shotDamage(relics, slot, this.save.playerClass) * dmgMul
                                        + this._attackFlat(Combat.TRAINING_SLOT_KIND[slot]),
                                      relics[slot].tier, reach);
        // A bow's arrow and a staff's bolt wear the relic's MATERIAL colour
        // (MATERIAL_TIERS .color) — a Frost bow looses ice-blue arrows, a
        // Crimson staff red bolts. _drawShots reads a shot's own `color`
        // ahead of the slot's.
        if (shot && (slot === 'bow' || slot === 'staff')) {
          shot.color = shotTierColour(slot, relics[slot].tier);
        }
        if (shot && ammo?.currency) {
          this._ammoDryWarned = false;
          addMoney(this.save, -1);
          persistSave(this.save);
        } else if (shot && ammo) {
          // Every `ammo.shots`-th arrow burns one wood (save.ammoShots counts
          // toward it, so the tally survives a reload).
          this._ammoDryWarned = false;
          this.save.ammoShots = (this.save.ammoShots || 0) + 1;
          if (this.save.ammoShots >= ammo.shots) {
            this.save.ammoShots = 0;
            Inventory.remove(this.save, ammo.id, 1);
            this._clampSelSlot();
            if (this.buildInventoryDOM) this.buildInventoryDOM();
            persistSave(this.save);
          }
        }
        if (shot) {
          this._shots.push(shot);
          // Keep the bow's existing ledger key; the staff gets its own first shot.
          // Only a fired projectile tells the story, never equip or a dry cadence.
          if (slot !== 'musket') this._toolActionStory(slot === 'bow' ? 'shoot' : 'staff');
        }
      }
    } else {
      // Nothing to shoot at — re-arm, so the next foe to walk on screen is shot
      // at almost immediately instead of waiting out a cadence that has been
      // ticking away in an empty street.
      this._nextShotT = {};
    }

    // ── Castle turrets: Wood bow arrows at 1/5 the player's cadence ─────────
    // Every turret on screen with the player shoots at the nearest enemy on
    // screen (Combat.turretTick — the maths, the damage and the rate all live
    // in combat.js). Surface only: caves have no castles, and a foe down
    // there must not draw fire from a rim two hundred metres overhead.
    if (enemies.length && this.depth === 0) {
      this._turretFire(now, px, py, halfSpanM, enemies, pcTick);
    } else {
      this._turretNextT = {};          // re-arm at the phase on the next sighting
    }

    if (this._shots.length) {
      // What stops an ARROW (staff bolts pierce and never consult this):
      // underground, cave rock — _cellBlocked is the SAME test the body walks
      // against, so what blocks you blocks your arrows; on the surface, a
      // trunk with real girth — an unchopped tree or fruit tree, MEDIUM size
      // class or bigger (treeSizeClass — the same ladder the axe-tier gate
      // reads). A rock never blocks, and a 'small'/'bush' tree is too slight a trunk —
      // only a medium/full canopy has the girth to stop a shot. The surface set is built lazily
      // when a shot is actually in flight: stepShots samples the test every
      // half-cell of every shot, far too often for a per-sample object scan.
      let solidCells = null;
      const shotBlocked = (x, y, shot) => {
        if (shot?.hostile && enemySightBlocked(this, shot._sourceGuard || {}, x, y)) return true;
        if (this._cellBlocked(x, y)) return true;
        if (this.depth !== 0) return false;
        if (!solidCells) {
          solidCells = new Set();
          const choppedSet = setOf(this.save.chopped);
          WorldGen.forEachItemNear('objects', pcTick.tx, pcTick.ty, (o) => {
            if (o.kind !== 'tree' && o.kind !== 'fruittree') return;
            if (o.chopped || choppedSet.has(o.id)) return;
            const cls = treeSizeClass(o);
            if (cls === 'small' || cls === 'bush') return;   // too slight to stop a shot
            if (Math.abs(o.x - px) > halfSpanM * 2 || Math.abs(o.y - py) > halfSpanM * 2) return;
            const c = worldMetersToAbsCell(this, o.x, o.y);
            solidCells.add(c.cellIX + '_' + c.cellIY);
          });
        }
        const cc = worldMetersToAbsCell(this, x, y);
        return solidCells.has(cc.cellIX + '_' + cc.cellIY);
      };
      // Hostile arrows can hit the player or an awake, unwarded neighbour. A
      // friendly shot never sweeps it, a hostile one never sweeps `enemies`
      // — stepShots keeps the two lanes apart.
      const playerTarget = { id: 'player', x: px, y: py };
      for (const shot of this._shots) {
        if (!shot._sourceGuard) continue;
        shot.hostile = !Combat.isCharmed(shot._sourceGuard);
        shot.source = shot.hostile ? 'enemy' : 'ally';
      }
      this._shots = Combat.stepShots(this._shots, dt, enemies,
        Combat.HIT_RADIUS_CELLS * this.cellM,
        (target, shot) => this._shotHitsTarget(target, shot),
        { blocked: shotBlocked, cellM: this.cellM,
          hostileTargets: [playerTarget, ...(this._npcCombatTargets || []), ...charmedAllies],
          explosiveTargets, potionTargets,
          canHit: (target, shot) => this._shotCanHit(target, shot),
          onFireCell: (x, y, shot) => this._igniteFireballTrail(shot, x, y),
          onFireSegment: (x0, y0, x1, y1, shot) => this._igniteFireballTrail(shot, x0, y0, x1, y1),
          onExplode: shot => {
            if (shot.projectile === 'explosive_flask') this._explodeFlask(shot);
            this._burstAtWorld('trailspark', shot.x, shot.y,
              { colour: '#ff742d', ringPx: shot.blastRadiusM / this.cellM * CELL_PX });
          } });
    }
    this._drawShots();

    // ── Melee: auto-engage ─────────────────────────────────────────────────
    // With no ranged weapon in hand you never have to tap the slime that is
    // already chewing on you: the nearest enemy IN REACH is picked up on its
    // own. That is the sword's lane AND bare hands'. An equipped bow or staff
    // turns it off — Gear.meleeActive — see the WEAPON_SLOTS note above.
    // The wheel is flagged `auto`, which is what keeps it from behaving
    // like a tapped action — it doesn't swallow taps, hold the body still, or
    // block the walk home (see _busyWheel).
    if (Gear.meleeActive(this.save) && (!this._workProgress || this._workProgress.combat)) {
      let best = null, bestD2 = Infinity;
      for (const c of enemies) {
        // ARM'S LENGTH, not the lit reach (Combat.MELEE_REACH_CELLS): a sword
        // swings as far as a monster bites and no further.
        if (!Combat.inMeleeReach(c.x, c.y, px, py, this.cellM, Gear.activeWeapon(this.save))) continue;
        const d2 = (c.x - px) * (c.x - px) + (c.y - py) * (c.y - py);
        if (d2 < bestD2) { bestD2 = d2; best = c; }
      }
      // Recheck distance while fighting too. Retargeting keeps the scene's
      // swing deadline, so crossing targets cannot grant an extra blow.
      if (best && this._workProgress?.combat !== best) this.startCombat(best, { auto: true });
      else if (!best && this._workProgress?.combat) this.cancelWorkProgress();
    }

    this._drawEnemyHealth(enemies);
  }

  _applyCondition(id) {
    // A fresh row pops its word and flicks the body from _announceStatuses
    // (the next condition tick), as every status does; poison keeps its
    // one-time lesson.
    const fresh = Conditions.apply(this.save, id);
    this._syncAttackConditionSpeed();
    if (fresh && id === 'confused') this._confusedRecover = true;
    if (fresh && id === 'poison') {
      if (!this.save.poisonLearned) {
        this.save.poisonLearned = true;
        this.showMessageModal({ title: 'Poisoned', body:
          'A purple chill creeps from the bite. At the healthcare site, an antidote waits to draw it out.' });
      }
    }
    persistSave(this.save);
    this._syncStatusRow();
  }

  // Rescale an in-progress swing/shot when stun starts, expires or is cured.
  _syncAttackConditionSpeed() {
    const mul = Conditions.attackIntervalMul(this.save);
    const ratio = mul / (this._conditionAttackIntervalMul || 1);
    this._conditionAttackIntervalMul = mul;
    if (ratio === 1) return;
    const now = performance.now();
    if (this._nextBlowT > now) this._nextBlowT = now + (this._nextBlowT - now) * ratio;
    for (const slot of Object.keys(this._nextShotT || {})) {
      if (this._nextShotT[slot] > now) this._nextShotT[slot] = now + (this._nextShotT[slot] - now) * ratio;
    }
  }

  _tickConditions() {
    const giantExpired = Energy.expireGiant(this.save);
    const shrinkingExpired = Energy.expireShrinking(this.save);
    if (giantExpired || shrinkingExpired) {
      this._syncPlayerSkin();
      this.updateEnergyDOM();
      persistSave(this.save);
    }
    if (!this._conditionVisibilityHandler) {
      this._conditionVisibilityHandler = () => { this._conditionLastT = null; };
      document.addEventListener('visibilitychange', this._conditionVisibilityHandler);
      const resetClock = this._conditionVisibilityHandler;
      this.events?.on('pause', resetClock);
      this.events?.on('resume', resetClock);
      this.events?.once('shutdown', () => {
        document.removeEventListener('visibilitychange', resetClock);
        this.events?.off('pause', resetClock);
        this.events?.off('resume', resetClock);
        this._conditionVisibilityHandler = null;
        this._conditionLastT = null;
        document.getElementById('status-row')?.remove();
        this.statusRowEl = null;
      });
    }
    const now = performance.now();
    const elapsed = !document.hidden && this._conditionLastT != null ? now - this._conditionLastT : 0;
    this._conditionLastT = document.hidden ? null : now;
    const before = this.save.energy ?? 0;
    const burningExposure = this._playerFireExposure?.() || false;
    if (burningExposure) this._ignitePlayer();
    const wasPinned = Conditions.active(this.save, 'pinned');
    const result = Conditions.tick(this.save, elapsed, { burningExposure });
    this._syncAttackConditionSpeed();
    // A trap's pin that RUNS OUT (not one an Antidote pried open) tells the
    // "pried free" story once per save (a busy screen returns false
    // unmarked; the splash is lost that once, which is fine).
    if (wasPinned && !Conditions.active(this.save, 'pinned')) {
      this._storySplashOnce('trap_free', {
        art: 'trap_free',
        title: 'You pry yourself free',
        body: "You force the iron jaws apart and pull your leg free.",
      });
    }
    if (result.lost > 0) {
      this._flashPlayerHit(result.lost);
      this._popEnergy(-result.lost);
      this._warnIfTiring(before);
      this.updateEnergyDOM();
    }
    if (result.ticks || result.expired) persistSave(this.save);
    this._announceStatuses();
    this._syncStatusRow();
  }

  // THE ANNOUNCEMENT. A status or a timed effect that has just LANDED on the
  // player — a row of Conditions.DEFINITIONS newly active, a row of
  // Buffs.KINDS whose expiry is newly set or pushed out (a second potion on
  // top of the first, a torch relit, counts) — flicks the body in the row's
  // own colour (_flashPlayerStatus → _updatePlayerAura, for
  // Combat.STATUS_FLASH_MS, the flick a foe gets) and pops the row's word on
  // the player's cell (_popCellNumber, the tier the "+N⚡" uses). Read off
  // the two owning tables every frame from _tickConditions, so a new row
  // announces itself with no call at its writer — the same way the status
  // row shows it. The first pass only takes stock: a save loaded with three
  // potions running is not three things landing at once.
  _announceStatuses() {
    const seen = this._statusSeen;
    const next = {};
    const now = Date.now();
    for (const [id, def] of Object.entries(Conditions.DEFINITIONS)) {
      if (!Conditions.active(this.save, id)) continue;
      next['c:' + id] = 1;
      if (seen && !seen['c:' + id]) this._flashPlayerStatus(def.label, def.ink);
    }
    for (const [id, k] of Object.entries(Buffs.KINDS)) {
      const until = Buffs.until(id, this.save, this);
      if (!(until > now)) continue;
      next['b:' + id] = until;
      // Pushed out by more than a clock's jitter: a relit torch, a second
      // potion. A buff merely still running is not announced again.
      const prev = seen?.['b:' + id];
      if (seen && (prev == null || until > prev + STATUS_EXTEND_SLACK_MS)) this._flashPlayerStatus(k.name, k.color);
    }
    this._statusSeen = next;
  }
  _flashPlayerStatus(label, color) {
    this._statusFlashUntilT = performance.now() + Combat.STATUS_FLASH_MS;
    this._statusFlashTint = parseInt(String(color).slice(1), 16);
    let ix, iy;
    if (this.startWorldM && this.originPx && typeof playerReachCell === 'function') {
      const p = playerReachCell(this);
      ix = p.cellIX; iy = p.cellIY;
    }
    this._popCellNumber(label, color, ix, iy);
  }

  // THE STATUS ROW — every status, buff and timer on the player, as chips
  // under the top HUD row (#status-row, STATUS_ROW_CSS; built by
  // _buildStatusRow): first the conditions (the rows of
  // Conditions.DEFINITIONS the player carries, in table order — label, time
  // left and the drain it levies now, in the row's ink on its bg), then every running timed effect
  // (Buffs.active — potions, powders, the torch, coffee, the bike, the
  // compass, every shrine boon — "<name> · <wait>", in the row's ink on its
  // stroke). One chip per id, kept in that order; a chip whose effect has
  // run out is removed. Runs every frame from _tickConditions, so every DOM
  // write is guarded on the value having changed: the order string decides
  // whether anything is re-appended, the text only rewrites when the
  // shown second ticks over. Nothing is drawn over the player's head.
  _syncStatusRow() {
    const row = this.statusRowEl;
    if (!row) return;
    // The objective chip (#objective, the starter ladder) hangs under the
    // same HUD row, full width: while it shows, the status row seats under
    // IT. Its bottom is read back only when what decides it changes (the
    // chip's display, its text, a dialog hiding it, a resize) — a rect read
    // every frame would force a layout every frame.
    const obj = document.getElementById('objective');
    const shown = obj && obj.style.display !== 'none' && !document.body.classList.contains('modal-open');
    const seatKey = shown ? `${obj.textContent}|${window.innerWidth}x${window.innerHeight}` : '';
    if (this._statusRowSeat !== seatKey) {
      this._statusRowSeat = seatKey;
      row.style.top = shown ? `${Math.round(obj.getBoundingClientRect().bottom) + 6}px` : '';
    }
    const chips = [];
    for (const [id, def] of Object.entries(Conditions.DEFINITIONS)) {
      if (!Conditions.active(this.save, id)) continue;
      // The drain the row levies NOW: a burn's grows with its exposure
      // (Conditions.burnTickLoss, the charge advanceBurn levies); a row with
      // no drain of its own (the trap pin) shows only its time.
      const left = this.save.conditions[id].remainingMs;
      const loss = id === 'burning' ? Conditions.burnTickLoss(left) : def.energyLoss;
      const drain = def.intervalMs ? ` · −${loss} energy / ${shortDuration(def.intervalMs)}` : '';
      chips.push({ id, ink: def.ink, bg: def.bg, text: `${def.label} · ${shortDuration(left)}${drain}` });
    }
    if (this._bodyHold?.().slowed) {
      const def = Conditions.CONTEXT_STATUS.slowed;
      chips.push({ id: 'slowed', ink: def.ink, bg: def.bg, text: def.label });
    }
    for (const b of Buffs.active(this.save, this)) {
      chips.push({ id: b.id, action: b.action, ink: b.color, bg: b.stroke + 'e8', text: `${b.name} · ${shortDuration(b.remainingMs)}` });
    }
    const order = chips.map((c) => c.id).join(',');
    if (this._statusRowDOM !== order) {
      this._statusRowDOM = order;
      const keep = new Set(chips.map((c) => c.id));
      for (const el of [...row.children]) if (!keep.has(el.dataset.id)) el.remove();
      for (const c of chips) {
        let el = row.querySelector(`[data-id="${c.id}"]`);
        if (!el) {
          el = document.createElement(c.action ? 'button' : 'div');
          if (c.action) {
            el.type = 'button';
            el.addEventListener('click', e => {
              e.stopPropagation();
              if (document.body.classList.contains('modal-open')) return;
              this[c.action]?.();
              this._syncStatusRow();
            });
          }
          el.className = 'status-chip';
          el.dataset.id = c.id;
          el.style.color = c.ink;
          el.style.background = c.bg;
        }
        row.append(el);   // append moves an existing chip into table order
      }
    }
    for (const c of chips) {
      const el = row.querySelector(`[data-id="${c.id}"]`);
      if (el && el.textContent !== c.text) el.textContent = c.text;
    }
  }

  // The row itself, under the HUD row's right edge (its CSS in
  // STATUS_ROW_CSS, injected once like the road chip's). Built in create()
  // beside the other chips; _syncStatusRow fills it.
  _buildStatusRow() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('status-row-style')) {
      const st = document.createElement('style');
      st.id = 'status-row-style';
      st.textContent = STATUS_ROW_CSS;
      document.head.appendChild(st);
    }
    let el = document.getElementById('status-row');
    if (!el) {
      el = document.createElement('div');
      el.id = 'status-row';
      document.body.appendChild(el);
    }
    el.replaceChildren();
    this.statusRowEl = el;
    this._statusRowDOM = null;
    this._statusRowSeat = null;
  }

  // ── Fire on the body ──────────────────────────────────────────────────────
  // Standing IN a campfire (FIRE_TOUCH_CELLS of one on this depth — warmth is
  // FIRE_REST_R, the touch is the hearth itself) or in lava (_tickLava) sets
  // the player BURNING: the `burning` row of Conditions.DEFINITIONS, on the
  // ticker poison runs on. Conditions owns exposure accumulation and scaled
  // damage; this hook starts the status and its feedback. Contact is reported
  // at most once a tick-interval, preserving the accumulated duration and
  // avoiding a save every frame. Never off an empty bar (Combat.playerDowned).
  _ignitePlayer() {
    const now = performance.now();
    if (now < (this._igniteNextT || 0) || Combat.playerDowned(this.save.energy)) return false;
    this._igniteNextT = now + Conditions.DEFINITIONS.burning.intervalMs;
    this._applyCondition('burning');
    return true;
  }
  _tickFireTouch() {
    if (!this.startWorldM || !this.save.fires?.length) return;
    const px = this.startWorldM.x + this.playerM.x, py = this.startWorldM.y + this.playerM.y;
    if (this._nearAny('fires', px, py, FIRE_TOUCH_CELLS)) this._ignitePlayer();
  }

  _shotCanHit(target, shot) {
    if (Combat.isConcealed(target)) return false;
    if (shot.potionId) return target.id !== 'player';
    // Recheck at impact: an earlier flower in this same frame may have changed
    // the source's or target's allegiance since the target lists were built.
    if (shot._sourceGuard && shot.hostile === Combat.isCharmed(shot._sourceGuard)) return false;
    if (!shot.hostile) return Combat.isEnemy(target);
    if (target.kind === 'npc') return !NPC.isDormant(target) && NPC.canTarget(this, target);
    return target.id === 'player' || Combat.isCharmed(target);
  }

  _shotHitsTarget(target, shot) {
    if (!this._shotCanHit(target, shot)) return false;
    if (shot.potionId) {
      PotionEffects.apply(this, target, shot.potionId);
      this._burstAtWorld('trailspark', target.x, target.y);
      return true;
    }
    if (!shot.hostile) return this._friendlyShotHitsEnemy(target, shot);
    if (target.kind === 'npc') return NPC.hit(this, target, Date.now(), shot.damage);
    if (target.id === 'player') return this._shotHitsPlayer(shot);
    return this._damageEnemy(target, shot.damage, 'enemy');
  }

  _friendlyShotHitsEnemy(target, shot) {
    if (!Combat.isEnemy(target)) return false;
    if (shot.effect === 'sleep') return Combat.applySleep(target, Date.now());
    if (shot.effect === 'charm') return Combat.applyCharm(target, Date.now());
    return this._damageEnemy(target, shot.damage, Combat.shotSource(shot));
  }

  // A monster's arrow lands. The same energy hit the melee leech deals
  // (wanderCreatures' monster branch) — the shield potion halves it at the
  // moment of impact, worn armour soaks what is left, and the loss rolls into
  // the throttled "monsters hit -N⚡" flash so a volley reads as one pop —
  // only delivered by a shot you could see coming rather than a silent drain
  // at range.
  _shotHitsPlayer(shot) {
    const dmg = Combat.incomingProjectileDamage(this.save, shot.damage, shot.hits);
    if (!(dmg > 0)) return false;
    const lost = this._losePlayerEnergy(dmg, { closeShop: true });
    this._monsterDmgAccum = (this._monsterDmgAccum || 0) + lost;
    if (lost > 0 && shot.condition) this._applyCondition(shot.condition);
    return lost > 0;
  }

  // The body takes a hit: a short red flick on the character, at the INSTANT
  // a blow lands — the slime's leech, a monster's melee, an arrow striking —
  // never from the throttled "−N⚡" pop, which rolls a second of hits into one
  // number and would flash once for three bites. Two channels, both read by
  // _updatePlayerAura every frame: the sprite tint, which is invisible under
  // Phaser's Canvas fallback (setTint is a no-op there — the shiny cue and the
  // coloured icons both learned this), and the halo's red texture, a plain
  // image that reads on every renderer. A haptic tick rides along, and so does
  // a red chip burst off the BODY (Particles 'pain') — every one of these
  // call sites is the player being hurt, so the burst belongs here rather
  // than duplicated at each one; it is already 0 under prefers-reduced-motion
  // by burstCount's own rule. `dmg` is the actual points this blow cost — the
  // burst reads it (Particles.dmgSpeedScale) to throw a 1-point graze a short
  // distance rather than the same full-force ring a worst-case hit gets;
  // omitted it defaults to the full throw.
  // A FOE'S blow ends any shopping: a shop dialog covers the map, so a player
  // haggling while a slime leeches them would otherwise never see the fight.
  // Called at the three places an enemy reaches the player (the slime leech,
  // the monster's melee, the goblin arrow) — NOT from _flashPlayerHit, which a
  // trap's bite and bleed also go through: iron jaws are not a foe walking up.
  // Every shop dialog is kind 'shop' (makeModalShell stamps data-kind), and
  // closing one is just removing it — the same thing its Cancel does.
  _closeShopOnHit() {
    if (typeof document === 'undefined') return;
    for (const w of document.querySelectorAll('.game-modal[data-kind="shop"]')) w.remove();
  }

  _flashPlayerHit(dmg) {
    this._hitFlashUntilT = performance.now() + HIT_FLASH_MS;
    if (this.hapticHit) this.hapticHit();
    if (typeof Particles !== 'undefined' && this.playerScreen) {
      const ps = this.playerScreen();
      if (ps && isFinite(ps.x) && isFinite(ps.y)) {
        Particles.burst(this, 'pain', ps.x, ps.y + this.playerFeetNudgeY, { dmg });
      }
    }
  }

  // A blow BANKED on the body — the one place a foe's (already mitigated) hit
  // or a trap's bleed comes off the bar: floored at 0, the flinch at the
  // instant it lands, the shop shut if `closeShop`, the tiring warning, the
  // HUD. Returns what was actually lost, for the caller's throttled pop
  // accumulator. It does NOT mitigate: Combat.playerDamage stays at the
  // caller, where the blow's own shield/armour inputs are.
  _losePlayerEnergy(dmg, { closeShop = false } = {}) {
    const before = this.save.energy ?? 0;
    if (!(before > 0) || !(dmg > 0)) return 0;
    if (Conditions.damageImmune(this.save)) { this._incomingDamageFraction = 0; return 0; }
    // Hard's post-armour penalty can leave half-pips. Bank them across hits
    // instead of rounding every attack into a different damage rate.
    this._incomingDamageFraction = (this._incomingDamageFraction || 0) + dmg;
    const whole = Math.floor(this._incomingDamageFraction + 1e-9);
    this._incomingDamageFraction -= whole;
    if (!whole) return 0;
    Energy.set(this.save, before - whole);
    if (!this.save.energy) this._incomingDamageFraction = 0;
    const lost = before - this.save.energy;
    this._flashPlayerHit(lost);
    if (closeShop) this._closeShopOnHit();
    this._warnIfTiring(before);
    if (this.updateEnergyDOM) this.updateEnergyDOM();
    return lost;
  }

  // A THEFT BANKED — the one place a thief's snatch (Combat.incomingTheft:
  // the raven's coins, the gull's food) lands on the player. The TAKE says
  // what: `{ what: 'coins', n }` goes to _losePlayerCoins, `{ what: 'food',
  // id, n }` to _losePlayerFood. Both are the thief twins of
  // _losePlayerEnergy — the thief marked sated for the day (Combat.bankTheft),
  // the flinch at the instant it lands (_flashPlayerHit), the shop shut like
  // any hit, and the "-N" on the player's own cell (_popCellNumber, the
  // pickup's "+N" in reverse — a number on the map names its cell). Neither
  // touches energy. Returns what was taken (a count).
  _losePlayerToThief(take, thief) {
    if (!take) return 0;
    if (take.what === 'coins') return this._losePlayerCoins(take.n, thief);
    if (take.what === 'food') return this._losePlayerFood(take.id, take.n, thief);
    return 0;
  }
  // Coins off the purse: never below $0, the gold "-N".
  _losePlayerCoins(n, thief) {
    const purse = Math.max(0, Math.floor(this.save.money ?? 0));
    const taken = Math.min(purse, Math.max(0, Math.floor(n || 0)));
    if (!(taken > 0)) return 0;
    addMoney(this.save, -taken);
    if (thief) Combat.bankTheft(this.save, thief);
    this._flashPlayerHit(taken);
    this._closeShopOnHit();
    if (typeof playerReachCell === 'function' && this.startWorldM && this.originPx) {
      const p = playerReachCell(this);
      this._popCellNumber(`-${taken}`, UI_GOLD, p.cellIX, p.cellIY);
    }
    if (typeof persistSave === 'function') persistSave(this.save);
    return taken;
  }
  // Food out of the bag: Inventory.remove is the one bag writer (never more
  // than the stack holds), the bar rebuilt so the missing piece shows, the
  // selection re-clamped like any consume, and the "-N Name" in the danger
  // ink — the same tier the eat button's "+N" answers in gold.
  _losePlayerFood(id, n, thief) {
    const taken = Inventory.remove(this.save, id, Math.max(0, Math.floor(n || 0)));
    if (!(taken > 0)) return 0;
    if (thief) Combat.bankTheft(this.save, thief);
    if ((this.save.selSlot ?? -1) >= (this.save.inv || []).length) this.save.selSlot = -1;
    this._flashPlayerHit(taken);
    this._closeShopOnHit();
    if (typeof playerReachCell === 'function' && this.startWorldM && this.originPx) {
      const p = playerReachCell(this);
      const name = (typeof ITEM_BY_ID !== 'undefined' && ITEM_BY_ID[id]?.name) || id;
      this._popCellNumber(`-${taken} ${name}`, UI_DANGER_INK, p.cellIX, p.cellIY);
    }
    if (typeof persistSave === 'function') persistSave(this.save);
    if (this.buildInventoryDOM) this.buildInventoryDOM();
    return taken;
  }

  // The castle turrets' volley — one arrow per turret per Combat.TURRET
  // interval at the nearest enemy in range. `enemies` is _combatTick's
  // already-filtered hostile list (Combat.isEnemy, minus the caught), so a
  // turret can no more shoot a crow or a pet than the player's bow can. The
  // on-screen turret set is the same viewport box the enemies were culled
  // with, rebuilt every TURRET_SCAN_MS rather than per frame (a tile can be
  // rebuilt under us — see rebuildTileWithBin — and the short cache is what
  // keeps a swapped-in entry's turrets firing without any hook there).
  // Turret arrows join _shots and fly exactly as the player's do: same
  // stepShots, same solid-cell test, same _damageEnemy — so a turret's kill
  // drops the bounty coin the way an arrow of your own does. Only the coin:
  // the shot carries source 'turret' (Combat.turretShot), which is not a
  // player kill (Combat.isPlayerKill), so nothing past the wage is paid.
  _turretFire(now, px, py, halfSpanM, enemies, pc) {
    let scan = this._turretScan;
    if (!scan || now - scan.t > TURRET_SCAN_MS) {
      const list = [];
      this._forEachTowerNear(pc, (o) => {
        if (o.kind !== 'tower') return;
        // ONLY A CASTLE YOU HAVE TAKEN BACK FIGHTS FOR YOU. A turret is stamped
        // with its castle's footprint key (worldgen), and this is the SAME
        // isClaimedKey test the tower's own art and its light already read: an
        // unclaimed castle draws in the shaded 'tower_unclaimed' palette
        // (render.js RENDER_SPEC.tower) and contributes no light
        // (lighting.js sourceKind), so a ruin that looked dead and dark was
        // nonetheless shooting arrows at everything that walked past it. A
        // turret with no castle at all (`o.castle` null) reads unclaimed to
        // every one of those three, and holds its fire here for the same
        // reason. Claim the castle and the walls man themselves — which is
        // what makes claiming one worth the walk.
        if (!this.isClaimedKey(o.castle)) return;
        if (Math.abs(o.x - px) > halfSpanM || Math.abs(o.y - py) > halfSpanM) return;
        list.push(o);
      });
      // A house the player restored as a TURRET (houses.js BUILD_OPTIONS) is
      // one more archer on the same lane: same bow, cadence and range. Its
      // `castle` is its own id — the material family the art picked
      // (render.js _houseFrame), which is what the arrow's launch height
      // reads (Render.towerCrownHeight).
      // Raised under the Magic Hammer (Houses.isShinyHouse) it is a SHINY
      // turret: Combat.turretTick hands the flag to the shot — double damage,
      // an arrow of light.
      this._forEachHouseNear(pc, (o) => {
        if (Houses.displayRole(this.save, o) !== 'turret') return;
        if (Math.abs(o.x - px) > halfSpanM || Math.abs(o.y - py) > halfSpanM) return;
        list.push({ id: o.id, x: o.x, y: o.y, castle: o.id, shiny: Houses.isShinyHouse(this.save, o) });
      });
      scan = this._turretScan = { t: now, list };
    }
    if (!scan.list.length) return;
    const shots = Combat.turretTick(scan.list, this._turretNextT, now, enemies, this.cellM);
    for (const shot of shots) {
      shot.liftFromPx = Render.towerCrownHeight(this.textures, shot.castle) - CELL_PX / 2 - 4;
      this._shots.push(shot);
    }
  }

  // Shots in flight, drawn as a short streak along their own heading so the
  // direction they're travelling is legible at a glance (a dot would just read
  // as a floating pixel).
  _drawShots() {
    const g = this.projGfx;
    if (!g) return;
    g.clear();
    this._boltUsed = 0;
    let spearUsed = 0;
    for (const s of this._shots) {
      const spec = Combat.SHOT[s.slot];
      if (s.projectile === 'bullet') { s.dotPx = 2; s.color = 0xe2d6b4; }
      if (s.projectile === 'blight_magic') { s.dotPx = 3; s.color = 0x85e64b; }
      const head = this.worldMetersToScreen(s.x, s.y);
      // Shots travel between FOOT positions (that's where the player and every
      // creature are anchored), but drawing them down at ankle height would
      // have them skim under the bodies they're hitting. Lift the streak to
      // roughly chest height so it leaves the archer and crosses the foe.
      // A turret's arrow starts higher — up on the battlements (liftFromPx)
      // — and comes down to the common chest height over the distance it was
      // aimed at (aimDistM, stamped by Combat.turretShot), so it reads as
      // loosed from the tower and landing on the foe rather than skimming
      // along the wall's foot.
      let lift = SHOT_DRAW_LIFT_PX;
      if (s.liftFromPx != null) {
        const f = s.aimDistM > 0 ? Math.min(1, s.travelledM / s.aimDistM) : 1;
        lift = s.liftFromPx + (SHOT_DRAW_LIFT_PX - s.liftFromPx) * f;
      }
      const hx = Math.round(head.x), hy = Math.round(head.y - lift);
      const thrownArt = MINERAL_ICON_SHEET[s.projectile]
        || (s.effect && CROP_SPRITE[s.projectile]);
      if (thrownArt) {
        const art = thrownArt;
        let sprite = this._spearPool[spearUsed];
        if (!sprite) {
          // Share the masked projectile layer, with ordinary sprite blending.
          sprite = this.add.image(0, 0, art.sheet, art.frame);
          this.boltContainer.add(sprite);
          this._spearPool.push(sprite);
        }
        spearUsed++;
        sprite.setTexture(art.sheet, art.frame).setScale(s.effect ? 0.8 : 1)
          .setVisible(true).setPosition(hx, hy).setRotation(Math.atan2(s.vy, s.vx));
        continue;
      }
      if (s.projectile === 'confusion_puff') {
        const phase = (s.travelledM || 0) * 3;
        for (let i = 0; i < 5; i++) {
          const angle = phase + i * Math.PI * 2 / 5;
          g.fillStyle(i % 2 ? 0xe8d878 : 0xc68ee8, 0.45);
          g.fillCircle(hx + Math.cos(angle) * 4, hy + Math.sin(angle) * 3, 4);
        }
        g.fillStyle(0xf2d8ff, 0.7); g.fillCircle(hx, hy, 2);
        continue;
      }
      if (s.projectile === 'rock') {
        // A small solid stone with a lit facet; no magic bolt halo.
        g.fillStyle(0x403e3c, 1);
        g.fillPoints([{ x: hx - 4, y: hy }, { x: hx - 2, y: hy - 3 },
          { x: hx + 2, y: hy - 3 }, { x: hx + 4, y: hy + 1 },
          { x: hx + 1, y: hy + 3 }, { x: hx - 3, y: hy + 2 }], true);
        g.fillStyle(0xa6a39a, 1);
        g.fillTriangle(hx - 2, hy - 2, hx + 2, hy - 2, hx - 1, hy + 1);
        continue;
      }
      if (s.projectile === 'musket_ball') {
        g.fillStyle(0x262930, 1);
        g.fillCircle(hx, hy, s.dotPx);
        g.fillStyle(0x9da4b0, 1);
        g.fillCircle(hx - 1, hy - 1, 1);
        continue;
      }
      if (s.dotPx) {
        // The staff bolt is a ball of light, not a streak — a bolt reads as
        // a thrown thing, an arrow as a flying line. Its radius is the shot's
        // own (stamped by Combat.spawnShot from the staff's tier, off the same
        // scale as the radius it hits with), never the spec's base dotPx; the
        // glow around it is drawn wider, but the hot core is that radius.
        this._drawBolt(s, s.color != null ? s.color : spec.color, lift);
        continue;
      }
      // The tail trails a fixed number of SCREEN pixels back along the
      // heading — the streak is a readability device, not a world-space
      // object, so it shouldn't grow or shrink with the projection.
      // A hostile arrow carries its own colour (Combat.HOSTILE_ARROW_COLOR)
      // so a shot coming AT you reads apart from one going out. A SHINY
      // turret's arrow (Combat.turretShot, `shiny`) is a streak of light: the
      // bolt's glow texture in its own gold, a soft halo on the head and a
      // fainter one trailing, under the same streak. Lighting.collectBolts
      // throws its light on the ground it crosses.
      if (s.shiny) {
        const key = this._boltGlowKey(s.color != null ? s.color : spec.color);
        this._boltGlow(key, hx, hy, SHINY_ARROW_GLOW_PX, 0.85);
        this._boltGlow(key, Math.round(hx - s.vx * spec.lenPx * 0.5), Math.round(hy - s.vy * spec.lenPx * 0.5),
          SHINY_ARROW_GLOW_PX * 0.6, 0.45);
      }
      g.lineStyle(spec.widthPx, s.color != null ? s.color : spec.color, 0.9);
      g.beginPath();
      g.moveTo(Math.round(hx - s.vx * spec.lenPx), Math.round(hy - s.vy * spec.lenPx));
      g.lineTo(hx, hy);
      g.strokePath();
    }
    this._drawStaffCharge(g);
    for (let i = spearUsed; i < this._spearPool.length; i++) this._spearPool[i].setVisible(false);
    for (let i = this._boltUsed; i < this._boltPool.length; i++) this._boltPool[i].setVisible(false);
  }

  // A soft round glow in `colour`, baked once per colour: a white-hot core
  // running out through the colour to nothing. The bolt, its trail and the
  // charging orb are all this one texture at different sizes and alphas.
  _boltGlowKey(colour) {
    const key = `bolt_glow_${(colour >>> 0).toString(16)}`;
    if (this.textures.exists(key)) return key;
    const S = BOLT_GLOW_TEX_PX;
    const tex = this.textures.createCanvas(key, S, S);
    const ctx = tex.context;
    const r = (colour >> 16) & 255, gg = (colour >> 8) & 255, b = colour & 255;
    const c = (a) => `rgba(${r},${gg},${b},${a})`;
    const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.16, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.3, c(0.85));
    grad.addColorStop(0.55, c(0.32));
    grad.addColorStop(0.8, c(0.08));
    grad.addColorStop(1, c(0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    tex.refresh();
    return key;
  }

  // One glow from the pool, placed at screen (x, y) with radius `rPx` (the
  // texture's own edge — where it has faded to nothing).
  _boltGlow(key, x, y, rPx, alpha, container = this.boltContainer) {
    let im = this._boltPool[this._boltUsed];
    if (!im) {
      im = this.add.image(0, 0, key).setBlendMode(Phaser.BlendModes.ADD);
      this._boltPool.push(im);
    } else if (im.texture.key !== key) {
      im.setTexture(key);
    }
    // The pool serves both flying bolts and the orb held in the player's
    // hand. Reset the parent on reuse so the charge hides with the body.
    if (im.parentContainer !== container) {
      im.setDepth(12);
      container.add(im);
      container.sort('depth');
    }
    this._boltUsed++;
    im.setVisible(true).setPosition(x, y)
      .setScale(Math.max(0.01, rPx / (BOLT_GLOW_TEX_PX / 2)))
      .setAlpha(Math.max(0, Math.min(1, alpha)));
    return im;
  }

  // A staff bolt in flight: a comet. The TRAIL is where the bolt has been, in
  // world metres (so a peek drag leaves it on the street it crossed — the
  // camera rule), fading and thinning behind it; the HALO is a wide soft glow
  // that breathes quickly; the CORE is the hot centre at the bolt's own
  // drawn radius. The ground under it is lit by Lighting's `bolt` row, which
  // reads the same shot list. The tier shows three ways: the radius (dotPx,
  // boltScale), the colour (the staff's metal, shotTierColour) and how hard
  // it burns (Combat.boltGlow, on the halo and trail; the core stays hot).
  _drawBolt(s, colour, lift) {
    const key = this._boltGlowKey(colour);
    const glow = Combat.boltGlow(s.slot, s.tier);
    const trail = s._trail || (s._trail = []);
    const last = trail[trail.length - 1];
    const stepM = BOLT_TRAIL_STEP_CELLS * this.cellM;
    if (!last || Math.hypot(s.x - last.x, s.y - last.y) >= stepM) {
      trail.push({ x: s.x, y: s.y });
      if (trail.length > BOLT_TRAIL_N) trail.shift();
    }
    // A foe the bolt has just passed through (stepShots' pierce ledger,
    // `_struck`, grew since the last draw) throws a ring of sparks in the
    // bolt's colour off the bolt. Sparks only, never a Lighting.blast: a
    // blast counts in brightnessAt, and a ghost the bolt crosses must not
    // take a burn from what is only the look of the hit.
    const struck = s._struck ? s._struck.size : 0;
    if (struck > (s._sparked || 0)) {
      s._sparked = struck;
      this._burstAtWorld('trailspark', s.x, s.y,
        { colour: '#' + (colour >>> 0).toString(16).padStart(6, '0') });
    }
    const r = s.dotPx;
    const n = trail.length;
    for (let i = 0; i < n - 1; i++) {
      const p = this.worldMetersToScreen(trail[i].x, trail[i].y);
      const f = (i + 1) / n;                        // 0 oldest → 1 the head
      this._boltGlow(key, p.x, p.y - lift, r * (1.2 + 1.6 * f), 0.5 * f * f * glow);
    }
    const head = this.worldMetersToScreen(s.x, s.y);
    const hx = head.x, hy = head.y - lift;
    const t = performance.now();
    if (s._boltPhase == null) s._boltPhase = Math.random() * Math.PI * 2;   // a look, not the world
    const breathe = 0.5 + 0.5 * Math.sin(t / 70 + s._boltPhase);
    this._boltGlow(key, hx, hy, r * (5.5 + 1.2 * breathe), (0.5 + 0.25 * breathe) * glow);
    this._boltGlow(key, hx, hy, r * 2.2, 0.5 + 0.5 * glow);
  }

  // The staff's next bolt, gathering by the player's hand between shots: a
  // dot that grows from a spark to the bolt's own size (Combat.shotDotPx at
  // the staff's tier) over the beat, in the bolt's colour, and pulses once it
  // is full and waiting for a foe to come into range. Drawn AT the player
  // (playerScreen, the camera rule), at the height a bolt is drawn in flight
  // (SHOT_DRAW_LIFT_PX) so the loosed bolt leaves from where it charged.
  _drawStaffCharge(g) {
    const f = this._staffCharge;
    const tier = Gear.effectiveRelics(this.save).staff?.tier;
    if (f == null || !tier) return;
    const full = Combat.shotDotPx('staff', tier);
    const p = this.playerScreen();
    const x = Math.round(p.x + STAFF_CHARGE_HAND_DX);
    const y = Math.round(p.y - SHOT_DRAW_LIFT_PX);
    const pulse = f >= 1 ? 0.75 + 0.25 * Math.sin(performance.now() / 160) : 1;
    const r = Math.max(1, full * (0.25 + 0.75 * f) * pulse);
    // The same glow as the bolt it becomes (_drawBolt): a soft halo gathering
    // round a hot core, both growing with the charge.
    const key = this._boltGlowKey(shotTierColour('staff', tier));
    const glow = Combat.boltGlow('staff', tier);
    this._boltGlow(key, x, y, r * 3.6, (0.2 + 0.45 * f) * pulse * glow, this.playerWorldContainer);
    this._boltGlow(key, x, y, r * 2.2, (0.35 + 0.65 * f) * (0.5 + 0.5 * glow), this.playerWorldContainer);
  }

  // A health bar over every enemy hurt in the last few seconds — the same bar
  // the combat wheel's target wears, at the same crown seating, so a bow shot
  // from across the street reports its damage exactly the way a sword swing
  // does. The wheel's own target is skipped: it draws its own, brighter, on
  // top (in _drawWorkProgress).
  _drawEnemyHealth(enemies) {
    const g = this.enemyHealthGfx;
    if (!g) return;
    g.clear();
    const now = performance.now();
    const engaged = this._workProgress?.combat || null;
    for (const c of enemies) {
      if (c === engaged) continue;
      if (!c._hurtUntilT || now >= c._hurtUntilT) continue;
      const screen = this.worldMetersToScreen(c.x, c.y);
      this._drawEnemyHealthBar(g, Math.round(screen.x),
        Math.round(screen.y) + Math.round(SpriteLayout.creatureHealthBarTop(c.kind, SpriteLayout.creatureInstScale(c))),
        Combat.hpFraction(c), 0.62);
    }
  }

  // The health bar itself: a small strip floating over the foe's head — a
  // faint full-HP track with the REMAINING hit points filled over it, tinted
  // green → amber → red on the way down. Deliberately NOT the work wheel's
  // ring: the wheel is a ring that sits ON the thing being worked, health is a
  // bar in the sky above it, so a fight and a job can never be misread for
  // each other. `cx` is the bar's horizontal centre, `top` its top edge;
  // `alpha` scales the whole bar (the engaged target draws brighter than a
  // foe merely hurt in passing).
  _drawEnemyHealthBar(g, cx, top, frac, alpha) {
    const W = SpriteLayout.HEALTH_BAR_W;
    const H = SpriteLayout.HEALTH_BAR_H;
    const x = cx - Math.floor(W / 2);
    // Dark backing one pixel proud on every side — the border that keeps the
    // strip legible over pale terrain, same job as the wheel's backing disc.
    g.fillStyle(0x000000, 0.5 * alpha);
    g.fillRect(x - 1, top - 1, W + 2, H + 2);
    // Faint full-width track: how much health there ISN'T, at a glance.
    g.fillStyle(0xffffff, 0.16 * alpha);
    g.fillRect(x, top, W, H);
    if (frac > 0) {
      g.fillStyle(Combat.healthColor(frac), 0.95 * alpha);
      g.fillRect(x, top, Math.max(1, Math.round(W * frac)), H);
    }
  }

  // A floating "-N" over a foe as damage lands — the sword's melee wheel and
  // every bow/staff shot funnel through _damageEnemy, so they all pop the
  // same way. Spawned at the health bar (projected off the foe's own world
  // position, so a peek slides it with the foe) and drifting up into the sky
  // above it; short-lived enough that it doesn't need to track a moving
  // target. It is a `damage` toast: the one style table dresses it, so it
  // wears the same stroke and drop shadow as every other number on the map
  // rather than a hand-set style that drifts from them.
  _popDamageNumber(c, amount) {
    return this._popCreatureText(c, `-${amount}`, UI_DANGER_INK);
  }
  // Any short word ON a creature: the "-N" above, and the name of a status
  // that has just landed on it (render.js drawCreatures, off
  // Combat.flagStatus — "Sleep", "Frozen", "Psychosis", in the status's own
  // ink). Seated over the health bar like the number, in the `damage` tier.
  _popCreatureText(c, text, color) {
    if (!this.add) return;                       // headless / teardown guard
    const screen = this.worldMetersToScreen(c.x, c.y);
    // Small horizontal scatter so back-to-back numbers (a bow hit landing
    // mid-swing) read as separate hits instead of overprinting — which is
    // also why it does NOT stack: a lift would undo the scatter.
    const jitter = Math.round((Math.random() - 0.5) * 10);
    const x = Math.round(screen.x) + jitter;
    const y = Math.round(screen.y) + Math.round(SpriteLayout.creatureHealthBarTop(c.kind, SpriteLayout.creatureInstScale(c))) - 3;
    // Clip to the map viewport like every other world-anchored layer.
    this._toast(text, {
      tier: 'damage', color, x, y, stack: false,
      mask: this.enemyHealthGfx?.mask,
    });
  }

  // The WORK wheel's ring: an arc that fills with progress toward finishing the
  // job (chop / mine / fish / hunt / catch), over a faint full-circle track so
  // it shows how far there is still to go and not just how much is done
  // (UX audit §20).
  //
  // The wheel sits ON the thing being worked, so its alphas have been walked
  // back twice: first 20% off everything (0.55 → 0.44 backing, 0.9 → 0.72 arc),
  // then a flat 0.1 off each — backing 0.34, arc 0.62 (the tool in the middle
  // is WORK_TOOL_ALPHA, drawn by _drawWorkProgress). At full
  // strength it hid the very sprite it was reporting progress against. The
  // track is thinned in step with the arc (×0.62/0.72) rather than by the flat
  // 0.1, which would have all but erased it.
  _strokeWorkRing(g, cx, cy, progress) {
    // Radius comes from the same table that PLACES the wheel — the crown
    // seating clears the outer edge (R + 1, the backing disc), so a resize here
    // without one there would put the ring back in the sky.
    const R = SpriteLayout.CREATURE_WHEEL_R;
    g.fillStyle(0x000000, 0.34);
    g.fillCircle(cx, cy, R + 1);
    g.lineStyle(3, 0xffffff, 0.155);
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2, false);
    g.strokePath();
    if (progress > 0) {
      g.lineStyle(3, 0xffffff, 0.62);
      g.beginPath();
      g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
      g.strokePath();
    }
  }

  // Apply damage to an enemy from any source (a shot, or the melee wheel).
  // Returns true if that blow killed it. `_hurtUntilT` is what keeps the
  // floating health bar up for a few seconds after the hit; `_lastDamagedT`
  // feeds the existing 20-minute regen in wanderCreatures, so a foe you wound
  // and abandon does heal back up. `source` names the killer for
  // resolveDefeat (Combat.isPlayerKill): 'player' unless a shot says otherwise.
  _damageEnemy(c, amount, source = 'player', options = {}) {
    if (!(amount > 0)) return false;
    const dealt = Combat.damageDealt(c, amount, (['lava', 'light', 'burn', 'obstacle'].includes(source)) ? { bypassArmor: true } : options);
    const left = Combat.hp(c);
    // Moss hides us until we strike this creature. Environmental damage and
    // allied attacks do not reveal us; a fresh blessing hides us again.
    if (source === 'player' && dealt > 0 && Shrines.leverActive(this.save, 'hidden')) {
      c._mossProvokedUntil = this.save.boonUntil.hidden;
    }
    // Asked BEFORE the stamp below, which is what makes it "was it already
    // charging" rather than "is it a slime".
    const wasCharging = slimeCharging(c);
    c._lastDamagedT = Date.now();
    // TURN NOW. A struck slime charges (slimeCharging), but the charge is only
    // read when it chooses its next hop, and its beat is the longest in the
    // game — so without this it finishes ambling away for up to 7.5 s before it
    // reacts to being stabbed. Only on the FIRST hit of a charge: the melee
    // wheel lands a blow a SECOND, and re-choosing on every blow would restart
    // the hop it is part-way through each time, leaving a slime under constant
    // fire twitching on the spot instead of closing.
    if (!wasCharging && c.kind === 'slime') c._nextChooseT = 0;
    // Nothing here about Home's rout: a foe hit at the doorstep is a foe
    // INSIDE Home's ring, and the ring itself is what routs it now
    // (wanderCreatures' `_wardFrom` latch). This carried a second copy
    // of that test — homeWorldPos, HOME_R, Combat.isEnemy — for the case where
    // the ward was a bare radius and only a blow could extend it.
    const now = performance.now();
    c._hurtUntilT = now + ENEMY_HEALTH_RING_MS;
    // Damage numbers. Accumulate-and-beat rather than pop-per-call: a shot
    // arrives as one whole payload, but the melee wheel calls this every
    // frame with a fraction of a point — see DMG_POPUP_BEAT_MS. The kill blow
    // flushes whatever the throttle was still holding, so the numbers a fight
    // shows always sum to the HP it took.
    c._dmgPopupAccum = (c._dmgPopupAccum || 0) + dealt;
    const dead = left <= 0;
    if (dead || now >= (c._dmgPopupNextT || 0)) {
      const n = Math.round(c._dmgPopupAccum);
      if (n >= 1) {
        this._popDamageNumber(c, n);
        // Subtract, don't zero: the rounding error carries into the next beat
        // instead of quietly inflating what a long fight claims to have dealt.
        c._dmgPopupAccum -= n;
        c._dmgPopupNextT = now + DMG_POPUP_BEAT_MS;
      }
    }
    if (!dead) {
      // A BLOW divides a splitting slime (creature_ai.js enemySplit — the
      // roster row's ability); the ground's damage (lava, light, a burn) does
      // not, or a burning slime would divide itself every tick. The striker's
      // side is whoever dealt it: a shot's origin when the caller says, else
      // the player's feet.
      if (dealt > 0 && !['lava', 'light', 'burn', 'obstacle'].includes(source)) {
        const from = options.from || this.playerM || { x: c.x - 1, y: c.y };
        if (enemySplit(this, c, from.x, from.y, now) && now >= (this._splitFlashT || 0)) {
          this._splitFlashT = now + 2500;
          this.flashAtWorld('The slime splits!', c.x, c.y);
        }
      }
      return false;
    }
    if (this._workProgress?.combat === c) this.cancelWorkProgress();
    this.resolveDefeat(c, source);
    return true;
  }

  // Start (or re-target) the COMBAT wheel on an enemy. Unlike the timed work
  // wheel this one is driven by the target's HP: the foe wears its health bar
  // (drawn bright in _drawWorkProgress), melee drains it every frame, and
  // bow/staff shots drain the same pool — so an arrow landing mid-swing
  // visibly shortens the fight.
  //
  // `durationMs` is still filled in, with the kill time at the CURRENT melee
  // rate and WITHOUT the dragon bonus. Nothing reads it as a deadline (HP ends
  // the fight), but the orphaned-wheel watchdog in _drawWorkProgress does, and
  // since every other damage source only makes the fight shorter, that
  // estimate is a true upper bound.
  startCombat(victim, opts = {}) {
    // A Shadow Powder is a truce: no wheel spins up while it hides the player.
    if (this.isShadowActive()) {
      if (!opts.auto) {
        const ps = this.playerScreen();
        this.flash('The shadows hold your arm.', ps.x, ps.y + this.playerBodyDy());
        this.hapticReject?.();
      }
      return false;
    }
    if (!Combat.isEnemy(victim) || !Gear.meleeActive(this.save)) return false;
    // First melee the save ever starts tells its story in the auto-engage lane,
    // fired
    // regardless of an owned sword: bare hands fight on the tier-0 rung too.
    this._toolActionStory('sword');
    const dps = Combat.meleeDps(this.save.relics, this.save.playerClass, Gear.activeWeapon(this.save), isRiding(this.save));
    const estMs = (Combat.hp(victim) / Math.max(0.01, dps)) * 1000;
    const now = performance.now();
    // A fight shows the foe's health bar, not a progress arc, so the tool
    // badge is the one place left that still says what you're hitting it WITH.
    // Bare hands own no sword and draw no badge — _setWorkProgressIcon answers
    // that for every wheel now, so the slot is passed plainly rather than
    // re-testing ownership here.
    this._setWorkProgressIcon(Gear.activeWeapon(this.save) || 'sword');
    this._workProgress = {
      worldX: victim.x, worldY: victim.y,
      combat: victim,
      track: victim,              // reuse the hunt wheel's follow + escape abort
      auto: !!opts.auto,
      onComplete: () => this.resolveDefeat(victim),
      durationMs: estMs,
      energyRefund: 0,
      startT: now,
    };
  }

  // The kill payload — drops, bounty, quest tick, shiny fanfare. Every route
  // to a dead creature funnels through here (the tap-hunt wheel in interact.js,
  // the combat wheel, a killing bow/staff shot, a pet's bite, a turret arrow)
  // so they can't pay out differently.
  //
  // `source` is WHO felled it. The BOUNTY is paid on every death, as a coin on
  // the ground (_dropBountyCoin); everything past it — the kind's drop, the
  // elite badge and roll, the monster treasure roll, the quest tick, the shiny
  // bonus — only when Combat.isPlayerKill(source): the player or their pet. A
  // castle turret's kill leaves the coin and nothing else.
  resolveDefeat(victim, source = 'player') {
    const save = this.save;
    save.caught = save.caught || [];
    if (save.caught.includes(victim.id)) return;
    save.caught.push(victim.id);
    StoryEncounters.defeated(this, victim);
    DragonStory.defeated(this, victim, source);
    const mine = Combat.isPlayerKill(source);
    // WHAT A KILL DROPS is the kind's own row (SpriteLayout.CREATURE_BEHAVIOUR
    // `drop`), not a ternary here: game drops a body part, and an ENEMY pays a
    // bounty instead — which is Combat's question, asked just below.
    // An ENEMY may carry one too (the goblin trapper's Magic Trap), and it is
    // paid ON TOP of the wage below, never instead of it.
    const dropId = mine ? SpriteLayout.creatureDrop(victim.kind) : null;
    if (dropId) {
      this.addToInv(dropId, 1);
      const item = ITEM_BY_ID[dropId];
      this.flashLoot(`+1 ${item?.name || dropId}`, '#ffe066', 1, dropId);
    }
    if (Combat.isEnemyKind(victim.kind)) {
      // Every enemy kill pays a bounty (enemyBounty — derived from the kind's
      // HP plus a depth climb). The SURFACE SLIME draws one too, because this
      // branch asks Combat what an enemy is rather than asking the cave-monster table.
      // It is NOT credited: it falls as one coin on the foe's cell carrying
      // the whole amount, and the coin tap (interact.js 'coindrop') pays it
      // and pops the real number there.
      // A SPLIT slime's halves pay by share (creature_ai.js enemySplit): the
      // lineage sums to one slime's wage however many pieces it fell in.
      const coins = Combat.enemyBounty(victim.kind, this.depth, Combat.powerMul(victim) * (victim._splitShare ?? 1));
      if (coins > 0) this._dropBountyCoin(victim, coins);
      const name = Combat.monster(victim.kind)?.name || 'Slime';
      const elite = Combat.isElite(victim);
      if (mine) this.flashAtWorld(`⚔️ ${name} slain`, victim.x, victim.y);
      if (!mine) {
        // A turret's (or any non-player) kill: the coin is the whole payout.
      } else if (elite) {
        // An elite always pays past the wage: the kind's memory the
        // first time, a relic-biased treasure roll at a depth-commensurate
        // tier every time after (see ELITE_TREASURE_CONTEXT / eliteRollBonus).
        if (this._bankDiscovery(victim.kind, `slaying an elite ${name}`)) {
          this.flashShiny(0, true, '✨ ELITE SLAIN ✨');   // the wage is the coin
        } else {
          // Shown as a card (showRewardCard), not a toast: an elite's drop is
          // a quest-sized reward, and a toast under a fight is missed.
          grantTreasureRoll(this, save, this.viewCenterX, this.viewCenterY - 24, '💀',
            Combat.ELITE_TREASURE_CONTEXT,
            { rollBonus: Combat.eliteRollBonus(victim.kind, this.depth),
              ceremony: { kind: 'treasure', header: 'Elite slain',
                          sub: `The ${name} falls. What it guarded is yours.` } });
        }
      } else if (Combat.isMonster(victim.kind) && Combat.spawnsUnderground(victim.kind)
                 && Math.random() < Combat.MONSTER_TREASURE_CHANCE) {
        // One in ten plain cave monsters also drops a buried-treasure roll —
        // the same table an X pays, so a lucky kill reads as finding one.
        // Underground only (a cave kind — not the night's ghost); see
        // MONSTER_TREASURE_CHANCE.
        grantTreasureRoll(this, save, this.viewCenterX, this.viewCenterY - 24, '💀');
      }
    } else if (mine && !dropId) {
      // Nothing defeatable reaches here today — interact.js sends only slimes,
      // crows and deer down the hunt wheel, and the other two routes only ever
      // carry enemies. A kind that ever did would otherwise die in silence.
      this.flashAtWorld(`${victim.kind} defeated`, victim.x, victim.y);
    }
    if (mine && typeof Quests !== 'undefined') {
      // The kind as-is: a giant is its own job on the board (QUEST_ENEMIES),
      // never credit toward its base kind's. A turret's kill is not the
      // player's job done.
      const qDone = Quests.onKill(save, victim.kind);
      if (qDone) this.flash('Quest done — see the castle.', this.viewCenterX, this.viewCenterY - 60);
    }
    // A guildhall bounty's foe: the pack's reward when it was the last one
    // (whoever felled it — the wage above was paid either way).
    if (victim.bounty) this._guildBountyDefeat(victim);
    persistSave(save);
    // Rare shiny deer / crow — hunted fauna drop their product (meat /
    // feather), so there's no live shiny animal to keep, but the shiny find
    // still pays the 10× money + memory with fanfare.
    if (victim.shiny && dropId) {
      this.awardShinyBonus(victim.kind, this.viewCenterX, this.viewCenterY - 60);
    }
  }

  // A kill's bounty, left ON THE GROUND: one coin at the centre of the foe's
  // cell in the tile that holds it, carrying the whole `amount` — the same
  // entry.coinDrops lane the coin bursts and cave coins ride (render.js draws
  // it, interact.js 'coindrop' pays `amount` and pops it on the cell), at any
  // depth since WorldGen.tileCache is the current level's. Session state like
  // every unseeded coin: no expiresAt (it waits for you), no save entry, and
  // the id is the dead foe's own, which it only ever has once. A tile REBUILT
  // under it carries coinDrops across (rebuildTileWithBin). Returns the coin,
  // or null when the foe's tile isn't loaded.
  _dropBountyCoin(victim, amount) {
    const edge = this.tileEdgeM;
    const tx = Math.floor(victim.x / edge), ty = Math.floor(victim.y / edge);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry) return null;
    const N = entry.cellsPerEdge || this.cellsPerTile;
    const cellSizeM = edge / N;
    let cx = Math.floor((victim.x - tx * edge) / cellSizeM);
    let cy = Math.floor((victim.y - ty * edge) / cellSizeM);
    // NEVER ON A ROAD OR IN A YARD (the coin rule — COIN_BURST_LIFE_MS's
    // note above, the same shared spawn rule _coinCellsNearPlayer uses for a
    // coin at the player's own feet): a foe felled off legitimate ground
    // leaves its coin on the nearest THE SPAWN GATE allows (a 'minor' spawn),
    // within three cells. Not just the road band: every hard spawn reason counts.
    const spawnOpts = { roadMask: entry.roadMask, quiet: entry.quietMask, spawnWhy: entry.spawnWhy };
    const blocked = (x, y) => !WorldGen.isSpawnCell(entry.grid, N, N, x, y, spawnOpts, 'minor');
    if ((this.depth || 0) === 0 && entry.grid && cx >= 0 && cy >= 0 && cx < N && cy < N && blocked(cx, cy)) {
      outer: for (let r = 1; r <= 3; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            if (blocked(nx, ny)) continue;
            cx = nx; cy = ny;
            break outer;
          }
        }
      }
    }
    const coin = {
      kind: 'coindrop',
      x: tx * edge + (cx + 0.5) * cellSizeM,
      y: ty * edge + (cy + 0.5) * cellSizeM,
      id: `bounty_${victim.id}`,
      amount,
    };
    (entry.coinDrops = entry.coinDrops || []).push(coin);
    return coin;
  }

  // The wheel that BLOCKS things — taps, the body's footsteps, the walk home.
  // An auto-engaged combat wheel is not one of those: the sword picks fights
  // on its own, so if it also froze the character and ate every tap, walking
  // past a slime would lock the game up until the slime died. So it fights in
  // the background and the player keeps playing.
  _busyWheel() {
    const wp = this._workProgress;
    return (wp && !wp.auto) ? wp : null;
  }

  // --- Work-progress wheel (rock-break / tree-chop / fish / defeat / catch) ---
  // `trackCreature` (optional): a moving target (e.g. a deer/crow being hunted)
  // whose position the wheel follows and whose escape ABORTS the action. Unlike
  // startCatchProgress' `flee`, the wheel does NOT drive the creature — its own
  // wander/flee AI does — track just re-anchors the wheel over it and cancels if
  // it slips out of reach. Omit it for static targets (rock / tree / fish).
  startWorkProgress(worldX, worldY, onComplete, durationMs = 3000, energyRefund = 0, toolSlot = null, trackCreature = null) {
    this._setWorkProgressIcon(toolSlot);
    this._barehandMutter?.(toolSlot, worldX, worldY);
    durationMs = Gear.workDurationMs(this.save, durationMs);
    this._workProgress = { worldX, worldY, onComplete, durationMs, energyRefund, startT: performance.now(), track: trackCreature };
  }
  // The grunt a bare-handed job starts with (BAREHAND_MUTTERS), on the job's
  // cell. Answered HERE, beside the badge, for the same reason the badge is:
  // every wheel starter passes its tool slot through startWorkProgress, so no
  // call site can forget it. A slot the player owns at any tier says nothing;
  // so does a wheel with no work tool (a catch, a fight, a dig in a cave wall
  // passes 'pickaxe' and grunts like the rest — the rung is the same).
  _barehandMutter(toolSlot, worldX, worldY) {
    if (!toolSlot || !BAREHAND_MUTTER_TOOLS.includes(toolSlot)) return false;
    if ((this.save?.relics?.[toolSlot]?.tier || 0) > 0) return false;
    if (!this.startWorldM || typeof worldMetersToAbsCell !== 'function') return false;
    const c = worldMetersToAbsCell(this, worldX, worldY);
    const n = this._barehandMutterN = (this._barehandMutterN | 0) + 1;
    this._popCellNumber(BAREHAND_MUTTERS[(n - 1) % BAREHAND_MUTTERS.length], UI_DANGER_INK, c.cellIX, c.cellIY);
    return true;
  }
  // Pick the tool drawn in the MIDDLE of a work-progress wheel: the equipped
  // tier's own art for `toolSlot`, or nothing. Shared by every wheel starter
  // (combat, mine/chop/fish, catch, till, dig, the interactables table).
  //
  // The tool is drawn IN THE CANVAS, by _drawWorkProgress, at the ring's own
  // centre (cx, cy) and at 1:1 game pixels: one coordinate space with the ring
  // is what keeps it in the middle.
  //
  // The texture is fetched on demand (_toolTexture) — gear art is never in the
  // boot preload — and warmed for every equipped wheel tool whenever relics
  // change (updateRelicRow), so it is normally ready before the first swing.
  //
  // BARE HANDS WEAR NO BADGE, and that test lives HERE, once. Every job on
  // this wheel can be done with nothing in hand — that is the tier-0, 9 s rung
  // of toolDurationMs — and the badge's whole job is to say what you are
  // swinging, so an unowned slot must draw NOTHING (no fallback to Wood: a
  // bare-handed catch would show the Bug Net's pale hoop tied to no owned item).
  // Answering it in the shared helper keeps the next wheel starter from
  // forgetting it, and it is the gate _drawWorkProgress
  // share with the badge.
  _setWorkProgressIcon(toolSlot) {
    this._workProgressToolKey = null;
    this._workProgressIcon?.setVisible(false);
    if (!toolSlot) return;
    const tier = this.save.relics?.[toolSlot]?.tier;
    if (!tier) return;
    this._workProgressToolKey = this._toolTexture(toolSlot, tier);
  }
  // Texture key for a wheel tool's art at `tier`, queuing the load the first
  // time it is asked for (null when the slot has no art). Every wheel tool's
  // sheet is 16 px frames with the plain icon on frame 0 — the 32×16 tool
  // sheets and the net's single 16×16 alike — so one framing covers them.
  _toolTexture(slot, tier) {
    const path = gearAssetPath('relic', slot, tier);
    if (!path) return null;
    const key = `wheeltool:${path}`;
    if (!this.textures.exists(key)) {
      this._toolTexQueued = this._toolTexQueued || new Set();
      if (!this._toolTexQueued.has(key)) {
        this._toolTexQueued.add(key);
        this.load.spritesheet(key, path, { frameWidth: 16, frameHeight: 16 });
        this.load.start();
      }
    }
    return key;
  }
  // Clear the wheel WITHOUT refunding energy. Used by the completion path and
  // test helpers — the work actually finished, so the up-front spend was earned.
  // Always releases a fleeing catch target so it resumes normal wandering.
  cancelWorkProgress() {
    if (this._workProgress?.flee) this._workProgress.flee._beingCaught = false;
    this._workProgress = null;
    this._workProgressGfx?.clear();
    this._workProgressIcon?.setVisible(false);
    this._workProgressToolKey = null;
  }
  // Player bailed on an in-flight mine/chop/cast (any tap aborts the wheel).
  // Refund the energy that was charged up-front when the action started, so
  // cancelling costs nothing, then clear. Clamp to max in case energy changed
  // (e.g. offline rest fired while the tab was backgrounded mid-wheel).
  abortWorkProgress() {
    const wp = this._workProgress;
    if (wp && wp.energyRefund > 0) {
      const before = this.save.energy ?? 0;
      Energy.set(this.save, before + wp.energyRefund, this.getMaxEnergy());
      // The spend popped a "−N⚡" on the cell when the wheel started; hand it
      // back on the same cell, or the bar climbing on its own reads as a bug.
      const refunded = this.save.energy - before;
      if (refunded > 0 && typeof worldMetersToAbsCell === 'function' && this.startWorldM && this.originPx) {
        const c = worldMetersToAbsCell(this, wp.worldX, wp.worldY);
        this._popEnergy(refunded, { ix: c.cellIX, iy: c.cellIY });
      }
      this.updateEnergyDOM();
    }
    // Tapping to bail on an underground auto-mine pauses the body's pursuit of
    // the target so the player can do something else; the next steer (GPS fix,
    // stick, keyboard) clears the pause and resumes following.
    if (this._autoMineKey) {
      this._followPaused = true;
      this._autoMineKey = null;
    }
    this.cancelWorkProgress();
  }
  // The visible slash to go with a sword swing — a short arc drawn near the
  // player's chest, swept toward whatever it's engaged with. Player-anchored
  // (drawn about scene.playerScreen() + playerBodyDy(), the body — never the
  // viewport centre) rather than world-anchored, unlike every other
  // combat visual here (shots, health bars): this reads as coming FROM the
  // player, not landing at a world point.
  _drawSwordSwing() {
    const g = this.swordSwingGfx;
    if (!g) return;
    g.clear();
    this._meleeWeaponSprite?.setVisible(false);
    const sw = this._swing;
    if (!sw) return;
    const pose = Render.meleePose(sw, performance.now(), sw.weapon || 'fist');
    if (!pose) { this._swing = null; return; }
    const ps = this.playerScreen();
    const cx = ps.x, cy = ps.y + this.playerBodyDy();
    Render.drawMelee(g, pose, cx, cy);
    if (sw.texture && this.textures.exists(sw.texture)) {
      if (!this._meleeWeaponSprite) {
        this._meleeWeaponSprite = this.add.image(0, 0, sw.texture, 0).setDepth(12);
        this.playerWorldContainer.add(this._meleeWeaponSprite);
        this.playerWorldContainer.sort('depth');
      }
      // The existing icons point northeast, with the grip at bottom-left.
      const handRadius = sw.weapon === 'lance' ? pose.radius * 0.4 : pose.radius - 7;
      const grip = sw.weapon === 'lance' ? 0.25 : 0.3;
      this._meleeWeaponSprite.setTexture(sw.texture, 0).setVisible(true)
        .setOrigin(grip, 1 - grip).setScale(sw.weapon === 'lance' ? 1.7 : 1.3)
        .setPosition(cx + Math.cos(pose.angle) * handRadius,
          cy + Math.sin(pose.angle) * handRadius)
        .setRotation(pose.angle + Math.PI / 4).setAlpha(pose.alpha);
    }
  }

  _drawWorkProgress() {
    // Independent of wp — a killing blow clears _workProgress the instant it
    // lands, and the swing that landed it should still finish its fade rather
    // than being cut off mid-sweep by the early `if (!wp) return` below.
    this._drawSwordSwing();
    const wp = this._workProgress;
    if (!wp) return;
    // A rose can change allegiance while a melee wheel is already running.
    if (wp.combat && (!Combat.isEnemy(wp.combat) || !Gear.meleeActive(this.save))) { this.cancelWorkProgress(); return; }
    const now = performance.now();
    // Stuck-wheel watchdog. A wheel always resolves at wp.durationMs (complete,
    // fail, or cancel), so one that has outlived that by a wide margin is
    // orphaned — e.g. its completion / flee / track code threw (the update loop
    // is kept alive by _reportLoopError, so a per-frame throw won't surface),
    // leaving _workProgress set forever. That makes the interact.js work-progress
    // tap guard swallow EVERY tap, which reads as "taps randomly stopped
    // working". Force-clear it here, at the very top — above the flee/track
    // blocks that might be the thing throwing — so the loop self-heals within a
    // few seconds. Generous +8s margin so a legitimately long bare-hands wheel
    // (9s) is never cut short.
    if (now - (wp.startT || now) > (wp.durationMs || 3000) + 8000) {
      try { console.warn('[wheel] watchdog cleared an orphaned work wheel after',
        Math.round(now - (wp.startT || now)), 'ms (dur', wp.durationMs, ')'); } catch (_) {}
      this.cancelWorkProgress();
      try { this.flash?.('(cleared a stuck action)', this.viewCenterX, this.viewCenterY - 60); } catch (_) {}
      return;
    }
    // Fleeing catch target: it backs away from the player at FLEE_MPS while the
    // wheel runs. If it stays outside the player's reach long enough the catch
    // fails. The wheel anchor (worldX/Y) follows the creature so it stays drawn
    // over it.
    if (wp.flee) {
      const c = wp.flee;
      const dt = Math.min(0.1, (now - (wp._lastT ?? wp.startT)) / 1000);
      wp._lastT = now;
      const px = this.startWorldM.x + this.playerM.x;
      const py = this.startWorldM.y + this.playerM.y;
      let dx = c.x - px, dy = c.y - py;
      let dist = Math.hypot(dx, dy);
      if (dist < 0.001) { dx = 1; dy = 0; dist = 1; }   // degenerate — pick a heading
      // Butterflies bolt 2.7× faster than other fauna while the net wheel runs.
      // Rare shiny animals flee at SHINY_SPEED_MUL too — the same factor as
      // their wander, making them a slippery catch.
      const isButterfly = c.kind === 'butterfly';
      const shinyFast = Combat.shinySpeedMul(c);
      const FLEE_MPS = Math.min(isButterfly ? 5.4 : 2, SpriteLayout.creatureMaxMps(c.kind)) * shinyFast;
      // Moss also conceals the catch: fauna and pets do not flee the net.
      if (!Shrines.leverActive(this.save, 'hidden')) {
        c.x += (dx / dist) * FLEE_MPS * dt;
        c.y += (dy / dist) * FLEE_MPS * dt;
      }
      wp.worldX = c.x; wp.worldY = c.y;
      // Escape: once the animal has been OUTSIDE the player's reach (the lit
      // interaction range — same radius the tap-gate uses) for a continuous
      // grace window, the catch FAILS. Re-entering reach resets the timer.
      // cancelWorkProgress() does NOT refund the up-front energy, so a getaway
      // costs the player the attempt. Normal animals get a 1 s grace;
      // butterflies flee faster but get 2 s, then keep bolting away from the
      // player for 2 minutes (see wanderCreatures' _escapingUntil handling).
      // Out-of-reach uses the SAME lit-cell test as the reach silhouette
      // (coords.js cellInReach) so a catch only fails once the target sits on a
      // visibly-UNLIT cell — measuring raw centre-to-centre distance instead
      // drifted from the lit diamond, failing catches while the animal was
      // still plainly inside the player's lit range.
      const fc = worldMetersToAbsCell(this, c.x, c.y);
      const outOfRange = (typeof cellInReach === 'function')
        ? !cellInReach(this, fc.cellIX, fc.cellIY)
        : ((c.x - px) ** 2 + (c.y - py) ** 2) > (reachRadiusM(this)) ** 2;
      const graceMs = isButterfly ? 2000 : 1000;
      if (outOfRange) {
        wp._outSinceT = wp._outSinceT ?? now;
        if (now - wp._outSinceT >= graceMs) {
          const onFail = wp.onFail;
          if (isButterfly) c._escapingUntil = now + 120000;   // 2 min of post-catch fleeing
          this.cancelWorkProgress();         // clears _beingCaught; keeps energy spent
          if (onFail) onFail();
          return;
        }
      } else {
        wp._outSinceT = null;                // back in reach — reset grace
      }
    }
    // Tracked defeat target (deer / crow / slime hunt): the creature moves under
    // its OWN wander/flee AI, not the wheel. Keep the wheel drawn over it, and
    // abort the hunt if it escapes the player's reach for a short grace window.
    if (wp.track) {
      const c = wp.track;
      wp.worldX = c.x; wp.worldY = c.y;        // follow the target
      // Use the lit-cell test (coords.js cellInReach), identical to the reach
      // silhouette, so a hunt only fails once the target is on a visibly-unlit
      // cell. The old raw centre-to-centre circle was tighter than the lit
      // diamond, so a crow still sitting inside the lit range read as "got
      // away" while it hadn't visually left it.
      const tc = worldMetersToAbsCell(this, c.x, c.y);
      // A FIGHT breaks off at arm's length (Combat.MELEE_REACH_CELLS), a HUNT
      // at the lit reach. Same wheel, two ranges, because they are two things:
      // a crow you are running down stays yours while it is in the light, but
      // a foe that has backed out of swinging distance is no longer being hit
      // — and without this you could engage at one cell and keep landing blows
      // out to five as it walked away.
      const outOfRange = wp.combat
        ? !Combat.inMeleeReach(c.x, c.y,
            this.startWorldM.x + this.playerM.x, this.startWorldM.y + this.playerM.y,
            this.cellM, Gear.activeWeapon(this.save))
        : (typeof cellInReach === 'function')
          ? !cellInReach(this, tc.cellIX, tc.cellIY)
          : ((c.x - (this.startWorldM.x + this.playerM.x)) ** 2
             + (c.y - (this.startWorldM.y + this.playerM.y)) ** 2) > (reachRadiusM(this)) ** 2;
      if (outOfRange) {
        wp._outSinceT = wp._outSinceT ?? now;
        if (now - wp._outSinceT >= 1000) {     // 1 s grace — matches the catch wheel
          const wasAuto = wp.auto;
          this.cancelWorkProgress();
          // An AUTO-engaged sword fight breaks off constantly — you walk, the
          // foe drifts, the reach diamond shrinks as energy drains. That's
          // normal, not a failed hunt, so it says nothing; a hunt or a fight
          // you actually chose still reports the getaway.
          if (!wasAuto && this.flash) this.flashAtWorld('It got away.', c.x, c.y);
          return;
        }
      } else {
        wp._outSinceT = null;
      }
    }
    // COMBAT wheel: the target's HP, not the clock, ends this one. Melee lands
    // as discrete BLOWS at Combat.MELEE_INTERVAL_MS — one interval's worth of
    // the sword's rate each (bare hands at the tier-0 rung) — and bow/staff
    // shots drain the same pool from _damageEnemy, so a fight you started with
    // a swing can be finished by an arrow.
    //
    // The clock is on the SCENE, not the wheel: startCombat re-targets by
    // building a fresh wheel, so a per-wheel clock would let a player flicking
    // between two foes land a blow every frame. It also isn't reset on engage
    // — after any gap longer than the interval it is already due, so the first
    // blow of a fight still lands at once.
    if (wp.combat) {
      const c = wp.combat;
      // Killed by something else mid-swing (a shot, a tame dog) — nothing left
      // to fight, and the kill has already paid out.
      if (this.save.caught?.includes(c.id)) { this.cancelWorkProgress(); return; }
      // EVERY BLOW IS ARM'S LENGTH, not just the one that opened the fight.
      // The three gates above (tap, auto-engage, break-off) all measure
      // Combat.inMeleeReach, but the swing below must check it too: the break-off
      // is a 1 s GRACE (== MELEE_INTERVAL_MS), and a foe hovering ON the boundary
      // resets `_outSinceT` so the grace never ripens. The grace decides whether
      // the FIGHT is still on, this decides whether a swing can LAND.
      // `_nextBlowT` is deliberately NOT advanced when the swing misses: the
      // clock is the scene's, so a foe that closes again is hit at once rather
      // than being granted a fresh interval of safety by having stepped out.
      const px = this.startWorldM.x + this.playerM.x;
      const py = this.startWorldM.y + this.playerM.y;
      const inSwing = Combat.inMeleeReach(c.x, c.y, px, py, this.cellM, Gear.activeWeapon(this.save));
      if (inSwing && now >= this._nextBlowT) {
        this._nextBlowT = now + Combat.meleeIntervalMs(Gear.activeWeapon(this.save), isRiding(this.save)) * Combat.playerAttackIntervalMul(this.save);
        const weapon = Gear.activeWeapon(this.save);
        const equipped = this.save.relics?.[weapon];
        const dx = c.x - px, dy = c.y - py;
        const d = Math.hypot(dx, dy);
        this._swing = { startT: now, dir: d ? { x: dx / d, y: dy / d } : { x: 0, y: 1 },
          weapon: equipped ? weapon : 'fist',
          texture: equipped ? this._toolTexture(weapon, equipped.tier) : null };
        const blow = (Combat.meleeSwingDamage(this.save.relics, this._attackMul(), this.save.playerClass, Gear.activeWeapon(this.save), isRiding(this.save))
          + this._attackFlat('melee')) * PotionEffects.meleeMul(this.save);
        if (this._damageEnemy(c, blow)) return;   // _damageEnemy clears the wheel + pays out
        // A LIT TORCH (isTorchActive) SETS THE FOE ALIGHT — Combat.ignite,
        // the `burning` row of Conditions.DEFINITIONS, as the player's own
        // kill. The blow lands first; the fire takes on what is left.
        if (this.isTorchActive()) Combat.ignite(c, now, 'player');
      }
    }
    const dur = wp.durationMs || 3000;
    const elapsed = now - wp.startT;
    if (!wp.combat && elapsed >= dur) {
      const cb = wp.onComplete;
      this.cancelWorkProgress();
      cb();
      return;
    }
    const progress = elapsed / dur;
    // Static targets (rock / tree / crop / fish / a cave wall) are worked in
    // ONE CELL, and the wheel is centred on that cell — the anchor is snapped
    // to its cell centre and no offset is added. A CREATURE can't use a flat
    // offset: the animals are drawn feet-anchored at wildly different sizes.
    // Wheels over a creature — a capture (wp.flee) or a hunt (wp.track) —
    // follow the animal's own position and are placed by the crown rule
    // (SpriteLayout.creatureWheelDy): the ring rests on the top row of that
    // kind's art, which also clears a fleeing animal by construction.
    const creature = wp.flee || wp.track || null;
    let ax = wp.worldX, ay = wp.worldY;
    if (!creature) {
      const ac = worldMetersToAbsCell(this, ax, ay);
      const cc = absCellCenterMeters(this, ac.cellIX, ac.cellIY);
      ax = cc.x; ay = cc.y;
    }
    const screen = this.worldMetersToScreen(ax, ay);
    const cx = Math.round(screen.x);
    const dyWheel = creature ? SpriteLayout.creatureWheelDy(creature.kind, SpriteLayout.creatureInstScale(creature)) : 0;
    const cy = Math.round(screen.y) + Math.round(dyWheel);
    const g = this._workProgressGfx;
    g.clear();
    // Two readouts, two shapes — deliberately. A WORK wheel is the original
    // ring: the arc FILLS with progress toward finishing the job, seated on
    // the crown. A COMBAT target wears the enemy HEALTH BAR instead — the
    // strip above its head that drains as you hurt it, the same bar every
    // hurt foe floats (_drawEnemyHealthBar), just brighter for the one you
    // are actually engaged with. A fight and a job can't be misread for each
    // other any more; the tool badge below still says what you're swinging.
    if (wp.combat) {
      this._drawEnemyHealthBar(g, cx,
        Math.round(screen.y) + Math.round(SpriteLayout.creatureHealthBarTop(wp.combat.kind, SpriteLayout.creatureInstScale(wp.combat))),
        Combat.hpFraction(wp.combat), 1);
    } else {
      this._strokeWorkRing(g, cx, cy, progress);
    }
    // The tool, dead centre on the ring (see _setWorkProgressIcon). Shown only
    // once its texture has landed; until then the ring runs on its own.
    const key = this._workProgressToolKey;
    const icon = this._workProgressIcon;
    if (icon) {
      if (key && this.textures.exists(key)) {
        if (icon.texture.key !== key) icon.setTexture(key, 0);
        icon.setPosition(cx, cy).setVisible(true);
      } else {
        icon.setVisible(false);
      }
    }
  }

  // Sample a symmetric square neighbourhood around (wcx, wcy) and return the
  // COLOR of the most-common non-road / non-building / non-path cell. Used to
  // tint road cells so the band sits on the surrounding zone.
  //
  // First-hit-in-asymmetric-ring picked DIFFERENT zones for each cell across a
  // wide road, producing visible green/brown stripes where a residential strip
  // ran along one side of the road and grass along the other. Mode of a
  // symmetric radius-3 sample keeps the whole road segment one consistent tint.
  neighborNonRoadColor(wcx, wcy) {
    const t = this.neighborNonRoadType(wcx, wcy);
    return t == null ? null : (COLORS[t] ?? null);
  }

  // The TYPE behind that colour. Polygonal building mode needs the type, not
  // just the colour: a building cell painted as its surrounding zone has to
  // wear that zone's biome TEXTURE too (see the texture pass in render.js), and
  // a colour can't be turned back into a texture key. The sampling — and the
  // memo — live here so both callers see the same answer for a cell.
  streetGroundType(wcx, wcy) {
    // Cave entries may inherit surface metadata; decoration is surface-only.
    if ((this.depth || 0) !== 0) return null;
    const cell = absCellToTile(this, Math.floor(wcx), Math.floor(wcy),
      this._nnScratch || (this._nnScratch = {}));
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
    const ground = entry && !(entry.depth > 0) && entry.streetGround
      && entry.streetGround[cell.iy * cell.n + cell.ix];
    return ground ? ground - 1 : null;
  }

  neighborNonRoadType(wcx, wcy) {
    // Explicit ground wins even if a fallback was cached before tile loading.
    const themed = this.streetGroundType(wcx, wcy);
    if (themed != null) return themed;
    // Memoise the per-cell result (the TYPE — the colour caller derives its
    // colour from it). Terrain is static after a tile loads, so the mode of a
    // 7×7 sample never changes for a given (wcx, wcy). Without
    // this, every road cell did ~48 `tileCache.get(string-key)` lookups +
    // a Map allocation EVERY FRAME — measurable cause of tap-input lag once
    // a viewport had ≥20 road cells. Cache is unbounded by design but each
    // entry is small and only ever-rendered road cells are populated.
    if (!this._neighborZoneCache) this._neighborZoneCache = new Map();
    // (wcx, wcy) is an ABSOLUTE cell (coords.js encoding; a fraction is
    // floored). Its neighbours are walked by POSITION (absCellOffset), and
    // each resolved to its own tile's grid — a 7×7 sample can straddle a row
    // seam whose cells are a different size.
    const cx0 = Math.floor(wcx), cy0 = Math.floor(wcy);
    // (2^23 per axis: an absolute cell index tops out near 16384 * 350 < 2^23,
    // so the key can't alias two cells the way a ×100000 key could.)
    const key = cx0 * 8388608 + cy0;
    const hit = this._neighborZoneCache.get(key);
    if (hit !== undefined) return hit;
    const R = 3;
    // Flat counts array beats Map for ~20-element domains; saves the per-call
    // Map allocation and avoids string keys.
    const counts = new Int16Array(32);
    const scratch = this._nnScratch || (this._nnScratch = {});
    let bestT = -1, bestN = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = absCellOffset(this, cx0, cy0, dx, dy);
        const c3 = absCellToTile(this, nc.cellIX, nc.cellIY, scratch);
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(c3.tx, c3.ty));
        if (!entry || !entry.grid) continue;
        const t = entry.grid[c3.iy * c3.n + c3.ix] || 0;
        // Skip roads (any tier), path, and buildings — those are overlays.
        if (t === 7 || t === 8 || t === 13 || t === 14 || t === 9 || t === 11 || t === 12) continue;
        const c = ++counts[t];
        if (c > bestN) { bestN = c; bestT = t; }
      }
    }
    const out = bestT === -1 ? null : bestT;
    // Don't memoise a "no neighbour found" — the surrounding tiles may load
    // moments later and we'd be stuck with a bad result. Only cache once we
    // sampled at least one valid neighbour.
    if (bestN > 0) this._neighborZoneCache.set(key, out);
    return out;
  }

  // === Drawing ===
  // Bodies live in render.js. These thin forwarders preserve the existing
  // call-site shape (this.drawCells, this.drawObjects, this.renderPool,
  // this.worldMetersToScreen, this.screenToWorldMeters) for the update loop,
  // interact.js, and test/tests.js -- behaviour is bit-identical.
  drawCells() {
    const B = window.__boot;
    if (!B) return Render.drawCells(this);
    const t0 = performance.now();
    Render.drawCells(this);
    const dt = performance.now() - t0;
    B.tick('drawCells', dt);
    // Border geometry, the biome-seam wave and the atmosphere resample all
    // gate on borderDirty INSIDE this same pass rather than as separable
    // calls (see the borderDirty comment in render.js), so they can't be
    // ticked apart without splitting the cell-paint loop itself. A second
    // tick under a different label, over the SAME measured span, still
    // answers "how much extra does the crossing frame cost here" —
    // this._boot_crossing was just stamped by the Render.drawCells call above.
    if (this._boot_crossing) B.tick('drawCells @crossing', dt);
  }
  drawRoadGeometry() {
    if (typeof RoadOverlay === 'undefined') return;
    RoadOverlay.draw(this);
    // …and then the live pass on top of it: the dwell preview and the shine,
    // re-stroked every frame — both switched off today, so this clears the
    // Graphics and draws nothing (see _drawStreetLive). AFTER draw(), because
    // draw() is what positions the container the live Graphics sits in.
    this._drawStreetLive();
    // …and WHICH lamps a restored street carries, on the surface it just drew.
    // Here rather than in the sweep because this runs on every frame the road
    // is drawn on — including the ones the sweep's gates refuse — and because
    // the list it refreshes has two readers a moment later in drawObjects: the
    // sprite pass that DRAWS each lamp (render.js RENDER_SPEC._streetlamp — a
    // lamp stands on the ground, so it sorts by screen row with every other
    // standing thing) and Lighting.collectLamps, which lights the lit ones.
    this._updateStreetLamps();
  }
  drawBuildingGeometry() { if (typeof BuildingOverlay !== 'undefined') BuildingOverlay.draw(this); }
  drawObjects() {
    const B = window.__boot;
    if (!B) return Render.drawObjects(this);
    const t0 = performance.now();
    Render.drawObjects(this);
    // Lighting.draw runs at the tail of the same pass and times itself
    // (scene._boot_lightMs, ticked as 'lighting'); take it back out so the
    // two rows are the scan and the lightmap, not the scan and scan+map.
    B.tick('drawObjects', performance.now() - t0 - (this._boot_lightMs || 0));
  }
  renderPool(pool, container, list, configure) { Render.renderPool(this, pool, container, list, configure); }
  worldMetersToScreen(wmx, wmy) { return worldMetersToScreen(this, wmx, wmy); }
  screenToWorldMeters(sx, sy) { return screenToWorldMeters(this, sx, sy); }

  // === The PEEK DRAG ======================================================
  // Drag the map to look a little way past the edge of the viewport, let go and
  // it springs back. The character is not a camera mount: the map is a small
  // window and half of "where do I go next" lives just outside it.
  //
  // It is a CAMERA offset (this.peekM, metres, player→camera) and nothing else.
  // playerM never moves, so reach, the tap gates, fog reveal and tile loading
  // all still measure from the body — peeking at a crate three cells away and
  // tapping it correctly says "too far", exactly as it would with the crate on
  // screen at the same distance. Everything that DRAWS goes through
  // coords.js viewAnchorWorldM / viewAnchorCell, which add this offset.
  //
  // The drawn window re-anchors with the camera, so a peek costs nothing: the
  // same 11×11 pass paints a different patch of ground. The cap is what keeps
  // it honest — PEEK_MAX_CELLS stays well inside the loaded 3×3 tile
  // neighbourhood every world pass scans (a tile is hundreds of cells wide).

  // Player's screen position. The camera normally sits on them, so this is the
  // viewport centre; a peek slides them off it by the drag. Everything drawn AT
  // the player rather than at a world position (the sprite and its shadow /
  // halo / arrow / swing) reads its centre from here — never viewCenterX/Y.
  // A looping animation over [start, end] or an explicit frame list — or
  // NONE, when that sheet has no frames to give (it failed to load even after
  // preload's one retry). Phaser builds an animation with an empty frame list
  // happily and then throws the moment anything plays it (getFirstTick reads
  // frames[0].duration), which killed the whole boot on the player's
  // idle-down. A missing key, by contrast, is a no-op in play(): the sprite
  // keeps whatever frame it has. So a sheet that is not there costs its art,
  // never the game.
  _createAnim(key, texKey, start, end, frameRate) {
    const frames = this.textures.exists(texKey)
      ? this.anims.generateFrameNumbers(texKey, Array.isArray(start) ? { frames: start } : { start, end }) : [];
    if (!frames.length) {
      console.warn(`animation ${key}: sheet ${texKey} has no frames — not created`);
      return false;
    }
    this.anims.create({ key, frames, frameRate, repeat: -1 });
    return true;
  }

  playerScreen() {
    const k = CELL_PX / this.cellM;
    return {
      x: this.viewCenterX - this.peekM.x * k,
      y: this.viewCenterY - this.peekM.y * k,
    };
  }

  // How far the BODY's centre sits from the ground point its feet stand on —
  // the one number everything hung on the sprite's centre reads (the sprite
  // itself, the warning halo behind it, the powder countdowns over its head).
  // Standing it is playerFeetNudgeY, which lifts the frame so the visible feet
  // land on the fix; collapsed it is 0, because a body lying down has its
  // midsection where its feet were (see PLAYER_DOWNED_ROTATION).
  playerBodyDy() {
    return Combat.playerDowned(this.save.energy) ? 0
      : this.playerFeetNudgeY - (this._obstacleStep?.liftPx || 0);
  }

  // …and which way up it is. Same read, so the seat and the turn can never
  // disagree about whether the player is on their feet.
  playerBodyRotation() {
    return Combat.playerDowned(this.save.energy) ? PLAYER_DOWNED_ROTATION : (this._obstacleLean || 0);
  }

  // Render supplies the same surviving props it draws, including connected
  // wall/hedge frames. Height is spatial: stopping or reversing never runs
  // down a hop timer. Only the balancing lean settles with elapsed time.
  _updateObstacleStep(objects) {
    if (typeof ObstacleStep === 'undefined' || !this.startWorldM || !this.playerM) return;
    const now = performance.now(), x = this.startWorldM.x + this.playerM.x,
      y = this.startWorldM.y + this.playerM.y;
    const prev = this._obstaclePoseAt;
    const dt = prev ? Math.max(0.001, Math.min(0.1, (now - prev.time) / 1000)) : 1 / 30;
    const distance = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;
    this._obstaclePoseAt = { x, y, time: now };
    this._obstacleStep = ObstacleStep.sample(x, y,
      Combat.playerDowned(this.save.energy) ? [] : objects, this.cellM);
    const moved = distance < this.cellM ? distance : 0; // no lean from teleports
    this._obstaclePhase = (this._obstaclePhase || 0) + moved / this.cellM;
    const motion = Math.min(1, moved / dt / WALK_M_S);
    this._obstacleMotion = (this._obstacleMotion || 0)
      + (motion - (this._obstacleMotion || 0)) * (1 - Math.exp(-dt / 0.12));
    this._obstacleLean = ObstacleStep.balance(this._obstaclePhase,
      this._obstacleMotion * Math.min(1, this._obstacleStep.liftPx / 6));
    const ps = this.playerScreen();
    this.player?.setPosition(ps.x, ps.y + this.playerBodyDy()).setRotation(this.playerBodyRotation());
    if (this.playerHalo?.visible) this.playerHalo.setPosition(ps.x, ps.y + this.playerBodyDy());
  }

  // A Phaser pointer's position in LOGICAL px (coords.js gamePt), at this
  // canvas's RENDER_SCALE. The scene method stays because every pointer
  // handler reads it as this._gamePt(p) and peek_drag.test.js drives it there.
  _gamePt(p) {
    return gamePt(p, RENDER_SCALE);
  }

  // Is the camera off the player right now (drag live, or still springing back)?
  isPeeking() {
    return this.peekM.x !== 0 || this.peekM.y !== 0;
  }

  // Set the peek from a drag delta in SCREEN pixels — the finger drags the
  // ground, so the camera moves the other way — clamped to a disc of
  // PEEK_MAX_CELLS so no drag can outrun the loaded world.
  _setPeekFromDrag(dxPx, dyPx) {
    const k = this.cellM / CELL_PX;
    let mx = -dxPx * k, my = -dyPx * k;
    const telescope = carriesItem(this.save, 'field_scope') || Energy.dawnfruitActive(this.save);
    const maxM = PEEK_MAX_CELLS * this.cellM
      / (telescope ? 1 : CARRIED_ITEM_SPEC.field_scope.peekMultiplier);
    const mag = Math.hypot(mx, my);
    if (mag > maxM) { mx = mx / mag * maxM; my = my / mag * maxM; }
    this.peekM.x = mx;
    this.peekM.y = my;
  }

  // Let go and the camera slides home. Eased per frame rather than tweened so
  // it survives a dropped pointerup (see the stuck-touch sweeper) and can be
  // cut short by the next drag without leaving a tween fighting the finger.
  _releasePeek() {
    this._peekDragging = false;
    this._peekPointerId = null;
    this._peekPointer = null;
    if (this.isPeeking()) this._peekReturning = true;
  }

  // Snap the camera back to the player at once, no spring. Used when something
  // OTHER than the drag has moved the view's meaning — a teleport, a descent,
  // a modal taking the screen.
  clearPeek() {
    this._peekDragging = false;
    this._peekPointerId = null;
    this._peekPointer = null;
    this._peekReturning = false;
    if (!this.peekM) return;      // called before the view was set up
    this.peekM.x = 0;
    this.peekM.y = 0;
  }

  // Per-frame spring-back. Exponential ease (frame-rate independent), with a
  // sub-pixel floor so it lands exactly on zero instead of creeping.
  _tickPeek(dt) {
    if (!this._peekReturning) return;
    const k = Math.exp(-dt / (PEEK_RETURN_MS / 1000));
    this.peekM.x *= k;
    this.peekM.y *= k;
    const snapM = 0.5 * (this.cellM / CELL_PX);       // half a screen pixel
    if (Math.abs(this.peekM.x) < snapM && Math.abs(this.peekM.y) < snapM) {
      this.peekM.x = 0;
      this.peekM.y = 0;
      this._peekReturning = false;
    }
  }
  // === Interaction ===
  // Dispatch lives in interact.js as a flat TAP_HANDLERS priority array;
  // this method just forwards to it.
  // A PASSENGER TAPS NOTHING (isTooFast): no pickup, no harvest, no chest at a
  // ride's pace — the one gate in front of every world tap.
  handleWorldTap(sx, sy) {
    if (this.isTooFast?.()) { this.flash('Too fast — on foot only.', sx, sy); return; }
    interactTap(this, sx, sy);
  }

  // === Coin-burst (the pot of gold — an ATM) ==============================
  // Once per UTC day per pot: the day ledger (Macros.usedToday / markToday —
  // save.coinBurstClaimed[<poiId>YYYYMMDD]); subsequent taps within the same
  // day flash a hint and spawn no coins. Coins themselves are in-memory only
  // (entry.coinDrops); only the ledger persists.
  _coinBurstInteract(sx, sy, poi) {
    const dayKey = utcDayKey();
    const ctx = { scene: this, save: this.save, sx, sy, dirty: false };
    const row = Macros.visitKindForObject(poi) || Macros.DAILY_VISIT_KINDS.gold;
    const visit = Macros.beginDailyVisit(ctx, poi, { row });
    if (!visit) return;

    // Find walkable cells within ~25m of the POI on the POI's host tile.
    // We restrict to the POI's home tile (cells_per_edge × cells_per_edge)
    // — the burst radius is ~5 cells at 5m/cell which fits inside one tile
    // for almost every POI placement, and saves us a multi-tile scan.
    const tileEdgeM = this.tileEdgeM;
    // The POI's tile and its cell on that tile's own grid (coords.js — the
    // same conversion every tap gate uses, never floor(metres / cellM)).
    const { tx, ty, ix: poiLocalCX, iy: poiLocalCY } = worldMetersToTileCell(this, poi.x, poi.y);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry || !entry.grid) {
      // Tile evicted between render and tap — shouldn't happen since the
      // chest sprite is in view, but bail rather than crash.
      this.flash('...', sx, sy);
      visit.finish();
      return;
    }
    // The host tile's OWN grid (its row's N) and its cell size in the frame.
    const N = entry.cellsPerEdge || rowCells(this, ty);
    const cellM = tileEdgeM / N;
    const RADIUS_CELLS = Math.max(2, Math.ceil(25 / cellM));   // ~5 cells at 5m
    const MAX_BURST_CELLS = RADIUS_CELLS * 3;                  // ~75 m, the escalated reach
    // Scatter only on legitimate spawn cells: walkable, off-road, and not deep
    // in a private yard. WorldGen.isSpawnCell is the single source of truth,
    // shared with the X-mark scatter above. This burst is centred on a POI, so
    // pass it as a public anchor — residential cells right around the chest are
    // fair game even if no road is within frontage.
    //
    // The road mask is only HALF of "don't spawn here" (CLAUDE.md's spawn
    // rule): the other half is opts.occupied, the Set of cells a tree, rock or
    // wildplant already claimed at rasterize time. spawnInTile builds that Set
    // ONCE per tile and stashes it on entry._spawnOpts.occupied precisely so
    // later passes (traps' per-frame tick, and now this burst) can reuse it
    // instead of re-scanning entry.objects/wildplants — the cave coin pass in
    // spawnCaveCreatures already guards this exact case ("a coin under a rock
    // sprite reads as a rock"). A burst can in principle fire on a tile whose
    // spawn pass hasn't run yet (the chest sprite is drawn from `entry.objects`
    // alone, which exists before `_spawned`), so fall back to no occupancy
    // check rather than crash on a missing entry._spawnOpts.
    const occupiedIdx = (entry._spawnOpts && entry._spawnOpts.occupied) || null;
    const burstOpts = { roadMask: entry.roadMask, quiet: entry.quietMask, spawnWhy: entry.spawnWhy,
      roadClass: entry.roadClass, occupied: occupiedIdx, pois: [{ ix: poiLocalCX, iy: poiLocalCY }] };
    // Cells within `r` that will take a coin: the shared spawn rule (the pot
    // itself is the public anchor, so the cells right round it pass the
    // frontage test) and the player's side of any major road. No relaxed
    // pass: a burst in a tight spot is a smaller burst, never a coin in the
    // street or in somebody's garden.
    const gather = (r) => {
      const out = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = poiLocalCX + dx, cy = poiLocalCY + dy;
          if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
          // Skip the POI's own cell (chest sprite sits there).
          if (dx === 0 && dy === 0) continue;
          if (!WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, burstOpts, 'attractor')) continue;
          if (WorldGen.privateVetoAt(tx, ty, cx, cy)) continue;
          if (!sameSideAs(this, tx * tileEdgeM + (cx + 0.5) * cellM, ty * tileEdgeM + (cy + 0.5) * cellM)) continue;
          out.push({ cx, cy });
        }
      }
      return out;
    };
    // KEEP LOOKING UNTIL THERE IS A BURST TO SCATTER: widen the ring (the same
    // rule) out to MAX_BURST_CELLS.
    let candidates;
    if (row.fillScreen) {
      // The reef fills the visible ground across tile seams. Each tile keeps
      // its own grid, occupancy and access rules; unopened tiles add nothing.
      candidates = [];
      const anchor = viewAnchorWorldM(this), half = VIEW_CELLS / 2 * cellM;
      const center = worldMetersToTileCell(this, anchor.x, anchor.y);
      eachTile3x3(center.tx, center.ty, (coinTX, coinTY) => {
        const coinEntry = WorldGen.tileCache.get(WorldGen.tileKey(coinTX, coinTY));
        if (!coinEntry?.grid) return;
        const coinN = coinEntry.cellsPerEdge || rowCells(this, coinTY), unit = tileEdgeM / coinN;
        const x0 = coinTX * tileEdgeM, y0 = coinTY * tileEdgeM;
        const occupied = new Set(coinEntry._spawnOpts?.occupied || []);
        for (const coin of coinEntry.coinDrops || []) if (coin.expiresAt > Date.now())
          occupied.add(Math.floor((coin.y - y0) / unit) * coinN + Math.floor((coin.x - x0) / unit));
        const opts = { roadMask: coinEntry.roadMask, quiet: coinEntry.quietMask,
          spawnWhy: coinEntry.spawnWhy, roadClass: coinEntry.roadClass, occupied,
          pois: coinTX === tx && coinTY === ty ? [{ ix: poiLocalCX, iy: poiLocalCY }] : undefined };
        const minX = Math.max(0, Math.ceil((anchor.x - half - x0) / unit - .5));
        const maxX = Math.min(coinN - 1, Math.floor((anchor.x + half - x0) / unit - .5));
        const minY = Math.max(0, Math.ceil((anchor.y - half - y0) / unit - .5));
        const maxY = Math.min(coinN - 1, Math.floor((anchor.y + half - y0) / unit - .5));
        for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
          if (coinTX === tx && coinTY === ty && cx === poiLocalCX && cy === poiLocalCY) continue;
          if (!WorldGen.isSpawnCell(coinEntry.grid, coinN, coinN, cx, cy, opts, 'attractor')) continue;
          if (WorldGen.privateVetoAt(coinTX, coinTY, cx, cy)) continue;
          const x = x0 + (cx + .5) * unit, y = y0 + (cy + .5) * unit;
          if (!sameSideAs(this, x, y)) continue;
          candidates.push({ cx, cy, tx: coinTX, ty: coinTY, entry: coinEntry, x, y });
        }
      });
    } else candidates = gather(RADIUS_CELLS);
    // The burst: its size off the pot's density on its tile (potCoinsFor),
    // a few of them (a quarter at most) at the player's feet, the rest
    // scattered round the pot.
    const burstN = row.fillScreen ? candidates.length : potCoinsFor(poi.poiDensity);
    const nearN = row.fillScreen ? 0 : Math.min(COIN_BURST_NEAR_PLAYER, Math.floor(burstN / 4));
    const scatterN = burstN - nearN;
    for (let r = RADIUS_CELLS + 2; candidates.length < scatterN && r <= MAX_BURST_CELLS; r += 2) {
      candidates = gather(r);
    }
    // Constrain to the visible SCREEN AREA — coins may sit right at its edge,
    // never past it. The widen/relax escalation above can reach out to
    // MAX_BURST_CELLS (3x the spec'd ~25m) when a suburb has too few
    // legitimate spawn cells nearby, and a coin placed out there is invisible
    // for its whole 60s life: the player tapped something ON SCREEN, so
    // "Scattered N coins!" has to mean coins they can actually walk over to.
    // viewAnchorWorldM is the camera anchor every screen projection in
    // render.js measures from (coords.js) — the same point a coin's sx/sy is
    // computed against — so filtering against it (not the POI) is what
    // actually matches what's on screen.
    const anchor = viewAnchorWorldM(this);
    const screenHalfM = (VIEW_CELLS / 2) * cellM;
    if (!row.fillScreen) candidates = candidates.filter(({ cx, cy }) => {
      const wx = tx * tileEdgeM + (cx + 0.5) * cellM;
      const wy = ty * tileEdgeM + (cy + 0.5) * cellM;
      return Math.abs(wx - anchor.x) <= screenHalfM && Math.abs(wy - anchor.y) <= screenHalfM;
    });
    // Sort the (now on-screen) candidates nearest-to-the-POI-first so the
    // burst still reads as clustered on the chest the player just tapped,
    // rather than an even spread across the whole visible screen.
    candidates.sort((a, b) => {
      if (row.fillScreen) return 0;
      const da = (a.cx - poiLocalCX) ** 2 + (a.cy - poiLocalCY) ** 2;
      const db = (b.cx - poiLocalCX) ** 2 + (b.cy - poiLocalCY) ** 2;
      return da - db;
    });
    const n = Math.min(scatterN, candidates.length);
    // Shuffle only the near buffer we're actually drawing coins from, so the
    // exact cells still vary run to run without reaching past it for cells
    // near the far edge of the search box.
    const pool = shuffleInPlace(candidates.slice(0, Math.max(n, scatterN * 2)));
    // Where each coin lands: { entry, x, y } — the pot's scatter on the pot's
    // tile, then the rest of the burst at the player's feet (nearN, plus
    // whatever the scatter could not seat).
    const drops = [];
    const taken = new Set();
    for (let i = 0; i < n; i++) {
      const cell = pool[i], { cx, cy } = cell;
      const x = cell.x ?? tx * tileEdgeM + (cx + 0.5) * cellM;
      const y = cell.y ?? ty * tileEdgeM + (cy + 0.5) * cellM;
      taken.add(`${cell.tx ?? tx}_${cell.ty ?? ty}_${cx}_${cy}`);
      drops.push({ entry: cell.entry || entry, x, y });
    }
    if (!row.fillScreen) for (const d of this._coinCellsNearPlayer(burstN - n, COIN_BURST_NEAR_R, taken)) drops.push(d);
    // NOTHING SEATED, NOTHING SPENT. The day's claim is written only once a
    // coin will actually land: "No room to scatter!" used to fire AFTER the
    // coin will actually land: a pot in a tight spot (or tapped with the view
    // peeked away) must not eat the day's burst and pay nothing.
    if (drops.length === 0) {
      this.flash('No room to scatter!', sx, sy);
      visit.finish();
      return;
    }
    // The ledger's one writer (it prunes takes older than a week).
    visit.claim();
    if (typeof persistSave === 'function') persistSave(this.save);
    const expiresAt = Date.now() + COIN_BURST_LIFE_MS;
    drops.forEach((d, i) => {
      d.entry.coinDrops = d.entry.coinDrops || [];
      d.entry.coinDrops.push({ kind: 'coindrop', x: d.x, y: d.y, id: `coin_${poi.id}_${dayKey}_${i}`, expiresAt });
    });
    this.flashLoot(`Scattered ${drops.length} coins!`, '#ffe066', 1, null, this.coinIconEl());
    visit.present();
  }

  // Up to `count` coin cells around the PLAYER's feet (never the feet cell
  // itself), within `r` cells, nearest ring first: the shared spawn rule (off
  // the road band, under nothing, no private yard) on the player's side of any
  // major road — the pot scatter's rule. On the tile
  // the player stands on, in that tile's own grid. `taken` holds cells
  // already used ("tx_ty_cx_cy"). Returns [{ entry, x, y }].
  _coinCellsNearPlayer(count, r, taken) {
    const out = [];
    if (count <= 0) return out;
    const tileEdgeM = this.tileEdgeM;
    const wx = this.startWorldM.x + this.playerM.x, wy = this.startWorldM.y + this.playerM.y;
    const { tx, ty, ix: pcx, iy: pcy } = worldMetersToTileCell(this, wx, wy);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry || !entry.grid) return out;
    const N = entry.cellsPerEdge || rowCells(this, ty);
    const cellM = tileEdgeM / N;
    const opts = { roadMask: entry.roadMask, quiet: entry.quietMask, spawnWhy: entry.spawnWhy,
      occupied: (entry._spawnOpts && entry._spawnOpts.occupied) || null };
    for (let ring = 1; ring <= r && out.length < count; ring++) {
      const cells = [];
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const cx = pcx + dx, cy = pcy + dy;
          if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
          if (!WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, opts, 'minor')) continue;
          if (WorldGen.privateVetoAt(tx, ty, cx, cy)) continue;
          if (!sameSideAs(this, tx * tileEdgeM + (cx + 0.5) * cellM, ty * tileEdgeM + (cy + 0.5) * cellM)) continue;
          if (taken.has(`${tx}_${ty}_${cx}_${cy}`)) continue;
          cells.push({ cx, cy });
        }
      }
      shuffleInPlace(cells);
      for (const { cx, cy } of cells) {
        if (out.length >= count) break;
        taken.add(`${tx}_${ty}_${cx}_${cy}`);
        out.push({ entry, x: tx * tileEdgeM + (cx + 0.5) * cellM, y: ty * tileEdgeM + (cy + 0.5) * cellM });
      }
    }
    return out;
  }

  // --- Movement collision & level transitions ---
  // True if the cell at world point (wmx,wmy) is a solid cave wall. Unloaded
  // cells return false so the player is never trapped at a tile seam mid-load.
  //
  // The SURFACE has no movement collision at all. WorldGen.isWalkable answers a
  // different question up here — "may a person legally stand on this cell",
  // which excludes every road tier and water, and is what gates loot/spawn
  // placement. The player has always been free to walk over roads and rivers
  // (they're really out there doing it), so feeding that predicate to the
  // follow step would wall the body in behind the nearest street.
  // A cast that hooks a slime (interact.js fishing): seat it beside the
  // player's FEET, angry. See fishedSlimeSpawn.
  spawnFishedSlime() {
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    return fishedSlimeSpawn(this, performance.now(), px, py, this.playerToWorldCell());
  }
  _cellBlocked(wmx, wmy) {
    if (this.depth === 0) return false;
    const c = this.cellAt(wmx, wmy);
    if (!c.loaded) return false;
    return !WorldGen.isWalkable(c.type);
  }
  // Mine a blocking cave wall into walkable floor. Mutates the live tile grid
  // (so collision + rendering update at once) and records the dug cell so the
  // passage is re-opened whenever this tile is regenerated (_applyDugWalls).
  digCaveWall(tx, ty, ix, iy, cellIX, cellIY) {
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (entry && entry.grid) entry.grid[iy * entry.cellsPerEdge + ix] = 24;   // CAVE_FLOOR
    this.dugWallSet.add(`${this.depth}:${cellKeyFromAbsCell(cellIX, cellIY)}`);
  }
  // Re-apply previously-dug walls to a freshly (re)generated cave tile's grid.
  // Cave tiles are derived from the surface on demand, so a dug-out cell would
  // otherwise come back as solid rock after the tile is evicted and reloaded.
  _applyDugWalls(entry, tx, ty) {
    if (!entry || !entry.grid || !this.dugWallSet.size) return;
    const N = entry.cellsPerEdge;
    const prefix = `${entry.depth}:`;
    const scratch = {};
    for (const k of this.dugWallSet) {
      if (!k.startsWith(prefix)) continue;
      const coord = k.slice(prefix.length);          // "absIX_absIY"
      const us = coord.indexOf('_');
      const aix = parseInt(coord.slice(0, us), 10);
      const aiy = parseInt(coord.slice(us + 1), 10);
      // Absolute → this tile's own cell (coords.js; the rows' grids differ).
      const t = absCellToTile(this, aix, aiy, scratch);
      if (t.tx !== tx || t.ty !== ty) continue;
      const ix = t.ix, iy = t.iy;
      if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
      const idx = iy * N + ix;
      if (entry.grid[idx] === 25) entry.grid[idx] = 24;   // CAVE_WALL → CAVE_FLOOR
    }
  }
  // === Target-follow movement (every depth) ===
  // ONE movement model, surface and cave alike: nothing drives the body
  // directly. A TARGET point moves — the GPS fix up top, the player's steering
  // input either way — and the body walks toward it. Underground the target
  // floats free through rock and the body mines what blocks it; on the surface
  // _cellBlocked is always false, so the same code degrades to a plain walk and
  // the mining branches can never fire.
  //
  // Steer the target by an input velocity (the keyboard). The target
  // ignores walls entirely — it's just a point the body heads toward. Any steer
  // clears the auto-mine pause so pursuit resumes.
  _steerTarget(vx, vy, speedMul, dt) {
    if (!this._targetM) this._targetM = { x: this.playerM.x, y: this.playerM.y };
    if (!vx && !vy) return;
    const n = Math.hypot(vx, vy);
    this._targetM.x += (vx / n) * WALK_M_S * speedMul * dt;
    this._targetM.y += (vy / n) * WALK_M_S * speedMul * dt;
    this._followPaused = false;
    if (this.compassDeg == null) this.facing = { x: vx, y: vy };
  }
  // Snap the walk target onto the body and drop any pause. Call after ANY warp
  // that moves playerM without the body having walked there — teleport presets,
  // taking a staircase, a dragon landing. Also drops the stick's manual offset:
  // after a warp there's no "how far I walked off the GPS" left to honour, and
  // keeping it would just walk the player straight back off the new spot.
  // Without this the stale target survives the warp and the body walks back.
  syncMoveTarget() {
    // A peek is a look at the ground AROUND YOU; after a warp that ground is
    // somewhere else, so the camera snaps back onto the body rather than
    // spring-easing across a view that has nothing to do with the old one.
    this.clearPeek();
    this._targetM = { x: this.playerM.x, y: this.playerM.y };
    this._manualOffsetM = { x: 0, y: 0 };
    this._steerDistAccrue = 0;
    this._steerCostAccrue = 0;
    this._followPaused = false;
    this._detourHold = null;   // a side of a wall back where the body was
  }
  // Place the body ON the GPS fix — the "too far to walk" answer shared by a
  // jumped fix (the GPS watcher) and the walk home (_driftHome), so the two
  // sides can't drift apart on what a placement does. The caller owns the
  // target and the stick offset (the fix path zeroes the offset and re-targets
  // the fix; the drift calls syncMoveTarget). Underground the placement also
  // carves the landing cell: a snap into solid rock would leave the character
  // standing inside a wall, which was the reason both snaps were surface-only
  // until Sep 2026 — and why the walk home never ran in a cave at all.
  _placeBodyOnFix() {
    if (Conditions.active(this.save, 'confused') || this._confusedRecover) return;
    this.playerM.x = this.gpsM.x;
    this.playerM.y = this.gpsM.y;
    this._carveLanding();
  }
  // THE CUT — wraps a "place the body outright" moment (see _placeBodyOnFix)
  // in the transition described at TELEPORT_FADE_OUT_MS above: a burst where
  // the player is currently standing, fade to black, `place()` runs hidden
  // behind the black (so it can do whatever a caller needs — placement,
  // re-targeting — in whatever order that caller already does it), then fade
  // back in on wherever `place` left the body. `_teleporting` guards re-entry:
  // both call sites re-check their own gap every frame, and the gap is still
  // "too far" for the whole 2 s the cut takes — re-entry is a no-op (the cut
  // already under way owns the eventual placement), never a second fade
  // stacked on the first.
  // Falls back to running `place` immediately when there's no camera to fade
  // (headless tests, a stub scene) — the cut is a courtesy, not a dependency.
  _teleportCut(place) {
    const cam = this.cameras?.main;
    if (!cam || typeof cam.fadeOut !== 'function') { place(); return; }
    if (this._teleporting) return;
    this._teleporting = true;
    const p = this.playerScreen();
    this._burstAt('shiny', p.x, p.y);
    cam.fadeOut(TELEPORT_FADE_OUT_MS, 0, 0, 0);
    cam.once('camerafadeoutcomplete', () => {
      place();
      cam.fadeIn(TELEPORT_FADE_IN_MS, 0, 0, 0);
      this._teleporting = false;
    });
  }
  // Dig out the cave-wall cell under the player's feet, if that is what they
  // are standing in. Called after a placement underground, and again from the
  // tile loader for each cave tile that arrives, because the tile under a
  // placed body is very often NOT loaded yet (that is what "too far" means) —
  // its cell reads as open until the grid lands, and lands as rock. Recorded
  // through digCaveWall like any other dig, so the pocket survives a rebuild.
  // No-op on the surface, on an unloaded cell, and on anything but a wall.
  _carveLanding(onlyTile = null) {
    if (!(this.depth > 0)) return;
    const c = this.cellAt(this.startWorldM.x + this.playerM.x,
                          this.startWorldM.y + this.playerM.y + this.feetOffsetM);
    if (onlyTile && (c.tx !== onlyTile.tx || c.ty !== onlyTile.ty)) return;
    if (!c.loaded || c.type !== 25 /* CAVE_WALL */) return;
    this.digCaveWall(c.tx, c.ty, c.ix, c.iy, c.cellIX, c.cellIY);
  }
  // How far the character is standing from the player's REAL position, in
  // metres. That gap is what stick walking buys and what the map's warnings are
  // about: cheap steering close to home, a darkening character further out, and
  // the walk back when you let go. Measured body-to-fix when there's a fix; with
  // no GPS at all the accumulated stick offset is the only notion of "away".
  _gpsAwayM() {
    if (this.gpsM) {
      return Math.hypot(this.playerM.x - this.gpsM.x, this.playerM.y - this.gpsM.y);
    }
    const o = this._manualOffsetM;
    return Math.hypot(o.x, o.y);
  }
  // Has the player been walked OFF their real position by hand? A GPS fix to
  // be away from, and either the stick's banked offset past
  // Combat.OFF_GPS_MIN_CELLS or the keyboard's session-long manual override.
  // With no fix at all there is nothing to be away from, so no penalty. The
  // offset drains back as the body walks home (_driftHome), so the penalty
  // lifts on its own once you let go and it arrives.
  _offGps() {
    if (!this.gpsM) return false;
    if (this._gpsManualOverride) return true;
    const o = this._manualOffsetM;
    return !!o && Math.hypot(o.x, o.y) > Combat.OFF_GPS_MIN_CELLS * this.cellM;
  }
  // The multiplier on the player's OWN attacks (melee wheel, bow, staff):
  // Dragon Powder doubles them, being off the GPS takes a third off
  // (Combat.OFF_GPS_ATTACK_MUL). One answer both attack paths read.
  _attackMul() {
    return (this.isDragonActive() ? CONSUMABLE_SPEC.dragon_powder.damageMul : 1)
      * (this._offGps() ? Combat.OFF_GPS_ATTACK_MUL : 1);
  }
  // The FLAT damage a hit of the player's own carries on top, after
  // _attackMul — its own attack type's training ('melee' a blow, 'ranged' an
  // arrow, 'magic' a bolt; Combat.trainingBonus). One answer every attack
  // path reads, by type. Giant adds its flat bonus to melee blows.
  _attackFlat(kind) {
    const training = Combat.TRAINING_KINDS[kind]?.unit === 'dmg' ? Combat.trainingBonus(this.save, kind) : 0;
    const giant = kind === 'melee' ? PotionEffects.meleeBonus(this.save) : 0;
    return training + giant;
  }
  // Is the stick actually being PUSHED right now? Pointer-down alone isn't
  // enough — a finger resting on a centred nub holds _movePadHeld true while
  // steering nothing, and treating that as steering would animate the player
  // walking on the spot.
  _stickPushed() {
    const v = this.joystickVec;
    return !!(this._movePadHeld && v && (v.x || v.y));
  }
  // Boots set walking speed and cost. Dragon and Speed lend tiers to both;
  // coffee adds speed tiers only; a bike rack multiplies speed (boots.boost).
  _walkRelics() {
    let speedTier = this.save.armor?.boots?.tier || 0;
    let costTier = speedTier;
    let buffTier = this.isDragonActive() ? DRAGON_WALK_COST_TIER : 0;
    if ((this.save.speedPotionUntil ?? 0) > Date.now()) {
      buffTier = Math.max(buffTier, SPEED_POTION_WALK_COST_TIER);
    }
    speedTier = Math.max(speedTier, buffTier);
    costTier = Math.max(costTier, buffTier);
    if ((this.save.coffeeUntil ?? 0) > Date.now()) {
      speedTier = Math.min(SPEED_POTION_WALK_COST_TIER, speedTier + COFFEE_BOOT_BOOST);
    }
    // A BIKE RACK's loan (items.js BIKE_RACK_SPEED_MUL for BIKE_RACK_MS —
    // interactables.js writes save.bikeUntil): a factor on the speed, not a
    // tier, carried on the boots to steerSpeedMul like every other reason.
    // A ridden HORSE (items.js HORSE_RIDE, isRiding) is the same kind of
    // factor; a horse and a rack do not stack, the faster one counts. Only the
    // horse charges for it: its energyMul rides the boots' costTier to
    // steerEnergyCost.
    const bike = (this.save.bikeUntil ?? 0) > Date.now() ? BIKE_RACK_SPEED_MUL : 1;
    const riding = isRiding(this.save);
    const boost = Math.max(bike, riding ? HORSE_RIDE.speedMul : 1);
    const costMul = riding ? HORSE_RIDE.energyMul : 1;
    return { boots: { tier: speedTier, costTier, boost, costMul } };
  }
  // Steer with the STICK — the one control that walks you somewhere other than
  // where the GPS says you are. Unlike _steerTarget (the keyboard, which is
  // a free debug takeover) this is a first-class part of play:
  //
  //   • it moves the target AND banks the same delta into _manualOffsetM, so
  //     the next fix targets gpsM + offset and the ground you covered by hand
  //     isn't undone a second later;
  //   • it costs STAMINA, per cell, because this is the character covering
  //     ground you didn't. Walking with the GPS stays free — that's you
  //     actually walking.
  //
  // Boots scale stick speed and energy cost per cell. Dragon Powder and Speed
  // lend tier 8 / 9 to both for their duration.
  _steerManual(vx, vy, dt) {
    // Steering by hand is the opposite of walking home — clear the flag the
    // hint draws from, or it would stay lit from the last drift frame.
    this._driftingHome = false;
    const n = Math.hypot(vx, vy);
    if (!n) return;
    // The "no GPS — use the stick or WASD" line is a lesson, not a status.
    // The player just demonstrated they know it, so updateHUD stops drawing
    // it from here on. Session-scoped: a fresh load offers the hint again,
    // which costs one line until the first step and needs no save migration.
    this._steeredManually = true;
    // Out of energy is a hard stop, not a slow crawl: the stick simply can't
    // walk you any further off the GPS until you rest. Throttle the nag so it
    // doesn't fire every frame the player keeps pushing.
    if ((this.save.energy ?? 0) <= 0) {
      const now = Date.now();
      if (now - (this._steerTiredFlashAt || 0) > 3000) {
        this._steerTiredFlashAt = now;
        this.flash(TOO_TIRED_MSG, this.viewCenterX, this.viewCenterY);
      }
      return;
    }
    const relics = this._walkRelics();
    const step = WALK_M_S * steerSpeedMul(relics) * dt;
    const dx = (vx / n) * step, dy = (vy / n) * step;
    if (!this._targetM) this._targetM = { x: this.playerM.x, y: this.playerM.y };
    // TAKE THE WHEEL AT ONCE. The stick nudges the TARGET, and _followStep
    // walks the body toward it — which is right while steering, because the
    // body then sits within one step of a target being dragged along. But if
    // the stick is taken MID AUTO-WALK the target is tens of metres ahead in
    // the old direction, so a frame's nudge barely bends the course and the
    // character keeps marching the way it was going for a second or two before
    // the accumulated offset wins. It reads as momentum, and nobody asked for
    // momentum. Re-anchoring on takeover makes the first push move the body.
    //
    // The OFFSET moves with the target. The target is gpsM + offset, so
    // pulling the target back onto the body without the offset leaves the
    // abandoned lead in the offset — a walk home that had bled the offset
    // ahead of the body, or a GPS chase that hadn't caught up. The next fix
    // then re-targets gpsM + offset, a point the body is NOT at, and the auto
    // walk carries on the moment the stick is let go, under a countdown that
    // promised it wouldn't. Shifting the offset by the same delta keeps
    // target == gpsM + offset == body, so the only way home again is
    // _driftHome, after its debounce.
    // The half-cell test only ever fires on takeover — while steering, the gap
    // is one step, far inside it.
    if (Math.hypot(this._targetM.x - this.playerM.x, this._targetM.y - this.playerM.y)
        > this.cellM * 0.5) {
      this._manualOffsetM.x += this.playerM.x - this._targetM.x;
      this._manualOffsetM.y += this.playerM.y - this._targetM.y;
      this._targetM.x = this.playerM.x;
      this._targetM.y = this.playerM.y;
    }
    this._targetM.x += dx;
    this._targetM.y += dy;
    this._manualOffsetM.x += dx;
    this._manualOffsetM.y += dy;
    this._followPaused = false;
    // Remember which way the stick is pushing. _followStep animates from this
    // rather than from its own step vector while you steer: the body sits
    // within a step of a target you're dragging along, so its step vector
    // wobbles (and briefly points backwards) frame to frame, which showed up
    // as the sprite flickering between walk and idle and flipping direction.
    this._stickHeading = { x: vx / n, y: vy / n };
    this._lastStickT = Date.now();   // the walk-home timer starts when you stop
    if (this.compassDeg == null) this.facing = { x: vx, y: vy };
    // Per-cell stamina, banked fractionally and spent in STEER_DRAIN_LUMP-sized
    // bites, so a 0.15/cell Frost boots debits a lump every ~13 cells rather than
    // rounding up to a pip per cell. The rate is the same either way — the lump
    // only decides how coarse the steps are. Close to
    // your real position it's a fifth of that: pottering around the block you're
    // actually standing on shouldn't cost what striking out across town does,
    // and the discount is what makes the stick usable for lining up a tap.
    this._steerDistAccrue += Math.hypot(dx, dy);
    const near = this._gpsAwayM() <= NEAR_GPS_CELLS * this.cellM;
    const costPerCell = steerEnergyCost(relics) * (near ? NEAR_GPS_COST_MUL : 1);
    while (this._steerDistAccrue >= this.cellM) {
      this._steerDistAccrue -= this.cellM;
      this._steerCostAccrue += costPerCell;
      while (this._steerCostAccrue >= STEER_DRAIN_LUMP) {
        this._steerCostAccrue -= STEER_DRAIN_LUMP;
        const before = this.save.energy ?? 0;
        Energy.set(this.save, before - STEER_DRAIN_LUMP);
        // CLAUDE.md: "when you add an energy gain or loss the player can see,
        // pop it with _popEnergy and name the cell." Every other continuous
        // drain (the slime leech, a monster's melee, the trap bleed) rolls up
        // into an accumulator and flushes it as ONE throttled pop rather than
        // one per pip — a long drag across town would otherwise spam a "-1⚡"
        // every single cell. This one had no pop at all until now. Flushed in
        // update() (see _lastSteerFlashT), not here, because _steerManual only
        // runs while the stick is actually pushed — the flush needs a home
        // that runs every frame so a drag that stops mid-throttle still pays
        // out. This is a cost to the BODY (walking, not a tap on a cell), so
        // it wears the same "no ix/iy" default _popEnergy already gives the
        // slime leech and the rest splash — it lands on the player's own cell.
        this._steerDrainAccum = (this._steerDrainAccum || 0) + (before - this.save.energy);
        this._warnIfTiring(before);
        if (this.updateEnergyDOM) this.updateEnergyDOM();
      }
    }
  }
  // Interacting with the world puts the walk-home countdown back to its full
  // WALK_HOME_IDLE_MS (a no-op before the stick has ever been let go).
  _resetWalkHome() {
    if (this._lastStickT) this._lastStickT = Date.now();
  }
  // Is the walk home ON HOLD? A work wheel (standing still to chop a tree is
  // being busy, not idle — an AUTO wheel, auto-mining, isn't) or any dialog on
  // screen (body.modal-open, the same live signal the pads hide on). Held is a
  // PAUSE of the debounce, not a block: see _driftHome.
  _walkHomeHeld() {
    if (this._busyWheel()) return true;
    return typeof document !== 'undefined' && !!document.body?.classList?.contains('modal-open');
  }
  // Let go of the stick and, after a few seconds, the character walks itself
  // back to where you actually are. Stick walking builds up an offset from the
  // GPS (see _steerManual); this bleeds that offset back toward zero, dragging
  // the walk target home with it so _followStep walks the body there at its
  // own pace. Free — you're returning to reality, not spending a trip.
  //
  // At every depth (underground the body mines its way home, and a far return
  // is placed with the landing carved — see below), only while a fix is
  // actually driving (a keyboard takeover owns the target outright), and never
  // mid-wheel: standing still to chop a tree fifty metres out is being busy,
  // not being idle.
  _driftHome(dt) {
    // Every early return below is a frame where the character is NOT walking
    // itself home, so the flag the hint reads is cleared up front and set only
    // once the offset is actually being bled off.
    this._driftingHome = false;
    if (!this.gpsM || this._gpsManualOverride) return;
    if (this._stickPushed()) return;
    // A work wheel RESETS the debounce: working is interacting, so the full
    // WALK_HOME_IDLE_MS starts again when the wheel ends (a map tap does the
    // same, _resetWalkHome). A dialog PAUSES it instead: the clock slides
    // forward with the frame, so the countdown resumes where it stood (and a
    // mid-return picks up its ramp where it was) — never a dialog ending with
    // the walk already overdue.
    if (this._walkHomeHeld()) {
      if (this._lastStickT) {
        this._lastStickT = this._busyWheel()
          ? Date.now()
          : Math.min(Date.now(), this._lastStickT + dt * 1000);
      }
      return;
    }
    if (Date.now() - (this._lastStickT || 0) < WALK_HOME_IDLE_MS) return;
    // TOO FAR TO WALK — place the body instead. Past GPS_SNAP_M the gap is the
    // same thing a jumped fix treats as travel the player never made on foot,
    // and the rule has to be the same whichever side opened it: a fix that
    // jumps 500 m re-anchors you instantly, so a 500 m gap the stick opened
    // cannot be a minutes-long trudge back across terrain you aren't on any
    // more. The body chases at DEBUG_SPEED_MUL x walk pace (14 m/s) at best,
    // so half a kilometre is the better part of a minute of watching a
    // character walk in a straight line with the stick unusable under it.
    // Measured body-to-fix (_gpsAwayM), not by the stick offset: the offset
    // can bleed to zero with the body still hundreds of metres behind it, and
    // that lag is the same walk from the player's side of the screen.
    //
    // Still behind the idle debounce above, and deliberately: the distance
    // decides how the return is MADE, never when it starts. Yanking someone
    // mid-push would be the 500 ms hair-trigger bug with a warp on the end.
    //
    // Underground too. Until Sep 2026 this whole method was surface-only, so
    // a stick walk down a cave left the character parked that far off the
    // GPS for good: every later fix re-targeted fix + offset and nothing ever
    // bled the offset away ("underground I am not auto-walking to GPS"). The
    // one real reason to stay off the caves was this snap dropping the body
    // inside rock, and _placeBodyOnFix carves the landing cell instead.
    if (this._gpsAwayM() > GPS_SNAP_M && !this._confusedRecover
        && !Conditions.active(this.save, 'confused')) {
      this._teleportCut(() => {
        this._placeBodyOnFix();
        this.syncMoveTarget();    // drops the offset, the target and the ghost
      });
      return;
    }
    const off = this._manualOffsetM;
    const mag = Math.hypot(off.x, off.y);
    if (mag < 0.01) return;
    this._driftingHome = true;
    // Ease the return in (see WALK_HOME_RAMP_MS): squared ramp from the moment
    // the idle timer expires, so an interrupted nudge gives up almost no ground
    // while a real stop still gets home at walking pace.
    const rampT = Math.min(1, (Date.now() - (this._lastStickT || 0) - WALK_HOME_IDLE_MS)
                              / WALK_HOME_RAMP_MS);
    const ease = rampT * rampT;
    const step = Math.min(mag, WALK_M_S * WALK_HOME_SPEED_MUL
                                 * steerSpeedMul(this._walkRelics()) * ease * dt);
    if (step <= 0) return;
    const dx = -(off.x / mag) * step, dy = -(off.y / mag) * step;
    off.x += dx; off.y += dy;
    if (!this._targetM) this._targetM = { x: this.playerM.x, y: this.playerM.y };
    this._targetM.x += dx;
    this._targetM.y += dy;
    this._followPaused = false;
  }
  // Seconds left on the walk-home debounce, for the stick's countdown — or
  // null when there is nothing to count down to. The gates are _driftHome's
  // own: it only counts while a return is actually pending (a fix driving,
  // the stick let go, no wheel, and an offset to bleed — at any depth), so the
  // number on the stick is always a promise the walk will keep. Whole
  // seconds, rounded UP: "5" the instant you let go, "1" for the last second,
  // gone when the walk starts. Pure — no DOM — so the test suite drives it.
  _walkHomeCountdownS() {
    if (!this.gpsM || this._gpsManualOverride) return null;
    if (this._walkHomeHeld() || this._stickPushed()) return null;
    const off = this._manualOffsetM;
    if (!off || Math.hypot(off.x, off.y) < 0.01) return null;
    const left = WALK_HOME_IDLE_MS - (Date.now() - (this._lastStickT || 0));
    if (left <= 0) return null;
    return Math.ceil(left / 1000);
  }
  // Write the countdown onto the stick. The label lives on the pad itself (see
  // buildMovePad) so the number sits under the thumb that just let go — the
  // one place the player is looking when they wonder whether the character is
  // about to walk off. Only touches the DOM when the number changes.
  _updateWalkHomeCountdown() {
    const el = this._movePadCountdownEl;
    if (!el || !el.isConnected) return;
    const s = this._walkHomeCountdownS();
    // _walkHomeCountdownS stays a NUMBER (the tests drive it directly); the
    // unit is put on here, at the one place that writes the DOM, so the cap
    // reads "5s" like every other countdown in the game rather than a bare 5.
    const text = s == null ? '' : shortDuration(s * 1000);
    if (text === this._movePadCountdownText) return;
    this._movePadCountdownText = text;
    el.textContent = text;
    el.classList.toggle('on', !!text);
  }
  // The walk home is the one bit of movement the player didn't ask for frame by
  // frame — the character just starts walking, and until now the only clue was
  // the GPS dot quietly getting closer. So while it runs, draw a lead: a thin
  // dashed line from the feet to the dot with the dashes marching that way,
  // running all the way into the crosshair. It says "on my way back there" in
  // the one place the player is already looking, and it costs nothing to
  // ignore. No arrowhead: the line lands ON the marker, and the marker is
  // already the thing being pointed at — a chevron a few px short of it just
  // pointed at a target it was covering.
  //
  // Deliberately quiet. It waits out WALK_HOME_HINT_IDLE_MS after the stick was
  // last touched (the walk itself starts earlier, at WALK_HOME_IDLE_MS — the
  // first moments need no explaining to the player who just let go),
  // and it needs the dot on screen, which is the game's own test for "far
  // enough off your real position to matter". Gold and translucent — the same
  // gold the GPS crosshair itself is drawn in (UI_GOLD, 0xffe066), so the line
  // and the marker it runs to read as one piece of furniture rather than two
  // unrelated marks, and it stays quieter than the coloured compasses (the
  // green tutorial arrow, the cyan pairy dot) by being translucent.
  _drawWalkHomeHint(dt) {
    const g = this.walkHomeGfx;
    if (!g) return;
    g.clear();
    if (!this._driftingHome || !this.gpsGhost?.visible) return;
    if (Date.now() - (this._lastStickT || 0) < WALK_HOME_HINT_IDLE_MS) return;
    // Both endpoints are ground points: the character's feet are the player's
    // own screen point (feet-on-the-fix) and the GPS marker sits on the fix.
    const ps = this.playerScreen();
    const x0 = ps.x, y0 = ps.y;
    const x1 = this.gpsGhost.x;
    const y1 = this.gpsGhost.y;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    // Stop short of the character at the near end so the line never runs into
    // the sprite. At the far end it stops on the crosshair's RING (baked at
    // radius 5 in the 'gps_crosshair' texture above) rather than short of it:
    // the line is meant to reach the marker, so it touches it.
    const NEAR_GAP = 11, FAR_GAP = 5;
    if (len < NEAR_GAP + FAR_GAP + 10) return;
    const ux = dx / len, uy = dy / len;
    const from = NEAR_GAP, to = len - FAR_GAP;
    const DASH = 5, PERIOD = 11, MARCH = 26;   // px, px, px/s
    if (!this._reducedMotion) {
      this._walkHomeDashPhase = (this._walkHomeDashPhase + MARCH * dt) % PERIOD;
    }
    // Collected first, stroked twice: a soft dark pass under the gold one, so
    // the line holds up over pale ground (roads, sand) as well as grass — the
    // same keyline trick the stick's rim and the crosshair itself use.
    const segs = [];
    // One period of lead-in so the dash entering at the near end is drawn
    // clipped rather than popping into existence at full length.
    for (let s = from - PERIOD + this._walkHomeDashPhase; s < to; s += PERIOD) {
      const a = Math.max(s, from), b = Math.min(s + DASH, to);
      if (b > a) segs.push([x0 + ux * a, y0 + uy * a, x0 + ux * b, y0 + uy * b]);
    }
    const stroke = (list, width, colour, alpha) => {
      g.lineStyle(width, colour, alpha);
      for (const [ax, ay, bx, by] of list) {
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.strokePath();
      }
    };
    stroke(segs, 3.5, 0x0a1420, 0.22);
    stroke(segs, 2, 0xffe066, 0.55);
  }
  // Two states the player needs to feel without reading a number, both painted
  // on the character itself: an EMPTY TANK (nothing works until you rest) and
  // being FAR from where you actually are (the walk home is long and every step
  // out there is at full price). Each tints the sprite and lights a pulsing
  // halo behind it — red for empty, near-black for far — so the warning reads
  // at a glance in the corner of the eye. Empty wins when both are true: it's
  // the one that stops you doing anything.
  //
  // The far-tint is graded, not a switch: the character dims steadily from the
  // edge of the near ring out to DARK_FULL_CELLS, so the drift outward is
  // visible while it's happening rather than snapping at a threshold.
  _updatePlayerAura() {
    const DARK_FULL_CELLS = 10;     // fully dimmed by here
    const DIM_FLOOR = 0.45;         // darkest the character gets
    const away = this._gpsAwayM();
    const nearM = NEAR_GPS_CELLS * this.cellM;
    const spent = (this.save.energy ?? 0) <= 0;
    const far = away > nearM;
    // A hit just landed (_flashPlayerHit): a flick of red that wins over both
    // states for HIT_FLASH_MS, then hands back to whichever of them holds.
    const nowMs = performance.now();
    const hitLeft = (this._hitFlashUntilT || 0) - nowMs;
    const hit = hitLeft > 0;
    // A STATUS JUST LANDED (_flashPlayerStatus): a flick in the row's own
    // colour, under the hit (a blow still reads first) and over every state.
    const flicked = (this._statusFlashUntilT || 0) > nowMs;
    // A STATUS on the body wears its row's tint (Conditions.DEFINITIONS —
    // the same colour a foe wears, render.js): a burn flickers against the
    // farmer's own colour, a poison holds. Under the hit flick and the empty
    // bar, over the far-from-GPS dim.
    // The first active row, in table order, whose tint shows this instant.
    const status = Object.keys(Conditions.DEFINITIONS)
      .find((id) => Conditions.active(this.save, id) && Conditions.conditionTintOn(id, nowMs));
    // Pulse: a slow breath, faster and deeper for the empty-tank warning.
    const t = nowMs / 1000;
    const periodS = spent ? 1.2 : 2.0;
    const wave = 0.5 + 0.5 * Math.sin((t / periodS) * Math.PI * 2);
    if (hit || flicked || spent || far || status) {
      let tint = 0xffffff;
      if (hit) {
        tint = HIT_FLASH_TINT;
      } else if (flicked) {
        tint = this._statusFlashTint;
      } else if (spent) {
        tint = 0xff6b6b;
      } else if (status) {
        tint = Conditions.DEFINITIONS[status].tint;
      } else {
        const k = Math.min(1, (away - nearM) / Math.max(1, (DARK_FULL_CELLS - NEAR_GPS_CELLS) * this.cellM));
        const v = Math.round(255 * (1 - (1 - DIM_FLOOR) * k));
        tint = (v << 16) | (v << 8) | v;
      }
      this.player.setTint(mulTint(tint, (this._dragonActive || this._playerArt) ? null : this.save.playerColor));
      const key = (hit || spent) ? 'halo_red' : 'halo_dark';
      if (this.playerHalo.texture.key !== key) this.playerHalo.setTexture(key);
      // Strength follows the same k as the tint for the far case, so a halo
      // never shouts before the character has visibly dimmed.
      const strength = spent ? 1 : Math.min(1, (away - nearM) / (nearM * 2));
      // The hit is the halo at its brightest, decaying over the flash — this
      // is the channel that shows on a renderer where the tint does not.
      const size  = hit ? 46 : 38 + 6 * wave;
      const alpha = hit ? 0.2 + 0.6 * (hitLeft / HIT_FLASH_MS)
                        : (0.25 + 0.35 * wave) * strength;
      const ps = this.playerScreen();
      // On the BODY's centre, through the one accessor — the empty-tank red is
      // the halo that shows while the player is down, so a halo left on the
      // standing nudge would hang a body-length above the collapsed sprite it
      // is warning about.
      this.playerHalo
        .setDisplaySize(size, size)
        .setAlpha(alpha)
        .setPosition(ps.x, ps.y + this.playerBodyDy())
        .setVisible(true);
    } else {
      // At rest the farmer wears the save's own colour — the same tint other
      // players see on them (multiplayer.js), so you can spot yourself.
      this.player.setTint((!this._dragonActive && !this._playerArt && this.save.playerColor) || 0xffffff);
      if (this.playerHalo.visible) this.playerHalo.setVisible(false);
    }
    // THE GHOST. While nothing can perceive the player — a Shadow Powder's
    // minute, or collapsed on an empty bar — the body fades, and its contact
    // shadow fades with it. It is the same isUnnoticed() every hostile branch
    // in wanderCreatures asks, so the picture cannot promise a stealth the AI
    // isn't honouring: fade and safety begin and end on one expression.
    //
    // Alpha, not tint, on purpose. The two states this covers already own the
    // tint channel (the empty tank's red, the far-from-GPS dim) and the halo
    // beside it, and both of those are WARNINGS the player still needs while
    // down — a ghost that couldn't also go red would cost more than it says.
    // Fading is the one channel nothing else is using, and it says the right
    // thing by itself: less there.
    const ghost = this.isUnnoticed() ? UNNOTICED_ALPHA : 1;
    this.player.setAlpha(ghost);
    this.playerShadow?.setAlpha(
      (this._dragonActive ? PLAYER_SHADOW_ALPHA_FLYING : PLAYER_SHADOW_ALPHA) * ghost);
  }
  // Move the body one frame toward the target through open cells, mining a wall
  // only when it actually blocks the path AND can't be walked around (a cave
  // case only — the surface has no blocked cells).
  // "Choice of 2 cells": try the X-step and the Y-step of the heading
  // independently so the body slides past a wall that's off to the side. Then
  // DETECT BEING BLOCKED BY PROGRESS, not geometry: if heading toward the target
  // barely closed the gap this frame, a wall is in the way (a flat wall the old
  // wedge-only check would slide against forever). When blocked, first try a
  // single-cell jog around it (_detourDir) and only dig if no such trivial
  // detour exists. _startAutoMine no-ops unless a wall is really ahead, so a
  // body merely outrun by fast steering on open floor won't dig.
  // Confusion owns direction, while collision and the ordinary hold/slow gates
  // remain in force. GPS keeps its latest target for a gentle recovery later.
  _confusedStep(dt, capMS) {
    if (!(dt > 0) || Combat.playerDowned(this.save.energy)) return;
    if (this._busyWheel?.()) { this._playDirected(this.player, 'idle'); return; }
    if (!this._confusedLoop) this._confusedLoop = {
      angle: Math.random() * Math.PI * 2,
      turn: (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random()),
      left: 2 + Math.random() * 2,
    };
    const loop = this._confusedLoop;
    const balanceMul = typeof ObstacleStep !== 'undefined' ? ObstacleStep.speedMul(this._obstacleStep) : 1;
    const speed = Math.min(WALK_M_S, capMS > 0 ? capMS : Infinity) * balanceMul;
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, 0.05);
      remaining -= step;
      loop.angle += loop.turn * step;
      loop.left -= step;
      const dx = Math.cos(loop.angle) * speed * step, dy = Math.sin(loop.angle) * speed * step;
      const x = this.playerM.x + dx, y = this.playerM.y + dy;
      if (!this._cellBlocked(this.startWorldM.x + x, this.startWorldM.y + y + (this.feetOffsetM || 0))) {
        this.playerM.x = x; this.playerM.y = y;
      } else { loop.angle += Math.PI / 2; }
      if (loop.left <= 0) {
        loop.turn = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random());
        loop.left = 2 + Math.random() * 2;
      }
    }
    this.facing = { x: Math.cos(loop.angle), y: Math.sin(loop.angle) };
    this._playDirected(this.player, 'walk', this.facing.x, this.facing.y);
  }

  _followStep(dt, capMS) {
    // No target yet (surface before the first fix / any steer) — stand still.
    if (!this._targetM) { this._playDirected(this.player, 'idle'); return; }
    // A wheel is running (auto-mine, or a manual chop/mine the player tapped):
    // hold position until it resolves so the body doesn't wander off its work.
    // An AUTO-engaged sword fight is exempt — you didn't ask for it, so it must
    // not root you to the spot (see _busyWheel).
    if (this._busyWheel()) { this._playDirected(this.player, 'idle'); return; }
    // Paused after a tap-interrupt — wait for the next steer (GPS/keyboard).
    if (this._followPaused) { this._playDirected(this.player, 'idle'); return; }
    // Steering? Then the walk animation follows the STICK, not the step vector
    // (see _stickHeading) — and "arrived" doesn't mean stop, because the target
    // is being dragged away again the very next frame.
    const steering = this._stickPushed() && this._stickHeading;
    const body = this.playerM;
    const dx = this._targetM.x - body.x, dy = this._targetM.y - body.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= this.cellM * 0.15) {   // arrived — sit still, don't jitter
      this._confusedRecover = false;
      if (steering) this._playDirected(this.player, 'walk', this._stickHeading.x, this._stickHeading.y);
      else this._playDirected(this.player, 'idle');
      return;
    }
    // Catch-up speed: walk pace, scaled up with distance so the body keeps up
    // with fast (debug/GPS-jump) steering without ever teleporting, capped so a
    // big jump still reads as travel rather than a warp. One extra × per
    // FOLLOW_RAMP_M of gap — see that constant for why the rate is what it is.
    // `move` is clamped to `dist` besides, so no ramp can overshoot the target.
    //
    // While the STICK is held, floor it at the player's own stick speed: you
    // can never outrun your own legs. Without this the body settles
    // (steerSpeedMul - 1) cells behind a stick that's being held down — at
    // Frost that's a 20 m tail, and 20 m of coasting after you let go, which
    // reads as lag rather than speed. The floor is deliberately NOT applied
    // when the stick is idle: boots would otherwise have the body darting
    // after every few metres of GPS jitter. The cap has to clear the floor —
    // stick speeds run past DEBUG_SPEED_MUL from tier 4 up, and a cap under
    // the floor would silently cancel it.
    const stickMul = this._stickPushed() ? steerSpeedMul(this._walkRelics()) : 1;
    const mul = Math.min(Math.max(DEBUG_SPEED_MUL, stickMul),
                         Math.max(stickMul, 1 + dist / FOLLOW_RAMP_M));
    // SLOW (_bodyHold): tar or stakes underfoot cap the body's pace.
    if (this._confusedRecover) capMS = Math.min(capMS ?? Infinity, WALK_M_S);
    const balanceMul = typeof ObstacleStep !== 'undefined' ? ObstacleStep.speedMul(this._obstacleStep) : 1;
    const moveSpeed = Math.min(WALK_M_S * mul, capMS > 0 ? capMS : Infinity) * balanceMul;
    const move = Math.min(moveSpeed * dt, dist);
    const ux = dx / dist, uy = dy / dist;
    const foot = this.feetOffsetM;
    const open = (nx, ny) =>
      !this._cellBlocked(this.startWorldM.x + nx, this.startWorldM.y + ny + foot);
    const nx = body.x + ux * move, ny = body.y + uy * move;
    if ((ux !== 0) && open(nx, body.y)) body.x = nx;
    if ((uy !== 0) && open(body.x, ny)) body.y = ny;
    // Heading is the facing FALLBACK only — a real compass reading wins, same
    // rule _steerTarget follows. (The walk animation always uses the heading:
    // _playDirected is handed the vector explicitly rather than reading
    // this.facing.)
    if (this.compassDeg == null) this.facing = { x: ux, y: uy };
    if (steering) this._playDirected(this.player, 'walk', this._stickHeading.x, this._stickHeading.y);
    else this._playDirected(this.player, 'walk', ux, uy);
    // How much closer did we actually get? Against a wall in the heading
    // direction this collapses toward zero even while sliding sideways, so
    // we're blocked when progress is under half the step we tried to take.
    const moved = dist - Math.hypot(this._targetM.x - body.x, this._targetM.y - body.y);
    if (moved < move * 0.5) {
      // Blocked. Don't dig if a single-cell jog gets us around the obstacle —
      // mining is reserved for walls the player can't trivially walk past.
      const detour = this._detourDir(ux, uy);
      if (detour) {
        const sx = body.x + detour.x * move, sy = body.y + detour.y * move;
        if (detour.x !== 0 && open(sx, body.y)) body.x = sx;
        if (detour.y !== 0 && open(body.x, sy)) body.y = sy;
        if (this.compassDeg == null) this.facing = { x: detour.x, y: detour.y };
        this._playDirected(this.player, 'walk', detour.x, detour.y);
      } else {
        this._startAutoMine(ux, uy);
      }
    }
    // Arrival can consume only part of a long frame. Contact hazards charge
    // that walking time, not the idle remainder after reaching the target.
    return move / moveSpeed;
  }
  // Is the wall blocking forward progress one the body can trivially walk
  // around — one cell out of its way? Returns a unit perpendicular vector to
  // jog toward (the open side), or null if rounding the obstacle would take
  // more than a single-cell detour (in which case mining is the only way
  // through). "Trivial" means: the cell one step to the side is open AND the
  // cell forward of that sidestep is open, so a single jog clears a 1-cell-wide
  // wall. A thicker wall fails the forward check and falls through to mining.
  // The side it picks is COMMITTED (_detourHold, DETOUR_COMMIT_MS): the same
  // heading axis asks the same side first until the hold lapses, so the jog
  // can't flip the choice it was made by.
  _detourDir(ux, uy) {
    const m = this.cellM;
    const bx = this.startWorldM.x + this.playerM.x;
    const by = this.startWorldM.y + this.playerM.y + this.feetOffsetM;
    const open = (cdx, cdy) => !this._cellBlocked(bx + cdx * m, by + cdy * m);
    return committedDetourDir(this, ux, uy, open, performance.now(), DETOUR_COMMIT_MS);
  }
  // Pick the wall cell blocking progress toward the target (dominant axis first)
  // and start an auto-mine wheel on it. No-op if no adjacent wall is found.
  _startAutoMine(ux, uy) {
    const bx = this.startWorldM.x + this.playerM.x;
    const by = this.startWorldM.y + this.playerM.y + this.feetOffsetM;
    // Two candidates: the X-neighbour and Y-neighbour toward the target, in
    // dominant-axis order so we cut the most useful wall first.
    const cand = Math.abs(ux) >= Math.abs(uy)
      ? [[Math.sign(ux), 0], [0, Math.sign(uy)]]
      : [[0, Math.sign(uy)], [Math.sign(ux), 0]];
    for (const [cdx, cdy] of cand) {
      if (!cdx && !cdy) continue;
      const c = this.cellAt(bx + cdx * this.cellM, by + cdy * this.cellM);
      if (c.loaded && c.type === 25 /* CAVE_WALL */) { this._beginAutoMine(c); return; }
    }
  }
  // Start a work-wheel that digs cave-wall cell `c` (from cellAt) into floor and
  // drops stone — the same payout/cost as tapping a wall by hand. Auto-pauses on
  // empty energy so the player isn't silently stuck against a wall.
  _beginAutoMine(c) {
    const { cellIX, cellIY } = c;
    const { x: wx, y: wy } = absCellCenterMeters(this, cellIX, cellIY);
    const cost = (typeof effectivePickCost === 'function') ? effectivePickCost(this.save.relics) : 0;
    // Affordability GATE only — do NOT deduct here. Unlike a hand-tapped mine
    // (which the player starts deliberately and waits out), the body kicks off
    // these wheels on its own — up to 9s bare-handed — while the player is
    // tapping to steer underground. An up-front charge with
    // refund-on-bail (abortWorkProgress) meant every tap during the wheel handed
    // the energy back, so a whole tunnel could be dug for almost nothing.
    // Charge at COMPLETION instead (in the wheel callback below): a dug wall
    // always costs, an interrupted one costs nothing — and isn't dug.
    if (cost > (this.save.energy ?? 0)) {
      this.flash(TOO_TIRED_MSG, this.viewCenterX, this.viewCenterY);
      this._followPaused = true;   // out of energy — stop chewing the wall
      return;
    }
    const durMs = (typeof toolDurationMs === 'function')
      ? toolDurationMs(this.save.relics, 'pickaxe')
      : (this.save.relics?.pickaxe ? 4000 : 9000);
    this._autoMineKey = `${c.tx}/${c.ty}/${c.ix}/${c.iy}`;
    // energyRefund = 0: nothing was charged up-front, so a tap-bail has nothing
    // to refund (it just cancels the dig). The spend lands at the dig instant.
    this.startWorkProgress(wx, wy, () => {
      // Energy can have drained mid-wheel (monsters chip away at it during the
      // up-to-9s dig) even though the gate above passed at start — re-check at
      // completion and bail with no dig/loot if it no longer affords, same as
      // every other spendEnergy bail (flash already fired inside spendEnergy).
      if (!this.spendEnergy(cost, this.viewCenterX, this.viewCenterY, { ix: cellIX, iy: cellIY })) {
        this._followPaused = true;   // out of energy — stop chewing the wall
        this._autoMineKey = null;
        return;
      }
      this.digCaveWall(c.tx, c.ty, c.ix, c.iy, cellIX, cellIY);
      // The wall's own table (interactables.js caveWallDrop), the one a
      // tapped dig pays too.
      const qty = caveWallDrop(this);
      this._autoMineKey = null;
      persistSave(this.save);
      const item = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID['rubble'] : null;
      this.flashLoot(`+${qty} ${item?.name || 'Stone'}`, '#a7ffb0', 1, 'rubble');
    }, durMs, 0, 'pickaxe');
  }
  // Take a staircase: delta +1 descends, -1 ascends. Snaps the player onto the
  // staircase's cell at the new depth (where a matching stair sits), swaps the
  // active tile cache, repaints the background, and loads the new level.
  changeDepth(delta, stair) {
    const target = Math.max(0, (this.depth || 0) + delta);
    if (target === this.depth) return;
    // Can't descend on an empty tank — you'd just pass out down there. Climbing
    // up is always allowed (it's how you escape exhaustion).
    if (delta > 0 && (this.save.energy ?? 0) <= 0) {
      this.flash('Too tired to go down.', this.viewCenterX, this.viewCenterY);
      return;
    }
    // Leaving the portal's destination by any other route closes the return.
    if (this.save.sapphireReturn && target !== this.save.sapphireReturn.depth) {
      delete this.save.sapphireReturn;
    }
    this.depth = target;
    this.save.depth = target;
    WorldGen.setDepth(target);
    // GPS-mirror: keep the same world coordinates, just snap feet onto the stair.
    this.playerM.x = stair.x - this.startWorldM.x;
    this.playerM.y = stair.y - this.startWorldM.y - this.feetOffsetM;
    // Reset target-follow: any in-flight auto-mine is dropped, and the target
    // starts coincident with the body (syncMoveTarget, below) so the two don't
    // diverge until the player steers or the next GPS fix lands.
    if (this._workProgress && this._autoMineKey) this.cancelWorkProgress();
    this._autoMineKey = null;
    // A fight doesn't follow you up the stairs: drop any auto-engaged wheel and
    // the shots still in the air, or they'd carry on against a foe on a level
    // you just left.
    if (this._workProgress?.combat) this.cancelWorkProgress();
    this._shots = [];
    this._nextShotT = {};
    this._turretNextT = {};
    this._turretScan = null;
    this.syncMoveTarget();
    this.cameras.main.setBackgroundColor(target > 0 ? '#0a0a12' : '#000');
    this.ensureTilesAround().catch(() => {});
    this.flash(target > 0 ? `Descended — depth ${target}` : 'Back on the surface',
               this.viewCenterX, this.viewCenterY);
    persistSave(this.save);
    // The FIRST time a save goes below the surface tells its story. Every way
    // down (stairs, rope, the sapphire portal) comes through here, and a busy
    // screen returns false unmarked (the story ledger), so the next descent
    // asks again.
    if (delta > 0) {
      this._storySplashOnce('cave', {
        art: 'cave_first',
        title: 'Into the dark',
        body: 'You step into the cold cave. Water drips somewhere in the darkness ahead.',
      });
    }
  }

  // Every collapse tells this beat before its existing outcome panel.
  _deathStory(onDismiss) {
    this.showMessageModal({
      art: 'death_memories', kind: 'story', title: 'Fading memories',
      body: 'You desperately try to hold onto your memories... your vision goes dark and red.',
      okLabel: 'Next', mustAcknowledge: true, onDismiss,
    });
  }
  // Black out at 0 energy underground and wake on the surface. Keeps the same
  // world coordinates (GPS re-asserts position up top); the player wakes still
  // drained, so they must rest before heading back down (changeDepth gate).
  // Passing out also costs HALF the purse — floored, so it can't go negative
  // and a broke player loses nothing further. A real cost for running the
  // tank dry is what makes "rest first" a warning worth heeding rather than a
  // free teleport home.
  _passOutToSurface() {
    this._passingOut = true;
    if (this._workProgress) this.cancelWorkProgress();
    this._autoMineKey = null;
    this._shots = [];              // nothing you loosed down there follows you up
    this._nextShotT = {};
    this._turretNextT = {};
    this._turretScan = null;
    delete this.save.sapphireReturn;
    this.depth = 0;
    this.save.depth = 0;
    WorldGen.setDepth(0);
    // Same world coordinates, now on the surface — park the target on the body
    // so the walk up top doesn't start by chasing the cave target we woke with.
    this.syncMoveTarget();
    this.cameras.main.setBackgroundColor('#000');
    this.ensureTilesAround().catch(() => {});
    const lost = Math.floor((this.save.money ?? 0) / 2);
    if (lost > 0) addMoney(this.save, -lost);
    persistSave(this.save);
    this._deathStory(() => this.showChestRewardModal({
      kind: 'rest',
      header: 'Exhausted',
      iconHTML: '<span style="font-size:42px">😵</span>',
      name: 'You pass out from exhaustion and wake up on the surface.',
      sub: lost > 0 ? `Lost ${this.moneyHTML(lost)} while you were out cold.` : undefined,
      color: '#ff8c3b', accent: '#ff8c3b',
      onDismiss: () => { this._passingOut = false; },
    }));
  }
  // Hard mode's surface exhaustion: the same half-purse cost as the
  // underground blackout above, but nothing else about it — no cave to wake
  // up from, so position, depth and any in-progress work are all untouched.
  // Easy mode never calls this (see the update() gate).
  _passOutOnSurface() {
    this._passingOut = true;
    const lost = Math.floor((this.save.money ?? 0) / 2);
    if (lost > 0) addMoney(this.save, -lost);
    persistSave(this.save);
    this._deathStory(() => this.showChestRewardModal({
      kind: 'rest',
      header: 'Exhausted',
      iconHTML: '<span style="font-size:42px">😵</span>',
      name: 'You collapse from exhaustion.',
      sub: lost > 0 ? `Lost ${this.moneyHTML(lost)} while you were out cold.` : undefined,
      color: '#ff8c3b', accent: '#ff8c3b',
      onDismiss: () => { this._passingOut = false; },
    }));
  }
  // Guarantee an UP staircase (and never a DOWN one) on the home cell of every
  // cave level, so the player can always climb back toward the surface from the
  // starting house. Idempotent — runs on each (re)load of the home tile.
  //   NOTHING ELSE STANDS ON A LADDER. The cave build (loadCaveTile) seated
  // its rocks, chests, mushrooms and torches before this cell was a stair, so
  // whatever landed here is cleared; the spawn pass runs AFTER this (buildOne)
  // and culls anything it draws onto the stair (spawnCaveCreatures'
  // heldByPlayer — it is not one of the level's GENERATED objects).
  _ensureHomeUpStair(entry, tx, ty) {
    if (!entry || !entry.grid || typeof HomeArea === 'undefined' || !HomeArea.worldM) return;
    this._laySyntheticUpStair(entry, tx, ty, HomeArea.worldM.x, HomeArea.worldM.y, 'homeup');
  }
  // The same for the STARTER LADDER — the `_synthetic` down-stair
  // _provisionStarterHome seats beside Home (a frozen `ladder` record in
  // save.starterHome). loadCaveTile mirrors only GENERATED down-stairs (a
  // player's own ladder must not reshape the cave everyone else descends
  // into), so the way back up under it is laid here, per player, on every
  // cave level — exactly as the home stair is.
  _ensureLadderUpStairs(entry, tx, ty) {
    const placed = this.save && this.save.starterHome && this.save.starterHome.placed;
    if (!entry || !entry.grid || !Array.isArray(placed)) return;
    for (const rec of placed) {
      if (!rec || rec.k !== 'ladder' || !Number.isFinite(rec.x)) continue;
      this._laySyntheticUpStair(entry, tx, ty, rec.x, rec.y, 'ladderup');
    }
  }
  // One per-player up-stair at world point (wx, wy) on a cave level, when it
  // falls in this tile: floor under it, nothing else on the cell, never a
  // down-stair there. `_synthetic` — a player overlay, never part of the
  // level's generated layer (CLAUDE.md "Every player sees the SAME generated
  // world"), so no spawn anchors on it and no level below mirrors it.
  _laySyntheticUpStair(entry, tx, ty, wx, wy, prefix) {
    const N = entry.cellsPerEdge;
    const tileEdgeM = entry.tileEdgeM;
    if (Math.floor(wx / tileEdgeM) !== tx || Math.floor(wy / tileEdgeM) !== ty) return;
    const mPerCell = tileEdgeM / N;
    const lix = Math.floor((wx - tx * tileEdgeM) / mPerCell);
    const liy = Math.floor((wy - ty * tileEdgeM) / mPerCell);
    if (lix < 0 || liy < 0 || lix >= N || liy >= N) return;
    entry.grid[liy * N + lix] = 24;   // CAVE_FLOOR — the stair must sit on floor
    const cx = tx * tileEdgeM + (lix + 0.5) * mPerCell;
    const cy = ty * tileEdgeM + (liy + 0.5) * mPerCell;
    const half = mPerCell * 0.5;
    const atCell = (o) => Math.abs(o.x - cx) < half && Math.abs(o.y - cy) < half;
    entry.objects = entry.objects || [];
    // No descending from here, and nothing sitting on the ladder: drop every
    // object on this cell but an up-stair, and any wildplant.
    entry.objects = entry.objects.filter(o => !atCell(o) || (o.kind === 'staircase' && o.dir === 'up'));
    if (entry.wildplants) entry.wildplants = entry.wildplants.filter(w => !atCell(w));
    if (!entry.objects.some(o => o.kind === 'staircase' && o.dir === 'up' && atCell(o))) {
      entry.objects.push(WorldGen.makeObject('staircase', cx, cy,
        WorldGen.cellId(`${prefix}_${entry.depth}`, tx, ty, lix, liy),
        { dir: 'up', depth: entry.depth, _synthetic: true }));
    }
  }
  cellAt(wmx, wmy) {
    // Absolute metres → tile-pixel space, through the one conversion
    // (coords.js) every cell index in the game is floored out of.
    const { x: wx, y: wy } = worldMetersToTilePx(this, wmx, wmy);
    const TILE_PX = WorldGen.TILE_PX;
    const tx = Math.floor(wx / TILE_PX), ty = Math.floor(wy / TILE_PX);
    // The tile's OWN grid — its row's cell count (coords.js rowCells).
    const N = rowCells(this, ty);
    const cps = TILE_PX / N;
    const ix = Math.floor((wx - tx * TILE_PX) / cps);
    const iy = Math.floor((wy - ty * TILE_PX) / cps);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    const loaded = !!(entry && entry.grid);
    // ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): NOT a spawn
    // decision — cellAt() is a general-purpose cell query (isTillableCell in
    // items.js, the terrain-flavour text in interact.js, an NPC's own
    // walk-blocked test in npc.js all read this .underRoad flag; nothing
    // here places anything). Road-band flag. The terrain grid under-reports
    // roads (QC rules: a way rasterizes exactly ONE cell wide however wide
    // its drawn band really is), so "is this ground road" must come from
    // entry.roadMask — stamped from the same WorldGen.roadOverlayWidthM the
    // overlay strokes with. Checking road TERRAIN alone is the bug, not the
    // fix.
    const underRoad = !!(loaded && entry.roadMask
      && entry.roadMask[iy * N + ix]);
    // cellIX / cellIY: the same cell as an ABSOLUTE key (coords.js encoding) —
    // what dug-wall keys and _popEnergy take. Never tx * N + ix by hand.
    const abs = tileCellToAbs(this, tx, ty, ix, iy);
    return { tx, ty, ix, iy, cellIX: abs.cellIX, cellIY: abs.cellIY, loaded, underRoad,
      type: loaded ? entry.grid[iy * N + ix] : 0 };
  }

  // Debug key T — hop to the nearest standalone (OSM-mapped) tree not yet
  // visited this session, measured from wherever the last hop landed; once
  // every loaded tree has been visited the set clears and the cycle restarts.
  teleportNextIndividualTree() {
    this.disableGpsForSession();
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    if (!this._indivTreeVisited) this._indivTreeVisited = new Set();
    // Gather every standalone OSM tree across currently-loaded tiles.
    const all = [];
    WorldGen.forEachItem('objects', (o) => {
      if (o.kind === 'tree' && o.individual) all.push(o);
    });
    if (!all.length) {
      this.flash('no individual trees loaded yet', this.viewCenterX, this.viewCenterY - 40);
      return;
    }
    // Cycle outward: hop to the nearest tree we haven't visited yet. Once we've
    // seen them all, wrap around so the key keeps working. Because each hop
    // measures distance from the *new* position, repeated presses naturally
    // walk you through a cluster rather than ping-ponging.
    let pool = all.filter(o => !this._indivTreeVisited.has(o.id));
    if (!pool.length) { this._indivTreeVisited.clear(); pool = all; }
    let best = null, bestD = Infinity;
    for (const o of pool) {
      const dx = o.x - px, dy = o.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = o; }
    }
    this._indivTreeVisited.add(best.id);
    this.playerM.x = best.x - this.startWorldM.x;
    this.playerM.y = best.y - this.startWorldM.y + 4;
    this.gpsM = { x: this.playerM.x, y: this.playerM.y };
    this.syncMoveTarget();
    this.flash(`→ ${treeSpeciesName(best)} (${this._indivTreeVisited.size}/${all.length})`,
               this.viewCenterX, this.viewCenterY - 40);
  }

  // Debug-only: jump to the next-nearest POI chest that has a decoration pad,
  // walking outward by distance. First press preferentially seeks the named
  // POI in `_poiTpFirst` if it's loaded.
  teleportNextPoi() {
    this.disableGpsForSession();
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    // Deterministic visit key by game cell — matches the render/tap dedupe so the
    // teleport cycle visits exactly the crates you can see. Chest ids are cell-snapped,
    // so duplicates of one POI across tile seams share a cell and count as a single stop.
    const chestKey = (o) => {
      const c = worldMetersToAbsCell(this, o.x, o.y);
      return cellKeyFromAbsCell(c.cellIX, c.cellIY);
    };
    // First press: try to find the named seed POI (e.g. Windermere Park).
    if (this._poiTpVisited.size === 0 && this._poiTpFirst) {
      WorldGen.forEachItem('objects', (o) => {
        if (o.kind !== 'chest' || o.name !== this._poiTpFirst) return;
        this._poiTpVisited.add(chestKey(o));
        this.playerM.x = o.x - this.startWorldM.x;
        this.playerM.y = o.y - this.startWorldM.y + 4;
        this.syncMoveTarget();
        // Name the KIND, never the OSM name (unbounded — MAP_MSG_MAX).
        this.flash(`→ ${o.poiClass || 'chest'}`, this.viewCenterX, this.viewCenterY - 40);
        return true; // short-circuit
      });
      if (this._poiTpVisited.size > 0) return;
    }
    // Find the nearest unvisited decorated chest, deduped by key.
    let best = null, bestD = Infinity, bestKey = null;
    const seenKey = new Set();
    WorldGen.forEachItem('objects', (o) => {
      if (o.kind !== 'chest' || !o.poiClass) return;
      if (!padShapeKeyForPoi(o.poiClass)) return;
      const k = chestKey(o);
      if (seenKey.has(k)) return;
      seenKey.add(k);
      if (this._poiTpVisited.has(k)) return;
      const d = Math.hypot(o.x - px, o.y - py);
      if (d < bestD) { bestD = d; best = o; bestKey = k; }
    });
    if (!best) {
      // Out of decorated chests within loaded tiles — reset cycle.
      this._poiTpVisited.clear();
      this.flash('cycle reset — press space', this.viewCenterX, this.viewCenterY - 40);
      return;
    }
    this._poiTpVisited.add(bestKey);
    this.playerM.x = best.x - this.startWorldM.x;
    this.playerM.y = best.y - this.startWorldM.y + 4;
    this.syncMoveTarget();
    this.flash(`→ ${best.poiClass} ${Math.round(bestD)}m`, this.viewCenterX, this.viewCenterY - 40);
  }

  // ── Toasts ───────────────────────────────────────────────────────────────
  // Every transient in-world message goes through _toast. There used to be
  // five separate builders (flash, _splashEnergyGain, flashLoot, flashJackpot,
  // flashShiny) which between them used three dark backgrounds (#000a, #000c,
  // rgba(0,0,0,.6)), four unrelated font sizes, three stroke weights including
  // none at all, and four padding shapes — so two messages a second apart could
  // look like they came from different games.
  //
  // The tiers below are the differences that are actually meaningful; every
  // other axis is now shared. See TOAST_TIER in this file for the table.
  //
  // Returns the text object so a caller can hang extra tweens on it (the
  // fanfares add a wobble). Options:
  //   tier          which row of TOAST_TIER
  //   x, y          absolute position; default is the viewport centre offset
  //                 by the tier's dy
  //   originY       1 (default) hangs the chip above y; 0 drops it below
  //   color, bg     ink and chip colour
  //   dwellMul      scales hold + fade (a chest open lingers longer)
  //   padExtraLeft  reserve inside the chip for flashLoot's DOM icon
  //   mask          clip to a geometry mask (a world-anchored pop takes the
  //                 map viewport's, like every other world-anchored layer)
  //   stack         false to skip the lift past other toasts
  _toast(text, opts = {}) {
    const S = TOAST_TIER[opts.tier || 'note'];
    const x = opts.x ?? this.viewCenterX;
    const y = opts.y ?? (this.viewCenterY + S.dy);
    const mul = opts.dwellMul || 1;
    // Chip colour: caller override, else the tier's own, else the shared one.
    // A tier may opt out entirely with `bg: null`, so this can't collapse to
    // `opts.bg || S.bg || TOAST_BG` — null is exactly the value that must win.
    const bg = opts.bg !== undefined ? opts.bg
             : (S.bg !== undefined ? S.bg : TOAST_BG);
    const style = {
      font: fontMono(S.font),
      color: opts.color || UI_INK,
      stroke: UI_SHADOW, strokeThickness: S.stroke,
      padding: {
        left: S.pad + (opts.padExtraLeft || 0), right: S.pad,
        top: S.padY, bottom: S.padY,
      },
    };
    if (bg) style.backgroundColor = bg;
    if (S.shadow) {
      style.shadow = {
        offsetX: S.shadow.offsetX, offsetY: S.shadow.offsetY,
        color: UI_SHADOW, blur: S.shadow.blur, fill: true, stroke: true,
      };
    }
    const t = this.add.text(x, y, text, style)
      .setOrigin(0.5, opts.originY ?? 1).setDepth(S.depth);
    if (opts.mask) t.setMask(opts.mask);
    // EVERY tier clamps: a tap near an edge must not render half a message.
    t.x = clampTextX(x, t.width, W);
    // Stack instead of overlapping. Do this BEFORE the drift tween is built so
    // the tween captures the final resting y.
    if (opts.stack !== false) this._stackToast(t);
    if (S.pop) {
      t.setScale(S.popScale).setAlpha(0);
      const peak = S.overshoot || 1;
      this.tweens.add({ targets: t, scale: peak, alpha: 1, duration: S.pop, ease: 'Back.Out' });
      // Fanfares overshoot and settle back; the loot pop lands directly.
      if (peak !== 1) {
        this.tweens.add({ targets: t, scale: 1, duration: S.pop, delay: S.pop, ease: 'Sine.InOut' });
      }
    } else if (S.fadeIn) {
      t.setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, duration: S.fadeIn, delay: 160 });
    }
    // t.y, not the anchor y — _stackToast may have lifted it clear.
    this.tweens.add({
      targets: t, y: t.y - S.rise, alpha: 0,
      duration: Math.round(S.fade * mul), delay: Math.round(S.hold * mul),
      ease: S.ease, onComplete: () => t.destroy(),
    });
    return t;
  }

  // Lift a freshly-built toast until it clears every toast already on screen.
  //
  // The NEW one moves, never the ones already placed. That is not a style
  // choice: a placed toast already owns a tween on its own `y` for the drift,
  // and a second tween on the same property fights it — the toast would snap
  // between the two values for the rest of its life. Walking the newcomer
  // upward past what is already there needs no tween at all.
  //
  // Overlap is tested on real rendered bounds rather than on tier or anchor,
  // so it also catches a note colliding with a loot pop, and leaves two
  // messages at opposite corners alone.
  _stackToast(t) {
    const live = this._liveToasts || (this._liveToasts = []);
    // Drop anything Phaser has already destroyed. The destroy handler below
    // normally does this; the sweep covers a scene teardown that fired none.
    for (let i = live.length - 1; i >= 0; i--) {
      if (!live[i].scene || live[i].active === false) live.splice(i, 1);
    }
    const GAP = 3;
    const ceiling = (this.viewTop ?? 0) + 2;
    const hits = (b) => live.find((o) => {
      const ob = o.getBounds();
      return !(b.right <= ob.left || b.left >= ob.right
            || b.bottom <= ob.top  || b.top  >= ob.bottom);
    });
    // Bounded: a burst of messages must not march off the top of the map. Once
    // the stack reaches the ceiling the newest simply overlaps, which is the
    // old behaviour and still better than a toast nobody can see.
    for (let guard = 0; guard < 6; guard++) {
      const b = t.getBounds();
      const hit = hits(b);
      if (!hit) break;
      const lift = (b.bottom - hit.getBounds().top) + GAP;
      if (b.top - lift < ceiling) break;
      t.y -= lift;
    }
    live.push(t);
    t.once('destroy', () => {
      const i = live.indexOf(t);
      if (i >= 0) live.splice(i, 1);
    });
  }

  // ── Particle bursts (src/particles.js) ─────────────────────────────────
  // Three entry points, one per kind of position. All of them end in
  // Particles.burst, which owns the presets, the lazy emitters and the
  // reduced-motion gate; these only answer "where on screen?".
  //
  // At a SCREEN point — a toast's own x/y (the jackpot and shiny banners).
  // The old _starburst (eight tweened ✦ Text objects) lived here.
  _burstAt(kind, x, y) {
    if (typeof Particles === 'undefined') return 0;
    return Particles.burst(this, kind, x, y);
  }

  // At a WORLD point (absolute metres — a planted crop's x/y). Projected
  // through worldMetersToScreen at fire time, never off the player, so a peek
  // drag can't tear the puff off the thing it marks (QC rules: "where do I
  // DRAW this?" goes through the projection). Gated on the viewport with a
  // cell of margin: the crop tick advances plants the player is nowhere near,
  // and a burst nobody sees still costs the pool.
  // `opts` is handed straight to Particles.burst — ringPx (throw them off a
  // ring of that radius rather than out of the one point), count, colour.
  // The viewport gate grows with the ring: a building whose centre is off the
  // edge still throws sparks off the wall that isn't.
  _burstAtWorld(kind, wmx, wmy, opts) {
    if (typeof Particles === 'undefined' || !this.worldMetersToScreen) return 0;
    if (!this.startWorldM || !this.originPx) return 0;
    const p = this.worldMetersToScreen(wmx, wmy);
    const margin = CELL_PX + Math.max(0, (opts && opts.ringPx) || 0);
    if (!p || !Particles.onScreen(this, p.x, p.y, margin)) return 0;
    return Particles.burst(this, kind, p.x, p.y, opts);
  }

  // At an absolute CELL: its centre, then as above.
  _burstAtCell(kind, ix, iy) {
    if (ix == null || iy == null || typeof absCellCenterMeters !== 'function') return 0;
    if (!this.startWorldM || !this.originPx) return 0;
    const c = absCellCenterMeters(this, ix, iy);
    return this._burstAtWorld(kind, c.x, c.y);
  }

  // ── THE BLAST: one restoration fanfare, at any size ────────────────────
  // Something in the world came back — a street rebuilt, a wreck pulled back into
  // a house — and the moment is the same moment at two scales. One entry
  // point, four parts, all of them scalable:
  //
  //   the LIGHT   a transient near-white flash on the lightmap
  //               (Lighting.blast), `radiusCells` across, swelling as it
  //               fades over its duration. It is handed WORLD METRES and the
  //               lightmap re-anchors it every frame, so a peek drag leaves
  //               the flash on the ground it went off on (CLAUDE.md's camera
  //               rule) rather than sliding it with the camera.
  //   the CHIPS   debris off the thing, in ITS material (`chips` — the stone
  //               preset for a street, timber for a house; `material`
  //               overrides the preset's colour outright).
  //   the SPARKS  a ring of stars in the moment's own colour (`sparks`).
  //   the GATHER  (`gather`, optional) the opposite of the chips: material
  //               pulled BACK toward the point rather than kicked off it — a
  //               converging particles.js preset (`converge: true`), the one
  //               piece of this fanfare that reads as a REPAIR rather than an
  //               impact. The street is the only caller that asks for it.
  //               `gatherPts` (optional, WORLD METRES) spreads its sink
  //               across several points — a restored road SECTION, not one
  //               dot on it — projected here and handed on as particles.js's
  //               `opts.targets`; without it every particle still converges
  //               on the one point every other part of the blast uses.
  //
  // `ringPx` is what makes the particles fit the thing: 0 (a stone) throws
  // them out of the one point, and a building's half-extent throws them off
  // its WALLS, with the count scaled to the ring (particles.js burstCount).
  // `colour` is the LIGHT's, if the flash should not be the default white.
  //
  // Every part no-ops cleanly with no Phaser, no fx layer and no projection,
  // so the headless harness can drive the callers.
  _blastAt(wmx, wmy, opts) {
    if (!Number.isFinite(wmx) || !Number.isFinite(wmy)) return 0;
    const o = opts || {};
    const ringPx = (o.ringPx > 0) ? o.ringPx : 0;
    if (typeof Lighting !== 'undefined' && Lighting.blast) {
      Lighting.blast(this, wmx, wmy, {
        radiusCells: o.radiusCells, colour: o.colour, durationMs: o.durationMs,
      });
    }
    const popts = { ringPx, colour: o.material };
    if (Array.isArray(o.gatherPts) && o.gatherPts.length && this.worldMetersToScreen) {
      const targets = o.gatherPts.map((q) => this.worldMetersToScreen(q.x, q.y)).filter(Boolean);
      if (targets.length) popts.targets = targets;
    }
    let n = 0;
    if (o.chips)  n += this._burstAtWorld(o.chips,  wmx, wmy, popts);
    if (o.sparks) n += this._burstAtWorld(o.sparks, wmx, wmy, popts);
    if (o.gather) n += this._burstAtWorld(o.gather, wmx, wmy, popts);
    return n;
  }

  // Where a blast for `house` goes off and how big it is. The footprint is the
  // building's SOURCE ring (entry.buildingShapes, keyed by the same ownerKey
  // the house's id is minted as — the key building_overlay.js draws the
  // polygon under), in tile-local metres, so its bounding box is the real
  // outline rather than the sprite's cell. Failing that (a house whose tile
  // has been evicted, or a synthetic trailer) the polygon area the object
  // carries stands in as a square, and failing THAT one cell.
  //
  // Returns { x, y } absolute metres, `radiusCells` (the half-diagonal, plus
  // BLAST_HOUSE_PAD_CELLS so the light clears the roof) and `ringPx` (the mean
  // half-extent, in px — the wall the sparks come off).
  _houseBlastGeometry(house) {
    const cellM = this.cellM || 1;
    let cx = house?.x, cy = house?.y;
    let halfW = null, halfH = null;
    try {
      if (house && house.id && typeof WorldGen !== 'undefined' && WorldGen.tileCache) {
        for (const [tkey, e] of WorldGen.tileCache) {
          if (!e || !e.buildingShapes || !e.tileEdgeM) continue;
          // The tile's own origin, off its cache key (`Z/tx/ty`) — never off
          // house.x, which sits a hair the wrong side of the seam for a
          // building whose polygon lives in the neighbouring tile.
          const kp = String(tkey).split('/');
          const ox = (+kp[1]) * e.tileEdgeM, oy = (+kp[2]) * e.tileEdgeM;
          if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
          for (const sh of e.buildingShapes) {
            if (!sh || sh.key !== house.id || !sh.ring || sh.ring.length < 6) continue;
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (let i = 0; i < sh.ring.length; i += 2) {
              const rx = sh.ring[i], ry = sh.ring[i + 1];
              if (rx < x0) x0 = rx;
              if (rx > x1) x1 = rx;
              if (ry < y0) y0 = ry;
              if (ry > y1) y1 = ry;
            }
            halfW = (x1 - x0) / 2; halfH = (y1 - y0) / 2;
            cx = ox + (x0 + x1) / 2; cy = oy + (y0 + y1) / 2;
            break;
          }
          if (halfW != null) break;
        }
      }
    } catch (_) { halfW = null; }
    if (halfW == null && house && house.area > 0) {
      halfW = halfH = Math.sqrt(house.area) / 2;     // a square of the same area
    }
    if (!(halfW > 0) || !(halfH > 0)) { halfW = halfH = cellM / 2; }   // one cell
    const halfDiagCells = Math.hypot(halfW, halfH) / cellM;
    return {
      x: cx, y: cy,
      radiusCells: halfDiagCells + BLAST_HOUSE_PAD_CELLS,
      ringPx: ((halfW + halfH) / 2) * CELL_PX / cellM,
    };
  }

  // Small status message, placed where the player tapped so it stays attached
  // to the thing they touched. `color` is optional — omit for the default ink.
  flash(text, x, y, color) {
    this._toast(text, { tier: 'note', x, y, color });
  }

  // A note ABOUT a thing on the map that isn't where the finger is — a
  // creature that slipped the net (it has moved since the tap), a landmark's
  // quest tick. Seated on the absolute CELL under world point (wmx, wmy) by
  // the same seat as the cell numbers (_energyPopAt: clear of the cell's top
  // edge, or of the player's head on their own cell), never at
  // viewCenterX/Y, which is the camera, not the cell. Falls back to the
  // toast's centred default when nothing projects.
  flashAtWorld(text, wmx, wmy, color) {
    if (this.startWorldM && this.originPx && typeof worldMetersToAbsCell === 'function') {
      const c = worldMetersToAbsCell(this, wmx, wmy);
      this.flashAtCell(text, c.cellIX, c.cellIY, color);
    } else this.flash(text, undefined, undefined, color);
  }
  // The same note, for a known absolute cell (a wall of fire's middle cell).
  flashAtCell(text, ix, iy, color) {
    const at = this._energyPopAt(ix, iy);
    this.flash(text, at.x, at.y, color);
  }
  // A note about the player's BODY ("You catch fire!") — over the
  // character's head at scene.playerScreen() (which follows a peek drag),
  // clear of the energy pop that hangs at ENERGY_POP_HEAD_PX; never at
  // viewCenterX/Y. The toast's centred default when nothing projects.
  flashAtPlayer(text, color) {
    const ps = this.playerScreen ? this.playerScreen() : null;
    const ok = !!ps && isFinite(ps.x) && isFinite(ps.y);
    this.flash(text, ok ? Math.round(ps.x) : undefined,
      ok ? Math.round(ps.y) - ENERGY_POP_HEAD_PX - 22 : undefined, color);
  }

  // ── Energy pops ──────────────────────────────────────────────────────────
  // Every "+N⚡" / "−N⚡" the player can read goes through here, and it is
  // placed ON THE CELL the change belongs to: `opts.ix/iy`, an absolute cell —
  // the plot a till just paid for, the wall a dig just cost — defaulting to the
  // player's own cell when the change is to the body (a rest tick, a slime's
  // leech, an offline refill). The number hangs just clear of that cell's top
  // edge (or of the player's head, on their own cell — see ENERGY_POP_HEAD_PX),
  // which is what tells the eye WHICH cell earned or paid it. The number is
  // the whole mark: until Sep 2026 a thin outline in the same ink also ticked
  // on the cell under it, which read as a flicker of red or green damage on
  // whatever you had just tapped. Don't add a ring back.
  //
  // Seated through the projection (_energyPopAt → worldMetersToScreen /
  // playerScreen), never off viewCenterX/Y: until Sep 2026 the rest splash was
  // a note tier at the viewport centre minus 70px — two cells over anyone's
  // head, and under a peek drag two cells from nowhere in particular — and the
  // slime / monster drains sat 40px above the same point. Falls back to the
  // toast's own centred default when the cell can't be projected (a headless
  // scene, a splash before the camera exists). Text comes from the delta's
  // sign; `opts.label` is appended ("−6⚡ 🟢 slime") and `opts.text` replaces
  // it outright.
  _popEnergy(delta, opts = {}) {
    if (!delta || !this.add) return null;
    const gain = delta > 0;
    const n = Math.abs(delta);
    const text = opts.text ?? `${gain ? '+' : '−'}${n}⚡${opts.label ? ` ${opts.label}` : ''}`;
    const color = opts.color || (gain ? UI_GREEN : UI_DANGER_INK);
    let ix = opts.ix, iy = opts.iy;
    if ((ix == null || iy == null) && this.startWorldM && this.originPx
        && typeof playerReachCell === 'function') {
      const p = playerReachCell(this);
      ix = p.cellIX; iy = p.cellIY;
    }
    return this._popCellNumber(text, color, ix, iy);
  }

  // Any short number ON a cell — the energy pops above, and the "+1" on the
  // cell a coin was just picked from (interact.js 'coindrop'). Seats the text
  // by _energyPopAt (clear of the cell's top edge, or of the player's head on
  // their own cell) and wears the `cell` tier — the seating is what points at
  // the cell, so nothing is drawn ON the ground. Falls back to the toast's
  // centred default when (ix, iy) can't be projected.
  _popCellNumber(text, color, ix, iy) {
    if (!this.add) return null;
    const at = this._energyPopAt(ix, iy);
    return this._toast(text, { tier: 'cell', color, ...at });
  }

  // Small green "+N⚡" on the player when energy is RECOVERED (passive rest,
  // offline rest). No-ops before the viewport centre is known.
  _splashEnergyGain(amount) {
    if (!(amount > 0) || this.viewCenterX == null) return;
    this._popEnergy(amount);
  }

  // Is (ix, iy) the cell the player is standing on? The test _energyPopAt
  // reads to anchor a body pop on the character (their head) rather than on
  // the ground, so a rest tick, a leech or a spend underfoot hangs where the
  // player already is.
  _isPlayerCell(ix, iy) {
    if (ix == null || iy == null) return false;
    if (!this.startWorldM || !this.originPx || typeof playerReachCell !== 'function') return false;
    const p = playerReachCell(this);
    return ix === p.cellIX && iy === p.cellIY;
  }

  // Where an energy pop for abs cell (ix, iy) hangs its text. The player's
  // own cell anchors on the BODY (playerScreen — the feet, which a peek drag
  // slides with the ground) and clears the head; any other cell clears the
  // cell's top edge. Returns {} — the toast's centred default — when nothing
  // can be projected.
  _energyPopAt(ix, iy) {
    if (ix == null || iy == null) return {};
    if (!this.startWorldM || !this.originPx || typeof playerReachCell !== 'function') return {};
    if (this._isPlayerCell(ix, iy) && this.playerScreen) {
      const ps = this.playerScreen();
      if (!ps || !isFinite(ps.x) || !isFinite(ps.y)) return {};
      return { x: Math.round(ps.x), y: Math.round(ps.y) - ENERGY_POP_HEAD_PX };
    }
    return this._cellToastAt(ix, iy, CELL_PX / 2 + ENERGY_POP_LIFT_PX);
  }

  // The absolute cell under a SCREEN point — a tap's own coordinates, so a
  // spend can be shown on the cell that was tapped (screenToWorldMeters is the
  // peek-aware inverse of the projection every tap gate already uses). Null
  // before the camera exists.
  _cellAtScreen(sx, sy) {
    if (sx == null || sy == null || !this.startWorldM || !this.originPx) return null;
    if (typeof worldMetersToAbsCell !== 'function' || !this.screenToWorldMeters) return null;
    const w = this.screenToWorldMeters(sx, sy);
    if (!w || !isFinite(w.x) || !isFinite(w.y)) return null;
    const c = worldMetersToAbsCell(this, w.x, w.y);
    return { ix: c.cellIX, iy: c.cellIY };
  }


  // Shared rest-energy accumulator. Adds `gain` energy onto the named fractional
  // accumulator field, spends whole points into save.energy (capped at maxE),
  // and emits the throttled green "+N⚡" splash. Used by BOTH indoor/home rest
  // and campfire warmth so the two share one mental model (and one bug surface).
  // `quiet` banks the pips with no splash at all — not now, not on the way
  // out: the walk through Home (update()'s settledHome). The bar still moves.
  _accrueRestEnergy(accrueKey, gain, maxE, quiet = false) {
    this[accrueKey] = (this[accrueKey] || 0) + gain;
    const pip = Math.floor(this[accrueKey]);
    if (pip <= 0) return;
    this[accrueKey] -= pip;
    const beforeE = this.save.energy ?? 0;
    Energy.set(this.save, beforeE + pip, maxE);
    const gainedE = this.save.energy - beforeE;
    // Accumulate rest gains and splash a throttled "+N⚡" so a long rest shows
    // periodic ticks rather than one pop per energy pip.
    if (gainedE > 0 && !quiet) {
      this._restSplashAccum = (this._restSplashAccum || 0) + gainedE;
      const tnow = performance.now();
      if (!this._restSplashNextT || tnow >= this._restSplashNextT) {
        this._splashEnergyGain(this._restSplashAccum);
        this._restSplashAccum = 0;
        this._restSplashNextT = tnow + 1200;
      }
    }
    if (this.updateEnergyDOM) this.updateEnergyDOM();
  }

  // True if world point (wx,wy) is within `cells` cells of ANY entry (a {x,y})
  // in save[listKey]. Shared by fauna aversion: scarecrows repel crows/deer and
  // campfires repel the surface slime plus the cave's entry-level monsters
  // (FIRE_WARD_MAX_DEPTH), all at the same radius, so the wander/flight target
  // pickers funnel through one check instead of three copies of the loop.
  // Is a VIEWPOINT's scope (src/scenic.js) within `cells` of (wx, wy)? The
  // campfire rest's second reason (update()'s `fireside`). Surface only; the
  // 3x3 tiles round the feet, each tile's scopes listed once per entry (a
  // rebuilt entry lists its own — generated, re-derived).
  _nearVista(wx, wy, cells) {
    if ((this.depth ?? 0) !== 0 || typeof WorldGen === 'undefined' || !this.playerToWorldCell) return false;
    const r2 = (cells * this.cellM) * (cells * this.cellM);
    const pc = this.playerToWorldCell();
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx + dtx, pc.ty + dty));
        if (!entry || !entry._spawned || !entry.objects) continue;
        const list = entry._vistaScopes || (entry._vistaScopes = entry.objects.filter((o) => o && o.kind === 'vista_scope'));
        for (const o of list) {
          const dx = o.x - wx, dy = o.y - wy;
          if (dx * dx + dy * dy < r2) return true;
        }
      }
    }
    return false;
  }

  _nearAny(listKey, wx, wy, cells) {
    const list = this.save[listKey];
    if (!list || !list.length) return false;
    const r2 = (cells * this.cellM) * (cells * this.cellM);
    for (const e of list) {
      // Wards (scarecrows / fires) only repel on their own level — the world is
      // GPS-mirrored across depths, so a surface ward must not reach a cave
      // creature at the same (x, y). See src/placed_floor.js.
      if (!PlacedFloor.onDepth(e, this.depth)) continue;
      const dx = e.x - wx, dy = e.y - wy;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  // Bigger, longer-dwelling pop for loot pickups (chest opens, treasure X, harvest, debris).
  // Brief scale-up then a slow drift + fade. Always rendered at the player's viewport center
  // so the eye doesn't have to chase it back to where the X used to be.
  // dwellMul scales the hold + fade portion (chest opens use 1.25 for a longer read).
  // iconEl: an optional pre-rendered 28px icon element. Used for forged GEAR
  // (pick / axe / armor), whose art comes from gearIconHTML rather than the
  // ITEM_BY_ID-only renderItemIcon that the `itemId` path uses.
  flashLoot(text, color = UI_GOLD, dwellMul = 1, itemId = null, iconEl = null) {
    // Every "you got something" goes through here, so it's the one place a
    // success buzz needs wiring (UX audit §18).
    this.hapticOk();
    // Loot icon = DOM overlay using the same CSS-background renderer the
    // inventory uses. Going through scene.add.image(sheet) would demand
    // every icon sheet be preloaded into Phaser textures (egg / milk /
    // fish / fruit / etc.); the inventory doesn't need that, it draws
    // straight from disk via background-image. The DOM icon is appended
    // to <body> (matching the inventory bar's anchoring) and re-positioned
    // each frame against #game's CSS-scaled bounding rect.
    iconEl = iconEl || (itemId && this.renderItemIcon
      ? this.renderItemIcon(itemId, 28, 'block') : null);
    const ICON_PX = 28;       // displayed icon side
    const ICON_GAP = 8;       // gap between icon and text inside the bg
    const RESERVE = iconEl ? ICON_PX + ICON_GAP : 0;
    const t = this._toast(text, { tier: 'gain', color, dwellMul, padExtraLeft: RESERVE });
    // THE TIER BADGE (items.js tierBadgeHTML): the item's rarity word on its
    // ore's colour, hung off the toast's right edge and tracked with it, so
    // every "you got something" says how good it is. Same overlay lane as
    // the icon (the .loot-toast-icon class hides both under a dialog).
    let badgeEl = null;
    if (iconEl && itemId && typeof tierBadgeHTML === 'function' && typeof itemTierOf === 'function') {
      const html = tierBadgeHTML(itemTierOf(itemId), 9);
      if (html) {
        badgeEl = document.createElement('span');
        badgeEl.innerHTML = html;
        badgeEl.className = 'loot-toast-icon';
        badgeEl.style.cssText = 'position:fixed;left:0;top:0;z-index:102;pointer-events:none;opacity:0;'
          + 'transform-origin:left center;white-space:nowrap;line-height:0;';
      }
    }
    if (iconEl) {
      // The 'block' icon came back as inline-block — restyle as a fixed
      // overlay we can absolute-position with transform.
      iconEl.classList.add('loot-toast-icon');   // body.modal-open hides it (index.html)
      iconEl.style.position = 'fixed';
      iconEl.style.left = '0px';
      iconEl.style.top  = '0px';
      iconEl.style.zIndex = '102';
      iconEl.style.pointerEvents = 'none';
      iconEl.style.opacity = '0';
      iconEl.style.transformOrigin = 'center center';
      document.body.appendChild(iconEl);
      if (badgeEl) document.body.appendChild(badgeEl);
      // Re-place every frame so the icon tracks the text through pop-in,
      // hold, and drift-up. Cheap — getBoundingClientRect + transform set.
      const gameEl = document.getElementById('game');
      const placeIcon = () => {
        // Runs on the scene 'update' event — INSIDE Phaser's RAF callback but
        // outside MapScene.update()'s try/catch, so a throw here would escape
        // and freeze the whole loop. If the text is already destroyed (a tween
        // onComplete / scene shutdown race could fire between frames), detach
        // and bail; wrap the rest so a transient layout error can't kill taps.
        if (!t || !t.scene || t.active === false) {
          this.events.off('update', placeIcon);
          iconEl.remove();
          badgeEl?.remove();
          return;
        }
        try {
          const r = gameScreenRect() || gameEl.getBoundingClientRect();
          const sx = r.width  / W;   // current CSS scale (uniform — same value either axis)
          const sy = r.height / H;
          const b = t.getBounds();   // Phaser/game coords
          const reserveCentreFromLeft = (10 + RESERVE / 2) * t.scaleX;
          const cx = b.left + reserveCentreFromLeft;
          const cy = (b.top + b.bottom) / 2;
          const px = r.left + cx * sx;
          const py = r.top  + cy * sy;
          // Match the text's current scale (0.6 → 1.0 during pop-in) and alpha.
          iconEl.style.transform =
            `translate(${Math.round(px - ICON_PX / 2)}px, ${Math.round(py - ICON_PX / 2)}px) scale(${t.scaleX})`;
          iconEl.style.opacity = String(t.alpha);
          if (badgeEl) {
            // Just past the text's right edge, on its centre line.
            const bx = r.left + (b.right + 6 * t.scaleX) * sx;
            badgeEl.style.transform = `translate(${Math.round(bx)}px, ${Math.round(py)}px) scale(${t.scaleX})`;
            badgeEl.style.opacity = String(t.alpha);
          }
        } catch (_) { /* keep the loop alive; the destroy handler will clean up */ }
      };
      this.events.on('update', placeIcon);
      // Clean up alongside the text — covers normal completion AND any
      // early scene shutdown (Phaser destroys all GOs on stop).
      t.once('destroy', () => {
        this.events.off('update', placeIcon);
        iconEl.remove();
        badgeEl?.remove();
      });
      placeIcon();
    }
  }

  // Jackpot fanfare for rarity.js' boost-chain rewards. Fires on any jackpot
  // (+1 or larger) since rarity.js now gates the geometric chain at a low
  // jackpotEntryP (~16%) so each fanfare feels earned. Call AFTER flashLoot
  // — stacks above the loot pop at depth 110.
  //
  // `text` overrides the headline (the slot machine's JACKPOT / THREE STARS).
  // While a dialog is open — a chest ceremony, the slot machine — the canvas
  // toast would sit hidden BEHIND it, so the fanfare is set in the DOM above
  // the dialog instead (_domFanfare), in the same colours, larger.
  flashJackpot(n, text) {
    if (!n || n < 1) return;
    const headline = text || `✨ JACKPOT +${n} ✨`;
    if (this._dialogOpen()) { this._domFanfare(headline, UI_GOLD, '#3a1f5a'); return; }
    if (!this.add) return;
    try {
      const t = this._toast(headline,
        { tier: 'fanfare', color: UI_GOLD, bg: '#3a1f5a' });
      this.tweens.add({ targets: t, angle: 4, duration: 320, yoyo: true, repeat: 2, delay: 200, ease: 'Sine.InOut' });
      this._burstAt('jackpot', t.x, t.y);
      // …and CONFETTI off the banner: the one preset, once per colour.
      if (typeof Particles !== 'undefined' && Particles.CONFETTI_COLOURS) {
        for (const colour of Particles.CONFETTI_COLOURS) Particles.burst(this, 'confetti', t.x, t.y, { colour });
      }
    } catch (_) {}
  }

  flashEliteAppearance(count) {
    if (!this.add || this._dialogOpen()) return false;
    const now = performance.now();
    if (now < (this._eliteFanfareUntil || 0)) return false;
    const banner = this._toast(count > 1 ? 'ELITES APPROACH' : 'ELITE APPROACHES',
      { tier: 'fanfare', color: UI_GOLD_DEEP, bg: '#350f1b' });
    this._burstAt('eliteArrival', banner.x, banner.y);
    this._eliteFanfareUntil = now + 3200;
    return true;
  }

  // Is a dialog up right now? Read off the DOM, not body.modal-open: that
  // class is synced by a MutationObserver AFTER the tap's handler, and the
  // fanfare fires in the same handler that just mounted the dialog.
  _dialogOpen() {
    if (typeof document === 'undefined') return false;
    return [...document.querySelectorAll('.game-modal')]
      .some((el) => el.isConnected && el.style.display !== 'none' && el.getClientRects().length > 0);
  }

  // The fanfare as HTML, over whatever dialog is open: the canvas toast's
  // purple chip and gold ink at DOM_FANFARE_PX, popping in with the same
  // overshoot, three wobbles, a hold and the same rise-and-fade, with a ring
  // of gold ✦ thrown off it (the 'jackpot' particle preset's count and reach).
  // Reduced motion keeps only a fade. Never takes a tap (pointer-events:none),
  // so it can't cover the dialog's buttons.
  _domFanfare(text, color, bg) {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('game') || document.body;
    const vs = this.viewSize || VIEW_CELLS * CELL_PX;
    const cx = (this.viewLeft ?? 0) + vs / 2;
    const cy = (this.viewTop ?? 0) + Math.round(vs * DOM_FANFARE_Y_FRAC);
    const el = document.createElement('div');
    el.className = 'dom-fanfare';
    el.textContent = text;
    el.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;z-index:300;pointer-events:none;`
      + `white-space:nowrap;font:700 ${DOM_FANFARE_PX}px ui-monospace,monospace;color:${color};`
      + `background:${bg};padding:8px 18px;border-radius:12px;border:2px solid ${color};`
      + `text-shadow:0 2px 0 #000,0 0 12px ${color}99;box-shadow:0 0 28px ${color}88;`
      + 'transform:translate(-50%,-50%);';
    host.appendChild(el);
    // Never wider than the dialog it crowns: a long headline at full size
    // would run off both edges of a phone's map square, so it shrinks to fit.
    const fit = Math.min(1, (vs - 12) / Math.max(1, el.offsetWidth));
    el.style.transform = `translate(-50%,-50%) scale(${fit})`;   // the reduced-motion fade's resting size
    const at = (dy, sc, rot) => `translate(-50%, calc(-50% + ${dy}px)) scale(${sc * fit}) rotate(${rot}deg)`;
    const HOLD_END = 0.76;   // pop + wobble + hold, then the last quarter fades
    const anim = this._reducedMotion
      ? el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: HOLD_END }, { opacity: 0 }],
          { duration: 2900, fill: 'forwards' })
      : el.animate([
          { transform: at(0, 0.2, 0), opacity: 0 },
          { transform: at(0, 1.1, 0), opacity: 1, offset: 0.075, easing: 'ease-in-out' },
          { transform: at(0, 1, 0), offset: 0.15 },
          { transform: at(0, 1, 4), offset: 0.22 },
          { transform: at(0, 1, -4), offset: 0.33 },
          { transform: at(0, 1, 4), offset: 0.44 },
          { transform: at(0, 1, 0), offset: 0.52 },
          { transform: at(0, 1, 0), opacity: 1, offset: HOLD_END, easing: 'ease-in' },
          { transform: at(-60, 1, 0), opacity: 0 },
        ], { duration: 2900, fill: 'forwards' });
    anim.onfinish = () => el.remove();
    if (this._reducedMotion) return;
    for (let i = 0; i < DOM_FANFARE_SPARKS; i++) {
      const sp = document.createElement('div');
      sp.textContent = '✦';
      sp.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;z-index:301;pointer-events:none;`
        + `font:700 ${14 + Math.round(Math.random() * 10)}px ui-monospace,monospace;color:${color};`
        + 'text-shadow:0 0 6px #fff;transform:translate(-50%,-50%);';
      host.appendChild(sp);
      const a = Math.random() * Math.PI * 2;
      const d = 90 + Math.random() * 110;
      const spin = Math.round(Math.random() * 360);
      sp.animate([
        { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 30}px)) scale(0.2) rotate(${spin}deg)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 400, delay: 120, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'both' })
        .onfinish = () => sp.remove();
    }
  }

  // A rare SHINY find (yellow-tinted flora / tree / animal). Pays 10× the
  // harvested/caught item's value in cash, banks a memory, and fires
  // the shiny fanfare. `baseId` is the plain item id used to read the value
  // (e.g. 'wood', 'apple', 'cow'). Returns the cash awarded.
  awardShinyBonus(baseId, sx, sy) {
    const value = (typeof itemValue === 'function')
      ? itemValue(baseId)
      : (PRICES[baseId] ?? 1);
    const money = Math.max(10, Math.round(value * 10));
    addMoney(this.save, money);
    // A memory: at most ONE per type of interactable (keyed by baseId — the
    // species/kind/produce id); later shinies of the same type still pay the
    // cash windfall but bring back no further memory.
    const name = ITEM_BY_ID[baseId]?.name || Combat.monster(baseId)?.name || baseId;
    const isNew = this._bankDiscovery(baseId, `a shiny ${name}`);
    persistSave(this.save);
    this.flashShiny(money, isNew);
    return money;
  }

  // THE MEMORY LEDGER. One memory per key, ever: `save.discovered` is the
  // set of keys already banked, and this is the only thing that writes it or
  // adds to `save.memories`. Keys are whatever "a thing you can discover once"
  // is — a shiny type's base item id, an elite monster's kind, `house:<id>`
  // for a household's first delivery — all in the one map, so there is one
  // answer to "has this been discovered". Returns true when the memory was
  // banked just now, false when the key was already in the ledger.
  //
  // TWO NUMBERS, ONE LEDGER. Memories recovered = the keys in
  // save.discovered (memoriesTotal); memories UNSPENT = save.memories, a
  // plain counter, which only spendMemories takes from. The HUD chip
  // (updateMemoriesDOM) reads both.
  //
  // EVERY MEMORY HEALS. The moment you feel whole again is literal: the bar
  // goes to the live cap, popped on the body through _popEnergy. A one-shot
  // gain, not a passive rest, so it is not gated on `working`.
  //
  // EVERY BANKED MEMORY TELLS ITS STORY: `label` finishes the sentence "A
  // glimpse of a memory comes back as you find ____" and is queued for the
  // discovery_badge splash. Here, in the one writer, so no memory can land
  // without it. It is QUEUED, never opened on the spot: a memory lands
  // beside other first-time splashes (the first shiny, the first delivery)
  // and opening it first would find those a busy screen and burn nothing —
  // but make them wait a whole shiny. _drainBadgeStories shows the queue
  // one dialog at a time, on a clear screen.
  _bankDiscovery(key, label) {
    const found = this.save.discovered = this.save.discovered || {};
    if (found[key]) return false;
    found[key] = 1;
    this.save.memories = this.memoriesUnspent() + 1;
    const maxE = this.getMaxEnergy();
    const healed = Math.round(maxE - Math.max(0, this.save.energy ?? 0));
    if (healed > 0) {
      Energy.set(this.save, maxE);
      this._popEnergy(healed);
    }
    if (this.updateEnergyDOM) this.updateEnergyDOM();
    if (this.updateMemoriesDOM) this.updateMemoriesDOM();
    MemoryStory.enqueue(this.save, this.memoriesTotal(), label);
    this._seatStoryNeighbours();   // a neighbour this memory brings to the trailer
    this.updateObjectiveDOM?.();
    persistSave(this.save);
    return true;
  }

  // Memories recovered, ever — one per key in the ledger.
  memoriesTotal() {
    return Object.keys(this.save.discovered || {}).length;
  }

  // Memories not yet spent (the wizard's currency). Whole, never negative.
  memoriesUnspent() {
    const n = Math.floor(this.save.memories ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Spend `n` memories. False (nothing spent) when fewer than n are unspent;
  // on success the counter drops, the HUD chip repaints and the save is
  // written. The ONE place save.memories goes down.
  spendMemories(n) {
    n = Math.floor(n);
    if (!(n > 0)) return false;
    const have = this.memoriesUnspent();
    if (have < n) return false;
    this.save.memories = have - n;
    if (this.updateMemoriesDOM) this.updateMemoriesDOM();
    persistSave(this.save);
    return true;
  }

  // Queue from the shared energy display update, covering damage, work and
  // conditions. Keep the request across a busy dialog, healing or a reload.
  _queueLowHealthStory() {
    if (this.save.storySeen?.['health:low'] || this.save.healthLowPending) return;
    const energy = this.save.energy ?? 0;
    if (!(energy > 0)) return;
    Energy.maxEnergy(this.save);
    if (energy > Energy.tiredThreshold(this.save)) return;
    this.save.healthLowPending = true;
    persistSave(this.save);
  }

  _firstSaleStory() {
    if (!this.save.firstSalePending || this.save.storySeen?.['sale:first']) return;
    if (this._storySplashOnce('sale:first', {
      art: 'first_sale', title: 'Fine wares',
      body: "The neighbours offer to buy your fine wares for some 'green'.",
    })) {
      delete this.save.firstSalePending;
      persistSave(this.save);
    }
  }

  _lowHealthStory() {
    this._queueLowHealthStory();
    if (!this.save.healthLowPending || this.save.storySeen?.['health:low']
        || !(this.save.energy > 0) || this._passingOut) return;
    if (this._storySplashOnce('health:low', {
      art: 'health_low', title: 'Running low',
      body: 'Your hands tremble, and every step feels heavier. You need food or a place to rest.',
    })) {
      delete this.save.healthLowPending;
      persistSave(this.save);
    }
  }

  // Opens the next queued memory story once nothing else is up. Rides the
  // modal-gate backstop's throttle in update(), right after the sync, so
  // body.modal-open is fresh when it is read.
  _drainBadgeStories() {
    if (this._drainMacroTransactions()) return;
    MemoryStory.drain(this);
  }

  // THE STORY LEDGER. One story splash per key, ever: `save.storySeen` is
  // the set of first-time moments this save has already been shown (a first
  // delivery, a first shiny, a castle's claim), so a reload can never replay
  // one. Returns true when the splash opened just now.
  //
  // NEVER ON TOP OF ANOTHER MODAL. A first delivery can land while a shop
  // dialog is still up, so this waits for a clear screen (body.modal-open,
  // the same live signal _showTrailIntro waits on) and returns false WITHOUT
  // marking the key seen: the caller falls back to its plain flash, and the
  // next time the moment fires it asks again. Marking seen on a busy screen
  // would burn a first-time moment the player never got to see.
  _storySplashOnce(key, { art, title, body, okLabel, onDismiss } = {}) {
    const seen = this.save.storySeen = this.save.storySeen || {};
    if (seen[key]) return false;
    // The modal-open class lags the DOM by a microtask (it is mirrored off a
    // MutationObserver), and two of the story moments - a first delivery, a
    // castle's claim - fire from inside the accept handler of the modal they
    // just closed, where the class still says busy. Re-sync first so the
    // guard reads the screen as it is, not as it was a click ago.
    this._syncModalGate?.();
    if (document.body?.classList?.contains('modal-open')) return false;
    seen[key] = 1;
    persistSave(this.save);
    this.showMessageModal({ title, body, art, okLabel, onDismiss });
    return true;
  }

  // THE REVIVAL STORYBOARD: three panels, read in order, the first time a
  // save is revived at Home (update()'s hard-mode lockout lift) — out cold,
  // found by villagers, back at Home. Once per save, in the story ledger
  // under 'revive'; a busy screen leaves it unmarked for the next revival,
  // the _storySplashOnce rule. It tells no numbers: the energy the revival
  // gave is the on-screen pop's (_splashEnergyGain), not the story's.
  _reviveStoryboard() {
    const seen = this.save.storySeen = this.save.storySeen || {};
    if (seen.revive) return;
    this._syncModalGate?.();
    if (document.body?.classList?.contains('modal-open')) return;
    seen.revive = 1;
    persistSave(this.save);
    const PANELS = [
      { art: 'revive_fall',  title: 'Out cold', body: 'Your legs give out. You hit the ground, and everything goes dark.' },
      { art: 'revive_found', title: 'Found',    body: 'Villagers find you by lantern light. They lift you gently and carry you home.' },
      // The carer is the villager revive_wake draws; they say nothing, which
      // is the point. What the revival GAVE is the energy pop's to say.
      { art: 'revive_wake',  title: 'Home',     body: 'You wake under a rough blanket beside your trailer. A farmhand nods goodbye.' },
    ];
    const show = (i) => this.showMessageModal({
      ...PANELS[i], kind: 'story',
      okLabel: i < PANELS.length - 1 ? 'Next' : 'OK',
      onDismiss: i < PANELS.length - 1 ? () => show(i + 1) : undefined,
    });
    show(0);
  }

  // FIRST-TOOL-ACTION stories: one splash per action, ever, keyed
  // 'tool:<action>' in the same story ledger as the other first-time
  // moments. Hooked where each action STARTS (the wheel spinning up, the
  // shot loosed, the watering landing) - a dry tap that never runs the
  // action tells no story, and a busy screen just asks again next time.
  _catchStory(creature) {
    if (creature.kind === 'chicken') {
      this._storySplashOnce('catch:chicken', {
        art: 'tool_catch_chicken', title: 'That chicken',
        body: '“You want to catch that chicken,” <em>beckons a voice inside you.</em>',
      });
      return;
    }
    this._toolActionStory('catch');
  }

  _toolActionStory(action) {
    const slot = { till: 'hoe', chop: 'axe', dig: 'pickaxe', water: 'watering_can',
      catch: 'net', sword: 'sword', staff: 'staff', shoot: 'bow' }[action];
    if (!slot || !(this.save.relics?.[slot]?.tier > 0)) return;
    const TOOL_STORIES = {
      till:  { art: 'tool_till',  title: 'First furrow',
               body: 'You pull the hoe through the dry ground, turning up dark, fresh soil.' },
      chop:  { art: 'tool_chop',  title: 'Timber!',
               body: 'Your axe bites into the trunk. Wood chips scatter at your feet.' },
      dig:   { art: 'tool_dig',   title: 'The pick bites',
               body: 'Your pick strikes with a sharp ring. A crack opens in the stone.' },
      water: { art: 'tool_water', title: 'A good soak',
               body: "You tip the can, soaking the soil around your seeds." },
      catch: { art: 'tool_catch', title: 'A careful sweep',
               body: 'You hold your breath and sweep the net through the air.' },
      sword: { art: 'tool_sword', title: 'Steel out',
               body: 'You plant your feet and swing your blade. The movement feels familiar.' },
      staff: { art: 'tool_staff', title: 'First spark',
               body: 'A spark gathers at the tip of your staff. You hold it steady as the light grows.' },
      shoot: { art: 'tool_shoot', title: 'Loose!',
               body: 'You draw the bow and release. The string snaps forward as your arrow flies.' },
    };
    const entry = TOOL_STORIES[action];
    if (entry) this._storySplashOnce('tool:' + action, entry);
  }

  // Completion-only: remember the equipment the job began with, even if
  // another reward changes the inventory while its wheel is running.
  // (BAREHAND_STORY_ASIDE closes both bodies — barehand_story.test.js.)
  _barehandWorkStory(tool, startingTier, isTree = false) {
    if ((this.depth ?? 0) > 0 || startingTier > 0 || !['axe', 'pickaxe', 'hoe'].includes(tool)) return;
    this._storySplashOnce('work:barehands', {
      art: isTree ? 'barehand_tree' : 'barehand_work',
      title: 'Without a tool',
      // Both end on the same aside (owner's copy, Oct 2026): the job got
      // done, and the hint that a tool is the easier way rides the joke.
      body: (isTree
        ? 'You fell the tree with your bare hands. Nearby survivors stare in disbelief.'
        : 'You finish the work with your bare hands before the others can fetch their tools. They stare in disbelief.')
        + BAREHAND_STORY_ASIDE,
    });
  }

  // Shiny-find fanfare — a richer cousin of flashJackpot in warm gold. Headline
  // banner + a money line + a memory line, with a star burst. Call AFTER the
  // loot/catch flash so it stacks above (depth 110). `title` is the headline —
  // the elite kill wears its own.
  flashShiny(money, isNew = true, title = SHINY_FIND_TITLE) {
    if (!this.add) return;
    // The FIRST shiny a save ever finds gets its story splash, ahead of the
    // fanfare toasts. A busy screen returns false unmarked (see the ledger),
    // so the next shiny asks again rather than burning the moment.
    // ONLY for a shiny: the same fanfare also crowns a first delivery to a
    // new house (🏠 NEW DOOR) and an elite kill, and a save whose first
    // fanfare was a delivery was told "A shiny find!" for it.
    if (title === SHINY_FIND_TITLE) this._storySplashOnce('shiny', {
      art: 'shiny_first',
      title: 'A shiny find!',
      body: 'The glow warms your fingertips. You almost remember holding someone’s hand.',
    });
    try {
      const banner = this._toast(title,
        { tier: 'fanfare', color: UI_GOLD_PALE, bg: '#7a5200' });
      this.tweens.add({ targets: banner, angle: 4, duration: 320, yoyo: true, repeat: 2, delay: 200, ease: 'Sine.InOut' });
      // Hangs BELOW the headline (originY 0) rather than above it, which is
      // the whole reason `sub` is its own tier.
      // `money` is what was actually banked alongside the fanfare; a caller
      // that banked none (an elite kill — its bounty lies on the ground as a
      // coin) passes 0 and the line claims only the memory.
      const subText = [money ? `+${money}` : '', isNew ? '🌟 +1 memory' : '']
        .filter(Boolean).join('   ');
      // Pinned 8px under the headline's FINAL y (the banner may have been
      // lifted clear of a loot pop — flashShiny is documented to fire after
      // one) and opted out of stacking, so the pair always reads as one unit
      // instead of the sub wandering off to find its own clear slot.
      if (subText) this._toast(subText, {
        tier: 'sub', color: UI_GOLD_DEEP, originY: 0,
        y: banner.y + 8, stack: false,
      });
      this._burstAt('shiny', banner.x, banner.y);
    } catch (_) {}
  }

  updateHUD() {
    // Runs every frame, so every write in here is guarded on the value having
    // actually changed. Money and energy move a few times a minute at most,
    // but an unguarded textContent/style assignment still costs a style
    // invalidation on each of the ~60 frames a second in between.
    // Money badge always shown.
    if (this.moneyEl) {
      const money = `${this.save.money ?? 0}`;
      if (this._moneyDOM !== money) {
        this._moneyDOM = money;
        // The chip is a coin icon plus a bare number span (#money-num); the
        // icon is the symbol, so the number carries no `$`. Fall back to the
        // chip itself when the span is absent.
        const numEl = document.getElementById('money-num') || this.moneyEl;
        numEl.textContent = money;
      }
      // The chip now holds a real balance, so it can be shown. Until this
      // point body.booting keeps the whole top row off screen: the markup
      // ships "0" and "⚡100/100" as placeholder text, and on a fresh save the
      // scene does not exist for the whole opening story — so the first thing
      // a new player read was a money chip saying 0, which then became 50
      // the moment the world came up. (body.modal-open, which dims these two
      // for a dialog, cannot cover that stretch: it is toggled from the
      // scene's own update loop, and there is no scene yet.)
      document.body.classList.remove('booting');
    }
    this.updateEnergyDOM();
    this.updateMemoriesDOM();
    this.updateRoadChipDOM();
    this.updateBookChipDOM();
    this.updateRelicRow();
    // Debug HUD: only show when GPS is unavailable or unfixed — i.e. an
    // exception case (desktop/wasd, denied permission, still acquiring).
    const gpsLive = this.gpsAvailable && this.gpsM;
    if (gpsLive) {
      if (this._hudDOM !== '') { this._hudDOM = ''; this.hud.textContent = ''; }
      return;
    }
    // 'waiting for GPS…' is genuine live status and stays until a fix lands.
    // The no-GPS movement hint retires the moment the player moves by hand
    // (see _steerManual) — after that it is a permanent line of instructions
    // for something they have already done.
    const text = this.gpsAvailable ? 'waiting for GPS…'
      : (this._steeredManually ? '' : 'no GPS — use the stick or WASD to move');
    if (this._hudDOM !== text) { this._hudDOM = text; this.hud.textContent = text; }
  }

  // Always derive the cap from currently-equipped armor (rather than reading
  // a stale save.maxEnergy that may pre-date the latest armor change). All
  // energy reads/writes funnel through this so the UI and the writer agree.
  getMaxEnergy() {
    return Energy.maxEnergy(this.save);
  }

  // Hard mode's zero-energy lockout. Once the tank reads empty on hard, food
  // (eatSelected), campfire rest and offline/passive rest (applyOfflineRest)
  // all refuse — the ways back are reaching the trailer (the Home rest branch
  // in update(), a quarter bar), eating a Crow Feather or drinking a revival
  // potion (REVIVE_ITEM_FRAC) — never a free full tank. Easy mode has no floor:
  // this is always false there, so every existing recovery path is untouched.
  _zeroEnergyLocked() {
    return Difficulty.isHard() && (this.save.energy ?? 0) <= 0;
  }

  // Equip a bought/forged relic or armor piece into its slot. Armor also
  // recomputes max energy and grants the freshly-unlocked headroom (captured
  // BEFORE mutating armor so the bump is the delta, not the whole new max).
  _equipGear(kind, slot, tier) {
    Gear.equip(this.save, kind, slot, tier);
  }

  // Convert a wall-time gap (since the previous lastSeenAt) into energy and
  // restore it. Called from create() and the visibilitychange handler so the
  // same formula serves both "tab was closed" and "tab was backgrounded".
  applyOfflineRest(gapMs) {
    // Hard mode's zero-energy lockout: time away doesn't revive you either —
    // only the trailer or a Crow Feather does once the tank is empty.
    if (this._zeroEnergyLocked()) return;
    const gained = Energy.applyOfflineRest(this.save, gapMs);
    if (gained > 0 && this.updateEnergyDOM) this.updateEnergyDOM();
    if (gained > 0) this._splashEnergyGain(gained);
  }

  updateEnergyDOM() {
    this._queueLowHealthStory();
    // Element refs are looked up once and kept: the energy widget is static
    // markup in index.html and is never rebuilt. Re-query until found, so a
    // call that somehow lands before the DOM is parsed can't cache nulls.
    let els = this._energyEls;
    if (!els || !els.el) {
      els = this._energyEls = {
        el:    document.getElementById('energy'),
        label: document.getElementById('energy-label'),
        fill:  document.getElementById('energy-bar-fill'),
      };
    }
    const el = els.el;
    if (!el) return;
    const cur = Math.max(0, this.save.energy ?? 0);
    const max = this.getMaxEnergy();
    // Every value written below — the two colours, the label text, the bar
    // width — is a pure function of (cur, max). This is called once per frame
    // from updateHUD, so when neither has moved there is nothing to write:
    // bail before touching the DOM rather than restating the same six values
    // and dirtying style for the next layout pass.
    if (this._energyDOMCur === cur && this._energyDOMMax === max) return;
    this._energyDOMCur = cur;
    this._energyDOMMax = max;
    const pct = max > 0 ? cur / max : 0;
    // Green normally, yellow at/below 30%, red when critically low.
    // Green → GOLD → red. Gold is the interaction colour everywhere else in the
    // HUD, and this gauge is not a control — it was briefly moved to amber for
    // that reason. Reverted on the call that the traffic-light reading is worth
    // more here than the strict colour law: a draining bar is an idiom players
    // already know, and the gauge carries no affordance for gold to confuse.
    const color = pct > 0.30 ? '#a7ffb0' : (pct > 0.10 ? '#ffe066' : '#ff8a7a');
    el.style.borderColor = pct > 0.30 ? '#4a8c4a' : (pct > 0.10 ? '#8c7a2a' : '#a04040');
    const label = els.label;
    // Just the current energy: the bar under it already shows how full it is,
    // and the max rides in the tooltip (the top row is tight on a phone).
    if (label) { label.style.color = color; label.textContent = `⚡${cur}`; }
    else { el.style.color = color; el.textContent = `⚡${cur}`; }
    el.title = `Energy ${cur} of ${max}`;
    const fill = els.fill;
    if (fill) {
      fill.style.width = `${Math.round(pct * 100)}%`;
      fill.style.background = color;
    }
  }

  // ── The memories chip ───────────────────────────────────────────────────
  // A third chip in the top row (#hud-row), beside the energy gauge: the gold
  // star, the memories RECOVERED ever (memoriesTotal), and a corner pip with
  // the UNSPENT count (memoriesUnspent, hidden at 0). Built here rather than
  // in index.html's markup, so its rule rides in with it (MEMORIES_CHIP_CSS);
  // the box is the row's shared chip box, restated, and it dims under
  // body.modal-open exactly like #energy / #money. Tapping it explains itself
  // (showMemoriesHelp) and never reaches the map.
  _buildMemoriesChip() {
    if (typeof document === 'undefined') return;
    const row = document.getElementById('hud-row');
    if (!row) return;
    if (!document.getElementById('memories-style')) {
      const st = document.createElement('style');
      st.id = 'memories-style';
      st.textContent = MEMORIES_CHIP_CSS;
      document.head.appendChild(st);
    }
    let el = document.getElementById('memories');
    if (!el) {
      el = document.createElement('div');
      el.id = 'memories';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Memories');
      const ico = this.renderItemIcon('memory', 18, 'block');
      ico.classList.add('mem-ico');
      const num = document.createElement('span');
      num.className = 'mem-num';
      num.textContent = '0';
      const pip = document.createElement('span');
      pip.className = 'mem-unspent';
      pip.style.display = 'none';
      el.append(ico, num, pip);
      // The chip sits over the map: swallow the press so no tap lands on the
      // world under it, then explain on the click.
      for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown'])
        el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      el.addEventListener('click', (e) => { e.stopPropagation(); this.showMemoriesHelp(); });
      const energy = document.getElementById('energy');
      if (energy && energy.parentNode === row) row.insertBefore(el, energy);
      else row.prepend(el);
    }
    this.memoriesEl = el;
    this._memoriesDOM = null;
    this.updateMemoriesDOM();
  }

  // Paints the chip from the two numbers. Called every frame from updateHUD
  // (guarded on the pair having moved) and at once by every writer.
  updateMemoriesDOM() {
    const el = this.memoriesEl;
    if (!el) return;
    const total = this.memoriesTotal(), unspent = this.memoriesUnspent();
    const key = total + '|' + unspent;
    if (this._memoriesDOM === key) return;
    this._memoriesDOM = key;
    const num = el.querySelector('.mem-num');
    if (num) num.textContent = String(total);
    const pip = el.querySelector('.mem-unspent');
    if (pip) {
      pip.textContent = String(unspent);
      pip.style.display = unspent > 0 ? '' : 'none';
    }
    el.title = `Memories: ${total} recovered, ${unspent} unspent`;
  }

  // ── The road chip ─────────────────────────────────────────────────────
  // Beside the memories chip: how far along the road-repair ladder the next
  // prize is. The numbers are Trail.progress over save.trail — the same pair
  // the on-street counter prints — so the chip and the counter can't disagree
  // (the Runner's shorter rungs come through save.playerClass, as everywhere).
  _buildRoadChip() {
    if (typeof document === 'undefined' || typeof Trail === 'undefined') return;
    const row = document.getElementById('hud-row');
    if (!row) return;
    if (!document.getElementById('roadchip-style')) {
      const st = document.createElement('style');
      st.id = 'roadchip-style';
      st.textContent = ROAD_CHIP_CSS;
      document.head.appendChild(st);
    }
    let el = document.getElementById('roadchip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'roadchip';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Road repair');
      // The road strip is the bar; the total restored sits small beneath it.
      el.innerHTML = ROAD_CHIP_SVG + '<span class="road-num">0km</span>';
      for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown'])
        el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      el.addEventListener('click', (e) => { e.stopPropagation(); this._showRoadChipHelp(); });
      const mem = document.getElementById('memories');
      if (mem && mem.parentNode === row) mem.after(el);
      else row.append(el);
    }
    this.roadChipEl = el;
    this._roadChipDOM = null;
    this.updateRoadChipDOM();
  }

  // The chip's numbers: { pos, target } toward the next road prize.
  roadChipProgress() {
    const st = this.save?.trail || { metres: 0, prizes: 0 };
    return Trail.progress(st.metres, st.prizes, this.save?.playerClass);
  }

  // Paints the chip. Every frame from updateHUD, guarded on the numbers.
  updateRoadChipDOM() {
    const el = this.roadChipEl;
    if (!el || typeof Trail === 'undefined') return;
    const p = this.roadChipProgress();
    const st = this.save?.trail || { metres: 0, prizes: 0 };
    const total = Trail.distanceLabel(Trail.restoredMetres(st, this.save?.playerClass));
    const pos = Math.floor(p.pos), key = pos + '|' + p.target + '|' + total;
    if (this._roadChipDOM === key) return;
    this._roadChipDOM = key;
    // The bar is THIS rung: metres banked toward the next prize.
    const clip = el.querySelector('.road-clip');
    const frac = Math.min(1, Math.max(0, pos / Math.max(1, p.target)));
    if (clip) clip.setAttribute('width', (ROAD_CHIP_W * frac).toFixed(1));
    // The number is the whole walk: every metre restored, 2 significant
    // figures in km — TRUE metres (Trail.restoredMetres: a scenic path's
    // bonus shows in the prizes, never in the distance). The bar already shows the rung, and a full
    // "1200/2000m" pushed the top row into the ☰ button on a 375px phone.
    const num = el.querySelector('.road-num');
    if (num) num.textContent = total;
    el.title = `Road repair: ${total} fixed · ${pos} of ${p.target} m to the next prize`;
  }

  _showRoadChipHelp() {
    const p = this.roadChipProgress();
    // Metres to the next prize, and every metre restored so far (Trail.totalMetres).
    const toGoM = Math.max(0, Math.ceil(p.target - p.pos));   // metres, not a countdown
    const st = this.save?.trail || { metres: 0, prizes: 0 };
    const doneM = Trail.restoredMetres(st, this.save?.playerClass);
    this.flash(`${toGoM}m to go · ${Trail.distanceLabel(doneM)} fixed`, this.viewCenterX, 60);
  }

  // ── The books chip ────────────────────────────────────────────────────
  // After the road chip: how many pages of the Book's course this save has
  // read (play_tips.js bookPagesRead — the bookmark save.tipsRead, capped at
  // the course's length). A tap opens the list of them to read again.
  _buildBookChip() {
    if (typeof document === 'undefined' || typeof bookPagesRead !== 'function') return;
    const row = document.getElementById('hud-row');
    if (!row) return;
    if (!document.getElementById('bookchip-style')) {
      const st = document.createElement('style');
      st.id = 'bookchip-style';
      st.textContent = BOOK_CHIP_CSS;
      document.head.appendChild(st);
    }
    let el = document.getElementById('bookchip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bookchip';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Books read');
      const ico = this.renderItemIcon('book', 18, 'block');
      ico.classList.add('book-ico');
      const num = document.createElement('span');
      num.className = 'book-num';
      num.textContent = '0';
      el.append(ico, num);
      for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown'])
        el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      el.addEventListener('click', (e) => { e.stopPropagation(); this._showBooksRead(); });
      const road = document.getElementById('roadchip');
      if (road && road.parentNode === row) road.after(el);
      else row.append(el);
    }
    this.bookChipEl = el;
    this._bookChipDOM = null;
    this.updateBookChipDOM();
  }

  // Paints the chip. Every frame from updateHUD, guarded on the count.
  updateBookChipDOM() {
    const el = this.bookChipEl;
    if (!el || typeof bookPagesRead !== 'function') return;
    const n = bookPagesRead(this.save).length;
    if (this._bookChipDOM === n) return;
    this._bookChipDOM = n;
    const num = el.querySelector('.book-num');
    if (num) num.textContent = String(n);
    el.title = `Books read: ${n} of ${PLAY_TIPS.length}`;
  }

  // THE SHELF OF PAGES READ: every page of the course this save has turned,
  // newest last, each a row that opens the page again (the same panel the
  // read showed — bookPageHTML on the book painting, no title line) and
  // comes back to the list when that is tapped away. Rereading moves no
  // bookmark: save.tipsRead is the course's, not the shelf's.
  _showBooksRead() {
    if (typeof document === 'undefined' || typeof bookPagesRead !== 'function') return;
    const pages = bookPagesRead(this.save);
    if (!pages.length) {
      this.showMessageModal({ title: '', body: 'No pages read yet. Every Book you find turns one.', art: 'book_read' });
      return;
    }
    const { wrap, box, mount, mkBtn } = this.makeModalShell('books-modal',
      { zIndex: 60, kind: 'story', kindLabel: 'Books read', art: 'book_read', textAlign: 'left' });
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin:4px 0 12px;max-height:46vh;overflow-y:auto;overscroll-behavior:contain;';
    for (const page of pages) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'book-row';
      b.textContent = `${page + 1}. ${bookPageLabel(page)}`;
      b.style.cssText = 'text-align:left;padding:8px 10px;border-radius:6px;background:transparent;color:#eee;' +
        'border:1px solid #6b5a2c;font:600 13px ui-monospace,monospace;cursor:pointer;';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        wrap.remove();
        this.showMessageModal({ title: '', body: bookPageHTML(page), art: 'book_read',
          onDismiss: () => this._showBooksRead() });
      });
      list.appendChild(b);
    }
    box.appendChild(list);
    const close = mkBtn('Close');
    close.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:center';
    row.appendChild(close);
    box.appendChild(row);
    mount();
  }

  // What the memories chip says when tapped.
  // Once the wizard has granted a calling, this is where the player can see
  // which one (Wizard.CLASSES row: its icon, name and blurb).
  // Has the player met the wizard? A restored house frozen as his tower, or a
  // purchase already made from him (an older save whose tower predates the
  // role-freezing). Until then no memory copy names him.
  _metWizard() {
    if (Object.values(this.save.restoredHouses || {}).includes('wizard')) return true;
    return typeof Wizard !== 'undefined' && Wizard.buys(this.save) > 0;
  }

  showMemoriesHelp() {
    const total = this.memoriesTotal(), unspent = this.memoriesUnspent();
    const key = typeof Wizard !== 'undefined' ? Wizard.playerClass(this.save) : null;
    const cls = key ? Wizard.CLASSES.find((c) => c.key === key) : null;
    this.showMessageModal({
      kind: 'memory',
      title: `${total} recovered · ${unspent} unspent`,
      body: MemoryStory.objective(this.save) || (cls ? `Your calling feels familiar: ${cls.icon} ${cls.name}. ${cls.blurb()}`
        : this._metWizard() ? 'The memories hum in your chest. At the Wizard Tower, someone knows how to answer.'
        : 'Each new discovery brings a flicker of recognition. Your old life is finding its way home.'),
      okLabel: 'Got it',
    });
  }

  // ── First-session objective chip ────────────────────────────────────────
  // Renders the active step of the starter ladder (quests.js STARTER_CHAIN)
  // into #objective. One step is shown at a time — the whole point is to
  // answer "what now?" with a single instruction, not a checklist. The chip
  // removes itself once the ladder is finished or the player dismisses it.
  updateObjectiveDOM() {
    const el = document.getElementById('objective');
    if (!el) return;
    if (typeof Quests === 'undefined' || Quests.starterHidden(this.save)) {
      el.style.display = 'none';
      return;
    }
    // With no map tiles loaded there is no road and no crate, so the ladder's
    // "supply crates line the road nearby" reads as a lie over an
    // empty green field. Hold the chip until at least one tile is ready; the
    // #banner is what's talking to the player in that state.
    if (this._tilesReady === 0) { el.style.display = 'none'; return; }
    const step = Quests.starterCurrent(this.save);
    if (!step) { el.style.display = 'none'; return; }
    const idx = Quests.starterStepIndex(this.save);
    el.querySelector('.step').textContent  = `${idx + 1}/${Quests.starterTotal()}`;
    el.querySelector('.title').textContent = step.title;
    el.querySelector('.body').textContent  = step.body;
    el.style.display = 'block';
  }

  // Hide the chip for good (the × button). The ladder keeps tracking quietly
  // underneath, so nothing downstream has to care that it was dismissed.
  dismissObjective() {
    if (typeof Quests === 'undefined') return;
    Quests.starterDismiss(this.save);
    persistSave(this.save);
    this.updateObjectiveDOM();
  }

  // The how-to card's answer: which game this save plays (difficulty.js).
  // Chosen ONCE — the card only asks while save.mode is unset — because the
  // two modes price the same haul differently and a switch mid-game would be
  // a free arbitrage. Everything the mode changes is read live through
  // Difficulty.get(); the only things done HERE are the ones that can't be
  // read at use time because they already happened at boot or tile build:
  // the starting purse, the starter ladder, and the supply crates the starter
  // tile seated before the player answered.
  chooseMode(mode) {
    if (typeof Difficulty === 'undefined' || !Difficulty.isMode(mode)) return false;
    if (Difficulty.isMode(this.save.mode)) return false;   // already answered — the card never re-asks
    const prof = Difficulty.PROFILES[mode];
    this.save.mode = mode;
    Difficulty.setMode(mode);
    // The purse: a fresh save opened at STARTING_MONEY (the easy figure). Only
    // a save that has not been played is re-pursed — the first-run card is the
    // only path here, but the guard keeps a reset-then-answer honest.
    if (typeof SaveState !== 'undefined' && !SaveState.hasPlayed(this.save)) {
      this.save.money = prof.startingMoney;
    }
    if (!prof.tutorial && typeof Quests !== 'undefined') {
      // Finished, not dismissed: a dismissed ladder keeps tracking and paying
      // its step rewards underneath (questEvent), and "no tutorial" means no
      // tutorial money either. This also retires the arrow, the starter plot
      // carve and the home provisioning, which all gate on starterHidden.
      Quests.starterSkipAll(this.save);
      this._starterGoalMemo = null;
    }
    if (!prof.starterCrates) {
      // The starter tile built (and seated its crates) before the card could
      // ask. Sweep every cached tile now; _placeStarterTrail's call sites
      // strip any tile built from here on.
      WorldGen.tileCache?.forEach?.((entry) => this._stripStarterCrates(entry));
    }
    // Same race for the doorstep greeter: a save reads as EASY until the card
    // is answered, so a starter tile built first is standing a chicken there.
    // _placeHomeGreeter swaps a wrong-kind greeter for this mode's own.
    const home = this._starterTileEntry();
    if (home) this._placeHomeGreeter(home.entry, home.tx, home.ty);
    // And the same race for the TRAPS, which is the one the player notices:
    // trapCountMul is 10x on easy against 25x on hard, so a starter tile laid
    // before the card was answered carries under half of hard mode's verge on
    // the one tile a new hard save spends its first minutes walking over. Re-lay every cached surface tile
    // at the density the answer just chose.
    this._relayTrapsForMode();
    persistSave(this.save);
    this.updateObjectiveDOM();
    this.buildInventoryDOM();
    if (this.updateHUD) this.updateHUD();
    return true;
  }
  // ── The trap density race ──────────────────────────────────────────────────
  // Re-lay the roadside traps on every cached SURFACE tile at the active mode's
  // density. The card is answered after boot, so tiles built first were laid at
  // the default-easy rate; this is the trap half of the same repair the crates
  // and the greeter above get.
  //
  // Safe to re-run because a trap is GENERATED, NEVER STORED (CLAUDE.md): the
  // placement is a pure function of (tx, ty) and the count, and the only thing
  // on disk is `save.sprungTraps`. It goes through the tile's OWN `_spawnOpts`
  // — the shared object spawnInTile handed every other spawner — so the road
  // rule stays the one in WorldGen.isSpawnCell rather than a copy of it.
  //
  // Surface only, and only tiles that have already spawned: cave traps are
  // flat-scaled by Traps.DUNGEON_DENSITY_MUL regardless of mode, so there is
  // nothing down there for a mode answer to change, and WorldGen.tileCache is
  // repointed at the current depth.
  //
  // A trap the player has ALREADY SPRUNG is carried across. The new roll draws
  // a different rng sequence (the reservoir size moves with the count), so it
  // need not land on the old cells — and a trap that has bitten you is one you
  // can see, which must not blink out from under you.
  _relayTrapsForMode() {
    if (typeof Traps === 'undefined' || window.__TEST_MODE) return;
    if ((this.depth || 0) !== 0) return;
    const mul = Difficulty.get().trapCountMul;
    const sprung = setOf(this.save.sprungTraps);
    WorldGen.tileCache?.forEach?.((entry, key) => {
      if (!entry || !entry.grid || !entry.roadClass || !entry._spawned) return;
      if (!entry._spawnOpts) return;
      const [, sx, sy] = String(key).split('/');
      const tx = Number(sx), ty = Number(sy);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
      const N = entry.cellsPerEdge;
      // Off the GENERATED grid, like the spawn pass's own roll — the live one
      // carries this player's edits (spawnInTile's genGrid note).
      const genGrid = entry.baseGrid || entry.grid;
      const laid = Traps.spawnSurface(genGrid, entry.roadClass, N, N, tx, ty,
        this.tileEdgeM, entry._ambientSpawnOpts || entry._spawnOpts, mul, entry.zone && entry.zone.under);
      // Keep authored zone/street traps and already-discovered traps, one per cell.
      const cells = new Set(laid.map((t) => t._iy * N + t._ix));
      for (const t of (entry.traps || [])) {
        if ((!t.zoneVariant && !t._street && !sprung.has(t.id)) || cells.has(t._iy * N + t._ix)) continue;
        laid.push(t);
        cells.add(t._iy * N + t._ix);
      }
      entry.traps = laid;
      // …and the same per-player cull the spawn pass ends on.
      this._cullOffLiveGround(entry, tx, ty, N, this.tileEdgeM / N, genGrid,
        entry.genObjects || entry.objects || [], null);
    });
  }

  // The cached tile entry holding the frozen starter anchor, with its tile
  // coords — or null when the anchor hasn't resolved, the tile isn't cached,
  // or we're underground (tileCache is repointed down there). Three passes
  // need "the starter tile, right now" — the crate strip, the greeter, and the
  // retro-place when the anchor freezes late — and asking three different ways
  // is how one of them ends up looking at a tile the others don't.
  //
  // Reads only the FROZEN anchor, never _starterTrailAnchor(): that getter
  // freezes one as a side effect when the origin looks trustworthy, and its
  // callers are all points where a tile is being built (so a GPS fix has
  // landed). chooseMode is not — the card can be answered at boot, before the
  // first fix, and freezing there would pin home to the default projection
  // origin while the player is actually somewhere else. With no anchor yet
  // there is simply nothing cached to act on, and spawnInTile does the work
  // when the real starter tile builds.
  _starterTileEntry() {
    if ((this.depth || 0) !== 0) return null;
    const anchor = this.save.starterCratesAt;
    if (!anchor || !Number.isFinite(anchor.x)) return null;
    const tx = Math.floor(anchor.x / this.tileEdgeM);
    const ty = Math.floor(anchor.y / this.tileEdgeM);
    const entry = WorldGen.tileCache?.get?.(WorldGen.tileKey(tx, ty));
    if (!entry || (entry.status && entry.status !== 'ready') || !entry.grid) return null;
    return { entry, tx, ty };
  }

  // Starter-area setup — see Starter.placeHomeGreeter (src/starter.js).
  _placeHomeGreeter(entry, tx, ty) { return Starter.placeHomeGreeter(this, entry, tx, ty); }
  _placeSafeAreaWarden(entry, tx, ty) { return Starter.placeSafeAreaWarden(this, entry, tx, ty); }
  _seatStoryNeighbours() { return Starter.seatStoryNeighbours(this); }

  // Starter-area setup — see Starter.stripStarterCrates (src/starter.js).
  _stripStarterCrates(entry) { return Starter.stripStarterCrates(this, entry); }

  // Report a gameplay event to the starter ladder. Called from the site that
  // performs the action (open a crate, till, plant, restore, harvest, sell);
  // no-ops unless that event is exactly what the current step is waiting for,
  // so the call sites can fire unconditionally and stay ignorant of the chain.
  questEvent(event) {
    if (typeof Quests === 'undefined') return;
    // The castle board listens to the SAME events the starter ladder does —
    // that shared bus is most of what made a generator cheap to build. All
    // three slots see every event; none of them has an accept step.
    if (Quests.onEvent(this.save, event)) persistSave(this.save);
    const done = Quests.onStarterEvent(this.save, event);
    if (!done) return;
    // Bank the step NOW — the money and the advanced ladder are earned whether
    // or not the player ever looks at the celebration.
    if (done.reward?.money) addMoney(this.save, done.reward.money);
    persistSave(this.save);
    this.buildInventoryDOM();
    this._celebrateStarterStep(done);
  }

  // Say that a starter step just completed: a green toast at the view centre
  // and a 1400 ms hold on the objective chip.
  //
  // Always QUEUED, never played inline, because the first step of the ladder —
  // the one EVERY player completes first — fires from inside the chest
  // handler, one line before it opens the reward modal. Both halves of the
  // celebration then played underneath that card: the toast clipped to a
  // sliver at the modal's top edge, and the chip hold (which body.modal-open
  // hides outright) expiring before the player had tapped through. They came
  // back to a chip reading 2/6 with nothing having acknowledged step 1.
  //
  // Testing "is a modal open?" right here does NOT work and was the first
  // attempt: at that moment the reward modal has not been created and
  // body.modal-open still says no. So the decision waits a frame, for
  // _installModalPadGate's sync to have looked at the real DOM — that sync
  // owns the flush. With no dialog in the way the delay is one frame, which
  // is not perceptible; with one, the cheer waits for it to close.
  //
  // Gated on ANY modal rather than on the chest path specifically, so
  // restoring a wreck (its own ceremony) and any future step that completes
  // behind a dialog get the same treatment without their call sites knowing.
  _celebrateStarterStep(done) {
    (this._pendingStarterCheers = this._pendingStarterCheers || []).push(done);
  }

  _flushStarterCheers() {
    const queued = this._pendingStarterCheers;
    if (!queued || !queued.length) return;
    this._pendingStarterCheers = [];
    // Only the LAST one gets the full ceremony: two cheers racing for the same
    // chip means the first is overwritten mid-hold anyway, and stacking their
    // toasts on one frame just makes an unreadable pile. The rest are already
    // banked; the chip resync at the end of the play shows where the ladder
    // actually stands.
    // Own try/catch: this is also called from _installModalPadGate's
    // MutationObserver callback, which runs outside update()'s guard — a throw
    // escaping from a microtask there is uncatchable by the game loop.
    const quiet = !!this._starterCheerBehindDialog;
    this._starterCheerBehindDialog = false;
    try { this._playStarterCheer(queued[queued.length - 1], { quiet }); }
    catch (e) { this._reportLoopError?.(e); }
  }

  // `quiet`: the step completed behind a dialog, which was the notice — the
  // chip still holds the green ✓, but no toast repeats it.
  _playStarterCheer(done, { quiet = false } = {}) {
    if (!quiet) this.flashLoot(`✅ ${done.title}${done.reward?.money ? ` +${done.reward.money}` : ''}`, '#a7ffb0', 1.3);
    // Hold the COMPLETED step on screen in green for a beat before swapping in
    // the next one, so finishing something is legible instead of an instant
    // relabel. The held text is written from `done` rather than left as
    // whatever the chip happened to show, so two completions in quick
    // succession each get their own flash instead of re-freezing a stale one.
    const el = document.getElementById('objective');
    // No chip on screen (dismissed, or not built yet) — just resync and go.
    if (!el || el.style.display === 'none') { this.updateObjectiveDOM(); return; }
    el.classList.add('done');
    el.querySelector('.step').textContent  = '✓';
    el.querySelector('.title').textContent = done.title;
    el.querySelector('.body').textContent  = done.reward?.money
      ? `Done — ${done.reward.money} coins earned.`
      : 'Done.';
    if (this._objectiveTimer) clearTimeout(this._objectiveTimer);
    this._objectiveTimer = setTimeout(() => {
      el.classList.remove('done');
      this.updateObjectiveDOM();
    }, 1400);
  }

  // Spend energy if the player has enough, returning true on success.
  // Callers (interact.js handlers) refuse the action when this returns false.
  // `cell` ({ ix, iy }, absolute) is the cell the price is shown on; without
  // it the cell under the tap (sx, sy) is used — every interact.js handler
  // hands the tap through, so a till pops its "−2⚡" on the plot it tilled. A
  // spend with neither (the staff's per-bolt cost) is silent, exactly as its
  // "too tired" is: an auto-firing weapon must not spam the map.
  spendEnergy(cost, sx, sy, cell = null) {
    if (cost <= 0) return true;
    const r = Energy.spend(this.save, cost);
    if (!r.ok) {
      if (sx != null && sy != null) this.flash(TOO_TIRED_MSG, sx, sy);
      return false;
    }
    const at = cell || this._cellAtScreen(sx, sy);
    if (at && r.spent > 0) this._popEnergy(-r.spent, at);
    // A spend is work: Home's rest (and a campfire's) stays paused for
    // REST_SETTLE_S after it, so the price just paid isn't handed straight
    // back by the ring the player is standing in. See REST_SETTLE_S.
    if (r.spent > 0) this._holdRest();
    this._warnIfTiring(r.before, sx, sy);
    this.updateEnergyDOM();
    return true;
  }

  // Push the passive rests' resume time out to REST_SETTLE_S from `now`. The
  // one place the hold is written: update() calls it every frame a work
  // wheel is up, spendEnergy on every successful spend.
  _holdRest(now = performance.now()) {
    this._restHoldUntil = now + REST_SETTLE_S * 1000;
  }

  // Flash a "getting tired" warning the first time a drain crosses below 30%
  // energy, so running down toward 0 (where you can't reach at all) isn't a
  // silent surprise. `before` is the energy reading just before the drain;
  // sx/sy are optional and default to the view centre.
  _warnIfTiring(before, sx, sy) {
    // Energy.crossedTired owns the reach-potion guard + 30%-threshold math; this
    // wrapper only fires the flash (defaulting to the view centre).
    if (Energy.crossedTired(this.save, before)) {
      this.flash('Getting tired…', sx != null ? sx : this.viewCenterX,
                                    sy != null ? sy : this.viewCenterY, UI_DANGER_INK);
    }
  }

  // A wreck the player has not restored yet — see Houses.isHouseWreck.
  _isHouseWreck(house) { return Houses.isHouseWreck(this.save, house); }

  // Restoration cost — see Houses.wreckRestoreCost.
  _wreckRestoreCost(house) { return Houses.wreckRestoreCost(this.save, house); }

  presentWreckRestoreModal(sx, sy, house) {
    // WHAT THE WRECK BECOMES IS THE PLAYER'S PICK: the cards on offer are
    // Houses.buildOptions (one owning table, unlocked by how many wrecks
    // already stand), each named the way its sign will be (Shops.roleLabel —
    // the Shop card promises the line the next shop sells, Shops.nextLine).
    // The single-modal guard keeps the count stable while the modal is open;
    // restoreAs re-checks the offer at accept anyway.
    const options = Houses.buildOptions(this.save, house);
    const order = Houses.restoredCount(this.save);
    // EACH CARD HAS ITS OWN PRICE (Houses.buildCost — the House ladder, a
    // shop's stones per tier, the turret's flat five): the cost line shows
    // the selected card's, and the charge at accept is that card's too.
    const costFor = (row) => Houses.buildCost(this.save, house, row, order);
    const costLine = (c) => {
      const held = Inventory.count(this.save, c.id);
      const it = ITEM_BY_ID[c.id];
      return `${c.qty}× ${this.iconSpanHTML(c.id)} ${it?.name || c.id}`
        + (held >= c.qty ? '' : ` <span style="opacity:.7">(have ${held})</span>`);
    };
    const affords = (c) => Inventory.count(this.save, c.id) >= c.qty;
    // A Shop card is named for the line it would open (its variant's theme).
    const labelFor = (row, theme) => row.name
      || Shops.roleLabel(row.role, row.role === 'market' ? (row.theme || theme) : null) || 'House';
    const iconFor = (row) => {
      const texKey = Render.houseTextureKey(row.role, house, this);
      const frame = row.role === 'plain' ? 'front' : row.role === 'wizard' ? 3
        : row.role === 'turret' ? CastleStyles.get(house.id).towerFrame : 0;
      return this.worldIconHTML(texKey, 36, frame);
    };
    const tierOf = (row) => (typeof row.tier === 'function' ? row.tier(this.save, order) : 0);
    // Pick the type first; the second step quotes only that type's available
    // rank. Progression still owns the rank and restoreAs validates the pick.
    const showTypes = (choice = null) => this.showOfferModal({
      kind: 'build',
      title: 'Step 1 of 2 · Building type',
      get: 'Restore this wreck as…',
      choices: options.map((row) => ({
        key: row.key,
        label: labelFor(row, null),
        iconHTML: iconFor(row),
        suggested: !!row.suggested?.(this.save),
      })),
      choice,
      pickHint: 'Choose a building type',
      canAfford: true,
      acceptLabel: 'Next',
      cancelLabel: 'Later',
      onAccept: (key) => showTiers(key),
    });
    const showTiers = (typeKey) => {
      const row = options.find((r) => r.key === typeKey);
      if (!row) return;
      const c = costFor(row);
      const tier = tierOf(row);
      const choices = [{
        key: row.key,
        label: (tier ? tierBadgeHTML(tier, 11) : labelFor(row, null))
          + `<div style="margin-top:6px;font-size:11px">${costLine(c)}</div>`,
        iconHTML: iconFor(row),
        cost: costLine(c),
        canAfford: affords(c),
      }];
      const hasHammer = Inventory.count(this.save, Houses.HAMMER_ID) > 0;
      const hammer = ITEM_BY_ID[Houses.HAMMER_ID];
      this.showOfferModal({
        kind: 'build',
        title: tier ? 'Step 2 of 2 · Tier and cost' : 'Step 2 of 2 · Confirm cost',
        get: labelFor(row, null),
        choices,
        pickHint: 'Choose a tier',
        costLabel: 'Cost',
        canAfford: affords(c),
        acceptLabel: 'Restore',
        cancelLabel: 'Back',
        onCancel: () => showTypes(typeKey),
        blurb: (tier ? 'This quality is available at your current progress.' : '')
          + (hasHammer
            ? `<span style="display:block;margin-top:4px">${this.iconSpanHTML(Houses.HAMMER_ID)} With the ${hammer?.name || 'Magic Hammer'} it gleams: folk deal kindly, archers strike hard.</span>`
            : ''),
        secondary: hasHammer
          ? { label: `${this.iconSpanHTML(Houses.HAMMER_ID)} With Hammer`, withChoice: true,
              takes: (key) => Houses.hammerTakes(options.find((r) => r.key === key)),
              onClick: (key) => restore(key, true) }
          : undefined,
        onAccept: (key) => restore(key, false),
      });
    };
    const restore = (key, hammer) => {
      const picked = options.find((r) => r.key === key);
      const cost = picked ? costFor(picked) : null;
      const item = cost && ITEM_BY_ID[cost.id];
      if (!cost || Inventory.count(this.save, cost.id) < cost.qty) {
        if (cost) this.flash(`need ${cost.qty} ${item?.name || cost.id}`, sx, sy);
        return;
      }
      if (hammer && (Inventory.count(this.save, Houses.HAMMER_ID) < 1 || !Houses.hammerTakes(picked))) hammer = false;
      // Freeze the pick onto the house (the role string, never a bare
      // `true`) and stamp what it owns — the first smithy, the Book Shop,
      // a wizard tower, a shop's line, the hammer's shine. A card no longer
      // on offer (a stale modal) is refused before anything is charged.
      const row = Houses.restoreAs(this.save, house, key, { hammer });
      if (!row) { this.flash('No longer on offer.', sx, sy); return; }
      Inventory.remove(this.save, cost.id, cost.qty);
      if (hammer) Inventory.remove(this.save, Houses.HAMMER_ID, 1);
      this._clampSelSlot();
      const order = Houses.restoredCount(this.save) - 1;   // this restore's 0-based index
      if (row.role === 'wizard') NPC.restoreShrine(this, house);
      persistSave(this.save);
      // THE GATHER FIRST: the road repair's own `stonegather` (the setts
      // pulling back together), thrown off a ring at the walls and drawn in
      // to the footprint's centre, plays for WRECK_GATHER_MS before the
      // blast and the Restored! card. The save, the ledger and the stock
      // have all moved already — only the picture and the card wait.
      const bg = this._houseBlastGeometry(house);
      this._blastAt(bg.x, bg.y, { ringPx: bg.ringPx, gather: 'stonegather' });
      this.buildInventoryDOM();
      this.questEvent('restore');
      this._afterWreckGather(() => {
        // THE BLAST, before the card opens (once the gather has played): the
        // same fanfare a street gets, scaled to a building. The flash covers the footprint's half-diagonal
        // (plus BLAST_HOUSE_PAD_CELLS), the timber chips and the green sparks
        // are thrown off a RING at its half-extent so they come off the walls
        // rather than out of the middle, and the sparks are UI_GREEN — the
        // colour the Restored! card that follows is already set in, so the
        // world and the card read as one event.
        this._blastAt(bg.x, bg.y, {
          radiusCells: bg.radiusCells, ringPx: bg.ringPx,
          chips: 'timber', sparks: 'greenspark',
        });
        if (this.showChestRewardModal) {
          // Name the building, describe what it does, show its painting, and
          // let showChestRewardModal's sparkle burst supply the fanfare. The
          // name is the sign's (Shops.roleLabel — a shop is named for the
          // line it now sells, marketTheme), the blurb and art the row's.
          const theme = row.role === 'market' ? this.marketTheme(house).theme : null;
          const name = labelFor(row, theme);
          const tier = Shops.shopTier(this.save, house, row.role) || 0;
          const blurb = row.key === 'market' ? row.blurb + (Shops.THEME_BLURB[theme] || 'You look over the freshly stocked counter.') : row.blurb;
          this.showChestRewardModal({
            kind: 'build',
            // The banner carries the picture - one art piece per card
            // (restore_house / restore_blacksmith / …), so the card shows
            // the story of the restore.
            iconHTML: '',
            art: row.art,
            header: 'Restored!',
            name: `You restored a ${hammer ? 'shiny ' : ''}${name}`,
            tier,
            sub: (hammer ? 'The walls gleam under the hammer’s work. ' : '')
              + (order === 0 ? "The family stares at the repaired building, amazed. How did you finish so quickly?" : blurb),
            color: '#a7ffb0', accent: '#a7ffb0',
            onDismiss: row.role === 'wizard'
              ? () => MemoryStory.visitWizard(this, () => {}, house) : undefined,
          });
        } else {
          this.flashLoot('🛠 restored', '#a7ffb0', 1.25);
        }
      });
    };
    showTypes();
  }


  // Wood this fort demands to unseal — see Houses.fortUnlockCost / FORT_UNLOCK_WOOD*.
  _fortUnlockCost() { return Houses.fortUnlockCost(this.save); }

  // True iff `house` is a castle still sealed — see Houses.isBuildingSealed.
  _isBuildingSealed(house) { return Houses.isBuildingSealed(this.save, house); }

  // The sealed castle gate — now delegates to the quest board.
  presentSealedBuildingModal(sx, sy, house) {
    this.showQuestBoard(sx, sy, house);
  }

  // WHICH CASTLE this is — see Houses.castleKey.
  _castleKey(house) { return Houses.castleKey(house); }

  // IS THE BUILDING UNDER THIS CELL THE PLAYER'S? — see Houses.isClaimedKey.
  isClaimedKey(key) { return Houses.isClaimedKey(this.save, key); }

  isCastleClaimed(house) { return Houses.isCastleClaimed(this.save, house); }

  _claimCastle(house) { return Houses.claimCastle(this.save, house); }

  // Once-per-castle-per-twelve-hours gate — see Houses.castleServiceUsed.
  _castleServiceUsed(house) { return Houses.castleServiceUsed(this.save, house); }
  _castleServiceWaitMs(house) { return Houses.castleServiceWaitMs(this.save, house); }
  _markCastleServiceUsed(house) { return Houses.markCastleServiceUsed(this.save, house); }

  // Simple yes/no DOM modal. Dismissible. Renders over #game so it scales with the viewport.
  // Inline HTML <span> showing the same Crops.png / Spring Crops.png cell the
  // inventory bar uses. Returns '' if the item has no sprite (fall back to text).
  // Canonical icon renderer — single source of truth used by BOTH inventory
  // slots and modal cost text. Resolves an itemId to a styled <span>:
  //   1. ITEM_DATA_URLS cache  (longgrass / chicken / cow / flowers — map-sprite snapshots)
  //   2. inventoryIconSource() (Crops.png / Spring Crops.png lookup)
  //   3. fallback to the item.icon emoji
  // `style` ('inline' or 'block') controls vertical-align + display so the
  // same function works inside text (modal cost) and as a standalone tile
  // (inventory slot). Returns either an HTMLElement (style='block') or an
  // HTML string (style='inline') — the caller picks based on context.
  renderItemIcon(itemId, sizePx, style = 'inline') {
    const item = ITEM_BY_ID[itemId];
    // Shiny variants (shiny_chicken, …) have no sprite of their own — they
    // reuse the base animal's icon, recoloured with the warm filter applied
    // below. Fall back to `item.base` only when there's no dedicated bake.
    const hasOwnBake = !!(window.ITEM_DATA_URLS && window.ITEM_DATA_URLS[itemId]);
    const iconId = (item && item.base && !hasOwnBake) ? item.base : itemId;
    const dataUrl = window.ITEM_DATA_URLS && window.ITEM_DATA_URLS[iconId];
    const src = (typeof inventoryIconSource === 'function') ? inventoryIconSource(iconId) : null;
    const base = `width:${sizePx}px;height:${sizePx}px;image-rendering:pixelated;`
      + (style === 'inline' ? 'display:inline-block;vertical-align:middle;' : 'display:inline-block;');
    let css = null;
    // Network-fetched sheet URL backing this icon, if any — a data-URL bake
    // paints instantly, but a sheet PNG that isn't in the browser cache yet
    // leaves the span BLANK for however long the fetch takes (seconds on a
    // slow line — most visible as an empty hole in the treasure ceremony).
    // IconNet turns that hole into a pulsing placeholder plate; see below.
    let netUrl = null;
    if (dataUrl) {
      css = base + `background-image:url('${dataUrl}');background-size:${sizePx}px ${sizePx}px;`;
    } else if (src) {
      // Sheet table — ICON_SHEETS, module scope above the class: shared with
      // IconNet's prewarmer, and not rebuilt on every icon render.
      const sheet = ICON_SHEETS[src.sheet] || ICON_SHEETS.crops;
      const col = src.frame % sheet.cols;
      const row = Math.floor(src.frame / sheet.cols);
      const scale = sizePx / 16;
      css = base + `background-image:url('${sheet.url}');`
        + `background-size:${sheet.srcW * scale}px ${sheet.srcH * scale}px;`
        + `background-position:-${col * sizePx}px -${row * sizePx}px;`;
      if (!IconNet.ready(sheet.url)) netUrl = sheet.url;
    }
    // Shiny variants tint the base sprite warm-gold with a sheen.
    if (css && item && item.shiny) {
      css += 'filter:sepia(1) saturate(3.2) hue-rotate(-18deg) brightness(1.08)'
        + ` drop-shadow(0 0 ${Math.max(1, Math.round(sizePx * 0.06))}px #ffd23a);`;
    }
    if (style === 'block') {
      const el = document.createElement('span');
      if (css) {
        el.style.cssText = css;
        if (netUrl) {
          el.className = 'px-icon icon-loading';
          el.dataset.iconsrc = netUrl;
        }
      } else {
        // No sprite source resolved — show a neutral placeholder, never an
        // item-emoji (every catalogued item has a real sprite; a bare dot
        // here surfaces a missing icon source instead of masking it).
        el.textContent = '·';
        el.style.cssText = `display:inline-block;font-size:${Math.round(sizePx * 0.9)}px;line-height:${sizePx}px;`;
      }
      return el;
    }
    // Inline string form (used inside modal cost/get text).
    if (css) {
      return netUrl
        ? `<span class="px-icon icon-loading" data-iconsrc="${netUrl}" style="${css}"></span>`
        : `<span style="${css}"></span>`;
    }
    return '?';
  }

  iconSpanHTML(itemId, sizePx = 20) {
    return this.renderItemIcon(itemId, sizePx, 'inline');
  }

  // The detailed money icon (assets/Icons/coin.png); ground drops use
  // separate coarse art. Deliberately NOT routed through renderItemIcon /
  // ICON_SHEETS — the coin is no item-sheet icon. Three forms:
  //   coinIconHTML  — an inline <img> for modal / list HTML strings
  //   moneyHTML     — that icon plus an amount, for any money readout in HTML
  //   coinIconEl    — the same coin as a DOM element, for flashLoot's iconEl
  coinIconHTML(px = 16) {
    return `<img src="assets/Icons/coin.png?v=2" style="width:${px}px;height:${px}px;image-rendering:pixelated;vertical-align:-2px;" alt="">`;
  }
  moneyHTML(n, px = 16) {
    return `${this.coinIconHTML(px)} ${n}`;
  }
  coinIconEl(px = 28) {
    const el = document.createElement('img');
    el.src = 'assets/Icons/coin.png?v=2';
    el.alt = '';
    el.style.cssText = `width:${px}px;height:${px}px;image-rendering:pixelated;`;
    return el;
  }

  // A WORLD sprite as a DOM icon, by the texture key the renderer draws it
  // with (WORLD_ICON_URLS, baked in create()). renderItemIcon above answers
  // the same question for an ITEM; this one is for a thing on the map that is
  // not in the catalog — the chest or crate a treasure ceremony came out of.
  // A data URL paints instantly, so there is no IconNet hole to cover. Returns
  // '' for a key with no bake, which every caller reads as "use the emoji".
  worldIconHTML(texKey, sizePx = 26, frame = 0) {
    // The boot bake first; a frame it never baked (a building's) is cut on
    // demand by _worldIconUrl.
    const urls = window.WORLD_ICON_URLS;
    const url = (urls && (urls[texKey + ':' + frame] || (frame === 0 ? urls[texKey] : null)))
      || this._worldIconUrl?.(texKey, frame);
    if (!url) return '';
    return `<span style="display:inline-block;width:${sizePx}px;height:${sizePx}px;`
      + `background:url('${url}') center/contain no-repeat;image-rendering:pixelated;`
      + `vertical-align:middle"></span>`;
  }

  // The data URL for one frame of a world texture: the boot bake
  // (WORLD_ICON_URLS, create()) when it has it, else baked NOW from the
  // texture's own frame — a named sub-rect ('front' of the house tileset), a
  // sheet index (the castle tower's style) or a whole image — and cached
  // under the same key. A read-back, but at a tap on a dialog, never on a
  // cell crossing (CLAUDE.md), and once per key for the session. Null when
  // the texture is not loaded, so the caller draws no picture rather than a
  // broken one.
  _worldIconUrl(texKey, frame = 0) {
    const urls = window.WORLD_ICON_URLS = window.WORLD_ICON_URLS || {};
    const k = texKey + ':' + frame;
    const cached = urls[k] || (frame === 0 ? urls[texKey] : null);
    if (cached) return cached;
    if (!this.textures?.exists?.(texKey) || typeof document === 'undefined') return null;
    try {
      const tex = this.textures.get(texKey);
      const fr = tex.get(tex.frameTotal === 1 ? '__BASE' : frame);
      const src = fr?.source?.image || tex.getSourceImage();
      if (!fr || !src || !fr.width || !fr.height) return null;
      const c = document.createElement('canvas');
      c.width = fr.width; c.height = fr.height;
      c.getContext('2d').drawImage(src, fr.cutX, fr.cutY, fr.width, fr.height, 0, 0, fr.width, fr.height);
      return (urls[k] = c.toDataURL());
    } catch (e) { return null; }
  }

  // Every PNG a DOM modal can ask for outside the Phaser preloader: the
  // CSS-clip icon sheets (ICON_SHEETS) plus each gear slot's per-tier art.
  // Handed to IconNet.prewarm shortly after boot (see update()) so the
  // treasure / trade / forge modals open with their icons already cached.
  // FIRST-USE costs, paid while nothing is happening rather than in the
  // middle of a moment: the street restore's blast (its particle textures and
  // emitters) and one text in every toast font. The first restore of a
  // session measured ~18 ms of effects against ~2 ms for the next
  // (render-loop audit, 2026-09-27); the first toast in a font ~5 ms against
  // ~1 ms. The warm text is never drawn — made invisible, destroyed at once.
  _prewarmFx() {
    if (typeof Particles !== 'undefined') Particles.warm(this, ['stone', 'trailspark', 'stonegather']);
    try {
      const fonts = new Set(Object.values(TOAST_TIER).map((t) => fontMono(t.font)));
      for (const font of fonts) this.add.text(-999, -999, '0m', { font }).setVisible(false).destroy();
    } catch (e) { /* a warm-up never breaks the game */ }
  }

  _prewarmModalIcons() {
    const urls = new Set();
    for (const s of Object.values(ICON_SHEETS)) urls.add(s.url);
    for (const kind of ['relic', 'armor']) {
      const defs = kind === 'relic' ? RELIC_DEFS : ARMOR_DEFS;
      for (const slot of Object.keys(defs)) {
        for (const tier of Object.keys(TIER_BY_NUM)) {
          const p = gearAssetPath(kind, slot, Number(tier));
          if (p) urls.add(p);
        }
      }
    }
    // Keep startup prewarming to small icons. Category paintings total about
    // 27 MiB of decoded pixels; opening a modal loads its own painting over
    // the inline PIXEL RESOLVE placeholder instead of decoding them all here.
    IconNet.prewarm([...urls]);
  }

  // Canonical relic / armor icon renderer — used by BOTH the Stats modal and
  // the Buy/Re-roll relic modal so they stay perfectly in sync.
  //
  // The gear PNGs are spritesheets, not single icons:
  //   weapons + armor (Pickaxe.png, Helmet.png, …): 32×16, two 16×16 frames
  //     side-by-side. We show frame 0.
  // CSS-clip via background-image instead of an unclipped <img> — otherwise
  // the entire sheet gets crushed into the icon box ("ring looks like a
  // whole spritesheet", "armor shows 2 suits").
  // Row of obtained-relic icons, anchored top-right just below the
  // money/energy badges. Rebuilds only when the relics signature changes,
  // so calling from updateHUD every frame stays cheap.
  // Play a directional player animation on `sprite`. When dx/dy are supplied
  // (movement frame), updates this._spriteDir so the idle pose holds the last
  // walking direction. Avoids restarting the anim if the key is unchanged.
  // Swap the player between the human sheets and the red dragon while the
  // Dragon Powder is active. Sets _dragonActive so
  // _playDirected routes both sprites through the looping 'dragon-fly' anim,
  // and rescales the 96×96 dragon frames down to roughly the human's size.
  _applyDragonSkin(on) {
    // Guard: if the dragon spritesheet failed to load (e.g. the asset 404s on
    // a deploy), 'dragon-fly' would be a frameless anim and play() would crash
    // on currentFrame.duration. Degrade to no visual transform — the flight
    // buff (free flight + 2× damage) still works off the _dragonUntil
    // timer, which is independent of the skin.
    const ready = on && this.textures.exists('dragon')
      && (this.anims.get('dragon-fly')?.frames?.length > 0);
    this._dragonActive = ready;
    if (ready) this.playerFeetNudgeY = -PLAYER_FEET_DROP_PX * this.playerScale;
    for (const s of [this.player]) {
      if (!s) continue;
      if (ready) {
        s.setScale(this.dragonScale);
        if (s.anims.currentAnim?.key !== 'dragon-fly') s.play('dragon-fly');
      } else {
        s.setScale(this.playerScale);
        s.setFlipX(false);
        this._playDirected(s, 'idle');   // back onto the human sheet the save is owed, facing as before
      }
    }
    // A flying dragon isn't standing on the cell, so its shadow shrinks and
    // fades — the standard "it left the ground" read. Restored on landing.
    // Only the SIZE is set here: the ALPHA is written every frame by
    // _updatePlayerAura, which multiplies the level this form calls for by the
    // ghost fade, so the two can't fight over the property.
    this._syncPlayerSkin();
    if (this.playerShadow) this.playerShadow.setDisplaySize(ready ? 13 : 17, ready ? 5 : 6);
  }
  // Resolve directly from wizard assignment / bicycle deadline every frame,
  // including restored saves. The dragon transform keeps visual priority.
  _syncPlayerSkin() {
    if (!this.player) return;
    const giantScale = PotionEffects.scaleMul(this.save);
    if (this._dragonActive) {
      this.player.setScale(this.dragonScale * giantScale);
      this.playerFeetNudgeY = -PLAYER_FEET_DROP_PX * this.playerScale * giantScale;
      return;
    }
    const desired = SpriteLayout.playerArt(this.save);
    // Is the desired skin's sheet loaded and every directional anim built?
    // Runs every step, so a YES is remembered per skin (`_skinReady`): the
    // answer only ever turns from no to yes as the lazy sheets arrive, and
    // re-deriving it cost a texture lookup plus a dozen anim-key strings a
    // step for a player standing still. A NO is asked again next step.
    const art = desired && (this._skinReady === desired || (this.textures.exists(desired.sheet)
      && Object.keys(desired.directions).every(dir => ['idle', 'walk'].every(state =>
        this.anims.get(`${desired.sheet}-${state}-${dir}`)?.frames?.length > 0))
      && (this._skinReady = desired))) ? desired : null;
    this._playerArt = art;
    this.player.setScale((art?.scale ?? this.playerScale) * giantScale);
    this.playerFeetNudgeY = (art ? -art.footDrop * art.scale : -PLAYER_FEET_DROP_PX * this.playerScale) * giantScale;
  }
  _playDirected(sprite, baseKey, dx, dy) {
    if (dx !== undefined) {
      const d = Math.hypot(dx, dy);
      if (d > 0.001) this._spriteDir = { x: dx / d, y: dy / d };
    }
    const { x, y } = this._spriteDir;
    // Dragon transform: the player flies as a single-direction dragon.
    // Keep the flap looping and just mirror by heading (art faces
    // right at rest), ignoring the human walk/idle directional sheets.
    if (this._dragonActive && sprite === this.player) {
      this._syncPlayerSkin();
      if (sprite.anims.currentAnim?.key !== 'dragon-fly') sprite.play('dragon-fly');
      if (Math.abs(x) > 0.001) sprite.setFlipX(x < 0);
      sprite.anims.timeScale = 1;
      return;
    }
    let dir = 'down';
    if (Math.abs(x) > Math.abs(y)) dir = x < 0 ? 'left' : 'right';
    else if (y < 0) dir = 'up';
    if (sprite === this.player) this._syncPlayerSkin();
    // Every player sheet authors all four directions (SpriteLayout.PLAYER_ART),
    // so nothing is mirrored. Until the skin the save is owed has its sheet
    // and cycles up, the cyan farmer — the base sheet every save starts on —
    // stands in for it (a missing farmer cycle is a no-op in play(), never a
    // crash: anim_guard.test.js).
    const skin = (sprite === this.player && this._playerArt) || SpriteLayout.PLAYER_ART.farmer;
    const key = `${skin.sheet}-${baseKey}-${dir}`;
    if (sprite.anims.currentAnim?.key !== key) sprite.play(key);
    sprite.setFlipX(false);
    // TIRED WALK: eases the CYCLE's frame pace toward WALK_TIRED_SLOW_MUL as
    // energy drains past Lighting.LOW_ENERGY_FRAC — the same weight the reach
    // tint reddens by (Lighting.lowEnergyFrac), so the legs visibly labour in
    // step with the warning colour rather than as a second, independent read
    // of how tired the player is. Idle keeps its own pace (standing still
    // isn't laboured); only the walk cycle sags. Every call sets timeScale,
    // not just a transition into 'walk-*', because Phaser's timeScale lives
    // on the AnimationState rather than the anim — a stale value from a
    // frame ago would otherwise ride along after energy changes.
    if (baseKey === 'walk' && sprite === this.player) {
      const w = (typeof Lighting !== 'undefined' && Lighting.lowEnergyFrac) ? Lighting.lowEnergyFrac(this) : 0;
      sprite.anims.timeScale = 1 - w * (1 - WALK_TIRED_SLOW_MUL);
    } else {
      sprite.anims.timeScale = 1;
    }
  }
  // THE ☰ MENU IS A STANDARD DIALOG. The <details id="menu"> stays the menu's
  // STATE — every entry closes it with `m.open = false` / removeAttribute
  // ('open'), and the modal gate shuts it under any other dialog — but while
  // it is open, its list (#menu-items, with every id-bound handler, the saves
  // rows and the teleport buttons already on it) is MOVED into a
  // makeModalShell box, and moved home again when it closes. One `toggle`
  // listener is the only bridge, so however the menu is closed, the dialog
  // follows. Before create() runs this never installs, and the <details>
  // falls back to its own dropdown panel.
  _installMenuDialog() {
    const menu = document.getElementById('menu');
    const items = document.getElementById('menu-items');
    if (!menu || !items) return;
    this._menuItemsEl = items;
    menu.addEventListener('toggle', () => {
      if (menu.open) this._openMenuDialog();
      else this._closeMenuDialog();
    });
    if (menu.open) this._openMenuDialog();
  }
  _openMenuDialog() {
    const menu = document.getElementById('menu');
    const items = this._menuItemsEl;
    if (!menu || !items || document.getElementById('menu-modal')) return;
    const { box, mount, mkBtn } = this.makeModalShell('menu-modal', {
      kind: 'menu', textAlign: 'left',
      // A tap on the backdrop closes it like any dialog; the shell has
      // already removed the wrap, and the toggle brings the list home.
      onClose: () => { menu.open = false; },
    });
    box.appendChild(items);
    const done = mkBtn('Close', false);
    done.style.marginTop = '10px';
    done.style.alignSelf = 'center';
    done.addEventListener('click', (e) => { e.stopPropagation(); menu.open = false; });
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:center';
    row.appendChild(done);
    box.appendChild(row);
    mount();
  }
  _closeMenuDialog() {
    const menu = document.getElementById('menu');
    const items = this._menuItemsEl;
    if (menu && items && items.parentNode !== menu) menu.appendChild(items);
    document.getElementById('menu-modal')?.remove();
    this._syncModalGate?.();
  }

  // The movement stick is ALWAYS on screen — it's how you walk anywhere the
  // GPS isn't taking you, with or without boots, a buff, or a debug flag.
  // Nothing takes its slot any more. Idempotent, so it's safe to call from the
  // per-frame relic sync, which is what puts it up on the first frame.
  syncMovePad() {
    if (!document.getElementById('move-pad')) this.buildMovePad();
  }
  removeMovePad() {
    document.getElementById('move-pad')?.remove();
    this.joystickVec = { x: 0, y: 0 };
    this._movePadHeld = false;
  }
  // Virtual analog stick — bottom-right above the inventory bar. Fixed to the
  // viewport (outside #game for the usual transform-containing-block reason).
  // Pointer events drive this.joystickVec ∈ [-1, 1]² and _movePadHeld;
  // update() reads both to walk the player off the GPS while held.
  buildMovePad() {
    this.removeMovePad();
    const PAD = 110, NUB = 48;
    const HALF = (PAD - NUB) / 2;     // nub centred in the pad at rest
    const R = HALF;                   // max nub offset from pad centre
    this._installMovePadCss(PAD, NUB, HALF);
    const pad = document.createElement('div');
    pad.id = 'move-pad';
    const nub = document.createElement('div');
    nub.className = 'nub';
    pad.appendChild(nub);
    // The walk-home countdown (see _walkHomeCountdownS): seconds until the
    // character walks itself back to the GPS, drawn over the resting nub.
    const countdown = document.createElement('div');
    countdown.className = 'countdown';
    countdown.setAttribute('aria-hidden', 'true');
    pad.appendChild(countdown);
    this._movePadCountdownEl = countdown;
    this._movePadCountdownText = '';
    document.body.appendChild(pad);

    let activePtr = null;
    const reset = () => {
      activePtr = null;
      // Dropping .held re-arms the nub's transform transition (see the CSS
      // note), so clearing the offset here is what plays the spring-back.
      pad.classList.remove('held');
      nub.style.transform = '';
      this.joystickVec = { x: 0, y: 0 };
      this._movePadHeld = false;
    };
    const place = (e) => {
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > R) { dx = dx / m * R; dy = dy / m * R; }
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joystickVec = { x: dx / R, y: dy / R };
    };
    pad.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      activePtr = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('held');
      this._movePadHeld = true;
      place(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePtr) return;
      e.stopPropagation();
      place(e);
    });
    const release = (e) => {
      if (e.pointerId !== activePtr) return;
      e.stopPropagation();
      reset();
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
    pad.addEventListener('lostpointercapture', reset);
  }
  // The stick's looks live in one injected sheet rather than inline styles:
  // the recessed well, the domed cap and the spring-back all need states and
  // pseudo-elements that a style attribute can't express. Geometry still comes
  // from buildMovePad's constants, so the CSS and the pointer maths can't drift.
  //
  // The shape it's going for: a well sunk into the HUD (dark centre, inner
  // shadow, a lit lower rim) with a brass cap sitting proud of it (top-lit
  // dome, its own drop shadow). The stick is GOLD because gold is the
  // interaction colour — it is the single most-touched control in the game,
  // so it wears the affordance hue at full strength. The dark
  // it legible over a bright map.
  _installMovePadCss(PAD, NUB, HALF) {
    if (document.getElementById('move-pad-css')) return;
    const s = document.createElement('style');
    s.id = 'move-pad-css';
    s.textContent = `
      #move-pad {
        position: fixed;
        /* Placed by fitGame, which measures what is actually left between the
           map's bottom edge and the inventory tabs: centred in that gap when
           the stick fits there, tucked just above the tabs (overlaying the
           map's bottom corner) when it doesn't. The 160px fallback is the old
           fixed offset, used only if the variable is somehow unset. */
        bottom: calc(var(--stick-bottom, 160px) + env(safe-area-inset-bottom, 0px));
        /* Right-anchored via --phone-right so the pad tucks inside the
           simulated phone column on desktop. */
        right: calc(var(--phone-right, 0px) + 16px);
        width: ${PAD}px; height: ${PAD}px; border-radius: 50%;
        z-index: 6; touch-action: none;
        user-select: none; -webkit-user-select: none;
        background:
          radial-gradient(circle at 50% 38%,
            rgba(138,116,64,0.30) 0%,
            rgba(66,52,22,0.48) 58%,
            rgba(28,22,12,0.62) 100%);
        border: 2px solid rgba(200,166,74,0.78);   /* --gold-dark / UI_CONTROL_DIM */
        box-shadow:
          inset 0 3px 12px rgba(0,0,0,0.58),
          inset 0 -2px 6px rgba(255,224,102,0.16),
          0 4px 14px rgba(0,0,0,0.48),
          0 0 0 1px rgba(0,0,0,0.42);
        -webkit-backdrop-filter: blur(3px) saturate(1.15);
        backdrop-filter: blur(3px) saturate(1.15);
        transition: border-color 140ms ease, box-shadow 140ms ease;
      }
      /* Four ticks just inside the rim — N/E/S/W, so the well reads as a
         direction control at a glance instead of a plain circle. */
      #move-pad::before {
        content: ''; position: absolute; inset: 0; border-radius: 50%;
        pointer-events: none; opacity: 0.5;
        background:
          linear-gradient(rgba(255,243,176,1), rgba(255,243,176,1)) 50% 7px / 2px 7px no-repeat,
          linear-gradient(rgba(255,243,176,1), rgba(255,243,176,1)) 50% calc(100% - 7px) / 2px 7px no-repeat,
          linear-gradient(rgba(255,243,176,1), rgba(255,243,176,1)) 7px 50% / 7px 2px no-repeat,
          linear-gradient(rgba(255,243,176,1), rgba(255,243,176,1)) calc(100% - 7px) 50% / 7px 2px no-repeat;
        transition: opacity 140ms ease;
      }
      #move-pad .nub {
        position: absolute; left: ${HALF}px; top: ${HALF}px;
        width: ${NUB}px; height: ${NUB}px; border-radius: 50%;
        /* border-box because HALF is derived as (PAD - NUB) / 2 — that only
           centres the cap in the well if NUB is the cap's OUTER size. Under
           content-box the 2px rim pushed the cap 2px down-and-right of the
           well's centre (and 2px past the rim at full deflection), which is
           what left the countdown digit below looking off-centre on it. */
        box-sizing: border-box;
        pointer-events: none;
        background:
          radial-gradient(circle at 38% 30%,
            rgba(255,247,203,0.97) 0%,
            rgba(255,214,92,0.94) 38%,
            rgba(168,128,40,0.96) 100%);
        border: 2px solid rgba(255,232,150,0.9);
        box-shadow:
          inset 0 -3px 7px rgba(96,72,18,0.55),
          inset 0 2px 4px rgba(255,255,255,0.5),
          0 3px 8px rgba(0,0,0,0.45);
        /* Only the RELEASED nub animates. While .held is on, transform is
           excluded from the transition list so the cap tracks the finger
           1:1; dropping the class on release re-arms it, so clearing the
           inline transform plays as a spring back to centre. */
        transition: transform 170ms cubic-bezier(.22,1,.36,1),
                    box-shadow 140ms ease, border-color 140ms ease;
      }
      /* Held: the well lights up and the cap lifts, so a finger already
         covering the nub still gets feedback from the ring around it. */
      #move-pad.held {
        border-color: rgba(255,224,102,0.95);
        box-shadow:
          inset 0 3px 12px rgba(0,0,0,0.5),
          inset 0 -2px 6px rgba(255,224,102,0.24),
          0 4px 16px rgba(0,0,0,0.45),
          0 0 14px rgba(255,210,58,0.5),
          0 0 0 1px rgba(0,0,0,0.42);
      }
      #move-pad.held::before { opacity: 0.75; }
      #move-pad.held .nub {
        transition: box-shadow 140ms ease, border-color 140ms ease;
        border-color: #fff8d6;
        box-shadow:
          inset 0 -3px 7px rgba(96,72,18,0.5),
          inset 0 2px 4px rgba(255,255,255,0.55),
          0 3px 10px rgba(0,0,0,0.5),
          0 0 12px rgba(255,224,102,0.6);
      }
      /* Walk-home countdown: the seconds until the character heads back to
         the GPS, stamped on the resting cap. Gold, because it is a readout of
         a CONTROL (spec §UI COLOUR LANGUAGE) — the stick it sits on — and its
         box is the cap's box exactly (same left/top/size, and the cap is
         border-box above), so the digit centres on the cap rather than near
         it. The shadow is CENTRED — no x/y offset — a dark halo ringing the
         glyph evenly, so the gold holds up over the cap's bright highlight and
         its darker rim alike without reading as lit from one side. Hidden
         while the stick is held (the cap is under a thumb, and there is
         nothing to count down to). */
      #move-pad .countdown {
        position: absolute; left: ${HALF}px; top: ${HALF}px;
        box-sizing: border-box;
        width: ${NUB}px; height: ${NUB}px; line-height: ${NUB}px;
        text-align: center; pointer-events: none;
        font: ${fontMono(`700 18px/${NUB}px`)};
        color: ${UI_GOLD};
        text-shadow: 0 0 2px rgba(12,9,4,0.95), 0 0 5px rgba(12,9,4,0.8);
        display: none;
      }
      #move-pad .countdown.on { display: block; }
      #move-pad.held .countdown { display: none; }
      /* The spring-back is decoration — the nub is already back at centre as
         far as movement is concerned the moment the finger leaves. */
      @media (prefers-reduced-motion: reduce) {
        #move-pad, #move-pad::before, #move-pad .nub { transition: none; }
      }
    `;
    document.head.appendChild(s);
  }
  // Dev tool (☰ › Developer): call a pack of wild slimes to the edge of the
  // screen. They spawn as ORDINARY surface slimes — same kind, same HP table,
  // same wander/leech/combat behaviour — pushed into the covering tile's
  // creature list, so everything downstream (render, the sim loops, the
  // combat tick) picks them up with no special path. The pack arrives
  // clustered on one random side, just inside the view edge, and oozes in
  // from there (slimes drift toward the player), which is what makes it a
  // usable combat test: the fight starts a moment later, not on your feet.
  // Returns how many actually landed (a spot with no walkable ground — open
  // water, a cave wall — re-rolls a few times, then gives up on that slime).
  debugSpawnSlimePack(n = 6) {
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    // Just inside the view edge: visible the moment they land (so the
    // auto-fire gate sees them too), but a full screen-half from the player.
    const edgeM = (VIEW_CELLS / 2 - 0.5) * this.cellM;
    const heading = Math.random() * Math.PI * 2;   // the side the pack comes from
    let placed = 0;
    for (let i = 0; i < n; i++) {
      // Fan the pack ±~45° around the heading, one slot per slime, with a
      // little jitter so it reads as a mob rather than a picket line. A spot
      // a slime can't stand on re-rolls its jitter, then gives up.
      const slot = (n > 1 ? i / (n - 1) - 0.5 : 0) * 1.6;
      for (let attempt = 0; attempt < 8; attempt++) {
        const a = heading + slot + (Math.random() - 0.5) * 0.35;
        const r = edgeM - Math.random() * this.cellM;
        const x = px + Math.cos(a) * r;
        const y = py + Math.sin(a) * r;
        const entry = this._devSlimeGroundAt(x, y);
        if (!entry) continue;
        entry.creatures = entry.creatures || [];
        this._devSlimeSeq = (this._devSlimeSeq || 0) + 1;
        // Unique per press — never a tile-data id, so a dev slime can't mark
        // a real spawn as caught when it dies.
        entry.creatures.push(WorldGen.makeCreature('slime', x, y,
          `slime_dev_${Date.now()}_${this._devSlimeSeq}`, { shiny: false }));
        placed++;
        break;
      }
    }
    this.flash?.(placed ? `🟢 ${placed} slimes closing in!` : 'No ground for slimes here',
      this.viewCenterX, this.viewCenterY - 40);
    return placed;
  }
  // The cached tile entry covering a world-metre spot, but only if a slime
  // can stand there — walkable terrain on a loaded tile (surface or the
  // current cave level; the tile cache already reflects the active depth).
  _devSlimeGroundAt(wmx, wmy) {
    const tx = Math.floor(wmx / this.tileEdgeM), ty = Math.floor(wmy / this.tileEdgeM);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry || !entry.grid) return null;
    const N = entry.cellsPerEdge || rowCells(this, ty);
    const cellM = this.tileEdgeM / N;   // THIS tile's cells (its row's grid)
    const ix = Math.floor((wmx - tx * this.tileEdgeM) / cellM);
    const iy = Math.floor((wmy - ty * this.tileEdgeM) / cellM);
    if (ix < 0 || iy < 0 || ix >= N || iy >= N) return null;
    if (!WorldGen.isWalkable(entry.grid[iy * N + ix])) return null;
    return entry;
  }
  // Bump _relicsGen at every site that writes save.relics / save.armor so the
  // per-frame row rebuild can early-out by comparing a counter instead of
  // recomputing a join-string of every slot every frame.
  markRelicsDirty() { this._relicsGen = (this._relicsGen || 0) + 1; }
  // Equipped gear lives in the Relics / Armor tabs of the two-bar inventory HUD
  // (buildInventoryDOM); this is the per-frame hook that keeps the movement
  // stick on screen, guarded by a generation counter so it only does work
  // when gear actually changed (markRelicsDirty bumps the counter).
  updateRelicRow() {
    const gen = this._relicsGen || 0;
    const wandUntil = Shrines.leverActive(this.save, 'wand') ? this.save.boonUntil.wand : 0;
    if (this._relicRowGen === gen && this._relicRowWandUntil === wandUntil) return;
    this._relicRowGen = gen;
    this._relicRowWandUntil = wandUntil;
    // The stick doesn't depend on gear any more, but syncing here (idempotent)
    // is what puts it on screen on the first frame.
    this.syncMovePad();
    // Warm the work wheel's tool art for everything equipped, so a wheel's
    // centre is drawn from its first frame rather than after a fetch.
    for (const [slot, eq] of Object.entries(Gear.effectiveRelics(this.save))) {
      if (eq?.tier) this._toolTexture(slot, eq.tier);
    }
    // If a gear tab is currently showing, rebuild the inventory bars so a newly
    // bought/forged/looted relic or armor piece appears immediately.
    const cat = INV_CAT_BY_KEY[this.save.invCat];
    if (cat && cat.gear && typeof this.buildInventoryDOM === 'function') {
      this.buildInventoryDOM();
    }
  }
  gearIconHTML(kind, slot, tier, sizePx = 20) {
    const path = gearAssetPath(kind, slot, tier);
    if (!path) return '';
    // Each gear asset has its own sprite-sheet layout. Pick [cols, rows] + the
    // frame to show so we never squish a multi-frame strip into one cell or
    // crop a single-frame icon:
    //   bags        — 7×1 strip (one bag per tier), frame = tier-1
    //   bug net     — single 16×16 icon
    //   everything else (tools/armor) — 32×16 two-frame sheet, show frame 0
    let sheetCols, sheetRows, frame;
    if (kind === 'relic' && slot === 'bag') {
      sheetCols = 7; sheetRows = 1; frame = tier - 1;
    } else if (kind === 'relic' && slot === 'net') {
      sheetCols = 1; sheetRows = 1; frame = 0;
    } else {
      sheetCols = 2; sheetRows = 1; frame = 0;
    }
    const col = frame % sheetCols;
    const row = Math.floor(frame / sheetCols) % sheetRows;
    const bgW = sheetCols * sizePx, bgH = sheetRows * sizePx;
    // Gear PNGs load only when a modal first shows them — never through the
    // Phaser preloader — so on a cold cache the icon is blank for the whole
    // fetch. IconNet holds the footprint with a pulsing plate until it lands.
    const net = IconNet.ready(path) ? '' : ` class="px-icon icon-loading" data-iconsrc="${path}"`;
    return `<span${net} style="display:inline-block;vertical-align:middle;`
      + `width:${sizePx}px;height:${sizePx}px;image-rendering:pixelated;`
      + `background-image:url('${path}');background-size:${bgW}px ${bgH}px;`
      + `background-position:-${col * sizePx}px -${row * sizePx}px;"></span>`;
  }

  // How many more of `id` would fit right now (0 = full for that item).
  // Thin wrapper over Inventory.roomFor — the stack/cap math lives in
  // inventory.js (headlessly tested). Used by the chest open to detect overflow
  // BEFORE committing ("leave it for later" instead of silently dropping loot).
  invRoomFor(id) {
    return Inventory.roomFor(this.save, id);
  }

  // Add up to `n` of `id` to inventory. The stack/cap/dedupe rules live in
  // Inventory.add (inventory.js); this wrapper owns only the scene side
  // effects: persist + rebuild the inventory DOM, and the deferred 'bag full'
  // flash. Returns the count actually accepted so callers can adjust narration.
  // opts.deferRefresh keeps pickup feedback but lets a transaction commit once
  // through _finishInventoryChange after its payment and deal bookkeeping.
  addToInv(id, n = 1, silent = false, opts = {}) {
    // A book triggers its read (a page of the course, or a chest hint) the
    // instant it's picked up rather than waiting in the bag for a manual
    // Read tap — see readBook / _bookRead / _presentBookRead. It never
    // occupies an inventory slot, so it skips Inventory.add entirely; it
    // still counts as "accepted" for callers that adjust their pickup
    // narration off the return value.
    // opts.deferBookRead: the caller is about to show its OWN "you found a
    // Book" modal (a chest/trail ceremony) right after this call — showing
    // the read modal here too would stack two modals at once. Queue it
    // instead; the caller must fire it from that modal's onDismiss via
    // _revealPendingBookReads(), or the read is never shown.
    if (id === 'book') {
      if (n <= 0) return 0;
      if (!silent) {
        // THE BOOK CLUB's reading (Macros.booksRead): every Book read counts,
        // found or bought — the brake on buying is
        // the counter's price ladder (shops_math.js listPrice), not this.
        this.save.booksRead = (this.save.booksRead || 0) + n;
        this._pendingBookReads = (this._pendingBookReads || 0) + n;
        // deferBookRead: the caller shows its own modal right after and will
        // reveal these itself from that modal's onDismiss. Otherwise reveal
        // now — _revealPendingBookReads shows multiple reads one at a time
        // rather than stacking them, so even a rare qty>1 grant is safe.
        if (!opts.deferBookRead) this._revealPendingBookReads();
      }
      return n;
    }
    const r = Inventory.add(this.save, id, n);
    if (!r.valid) return 0;                      // not a real item / n<=0: no-op, no persist/DOM
    // The wild-finds ledger (items.js homeRecipeLocked): every grant counts
    // unless its caller says it was bought, bartered, forged or crafted.
    if (!opts.notWild) (this.save.foundWild = this.save.foundWild || {})[id] = 1;
    if (!silent) {
      // A brand-new stack surfaces on its own type tab. Switch the active tab
      // and page so the freshly-obtained item is VISIBLE — but never select it:
      // whatever was in the player's hand stays there (or stays nothing).
      // Topping up an existing stack leaves the tab alone.
      if (r.isNewStack && r.accepted > 0) {
        this.save.invCat = invCatForItem(id);
        const newIdx = this.save.inv.findIndex(s => s && s.id === id);
        const pos = this.invDisplayEntriesForCat(this.save.invCat).findIndex(e => e.idx === newIdx);
        this.save.invPage = pos >= 0 ? Math.floor(pos / 5) : 0;
      }
      if (!opts.deferRefresh) this._finishInventoryChange();
    }
    // Flash whenever anything was rejected — that's the player attempting to
    // exceed the cap. Deferred via setTimeout so it can't race a flashLoot the
    // caller fires right after addToInv (back-to-back add.text in the same
    // synchronous chain exhausts Phaser's text-canvas pool under the harness).
    // Coalesced so a bulk drop fires once.
    if (r.rejected > 0 && !silent && typeof this.flash === 'function' && this.add) {
      if (!this._bagFullPending) {
        this._bagFullPending = true;
        setTimeout(() => {
          this._bagFullPending = false;
          try {
            this.flash(BAG_FULL_MSG, this.viewCenterX, this.viewCenterY - 28);
          } catch (_) {}
        }, 0);
      }
    }
    return r.accepted;
  }
  // Commit a completed inventory transaction after its payment and bookkeeping.
  _finishInventoryChange() {
    persistSave(this.save);
    this.buildInventoryDOM();
  }

  // --- Two-bar inventory helpers ------------------------------------------
  // After a spend spliced a stack out (Inventory.remove leaves the re-clamp
  // to its caller): a selection that fell off the end of save.inv becomes
  // "nothing in hand" (-1) — never a neighbouring stack the player didn't
  // pick. A gear selection's -1 is below every length, so it is left alone.
  _clampSelSlot() {
    if (this.save.selSlot >= this.save.inv.length) this.save.selSlot = -1;
  }
  // Filtered, index-tagged stacks for an item category. Each element is
  // { idx, entry } where idx is the real position in save.inv (so selection +
  // every downstream save.inv[selSlot] reader keep working unchanged). Gear
  // without item kinds return [] — equipped entries come from gearEntriesForCat.
  invEntriesForCat(catKey) {
    const cat = INV_CAT_BY_KEY[catKey];
    if (!cat || !cat.kinds) return [];
    const out = [];
    (this.save.inv || []).forEach((entry, idx) => {
      if (!entry || !ITEM_BY_ID[entry.id]) return;
      if (invCatForItem(entry.id) === catKey) out.push({ idx, entry });
    });
    return out;
  }
  // One display order for tab counts, paging and pickups. Fixed-tier relics
  // remain ordinary inventory stacks after the equipped tool/weapon slots.
  invDisplayEntriesForCat(catKey) {
    return [...this.gearEntriesForCat(catKey).map(gear => ({ gear })),
      ...this.invEntriesForCat(catKey)];
  }
  // Owned relic/armor slots for a gear category, in draw order. One per slot —
  // these are equipped gear (save.relics / save.armor), not save.inv stacks.
  gearEntriesForCat(catKey) {
    const cat = INV_CAT_BY_KEY[catKey];
    if (!cat || !cat.gear) return [];
    if (cat.gear === 'relic') {
      const r = Gear.effectiveRelics(this.save);
      return INV_RELIC_ORDER.filter(s => r[s]).map(s => ({ kind: 'relic', slot: s, tier: r[s].tier, temporary: !!r[s].temporary }));
    }
    const a = this.save.armor || {};
    return INV_ARMOR_ORDER.filter(s => a[s]).map(s => ({ kind: 'armor', slot: s, tier: a[s].tier }));
  }
  // Switch the active type tab and re-anchor the selection to that tab's first
  // entry (or empty). Used by the tab buttons.
  // Land the inventory on a tab that has something in it — ONCE, at boot.
  //
  // save.invCat defaults to 'seed' and otherwise persists whatever tab was
  // last open. Either can point somewhere empty on the screen the player
  // arrives at: a fresh save opens on Seeds with nothing in it, and a
  // returning one opens on the tab it was left on, which may have been emptied
  // since. Both read as "my bag is broken" on the one screen that has no
  // history to explain it.
  //
  // Deliberately boot-only, NOT part of buildInventoryDOM: mid-session an open
  // empty tab is a CHOICE (the player tapped it, or just spent the last of a
  // stack and wants to see that), and re-homing under them there would be the
  // UI arguing with the tap they just made. At boot there is no such choice to
  // respect. addToInv already handles the other direction — a new stack pulls
  // its own tab forward.
  _settleInvCatOnBoot() {
    const has = (c) => this.invDisplayEntriesForCat(c.key).length > 0;
    const cur = INV_CAT_BY_KEY[this.save.invCat];
    if (cur && has(cur)) return;               // already showing something
    const stocked = INV_CATS.find(has);
    if (stocked) this.selectInvCat(stocked.key);   // persists + reconciles selection
  }

  selectInvCat(catKey) {
    if (!INV_CAT_BY_KEY[catKey]) return;
    this.save.invCat = catKey;
    this.save.invPage = 0;
    const cat = INV_CAT_BY_KEY[catKey];
    if (cat.gear) {
      this.save.selSlot = -1;
      const list = this.gearEntriesForCat(catKey);
      this.save.selGear = list[0] ? { kind: list[0].kind, slot: list[0].slot } : null;
    } else {
      // An item tab opens with NOTHING selected — the player picks, or doesn't.
      this.save.selGear = null;
      this.save.selSlot = -1;
    }
    persistSave(this.save);
    this.buildInventoryDOM();
  }

  buildInventoryDOM() {
    const PAGE = 5;
    if (!INV_CAT_BY_KEY[this.save.invCat]) this.save.invCat = 'seed';
    if (this.save.invPage == null) this.save.invPage = 0;
    const cat = INV_CAT_BY_KEY[this.save.invCat];
    const gearList = this.gearEntriesForCat(cat.key);
    const itemList = this.invEntriesForCat(cat.key);
    const displayList = this.invDisplayEntriesForCat(cat.key);

    // Reconcile the selection so the highlight always points at something IN
    // the active tab, or at "empty" (-1). A selection that no longer belongs
    // to this tab (the action handlers clamp selSlot to a raw save.inv index
    // that may belong to another category) drops to empty — it is never
    // re-anchored onto the tab's first item, which would put something in the
    // player's hand they didn't choose. We deliberately do NOT move invPage
    // to the selection — paging is driven by ◀ ▶ / tab switches / pickups,
    // not by every rebuild.
    const inCat = this.save.selSlot >= 0 && itemList.some(e => e.idx === this.save.selSlot);
    if (inCat) {
      this.save.selGear = null;
    } else {
      this.save.selSlot = -1;
      const owned = this.save.selGear &&
        gearList.some(g => g.kind === this.save.selGear.kind && g.slot === this.save.selGear.slot);
      if (!owned) this.save.selGear = null;
    }

    // Tabs holding inventory stacks keep one trailing empty-hand slot, even
    // when they also contain equipped gear. Armor remains gear-only.
    const cellCount = displayList.length + (cat.kinds ? 1 : 0);
    const pageCount = Math.max(1, Math.ceil(Math.max(1, cellCount) / PAGE));
    if (this.save.invPage >= pageCount) this.save.invPage = pageCount - 1;
    if (this.save.invPage < 0) this.save.invPage = 0;

    // ── Type-selector bar (TOP of the two-bar HUD) ────────────────────────
    let tabs = document.getElementById('inv-tabs');
    if (tabs) tabs.remove();
    tabs = document.createElement('div');
    tabs.id = 'inv-tabs';
    // position:fixed + appended to <body> for the same containing-block reason
    // as the item bar below. Sits just above the item bar.
    tabs.style.cssText = 'position:fixed;bottom:calc(118px + env(safe-area-inset-bottom, 0px));left:var(--phone-left, 0px);right:var(--phone-right, 0px);display:flex;justify-content:flex-start;align-items:stretch;gap:2px;padding:0 6px;z-index:6;pointer-events:auto;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;';
    for (const c of INV_CATS) {
      const active = c.key === this.save.invCat;
      const count = this.invDisplayEntriesForCat(c.key).length;
      const tab = document.createElement('button');
      tab.dataset.cat = c.key;
      tab.title = c.label;
      // Layout inline, paint from .hud-tab / .hud-tab.sel (index.html).
      tab.className = active ? 'hud-tab sel' : 'hud-tab';
      tab.style.cssText =
        'position:relative;flex:1 0 44px;min-width:44px;height:44px;border-radius:7px 7px 0 0;cursor:pointer;' +
        'font-size:16px;line-height:1;display:flex;flex-direction:column;align-items:center;' +
        'justify-content:center;gap:1px;padding:0;overflow:hidden;';
      // Glyph in its own span so the desaturation targets ONLY the emoji — the
      // count pip below keeps its full colour. The active tab shows its glyph in
      // full colour; inactive tabs render greyscale + dimmed so the lit-up tab
      // reads as the current category at a glance.
      const glyph = document.createElement('span');
      glyph.textContent = c.sym;
      glyph.style.cssText = 'line-height:1;' + (active ? '' : 'filter:grayscale(1) opacity(0.55);');
      tab.appendChild(glyph);
      // Word under the glyph. Seven unlabelled emoji left a new player guessing
      // which one holds seeds — and the seed tab is the first thing the starter
      // ladder asks them to find. `title` alone doesn't help on a touch device,
      // where there is nothing to hover.
      const caption = document.createElement('span');
      caption.textContent = c.label;
      caption.style.cssText =
        'font:700 7px ui-monospace,monospace;letter-spacing:-0.2px;line-height:1;' +
        'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
        (active ? 'color:#ffe066;' : 'color:#999;');
      tab.appendChild(caption);
      // An EMPTY tab reads as empty: without this a fresh save's Relics and
      // Armor tabs looked identical to stocked ones bar a missing pip (UX audit
      // §20). The active tab always stays full strength — you're looking at it.
      if (!count && !active) tab.style.opacity = '0.45';
      // Tiny count pip so the player can see at a glance which tabs hold gear.
      if (count > 0) {
        const pip = document.createElement('span');
        pip.textContent = count;
        pip.className = 'hud-pip';
        pip.style.cssText = 'position:absolute;top:-2px;right:1px;font:700 9px ui-monospace,monospace;padding:0 3px;border-radius:7px;line-height:13px;';
        tab.appendChild(pip);
      }
      tab.addEventListener('click', (e) => { e.stopPropagation(); this.selectInvCat(c.key); });
      tabs.appendChild(tab);
    }
    document.body.appendChild(tabs);
    tabs.querySelector('.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    // ── Item / gear slot bar (BOTTOM of the two-bar HUD) ──────────────────
    let bar = document.getElementById('inv');
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.id = 'inv';
    // The bar is the OPEN DRAWER under the tab row: painted --tab-brown, the
    // same colour the selected tab fades into (index.html .hud-tab.sel), so
    // the active tab and the panel below it read as one surface.
    bar.style.cssText = 'position:fixed;bottom:calc(66px + env(safe-area-inset-bottom, 0px));left:var(--phone-left, 0px);right:var(--phone-right, 0px);display:flex;justify-content:center;align-items:center;gap:3px;padding:4px;z-index:6;pointer-events:auto;background:var(--tab-brown, #4a3a17);';

    // 40×44, not 28×42: this is a one-handed outdoor game and the pager sat
    // well under the 44px guideline (QC/UX audit §13).
    const makeBtn = (txt, onclick, w = 40) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.className = 'hud-btn';
      b.style.cssText = `width:${w}px;height:44px;border-radius:6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;`;
      b.addEventListener('click', (e) => { e.stopPropagation(); onclick(); });
      return b;
    };

    // Sort (item tabs only) — group by kind then alphabetical by name. Selection
    // is re-anchored to the same item id so the highlight follows the resort.
    const KIND_ORDER = { produce: 0, seed: 1, animal: 2 };
    if (cat.kinds) {
      bar.appendChild(makeBtn('⇅', () => {
        const selId = this.save.inv[this.save.selSlot]?.id;
        this.save.inv = [...this.save.inv].sort((a, b) => {
          const ia = ITEM_BY_ID[a.id], ib = ITEM_BY_ID[b.id];
          const ka = KIND_ORDER[ia?.kind] ?? 9, kb = KIND_ORDER[ib?.kind] ?? 9;
          if (ka !== kb) return ka - kb;
          return (ia?.name || a.id).localeCompare(ib?.name || b.id);
        });
        if (selId != null) {
          const newIdx = this.save.inv.findIndex(e => e.id === selId);
          if (newIdx >= 0) {
            this.save.selSlot = newIdx;
            const pos = this.invDisplayEntriesForCat(this.save.invCat).findIndex(e => e.idx === newIdx);
            if (pos >= 0) this.save.invPage = Math.floor(pos / PAGE);
          }
        }
        persistSave(this.save); this.buildInventoryDOM();
      }));
    }
    // ◀ ▶ and the page plate only exist when the category actually spans more
    // than one page. Most do not, and three dead controls on a bar that is
    // already wider than the 352px column (5×42 slots + 3×40 buttons + the
    // plate) cost both space and attention for nothing.
    const paged = pageCount > 1;
    if (paged) {
      bar.appendChild(makeBtn('◀', () => {
        this.save.invPage = (this.save.invPage - 1 + pageCount) % pageCount;
        persistSave(this.save); this.buildInventoryDOM();
      }));
    }

    const slotCss = 'position:relative;width:42px;height:42px;flex:0 0 42px;border-radius:6px;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    const startPos = this.save.invPage * PAGE;
    for (let s = 0; s < PAGE; s++) {
      const p = startPos + s;
      const slot = document.createElement('button');
      slot.className = 'hud-slot';
      slot.style.cssText = slotCss;
      if (displayList[p]?.gear) {
        const g = displayList[p].gear;
        if (g) {
          slot.dataset.gear = `${g.kind}:${g.slot}`;
          slot.title = (typeof gearName === 'function') ? gearName(g.kind, g.slot, g.tier) : g.slot;
          const wrap = document.createElement('span');
          wrap.style.cssText = 'display:inline-block;line-height:0;';
          wrap.innerHTML = this.gearIconHTML(g.kind, g.slot, g.tier, 32);
          slot.appendChild(wrap);
          // Rarity uses the shared word/color badge; numeric tiers stay internal.
          const badge = document.createElement('span');
          badge.innerHTML = tierBadgeHTML(g.tier, 6, 2);
          badge.style.cssText = 'position:absolute;bottom:1px;left:50%;transform:translateX(-50%);line-height:10px;';
          slot.appendChild(badge);
          if (g.temporary) {
            const temporary = document.createElement('span');
            temporary.textContent = '⏳';
            temporary.title = 'Temporary equipment';
            temporary.style.cssText = 'position:absolute;top:1px;right:2px;font-size:10px;';
            slot.appendChild(temporary);
          }
          // "E" (Equipped/active) badge — only the weapon currently doing the
          // auto-engage/auto-fire (save.activeWeapon) wears it, opposite corner
          // from the tier badge so the two never collide.
          const isWeapon = g.kind === 'relic' && WEAPON_SLOTS.includes(g.slot);
          if (isWeapon && Gear.activeWeapon(this.save) === g.slot) {
            const eBadge = document.createElement('span');
            eBadge.textContent = 'E';
            eBadge.title = 'Active weapon';
            eBadge.className = 'hud-badge';
            eBadge.style.cssText = 'position:absolute;top:1px;left:2px;font-size:10px;padding:0 3px;border-radius:3px;line-height:12px;background:#ffe066;color:#3a3322;';
            slot.appendChild(eBadge);
          }
          slot.addEventListener('click', (e) => {
            e.stopPropagation();
            this.save.selGear = { kind: g.kind, slot: g.slot };
            this.save.selSlot = -1;
            // Highlighting a weapon is just that. Until Oct 2026 the tap
            // also made it the active one, so reading a bow's blurb silently
            // switched the fight off melee; the Equip button under the bar
            // (syncEquipButton) is the explicit act now.
            persistSave(this.save);
            this.refreshInventoryHighlight();
          });
        } else {
          // Empty gear well — no glyph. '·' is reserved for MISSING ART
          // (QC_RULES §1); using it here made five empty slots read as five
          // broken icons on a fresh save.
          slot.textContent = '';
          slot.style.cursor = 'default';
        }
      } else if (displayList[p]?.entry) {
        const { idx, entry } = displayList[p];
        const item = ITEM_BY_ID[entry.id];
        slot.dataset.slot = idx;
        slot.title = item ? `${item.name}${entry.count != null ? ' ×' + entry.count : ''}` : 'empty';
        if (item) slot.appendChild(this.renderItemIcon(item.id, 32, 'block'));
        else slot.textContent = '·';
        if (entry.count != null) {
          const badge = document.createElement('span');
          if (item?.kind === 'unique_relic') {
            badge.innerHTML = tierBadgeHTML(itemTierOf(item.id), 6, 2);
            badge.style.cssText = 'position:absolute;bottom:1px;left:50%;transform:translateX(-50%);line-height:10px;';
            if (entry.count > 1) {
              const count = document.createElement('span');
              count.textContent = entry.count;
              count.className = 'hud-badge';
              count.style.cssText = 'position:absolute;top:1px;right:2px;font-size:10px;';
              slot.appendChild(count);
            }
          } else {
            badge.textContent = entry.count;
            badge.className = 'hud-badge';
            badge.style.cssText = 'position:absolute;bottom:1px;right:2px;font-size:10px;padding:0 3px;border-radius:3px;line-height:12px;';
          }
          slot.appendChild(badge);
        }
        slot.addEventListener('click', (e) => {
          e.stopPropagation();
          // Tapping the already-selected stack deselects it (empty hand)
          // rather than re-selecting itself as a no-op tap.
          this.save.selSlot = (this.save.selSlot === idx) ? -1 : idx;
          this.save.selGear = null;
          persistSave(this.save);
          this.refreshInventoryHighlight();
        });
      } else if (cat.kinds && p === displayList.length) {
        // The single trailing EMPTY slot — selecting it means "nothing held",
        // which a shop reads as buy intent. dataset.slot = -1.
        slot.dataset.slot = -1;
        slot.title = 'empty';
        slot.textContent = '';
        slot.addEventListener('click', (e) => {
          e.stopPropagation();
          this.save.selSlot = -1;
          this.save.selGear = null;
          persistSave(this.save);
          this.refreshInventoryHighlight();
        });
      } else {
        // Filler beyond the list — inert, and blank for the same reason.
        slot.textContent = '';
        slot.style.cursor = 'default';
      }
      bar.appendChild(slot);
    }
    if (paged) {
      bar.appendChild(makeBtn('▶', () => {
        this.save.invPage = (this.save.invPage + 1) % pageCount;
        persistSave(this.save); this.buildInventoryDOM();
      }));
      const pageLbl = document.createElement('span');
      pageLbl.textContent = `${this.save.invPage + 1}/${pageCount}`;
      pageLbl.className = 'hud-page';
      pageLbl.style.cssText = 'min-width:28px;height:22px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #4a4238;border-radius:11px;font:700 11px ui-monospace,monospace;margin-left:4px;';
      bar.appendChild(pageLbl);
    }

    document.body.appendChild(bar);

    // Name plate — shows the selected item / gear name + effect line. Its own
    // struck box (.hud-name, index.html), stacked with NO gap between the
    // slot bar above (bottom:66) and the Eat/Read/Drink button below
    // (bottom:4..40) — same touching-edges convention as the tabs sitting
    // directly on the slot bar. Giving it a fixed box (instead of bare
    // floating text) is what stops the name/effect line from running under
    // the icons above or getting covered by the action button below.
    let nameLbl = document.getElementById('inv-name');
    if (nameLbl) nameLbl.remove();
    nameLbl = document.createElement('div');
    nameLbl.id = 'inv-name';
    nameLbl.className = 'hud-name';
    nameLbl.style.cssText = 'position:fixed;bottom:calc(40px + env(safe-area-inset-bottom, 0px));left:calc(var(--phone-left, 0px) + 6px);right:calc(var(--phone-right, 0px) + 6px);height:26px;border-radius:6px;box-sizing:border-box;padding:0 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;text-align:center;font:12px/14px ui-monospace,monospace;pointer-events:none;z-index:6;text-shadow:1px 1px 2px #000,0 0 3px #000;';
    document.body.appendChild(nameLbl);

    this.refreshInventoryHighlight();
  }
  // The ✦ effect line under the selected stack or relic. It is one nowrap
  // line with an ellipsis, so a long description is cut off on a narrow
  // phone — TAPPING it opens the whole sentence in a message dialog. The
  // strip it sits in (#inv-name) is pointer-events:none so it never eats a
  // tap meant for the map; only this line opts back in.
  _effectLineEl(text, titleHTML) {
    const fx = document.createElement('div');
    fx.textContent = `✦ ${text}`;
    fx.style.cssText = 'font:10px/12px ui-monospace,monospace;color:#9fe6ff;opacity:0.92;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:auto;cursor:pointer;';
    fx.addEventListener('pointerdown', (e) => e.stopPropagation());
    fx.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showMessageModal({ title: titleHTML, body: `✦ ${text}` });   // catalog text, static — no markup in it
    });
    return fx;
  }
  refreshInventoryHighlight() {
    const bar = document.getElementById('inv');
    if (!bar) return;
    const cat = INV_CAT_BY_KEY[this.save.invCat] || INV_CAT_BY_KEY.seed;
    const isGear = !!cat.gear && this.save.selSlot < 0;
    const gearKey = this.save.selGear ? `${this.save.selGear.kind}:${this.save.selGear.slot}` : null;
    [...bar.querySelectorAll('button[data-slot],button[data-gear]')].forEach(el => {
      let isSel;
      if (el.dataset.gear != null) isSel = el.dataset.gear === gearKey;
      else isSel = +el.dataset.slot === this.save.selSlot;
      // .sel carries the whole selected look (gold rim + glow, lit well) —
      // see .hud-slot in index.html. Inline paint here would outrank it.
      el.classList.toggle('sel', isSel);
    });
    const nameLbl = document.getElementById('inv-name');
    if (nameLbl) {
      nameLbl.textContent = '';
      if (isGear) {
        const g = this.save.selGear;
        if (!g) {
          // Empty gear tab — tell the player where this gear comes from.
          const hint = document.createElement('div');
          hint.textContent = cat.key === 'armor'
            ? 'No armour yet — forge or find it'
            : this.invDisplayEntriesForCat(cat.key).length ? 'Select a relic' : 'No relics yet — forge or find them';
          hint.style.cssText = 'opacity:0.7;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          nameLbl.appendChild(hint);
        } else {
          const nameSpan = document.createElement('div');
          nameSpan.textContent = (typeof gearName === 'function') ? gearName(g.kind, g.slot, (g.kind === 'armor' ? this.save.armor : Gear.effectiveRelics(this.save))?.[g.slot]?.tier) : g.slot;
          nameSpan.style.cssText = 'max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          nameLbl.appendChild(nameSpan);
          const def = gearDef(g.kind, g.slot);
          if (def && def.blurb) {
            const tier = (g.kind === 'armor' ? this.save.armor : Gear.effectiveRelics(this.save))?.[g.slot]?.tier;
            nameLbl.appendChild(this._effectLineEl(def.blurb,
              `${this.gearIconHTML(g.kind, g.slot, tier)} ${nameSpan.textContent}`));
          }
        }
      } else {
        const sel = this.save.inv[this.save.selSlot];
        const it = sel && ITEM_BY_ID[sel.id];
        if (it) {
          const nameTxt = sel.count != null ? `${it.name} ×${sel.count}` : it.name;
          const effect = (typeof ITEM_EFFECTS !== 'undefined') ? ITEM_EFFECTS[sel.id] : null;
          const nameSpan = document.createElement('div');
          nameSpan.textContent = nameTxt;
          nameSpan.style.cssText = 'max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          nameLbl.appendChild(nameSpan);
          if (effect) {
            nameLbl.appendChild(this._effectLineEl(effect,
              `${this.iconSpanHTML(sel.id)} ${it.name}`));
          }
        }
      }
    }
    this.syncEatButton();
    this.syncConsumableButton();
    this.syncEquipButton();
  }

  // Equip / Unequip button — the Eat button's slot, shown while a WEAPON is
  // highlighted in the Relics tab. Gear selection clears selSlot; selecting
  // a carried relic clears selGear, so its Eat / Use action appears instead.
  // Equip makes the highlighted weapon fight (Gear.selectWeapon). Unequip
  // puts a ranged weapon away: back to the sword, or bare hands if no sword
  // is owned (Gear.unequipWeapon). An active melee weapon needs no
  // button: melee is the default state, so there is nothing to put away.
  // This is the ONE way the active weapon changes by hand; tapping a slot
  // only highlights it.
  syncEquipButton() {
    const g = this.save.selGear;
    const existing = document.getElementById('equip-btn');
    const cat = INV_CAT_BY_KEY[this.save.invCat];
    const isWeapon = !!cat?.gear && g?.kind === 'relic' && WEAPON_SLOTS.includes(g.slot)
      && !!Gear.effectiveRelics(this.save)[g.slot];
    if (!isWeapon) { existing?.remove(); return; }
    const active = Gear.activeWeapon(this.save) === g.slot;
    const ranged = Combat.RANGED_SLOTS.includes(g.slot);
    if (active && !ranged) { existing?.remove(); return; }
    const tier = Gear.effectiveRelics(this.save)[g.slot]?.tier;
    const verb = active ? 'Unequip' : 'Equip';
    const label = `${this.gearIconHTML('relic', g.slot, tier, 20)} ${verb}`;
    const btn = existing || document.createElement('button');
    if (!existing) {
      btn.id = 'equip-btn';
      // Same seat and face as the Drink button (control gold: a thing you
      // press), bottom-right under the inventory bar.
      btn.className = 'hud-action';
      btn.style.cssText =
        'position:fixed;' +
        'bottom:calc(4px + env(safe-area-inset-bottom, 0px));' +
        'right:calc(var(--phone-right, 0px) + 8px);z-index:7;' +
        'display:flex;align-items:center;gap:6px;' +
        'padding:6px 10px;border-radius:8px;cursor:pointer;' +
        'color:#ffe066;border:2px solid #c8a64a;' +
        'font:700 12px ui-monospace,monospace;';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sel = this.save.selGear;
        if (!sel || !WEAPON_SLOTS.includes(sel.slot)) return;
        if (Gear.activeWeapon(this.save) === sel.slot) Gear.unequipWeapon(this.save);
        else Gear.selectWeapon(this.save, sel.slot);
        this.markRelicsDirty();
        persistSave(this.save);
        this.buildInventoryDOM();   // the "E" badge moves; refreshes this button too
      });
      document.body.appendChild(btn);
    }
    btn.dataset.slot = g.slot;
    btn.innerHTML = label;
  }

  // Eat button — appears bottom-right when the selected stack is food.
  // Tapping the player sprite to eat works too (interact.js 'eat' handler),
  // but on a small screen the body is fiddly to hit; this surfaces an
  // explicit affordance below the inventory bar.
  syncEatButton() {
    const sel = this.save.inv?.[this.save.selSlot];
    // A Crow Feather carries no ordinary FOOD_ENERGY — it only works through
    // the hard-mode zero-energy lockout (eatSelected), reviving to a tenth of
    // the bar, so the button only appears for it while that lockout actually
    // holds (never in easy mode, never above 0 energy).
    const featherRevive = !!sel && sel.id === 'crow_feather' && this._zeroEnergyLocked();
    const restore = (sel && typeof FOOD_ENERGY !== 'undefined') ? FOOD_ENERGY[sel.id] : null;
    const existing = document.getElementById('eat-btn');
    if (restore == null && !featherRevive) { existing?.remove(); return; }
    // THE COOLDOWN IS SHOWN ON THE BUTTON, in the two shapes the rest of the
    // game already uses for a wait: the exact number (shortDuration — every
    // wait the player can read goes through it) and a bar that fills as the
    // wait runs out. The bar is what makes it readable at a glance mid-chew;
    // the number is what makes it readable to the second. Both come off
    // Energy.eatCooldownLeft, the same call eatSelected refuses on — one
    // expression, so the greyed face and the refused tap can't disagree.
    // Potions have their own Drink button (syncConsumableButton) and never
    // appear here, which is the whole of their exemption.
    const cdLeft = Energy.eatCooldownLeft(this.save);
    const cooling = cdLeft > 0;
    const fishWait = Energy.fishRegenWait(this.save, sel?.id);
    this._eatFishShown = fishWait > 0 ? shortDuration(fishWait) : '';
    // DOWN AND LOCKED OUT (hard mode, empty bar — _zeroEnergyLocked): every
    // food but the feather is refused by eatSelected, so the button wears the
    // same dimmed face the cooldown does. Same expression both sides read, so
    // the grey button and the refused tap can't disagree.
    // _eatLockShown holds the raw lockout for _tickEatButton's change check.
    this._eatLockShown = this._zeroEnergyLocked();
    const locked = this._eatLockShown && !featherRevive;
    const dim = cooling || locked || fishWait > 0;
    // Held so _tickEatButton knows when the readout has actually changed and
    // this rebuild is worth running again (it drives the bar every frame, but
    // the label only moves on the whole second).
    this._eatCdShown = cooling ? shortDuration(cdLeft) : '';
    // While the gate refuses, the wait REPLACES the "+N⚡" it would otherwise
    // advertise: the restore isn't the actionable number until the bar fills.
    const eatVerb = ITEM_BY_ID[sel?.id]?.reusable ? 'Drink' : 'Eat';
    const text = cooling ? `${eatVerb} ${this._eatCdShown}`
      : fishWait > 0 ? `Stronger regen ${this._eatFishShown}`
      : featherRevive ? `Use → ${FEATHER_REVIVE_ENERGY}⚡`
      : Energy.fishRegenTotal(sel?.id) ? `${eatVerb} ${restore}⚡/${shortDuration(Energy.FISH_REGEN_MS)}`
      : CONSUMABLE_SPEC[sel?.id]?.eatLabel ? `${eatVerb} · ${CONSUMABLE_SPEC[sel.id].eatLabel} ${shortDuration(CONSUMABLE_SPEC[sel.id].durationMs)}`
      : `${eatVerb} +${restore}⚡`;
    const btn = existing || this._makeEatButton();
    // The icon is rebuilt only when the SELECTED STACK changes, not on every
    // repaint: this method now runs once a second for the whole cooldown, and
    // re-writing a background-image span at that cadence is churn for a glyph
    // that hasn't moved. The countdown itself is text, so it costs nothing.
    if (btn.dataset.id !== sel.id) {
      btn.dataset.id = sel.id;
      btn.querySelector('.eat-ico').innerHTML = this.iconSpanHTML(sel.id, 20);
    }
    btn.querySelector('.eat-txt').textContent = text;
    // Ready is the button's own green; cooling is that same green gone dim —
    // never the control gold, which in this palette means "a thing you press"
    // and would read as a different button rather than the same one waiting.
    btn.style.color = dim ? EAT_COOLING_INK : UI_GREEN;
    btn.style.borderColor = dim ? EAT_COOLING_EDGE : '#4a8c4a';
    btn.style.cursor = dim ? 'default' : 'pointer';
    this._paintEatCooldownBar(btn, cdLeft);
  }

  // Build the Eat button's element once. Split out of syncEatButton because
  // the button carries the cooldown bar as a child, so a plain
  // `innerHTML = label` on the whole button would wipe it.
  _makeEatButton() {
    const btn = document.createElement('button');
    btn.id = 'eat-btn';
    // Bottom-right, BELOW the inventory bar (the bar bottom sits at
    // safe-area + 48px, so a button at safe-area + 4px sits in the gap
    // underneath). Right-anchored to --phone-right so the button tucks
    // inside the simulated phone column on desktop.
    btn.className = 'hud-action';
    // overflow:hidden clips the cooldown bar to the rounded corners; the
    // fixed position is also what makes the bar's absolute placement resolve
    // against the button rather than the page.
    btn.style.cssText =
      'position:fixed;' +
      'bottom:calc(4px + env(safe-area-inset-bottom, 0px));' +
      'right:calc(var(--phone-right, 0px) + 8px);z-index:7;' +
      'display:flex;align-items:center;overflow:hidden;' +
      'padding:6px 10px;border-radius:8px;cursor:pointer;' +
      `color:${UI_GREEN};border:2px solid #4a8c4a;` +
      'font:700 12px ui-monospace,monospace;';
    // The bar sits along the BOTTOM EDGE rather than washing over the face:
    // a shroud across a button this small swallows its own label, and the
    // label is carrying the exact number.
    const bar = document.createElement('span');
    bar.className = 'eat-cd';
    bar.style.cssText =
      'position:absolute;left:0;bottom:0;height:3px;width:0;' +
      `background:${UI_GREEN};pointer-events:none;`;
    const lbl = document.createElement('span');
    lbl.className = 'eat-lbl';
    lbl.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const ico = document.createElement('span');
    ico.className = 'eat-ico';
    ico.style.cssText = 'display:flex;align-items:center;';
    const txt = document.createElement('span');
    txt.className = 'eat-txt';
    lbl.append(ico, txt);
    btn.append(bar, lbl);
    // NOT `disabled` while cooling: a disabled button swallows the tap without
    // running this handler, so the stopPropagation below never fires and the
    // press falls through to the world underneath — tilling the ground behind
    // the button. eatSelected owns the refusal instead.
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.eatSelected();
      this.syncEatButton();   // refresh count / hide if stack ran out
    });
    document.body.appendChild(btn);
    return btn;
  }

  // Size the cooldown bar. It FILLS as the wait runs down — a full bar is a
  // ready button — so the growing green and the shrinking number both point
  // the same way: toward the next bite.
  _paintEatCooldownBar(btn, leftMs) {
    const bar = btn.querySelector('.eat-cd');
    if (!bar) return;
    const done = 1 - clamp01(leftMs / Energy.EAT_COOLDOWN_MS);
    // Hidden outright when there is nothing to count: a permanently full bar
    // under a ready button is just a green line with no meaning.
    bar.style.width = leftMs > 0 ? `${done * 100}%` : '0';
  }

  // Drive that readout. The bar is re-sized every frame (one style write on an
  // element that only exists while food is selected) so it climbs smoothly;
  // the full rebuild runs only when the whole-second reading changes — which
  // includes the tick the wait ends on, and that is what un-greys the button.
  _tickEatButton() {
    const btn = document.getElementById('eat-btn');
    if (!btn) { this._eatCdShown = null; return; }
    const left = Energy.eatCooldownLeft(this.save);
    this._paintEatCooldownBar(btn, left);
    const shown = left > 0 ? shortDuration(left) : '';
    // Also rebuild when the bar empties or refills, which greys / un-greys it.
    const locked = this._zeroEnergyLocked();
    const fishWait = Energy.fishRegenWait(this.save, getSelectedSlot(this.save)?.id);
    const fishShown = fishWait > 0 ? shortDuration(fishWait) : '';
    if (shown !== this._eatCdShown || locked !== this._eatLockShown || fishShown !== this._eatFishShown) this.syncEatButton();
  }

  // Book / Honey Read / Use button. Mirror of syncEatButton — sits next
  // to the Eat button (or in the same spot when food isn't selected). This
  // is THE way to use a self-targeted consumable (a tap on your own feet was
  // too easy to trigger accidentally while tilling / planting under the player).
  hatchEgg() {
    const selectedId = this.save.inv?.[this.save.selSlot]?.id;
    const result = EggHatch.hatch(this.save);
    if (!result.ok) {
      if (result.reason === 'full') this.flash('Make room for a pet first.');
      return false;
    }
    this._eggHatchTracker = null;
    this.save.selSlot = this.save.inv.findIndex(item => item.id === selectedId);
    this._clampSelSlot();
    persistSave(this.save);
    this.buildInventoryDOM();
    // The hatch is a ceremony (SceneModals.showBabyFound): the offer modal
    // that asked has already closed, so the card stands alone.
    this.showBabyFound(result.petId, 'egg');
    return true;
  }

  _tickThrowButton() {
    const id = getSelectedSlot(this.save)?.id;
    if (!CONSUMABLE_SPEC[id]?.throwCooldownMs && !isPotion(id)) { this._throwButtonState = null; return; }
    const state = `${id}:${this.throwActionLabel()}:${this.canThrowItem(id)}`;
    if (state === this._throwButtonState) return;
    this._throwButtonState = state;
    this.syncConsumableButton();
  }

  syncConsumableButton() {
    const sel = this.save.inv?.[this.save.selSlot];
    const existing = document.getElementById('consumable-btn');
    const cfg = sel && CONSUMABLE_SPEC[sel.id];
    let throwBtn = document.getElementById('potion-throw-btn');
    if (sel && isPotion(sel.id) && sel.count > 0) {
      if (!throwBtn) {
        throwBtn = document.createElement('button');
        throwBtn.id = 'potion-throw-btn';
        throwBtn.className = 'hud-action';
        throwBtn.style.cssText = 'position:fixed;bottom:calc(4px + env(safe-area-inset-bottom, 0px));right:calc(var(--phone-right, 0px) + 130px);z-index:7;padding:6px 10px;border:2px solid #c8a64a;border-radius:8px;color:#ffe066;font:700 12px ui-monospace,monospace;';
        throwBtn.addEventListener('click', e => {
          e.stopPropagation();
          const id = getSelectedSlot(this.save)?.id;
          if (isPotion(id)) this._throwItem(id);
          this.syncConsumableButton();
        });
        document.body.appendChild(throwBtn);
      }
      throwBtn.textContent = this.throwActionLabel();
      throwBtn.disabled = !this.canThrowItem(sel.id);
    } else throwBtn?.remove();
    // Only a row with an ACTION gets the button. The foods with an extra
    // effect (rainberry, pairy, coffee) keep tuning rows in CONSUMABLE_SPEC
    // but no verb — they go through Eat — and without this check the
    // rainberry grew a second button reading "undefined".
    if (!cfg || !(cfg.verb || cfg.label) || (sel.count ?? 0) <= 0) { existing?.remove(); return; }
    const iconHtml = this.iconSpanHTML(sel.id, 20);
    const label = `${iconHtml} ${cfg.label ? cfg.label(this, cfg) : cfg.verb}`;
    const syncState = button => {
      button.disabled = !!cfg.disabled?.(this, cfg);
      button.style.opacity = button.disabled ? '0.55' : '1';
      button.style.cursor = button.disabled ? 'default' : 'pointer';
      // Eggs keep Eat and Hatch available without overlapping the controls.
      button.style.bottom = sel.id === 'egg'
        ? 'calc(46px + env(safe-area-inset-bottom, 0px))'
        : 'calc(4px + env(safe-area-inset-bottom, 0px))';
    };
    if (existing) { existing.innerHTML = label; existing.dataset.id = sel.id; syncState(existing); return; }
    const btn = document.createElement('button');
    btn.id = 'consumable-btn';
    btn.dataset.id = sel.id;
    // Sit to the LEFT of the Eat button (Eat lives at right:8). Since the
    // two are mutually-exclusive in normal play (Eat = food selected,
    // consumable = book/honey selected) we use the same right slot. CSS
    // identical except border colour (warm tan to distinguish from
    // Eat's green).
    btn.className = 'hud-action';
    btn.style.cssText =
      'position:fixed;' +
      'bottom:calc(4px + env(safe-area-inset-bottom, 0px));' +
      'right:calc(var(--phone-right, 0px) + 8px);z-index:7;' +
      'display:flex;align-items:center;gap:6px;' +
      'padding:6px 10px;border-radius:8px;cursor:pointer;' +
      'color:#ffe066;border:2px solid #c8a64a;' +
      'font:700 12px ui-monospace,monospace;';
    btn.innerHTML = label;
    syncState(btn);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const entry = CONSUMABLE_SPEC[id];
      const fn = entry?.method;
      if (!fn || typeof this[fn] !== 'function') return;
      if (entry.immediate) {
        this[fn]();
        this.syncConsumableButton();
        return;
      }
      // Mirror the interact.js use-consumable flow: confirmation modal,
      // accept consumes 1 and triggers the action.
      const item = ITEM_BY_ID[id];
      // A `secondary` row (the rope's Up) becomes the modal's middle button:
      // its own method, its own live disabled test, the same consume-then-
      // resync flow as the primary.
      const sec = entry.secondary;
      let secondary = sec ? {
        label: sec.label,
        disabled: typeof sec.disabled === 'function' ? sec.disabled(this, entry) : !!sec.disabled,
        onClick: () => {
          if (typeof this[sec.method] === 'function') this[sec.method]();
          this.syncConsumableButton();
        },
      } : undefined;
      this.showOfferModal({
        kind: 'use',
        title: entry.title,
        get: typeof entry.get === 'function' ? entry.get(this, entry) : entry.get,
        cost: `1× ${this.iconSpanHTML(id)} ${item?.name || id}`,
        canAfford: typeof entry.usable === 'function' ? entry.usable(this, entry) : true,
        acceptLabel: entry.acceptLabel || entry.verb,
        secondary,
        onAccept: () => { this[fn](); this.syncConsumableButton(); },
      });
    });
    document.body.appendChild(btn);
  }
}
// The modal shell's methods (makeModalShell, showMessageModal, showOfferModal,
// showChestRewardModal, _installModalPadGate) live in modal_shell.js as the
// SceneModals mixin; this puts them on the scene. It throws if a copy of any
// of them is still defined above.
installSceneMixin(MapScene, SceneModals);
// The scene's geography (the GPS / compass / lifecycle consumer of Geo, and
// the 3x3 tile loading around the fix with its retry) lives in scene_geo.js
// as the SceneGeo mixin — same install, same throw on a stale copy.
installSceneMixin(MapScene, SceneGeo);
// The creature sim and per-tile spawning (spawnInTile, spawnCaveCreatures,
// wanderCreatures and the wild crow's tick, the catch wheel and
// catchCreature) live in scene_creatures.js as the SceneCreatures mixin —
// same install, same throw on a stale copy.
installSceneMixin(MapScene, SceneCreatures);
// The shops and their offers (shopInteract and the starter-shop lookups, the
// delivery / relic / themed / smelt / wizard / trader / castle / blacksmith
// offers, the quest board) live in scene_shops.js as the SceneShops mixin —
// same install, same throw on a stale copy.
installSceneMixin(MapScene, SceneShops);
installSceneMixin(MapScene, SceneFire);
// create() (world, layers, camera and HUD wiring at boot) is scene_create.js;
// the bag's potions, tomes, scrolls, powders and food are scene_consumables.js;
// the inn, guildhall, Home tabs, fort slots and trailer are scene_venues.js;
// street restoration, lamps and the trail's prizes are scene_streets.js.
installSceneMixin(MapScene, SceneCreate);
installSceneMixin(MapScene, SceneConsumables);
installSceneMixin(MapScene, SceneVenues);
installSceneMixin(MapScene, SceneStreets);

const game = window.__game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // The canvas BACKING STORE, in device px — see the canvas-resolution note by
  // W/H. With Scale.NONE, Phaser sets canvas.width to the game size and the
  // canvas's CSS size to game size × zoom, so the reciprocal zoom lays a
  // device-resolution buffer back out at the logical 352×844 that #game's own
  // transform expects. The camera zoom that puts logical coordinates back on
  // that buffer is applied in create() (applyRenderScale).
  width: W * RENDER_SCALE, height: H * RENDER_SCALE,
  zoom: 1 / RENDER_SCALE,
  backgroundColor: '#000',
  pixelArt: true,
  // Phaser 3.87 preallocates three square pre-FX targets every 32px up to
  // the canvas width, plus three full-size targets. At 1179×2826 that pool
  // alone is ~228 MiB of RGBA pixels, even before any shiny uses it.
  // Default to the light/spark fallback; the menu can opt in on this device.
  disablePreFX: !GRAPHICS_FX_ENABLED,
  disablePostFX: true,
  // See FPS_LIMIT / PHASER_FPS_LIMIT: 30 steps/s on any display, 0 = uncapped (?fps=0).
  fps: { limit: PHASER_FPS_LIMIT },
  scene: [MapScene],
  scale: { mode: Phaser.Scale.NONE },
  // Phaser's loader defaults to maxParallelDownloads: 32. ASSETS in
  // assets.js already exceeds that, and the queue-pump fails to move the
  // remaining files into inflight after the first 32 finish — the scene
  // stalls in LOADING forever, leaving the game frozen on a black canvas
  // (and the test harness timing out on "scene never booted"). Bump the
  // cap above the asset count so every file fits in one batch; nothing in
  // this project is big enough to make parallel downloads a network
  // concern.
  loader: { maxParallelDownloads: 128 },
  // No audio in this game — disable both backends so Phaser uses the
  // NoAudioSoundManager and never creates an AudioContext. Without this the
  // browser logs a "failed to start the audio device" warning on iOS/Android
  // because Web Audio can't start before the first user gesture.
  audio: { noAudio: true, disableWebAudio: true },
  // Phaser defaults to ONE touch pointer (pointers[1]; pointers[0] is the
  // mouse). With a single slot, holding the movement stick — a plain DOM
  // element whose touches still bubble to Phaser's window listeners —
  // occupies the only pointer, so a world tap with the other thumb is
  // silently dropped. Worse, a touchend that never reaches Phaser (see the
  // stuck-pointer sweeper in create()) strands that one pointer `active`
  // forever and ALL canvas taps die until reload. Three slots covers
  // stick + tap + one stray finger.
  input: { activePointers: 3 },
});

// Follow the screen. fitGame re-runs on resize, orientationchange and visual-
// viewport changes, and publishes its scale through this hook; devicePixelRatio
// moves too, when a window is dragged between monitors or the browser zooms. If
// the canvas didn't follow, it would keep a backing store sized for the old
// screen. The same memory cap applies at boot and after every resize.
//
// The epsilon is not a tuning knob: resizing a WebGL drawing buffer reallocates
// it, and fitGame fires on every resize event, so a scale that wobbles in the
// last decimal (iOS Safari's toolbar collapsing mid-scroll does exactly this)
// must not reallocate the buffer on every frame of the wobble. A change too
// small to see is a change not worth paying for.
window.__onGameScaleChange = () => {
  const next = renderScale();
  if (Math.abs(next - RENDER_SCALE) < 0.01) return;
  RENDER_SCALE = next;
  // setZoom first: ScaleManager.resize reads the CURRENT zoom to work out the
  // canvas's CSS size, so a stale one would lay the new buffer out at the wrong
  // number of CSS px and #game's transform would compound the error.
  game.scale.setZoom(1 / RENDER_SCALE);
  game.scale.resize(W * RENDER_SCALE, H * RENDER_SCALE);
  // The resize grows each camera to the new buffer but leaves its transform
  // alone, so the zoom is still the OLD render scale — which would draw the
  // logical grid at the wrong size on a correctly-sized canvas. Re-point it.
  for (const scene of game.scene.getScenes(true)) applyRenderScale(scene.cameras.main);
};
