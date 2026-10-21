// Original OSM building geometry overlay — POLYGONAL footprints.
//
// Buildings reach the player as CELLS: worldgen assigns each `building`
// polygon an exclusive set of grid cells (assignBuildingFootprints) and paints
// them in the tier's colour, and render.js draws the silhouette from those
// cells — a south-facing extrusion and an outline along every cell edge whose
// neighbour isn't the same building. That rasterization is lossy in a way you
// can see from the street: a house at 30° to the grid squares off into a
// staircase, an L-shaped block loses its notch, a bay or a porch smaller than
// a cell disappears, and two buildings that abut weld into one span of tier
// colour separated only by a seam.
//
// This layer draws the SOURCE rings instead — `entry.buildingShapes`, the
// polygons worldgen kept from the decoded MVT (tile-local metres, carrying the
// tier the distribution pass settled on and the ownerKey the footprint was
// stamped with). Same idea as road_overlay.js, one dimension up: the roads
// overlay strokes the raw linework the rasterizer turned into road cells; this
// one FILLS the raw rings it turned into building cells.
//
// It is a REPLACEMENT, not a decoration. While it's on (BuildingOverlay
// .enabled()), render.js paints building cells as the ground around them — the
// same neighbour-zone colour and texture a road cell inherits — and skips the
// tiled floor, extrusion, outline, palisade and rampart passes entirely, so
// what you see IS the polygon. Flip it off (`__POLY_BUILDINGS = false`, or
// BuildingOverlay.setEnabled(scene, false) from the console) and the tiled art
// comes straight back — that A/B is the whole point of the layer.
//
// What the polygon draws, tier for tier:
//   • small houses use raised walls, recessed windows and a tiled roof with
//     clipped contour eaves that follow concave footprints (canvas renderer);
//   • the floor, in the tier's colour, carrying the tier's own biome texture
//     (house cobbles / fort planks / castle paving) so the material reads;
//   • a south-facing wall: the ring filled again, shifted down by the tier's
//     face depth, UNDER the floor — one fill that lands a wall on exactly the
//     south-facing edges of any polygon, however it's shaped;
//   • a 1px silhouette outline;
//   • a castle's rampart, as a stone band running INSIDE the ring with the
//     merlon rhythm dashed along it;
//   • and the unclaimed shade — the same transform textures.js bakes the
//     unclaimed castle palette with, applied to the colours rather than washed
//     over the top, so two overlapping footprints can't wash one twice — then
//     the unclaimed MATERIAL lift (textures.js unclaimedMaterialColor), applied
//     to the same colours. Tuning colours reads no pixels back (a per-building
//     canvas read-back was the walking stutter on phones).
//
// A DILAPIDATED footprint (unclaimed — the wreck you can still restore) also
// grows dark green slime splotches across its floor (see the slime block
// below): seeded from the building's own identity so they don't crawl as you
// walk, scattered inside the ring rather than its bounding box, and coloured
// by running the unclaimed shade over the floor twice more.
//
// Floors share the cached ground canvas. Wall faces and castle ramparts use
// retained prisms in heading-up mode, or cached atlas pieces in north-up mode,
// in a background container immediately above the floors.
// Every interactable and character draws above both layers.
//
// Depends on:
//   scene fields (read-only): buildingGeomGfx, buildingGeomContainer,
//     startWorldM, playerM, cellM, cellsPerTile / cellsForRow (coords.js), depth, textures,
//     viewCenterX/Y, viewLeft, viewTop, viewSize
//     helpers: playerToWorldCell(), isClaimedKey()
//   worldgen.js — WorldGen.tileCache, WorldGen.tileKey, WorldGen.makeRng;
//                 per-tile `entry.buildingShapes` + `entry.tileEdgeM`
//   coords.js   — overlayFrame / overlayProjection / timedOverlayRebuild (the
//                 camera-anchored draw frame both geometry overlays share)
//   biome_profiles.js — BiomeProfiles.mixHex (the one colour lerp)
//   render.js   — Render.BUILDING_FACE_COLOR / BUILDING_FACE_PX (the tiled
//                 pass's own wall colours + depths, so the two can't drift)
//   castle_styles.js — castle tower, wall and courtyard materials
//   textures.js — unclaimedShade,
//                 unclaimedMaterialColor
//   app.js consts — COLORS, CELL_PX
//
// Exports as globals:
//   BuildingOverlay.draw(scene)       — per-frame entry point (cheap when cached)
//   BuildingOverlay.enabled()         — is the polygonal mode on?
//   BuildingOverlay.setEnabled(scene, on) — flip the mode (forces a rebuild)
(function (global) {
  const CASTLE = 12;   // BUILDING_LARGE — the one tier that draws a rampart

  // Floor colours come from app.js's terrain palette, the table the tiled
  // floor fill reads, so a polygon and the cells under it match. The
  // fallbacks are for the headless suite, where app.js isn't loaded.
  const FLOOR_FALLBACK = { 9: 0xae685d, 11: 0xaa9577, 12: 0x919395 };
  const floorColor = (tier, claimed = true) =>
    (!claimed && typeof UNCLAIMED_BUILDING_BASE !== 'undefined') ? UNCLAIMED_BUILDING_BASE.floors[tier]
      : (typeof COLORS !== 'undefined' && COLORS[tier] != null) ? COLORS[tier]
      : (FLOOR_FALLBACK[tier] ?? 0xae685d);

  // Wall face + depth: render.js's SOUTH_FACE_COLOR / SOUTH_FACE_PX via Render,
  // so the polygonal and tiled walls match. The fallback is DERIVED (40%
  // brightness of the floor, as those constants are), not a third set of numbers.
  const FACE_MUL = 0.4;
  // Colour maths is BiomeProfiles.mixHex, the one lerp every module shares;
  // scaling a colour by `m` is the lerp from black.
  const mix = BiomeProfiles.mixHex;
  const dim = (c, m) => mix(0x000000, c, m);
  const faceColor = (tier, claimed = true) => {
    if (!claimed && typeof UNCLAIMED_BUILDING_BASE !== 'undefined') return UNCLAIMED_BUILDING_BASE.faces[tier];
    const tbl = (typeof Render !== 'undefined' && Render.BUILDING_FACE_COLOR) || null;
    return (tbl && tbl[tier] != null) ? tbl[tier] : dim(floorColor(tier), FACE_MUL);
  };
  const facePx = (tier) => {
    const tbl = (typeof Render !== 'undefined' && Render.BUILDING_FACE_PX) || null;
    return (tbl && tbl[tier] != null) ? tbl[tier] : (tier === CASTLE ? 11 : 7);
  };

  // The silhouette: the tiled pass draws black at 50% over the floor; mixing
  // the same black into the floor colour lands the identical pixel without a
  // translucent stroke that would double up where two rings touch.
  const OUTLINE_MUL = 0.5;

  // A footprint Home's trailer cleared keeps only its shadow on the ground.
  const CLEARED_SHADOW = 0x000000;
  const CLEARED_SHADOW_ALPHA = 0.2;
  const OUTLINE_PX = 1;

  // Castle rampart: a stone band run INSIDE the ring (the cell version's
  // 6px side walls), with the merlon grid dashed along it — 4px tooth,
  // 4px crenel, the same 8px rhythm the tiled battlements tile at.
  const BAND_PX = Math.max(...CastleStyles.ids.map(id => CastleStyles.get(id).rampart.topDepth));
  // The teeth sit on the OUTER lip of that band, not across the whole of it:
  // a dashed stroke as wide as the band replaces the stone rather than
  // crowning it, and the wall reads as a dashed ribbon instead of masonry.
  const MERLON_PX = 2;

  // "Somebody else's": colours are shaded (the unclaimed castle palette's
  // unclaimedShade() transform) rather than washed over, since overlapping OSM
  // footprints (a shed inside a house) would take a translucent wash twice.
  const shadeOf = (claimed) => {
    if (claimed || typeof unclaimedShade !== 'function') return (c) => c;
    return (c) => unclaimedShade(c);
  };
  // …and the material lift over the shaded colour: what render.js's tiled
  // pass does to an unclaimed court floor and its stone (courtShaded, `stone`).
  const tuneOf = (claimed) => {
    if (claimed || typeof unclaimedMaterialColor !== 'function') return buildingBackgroundColor;
    return (c) => buildingBackgroundColor(unclaimedMaterialColor(c));
  };

  // ── Slime: what "dilapidated" looks like up close ────────────────────────
  // Dark green splotches across an unclaimed footprint's floor say WHY it is
  // dim. Unclaimed buildings only; a restore clears them in the same repaint
  // the claim epoch already forces.
  //
  // The colour is DERIVED: the unclaimed shade run over the already shaded
  // floor twice more (each a 35% lerp toward textures.js's green wash), so
  // retuning UNCLAIMED_SHADE moves the slime too. SLIME_FALLBACK is only
  // reached when textures.js isn't loaded (the headless suite).
  const SLIME_FALLBACK = 0x1e3b24;      // = textures.js UNCLAIMED_SHADE.wash
  const SLIME_FALLBACK_A = 0.73;        // ≈ where three 35% lerps land (1 − 0.65³)
  // Translucent, so the floor's own material grains through the stain. A
  // castle courtyard's pale stone floor is not pre-shaded like other wrecks',
  // so the same stain reads twice as dark against it; it takes half the alpha.
  const SLIME_ALPHA = 0.8;
  const CASTLE_SLIME_ALPHA = SLIME_ALPHA / 2;
  // One splotch per ~30×30 px of floor, capped so a cathedral-sized footprint
  // stays speckled instead of solid.
  const SLIME_PER_PX2 = 1 / (30 * 30);
  const SLIME_MAX = 28;
  const SLIME_MIN_R = 5, SLIME_MAX_R = 11;   // px
  const SLIME_LOBES = 9;                     // points around one blob
  const SLIME_WOBBLE = 0.45;                 // radius jitter, ± of the mean
  const SLIME_TRIES = 6;                     // rejection sampling per splotch
  const SLIME_CACHE_MAX = 2048;

  const slimeColor = (floor, shade) => {
    const s = shade(shade(floor));
    return s === floor ? mix(floor, SLIME_FALLBACK, SLIME_FALLBACK_A) : s;
  };

  // The seed. A building's splotches must be the SAME every rebuild (the layer
  // repaints on every cell crossing), so the scatter is a pure function of the
  // building's identity: its ownerKey where it has one, its tile and ring where
  // it doesn't (a sliver clipped at a tile seam owns no cells and has no key).
  //
  // NOT util.js' fnv1a: it is seeded from the two TILE COORDINATES and eats
  // NUMBERS (every quantised ring vertex), not just string char codes. One
  // call site, so it stays here.
  const seedOf = (tx, ty, ring, key) => {
    let h = (0x811c9dc5 ^ ((tx & 0xffff) << 16) ^ (ty & 0xffff)) >>> 0;
    const eat = (n) => { h = Math.imul(h ^ (n | 0), 0x01000193) >>> 0; };
    if (key) for (let i = 0; i < key.length; i++) eat(key.charCodeAt(i));
    // …and the whole ring: the seed is also the blob cache's key, so two
    // footprints sharing one would share splotches.
    for (let i = 0; i < ring.length; i++) eat(Math.round(ring[i] * 16));
    return h >>> 0;
  };
  // …fed to worldgen's mulberry32 (WorldGen.makeRng).
  const rngFrom = (seed) => WorldGen.makeRng(seed);

  // Shoelace area and a ray-cast containment test on the PROJECTED ring: area
  // drives the splotch count off the real footprint, and containment keeps the
  // scatter off the empty quadrant of an L-shaped block.
  const polyArea = (pts) => {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    return Math.abs(a) / 2;
  };
  const inPoly = (pts, x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const yi = pts[i].y, yj = pts[j].y;
      if ((yi > y) !== (yj > y)
        && x < ((pts[j].x - pts[i].x) * (y - yi)) / (yj - yi) + pts[i].x) inside = !inside;
    }
    return inside;
  };

  // Blobs are generated in LOCAL px (relative to the footprint's NW bbox
  // corner) and translated at draw time: the projection is a pure translation,
  // so one generation serves every rebuild this session.
  const slimeCache = new Map();
  function slimeBlobs(d) {
    let blobs = slimeCache.get(d.seed);
    if (blobs) return blobs;
    const w = d.right - d.left, h = d.south - d.north;
    const area = polyArea(d.pts);
    const n = clamp(Math.round(area * SLIME_PER_PX2), 1, SLIME_MAX);
    // A splotch can't be a third of the building: on a shed, the cap comes off
    // the footprint's own size rather than the constant.
    const maxR = clamp(Math.sqrt(area) / 3, 2, SLIME_MAX_R);
    const minR = Math.min(SLIME_MIN_R, maxR);
    const rnd = rngFrom(d.seed);
    blobs = [];
    for (let i = 0; i < n; i++) {
      let cx = 0, cy = 0, ok = false;
      for (let t = 0; t < SLIME_TRIES && !ok; t++) {
        cx = d.left + rnd() * w;
        cy = d.north + rnd() * h;
        ok = inPoly(d.pts, cx, cy);
      }
      if (!ok) continue;                    // a spindly ring: fewer splotches, none outside it
      const r = minR + rnd() * (maxR - minR);
      const spin = rnd() * Math.PI * 2;
      const pts = [];
      for (let k = 0; k < SLIME_LOBES; k++) {
        const a = spin + (k / SLIME_LOBES) * Math.PI * 2;
        const rr = r * (1 + (rnd() * 2 - 1) * SLIME_WOBBLE);
        pts.push({ x: cx - d.left + Math.cos(a) * rr, y: cy - d.north + Math.sin(a) * rr });
      }
      blobs.push(pts);
    }
    if (slimeCache.size >= SLIME_CACHE_MAX) slimeCache.clear();
    slimeCache.set(d.seed, blobs);
    return blobs;
  }

  // Castle masonry shares the tower material, muted for the background.
  const castleStone = (claimed, key) => {
    const style = buildingBackgroundMaterial(CastleStyles.get(key, claimed));
    const top = style.rampart.woodTop ? style.wood : style.stone;
    return { body: style.stone.BODY, lite: top.LITE, dark: style.stone.DARK,
      top: top.BODY, style };
  };

  // The dashed cell grid, from render.js, so the lattice over a footprint is
  // the SAME lattice as the ground's and continues across the building.
  const GRID_FALLBACK = { width: 1, color: 0x000000, alpha: 0.08, dash: 4, gap: 4 };
  const gridStyle = () =>
    ((typeof Render !== 'undefined' && Render.GRID_LINE) || GRID_FALLBACK);
  // …with ONE thing changed per building: the ink flips to white where the
  // floor is too dark to take a dark line (an unclaimed house is shaded nearly
  // to black), at the same weight, rhythm and alpha. Rec. 601 luma
  // (luminance() from util.js).
  const LUMA_FLIP = 0.42;
  // …and the WEIGHT: floors (cobbles, planks, paving) carry far more local
  // contrast than the ground, so an 8% hairline vanishes on them. This
  // multiple puts its contrast against a floor roughly where 8% is on grass.
  const GRID_OVER_FLOOR_MUL = 2;
  const gridInkFor = (style, floor) => ({
    ...style,
    alpha: style.alpha * GRID_OVER_FLOOR_MUL,
    color: luminance(floor) >= LUMA_FLIP ? style.color : 0xffffff,
  });

  // cssOf / rgbaOf (int → '#rrggbb' / 'rgba(...)') come from util.js.

  // ── The polygonal mode switch ────────────────────────────────────────────
  // Default ON — this branch exists to look at it. `false` (not merely falsy)
  // turns it off so an undefined flag still means on.
  function enabled() {
    return (typeof global === 'undefined') || global.__POLY_BUILDINGS !== false;
  }
  function setEnabled(scene, on) {
    global.__POLY_BUILDINGS = !!on;
    invalidate(scene);
    // The road band's keep-out depends on this flag too and that layer caches
    // its canvas the same way, so flip both.
    if (typeof RoadOverlay !== 'undefined') RoadOverlay.invalidate(scene);
    return !!on;
  }

  // ── Fill target ──────────────────────────────────────────────────────────
  // The overlay paints into a Graphics-SHAPED object: clear / fillPoly /
  // strokePoly / insetStroke / texturePoly, plus commit() once the pass is
  // done. In the game that's the canvas-2D adapter below; the headless tests
  // inject a recording stub as scene.buildingGeomGfx.
  //
  // Canvas 2D rather than a Phaser Graphics for the same reasons the road
  // overlay uses it: path fills with holes and joins, `clip()` for the
  // rampart band, and pattern fills for the materials.
  const TEX_KEY = 'buildinggeom_overlay';
  // Curated recipes: geometry and seeded marks vary; material, contrast,
  // floor rhythm and trim stay authored. No per-frame randomness.
  const WALL_RECIPES = Object.freeze({
    plain: { material:'plaster', body:0xb9a78a, trim:0x735741, roof:0x985c49, stories:1 },
    blacksmith: { material:'stone', body:0x92958f, trim:0x626961, roof:0x555b60, stories:1 },
    trader: { material:'sandstone', body:0xc1a77c, trim:0x73573b, roof:0x927349, stories:1 },
    seed: { material:'plaster', body:0xa4ac87, trim:0x64714a, roof:0x507957, stories:1 },
    supply: { material:'timber', body:0xa18a69, trim:0x62503c, roof:0x536c83, stories:2 },
    potion: { material:'plaster', body:0xa59bac, trim:0x62536e, roof:0x70558d, stories:2 },
    relic: { material:'stone', body:0x9ba5aa, trim:0x606977, roof:0x536779, stories:2 },
    book: { material:'sandstone', body:0xc0b299, trim:0x785746, roof:0x8a4f4b, stories:2 },
    pet: { material:'plaster', body:0x9eafa5, trim:0x627b70, roof:0x547e78, stories:1 },
    wizard: { material:'stone', body:0x9691a6, trim:0x59536d, roof:0x51446f, stories:3 },
    turret: { material:'stone', body:0x92958f, trim:0x626961, roof:0x777e82, stories:2 },
  });
  function wallRecipe(role, stories, claimed = true) {
    const recipe=WALL_RECIPES[role] || WALL_RECIPES.plain;
    const paint=c=>tuneOf(claimed)(shadeOf(claimed)(c));
    return {...recipe,body:paint(recipe.body),trim:paint(recipe.trim),roof:paint(recipe.roof),
      stories:Math.max(1,Math.min(3,Math.round(stories || recipe.stories)))};
  }
  function simplifyRoofRing(ring) {
    const out=ring.slice(),area=polyArea(ring),tolerance=4;
    const distance=(p,a,b)=>{
      const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
      return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
    };
    for(let pass=0;pass<ring.length;pass++) {
      let removed=false;
      for(let i=0;i<out.length&&out.length>4;i++) {
        const a=out[(i+out.length-1)%out.length],b=out[i],c=out[(i+1)%out.length];
        if(distance(b,a,c)>tolerance)continue;
        const candidate=out.filter((_,j)=>j!==i);
        if(Math.abs(polyArea(candidate)-area)>area*0.035)continue;
        if(ring.some(p=>Math.min(...candidate.map((a,j)=>distance(p,a,candidate[(j+1)%candidate.length])))>tolerance))continue;
        // The simplified control must remain a simple polygon.
        const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
        if(candidate.some((p,j)=>{const q=candidate[(j+1)%candidate.length];return p!==a&&p!==c&&q!==a&&q!==c
          &&cross(a,c,p)*cross(a,c,q)<-1e-8&&cross(p,q,a)*cross(p,q,c)<-1e-8;}))continue;
        out.splice(i,1);removed=true;break;
      }
      if(!removed)break;
    }
    return out;
  }
  // A sampled inward wavefront. Distance to the actual outline makes narrow
  // wings collapse to ridges, while a height cap leaves an inset flat roof.
  // Unlike a centroid fan, no triangle crosses a courtyard or concave notch.
  // This approximates a skeleton; concave junctions soften over one mesh cell.
  const roofCache = new Map();
  function roofMesh(source, variant = 'ridge', detail = 'clean') {
    const left = Math.min(...source.map(p => p.x)), top = Math.min(...source.map(p => p.y));
    let ring = source.map(p => ({ x: p.x - left, y: p.y - top }));
    const cross = (a, b, c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    // Remove only duplicate/collinear vertices, never small genuine details.
    PolygonGeometry.removeCollinear(ring);
    if (ring.reduce((a,p,i) => a + p.x*ring[(i+1)%ring.length].y-p.y*ring[(i+1)%ring.length].x,0) < 0) ring.reverse();
    const first = ring.reduce((best,p,i) => p.x < ring[best].x || (p.x === ring[best].x && p.y < ring[best].y) ? i : best,0);
    ring = ring.slice(first).concat(ring.slice(0,first));
    const key = detail + ':' + variant + ':' + ring.map(p => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).join(';');
    if (roofCache.has(key)) return roofCache.get(key);
    const triangles = PolygonGeometry.triangulate(ring);
    // Invalid rings retain the old flat roof, never a fan across missing space.
    if (!triangles.length) return { triangles: [], ring, variant };
    const pitch = variant === 'shallow' ? 0.32 : 0.68;
    const cap = variant === 'inset' ? 9 : variant === 'shallow' ? 5 : 32;
    const controlRing=detail==='clean' ? simplifyRoofRing(ring) : ring;
    const distanceTo=(p,outline)=>{
      let distance=Infinity;
      for(let i=0;i<outline.length;i++) {
        const a=outline[i],b=outline[(i+1)%outline.length],dx=b.x-a.x,dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
        distance=Math.min(distance,(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2);
      }
      return Math.sqrt(distance);
    };
    const heightAt=p=>Math.min(cap,distanceTo(p,controlRing)*pitch,
      distanceTo(p,ring)*(detail==='clean' ? Math.min(0.86,pitch*1.25) : pitch));
    const vertices = new Map(), mesh = [];
    const vertex = p => {
      const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
      if (vertices.has(key)) return vertices.get(key);
      const v = { x:p.x, y:p.y, z:heightAt(p) };
      vertices.set(key,v); return v;
    };
    const clip = (poly, axis, value, sign) => {
      const out = [];
      for (let i=0;i<poly.length;i++) {
        const a=poly[i],b=poly[(i+1)%poly.length];
        const da=(a[axis]-value)*sign,db=(b[axis]-value)*sign;
        if (da >= -1e-9) out.push(a);
        if ((da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9)) {
          const t=da/(da-db); out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
        }
      }
      return out;
    };
    // Clip already-triangulated geometry to a fixed grid: all intersections
    // remain convex, and shared boundary vertices have identical heights.
    const step = Math.max(detail==='clean' ? 10 : 6, Math.ceil(Math.sqrt(polyArea(ring) / 1000)));
    for (const tri of triangles) {
      const x0=Math.floor(Math.min(...tri.map(p=>p.x))/step)*step, x1=Math.max(...tri.map(p=>p.x));
      const y0=Math.floor(Math.min(...tri.map(p=>p.y))/step)*step, y1=Math.max(...tri.map(p=>p.y));
      for(let y=y0;y<y1;y+=step) for(let x=x0;x<x1;x+=step) {
        let poly=clip(tri,'x',x,1); poly=clip(poly,'x',x+step,-1);
        poly=clip(poly,'y',y,1); poly=clip(poly,'y',y+step,-1);
        if(poly.length<3) continue;
        const center=vertex({x:poly.reduce((s,p)=>s+p.x,0)/poly.length,y:poly.reduce((s,p)=>s+p.y,0)/poly.length});
        const corners=poly.map(vertex);
        // Flat/planar cells need only a diagonal, not a centre fan.
        let planar=false;
        if(detail==='clean'&&corners.length>=3) {
          const a=corners[0],b=corners[1],c=corners[2],area=cross(a,b,c);
          if(area>1e-8) {
            const dx=((b.z-a.z)*(c.y-a.y)-(c.z-a.z)*(b.y-a.y))/area;
            const dy=((b.x-a.x)*(c.z-a.z)-(c.x-a.x)*(b.z-a.z))/area;
            planar=[...corners,center].every(p=>Math.abs(p.z-a.z-dx*(p.x-a.x)-dy*(p.y-a.y))<0.02);
          }
        }
        const parts=planar ? corners.slice(1,-1).map((p,i)=>[corners[0],p,corners[i+2]])
          : corners.map((p,i)=>[p,corners[(i+1)%corners.length],center]);
        for(const points of parts)if(cross(...points)>1e-8)mesh.push({points});
      }
    }
    // Keep the projected surface one-to-one. Sampling across an extremely
    // skinny triangle can steepen its interpolated slope beyond the analytic
    // distance field. Lower only the offending shared vertices, leaving every
    // eave and the footprint topology fixed. Zero height is always feasible.
    for(let pass=0;pass<32;pass++) {
      let changed=false;
      for(const {points:[a,b,c]} of mesh) {
        const coefficients=[c.x-b.x,a.x-c.x,b.x-a.x], points=[a,b,c];
        const limit=cross(a,b,c)*0.88;
        const slope=points.reduce((sum,p,i)=>sum+coefficients[i]*p.z,0);
        if(slope<=limit+1e-9) continue;
        const positive=points.reduce((sum,p,i)=>sum+Math.max(0,coefficients[i])*p.z,0);
        const factor=Math.max(0,1-(slope-limit)/positive);
        for(let i=0;i<3;i++) if(coefficients[i]>0)points[i].z*=factor;
        changed=true;
      }
      if(!changed)break;
    }
    let maxSlope=0;
    for(const {points:[a,b,c]} of mesh) {
      maxSlope=Math.max(maxSlope,((b.x-a.x)*(c.z-a.z)-(c.x-a.x)*(b.z-a.z))/cross(a,b,c));
    }
    // Bounded fallback for unusually degenerate source polygons.
    if(maxSlope>0.9)for(const v of vertices.values())v.z*=0.88/maxSlope;
    for(const triangle of mesh) {
      const [a,b,c]=triangle.points,area=cross(a,b,c);
      const dx=((b.z-a.z)*(c.y-a.y)-(c.z-a.z)*(b.y-a.y))/area;
      const dy=((b.x-a.x)*(c.z-a.z)-(c.x-a.x)*(b.z-a.z))/area;
      if(detail==='clean') {
        const p={x:(a.x+b.x+c.x)/3,y:(a.y+b.y+c.y)/3},e=1.5;
        const gx=(heightAt({x:p.x+e,y:p.y})-heightAt({x:p.x-e,y:p.y}))/(2*e);
        const gy=(heightAt({x:p.x,y:p.y+e})-heightAt({x:p.x,y:p.y-e}))/(2*e);
        const angle=Math.round(Math.atan2(gy,gx)/(Math.PI/4))*Math.PI/4;
        const slope=Math.hypot(gx,gy)<0.12 ? 0 : pitch;
        triangle.light=Math.round((0.9-Math.cos(angle)*slope*0.23-Math.sin(angle)*slope*0.38)*12)/12;
      } else triangle.light=Math.max(0.58,Math.min(1.18,0.9
        -Math.max(-pitch,Math.min(pitch,dx))*0.23-Math.max(-pitch,Math.min(pitch,dy))*0.38));
    }

    const result = { triangles:mesh, ring, controlRing, variant, detail, heightAt };
    if(roofCache.size>=96) roofCache.delete(roofCache.keys().next().value);
    roofCache.set(key,result); return result;
  }

  function canvasTarget(scene) {
    if (typeof document === 'undefined' || !scene.textures || !scene.buildingGeomContainer) return null;
    if (scene._buildingGeomTarget) return scene._buildingGeomTarget;
    // The padded viewport layer (render.js Render.viewportCanvas — the grid
    // and border bakes open theirs the same way). A texture left by an
    // earlier scene is dropped first, so this canvas is this scene's own.
    if (scene.textures.exists(TEX_KEY)) scene.textures.remove(TEX_KEY);
    const { tex, x: originX, y: originY, cw: size } = Render.viewportCanvas(scene, TEX_KEY, CELL_PX * 2);
    if (!tex) return null;
    const ctx = tex.getContext();
    ctx.lineJoin = 'round';
    const img = scene.add.image(originX, originY, TEX_KEY).setOrigin(0, 0);
    scene.buildingGeomContainer.add(img);
    // Interior sheet materials, one per tier, with procedural biome patterns
    // as a fallback when the sheet could not load. Built lazily.
    const patterns = new Map();
    const patternFor = (tier) => {
      if (patterns.has(tier)) return patterns.get(tier);
      let p = null;
      const key = scene.textures.exists(`interior_floor_${tier}`) ? `interior_floor_${tier}`
        : tier === CASTLE && scene.textures.exists('castle_paving') ? 'castle_paving' : `biome${tier}_0`;
      if (scene.textures.exists(key)) {
        const src = scene.textures.get(key).getSourceImage();
        // createPattern THROWS on a zero-sized source (a texture not baked yet)
        // and would take the whole pass down. No material is fine.
        if (src && src.width && src.height) p = {
          fill: ctx.createPattern(src, 'repeat'), width: src.width, height: src.height,
        };
      }
      patterns.set(tier, p);
      return p;
    };
    // The material patterns are anchored to the WORLD, not the canvas: the
    // texture is screen-fixed while the buildings slide across it, so an
    // un-phased pattern would swim over the floors as the player walks. Whole
    // pixels only — a fractional translate resamples the tile and mushes it.
    let phaseX = 0, phaseY = 0;
    const wrap = (v, period) => ((v % period) + period) % period;
    const trace = (pts, holes = []) => {
      ctx.beginPath();
      for (const ring of [pts, ...holes]) {
        ctx.moveTo(ring[0].x - originX, ring[0].y - originY);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x - originX, ring[i].y - originY);
        ctx.closePath();
      }
    };
    // Bake once per geometry/palette. Camera crossings then copy one small
    // bitmap instead of replaying thousands of mesh triangles.
    const roofBitmap = (mesh, tile) => {
      if (mesh.bitmap?.tile === tile) return mesh.bitmap.canvas;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(Math.max(...mesh.ring.map(p => p.x))) + 2;
      canvas.height = Math.ceil(Math.max(...mesh.ring.map(p => p.y))) + 2;
      if(mesh.detail==='clean') {
        // Shade the continuous roof at native pixel size, independent of the
        // coarse mesh. This removes triangle-sized sawteeth along ridge lines.
        const width=canvas.width,height=canvas.height,stride=width+2;
        const field=new Float32Array((width+2)*(height+2));
        for(let y=-1;y<=height;y++)for(let x=-1;x<=width;x++)field[(y+1)*stride+x+1]=mesh.heightAt({x:x-1,y:y-1});
        const ink=canvas.getContext('2d'),pixels=ink.createImageData(width,height),data=pixels.data;
        const colors=new Map();
        const colorFor=(shade,seam)=>{
          const key=shade+':'+seam;if(colors.has(key))return colors.get(key);
          let c=shade>1?mix(tile,0xffe7c0,(shade-1)*0.6):dim(tile,shade);
          if(seam)c=mix(c,dim(tile,0.6),0.24);colors.set(key,c);return c;
        };
        for(let x=0;x<width;x++)for(let y=0;y<height;y++) {
          const index=(y+1)*stride+x+1,z=field[index];
          const gx=(field[index+1]-field[index-1])/2,gy=(field[index+stride]-field[index-stride])/2;
          const angle=Math.round(Math.atan2(gy,gx)/(Math.PI/4))*Math.PI/4;
          const slope=Math.hypot(gx,gy)<0.12?0:0.68;
          const shade=Math.round((0.95-Math.cos(angle)*slope*0.18-Math.sin(angle)*slope*0.28)*16)/16;
          const color=colorFor(shade,(y-1)%7===0);
          const top=Math.max(0,Math.round(y-z)),bottom=Math.min(height,Math.round(y+1-field[index+stride]));
          for(let row=top;row<bottom;row++) {
            const offset=(row*width+x)*4;data[offset]=color>>16;data[offset+1]=(color>>8)&255;data[offset+2]=color&255;data[offset+3]=255;
          }
        }
        ink.putImageData(pixels,0,0);mesh.bitmap={tile,canvas};return canvas;
      }
      const ink = canvas.getContext('2d');
      ink.translate(1,1); ink.lineJoin='round'; ink.lineWidth=0.45;
      for (const triangle of mesh.triangles) {
        ink.beginPath();
        triangle.points.forEach((p,i) => i ? ink.lineTo(p.x,p.y-p.z) : ink.moveTo(p.x,p.y-p.z));
        ink.closePath();
        const color=triangle.light>1 ? mix(tile,0xffe7c0,(triangle.light-1)*0.6) : dim(tile,triangle.light);
        ink.fillStyle=ink.strokeStyle=cssOf(color); ink.fill(); ink.stroke();
      }
      // Roof courses follow the surface height, including the inward valleys.
      ink.strokeStyle=cssOf(dim(tile,0.65)); ink.lineWidth=0.65; ink.globalAlpha=0.4; ink.beginPath();
      for (const {points} of mesh.triangles) {
        const y0=Math.min(...points.map(p=>p.y)),y1=Math.max(...points.map(p=>p.y));
        for(let y=Math.ceil((y0+1e-6)/7)*7;y<y1;y+=7) {
          const ends=[];
          for(let i=0;i<3;i++) {
            const a=points[i],b=points[(i+1)%3];
            if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y)) {
              const t=(y-a.y)/(b.y-a.y);ends.push({x:a.x+(b.x-a.x)*t,y:y-a.z-(b.z-a.z)*t});
            }
          }
          if(ends.length===2){ink.moveTo(ends[0].x,ends[0].y);ink.lineTo(ends[1].x,ends[1].y);}
        }
      }
      ink.stroke();
      mesh.bitmap={tile,canvas};return canvas;
    };
    const wallTextures=new Map();
    const wallTexture=(material,body,trim)=>{
      const key=`${material}:${body}:${trim}`;
      if(wallTextures.has(key))return wallTextures.get(key);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
      const ink=canvas.getContext('2d');
      const rand=(x,y)=>((Math.imul(x+17,374761393)^Math.imul(y+31,668265263))>>>0)/4294967296;
      const dark=cssOf(mix(body,trim,0.24)),lite=cssOf(mix(body,0xe5d5b5,0.17));
      if(material==='timber') {
        for(let x=0;x<64;x+=8) {
          ink.fillStyle=dark;ink.fillRect(x,0,1,64);
          ink.fillStyle=lite;ink.fillRect(x+1,0,1,64);
          for(let y=4;y<64;y+=13) {ink.fillStyle=rand(x,y)>.5?dark:lite;ink.fillRect(x+3,y,1,5);}
        }
      } else if(material==='plaster') {
        for(let y=0;y<64;y+=8)for(let x=0;x<64;x+=8) {
          const n=rand(x,y);if(n<0.72)continue;
          ink.fillStyle=n>.88?lite:dark;ink.fillRect(x+(y%3),y,3+(x%3),1);
          if(n>.94)ink.fillRect(x+2,y+1,2,2);
        }
      } else {
        const block=material==='brick'?12:material==='sandstone'?20:16;
        for(let row=0,y=0;y<64;y+=8,row++)for(let x=-block;x<64;x+=block) {
          const px=x+(row%2)*block/2,n=rand(x,y);
          ink.fillStyle=dark;
          if(n>0.2)ink.fillRect(px,y,block-2,1);
          if(n>0.35)ink.fillRect(px,y,1,6);
          ink.fillStyle=lite;if(n>.5)ink.fillRect(px+2,y+1,block-5,1);
          if(n>.85){ink.fillStyle=dark;ink.fillRect(px+4,y+5,3,1);}
        }
      }
      if(wallTextures.size>=64)wallTextures.delete(wallTextures.keys().next().value);
      wallTextures.set(key,canvas);return canvas;
    };
    const paintWall=(a,b,lift,base,recipe,seed,entrance)=>{
      if(a.x>b.x)[a,b]=[b,a];
      const length=Math.hypot(b.x-a.x,b.y-a.y),ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
      const shade=ux>0.85?1:uy>0?0.76:0.88;
      const body=dim(recipe.body,shade),trim=dim(recipe.trim,shade),dark=mix(trim,0x252931,0.42);
      const height=lift+base;
      ctx.save();ctx.transform(ux,uy,0,1,a.x-originX,a.y-originY-lift);
      ctx.beginPath();ctx.rect(0,0,length,height);ctx.clip();
      ctx.fillStyle=cssOf(body);ctx.fillRect(0,0,length,height);
      const pattern=ctx.createPattern(wallTexture(recipe.material,body,trim),'repeat');
      ctx.save();const phase=seed%64;ctx.translate(-phase,0);ctx.fillStyle=pattern;ctx.fillRect(phase,0,length,height);ctx.restore();
      const rect=(x,y,w,h,color)=>{ctx.fillStyle=cssOf(color);ctx.fillRect(x,y,w,h);};
      // Clear lip, broad under-eave shadow and a grounded stone plinth.
      rect(0,0,length,3,dark);rect(0,3,length,1,mix(body,dark,0.4));
      rect(0,height-4,length,4,mix(body,trim,0.4));rect(0,height-1,length,1,dark);
      if(length>12){rect(0,4,2,height-8,mix(body,0xead7b3,0.18));rect(length-2,3,2,height-7,mix(body,trim,0.4));}
      for(let level=1;level<recipe.stories;level++) {
        const y=height-level*24;
        rect(0,y-2,length,3,trim);rect(0,y-2,length,1,mix(body,0xe3d5ba,0.3));
        rect(0,y+1,length,1,mix(body,dark,0.4));
      }
      const bays=Math.floor((length-8)/27);
      for(let floor=0;floor<recipe.stories;floor++)for(let bay=0;bay<bays;bay++) {
        const x=(bay+0.5)*length/bays,y=height-24*(floor+1)+7;
        if(entrance&&floor===0&&Math.abs(x-length/2)<14)continue;
        rect(x-5,y-2,10,2,trim);rect(x-4,y,8,9,dark);
        rect(x-3,y+1,2,7,mix(body,dark,0.35));rect(x+1,y+1,2,7,mix(body,dark,0.35));
        rect(x-6,y+9,12,2,trim);rect(x-6,y+9,12,1,mix(body,0xe6d6b9,0.35));
        rect(x-5,y+11,10,2,mix(body,dark,0.35));
      }
      if(entrance&&length>24) {
        const x=Math.floor(length/2)-6,y=height-20;
        rect(x-2,y-2,16,3,trim);rect(x-1,y+1,14,18,dark);rect(x+1,y+2,10,16,trim);
        rect(x+5,y+3,1,14,mix(trim,dark,0.6));rect(x+9,y+9,1,2,0xc8b786);
        rect(x-3,height-3,18,2,mix(body,0xded0b2,0.3));
      }
      ctx.restore();
    };
    const target = {
      clear() { ctx.clearRect(0, 0, size, size); },
      // Sloped roofs preserve the source outline, including tiny bays and notches.
      housePoly(pts, floor, face, outline, specialty = 'plain', variant = null, stories = null, seed = 0, claimed = true) {
        const recipe=wallRecipe(specialty,stories,claimed);
        const base = facePx(9), lift=recipe.stories*24+5-base;
        const accent = mix(recipe.body,0xd8c79f,0.25);
        const roof = pts.map(p => ({ x: p.x, y: p.y - lift }));
        let area = 0;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          area += a.x * b.y - b.x * a.y;
        }
        const winding = area < 0 ? -1 : 1;
        const edges = pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length], i }))
          .filter(({ a, b }) => (b.x - a.x) * winding < -0.001)
          .sort((a, b) => (a.a.y + a.b.y) - (b.a.y + b.b.y));
        const front=edges.reduce((best,edge)=>!best || Math.hypot(edge.b.x-edge.a.x,edge.b.y-edge.a.y)>
          Math.hypot(best.b.x-best.a.x,best.b.y-best.a.y)?edge:best,null);
        for (const edge of edges) {
          paintWall(edge.a,edge.b,lift,base,recipe,seed,edge===front);
        }
        const tile = recipe.roof;
        target.fillPoly(roof, tile);
        const left = Math.min(...roof.map(p => p.x)), top = Math.min(...roof.map(p => p.y));
        const style = variant || (specialty === 'blacksmith' || specialty === 'supply' ? 'inset'
          : specialty === 'trader' || specialty === 'pet' ? 'shallow' : 'ridge');
        if (specialty !== 'turret') {
          const mesh = roofMesh(roof, style, scene.buildingRoofDetail);
          ctx.save(); trace(roof); ctx.clip();
          ctx.drawImage(roofBitmap(mesh,tile),left-originX-1,top-originY-1);
          ctx.restore();
        } else {
          target.insetStroke(roof,4,accent,[6,5]);
        }
        target.insetStroke(roof,1,mix(tile,0xffd6a0,0.28));
        target.strokePoly(roof,1,outline);
        // The existing world signs carry the role; no duplicate roof plaques.
        if (!WALL_RECIPES[specialty] || specialty==='plain') return;
        // A striped canopy sits on the longest visible wall, following its angle.
        if (!['wizard', 'turret', 'blacksmith'].includes(specialty) && edges.length) {
          const {a,b} = edges.reduce((best,e) => Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y) >
            Math.hypot(best.b.x-best.a.x,best.b.y-best.a.y) ? e : best);
          const length = Math.hypot(b.x-a.x,b.y-a.y), span = Math.min(36, length * 0.7) / length;
          const at = (t,dy) => ({x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t+dy});
          for (let i=0;i<6;i++) {
            const t=0.5-span/2+span*i/6, u=t+span/6;
            target.fillPoly([at(t,-lift+2),at(u,-lift+2),at(u,-lift+9),at(t,-lift+9)],
              i%2 ? accent : dim(tile,0.7));
          }
        }
      },
      fillPoly(pts, color, alpha, holes = []) {
        if (!pts || pts.length < 3) return;
        trace(pts, holes);
        ctx.fillStyle = alpha == null ? cssOf(color) : rgbaOf(color, alpha);
        ctx.fill('evenodd');
      },
      strokePoly(pts, width, color) {
        if (!pts || pts.length < 3) return;
        trace(pts);
        ctx.lineWidth = width;
        ctx.strokeStyle = cssOf(color);
        ctx.stroke();
      },
      // A band running INSIDE the ring: clip to the polygon and stroke it at
      // double width, so the outer half falls away and the inner half is a
      // band of exactly `width` hugging the wall. `dash` (optional) gives the
      // band the crenellation rhythm.
      insetStroke(pts, width, color, dash) {
        if (!pts || pts.length < 3) return;
        ctx.save();
        trace(pts);
        ctx.clip();
        trace(pts);
        ctx.lineWidth = width * 2;
        ctx.strokeStyle = cssOf(color);
        if (dash) ctx.setLineDash(dash);
        ctx.stroke();
        ctx.restore();
      },
      // The ground's own cell lattice, continued across the footprint: clipped
      // to the ring, stroked over its bounding box only, and placed from the
      // VIEWPORT exactly where render.js's gridGfx places it, so the lattice is
      // continuous from the grass onto the floor.
      gridPoly(pts, style) {
        if (!pts || pts.length < 3) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of pts) {
          if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
        }
        x0 -= originX; x1 -= originX; y0 -= originY; y1 -= originY;
        // Where the grid's first line falls on THIS canvas, and its dash phase,
        // both measured from the viewport corner.
        const vx = scene.viewLeft - originX, vy = scene.viewTop - originY;
        const gx = vx + CELL_PX / 2, gy = vy + CELL_PX / 2;
        const period = style.dash + style.gap;
        // gridGfx runs each dash sequence from the VIEWPORT corner (vLeft for
        // the horizontals, vTop for the verticals), not from the first line —
        // so the dashes are anchored there too, or the two lattices would meet
        // at a building's wall out of step.
        const phase = (v) => v - Math.ceil(v / period) * period;   // ≤ 0, in step with v
        ctx.save();
        trace(pts);
        ctx.clip();
        ctx.lineWidth = style.width;
        ctx.strokeStyle = rgbaOf(style.color, style.alpha);
        ctx.setLineDash([style.dash, style.gap]);
        ctx.beginPath();
        for (let x = gx + Math.ceil((x0 - gx) / CELL_PX) * CELL_PX; x <= x1; x += CELL_PX) {
          const sy = phase(vy) + Math.floor((y0 - phase(vy)) / period) * period;
          const cx = Math.round(x) + 0.5;   // half-pixel: a crisp 1px column, not two grey ones
          ctx.moveTo(cx, sy);
          ctx.lineTo(cx, y1);
        }
        for (let y = gy + Math.ceil((y0 - gy) / CELL_PX) * CELL_PX; y <= y1; y += CELL_PX) {
          const sx = phase(vx) + Math.floor((x0 - phase(vx)) / period) * period;
          const cy = Math.round(y) + 0.5;
          ctx.moveTo(sx, cy);
          ctx.lineTo(x1, cy);
        }
        ctx.stroke();
        ctx.restore();
      },
      // The dilapidated floor's slime, clipped to the ring so a splotch that
      // overhangs the wall is cut off at it. `blobs` arrive in local px
      // (relative to the ring's NW bbox corner) and are offset here — see
      // slimeBlobs().
      blobsPoly(pts, blobs, ox, oy, color, alpha) {
        if (!pts || pts.length < 3 || !blobs || !blobs.length) return;
        ctx.save();
        trace(pts);
        ctx.clip();
        ctx.fillStyle = rgbaOf(color, alpha);
        ctx.beginPath();
        for (const b of blobs) {
          ctx.moveTo(b[0].x + ox - originX, b[0].y + oy - originY);
          for (let i = 1; i < b.length; i++) ctx.lineTo(b[i].x + ox - originX, b[i].y + oy - originY);
          ctx.closePath();
        }
        // One path for every splotch on the building: two that overlap fill as
        // one puddle instead of stacking two alphas into a dark spot.
        ctx.fill();
        ctx.restore();
      },
      // The tier's material, laid inside the ring. One clip + one pattern fill
      // per building; rebuilds are rare (a cell crossing or a tile load), so
      // this is nothing per frame.
      texturePoly(pts, tier, holes = []) {
        const p = patternFor(tier);
        if (!p || !pts || pts.length < 3) return;
        ctx.save();
        trace(pts, holes);
        ctx.clip('evenodd');
        ctx.fillStyle = p.fill;
        const x = wrap(phaseX, p.width), y = wrap(phaseY, p.height);
        ctx.translate(x, y);
        ctx.fillRect(-x, -y, size, size);
        ctx.restore();
      },
      damagePoly(pts, key, claimed, anchorX, anchorY) {
        const texture = CastleStyles.damageTexture(scene, key, claimed);
        if (!texture) return false;
        if (!patterns.has(texture)) patterns.set(texture,
          ctx.createPattern(scene.textures.get(texture).getSourceImage(), 'repeat'));
        ctx.save(); trace(pts); ctx.clip();
        ctx.translate(anchorX - originX, anchorY - originY);
        ctx.fillStyle = patterns.get(texture);
        ctx.fillRect(originX - anchorX, originY - anchorY, size, size);
        ctx.restore();
        return true;
      },
      columnsPoly(pts, columns, claimed) {
        if (!columns.length) return;
        const key = CastleStyles.columnTexture(scene, claimed);
        if (!key) return;
        const source = scene.textures.get(key).getSourceImage();
        ctx.save(); trace(pts); ctx.clip(); ctx.imageSmoothingEnabled = false;
        for (const p of columns) ctx.drawImage(source, 0, 20 - p.height, 16, p.height,
          Math.round(p.x - originX - 8), Math.round(p.y - originY - p.height), 16, p.height);
        ctx.restore();
      },
      templePoly(pts, activated, dark) {
        ctx.save();
        ctx.translate(-originX, -originY);
        const floorKey = TempleArt.floorTexture(activated,dark);
        const floorSource=scene.textures.exists(floorKey) ? scene.textures.get(floorKey).getSourceImage() : null;
        if (!patterns.has(floorKey)) patterns.set(floorKey,floorSource ? ctx.createPattern(floorSource,'repeat') : null);
        TempleArt.draw(ctx, pts, { activated, dark, faces: false, background: true,
          floorPattern: patterns.get(floorKey),floorPhaseX: wrap(phaseX+originX,floorSource?.width || 32),
          floorPhaseY: wrap(phaseY+originY,floorSource?.height || 32) });
        ctx.restore();
      },
      texturePhase(x, y) { phaseX = Math.round(x - originX); phaseY = Math.round(y - originY); },
      commit() { tex.refresh(); },
    };
    scene._buildingGeomTarget = target;
    return target;
  }
  function fillTarget(scene) {
    return scene.buildingGeomGfx || canvasTarget(scene);
  }

  // Floors stay under the world. Each short perimeter segment is an upright
  // piece, so a long north/south wall can interleave with walking characters.
  // Canvas clipping keeps angled walls inside the source footprint.
  //
  // Pieces are cached across rebuilds, keyed by their WORLD geometry: the
  // projection is a pure translation (whole cells between rebuilds), so a
  // piece baked once stays valid and only moves. A cell crossing then bakes
  // just the edges newly in view instead of every wall on screen.
  //
  // ── The wall atlas ───────────────────────────────────────────────────────
  // Pieces share ATLAS PAGES: square canvas textures cut into fixed slots, one
  // per piece, each exposed to its sprite as a Phaser frame. Per-piece canvas
  // textures cost a read-back each (Phaser's CanvasTexture reads pixels back
  // on creation) and were most of the 60–190 ms stall on every cell crossing.
  // A crossing paints new pieces into free slots and uploads each touched page
  // once (commitWallAtlas); nothing reads pixels back. Slots are freed when a
  // piece scrolls out of the padded view; an empty page is dropped.
  const PAGE_PX = 512;
  // A slot holds the largest piece uprightEdges can cut: one edge segment of
  // at most a cell in either axis, its wall depth below, the rampart band and
  // outline padding on every side, and the pixel of floor/ceil rounding at
  // each end. Derived from the constants the bake pads with, so a retune of
  // BAND_PX can't overflow a slot.
  const SLOT_PAD = Math.ceil(Math.max(...CastleStyles.ids.map(id => {
    const r = CastleStyles.get(id).rampart;
    return r.topDepth + Math.max(r.topDepth, r.wallHeight) + r.toothHeight;
  })) + 2);
  const slotSize = () => {
    const tbl = (typeof Render !== 'undefined' && Render.BUILDING_FACE_PX) || null;
    const deepest = tbl ? Math.max(...Object.values(tbl)) : facePx(CASTLE);
    return { w: CELL_PX + SLOT_PAD * 2 + 2, h: CELL_PX + deepest + SLOT_PAD * 2 + 2 };
  };
  function wallAtlas(scene) {
    let A = scene._buildingWallAtlas;
    if (!A) {
      const { w, h } = slotSize();
      A = scene._buildingWallAtlas = {
        pages: [], slotW: w, slotH: h,
        cols: Math.floor(PAGE_PX / w), rows: Math.floor(PAGE_PX / h), seq: 0,
      };
    }
    return A;
  }
  // A free slot on some page: { page, slot, sx, sy }. Opens a page when every
  // slot in hand is taken.
  function allocSlot(scene) {
    const A = wallAtlas(scene);
    let page = A.pages.find((p) => p.free.length);
    if (!page) {
      const key = `buildinggeom_walls_${++A.seq}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const tex = scene.textures.createCanvas(key, PAGE_PX, PAGE_PX);
      const free = [];
      for (let i = A.cols * A.rows - 1; i >= 0; i--) free.push(i);
      page = { key, tex, ctx: tex.getContext(), free, used: 0, dirty: false, seq: 0 };
      A.pages.push(page);
    }
    const slot = page.free.pop();
    page.used++;
    return { page, slot, sx: (slot % A.cols) * A.slotW, sy: Math.floor(slot / A.cols) * A.slotH };
  }
  // Upload every page a rebuild painted on, once, and drop the pages the
  // release pass emptied.
  function commitWallAtlas(scene) {
    const A = scene._buildingWallAtlas;
    if (!A) return;
    A.pages = A.pages.filter((page) => {
      if (!page.used) { scene.textures.remove(page.key); return false; }
      if (page.dirty) { page.tex.refresh(); page.dirty = false; }
      return true;
    });
  }
  function releasePiece(scene, p) {
    p.sprite.destroy();
    p.page.tex.remove(p.frame);
    p.page.free.push(p.slot);
    p.page.used--;
  }
  function clearUprights(scene) {
    for (const p of (scene._buildingUprightCache || new Map()).values()) p.sprite.destroy();
    for (const page of (scene._buildingWallAtlas ? scene._buildingWallAtlas.pages : [])) {
      scene.textures.remove(page.key);
    }
    scene._buildingWallAtlas = null;
    scene._buildingUprightCache = new Map();
    scene._buildingUprightPieces = [];
  }

  // Compass-aware walls keep the same footprint and material as the atlas.
  // Elevation is independent of map rotation; joins share ground vertices.
  function perspectiveEdges(scene, d, isMine) {
    const shade = shadeOf(isMine), tune = tuneOf(isMine);
    const stone = d.tier === CASTLE && !d.templeZone ? castleStone(isMine, d.castleStyle || d.key) : null;
    const temple = d.templeZone ? TempleArt.palette(isMine, d.templeKind === 'tar', true) : null;
    const rampart = stone?.style.rampart;
    const height = temple ? TempleArt.geometry.wallHeight : rampart ? rampart.wallHeight : d.tier === 11 ? 5 : facePx(d.tier);
    const face = temple ? temple.face : stone ? stone.style.stone.FACE : tune(shade(faceColor(d.tier, isMine)));
    const top = temple ? temple.coping : stone ? stone.top : tune(shade(floorColor(d.tier, isMine)));
    const dark = temple ? temple.outline : stone ? stone.dark : tune(dim(shade(floorColor(d.tier, isMine)), OUTLINE_MUL));
    const thickness = temple ? TempleArt.geometry.wallThickness : rampart ? rampart.topDepth : d.tier === 11 ? 3 : 1;
    const points = d.pts;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    const winding = Math.sign(area);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (!length) continue;
      const nx = -dy / length * winding, ny = dx / length * winding;
      const spec = { ax: a.x, ay: a.y, bx: b.x, by: b.y, nx, ny, height, thickness, face, top, dark };
      if (rampart) {
        const count = length < rampart.toothWidth ? 0 : Math.max(1, Math.round((length - rampart.toothWidth) / 8) + 1);
        const pitch = count > 1 ? (length - rampart.toothWidth) / (count - 1) : 0;
        const missing = [];
        for (let tooth = 0; tooth < count; tooth++) {
          const t = tooth * pitch / length;
          const damage = CastleStyles.damageCell(d.castleStyle || d.key,
            Math.floor((a.x + dx * t + nx * 0.01 - d.damageOriginX) / CELL_PX),
            Math.floor((a.y + dy * t + ny * 0.01 - d.damageOriginY) / CELL_PX));
          if ((rampart.broken && tooth % 4 === 2) || damage?.missing === tooth % 4) missing.push(tooth);
        }
        Object.assign(spec, { crownTop: stone.lite, toothWidth: rampart.toothWidth, toothHeight: rampart.toothHeight, missing });
      }
      if (d.tier === 11 && !temple) {
        const count = Math.max(1, Math.round(length / WallMaterials.WOOD.pitch));
        for (let j = 0; j < count; j++) {
          const lo = j / count, hi = Math.min(1, lo + WallMaterials.WOOD.width / length);
          WallPerspective.palisade(scene, 'polygon', { ...spec, tint: tune(shade(0xffffff)),
            ax: a.x + dx * lo, ay: a.y + dy * lo, bx: a.x + dx * hi, by: a.y + dy * hi });
        }
      } else {
        WallPerspective.addSegment(scene, 'polygon', spec);
        // Bounded bevel at a concave turn fills the wedge between inward
        // offsets. At convex turns the strips already overlap inside the ring.
        const previous = points[(i + points.length - 1) % points.length];
        const px = a.x - previous.x, py = a.y - previous.y, plen = Math.hypot(px, py);
        if (plen && (px * dy - py * dx) * winding < 0) {
          WallPerspective.prism(scene, 'polygon', [a,
            { x: a.x - py / plen * winding * thickness, y: a.y + px / plen * winding * thickness },
            { x: a.x + nx * thickness, y: a.y + ny * thickness }], 0, height, { face, top, dark });
        }
      }
    }
  }

  function uprightEdges(scene, d, isMine, projX, projY, seen) {
    const shade = shadeOf(isMine), tune = tuneOf(isMine);
    const stone = d.tier === CASTLE && !d.templeZone ? castleStone(isMine, d.castleStyle || d.key) : null;
    const temple = d.templeZone ? TempleArt.palette(isMine, d.templeKind === 'tar', true) : null;
    const depth = stone ? stone.style.rampart.wallHeight : facePx(d.tier);
    const face = temple ? temple.face : stone ? stone.style.stone.FACE : tune(shade(faceColor(d.tier, isMine)));
    const outline = temple ? temple.outline : stone ? stone.dark : tune(dim(shade(floorColor(d.tier, isMine)), OUTLINE_MUL));
    const points = d.pts;
    // Only outward south-facing edges retain the downward face after the
    // floor is erased from the piece. Their physical base includes that
    // face depth; the other edges end at the perimeter. Winding keeps the
    // classification stable for clockwise and counterclockwise rings.
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    const winding = Math.sign(area);
    const trace = (ctx) => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
    };
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (a.x === b.x && a.y === b.y) continue;
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / CELL_PX));
      // Crowns must composite after every cap: a tooth can cross the next
      // atlas section, whose opaque body would otherwise cut into its roof.
      const passes = stone ? 2 : 1;
      for (let section = 0; section < count * passes; section++) {
        const j = Math.floor(section / passes), crownPass = stone && section % passes === 1;
        const at = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        const p = at(j / count), q = at((j + 1) / count);
        const pad = SLOT_PAD;
        const x = Math.floor(Math.min(p.x, q.x) - pad);
        const y = Math.floor(Math.min(p.y, q.y) - pad);
        const w = Math.ceil(Math.max(p.x, q.x) + pad) - x;
        const h = Math.ceil(Math.max(p.y, q.y) + depth + pad) - y;
        if (x + w < scene.viewLeft - CELL_PX * 2 || x > scene.viewLeft + scene.viewSize + CELL_PX * 2
          || y + h < scene.viewTop - CELL_PX * 2 || y > scene.viewTop + scene.viewSize + CELL_PX * 2) continue;
        // World-relative placement: the same edge at a later camera cell sits
        // at the same offset from the projected world origin.
        const wx = x - projX(0), wy = y - projY(0);
        const cacheKey = `${d.seed}|${d.templeZone || ''}|${d.tier}|${stone?.style.id || ''}|${isMine ? 1 : 0}|${i}|${j}|${crownPass ? 1 : 0}|${Math.round(wx)}|${Math.round(wy)}|${w}|${h}`;
        const cached = scene._buildingUprightCache.get(cacheKey);
        if (cached) {
          if (!seen.has(cacheKey)) {
            seen.add(cacheKey);
            cached.x = projX(0) + cached.wx;
            cached.y = projY(0) + cached.wy;
            scene._buildingUprightPieces.push(cached);
          }
          continue;
        }
        const { page, slot, sx, sy } = allocSlot(scene);
        const A = scene._buildingWallAtlas;
        const ctx = page.ctx;
        // Paint into the slot: clear it (a freed slot still wears its last
        // piece), clip to it so the erase below can't reach a neighbour, and
        // move the piece's own pixel box onto it.
        ctx.save();
        ctx.clearRect(sx, sy, A.slotW, A.slotH);
        ctx.beginPath(); ctx.rect(sx, sy, A.slotW, A.slotH); ctx.clip();
        ctx.translate(sx - x, sy - y);
        let masonryBaseY = Math.max(p.y, q.y) + ((a.x - b.x) * winding > 1e-6 ? depth : 0);
        if (stone) {
          // The square map stays fixed. Lift the north edge and expose its
          // inward, south-facing face; the south edge projects beyond the floor.
          // For angled rings the inward normal blends those two profiles.
          const rampart = stone.style.rampart, cap = rampart.topDepth;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const nx = -(b.y - a.y) / length * winding;
          const ny = (b.x - a.x) / length * winding;
          // The north face lands at ground level even when the cap narrows;
          // wall height controls its lift, while cap depth controls thickness.
          const liftFor = normalY => cap + (depth - cap) * Math.max(0, normalY);
          const lift = liftFor(ny);
          const outer = v => ({ x: v.x, y: v.y - lift - cap * ny });
          const inner = v => ({ x: v.x + nx * cap, y: v.y - lift });
          const op = outer(p), oq = outer(q), ip = inner(p), iq = inner(q);
          masonryBaseY = -Infinity;
          let drawingCrown = false;
          const quad = (a, b, c, d, color) => {
            masonryBaseY = Math.max(masonryBaseY, a.y, b.y, c.y, d.y);
            if (drawingCrown !== crownPass) return;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
            ctx.fillStyle = cssOf(color); ctx.fill();
          };
          const down = (v, dy) => ({ x: v.x, y: v.y + dy });
          const fp = ny > 0 ? ip : op, fq = ny > 0 ? iq : oq;
          // Pure side edges have no south-facing vertical plane.
          if (Math.abs(ny) > 1e-6) {
            quad(fp, fq, down(fq, depth), down(fp, depth), face);
            quad(down(fp, depth - 1), down(fq, depth - 1), down(fq, depth), down(fp, depth), outline);
          }
          // A bounded bevel bridges the two edge-local cap profiles at
          // every convex or concave vertex. No miter can spike at acute bends.
          if (j === 0) {
            let previous = points[(i + points.length - 1) % points.length];
            for (let back = 2; previous.x === a.x && previous.y === a.y && back < points.length; back++)
              previous = points[(i + points.length - back) % points.length];
            const previousLength = Math.hypot(a.x - previous.x, a.y - previous.y);
            if (previousLength > 0) {
              const previousNx = -(a.y - previous.y) / previousLength * winding;
              const previousNy = (a.x - previous.x) / previousLength * winding;
              const previousOuter = { x: a.x, y: a.y - liftFor(previousNy) - cap * previousNy };
              const previousInner = { x: a.x + previousNx * cap, y: a.y - liftFor(previousNy) };
              const previousFront = previousNy > 0 ? previousInner : previousOuter;
              // The bevel needs a vertical face too: joining only the roof
              // leaves a daylight gap beneath angled and concave corners.
              if (Math.abs(previousFront.x - fp.x) > 1e-6) {
                quad(previousFront, fp, down(fp, depth), down(previousFront, depth), face);
                quad(down(previousFront, depth - 1), down(fp, depth - 1),
                  down(fp, depth), down(previousFront, depth), outline);
              }
              quad(previousOuter, op, ip, previousInner, stone.top);
            }
          }
          quad(op, oq, iq, ip, stone.top);
          const line = (a, b, color) => {
            if (crownPass) return;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.lineWidth = 1; ctx.strokeStyle = cssOf(color); ctx.stroke();
          };
          // Keep the rear highlight quiet; a dark front-lip stroke would
          // cut an unnecessary horizontal stripe through the wall body.
          const toward = ny < 0 ? -1 : 1;
          const lip = v => ({ x: v.x + nx * toward * 0.5, y: v.y + ny * toward * 0.5 });
          line(lip(ny < 0 ? ip : op), lip(ny < 0 ? iq : oq), stone.lite);
          // Seat full teeth at both endpoints; distribute the gaps near the
          // 8px rhythm, with the same phase across every atlas section.
          const damage = CastleStyles.damageCell(d.castleStyle || d.key,
            Math.floor(((p.x + q.x) / 2 + nx * 0.01 - d.damageOriginX) / CELL_PX),
            Math.floor(((p.y + q.y) / 2 + ny * 0.01 - d.damageOriginY) / CELL_PX));
          if (damage && !crownPass) {
            const at = damage.chip / CELL_PX;
            const x = p.x + (q.x - p.x) * at + nx * cap / 2;
            const y = p.y + (q.y - p.y) * at - lift - cap * ny / 2;
            ctx.fillStyle = cssOf(stone.style.stone.SHADOW);
            ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
          }
          drawingCrown = true;
          const teeth = length < rampart.toothWidth ? 0
            : Math.max(1, Math.round((length - rampart.toothWidth) / 8) + 1);
          const pitch = teeth > 1 ? (length - rampart.toothWidth) / (teeth - 1) : length;
          const first = Math.ceil(length * j / count / pitch - 1e-9);
          const last = Math.min(teeth, Math.ceil(length * (j + 1) / count / pitch - 1e-9));
          for (let tooth = first; tooth < last; tooth++) {
            if (rampart.broken && tooth % 4 === 2) continue;
            const t = tooth * pitch / length;
            if (t >= 1) continue;
            // Crown the rear edge, leaving the top plane visible in front
            // of the teeth, as in the tiled rampart's overhead profile.
            const crest = ny < 0 ? inner : outer;
            const v = crest({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
            if (damage && damage.missing === tooth % 4) continue;
            // A tooth follows the crest, rather than touching an angled
            // wall at the corner of an axis-aligned rectangle. The top is
            // rectangular in plan, spanning the full depth of the thinner cap.
            const endT = Math.min(1, t + rampart.toothWidth / length);
            const end = crest({ x: a.x + (b.x - a.x) * endT, y: a.y + (b.y - a.y) * endT });
            const front = v => ({ x: v.x + nx * toward * cap,
              y: v.y + ny * toward * cap });
            const base = [v, end, front(end), front(v)];
            const roof = base.map(v => down(v, -rampart.toothHeight));
            const toothWinding = winding * toward;
            for (let edge = 0; edge < 4; edge++) {
              const next = (edge + 1) % 4;
              if ((base[edge].x - base[next].x) * toothWinding <= 1e-6) continue;
              quad(roof[edge], roof[next], base[next], base[edge],
                edge === 2 ? face : stone.style.stone.SHADOW);
            }
            quad(roof[0], roof[1], roof[2], roof[3], stone.lite);
          }
        } else {
        // Extrude this edge downward, then remove its part inside the floor.
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
        ctx.lineTo(q.x, q.y + depth); ctx.lineTo(p.x, p.y + depth); ctx.closePath();
        ctx.fillStyle = cssOf(face); ctx.fill();
        // Work inside the face quadrilateral, then erase the floor below.
        // This keeps angled courses out of the court and caps every short
        // piece at the same height without changing its physical sort foot.
        ctx.save(); ctx.clip();
        const faceLine = (offset, color) => {
          ctx.beginPath(); ctx.moveTo(p.x, p.y + offset);
          ctx.lineTo(q.x, q.y + offset);
          ctx.lineWidth = 1; ctx.strokeStyle = cssOf(color); ctx.stroke();
        };
        const lip = temple ? temple.coping : stone ? stone.top
          : mix(face, tune(shade(floorColor(d.tier, isMine))), 0.48);
        const joint = mix(face, outline, 0.32);
        faceLine(0.5, lip);
        // Shallow courses give the taller face a material scale. The fort's
        // wooden footing keeps its grain as long horizontal seams.
        for (let course = 3; course < depth - 1; course += 3) {
          faceLine(course + 0.5, joint);
          if (d.tier === 11 && !temple) continue;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const spacing = 16, stagger = (Math.floor(course / 3) % 2) * spacing / 2;
          const first = Math.max(0, Math.ceil((length * j / count - stagger) / spacing));
          const last = Math.ceil((length * (j + 1) / count - stagger) / spacing);
          for (let jointIndex = first; jointIndex < last; jointIndex++) {
            const along = stagger + jointIndex * spacing;
            const t = along / length;
            const jx = a.x + (b.x - a.x) * t, jy = a.y + (b.y - a.y) * t;
            ctx.beginPath(); ctx.moveTo(jx, jy + Math.max(1, course - 3));
            ctx.lineTo(jx, jy + course); ctx.stroke();
          }
        }
        faceLine(depth - 0.5, outline);
        ctx.restore();
        ctx.globalCompositeOperation = 'destination-out';
        trace(ctx); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
        ctx.lineWidth = OUTLINE_PX;
        ctx.strokeStyle = cssOf(outline);
        ctx.stroke();
        }
        ctx.restore();
        page.dirty = true;
        // The piece's frame on its page. The slot bounds the piece by
        // construction (slotSize); the min is belt-and-braces against a
        // frame that would read a neighbour's pixels.
        const frame = `p${++page.seq}`;
        page.tex.add(frame, 0, sx, sy, Math.min(w, A.slotW), Math.min(h, A.slotH));
        const sprite = scene.add.image(x, y, page.key, frame).setOrigin(0, 0);
        scene.buildingWallContainer.add(sprite);
        const piece = {
          sprite, page, frame, slot, x, y, wx, wy, width: w, height: h, rank: 1,
          background: !crownPass,
          // Lowest visible masonry, excluding transparent frame padding.
          groundY: (masonryBaseY - projY(0)) * scene.cellM / CELL_PX,
        };
        scene._buildingUprightCache.set(cacheKey, piece);
        seen.add(cacheKey);
        scene._buildingUprightPieces.push(piece);
      }
    }
  }

  function invalidate(scene) {
    if (scene) scene._buildingGeomKey = null;
  }

  // The world→screen transform is a pure translation, so the geometry is drawn
  // ONCE at the cell-snapped camera position and the container scrolled by the
  // sub-cell fraction every frame (as the road overlay does).
  function draw(scene) {
    const g = fillTarget(scene);
    if (!g) return;
    const container = scene.buildingGeomContainer;
    // Off underground (cave tiles carry no building polygons) and off whenever
    // the tiled art is the one being drawn.
    const on = (scene.depth ?? 0) === 0 && enabled();
    if (container) container.setVisible(on);
    if (scene.buildingWallContainer) scene.buildingWallContainer.setVisible((scene.depth ?? 0) === 0);
    if (!on) {
      clearUprights(scene);
      scene._proceduralBuildings = new Map();
      if (typeof BuildingLowPoly !== 'undefined') BuildingLowPoly.clear(scene);
      if (typeof WallPerspective !== 'undefined') {
        WallPerspective.clear(scene, 'polygon');
        WallPerspective.clear(scene, 'home');
      }
      // Wipe the canvas the first time it goes off: setEnabled() invalidates
      // on its way out, and a hidden container full of last frame's buildings
      // would come back. `_buildingGeomPainted` tracks what is ON the canvas.
      if (scene._buildingGeomPainted) {
        g.clear();
        if (g.commit) g.commit();
        scene._buildingGeomPainted = false;
      }
      scene._buildingGeomKey = null;
      return;
    }

    // Camera anchor, not the body — a peek drag slides these footprints with
    // the ground they're painted on (coords.js overlayFrame → viewAnchorCell).
    // Keep padded paint across crossings. New tile inputs and the claim epoch
    // still repaint immediately: restoring a wreck or taking a castle must
    // lift the shade off that footprint on the next frame.
    const frame = overlayFrame(scene, (entry) => !!entry.buildingShapes || !!entry.retailInteriors || (Render.proceduralBuildings?.() && !!entry.objects));
    const { tiles } = frame;
    const previous = scene._buildingGeomKey ? scene._buildingGeomFrame : null;
    const paint = overlayPaintFrame(scene, frame, previous, claimEpoch(scene));
    let offset = paint;
    if (paint.rebuild) {
      // Null = the retained paint cannot follow the anchor (a teleport
      // outran its pad): spend this update's upload rather than show stale
      // geometry for a frame.
      const retained = retainedOverlayOffset(scene, previous, frame);
      if (claimOverlayRebuild(scene, 'building', !retained)) {
        scene._buildingGeomFrame = paint;
        scene._buildingGeomKey = paint.key;
        scene._buildingGeomPainted = true;
        timedOverlayRebuild('building overlay rebuild',
          () => rebuild(scene, tiles, paint.fracX, paint.fracY));
      } else {
        // Road used this update's one canvas upload. Keep both the retained
        // footprint canvas and its upright sprites seated from their old
        // anchor; this module rebuilds from latest claims/tiles next frame.
        offset = retained;
      }
    }
    if (scene._lowpoly) BuildingLowPoly.offset(scene, -offset.fracX * CELL_PX, -offset.fracY * CELL_PX);
    if (container) container.setPosition(-offset.fracX * CELL_PX, -offset.fracY * CELL_PX);
    if (typeof WallPerspective !== 'undefined') {
      WallPerspective.offset(scene, 'polygon', -offset.fracX * CELL_PX, -offset.fracY * CELL_PX);
      WallPerspective.offset(scene, 'home', -offset.fracX * CELL_PX, -offset.fracY * CELL_PX);
    }
    for (const p of scene._buildingUprightPieces || []) {
      const x = p.x - offset.fracX * CELL_PX, y = p.y - offset.fracY * CELL_PX;
      p.sprite.setPosition(x, y);
      // Keep the padded cache for the next crossing, but do not submit walls
      // wholly outside the world's viewport mask to the renderer. One pixel
      // of slack preserves filtered/rounded edge pixels at fractional scales.
      p.sprite.visible = x + p.width >= scene.viewLeft - 1
        && y + p.height >= scene.viewTop - 1
        && x <= scene.viewLeft + scene.viewSize + 1
        && y <= scene.viewTop + scene.viewSize + 1;
    }
  }

  // A cheap stamp that changes whenever a claim could have changed. The tiled
  // pass re-reads ownership every frame (it redraws every frame anyway); this
  // layer caches its canvas, so it needs a signal. House roles and shop lines
  // also matter: a renovation can change a roof without adding a claim.
  function specialtyFor(save, house) {
    const role = Houses.displayRole(save, house);
    return role === 'shop' ? Shops.lineFor(save, house).theme : role;
  }
  function authoredRecipe(scene,object,role){
    if(typeof AuthoredBuildings==='undefined')return null;
    const display=Houses.displayRole(scene.save,object);
    const themed=typeof DreamlandObjects!=='undefined'&&DreamlandObjects.buildingRecipe(object,scene,role);
    if(themed)return themed;
    return AuthoredBuildings.recipeFor(role,object.id,Shops.shopTier(scene.save,object,display)||1,
      role==='wizard'&&Houses.wizardTowerIdentity(scene.save,object)==='second');
  }
  function claimEpoch(scene) {
    const s = scene.save || {};
    const n = (o) => (o ? (Array.isArray(o) ? o.length : Object.keys(o).length) : 0);
    return [!!scene._headingUp,scene.game?.renderer?.type,Render.buildingArtStyle,scene.buildingRoofVariant,scene.buildingRoofDetail,scene.buildingStoreys].join(':') + ',' + n(s.restoredHouses) + ',' + n(s.unlockedForts) + ',' + n(s.claimedCastles)
      + ',' + JSON.stringify([s.restoredHouses, s.shopLines, s.shopTiers, s.bookshopId, s.petshopId, s.starterBlacksmithId])
      + ',' + (s.starterShopId || '') + ',' + Object.values(s.temples || {}).filter(r => r.active).length
      // Home's roof comes off while the player is inside (drawHome).
      + ',' + (scene.homeInside ? Number(!!scene.homeInside()) : '')
      + ',' + (scene.activeInterior?.()?.key || '');
  }

  function rebuild(scene, tiles, fracX, fracY) {
    const g = fillTarget(scene);
    g.clear();
    if (!scene._buildingUprightCache) clearUprights(scene);
    scene._buildingUprightPieces = [];
    const seen = new Set();
    if (scene.events && !scene._buildingUprightCleanup) {
      scene._buildingUprightCleanup = true;
      scene.events.once('shutdown', () => {
        clearUprights(scene);
        scene._buildingUprightCleanup = false;
        scene._buildingGeomKey = null;
        scene._buildingGeomTarget = null;
      });
    }
    // Standalone art exporters load the legacy Canvas painter without Phaser.
    const procedural = Render.proceduralBuildings?.() && !!scene.buildingWallContainer && typeof scene.add?.graphics === 'function';
    scene._proceduralBuildings = new Map();
    const perspective = typeof WallPerspective !== 'undefined' && (WallPerspective.active(scene) || procedural) && !!scene.buildingWallContainer;
    // This path also owns procedural walls in north-up mode. Their visibility
    // must not depend on a nearby temple or restored house enabling the group.
    if (perspective) WallPerspective.begin(scene, 'polygon').alwaysActive = true;
    else if (typeof WallPerspective !== 'undefined') WallPerspective.clear(scene, 'polygon');
    const lowpoly = typeof BuildingLowPoly !== 'undefined' && BuildingLowPoly.active(scene);
    if (lowpoly) BuildingLowPoly.begin(scene);
    else if (typeof BuildingLowPoly !== 'undefined') BuildingLowPoly.clear(scene);
    const separateUprights = !!(scene.buildingWallContainer && scene.add && scene.textures);
    // Home without the low-poly path (Canvas, north-up): its own retained
    // prisms, in the 'home' group, on at every heading. Opened by drawHome
    // and emptied here when Home is out of view.
    const homePrisms = separateUprights && typeof WallPerspective !== 'undefined'
      && typeof scene.add.graphics === 'function';
    if (homePrisms) WallPerspective.clear(scene, 'home');
    let homeBegun = false;
    // Cell-snapped projection (the container re-applies the sub-cell offset) —
    // the same one the road overlay strokes with — and its padded cull bounds.
    const { projX, projY, minX, maxX, minY, maxY } = overlayProjection(scene, fracX, fracY);

    // Use the same source street lines and projection as the road painter.
    const doorStreets = [];
    if (lowpoly && typeof RoadOverlay !== 'undefined' && typeof RoadOverlay.transportLines === 'function') {
      for (const { line, mvtToM, originMx, originMy } of RoadOverlay.transportLines(tiles.filter(t => t.entry.layers))) {
        for (let i = 1; i < line.length; i++) doorStreets.push([line[i-1], line[i]].map(p => ({
          x: projX(originMx + p.x * mvtToM), y: projY(originMy + p.y * mvtToM),
        })));
      }
    }

    // Per-pass memo of ownerKey → claimed, the same one the tiled pass keeps:
    // a footprint asks the save once instead of once per shape.
    const claimMemo = new Map();
    const claimed = (k) => {
      if (!k) return true;                       // no key = nothing to own
      let v = claimMemo.get(k);
      if (v === undefined) {
        v = scene.isClaimedKey ? scene.isClaimedKey(k) : true;
        claimMemo.set(k, v);
      }
      return v;
    };

    const GRID = gridStyle();
    const draws = [];
    const houses = new Map();
    for (const { entry } of tiles) for (const o of entry.objects || []) {
      if (o.kind === 'house') houses.set(o.id, o);
    }
    for (const { tx, ty, entry } of tiles) {
      const originMx = tx * entry.tileEdgeM;
      const originMy = ty * entry.tileEdgeM;
      const objects = (entry.objects || []).filter(o => o.kind === 'house');
      const objectsById = new Map(objects.map(o => [o.id, o]));
      const matched = new Set();
      const shapes = entry.clearedShapes
        ? entry.clearedShapes.map(s => ({ ...s, cleared: true })).concat(entry.buildingShapes || [])
        : (entry.buildingShapes || []);
      for (const shape of shapes) {
        if (!shape.cleared && objectsById.has(shape.key)) matched.add(shape.key);
        const r = shape.ring;
        if (!r || r.length < 6) continue;        // fewer than 3 points is not a footprint
        const pts = [];
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (let i = 0; i < r.length; i += 2) {
          const x = projX(originMx + r[i]);
          const y = projY(originMy + r[i + 1]);
          pts.push({ x, y });
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
        // Cull on the bounding box, grown by the wall depth so a building just
        // off the north edge still drops its face into view.
        const pad = procedural ? CELL_PX * 3 : facePx(shape.tier);
        if (bx1 + pad < minX || bx0 - pad > maxX || by1 + pad < minY || by0 - pad > maxY) continue;
        // Sandbox blocks can predate their hand-placed object IDs. Match only
        // an unambiguous contained house; shared blocks keep separate houses.
        let object = objectsById.get(shape.key), shared = false;
        if (procedural && !shape.cleared && String(shape.key).startsWith('sb_')) {
          const inside = objects.filter(o => inPoly(pts, projX(o.x), projY(o.y)));
          if (inside.length === 1) object = inside[0];
          shared = inside.length > 1;
          if (shared) {
            if (object) matched.delete(object.id);
            object = null;
          }
        }
        if (object && !shape.cleared) matched.add(object.id);
        draws.push({
          object, shared, pts, south: by1, left: bx0, north: by0, right: bx1, cleared: !!shape.cleared,
          tier: shape.tier, key: shape.key, templeZone: shape.templeZone, templeKind: shape.templeKind,
          damageOriginX: projX(originMx), damageOriginY: projY(originMy),
          // Home's doorway (scene_venues.js _stampHomeFootprint), projected.
          door: shape.door ? { x: projX(originMx + shape.door.x), y: projY(originMy + shape.door.y) } : null,
          columns: shape.tier === CASTLE && !shape.templeZone ? CastleStyles.columnSites(shape.key, r,
            entry.tileEdgeM / (entry.cellsPerEdge || scene.cellsPerTile))
            .map(p => ({ x: projX(originMx + p.x), y: projY(originMy + p.y), height: p.height })) : [],
          seed: seedOf(tx, ty, r, shape.key),
        });
      }
      // Objects without a source polygon (Home and authored sandbox fixtures)
      // still get a footprint-derived building, without changing world data.
      if (procedural) for (const o of objects) {
        if (matched.has(o.id) || o.tier === CASTLE) continue;
        const x = projX(o.x) + (o.footDx || 0) * CELL_PX;
        const y = projY(o.y) + (o.footDy || 0) * CELL_PX;
        const size = Math.max(CELL_PX, Math.min(CELL_PX * 3,
          Math.sqrt(o.area || scene.cellM * scene.cellM) / scene.cellM * CELL_PX));
        if (x + size < minX || x - size > maxX || y + size * 2 < minY || y - size * 2 > maxY) continue;
        const h = size / 2;
        draws.push({ object: o, key: o.id, tier: o.tier || 9, seed: 0, columns: [],
          pts: [{ x: x-h, y: y-h }, { x: x+h, y: y-h }, { x: x+h, y: y+h }, { x: x-h, y: y+h }],
          left: x-h, right: x+h, north: y-h, south: y+h });
      }
    }

    // A retail room uses the same open-roof house renderer and floor canvas.
    // Its source footprint survives POI frontage placement and civic dissolves.
    const room = scene.activeInterior?.();
    if (room?.kind === 'retail') {
      const project = ring => ring.map(p => ({ x: projX(p.x), y: projY(p.y) }));
      const pts = project(room.ring), holes = (room.holes || []).map(project);
      const left = Math.min(...pts.map(p => p.x)), right = Math.max(...pts.map(p => p.x));
      const north = Math.min(...pts.map(p => p.y)), south = Math.max(...pts.map(p => p.y));
      for (let i = draws.length - 1; i >= 0; i--) {
        const d = draws[i], epsilon = 0.1;
        const sameBounds = Math.abs(d.left - left) < epsilon && Math.abs(d.right - right) < epsilon
          && Math.abs(d.north - north) < epsilon && Math.abs(d.south - south) < epsilon;
        // Match the source ring, not its bounding box: another building can
        // cross an L-shaped mall's exterior notch or stand in its courtyard.
        // Ring start, winding and a duplicated closing point do not matter.
        const verticesMatch = (a, b) => a.every(p => b.some(q => Math.hypot(p.x - q.x, p.y - q.y) < epsilon));
        if (!d.templeZone && sameBounds && verticesMatch(d.pts, pts) && verticesMatch(pts, d.pts)) {
          if (d.object?.id) scene._proceduralBuildings.set(d.object.id, { height: 0 });
          draws.splice(i, 1);
        }
      }
      draws.push({ pts, holes, left, right, north, south, key: room.key,
        tier: 9, retail: true, columns: [], seed: 0 });
    }

    // Painter rule: the LOWER building draws in front. Ties break on the
    // leftmost x so the order is fully determined by the geometry rather than
    // by which tile happened to load first.
    // A cleared footprint's shadow lies on the ground, under every building.
    draws.sort((a, b) => (b.cleared - a.cleared) || (a.south - b.south) || (a.left - b.left));

    // Anchor the material patterns to the WORLD before anything is filled:
    // texturePoly paints immediately, so the phase has to be in hand first.
    if (g.texturePhase) g.texturePhase(projX(0), projY(0));

    for (const d of draws) {
      if (perspective) scene._wallPerspective.polygon.building = {
        key: d.key, footprint: d.pts,
        anchor: { x: (d.left + d.right) / 2, y: (d.north + d.south) / 2 },
      };
      // A house Home's trailer cleared (scene_venues.js _eraseHomeBuildings):
      // just the footprint, as a flat shadow — no walls, floor or outline.
      if (d.cleared) { g.fillPoly(d.pts, CLEARED_SHADOW, CLEARED_SHADOW_ALPHA); continue; }
      if (d.templeZone) {
        const active = Temples.isActive(scene.save, d);
        const palette = TempleArt.palette(active, d.templeKind === 'tar', true);
        // The rune floor stays at ground elevation. Its foundation descends
        // below it, while low capped walls rise above it at every heading.
        if (perspective) {
          scene._wallPerspective.polygon.alwaysActive = true;
          WallPerspective.prism(scene, 'polygon', d.pts, -TempleArt.geometry.foundationDepth, 0,
            { face: palette.face }, null, false);
          perspectiveEdges(scene, d, active);
        } else {
          g.fillPoly(d.pts.map(p => ({ x: p.x, y: p.y + TempleArt.geometry.foundationDepth })), palette.face);
        }
        if (g.templePoly) g.templePoly(d.pts, active, d.templeKind === 'tar');
        else { g.fillPoly(d.pts, palette.floor); g.strokePoly(d.pts, OUTLINE_PX, palette.outline); }
        continue;
      }
      // Dreamland's native facade replaces only an existing eligible house.
      // Keep its source ring for collision, roads and all other geometry.
      const trialHouse = d.object || houses.get(d.key);
      if (!d.retail && typeof WorldArtProfile !== 'undefined'
          && WorldArtProfile.houseKey(trialHouse, scene, Houses.displayRole(scene.save, trialHouse))) continue;
      const isMine = claimed(d.object?.id || d.key);
      // HOME — the player's house (HomeArea.HOUSE; its footprint is stamped by
      // scene_venues.js): the low-poly `home` role, open-roofed while the
      // player stands inside; without WebGL, its own prism walls (drawHome).
      if (d.retail || (d.key && scene.save && d.key === scene.save.starterShopId)) {
        const inside = d.retail || !!(scene.homeInside && scene.homeInside());
        drawHomeFloor(g, d, GRID, homePrisms || lowpoly);
        let model = null;
        if (lowpoly) {
          const object = d.object || { kind: 'house', id: d.key, tier: 9 };
          const profile = d.retail ? { style: 'whitewash', palette: {} } : Render.buildingProfileFor(object, scene);
          const palette = { ...BuildingStyles.STYLES[profile.style], ...profile.palette };
          const recipe = BuildingLowPoly.recipeFor('home',
            { wall: palette.wall, roof: palette.roof, trim: palette.trim ?? 0x614534 }, scene.buildingStoreys);
          recipe.interior = inside;
          recipe.authored = authoredRecipe(scene,object,'home');
          const variant = scene.buildingRoofVariant === 'styles' ? null : scene.buildingRoofVariant || recipe.variant || 'ridge';
          // Home's door is the save's doorway wall (the shape's door point,
          // chosen toward the nearest street at placement — scene_venues.js
          // _homeDoorSideToStreet), so the painted bay, the plank panel and
          // the prism doorway all agree; an adopted house without one asks
          // the streets like every other house.
          const entrance = d.door ? BuildingLowPoly.ringEdgeNearest(d.pts, d.door) : null;
          model = BuildingLowPoly.add(scene, d.pts, recipe, variant, object.id, doorStreets, entrance);
          if (d.retail) for (const [i, hole] of (d.holes || []).entries()) {
            BuildingLowPoly.add(scene, hole, recipe, variant, `${object.id}:court:${i}`, []);
          }
          if (model?.faces?.length) scene._proceduralBuildings.set(object.id, { height: model.height * BuildingLowPoly.LOOK.heightScale });
        }
        if (!model?.faces?.length) {
          if (homePrisms) {
            if (!homeBegun) {
              WallPerspective.begin(scene, 'home');
              scene._wallPerspective.home.alwaysActive = true;
              homeBegun = true;
            }
            scene._wallPerspective.home.building = {
              key: d.key, footprint: d.pts,
              anchor: { x: (d.left + d.right) / 2, y: (d.north + d.south) / 2 },
            };
            // Inside, every wall sorts against the player on its own
            // (WallPerspective perWall / worldPieces) — one graphics object
            // under the player's container would draw the player over the
            // walls in front of them.
            scene._wallPerspective.home.perWall = inside || room?.kind === 'retail';
            homeWalls(scene, d, HomeArea.HOUSE, inside);
            if (d.retail) for (const hole of d.holes || []) {
              homeWalls(scene, { ...d, pts: hole, door: null }, HomeArea.HOUSE, true);
            }
          } else if (!inside && typeof HomeArea !== 'undefined') {
            g.fillPoly(d.pts, HomeArea.HOUSE.roof.top);   // a bare fill target: a flat roof
          }
        }
        continue;
      }
      // Wizard retains its shrine sprite above a plain footprint.
      const role = d.object && Houses.displayRole(scene.save, d.object);
      if(role === 'wizard' && !lowpoly){
        g.fillPoly(d.pts,tuneOf(isMine)(shadeOf(isMine)(floorColor(d.tier,isMine))));continue;
      }
      // Forts keep their footprint palisade and plank floor; the reviewed
      // gearhouse replaces only the central hall sprite.
      // Turrets retain the intact tower sprite inside standard castle walls.
      // Only this draw uses the castle tier; world ownership and gameplay stay house-based.
      if (role === 'turret') {
        d.tier = CASTLE;
        d.castleStyle = CastleStyles.TURRET_STYLE;
      }
      if (procedural && !d.shared && d.tier === 9) {
        const object = d.object || { kind: 'house', id: d.key, tier: d.tier };
        const profile = Render.buildingProfileFor(object, scene);
        const styleId = profile.style;
        if (styleId === 'ruin') {
          const floor = tuneOf(isMine)(shadeOf(isMine)(floorColor(d.tier, isMine)));
          g.fillPoly(d.pts, floor);
          if (g.texturePoly) g.texturePoly(d.pts, d.tier);
          if (g.blobsPoly) g.blobsPoly(d.pts, slimeBlobs(d), d.left, d.north,
            slimeColor(floor, shadeOf(false)), SLIME_ALPHA);
          // Canvas uses BuildingStyles' broken-wall prisms below. Marking
          // this footprint covered here would suppress its sprite while
          // leaving only the floor, with no wreck walls at all.
        }
        let model;
        if (lowpoly) {
          const role = specialtyFor(scene.save, object);
          const base = BuildingStyles.STYLES[styleId], palette = {...base,...profile.palette};
          const paint = c => tuneOf(isMine)(shadeOf(isMine)(c));
          const recipe = BuildingLowPoly.recipeFor(role,{wall:paint(palette.wall),roof:paint(palette.roof),
                trim:role==='turret'?paint(palette.wall):undefined},Render.buildingStoreysFor(object, scene),isMine);
          if(typeof DreamlandObjects!=='undefined'&&DreamlandObjects.enabled
              &&role==='wreck'&&object.tier===9&&!object.castle)recipe.artProfile='dreamland';
          else if(typeof RogueObjects!=='undefined'&&RogueObjects.enabled
              &&role==='wreck'&&object.tier===9&&!object.castle)recipe.artProfile='rogue';
          recipe.authored = styleId==='ruin'?null:authoredRecipe(scene,object,role);
          // Restored recipes own their brass/copper palette; apply the same
          // background treatment after selection, including the recipe trim.
          if(recipe.facadeTrim==='brass')for(const key of ['body','roof','trim'])recipe[key]=paint(recipe[key]);
          else recipe.trim=paint(recipe.trim);
          const variant = scene.buildingRoofVariant === 'styles' ? null : scene.buildingRoofVariant
            || recipe.variant||'ridge';
          model = BuildingLowPoly.add(scene,d.pts,recipe,variant,object.id,doorStreets);
        } else model = BuildingStyles.emit(scene, 'polygon', d.pts, styleId, {
          claimed: isMine, palette: profile.palette,
          stories: Render.buildingStoreysFor(object, scene) ?? BuildingLowPoly.ROLES[specialtyFor(scene.save, object)]?.stories,
        });
        if (model && (model.faces?.length || model.prisms?.length)) {
          // Signs and flags seat on the drawn top: the low-poly path foreshortens height.
          if (object.id) scene._proceduralBuildings.set(object.id, { height: model.height * (lowpoly ? BuildingLowPoly.LOOK.heightScale : 1), mountedSign: !!model.mountedSign });
          continue;
        }
      }
      if(lowpoly&&role==='fort'&&typeof AuthoredBuildings!=='undefined'){
        const recipe=BuildingLowPoly.recipeFor('fort');
        recipe.authored=authoredRecipe(scene,d.object,'fort');
        const model=BuildingLowPoly.add(scene,d.pts,recipe,null,d.object.id);
        if(model?.faces?.length)scene._proceduralBuildings.set(d.object.id,{height:model.height*BuildingLowPoly.LOOK.heightScale});
      }
      const shade = shadeOf(isMine), tune = tuneOf(isMine);
      // The shaded floor is what the slime derives from (three shades deep —
      // see slimeColor); the material lift goes over every colour after.
      const style = d.tier === CASTLE ? buildingBackgroundMaterial(CastleStyles.get(d.castleStyle || d.key, isMine)) : null;
      const shaded = style ? style.floor : shade(floorColor(d.tier, isMine));
      const floor = style ? style.floor : tune(shaded);
      const depth = facePx(d.tier);
      if (d.tier === 9 && lowpoly && !d.shared && procedural) {
        const role = specialtyFor(scene.save, houses.get(d.key) || {kind:'house',id:d.key,tier:9});
        BuildingLowPoly.add(scene, d.pts, wallRecipe(role,scene.buildingStoreys,isMine), scene.buildingRoofVariant || 'ridge', d.key);
        continue;
      }
      if (d.tier === 9 && g.housePoly && (!Render.proceduralBuildings || Render.proceduralBuildings())) {
        g.housePoly(d.pts, floor, tune(shade(faceColor(d.tier, isMine))),
          tune(dim(shaded, OUTLINE_MUL)), specialtyFor(scene.save, houses.get(d.key)
            || { kind: 'house', id: d.key, tier: 9 }), scene.buildingRoofVariant, Render.buildingStoreysFor(d.object || {kind:'house',id:d.key,tier:9}, scene), d.seed, isMine);
        continue;
      }
      // The wall, as the ring filled again one face-depth south and painted
      // UNDER the floor: whatever survives is exactly the polygon's
      // south-facing edges, at any angle, with no per-edge normal test.
      if (!separateUprights || (d.tier === 9 && !perspective)) g.fillPoly(d.pts.map((p) => ({ x: p.x, y: p.y + depth })), (style ? style.stone.FACE : tune(shade(faceColor(d.tier, isMine)))));
      g.fillPoly(d.pts, floor);
      const damagedFloor = style?.id === 'ruin' && g.damagePoly
        && g.damagePoly(d.pts, d.key, isMine, d.damageOriginX, d.damageOriginY);
      if (!damagedFloor && g.texturePoly) g.texturePoly(d.pts, d.tier);
      // Dilapidated: the slime, over the floor and its material (it is growing
      // on them) but under the lattice, the rampart and the outline — the
      // building's own lines stay clean, only its floor is overgrown.
      if (!isMine && g.blobsPoly) {
        g.blobsPoly(d.pts, slimeBlobs(d), d.left, d.north, tune(slimeColor(shaded, shade)), style ? CASTLE_SLIME_ALPHA : SLIME_ALPHA);
      }
      // The cell grid goes on OVER the floor and its material: a hairline this
      // faint loses to a cobble or plank pattern laid on top of it.
      // Castle paving already carries its cell seams. A second lattice
      // beside those joints makes the stones read as doubled outlines.
      if (g.gridPoly && d.tier !== CASTLE) g.gridPoly(d.pts, gridInkFor(GRID, floor));
      if (d.columns.length && g.columnsPoly) g.columnsPoly(d.pts, d.columns, isMine);
      // House foundations descend below the textured floor, unlike ramparts.
      // Retain the whole perimeter: uncapped sides support concave OSM rings
      // without tessellating or rebaking their floor when the compass turns.
      if (perspective && d.tier === 9) {
        WallPerspective.prism(scene, 'polygon', d.pts, -depth, 0,
          { face: tune(shade(faceColor(d.tier, isMine))) }, null, false);
      }
      // Wall sections stay in the building background.
      if (separateUprights && d.tier !== 9) {
        if (perspective) perspectiveEdges(scene, d, isMine);
        else uprightEdges(scene, d, isMine, projX, projY, seen);
      } else if (d.tier === CASTLE) {
        // Rampart: the stone band inside the wall line, then the merlon teeth
        // dashed along it in the light stone — the polygon's answer to the
        // tiled battlements.
        const stone = castleStone(isMine, d.castleStyle || d.key);
        g.insetStroke(d.pts, BAND_PX, stone.body);
        if (style.rampart.woodTop) g.insetStroke(d.pts, 3, stone.top);
        const tooth = style.rampart.toothWidth;
        const dash = style.rampart.broken ? [tooth, 4, tooth - 1, 7] : [tooth, 8 - tooth];
        g.insetStroke(d.pts, MERLON_PX, stone.lite, dash);
        g.strokePoly(d.pts, OUTLINE_PX, stone.dark);
      } else {
        g.strokePoly(d.pts, OUTLINE_PX, tune(dim(shaded, OUTLINE_MUL)));
      }
    }
    if (perspective) scene._wallPerspective.polygon.building = null;
    // Pieces that scrolled out of view (or changed claim state) go.
    for (const [k, p] of scene._buildingUprightCache) {
      if (!seen.has(k)) { releasePiece(scene, p); scene._buildingUprightCache.delete(k); }
    }
    if (separateUprights) {
      Render.sortWorldDepth(scene._buildingUprightPieces);
      scene.buildingWallContainer.sort('depth');
      commitWallAtlas(scene);
    }
    if (lowpoly) BuildingLowPoly.update(scene);
    if (perspective) WallPerspective.finish(scene, 'polygon');
    if (homeBegun) WallPerspective.finish(scene, 'home');
    if (g.commit) g.commit();
  }

  // ── YOUR HOUSE ───────────────────────────────────────────────────────────
  // Home (HomeArea.HOUSE; scene_venues.js stamps its footprint) is the one
  // building the player walks into, so it is never a sprite. On the low-poly
  // path it is the `home` role (BuildingLowPoly.ROLES), and INSIDE
  // (scene.homeInside: the player stands on one of its cells) its recipe is
  // `interior`: no roof, the walls cut level at the eaves with their inner
  // faces and a top band showing their thickness, so the floor and the far
  // walls are the room; the lightmap masks everything outside (lighting.js
  // paintIndoorMask). The floor is painted on the canvas either way: the
  // roof covers it outside, the room shows it inside.
  //
  // Without the low-poly path (Canvas, north-up) the same house is retained
  // prisms in the 'home' group (homeWalls): walls with the fort's thickness
  // and a taller wall round the whole perimeter save a doorway on the door
  // side (shape.door), under a gabled two-tone roof with a ridge — and no
  // roof inside, with the wall tops in the wall's own colour.
  function drawHomeFloor(g, d, GRID, walled) {
    const tune = tuneOf(true);
    const tier = d.retail ? 9 : 11;
    const floor = tune(floorColor(tier, true));
    // No walls at all (a bare fill target): the tiled south face under the floor.
    if (!walled && !d.retail) g.fillPoly(d.pts.map((p) => ({ x: p.x, y: p.y + facePx(9) })), tune(faceColor(9, true)));
    g.fillPoly(d.pts, floor, undefined, d.holes);
    if (g.texturePoly) g.texturePoly(d.pts, tier, d.holes);
    if (g.gridPoly && !d.retail) g.gridPoly(d.pts, gridInkFor(GRID, floor));
    g.strokePoly(d.pts, OUTLINE_PX, tune(dim(floorColor(9, true), OUTLINE_MUL)));
  }
  // The door edge: the ring edge nearest the doorway point, and where along
  // it the doorway sits (0..1). Null without a doorway.
  function homeDoorEdge(points, door) {
    if (!door) return null;
    let best = null;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
      if (!len2) continue;
      const t = Math.max(0, Math.min(1, ((door.x - a.x) * dx + (door.y - a.y) * dy) / len2));
      const px = a.x + dx * t - door.x, py = a.y + dy * t - door.y;
      const dist = px * px + py * py;
      if (!best || dist < best.dist) best = { i, t, dist };
    }
    return best;
  }
  function homeWalls(scene, d, HA, inside) {
    const points = d.pts;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    const winding = Math.sign(area);
    const door = homeDoorEdge(points, d.door);
    const height = HA.wallPx, thickness = HA.thicknessPx;
    // Roofed, the wall tops are the eave line; inside, they are the wall's
    // own top course.
    const colors = { face: HA.wall.face, top: inside ? HA.wall.top : HA.roof.dark, dark: HA.wall.dark };
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (!length) continue;
      const nx = -dy / length * winding, ny = dx / length * winding;
      const spec = { ax: a.x, ay: a.y, bx: b.x, by: b.y, nx, ny, height, thickness, ...colors };
      if (door && door.i === i) {
        // The doorway: a gap HA.doorCells wide about the door point.
        const half = HA.doorCells * CELL_PX / 2 / length;
        const t0 = Math.max(0, door.t - half), t1 = Math.min(1, door.t + half);
        if (t0 > 0) WallPerspective.addSegment(scene, 'home', { ...spec, bx: a.x + dx * t0, by: a.y + dy * t0 });
        if (t1 < 1) WallPerspective.addSegment(scene, 'home', { ...spec, ax: a.x + dx * t1, ay: a.y + dy * t1 });
      } else {
        WallPerspective.addSegment(scene, 'home', spec);
      }
      // A concave turn's bevel, as the fort's (perspectiveEdges).
      const previous = points[(i + points.length - 1) % points.length];
      const px = a.x - previous.x, py = a.y - previous.y, plen = Math.hypot(px, py);
      if (plen && (px * dy - py * dx) * winding < 0) {
        WallPerspective.prism(scene, 'home', [a,
          { x: a.x - py / plen * winding * thickness, y: a.y + px / plen * winding * thickness },
          { x: a.x + nx * thickness, y: a.y + ny * thickness }], 0, height, colors);
      }
    }
    if (inside) return;
    // The roof. A quad is GABLED: the cap at wall height splits along the
    // long axis into the far slope (in shade) and the near slope (map-south,
    // toward the camera, lit), with the ridge raised along the join; its
    // dark eave lip shows on the camera-facing sides. Any other ring takes a
    // flat cap.
    const roof = { face: HA.roof.dark, top: HA.roof.top, dark: HA.roof.dark };
    if (points.length !== 4) {
      WallPerspective.prism(scene, 'home', points, height - 2, height, roof, null, true);
      return;
    }
    const [p0, p1, p2, p3] = points;
    const e1 = { x: p1.x - p0.x, y: p1.y - p0.y }, e2 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const along = Math.hypot(e1.x, e1.y) >= Math.hypot(e2.x, e2.y);
    const at = (p, e, t) => ({ x: p.x + e.x * t, y: p.y + e.y * t });
    // The two slopes, split across the short axis; the one whose centre is
    // further down the map (south) is the lit one.
    const halves = along
      ? [[p0, p1, at(p1, e2, 0.5), at(p0, e2, 0.5)], [at(p0, e2, 0.5), at(p1, e2, 0.5), p2, p3]]
      : [[p0, at(p0, e1, 0.5), at(p3, e1, 0.5), p3], [at(p0, e1, 0.5), p1, p2, at(p3, e1, 0.5)]];
    const centreY = (q) => q.reduce((n, p) => n + p.y, 0) / q.length;
    const [far, near] = centreY(halves[0]) <= centreY(halves[1]) ? halves : [halves[1], halves[0]];
    WallPerspective.prism(scene, 'home', far, height - 2, height, { ...roof, top: HA.roof.shade }, null, true);
    WallPerspective.prism(scene, 'home', near, height - 2, height, roof, null, true);
    // The ridge: a thin strip on the join, raised, lit along its crest.
    const half = 1.5 / Math.hypot(along ? e2.x : e1.x, along ? e2.y : e1.y);
    const strip = along
      ? [at(p0, e2, 0.5 - half), at(p1, e2, 0.5 - half), at(p1, e2, 0.5 + half), at(p0, e2, 0.5 + half)]
      : [at(p0, e1, 0.5 - half), at(p0, e1, 0.5 + half), at(p3, e1, 0.5 + half), at(p3, e1, 0.5 - half)];
    WallPerspective.prism(scene, 'home', strip, height, height + HA.ridgePx,
      { face: HA.roof.dark, top: HA.roof.lite, dark: HA.roof.dark }, null, true);
  }

  global.BuildingOverlay = { draw, enabled, setEnabled, specialtyFor, roofMesh, wallRecipe };
})(window);
