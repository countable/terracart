// One material family for each castle's tower, ramparts and courtyard.
// Identity is stable across tile loads; restoration changes its condition only.
(function (global) {
  const variants = [
    { id: 'citadel', name: 'Citadel', floor: 0xaaa7a4,
      stone: { LITE: 0xc4c0bb, BODY: 0x999795, FACE: 0x858487, SIDE: 0x797a80, SHADOW: 0x5b5d67, DARK: 0x393d49 },
      rampart: { merlons: 4, toothHeight: 3, wallHeight: 10, topDepth: 3.6 } },
    { id: 'ruin', name: 'Bastion', guards: false, questType: 'hunt', floor: 0xa6a087,
      stone: { LITE: 0xbdb9a4, BODY: 0x959a85, FACE: 0x858c79, SIDE: 0x747e6c, SHADOW: 0x596957, DARK: 0x384b3f },
      rampart: { merlons: 4, toothHeight: 2.5, wallHeight: 10, topDepth: 3.6, broken: true } },
    { id: 'bastion', name: 'Intact Bastion', guards: false, questType: 'kill', floor: 0xc3b597,
      stone: { LITE: 0xd4cbb7, BODY: 0xb7aa91, FACE: 0xa2977f, SIDE: 0x968b77, SHADOW: 0x756d5d, DARK: 0x4f4a41 },
      rampart: { merlons: 4, toothHeight: 3, wallHeight: 10, topDepth: 3.6 } },
    { id: 'archive', name: 'Old Archive Court', guards: false, questType: 'deliver', questTypes: ['deliver', 'luxury'], floor: 0xb3a88c,
      stone: { LITE: 0xc6bca5, BODY: 0xa49c88, FACE: 0x928b7b, SIDE: 0x827e72, SHADOW: 0x656559, DARK: 0x444a43 },
      rampart: { merlons: 4, toothHeight: 2.5, wallHeight: 10, topDepth: 3.6, woodTop: true } },
  ];
  const wood = { LITE: 0xc2a16b, BODY: 0x967549, FACE: 0x80613e, SHADOW: 0x624e37, DARK: 0x423b2d };
  const ids = variants.map(v => v.id);
  const cache = new Map();
  function variantFor(key) {
    if (ids.includes(key)) return key;
    let h = 0x811c9dc5;
    for (const ch of String(key || 'castle')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    return ids[(h >>> 0) % ids.length];
  }
  // Quest selection uses a hash bit above the two style bits. Reusing the
  // low parity bit would give every Archive the same job. The four styles
  // and their hash assignment remain unchanged, including existing saves.
  function questTypeFor(key, variant) {
    const style = variants.find(v => v.id === variantFor(variant || key));
    if (!style.questTypes || ids.includes(key)) return style.questType || null;
    let h = 0x811c9dc5;
    for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    return style.questTypes[(h >>> 2) % style.questTypes.length];
  }
  // A shared, pure condition treatment, already baked into every returned
  // colour. Callers must not apply the general building wash a second time.
  function weathered(c, floor = false) {
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    // Floors get a small additional lift so the masonry reads against them.
    const lift = floor ? 0.08 : 0;
    return (Math.round(r * (0.80 + lift)) << 16)
      | (Math.round(g * (0.82 + lift)) << 8) | Math.round(b * (0.78 + lift));
  }
  function get(keyOrVariant, claimed = true) {
    const id = variantFor(keyOrVariant), key = `${id}:${claimed ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);
    const source = variants.find(v => v.id === id);
    const paint = c => claimed ? c : weathered(c);
    const palette = p => Object.freeze(Object.fromEntries(Object.entries(p).map(([k, c]) => [k, paint(c)])));
    const value = Object.freeze({ id, name: source.name, guards: source.guards !== false, questType: source.questType || null,
      floor: claimed ? source.floor : weathered(source.floor, true),
      stone: palette(source.stone), wood: palette(wood),
      // Merlons retain their along-wall length; their depth follows the cap.
      rampart: Object.freeze({ woodTop: false, broken: false, ...source.rampart,
        toothWidth: 6 }),
      towerFrame: ids.indexOf(id) });
    cache.set(key, value);
    return value;
  }
  // Source-ring placements shared by the tiled and polygon floor passes.
  // They never enter world objects, collision, interaction or spawn budgets.
  const columnCache = new WeakMap();
  function columnSites(key, ring, cellM) {
    if (variantFor(key) !== 'ruin' || !ring || !(cellM > 0)) return [];
    const cached = columnCache.get(ring);
    if (cached && cached.key === key && cached.cellM === cellM) return cached.sites;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, area = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      left = Math.min(left, ring[i]); right = Math.max(right, ring[i]);
      top = Math.min(top, ring[i + 1]); bottom = Math.max(bottom, ring[i + 1]);
      area += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
    }
    const count = Math.min(5, Math.floor(Math.abs(area) / 2 / (cellM * cellM) / 9));
    let seed = 0x811c9dc5;
    for (const ch of String(key)) seed = Math.imul(seed ^ ch.charCodeAt(0), 0x01000193);
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const clear = (x, y) => {
      let inside = false;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const ax = ring[j], ay = ring[j + 1], bx = ring[i], by = ring[i + 1];
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
        const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
        if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < cellM * 0.8) return false;
      }
      return inside;
    };
    const sites = [];
    for (let tries = 0; tries < 120 && sites.length < count; tries++) {
      const x = left + random() * (right - left), y = top + random() * (bottom - top);
      if (!clear(x, y) || sites.some(p => Math.hypot(x - p.x, y - p.y) < cellM * 1.3)) continue;
      sites.push({ x, y, height: [12, 16, 20][sites.length % 3] });
    }
    columnCache.set(ring, { key, cellM, sites });
    return sites;
  }
  function columnTexture(scene, claimed) {
    const key = `castle_column_${claimed ? 'restored' : 'weathered'}`;
    if (scene.textures.exists(key)) return key;
    if (!scene.textures.exists('pillar')) return null;
    const texture = scene.textures.createCanvas(key, 16, 20), ctx = texture.getContext();
    // Keep the existing fluted shaft and stone plinth, removing its intact cap.
    ctx.drawImage(scene.textures.get('pillar').getSourceImage(), 0, 12, 16, 18, 0, 2, 16, 18);
    const image = ctx.getImageData(0, 0, 16, 20), data = image.data, stone = buildingBackgroundMaterial(get('ruin', claimed)).stone;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      if (data[i + 3] < 128 || y < 2 + (x % 3)) { data[i + 3] = 0; continue; }
      const light = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const color = stone[light < 65 ? 'DARK' : light < 105 ? 'SHADOW' : light < 145 ? 'FACE' : light < 180 ? 'BODY' : 'LITE'];
      data[i] = color >> 16; data[i + 1] = (color >> 8) & 255; data[i + 2] = color & 255; data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    for (const height of [12, 16, 20]) texture.add(height, 0, 0, 20 - height, 16, height);
    texture.refresh();
    return key;
  }
  // Four authored 3×3-cell repeats bound both geometry and texture memory.
  // Each repeat loses one paving slab; its other marks are hairline cracks
  // and a few stone fragments. The castle key selects a repeat, never a frame.
  const damagePatterns = Array.from({ length: 4 }, (_, variant) => {
    const cells = Array.from({ length: 9 }, (_, i) => ({ rects: [],
      missing: (i + variant) % 3 === 0 ? (i + variant) % 4 : -1,
      chip: (i * 7 + variant * 5) % 19 + 6 }));
    const add = (cell, x, y, w, h, ink, alpha = 1) => cells[cell].rects.push({ x, y, w, h, ink, alpha });
    const slab = (variant * 2 + 4) % 9;
    add(slab, 10, 12, 8, 6, 'floor');
    add(slab, 10, 12, 8, 6, 'SHADOW', 0.55);
    add(slab, 10, 12, 8, 1, 'DARK', 0.5);
    add(slab, 17, 13, 1, 4, 'FACE');
    add(slab, 8, 19, 3, 2, 'BODY'); add(slab, 8, 19, 2, 1, 'LITE');
    add(slab, 20, 16, 2, 2, 'BODY'); add(slab, 20, 16, 2, 1, 'LITE');
    for (const cell of [(slab + 2) % 9, (slab + 5) % 9]) {
      const x = 8 + variant * 2, y = 8 + (cell % 3) * 4;
      add(cell, x, y, 1, 4, 'SHADOW', 0.6);
      add(cell, x + 1, y + 3, 3, 1, 'SHADOW', 0.6);
      add(cell, x + 3, y + 4, 1, 4, 'SHADOW', 0.6);
      add(cell, x + 4, y + 7, 3, 1, 'SHADOW', 0.6);
    }
    return Object.freeze({ index: variant, cells });
  });
  const damageSelections = new Map();
  function damagePattern(key) {
    if (variantFor(key) !== 'ruin') return null;
    if (damageSelections.has(key)) return damageSelections.get(key);
    let hash = 0x811c9dc5;
    for (const ch of String(key)) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193);
    const pattern = damagePatterns[(hash >>> 2) % damagePatterns.length];
    if (damageSelections.size >= 256) damageSelections.clear();
    damageSelections.set(key, pattern);
    return pattern;
  }
  const damageCellIndex = (x, y) => ((y % 3 + 3) % 3) * 3 + (x % 3 + 3) % 3;
  function damageCell(key, x, y) {
    return damagePattern(key)?.cells[damageCellIndex(x, y)] || null;
  }
  function damageTexture(scene, key, claimed) {
    const pattern = damagePattern(key);
    if (!pattern) return null;
    const name = `castle_ruin_floor_${pattern.index}_${claimed ? 1 : 0}`;
    if (scene.textures.exists(name)) return name;
    const pavingKey = scene.textures.exists('castle_paving') ? 'castle_paving' : 'biome12_0';
    if (!scene.textures.exists(pavingKey)) return null;
    const texture = scene.textures.createCanvas(name, 96, 96), ctx = texture.getContext();
    const paving = scene.textures.get(pavingKey).getSourceImage(), material = buildingBackgroundMaterial(get('ruin', claimed));
    const cols = Math.max(1, Math.floor(paving.width / 32)), rows = Math.max(1, Math.floor(paving.height / 32));
    for (let i = 0; i < 9; i++) {
      const x = i % 3 * 32, y = Math.floor(i / 3) * 32;
      // Reuse the courtyard's cell slabs and split cells in each bounded
      // ruin pattern, with a stable patch for each damage layout.
      const sx = ((i % 3 + pattern.index * 3) % cols) * 32;
      const sy = ((Math.floor(i / 3) + pattern.index * 2) % rows) * 32;
      ctx.drawImage(paving, sx, sy, 32, 32, x, y, 32, 32);
      for (const r of pattern.cells[i].rects) {
        const color = r.ink === 'floor' ? material.floor : material.stone[r.ink];
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0'); ctx.globalAlpha = r.alpha;
        ctx.fillRect(x + r.x, y + r.y, r.w, r.h);
      }
      ctx.globalAlpha = 1;
      texture.add(i, 0, x, y, 32, 32);
    }
    texture.refresh();
    return name;
  }
  // Visual families are independent of the historical four hash/quest slots.
  // Old ruin sites keep their hunt jobs and IDs, but use Bastion architecture.
  const renderFamilies = Object.freeze({
    citadel: { wall: 0x747985, side: 0x59616f, top: 0xe2d2b4, base: 0x454e5b,
      floor: 0xc5b18a, roof: 0x73818b, roofSide: 0x56616b, roofBack: 0x73818b, roofLight: 0x85919b, door: 0x303941,
      accent: 0xffd575, towerWidth: 32, towerHeight: 40, keepHeight: 48, roofHeight: 0 },
    bastion: { wall: 0xc4a374, side: 0x96754e, top: 0xf7d9a7, base: 0x786447,
      floor: 0xd3b081, roof: 0xbba57a, roofSide: 0xa58d66, roofBack: 0xbba57a, roofLight: 0xceba93, door: 0x554737,
      accent: 0xb84731, towerWidth: 36, towerHeight: 32, keepHeight: 42, roofHeight: 0 },
    archive: { wall: 0xd0bfa0, side: 0xa28e70, top: 0xf6e5c4, base: 0x7c6c55,
      floor: 0xd0bc94, roof: 0x2a7186, roofSide: 0x28677b, roofBack: 0x347e92, roofLight: 0x4b8ea0, door: 0x3e4748,
      accent: 0xb7a06c, towerWidth: 32, towerHeight: 30, keepHeight: 40, roofHeight: 12 },
  });
  const renderCache = new Map();
  function renderStyle(key, active = true) {
    const legacy = variantFor(key), id = legacy === 'ruin' ? 'bastion' : legacy;
    const cacheKey = `${id}:${active ? 1 : 0}`;
    if (renderCache.has(cacheKey)) return renderCache.get(cacheKey);
    const source = renderFamilies[id], value = { id, active: !!active };
    value.masonrySlot = { citadel: [9, 3], bastion: [4, 10], archive: [14, 13] }[id][active ? 1 : 0];
    value.towerMasonrySlot = id === 'archive' ? (active ? 11 : 12) : value.masonrySlot;
    // A 128-unit motif occupies exactly 64 of the tile's 112 atlas texels.
    value.masonryRepeatFraction = 4 / 7;
    value.masonryLightGain = 1.25;
    value.masonryWeatheredCompensation = 1.2;
    value.paving = Object.freeze(id === 'citadel'
      ? { key: 'fdr', scale: 1.5, alpha: active ? .28 : .16 }
      : { key: `fdr-${id}`, scale: 1, alpha: active ? 1 : .55 });
    for (const field of ['wall', 'side', 'top', 'base', 'floor', 'roof', 'roofSide', 'roofBack', 'roofLight', 'door', 'accent'])
      value[field] = active ? source[field] : weathered(source[field], field === 'floor');
    if (!active) {
      value.base = id === 'citadel' ? 0x262f3b : 0x555d42;
      if(id==='citadel'){value.wall=0x434956;value.side=0x343c47;value.top=0x92969b;value.door=0x242c36;}
      value.accent = id === 'citadel' ? 0xa52e34 : id === 'bastion' ? weathered(source.accent) : 0x827657;
    }
    value.heraldry = id === 'citadel' ? (active ? 0xa66b20 : 0xf4ead6)
      : active ? source.top : weathered(source.top,true);
    // Citadel wreck coping turns slate-grey, but its inset paving remains
    // sandstone. Preserve that material separately from the crown's tint.
    value.deck = id === 'citadel' && !active ? weathered(source.top, true) : value.top;
    value.geometry = Object.freeze({ towerWidth: source.towerWidth, towerHeight: source.towerHeight,
      keepHeight: source.keepHeight, wallHeight: 24, merlonPitch: 16, merlonWidth: 9.6, merlonHeight: 5.6, roofHeight: source.roofHeight });
    const style = Object.freeze(value); renderCache.set(cacheKey, style); return style;
  }
  const interiorCarpets = Object.freeze({
    citadel: { field: 0x783d46, edge: 0xc5a76a, ink: 0xa76b65, dark: 0x492d38, motif: 'diamond' },
    bastion: { field: 0x985c41, edge: 0xd1ae79, ink: 0xb98558, dark: 0x603d35, motif: 'band' },
    archive: { field: 0x315e64, edge: 0xb8aa79, ink: 0x578080, dark: 0x293f47, motif: 'check' },
  });
  // Ground-canvas decoration only. The clip follows the real room (including
  // courtyards), while the rectangular border leaves a strip of stone visible.
  // Motifs retain world phase and visit only the current canvas, even when a
  // mapped building is much larger than the viewport.
  function paintInteriorCarpet(ctx, points, holes = [], key, active = true, phaseX = 0, phaseY = 0) {
    if (!ctx || !points || points.length < 3 || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
    const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
    const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
    const width = right - left, height = bottom - top;
    if (Math.min(width, height) < 24) return false;
    const margin = Math.min(14, Math.min(width, height) * .14);
    const x = left + margin, y = top + margin, w = width - margin * 2, h = height - margin * 2;
    const border = Math.min(4, Math.min(w, h) / 8);
    const family = renderStyle(key, active).id, source = interiorCarpets[family];
    const color = name => '#' + (active ? source[name] : weathered(source[name])).toString(16).padStart(6, '0');
    const trace = ring => {
      ctx.moveTo(ring[0].x, ring[0].y);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
      ctx.closePath();
    };
    const fill = (name, rx, ry, rw, rh) => { ctx.fillStyle = color(name); ctx.fillRect(rx, ry, rw, rh); };
    ctx.save();
    ctx.beginPath();
    trace(points);
    for (const hole of holes || []) if (hole.length >= 3) trace(hole);
    ctx.clip('evenodd');
    // A valid inset also keeps stone beside concave returns. Exact clipping
    // remains authoritative if a very thin wing cannot support an inset.
    if (typeof BuildingStyles !== 'undefined') {
      const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0);
      const inset = BuildingStyles.inset(area >= 0 ? points : points.slice().reverse(), margin);
      if (inset) { ctx.beginPath(); trace(inset); ctx.clip(); }
    }
    fill('dark', x, y, w, h);
    fill('edge', x + 1, y + 1, w - 2, h - 2);
    fill('dark', x + border, y + border, w - border * 2, h - border * 2);
    fill('field', x + border + 1, y + border + 1, w - (border + 1) * 2, h - (border + 1) * 2);
    ctx.beginPath();ctx.rect(x + border + 2, y + border + 2, w - (border + 2) * 2, h - (border + 2) * 2);ctx.clip();
    const minX = Math.max(x, 0), minY = Math.max(y, 0);
    const maxX = Math.min(x + w, ctx.canvas?.width ?? x + w), maxY = Math.min(y + h, ctx.canvas?.height ?? y + h);
    // A fixed pitch at ordinary view sizes; the ceiling only affects unusually
    // large offscreen/export canvases, never a castle's physical dimensions.
    const paintWidth = ctx.canvas?.width ?? width, paintHeight = ctx.canvas?.height ?? height;
    const pitch = Math.max(24, Math.ceil(Math.sqrt(paintWidth * paintHeight / 1024) / 4) * 4);
    const startX = Math.floor((minX - phaseX) / pitch) * pitch + phaseX;
    const startY = Math.floor((minY - phaseY) / pitch) * pitch + phaseY;
    for (let py = startY; py < maxY; py += pitch) for (let px = startX; px < maxX; px += pitch) {
      const cx = px + pitch / 2, cy = py + pitch / 2;
      if (source.motif === 'diamond') {
        fill('ink', cx - 6, cy - 2, 12, 4);
        fill('ink', cx - 4, cy - 4, 8, 8);
        fill('ink', cx - 2, cy - 6, 4, 12);
        fill('edge', cx - 1, cy - 1, 2, 2);
      } else if (source.motif === 'band') {
        fill('ink', px, cy - 3, pitch, 6);
        fill('dark', px, cy - 1, pitch, 2);
        fill('edge', cx - 2, cy - 2, 4, 4);
      } else {
        fill('ink', cx - 5, cy - 5, 10, 10);
        fill('field', cx - 3, cy - 3, 6, 6);
        fill('edge', cx - 1, cy - 1, 2, 2);
        fill('ink', px - 1, py - 1, 2, 2);
      }
    }
    ctx.restore();
    return true;
  }
  // Ground-only contact growth. The canvas clips these bounded masks to the
  // courtyard; they never become retained castle meshes or world objects.
  function growthPatches(key, layout) {
    const family=renderStyle(key,false).id;
    const spread={citadel:12,bastion:48,archive:15}[family];
    const coverage={citadel:.28,bastion:.85,archive:.64}[family];
    let seed=0x811c9dc5;
    for(const ch of String(key))seed=Math.imul(seed^ch.charCodeAt(0),0x01000193);
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const patches=[];
    const ring=(points,width,inward)=>{
      if(!points||points.length<3)return;
      let area=0,perimeter=0;
      for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length];
        area+=a.x*b.y-b.x*a.y;perimeter+=Math.hypot(b.x-a.x,b.y-a.y);
      }
      const sign=(area<0?-1:1)*(inward?1:-1),step=Math.max(inward?48:32,perimeter/96);
      for(let edge=0;edge<points.length&&patches.length<256;edge++){
        const a=points[edge],b=points[(edge+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
        if(length<1e-6)continue;
        const nx=-dy/length*sign,ny=dx/length*sign,count=Math.ceil(length/step);
        for(let i=0;i<count&&patches.length<256;i++){
          const selected=random()<coverage;
          const depth=width*(.25+random()*.75)*(family==='bastion'?1.12:1);
          const start=Math.max(0,(i-random()*.18)/count),end=Math.min(1,(i+1+random()*.18)/count);
          let trend=random();
          const contour=Array.from({length:7},(_,j)=>{
            trend=trend*.6+random()*.4;
            // Coarse correlated variation makes one broad unequal lobe,
            // rather than independently alternating narrow comb teeth.
            const shoulder=j===0||j===6?.38:j===1||j===5?.78:1;
            const reach=depth*(.65+trend*.55)*shoulder;
            return family==='bastion'?reach:Math.min(width,reach);
          });
          if(!selected)continue;
          const at=(fraction,depth)=>({x:a.x+dx*fraction+nx*depth,y:a.y+dy*fraction+ny*depth});
          patches.push([at(start,0),at(end,0),...contour.map((d,j)=>at(end-(end-start)*j/6,d))]);
        }
      }
    };
    ring(layout.points,spread,true);
    for(const part of [...layout.towers,...(layout.keep?[layout.keep]:[])])
      ring(part.points,spread*.45,false);
    // Coarse leaf clusters break the smooth mask perimeter. Missing cells
    // are paving gaps before compositing, never erasures of the floor below.
    const left=Math.min(...layout.points.map(p=>p.x)),top=Math.min(...layout.points.map(p=>p.y));
    const width=Math.max(...layout.points.map(p=>p.x))-left,height=Math.max(...layout.points.map(p=>p.y))-top;
    let cell=4;
    while(Math.ceil(width/cell)*Math.ceil(height/cell)>2048)cell*=1.25;
    const cols=Math.ceil(width/cell),rows=Math.ceil(height/cell),filled=new Set();
    const inside=(x,y,points)=>{
      let yes=false;
      for(let i=0,j=points.length-1;i<points.length;j=i++){
        const a=points[i],b=points[j];
        if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)yes=!yes;
      }
      return yes;
    };
    for(const patch of patches){
      const x0=Math.max(0,Math.floor((Math.min(...patch.map(p=>p.x))-left)/cell));
      const x1=Math.min(cols-1,Math.floor((Math.max(...patch.map(p=>p.x))-left)/cell));
      const y0=Math.max(0,Math.floor((Math.min(...patch.map(p=>p.y))-top)/cell));
      const y1=Math.min(rows-1,Math.floor((Math.max(...patch.map(p=>p.y))-top)/cell));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)
        if(inside(left+(x+.5)*cell,top+(y+.5)*cell,patch))filled.add(y*cols+x);
    }
    const noise=(x,y)=>((Math.imul(x+29,374761393)^Math.imul(y+71,668265263)^seed)>>>0);
    const clusters=[],selectedCells=new Set();
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const has=(cx,cy)=>cx>=0&&cx<cols&&cy>=0&&cy<rows&&filled.has(cy*cols+cx);
      const neighbors=Number(has(x-1,y))+Number(has(x+1,y))+Number(has(x,y-1))+Number(has(x,y+1));
      const occupied=has(x,y),n=noise(x,y);
      if(occupied){
        if(neighbors<4&&n%7===0)continue;
        // A few grouped 8-unit gaps expose paving inside broad vegetation.
        if(neighbors===4&&noise(Math.floor(x/2)+213,Math.floor(y/2)+91)%43===0)continue;
      }else if(neighbors<2||n%5!==0)continue;
      selectedCells.add(y*cols+x);
    }
    // Merge contiguous cells into row runs. This preserves the leafy outline
    // and paving gaps while reducing the cached canvas path substantially.
    for(let y=0;y<rows;y++)for(let x=0;x<cols;){
      if(!selectedCells.has(y*cols+x)){x++;continue;}
      const start=x;
      while(x<cols&&selectedCells.has(y*cols+x))x++;
      const x0=left+start*cell,y0=top+y*cell,x1=Math.min(left+width,left+x*cell),y1=Math.min(top+height,y0+cell);
      clusters.push([{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]);
    }
    return clusters;
  }
  global.CastleStyles = Object.freeze({ TOWER_WIDTH: 32, TOWER_HEIGHT: 48, TURRET_STYLE: 'bastion', ids: Object.freeze(ids), renderStyle, paintInteriorCarpet, growthPatches, variantFor, questTypeFor, get, columnSites, columnTexture, damagePattern, damageCellIndex, damageCell, damageTexture });
})(window);
