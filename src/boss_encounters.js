// BOSS ENCOUNTERS — the one routine every boss fight shares: a citadel's
// garrison (houses.js) and the serpent a Serpent Idol raises
// (scene_boss.js). A fight is a record in its kind's store on the save,
// keyed by what triggered it: { startedAt, own, depth, ...the kind's fields }.
//   ACTIVE while the wall clock is short of startedAt + the kind's duration
//   and nothing has ended it (the clock runs while the player is away).
//   RESET when it times out, or when the player who STARTED it (`own`; a
//   battle adopted from another player is not theirs to end) goes down or
//   leaves its floor (abandon). The record is dropped by expire() and the
//   kind's scene hook undoes the fight — despawns the foes and forgets their
//   defeats — so the trigger can be used again later.
//   WON: the kind's victory hook spends the trigger for good (a citadel is
//   claimed, the idol is consumed) and drops the record.
// Pure: no Phaser, no scene. A new kind of boss is a KINDS row.
const BossEncounters = (() => {
  const KINDS = {
    // `store` is the save key holding the kind's records (the citadel's is
    // the shape multiplayer shares; keep it). `chip` is the status-row chip.
    citadel: { store: 'citadelBattles', durationMs: 10 * 60 * 1000,
      chip: { label: 'Citadel', ink: '#ffe9b0', bg: '#4a2a12e8' },
      resetLine: 'The garrison withdraws. The fight resets.' },
    // The serpent's body and gait (scene_boss.js): `coils` struck pieces
    // `spacingCells` apart on the head's trail; raised `spawnCells` off;
    // the head's goals on a `ringCells` ring about the player, `throughP` of
    // them straight through the player, re-aimed each `goalMs`, turning at
    // most `turnRadPerS`; a coil within `touchCells` bites.
    serpent: { store: 'bossEncounters', durationMs: 5 * 60 * 1000,
      coils: 12, spacingCells: 0.55, spawnCells: 6, ringCells: [2, 7], throughP: 0.35,
      goalMs: 4000, turnRadPerS: 2.6, touchCells: 0.5,
      chip: { label: 'Serpent', ink: '#c8ffd0', bg: '#123a24e8' },
      resetLine: 'The serpent sinks away. The idol is still yours.' },
  };

  function store(save, kind, create = false) {
    const key = KINDS[kind]?.store;
    if (!key || !save) return null;
    const s = save[key];
    if (s && typeof s === 'object' && !Array.isArray(s)) return s;
    return create ? (save[key] = {}) : null;
  }
  function get(save, kind, key) { return store(save, kind)?.[key] || null; }
  function remainingMs(save, kind, key, now = Date.now()) {
    const r = get(save, kind, key);
    if (!r || r.abandoned || !Number.isFinite(r.startedAt)) return 0;
    return Math.max(0, r.startedAt + KINDS[kind].durationMs - now);
  }
  function active(save, kind, key, now = Date.now()) { return remainingMs(save, kind, key, now) > 0; }
  // Start a fight this player triggered. Refused while a record for the key
  // exists (an expired one is cleared by expire() first).
  function start(save, kind, key, fields = {}, now = Date.now()) {
    if (!key || !KINDS[kind] || get(save, kind, key)) return null;
    const record = { startedAt: now, own: true, depth: 0, ...fields };
    store(save, kind, true)[key] = record;
    return record;
  }
  // Drop the records that are no longer active (timed out or abandoned);
  // the caller resets each one's fight.
  function expire(save, kind, now = Date.now()) {
    const out = [], s = store(save, kind);
    for (const [key, record] of Object.entries(s || {})) {
      if (active(save, kind, key, now)) continue;
      out.push({ kind, key, record, reason: record.abandoned || 'timeout' });
      delete s[key];
    }
    return out;
  }
  // End the player's own fights they can no longer be in: every one when
  // they are down, and any on another floor. Marks them (expire() collects
  // them); returns what it ended.
  function abandon(save, { depth = 0, downed = false } = {}, now = Date.now()) {
    const out = [];
    for (const kind of Object.keys(KINDS)) {
      for (const [key, record] of Object.entries(store(save, kind) || {})) {
        if (record.own !== true || !active(save, kind, key, now)) continue;
        const reason = downed ? 'downed' : (record.depth || 0) !== depth ? 'left' : null;
        if (!reason) continue;
        record.abandoned = reason;
        out.push({ kind, key, record, reason });
      }
    }
    return out;
  }
  // Every live fight, for the status row.
  function list(save, now = Date.now()) {
    const out = [];
    for (const kind of Object.keys(KINDS)) {
      for (const key of Object.keys(store(save, kind) || {})) {
        const left = remainingMs(save, kind, key, now);
        if (left > 0) out.push({ kind, key, record: get(save, kind, key), remainingMs: left });
      }
    }
    return out;
  }
  return { KINDS, store, get, remainingMs, active, start, expire, abandon, list };
})();
(typeof window !== 'undefined' ? window : globalThis).BossEncounters = BossEncounters;
