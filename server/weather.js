'use strict';

const { kindFor } = require('../src/weather_codes.js');

const CACHE_MS = 60 * 60 * 1000;
const ROUND_DEGREES = 0.05;

function weatherError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parsePoint(url) {
  const latValues = url.searchParams.getAll('lat'), lonValues = url.searchParams.getAll('lon');
  if (latValues.length !== 1 || lonValues.length !== 1 || latValues[0] === '' || lonValues[0] === '') {
    throw weatherError('lat and lon required', 400);
  }
  const lat = Number(latValues[0]), lon = Number(lonValues[0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw weatherError('invalid coordinates', 400);
  }
  return { lat, lon };
}

function cacheKey({ lat, lon }) {
  const round = value => Math.round(value / ROUND_DEGREES) * ROUND_DEGREES;
  return `${round(lat).toFixed(2)},${round(lon).toFixed(2)}`;
}

function compactWeather(payload, now = Date.now()) {
  const current = payload && payload.current;
  const code = Number(current?.condition?.code), temp = Number(current?.temp_c), windKph = Number(current?.wind_kph);
  if (!Number.isInteger(code) || !Number.isFinite(temp) || !Number.isFinite(windKph))
    throw weatherError('Weather service unavailable');
  const kind = kindFor(code, current.precip_mm);
  // Today's forecast high and low plus the place's UTC offset let the client
  // interpolate the temperature between hourly measurements.
  const day = payload.forecast?.forecastday?.[0]?.day;
  const hi = Number(day?.maxtemp_c), lo = Number(day?.mintemp_c);
  const epoch = Number(payload.location?.localtime_epoch);
  const local = Date.parse(String(payload.location?.localtime || '').replace(' ', 'T') + 'Z');
  const offset = Number.isFinite(epoch) && Number.isFinite(local) ? Math.round((local - epoch * 1000) / 60000 / 15) * 15 : NaN;
  const measured = Number(current.last_updated_epoch);
  return { precip: kind !== 'none', kind, condition: code, temp: Math.round(temp * 10) / 10,
    windKph: Math.round(windKph * 10) / 10,
    hi: Number.isFinite(hi) && Number.isFinite(lo) ? Math.round(hi * 10) / 10 : null,
    lo: Number.isFinite(hi) && Number.isFinite(lo) ? Math.round(lo * 10) / 10 : null,
    utcOffsetMin: Number.isFinite(offset) ? offset : null,
    measuredAt: Number.isFinite(measured) && measured > 0 ? measured * 1000 : now, cachedAt: now };
}

function createWeatherService(options = {}) {
  const apiKey = options.apiKey === undefined ? process.env.WEATHERAPI_KEY : options.apiKey;
  const fetchWeather = options.fetch || global.fetch;
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs || CACHE_MS;
  const cache = new Map(), pending = new Map();

  async function load(point) {
    if (!apiKey) throw weatherError('weather disabled');
    if (typeof fetchWeather !== 'function') throw weatherError('Weather service unavailable');
    const upstream = new URL('https://api.weatherapi.com/v1/forecast.json');
    upstream.searchParams.set('key', apiKey);
    upstream.searchParams.set('q', `${point.lat},${point.lon}`);
    upstream.searchParams.set('days', '1');
    upstream.searchParams.set('aqi', 'no');
    upstream.searchParams.set('alerts', 'no');
    let response;
    try { response = await fetchWeather(upstream); } catch (_) { throw weatherError('Weather service unavailable'); }
    if (!response?.ok) throw weatherError('Weather service unavailable');
    let payload;
    try { payload = await response.json(); } catch (_) { throw weatherError('Weather service unavailable'); }
    return compactWeather(payload, now());
  }

  async function get(point) {
    const key = cacheKey(point), at = now(), cached = cache.get(key);
    if (cached && at - cached.cachedAt < ttlMs) return cached;
    if (pending.has(key)) return pending.get(key);
    const promise = load(point).then(value => { cache.set(key, value); return value; })
      .finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

  return { get, cache };
}

module.exports = { CACHE_MS, ROUND_DEGREES, parsePoint, cacheKey, compactWeather, createWeatherService };
