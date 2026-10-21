// Transfer the floor reviewer's generated map into an isolated, playable sandbox.
(function (root) {
  'use strict';
  const KEY = 'terracart-floor-sandbox-v1';
  const TYPES = { Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array, Float32Array, Float64Array };
  let snapshot;
  let lastSearch, activeMap = false;
  function active() {
    const search = root.location?.search || '';
    if (search !== lastSearch) {
      lastSearch = search;
      activeMap = ['floor-viewer', 'scenario'].includes(new URLSearchParams(search).get('sandboxMap'));
    }
    return activeMap;
  }
  function isScenario() { return active() && read().scenario === true; }
  function encode(key, value) {
    if (value instanceof Promise) return undefined;
    if (ArrayBuffer.isView(value) && TYPES[value.constructor.name])
      return { _floorType: value.constructor.name, values: Array.from(value) };
    if (value instanceof Set) return { _floorType: 'Set', values: Array.from(value) };
    if (value instanceof Map) return { _floorType: 'Map', values: Array.from(value) };
    return value;
  }
  function decode(key, value) {
    if (!value || !value._floorType) return value;
    if (value._floorType === 'Set') return new Set(value.values);
    if (value._floorType === 'Map') return new Map(value.values);
    if (Object.hasOwn(TYPES, value._floorType)) return new TYPES[value._floorType](value.values);
    return value;
  }
  function write(entries, depth, seed, variant, options = {}) {
    const R = root.FloorViewerRegion;
    const data = { version: 1, entries, depth, seed, variant,
      home: options.home || (R ? { ...R.HOME } : { x: 25.5, y: 12.5 }),
      lat: options.lat ?? R?.lat ?? 47.62, title: options.title,
      returnUrl: options.returnUrl, scenario: !!options.scenario };
    root.sessionStorage.setItem(KEY, JSON.stringify(data, encode));
    snapshot = undefined;
    return data;
  }
  function writeScenario(scenario) {
    const data = root.SandboxScenarios.build(scenario);
    return write(data.entries, data.depth, data.seed, data.variant, data.options);
  }
  function read() {
    if (snapshot) return snapshot;
    const data = JSON.parse(root.sessionStorage.getItem(KEY) || 'null', decode);
    if (data?.version !== 1 || !Number.isInteger(data.depth) || data.depth < 0
        || !data.entries?.[0] || !data.entries[data.depth])
      throw new Error('Open the floor design reviewer and choose Play in sandbox to load its map.');
    for (const entry of Object.values(data.entries)) {
      if (!(entry.grid instanceof Uint8Array) || !Number.isInteger(entry.cellsPerEdge)
          || entry.grid.length !== entry.cellsPerEdge ** 2 || !(entry.tileEdgeM > 0))
        throw new Error('The saved floor review map is invalid. Rebuild it in the reviewer.');
    }
    return (snapshot = data);
  }
  function configure(scene) {
    const data = read(), entry = data.entries[0], W = root.WorldGen;
    scene.tileEdgeM = entry.tileEdgeM;
    scene.cellsPerTile = entry.cellsPerEdge;
    scene.cellsForRow = () => entry.cellsPerEdge;
    scene.cellM = entry.tileEdgeM / entry.cellsPerEdge;
    scene.mPerPx = entry.tileEdgeM / W.TILE_PX;
    scene.originPx = { x: data.home.x * scene.cellM / scene.mPerPx,
      y: data.home.y * scene.cellM / scene.mPerPx };
    scene.habitatTileAreaScale = (entry.tileEdgeM / W.tileEdgeMeters(data.lat)) ** 2;
  }
  function blank(depth, tx, ty, reference) {
    const W = root.WorldGen, N = reference.cellsPerEdge;
    const grid = new Uint8Array(N * N).fill(depth === 0 ? W.T.GRASS : W.T.CAVE_WALL);
    return { status: 'ready', depth, tx, ty, cellsPerEdge: N, tileEdgeM: reference.tileEdgeM,
      grid, baseGrid: grid.slice(), objects: [], genObjects: [], wildplants: [], genWildplants: [],
      creatures: [], _spawned: true, hadBin: true, layers: [], owners: new Uint16Array(N * N),
      ownerKeys: [null], poiPadCells: new Set(), parkingTreasures: [], extraTreasures: [],
      coinDrops: [], traps: [], streetLairs: [], torchSites: [], buildingShapes: [],
      roadLabels: {}, pathUnder: {}, treasure: null };
  }
  function install(scene) {
    const data = read(), W = root.WorldGen, surface = data.entries[0];
    configure(scene);
    scene._sandboxMode = true;
    scene.startWorldM = { x: data.home.x * scene.cellM, y: data.home.y * scene.cellM };
    if (typeof HomeArea !== 'undefined') HomeArea.setOrigin(scene.startWorldM.x, scene.startWorldM.y);
    Object.assign(scene.save, surface.viewerSave || {});
    scene.depth = scene.save.depth = data.depth;
    for (const [depth, entry] of Object.entries(data.entries)) {
      entry.status = 'ready'; entry.hadBin = true;
      W.tileCacheFor(+depth).clear();
      W.tileCacheFor(+depth).set(W.tileKey(0, 0), entry);
    }
    const original = W.loadTile, originalAtDepth = original.atDepth;
    async function atDepth(depth, tx, ty, lat) {
      const cache = W.tileCacheFor(depth), key = W.tileKey(tx, ty);
      if (cache.has(key)) return cache.get(key);
      if (tx === 0 && ty === 0 && data.entries[depth]) {
        cache.set(key, data.entries[depth]);
        return data.entries[depth];
      }
      if (!data.scenario && tx === 0 && ty === 0 && depth > 0) return originalAtDepth(depth, tx, ty, lat);
      const entry = blank(depth, tx, ty, surface);
      cache.set(key, entry);
      return entry;
    }
    // Cave generation calls the original function's atDepth property internally.
    original.atDepth = atDepth;
    W.loadTile = (tx, ty, lat) => atDepth(scene.depth, tx, ty, lat);
    W.loadTile.atDepth = atDepth;
    W.setDepth(data.depth);
    const entry = data.entries[data.depth], N = entry.cellsPerEdge;
    const occupied = new Set(data.scenario ? [...(entry.objects || []), ...(entry.creatures || [])]
      .map(p => Math.floor(p.y / scene.cellM) * N + Math.floor(p.x / scene.cellM)) : []);
    let best = null, distance = Infinity;
    for (let i = 0; i < entry.grid.length; i++) {
      if (!W.isWalkable(entry.grid[i]) || entry.grid[i] === W.T.CAVE_LAVA
          || entry.grid[i] === W.T.WATER || occupied.has(i)) continue;
      const x = i % N + 0.5, y = Math.floor(i / N) + 0.5;
      const d = (x - data.home.x) ** 2 + (y - data.home.y) ** 2;
      if (d < distance) { best = { x, y }; distance = d; }
    }
    if (!best) throw new Error('This floor has no safe starting cell. Choose another floor in the reviewer.');
    scene.playerM = { x: best.x * scene.cellM - scene.startWorldM.x,
      y: best.y * scene.cellM - scene.startWorldM.y };
    scene.syncMoveTarget?.();
    scene.gpsM = { ...scene.playerM };
    scene.gpsAvailable = false;
    if (scene.gpsWatchId != null && root.Geo) {
      root.Geo.unsubscribe(scene.gpsWatchId); scene.gpsWatchId = null;
    }
    scene.cameras?.main.setBackgroundColor(data.depth > 0 ? '#0a0a12' : '#172a20');
  }
  root.FloorSandbox = { active, isScenario, write, writeScenario, read, configure, install };
  // This script loads after save.js and before the game's scene is created.
  // Keep the real save out of this session, including pagehide flushes.
  if (active()) {
    root.disableSave();
    root.loadSave = () => ({});
  }
})(typeof window !== 'undefined' ? window : globalThis);
