// Live weather comes through the credential-protecting relay. It is a runtime
// overlay only: generated ids, tile-cache keys and saved object identity never
// depend on it. EFFECTS is the one owner of every weather band, duration,
// multiplier, colour and cadence used by presentation or gameplay.
const Weather = (() => {
  'use strict';

  const EFFECTS = Object.freeze({
    pollMs: 60 * 60 * 1000,
    movePollM: 1000,
    // Between hourly measurements the readout follows a daily curve through the
    // forecast low (at dawn) and high (mid-afternoon), local solar-clock hours.
    diurnal: Object.freeze({ lowHour: 6, highHour: 15 }),
    windyKph: 10,
    maxForegroundStepMs: 1000,
    precipitation: Object.freeze({
      none: null,
      drizzle: Object.freeze({ frequency: 260, speedX: [15, 28], speedY: [150, 210], lifespan: 2600, scale: 1.45, alpha: 0.58 }),
      rain: Object.freeze({ frequency: 72, speedX: [28, 46], speedY: [250, 340], lifespan: 1800, scale: 1.6, alpha: 0.82 }),
      sleet: Object.freeze({ frequency: 130, speedX: [5, 18], speedY: [210, 280], lifespan: 2100, scale: 1.45, alpha: 0.72 }),
      snow: Object.freeze({ frequency: 240, speedX: [-8, 8], speedY: [50, 78], lifespan: 6200, scale: 1.3, alpha: 0.68 }),
    }),
    rain: Object.freeze({ cropCadenceMs: 20 * 1000 }),
    cold: Object.freeze({
      maxTempC: 0,
      grassTint: 0xd8bd55,
      frozenMs: 10 * 1000,
      auraTint: 0x68bfff, auraPeak: 0.34, auraAlpha: 0.34, auraSize: 54, auraPulsePx: 5, auraPeriodMs: 2400,
      lightTint: 0x96cfff, lightMix: 0.12,
      enemyBirth: Object.freeze({ from: 'slime', kind: 'split_slime', baseWeight: 1, themedWeight: 3 }),
    }),
    hot: Object.freeze({
      minTempC: 28,
      workCostMul: 2,
      hardworkingMs: 10 * 60 * 1000,
      feedbackCooldownMs: 12 * 1000,
      feedback: 'It’s too hot!',
      auraTint: 0xff6a3d, auraPeak: 0.32, auraAlpha: 0.3, auraSize: 54, auraPulsePx: 5, auraPeriodMs: 2000,
      lightTint: 0xff8b62, lightMix: 0.11,
      enemyBirth: Object.freeze({ from: 'slime', kind: 'fire_slime', baseWeight: 1, themedWeight: 3 }),
    }),
  });
  const POLL_MS = EFFECTS.pollMs, MOVE_POLL_M = EFFECTS.movePollM;
  const KINDS = EFFECTS.precipitation;
  const EARTH_M = 6371000;
  const S = {
    scene: null, kind: 'none', precip: false, condition: 0, temp: null, windKph: null, cachedAt: 0,
    hi: null, lo: null, utcOffsetMin: null, measuredAt: 0,
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

  // 0 at the forecast low hour, 1 at the high hour, half-cosine between them.
  function diurnalShare(localHour) {
    const { lowHour, highHour } = EFFECTS.diurnal;
    const h = ((localHour % 24) + 24) % 24;
    const rise = highHour - lowHour, since = ((h - lowHour) % 24 + 24) % 24;
    const t = since <= rise ? since / rise : 1 - (since - rise) / (24 - rise);
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }

  // The latest measurement moves along the hi/low curve by the time elapsed
  // since it was taken; without a forecast the measurement stands as is.
  function estimateTemp(now = Date.now(), s = S) {
    if (!Number.isFinite(s.temp)) return null;
    const { hi, lo, utcOffsetMin: offset, measuredAt } = s;
    if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi < lo || !Number.isFinite(offset) || !(measuredAt > 0)) return s.temp;
    const hour = at => (at / 3600000 + offset / 60) % 24;
    const value = s.temp + (hi - lo) * (diurnalShare(hour(now)) - diurnalShare(hour(measuredAt)));
    return Math.min(Math.max(hi, s.temp), Math.max(Math.min(lo, s.temp), value));
  }

  function currentTemp(now = Date.now()) {
    const value = estimateTemp(now);
    return value == null ? null : Math.round(value);
  }

  function band(temp = currentTemp()) {
    const value = typeof temp === 'object' ? temp?.temp : temp;
    if (!Number.isFinite(value)) return 'mild';
    if (value <= EFFECTS.cold.maxTempC) return 'cold';
    if (value > EFFECTS.hot.minTempC) return 'hot';
    return 'mild';
  }

  function surfaceBand(scene) { return (scene?.depth || 0) === 0 ? band() : 'mild'; }
  function effectiveKind(kind, depth) { return (depth || 0) > 0 || !KINDS[kind] ? 'none' : kind; }
  function lightEffect(scene) {
    const row = EFFECTS[surfaceBand(scene)];
    return row?.lightTint == null ? null : { tint: row.lightTint, mix: row.lightMix };
  }
  function auraEffect(scene) {
    const name = surfaceBand(scene), row = EFFECTS[name];
    return row?.auraTint == null ? null : { band: name, ...row };
  }
  function coldGrassTint(scene, crop) {
    return crop === 'longgrass' && surfaceBand(scene) === 'cold' ? EFFECTS.cold.grassTint : null;
  }

  function enemyBirthKind(kind, id, scene) {
    const row = EFFECTS[surfaceBand(scene)]?.enemyBirth;
    if (!row || kind !== row.from || !id) return kind;
    const total = row.baseWeight + row.themedWeight;
    const value = typeof hash01 === 'function' ? hash01(`${id}:weather:${surfaceBand(scene)}`) : 0.5;
    return value * total < row.themedWeight ? row.kind : kind;
  }

  function hardworking(scene, now = Date.now()) {
    return typeof Buffs !== 'undefined' && Buffs.until('work', scene?.save, scene) > now;
  }
  function workCostMultiplier(scene, now = Date.now()) {
    return surfaceBand(scene) === 'hot' && !hardworking(scene, now) ? EFFECTS.hot.workCostMul : 1;
  }
  function workCost(scene, cost, now = Date.now()) {
    return Math.ceil(Math.max(0, Number(cost) || 0) * workCostMultiplier(scene, now));
  }
  function showHeatFeedback(scene, sx, sy, now = Date.now()) {
    if (workCostMultiplier(scene, now) === 1) return false;
    const previous = Number(scene?._weatherHeatFeedbackAt) || 0;
    if (previous && now - previous < EFFECTS.hot.feedbackCooldownMs) return false;
    scene._weatherHeatFeedbackAt = now;
    if (sx != null && sy != null && typeof scene.flash === 'function') scene.flash(EFFECTS.hot.feedback, sx, sy, EFFECTS.hot.auraTint);
    else scene.flashAtPlayer?.(EFFECTS.hot.feedback, EFFECTS.hot.auraTint);
    return true;
  }

  // This clock accumulates only foreground time spent in the surface cold band.
  // SaveState subtracts the runtime-only offset when judging known longgrass
  // deadlines; no saved deadline is moved, reset or rerolled.
  function advanceGameplayClock(scene, now = Date.now(), foregroundMs = null) {
    if (!scene) return;
    const clock = scene._weatherGrassClock || (scene._weatherGrassClock = { at: now, cold: surfaceBand(scene) === 'cold', total: 0 });
    const elapsed = Number.isFinite(foregroundMs)
      ? Math.min(EFFECTS.maxForegroundStepMs, Math.max(0, foregroundMs)) : Math.max(0, now - clock.at);
    if (clock.cold) clock.total += elapsed;
    clock.at = now; clock.cold = surfaceBand(scene) === 'cold';
  }
  function coldGrassPauseMs(scene) {
    return scene?._weatherGrassClock?.total || 0;
  }

  function stableCropKey(p) {
    return `${Number(p?.x) || 0},${Number(p?.y) || 0}:${String(p?.crop || '')}`;
  }
  function waterRainCrop(scene, now) {
    if (!S.precip || !['drizzle', 'rain', 'sleet'].includes(S.kind) || (scene?.depth || 0) !== 0) {
      scene._weatherRainWaterAt = now;
      return false;
    }
    const last = Number(scene._weatherRainWaterAt);
    if (!Number.isFinite(last)) { scene._weatherRainWaterAt = now; return false; }
    if (now - last < EFFECTS.rain.cropCadenceMs) return false;
    scene._weatherRainWaterAt = now;
    const candidates = (scene.save?.planted || []).filter(p => (p.stage ?? 0) < Crops.maxStage() && !p.watered_t)
      .slice().sort((a, b) => stableCropKey(a).localeCompare(stableCropKey(b)));
    if (!candidates.length) return false;
    const index = (scene._weatherRainCropCursor || 0) % candidates.length;
    scene._weatherRainCropCursor = index + 1;
    // No watering-can relic is passed, so weather can only start the ordinary
    // stage hold; it can never trigger the can's immediate stage jump.
    const result = Crops.waterOne(scene.save, candidates[index], null, now, () => 0.5);
    if (!result) return false;
    if (typeof persistSave === 'function') persistSave(scene.save);
    scene.drawObjects?.();
    return true;
  }

  function waterContact(scene, inWater, now = Date.now()) {
    const entering = !!inWater && !scene?._weatherInWater;
    if (scene) scene._weatherInWater = !!inWater;
    if (!entering || (scene?.depth || 0) !== 0 || !scene.save) return false;
    const name = surfaceBand(scene);
    let changed = false;
    if (name === 'cold' && typeof Conditions !== 'undefined') {
      changed = Conditions.apply(scene.save, 'frozen', now, { durationMs: EFFECTS.cold.frozenMs }) || Conditions.active(scene.save, 'frozen');
    } else if (name === 'hot' && typeof Buffs !== 'undefined') {
      changed = Buffs.extend(scene.save, scene, 'work', EFFECTS.hot.hardworkingMs, now);
    }
    if (changed) {
      if (typeof persistSave === 'function') persistSave(scene.save);
      scene._syncStatusRow?.();
    }
    return changed;
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
        alpha: { start: row.alpha, end: 0.12 }, quantity: 1,
      });
      S.emitter.setDepth?.(90); S.emitter.setScrollFactor?.(0);
      S.drawnKind = kind; S.drawnLayout = layout;
    } catch (_) { destroyEmitter(); }
  }

  function accept(value) {
    const kind = value && typeof value.kind === 'string' && Object.prototype.hasOwnProperty.call(KINDS, value.kind) ? value.kind : 'none';
    S.kind = value?.precip ? kind : 'none'; S.precip = S.kind !== 'none';
    S.condition = Number.isInteger(value?.condition) ? value.condition : 0;
    S.temp = Number.isFinite(value?.temp) ? value.temp : null;
    S.hi = Number.isFinite(value?.hi) ? value.hi : null;
    S.lo = Number.isFinite(value?.lo) ? value.lo : null;
    S.utcOffsetMin = Number.isFinite(value?.utcOffsetMin) ? value.utcOffsetMin : null;
    S.measuredAt = Number(value?.measuredAt) || Number(value?.cachedAt) || 0;
    S.windKph = Number.isFinite(value?.windKph) ? Math.round(value.windKph * 10) / 10 : null;
    S.cachedAt = Number(value?.cachedAt) || 0;
    if (S.scene) syncOverlay(S.scene);
  }

  async function poll(scene, position, now) {
    if (S.loading || typeof fetch !== 'function' || typeof Multiplayer === 'undefined') return;
    S.loading = true; S.lastPollAt = now; S.lastPosition = position;
    const url = new URL(Multiplayer.httpUrl() + '/weather');
    url.searchParams.set('lat', position.lat.toFixed(5)); url.searchParams.set('lon', position.lon.toFixed(5));
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.status === 503) { accept({ precip: false, kind: 'none' }); return; }
      if (!response.ok) return;
      accept(await response.json());
    } catch (_) {
      // Network weather is optional; the last good state remains until retry.
    } finally { S.loading = false; }
  }

  function tick(scene, now = Date.now(), foregroundMs = null) {
    if (!scene || S.stopped) return;
    syncOverlay(scene); advanceGameplayClock(scene, now, foregroundMs); waterRainCrop(scene, now);
    if ((scene.depth || 0) > 0 || !scene.playerM || typeof localMToLonLat !== 'function' || typeof playerWorldM !== 'function') return;
    const player = playerWorldM(scene), position = localMToLonLat(scene, player.x, player.y);
    if (pollNeeded(S.lastPollAt, S.lastPosition, now, position)) poll(scene, position, now);
  }

  function stop() { destroyEmitter(); S.scene = null; S.stopped = true; S.loading = false; }
  function start(scene) {
    if (!scene) return;
    if (S.scene && S.scene !== scene) stop();
    S.scene = scene; S.stopped = false;
    scene.events?.once?.('shutdown', () => { if (S.scene === scene) stop(); });
    tick(scene);
  }
  // The readout's one-word condition: precipitation kind, else fog or mist.
  function conditionLabel() {
    if (S.precip) return S.kind;
    return typeof WeatherCodes !== 'undefined' ? WeatherCodes.labelFor(S.condition, 0) : '';
  }
  function windy() { return Number.isFinite(S.windKph) && S.windKph > EFFECTS.windyKph; }

  function state(now = Date.now()) { return { kind: S.kind, precip: S.precip, condition: S.condition,
    temp: currentTemp(now), windKph: S.windKph, hi: S.hi, lo: S.lo, cachedAt: S.cachedAt }; }

  return { EFFECTS, POLL_MS, MOVE_POLL_M, KINDS, distanceM, pollNeeded, band, surfaceBand,
    effectiveKind, lightEffect, auraEffect, coldGrassTint, enemyBirthKind, workCostMultiplier, workCost,
    showHeatFeedback, advanceGameplayClock, coldGrassPauseMs, waterRainCrop, waterContact, accept,
    diurnalShare, estimateTemp, currentTemp, conditionLabel, windy,
    conditionKind: (code, precipMm) => WeatherCodes.kindFor(code, precipMm), start, stop, tick, state };
})();
if (typeof window !== 'undefined') window.Weather = Weather;
