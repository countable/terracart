// ─────────────────────────────────────────────────────────────────────────
// Combat — the ONE place the fight maths lives.
//
// Before this module a fight was a TIMER: you tapped a foe, a work wheel ran
// for `toolDurationMs × hp/15`, and when the arc closed the creature died. The
// weapon you carried only ever changed how long that arc took, and all three
// weapons (sword / bow / staff) did the identical thing.
//
// Now a fight is HIT POINTS, and the three weapons reach them differently:
//
//   sword          — melee. The combat wheel drains the foe's HP while it runs
//                    (app.js `startCombat` / `_drawWorkProgress`), and owning
//                    one AUTO-ENGAGES the nearest enemy in reach, so you don't
//                    have to tap a slime that's already chewing on you.
//   bow / staff    — ranged. While an enemy is on screen they loose one shot a
//                    second along the COMPASS HEADING (app.js `_combatTick`) —
//                    they do not home, so you aim by turning. A hit drains the
//                    same HP pool the melee wheel does.
//   bare hands     — still work, still slow (the 9 s tier-0 rung).
//
// KILL TIMES ARE INHERITED, NOT RE-TUNED. The old wheel spent
// `toolDurationMs × hp/15` ms on a target, so the damage per second that
// reproduces it exactly is `15000 / toolDurationMs` — see `dpsForDurationMs`.
// One shot carries one second of that same rate, so a bow of tier N landing
// every shot does exactly what a sword of tier N does in melee. Everything
// below is derived from that one identity; nothing here is a magic number
// picked to feel right.
//
// WHAT COUNTS AS AN ENEMY (`isEnemy`): things that attack YOU — the cave
// monsters and the wild surface slime. Crows and deer are NOT enemies: they're
// game. Nothing auto-fires at them and no shot can hit them, so hunting stays
// a deliberate tap on the old timed wheel (and still takes any weapon's tier,
// bow and staff included — a bow-only player can still bring down a deer).
//
// Node-testable: no DOM, no Phaser, no WorldGen. The monster stat table lives
// in app.js, which headless tests don't load, so app.js hands it over once via
// `registerMonsters` and tests register a synthetic one.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // The MONSTERS table from app.js, registered at load. Kept as a reference
  // (not a copy) so a kind added there is an enemy here the same instant.
  let MONSTER_STATS = {};
  function registerMonsters(table) { MONSTER_STATS = table || {}; }

  // Non-monster fauna that can take damage. cat/dog/crow/deer are the pet-combat
  // ladder (a tame dog hunting a deer); `slime` is the surface pest, the one
  // non-monster kind that is also an ENEMY. app.js reads this through
  // creatureMaxHp so the pet fight and the player fight can't drift apart.
  const FAUNA_HP = { cat: 20, dog: 40, crow: 8, deer: 15, slime: 15 };

  function creatureMaxHp(kind) {
    const m = MONSTER_STATS[kind];
    if (m && Number.isFinite(m.hp)) return m.hp;
    return FAUNA_HP[kind] ?? 10;
  }

  // Hostile kinds — every cave monster, plus the surface slime.
  function isEnemyKind(kind) {
    return !!MONSTER_STATS[kind] || kind === 'slime';
  }
  // A hostile INSTANCE. A slime tamed with a sapphire (id 'released_…') is a
  // pet: it must never be shot at, auto-engaged, or counted as "an enemy is on
  // screen" for the auto-fire gate.
  function isEnemy(c) {
    if (!c) return false;
    if (typeof c.id === 'string' && c.id.startsWith('released_')) return false;
    return isEnemyKind(c.kind);
  }

  // Current HP, lazily seeded from the kind's max the first time anything hits
  // it. Creatures are re-spawned from tile data on every reload, so `_hp` is
  // in-memory only — a foe you softened up and walked away from is whole again
  // next session, exactly like the timed wheel it replaces.
  function hp(c) {
    if (!Number.isFinite(c._hp)) c._hp = creatureMaxHp(c.kind);
    return c._hp;
  }
  // Apply `amount` damage; returns the HP left (never below 0).
  function damage(c, amount) {
    c._hp = Math.max(0, hp(c) - Math.max(0, amount));
    return c._hp;
  }
  function hpFraction(c) {
    const max = creatureMaxHp(c.kind) || 1;
    return Math.max(0, Math.min(1, hp(c) / max));
  }

  // ── Damage ladders ───────────────────────────────────────────────────────
  // The identity described at the top: a wheel that took `durMs` to strip the
  // 15-HP slime baseline was dealing 15000/durMs HP per second. Bare hands
  // (tier 0, 9000 ms) → 1.67 dps; wood (4000) → 3.75; frost (300) → 50.
  const BASELINE_HP = 15;
  function dpsForDurationMs(durMs) { return (BASELINE_HP * 1000) / Math.max(1, durMs); }

  // Melee is the SWORD's job now. Bow and staff shoot instead of swinging, so
  // they no longer shorten the combat wheel — carrying one and no sword fights
  // at the bare-handed rung, and the shots are what make up the difference.
  function meleeDps(relics) {
    const slot = relics && relics.sword ? 'sword' : null;
    return dpsForDurationMs(toolDurationMs(relics, slot));
  }

  const FIRE_INTERVAL_MS = 1000;          // "1/s", as asked
  const RANGED_SLOTS = ['bow', 'staff'];
  // Per-slot shot geometry. `phaseMs` staggers the staff half a beat off the
  // bow so a player carrying both hears an alternating patter rather than one
  // doubled thud. Ranges/speeds are in CELLS and cells-per-second so they hold
  // at any cell size; the viewport is 11 cells wide, so a bow shot crosses the
  // screen and a staff bolt very nearly does.
  const SHOT = {
    bow:   { speedCps: 4.5, rangeCells: 8, color: 0xffe6a8, lenPx: 9, widthPx: 2, phaseMs: 0 },
    staff: { speedCps: 3.2, rangeCells: 7, color: 0x9ad6ff, lenPx: 6, widthPx: 3, phaseMs: 500 },
  };
  // How close a shot has to pass to a foe's feet to count as a hit, in cells.
  // Deliberately generous: the heading comes off a phone COMPASS, which is
  // coarse and jittery, so a strict hit box would make the whole mechanic read
  // as broken. Just under a cell puts a foe eight cells out inside a ~7° cone.
  const HIT_RADIUS_CELLS = 0.9;

  // Damage per shot: one second of that weapon tier's melee-equivalent rate,
  // fired once a second. An empty slot fires nothing at all.
  function shotDamage(relics, slot) {
    if (!relics || !relics[slot]) return 0;
    const perSecond = dpsForDurationMs(toolDurationMs(relics, slot));
    return Math.max(1, Math.round(perSecond * FIRE_INTERVAL_MS / 1000));
  }

  // A shot in flight. `dir` is the compass heading (need not be normalised);
  // a zero-length heading is refused rather than firing a shot that sits on
  // the player's feet forever.
  function spawnShot(slot, x, y, dir, cellM, dmg) {
    const mag = Math.hypot(dir?.x || 0, dir?.y || 0);
    if (!(mag > 0)) return null;
    const spec = SHOT[slot];
    return {
      slot, x, y,
      vx: dir.x / mag, vy: dir.y / mag,
      speedMps: spec.speedCps * cellM,
      rangeM: spec.rangeCells * cellM,
      travelledM: 0,
      damage: dmg,
    };
  }

  // Advance every shot by `dt` seconds and resolve the first enemy each one
  // touches. `enemies` is the caller's already-filtered hostile list; `onHit`
  // takes (enemy, shot). A shot is dropped when it hits or when it has flown
  // its range. Returns the survivors — assign the result back.
  //
  // No swept-collision maths: the fastest shot covers ~0.5 m a frame against a
  // hit radius of ~6 m, so nothing can tunnel through a foe.
  function stepShots(shots, dt, enemies, hitRadiusM, onHit) {
    const alive = [];
    const r2 = hitRadiusM * hitRadiusM;
    for (const s of shots) {
      const step = s.speedMps * dt;
      s.x += s.vx * step;
      s.y += s.vy * step;
      s.travelledM += step;
      let hit = null, bestD2 = r2;
      for (const e of enemies) {
        const d2 = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
        if (d2 <= bestD2) { bestD2 = d2; hit = e; }
      }
      if (hit) { onHit(hit, s); continue; }
      if (s.travelledM >= s.rangeM) continue;
      alive.push(s);
    }
    return alive;
  }

  // Health-ring tint. The combat wheel is a health bar, so it has to read as
  // one at a glance without a number: full green, bloodied amber, nearly-dead
  // red.
  function healthColor(frac) {
    if (frac > 0.5) return 0x6fdc6f;
    if (frac > 0.25) return 0xffc23d;
    return 0xff5a5a;
  }

  const api = {
    registerMonsters, FAUNA_HP, creatureMaxHp,
    isEnemyKind, isEnemy, hp, damage, hpFraction,
    BASELINE_HP, dpsForDurationMs, meleeDps, shotDamage,
    FIRE_INTERVAL_MS, RANGED_SLOTS, SHOT, HIT_RADIUS_CELLS,
    spawnShot, stepShots, healthColor,
  };
  root.Combat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
