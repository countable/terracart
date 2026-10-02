// Procedural textures + per-POI concrete-pad shapes.
// Extracted from app.js for maintainability. Loaded BEFORE app.js so all
// names (BIOME_TEX, draw* fns, makeBiomeTextures, …) are available as plain globals.
//
// Depends on:
//   nothing external. Pure draws-to-canvas — no Phaser scene work other than
//   makeBiomeTextures which takes the scene as a parameter.
//

// --- Castle stone palette -------------------------------------------------
// ONE set of stone colours for everything castle: the rampart walls (drawn as
// graphics in render.js drawCells) and the turret texture below. They used to
// carry separate palettes — the turret was mixed from #a8a8b0 / #b4b4bc with a
// near-black outline, roughly two shades lighter than the wall it stands on,
// so a tower never looked like it was cut from the same rock as its rampart.
// `.n` is the 0xRRGGBB form the Phaser graphics API wants; `.s` is the CSS
// string the canvas 2D contexts want.
const CASTLE_STONE = (() => {
  const mk = (n) => ({ n, s: '#' + n.toString(16).padStart(6, '0') });
  return {
    LITE:   mk(0xc2c7c2),   // lit battlement tops / merlon crowns
    BODY:   mk(0x949895),   // battlement + parapet stone
    FACE:   mk(0x7e837f),   // the tall extruded wall faces (and the turret column)
    SIDE:   mk(0x797e7a),   // E/W side-wall crenel dashes
    SHADOW: mk(0x575d59),   // shadow lines / joints
    DARK:   mk(0x2c302d),   // grounding line + silhouette
  };
})();

