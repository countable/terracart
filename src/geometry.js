// Successful z18 observations are immutable local evidence; failures remain retryable.
const Geometry = (() => {
  const Z = 18, SCHEMA = 1;
  function tileAt(lon, lat) {
    const n = 2 ** Z, r = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
    return { z: Z, x: Math.min(n - 1, Math.max(0, Math.floor((lon + 180) / 360 * n))),
      y: Math.min(n - 1, Math.max(0, Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n))) };
  }
  function enabled(search) {
    if (search === undefined) {
      if (!globalThis.location || /\/test\//.test(globalThis.location.pathname || '')) return false;
      search = globalThis.location.search || '';
    }
    const p = new URLSearchParams(search);
    return p.get('geometry') !== 'off' && !p.has('sandbox') && !p.has('test');
  }
  function bounds(tile) {
    const n = 2 ** Z, lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    return [tile.x / n * 360 - 180, lat(tile.y + 1), (tile.x + 1) / n * 360 - 180, lat(tile.y)];
  }
  function valid(fc, tile) {
    if (!tile || tile.z !== Z || !Number.isInteger(tile.x) || !Number.isInteger(tile.y) ||
        tile.x < 0 || tile.y < 0 || tile.x >= 2 ** Z || tile.y >= 2 ** Z) return false;
    const box = bounds(tile);
    return fc?.type === 'FeatureCollection' && fc.schemaVersion === SCHEMA &&
      fc.tile?.z === Z && fc.tile.x === tile.x && fc.tile.y === tile.y &&
      typeof fc.model === 'string' && typeof fc.generatedAt === 'string' &&
      Array.isArray(fc.coverage?.bbox) && fc.coverage.bbox.length === 4 &&
      fc.coverage.bbox.every((v, i) => Number.isFinite(v) && Math.abs(v - box[i]) < 1e-9) &&
      Array.isArray(fc.features) && fc.features.length <= 3000 && fc.features.every(f => {
        const c = f?.geometry?.coordinates, p = f?.properties;
        return f?.type === 'Feature' && f.geometry.type === 'Point' && Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) &&
          c[0] >= box[0] && c[0] < box[2] && c[1] > box[1] && c[1] <= box[3] &&
          p?.source === 'gemini' && p.kind === 'tree' && ['conifer', 'broadleaf', 'unknown'].includes(p.tree_type) &&
          ['small', 'medium', 'large'].includes(p.size) && ['high', 'medium', 'low'].includes(p.confidence) &&
          Number.isFinite(p.crown_m) && p.crown_m > 0 &&
          (p.species === undefined || p.species === ({ conifer: 'pine', broadleaf: 'maple' })[p.tree_type] && p.treeSpeciesFixed === true);
      });
  }
  function revision(aggregate) { return Object.keys(aggregate).sort().join('|'); }
  async function requestWithTimeout(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try { return await fetch(url, { signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  }
  function createClient({ origin, get, put, merge, request = requestWithTimeout, now = () => Date.now(), maxEntries = 64 }) {
    const memory = new Map(), pending = new Map(), failures = new Map(), parentReads = new Map();
    const remember = (map, key, value) => {
      map.delete(key); map.set(key, value);
      while (map.size > maxEntries) map.delete(map.keys().next().value);
      return value;
    };
    const prefix = () => `geometry/${encodeURIComponent(origin())}/v${SCHEMA}`;
    const parentKey = (x, y) => `${prefix()}/parent/14/${x}/${y}`;
    async function readParent(x, y) {
      const key = parentKey(x, y);
      if (memory.has(key)) return memory.get(key);
      if (!parentReads.has(key)) parentReads.set(key, Promise.resolve(get(key)).then(value => {
        const clean = Object.fromEntries(Object.entries(value || {}).filter(([, fc]) => valid(fc, fc?.tile) && Math.floor(fc.tile.x / 16) === x && Math.floor(fc.tile.y / 16) === y));
        return remember(memory, key, clean);
      }).finally(() => parentReads.delete(key)));
      return parentReads.get(key);
    }
    function warm(lon, lat) {
      const t = tileAt(lon, lat), key = `${prefix()}/trees/${Z}/${t.x}/${t.y}`;
      if (pending.has(key)) return pending.get(key);
      if (pending.size >= 4) return Promise.resolve(null);
      const failure = failures.get(key);
      if (failure && now() < failure.until) return Promise.resolve(null);
      const p = (async () => {
        let fc = memory.get(key) || await get(key);
        if (!valid(fc, t)) {
          const response = await request(`${origin()}/geometry/trees/${Z}/${t.x}/${t.y}`);
          if (!response.ok) throw new Error('geometry unavailable');
          fc = await response.json();
          if (!valid(fc, t)) throw new Error('invalid geometry');
          await put(key, fc);
        }
        remember(memory, key, fc);
        const x = Math.floor(t.x / 16), y = Math.floor(t.y / 16);
        const aggregate = await readParent(x, y);
        if (aggregate[key]) return null;
        if (merge) {
          const updated = await merge(parentKey(x, y), key, fc);
          if (updated) remember(memory, parentKey(x, y), updated);
          else aggregate[key] = fc; // Storage unavailable: retain this session's evidence.
        } else {
          aggregate[key] = fc;
          await put(parentKey(x, y), aggregate);
        }
        failures.delete(key);
        return { x, y, fc };
      })().catch(() => {
        const count = (failures.get(key)?.count || 0) + 1;
        remember(failures, key, { count, until: now() + Math.min(300000, 5000 * 2 ** Math.min(count - 1, 6)) });
        return null;
      }).finally(() => pending.delete(key));
      pending.set(key, p);
      return p;
    }
    return { warm, readParent };
  }
  return { tileAt, bounds, enabled, valid, revision, createClient };
})();
