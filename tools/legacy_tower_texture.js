// Historical castle painter for before/after art-review exports only.
// Loaded by export_map_art_painters.js after src/textures.js.

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
// Retained for legacy art-review tools only; gameplay preloads the generated
// restored/wreck pair from ASSETS instead of drawing either texture here.
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

