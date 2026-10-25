// Live precipitation is presentation only. The relay protects the WeatherAPI
// key and returns a compact state; this module owns polling and the RA overlay.
const Weather = (() => {
  'use strict';

  const POLL_MS = 10 * 60 * 1000;
  const MOVE_POLL_M = 1000;
  const EARTH_M = 6371000;
  // One table owns density and motion for every relay kind. The turquoise
  // Rogue Adventure water-drop frames stay crisp at the game's 2x art scale.
  const KINDS = Object.freeze({
    none: null,
    drizzle: Object.freeze({ frequency: 260, speedX: [15, 28], speedY: [150, 210], lifespan: 2600, scale: 1.45, alpha: 0.58 }),
    rain: Object.freeze({ frequency: 72, speedX: [28, 46], speedY: [250, 340], lifespan: 1800, scale: 1.6, alpha: 0.82 }),
    sleet: Object.freeze({ frequency: 130, speedX: [5, 18], speedY: [210, 280], lifespan: 2100, scale: 1.45, alpha: 0.72 }),
    snow: Object.freeze({ frequency: 240, speedX: [-8, 8], speedY: [50, 78], lifespan: 6200, scale: 1.3, alpha: 0.68 }),
  });
  const S = {
    scene: null, kind: 'none', precip: false, condition: 0, cachedAt: 0,
    lastPollAt: 0, lastPosition: null, loading: false, emitter: null,
    drawnKind: 'none', drawnLayout: '', stopped: true,
  };

  function distanceM(a, b) {
    if (!a || !b) return Infinity;
    const rad = Math.PI / 180, p1 = a.lat * rad, p2 = b.lat * rad;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function pollNeeded(lastAt, lastPosition, now, position) {
    return !lastAt || now - lastAt >= POLL_MS || distanceM(lastPosition, position) >= MOVE_POLL_M;
  }

  function effectiveKind(kind, depth) {
    return (depth || 0) > 0 || !KINDS[kind] ? 'none' : kind;
  }

  function destroyEmitter() {
    if (S.emitter) {
      try { S.emitter.destroy(); } catch (_) {}
      S.emitter = null;
    }
    S.drawnKind = 'none'; S.drawnLayout = '';
  }

  function syncOverlay(scene) {
    const kind = effectiveKind(S.kind, scene?.depth);
    const left = scene?.viewLeft || 0, top = scene?.viewTop || 0;
    const size = scene?.viewSize || Math.max(scene?.scale?.width || 320, scene?.scale?.height || 320);
    const layout = `${left}:${top}:${size}`;
    if (kind === S.drawnKind && layout === S.drawnLayout && (kind === 'none' || S.emitter)) return;
    destroyEmitter();
    if (kind === 'none' || !scene?.add?.particles || !scene.textures?.exists?.('weather_rain')) return;
    const row = KINDS[kind];
    try {
      S.emitter = scene.add.particles(0, 0, 'weather_rain', {
        frame: [0, 1, 2, 3],
        x: { min: left - 24, max: left + size + 24 }, y: top - 24,
        speedX: { min: row.speedX[0], max: row.speedX[1] },
        speedY: { min: row.speedY[0], max: row.speedY[1] },
        lifespan: row.lifespan, frequency: row.frequency,
        scale: { start: row.scale, end: row.scale * 0.75 },
        alpha: { start: row.alpha, end: 0.12 },
        quantity: 1,
      });
      S.emitter.setDepth?.(90);
      S.emitter.setScrollFactor?.(0);
      S.drawnKind = kind; S.drawnLayout = layout;
    } catch (_) { destroyEmitter(); }
  }

  function accept(value) {
    const kind = value && typeof value.kind === 'string' && Object.prototype.hasOwnProperty.call(KINDS, value.kind) ? value.kind : 'none';
    S.kind = value?.precip ? kind : 'none';
    S.precip = S.kind !== 'none';
    S.condition = Number.isInteger(value?.condition) ? value.condition : 0;
    S.cachedAt = Number(value?.cachedAt) || 0;
    if (S.scene) syncOverlay(S.scene);
  }

  async function poll(scene, position, now) {
    if (S.loading || typeof fetch !== 'function' || typeof Multiplayer === 'undefined') return;
    S.loading = true; S.lastPollAt = now; S.lastPosition = position;
    const url = new URL(Multiplayer.httpUrl() + '/weather');
    url.searchParams.set('lat', position.lat.toFixed(5));
    url.searchParams.set('lon', position.lon.toFixed(5));
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.status === 503) { accept({ precip: false, kind: 'none' }); return; }
      if (!response.ok) return;
      accept(await response.json());
    } catch (_) {
      // Network weather is optional; the last good state remains until retry.
    } finally { S.loading = false; }
  }

  function tick(scene, now = Date.now()) {
    if (!scene || S.stopped) return;
    syncOverlay(scene);
    if ((scene.depth || 0) > 0 || !scene.playerM || typeof localMToLonLat !== 'function' || typeof playerWorldM !== 'function') return;
    const player = playerWorldM(scene), position = localMToLonLat(scene, player.x, player.y);
    if (pollNeeded(S.lastPollAt, S.lastPosition, now, position)) poll(scene, position, now);
  }

  function stop() {
    destroyEmitter();
    S.scene = null; S.stopped = true; S.loading = false;
  }

  function start(scene) {
    if (!scene) return;
    if (S.scene && S.scene !== scene) stop();
    S.scene = scene; S.stopped = false;
    scene.events?.once?.('shutdown', () => { if (S.scene === scene) stop(); });
    tick(scene);
  }

  function state() {
    return { kind: S.kind, precip: S.precip, condition: S.condition, cachedAt: S.cachedAt };
  }

  return { POLL_MS, MOVE_POLL_M, KINDS, distanceM, pollNeeded, effectiveKind,
    conditionKind: (code, precipMm) => WeatherCodes.kindFor(code, precipMm), start, stop, tick, state };
})();
if (typeof window !== 'undefined') window.Weather = Weather;
