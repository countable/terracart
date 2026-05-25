// Procedural textures + POI statue sprites + flora decals.
// Extracted from app.js for maintainability. Loaded BEFORE app.js so all
// names (BIOME_TEX, draw* fns, makeBiomeTextures, makeFloraTextures, …) are
// available as plain globals.
//
// Depends on:
//   nothing external. Pure draws-to-canvas — no Phaser scene work other than
//   makeBiomeTextures/makeFloraTextures which take the scene as a parameter.
//
// Does NOT include makePlaqueTextures: it depends on per-crop globals
// (CROP_ROW, PRODUCE_COL) that still live in app.js.

// --- Biome texture registry ---
// Terrain class id → { variants, draw(ctx, size, rng) }. Each variant becomes
// a Phaser canvas texture keyed `biome${type}_${v}` via makeBiomeTextures.
const BIOME_TEX = {
  0:  { variants: 2, draw: drawGrassTex },        // grass: tufts
  1:  { variants: 2, draw: drawForestTex },       // forest: dense leaf litter
  2:  { variants: 2, draw: drawSandTex },         // sand: fine grain
  3:  { variants: 2, draw: drawWaterTex },        // water: ripples
  4:  { variants: 1, draw: drawFarmlandTex },     // farmland: tidy furrows
  5:  { variants: 1, draw: drawResidentialTex },  // residential: concrete
  6:  { variants: 2, draw: drawParkTex },         // park: grass + flowers
  8:  { variants: 2, draw: drawPathTex },         // path: pebble grain
  9:  { variants: 1, draw: drawBuildingTex },     // building: cobbles
  10: { variants: 2, draw: drawRockTex },         // rock: cracks
  // Grassland subtype splits — reuse the grass blade texture so they all read as grassy.
  15: { variants: 2, draw: drawGrassTex },        // SCHOOL
  18: { variants: 2, draw: drawGrassTex },        // PLAYGROUND
  19: { variants: 2, draw: drawGrassTex },        // PITCH
  21: { variants: 2, draw: drawGrassTex },        // GOLF
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
  // Very fine grain — many low-alpha dots, mostly warm.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 36; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.6
      ? 'rgba(120,90,40,0.18)'
      : 'rgba(255,240,200,0.18)';
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawFarmlandTex(ctx, size, rng) {
  // Tidy parallel furrow rows — horizontal alternating shade bands.
  ctx.clearRect(0, 0, size, size);
  const rowH = 4;
  for (let y = 0; y < size; y += rowH) {
    ctx.fillStyle = 'rgba(60,35,10,0.22)';
    ctx.fillRect(0, y, size, 1);
    ctx.fillStyle = 'rgba(255,230,180,0.10)';
    ctx.fillRect(0, y + 1, size, 1);
  }
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
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
  // Faint horizontal ripple highlights on transparent bg.
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const baseY = (r + 0.5) * (size / rows) + (rng() - 0.5) * 2;
    const amp = 0.8 + rng() * 0.6;
    const phase = rng() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x <= size; x++) {
      const y = baseY + Math.sin((x / size) * Math.PI * 2 + phase) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,40,0.18)';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
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

// Procedurally drawn long-grass sprite (16x16, transparent background).
function drawLongGrassTex(ctx, size, rng) {
  ctx.clearRect(0, 0, size, size);
  const cy = size - 1;
  const blades = 6 + Math.floor(rng() * 3);
  for (let i = 0; i < blades; i++) {
    const baseX = 2 + Math.floor(rng() * (size - 4));
    const h = 6 + Math.floor(rng() * 6);
    const lean = (rng() - 0.5) * 3;
    const shade = 90 + Math.floor(rng() * 60);
    ctx.strokeStyle = `rgb(${Math.floor(shade * 0.4)},${shade + 30},${Math.floor(shade * 0.45)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(baseX + 0.5, cy + 0.5);
    ctx.quadraticCurveTo(baseX + lean * 0.5, cy - h * 0.5, baseX + lean, cy - h);
    ctx.stroke();
  }
  ctx.fillStyle = '#d8c873';
  for (let i = 0; i < 2; i++) {
    const x = 3 + Math.floor(rng() * (size - 6));
    const y = 2 + Math.floor(rng() * 4);
    ctx.fillRect(x, y, 1, 1);
  }
}

// (Previous greyscale "statue" sprites + plinth helper were superseded by the
// shape-based concrete pads below — they're no longer drawn anywhere.)

// === Procedural decorative flora ===
// Tiny non-interactable sprites drawn on transparent 16×16 canvases.
function drawFlora(ctx, kind, variant) {
  ctx.clearRect(0, 0, 16, 16);
  if (kind === 'flower') {
    // Color per polygon (not per cell). Saturated primaries so a field of flowers
    // reads as a single distinct color.
    const palettes = [
      { petal: '#ffe14a', center: '#c25400' },   // yellow
      { petal: '#e23a3a', center: '#ffe46b' },   // red
      { petal: '#4a82ff', center: '#ffe46b' },   // blue
      { petal: '#b15cff', center: '#ffe46b' },   // purple
    ];
    const p = palettes[variant % palettes.length];
    ctx.fillStyle = '#2e5a2e';
    ctx.fillRect(8, 9, 1, 5);
    ctx.fillStyle = p.petal;
    ctx.fillRect(7, 5, 3, 2);
    ctx.fillRect(7, 8, 3, 2);
    ctx.fillRect(5, 6, 2, 3);
    ctx.fillRect(10, 6, 2, 3);
    ctx.fillStyle = p.center;
    ctx.fillRect(8, 7, 1, 1);
  } else if (kind === 'pebble') {
    const sets = [
      [[7,9,2,2],[10,11,2,1]],
      [[6,10,3,2],[10,10,1,2],[11,11,1,1]],
      [[8,11,2,1],[6,12,2,1]],
    ];
    const set = sets[variant % sets.length];
    for (const [x, y, w, h] of set) {
      ctx.fillStyle = '#000a';
      ctx.fillRect(x, y + 1, w, 1);
      ctx.fillStyle = '#7d736b';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#bcb5a7';
      ctx.fillRect(x, y, w, 1);
    }
  } else if (kind === 'mushroom') {
    const big = variant === 0;
    const cx = 8, cy = big ? 9 : 10;
    ctx.fillStyle = '#f5e8c6';
    ctx.fillRect(cx, cy, big ? 2 : 1, big ? 3 : 2);
    ctx.fillStyle = '#b8242c';
    if (big) {
      ctx.fillRect(cx - 2, cy - 2, 5, 2);
      ctx.fillRect(cx - 1, cy - 3, 3, 1);
    } else {
      ctx.fillRect(cx - 1, cy - 1, 3, 1);
      ctx.fillRect(cx, cy - 2, 1, 1);
    }
    ctx.fillStyle = '#fff';
    if (big) { ctx.fillRect(cx - 1, cy - 2, 1, 1); ctx.fillRect(cx + 1, cy - 1, 1, 1); }
    else { ctx.fillRect(cx, cy - 1, 1, 1); }
  }
}

function makeFloraTextures(scene) {
  const SPECS = { flower: 4 };
  for (const [kind, n] of Object.entries(SPECS)) {
    for (let v = 0; v < n; v++) {
      const key = `flora_${kind}_${v}`;
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.createCanvas(key, 16, 16);
      drawFlora(tex.getContext(), kind, v);
      tex.refresh();
    }
  }
}

// Simple procedural castle turret — narrow stone column with crenellated top.
// One 24×40 canvas, anchor at bottom-centre so it sits on its cell.
function makeTowerTexture(scene) {
  const KEY = 'tower';
  if (scene.textures.exists(KEY)) return;
  const W = 24, H = 40;
  const tex = scene.textures.createCanvas(KEY, W, H);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, W, H);
  // Body
  const bodyX = 4, bodyW = W - 8;
  const bodyTop = 10, bodyBot = H - 2;
  ctx.fillStyle = '#8e8e96';
  ctx.fillRect(bodyX, bodyTop, bodyW, bodyBot - bodyTop);
  // Vertical highlight + shadow stripes
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(bodyX + 1, bodyTop, 2, bodyBot - bodyTop);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(bodyX + bodyW - 3, bodyTop, 2, bodyBot - bodyTop);
  // Stone-block joints (a few horizontal nicks)
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (let y = bodyTop + 6; y < bodyBot - 2; y += 7) {
    ctx.fillRect(bodyX, y, bodyW, 1);
  }
  // Arrow-slit window
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(W / 2 - 1, bodyTop + 8, 2, 6);
  // Battlement slab (wider than body)
  const battTop = bodyTop - 6;
  const battH = 6;
  const battX = bodyX - 2, battW = bodyW + 4;
  ctx.fillStyle = '#9a9aa2';
  ctx.fillRect(battX, battTop, battW, battH);
  // Crenellations — three merlons across the top
  ctx.fillStyle = '#9a9aa2';
  const merlonW = 4, merlonH = 4;
  for (let i = 0; i < 3; i++) {
    const mx = battX + 1 + i * (merlonW + 2);
    ctx.fillRect(mx, battTop - merlonH, merlonW, merlonH);
  }
  // Dark outline around everything (battlement + body + merlons)
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  // Body sides
  ctx.strokeRect(bodyX + 0.5, bodyTop + 0.5, bodyW - 1, bodyBot - bodyTop - 1);
  // Battlement slab
  ctx.strokeRect(battX + 0.5, battTop + 0.5, battW - 1, battH - 1);
  // Merlons
  for (let i = 0; i < 3; i++) {
    const mx = battX + 1 + i * (merlonW + 2);
    ctx.strokeRect(mx + 0.5, battTop - merlonH + 0.5, merlonW - 1, merlonH - 1);
  }
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

// === Shape-based concrete pads ===
// PAD_SHAPES define occupancy on a cell grid + the chest's cell. Each shape
// becomes one texture keyed `pad_<shape>`. Cells are CELL_PX (32 px) and the
// outline only strokes the OUTER boundary of the shape (edges not shared with
// another cell), so an L / + / triangle reads as one continuous slab.
//
// Coordinate convention: [col, row] with col=x, row=y. (0,0) = top-left.
const PAD_CELL = 32;
const PAD_SHAPES = {
  // 3x3 square, chest centered. Used as the default for park/food/farm/etc.
  square3: {
    cells: [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]],
    chest: [1, 1],
  },
  // 2x2 square, chest in TOP-LEFT corner. Used for pitches/sports fields.
  square2: {
    cells: [[0,0],[1,0],[0,1],[1,1]],
    chest: [0, 0],
  },
  // Greek cross (+ shape), chest centered. Used for chapels and medical.
  cross: {
    cells:        [[1,0],[0,1],[1,1],[2,1],[1,2]],
    chest: [1, 1],
  },
  // Stepped triangle, 5 wide × 3 tall, point on top. Chest in middle row centre.
  //   .  .  O  .  .
  //   .  O  O  O  .
  //   O  O  O  O  O
  triangle: {
    cells: [           [2,0],
                  [1,1],[2,1],[3,1],
            [0,2],[1,2],[2,2],[3,2],[4,2]],
    chest: [2, 1],
  },
  // 1×3 horizontal strip, chest centered. Used for food / commerce — reads
  // as a market counter / shop frontage.
  line3h: {
    cells: [[0,0],[1,0],[2,0]],
    chest: [1, 0],
  },
  // 1×3 vertical strip, chest centered. Used for playgrounds.
  line3v: {
    cells: [[0,0],[0,1],[0,2]],
    chest: [0, 1],
  },
};
// Pre-compute bounding box for each shape (cols × rows).
for (const s of Object.values(PAD_SHAPES)) {
  s.cols = Math.max(...s.cells.map(c => c[0])) + 1;
  s.rows = Math.max(...s.cells.map(c => c[1])) + 1;
}

// Build a texture for one shape. Each cell is PAD_CELL × PAD_CELL pixels;
// the texture's full bounds are cols×rows cells. Only the outer perimeter
// is stroked.
function makePadShapeTexture(scene, shapeKey) {
  const key = `pad_${shapeKey}`;
  if (scene.textures.exists(key)) return;
  const shape = PAD_SHAPES[shapeKey];
  if (!shape) return;
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
