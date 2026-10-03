// ─────────────────────────────────────────────────────────────────────────
// StreetVariants — what a STREET is, and what it wears.
//
// A street is a NAME inside a PARISH (streetKey). Every tile can compute it
// from its own layers (the name comes off `transportation_name` by vertex
// vote, nameVote/lineName) and it is the same on both sides of a seam, so
// deterministic rolls give each eligible street ONE variant end to end.
// Named fragments are pooled; connected unnamed fragments share a canonical
// local key. Roads crossing a tile edge have unknown full length and use
// compact patches, as do roads longer than 500 m. Their context stays neutral;
// local complete roads read final zone coverage without fetching neighbours.
//
// TWO SIZES, off WorldGen.classifyLine's tiers:
//   MAJOR — ROAD_MD + ROAD_LG (tertiary / secondary and up): the OLD TRADE
//           ROADS (internally still "bandit": BANDIT_STORY, banditStop). The
//           theme is a LOOK only — its story, its torch-orange lamps and the
//           broken wagon a third of its bus stops wear (WAGON_STOP_SHARE,
//           loot.js chestLook). Since Sep 2026 (the owner's safety pass) NOTHING
//           hostile or alive is seated for it: no wagon goblin, no dogs pulled
//           onto its verge, no traps on its stretches (traps.js reads footpaths
//           and park edges now). The stretches are still stamped
//           (ROAD_CLASS_BANDIT_VERGE) but no spawner reads them for a foe.
//   MINOR — ROAD with class minor/street (residential streets). Service ways
//           (driveways, alleys, parking) are neither — they stay plain.
//   Footpaths are neither.
//
// THE KERB BUFFER (WorldGen.ROAD_CLASS_MAJOR_BUFFER, ~one reach radius round
// every MAJOR band): the few foes the variants still seat — a barricade's
// goblin, a burned row's fire slime, a café hoard's giant — are seated BACK
// beyond it (foeSeat: the nearest cell outside it, reached without crossing a
// major band) or not at all. Never a player's reason to step toward the road.
//
// THE CAFÉ HOARDS: a buried hoard (and usually its giant-goblin guard) beside
// a coffee shop — HOARDS_PER_TILE of the tile's own café points, lowest hash
// of the GLOBAL point first (commercial POIs where a tile has no café). Until
// Sep 2026 it sat at the head of a hedgerow's residential dead end.
//
// THE VARIANTS are rows of STREET_VARIANTS, each on ONE size. The roll
// (variantFor) first rolls rarity, then chooses a weighted row. A
// name word (row.words) multiplies its choice weight by NAME_NUDGE, so "Cherry
// Lane" is likelier an orchard — the street sign foreshadows the street.
// Separately, ROCK_STREET_SHARE of minor streets are lined with rock clusters
// (rocksFor — worldgen's street rock pass reads it), never a hedgerow.
//
// NOTHING IS STORED. A variant is a pure function of its key and mapped context; what the
// player does to its pieces lands in the save's existing delta lists
// (picked, foundTreasures, caught). Every piece's id is `cellId(prefix, tx,
// ty, ix, iy)` and every stream is its own (`dress|variant|key|tile|line`),
// so dressing never moves another spawner's stream.
//
// What this is NOT: the restoration arithmetic (streets.js), the road mask
// (worldgen.js roadMask / roadClass — the MAJOR band and verge are stamped
// there, in the same pass as the mask, and read here), nor the drawing.
//
// Pure: no Phaser, no DOM. Reads WorldGen / Streets / fnv1a at CALL time, so
// it loads before worldgen.js. Audit: test/node/street_variants.test.js.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // ── The key ──────────────────────────────────────────────────────────────
  // A parish is PARISH_TILES z14 tiles on an edge (~25 km: a town). A street
  // changes variant only where it crosses a parish line.
  const PARISH_TILES = 16;
  // A name word multiplies its row's share by this, capped per row.
  const NAME_NUDGE = 4;
  const NUDGED_SHARE_MAX = 0.9;
  // Share of MINOR street keys lined with rock clusters (hedgerows excepted).
  const ROCK_STREET_SHARE = 0.25;
  const MINOR_VARIANT_SHARE = 0.40;

  // ── The verge ────────────────────────────────────────────────────────────
  // Every verge piece searches OUTWARD from the band's edge, k = 1..this
  // cells, and takes the first cell that passes the shared spawn rule.
  const VERGE_MAX_CELLS = 3;
  // A bus stop is on a MAJOR road when a major band touches a cell within
  // this many cells (Chebyshev) of its own.
  const BUS_STOP_MAJOR_CELLS = 2;
  // Only this share of the stops on a major road wear the broken wagon; the
  // rest stay ordinary bus-stop chests. Decided per stop off a hash of the
  // chest's own id (its POI cell — generated, the same for every player),
  // never a draw. A LOOK only: no guard (the owner, Sep 2026 — no wagon
  // goblins at all).
  const WAGON_STOP_SHARE = 1 / 3;

  // ── The kerb buffer: seating a foe BACK ─────────────────────────────────
  // A foe the dressing seats (barricade goblin, burned-row fire slime, café
  // giant) takes the nearest cell within this many cells of its natural spot
  // that takes an 'enemy' spawn (the spawn gate: OPEN ground — outside the
  // kerb buffer ROAD_CLASS_MAJOR_BUFFER and every other buffer) and is
  // reached by a straight walk crossing no MAJOR band cell — so it stays on
  // its own side of the road. None → the foe is dropped.
  const FOE_SEAT_BACK_CELLS = 4;

  // ── Bandit stretches ─────────────────────────────────────────────────────
  // The bandits do not work a major road end to end: each MAJOR street is cut
  // into STRETCHES and BANDIT_STRETCH_SHARE of them are theirs, stamped as
  // the roadClass bit WorldGen.ROAD_CLASS_BANDIT_VERGE. Until Sep 2026 the
  // surface traps sat on those verges; they read footpaths and park edges now
  // (traps.js) and NOTHING reads this bit for a foe or a trap — it stays for
  // the look and the story (and the burned row's per-stretch key).
  // A stretch is (street key, lattice square): the squares are
  // BANDIT_STRETCH_UNITS on an edge in GLOBAL MVT units (tile·4096 + local —
  // ~200 m at play latitudes), aligned to the tile grid, so every square lies
  // inside exactly one tile and a named street's stretch is the same from
  // either side of a seam (the key is; the square is). An unnamed way keys
  // off its own piece (anonKey), so it may disagree at a seam — accepted, as
  // for its variant.
  const BANDIT_STRETCH_UNITS = 512;
  const BANDIT_STRETCH_SHARE = 1 / 3;

  // ── Café hoards ─────────────────────────────────────────────────────────
  // The POI classes a hoard is buried beside: a coffee shop, or — on a tile
  // with no café point of its own — the other commercial food / shop classes.
  const HOARD_POI_CLASSES = new Set(['cafe']);
  const HOARD_POI_FALLBACK = new Set(['bakery', 'ice_cream', 'restaurant', 'fast_food', 'grocery', 'shop']);
  // At most this many hoards per tile (~2.5 km²): lowest hash of the POI's
  // GLOBAL point first, so a tile's pick is a pure function of its own bytes
  // and a seam café is only ever the owning tile's. Keeps the guarded hoards
  // under ~1 per km² even in Berlin (353 cafés over nine tiles).
  const HOARDS_PER_TILE = 2;
  // How far from the POI's cell a hoard may be seated (cells).
  const HOARD_SEAT_CELLS = 5;

  // Relocate reach for an end piece (waystone / barricade) off its line end.
  const END_SEAT_CELLS = 4;

  // ── Dressing density (generation metres along the way) ───────────────────
  const HEDGE_GATE_EVERY_CELLS = 6; // aligned garden gates on both verges
  // ── How much of a street wears its theme ────────────────────────────────
  // Complete short streets wear their theme end to end. Longer or clipped
  // streets keep the middle sectionShare of each tile-aligned patch, measured
  // along the road. This leaves real plain gaps even between adjacent patches
  // and bounds coverage per road, rather than only across random street keys.
  // Section min/max limits still apply; unusually short or winding fragments
  // may therefore wear less than the target share. Long roads use wider patches.
  const MAX_VARIANT_LENGTH_M = 500;
  const MIN_VARIANT_LENGTH_M = 50;
  const LONG_ROAD_M = 1000;
  const LONG_ROAD_SECTION_SHARE = 0.4;
  const VARIANT_PATCH_UNITS = 512;
  const LONG_PATCH_UNITS = 1024;
  function sectionLimits(variant) {
    const row = variant ? VARIANT_BY_ID[variant] : null;
    return {
      maxM: row?.sectionMaxM ?? MAX_VARIANT_LENGTH_M,
      minM: row?.sectionMinM ?? MIN_VARIANT_LENGTH_M,
      share: row?.sectionShare ?? LONG_ROAD_SECTION_SHARE,
    };
  }
  // Half-cell samples fill the full three-cell verge on both sides.
  const GOLDEN_STEP_M = 3.5, GOLDEN_COIN_AMOUNT = 1;
  const OVERGROWN_STEP_M = 12, OVERGROWN_MAX = 42;
  const ORCHARD_STEP_M = 12, ORCHARD_MAX = 80;
  const TOADSTOOL_STEP_M = 6, TOADSTOOL_MAX = 100;
  const TOADSTOOL_GIANT_EVERY_GROUPS = 3;
  const BURNED_STEP_M = 8, BURNED_MAX = 100;
  const BURNED_TORCH_STEP_M = 32;
  // Stop starting new barricade lines at this budget; finish the last line
  // so a count cutoff cannot leave a gap halfway across its road.
  const BARRICADE_STEP_M = 12, BARRICADE_MAX = 80;
  const BARRICADE_VERGE_MAX_CELLS = 4;
  // How finely a burned row is walked for its one fire slime per stretch.
  const BURNED_GUARD_STEP_M = 10;
  // Lantern Row: NOT a prop of its own — the street lamps, denser. A lantern
  // street stands its restoration lamps at Streets.lampSpacingM() / this
  // (app.js _streetLampsForTile), same art, same lit-when-restored rule, one
  // lane.
  const LANTERN_SPACING_DIV = 4;
  // The hedged lane's white lamps stand closer than the usual street's, still
  // short of a Lantern Row.
  const HEDGE_LAMP_DENSITY = 3;
  // The hedged lane's carpet: centred on the first verge cell (where the
  // hedges stand, so it shows at every garden gate), this many cells wide.
  const CARPET_WIDTH_CELLS = 0.6;
  const TERRAIN_VERGE_CELLS = 1.5;
  const THORNY_SHRINE_RADIUS_CELLS = 2;
  const THORNY_VERGE_MAX_CELLS = 4;
  const SNARE_CHEST_TIER = 3;
  const SNARE_TRAP_RADIUS_CELLS = 2;
  const SNARE_MIN_TRAPS = 8;

  // What a burned row's verge holds — the two props that SLOW the body
  // (app.js _bodyHold). One table both sides read: dressing lays these kinds,
  // and the slow gate asks isSlowKind.
  const SLOW_KINDS = new Set(['tar', 'stakes']);

  // ── The rows ─────────────────────────────────────────────────────────────
  // `lampGlow` is the colour its lamps shed (lampGlowFor — light and art read
  // the one value); `attracts` { species: p } is the FAUNA ATTRACTOR column
  // (scene_creatures.js _seatFaunaOnFavouriteGround): each of the tile's own
  // spawns of that species moves onto this street's verge with probability p.
  // `share` is the neutral-name probability for a key of that size. Minor
  // shares total 40%; name nudges redistribute ordinary themes inside that
  // fixed budget, while Golden Road remains 2% of all minor keys.
  // `story` is the _storySplashOnce key AND the painting stem (sceneArtUrl);
  // `flash` is the ≤30-char map line a later visit gets.
  const STREET_VARIANTS = [
    { id: 'hedgerow', terrain: 'PARK', affinities: ['cultivated', 'formal'], size: 'minor', share: 0.08, nudge: 2, rung: 'find',
      stone: { weathered: '#3a322c', restored: '#000000' }, lampDensity: HEDGE_LAMP_DENSITY,
      // A dark green carpet runs down the verge either side (road_overlay.js
      // decor lane), sown with the old monarch's crown — the one royal symbol
      // the kept lanes still carry from before the fire. `emblem` names the
      // repeating mark; `emblemInk` is its colour.
      carpet: '#1f4a2c', emblem: 'crown', emblemInk: '#7b803b',
      words: /\b(lane|ln|close|court|ct|place|pl|mews|circle|cir|crescent|cres|cove|row|gasse|hecke|weg)\b/i,
      lampGlow: '#ffffff', attracts: { rabbit: 0.5 },
      story: 'street_hedgerow', title: 'The hedged lane',
      body: 'Hedges line the road, with gaps at the garden gates. You look through as you pass.',
      flash: 'A hedged lane, still kept.' },
    { id: 'overgrown', terrain: 'FOREST', affinities: ['woodland'], size: 'minor', share: 0.04, rung: 'common',
      stone: { weathered: '#465b42', restored: '#5d7953' }, lampDensity: 1,
      carpet: '#9caa55', carpetWidthCells: 0.28, carpetFeatherCells: 0.14,
      words: /(park|wood|forest|grove|glen|heath|moor|green|meadow|wald|heide|hain|wiese|garten|garden|fern|brook)/i,
      lampGlow: '#9be08a', attracts: { rabbit: 0.5, butterfly: 0.5 },
      story: 'street_overgrown', title: 'Gone to seed',
      body: 'Saplings crowd the verge beneath tall maples. You push past branches reaching into the street.',
      flash: 'The green is taking it back.' },
    { id: 'orchard', terrain: 'ORCHARD', affinities: ['cultivated'], size: 'minor', share: 0.08, rung: 'uncommon',
      stone: { weathered: '#78604e', restored: '#ab8659' }, lampDensity: 0.5,
      words: /(orchard|apple|cherry|plum|pear|peach|fruit|obst|kirsch|apfel|birn|pflaum|vine|berry)/i,
      lampGlow: '#ffa6c9', attracts: { deer: 0.5 },
      story: 'street_orchard', title: 'Orchard Lane',
      body: 'Apples hang from the old orchard trees.',
      flash: 'Old trees, still fruiting.' },
    { id: 'pilgrim', terrain: 'ROCK', affinities: ['sacred'], size: 'minor', share: 0.06, rung: 'uncommon',
      stone: { weathered: '#8b8879', restored: '#c5c1aa' }, lampDensity: 1,
      // The diamond marks the ancient religion; hedged lanes bear the ruling crown.
      carpet: '#64517d', emblem: 'diamond', emblemInk: '#c5b4d5',
      words: /(church|chapel|abbey|kirch|kloster|pilgrim|cross|saint|\bst\b|priest|minster|\bdom\b|mission)/i,
      lampGlow: '#f2eee0', attracts: { crow: 0.1 },
      story: 'street_pilgrim', title: "Pilgrim's Way",
      body: 'A waystone stands beside the road. You rest your hand in its smooth, worn hollow.',
      flash: 'A waystone, worn smooth.' },
    { id: 'lantern', terrain: 'COMMERCIAL', affinities: ['formal', 'destination'], size: 'major', share: 0.07, rung: 'common',
      stone: { weathered: '#806438', restored: '#c79a48' }, lampDensity: LANTERN_SPACING_DIV,
      words: /(lantern|lamp|light|candle|latern)/i,
      // No `attracts`: its marks lie on the major band + verge, all inside
      // the kerb buffer — the road is never a lure, and the spawn gate
      // (WorldGen.isSpawnCell(…, creatureSpawnClass(kind))) keeps every fast
      // animal out of it.
      lampGlow: '#ffb347',
      story: 'street_lantern', title: 'Lantern Row',
      body: 'Lamp posts line the road, close enough to light the whole street. You walk between the rows of lamps.',
      flash: 'Lamp posts, cold and waiting.' },
    { id: 'burned', terrain: 'INDUSTRIAL', affinities: ['ruined'], size: 'major', share: 0.05, rung: 'uncommon',
      stone: { weathered: '#583c35', restored: '#865041' }, lampDensity: 0.5,
      words: /(mill|forge|smith|ash|burn|brand|kiln|furnace|cinder|coal|ember|kohle|schmied|asche)/i,
      lampGlow: '#ff5a3c',
      story: 'street_burned', title: 'Burned Row',
      body: 'Tar fills the gutters, and iron stakes jut from the verge. You keep to the clear stones between them.',
      flash: 'Tar underfoot. Go slow.' },
    { id: 'barricade', terrain: 'WASTELAND', affinities: ['ruined'], size: 'major', share: 0.04, rung: 'rare',
      stone: { weathered: '#706047', restored: '#a38754' }, lampDensity: 1,
      words: /(gate|wall|fort|\btor\b|mauer|castle|burg|bastion|guard|wache|barrack|kaserne|armou?ry)/i,
      lampGlow: '#ff8c2a',
      story: 'street_barricade', title: 'The barricade',
      body: 'Rough barricades cross the road and reach into the verges. Iron spikes stand between the wooden barriers.',
      flash: 'Barricades. Goblins held it.' },
    // Appended LAST so no older row's code (index + 1) moves; the roll walks
    // the minor rows in order, so a street that rolled an older minor row
    // still does — only plain streets can become a toadstool lane.
    // The paving is a fly agaric: red cap, cream spots. The restored red is
    // kept SATURATED (owner, Sep 2026 — the earlier #9a5943 read as dusty
    // pink against the dim wetland verge); the weathered stone stays muted
    // like every unrestored surface. Its lamps burn torch orange, not the
    // caps' glow — the mushrooms carry that themselves after dark.
    { id: 'toadstool', terrain: 'WETLAND', affinities: ['damp', 'woodland'], size: 'minor', share: 0.05, rung: 'uncommon',
      stone: { weathered: '#6d412c', restored: '#ad4e2e', pattern: 'spots', accent: '#f0dfb4' }, lampDensity: 1,
      words: /(mushroom|toadstool|fung|pilz|fairy|\bring|moss|damp|mycel|spore|schwamm|elfen|feen)/i,
      lampGlow: '#ff8c2a', attracts: { butterfly: 0.5 },
      story: 'street_toadstool', title: 'Toadstool Lane',
      body: 'Red toadstools crowd the verge, and the air smells of damp earth. You step around their spotted caps.',
      flash: 'Toadstools. They glow at dusk.' },
    // SCENIC PATHS (src/scenic.js) — a third SIZE, 'path', appended LAST so
    // no older row's code moves. NEVER ROLLED: sizeOfTags never answers
    // 'path', so variantFor never walks them (share 0); the row is read off a
    // way's SCENIC CLASS (Scenic.rowFor — shore → promenade, greenway,
    // park → parkpath). The columns are the street rows' own: `lampGlow` (the
    // lamps on the scenic metres shed it — lampGlowFor), and the story — one
    // shared ledger key with a painting per landscape, told on the first scenic metre
    // restored (app.js _ripenStreets), the `flash` on later walks.
    { id: 'promenade', terrain: 'SAND', affinities: ['coastal', 'formal'], size: 'path', share: 0, rung: 'uncommon',
      stone: { weathered: '#92743e', restored: '#d6ad58' },
      lampGlow: '#ffd16a', attracts: { metal_slime: 1 },
      story: 'street_scenic', title: 'The promenade',
      body: 'The path runs along the water. You listen to it lapping against the shore as you walk.',
      flash: 'The promenade. Walk it slow.' },
    { id: 'greenway', terrain: 'GRASS', affinities: ['woodland'], size: 'path', share: 0, rung: 'uncommon',
      stone: { weathered: '#4f6c49', restored: '#76966a' },
      lampGlow: '#a8e07a', attracts: { butterfly: 0.5 },
      story: 'street_scenic', art: 'street_greenway', title: 'A greenway',
      body: "Branches hang low over the path. You duck beneath them as leaves brush your hood.",
      flash: 'A greenway. The green holds.' },
    { id: 'parkpath', terrain: 'PARK', affinities: ['formal', 'cultivated'], size: 'path', share: 0, rung: 'uncommon',
      stone: { weathered: '#5c4b3f', restored: '#000000' },
      lampGlow: '#a8e07a',
      story: 'street_scenic', art: 'street_parkpath', title: 'The park path',
      body: "Weeds crowd the old park path, and dry leaves cover its edges. You follow it through the overgrowth.",
      flash: 'The park path winds on.' },
    { id: 'golden', terrain: 'ROCK', affinities: ['formal'], size: 'minor', share: 0.02, rung: 'rare',
      stone: { weathered: '#806747', restored: '#bd9650' }, lampDensity: 1,
      // A coin carpet half the usual section long (sectionLimits): a whole
      // 500 m of coins on every long road would be a purse, not a find.
      sectionMaxM: 250,
      lampGlow: '#efc46a',
      story: 'street_golden', art: 'street_golden', title: 'Golden Road',
      body: 'Green coins lie scattered in the grass on both sides of the road. You spot more with every step.',
      flash: 'The verges glitter with coins.' },
    { id: 'snare', terrain: 'WASTELAND', affinities: ['ruined'], size: 'minor', share: 0.03, rung: 'rare',
      stone: { weathered: '#594a3f', restored: '#897051' }, lampDensity: 1,
      lampGlow: '#d58b52', story: 'street_snare', art: 'street_snare', title: 'Snare Lane',
      body: 'A chest sits beside the lane, surrounded by iron traps. You stop short of the open jaws in the grass.',
      flash: 'Iron teeth around a chest.' },
    // Append so saved mark codes retain their existing meanings.
    { id: 'thorny', terrain: 'FOREST', affinities: ['woodland'], size: 'minor', share: 0.04, rung: 'uncommon',
      stone: { weathered: '#514638', restored: '#8c7654' }, lampDensity: 1,
      sectionMaxM: 250, words: /(thorn|bramble|briar|brier)/i,
      lampGlow: '#b1bd78', story: 'street_thorny', art: 'street_overgrown', title: 'Thorny Path',
      body: 'Tangled brambles crowd both sides of the path. You follow the narrow opening between their thorns.',
      flash: 'Brambles crowd the path.' },
  ];
  const VARIANT_BY_ID = {};
  STREET_VARIANTS.forEach((r, i) => { VARIANT_BY_ID[r.id] = r; r.code = i + 1; });
  // The OLD TRADE ROAD (internally "bandit"): every MAJOR road, variant or
  // not. Not a row of the table (it dresses nothing of its own — the wagon
  // look is loot.js chestLook's); its story is here beside the others. A LOOK
  // and a story only: no `attracts` (the dogs no longer work major verges —
  // the owner's safety pass, Sep 2026), no foe, no trap.
  const BANDIT_STORY = {
    story: 'street_bandit', title: 'Old trade road',
    body: 'Deep wheel ruts run past the remains of broken wagons. You follow the old trade road.',
    flash: 'Old trade road. Wheel ruts.',
    // Unthemed major road: torch orange.
    lampGlow: '#ff8c2a',
  };
  // Per-cell marks (dress().marks): a variant's code 1..n, BANDIT_CODE for a
  // plain major cell (resolved from roadClass by the caller).
  function variantByCode(code) { return STREET_VARIANTS[code - 1] || null; }

  // ── Names and keys ──────────────────────────────────────────────────────
  function normName(name) {
    return String(name || '').toLowerCase().replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function parishOf(tx, ty) { return `${Math.floor(tx / PARISH_TILES)},${Math.floor(ty / PARISH_TILES)}`; }
  function streetKey(name, tx, ty) { return `${normName(name)}|${parishOf(tx, ty)}`; }
  // An unnamed way: its own geometry in the tile (tile-local MVT ends).
  function anonKey(tx, ty, line) {
    const path = canonicalPaths([line])[0] || line;
    const a = path[0], z = path[path.length - 1];
    return `~${tx},${ty}|${a.x},${a.y}|${z.x},${z.y}|${path.length}`;
  }
  const u01 = (s) => (fnv1a(s) >>> 0) / 4294967296;

  // Which size a way is, off its terrain tier. Rail/transit/ferry are not
  // streets (classifyLine's fallback would call them ROAD).
  const NON_STREET = new Set(['rail', 'transit', 'ferry', 'aerialway', 'service', 'track']);
  function sizeOfTags(tags) {
    const WG = root.WorldGen;
    const t = tags || {};
    const c = t.class || '';
    if (NON_STREET.has(c)) return null;
    const tier = WG.classifyLine('transportation', t);
    if (tier === WG.T.ROAD_MD || tier === WG.T.ROAD_LG) return 'major';
    if (tier === WG.T.ROAD && (c === 'minor' || c === 'street')) return 'minor';
    return null;
  }
  // Is this a way a vehicle drives (junction / dead-end tests)?
  function isVehicleTags(tags) {
    const WG = root.WorldGen;
    const c = (tags && tags.class) || '';
    if (c === 'rail' || c === 'transit' || c === 'ferry' || c === 'aerialway') return false;
    const tier = WG.classifyLine('transportation', tags || {});
    return tier === WG.T.ROAD || tier === WG.T.ROAD_MD || tier === WG.T.ROAD_LG;
  }

  // Rarity and choice have independent hash lanes. Names and surroundings
  // redistribute the special roads; they never increase their total share.
  function selectionWeights(name, size, context) {
    const weights = STREET_VARIANTS.filter(row => row.size === size && row.share > 0).map(row => {
      const named = !!(name && row.words && row.words.test(name));
      const nameMultiplier = named ? Math.min(NUDGED_SHARE_MAX, row.share * (row.nudge || NAME_NUDGE)) / row.share : 1;
      const contextMultiplier = root.ZoneVariants?.affinityMultiplier(row.affinities, context) || 1;
      return { id: row.id, baseWeight: row.share, nameMultiplier, contextMultiplier,
        weight: row.share * nameMultiplier * contextMultiplier };
    });
    const golden = size === 'minor' && weights.find(row => row.id === 'golden');
    const goldenShare = golden ? golden.baseWeight / MINOR_VARIANT_SHARE : 0;
    const total = weights.reduce((sum, row) => sum + (row === golden ? 0 : row.weight), 0);
    for (const row of weights) row.probability = row === golden ? goldenShare : (1 - goldenShare) * row.weight / total;
    return weights;
  }
  function variantFor(key, name, size, context) {
    if (!key || !size) return null;
    const weights = selectionWeights(name, size, context);
    const share = size === 'minor' ? MINOR_VARIANT_SHARE : weights.reduce((sum, row) => sum + row.baseWeight, 0);
    if (u01('street|' + key) >= share || !weights.length) return null;
    let ticket = u01(size === 'minor' ? 'street-kind|' + key : 'street-choice|' + key);
    const golden = weights.find(row => row.id === 'golden');
    if (golden) {
      if (ticket < golden.probability) return golden.id;
      ticket -= golden.probability;
    }
    for (const row of weights) {
      if (row === golden) continue;
      ticket -= row.probability;
      if (ticket < 0) return row.id;
    }
    return weights[weights.length - 1].id;
  }

  // Preserve the original rock substrate used to derive existing caves.
  // Surface rocks are reconciled against the final theme after zone coverage.
  function substrateVariantFor(key, name, size) {
    let cumulative = 0;
    const roll = u01('street|' + key);
    for (const row of STREET_VARIANTS) {
      if (row.size !== size || row.id === 'golden' || row.id === 'thorny') continue;
      const share = row.id === 'hedgerow' || row.id === 'overgrown' ? 0.10 : row.share;
      cumulative += name && row.words && row.words.test(name)
        ? Math.min(NUDGED_SHARE_MAX, share * (row.nudge || NAME_NUDGE)) : share;
      if (roll < cumulative) return row.id;
    }
    return null;
  }

  const AFFINITY_SAMPLE_M = 20;
  // Final coverage is the same ownership field as zone art and lamp tint.
  // Eligible roads are wholly inside this tile; never consult loaded neighbours.
  // Canonical, unique segments make reversal and duplicate features immaterial.
  function* applyAffinitiesSteps(index, zone, N, mvtToM, geography = {}) {
    if (!index || !(N > 0) || !(mvtToM > 0)) return;
    const coverage = zone && (zone.coverage || zone.idx);
    const groups = new Map(), zoneTraits = new Map();
    const WG = root.WorldGen, nearby = new Map();
    const poiCells = new Set((geography.pois || []).filter(p => p.ix >= 0 && p.iy >= 0 && p.ix < N && p.iy < N).map(p => p.iy * N + p.ix));
    // Reuse public-frontage ground and reach. Roads and paths are routes,
    // not destinations: a road alone must not favour its own Lantern Row.
    const destinationAt = (x, y) => {
      if (x < 0 || y < 0 || x >= N || y >= N) return false;
      const key = y * N + x;
      if (nearby.has(key)) return nearby.get(key);
      const radius = WG.SPAWN_FRONTAGE;
      for (let iy = Math.max(0, y - radius); iy <= Math.min(N - 1, y + radius); iy++) {
        for (let ix = Math.max(0, x - radius); ix <= Math.min(N - 1, x + radius); ix++) {
          const i = iy * N + ix;
          const land = geography.grid && (root.Zones
            ? root.Zones.landAt(geography.grid, zone && zone.under, i) : geography.grid[i]);
          const publicArea = WG.PUBLIC_NEAR.has(land)
            && ![WG.T.ROAD, WG.T.ROAD_MD, WG.T.ROAD_LG, WG.T.PATH].includes(land);
          if (poiCells.has(i) || publicArea) { nearby.set(key, true); return true; }
        }
      }
      nearby.set(key, false);
      return false;
    };
    const cell = p => ({ x: Math.floor(p.x * N / index.extent), y: Math.floor(p.y * N / index.extent) });
    for (const rec of index.lines) {
      if (!rec.variantEligible) continue;
      const key = rec.size + '|' + rec.affinityKey;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rec);
    }
    for (const records of groups.values()) {
      const segments = new Map(), context = {}, ends = new Map();
      let total = 0, samples = 0;
      for (const rec of records) for (let i = 1; i < rec.line.length; i++) {
        let a = rec.line[i - 1], b = rec.line[i];
        if (a.x > b.x || (a.x === b.x && a.y > b.y)) [a, b] = [b, a];
        segments.set(`${a.x},${a.y}|${b.x},${b.y}`, [a, b]);
      }
      for (const [, [a, b]] of [...segments].sort((a, b) => a[0].localeCompare(b[0]))) {
        for (const p of [a, b]) {
          const key = `${p.x},${p.y}`, end = ends.get(key);
          ends.set(key, { p, degree: (end ? end.degree : 0) + 1 });
        }
        const metres = Math.hypot(b.x - a.x, b.y - a.y) * mvtToM;
        if (!metres) continue;
        const count = Math.ceil(metres / AFFINITY_SAMPLE_M), weight = metres / count;
        for (let i = 0; i < count; i++) {
          const t = (i + .5) / count;
          const x = Math.floor((a.x + (b.x - a.x) * t) * N / index.extent);
          const y = Math.floor((a.y + (b.y - a.y) * t) * N / index.extent);
          const slot = coverage && x >= 0 && y >= 0 && x < N && y < N ? coverage[y * N + x] : 0;
          if (!zoneTraits.has(slot)) {
            const anchor = slot && zone.anchors[slot - 1];
            zoneTraits.set(slot, anchor && root.ZoneVariants ? root.ZoneVariants.traitsFor(root.ZoneVariants.pick(anchor)) : []);
          }
          const traits = zoneTraits.get(slot).slice();
          if (destinationAt(x, y)) traits.push('destination');
          if (traits.length) for (const trait of traits) context[trait] = (context[trait] || 0) + weight / traits.length;
          else context.neutral = (context.neutral || 0) + weight;
          total += weight;
          if ((++samples & 127) === 0) yield 'street affinity samples';
        }
      }
      // An actual road end near a destination favours the whole approach,
      // even when most of that approach runs through ordinary residential land.
      // Unique segment degrees ignore duplicates and internal feature cuts.
      const leadsSomewhere = [...ends.values()].some(({ p, degree }) => {
        const c = cell(p);
        return degree === 1 && destinationAt(c.x, c.y);
      });
      if (leadsSomewhere) { context.destination = (context.destination || 0) + total; total *= 2; }
      for (const trait of Object.keys(context)) context[trait] /= total;
      const first = records[0];
      const variant = variantFor(first.affinityKey, first.name, first.size, context);
      for (const rec of records) {
        rec.affinityContext = context;
        rec.selectedVariant = variant;
        rec.variant = !rec.variantRanges || rec.variantRanges.length ? variant : null;
        rec.rocks = rocksFor(rec.key, rec.size, variant);
      }
      for (const rec of index.dressingLines || []) if (rec.key === first.affinityKey && rec.size === first.size) {
        rec.variant = variant;
        rec.affinityContext = context;
      }
      yield 'street affinities';
    }
  }
  // Is this street one of the rock-lined ones? Minor only, never a hedgerow.
  function rocksFor(key, size, variant) {
    return size === 'minor' && variant !== 'hedgerow' && !!key
      && u01('rocks|' + key) < ROCK_STREET_SHARE;
  }

  // Is the stretch of street `key` through lattice square (sx, sy) a bandit
  // stretch? A pure hash of the pair — the same for every player and tile.
  function stretchOf(gx, gy) {
    return { sx: Math.floor(gx / BANDIT_STRETCH_UNITS), sy: Math.floor(gy / BANDIT_STRETCH_UNITS) };
  }
  function isBanditStretch(key, sx, sy) {
    return !!key && u01(`bandit|${key}|${sx},${sy}`) < BANDIT_STRETCH_SHARE;
  }

  // ── The name vote ───────────────────────────────────────────────────────
  const vkey = (x, y) => (x + 16384) * 65536 + (y + 16384);
  function nameVote(tnLayer) {
    const m = new Map();
    if (!tnLayer) return m;
    for (const f of tnLayer.features) {
      const name = f.tags && f.tags.name;
      if (!name || !f.geom) continue;
      for (const line of f.geom) for (const p of line) m.set(vkey(p.x, p.y), name);
    }
    return m;
  }
  // The name most of the line's vertices hit, or null.
  function lineName(line, vote) {
    if (!vote || !vote.size) return null;
    let best = null, bestN = 0;
    const counts = new Map();
    for (const p of line) {
      const n = vote.get(vkey(p.x, p.y));
      if (!n) continue;
      const c = (counts.get(n) || 0) + 1;
      counts.set(n, c);
      if (c > bestN) { bestN = c; best = n; }
    }
    return best;
  }

  // ── Walking a line ──────────────────────────────────────────────────────
  // Calls cb(s, x, y, nx, ny) every `step` metres of arclength from `s0`,
  // with the point and the LEFT normal of its segment (streets.js's
  // convention: left of (dx, dy) is (dy, -dx)). One pass over the vertices —
  // never Streets.pointAtM per sample, which walks from the start each time.
  function sampleLine(line, mToM, step, s0, cb) {
    if (!line || line.length < 2 || !(step > 0)) return;
    let acc = 0, next = s0 > 0 ? s0 : 0;
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1].x * mToM, ay = line[i - 1].y * mToM;
      const dx = line[i].x * mToM - ax, dy = line[i].y * mToM - ay;
      const seg = Math.hypot(dx, dy);
      if (!(seg > 0)) continue;
      const ux = dx / seg, uy = dy / seg;
      while (next <= acc + seg) {
        const u = next - acc;
        if (cb(next, ax + ux * u, ay + uy * u, uy, -ux) === false) return;
        next += step;
      }
      acc += seg;
    }
  }

  // ── The index (built in rasterizeTileSteps, pure MVT) ────────────────────
  // lines: every MAJOR line and every MINOR line of the transportation layer
  //   { fi, li, line, tags, size, name, key, variant, rocks, halfW, lineKey }
  //   (halfW in metres, WorldGen.roadOverlayWidthM / 2: the drawn band's).
  // hoardPois: the POI points a café hoard may be buried beside — the tile's
  //   OWN café points (inside the square: point ownership, never a neighbour
  //   scan), or its own commercial points when it has no café — each
  //   { x, y, gk } (tile-local MVT, gk the GLOBAL point), sorted by
  //   hoardPick(gk). dress seats the first HOARDS_PER_TILE that seat.
  // roadClass: stamped on by stampBanditStretchesSteps (the tile's resolved
  //   roadClass, kerb buffer included) so the dressing can read the buffer.
  // A generator for the tile-build rule: one yield per INDEX_YIELD_LINES.
  const INDEX_YIELD_LINES = 256;
  // Reconstruct canonical paths before sampling. Splitting a line into MVT
  // features, reversing it, or repeating a reversed segment cannot reroll
  // its dressing or restart the coin/plant spacing at artificial cuts.
  function canonicalPaths(lines) {
    const nodes = new Map(), edges = new Set();
    const pointKey = p => `${p.x},${p.y}`;
    const compare = (a, b) => a.x - b.x || a.y - b.y;
    const node = p => {
      const key = pointKey(p);
      if (!nodes.has(key)) nodes.set(key, { key, p, next: new Set() });
      return nodes.get(key);
    };
    const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = node(line[i - 1]), b = node(line[i]);
      if (a.key === b.key) continue;
      a.next.add(b.key); b.next.add(a.key); edges.add(edgeKey(a.key, b.key));
    }
    const sorted = [...nodes.values()].sort((a, b) => compare(a.p, b.p));
    const out = [];
    const walk = (start, next) => {
      const path = [start.p];
      let a = start, b = nodes.get(next);
      while (edges.delete(edgeKey(a.key, b.key))) {
        path.push(b.p);
        if (b.next.size !== 2 || b.key === start.key) break;
        const forward = [...b.next].find(k => k !== a.key);
        a = b; b = nodes.get(forward);
      }
      // Remove redundant collinear vertices introduced by fragmentation.
      const clean = [];
      for (const p of path) {
        while (clean.length > 1) {
          const a = clean[clean.length - 2], b = clean[clean.length - 1];
          const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
          const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
          if (Math.abs(cross) > 1e-7 || dot < 0) break;
          clean.pop();
        }
        clean.push(p);
      }
      if (clean.length > 1) out.push(clean);
    };
    for (const n of sorted.filter(n => n.next.size !== 2)) {
      for (const k of [...n.next].sort((a, b) => compare(nodes.get(a).p, nodes.get(b).p))) {
        if (edges.has(edgeKey(n.key, k))) walk(n, k);
      }
    }
    // Closed rings have no endpoint; start at their smallest coordinate.
    for (const n of sorted) for (const k of [...n.next].sort((a, b) => compare(nodes.get(a).p, nodes.get(b).p))) {
      if (edges.has(edgeKey(n.key, k))) walk(n, k);
    }
    return out;
  }

  function clipPath(line, left, top, right, bottom) {
    const paths = [];
    let path = null;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], dx = b.x - a.x, dy = b.y - a.y;
      // Half-open ownership: a line along a grid boundary belongs only to
      // the patch on its right/bottom, never both neighbouring patches.
      if ((!dx && a.x >= right) || (!dy && a.y >= bottom)) { path = null; continue; }
      let lo = 0, hi = 1;
      for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]]) {
        if (p === 0) { if (q < 0) { lo = 2; break; } continue; }
        const t = q / p;
        if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      }
      if (lo >= hi) { path = null; continue; }
      const p = { x: a.x + dx * lo, y: a.y + dy * lo };
      const q = { x: a.x + dx * hi, y: a.y + dy * hi };
      const last = path && path[path.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-7) {
        path = [p]; paths.push(path);
      }
      path.push(q);
    }
    return paths;
  }

  // MVT-arclength intervals of an original source line covered by canonical theme
  // paths. The renderer/lamp pass reads these same intervals as the dressing.
  function* themeRanges(line, themed, mvtToM) {
    const ranges = [];
    let comparisons = 0;
    let metres = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy), len2 = len * len;
      if (!len) continue;
      for (const path of themed) for (let j = 1; j < path.length; j++) {
        if ((++comparisons & 511) === 0) yield 'street theme interval geometry';
        const p = path[j - 1], q = path[j];
        const dist = r => Math.abs((r.x - a.x) * dy - (r.y - a.y) * dx) / len;
        if (dist(p) > 1e-5 || dist(q) > 1e-5) continue;
        const t = r => ((r.x - a.x) * dx + (r.y - a.y) * dy) / len2;
        const lo = Math.max(0, Math.min(t(p), t(q))), hi = Math.min(1, Math.max(t(p), t(q)));
        if (hi > lo + 1e-9) ranges.push([metres + lo * len * mvtToM, metres + hi * len * mvtToM]);
      }
      metres += len * mvtToM;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const span of ranges) {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], span[1]);
      else merged.push(span.slice());
    }
    return merged;
  }

  function variantAt(rec, metres, mvtToM = 1) {
    if (!rec || !rec.variant) return null;
    metres /= mvtToM;
    return !rec.variantRanges || rec.variantRanges.some(([a, b]) => metres >= a - 1e-6 && metres <= b + 1e-6)
      ? rec.variant : null;
  }

  function lineParts(rec, mvtToM) {
    const length = root.Streets.lineLengthM(rec.line, mvtToM);
    const cuts = [0, length];
    for (const span of rec.variantRanges || []) for (const end of span) {
      cuts.push(Math.max(0, Math.min(length, end * mvtToM)));
    }
    cuts.sort((a, b) => a - b);
    const out = [];
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i];
      if (b - a < 1e-6) continue;
      out.push({ a, b, variant: variantAt(rec, (a + b) / 2, mvtToM) });
    }
    return out;
  }

  // Same split geometry for the map-review overlay and in-game QC labels.
  function displayLines(index, mvtToM) {
    const out = [];
    for (const rec of index.lines || []) for (const part of lineParts(rec, mvtToM)) {
      const line = root.Streets.subLineM(rec.line, mvtToM, part.a, part.b)
        .map(p => ({ x: p.x / mvtToM, y: p.y / mvtToM }));
      out.push({ ...rec, line, variant: part.variant });
    }
    return out;
  }

  function* buildIndexSteps(layers, tx, ty, mvtToM) {
    const WG = root.WorldGen, S = root.Streets;
    const out = { lines: [], dressingLines: [], hoardPois: [], extent: 4096 };
    if (!layers || !WG) return out;
    let tr = null, tn = null, poi = null;
    for (const l of layers) {
      if (l.name === 'transportation') tr = l;
      else if (l.name === 'transportation_name') tn = l;
      else if (l.name === 'poi') poi = l;
    }
    if (tr) {
      const ext = tr.extent || 4096;
      out.extent = ext;
      const vote = nameVote(tn);
      yield 'street names';
      let n = 0;
      for (let fi = 0; fi < tr.features.length; fi++) {
        const f = tr.features[fi];
        if (f.type !== 2 || !f.geom) continue;
        const size = sizeOfTags(f.tags);
        if (!size) continue;
        for (let li = 0; li < f.geom.length; li++) {
          const line = f.geom[li];
          if (!line || line.length < 2) continue;
          if ((++n % INDEX_YIELD_LINES) === 0) yield 'street index lines';
          const rec = { fi, li, line, tags: f.tags, size };
          const name = lineName(line, vote);
          const key = name ? streetKey(name, tx, ty) : anonKey(tx, ty, line);
          const variant = variantFor(key, name, size);
          rec.name = name;
          rec.key = key;
          rec.variant = variant;
          rec.rocks = rocksFor(key, size, variant);
          rec.halfW = WG.roadOverlayWidthM(f.tags || {}) / 2;
          rec.lineKey = S ? S.lineKey(f, li) : `${fi}:${li}`;
          out.lines.push(rec);
        }
      }
      // MVT supplies tile-local fragments, not whole OSM ways. Pool named
      // fragments, and join unnamed fragments at their shared endpoints; a
      // split feature must not evade the length cap. No loaded-tile state.
      const groups = new Map(), unnamedEnds = new Map();
      const parent = out.lines.map((_, i) => i);
      const find = (i) => { while (parent[i] !== i) i = parent[i]; return i; };
      const join = (a, b) => { parent[find(a)] = find(b); };
      out.lines.forEach((rec, i) => {
        if (rec.name) {
          const groupKey = rec.size + '|' + rec.key;
          if (groups.has(groupKey)) join(i, groups.get(groupKey));
          else groups.set(groupKey, i);
        } else for (const p of [rec.line[0], rec.line[rec.line.length - 1]]) {
          const k = `${rec.size}|${p.x},${p.y}`;
          if (unnamedEnds.has(k)) join(i, unnamedEnds.get(k));
          else unnamedEnds.set(k, i);
        }
      });
      const lengths = new Map();
      out.lines.forEach((rec, i) => {
        const k = find(i);
        let group = lengths.get(k);
        if (!group) lengths.set(k, group = { metres: 0, clipped: false, segments: new Set(), records: [] });
        group.records.push(rec);
        if (rec.line.some((p) => p.x <= 0 || p.y <= 0 || p.x >= ext || p.y >= ext)) group.clipped = true;
        for (let j = 1; j < rec.line.length; j++) {
          const a = rec.line[j - 1], b = rec.line[j];
          const ak = `${a.x},${a.y}`, bk = `${b.x},${b.y}`;
          const edge = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
          if (group.segments.has(edge)) continue;
          group.segments.add(edge);
          group.metres += Math.hypot(b.x - a.x, b.y - a.y) * mvtToM;
        }
      });
      // Every selected street remains eligible. Long/unknown streets use
      // compact tile-aligned patches instead of silently losing their theme.
      // Canonical paths make the geometry independent of feature order/cuts.
      for (const group of lengths.values()) {
        yield 'street theme paths';
        const records = group.records;
        const canonical = canonicalPaths(records.map(rec => rec.line));
        const source = records.slice().sort((a, b) => a.key.localeCompare(b.key))[0];
        const key = source.name ? source.key : canonical.map(line => anonKey(tx, ty, line)).join(';');
        const selected = variantFor(key, source.name, source.size);
        const prototype = { ...source, key, variant: selected, halfW: Math.max(...records.map(r => r.halfW)) };
        const limits = sectionLimits(selected);
        const bounded = group.clipped || group.metres > limits.maxM;
        const long = group.clipped || group.metres > LONG_ROAD_M;
        const paths = [];
        if (selected && group.metres >= limits.minM) {
          if (!bounded) paths.push(...canonical.map(line => ({ line, patch: null })));
          else {
            const units = long ? LONG_PATCH_UNITS : VARIANT_PATCH_UNITS;
            for (let py = 0; py < ext; py += units) {
              for (let px = 0; px < ext; px += units) {
                yield 'street theme patch';
                const patch = `${tx * ext + px},${ty * ext + py}`;
                let budget = limits.maxM;
                for (const path of canonical) {
                  for (const line of clipPath(path, px, py, px + units, py + units)) {
                    if (budget <= 1e-6) break;
                    const length = S.lineLengthM(line, mvtToM);
                    // Trim ALONG the road, never perpendicular to it: otherwise
                    // a road following a lattice boundary would disappear.
                    const keptLength = Math.min(length * limits.share, budget);
                    const trim = (length - keptLength) / 2;
                    if (keptLength < limits.minM) continue;   // too short to read as a section
                    const kept = S.subLineM(line, mvtToM, trim, trim + keptLength)
                      .map(p => ({ x: p.x / mvtToM, y: p.y / mvtToM }));
                    paths.push({ line: kept, patch });
                    budget -= keptLength;
                  }
                }
              }
            }
          }
        }
        for (const { line, patch } of paths) {
          const lineKey = line.map(p => `${p.x},${p.y}`).join('|');
          out.dressingLines.push({ ...prototype, line, lineKey, patch,
            variant: selected, streetLengthM: group.metres });
        }
        for (const rec of records) {
          yield 'street theme intervals';
          const substrateKey = rec.key;
          rec.key = key;
          rec.affinityKey = key;
          rec.variantEligible = !bounded;
          rec.rocks = rocksFor(substrateKey, rec.size, substrateVariantFor(substrateKey, rec.name, rec.size));
          rec.streetLengthM = group.metres;
          rec.selectedVariant = selected;
          rec.variantRanges = yield* themeRanges(rec.line, paths.map(p => p.line), 1);
          rec.variant = rec.variantRanges.length ? selected : null;
          // Keep the independent rock treatment compact too; it is not one
          // of the themed dressing rows and has no interval consumer.
          if (bounded) rec.rocks = false;
        }
      }
      yield 'street index';
    }
    out.hoardPois = hoardPoisOf(poi, tx, ty, out.extent);
    yield 'street hoard pois';
    return out;
  }
  function buildIndex(layers, tx, ty, mvtToM) {
    const it = buildIndexSteps(layers, tx, ty, mvtToM);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  // Squared distance from a line segment to one cell square. A clipped MVT
  // centreline may sit outside the tile while its band and verge cross it, so
  // the test must use the full segment, not tileSpans of its centreline.
  function segmentCellD2(ax, ay, bx, by, ix, iy) {
    const dx = bx - ax, dy = by - ay;
    // Liang-Barsky clipping: intersection makes the distance zero.
    let lo = 0, hi = 1;
    for (const [p, q] of [[-dx, ax - ix], [dx, ix + 1 - ax],
      [-dy, ay - iy], [dy, iy + 1 - ay]]) {
      if (p === 0) { if (q < 0) { lo = 2; break; } continue; }
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
    }
    if (lo <= hi) return 0;
    const pointBoxD2 = (x, y) => {
      const ox = Math.max(ix - x, 0, x - ix - 1);
      const oy = Math.max(iy - y, 0, y - iy - 1);
      return ox * ox + oy * oy;
    };
    let best = Math.min(pointBoxD2(ax, ay), pointBoxD2(bx, by));
    const len2 = dx * dx + dy * dy;
    for (const x of [ix, ix + 1]) for (const y of [iy, iy + 1]) {
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      const ex = x - ax - t * dx, ey = y - ay - t * dy;
      best = Math.min(best, ex * ex + ey * ey);
    }
    return best;
  }

  // Reserve the full band and themed verge of each themed street,
  // including deliberate gaps between furniture. Test cell squares against
  // the geometry; sample spacing or a missed loop endpoint cannot make holes.
  function* areaSteps(index, N) {
    const area = new Uint8Array(N * N);
    const WG = root.WorldGen;
    if (!index || !WG || !(N > 0)) return area;
    const ext = index.extent || 4096;
    const cellM = WG.CELL_M;
    const toCell = N / ext;
    let segments = 0;
    let candidates = 0;
    for (const rec of (index.dressingLines || index.lines)) {
      if (!rec.variant) continue;
      yield 'street area';
      const radius = rec.halfW / cellM + TERRAIN_VERGE_CELLS;
      for (let j = 1; j < rec.line.length; j++) {
        if ((++segments & 127) === 0) yield 'street area segments';
        const a = rec.line[j - 1], b = rec.line[j];
        const ax = a.x * toCell, ay = a.y * toCell;
        const bx = b.x * toCell, by = b.y * toCell;
        const left = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
        const right = Math.min(N - 1, Math.floor(Math.max(ax, bx) + radius));
        const top = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
        const bottom = Math.min(N - 1, Math.floor(Math.max(ay, by) + radius));
        const r2 = radius * radius;
        for (let iy = top; iy <= bottom; iy++) for (let ix = left; ix <= right; ix++) {
          if ((++candidates & 511) === 0) yield 'street area cells';
          if (segmentCellD2(ax, ay, bx, by, ix, iy) <= r2) area[iy * N + ix] = 1;
        }
      }
    }
    return area;
  }
  function area(index, N) {
    const it = areaSteps(index, N);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  function terrainFor(variant) {
    return root.WorldGen?.T[VARIANT_BY_ID[variant]?.terrain] ?? null;
  }

  // Select all themes before painting. Theme the ground continuously beneath
  // the road and out to its 1.5-cell verge. Road/path codes stay intact;
  // streetGround stores their visible base as terrain + 1 (zero = unset).
  // Intersections prefer the nearest
  // road edge, with a stable key breaking ties. Source access reasons remain
  // authoritative: a cosmetic commercial verge does not become private land.
  function* paintTerrainSteps({ index, scenic, transportation, grid, N, roadMask, spawnWhy, zone, streetGround }) {
    const WG = root.WorldGen, S = root.Streets;
    const painted = new Uint8Array(N * N);
    if (!WG || !S) return painted;
    const records = [];
    const ext = index?.extent || scenic?.ext || transportation?.extent || 4096;
    for (const rec of index?.dressingLines || []) {
      if (terrainFor(rec.variant) != null) records.push(rec);
    }
    const scale = N * WG.CELL_M / ext;
    for (const f of transportation?.features || []) {
      if (f.type !== 2) continue;
      for (let li = 0; li < (f.geom || []).length; li++) {
        const key = S.lineKey(f, li);
        for (const iv of scenic?.lines?.get(key) || []) {
          const variant = root.Scenic.KIND_ROW[iv[2]];
          if (terrainFor(variant) == null) continue;
          records.push({ key, variant, halfW: WG.roadOverlayWidthM(f.tags) / 2,
            line: S.subLineM(f.geom[li], scale, iv[0] * scale, iv[1] * scale)
              .map(p => ({ x: p.x / scale, y: p.y / scale })) });
        }
      }
    }
    if (!records.length) return painted;
    const ordinal = (a,b) => a < b ? -1 : a > b ? 1 : 0;
    records.sort((a,b) => ordinal(String(a.key),String(b.key)) || ordinal(a.variant,b.variant));
    const nearest = new Float32Array(N * N).fill(Infinity);
    const original = grid.slice();
    let candidates = 0;
    for (const rec of records) {
      yield 'street terrain lines';
      const half = rec.halfW / WG.CELL_M, radius = half + TERRAIN_VERGE_CELLS;
      for (let j = 1; j < rec.line.length; j++) {
        const a = rec.line[j - 1], b = rec.line[j];
        const ax = a.x * N / ext, ay = a.y * N / ext;
        const bx = b.x * N / ext, by = b.y * N / ext;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        for (let y = Math.max(0, Math.floor(Math.min(ay, by) - radius)); y <= Math.min(N-1, Math.floor(Math.max(ay, by) + radius)); y++) {
          for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - radius)); x <= Math.min(N-1, Math.floor(Math.max(ax, bx) + radius)); x++) {
            if ((++candidates & 511) === 0) yield 'street terrain cells';
            const i = y * N + x, here = original[i];
            if (zone?.coverage?.[i] || zone?.under?.present?.[i] || zone?.under?.[i]) continue;
            // Road/terrain spawn exclusions remain unchanged; only land-access
            // exclusions prevent this visual ground paint.
            if ((spawnWhy?.[i] || 0) & WG.SPAWN_WHY_LAND) continue;
            if ((!WG.isWalkable(here) && !WG.isCobbleTerrain(here))
                || WG.isBuildingTerrain(here) || here === WG.T.PIER) continue;
            const t = len2 ? Math.max(0, Math.min(1, ((x+.5-ax)*dx + (y+.5-ay)*dy)/len2)) : 0;
            const distance = Math.hypot(x+.5-ax-t*dx, y+.5-ay-t*dy) - half;
            if (distance > TERRAIN_VERGE_CELLS || distance >= nearest[i] - 1e-6) continue;
            nearest[i] = distance;
            const terrain = terrainFor(rec.variant);
            if (WG.isCobbleTerrain(here)) {
              if (streetGround) streetGround[i] = terrain + 1;
            } else {
              grid[i] = terrain;
              painted[i] = 1;
            }
          }
        }
      }
    }
    return painted;
  }

  // The café hoard's pick: a pure hash of the POI's GLOBAL MVT point, the
  // same for every player and whichever tile asks.
  function hoardPick(gk) { return u01('hoard|' + gk); }
  // The tile's own hoard POIs (see buildIndexSteps' hoardPois). Linear in
  // the poi layer.
  function hoardPoisOf(poiLayer, tx, ty, ext) {
    const cafes = [], other = [];
    if (!poiLayer || !poiLayer.features) return cafes;
    const seen = new Set();
    for (const f of poiLayer.features) {
      if (f.type !== 1 || !f.geom) continue;
      const cls = (f.tags && f.tags.class) || '';
      const isCafe = HOARD_POI_CLASSES.has(cls);
      if (!isCafe && !HOARD_POI_FALLBACK.has(cls)) continue;
      for (const ring of f.geom) {
        const p = ring && ring[0];
        if (!p || p.x < 0 || p.y < 0 || p.x >= ext || p.y >= ext) continue;   // the neighbour's
        const gk = `${tx * ext + p.x},${ty * ext + p.y}`;
        if (seen.has(gk)) continue;
        seen.add(gk);
        (isCafe ? cafes : other).push({ x: p.x, y: p.y, gk, u: hoardPick(gk) });
      }
    }
    const list = cafes.length ? cafes : other;
    list.sort((a, b) => a.u - b.u || (a.gk < b.gk ? -1 : 1));
    return list;
  }

  // ── Stamping the bandit stretches (rasterizeTileSteps, after roadClass) ──
  // For every MAJOR line piece in the tile, walk its arclength (buffer
  // included), and wherever the WAY is on a bandit stretch mark the cells
  // across the band out to its verge (halfW + BANDIT_STAMP_OUT_CELLS). A
  // major-VERGE cell (WorldGen.ROAD_CLASS_MAJOR_VERGE) under a mark gains
  // ROAD_CLASS_BANDIT_VERGE. Generation cells throughout (gM = N·CELL_M/ext),
  // never frame metres. A generator: one yield per major line.
  const BANDIT_STAMP_OUT_CELLS = 2;
  function* stampBanditStretchesSteps(index, roadClass, N, tx, ty) {
    const WG = root.WorldGen, S = root.Streets;
    if (!index || !roadClass || !WG || !S || !(N > 0)) return 0;
    // The tile's resolved roadClass, kept on the index so the dressing (run
    // later in the same build) can read the kerb buffer when its caller's
    // spawn options carry none — one array, never a second reading.
    index.roadClass = roadClass;
    const ext = index.extent || 4096;
    const CELL_M = WG.CELL_M;
    const gM = (N * CELL_M) / ext;
    const VERGE = WG.ROAD_CLASS_MAJOR_VERGE, BANDIT = WG.ROAD_CLASS_BANDIT_VERGE;
    const ox = tx * ext, oy = ty * ext;
    let n = 0;
    for (const rec of index.lines) {
      if (rec.size !== 'major') continue;
      yield 'bandit stretches';
      const r = rec.halfW + BANDIT_STAMP_OUT_CELLS * CELL_M;
      const memo = new Map();
      // The WHOLE piece, buffer included (no tileSpans cut): a way running
      // just past the tile edge still has its verge inside — and the stretch
      // is the square the WAY is in, the same from either tile.
      sampleLine(rec.line, gM, CELL_M * 0.7, 0, (s, x, y, nx, ny) => {
        const st = stretchOf(ox + x / gM, oy + y / gM);
        const mk = st.sx * 65536 + st.sy;
        let on = memo.get(mk);
        if (on === undefined) memo.set(mk, on = isBanditStretch(rec.key, st.sx, st.sy));
        if (!on) return;
        for (let o = -r; o <= r; o += CELL_M * 0.7) {
          const ix = Math.floor((x + nx * o) / CELL_M), iy = Math.floor((y + ny * o) / CELL_M);
          if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
          const i = iy * N + ix;
          if ((roadClass[i] & VERGE) && !(roadClass[i] & BANDIT)) { roadClass[i] |= BANDIT; n++; }
        }
      });
    }
    return n;
  }

  // ── Bandit stops (the old trade road's wagons — a LOOK) ─────────────────
  // Stamp `banditStop` on the bus-stop chests within BUS_STOP_MAJOR_CELLS of
  // a MAJOR band (roadClass bit 1) that isWagonStop picks (WAGON_STOP_SHARE).
  // The chest itself is untouched otherwise: same id, tier, contents and
  // `opened` semantics; loot.js chestLook reads the flag to wear the wagon.
  // Its memoised look is dropped so a stop drawn before this pass re-resolves.
  // NO GUARD (the owner, Sep 2026: no wagon goblins at all — a stop is on the
  // kerb of a major road by definition). Returns the lair candidates it adds
  // — always NONE now; kept an (empty) array so a caller that still iterates
  // it (scene_creatures.js spawnInTile) needs no change.
  function isWagonStop(id) { return !!id && u01('wagon|' + id) < WAGON_STOP_SHARE; }
  function markBanditStops(objects, roadClass, N, tx, ty, tileEdgeM) {
    const WG = root.WorldGen;
    const lairs = [];
    if (!objects || !roadClass || !(N > 0)) return lairs;
    const cellM = tileEdgeM / N;
    const R = BUS_STOP_MAJOR_CELLS;
    for (const o of objects) {
      if (!o || o.kind !== 'chest' || o.poiClass !== 'bus' || o.depth > 0) continue;
      const ix = Math.floor((o.x - tx * tileEdgeM) / cellM);
      const iy = Math.floor((o.y - ty * tileEdgeM) / cellM);
      if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
      let near = false;
      for (let dy = -R; dy <= R && !near; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = ix + dx, y = iy + dy;
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          if (roadClass[y * N + x] & WG.ROAD_CLASS_MAJOR_BAND) { near = true; break; }
        }
      }
      if (!near || !isWagonStop(o.id)) continue;
      o.banditStop = true;
      delete o._chestLook;
    }
    return lairs;
  }

  // ── Seating a foe back from the kerb ────────────────────────────────────
  // The offsets within FOE_SEAT_BACK_CELLS / HOARD_SEAT_CELLS, nearest first
  // (ties row-major) — built once, so the search order is a constant.
  function offsetsWithin(R) {
    const out = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= R * R) out.push({ dx, dy, d2 });
      }
    }
    out.sort((a, b) => a.d2 - b.d2 || a.dy - b.dy || a.dx - b.dx);
    return out;
  }
  const BACK_OFFSETS = offsetsWithin(FOE_SEAT_BACK_CELLS);
  const HOARD_OFFSETS = offsetsWithin(HOARD_SEAT_CELLS);
  // Does the straight walk from cell (x0, y0) to (x1, y1) touch a MAJOR band
  // cell? Sampled four times a cell, so a band a cell wide is never stepped
  // over. The "same side of the road" test: a seat reached without crossing
  // the band is on the side it started. The START cell is not asked: the
  // band bit covers every cell the band so much as grazes (wider than
  // roadMask), so a verge cell or a café's own cell may carry it, and a walk
  // AWAY from the road must still be allowed out of it.
  function crossesMajorBand(roadClass, N, x0, y0, x1, y1) {
    if (!roadClass) return false;
    const WG = root.WorldGen;
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4));
    for (let k = 1; k <= steps; k++) {
      const x = Math.floor(x0 + 0.5 + dx * k / steps), y = Math.floor(y0 + 0.5 + dy * k / steps);
      if (x === x0 && y === y0) continue;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (WG.onMajorBand(roadClass, N, x, y)) return true;
    }
    return false;
  }
  // The first cell of `offsets` round (ix, iy) that passes `ok` and is
  // reached without crossing a major band, or null.
  function nearestSeat(ix, iy, N, roadClass, offsets, ok) {
    for (const o of offsets) {
      const x = ix + o.dx, y = iy + o.dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (!ok(x, y)) continue;
      if (crossesMajorBand(roadClass, N, ix, iy, x, y)) continue;
      return { ix: x, iy: y };
    }
    return null;
  }

  // ── Dressing (the end of rasterizeTileSteps; laid by spawnInTile) ─────────
  // ctx: { index, tx, ty, N, tileEdgeM, grid (the GENERATED grid), spawnOpts
  //        (roadMask + occupied + pois [+ roadClass] — occupied GROWS: each
  //        placed piece claims its cell, so later spawners and later pieces
  //        see it; roadClass, when absent, is read off index.roadClass) }
  // Returns { objects, wildplants, treasures, lairs, slowCells (Map cell
  // index → 'tar' | 'stakes'), marks } —
  // marks is a Uint8Array (N*N) of variant codes on each dressed line's band
  // and verge (the story trigger reads it), or null when nothing is dressed.
  function dress(ctx) {
    const it = dressSteps(ctx);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }
  // The same, as a generator — rasterizeTileSteps drives it (one yield per
  // dressed line), so the dressing is paid inside the sliced tile build and
  // never in the unsliced spawn pass (CLAUDE.md, the worst-block rule).
  function* dressSteps(ctx) {
    const WG = root.WorldGen, S = root.Streets;
    const res = { objects: [], wildplants: [], treasures: [], coins: [], traps: [], lairs: [], slowCells: new Map(), marks: null };
    const idx = ctx && ctx.index;
    if (!idx || !WG || !S) return res;
    const { tx, ty, N, tileEdgeM, grid, spawnOpts } = ctx;
    const ext = idx.extent || 4096;
    const CELL_M = WG.CELL_M;
    const gM = (N * CELL_M) / ext;            // GENERATION metres per MVT unit
    const frameCellM = tileEdgeM / N;
    const ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const occ = spawnOpts.occupied || (spawnOpts.occupied = new Set());
    // The verge dressing is scenery — a MINOR spawn (the spawn gate).
    const cellOk = (ix, iy) => ix >= 0 && iy >= 0 && ix < N && iy < N
      && WG.isSpawnCell(grid, N, N, ix, iy, spawnOpts, 'minor');
    // A hoard is an ATTRACTOR: OPEN ground only.
    const hoardOk = (ix, iy) => ix >= 0 && iy >= 0 && ix < N && iy < N
      && WG.isSpawnCell(grid, N, N, ix, iy, spawnOpts, 'attractor');
    const claim = (ix, iy) => { occ.add(iy * N + ix); };
    // THE KERB BUFFER: the caller's roadClass, else the one the stamp pass
    // left on the index (nearestSeat keeps a seat on its side of the band).
    // A STREET GUARD'S POINT (a waystone's, a barricade's, a guarded hoard's)
    // is where a runner stands — the barricade's goblin, the hoard's giant —
    // so it takes the FAST foe's class ('fastEnemy': the attractor row plus
    // the kerb): a point in the buffer would leave its guard ring nowhere to
    // seat. Found by foeSeat, seated BACK from the kerb.
    const rc = spawnOpts.roadClass || idx.roadClass || null;
    const foeOpts = rc && !spawnOpts.roadClass ? Object.assign({}, spawnOpts, { roadClass: rc }) : spawnOpts;
    const foeOk = (ix, iy) => WG.isSpawnCell(grid, N, N, ix, iy, foeOpts, 'fastEnemy');
    // Seat a foe BACK: its natural cell if it is a foe cell, else the nearest
    // within FOE_SEAT_BACK_CELLS on the same side of any major band — or null
    // (the foe is dropped).
    const foeSeat = (ix, iy) => nearestSeat(ix, iy, N, rc, BACK_OFFSETS, foeOk);
    const cx = (ix) => ox + (ix + 0.5) * frameCellM;
    const cy = (iy) => oy + (iy + 0.5) * frameCellM;
    const cellOfM = (m) => Math.floor(m / CELL_M);
    // The first spawnable verge cell k = 1..VERGE_MAX_CELLS out from the
    // band's edge at arclength point (x, y) with left normal (nx, ny).
    const verge = (rec, x, y, nx, ny, side, start = 1) => {
      for (let k = start; k <= VERGE_MAX_CELLS; k++) {
        const off = side * (rec.halfW + (k - 0.5) * CELL_M);
        const ix = cellOfM(x + nx * off), iy = cellOfM(y + ny * off);
        if (cellOk(ix, iy)) return { ix, iy };
      }
      return null;
    };
    // Cross the authored road only, then extend along each normal.
    // Existing pieces from this pass are transparent to repeated samples;
    // every unrelated obstacle terminates the ray instead of being skipped.
    const crossSection = (rec, x, y, nx, ny, depth, owned, emit) => {
      const roadSeats = new Set(), gate = { ...spawnOpts, roadClass: rc, streetObstacleCells: roadSeats, streetObstacleKind: rec.variant };
      for (const side of [1, -1]) {
        const start = 0;
        for (let distance = start; distance <= rec.halfW + depth(side) * CELL_M - CELL_M / 2; distance += CELL_M / 2) {
          const ix = cellOfM(x + nx * side * distance), iy = cellOfM(y + ny * side * distance);
          if (ix < 0 || iy < 0 || ix >= N || iy >= N) break;
          const i = iy * N + ix;
          if (owned.has(i)) continue;
          // Classify the cell center, not the sub-cell sampling point.
          const normalDistance = Math.abs(((ix + .5) * CELL_M - x) * nx + ((iy + .5) * CELL_M - y) * ny);
          const road = normalDistance <= rec.halfW;
          if (road) roadSeats.add(i);
          if (!(road ? WG.isSpawnCell(grid,N,N,ix,iy,gate,'streetObstacle') : cellOk(ix,iy))) break;
          owned.add(i); emit(ix,iy);
        }
      }
    };
    const seat = (px, py) => {
      const ix = cellOfM(px * gM), iy = cellOfM(py * gM);
      if (ix < -END_SEAT_CELLS || iy < -END_SEAT_CELLS
          || ix >= N + END_SEAT_CELLS || iy >= N + END_SEAT_CELLS) return null;
      return WG.relocateToSpawnCell(grid, N, N, ix, iy, spawnOpts, END_SEAT_CELLS, 'minor');
    };
    const marks = new Uint8Array(N * N);
    let marked = false;
    const mark = (rec, code) => {
      const r = rec.halfW + CELL_M;
      const spans = S.tileSpans(rec.line, gM, ext);
      // A cell's width along the way and ~¾ of one across it: dense enough
      // that no cell of the band + verge is skipped (a diagonal cell is
      // √2·CELL_M wide), cheap enough for the unsliced spawn pass.
      sampleLine(rec.line, gM, CELL_M * 0.7, 0, (s, x, y, nx, ny) => {
        if (!S.covers(spans, s)) return;
        for (let o = -r; o <= r; o += CELL_M * 0.7) {
          const ix = cellOfM(x + nx * o), iy = cellOfM(y + ny * o);
          if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
          marks[iy * N + ix] = code;
        }
      });
      marked = true;
    };
    const streamFor = (rec, what) =>
      WG.makeRng(fnv1a(`dress|${what}|${rec.key}|${tx},${ty}|${rec.lineKey}`));
    // Every piece end inside the tile square (where a waystone / barricade
    // stands).
    const ownedEnds = (rec) => {
      const L = rec.line, out = [];
      for (const p of [L[0], L[L.length - 1]]) {
        if (p.x >= 0 && p.y >= 0 && p.x < ext && p.y < ext) out.push(p);
      }
      return out;
    };

    const burnedSeen = new Set();
    // Pilgrim's Way / barricade street key → every owned piece end in the
    // square (tile-local MVT points), in line order.
    const streetEnds = new Map(), habitatSeats = new Set(), snareSeats = new Set();
    // Street key → its dressed pieces here, for the street shrines.
    const shrineStreets = new Map(), thornyShrines = new Set();
    for (const rec of (idx.dressingLines || idx.lines)) {
      const v = rec.variant;
      if (!v) continue;
      yield 'street dressing';
      const row = VARIANT_BY_ID[v];
      mark(rec, row.code);
      const spans = S.tileSpans(rec.line, gM, ext);
      if (!spans.length) continue;
      if (v !== 'thorny' && root.Shrines && root.Shrines.kindForStreet(v)) {
        if (!shrineStreets.has(rec.key)) shrineStreets.set(rec.key, { v, recs: [] });
        shrineStreets.get(rec.key).recs.push({ rec, spans });
      }
      // One finite encounter per themed street and owning tile, independent
      // of how many geometry fragments represent the street. Scenery streams
      // keep their draws; guards share the existing lair persistence lane.
      if (['hedgerow', 'overgrown', 'orchard', 'toadstool'].includes(v)) {
        const sid = `street_habitat_${tx}_${ty}_${v}_${rec.key}`;
        // A hedge encounter uses a regular gate gap, keeping both clipped
        // rows aligned instead of removing an extra hedge for its anchor.
        const step = v === 'hedgerow' ? CELL_M * HEDGE_GATE_EVERY_CELLS : BURNED_GUARD_STEP_M;
        const start = v === 'hedgerow' ? step - CELL_M / 2 : step / 2;
        if (!habitatSeats.has(sid)) sampleLine(rec.line, gM, step, start, (s, x, y, nx, ny) => {
          if (habitatSeats.has(sid)) return false;
          if (!S.covers(spans, s)) return;
          for (const side of [1, -1]) {
            const candidate = verge(rec, x, y, nx, ny, side);
            const c = candidate && foeSeat(candidate.ix, candidate.iy);
            if (!c) continue;
            claim(c.ix, c.iy); habitatSeats.add(sid);
            res.lairs.push({ tier: `street_${v}`, sid,
              lx: (c.ix + 0.5) * frameCellM, ly: (c.iy + 0.5) * frameCellM });
            break;
          }
        });
      }
      if (v === 'snare' && !snareSeats.has(rec.key)) {
        // One cache at the canonical street patch's midpoint, on one verge.
        // The dense two-cell ring stays off roads and outside major buffers;
        // every seat also obeys occupied, private-ground and restriction masks.
        const length = S.lineLengthM(rec.line, gM);
        sampleLine(rec.line, gM, length + CELL_M, length / 2, (s, x, y, nx, ny) => {
          if (!S.covers(spans, s)) return;
          for (const side of [1, -1]) {
            const off = side * (rec.halfW + (SNARE_TRAP_RADIUS_CELLS + 1.5) * CELL_M);
            const ix = cellOfM(x + nx * off), iy = cellOfM(y + ny * off);
            if (!hoardOk(ix, iy) || !foeOk(ix, iy)) continue;
            const traps = [];
            for (let dy = -SNARE_TRAP_RADIUS_CELLS; dy <= SNARE_TRAP_RADIUS_CELLS; dy++) {
              for (let dx = -SNARE_TRAP_RADIUS_CELLS; dx <= SNARE_TRAP_RADIUS_CELLS; dx++) {
                if (!dx && !dy) continue;
                const ax = ix + dx, ay = iy + dy;
                if (!foeOk(ax, ay)) continue;
                traps.push({ id: WG.cellId('trap_snare', tx, ty, ax, ay),
                  x: cx(ax), y: cy(ay), _ix: ax, _iy: ay, _street: v });
              }
            }
            // Do not generate an undefended reward on cramped ground.
            if (traps.length < SNARE_MIN_TRAPS) continue;
            claim(ix, iy);
            for (const trap of traps) claim(trap._ix, trap._iy);
            res.traps.push(...traps);
            res.objects.push(WG.makeObject('chest', cx(ix), cy(iy),
              WG.cellId('chest_snare', tx, ty, ix, iy), { _street: v, name: 'Snare cache' }));
            snareSeats.add(rec.key);
            break;
          }
        });
      } else if (v === 'hedgerow') {
        // One tidy row at the band's edge; obstacles leave a gap instead of
        // pushing individual hedges out of line. Both sides share gate stations.
        sampleLine(rec.line, gM, CELL_M, CELL_M / 2, (s, x, y, nx, ny) => {
          if (!S.covers(spans, s)) return;
          if (Math.floor(s / CELL_M) % HEDGE_GATE_EVERY_CELLS === HEDGE_GATE_EVERY_CELLS - 1) return;
          for (const side of [1, -1]) {
            const off = side * (rec.halfW + CELL_M / 2);
            const ix = cellOfM(x + nx * off), iy = cellOfM(y + ny * off);
            if (!cellOk(ix, iy)) continue;
            claim(ix, iy);
            res.wildplants.push(WG.makeWildplant('shrub', cx(ix), cy(iy),
              WG.cellId('hedge', tx, ty, ix, iy), { _street: v, _streetArt: 'clipped' }));
          }
        });
      } else if (v === 'thorny') {
        const brambleSeats = new Set();
        const bramble = (ix, iy) => {
          brambleSeats.add(iy * N + ix);
          claim(ix, iy);
          res.wildplants.push(WG.makeWildplant('shrub', cx(ix), cy(iy),
            WG.cellId('bramble', tx, ty, ix, iy), { _street: v, _streetArt: 'bramble' }));
        };
        // Reserve the selected shrine before filling its verge. Two complete
        // shrub rings enclose it, connected to the verge but clear of the road.
        // Cutting or burning an approach uses the ordinary shrub picked ledger.
        if (!thornyShrines.has(rec.key) && streetShrineChosen(rec.key)) {
          const length = S.lineLengthM(rec.line, gM), radius = THORNY_SHRINE_RADIUS_CELLS;
          sampleLine(rec.line, gM, length + CELL_M, length / 2, (s, x, y, nx, ny) => {
            if (!S.covers(spans, s)) return;
            for (const side of [1, -1]) {
              const off = side * (rec.halfW + (radius + 1.5) * CELL_M);
              const ix = cellOfM(x + nx * off), iy = cellOfM(y + ny * off);
              if (!hoardOk(ix, iy)) continue;
              const ring = [];
              for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
                if (dx || dy) ring.push({ ix: ix + dx, iy: iy + dy });
              }
              if (!ring.every(c => cellOk(c.ix, c.iy))) continue;
              claim(ix, iy);
              res.objects.push(WG.makeObject('grove_shrine', cx(ix), cy(iy),
                WG.cellId('street_shrine', tx, ty, ix, iy),
                { _shrineStreet: v, shrineKind: root.Shrines.kindForStreet(v) }));
              for (const c of ring) bramble(c.ix, c.iy);
              thornyShrines.add(rec.key);
              break;
            }
          });
        }
        // Dense irregular thickets grow from the kerb, ending at the first
        // obstruction. A ray never jumps a building, occupied seat or road.
        sampleLine(rec.line, gM, CELL_M / 2, CELL_M / 4, (s, x, y, nx, ny) => {
          if (!S.covers(spans, s)) return;
          const depth = side => 2 + Math.floor(u01(`thorny-depth|${rec.key}|${Math.floor(s / CELL_M)}|${side}`) * (THORNY_VERGE_MAX_CELLS - 1));
          crossSection(rec,x,y,nx,ny,depth,brambleSeats,bramble);
        });
      } else if (v === 'overgrown') {
        let placed = 0;
        const length = rec.line.slice(1).reduce((m, p, i) => m + Math.hypot(p.x - rec.line[i].x, p.y - rec.line[i].y) * gM, 0);
        sampleLine(rec.line, gM, OVERGROWN_STEP_M, OVERGROWN_STEP_M / 2, (s, x, y, nx, ny) => {
          if (placed >= OVERGROWN_MAX) return false;
          if (!S.covers(spans, s)) return;
          const c = verge(rec, x, y, nx, ny, 1);
          if (!c) return;
          claim(c.ix, c.iy);
          res.objects.push(WG.makeObject('tree', cx(c.ix), cy(c.iy),
            WG.cellId('tree_og', tx, ty, c.ix, c.iy),
            { species: 'maple', variant: 1 + Math.min(2, Math.floor(3 * s / Math.max(1, length))), _street: v }));
          placed++;
        });
      } else if (v === 'toadstool') {
        // Repeating loose scallops: three caps, a breathing gap, then the
        // opposite verge. Every third group has a giant at its set-back center;
        // setback changes within each group, all spawn-gated.
        let placed = 0, sample = 0;
        sampleLine(rec.line, gM, TOADSTOOL_STEP_M, TOADSTOOL_STEP_M / 2, (s, x, y, nx, ny) => {
          const n = sample++;
          if (placed >= TOADSTOOL_MAX) return false;
          if (n % 4 === 3 || !S.covers(spans, s)) return;
          const side = Math.floor(n / 4) % 2 ? -1 : 1;
          const c = verge(rec, x, y, nx, ny, side, n % 4 === 1 ? 2 : 1);
          if (!c) return;
          claim(c.ix, c.iy);
          const crop = n % 4 === 1 && Math.floor(n / 4) % TOADSTOOL_GIANT_EVERY_GROUPS === 0
            ? 'giant_mushroom' : 'mushroom';
          res.wildplants.push(WG.makeWildplant(crop, cx(c.ix), cy(c.iy),
            WG.cellId('wp_ts', tx, ty, c.ix, c.iy), { _street: v }));
          placed++;
        });
      } else if (v === 'orchard') {
        let placed = 0;
        sampleLine(rec.line, gM, ORCHARD_STEP_M, ORCHARD_STEP_M / 2, (s, x, y, nx, ny) => {
          if (placed >= ORCHARD_MAX) return false;
          if (!S.covers(spans, s)) return;
          for (const side of [1, -1]) {
            const c = verge(rec, x, y, nx, ny, side);
            if (!c) continue;
            claim(c.ix, c.iy);
            // Alternate along each verge, with the opposite species across
            // the road: half apples, half mature deciduous maples on clear ground.
            const apple = (Math.floor(s / ORCHARD_STEP_M) + (side === 1 ? 0 : 1)) % 2 === 0;
            res.objects.push(WG.makeObject(apple ? 'fruittree' : 'tree', cx(c.ix), cy(c.iy),
              WG.cellId(apple ? 'ft_lane' : 'tree_lane', tx, ty, c.ix, c.iy),
              apple ? { species: WG.fruitTreeSpecies(WG.cellHash(tx, ty, c.ix, c.iy)), wild: true, _street: v }
                : { species: 'maple', variant: 3, _street: v }));
            placed++;
          }
        });
      } else if (v === 'golden') {
        // Dense ribbons on both verges, one pickup per free cell. Sampling
        // below cell width also covers diagonal roads; the shared gate and
        // immediate claim keep roadway, restricted and occupied cells empty.
        // Cell ids survive reloads and use the existing foundTreasures ledger.
        sampleLine(rec.line, gM, GOLDEN_STEP_M, GOLDEN_STEP_M / 2, (s, x, y, nx, ny) => {
          if (!S.covers(spans, s)) return;
          for (const side of [1, -1]) for (let k = 1; k <= VERGE_MAX_CELLS; k++) {
            const off = side * (rec.halfW + (k - 0.5) * CELL_M);
            const ix = cellOfM(x + nx * off), iy = cellOfM(y + ny * off);
            if (!cellOk(ix, iy)) continue;
            claim(ix, iy);
            res.coins.push({ kind: 'coindrop', x: cx(ix), y: cy(iy),
              id: WG.cellId('golden_coin', tx, ty, ix, iy),
              amount: GOLDEN_COIN_AMOUNT, seeded: true, _street: v });
          }
        });
      } else if (v === 'pilgrim' || v === 'barricade') {
        if (v === 'barricade') {
          let placed = 0;
          const barricadeSeats = new Set();
          sampleLine(rec.line, gM, BARRICADE_STEP_M, BARRICADE_STEP_M / 2, (s, x, y, nx, ny) => {
            if (placed >= BARRICADE_MAX) return false;
            if (!S.covers(spans, s)) return;
            crossSection(rec,x,y,nx,ny,()=>BARRICADE_VERGE_MAX_CELLS,barricadeSeats,(ix,iy)=>{
              claim(ix,iy);
              const extra = { _street: v, _streetScenery: true };
              if (u01(WG.cellId('barr-kind',tx,ty,ix,iy)) < 1/3) res.objects.push(WG.makeObject('stakes',cx(ix),cy(iy),
                WG.cellId('stakes_barr',tx,ty,ix,iy),extra));
              else res.wildplants.push(WG.makeWildplant('barricade',cx(ix),cy(iy),
                WG.cellId('barr_scenery',tx,ty,ix,iy),extra));
              placed++;
            });
          });
        }
        // ONE PER STREET PER TILE: the ends are pooled by street key and
        // seated after this loop (see `streetEnds` below) — a major road cut
        // into many short pieces stood a barricade at every cut.
        let arr = streetEnds.get(v + '|' + rec.key);
        if (!arr) streetEnds.set(v + '|' + rec.key, arr = { v, key: rec.key, ends: [] });
        for (const p of ownedEnds(rec)) arr.ends.push(p);
      } else if (v === 'burned') {
        const rng = streamFor(rec, v);
        let placed = 0;
        sampleLine(rec.line, gM, BURNED_STEP_M, BURNED_STEP_M / 2, (s, x, y, nx, ny) => {
          if (placed >= BURNED_MAX) return false;
          const side = rng() < 0.5 ? 1 : -1;
          const tar = rng() < 0.5;
          if (!S.covers(spans, s)) return;
          const c = verge(rec, x, y, nx, ny, side);
          if (!c) return;
          claim(c.ix, c.iy);
          const kind = tar ? 'tar' : 'stakes';
          res.objects.push(WG.makeObject(kind, cx(c.ix), cy(c.iy),
            WG.cellId(kind, tx, ty, c.ix, c.iy), { _street: v }));
          res.slowCells.set(c.iy * N + c.ix, kind);
          placed++;
        });
        // Placed torches reuse the cave torch's animated art and warm light.
        // Dress after the debris without disturbing its random stream or seats.
        sampleLine(rec.line, gM, BURNED_TORCH_STEP_M, BURNED_TORCH_STEP_M / 2, (s, x, y, nx, ny) => {
          if (!S.covers(spans, s)) return;
          const side = Math.floor(s / BURNED_TORCH_STEP_M) % 2 ? -1 : 1;
          const c = verge(rec, x, y, nx, ny, side) || verge(rec, x, y, nx, ny, -side);
          if (!c) return;
          claim(c.ix, c.iy);
          res.objects.push(WG.makeObject('torch', cx(c.ix), cy(c.iy),
            WG.cellId('torch_burned', tx, ty, c.ix, c.iy), { _street: v }));
        });
        // ONE FIRE SLIME PER STRETCH (lairs.js 'burned' tier): the first
        // spawnable verge cell of each (street key, stretch square) this piece
        // walks through inside the tile. The squares are tile-aligned, so a
        // stretch belongs to one tile; `burnedSeen` keeps a street that is
        // several line pieces here to one guard per stretch. No draws.
        sampleLine(rec.line, gM, BURNED_GUARD_STEP_M, BURNED_GUARD_STEP_M / 2, (s, x, y, nx, ny) => {
          if (!S.covers(spans, s)) return;
          const st = stretchOf(tx * ext + x / gM, ty * ext + y / gM);
          const sk = `burned:${rec.key}|${st.sx},${st.sy}`;
          if (burnedSeen.has(sk)) return;
          // Seated BACK beyond the kerb buffer (foeSeat), from whichever
          // verge side seats; neither → try the stretch's next sample.
          let c = null;
          for (const side of [1, -1]) {
            const v = verge(rec, x, y, nx, ny, side);
            c = v && foeSeat(v.ix, v.iy);
            if (c) break;
          }
          if (!c) return;
          burnedSeen.add(sk);
          res.lairs.push({ tier: 'burned', sid: sk,
            lx: (c.ix + 0.5) * frameCellM, ly: (c.iy + 0.5) * frameCellM });
        });
      }
      // lantern: nothing seated here — denser street lamps (lampSpacingFor).
    }

    // THE END PIECES — ONE per (street, tile). A waystone (Pilgrim's Way —
    // tapped, it reads one page of the Book: interactables.js
    // INTERACTABLES.waystone, spent in `opened`) or a barricade (a wild plant
    // on the SHRUB's rule, items.js WILDPLANT_RULES.barricade — broken up
    // with the axe, `picked` once cleared — and the goblin who holds it,
    // lairs.js 'barricade' tier) stands at the ONE owned end of the street's
    // pieces here whose hash endPick(variant, key, global point) is lowest
    // and that seats (the next lowest if not). Ends are tile-owned, so no two
    // tiles seat the same street's piece at one end, and the choice is a pure
    // function of the tile's bytes. (Until Sep 2026 every piece end stood one:
    // a major road cut into many short lines stood 220 goblins over Seattle's
    // nine tiles.)
    for (const grp of streetEnds.values()) {
      yield 'street end pieces';
      const seen = new Set();
      const cands = [];
      for (const p of grp.ends) {
        const gk = `${tx * ext + p.x},${ty * ext + p.y}`;
        if (seen.has(gk)) continue;
        seen.add(gk);
        cands.push({ p, u: u01(`end|${grp.v}|${grp.key}|${gk}`) });
      }
      cands.sort((a, b) => a.u - b.u);
      for (const { p } of cands) {
        const c = seat(p.x, p.y);
        if (!c) continue;
        claim(c.ix, c.iy);
        if (grp.v === 'pilgrim') {
          res.objects.push(WG.makeObject('waystone', cx(c.ix), cy(c.iy),
            WG.cellId('waystone', tx, ty, c.ix, c.iy), { _street: grp.v }));
        } else {
          res.wildplants.push(WG.makeWildplant('barricade', cx(c.ix), cy(c.iy),
            WG.cellId('barricade', tx, ty, c.ix, c.iy), { _street: grp.v }));
          // Its goblin stands BACK from the kerb (foeSeat), keyed on the
          // barricade — or there is none.
          const g = foeSeat(c.ix, c.iy);
          if (g) {
            res.lairs.push({ tier: 'barricade', sid: WG.cellId('barricade', tx, ty, c.ix, c.iy),
              lx: (g.ix + 0.5) * frameCellM, ly: (g.iy + 0.5) * frameCellM });
          }
        }
        break;
      }
    }

    // Independently choose half of eligible special streets, keyed by the
    // canonical street identity so fragments and adjacent tiles agree.
    // Hash order gives competing streets stable priority for safe seats.
    // A shrine stands back from the road on an ATTRACTOR cell, on the same
    // side of every major band. Unsafe streets simply receive no shrine.
    const shrineKeys = [...shrineStreets.keys()].sort((a, b) => u01('shrine|' + a) - u01('shrine|' + b));
    for (const key of shrineKeys) {
      if (!streetShrineChosen(key)) continue;
      yield 'street shrines';
      const { v, recs } = shrineStreets.get(key);
      let c = null;
      for (const { rec, spans } of recs) {
        const length = S.lineLengthM(rec.line, gM);
        sampleLine(rec.line, gM, length + CELL_M, length / 2, (s, x, y, nx, ny) => {
          if (!S.covers(spans, s)) return;
          for (const side of [1, -1]) {
            const k = verge(rec, x, y, nx, ny, side);
            c = k && nearestSeat(k.ix, k.iy, N, rc, HOARD_OFFSETS, hoardOk);
            if (c) break;
          }
        });
        if (c) break;
      }
      if (!c) continue;
      claim(c.ix, c.iy);
      res.objects.push(WG.makeObject('grove_shrine', cx(c.ix), cy(c.iy),
        WG.cellId('street_shrine', tx, ty, c.ix, c.iy), { _shrineStreet: v, shrineKind: root.Shrines.kindForStreet(v) }));
    }

    // THE CAFÉ HOARDS: the index's hoard POIs in hash order, the first
    // HOARDS_PER_TILE that seat. A hoard lies BESIDE its POI on public ground
    // within HOARD_SEAT_CELLS, on the POI's side of any major band
    // (nearestSeat). A hoard is an ATTRACTOR (the spawn gate: every hard
    // reason plus the sensitive buffer — the kerb does not refuse it). GUARDED
    // when the hoard's own cell is a foe cell: a lair candidate on it
    // (lairs.js 'cafe' tier — Lairs seats the giant as an 'enemy' too). With
    // the mask an attractor's ground IS a foe's, so every seated hoard is
    // guarded; the unguarded fallback remains for an entry built without
    // one (the legacy parts). Else nothing, and the next café may take it.
    // Keyed on the POI's GLOBAL point; the id from the hoard's cell.
    let hoards = 0;
    for (const hp of idx.hoardPois || []) {
      if (hoards >= HOARDS_PER_TILE) break;
      yield 'street hoards';
      const pix = cellOfM(hp.x * gM), piy = cellOfM(hp.y * gM);
      let h = nearestSeat(pix, piy, N, rc, HOARD_OFFSETS, foeOk);
      const guarded = !!h;
      if (!h) h = nearestSeat(pix, piy, N, rc, HOARD_OFFSETS, hoardOk);
      if (!h) continue;
      claim(h.ix, h.iy);
      hoards++;
      res.treasures.push({ x: cx(h.ix), y: cy(h.iy),
        id: WG.cellId('treasure_cafe', tx, ty, h.ix, h.iy), rollBonus: 1, guarded });
      if (guarded) {
        res.lairs.push({ tier: 'cafe', sid: `cafe:${hp.gk}`,
          lx: (h.ix + 0.5) * frameCellM, ly: (h.iy + 0.5) * frameCellM });
      }
    }
    if (marked) res.marks = marks;
    return res;
  }

  // Scenic paths show their distance-credit bonus through lantern density.
  // Resolve the owning table at call time: Scenic loads after this module.
  // Non-scenic street themes keep their authored density (e.g. Lantern Row).
  function lampSpacingFor(variant, baseSpacingM) {
    const S = root.Streets, scenic = root.Scenic;
    const base = baseSpacingM || (S ? S.lampSpacingM() : 100);
    const kind = Object.keys(scenic?.KIND_ROW || {}).find(k => scenic.KIND_ROW[k] === variant);
    const density = kind ? scenic.SCENIC_MUL[kind] : VARIANT_BY_ID[variant]?.lampDensity;
    return base / (density || 1);
  }

  function stoneColorFor(variant, restored = true) {
    return VARIANT_BY_ID[variant]?.stone?.[restored ? 'restored' : 'weathered'] || null;
  }

  // One line's themed metre intervals, shared by paving, lamps and previews.
  // Scenic classifications can change partway along a path; never let one
  // scenic stretch repaint or change the lamp spacing on its plain remainder.
  function lineStyles(entry, feature, fi, li, mvtToM) {
    const S = root.Streets, line = feature.geom[li];
    const length = S.lineLengthM(line, mvtToM);
    const rec = entry.streetIndex?.lines?.find((r) => r.fi === fi && r.li === li);
    if (rec) return lineParts(rec, mvtToM).map(part => ({ ...part, size: rec.size }));
    const ivs = entry.scenic?.lines?.get(S.lineKey(feature, li));
    const cuts = [0, length];
    for (const iv of ivs || []) for (const u of [iv[0], iv[1]]) {
      const m = Math.max(0, Math.min(length, u * mvtToM));
      cuts.push(m);
    }
    cuts.sort((a, b) => a - b);
    const out = [];
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i];
      if (b - a < 1e-6) continue;
      const kind = ivs && root.Scenic?.kindAt(ivs, (a + b) / 2, mvtToM);
      out.push({ a, b, variant: rec?.variant || (kind && root.Scenic.KIND_ROW[kind]) || null, size: rec?.size });
    }
    return out;
  }

  // THE LAMP'S GLOW: a street's lamps shed its variant's colour (the row's
  // `lampGlow`), an unthemed MAJOR road the bandit road's torch orange, and
  // anything else (a plain minor street, a service way, a footpath) null —
  // the caller's default, util.js UI_LAMP_GLOW. `rec` is a street-index line
  // record ({ size, variant }) or null. One value per lamp, read by both the
  // light and the baked art.
  function lampGlowFor(rec) {
    if (!rec) return null;
    const row = rec.variant ? VARIANT_BY_ID[rec.variant] : null;
    if (row && row.lampGlow) return row.lampGlow;
    if (rec.size === 'major') return BANDIT_STORY.lampGlow;
    return null;
  }

  function carpetColorFor(variant) {
    const hex = VARIANT_BY_ID[variant]?.carpet;
    return hex ? parseInt(hex.slice(1), 16) : null;
  }
  // The repeating mark on a variant's carpet, or null: { kind, ink }.
  function carpetEmblemFor(variant) {
    const row = VARIANT_BY_ID[variant];
    if (!row?.carpet || !row.emblem) return null;
    return { kind: row.emblem, ink: parseInt((row.emblemInk || '#ffffff').slice(1), 16) };
  }

  // Runtime and review surfaces share the strip's width, soft edge and mark.
  function carpetStyleFor(variant) {
    const row = VARIANT_BY_ID[variant];
    if (!row?.carpet) return null;
    return { color: carpetColorFor(variant), widthCells: row.carpetWidthCells ?? CARPET_WIDTH_CELLS,
      featherCells: row.carpetFeatherCells || 0, emblem: carpetEmblemFor(variant) };
  }

  function streetShrineChosen(key) {
    return !!root.Shrines && u01('shrine|' + key) < root.Shrines.STREET_SHRINE_CHANCE;
  }

  function isSlowKind(kind) { return SLOW_KINDS.has(kind); }

  root.StreetVariants = {
    PARISH_TILES, NAME_NUDGE, NUDGED_SHARE_MAX, ROCK_STREET_SHARE, MINOR_VARIANT_SHARE, VERGE_MAX_CELLS,
    BANDIT_STRETCH_UNITS, BANDIT_STRETCH_SHARE, BANDIT_STAMP_OUT_CELLS,
    stretchOf, isBanditStretch, stampBanditStretchesSteps,
    BUS_STOP_MAJOR_CELLS, WAGON_STOP_SHARE, isWagonStop, END_SEAT_CELLS,
    FOE_SEAT_BACK_CELLS, HOARD_POI_CLASSES, HOARD_POI_FALLBACK, HOARDS_PER_TILE, HOARD_SEAT_CELLS,
    hoardPick, hoardPoisOf, crossesMajorBand, nearestSeat,
    HEDGE_GATE_EVERY_CELLS, OVERGROWN_STEP_M, OVERGROWN_MAX, ORCHARD_STEP_M,
    ORCHARD_MAX, TOADSTOOL_STEP_M, TOADSTOOL_MAX, MAX_VARIANT_LENGTH_M, MIN_VARIANT_LENGTH_M, LONG_ROAD_M, LONG_ROAD_SECTION_SHARE, LONG_PATCH_UNITS, sectionLimits, VARIANT_PATCH_UNITS, GOLDEN_STEP_M, GOLDEN_COIN_AMOUNT, BARRICADE_STEP_M, BARRICADE_MAX, BARRICADE_VERGE_MAX_CELLS, BURNED_STEP_M, BURNED_MAX, BURNED_TORCH_STEP_M, BURNED_GUARD_STEP_M, LANTERN_SPACING_DIV, HEDGE_LAMP_DENSITY, CARPET_WIDTH_CELLS, SLOW_KINDS,
    THORNY_SHRINE_RADIUS_CELLS, THORNY_VERGE_MAX_CELLS, SNARE_CHEST_TIER, SNARE_TRAP_RADIUS_CELLS, SNARE_MIN_TRAPS, STREET_VARIANTS, VARIANT_BY_ID, BANDIT_STORY, variantByCode,
    normName, streetKey, anonKey, parishOf, sizeOfTags, isVehicleTags, variantFor, rocksFor,
    selectionWeights, applyAffinitiesSteps, AFFINITY_SAMPLE_M, terrainFor, paintTerrainSteps,
    nameVote, lineName, sampleLine, canonicalPaths, variantAt, lineParts, displayLines, buildIndexSteps, buildIndex, areaSteps, area,
    markBanditStops, streetShrineChosen, dress, dressSteps, lampSpacingFor, lampGlowFor, stoneColorFor, carpetColorFor, carpetEmblemFor, carpetStyleFor, lineStyles, isSlowKind,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
