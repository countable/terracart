// Shared cel-pixel wall sheet and retained world-space triangles.
(function (global) {
  'use strict';
  const KEY = 'wall-materials-cel-v6', SIZE = 512, TILE = 128, PAD = 2;
  const WHITE = { u: 500 / SIZE, v: 500 / SIZE };
  // Square sixth-cell posts; alternate logs are 10% taller with equal carved tips.
  const WOOD = Object.freeze({ height: 14, tipHeight: 8.5, thickness: 32 / 6, width: 32 / 6, pitch: 32 / 6, shadeHeight: 11.25, staggerScale: 1.1, lowerTint: 0xe4e4e4 });
  const slots = { hedgeTop: 0, hedgeSide: 1, stoneTop: 2, stoneSide: 3, woodTop: 4, woodSide: 5, stoneEnd: 6, stonePlain: 7 };
  const colors = { hedgeTop: 0x4f813b, hedgeSide: 0x35633a, stoneTop: 0xc6baa4,
    stonePlain: 0xc6baa4, stoneSide: 0x968a76, stoneEnd: 0x968a76, woodTop: 0xb59969, woodSide: 0x9e7e50 };
  // Approved shared RA olive ramp, continuously interpolated by source luminance
  // (+12), then given the review's 20% saturation lift. Bake the eight painted
  // shades instead of reading back or recoloring a canvas during scene rebuilds.
  const rogueHedge = {
    '#294d30': '#525130', '#2f5934': '#5c5c36',
    '#35633a': '#656539', '#3f7035': '#70703e',
    '#457744': '#787840', '#477735': '#777740',
    '#4f813b': '#818143', '#629347': '#949445'
  };
  const rogueEnabled = () => typeof RogueObjects !== 'undefined' && RogueObjects.enabled;
  const materialColor = material => rogueEnabled() && material.startsWith('hedge')
    ? parseInt(rogueHedge['#' + colors[material].toString(16)].slice(1), 16) : colors[material];
  const hash = (x, y) => ((Math.imul(x + 173, 374761393) ^ Math.imul(y + 97, 668265263)) >>> 0) / 4294967296;
  function postHeight(index = 0) {
    const total = WOOD.height + WOOD.tipHeight;
    return (Math.trunc(index) & 1) ? total * WOOD.staggerScale - WOOD.tipHeight : WOOD.height;
  }
  function multiplyColors(a, b) {
    const channel = shift => Math.round(((a >>> shift) & 255) * ((b >>> shift) & 255) / 255);
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }
  function prepare(scene) {
    if (!scene.textures?.createCanvas || !scene.textures?.exists) return null;
    const rogue = rogueEnabled(), key = KEY + (rogue ? '-rogue' : '');
    if (scene.textures.exists(key)) return scene.textures.get(key);
    const texture = scene.textures.createCanvas(key, SIZE, SIZE), g = texture.getContext();
    for (const name of Object.keys(slots)) {
      const slot = slots[name], ox = slot % 4 * TILE + PAD, oy = Math.floor(slot / 4) * TILE + PAD, n = TILE - PAD * 2;
      g.save(); g.translate(ox, oy); g.beginPath(); g.rect(0, 0, n, n); g.clip();
      const fill = (color, x, y, w, h) => {
        g.fillStyle = rogue && name.startsWith('hedge') ? (rogueHedge[color] || color) : color;
        g.fillRect(x, y, w, h);
      };
      fill('#' + colors[name].toString(16).padStart(6, '0'), 0, 0, n, n);
      if (name.startsWith('hedge')) {
        const side = name === 'hedgeSide';
        fill(side ? '#2f5934' : '#477735', 0, 0, n, n);
        for (let y = -8; y < n; y += 10) for (let x = -8; x < n; x += 12) {
          const v = hash(x, y), xx = x + Math.floor(hash(y, x) * 7), yy = y + Math.floor(v * 5);
          fill(side ? '#35633a' : '#4f813b', xx + 1, yy + 1, 8, 5);
          fill(side ? '#35633a' : '#4f813b', xx + 3, yy, 4, 7);
          if (v > .24) fill(side ? '#457744' : '#629347', xx + 2, yy + 1, 4, 1);
          if (v > .4) fill(side ? '#294d30' : '#3f7035', xx + 6, yy + 6, 2, 1);
        }
      } else if (name === 'stoneTop' || name === 'stonePlain') {
        for (let y = 3; y < n; y += 11) for (let x = 3; x < n; x += 13) {
          const v = hash(x, y);
          if (v > .48) fill(v > .8 ? '#d0c5b0' : '#bcb19b', x, y, 2, 1);
        }
        // One stone across the width, with only transverse cap joints.
        if (name === 'stoneTop') fill('#968d7d', Math.floor(n / 2), 0, 3, n);
      } else if (name === 'stoneSide' || name === 'stoneEnd') {
        for (let row = 0; row < 2; row++) {
          const y = row * n / 2;
          fill(row % 2 ? '#9e917d' : '#a29682', 0, y, n, n / 2);
          if (row) fill('#706c62', 0, y, n, 5);
          if (name === 'stoneSide') for (let x = (row % 2) * n / 4; x < n; x += n / 2) fill('#706c62', x, y + 5, 3, n / 2 - 5);
        }
        fill('#827764', 0, n * .76, n, n * .24);
        fill('#746a58', 0, n - 15, n, 8); fill('#615b50', 0, n - 7, n, 7);
      } else if (name === 'woodSide') {
        // Warm plank-floor browns with Rogue Adventure's sparse grain. Broad vertical
        // bands give square faces weight; the mesh owns the half-height step.
        fill('#675035', 0, 0, 10, n); fill('#675035', n - 10, 0, 10, n);
        fill('#82653f', 10, 0, 15, n); fill('#82653f', n - 25, 0, 15, n);
        fill('#b59969', 32, 0, 17, n);
        fill('#82653f', 73, 38, 6, 26); fill('#82653f', 86, 81, 5, 17);
      }
      g.restore();
      // Duplicate border texels so affine Canvas and GPU filtering cannot bleed atlas neighbours.
      g.drawImage(texture.getSourceImage(), ox, oy, n, 1, ox, oy - PAD, n, PAD);
      g.drawImage(texture.getSourceImage(), ox, oy + n - 1, n, 1, ox, oy + n, n, PAD);
      g.drawImage(texture.getSourceImage(), ox, oy - PAD, 1, TILE, ox - PAD, oy - PAD, PAD, TILE);
      g.drawImage(texture.getSourceImage(), ox + n - 1, oy - PAD, 1, TILE, ox + n, oy - PAD, PAD, TILE);
    }
    g.fillStyle = '#ffffff'; g.fillRect(496, 496, 8, 8);
    texture.refresh();
    texture.setFilter(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);
    return texture;
  }
  function clip(poly, axis, bound, greater) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ai = greater ? a[axis] >= bound : a[axis] <= bound,
        bi = greater ? b[axis] >= bound : b[axis] <= bound;
      if (ai) out.push(a);
      if (ai !== bi) {
        const t = (bound - a[axis]) / (b[axis] - a[axis]), p = {};
        for (const k of ['x', 'y', 'z', 's', 't']) p[k] = a[k] + (b[k] - a[k]) * t;
        out.push(p);
      }
    }
    return out;
  }
  // Split only at texture repeat boundaries; individual texels never create geometry.
  function surface(result, points, material, normal, tint = 0xffffff) {
    const slot = slots[material], ox = slot % 4 * TILE + PAD, oy = Math.floor(slot / 4) * TILE + PAD;
    const lo = Math.floor(Math.min(...points.map(p => p.s))), hi = Math.ceil(Math.max(...points.map(p => p.s)));
    const bottom = Math.floor(Math.min(...points.map(p => p.t))), top = Math.ceil(Math.max(...points.map(p => p.t)));
    for (let s = lo; s < Math.max(lo + 1, hi); s++) for (let t = bottom; t < Math.max(bottom + 1, top); t++) {
      let ring = clip(clip(points, 's', s, true), 's', s + 1, false);
      ring = clip(clip(ring, 't', t, true), 't', t + 1, false);
      if (ring.length < 3) continue;
      ring = ring.map(p => ({ x: p.x, y: p.y, z: p.z,
        u: (ox + (p.s - s) * (TILE - PAD * 2)) / SIZE,
        v: (oy + (p.t - t) * (TILE - PAD * 2)) / SIZE }));
      for (let i = 1; i + 1 < ring.length; i++) result.push({ points: [ring[0], ring[i], ring[i + 1]], normal, color: tint, flatColor: multiplyColors(materialColor(material), tint) });
    }
  }
  // Clipped hedges are bushes, not masonry: convex corners round off in plan,
  // the exposed sides roll over a quarter-round shoulder into the crown, and
  // the shoulder dips a little at hashed world positions so long runs read
  // leafy. The crown cap stays flat at the step-over height: its long slivers
  // would flip winding under projection if their vertices dipped apart.
  // Open (joined) edges stay square and every wobble is keyed to the world
  // point, so neighbouring cells still meet on identical vertices.
  const HEDGE = { corner: 6, shoulder: 4.5, rise: 4.5, bands: 2, step: 8, dip: 1.8, footInset: 1.5, footRise: 2.5, repeat: 124 };
  function roundHedgeOutline(points, open) {
    const n = points.length, ring = [], flags = [];
    for (let i = 0; i < n; i++) {
      const prev = points[(i + n - 1) % n], p = points[i], next = points[(i + 1) % n];
      const la = Math.hypot(p.x - prev.x, p.y - prev.y), lb = Math.hypot(next.x - p.x, next.y - p.y);
      const u = { x: (p.x - prev.x) / la, y: (p.y - prev.y) / la }, w = { x: (next.x - p.x) / lb, y: (next.y - p.y) / lb };
      const convex = u.x * w.y - u.y * w.x > 1e-8, r = Math.min(HEDGE.corner, la / 2, lb / 2);
      if (!convex || open[(i + n - 1) % n] || open[i] || r <= 0) { ring.push(p); flags.push(!!open[i]); continue; }
      // Quarter-round between the two tangent points (outlines are axis-aligned).
      const nPrev = { x: u.y, y: -u.x }, centre = { x: p.x - u.x * r - nPrev.x * r, y: p.y - u.y * r - nPrev.y * r };
      for (let k = 0; k <= 3; k++) {
        const a = k / 3 * Math.PI / 2, last = ring[ring.length - 1];
        // Two arcs that consume a whole edge share their tangent point.
        if (k === 0 && last && Math.hypot(last.x - (p.x - u.x * r), last.y - (p.y - u.y * r)) < 1e-6) continue;
        ring.push({ x: centre.x + nPrev.x * r * Math.cos(a) + u.x * r * Math.sin(a),
          y: centre.y + nPrev.y * r * Math.cos(a) + u.y * r * Math.sin(a) });
        flags.push(k === 3 ? !!open[i] : false);
      }
    }
    if (ring.length > 1 && Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y) < 1e-6) { ring.pop(); flags.pop(); }
    // Split long closed runs so the crown has vertices to dip between.
    const out = [], outFlags = [];
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length], parts = flags[i] ? 1 : Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / HEDGE.step));
      for (let k = 0; k < parts; k++) { out.push({ x: a.x + (b.x - a.x) * k / parts, y: a.y + (b.y - a.y) * k / parts }); outFlags.push(flags[i]); }
    });
    return { points: out, open: outFlags };
  }
  function hedgeGeometry(points, height, options) {
    const faces = [], rounded = roundHedgeOutline(points, options.openEdges || []), open = rounded.open;
    points = rounded.points;
    const n = points.length, originX = options.textureOriginX || 0, originY = options.textureOriginY || 0;
    const normals = points.map((a, i) => { const b = points[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.y - a.y) / l, y: (a.x - b.x) / l }; });
    const inset = d => points.map((p, i) => {
      const prev = (i + n - 1) % n, a = normals[prev], b = normals[i], da = open[prev] ? 0 : d, db = open[i] ? 0 : d;
      const det = a.x * b.y - a.y * b.x;
      if (Math.abs(det) < 1e-8) return { x: p.x - b.x * db, y: p.y - b.y * db };
      return { x: p.x + (-da * b.y + db * a.y) / det, y: p.y + (-db * a.x + da * b.x) / det };
    });
    const rise = Math.min(HEDGE.rise, height / 2), shoulder = Math.min(HEDGE.shoulder, rise);
    const wall = height - rise, foot = Math.min(HEDGE.footRise, wall);
    const dip = p => hash(Math.round((p.x + originX) * 4), Math.round((p.y + originY) * 4)) * HEDGE.dip;
    // The profile from the ground up: a tucked-in foot, the clipped face, then
    // the quarter-round shoulder whose upper half takes the crown's leaves.
    const rings = [{ ring: inset(HEDGE.footInset).map(p => ({ ...p, z: 0 })) }, { ring: inset(0).map(p => ({ ...p, z: foot })) }];
    for (let k = 0; k <= HEDGE.bands; k++) {
      const a = k / HEDGE.bands * Math.PI / 2, lift = Math.sin(a);
      rings.push({ crown: k >= HEDGE.bands / 2 + 1, ring: inset(shoulder * (1 - Math.cos(a)))
        .map(p => ({ ...p, z: k < HEDGE.bands ? wall + rise * lift - dip(p) * lift : height })) });
    }
    const top = p => ({ ...p, s: (p.x + originX) / HEDGE.repeat, t: (p.y + originY) / HEDGE.repeat });
    const side = (p, alongX) => ({ ...p, s: ((alongX ? p.x + originX : p.y + originY)) / HEDGE.repeat, t: 1 - p.z / HEDGE.repeat });
    // Every band culls by projected winding (normal null), so the leaning
    // foot and shoulder show exactly when they face the camera: order each
    // quad so its 3D normal points outward.
    const outward = (quad, normal) => {
      const [a, b, c] = quad, ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      return nx * normal.x + ny * normal.y + nz * .1 >= 0 ? quad : quad.slice().reverse();
    };
    for (let k = 0; k + 1 < rings.length; k++) {
      const lo = rings[k].ring, hi = rings[k + 1].ring, crown = rings[k + 1].crown;
      for (let i = 0; i < n; i++) {
        if (open[i]) continue;
        const j = (i + 1) % n, alongX = Math.abs(points[j].x - points[i].x) >= Math.abs(points[j].y - points[i].y);
        const quad = outward([lo[i], lo[j], hi[j], hi[i]], normals[i]).map(p => crown ? top(p) : side(p, alongX));
        surface(faces, quad, crown ? 'hedgeTop' : 'hedgeSide', null, k === 0 ? 0xc4cfc0 : 0xffffff);
      }
    }
    for (const tri of global.PolygonGeometry.triangulate(rings[rings.length - 1].ring)) surface(faces, tri.map(top), 'hedgeTop', null);
    if (options.tint != null) for (const face of faces) {
      face.color = multiplyColors(face.color, options.tint);
      face.flatColor = multiplyColors(face.flatColor, options.tint);
    }
    return faces;
  }
  // Approved dense field: global blade seats avoid seams when cells rebuild.
  const GRASS = Object.freeze({ texture: 'grass-blades-v1', width: 5.6, height: 11.9, spacing: 4.2, stagger: 1, rootShade: .45 });
  function prepareGrass(scene) {
    if (!scene.textures?.createCanvas) return null;
    if (scene.textures.exists(GRASS.texture)) return scene.textures.get(GRASS.texture);
    const texture = scene.textures.createCanvas(GRASS.texture, 16, 16), g = texture.getContext();
    for (let style = 0; style < 2; style++) {
      g.save(); g.translate(style * 8, 0);
      g.fillStyle = style ? '#955878' : '#87963d'; g.beginPath();
      if (!style) {
        const points = [[3,16],[1,10],[1,5],[2,1],[5,0],[6,3],[7,7],[6,11],[5,16]];
        points.forEach(([x,y], i) => i ? g.lineTo(x,y) : g.moveTo(x,y));
      } else {
        g.moveTo(3,16); g.quadraticCurveTo(3,12,2,10); g.quadraticCurveTo(1,8,1,6);
        g.quadraticCurveTo(1,2,3,0); g.lineTo(6,0); g.quadraticCurveTo(7,3,7,6);
        g.quadraticCurveTo(7,8,6,10); g.quadraticCurveTo(5,12,5,16);
      }
      g.closePath(); g.fill(); g.save(); g.clip();
      g.fillStyle = style ? '#e5a0c0' : '#c2c966'; g.beginPath();
      if (!style) { g.moveTo(4,16); g.lineTo(3,7); g.lineTo(4,0); g.lineTo(8,0); g.lineTo(8,16); }
      else {
        g.moveTo(4,16); g.quadraticCurveTo(4,12,3,10); g.quadraticCurveTo(2,8,2,6);
        g.quadraticCurveTo(2,2,4,0); g.lineTo(6,0); g.quadraticCurveTo(7,3,7,6);
        g.quadraticCurveTo(7,8,6,10); g.quadraticCurveTo(5,12,5,16);
      }
      g.closePath(); g.fill(); g.restore();
      g.globalCompositeOperation = 'source-atop';
      for (let y = 0; y < 16; y++) { g.fillStyle = `rgba(0,0,0,${GRASS.rootShade*y/15})`; g.fillRect(0,y,8,1); }
      g.restore();
    }
    texture.refresh(); texture.setFilter(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);
    return texture;
  }
  function grassGeometry(points, options = {}) {
    const faces = [], size = options.cellSize || 32, spacing = GRASS.spacing;
    const cellX = options.cellIX || 0, cellY = options.cellIY || 0;
    const minX = cellX * size, minY = cellY * size;
    const ox = points.reduce((n,p) => n+p.x,0)/points.length-size/2;
    const oy = points.reduce((n,p) => n+p.y,0)/points.length-size/2;
    const u0 = options.underdark ? .5005 : .0005, u1 = options.underdark ? .9995 : .4995;
    for (let row = Math.ceil(minY/spacing-.5); row < Math.ceil((minY+size)/spacing-.5); row++) {
      for (let col = Math.ceil((minX-GRASS.stagger)/spacing-.5); col < Math.ceil((minX+size+GRASS.stagger)/spacing-.5); col++) {
        let h = Math.imul(col,374761393)^Math.imul(row,668265263);
        h = Math.imul(h^(h>>>13),1274126177); h = (h^(h>>>16))>>>0;
        const wx = (col+.5)*spacing+(h%3-1)*GRASS.stagger;
        if (wx < minX || wx >= minX+size) continue;
        const x = ox+wx-minX, y = oy+(row+.5)*spacing-minY, half = GRASS.width/2;
        const quad = [{x:x-half,y,z:0,u:u0,v:.999},{x:x+half,y,z:0,u:u1,v:.999},
          {x:x+half,y,z:GRASS.height,u:u1,v:.001},{x:x-half,y,z:GRASS.height,u:u0,v:.001}];
        const billboard = { x, y };
        for (const ids of [[0,1,2],[0,2,3]]) faces.push({points:ids.map(i=>quad[i]), billboard,
          normal:null,twoSided:true,color:0xffffff,flatColor:options.underdark?0xb36f91:0x87963d});
      }
    }
    return faces;
  }
  function geometry(kind, points, height, options = {}) {
    if (kind === 'grass') return grassGeometry(points, options);
    const wood = kind === 'wood' || kind === 'fort', hedge = kind === 'hedge';
    if (hedge && points.length >= 3 && height > 0) return hedgeGeometry(points, height, options);
    const prefix = wood ? 'wood' : hedge ? 'hedge' : 'stone', faces = [], n = points.length;
    const shadeHeight = wood ? (height + WOOD.tipHeight) / 2 : 0;
    if (n < 3 || height <= 0) return faces;
    const open = options.openEdges || [], d = hedge ? 1.6 : .7, bevel = Math.min(height / 3, hedge ? 1.5 : .65);
    const normals = points.map((a, i) => { const b = points[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.y - a.y) / l, y: (a.x - b.x) / l }; });
    const cap = points.map((p, i) => {
      const prev = (i + n - 1) % n, a = normals[prev], b = normals[i], da = open[prev] ? 0 : d, db = open[i] ? 0 : d;
      const det = a.x * b.y - a.y * b.x;
      if (Math.abs(det) < 1e-8) return { x: p.x - b.x * db, y: p.y - b.y * db };
      return { x: p.x + (-da * b.y + db * a.y) / det, y: p.y + (-db * a.x + da * b.x) / det };
    });
    const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
    const horizontal = Math.max(...points.map(p => p.x)) - minX >= Math.max(...points.map(p => p.y)) - minY;
    const originX = options.textureOriginX || 0, originY = options.textureOriginY || 0;
    const topPoint = (p, runHorizontal = horizontal) => ({ ...p, z: height, s: hedge ? (p.x + originX) / 124 : ((runHorizontal ? p.x + originX : p.y + originY) / 14),
      t: hedge ? (p.y + originY) / 124 : ((runHorizontal ? p.y + originY : p.x + originX) / 32) });
    function topSurface(poly, normal, tint = 0xffffff) {
      // Connected arms keep transverse seams along their own run. Splits occur
      // only at the five footprint regions, never at individual texels.
      if (!hedge && options.capRegions?.length) {
        for (const region of options.capRegions) {
          let ring = clip(clip(poly, 'x', region.x0, true), 'x', region.x1, false);
          ring = clip(clip(ring, 'y', region.y0, true), 'y', region.y1, false);
          if (ring.length < 3) continue;
          surface(faces, ring.map(p => ({ ...topPoint(p, region.horizontal), z: p.z })),
            region.joints === false ? 'stonePlain' : 'stoneTop', normal, tint);
        }
      } else surface(faces, poly.map(p => ({ ...topPoint(p), z: p.z })), prefix + 'Top', normal, tint);
    }
    if (!wood) {
      const tris = global.PolygonGeometry.triangulate(cap);
      for (const tri of tris) topSurface(tri.map(p => ({ ...p, z: height, s: 0, t: 0 })), null);
    }
    const center = { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
    const across = p => p.x * .8 - p.y * .6;
    const minAcross = Math.min(...points.map(across)), spanAcross = Math.max(...points.map(across)) - minAcross;
    for (let i = 0; i < n; i++) {
      if (open[i]) continue;
      const j = (i + 1) % n, a = points[i], b = points[j], normal = normals[i], low = wood ? height : height - bevel;
      const alongX = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y), repeat = hedge ? 124 : 28;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const sidePoint = (p, z, end) => ({ ...p, z,
        s: wood ? (across(p) - minAcross) / spanAcross : (alongX ? p.x + originX : p.y + originY) / repeat,
        t: 1 - z / (hedge ? 124 : wood ? height + WOOD.tipHeight : low) });
      const tint = wood ? (normal.x * .6 + normal.y * .8 > .35 ? 0xdfcdb8 : normal.x * .6 + normal.y * .8 < -.35 ? 0xffffff : 0xf1e4d2) : 0xffffff;
      if (distance > 1e-8) {
        // Two discrete bands also reach Canvas's flat-material fallback.
        // UVs stay continuous: the colour step must not restart the grain.
        const levels = wood ? [0, Math.min(shadeHeight, low), low] : [0, low];
        for (let band = 1; band < levels.length; band++) {
          const z0 = levels[band - 1], z1 = levels[band];
          if (z1 <= z0) continue;
          surface(faces, [sidePoint(a, z0, 0), sidePoint(b, z0, 1), sidePoint(b, z1, 1), sidePoint(a, z1, 0)],
            (!wood && !hedge && distance <= 8 ? 'stoneEnd' : prefix + 'Side'), normal,
            wood && z0 < shadeHeight ? multiplyColors(tint, WOOD.lowerTint) : tint);
        }
      }
      if (wood) {
        // One carved pole: carry the shaft's grain, UVs and face shade
        // straight into its longer point instead of adding a bright cap.
        surface(faces, [sidePoint(a, height), sidePoint(b, height),
          sidePoint(center, height + WOOD.tipHeight)], 'woodSide', null, tint);
      } else {
        const edge = [topPoint(a), topPoint(b), topPoint(cap[j]), topPoint(cap[i])];
        edge[0].z = edge[1].z = low;
        topSurface(edge, normal, hedge ? 0xffffff : 0xd5c9b6);
      }
    }
    if (options.tint != null) for (const face of faces) {
      face.color = multiplyColors(face.color, options.tint);
      face.flatColor = multiplyColors(face.flatColor, options.tint);
    }
    return faces;
  }
  global.WallMaterials = { prepare, prepareGrass, geometry, postHeight, WOOD, HEDGE, GRASS, KEY, WHITE };
})(globalThis);
