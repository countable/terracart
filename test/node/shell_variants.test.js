// Regression guard: NO SHELLS ON BEACHES.
//
// A shell is the sand family's only flora (src/biome_profiles.js), scattered at
// 4–7 % of a beach's cells — so a beach should be dotted with them. It wasn't,
// and every step of the chain looked fine on its own:
//
//   • the rasterizer spawned the shells (this file proves it still does);
//   • CROP_SPRITE.shell said `variants: 12` because Shell.png is a 3×4 grid —
//     but only its TOP ROW is shell art. The rest is three keyline duplicates,
//     two flat mask rows and four BLANK cells;
//   • render.js drew `hash % 12`, and its hash was `_ix`/`_iy` — which the
//     rasterizer's occupancy pass deletes before the entry is ever drawn —
//     XORed with the wildplant id's LENGTH. One number for a whole tile.
//
// So every shell in a tile drew the same frame, chosen by how many digits its
// tile and cell indices happened to have, and for most tiles that frame was
// blank: a pickup the player could tap but not see.
//
// The fix is the discipline the plain rock uses (rock_yield.test.js): ONE
// table both sides read. `CROP_SPRITE.shell.frames` LISTS the frames that
// carry art, and `wildplantFrame` (items.js) is the only thing that picks one,
// off a hash of the wildplant's stable id. These tests drive that resolver over
// a real rasterized beach; tools/sprite_audit.js checks the declared frames
// against the real PNG.

(function () {
const T = WorldGen.T;

// One tile of round numbers, at a REALISTIC z14 tile coordinate — the id
// string is what the variant hash keys off, and its shape (`wp_<tx>_<ty>_<ix>_<iy>`)
// is exactly what the old length-hash was accidentally reading.
const CPE = 64;
const TILE_EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const TX = 2799, TY = 6544;                 // a real coastal tile (Santa Monica)
const cellToMvt = (c) => c * CELL_MVT + CELL_MVT / 2;
const ring = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
const wholeTile = () => ring([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]]);

// A tile that is all beach — one `landcover` sand polygon, the way OSM tags a
// real one (class sand / subclass beach).
const beachLayers = () => [
  { name: 'landcover', features: [
    { type: 3, tags: { class: 'sand', subclass: 'beach' }, geom: [wholeTile()] },
  ] },
];
const rasterizeBeach = () => WorldGen.rasterizeTile(beachLayers(), CPE, TX, TY, TILE_EDGE_M);

const beach = rasterizeBeach();
const shells = beach.wildplants.filter((wp) => wp.crop === 'shell');
const FRAMES = CROP_SPRITE.shell.frames;

// --- The beach is stocked ---------------------------------------------------

test('beach: a sand tile scatters shells over its cells', () => {
  let sand = 0;
  for (const t of beach.grid) if (t === T.SAND) sand++;
  assert.gt(sand, 0, 'the sand polygon painted SAND');
  assert.gt(shells.length, 0, 'shells spawned on the sand');
  // The sand family's window is 4–7 % of the polygon's cells; allow slack for
  // the per-polygon density roll but fail if the scatter has collapsed.
  assert.inRange(shells.length / sand, 0.02, 0.12, 'shell density');
});

// --- Every shell draws a shell ---------------------------------------------

test('beach: every shell draws a frame the sheet actually carries', () => {
  assert.truthy(Array.isArray(FRAMES) && FRAMES.length > 0, 'shell declares a frame list');
  for (const wp of shells) {
    const f = wildplantFrame(wp);
    assert.includes(FRAMES, f, `shell ${wp.id} drew frame ${f}`);
  }
});

test('shell: the frame list is a list, never a count', () => {
  // `variants: N` asserts that every cell of the sheet is a sprite. Shell.png
  // is the counter-example, so the count is not a shape this table may take.
  assert.eq(CROP_SPRITE.shell.variants, undefined, 'no variant count');
  for (const [crop, ov] of Object.entries(CROP_SPRITE)) {
    assert.eq(ov.variants, undefined, `${crop} declares frames, not a count`);
  }
});

// --- The field reads as varied ----------------------------------------------

test('beach: the shells are a mix, not one frame repeated', () => {
  const seen = new Set(shells.map((wp) => wildplantFrame(wp)));
  assert.eq(seen.size, FRAMES.length,
    `all ${FRAMES.length} shells appear across one beach (saw ${[...seen]})`);
});

test('beach: the variant reads the whole id, not its length', () => {
  // THE BUG, pinned from the other end: ids of the SAME LENGTH must still be
  // able to draw different shells. The old hash was `id.length * K`, so every
  // wildplant whose indices had the same digit count drew the same frame —
  // which, in a tile, is nearly all of them.
  const byLen = new Map();
  for (const wp of shells) {
    const L = wp.id.length;
    if (!byLen.has(L)) byLen.set(L, new Set());
    byLen.get(L).add(wildplantFrame(wp));
  }
  const varied = [...byLen.values()].filter((s) => s.size > 1);
  assert.gt(varied.length, 0, 'some id-length group draws more than one frame');
});

test('beach: a cell keeps its shell across a rebuild', () => {
  // A tile can be rebuilt under the player (spawn_rebuild.test.js), and the
  // rebuilt entry is a new object — so the look has to be a pure function of
  // the id, not of anything the rasterizer happened to hang on the old one.
  const again = rasterizeBeach().wildplants.filter((wp) => wp.crop === 'shell');
  assert.eq(again.length, shells.length, 'same scatter');
  const before = new Map(shells.map((wp) => [wp.id, wildplantFrame(wp)]));
  for (const wp of again) {
    assert.eq(wildplantFrame(wp), before.get(wp.id), `shell ${wp.id} kept its frame`);
  }
});

// --- The renderer asks the table --------------------------------------------

test('render: the wildplant pass picks its frame through wildplantFrame', () => {
  assert.truthy(/setTextureIfDifferent\(s, ov\.sheet\);\s*\n\s*s\.setFrame\(wildplantFrame\(p\)\);/
    .test(RENDER_SRC), 'custom-sheet branch defers to items.js');
  assert.falsy(/% ov\.variants/.test(RENDER_SRC), 'no frame index rolled over a count');
  assert.falsy(/wildId \|\| ''\)\.length/.test(RENDER_SRC), 'no hash off the id LENGTH');
});

