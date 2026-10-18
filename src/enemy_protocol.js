// Shared browser/relay enemy snapshot contract. Keep complete damage vectors;
// dropping acknowledged origins would cause receivers to apply damage twice.
(function (root) {
'use strict';
const MOVE_NUMBERS = ['_idleAngle', '_avoidSide', '_hopMs', '_batLeg', '_lungeAngle'];
const MOVE_FLAGS = ['_batSwooping', '_batHit', '_lungeHit', '_burrowed', '_hasEmerged'];
const MOVE_TIMERS = ['_idleTurnT', '_nextChooseT', '_stepT0', '_batPauseUntil', '_lungeUntil',
  '_lungeWindupUntil', '_lungeRecoverUntil', '_lungeNextT', '_burrowNextT', '_emergeUntil'];
const MOVE_POINTS = [['_startX', '_startY'], ['_targetX', '_targetY']];
const MOVE_KEYS = new Set([...MOVE_NUMBERS, ...MOVE_FLAGS, ...MOVE_TIMERS, ...MOVE_POINTS.flat(), '_batFlight', '_movementDecisions']);
const FLIGHT_KEYS = new Set(['x', 'y', 'tx', 'ty', 'start', 'duration', 'jx', 'jy']);
const SYNC_ORIGIN_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SYNC_MAX_ORIGINS = 32;
const SYNC_MAX_TOTAL = 1e6;
function cleanEnemyState(raw, { rejectUnknown = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { q, h, x, y, v, m, pid } = raw;
  const coordinate = n => Number.isFinite(n) && n >= 0 && n <= 4194304;
  if (!Number.isSafeInteger(q) || q < 1 || !Number.isFinite(h) || h < 0 || h > 1 || !coordinate(x) || !coordinate(y)) return null;
  if (!Array.isArray(v) || v.length > SYNC_MAX_ORIGINS) return null;
  const origins = new Set();
  for (const row of v) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !SYNC_ORIGIN_RE.test(row[0]) ||
        !Number.isFinite(row[1]) || row[1] < 0 || row[1] > SYNC_MAX_TOTAL || origins.has(row[0])) return null;
    origins.add(row[0]);
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  if (rejectUnknown && Object.keys(m).some(key => !MOVE_KEYS.has(key))) return null;
  const movement = {};
  for (const key of [...MOVE_NUMBERS, ...MOVE_TIMERS]) {
    if (m[key] === undefined) continue;
    if (!Number.isFinite(m[key]) || Math.abs(m[key]) > 300000) return null;
    movement[key] = m[key];
  }
  for (const key of MOVE_FLAGS) {
    if (m[key] === undefined) continue;
    if (typeof m[key] !== 'boolean') return null;
    movement[key] = m[key];
  }
  if (m._batFlight !== undefined) {
    const f = m._batFlight;
    if (f === null) movement._batFlight = null;
    else {
      if (!f || typeof f !== 'object' || Array.isArray(f) || ![f.x, f.y, f.tx, f.ty].every(coordinate) ||
          !Number.isFinite(f.start) || Math.abs(f.start) > 300000 || !Number.isFinite(f.duration) || f.duration <= 0 || f.duration > 300000) return null;
      // Legacy clients omit the bow; current clients send both vector components.
      if ((f.jx === undefined) !== (f.jy === undefined) ||
          !['jx', 'jy'].every(key => f[key] === undefined || (Number.isFinite(f[key]) && Math.abs(f[key]) <= 4194304)) ||
          (rejectUnknown && Object.keys(f).some(key => !FLIGHT_KEYS.has(key)))) return null;
      movement._batFlight = { x: f.x, y: f.y, tx: f.tx, ty: f.ty, start: f.start, duration: f.duration };
      if (f.jx !== undefined) { movement._batFlight.jx = f.jx; movement._batFlight.jy = f.jy; }
    }
  }
  for (const [kx, ky] of MOVE_POINTS) {
    if (m[kx] === undefined && m[ky] === undefined) continue;
    if (!coordinate(m[kx]) || !coordinate(m[ky])) return null;
    movement[kx] = m[kx]; movement[ky] = m[ky];
  }
  if (m._movementDecisions !== undefined) {
    const decisions = m._movementDecisions;
    if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions) || Object.keys(decisions).length > 32) return null;
    const copy = {};
    for (const [key, n] of Object.entries(decisions)) {
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(key) || !Number.isSafeInteger(n) || n < 0 || n > 1e9) return null;
      copy[key] = n;
    }
    movement._movementDecisions = copy;
  }
  if (pid !== undefined && (!Number.isSafeInteger(pid) || pid < 1)) return null;
  return { q, h, x, y, v: v.map(row => [...row]), m: movement, ...(pid === undefined ? {} : { pid }) };
}
const api = { cleanEnemyState, SYNC_ORIGIN_RE, SYNC_MAX_ORIGINS, SYNC_MAX_TOTAL,
  MOVE_NUMBERS, MOVE_FLAGS, MOVE_TIMERS, MOVE_POINTS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.EnemyProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
