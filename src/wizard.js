// ─────────────────────────────────────────────────────────────────────────
// Wizard — the wizard tower's offers, priced in MEMORIES.
//
// The wizard draws power from the player's memories (save.memories, the
// currency that was "Discovery badges") and turns it into rungs of power.
// Until Sep 2026 he offered one strict ladder — Inner Light, then Full
// Measure, then Keen Eye, five badges a rung. Now:
//
//   • TRACKS (one table, TRACKS below). Each is a counter on the save with a
//     cost and a max; within a track the rungs still climb in order, so the
//     offer for a track is always its NEXT rung.
//   • TWO OFFERS a visit, two distinct unfinished tracks drawn by a stream
//     seeded on the purchase count (and save.relicSalt — CLAUDE.md "salt the
//     roll"), so re-opening the tower shows the same pair until a purchase
//     moves the seed, and every purchase re-rolls BOTH.
//   • ONE CALLING (CLASSES below), chosen once, as the THIRD purchase: while
//     the player has no class and has already bought CLASS_AT_BUYS things, the
//     table holds all four classes and nothing else. A save that was past its
//     third purchase before classes existed meets the choice on its next
//     visit.
//
// Pure on purpose — no scene, no DOM, no Phaser — so test/node/wizard.test.js
// pins the shipping rules. What a class or a rung DOES lives with the module
// that applies it (the numbers are derived, never a second copy here):
//   hunter    → Combat.shotDamage(…, playerClass)   HUNTER_BOW_MUL
//   runner    → Trail.goalFor(…, playerClass)       RUNNER_GOAL_DIV
//   enforcer  → Combat.meleeDps(…, playerClass)     ENFORCER_MELEE_DPS
//   enchanter → app.js (a held potion's timed effect for ENCHANTER_ENERGY_COST)
//   vigour    → Energy.maxEnergy                    VIGOUR_ENERGY_STEP
// The copy here reads those at CALL time, so load order only has to put this
// file before app.js.
//
// This file is NOT the thing that equips the Ring: buying a Keen Eye rung
// returns `equip` and the caller runs app.js _equipGear('relic','ring',n).
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // ── Prices and shapes ────────────────────────────────────────────────────
  const TRACK_COST = 5;            // Inner Light, Full Measure, Keen Eye
  const VIGOUR_COST = 2;           // the cheap track
  const VIGOUR_MAX = 5;
  const CLASS_COST = 3;
  // The class is offered once this many purchases are behind the player —
  // i.e. it IS the third purchase.
  const CLASS_AT_BUYS = 2;
  const OFFER_COUNT = 2;
  // Reach runs 2 cells + 0.5 a rung, 6 rungs (coords.js reads the same field).
  const REACH_UPGRADE_MAX = 6;
  // The Ring tops out at the material ladder's 7 tiers.
  const RING_UPGRADE_MAX = 7;
  // The enchanter's price for a potion's timed effect without drinking it.
  const ENCHANTER_ENERGY_COST = 20;
  // The wizard's own RNG stream (CLAUDE.md: each spawner seeds its own).
  const OFFER_SALT = 0x3A7D1C55;

  const INTRO = 'The wizard draws power from your memories.';

  // ── Defensive reads of other modules (headless-safe) ─────────────────────
  function qtyMax(opts) {
    if (opts && Number.isFinite(opts.qtyMax)) return opts.qtyMax;
    return (typeof RARITY_TUNING !== 'undefined' && RARITY_TUNING.qtyLuckLevels) || 3;
  }
  function qtyLuckAt(n) {
    return (typeof qtyLuck === 'function') ? qtyLuck({ qtyUpgrades: n }) : 0;
  }
  const pct = (p) => `${Math.round(p * 100)}%`;
  const reachAt = (n) => Math.min(5, 2 + 0.5 * n);
  const vigourStep = () => (typeof Energy !== 'undefined' && Energy.VIGOUR_ENERGY_STEP) || 10;
  const int = (v) => Math.max(0, Math.floor(Number(v) || 0));

  // ── The tracks ───────────────────────────────────────────────────────────
  // One row per track: price, ceiling, where the save keeps it, how to grant a
  // rung, and the copy the modal prints for rung n.
  const TRACKS = [
    {
      key: 'light', cost: TRACK_COST, icon: '🔆',
      max: () => REACH_UPGRADE_MAX,
      have: (save) => int(save.reachUpgrades),
      grant: (save, n) => { save.reachUpgrades = n; },
      title: 'Inner Light', accept: 'Kindle',
      get: (n) => `🔆 Inner Light — reach ${reachAt(n)} cells`,
      header: '✨ Inner Light kindled ✨',
      name: (n) => `Reach ${reachAt(n)} cells`,
      sub: 'Your memories, burned into wider sight.',
    },
    {
      key: 'measure', cost: TRACK_COST, icon: '🎒',
      max: (opts) => qtyMax(opts),
      have: (save) => int(save.qtyUpgrades),
      grant: (save, n) => { save.qtyUpgrades = n; },
      title: 'Full Measure', accept: 'Accept',
      get: (n) => `🎒 Full Measure — ${pct(qtyLuckAt(n))} chance of a bigger find`,
      header: '✨ Full Measure granted ✨',
      name: (n) => `Bigger finds — ${pct(qtyLuckAt(n))} of the time`,
      sub: 'What the world gives you, it gives you more of.',
    },
    {
      key: 'eye', cost: TRACK_COST, icon: '👁',
      max: () => RING_UPGRADE_MAX,
      have: (save) => int(save.relics && save.relics.ring && save.relics.ring.tier),
      // The Ring is GEAR: the caller equips it (buy() returns `equip`).
      grant: null,
      title: 'Keen Eye', accept: 'Accept',
      get: (n) => `👁 Keen Eye — Ring T${n} · rarer finds`,
      header: '✨ Keen Eye opened ✨',
      name: (n) => `Ring T${n} · rarer finds`,
      sub: 'A Ring to bear the sight — rarer things find you.',
    },
    {
      key: 'vigour', cost: VIGOUR_COST, icon: '💪',
      max: () => VIGOUR_MAX,
      have: (save) => int(save.vigourUpgrades),
      grant: (save, n) => { save.vigourUpgrades = n; },
      title: 'Vigour', accept: 'Accept',
      get: (n) => `💪 Vigour — +${n * vigourStep()}⚡ max energy`,
      header: '✨ Vigour granted ✨',
      name: (n) => `Max energy +${n * vigourStep()}⚡`,
      sub: 'Old strength, remembered into your bones.',
    },
  ];
  const TRACK_BY_KEY = Object.fromEntries(TRACKS.map((t) => [t.key, t]));

  // ── The callings ─────────────────────────────────────────────────────────
  // One table the offer copy AND the mechanics read: the key is what
  // save.playerClass stores and what combat.js / trail.js / app.js test.
  const CLASSES = [
    {
      key: 'hunter', icon: '🏹', name: 'Hunter',
      blurb: () => `Bow shots hit ×${(typeof Combat !== 'undefined' && Combat.HUNTER_BOW_MUL) || 1.5}.`,
    },
    {
      key: 'runner', icon: '👟', name: 'Runner',
      blurb: () => {
        const div = (typeof Trail !== 'undefined' && Trail.RUNNER_GOAL_DIV) || 2;
        return div === 2 ? 'Road treasure twice as often.' : `Road treasure ${div}× as often.`;
      },
    },
    {
      key: 'enforcer', icon: '⚔', name: 'Enforcer',
      blurb: () => `Melee +${(typeof Combat !== 'undefined' && Combat.ENFORCER_MELEE_DPS) || 5} damage a second.`,
    },
    {
      key: 'enchanter', icon: '🔮', name: 'Enchanter',
      blurb: () => `Pay ${ENCHANTER_ENERGY_COST}⚡ for a potion's effect, and keep it.`,
    },
  ];
  const CLASS_BY_KEY = Object.fromEntries(CLASSES.map((c) => [c.key, c]));

  // The player's class key, or null (an unknown string is no class at all).
  function playerClass(save) {
    const k = save && save.playerClass;
    return (typeof k === 'string' && CLASS_BY_KEY[k]) ? k : null;
  }
  function isClass(save, key) { return playerClass(save) === key; }

  // ── Purchase count ───────────────────────────────────────────────────────
  // save.wizardBuys when set; for a save from before it existed, the rungs
  // already on it — so no migration is needed. (A pre-Sep-2026 save whose
  // Inner Light also bought the Ring counts those rungs twice; the count only
  // seeds the draw and gates the calling, so it errs toward offering it.)
  function derivedBuys(save) {
    return int(save.reachUpgrades) + int(save.qtyUpgrades)
      + int(save.relics && save.relics.ring && save.relics.ring.tier)
      + int(save.vigourUpgrades) + (playerClass(save) ? 1 : 0);
  }
  function buys(save) {
    if (!save) return 0;
    return Number.isFinite(save.wizardBuys) ? int(save.wizardBuys) : derivedBuys(save);
  }

  // mulberry32 — the same generator as WorldGen.makeRng, inlined so this
  // module stays loadable on its own.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function offerSeed(save) {
    const salt = (save && save.relicSalt != null) ? (save.relicSalt >>> 0) : 0;
    return (Math.imul(buys(save) + 1, 0x9E3779B1) ^ salt ^ OFFER_SALT) >>> 0;
  }

  // ── Offers ───────────────────────────────────────────────────────────────
  function trackOffer(t, save, opts) {
    const have = t.have(save);
    const rung = have + 1;
    return {
      kind: 'track', key: t.key, cost: t.cost, rung, max: t.max(opts), icon: t.icon,
      title: t.title, accept: t.accept, get: t.get(rung),
      header: t.header, name: t.name(rung), sub: t.sub,
      canAfford: int(save.memories) >= t.cost,
    };
  }
  function classOffer(c, save) {
    return {
      kind: 'class', key: c.key, cost: CLASS_COST, rung: null, icon: c.icon,
      title: c.name, accept: 'Choose', get: `${c.icon} ${c.name} — ${c.blurb()}`,
      header: `✨ You are ${/^[AEIOU]/.test(c.name) ? 'an' : 'a'} ${c.name} ✨`, name: c.name, sub: c.blurb(),
      canAfford: int(save.memories) >= CLASS_COST,
    };
  }
  function unfinishedTracks(save, opts) {
    return TRACKS.filter((t) => t.have(save) < t.max(opts));
  }
  // Is the calling what's on the table right now?
  function classDue(save) {
    return !playerClass(save) && buys(save) >= CLASS_AT_BUYS;
  }

  // What the wizard offers right now: the four callings when the class is
  // due; otherwise up to OFFER_COUNT distinct unfinished tracks (table order
  // on the modal); [] when he has nothing left.
  function offers(save, opts) {
    if (!save) return [];
    if (classDue(save)) return CLASSES.map((c) => classOffer(c, save));
    const pool = unfinishedTracks(save, opts);
    let picked = pool;
    if (pool.length > OFFER_COUNT) {
      const rng = makeRng(offerSeed(save));
      const left = pool.slice();
      picked = [];
      while (picked.length < OFFER_COUNT) {
        picked.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
      }
      picked.sort((a, b) => TRACKS.indexOf(a) - TRACKS.indexOf(b));
    }
    return picked.map((t) => trackOffer(t, save, opts));
  }

  // Buy `key` off the table. Null on refusal (not on offer right now, or not
  // enough memories) with nothing changed. On success save.memories is spent,
  // the rung / calling is written, save.wizardBuys moves on (which re-rolls
  // the next pair), and the result says what the caller still has to do:
  //   equip        — { kind:'relic', slot:'ring', tier } for a Keen Eye rung:
  //                  the caller runs _equipGear(kind, slot, tier).
  //   energyCap    — true for Vigour: refresh the bar (Energy.maxEnergy).
  //   reach        — true for Inner Light (reach redraws on its own).
  //   playerClass  — the calling just chosen, for a class purchase.
  // The caller persists the save and rebuilds its UI.
  //
  // THE SPEND. `opts.spend(cost)`, when given, IS the payment: buy() calls it
  // once every check has passed and, if it returns false, refuses with nothing
  // changed. app.js passes its spendMemories — the ONE place save.memories goes
  // down (it repaints the HUD chip and persists) — so the scene has a single
  // writer. With no hook (headless tests) buy() decrements save.memories
  // itself.
  function buy(save, key, opts) {
    if (!save) return null;
    const offer = offers(save, opts).find((o) => o.key === key);
    if (!offer) return null;
    const mem = int(save.memories);
    if (mem < offer.cost) return null;
    const before = buys(save);
    const spend = opts && typeof opts.spend === 'function' ? opts.spend : null;
    if (spend) { if (!spend(offer.cost)) return null; }
    else save.memories = mem - offer.cost;
    const out = {
      kind: offer.kind, key, cost: offer.cost, rung: offer.rung, offer,
      memories: save.memories, wizardBuys: before + 1,
      equip: null, energyCap: false, reach: false, playerClass: null,
    };
    if (offer.kind === 'class') {
      save.playerClass = key;
      out.playerClass = key;
    } else {
      const t = TRACK_BY_KEY[key];
      if (t.grant) t.grant(save, offer.rung);
      if (key === 'eye') out.equip = { kind: 'relic', slot: 'ring', tier: offer.rung };
      if (key === 'vigour') out.energyCap = true;
      if (key === 'light') out.reach = true;
    }
    save.wizardBuys = before + 1;
    return out;
  }

  root.Wizard = {
    TRACK_COST, VIGOUR_COST, VIGOUR_MAX, CLASS_COST, CLASS_AT_BUYS, OFFER_COUNT,
    REACH_UPGRADE_MAX, RING_UPGRADE_MAX, ENCHANTER_ENERGY_COST, INTRO,
    TRACKS, CLASSES, playerClass, isClass, classDue,
    buys, derivedBuys, offers, buy, unfinishedTracks, qtyLuckAt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
