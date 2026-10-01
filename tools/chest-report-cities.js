// Chest expectations use the current game's rasterizer and loot identities.
// Fixture bytes are map inputs only; no chest counts or tiers are stored here.
const CHEST_REPORT_CITIES = {
  kelowna: { name: 'Kelowna', centre: [2754, 5566], home: { lon: -119.47870, lat: 49.85438 } },
  vancouver: { name: 'Vancouver', centre: [2588, 5607], home: { lon: -123.12, lat: 49.28 } },
  seattle: { name: 'Seattle', centre: [2624, 5721], home: { lon: -122.3321, lat: 47.6062 } },
  berlin: { name: 'Berlin', centre: [8802, 5373], home: { lon: 13.405, lat: 52.52 } },
};
const CHEST_REPORT_HOME_RADIUS_M = 400;

async function loadChestReportCities(onProgress) {
  const cities = {}, total = Object.keys(CHEST_REPORT_CITIES).length * 9;
  let completed = 0;
  const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
  async function tileBytes(tx, ty) {
    // Match map-distribution's fixture path, then the other report cities'
    // bundled tiles, then the game's cached/live tile resolver.
    for (const [base, source] of [['../test/fixtures', 'fixture'], ['../data/report-tiles', 'report fixture']]) {
      const response = await fetch(`${base}/${tx}_${ty}.pbf`).catch(() => null);
      if (response?.ok) return { bytes: new Uint8Array(await response.arrayBuffer()), source };
    }
    const { bytes, fromCache } = await WorldGen.fetchTileBytes(tx, ty);
    return { bytes: new Uint8Array(bytes), source: fromCache ? 'cached' : 'live' };
  }
  for (const [key, config] of Object.entries(CHEST_REPORT_CITIES)) {
    const city = cities[key] = {
      ...config, homeRadiusM: CHEST_REPORT_HOME_RADIUS_M,
      chests: [], excluded: {}, excludedNear: {}, tiles: [], errors: [],
    };
    const seen = new Set();
    for (let i = 0; i < 9; i++) {
      const tx = config.centre[0] + i % 3 - 1;
      const ty = config.centre[1] + Math.floor(i / 3) - 1;
      const tile = { tx, ty, source: null, chests: 0, excluded: 0 };
      onProgress?.({ city: key, name: config.name, completed, total, message: `${config.name}: tile ${i + 1}/9` });
      await yieldToBrowser();
      try {
        const input = await tileBytes(tx, ty);
        tile.source = input.source;
        const layers = MVT.decodeTileSliced
          ? await MVT.decodeTileSliced(input.bytes, yieldToBrowser, WorldGen.sliceBudgetMs())
          : MVT.decodeTile(input.bytes);
        const edge = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
        const cells = WorldGen.cellsPerEdgeForTile(ty);
        const raster = await WorldGen.runStepsSliced(() => WorldGen.rasterizeTileSteps(layers, cells, tx, ty, edge));
        for (const object of raster.objects) {
          if (object.kind !== 'chest' || (object.depth ?? 0) !== 0 || seen.has(object.id)) continue;
          seen.add(object.id);
          // Placements use this tile row's metre frame, so invert with the
          // same edge, not one shared edge for the entire 3 × 3 block.
          const tileCount = 2 ** WorldGen.Z;
          const lon = object.x / edge / tileCount * 360 - 180;
          const n = Math.PI - 2 * Math.PI * object.y / edge / tileCount;
          const lat = Math.atan(Math.sinh(n)) * 180 / Math.PI;
          const dx = (lon - config.home.lon) * 111320 * Math.cos(config.home.lat * Math.PI / 180);
          const dy = (lat - config.home.lat) * 110540;
          const near = Math.hypot(dx, dy) <= CHEST_REPORT_HOME_RADIUS_M;
          const look = chestLook(object);
          const excluded = look.coin ? 'coin' : look.bike ? 'bike' : look.barrel ? 'barrel'
            : look.macro ? 'macro' : look.stand ? 'stand' : null;
          if (excluded) {
            city.excluded[excluded] = (city.excluded[excluded] || 0) + 1;
            if (near) city.excludedNear[excluded] = (city.excludedNear[excluded] || 0) + 1;
            tile.excluded++;
            continue;
          }
          city.chests.push({
            id: object.id, name: object.name || '', theme: chestThemeFor(object),
            tier: chestTier(object), poiClass: object.poiClass || null,
            lookKey: look.texKey, dens: object.poiDensity ?? null,
            x: object.x, y: object.y, lon, lat, near, tx, ty,
          });
          tile.chests++;
        }
      } catch (error) {
        tile.error = error.message;
        city.errors.push(`${tx}/${ty}: ${error.message}`);
      }
      city.tiles.push(tile);
      completed++;
      onProgress?.({ city: key, name: config.name, completed, total, message: `${config.name}: ${i + 1}/9 tiles processed` });
      await yieldToBrowser();
    }
  }
  return cities;
}