test('render: the wildplant carries its id and biome to the draw', () => {
  // The variant hash needs the id, and the per-biome flora tint needs the
  // terrain the rasterizer stamped (`_biome`) — which this pass used to drop
  // on the floor, leaving BiomeProfiles.tint reading undefined for every wild
  // plant in the world.
  const m = RENDER_SRC.match(/plantedList\.push\(\{ p: \{[^}]*\}/);
  assert.truthy(m, 'wildplant push is parseable');
  for (const field of ['wildId: wp.id', '_biome: wp._biome', '_cave: wp._cave']) {
    assert.truthy(m[0].includes(field), `wildplant carries ${field}`);
  }
});

// --- The other custom-sheet crops still resolve -----------------------------

test('wildplantFrame: a one-frame crop draws its frame', () => {
  const lg = { crop: 'longgrass', id: 'wp_1_2_3_4' };
  assert.eq(wildplantFrame(lg), CROP_SPRITE.longgrass.frame, 'longgrass');
  const rose = { crop: 'wildrose', id: 'wp_1_2_3_5' };
  assert.eq(wildplantFrame(rose), CROP_SPRITE.wildrose.frame, 'wildrose');
});

test('wildplantFrame: a mushroom grown underground wears its cave cap', () => {
  const caveFrames = CROP_SPRITE.mushroom.caveFrames;
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const surface = wildplantFrame({ crop: 'mushroom', id: `wp_1_2_${i}_0` });
    assert.eq(surface, CROP_SPRITE.mushroom.frame, 'a surface mushroom is the toadstool');
    const cave = wildplantFrame({ crop: 'mushroom', id: `wp_1_2_${i}_0`, _cave: true });
    assert.includes(caveFrames, cave, 'a cave mushroom is one of the blue caps');
    seen.add(cave);
  }
  assert.eq(seen.size, caveFrames.length, 'both cave caps occur');
});

test('wildplantFrame: an id-less wildplant falls back to its cell', () => {
  // The cave scatter and the sandbox placer both hand over `_ix`/`_iy`.
  const a = wildplantFrame({ crop: 'shell', _ix: 4, _iy: 9 });
  assert.includes(FRAMES, a, 'still a real frame');
  assert.eq(wildplantFrame({ crop: 'shell', _ix: 4, _iy: 9 }), a, 'stable for the cell');
});
})();