// --- The unclaimed shade, and the second castle palette -------------------
// An unclaimed building is shifted toward dark green and then murked down. For
// a HOUSE that is a wash painted over the finished art (see the wash pass in
// render.js drawCells). A CASTLE is not washed any more: it is GENERATED in a
// second palette run through this exact transform — rampart stone, turret and
// court floor alike.
//
// Why baking beat washing. A wash over a castle could only ever be a layer on
// top of drawn geometry, and it showed: the crest of a north wall whose own
// cell was off the top of the frame stayed lit stone, the pixels where two
// cells' extrusions overlapped got washed twice and banded, and the turret's
// multiply tint never quite matched the lerp on the wall under it. Baking
// deletes the layer and every one of those seams with it. Both sides still
// come through unclaimedShade(), so a baked castle and the washed house across
// the road land on the same colour rather than drifting apart.
// murkA was 0.22 — the darkening came out heavier than wanted once it was
// baked into the stone rather than washed over it, so it is down a tenth.
// washA was 0.5 — the green read as too strong across a derelict footprint,
// so it is at the 35% the wash was always described as.
const UNCLAIMED_SHADE = { wash: 0x1e3b24, washA: 0.35, murk: 0x05070c, murkA: 0.12 };
function unclaimedShade(rgb) {
  // `lerp` is util.js's (loaded first, and beside textures.js in every vm
  // context test/node/run.js bakes it into).
  const ch = (sh) => {
    const w = lerp((rgb >> sh) & 255, (UNCLAIMED_SHADE.wash >> sh) & 255, UNCLAIMED_SHADE.washA);
    return Math.round(lerp(w, (UNCLAIMED_SHADE.murk >> sh) & 255, UNCLAIMED_SHADE.murkA));
  };
  return (((ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0);
}
// Unclaimed masonry retains its original weathering rather than shading the
// much lighter restored palette. The final 5% treatment is applied after
// painting, so mortar, translucent sludge and outlines keep their contrast.
const UNCLAIMED_BUILDING_BASE = {
  floors: { 9: 0x984f45, 11: 0x9b8365, 12: 0x787a80 },
  faces: { 9: 0x401f1c, 11: 0x3c2e22, 12: 0x36373a },
  stone: { LITE: 0xb9bcc2, BODY: 0x8f9298, FACE: 0x7e8188,
    SIDE: 0x7a7d84, SHADOW: 0x5a5d63, DARK: 0x303134 },
};
const UNCLAIMED_MATERIAL_PALETTE = [0x171717, 0x26342a, 0x3e4b2c, 0x403e34,
  0x777462, 0xb0aa8a, 0x4c3018, 0x6c431d].map(n => [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
const _unclaimedMaterialColours = new Map();
// Half the approved colour/lightness treatment keeps gameplay masonry legible.
// Source shadows below
// 55 and bright glints above 235 remain exact; alpha never changes.
function tuneUnclaimedMaterialPixels(pixels) {
  const luma = c => c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    const cached = _unclaimedMaterialColours.get(key);
    if (cached !== undefined) {
      pixels[i] = (cached >> 16) & 255; pixels[i + 1] = (cached >> 8) & 255; pixels[i + 2] = cached & 255;
      continue;
    }
    const source = [pixels[i], pixels[i + 1], pixels[i + 2]], light = luma(source);
    if (light < 55 || light > 235) continue;
    let best = Infinity, target;
    for (const colour of UNCLAIMED_MATERIAL_PALETTE) {
      const cl = luma(colour);
      const distance = source.reduce((sum, v, k) => sum + (v - light - (colour[k] - cl)) ** 2, 0);
      if (distance < best) { best = distance; target = colour.map(v => light + v - cl); }
    }
    const adapted = source.map((v, k) => v + (target[k] - v) * .05);
    const adaptedLight = luma(adapted), lifted = light + (255 - light) * .05;
    for (let k = 0; k < 3; k++) pixels[i + k] = Math.max(0, Math.min(255, Math.round(lifted + (adapted[k] - adaptedLight) * .95)));
    if (_unclaimedMaterialColours.size >= 4096) _unclaimedMaterialColours.clear();
    _unclaimedMaterialColours.set(key, (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  }
  return pixels;
}
function tuneUnclaimedMaterialCanvas(canvas) {
  const ctx = canvas.getContext('2d'), image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  tuneUnclaimedMaterialPixels(image.data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}
function unclaimedMaterialColor(rgb) {
  const cached = _unclaimedMaterialColours.get(rgb);
  if (cached !== undefined) return cached;
  const px = new Uint8ClampedArray([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255]);
  tuneUnclaimedMaterialPixels(px);
  return (px[0] << 16) | (px[1] << 8) | px[2];
}
const CASTLE_STONE_UNCLAIMED = (() => {
  const mk = (n) => ({ n, s: '#' + n.toString(16).padStart(6, '0') });
  const out = {};
  for (const k of Object.keys(UNCLAIMED_BUILDING_BASE.stone)) out[k] = mk(unclaimedShade(UNCLAIMED_BUILDING_BASE.stone[k]));
  return out;
})();

// --- Water animation timing ---
// 8 phases × 220ms ≈ a 1.8s loop in which the highlight bands drift one full
// band-period (8px) downward — roughly 4.5px/s, ambience rather than a
// current you'd race. 8 phases over an 8px period = exactly 1px per step, so
// the drift reads as smooth motion, not a two-frame flicker.
const WATER_ANIM_PHASES = 8;
const WATER_ANIM_MS = 220;

// --- Biome texture registry ---
// Terrain class id → { variants, draw(ctx, size, rng, phaseFrac) }. Each
// variant becomes a Phaser canvas texture keyed `biome${type}_${v}` via
// makeBiomeTextures. Specs with `animPhases` additionally bake phases 1..N-1
// as `biome${type}_${v}p${p}` (phase 0 keeps the plain key), and render.js
// picks the phase from the wall clock when it builds the key.
const BIOME_TEX = {
  0:  { variants: 2, draw: drawGrassTex },        // grass: tufts (procedural — sheet-tiling was abandoned, see git history)
  1:  { variants: 2, patternOpacity: 0.75, draw: drawForestTex },       // forest: dense leaf litter
  2:  { variants: 2, patternOpacity: 0.925, draw: drawSandTex },         // sand: horizontal ripple marks
  // Water animates: `animPhases` pre-baked frames per variant (the bands drift
  // downward one band-period per loop), stepped every `animMs`. See the
  // "Animated biome textures" note above makeBiomeTextures for why this is the
  // cheap way to animate every water cell at once.
  3:  { variants: 2, draw: drawWaterTex, animPhases: WATER_ANIM_PHASES, animMs: WATER_ANIM_MS },
  4:  { variants: 2, patternOpacity: 0.9, draw: drawFarmlandTex },     // farmland: muddy pasture + grass
  5:  { variants: 1, draw: drawResidentialTex },  // residential: concrete
  6:  { variants: 2, draw: drawParkTex },         // park: grass + flowers
  8:  { variants: 2, draw: drawPathTex },         // path: pebble grain
  9:  { variants: 1, draw: drawBuildingTex },     // building: cobbles
  11: { variants: 1, draw: drawWoodFloorTex },    // building_med: wooden plank floor
  12: { variants: 2, draw: drawCastleFloorTex },  // building_large / castle: subtle stone cobbles
  10: { variants: 2, patternOpacity: 0.9, draw: drawRockTex },         // rock: cracks
  // Subtype splits — each biome gets its own low-res texture so it reads
  // qualitatively different from the others (see src/biome_profiles.js for the
  // matching flora/fauna/tint profile).
  15: { variants: 2, draw: drawSchoolTex },       // SCHOOL — mown grass bands
  16: { variants: 2, draw: drawCommercialTex },   // COMMERCIAL — grey ceramic floor tile
  17: { variants: 1, patternOpacity: 0.9, draw: drawIndustrialTex },   // INDUSTRIAL — concrete + gravel
  27: { variants: 2, patternOpacity: 0.9, draw: drawWastelandTex },    // WASTELAND — dry grit + dead scrub tufts
  // The influence-zone halos (src/zones.js).
  28: { variants: 2, draw: drawGroveTex },        // GROVE — lush clover sward
  29: { variants: 2, draw: drawChurchyardTex },   // CHURCHYARD — worn sward, stone chips
  31: { variants: 2, patternOpacity: 0.9, draw: drawTarYardTex },      // TAR_YARD — oily ground, black pools
  18: { variants: 2, patternOpacity: 0.9, draw: drawPlaygroundTex },   // PLAYGROUND — bark mulch
  19: { variants: 2, patternOpacity: 0.94, draw: drawPitchTex },        // PITCH — mown stripes + chalk
  20: { variants: 2, patternOpacity: 1, draw: drawWetlandTex },      // WETLAND — marsh mottle + glints
  21: { variants: 2, patternOpacity: 1, draw: drawGolfTex },         // GOLF — fine fairway stripes
  22: { variants: 2, patternOpacity: 0.9, draw: drawOrchardTex },      // ORCHARD — dappled grass
  // PIER (type 23) — reuse the water ripple as base texture; render.js
  // overlays the wooden plank sprite on top via the cobblePool. Without
  // this entry the cell would fall back to bare colour with no ripple,
  // breaking visual continuity with adjacent WATER cells. Animates in
  // lockstep with WATER for the same reason — a still patch under a pier
  // edge would break the "one body of water" read.
  23: { variants: 2, draw: drawWaterTex, animPhases: WATER_ANIM_PHASES, animMs: WATER_ANIM_MS },
  // Underground cave biome
  24: { variants: 3, patternOpacity: 0.9, draw: drawCaveFloorTex }, // CAVE_FLOOR — packed grit + pebbles
  25: { variants: 3, patternOpacity: 0.9, draw: drawCaveWallTex  }, // CAVE_WALL  — packed boulder faces
  // CAVE_LAVA (26) — the WATER tile, ember palette (drawLavaTex): same bands,
  // same animation clock, so it reads as the same kind of thing gone red.
  // One periodic wave shape keeps neighbouring cells aligned at every phase.
  26: { variants: 1, draw: drawLavaTex, animPhases: WATER_ANIM_PHASES, animMs: WATER_ANIM_MS },
  // UNMAPPED (30) — render-only pseudo-terrain render.js stamps on cells whose
  // map tile hasn't loaded yet (never appears in a tile's grid). The animated
  // survey-line shimmer is the tile-loading indicator: dark fog with faint
  // diagonal scan lines drifting through it, so a slow tile visibly reads as
  // "being charted" instead of as fake grass that pops into streets.
  30: { variants: 1, draw: drawUnmappedTex, animPhases: 8, animMs: 260 },
};

// Tilled soil is per-cell state (not a terrain class).
const TILLED_COLOR = 0xa48a66;        // approved lighter, desaturated turned earth
const TILLED_VARIANTS = 2;
// A tilled cell is drawn as ONE BED: an opaque soil pad baked into the
// `tilled_N` texture, inset TILLED_INSET_PX from every cell edge with corners
// of TILLED_CORNER_PX, and the ring outside it left transparent so the ground
// colour shows between neighbouring beds. The shape lives in the texture, not
// in a per-frame path: Phaser's fillRoundedRect tessellates four arcs (~400
// points) and triangulates them every frame, and the cell graphics are
// cleared each frame, so rounding a plot as geometry cost hundreds of
// triangles per cell. A baked pad is the one sprite the cell already drew.
// The gap is in LOGICAL px (the canvas renders at up to 4× that), so 1 would
// be a hairline on a phone; 2 reads as a real edge.
const TILLED_INSET_PX = 2;
const TILLED_CORNER_PX = 4;

// Tiny deterministic RNG factory so each texture variant looks stable across reloads.
// NOT road_overlay.js' lcg(): same advance, but this one divides by 0xffffffff
// (so it can return exactly 1.0) and floors a zero seed to 1, and the two
// streams share no draw at all. Neither can adopt the other's divisor without
// re-rolling every texture it has already baked, so they stay two.
function seededRand(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function drawGrassTex(ctx, size, rng) {
  // Short, dense lawn — just specks of two greens, no tall blades. Tall-grass tufts
  // are reserved for the harvestable "longgrass" wildplant sprite so they read as
  // pickable rather than ambient.
  ctx.clearRect(0, 0, size, size);
  // Mostly mid-green specks with occasional dark roots; very subtle.
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const r = rng();
    ctx.fillStyle = r < 0.20
      ? 'rgba(45,55,30,0.35)'        // dark root speck
      : r < 0.55
      ? 'rgba(95,110,65,0.25)'       // dry mid-green speck
      : 'rgba(170,175,130,0.18)';    // bleached highlight
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawForestTex(ctx, size, rng) {
  // Dense leaf-litter clumps — small dark blobs + a few bright leaf specks.
  ctx.clearRect(0, 0, size, size);
  drawGroundMottle(ctx, size, rng, 0xF047, 14, 1.5, 1.5, 'rgba(15,28,12,0.35)');
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = 'rgba(140,150,105,0.25)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
}

function drawSandTex(ctx, size, rng) {
  // Horizontal wind-ripple marks on beach sand (3-4 wavy lines per tile).
  ctx.clearRect(0, 0, size, size);
  // Every hash-picked variant shares the same periodic ripple paths. Random
  // phases/row counts at each cell edge used to chop the bands into squares.
  const ripples = seededRand(0x5A4D);
  const numLines = 3 + Math.floor(ripples() * 2);
  for (let r = 0; r < numLines; r++) {
    const baseY = Math.floor((r + 0.3 + ripples() * 0.4) * (size / numLines));
    const amp = 0.7 + ripples() * 0.9;
    const phase = ripples() * Math.PI * 2;
    ctx.strokeStyle = ripples() < 0.65 ? 'rgba(105,95,80,0.30)' : 'rgba(175,170,155,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Continue one sample beyond each edge, keeping the clipped stroke's
    // joins identical to the adjoining tile rather than ending a cap there.
    for (let x = -1; x <= size + 1; x++) {
      const y = baseY + Math.sin(x * 2 * Math.PI / size + phase) * amp;
      if (x === -1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Scattered fine grain specks.
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(90,82,68,0.14)' : 'rgba(235,232,222,0.12)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
}

// Toroidally-wrapped primitives for tileable textures: draw the feature at
// every ±size offset where it would be visible, so anything crossing a tile
// edge re-enters on the opposite side instead of being clipped flat.
function wrapArc(ctx, size, x, y, r, style) {
  ctx.fillStyle = style;
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      if (x + ox + r < 0 || x + ox - r > size) continue;
      if (y + oy + r < 0 || y + oy - r > size) continue;
      ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function wrapRect(ctx, size, x, y, w, h, style) {
  ctx.fillStyle = style;
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      if (x + ox + w <= 0 || x + ox >= size) continue;
      if (y + oy + h <= 0 || y + oy >= size) continue;
      ctx.fillRect(x + ox, y + oy, w, h);
    }
  }
}

// Hash-picked variants need identical boundary features, not merely a wrap
// within each individual tile. Keep variable blobs clear of the border and
// share wrapped edge blobs, as farmland does, so mixed neighbours join too.
function drawGroundMottle(ctx, size, rng, edgeSeed, count, minR, radiusSpan, style) {
  const edge = seededRand(edgeSeed);
  const edgeCount = Math.ceil(count / 3);
  for (let i = 0; i < edgeCount; i++) {
    const along = edge() * size;
    const across = (edge() - 0.5) * minR;
    const r = minR + edge() * radiusSpan;
    const x = i % 2 ? across : along;
    const y = i % 2 ? along : across;
    wrapArc(ctx, size, x, y, r, style);
  }
  ctx.fillStyle = style;
  for (let i = edgeCount; i < count; i++) {
    const r = minR + rng() * radiusSpan;
    const margin = r + 1; // include the antialiased edge
    const x = margin + rng() * (size - 2 * margin);
    const y = margin + rng() * (size - 2 * margin);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawFarmlandTex(ctx, size, rng) {
  // Muddy pasture — churned brown mud patches with tufts of grass poking
  // through, plus a few hoof/churn marks. (Replaces the old tidy furrow rows,
  // which read too much like freshly-tilled soil.)
  //
  // Tileability: cells hash-pick a variant, so any edge can abut any other
  // edge. The old version clipped its mud blobs flat at the canvas edge,
  // which read as a light grid at every cell boundary. Now features that may
  // touch an edge come from a FIXED seed shared by all variants and are drawn
  // toroidally wrapped; per-variant features stay fully inside the tile. All
  // variants therefore have pixel-identical borders and tile seamlessly in
  // any arrangement.
  ctx.clearRect(0, 0, size, size);

  // ── Seam pass: fixed seed, identical across variants, wrapped ──
  // Features are placed ON the tile edges (alternating top/left so the bottom
  // and right edges get their halves via the toroidal wrap) so the borders
  // carry the same mud density as the interior instead of a bare gutter.
  const edge = seededRand(0xFA47);
  // Mud blobs straddling the edges.
  for (let i = 0; i < 3; i++) {
    const style = edge() < 0.5 ? 'rgba(70,50,25,0.22)' : 'rgba(95,70,35,0.18)';
    const along = edge() * size;                  // position along the edge
    const across = (edge() - 0.5) * 4;            // small offset across it
    const horiz = edge() < 0.5;                   // top edge vs left edge
    const x = horiz ? along : (across + size) % size;
    const y = horiz ? (across + size) % size : along;
    wrapArc(ctx, size, x, y, 3 + edge() * 4, style);
  }
  // Grass tufts scattered over the edges.
  for (let i = 0; i < 10; i++) {
    const r = edge();
    const style = r < 0.5 ? 'rgba(88,100,58,0.30)'
                : r < 0.8 ? 'rgba(52,62,38,0.28)'
                          : 'rgba(150,150,105,0.22)';
    const along = Math.floor(edge() * size);
    const across = Math.floor(edge() * 3) - 1;
    const horiz = edge() < 0.5;
    const x = horiz ? along : (across + size) % size;
    const y = horiz ? (across + size) % size : along;
    wrapRect(ctx, size, x, y, 1, edge() < 0.4 ? 2 : 1, style);
  }
  // Edge hoof marks.
  for (let i = 0; i < 2; i++) {
    const along = Math.floor(edge() * size);
    const across = Math.floor(edge() * 3) - 1;
    const horiz = edge() < 0.5;
    const x = horiz ? along : (across + size) % size;
    const y = horiz ? (across + size) % size : along;
    wrapRect(ctx, size, x, y, 2, 1, 'rgba(40,25,12,0.30)');
  }

  // ── Interior pass: per-variant rng, kept clear of the edges ──
  // Soft mud patches — irregular brown blobs, fully contained in the tile.
  for (let i = 0; i < 3; i++) {
    const r = 3 + rng() * 4;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(70,50,25,0.22)' : 'rgba(95,70,35,0.18)';
    ctx.beginPath();
    ctx.arc(r + rng() * (size - 2 * r), r + rng() * (size - 2 * r), r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Grass tufts poking through — green specks, some 2px tall.
  for (let i = 0; i < 16; i++) {
    const r = rng();
    ctx.fillStyle = r < 0.5 ? 'rgba(88,100,58,0.30)'
                  : r < 0.8 ? 'rgba(52,62,38,0.28)'
                            : 'rgba(150,150,105,0.22)';
    const h = rng() < 0.4 ? 2 : 1;
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * (size - h + 1)), 1, h);
  }
  // A few dark churned / hoof marks.
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = 'rgba(40,25,12,0.30)';
    ctx.fillRect(Math.floor(rng() * (size - 1)), Math.floor(rng() * size), 2, 1);
  }
}

function drawParkTex(ctx, size, rng) {
  // Park = grass + occasional tiny flower.
  drawGrassTex(ctx, size, rng);
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    // No yellow bloom here: yellow is the interaction colour, and a yellow
    // speck on the ground reads as something to tap. Faded pink / rust /
    // mauve instead — wildflowers taking a park back.
    const colors = ['rgba(216,150,165,0.55)', 'rgba(190,120,95,0.55)', 'rgba(178,150,195,0.55)'];
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawTilledTex(ctx, size, rng) {
  // Ploughed earth — one rounded bed per cell (see TILLED_INSET_PX), with
  // clear horizontal furrows + grain clipped to the pad. Brown, never gold:
  // yellow is the interaction colour and tilled ground is terrain.
  // The pad is OPAQUE: render.js paints no soil fill under it, the cell's own
  // terrain colour is what shows through the transparent border ring.
  ctx.clearRect(0, 0, size, size);
  const x0 = TILLED_INSET_PX, y0 = TILLED_INSET_PX;
  const w = size - 2 * TILLED_INSET_PX, h = size - 2 * TILLED_INSET_PX;
  const r = Math.min(TILLED_CORNER_PX, w / 2, h / 2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x0 + w - r, y0);
  ctx.arcTo(x0 + w, y0, x0 + w, y0 + r, r);
  ctx.lineTo(x0 + w, y0 + h - r);
  ctx.arcTo(x0 + w, y0 + h, x0 + w - r, y0 + h, r);
  ctx.lineTo(x0 + r, y0 + h);
  ctx.arcTo(x0, y0 + h, x0, y0 + h - r, r);
  ctx.lineTo(x0, y0 + r);
  ctx.arcTo(x0, y0, x0 + r, y0, r);
  ctx.closePath();
  ctx.fillStyle = '#' + TILLED_COLOR.toString(16).padStart(6, '0');
  ctx.fill();
  ctx.clip();
  const rowH = 8;
  for (let y = 2; y < size; y += rowH) {
    ctx.fillStyle = 'rgba(60,35,10,0.55)';
    ctx.fillRect(0, y, size, 1);
    ctx.fillStyle = 'rgba(214,198,170,0.16)';
    ctx.fillRect(0, y + 3, size, 1);
  }
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.5
      ? 'rgba(64,44,22,0.35)'
      : 'rgba(206,190,162,0.22)';
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

// The liquid's inks: the crest band, its leading edge and the depth speck.
// Water is the original; lava is the same drawing in embers (drawLavaTex).
const WATER_INKS = {
  crest: 'rgba(150,200,205,0.26)', edge: 'rgba(205,225,225,0.12)', speck: 'rgba(0,20,50,0.18)',
};
const LAVA_INKS = {
  crest: 'rgba(218,107,35,0.24)', edge: 'rgba(241,157,69,0.16)', speck: 'rgba(40,0,0,0.30)',
};
function drawLavaTex(ctx, size, rng, phaseFrac = 0) {
  drawWaterTex(ctx, size, rng, phaseFrac, LAVA_INKS);
}

function drawWaterTex(ctx, size, rng, phaseFrac = 0, inks = WATER_INKS) {
  // Horizontal highlight bands — top-down water with distinct cyan stripe
  // pattern. `phaseFrac` (0..1) slides the bands downward by that fraction of
  // one band-period; a full unit brings the pattern back to itself, so the
  // WATER_ANIM_PHASES baked frames loop seamlessly. Everything is driven by
  // the same rng call sequence regardless of phase, so the depth specks hold
  // still while only the bands move.
  ctx.clearRect(0, 0, size, size);
  // The band grid is FIXED across variants and divides the tile exactly:
  // period 8 into a 32px cell, no per-variant start offset. Both are what
  // keep the animation continuous at tile edges — every water cell's crests
  // sit on the same rows and step in lockstep, so a crest leaving one cell's
  // bottom edge is the same crest entering the next cell's top edge. (The old
  // random 7-9px period + random start made each cell its own misaligned
  // grid, and crests visibly popped in at the top of every tile.)
  const bandH = 2;
  const period = 8;                        // must divide `size` for the wrap below
  const off = Math.round(phaseFrac * period);
  // Horizontal variation — a gentle sine swell plus one broken-crest window
  // where the band drops out. Both are SHARED by every band in the tile: a
  // per-band shape can't survive the loop (after one full cycle band k sits
  // exactly where band k+1 was, so any k-keyed difference would pop at the
  // wrap). Cells hash-pick between the variants, and the wave slides one full
  // wavelength sideways per loop, so the water still varies across cells and
  // shimmers diagonally rather than reading as ruled lines.
  const waveLen = size / (1 + Math.floor(rng() * 2));   // 1-2 waves per tile (x-periodic)
  const wavePhase = rng() * Math.PI * 2;
  const waveAmp = 0.8 + rng() * 0.7;                    // ~1px swell
  const gapStart = Math.floor(rng() * size);            // broken-crest window (wraps)
  const gapLen = 4 + Math.floor(rng() * 5);             // 4-8 px of open water
  const xPhase = phaseFrac * Math.PI * 2;   // one wavelength per loop — seamless
  // 1px row with toroidal y-wrap: a crest pushed past either edge re-enters
  // on the opposite side (consistent with the band grid, since period divides
  // size), so bands scroll through the tile without clipping flat at y=0.
  const row = (x, y, style) => {
    ctx.fillStyle = style;
    ctx.fillRect(x, ((y % size) + size) % size, 1, 1);
  };
  for (let y = off; y < size + off; y += period) {
    for (let x = 0; x < size; x++) {
      if ((x - gapStart + size) % size < gapLen) continue;
      const yy = y + Math.round(Math.sin(x * 2 * Math.PI / waveLen + wavePhase + xPhase) * waveAmp);
      for (let r = 0; r < bandH; r++) row(x, yy + r, inks.crest); // dull crest band
      row(x, yy, inks.edge);                                     // faint leading edge
    }
  }
  // Subtle dark depth specks.
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = inks.speck;
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 2, 1);
  }
}

function drawUnmappedTex(ctx, size, rng, phaseFrac = 0) {
  // The "still charting this ground" shimmer for cells whose tile hasn't
  // loaded (pseudo-terrain 30 above). Faint diagonal survey lines drift
  // slowly across the dark fog base colour; the line grid is tile-periodic
  // (spacing divides the tile size) and every unmapped cell shares the one
  // variant and the one clock, so the pattern runs continuously across the
  // whole unloaded area instead of breaking at each cell edge. Same
  // pre-baked-phases scheme as water: `phaseFrac` slides the lines one grid
  // period per loop, so the 8 frames loop seamlessly and cost nothing at
  // runtime.
  ctx.clearRect(0, 0, size, size);
  const P = 8;                                   // diagonal line spacing; divides 32
  const off = Math.round(phaseFrac * P);
  ctx.fillStyle = 'rgba(200,210,220,0.07)';      // survey line — barely-there steel
  for (let y = 0; y < size; y++) {
    for (let x = (((off - y) % P) + P) % P; x < size; x += P) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Static specks — unexposed film grain. Same rng sequence every phase, so
  // only the lines move.
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 2, 1);
  }
}

function drawResidentialTex(ctx, size, rng) {
  // Concrete — subtle, infrequent aggregate flecks on transparent bg.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.5
      ? 'rgba(0,0,0,0.18)'
      : 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 3; i++) {
    const x = 2 + Math.floor(rng() * (size - 4));
    const y = 2 + Math.floor(rng() * (size - 4));
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawPathTex(ctx, size, rng) {
  // Scattered pebbles — small darker and lighter dots.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const dark = rng() < 0.6;
    ctx.fillStyle = dark ? 'rgba(38,32,24,0.4)' : 'rgba(226,222,212,0.25)';
    const w = rng() < 0.3 ? 2 : 1;
    ctx.fillRect(x, y, w, w);
  }
}

function drawBuildingTex(ctx, size, rng) {
  // Small rounded cobbles packed across the cell.
  ctx.clearRect(0, 0, size, size);
  const step = 6;
  for (let row = 0; row * step < size + step; row++) {
    const offset = (row % 2) * (step / 2);
    for (let col = 0; col * step < size + step; col++) {
      const cx = col * step + offset + (rng() - 0.5) * 1.5;
      const cy = row * step + step / 2 + (rng() - 0.5) * 1.5;
      const r = 2 + rng() * 0.6;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(cx - 0.6, cy - 0.6, r - 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawCastleFloorTex(ctx, size, rng) {
  // Subtle stone cobbles for the castle court — coarser and much fainter
  // than the house cobble (drawBuildingTex) so the paving reads without
  // competing with the bright rampart walls. Drawn as a transparent overlay
  // baked over the slate base colour.
  ctx.clearRect(0, 0, size, size);
  const step = 8;
  for (let row = 0; row * step < size + step; row++) {
    const offset = (row % 2) * (step / 2);
    for (let col = 0; col * step < size + step; col++) {
      const cx = col * step + offset + (rng() - 0.5) * 2;
      const cy = row * step + step / 2 + (rng() - 0.5) * 2;
      const r = 2.6 + rng() * 0.8;
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.arc(cx - 0.7, cy - 0.7, r - 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawWoodFloorTex(ctx, size, rng) {
  // Horizontal planks with staggered seams + faint grain.
  ctx.clearRect(0, 0, size, size);
  const PLANK_H = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  for (let y = PLANK_H; y < size; y += PLANK_H) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(size, y + 0.5); ctx.stroke();
  }
  // Plank-end seams — one per row, staggered.
  for (let row = 0; row * PLANK_H < size; row++) {
    const ex = 4 + Math.floor(rng() * (size - 8));
    ctx.beginPath();
    ctx.moveTo(ex + 0.5, row * PLANK_H);
    ctx.lineTo(ex + 0.5, row * PLANK_H + PLANK_H);
    ctx.stroke();
  }
  // Light grain streaks.
  ctx.strokeStyle = 'rgba(222,214,196,0.18)';
  for (let i = 0; i < 20; i++) {
    const y = rng() * size, x = rng() * size, len = 3 + rng() * 10;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  // Occasional knot.
  if (rng() < 0.5) {
    ctx.fillStyle = 'rgba(62,48,30,0.55)';
    ctx.beginPath(); ctx.arc(rng() * size, rng() * size, 1.4 + rng() * 0.6, 0, Math.PI * 2); ctx.fill();
  }
}

function drawRockTex(ctx, size, rng) {
  // A few jagged dark cracks plus a couple highlights.
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  const cracks = 2 + Math.floor(rng() * 2);
  for (let c = 0; c < cracks; c++) {
    let x = rng() * size;
    let y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < segs; i++) {
      x += (rng() - 0.5) * (size / 2);
      y += (rng() - 0.5) * (size / 2);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 2, 1);
  }
}

// ── Cave biome textures ────────────────────────────────────────────────────

function drawCaveWallTex(ctx, size, rng) {
  // Packed boulder faces — irregular ellipses with shadow outlines and a
  // highlight sliver on the top-left so the rocks read as three-dimensional
  // against the near-black base colour (0x241f1b).
  ctx.clearRect(0, 0, size, size);
  const step = 7;
  for (let row = 0; row * step < size + step; row++) {
    const offset = (row % 2) * 3;
    for (let col = 0; col * step < size + step; col++) {
      const cx = col * step + offset + (rng() - 0.5) * 2.5;
      const cy = row * step + step * 0.5 + (rng() - 0.5) * 2;
      const rw = 2.5 + rng() * 1.2;
      const rh = 1.8 + rng() * 1.0;
      // Faint warm face — catches a tiny glimmer off the cave floor below
      ctx.fillStyle = 'rgba(200,170,130,0.07)';
      ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
      // Crack / shadow outline around each boulder
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); ctx.stroke();
      // Highlight sliver — top-left edge
      ctx.fillStyle = 'rgba(255,220,180,0.13)';
      ctx.beginPath(); ctx.ellipse(cx - rw * 0.3, cy - rh * 0.35, rw * 0.45, rh * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 1-2 longer crack lines cutting across the face
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  const cracks = 1 + Math.floor(rng() * 2);
  for (let c = 0; c < cracks; c++) {
    let x = rng() * size, y = rng() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      x += (rng() - 0.5) * 6; y += (rng() - 0.5) * 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Rare mineral glint — a single bright pixel
  if (rng() < 0.45) {
    ctx.fillStyle = 'rgba(200,240,255,0.45)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
}

function drawCaveFloorTex(ctx, size, rng) {
  // Packed grit and small pebbles over the earthy brown base (0x4a423b).
  ctx.clearRect(0, 0, size, size);
  // Fine grit — dark and light specks
  for (let i = 0; i < 22; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.6
      ? 'rgba(0,0,0,0.28)'
      : 'rgba(255,215,170,0.13)';
    ctx.fillRect(x, y, 1, 1);
  }
  // Small pebbles (2×1 or 1×2)
  const pebbles = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < pebbles; i++) {
    const x = 1 + Math.floor(rng() * (size - 3));
    const y = 1 + Math.floor(rng() * (size - 3));
    const horiz = rng() < 0.5;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y, horiz ? 2 : 1, horiz ? 1 : 2);
    ctx.fillStyle = 'rgba(255,210,160,0.18)';
    ctx.fillRect(x, y, 1, 1);
  }
  // Occasional shallow groove
  if (rng() < 0.4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    const gx = rng() * size, gy = rng() * size;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + (rng() - 0.5) * 8, gy + (rng() - 0.5) * 4);
    ctx.stroke();
  }
}

// ── Subtype-biome textures ─────────────────────────────────────────────────
// Each builds on grass or concrete to give the biome its own read at a glance.

function drawSchoolTex(ctx, size, rng) {
  // Schoolyard turf — grass with faint horizontal mown bands.
  drawGrassTex(ctx, size, rng);
  for (let y = 0; y < size; y += 8) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, y, size, 4);
  }
}

function drawPitchTex(ctx, size, rng) {
  // Sports pitch — bold alternating mown stripes + the odd chalk sideline.
  drawGrassTex(ctx, size, rng);
  for (let y = 0; y < size; y += 8) {
    ctx.fillStyle = (Math.floor(y / 8) % 2) ? 'rgba(255,255,255,0.04)' : 'rgba(0,30,0,0.05)';
    ctx.fillRect(0, y, size, 8);
  }
  if (rng() < 0.25) {
    ctx.fillStyle = 'rgba(235,235,225,0.22)';
    ctx.fillRect(rng() < 0.5 ? 2 : size - 3, 0, 1, size);
  }
}

function drawGolfTex(ctx, size, rng) {
  // Fairway — fine vertical mowing stripes on bright turf.
  drawGrassTex(ctx, size, rng);
  for (let x = 0; x < size; x += 4) {
    ctx.fillStyle = (Math.floor(x / 4) % 2) ? 'rgba(255,255,255,0.03)' : 'rgba(0,30,0,0.04)';
    ctx.fillRect(x, 0, 4, size);
  }
}

function drawPlaygroundTex(ctx, size, rng) {
  // Bark / rubber mulch — warm brown chips, no green.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
    const r = rng();
    ctx.fillStyle = r < 0.5 ? 'rgba(96,84,62,0.30)'
                  : r < 0.8 ? 'rgba(128,116,92,0.25)'
                            : 'rgba(72,62,44,0.30)';
    ctx.fillRect(x, y, rng() < 0.3 ? 2 : 1, 1);
  }
}

function drawCommercialTex(ctx, size, rng) {
  // Grey anti-slip matte ceramic floor tile (one big tile per cell). Drawn over
  // the flat grey COMMERCIAL fill: a fine matte speckle for the anti-slip
  // finish, a faint ceramic mottle, and a recessed grout seam on the top + left
  // edges so adjacent cells read as a continuous large-format tile grid.
  ctx.clearRect(0, 0, size, size);
  // Anti-slip matte speckle — many very-low-contrast dots, evenly spread.
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, 1, 1);
  }
  // Faint ceramic mottle — a couple of soft tonal patches.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.beginPath(); ctx.arc(rng() * size, rng() * size, 5 + rng() * 5, 0, Math.PI * 2); ctx.fill();
  }
  // Grout seam (top + left) with a soft inner highlight = a subtle bevel.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, size, 1);
  ctx.fillRect(0, 0, 1, size);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, 1, size, 1);
  ctx.fillRect(1, 0, 1, size);
}

function drawIndustrialTex(ctx, size, rng) {
  // Industrial yard — rough concrete with scattered gravel + the odd oil stain.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 22; i++) {
    const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.55 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.10)';
    const w = rng() < 0.25 ? 2 : 1;
    ctx.fillRect(x, y, w, w);
  }
  if (rng() < 0.5) {
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath(); ctx.arc(rng() * size, rng() * size, 2 + rng() * 2, 0, Math.PI * 2); ctx.fill();
  }
}

function drawWastelandTex(ctx, size, rng) {
  // Wasteland — abandoned lot gone to scrub: dry grit, a hairline crack or
  // two, and a few pale dead-grass ticks. Same family as residential's
  // concrete flecks, but looser and dustier, so a vacant lot reads as
  // neglected ground rather than a yard.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.6 ? 'rgba(52,42,26,0.22)' : 'rgba(236,224,190,0.12)';
    ctx.fillRect(x, y, rng() < 0.3 ? 2 : 1, 1);
  }
  ctx.strokeStyle = 'rgba(40,32,20,0.20)';
  ctx.lineWidth = 1;
  for (let c = 0; c < 2; c++) {
    let x = rng() * size, y = rng() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      x += (rng() - 0.5) * 8; y += (rng() - 0.5) * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let t = 0; t < 4; t++) {
    const x = 2 + Math.floor(rng() * (size - 4)), y = 3 + Math.floor(rng() * (size - 5));
    ctx.fillStyle = 'rgba(214,196,140,0.28)';
    ctx.fillRect(x, y - 2, 1, 2);
    ctx.fillRect(x + 1, y - 1, 1, 1);
    ctx.fillRect(x - 1, y - 1, 1, 1);
  }
}

function drawGroveTex(ctx, size, rng) {
  // Grove — the lush sward around a park's heart: the lawn's specks, denser
  // and greener, with clover clumps and a pale blossom or two. Never yellow
  // (the interaction colour).
  drawGrassTex(ctx, size, rng);
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(rng() * (size - 2)), y = Math.floor(rng() * (size - 2));
    ctx.fillStyle = 'rgba(70,120,55,0.40)';
    ctx.fillRect(x, y, 2, 1); ctx.fillRect(x, y + 1, 1, 1);
  }
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(230,225,240,0.45)' : 'rgba(216,160,175,0.45)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
}

function drawChurchyardTex(ctx, size, rng) {
  // Churchyard — mossy grey-green sward: moss tufts and grass specks over
  // the cool grey-green ground, and small pale stone chips working up
  // through it.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 22; i++) {
    const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
    const k = rng();
    ctx.fillStyle = k < 0.45 ? 'rgba(62,92,58,0.34)' : k < 0.75 ? 'rgba(96,128,84,0.26)' : 'rgba(150,160,140,0.20)';
    ctx.fillRect(x, y, k < 0.25 ? 2 : 1, 1);
  }
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rng() * (size - 2)), y = Math.floor(rng() * (size - 2));
    ctx.fillStyle = 'rgba(200,200,190,0.30)';
    ctx.fillRect(x, y, 2, 1);
    ctx.fillStyle = 'rgba(40,40,36,0.25)';
    ctx.fillRect(x, y + 1, 2, 1);
  }
}

function drawTarYardTex(ctx, size, rng) {
  // Tar yard — dark oily ground: grit, a black pool or two with a dull
  // blue-violet sheen on its lip.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.6 ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(x, y, 1, 1);
  }
  const pools = 1 + Math.floor(rng() * 2);
  for (let p = 0; p < pools; p++) {
    const x = rng() * size, y = rng() * size, r = 2 + rng() * 3;
    ctx.fillStyle = 'rgba(8,8,10,0.45)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,110,170,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
  }
}

function drawWetlandTex(ctx, size, rng) {
  // Marsh — dark mossy mottle, faint water glints, a few vertical reed flecks.
  ctx.clearRect(0, 0, size, size);
  drawGroundMottle(ctx, size, rng, 0x4A45, 10, 1.5, 2, 'rgba(30,42,28,0.30)');
  const glints = seededRand(0x61A7);
  ctx.strokeStyle = 'rgba(150,175,175,0.20)';
  ctx.lineWidth = 1;
  for (let r = 0; r < 2; r++) {
    const baseY = 2 + glints() * (size - 4), phase = glints() * Math.PI * 2;
    ctx.beginPath();
    for (let x = -1; x <= size + 1; x++) {
      const y = baseY + Math.sin((x / size) * Math.PI * 2 + phase);
      if (x === -1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(96,108,66,0.30)';
    const h = 2 + Math.floor(rng() * 2);
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * (size - h + 1)), 1, h);
  }
}

function drawOrchardTex(ctx, size, rng) {
  // Orchard understory — grass dappled with soft tree-shade pools.
  drawGrassTex(ctx, size, rng);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = 'rgba(0,30,0,0.10)';
    ctx.beginPath(); ctx.arc(rng() * size, rng() * size, 4 + rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
}

// (drawLongGrassTex removed — longgrass now uses frame 0 of the 'props'
// sheet via CROP_SPRITE. The procedurally drawn version had inconsistent
// blade colours / shading next to the hand-painted wilderness art.)

// Simple procedural castle turret — a stout stone column with a crenellated
// top. One 28×42 canvas, anchor at bottom-centre so it sits on its cell. The
// column still rises clearly above the rampart battlements it stands among
// (those reach ~10px above their cell) but is shorter than the old 50px
// version, which towered over the walls rather than crowning them.
//
// Pixel-art rules this obeys (the old version broke all three, which is what
// made it read as slightly "off"):
//   • the outline is drawn as 1px fillRects, never a stroked path — a
//     lineWidth-1 stroke ON integer coordinates straddles the pixel boundary
//     and renders as two half-lit rows, blurring every edge;
//   • the merlons are centred on the battlement slab (they used to sit 1px
//     left of centre, so the crown looked knocked sideways);
//   • shading lines stay INSIDE the outline instead of running under it.
// `palette` / `key` bake the SECOND turret: an unclaimed castle draws
// 'tower_unclaimed', generated from CASTLE_STONE_UNCLAIMED, instead of taking a
// multiply tint over the claimed one (see the unclaimed-shade note up top).
function makeTowerTexture(scene, palette, key) {
  const KEY = key || 'tower';
  const P = palette || CASTLE_STONE;
  if (scene.textures.exists(KEY)) return;
  // 28 wide (was 24): the column read as a thin post next to the rampart it
  // crowns. The 24px battlement slab still sits inside the 32px cell.
  // 42 tall with NO padding: the last row of the canvas IS the turret's
  // grounding line, so the renderer can seat the sprite by its frame bottom
  // and land the art exactly on the cell's bottom edge (see the tower entry in
  // render.js RENDER_SPEC). Padding here would offset that by however many
  // empty rows it left.
  const W = 28, H = 42;
  const tex = scene.textures.createCanvas(KEY, W, H);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, W, H);

  // Straight off the shared castle palette, so the turret is the same masonry
  // as the rampart: column = the walls' extruded FACE stone, battlements =
  // their lit BODY stone, silhouette = the walls' DARK grounding tone.
  const OUTLINE     = P.DARK.s;
  const wallColor   = P.FACE.s;
  const battleColor = P.BODY.s;

  // Layout, top to bottom: merlons, battlement slab (overhanging the body),
  // then the column down to a 2px gap at the canvas bottom.
  // Four teeth on the wider crown keeps the same 4px tooth / 2px crenel rhythm
  // the old three had on the narrower one (22px of crenellation on the 24px
  // slab, so 1px of slab shows at each end).
  const MERLON_H = 4, MERLON_W = 4, MERLON_GAP = 2, MERLONS = 4;
  const battTop = MERLON_H, battH = 5;
  const bodyTop = battTop + battH;          // 9
  const bodyBot = H;                        // 42 — art runs to the last row
  const bodyX = 4, bodyW = W - 8;           // x 4..24
  const battX = bodyX - 2, battW = bodyW + 4;  // slab overhangs 2px each side

  // ── Column ────────────────────────────────────────────────────────────
  ctx.fillStyle = wallColor;
  ctx.fillRect(bodyX, bodyTop, bodyW, bodyBot - bodyTop);
  // Lit left edge / shadowed right edge, both inset 1px so the outline below
  // paints over neither. Both are palette stones, not white/black washes.
  ctx.fillStyle = P.BODY.s;                 // lit edge = the wall's crest stone
  ctx.fillRect(bodyX + 1, bodyTop, 1, bodyBot - bodyTop);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = P.SHADOW.s;
  ctx.fillRect(bodyX + bodyW - 2, bodyTop, 1, bodyBot - bodyTop);
  ctx.globalAlpha = 1;
  // Corbel shadow: the slab overhangs, so the top of the column sits in its
  // shade. Without this the overhang read as a hat balanced on a stick.
  ctx.fillStyle = P.SHADOW.s;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(bodyX + 1, bodyTop, bodyW - 2, 2);
  ctx.globalAlpha = 1;
  // Stone-block joints, inset 1px from each side so they stop at the outline.
  // The wall's own SHADOW tone rather than a black wash: black pulls the
  // blue-grey stone toward neutral, so joints drawn that way read as a
  // different rock from the rampart's.
  ctx.fillStyle = P.SHADOW.s;
  for (let y = bodyTop + 7; y < bodyBot - 3; y += 7) {
    ctx.fillRect(bodyX + 1, y, bodyW - 2, 1);
  }
  // Grounding shade at the foot — a single soft SHADOW pass, no DARK contact
  // line. The turret always stands ON castle masonry (it only spawns on a
  // tier-12 wall cell), and that stone is the same tone as its own column, so
  // a hard dark line there read as the column being CUT rather than as it
  // meeting the wall. The fade at the very bottom (applied after the outline,
  // below) does the joining; this just keeps the foot from reading flat.
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = P.SHADOW.s;
  ctx.fillRect(bodyX + 1, bodyBot - 5, bodyW - 2, 5);
  ctx.globalAlpha = 1;
  // Arrow slit — a dark 2px slot with a lit sill under it so it reads as an
  // opening cut INTO the wall rather than a painted-on smudge. Sits one row
  // BELOW the first joint course: starting flush on a joint made the slit look
  // like a crack running out of the masonry line.
  const slitX = (W >> 1) - 1, slitY = bodyTop + 8;
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(slitX, slitY, 2, 5);
  ctx.fillStyle = P.LITE.s;
  ctx.fillRect(slitX, slitY + 5, 2, 1);

  // ── Battlement slab + merlons ─────────────────────────────────────────
  ctx.fillStyle = battleColor;
  ctx.fillRect(battX, battTop, battW, battH);
  // Merlons centred on the slab (see MERLONS above).
  const crownW = MERLONS * MERLON_W + (MERLONS - 1) * MERLON_GAP;
  const crownX = battX + ((battW - crownW) >> 1);
  const merlonX = (i) => crownX + i * (MERLON_W + MERLON_GAP);
  for (let i = 0; i < MERLONS; i++) {
    ctx.fillRect(merlonX(i), battTop - MERLON_H, MERLON_W, MERLON_H);
  }
  // (Merlon top-lighting is applied after the outline below — drawn here it
  // would be painted straight over by the merlon's own outline.)
  // Shadow line under the slab's own lip, so slab and merlons read as separate
  // courses of stone rather than one poured shape. Same SHADOW tone the wall
  // crest uses for its parapet line.
  ctx.fillStyle = P.SHADOW.s;
  ctx.fillRect(battX + 1, battTop + battH - 1, battW - 2, 1);

  // ── Silhouette outline (1px fillRects — see the note above) ───────────
  ctx.fillStyle = OUTLINE;
  const vline = (x, y0, y1) => ctx.fillRect(x, y0, 1, y1 - y0);
  const hline = (x0, x1, y) => ctx.fillRect(x0, y, x1 - x0, 1);
  // Column sides. NO foot line: the turret meets castle masonry of its own
  // tone, so a dark rule across the bottom read as a cut edge. The foot fade
  // at the end of this function joins it to the wall instead.
  vline(bodyX, bodyTop, bodyBot);
  vline(bodyX + bodyW - 1, bodyTop, bodyBot);
  // Slab: sides, its underside where it overhangs the column, and the top
  // where no merlon covers it.
  vline(battX, battTop, bodyTop);
  vline(battX + battW - 1, battTop, bodyTop);
  hline(battX, bodyX, bodyTop - 1);                       // left overhang underside
  hline(bodyX + bodyW, battX + battW, bodyTop - 1);        // right overhang underside
  // Merlon outlines + the crenel floors between them.
  hline(battX, crownX, battTop);
  for (let i = 0; i < MERLONS; i++) {
    const mx = merlonX(i);
    vline(mx, battTop - MERLON_H, battTop);
    vline(mx + MERLON_W - 1, battTop - MERLON_H, battTop);
    hline(mx, mx + MERLON_W, battTop - MERLON_H);
    if (i < MERLONS - 1) hline(mx + MERLON_W, merlonX(i + 1), battTop);
  }
  hline(crownX + crownW, battX + battW, battTop);
  // Merlon top-lighting, inside the outline: one lit pixel across each
  // merlon's crown, matching the light direction the rampart crest uses
  // (render.js crestH). Drawn last so the silhouette doesn't cover it.
  ctx.fillStyle = P.LITE.s;
  for (let i = 0; i < MERLONS; i++) {
    ctx.fillRect(merlonX(i) + 1, battTop - MERLON_H + 1, MERLON_W - 2, 1);
  }

  // ── Foot fade ─────────────────────────────────────────────────────────
  // The last rows ramp to fully transparent, so the column dissolves into the
  // masonry it stands on — the wall face where it crowns a rampart, the court
  // floor where it overhangs one — instead of stopping on a drawn edge. Done
  // by erasing (destination-out) rather than by painting a colour, so it
  // blends into WHATEVER is underneath without the texture having to know.
  // It also takes the side outlines with it, which is the point: an outline
  // that ran to the last row was the other half of the cut-off look.
  const FOOT_FADE = 6;
  ctx.globalCompositeOperation = 'destination-out';
  const foot = ctx.createLinearGradient(0, H - FOOT_FADE, 0, H);
  foot.addColorStop(0, 'rgba(0,0,0,0)');
  foot.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = foot;
  ctx.fillRect(0, H - FOOT_FADE, W, FOOT_FADE);
  ctx.globalCompositeOperation = 'source-over';
  if (P === CASTLE_STONE_UNCLAIMED) {
    const image = ctx.getImageData(0, 0, W, H);
    tuneUnclaimedMaterialPixels(image.data);
    ctx.putImageData(image, 0, 0);
  }
  tex.refresh();
}

// Procedural "pot of gold" — the in-world art for the coin-burst POIs
// (ATM + bicycle_parking). Tapping one of these spills a burst of collectible
// coins, so a little cast-iron cauldron brimming with gold reads the mechanic
// at a glance (and replaces the old tinted-chest stand-in flagged in render.js).
// Single-frame canvas texture keyed 'potofgold'; the render spec leaves `frame`
// undefined for it, exactly like the themed-house sprites.
function makePotOfGoldTexture(scene) {
  const KEY = 'potofgold';
  if (scene.textures.exists(KEY)) return;
  const W = 24, H = 22;
  const tex = scene.textures.createCanvas(KEY, W, H);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, W, H);
  const cx = 12;

  // ── Cast-iron cauldron body ─────────────────────────────────────────
  // A dark rounded pot drawn as an ellipse, with a belly highlight/shadow
  // and three stubby feet so it reads as a pot rather than a blob.
  const bodyCY = 14, bodyRX = 9, bodyRY = 7;
  ctx.fillStyle = '#2b2b32';
  ctx.beginPath();
  ctx.ellipse(cx, bodyCY, bodyRX, bodyRY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';   // left-belly highlight
  ctx.beginPath();
  ctx.ellipse(cx - 3, bodyCY + 1, 3, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.30)';          // right-belly shadow
  ctx.beginPath();
  ctx.ellipse(cx + 4, bodyCY + 1, 3, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rim band + dark inner mouth (so the gold reads as overflowing the pot).
  ctx.fillStyle = '#3b3b44';
  ctx.beginPath();
  ctx.ellipse(cx, 8, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1a1e';
  ctx.beginPath();
  ctx.ellipse(cx, 8, 7, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Three little feet.
  ctx.fillStyle = '#1f1f24';
  ctx.fillRect(cx - 7, 19, 3, 2);
  ctx.fillRect(cx - 1, 20, 3, 2);
  ctx.fillRect(cx + 4, 19, 3, 2);

  // ── Green coin pile overflowing the mouth ───────────────────────────
  const gold = '#45c878', goldHi = '#b2f5ba', goldLo = '#21894f';
  ctx.fillStyle = gold;                        // base mound
  ctx.beginPath();
  ctx.ellipse(cx, 7, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Rounded coin bumps on top — each is a low-shadow + body + highlight dot.
  const coins = [
    [cx - 4, 5, 2.4], [cx + 1, 4, 2.6], [cx + 5, 6, 2.2],
    [cx - 1, 7, 2.2], [cx + 3, 8, 1.8],
  ];
  for (const [x, y, r] of coins) {
    ctx.fillStyle = goldLo;
    ctx.beginPath(); ctx.ellipse(x, y + 0.6, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = gold;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = goldHi;
    ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.25, r * 0.4, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  }
  // A couple of coins spilling down each side of the pot.
  for (const [x, y] of [[cx - 8, 11], [cx + 9, 12]]) {
    ctx.fillStyle = gold;
    ctx.beginPath(); ctx.ellipse(x, y, 2, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = goldHi;
    ctx.beginPath(); ctx.ellipse(x - 0.4, y - 0.4, 0.8, 0.6, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Crisp dark outline along the lower belly for pixel-art pop (the top is
  // hidden behind the gold, so only stroke the visible bottom arc).
  ctx.strokeStyle = '#15151a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCY, bodyRX, bodyRY, 0, Math.PI * 0.12, Math.PI * 0.88);
  ctx.stroke();

  tex.refresh();
}

// === Traps — TEMPORARY procedural art ==================================
// Two single-frame canvas textures, both exactly one cell (TRAP_PX) square so
// the mark reads as belonging to ONE cell (CLAUDE.md: interactables must be
// clearly in one cell) — the art is inset from every edge, and the renderer
// centres it on the cell, so nothing spills onto a neighbour.
//
// These are STAND-INS for hand-drawn sprites. They are drawn rather than
// loaded because a trap has to say two opposite things with one silhouette,
// and getting that contrast right matters more right now than the linework:
//
//   trap_hidden — a scuff. Disturbed ground: a broken ring of small loose
//     stones ringing the covering, a couple of twig slivers laid over it, and
//     one small dark gap where the covering has sagged. Everything at low
//     alpha, in tones taken off the ground rather than added to it, so it
//     reads as "something is odd about this cell" to a player who is looking
//     and as nothing at all to one who is not. The stone ring is the actual
//     tell — round and grouped (a shadowed underside, a paler lit top) so it
//     reads as a little ring of stones rather than a scatter of specks; it was
//     too faint a first pass (flat 2×1 dots at 0.20-0.30 alpha) to be spotted
//     at a glance, which is dodgeable-by-the-observant tipping into
//     invisible-to-everyone. It still sits well under the 0.4-alpha ceiling
//     the sprung trap's opaque ink clears, so it stays the quieter of the
//     two. Under the lightmap (the trap layer sits below it) an unlit cell
//     hides it completely, which is why caves are the dangerous half of this
//     feature.
//
//   trap_open — a sprung iron jaw. Dark pit, a rust-brown ring, and two arcs
//     of triangular teeth meeting across it, lit from the top-left like every
//     other sprite here. Loud on purpose: once it has bitten you, the cost of
//     standing on it is ongoing, so the art's whole job is "get off, and don't
//     walk back onto it".
const TRAP_PX = 32;                 // one cell — CELL_PX in app.js

function makeTrapTextures(scene) {
  makeHiddenTrapTexture(scene);
  makeSprungTrapTexture(scene);
}

function makeHiddenTrapTexture(scene) {
  const KEY = 'trap_hidden';
  if (scene.textures.exists(KEY)) return;
  const S = TRAP_PX, c = S / 2;
  const tex = scene.textures.createCanvas(KEY, S, S);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, S, S);

  // Disturbed-earth ring: a broken ring of small round stones, each with a
  // shadowed underside and a paler lit top so it reads as an actual pebble
  // rather than a flat speck. Broken, not continuous — a complete circle on
  // the ground reads as a manhole — and the two dots per stone are drawn
  // close enough to overlap into one rounded shape instead of a pair of
  // pixels.
  const R = c - 4;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.35;
    if (i % 5 === 3) continue;                    // gaps in the ring
    const x = c + Math.cos(a) * R, y = c + Math.sin(a) * R * 0.92;
    ctx.fillStyle = 'rgba(24,18,12,0.40)';        // shadowed underside of the stone
    ctx.beginPath(); ctx.ellipse(x, y + 0.6, 1.8, 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(224,210,182,0.32)';     // its lit top, catching the light
    ctx.beginPath(); ctx.ellipse(x, y - 0.5, 1.4, 1.0, 0, 0, Math.PI * 2); ctx.fill();
  }
  // The sag: one small dark crescent just below centre where the covering has
  // given a little. Deliberately fainter and smaller than the disturbed-earth
  // ring around it — the ring is the tell a careful player learns to read;
  // the centre itself should all but disappear into the ground, not draw the
  // eye first.
  ctx.fillStyle = 'rgba(18,14,10,0.15)';
  ctx.beginPath();
  ctx.ellipse(c + 1, c + 2, 3, 1.5, -0.25, 0, Math.PI * 2);
  ctx.fill();
  // Twigs / grass laid over the covering — three short pale strokes at
  // different angles. Straight lines are what makes it read as PLACED cover
  // rather than as a patch of bare dirt.
  ctx.strokeStyle = 'rgba(150,132,92,0.28)';
  ctx.lineWidth = 1;
  const twigs = [[-7, -4, 6, 3], [-5, 4, 8, -2], [1, -6, 5, 6]];
  for (const [dx0, dy0, dx1, dy1] of twigs) {
    ctx.beginPath();
    ctx.moveTo(c + dx0 + 0.5, c + dy0 + 0.5);
    ctx.lineTo(c + dx0 + dx1 + 0.5, c + dy0 + dy1 + 0.5);
    ctx.stroke();
  }
  tex.refresh();
}

function makeSprungTrapTexture(scene) {
  const KEY = 'trap_open';
  if (scene.textures.exists(KEY)) return;
  const S = TRAP_PX, c = S / 2;
  const tex = scene.textures.createCanvas(KEY, S, S);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, S, S);

  // The whole jaw is drawn at SPRUNG_K of the cell it used to fill, and EVERY
  // number below is scaled by it — plate radii, ring thicknesses, jaw stroke,
  // tooth length, hinge block — so shrinking the art is one constant rather
  // than a re-tune. A trap that filled its cell edge to edge crowded the
  // ground marks and the sprites beside it; at 0.85 it still shouts, and the
  // cell around it reads as ground again.
  const SPRUNG_K = 0.85;
  const k = SPRUNG_K;
  const RX = (c - 3) * k, RY = (c - 3) * 0.84 * k;   // squashed — seen from above
  const IRON = '#7b6553', IRON_HI = '#ac967f', IRON_LO = '#332a22';
  const RUST = '#8a4a28';

  // The plate the trap is bolted to, and the dark hole inside it. The hole is
  // what the teeth bite into: without it the jaws have nothing to close ON and
  // the whole thing reads as a disc.
  ctx.fillStyle = 'rgba(38,27,18,0.9)';
  ctx.beginPath(); ctx.ellipse(c, c, RX, RY, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0b0908';
  ctx.beginPath(); ctx.ellipse(c, c, RX - 4 * k, RY - 2 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = RUST;
  ctx.beginPath(); ctx.ellipse(c, c, RX - 0.5 * k, RY - 0.5 * k, 0, 0, Math.PI * 2); ctx.stroke();

  // TWO JAWS, not a ring. Each is a thick arc over roughly the top (or bottom)
  // two-thirds of the plate, with a clear GAP at each side where the hinge and
  // the spring sit — that pair of gaps, and the dark slit left between the
  // tooth tips, are what make the silhouette read as a closed mouth rather
  // than as a wheel. (It read as a wheel when the teeth ran the whole way
  // round and met in the middle: evenly spaced spokes on a disc.)
  const A0 = 0.14, A1 = 0.86;                 // jaw arc, in units of π
  const jaw = (flip) => {
    const s = flip ? Math.PI * (1 + A0) : Math.PI * A0;
    const e = flip ? Math.PI * (1 + A1) : Math.PI * A1;
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = IRON;
    ctx.beginPath(); ctx.ellipse(c, c, RX - 2 * k, RY - 2 * k, 0, s, e); ctx.stroke();
    // Lit edge on the OUTSIDE of each jaw, so the two bands read as separate
    // pieces of metal rather than one ring.
    ctx.lineWidth = 1;
    ctx.strokeStyle = flip ? IRON_HI : IRON_LO;
    ctx.beginPath(); ctx.ellipse(c, c, RX - 0.8 * k, RY - 0.8 * k, 0, s, e); ctx.stroke();
  };
  jaw(true);      // upper
  jaw(false);     // lower

  // The teeth. They hang STRAIGHT DOWN off the upper jaw and straight up off
  // the lower one — never along the radius — and they are drawn only over the
  // middle of each arc, so the two rows meet in a narrow horizontal zigzag:
  // the mouth of a trap that has already CLOSED, which is what this texture is
  // for. Radial teeth were tried twice and read as a WHEEL both times, at both
  // lengths: short ones left evenly-spaced spokes on a disc, long ones crossed
  // near the sides and turned the black between them into more spokes. The
  // give-away is that a radial tooth near the side of the arc points sideways,
  // and no jaw has sideways teeth.
  const TOOTH = 4.6 * k, HALF_W = 1.5 * k;
  const B0 = 0.20, B1 = 0.80;                 // tooth span, in units of π
  const tooth = (ang, down) => {
    const bx = c + Math.cos(ang) * (RX - 3 * k);
    const by = c + Math.sin(ang) * (RY - 3 * k);
    ctx.fillStyle = IRON_HI;
    ctx.beginPath();
    ctx.moveTo(bx - HALF_W, by);
    ctx.lineTo(bx + HALF_W, by);
    ctx.lineTo(bx, by + (down ? TOOTH : -TOOTH));
    ctx.closePath();
    ctx.fill();
  };
  const TEETH = 5;
  for (let i = 0; i < TEETH; i++) {
    const t = (i + 0.5) / TEETH;
    tooth(Math.PI * (1 + B0 + (B1 - B0) * t), true);    // upper jaw, biting down
    tooth(Math.PI * (B0 + (B1 - B0) * t), false);       // lower jaw, biting up
  }

  // Hinge and spring, one on each side, filling the gaps the jaws left. They
  // break the circle — a plain disc on the ground reads as a treasure pad in
  // this world (see makeRoundPadTexture) — and say which way the jaws swung.
  // Anchored to the PLATE's rim rather than to the canvas edge: each block
  // starts 2 units outside the ellipse and runs inward, so it still bridges
  // the gap between the jaws at whatever size SPRUNG_K picks.
  const HW = 5 * k, HH = 4 * k, LIP = 1 * k;
  const hxL = c - RX - 2 * k, hxR = c + RX + 2 * k - HW, hy = c - HH / 2;
  ctx.fillStyle = IRON;
  ctx.fillRect(hxL, hy, HW, HH);
  ctx.fillRect(hxR, hy, HW, HH);
  ctx.fillStyle = RUST;
  ctx.fillRect(hxL, hy, HW, LIP);
  ctx.fillRect(hxR, hy, HW, LIP);
  ctx.fillStyle = IRON_LO;
  ctx.fillRect(hxL, hy + HH - LIP, HW, LIP);
  ctx.fillRect(hxR, hy + HH - LIP, HW, LIP);
  tex.refresh();
}

// === Animated biome textures ===
// A spec with `animPhases: N` bakes N phase frames per variant at startup:
// phase 0 keeps the plain `biome${type}_${v}` key (so anything holding that
// key still works), phases 1..N-1 get a `p${p}` suffix. drawCells already
// calls setTexture on every visible ground cell every frame, so animating is
// just building the key with the clock-derived phase — no per-frame canvas
// redraws, no texture uploads, no per-cell tweens. Each phase re-seeds the
// SAME rng, so static features stay put and only the phase-driven motion moves.
// Restore mark strength halfway toward the original for gameplay readability.
// Apply it once when baking a biome. Raw painters
// remain available to the audit's original/proposal comparison.
function drawBiomeTexture(ctx, size, type, variant = 0, phase = 0) {
  const spec = BIOME_TEX[type];
  ctx.save();
  spec.draw(ctx, size, seededRand((Number(type) + 1) * 1000 + variant + 1), phase);
  if (spec.patternOpacity != null && spec.patternOpacity !== 1) {
    // Scale the finished alpha, including overlaps, exactly as the proposal
    // composites its complete texture layer over the base colour.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.globalAlpha = spec.patternOpacity;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
}

// Render-only accents use the same anchor grid as ZoneDressing. They never
// alter terrain, occupancy, or the cave source. Cache anchor transforms, not
// a cell answer, so a player-edited terrain cell still keeps its own paint.
const ZONE_GROUND_ACCENTS = {
  mushroom_grove: { terrain: 28, color: 0x4b5d4a, fullCoverage: true },
  ancient_grove: { terrain: 28, color: 0x94a38c },
  silent_circle: { terrain: 29, color: 0xd5d3bd },
};
const _zoneGroundStates = new WeakMap();
function zoneGroundColor(entry, ix, iy, type, tx = entry && entry.tx, ty = entry && entry.ty) {
  const field = entry && entry.zone, V = typeof ZoneVariants !== 'undefined' && ZoneVariants;
  if (!field || !V || (type !== 28 && type !== 29)) return null;
  const N = entry.cellsPerEdge, coverage = field.coverage || field.idx;
  const ai = coverage && coverage[iy * N + ix] - 1;
  if (!(ai >= 0)) return null;
  let states = _zoneGroundStates.get(field);
  if (!states) {
    states = (field.anchors || []).map(a => {
      const variant = V.pick(a), accent = ZONE_GROUND_ACCENTS[variant.id];
      if (!accent) return null;
      const unit = WorldGen.CELL_M / (a.upm || N * WorldGen.CELL_M / 4096);
      const snap = p => {
        const origin = Math.floor(p / 4096) * 4096;
        return origin + (Math.floor((p - origin) / unit) + 0.5) * unit;
      };
      return { a, variant, accent, unit, rotation: V.rotation(a),
        x: snap(a.originGX == null ? a.gx : a.originGX),
        y: snap(a.originGY == null ? a.gy : a.originGY) };
    });
    _zoneGroundStates.set(field, states);
  }
  const s = states[ai];
  if (!s || type !== s.accent.terrain) return null;
  if (s.accent.fullCoverage) return s.accent.color;
  const dx = Math.round((tx * 4096 + (ix + 0.5) * 4096 / N - s.x) / s.unit);
  const dy = Math.round((ty * 4096 + (iy + 0.5) * 4096 / N - s.y) / s.unit);
  if (s.variant.id === 'silent_circle') return dx === 0 && dy === 0 ? s.accent.color : null;
  const [u, v] = V.inverseRotate(dx, dy, s.rotation), p = V.poiOrigin(s.variant);
  const material = V.sample(s.variant, u + p[0], v + p[1], s.a.key);
  return material === 'tree' || material === 'shrub' ? s.accent.color : null;
}

function makeBiomeTextures(scene, size) {
  for (const [type, spec] of Object.entries(BIOME_TEX)) {
    const phases = spec.animPhases || 1;
    for (let v = 0; v < spec.variants; v++) {
      for (let p = 0; p < phases; p++) {
        const key = `biome${type}_${v}` + (p ? `p${p}` : '');
        if (scene.textures.exists(key)) continue;
        const tex = scene.textures.createCanvas(key, size, size);
        const ctx = tex.getContext();
        drawBiomeTexture(ctx, size, type, v, p / phases);
        tex.refresh();
      }
    }
  }
  for (let v = 0; v < TILLED_VARIANTS; v++) {
    const key = `tilled_${v}`;
    if (scene.textures.exists(key)) continue;
    const tex = scene.textures.createCanvas(key, size, size);
    drawTilledTex(tex.getContext(), size, seededRand(7919 + v));
    tex.refresh();
  }
}

// === Concrete pads ===
// Every POI pad is the same: a single rounded slab sitting in the one cell
// directly under the chest. PAD_SHAPES still maps a shape key → cell occupancy
// + the chest's cell (the render layer anchors that cell's centre on the
// chest's ground point), but there is only one shape now: `round1`.
//
// Coordinate convention: [col, row] with col=x, row=y. (0,0) = top-left.
const PAD_CELL = 32;
// The pad is drawn a touch larger than its cell so it spills ~10% past the
// cell boundary into neighbouring cells, reading as a soft oversized base
// rather than a tile-aligned square.
const PAD_OVERSIZE = 1.10;
const PAD_SHAPES = {
  // Single rounded cell, chest centred on it. The only pad shape — used for
  // every pad-bearing POI regardless of type.
  round1: {
    cells: [[0, 0]],
    chest: [0, 0],
    round: true,
  },
};
// Pre-compute bounding box for each shape (cols × rows).
for (const s of Object.values(PAD_SHAPES)) {
  s.cols = Math.max(...s.cells.map(c => c[0])) + 1;
  s.rows = Math.max(...s.cells.map(c => c[1])) + 1;
}

// Trace a rounded-rectangle path (clamped so the radius never exceeds half the
// shorter side — at the max it degenerates to a circle/stadium).
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// The rounded single-cell pad. The canvas is PAD_OVERSIZE × PAD_CELL on a side
// so that, anchored at its centre on the chest's ground point, the slab spills
// evenly past the cell into its neighbours.
const POI_PAD_INKS = { top: '#dce4da', side: '#cbd2c9' };
function makeRoundPadTexture(scene, key, inks = POI_PAD_INKS) {
  const size = Math.round(PAD_CELL * PAD_OVERSIZE);
  const tex = scene.textures.createCanvas(key, size, size);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, size, size);
  const inset = 2;                          // keeps the slab off the texture edge
  // Pedestal: the slab top sits `depth` px above the silhouette's bottom; the
  // exposed band below it is drawn as a darker side face, so the pad reads as
  // a raised plinth the chest stands on rather than a flat painted disc.
  const depth = 4;
  const x = inset, y = inset, w = size - inset * 2, h = size - inset * 2 - depth;
  const radius = w * 0.32;                  // generously rounded corners
  // BORDERLESS: the pad is a backdrop, so it carries no perimeter outline —
  // just the two stone fills. (It used to be ringed in bright cyan, which
  // drew the eye to the slab instead of to the POI standing on it.) The
  // darker side face is the only thing separating plinth from top slab.
  // Warm ivory distinguishes this sacred/reward surface from rustic ground.
  // The same-hue side is about 8% darker, preserving the raised slab's depth
  // at the low alpha used by the renderer.
  // Side face first: the same rounded rect shifted down by `depth`.
  roundRectPath(ctx, x, y + depth, w, h, radius);
  ctx.fillStyle = inks.side;
  ctx.fill();
  // Top slab.
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = inks.top;
  ctx.fill();
  // Subtle top sheen + bottom shadow, clipped to the top slab, for the same
  // faint "beveled flagstone" feel the old shape pads had.
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.restore();
  tex.refresh();
}

// Build a texture for one shape. Every shape is round (see PAD_SHAPES above),
// so this just dispatches to the dedicated rounded-pad drawer.
function makePadShapeTexture(scene, shapeKey) {
  const key = `pad_${shapeKey}`;
  if (scene.textures.exists(key)) return;
  const shape = PAD_SHAPES[shapeKey];
  if (!shape) return;
  makeRoundPadTexture(scene, key);
}

function makeAllPadShapes(scene) {
  for (const k of Object.keys(PAD_SHAPES)) makePadShapeTexture(scene, k);
}
