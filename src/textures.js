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
    LITE:   mk(0xb9bcc2),   // lit battlement tops / merlon crowns
    BODY:   mk(0x8f9298),   // battlement + parapet stone
    FACE:   mk(0x7e8188),   // the tall extruded wall faces (and the turret column)
    SIDE:   mk(0x7a7d84),   // E/W side-wall crenel dashes
    SHADOW: mk(0x5a5d63),   // shadow lines / joints
    DARK:   mk(0x303134),   // grounding line + silhouette
  };
})();

// --- Biome texture registry ---
// Terrain class id → { variants, draw(ctx, size, rng) }. Each variant becomes
// a Phaser canvas texture keyed `biome${type}_${v}` via makeBiomeTextures.
const BIOME_TEX = {
  0:  { variants: 2, draw: drawGrassTex },        // grass: tufts (procedural — sheet-tiling was abandoned, see git history)
  1:  { variants: 2, draw: drawForestTex },       // forest: dense leaf litter
  2:  { variants: 2, draw: drawSandTex },         // sand: horizontal ripple marks
  3:  { variants: 2, draw: drawWaterTex },        // water: horizontal band highlights
  4:  { variants: 2, draw: drawFarmlandTex },     // farmland: muddy pasture + grass
  5:  { variants: 1, draw: drawResidentialTex },  // residential: concrete
  6:  { variants: 2, draw: drawParkTex },         // park: grass + flowers
  8:  { variants: 2, draw: drawPathTex },         // path: pebble grain
  9:  { variants: 1, draw: drawBuildingTex },     // building: cobbles
  11: { variants: 1, draw: drawWoodFloorTex },    // building_med: wooden plank floor
  12: { variants: 2, draw: drawCastleFloorTex },  // building_large / castle: subtle stone cobbles
  10: { variants: 2, draw: drawRockTex },         // rock: cracks
  // Subtype splits — each biome gets its own low-res texture so it reads
  // qualitatively different from the others (see src/biome_profiles.js for the
  // matching flora/fauna/tint profile).
  15: { variants: 2, draw: drawSchoolTex },       // SCHOOL — mown grass bands
  16: { variants: 2, draw: drawCommercialTex },   // COMMERCIAL — grey ceramic floor tile
  17: { variants: 1, draw: drawIndustrialTex },   // INDUSTRIAL — concrete + gravel
  18: { variants: 2, draw: drawPlaygroundTex },   // PLAYGROUND — bark mulch
  19: { variants: 2, draw: drawPitchTex },        // PITCH — mown stripes + chalk
  20: { variants: 2, draw: drawWetlandTex },      // WETLAND — marsh mottle + glints
  21: { variants: 2, draw: drawGolfTex },         // GOLF — fine fairway stripes
  22: { variants: 2, draw: drawOrchardTex },      // ORCHARD — dappled grass
  // PIER (type 23) — reuse the water ripple as base texture; render.js
  // overlays the wooden plank sprite on top via the cobblePool. Without
  // this entry the cell would fall back to bare colour with no ripple,
  // breaking visual continuity with adjacent WATER cells.
  23: { variants: 2, draw: drawWaterTex },
  // Underground cave biome
  24: { variants: 3, draw: drawCaveFloorTex }, // CAVE_FLOOR — packed grit + pebbles
  25: { variants: 3, draw: drawCaveWallTex  }, // CAVE_WALL  — packed boulder faces
};

// Tilled soil is per-cell state (not a terrain class).
const TILLED_COLOR = 0xc7973f;        // warm yellow-brown
const TILLED_VARIANTS = 2;

// Tiny deterministic RNG factory so each texture variant looks stable across reloads.
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
      ? 'rgba(25,70,25,0.35)'        // dark root speck
      : r < 0.55
      ? 'rgba(80,150,70,0.25)'       // mid-green speck
      : 'rgba(180,225,140,0.18)';    // soft highlight
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawForestTex(ctx, size, rng) {
  // Dense leaf-litter clumps — small dark blobs + a few bright leaf specks.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 14; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 1.5 + rng() * 1.5;
    ctx.fillStyle = 'rgba(0,30,0,0.35)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = 'rgba(160,210,130,0.25)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
}

