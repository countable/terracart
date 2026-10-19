// Authored preview adapter. Layout producers supply cells and art, while the
// existing floor sandbox owns storage, save isolation and runtime installation.
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({ edge: 64, placements: 512, imageChars: 350000, totalChars: 3000000 });
  const SEMANTICS = new Set(['ground', 'wall', 'water', 'lava', 'accent', 'path']);
  const KEY = /^[a-zA-Z0-9_-]{1,100}$/;
  function check(ok, message) { if (!ok) throw new Error('Invalid sandbox scenario: ' + message); }
  function image(uri) {
    check(typeof uri === 'string' && uri.length <= LIMITS.imageChars
      && /^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(uri), 'art must be a bounded raster data URI');
    return uri;
  }
  function returnUrl(value) {
    if (!value) return undefined;
    const url = new URL(value, root.location?.href || 'http://localhost/');
    check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'return URL must be HTTP(S)');
    return url.href;
  }
  function build(input) {
    check(input && JSON.stringify(input).length <= LIMITS.totalChars, 'payload too large');
    check(input.version === 1 && KEY.test(input.id), 'unsupported version or id');
    const { width, height, depth } = input;
    check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
      && width <= LIMITS.edge && height <= LIMITS.edge, 'dimensions');
    check(Number.isInteger(depth) && depth >= 0 && depth <= 7, 'floor');
    check(['tile', 'generated'].includes(input.mode), 'layout mode');
    check(Number.isSafeInteger(input.seed), 'seed');
    check(typeof input.title === 'string' && input.title.length <= 200, 'title');
    check(Array.isArray(input.cells) && input.cells.length === height
      && input.cells.every(row => Array.isArray(row) && row.length === width
        && row.every(cell => SEMANTICS.has(cell))), 'cell matrix');
    const W = root.WorldGen, N = Math.max(width, height) + 2, cellM = W.CELL_M;
    const fill = depth ? W.T.CAVE_WALL : W.T.ROCK;
    const grid = new Uint8Array(N * N).fill(fill), cells = Array(N * N).fill('wall');
    const mapping = { ground: depth ? W.T.CAVE_FLOOR : W.T.GRASS,
      accent: depth ? W.T.CAVE_FLOOR : W.T.GRASS,
      path: depth ? W.T.CAVE_FLOOR : W.T.PATH, wall: fill, water: W.T.WATER, lava: W.T.CAVE_LAVA };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y + 1) * N + x + 1;
      cells[i] = input.cells[y][x]; grid[i] = mapping[cells[i]];
    }
    const art = { tiles: {}, props: {} };
    for (const [key, uri] of Object.entries(input.art?.tiles || {})) {
      check(SEMANTICS.has(key), 'tile art key'); art.tiles[key] = image(uri);
    }
    const propEntries = Object.entries(input.art?.props || {});
    check(propEntries.length <= 64, 'too many prop images');
    for (const [key, value] of propEntries) {
      check(KEY.test(key), 'prop art key'); art.props[key] = { uri: image(value.uri) };
    }
    const occupied = new Set(), ids = new Set();
    function placements(list, type) {
      check(Array.isArray(list) && list.length <= LIMITS.placements, 'placements');
      return list.map(p => {
        check(Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < width
          && p.y >= 0 && p.y < height && KEY.test(p.kind), 'placement coordinates or kind');
        const i = (p.y + 1) * N + p.x + 1;
        const id = `scenario:${input.id}:${input.mode}:${input.seed}:${type}:${p.kind}:${p.x}:${p.y}`;
        check(!ids.has(id), 'duplicate placement'); ids.add(id); occupied.add(i);
        const x = (p.x + 1.5) * cellM, y = (p.y + 1.5) * cellM;
        if (type === 'creature') {
          check(root.SpriteLayout?.creatureBehaviour(p.kind), 'unknown creature kind');
          check((W.isWalkable(grid[i]) || grid[i] === W.T.WATER) && grid[i] !== W.T.CAVE_LAVA, 'creature inside a wall or lava');
          return W.makeCreature(p.kind, x, y, id, { depth });
        }
        check(p.pushable === undefined || typeof p.pushable === 'boolean', 'pushable flag');
        check(KEY.test(p.artKey) && Object.hasOwn(art.props, p.artKey), 'missing prop art');
        return W.makeObject('sandboxprop', x, y, id,
          { depth, sandboxDepth: depth, sandboxArtKey: p.artKey, previewKind: p.kind, ...(p.pushable ? {pushable: true} : {}) });
      });
    }
    const objects = placements(input.props || [], 'prop');
    const creatures = placements(input.creatures || [], 'creature');
    let home, distance = Infinity;
    for (let i = 0; i < grid.length; i++) {
      const cx = i % N, cy = Math.floor(i / N);
      if (cx < 1 || cx > width || cy < 1 || cy > height
          || !W.isWalkable(grid[i]) || grid[i] === W.T.WATER || grid[i] === W.T.CAVE_LAVA || occupied.has(i)) continue;
      const x = i % N + .5, y = Math.floor(i / N) + .5;
      const d = (x - (width + 2) / 2) ** 2 + (y - (height + 2) / 2) ** 2;
      if (d < distance) { home = { x, y }; distance = d; }
    }
    check(home, 'no dry unoccupied starting cell');
    const entry = { status: 'ready', depth, tx: 0, ty: 0, cellsPerEdge: N, tileEdgeM: N * cellM,
      grid, baseGrid: grid.slice(), objects, genObjects: objects.slice(), creatures,
      wildplants: [], genWildplants: [], _spawned: true, hadBin: true, layers: [],
      owners: new Uint16Array(N * N), ownerKeys: [null], poiPadCells: new Set(),
      parkingTreasures: [], extraTreasures: [], coinDrops: [], traps: [], streetLairs: [],
      torchSites: [], buildingShapes: [], roadLabels: {}, pathUnder: {}, treasure: null,
      sandboxArt: art, sandboxCells: cells, sandboxScenario: input.id };
    const entries = { [depth]: entry };
    if (depth) entries[0] = { ...entry, depth: 0, grid: new Uint8Array(N * N).fill(W.T.GRASS),
      baseGrid: new Uint8Array(N * N).fill(W.T.GRASS), objects: [], genObjects: [], creatures: [],
      sandboxArt: undefined, sandboxCells: undefined };
    return { entries, depth, seed: input.seed, variant: input.mode,
      options: { home, lat: 47.62, title: input.title, returnUrl: returnUrl(input.returnUrl), scenario: true } };
  }
  root.SandboxScenarios = { build, returnUrl, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
