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
//                    (app.js `startCombat` / `_drawWorkProgress`), and being
//                    the ACTIVE weapon AUTO-ENGAGES the nearest enemy in
//                    reach, so you don't have to tap a slime that's already
//                    chewing on you.
//   bow / staff    — ranged. While an enemy is on screen the ACTIVE one of
//                    the two looses one shot a second along the COMPASS
//                    HEADING (app.js `_combatTick`) — it does not home, so you
//                    aim by turning. A hit drains the same HP pool the melee
//                    wheel does.
//   bare hands     — still work, still slow (the 9 s tier-0 rung).
//
// KILL TIMES ARE INHERITED, NOT RE-TUNED. The old wheel spent
// `toolDurationMs × hp/15` ms on a target, so the damage per second that
// reproduces it exactly is `15000 / toolDurationMs` — see `dpsForDurationMs`.
// That rate is the MELEE rung, and everything below is derived from it;
// nothing here is a magic number picked to feel right.
//
// ONLY ONE WEAPON FIGHTS AT A TIME. `save.activeWeapon` (app.js) picks which
// of sword/bow/staff auto-engages or auto-fires; the other owned weapons sit
// inert — no auto-engage, no auto-fire — until the player switches to them
// (tapping a weapon in the Relics inventory tab, or obtaining/forging a new
// one, which becomes active automatically). Because only one weapon can ever
// be in play, there is no split across ranged slots any more: there used to
// be one (bow and staff fired simultaneously and stacked, so their shares
// were priced to sum to one sword), but exclusivity already prevents the
// double-dip the split existed to fix. What's left is SHOT_DMG_MUL, a
// deliberate difference in KIND rather than a stacking guard: the bow (an
// arrow) delivers its tier's full melee-equivalent rate, same as the sword;
// the staff (a piercing bolt) delivers DOUBLE that, priced in energy per
// bolt — see the SHOT table below.
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

  // ── Elites ───────────────────────────────────────────────────────────────
  // A SHINY cave monster is an elite: one multiplier over the kind's HP and
  // damage, the same shape as CAVE_ENEMY_MUL in app.js so the dps identity
  // holds — an elite takes exactly twice as long to kill at any weapon tier
  // and hits exactly twice as hard. Only MONSTERS are elites: a shiny deer is
  // game, and the surface slime never rolls shiny at all.
  const ELITE_MUL = 2;
  function isElite(c) {
    return !!c && !!c.shiny && !!MONSTER_STATS[c.kind];
  }
  function eliteMul(c) { return isElite(c) ? ELITE_MUL : 1; }
  // The HP pool of THIS instance — the kind's max times the elite multiplier.
  // Everything that seeds or refills a creature's HP reads this, never
  // creatureMaxHp(kind) directly, or an elite heals back to half its health.
  function maxHp(c) { return creatureMaxHp(c.kind) * eliteMul(c); }

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
    if (!Number.isFinite(c._hp)) c._hp = maxHp(c);
    return c._hp;
  }
  // Apply `amount` damage; returns the HP left (never below 0).
  function damage(c, amount) {
    c._hp = Math.max(0, hp(c) - Math.max(0, amount));
    return c._hp;
  }
  function hpFraction(c) {
    const max = maxHp(c) || 1;
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

  // One shot every two seconds. Was 1000 — halving the cadence makes each
  // shot a visible event instead of a stream; shotDamage scales per-shot
  // damage by the interval, so the delivered rate is cadence-independent.
  const FIRE_INTERVAL_MS = 2000;
  const RANGED_SLOTS = ['bow', 'staff'];
  // Per-slot shot geometry. `phaseMs` used to stagger the staff half a beat
  // off the bow so a player carrying both fired simultaneously heard an
  // alternating patter; only one ranged slot can ever be the active weapon
  // now, so it's a no-op, kept at 0 for both rather than an unexplained
  // half-second delay the first time the staff becomes active. Ranges/speeds
  // are in CELLS and cells-per-second so they hold at any cell size; the
  // viewport is 11 cells wide, so a bow shot crosses the screen and a staff
  // bolt very nearly does.
  //
  // The two weapons differ in KIND, not just tint:
  //   bow   — an arrow: a streak (lenPx/widthPx) that stops in the FIRST foe
  //           it hits and in anything solid on the way (cave rock, and on the
  //           surface standing trees / bushes / mineral rocks — app.js hands
  //           the test over as opts.blocked).
  //   staff — a magic bolt: a fat dot (dotPx radius) that PIERCES — it damages
  //           every foe it passes exactly once and ignores the world test
  //           entirely (magic goes over rock and timber alike). Each bolt
  //           draws energyCost (1⚡) from the caster — app.js gates the shot
  //           on affording it — and hits twice as hard as an arrow
  //           (SHOT_DMG_MUL below): the energy is the price of the pierce
  //           and the punch.
  const SHOT = {
    bow:   { speedCps: 4.5, rangeCells: 8, color: 0xffe6a8, lenPx: 9, widthPx: 2, phaseMs: 0 },
    staff: { speedCps: 3.2, rangeCells: 7, color: 0x9ad6ff, dotPx: 3,
             phaseMs: 0, pierce: true, energyCost: 1 },
  };
  // Damage weight per slot: a staff bolt lands double an arrow's share.
  const SHOT_DMG_MUL = { bow: 1, staff: 2 };
  // How close a shot has to pass to a foe's feet to count as a hit, in cells.
  // Deliberately generous: the heading comes off a phone COMPASS, which is
  // coarse and jittery, so a strict hit box would make the whole mechanic read
  // as broken. Just under a cell puts a foe eight cells out inside a ~7° cone.
  const HIT_RADIUS_CELLS = 0.9;

  // Damage per shot: one firing-interval's worth of that weapon tier's
  // melee-equivalent rate, weighted by the slot (SHOT_DMG_MUL — the staff
  // hits double, priced in energy per bolt). No split across ranged slots:
  // only one weapon ever fires (save.activeWeapon, app.js), so a bow alone
  // delivers its tier's FULL melee rate — same as a sword of that tier — and
  // a staff alone delivers double that. The interval cancels out of the
  // delivered per-second rate entirely; it only paces how chunky each hit
  // looks. An empty slot fires nothing at all.
  //
  // The floor of 1 is what keeps a wooden weapon firing at all once the
  // rounding is through; it only ever binds on rungs whose full rate is
  // already under two per second.
  function shotDamage(relics, slot) {
    if (!relics || !relics[slot]) return 0;
    const perSecond = dpsForDurationMs(toolDurationMs(relics, slot)) * (SHOT_DMG_MUL[slot] || 1);
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
      pierce: !!spec.pierce,
    };
  }

  // How finely a shot's flight is sampled against the world when the caller
  // supplies a `blocked` test, in cells. Half a cell is well under the
  // thinnest thing that can stop a shot (a cave wall is a whole cell), so a
  // frame long enough to carry a shot several cells still can't step over one.
  const BLOCK_SAMPLE_CELLS = 0.5;

  // Advance every shot by `dt` seconds and resolve the first enemy each one
  // touches. `enemies` is the caller's already-filtered hostile list; `onHit`
  // takes (enemy, shot). A shot is dropped when it hits, when it has flown its
  // range, or when it runs into something solid. Returns the survivors —
  // assign the result back.
  //
  // No swept-collision maths for the FOES: the fastest shot covers ~0.5 m a
  // frame against a hit radius of ~6 m, so nothing can tunnel through one.
  //
  // `opts.blocked(x, y)` — optional world test for solid ground, in world
  // metres. This module knows nothing about the map, so the caller hands the
  // question over: underground, app.js answers with the cave-wall collision
  // test, which is what stops a bow or staff shooting through solid rock at a
  // monster in the next tunnel. Without it a shot ignores the world entirely,
  // which is exactly right on the surface — there is nothing up there a shot
  // should stop against (you can shoot over a fence or a river). A shot that
  // runs into rock stops at the face rather than inside it, so the streak
  // reads as hitting the wall, and it is then dropped.
  // `opts.cellM` sizes the sampling; it falls back to the hit radius, which is
  // just under a cell.
  function stepShots(shots, dt, enemies, hitRadiusM, onHit, opts) {
    const alive = [];
    const r2 = hitRadiusM * hitRadiusM;
    const blocked = opts && opts.blocked;
    const sampleM = Math.max(0.01,
      ((opts && opts.cellM) || hitRadiusM) * BLOCK_SAMPLE_CELLS);
    for (const s of shots) {
      const step = s.speedMps * dt;
      // How far of this frame's step the shot actually gets to travel: all of
      // it, unless something solid is in the way. A PIERCING shot (the staff
      // bolt) never consults the world at all — magic crosses rock and timber.
      let travel = step;
      let stopped = false;
      if (!s.pierce && blocked && step > 0) {
        const samples = Math.max(1, Math.ceil(step / sampleM));
        for (let i = 1; i <= samples; i++) {
          const t = (step * i) / samples;
          if (!blocked(s.x + s.vx * t, s.y + s.vy * t)) continue;
          travel = Math.max(0, t - step / samples);   // stop at the face, not inside
          stopped = true;
          break;
        }
      }
      s.x += s.vx * travel;
      s.y += s.vy * travel;
      s.travelledM += travel;
      if (s.pierce) {
        // Piercing: damage every foe inside the radius ONCE each, keep flying.
        // The per-shot hit ledger is what stops a slow bolt re-hitting the
        // same foe on every frame it spends crossing them.
        for (const e of enemies) {
          const d2 = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
          if (d2 > r2) continue;
          const key = e.id != null ? e.id : e;
          if (!s._struck) s._struck = new Set();
          if (s._struck.has(key)) continue;
          s._struck.add(key);
          onHit(e, s);
        }
      } else {
        let hit = null, bestD2 = r2;
        for (const e of enemies) {
          const d2 = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
          if (d2 <= bestD2) { bestD2 = d2; hit = e; }
        }
        // A foe standing right against the far side of the wall is more than a
        // hit radius from where the shot stopped, so this can't reach through.
        if (hit) { onHit(hit, s); continue; }
      }
      if (stopped) continue;                          // spent against the rock
      if (s.travelledM >= s.rangeM) continue;
      alive.push(s);
    }
    return alive;
  }

  // Is there a clear line from (x0,y0) to (x1,y1)? Sampled at the same
  // resolution a shot's flight is, through the same caller-supplied world
  // test, so what stops an arrow stops a line of fire.
  //
  // For a RANGED MONSTER's attack. The goblin archer reaches three cells, and
  // without this it reaches them through solid rock — taking exactly the shot
  // the player is no longer allowed to take, from somewhere they often cannot
  // even see. Melee kinds are adjacent by definition and never consult it.
  // The endpoints are skipped: those are the two bodies, and a body is
  // standing on floor by definition.
  function lineOfFire(x0, y0, x1, y1, blocked, cellM) {
    if (!blocked) return true;
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (!(dist > 0)) return true;
    const sampleM = Math.max(0.01, (cellM || 1) * BLOCK_SAMPLE_CELLS);
    const samples = Math.max(1, Math.ceil(dist / sampleM));
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      if (blocked(x0 + dx * t, y0 + dy * t)) return false;
    }
    return true;
  }

  // Health-bar tint. The bar has to read as health at a glance without a
  // number: full green, bloodied amber, nearly-dead red.
  function healthColor(frac) {
    if (frac > 0.5) return 0x6fdc6f;
    if (frac > 0.25) return 0xffc23d;
    return 0xff5a5a;
  }

  const api = {
    registerMonsters, FAUNA_HP, creatureMaxHp,
    isEnemyKind, isEnemy, hp, damage, hpFraction,
    ELITE_MUL, isElite, eliteMul, maxHp,
    dpsForDurationMs, meleeDps, shotDamage,
    FIRE_INTERVAL_MS, RANGED_SLOTS, SHOT, SHOT_DMG_MUL, HIT_RADIUS_CELLS,
    spawnShot, stepShots, lineOfFire, healthColor,
  };
  root.Combat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