function drawSandTex(ctx, size, rng) {
  // Horizontal wind-ripple marks on beach sand (3-4 wavy lines per tile).
  ctx.clearRect(0, 0, size, size);
  const numLines = 3 + Math.floor(rng() * 2);
  for (let r = 0; r < numLines; r++) {
    const baseY = Math.floor((r + 0.3 + rng() * 0.4) * (size / numLines));
    const amp = 0.7 + rng() * 0.9;
    const phase = rng() * Math.PI * 2;
    ctx.strokeStyle = rng() < 0.65 ? 'rgba(130,70,30,0.30)' : 'rgba(190,140,80,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= size; x++) {
      const y = baseY + Math.sin(x * 2 * Math.PI / (size * 0.65) + phase) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Scattered fine grain specks.
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(100,55,15,0.14)' : 'rgba(255,240,200,0.12)';
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
    const style = r < 0.5 ? 'rgba(70,120,55,0.30)'
                : r < 0.8 ? 'rgba(40,80,35,0.28)'
                          : 'rgba(150,190,110,0.22)';
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
    ctx.fillStyle = r < 0.5 ? 'rgba(70,120,55,0.30)'
                  : r < 0.8 ? 'rgba(40,80,35,0.28)'
                            : 'rgba(150,190,110,0.22)';
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
    const colors = ['rgba(255,180,200,0.7)', 'rgba(255,240,120,0.7)', 'rgba(220,180,255,0.7)'];
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawTilledTex(ctx, size, rng) {
  // Yellow-brown ploughed soil — clear horizontal furrows + grain.
  ctx.clearRect(0, 0, size, size);
  const rowH = 8;
  for (let y = 2; y < size; y += rowH) {
    ctx.fillStyle = 'rgba(60,35,10,0.55)';
    ctx.fillRect(0, y, size, 1);
    ctx.fillStyle = 'rgba(255,225,160,0.16)';
    ctx.fillRect(0, y + 3, size, 1);
  }
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.5
      ? 'rgba(70,45,15,0.35)'
      : 'rgba(255,220,150,0.22)';
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawWaterTex(ctx, size, rng) {
  // Horizontal highlight bands — top-down water with distinct cyan stripe pattern.
  ctx.clearRect(0, 0, size, size);
  const bandH = 2;
  const gap = 5 + Math.floor(rng() * 3);   // 5-7 px between bands
  const startY = Math.floor(rng() * gap);
  for (let y = startY; y < size; y += gap + bandH) {
    ctx.fillStyle = 'rgba(160,235,245,0.30)';  // cyan highlight band
    ctx.fillRect(0, y, size, Math.min(bandH, size - y));
    ctx.fillStyle = 'rgba(220,250,255,0.14)';  // bright leading edge
    ctx.fillRect(0, y, size, 1);
  }
  // Subtle dark depth specks.
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = 'rgba(0,20,50,0.18)';
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
    ctx.fillStyle = dark ? 'rgba(40,25,10,0.4)' : 'rgba(255,240,210,0.25)';
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
  ctx.strokeStyle = 'rgba(255,230,170,0.18)';
  for (let i = 0; i < 20; i++) {
    const y = rng() * size, x = rng() * size, len = 3 + rng() * 10;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  // Occasional knot.
  if (rng() < 0.5) {
    ctx.fillStyle = 'rgba(70,40,15,0.55)';
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
    ctx.fillStyle = (Math.floor(y / 8) % 2) ? 'rgba(255,255,255,0.07)' : 'rgba(0,40,0,0.07)';
    ctx.fillRect(0, y, size, 8);
  }
  if (rng() < 0.25) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(rng() < 0.5 ? 2 : size - 3, 0, 1, size);
  }
}

function drawGolfTex(ctx, size, rng) {
  // Fairway — fine vertical mowing stripes on bright turf.
  drawGrassTex(ctx, size, rng);
  for (let x = 0; x < size; x += 4) {
    ctx.fillStyle = (Math.floor(x / 4) % 2) ? 'rgba(255,255,255,0.05)' : 'rgba(0,40,0,0.04)';
    ctx.fillRect(x, 0, 4, size);
  }
}

function drawPlaygroundTex(ctx, size, rng) {
  // Bark / rubber mulch — warm brown chips, no green.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
    const r = rng();
    ctx.fillStyle = r < 0.5 ? 'rgba(110,70,30,0.30)'
                  : r < 0.8 ? 'rgba(150,100,50,0.25)'
                            : 'rgba(80,50,20,0.30)';
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

function drawWetlandTex(ctx, size, rng) {
  // Marsh — dark mossy mottle, faint water glints, a few vertical reed flecks.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = 'rgba(20,45,25,0.30)';
    ctx.beginPath(); ctx.arc(rng() * size, rng() * size, 1.5 + rng() * 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(150,200,210,0.20)';
  ctx.lineWidth = 1;
  for (let r = 0; r < 2; r++) {
    const baseY = rng() * size, phase = rng() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x <= size; x++) {
      const y = baseY + Math.sin((x / size) * Math.PI * 2 + phase) * 1;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(90,130,70,0.30)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 2 + Math.floor(rng() * 2));
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
function makeTowerTexture(scene) {
  const KEY = 'tower';
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
  const OUTLINE     = CASTLE_STONE.DARK.s;
  const wallColor   = CASTLE_STONE.FACE.s;
  const battleColor = CASTLE_STONE.BODY.s;

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
  ctx.fillStyle = CASTLE_STONE.BODY.s;                 // lit edge = the wall's crest stone
  ctx.fillRect(bodyX + 1, bodyTop, 1, bodyBot - bodyTop);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = CASTLE_STONE.SHADOW.s;
  ctx.fillRect(bodyX + bodyW - 2, bodyTop, 1, bodyBot - bodyTop);
  ctx.globalAlpha = 1;
  // Corbel shadow: the slab overhangs, so the top of the column sits in its
  // shade. Without this the overhang read as a hat balanced on a stick.
  ctx.fillStyle = CASTLE_STONE.SHADOW.s;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(bodyX + 1, bodyTop, bodyW - 2, 2);
  ctx.globalAlpha = 1;
  // Stone-block joints, inset 1px from each side so they stop at the outline.
  // The wall's own SHADOW tone rather than a black wash: black pulls the
  // blue-grey stone toward neutral, so joints drawn that way read as a
  // different rock from the rampart's.
  ctx.fillStyle = CASTLE_STONE.SHADOW.s;
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
  ctx.fillStyle = CASTLE_STONE.SHADOW.s;
  ctx.fillRect(bodyX + 1, bodyBot - 5, bodyW - 2, 5);
  ctx.globalAlpha = 1;
  // Arrow slit — a dark 2px slot with a lit sill under it so it reads as an
  // opening cut INTO the wall rather than a painted-on smudge. Sits one row
  // BELOW the first joint course: starting flush on a joint made the slit look
  // like a crack running out of the masonry line.
  const slitX = (W >> 1) - 1, slitY = bodyTop + 8;
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(slitX, slitY, 2, 5);
  ctx.fillStyle = CASTLE_STONE.LITE.s;
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
  ctx.fillStyle = CASTLE_STONE.SHADOW.s;
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
  ctx.fillStyle = CASTLE_STONE.LITE.s;
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

  // ── Gold pile overflowing the mouth ─────────────────────────────────
  const gold = '#ffcf3a', goldHi = '#ffe98a', goldLo = '#e0a020';
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

function makeBiomeTextures(scene, size) {
  for (const [type, spec] of Object.entries(BIOME_TEX)) {
    for (let v = 0; v < spec.variants; v++) {
      const key = `biome${type}_${v}`;
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.createCanvas(key, size, size);
      const ctx = tex.getContext();
      spec.draw(ctx, size, seededRand((Number(type) + 1) * 1000 + v + 1));
      tex.refresh();
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
function makeRoundPadTexture(scene, key) {
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
  // Both stone tones sit HALFWAY between their old grey and white (#8d -> #c6,
  // #b2 -> #d8), so the pad reads as pale stone rather than a grey disc — it
  // still separates the POI from the terrain, but no longer as a dark blot.
  // Side face first: the same rounded rect shifted down by `depth`.
  roundRectPath(ctx, x, y + depth, w, h, radius);
  ctx.fillStyle = '#c6c6c6';
  ctx.fill();
  // Top slab.
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = '#d8d8d8';
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

// Build a texture for one shape. Round shapes get the dedicated rounded pad;
// any (legacy) multi-cell shape is drawn cell-by-cell with only its outer
// perimeter stroked.
function makePadShapeTexture(scene, shapeKey) {
  const key = `pad_${shapeKey}`;
  if (scene.textures.exists(key)) return;
  const shape = PAD_SHAPES[shapeKey];
  if (!shape) return;
  if (shape.round) { makeRoundPadTexture(scene, key); return; }
  const W = shape.cols * PAD_CELL, H = shape.rows * PAD_CELL;
  const tex = scene.textures.createCanvas(key, W, H);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, W, H);
  const occ = new Set(shape.cells.map(c => `${c[0]},${c[1]}`));
  // Body fill — slightly mottled by overlaying a darker bottom band.
  ctx.fillStyle = '#b2b2b2';
  for (const [c, r] of shape.cells) ctx.fillRect(c * PAD_CELL, r * PAD_CELL, PAD_CELL, PAD_CELL);
  // Per-cell subtle shading: a light top edge + dark bottom edge gives the
  // slabs a faint "beveled flagstone" feel without losing the unified outline.
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (const [c, r] of shape.cells) ctx.fillRect(c * PAD_CELL, r * PAD_CELL, PAD_CELL, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (const [c, r] of shape.cells) ctx.fillRect(c * PAD_CELL, r * PAD_CELL + PAD_CELL - 2, PAD_CELL, 2);
  // Faint grout lines between adjacent cells so you can read the tile count.
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [c, r] of shape.cells) {
    const x0 = c * PAD_CELL, y0 = r * PAD_CELL;
    if (occ.has(`${c + 1},${r}`)) { ctx.moveTo(x0 + PAD_CELL, y0 + 1); ctx.lineTo(x0 + PAD_CELL, y0 + PAD_CELL - 1); }
    if (occ.has(`${c},${r + 1}`)) { ctx.moveTo(x0 + 1, y0 + PAD_CELL); ctx.lineTo(x0 + PAD_CELL - 1, y0 + PAD_CELL); }
  }
  ctx.stroke();
  // Outer perimeter outline — lighter than the body and rounded at outer corners.
  // Each outside-facing edge is drawn as a shortened segment (leaving a corner gap)
  // with a small quarter-arc joining adjacent edges at each convex corner cell.
  // Cells where the corner is concave (e.g. inside angle of the cross) keep their
  // straight intersection.
  const RADIUS = 5;                      // corner radius in px (PAD_CELL is typically ~16)
  ctx.strokeStyle = '#c2c2c2';           // lighter than the previous '#6e6e6e'
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const r = Math.min(RADIUS, PAD_CELL / 2 - 1);
  for (const [c, ro] of shape.cells) {
    const x0 = c * PAD_CELL, y0 = ro * PAD_CELL;
    const N = !occ.has(`${c},${ro - 1}`);
    const E = !occ.has(`${c + 1},${ro}`);
    const S = !occ.has(`${c},${ro + 1}`);
    const W = !occ.has(`${c - 1},${ro}`);
    ctx.beginPath();
    // Top edge — trimmed by the corner radius on each outside-corner side.
    if (N) {
      const xL = x0 + (W ? r : 0), xR = x0 + PAD_CELL - (E ? r : 0);
      ctx.moveTo(xL, y0); ctx.lineTo(xR, y0);
    }
    if (E) {
      const yT = y0 + (N ? r : 0), yB = y0 + PAD_CELL - (S ? r : 0);
      ctx.moveTo(x0 + PAD_CELL, yT); ctx.lineTo(x0 + PAD_CELL, yB);
    }
    if (S) {
      const xL = x0 + (W ? r : 0), xR = x0 + PAD_CELL - (E ? r : 0);
      ctx.moveTo(xL, y0 + PAD_CELL); ctx.lineTo(xR, y0 + PAD_CELL);
    }
    if (W) {
      const yT = y0 + (N ? r : 0), yB = y0 + PAD_CELL - (S ? r : 0);
      ctx.moveTo(x0, yT); ctx.lineTo(x0, yB);
    }
    // Convex corner arcs (both adjacent edges are outside-facing).
    if (N && E) { ctx.moveTo(x0 + PAD_CELL - r, y0); ctx.arcTo(x0 + PAD_CELL, y0, x0 + PAD_CELL, y0 + r, r); }
    if (E && S) { ctx.moveTo(x0 + PAD_CELL, y0 + PAD_CELL - r); ctx.arcTo(x0 + PAD_CELL, y0 + PAD_CELL, x0 + PAD_CELL - r, y0 + PAD_CELL, r); }
    if (S && W) { ctx.moveTo(x0 + r, y0 + PAD_CELL); ctx.arcTo(x0, y0 + PAD_CELL, x0, y0 + PAD_CELL - r, r); }
    if (W && N) { ctx.moveTo(x0, y0 + r); ctx.arcTo(x0, y0, x0 + r, y0, r); }
    ctx.stroke();
  }
  tex.refresh();
}

function makeAllPadShapes(scene) {
  for (const k of Object.keys(PAD_SHAPES)) makePadShapeTexture(scene, k);
}
