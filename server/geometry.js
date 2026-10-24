'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const GEOMETRY_ZOOM = 18;
const MODEL = 'google/gemini-4-argon';
const LIMIT = 2 ** GEOMETRY_ZOOM;
class GeometryError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }
function tileAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85.0511287798066 || lon < -180 || lon >= 180) throw new GeometryError('Invalid latitude or longitude', 400);
  const r = lat * Math.PI / 180;
  return { z: GEOMETRY_ZOOM, x: Math.floor((lon + 180) / 360 * LIMIT), y: Math.min(LIMIT - 1, Math.max(0, Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * LIMIT))) };
}
function point(x, y, z = GEOMETRY_ZOOM) { const n = 2 ** z; return [x / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI]; }
function bbox(tile) { const nw = point(tile.x, tile.y), se = point(tile.x + 1, tile.y + 1); return [nw[0], se[1], se[0], nw[1]]; }
function parseTile(url) {
  if (url.pathname === '/geometry/trees') {
    if ([...url.searchParams.keys()].some(k => !['lat', 'lon'].includes(k)) || ['lat', 'lon'].some(k => url.searchParams.getAll(k).length !== 1 || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(url.searchParams.get(k)))) throw new GeometryError('Expected lat and lon', 400);
    return tileAt(Number(url.searchParams.get('lat')), Number(url.searchParams.get('lon')));
  }
  const m = /^\/geometry\/trees\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname);
  if (!m || url.search || +m[1] !== GEOMETRY_ZOOM || +m[2] >= LIMIT || +m[3] >= LIMIT) throw new GeometryError('Invalid geometry tile', 400);
  return { z: GEOMETRY_ZOOM, x: +m[2], y: +m[3] };
}
function convertTrees(raw, tile, image) {
  const width = image?.width || 1000, height = image?.height || 1000;
  const core = image?.coreBox || { left: 0, top: 0, width, height };
  const coreX = n => (n / 1000 * width - core.left) / core.width;
  const coreY = n => (n / 1000 * height - core.top) / core.height;
  if (!raw || !Array.isArray(raw.trees) || raw.trees.length > 3000) throw new GeometryError('Invalid tree detection response');
  const seen = new Set();
  return raw.trees.flatMap(t => {
    if (!t || !Array.isArray(t.box_2d) || t.box_2d.length !== 4 || !t.box_2d.every(n => Number.isFinite(n) && n >= 0 && n <= 1000)) throw new GeometryError('Invalid tree box');
    // Gemini native boxes are [ymin,xmin,ymax,xmax], normalized to 0..1000.
    const [y0, x0, y1, x1] = t.box_2d;
    if (x1 <= x0 || y1 <= y0) throw new GeometryError('Invalid tree box extent');
    const x = coreX((x0 + x1) / 2), y = coreY((y0 + y1) / 2);
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return [];
    if (!['conifer', 'broadleaf', 'unknown'].includes(t.tree_type) || !['high', 'medium', 'low'].includes(t.confidence)) throw new GeometryError('Invalid tree attributes');
    if (t.species !== undefined && !['pine', 'maple', 'unknown'].includes(t.species)) throw new GeometryError('Invalid species');
    const coordinates = point(tile.x + x, tile.y + y);
    const crown_m = Math.max(coreX(x1) - coreX(x0), coreY(y1) - coreY(y0)) * 40075016.686 / LIMIT * Math.cos(coordinates[1] * Math.PI / 180);
    const id = `tree:${tile.z}/${tile.x}/${tile.y}:${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
    if (seen.has(id)) return []; seen.add(id);
    const properties = { source: 'gemini', kind: 'tree', tree_type: t.tree_type, crown_m: +crown_m.toFixed(2), size: crown_m < 5 ? 'small' : crown_m < 10 ? 'medium' : 'large', confidence: t.confidence, box_2d: [...t.box_2d], bbox: [...point(tile.x + coreX(x0), tile.y + coreY(y1)), ...point(tile.x + coreX(x1), tile.y + coreY(y0))] };
    // Species here selects game art; it is not a botanical identification.
    if (t.tree_type !== 'unknown') Object.assign(properties, { species: t.tree_type === 'conifer' ? 'pine' : 'maple', species_basis: 'game_type_mapping', treeSpeciesFixed: true });
    return [{ type: 'Feature', id, geometry: { type: 'Point', coordinates }, properties }];
  });
}
async function imagery(tile, fetcher, signal) {
  const sharp = require('sharp');
  // A z18 core occupies 1024px at z20, with 128px context on each side.
  // Crop the outer neighbor tiles; x wraps at the dateline and y clips at poles. Fall back only for
  // Esri's explicit no-data responses or its known HTTP-200 placeholder.
  for (const zoom of [20, 19, 18]) {
    const scale = 2 ** (zoom - GEOMETRY_ZOOM), pieces = [];
    const n = 2 ** zoom, coreSize = scale * 256, padding = 128 * scale / 4;
    const originX = tile.x * coreSize - padding;
    const originY = Math.max(0, tile.y * coreSize - padding);
    const endY = Math.min(n * 256, (tile.y + 1) * coreSize + padding);
    const width = coreSize + padding * 2, height = endY - originY;
    const coreBox = { left: padding, top: tile.y * coreSize - originY, width: coreSize, height: coreSize };
    let missing = false;
    for (let ty = Math.floor(originY / 256); ty < Math.ceil(endY / 256) && !missing; ty++) for (let tx = Math.floor(originX / 256); tx < Math.ceil((originX + width) / 256); tx++) {
      const response = await fetcher(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${((tx % n) + n) % n}`, { signal });
      if (response.status === 404 || response.headers.get('blank-tile') === 'true') { missing = true; break; }
      if (!response.ok) throw new GeometryError('Imagery provider failed');
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 5 * 1024 * 1024) throw new GeometryError('Imagery response too large');
      if (crypto.createHash('sha256').update(data).digest('hex') === '9eafd300d61393184a4abc1d458564cfd1cd9b6f9c4e9c74687045c0a0e5b858') { missing = true; break; }
      try {
        const info = await sharp(data).metadata();
        if (info.width !== 256 || info.height !== 256) throw new Error('dimensions');
        const left = Math.max(originX, tx * 256), top = Math.max(originY, ty * 256);
        const right = Math.min(originX + width, (tx + 1) * 256), bottom = Math.min(endY, (ty + 1) * 256);
        const cropped = await sharp(data).extract({ left: left - tx * 256, top: top - ty * 256, width: right - left, height: bottom - top }).toBuffer();
        pieces.push({ input: cropped, left: left - originX, top: top - originY });
      } catch (error) { throw new GeometryError('Invalid imagery'); }
    }
    if (!missing) return { data: await sharp({ create: { width, height, channels: 3, background: '#000' } }).composite(pieces).jpeg().toBuffer(), provider: 'Esri World Imagery', zoom, width, height, coreBox };
  }
  throw new GeometryError('No satellite imagery available', 503);
}
async function detect(image, fetcher, signal, apiKey) {
  const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 16000, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [{ type: 'text', text: 'Detect individual visible tree crowns in this overhead satellite image. Return JSON {"trees":[{"box_2d":[ymin,xmin,ymax,xmax],"tree_type":"conifer|broadleaf|unknown","confidence":"high|medium|low"}]}. box_2d uses native Gemini normalized coordinates 0..1000 in y,x order. Include partial crowns at image edges. Separate touching crowns only when visually distinguishable. Exclude hedges, shrubs, shadows and buildings. Classify broad tree type only; do not guess botanical species. Return an empty trees array only when imagery is usable and has no trees.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.data.toString('base64')}` } }] }] }) });
  if (!response.ok) throw new GeometryError('Tree model request failed');
  const body = await response.json(), choice = body.choices?.[0];
  if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') throw new GeometryError('Incomplete tree model response');
  try { return JSON.parse(choice.message.content); } catch { throw new GeometryError('Invalid tree model JSON'); }
}
function validCache(value, tile) {
  const box = bbox(tile);
  const image = value?.imagery, core = image?.coreBox;
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.width > 1280 || image.height < 1 || image.height > 1280 || !core || !['left','top','width','height'].every(k => Number.isInteger(core[k])) || core.left < 0 || core.top < 0 || core.width < 1 || core.height < 1 || core.left + core.width > image.width || core.top + core.height > image.height) return false;
  return value?.schemaVersion === 1 && value.type === 'FeatureCollection' && value.tile?.z === tile.z && value.tile.x === tile.x && value.tile.y === tile.y && JSON.stringify(value.coverage?.bbox) === JSON.stringify(box) && value.model === MODEL && typeof value.generatedAt === 'string' && value.imagery?.provider === 'Esri World Imagery' && [18,19,20].includes(value.imagery.zoom) && Array.isArray(value.features) && value.features.length <= 3000 && value.features.every(f => f?.type === 'Feature' && typeof f.id === 'string' && f.geometry?.type === 'Point' && f.geometry.coordinates?.length === 2 && f.geometry.coordinates.every(Number.isFinite) && f.geometry.coordinates[0] >= box[0] && f.geometry.coordinates[0] < box[2] && f.geometry.coordinates[1] <= box[3] && f.geometry.coordinates[1] > box[1] && Array.isArray(f.properties?.box_2d) && f.properties.box_2d.length === 4 && f.properties.box_2d.every(n => Number.isFinite(n) && n >= 0 && n <= 1000) && f.properties.box_2d[0] < f.properties.box_2d[2] && f.properties.box_2d[1] < f.properties.box_2d[3] && Array.isArray(f.properties.bbox) && f.properties.bbox.length === 4 && f.properties.bbox.every(Number.isFinite) && f.properties?.source === 'gemini' && f.properties.kind === 'tree' && ['conifer','broadleaf','unknown'].includes(f.properties.tree_type) && ['small','medium','large'].includes(f.properties.size) && ['high','medium','low'].includes(f.properties.confidence) && Number.isFinite(f.properties.crown_m) && f.properties.crown_m > 0 && (f.properties.species === undefined || ['pine','maple'].includes(f.properties.species) && f.properties.treeSpeciesFixed === true));
}
function createGeometryService(options = {}) {
  const cacheDir = options.cacheDir || process.env.GEOMETRY_CACHE_DIR || path.join(__dirname, 'data/geometry');
  const fetcher = options.fetch || global.fetch, apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  const maxConcurrent = options.maxConcurrent ?? 2, maxQueue = options.maxQueue ?? 16, budget = options.coldBudget ?? Number(process.env.GEOMETRY_COLD_REQUESTS_PER_HOUR || 100);
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isInteger(maxQueue) || maxQueue < 0 || !Number.isInteger(budget) || budget < 0) throw new Error('Invalid geometry request limits');
  const inflight = new Map(), queue = []; let active = 0, spent = 0, windowStarted = Date.now();
  async function generate(tile, file) {
    if (!apiKey && !options.detect) throw new GeometryError('Tree generation is not configured', 503);
    if (Date.now() - windowStarted >= 3600000) { spent = 0; windowStarted = Date.now(); }
    if (spent >= budget) throw new GeometryError('Cold request budget exhausted', 429);
    spent++;
    const controller = new AbortController();
    let timer;
    const work = async () => {
      const image = await (options.imagery || imagery)(tile, fetcher, controller.signal);
      const raw = await (options.detect || detect)(image, fetcher, controller.signal, apiKey);
      if (controller.signal.aborted) throw new GeometryError('Tree generation timed out', 504);
      const value = { type: 'FeatureCollection', schemaVersion: 1, tile, coverage: { bbox: bbox(tile) }, imagery: { provider: image.provider, zoom: image.zoom, width: image.width, height: image.height, coreBox: image.coreBox || { left: 0, top: 0, width: image.width, height: image.height } }, model: MODEL, generatedAt: new Date().toISOString(), features: convertTrees(raw, tile, image) };
      if (!validCache(value, tile)) throw new GeometryError('Invalid generated geometry');
      await fs.mkdir(cacheDir, { recursive: true });
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      try { await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx' }); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => {}); }
      return value;
    };
    try { return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new GeometryError('Tree generation timed out', 504)); }, options.timeoutMs ?? 90000); })]); } finally { clearTimeout(timer); }
  }
  async function load(tile) {
    const file = path.join(cacheDir, `v1-${tile.z}-${tile.x}-${tile.y}.json`);
    try { const value = JSON.parse(await fs.readFile(file, 'utf8')); if (validCache(value, tile)) return value; } catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
    if (active >= maxConcurrent) {
      if (queue.length >= maxQueue) throw new GeometryError('Geometry queue is full', 429);
      await new Promise(resolve => queue.push(resolve));
    } else active++;
    try { return await generate(tile, file); } finally { const next = queue.shift(); if (next) next(); else active--; }
  }
  return { get(tile) { if (!Number.isInteger(tile?.x) || !Number.isInteger(tile?.y) || tile.z !== GEOMETRY_ZOOM || tile.x < 0 || tile.y < 0 || tile.x >= LIMIT || tile.y >= LIMIT) return Promise.reject(new GeometryError('Invalid geometry tile', 400)); const key = `${tile.x}/${tile.y}`; if (!inflight.has(key)) inflight.set(key, load(tile).finally(() => inflight.delete(key))); return inflight.get(key); } };
}
module.exports = { createGeometryService, parseTile, tileAt, bbox, point, convertTrees, imagery, detect, validCache, GeometryError, GEOMETRY_ZOOM, MODEL };
