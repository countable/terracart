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

// === POI decoration "statues" ===
// Greyscale stone sculptures placed next to chests. All 16x16, transparent bg.
const STONE_HI = '#c8c8c8', STONE_MID = '#9a9a9a', STONE_DK = '#6a6a6a', STONE_SH = '#3a3a3a';
const STONE_BASE = '#5a5a5a';

function drawPlinth(ctx, y = 14) {
  ctx.fillStyle = STONE_SH; ctx.fillRect(3, y + 1, 10, 1);
  ctx.fillStyle = STONE_DK; ctx.fillRect(3, y, 10, 1);
  ctx.fillStyle = STONE_MID; ctx.fillRect(4, y - 1, 8, 1);
}

function drawSignpostStatue(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(7, 4, 2, 10);
  ctx.fillStyle = STONE_MID; ctx.fillRect(7, 4, 1, 10);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(7, 4, 1, 2);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(2, 5, 8, 3);
  ctx.fillStyle = STONE_MID; ctx.fillRect(2, 5, 8, 1);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(3, 5, 1, 1);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(5, 9, 8, 3);
  ctx.fillStyle = STONE_MID; ctx.fillRect(5, 9, 8, 1);
  drawPlinth(ctx);
}

function drawChapelStatue(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = STONE_MID; ctx.fillRect(4, 8, 8, 6);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(4, 8, 1, 6);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(11, 8, 1, 6);
  ctx.fillStyle = STONE_SH;  ctx.fillRect(7, 11, 2, 3);
  ctx.fillStyle = STONE_DK;
  ctx.fillRect(3, 7, 10, 1);
  ctx.fillRect(4, 6, 8, 1);
  ctx.fillRect(5, 5, 6, 1);
  ctx.fillRect(6, 4, 4, 1);
  ctx.fillRect(7, 3, 2, 1);
  ctx.fillStyle = STONE_MID;
  ctx.fillRect(4, 6, 8, 1);
  ctx.fillRect(5, 5, 4, 1);
  ctx.fillStyle = STONE_HI; ctx.fillRect(7, 0, 2, 3); ctx.fillRect(6, 1, 4, 1);
  drawPlinth(ctx);
}

function drawBookStatue(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(7, 10, 2, 4);
  ctx.fillStyle = STONE_MID; ctx.fillRect(7, 10, 1, 4);
  ctx.fillStyle = STONE_MID; ctx.fillRect(2, 6, 6, 4); ctx.fillRect(8, 6, 6, 4);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(2, 6, 6, 1); ctx.fillRect(8, 6, 6, 1);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(7, 6, 2, 4);
  ctx.fillStyle = STONE_SH;
  ctx.fillRect(3, 7, 4, 1); ctx.fillRect(3, 9, 3, 1);
  ctx.fillRect(9, 7, 4, 1); ctx.fillRect(9, 9, 3, 1);
  drawPlinth(ctx);
}

function drawStockpotStatue(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(3, 7, 10, 6);
  ctx.fillStyle = STONE_MID; ctx.fillRect(3, 7, 10, 1);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(4, 8, 1, 4);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(2, 6, 12, 1);
  ctx.fillStyle = STONE_MID; ctx.fillRect(2, 5, 12, 1);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(1, 8, 1, 2); ctx.fillRect(14, 8, 1, 2);
  ctx.fillStyle = STONE_MID;
  ctx.fillRect(7, 3, 1, 1); ctx.fillRect(8, 2, 1, 1); ctx.fillRect(6, 2, 1, 1);
  drawPlinth(ctx);
}

function drawPotionStatue(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = STONE_DK;
  ctx.fillRect(4, 7, 8, 6);
  ctx.fillRect(5, 6, 6, 1); ctx.fillRect(5, 13, 6, 1);
  ctx.fillStyle = STONE_MID;
  ctx.fillRect(4, 7, 1, 5); ctx.fillRect(5, 6, 5, 1);
  ctx.fillStyle = STONE_HI;
  ctx.fillRect(5, 7, 1, 3);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(7, 4, 2, 3);
  ctx.fillStyle = STONE_MID; ctx.fillRect(7, 4, 1, 3);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(6, 2, 4, 2);
  ctx.fillStyle = STONE_MID; ctx.fillRect(6, 3, 4, 1);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(7, 0, 2, 1);
  drawPlinth(ctx);
}

function drawWheatSheafStatue(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = STONE_DK;
  ctx.fillRect(4, 9, 1, 5); ctx.fillRect(6, 8, 1, 6); ctx.fillRect(8, 8, 1, 6);
  ctx.fillRect(10, 9, 1, 5); ctx.fillRect(12, 10, 1, 4);
  ctx.fillStyle = STONE_MID;
  ctx.fillRect(6, 8, 1, 1); ctx.fillRect(8, 8, 1, 1);
  ctx.fillStyle = STONE_HI;
  ctx.fillRect(4, 7, 1, 2); ctx.fillRect(6, 6, 1, 2);
  ctx.fillRect(8, 6, 1, 2); ctx.fillRect(10, 7, 1, 2); ctx.fillRect(12, 8, 1, 2);
  ctx.fillStyle = STONE_SH;  ctx.fillRect(4, 12, 9, 1);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(4, 11, 9, 1);
  drawPlinth(ctx);
}

function drawBouquetStatue(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(7, 9, 1, 5); ctx.fillRect(8, 9, 1, 5);
  ctx.fillStyle = STONE_MID; ctx.fillRect(5, 12, 6, 2);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(5, 12, 6, 1);
  ctx.fillStyle = STONE_DK;
  ctx.fillRect(4, 6, 2, 2); ctx.fillRect(7, 4, 2, 2);
  ctx.fillRect(10, 6, 2, 2); ctx.fillRect(6, 7, 2, 2); ctx.fillRect(9, 8, 2, 2);
  ctx.fillStyle = STONE_HI;
  ctx.fillRect(4, 6, 1, 1); ctx.fillRect(7, 4, 1, 1);
  ctx.fillRect(10, 6, 1, 1); ctx.fillRect(6, 7, 1, 1); ctx.fillRect(9, 8, 1, 1);
  drawPlinth(ctx);
}

function drawMarketStallStatue(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(2, 5, 1, 9); ctx.fillRect(13, 5, 1, 9);
  for (let x = 2; x < 14; x++) {
    ctx.fillStyle = (x % 2) ? STONE_MID : STONE_HI;
    ctx.fillRect(x, 3, 1, 2);
  }
  ctx.fillStyle = STONE_DK;  ctx.fillRect(2, 10, 12, 2);
  ctx.fillStyle = STONE_MID; ctx.fillRect(2, 10, 12, 1);
  ctx.fillStyle = STONE_MID; ctx.fillRect(3, 7, 3, 3);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(3, 7, 1, 3);
  ctx.fillStyle = STONE_DK;
  ctx.fillRect(8, 8, 2, 2); ctx.fillRect(11, 8, 2, 2);
  ctx.fillStyle = STONE_HI;
  ctx.fillRect(8, 8, 1, 1); ctx.fillRect(11, 8, 1, 1);
  drawPlinth(ctx);
}

function drawFlowerTuftStatue(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(7, 8, 2, 6);
  ctx.fillStyle = STONE_MID; ctx.fillRect(7, 8, 1, 6);
  ctx.fillStyle = STONE_DK;  ctx.fillRect(5, 4, 6, 4);
  ctx.fillStyle = STONE_MID; ctx.fillRect(5, 4, 6, 1); ctx.fillRect(5, 4, 1, 4);
  ctx.fillStyle = STONE_HI;  ctx.fillRect(6, 5, 2, 2);
  drawPlinth(ctx);
}

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

// === POI concrete pad ===
// Build a 96×96 (3×3 game-cells, 32px each) "concrete slab" texture: rounded-
// rect grey base with a gentle darker outline, and the chosen statue embossed
// on each of the 9 cells at 20% alpha. Drawn under POI chests.
// Pass statueKey = null for a plain pad (no statue).
function makePadTexture(scene, padKey, statueKey) {
  if (scene.textures.exists(padKey)) return;
  const W = 96;
  const tex = scene.textures.createCanvas(padKey, W, W);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, W, W);
  // Rounded-rect slab (2px inset so the stroke isn't clipped).
  const m = 2, r = 8;
  ctx.beginPath();
  ctx.moveTo(m + r, m);
  ctx.lineTo(W - m - r, m);
  ctx.quadraticCurveTo(W - m, m, W - m, m + r);
  ctx.lineTo(W - m, W - m - r);
  ctx.quadraticCurveTo(W - m, W - m, W - m - r, W - m);
  ctx.lineTo(m + r, W - m);
  ctx.quadraticCurveTo(m, W - m, m, W - m - r);
  ctx.lineTo(m, m + r);
  ctx.quadraticCurveTo(m, m, m + r, m);
  ctx.closePath();
  ctx.fillStyle = '#b2b2b2';
  ctx.fill();
  ctx.strokeStyle = '#7a7a7a';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Emboss statue on each 32×32 cell at 20% alpha.
  if (statueKey && scene.textures.exists(statueKey)) {
    const src = scene.textures.get(statueKey).getSourceImage();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.20;
    const cellPx = 32, inset = 4;
    for (let r2 = 0; r2 < 3; r2++) {
      for (let c2 = 0; c2 < 3; c2++) {
        ctx.drawImage(src,
          c2 * cellPx + inset, r2 * cellPx + inset,
          cellPx - inset * 2, cellPx - inset * 2);
      }
    }
    ctx.globalAlpha = 1;
  }
  tex.refresh();
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
  // Outer perimeter outline (darker, slightly thicker).
  ctx.strokeStyle = '#6e6e6e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [c, r] of shape.cells) {
    const x0 = c * PAD_CELL, y0 = r * PAD_CELL;
    if (!occ.has(`${c},${r - 1}`)) { ctx.moveTo(x0, y0);                ctx.lineTo(x0 + PAD_CELL, y0); }
    if (!occ.has(`${c + 1},${r}`)) { ctx.moveTo(x0 + PAD_CELL, y0);      ctx.lineTo(x0 + PAD_CELL, y0 + PAD_CELL); }
    if (!occ.has(`${c},${r + 1}`)) { ctx.moveTo(x0, y0 + PAD_CELL);      ctx.lineTo(x0 + PAD_CELL, y0 + PAD_CELL); }
    if (!occ.has(`${c - 1},${r}`)) { ctx.moveTo(x0, y0);                ctx.lineTo(x0, y0 + PAD_CELL); }
  }
  ctx.stroke();
  tex.refresh();
}

function makeAllPadShapes(scene) {
  for (const k of Object.keys(PAD_SHAPES)) makePadShapeTexture(scene, k);
}
