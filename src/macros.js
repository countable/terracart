// THE MACRO STALLS — what a tap on an in-building POI DOES.
//
// loot.js decides WHICH POIs are macros (MACRO_KIND_BY_CLASS / macroFor — a
// pure function of the POI class, the same on every device) and how they
// look (chestLook → `macro_<kind>`). This module is the rest of the rules:
// the prices, the stock, the daily gate and the per-save progress, pure (no
// scene, no DOM) so the tests drive the shipping numbers. app.js
// presentMacro and one present* per kind are the dialogs over it; the chapel
// is the one kind that pays through the chest ceremony (interactables.js
// INTERACTABLES.chest), a tier humbler and once a day.
//
// Every macro is a place you come BACK to: never written to save.opened,
// never "picked clean". Only the player's USE is saved, in one of three
// lanes that already existed or are this module's own:
//   • the DAY LEDGER - save.coinBurstClaimed, pruned of takes older than a
//     week on every write. Plain id keys record coin bursts, shrines, crates
//     and barrels; `macro:` id keys record inn, chapel and guildhall services.
//     Separate keys let pickups and services at one place be used independently;
//   • save.donated — the curio ids this save has given (progress, not world
//     state), and its milestones in the memory ledger (save.discovered);
//   • save.training / save.trainingDrills — the levels and drills the player
//     bought (combat.js Combat.trainingBonus).
// The stalls (apothecary, sundries, scriptorium) have no gate at all: a
// counter, like the market stall they share their dialog with (app.js
// _presentStallOffer — one price lane, ShopsMath.standPrice).
//
// THE ECONOMY GOAL: a macro either SELLS at the
// stall price, charges for a service, or pays in something that is not coin
// (the curio hall's memories). The chapel's daily roll and the guildhall's
// bounty (a fight, paid by the kill lane plus a matched wage) are the only
// coin-positive taps left.
//
// Depends on (call time): items.js (PRICES, ITEMS, ITEM_BY_ID,
// HEALING_POTION_ENERGY), util.js (fnv1a, makeRng32, utcDayIndex, utcDayKey),
// shops.js (Shops.THEME_POOL), shops_math.js (ShopsMath.standPrice),
// combat.js (Combat.enemyBounty — the bounty's wage),
// loot.js (chestTier), combat.js (Combat.training*), energy.js (Energy),
// inventory.js (Inventory), save.js (addMoney).
(function (root) {
  'use strict';

  // ── The day ledger (the coin-burst one) ────────────────────────────────────
  // The ledger keeps pickups and services independent at a shared place.
  // usedToday / markToday own plain `<id><day>` keys for coin bursts, shrines,
  // crates and barrels. serviceUsedToday / markServiceToday own
  // `macro:<id><day>` keys for inns, chapels and guildhalls. Both lanes share
  // one pruning pass. A write
  // prunes every entry older than LEDGER_KEEP_DAYS, so a take is remembered
  // for a week: long enough for a crate that restocks after several days
  // (loot.js crateRestoreDays, capped at CRATE_RESTORE_MAX_DAYS — the same
  // week) to know how long ago it was taken (daysSinceTaken / restockWaitMs),
  // and short enough that the save does not grow. The day is util.js's UTC
  // owner (utcDayIndex / utcDayKey, a Date or epoch ms either way).
  const DAY_MS = UTC_DAY_MS;
  const LEDGER_KEEP_DAYS = (typeof CRATE_RESTORE_MAX_DAYS === 'number') ? CRATE_RESTORE_MAX_DAYS : 7;
  // A ledger key's day as a UTC day number (days since the epoch), or NaN.
  // The key ends in YYYYMMDD; each distinct tail is parsed once and kept (the
  // sprite pass asks for every key every frame — interactables.js
  // dayLedgerAges — and a ledger holds at most a week of days).
  const _tailDays = new Map();
  function ledgerKeyDay(key) {
    const k = String(key);
    if (k.length < 8) return NaN;
    const tail = k.slice(-8);
    let d = _tailDays.get(tail);
    if (d === undefined) {
      d = /^\d{8}$/.test(tail)
        ? Math.floor(Date.UTC(+tail.slice(0, 4), +tail.slice(4, 6) - 1, +tail.slice(6)) / DAY_MS) : NaN;
      if (_tailDays.size > 64) _tailDays.clear();
      _tailDays.set(tail, d);
    }
    return d;
  }
  function usedToday(save, id, now) {
    const m = save && save.coinBurstClaimed;
    return !!m && m[id + utcDayKey(now)] === 1;
  }
  function markToday(save, id, now) {
    const ledger = save.coinBurstClaimed = save.coinBurstClaimed || {};
    ledger[id + utcDayKey(now)] = 1;
    const today = utcDayIndex(now);
    for (const k of Object.keys(ledger)) {
      if (!(today - ledgerKeyDay(k) < LEDGER_KEEP_DAYS)) delete ledger[k];
    }
  }
  const serviceLedgerId = (id) => 'macro:' + id;
  function serviceUsedToday(save, id, now) {
    return usedToday(save, serviceLedgerId(id), now);
  }
  function markServiceToday(save, id, now) {
    markToday(save, serviceLedgerId(id), now);
  }
  // Whole UTC days since `id` was last taken: 0 = today, 1 = yesterday, …;
  // Infinity when the ledger holds no take within LEDGER_KEEP_DAYS.
  function daysSinceTaken(save, id, now) {
    const m = save && save.coinBurstClaimed;
    if (!m) return Infinity;
    const today = utcDayIndex(now);
    for (let k = 0; k < LEDGER_KEEP_DAYS; k++) {
      if (m[id + utcDayKey((today - k) * DAY_MS)] === 1) return k;
    }
    return Infinity;
  }
  // Is `id` still bare, restocking after `days` UTC days? (days 1 = daily.)
  function stillBare(save, id, days, now) {
    return daysSinceTaken(save, id, now) < Math.max(1, days || 1);
  }
  // How long until `id` restocks, in ms (0 when it is already there): the
  // rest of today plus every whole day still to run. What a refusal prints,
  // through shortDuration.
  function restockWaitMs(save, id, days, now) {
    const k = daysSinceTaken(save, id, now);
    const n = Math.max(1, days || 1);
    if (!(k < n)) return 0;
    return msToNextUtcDay(now) + (n - 1 - k) * DAY_MS;
  }
  // THE ONE REFUSAL SHAPE for a timed wait, on the map: "<prefix> — <wait>"
  // (shortDuration), within MAP_MSG_MAX. A pot, a chapel, a crate, a fruit
  // tree, a cow and a page stone all say it this way, so the rule is learned
  // once: glowing means available, the line says the wait.
  function waitLine(prefix, ms) {
    return `${prefix} — ${shortDuration(ms)}`;
  }

  // ── THE RECURRING SITES ───────────────────────────────────────────────────
  // One row per thing the player comes BACK to: the tap (interactables.js
  // chest.custom), the per-frame spent / glow tests (isSpent / poiLit via
  // takenBy) and the pot's burst (app.js) all read the row
  // visitKindForObject resolves. Columns: `ledger` — 'day' (the UTC-day
  // ledger above), 'service' (its `macro:` lane: the chapel, a building's
  // service independent of a pickup there) or 'ms' (a rolling clock,
  // save.js Ledger: the castle, houses.js reads cooldownMs); `days(o)` — a
  // 'day' row's bare spell (a crate's crateRestoreDays; 1 when absent);
  // `spent` — the refusal prefix (waitLine adds the wait); `open(ctx, o)` —
  // the whole tap when the row owns it (a hook answering null hands it
  // back); name / art / body / sprite / light — the ceremony
  // (beginDailyVisit) and the design sheet (tools/idols.html). The shrine
  // rows (Shrines.SHRINE_KINDS / REWARD_KINDS) are 'day' rows of this table
  // too, resolved first. Pending dialogs are scene state only: leaving loot
  // behind never spends the day's visit.
  const SPENT_DEFAULT = 'Already visited';
  const DAILY_VISIT_KINDS = {
    hive: { name: 'Forest hive', art: 'visit_hive', sprite: 'beehive', light: 0xe8b95a, ledger: 'day',
      reward: 'syrup', effect: 'Syrup, guarded by bees', locations: ['Forest'],
      spent: 'Hive already tapped',
      body: 'Thick syrup fills your jars. Angry bees pour from the hive.' },
    wagon: { name: 'Mercenary wagon', art: 'visit_wagon', sprite: 'wagon', light: 0xf2d9a0, ledger: 'day',
      reward: 'companion', effect: 'A mercenary fights beside you',
      get price() { return root.Companions.KINDS.mercenary.hireCost; },
      get durationMs() { return root.Companions.KINDS.mercenary.durationMs; },
      locations: ['Old-trade-road bus stops'],
      body: 'The mercenary takes your coins and lifts his sword. He falls into step beside you.',
      open: (ctx, o) => hireMercenary(ctx, o) },
    // A BIKE RACK: a push in the stick-walk speed lane (Buffs.KINDS.bike —
    // save.bikeUntil, app.js _walkRelics → items.js steerSpeedMul).
    bike: root.Shrines.REWARD_KINDS.bike,
    gold: root.Shrines.REWARD_KINDS.gold,
    // The CHAPEL's blessing: the chest ceremony a tier humbler (chapelRollTier).
    chapel: { name: 'Chapel', get art() { return KIND_DIALOG.chapel.art; }, sprite: 'macro_chapel', light: 0xf2d9a0, ledger: 'service',
      reward: 'treasure', effect: 'A daily blessing, a tier under the chest it replaced', durationMs: 0,
      locations: ['Mapped churches'], spent: 'The chapel is quiet',
      body: 'You leave a small offering beneath the bell and are given a blessing in return.' },
    // A CRATE (interactables.js restocks): the one chest that comes back.
    crate: { name: 'Crate', art: 'chest_t1', sprite: 'box', light: 0xf2d9a0, ledger: 'day',
      days: (o) => crateRestoreDays(o), reward: 'treasure', effect: 'A chest roll; bare for a day, up to a week where its kind crowds the tile', durationMs: 0,
      locations: ['Mapped POIs the tile left at the plain tier'], spent: 'The crate is bare',
      body: 'You lift the lid of the crate.' },
    // The PAGE STONES (interactables.js pageStone): one Book page a UTC day;
    // `read` is the map line for a scene with no dialog.
    board: { name: 'A notice board', art: 'book_read', sprite: 'signpost', light: 0xf2d9a0, ledger: 'day',
      reward: 'book', effect: 'Read one page of the Book', durationMs: 0,
      locations: ['Mapped information boards'], spent: 'Read it already', read: 'You read the notice.',
      body: 'You read the notice.' },
    bottle: { name: 'A message in a bottle', art: 'bottle_read', sprite: 'bottle', light: 0xf2d9a0, ledger: 'day',
      reward: 'book', effect: 'Read one page of the Book', durationMs: 0,
      locations: ['The waterline'], spent: 'Only sand here now', read: 'You read the message.',
      body: 'You read the message.' },
    // The CASTLE's favour (scene_shops.js): twelve hours, a rolling clock in
    // save.castleServiceClaimed (houses.js; owner, Sep 2026).
    castle: { name: 'Castle favour', art: 'castle_favour', sprite: { key: 'castle_tower_shapes', frame: 0, scale: 0.5 }, light: 0xf2d9a0,
      ledger: 'ms', cooldownMs: 12 * 60 * 60 * 1000, reward: 'favour', effect: 'A castellan\'s favour: rest, a meal or the hearth', durationMs: 0,
      locations: ['Claimed castles'], spent: 'The castellan is away',
      body: 'The castellan receives you in the hall.' },
  };
  // THE RESOLVER: the row `o` is, or null — a pure function of the object,
  // remembered per object for the per-frame readers.
  const _rowOf = new WeakMap();
  function visitKindForObject(o) {
    if (!o || typeof o !== 'object') return null;
    let row = _rowOf.get(o);
    if (row === undefined) {
      row = _resolveRow(o);
      _rowOf.set(o, row);
    }
    return row;
  }
  function _resolveRow(o) {
    if (o?.kind === 'hive') return DAILY_VISIT_KINDS.hive;
    const shrine = root.Shrines?.kindForObject(o);
    if (shrine) return shrine;
    if (o.kind === 'infoboard') return DAILY_VISIT_KINDS.board;
    if (o.kind === 'bottle') return DAILY_VISIT_KINDS.bottle;
    if (o.kind !== 'chest' || typeof chestLook !== 'function') return null;
    const look = chestLook(o);
    if (look.wagon) return DAILY_VISIT_KINDS.wagon;
    if (look.bike) return DAILY_VISIT_KINDS.bike;
    if (look.coin) return DAILY_VISIT_KINDS.gold;
    if (look.macro?.kind === 'chapel') return DAILY_VISIT_KINDS.chapel;
    if (typeof restocks === 'function' && restocks(o)) return DAILY_VISIT_KINDS.crate;
    return null;
  }
  // The ledger id a row's take is written under.
  function rowLedgerId(row, o) { return row?.ledger === 'service' ? serviceLedgerId(o.id) : o.id; }
  // Is the row's take gone right now (the tap's question)?
  function rowUsed(save, row, o, now) {
    if (row.days) return stillBare(save, o.id, row.days(o), now);
    return usedToday(save, rowLedgerId(row, o), now);
  }
  // …and for how long (ms) — what waitLine prints.
  function rowWaitMs(save, row, o, now) {
    return row.days ? restockWaitMs(save, o.id, row.days(o), now) : msToNextUtcDay(now);
  }
  function markUsed(save, row, o, now) { markToday(save, rowLedgerId(row, o), now); }
  // The per-frame form of rowUsed, off the frame's ledger ages
  // (interactables.js spentSets → dayLedgerAges): Map lookups only.
  function takenBy(row, o, ages) {
    if (!ages) return false;
    const age = ages.get(rowLedgerId(row, o));
    return age !== undefined && age < (row.days ? row.days(o) : 1);
  }
  function beginDailyVisit(ctx, o, { row = visitKindForObject(o), held = false } = {}) {
    const { scene, save, sx, sy } = ctx;
    const pending = scene._dailyVisits || (scene._dailyVisits = new Set());
    if (!held && usedToday(save, o.id)) {
      scene.flash(waitLine(row?.spent || SPENT_DEFAULT, msToNextUtcDay()), sx, sy);
      return null;
    }
    if (pending.has(o.id)) return null;
    pending.add(o.id);
    let claimed = false, finished = false, presented = false;
    const visit = {
      claim() {
        if (claimed || finished) return false;
        claimed = true;
        markToday(save, o.id);
        // Optional daily-site boons belong to the row, beside their copy.
        row?.grant?.(save, scene);
        ctx.dirty = true;
        return true;
      },
      finish() { finished = true; pending.delete(o.id); },
      present(afterStory) {
        if (presented || finished) return;
        presented = true;
        let dismissed = false;
        const onDismiss = () => {
          if (dismissed) return;
          dismissed = true;
          if (afterStory) afterStory(visit);
          else visit.finish();
          if (ctx.dirty) Save.persist(save);
        };
        if (row && typeof scene.showMessageModal === 'function') {
          scene.showMessageModal({ title: row.name, body: row.body, art: row.art, kind: 'story', onDismiss });
        } else onDismiss();
      },
    };
    return visit;
  }
  function dailyVisit(ctx, o, { row = visitKindForObject(o), grant, afterStory } = {}) {
    const visit = beginDailyVisit(ctx, o, { row });
    if (!visit) return true;
    if (!visit.claim()) return true;
    grant?.();
    visit.present(afterStory ? () => { visit.finish(); afterStory(); } : null);
    return true;
  }
  function hireMercenary(ctx, o) {
    const { scene, save, sx, sy } = ctx;
    const row = DAILY_VISIT_KINDS.wagon;
    if (scene._mercenaryHirePending) return true;
    const visit = beginDailyVisit(ctx, o, { row });
    if (!visit) return true;
    if (root.Companions.active(save, 'mercenary')) {
      scene.flash('Your mercenary is still with you.', sx, sy);
      visit.finish();
      return true;
    }
    if ((save.money || 0) < row.price) {
      scene.flash(`Need ${row.price} coins to hire.`, sx, sy);
      visit.finish();
      return true;
    }
    if (typeof scene.showConfirmModal !== 'function') { visit.finish(); return true; }
    let settled = false;
    scene._mercenaryHirePending = true;
    scene.showConfirmModal({ id: 'mercenary-hire', title: row.name, art: row.art,
      body: `Hire a mercenary for ${row.price} coins? He follows you and fights enemies for ${shortDuration(row.durationMs)}.`,
      acceptLabel: `Hire · ${row.price} coins`, cancelLabel: 'Later',
      onCancel: () => { if (!settled) { settled = true; scene._mercenaryHirePending = false; visit.finish(); } },
      onAccept: () => {
        if (settled) return;
        settled = true;
        scene._mercenaryHirePending = false;
        if (!root.Companions.hire(scene, 'mercenary')) {
          visit.finish();
          scene.flash('Unable to hire right now.', sx, sy);
          return;
        }
        visit.claim();
        Save.persist(save);
        scene._finishInventoryChange?.();
        visit.present();
      },
    });
    return true;
  }

  // What every stall counter charges for `id`: the market stall's price
  // (ShopsMath.standPrice — below par, never an arbitrage pump).
  function stallPrice(save, id) {
    return ShopsMath.standPrice(save, ShopsMath.listPrice(save, id));   // the Book's ladder rides in listPrice
  }
  // A stable pick from `pool` for this POI — a hash of its id and a per-kind
  // salt, so every player's apothecary on that corner sells the same thing.
  function _pick(o, salt, pool) {
    return pool.length ? pool[fnv1a(String(o && o.id) + '|' + salt) % pool.length] : null;
  }

  // ── INN: rest to full for money, once a day per inn ───────────────────────
  // The price per point of energy is the Potion of Healing's own
  // (PRICES.healing_potion / HEALING_POTION_ENERGY) × INN_RATE: cheaper than
  // carrying a potion, but you walk to it and it is once a day. Not Home's
  // passive rest (free, on HOME_R, gated on `working`): a one-shot purchase.
  const INN_RATE = 0.5;
  function innCoinsPerEnergy() {
    return PRICES.healing_potion / HEALING_POTION_ENERGY * INN_RATE;
  }
  function innPrice(missing) {
    const m = Math.max(0, Math.floor(missing || 0));
    return m > 0 ? Math.max(1, Math.ceil(m * innCoinsPerEnergy())) : 0;
  }
  // Rest `save` to `maxE` at inn `o`. Returns { ok, gain, price, why }:
  // why ∈ 'used' | 'full' | 'money'. Energy goes through Energy.set.
  function innRest(save, o, maxE, now) {
    if (serviceUsedToday(save, o.id, now)) return { ok: false, why: 'used' };
    const cur = save.energy ?? 0;
    const missing = Math.max(0, maxE - cur);
    if (missing <= 0) return { ok: false, why: 'full' };
    const price = innPrice(missing);
    if ((save.money ?? 0) < price) return { ok: false, why: 'money', price };
    addMoney(save, -price);
    Energy.set(save, maxE, maxE);
    markServiceToday(save, o.id, now);
    return { ok: true, gain: (save.energy ?? 0) - cur, price };
  }

  // ── CHAPEL: a daily blessing, a tier humbler than the chest it replaced ──
  // (A church only: every other faith's place mints nothing —
  // WorldGen.isSensitivePoi. The player LEAVES an offering and is GIVEN a
  // blessing; the copy never has them take alms from a box.)
  // The roll is the chest's own (chestTier — its density on its tile, the
  // depth bonus and the churchyard's ZONE_NEXUS_TIER_BONUS all still apply)
  // less CHAPEL_TIER_DROP, floored at T1: it pays every day, where the chest
  // paid once. Inside a churchyard (a nexus) that nets the old chest's tier.
  const CHAPEL_TIER_DROP = 1;
  function chapelRollTier(o) {
    return Math.max(1, chestTier(o) - CHAPEL_TIER_DROP);
  }

  // ── APOTHECARY: a potion counter, and the cure ────────────────────────────
  // One remedy per apothecary (a dentist is always Healing), plus the
  // Antidote (T1 — the poison cure, src/conditions.js) at every counter.
  // Counter remedies stay available independently of their loot tiers.
  const APOTHECARY_POTIONS = ['healing_potion', 'revival_potion', 'protection_potion', 'reach_potion'];
  const APOTHECARY_CURE = 'antidote';
  function apothecaryStock(o) {
    const potion = (o && o.poiClass === 'dentist') ? 'healing_potion' : _pick(o, 'apothecary', APOTHECARY_POTIONS);
    return [potion, APOTHECARY_CURE].filter((id) => id && ITEM_BY_ID[id]);
  }

  // ── SUNDRIES: a supply counter ────────────────────────────────────────────
  // One thing per shop: a supply item from the village Supply Shop's own line
  // (Shops.THEME_POOL.supply — the Book is the Bookshop's and the Scriptorium's)
  // or one of SUNDRIES_GEAR, the find-only weapons and the shield. A gear
  // entry is `gear:<line>`; what it sells depends on the player
  // (sundriesGear).
  const SUNDRIES_GEAR = ['dagger', 'lance', 'musket', 'shield'];
  const SUNDRIES_SHIELDS = ['wood_shield', 'metal_shield', 'gold_shield'];
  // Gear at a counter costs this many times its list price, before the
  // stall's usual discount (ShopsMath.standPrice).
  const SUNDRIES_GEAR_PRICE_MUL = 3;
  function sundriesStock(o) {
    const pool = [...Shops.THEME_POOL.supply().filter((id) => ITEM_BY_ID[id]),
      ...SUNDRIES_GEAR.map((line) => 'gear:' + line)];
    const id = _pick(o, 'sundries', pool);
    return id ? [id] : [];
  }
  function isSundriesGear(entry) { return typeof entry === 'string' && entry.startsWith('gear:'); }
  // What a gear entry sells THIS player: the lowest rung above what they hold
  // (a Rusty Dagger to a player without one, a Fine one over a Rusty; the
  // Metal Shield over a carried Wood one), as a Rewards.apply shape with its
  // `price`. Null when they already hold the line's finest.
  function sundriesGear(save, entry) {
    const line = entry.slice('gear:'.length);
    if (line === 'shield') {
      const held = Math.max(0, ...SUNDRIES_SHIELDS.filter((id) => carriesItem(save, id)).map((id) => ITEM_BY_ID[id].baseTier));
      const id = SUNDRIES_SHIELDS.find((s) => ITEM_BY_ID[s].baseTier > held);
      return id ? { kind: 'item', id, qty: 1, tier: ITEM_BY_ID[id].baseTier,
        price: ShopsMath.standPrice(save, itemValue(id) * SUNDRIES_GEAR_PRICE_MUL) } : null;
    }
    const owned = save?.relics?.[line]?.tier || 0;
    const tier = (RELIC_DEFS[line].tiers || [1, 2, 3, 4, 5, 6, 7]).find((t) => t > owned);
    return tier ? { kind: 'relic', slot: line, tier,
      price: ShopsMath.standPrice(save, gearPrice('relic', line, tier) * SUNDRIES_GEAR_PRICE_MUL) } : null;
  }

  // ── SCRIPTORIUM: a book counter ───────────────────────────────────────────
  // A plain stall (no free daily page). It sells the Book and
  // the one other scholarly thing the game has, a Torch to read by. Priced by
  // stallPrice like every counter; no gate, no cooldown.
  const SCRIPTORIUM_BOOK = 'book';
  const SCRIPTORIUM_STOCK = [SCRIPTORIUM_BOOK, 'torch'];
  function scriptoriumStock() { return SCRIPTORIUM_STOCK.filter((id) => ITEM_BY_ID[id]); }

  // ── GUILDHALL: a monster bounty a day ─────────────────────────────────────
  // Once a UTC day per hall (the day ledger) the board posts a BOUNTY: a small
  // pack of ordinary surface enemies (Combat.isEnemy kinds — the slime, then
  // goblins and archers) seated near the player by the scene's
  // findWalkableDestination (scene_creatures.js; the shared spawn rule, so
  // never on a road band or anything already there). Each foe dies through
  // the ONE kill lane (app.js resolveDefeat — its own wage, Combat.enemyBounty,
  // dropped as a coin); clearing the pack pays the hall's reward on top, which
  // is the pack's wages again × BOUNTY_MATCH — derived from enemyBounty, never
  // a table of its own. Modest by design (the economy goal above).
  //   WHICH pack is the hall's and the day's (a stream seeded by the hall id
  // and the UTC day), read against the player's WEAPON (the best of sword /
  // bow / staff, the tier that decides how long a fight takes): the rung picks
  // the kinds, the tier the count. Two players with the same weapon see the
  // same board.
  //   What it is NOT: not a lair (no ruin, no leash, no seat — it hunts you
  //   like any wild foe) and not a quest (the castle board's kill jobs still
  //   count these kills, through resolveDefeat, like any other).
  const BOUNTY_LADDER = [['slime'], ['slime', 'goblin'], ['goblin', 'goblin_archer']];
  const BOUNTY_TIERS_PER_RUNG = 2;       // weapon tier 0-1 → rung 0, 2-3 → 1, 4+ → 2
  const BOUNTY_TIERS_PER_FOE = 3;        // weapon tier 0-2 → 1 foe, 3-5 → 2, 6+ → 3
  const BOUNTY_MAX_FOES = 3;
  const BOUNTY_MATCH = 1;                // the hall matches the pack's wages, once
  const BOUNTY_DIST_CELLS = 5;           // seated inside the view (VIEW_CELLS 11 / 2)
  function bountyWeaponTier(save) {
    const r = (save && save.relics) || {};
    return Math.max(0, ...['sword', 'bow', 'staff'].map((k) => Math.floor(Number(r[k] && r[k].tier) || 0)));
  }
  function bountyFor(save, o, now) {
    const t = bountyWeaponTier(save);
    const rung = BOUNTY_LADDER[Math.min(BOUNTY_LADDER.length - 1, Math.floor(t / BOUNTY_TIERS_PER_RUNG))];
    const n = Math.min(BOUNTY_MAX_FOES, 1 + Math.floor(t / BOUNTY_TIERS_PER_FOE));
    const day = utcDayKey(now);
    const rng = makeRng32(fnv1a(String(o && o.id) + '|bounty|' + day));
    const kinds = [];
    for (let i = 0; i < n; i++) kinds.push(rung[Math.floor(rng() * rung.length)]);
    const wage = kinds.reduce((sum, k) => sum + Combat.enemyBounty(k, 0), 0);
    return { id: String(o && o.id) + '|' + day, kinds, wage, pay: bountyPay(kinds) };
  }
  // The hall's reward for clearing `kinds`: their surface wages × BOUNTY_MATCH.
  function bountyPay(kinds) {
    return Math.max(1, Math.round(kinds.reduce((sum, k) => sum + Combat.enemyBounty(k, 0), 0) * BOUNTY_MATCH));
  }
  // ── Kill credit ───────────────────────────────────────────────────────────
  // ONE answer to "did this foe fall to the player's side?": its id in
  // save.caught (app.js resolveDefeat's mark, written for every defeat) and
  // a blow of the player's or an ally's (Combat.isPlayerKill). The guild
  // bounty, Maud's archer (StoryEncounters) and the fire-breath demon
  // (DragonStory) all ask this.
  function slainByPlayer(save, id, source = 'player') {
    return id != null && Combat.isPlayerKill(source) && ((save && save.caught) || []).includes(id);
  }
  // Is a posted bounty cleared? Every foe of the pack fell to the player's side.
  function bountyCleared(save, foeIds) {
    return foeIds.length > 0 && foeIds.every((id) => slainByPlayer(save, id));
  }

  // ── CURIO HALL: one shared collection, paid in MEMORIES ──────────────────
  // A NEW lane, and what it is NOT: not a sell page (it pays no coin at all —
  // selling stays at Home) and not a delivery (it wants whatever of its list
  // you have not given yet, not a set). Every hall shares ONE list,
  // CURIO_COLLECTION — things that keep: metal, gems, shells, feathers, the
  // old boot, a Book, the lasting supplies. Nothing that spoils or grows
  // (no food, produce, seed, flower or potion). Each id is given once, one
  // copy, into save.donated (the collection is the player's; the halls are its
  // doors). The reward is a MEMORY (app.js _bankDiscovery, keyed
  // `curio:<n>`) when the count reaches each of CURIO_MILESTONES — once per
  // save, because the memory ledger pays each key once.
  const CURIO_COLLECTION = [
    'flint_shard', ...BAR_IDS.slice(1),   // the six forge bars (items.js BAR_IDS; T1 is plain wood)
    'sapphire', 'ruby', 'emerald', 'diamond',
    'shell', 'crow_feather', 'rabbit_pelt', 'old_boot', 'book', 'taming_potion',
    'rope', 'torch', 'trap_disarm_kit', 'magic_trap', 'scarecrow',
  ];
  const CURIO_MILESTONES = [5, 10, 15];
  const _curioSet = new Set(CURIO_COLLECTION);
  function curioEligible(id) { return _curioSet.has(id) && !!ITEM_BY_ID[id]; }
  function curioCollection() { return CURIO_COLLECTION.filter((id) => ITEM_BY_ID[id]); }
  function curioDonated(save, id) { return ((save && save.donated) || []).includes(id); }
  // How many listed ids this save has given (a legacy save.donated from the
  // paid build may hold ids that are not on the list; they do not count).
  function curioCount(save) { return ((save && save.donated) || []).filter((id) => _curioSet.has(id)).length; }
  // The next milestone above `count`, or null once the last is reached.
  function curioNextMilestone(count) { return CURIO_MILESTONES.find((m) => m > count) ?? null; }
  // The memory-ledger key a milestone banks under.
  function curioMilestoneKey(m) { return 'curio:' + m; }
  // Listed ids not yet given, in list order.
  function curioMissing(save) { return curioCollection().filter((id) => !curioDonated(save, id)); }
  // Give ONE `id`: { ok, count, milestone, why } with why ∈ 'ineligible' |
  // 'given' | 'none'. `milestone` is the milestone this gift reached (5, 10,
  // 15) or null — the caller banks its memory. Nothing is paid.
  function curioDonate(save, id) {
    if (!curioEligible(id)) return { ok: false, why: 'ineligible' };
    if (curioDonated(save, id)) return { ok: false, why: 'given' };
    if (Inventory.count(save, id) < 1) return { ok: false, why: 'none' };
    Inventory.remove(save, id, 1);
    save.donated = [...(save.donated || []), id];
    const count = curioCount(save);
    return { ok: true, count, milestone: CURIO_MILESTONES.includes(count) ? count : null };
  }

  // ── TRAINING HALLS: one discipline each, bought for good or for a day ───
  // What each discipline gives is combat.js's (Combat.TRAINING_KINDS /
  // trainingBonus). A hall teaches ONE, picked off its own id
  // (trainingKindFor), so it is the world's: every player finds the same hall
  // teaching the same thing, and the five turn up in equal shares.
  //   A LEVEL costs TRAINING_LESSON_PRICE × its number ($25 … $125) AND needs
  // TRAINING_MEMORIES_PER_LEVEL × its number memories RECOVERED (the ledger's
  // total, scene.memoriesTotal — nothing is spent, so it never competes with
  // the wizard): level 3 needs 6. A DRILL costs TRAINING_DRILL_PRICE and needs
  // no memories.
  const TRAINING_LESSON_PRICE = 25;
  const TRAINING_DRILL_PRICE = 150;
  const TRAINING_MEMORIES_PER_LEVEL = 2;
  function trainingKindFor(o) {
    const order = Combat.TRAINING_ORDER;
    return order[fnv1a(String(o && o.id) + '|training') % order.length];
  }
  // The price of level k+1 (k already owned), and the memories it needs.
  function lessonPriceAt(k) { return TRAINING_LESSON_PRICE * (k + 1); }
  function lessonMemoriesAt(k) { return TRAINING_MEMORIES_PER_LEVEL * (k + 1); }
  // The next level's price in `kind`, or null once it is maxed.
  function lessonPrice(save, kind) {
    const k = Combat.trainingLevel(save, kind);
    if (k >= Combat.TRAINING_PERM_MAX) return null;
    return lessonPriceAt(k);
  }
  function lessonMemories(save, kind) {
    const k = Combat.trainingLevel(save, kind);
    return k >= Combat.TRAINING_PERM_MAX ? null : lessonMemoriesAt(k);
  }
  // Every level's price, first to last.
  function lessonPricesAll() {
    const out = [];
    for (let k = 0; k < Combat.TRAINING_PERM_MAX; k++) out.push(lessonPriceAt(k));
    return out;
  }
  function drillPrice() { return TRAINING_DRILL_PRICE; }
  // `memories` is the player's RECOVERED total (scene.memoriesTotal()).
  function buyLesson(save, kind, memories) {
    if (!Combat.TRAINING_KINDS[kind]) return { ok: false, why: 'kind' };
    const price = lessonPrice(save, kind);
    if (price == null) return { ok: false, why: 'cap' };
    const need = lessonMemories(save, kind);
    if ((Number(memories) || 0) < need) return { ok: false, why: 'memories', need };
    if ((save.money ?? 0) < price) return { ok: false, why: 'money', price };
    addMoney(save, -price);
    save.training[kind] = Combat.trainingLevel(save, kind) + 1;
    return { ok: true, price };
  }
  // A drill bought while one runs EXTENDS it (the one buff rule,
  // Buffs.laterOf: another day on top of what is left), never refused.
  function buyDrill(save, kind, now = Date.now()) {
    if (!Combat.TRAINING_KINDS[kind]) return { ok: false, why: 'kind' };
    const price = drillPrice();
    if ((save.money ?? 0) < price) return { ok: false, why: 'money', price };
    addMoney(save, -price);
    save.trainingDrills[kind] = Buffs.laterOf(Combat.trainingDrillUntil(save, kind), Combat.TRAINING_BUFF_MS, now);
    return { ok: true, price };
  }
  // Time left on a discipline's drill, ms (0 when none runs).
  function drillLeftMs(save, kind, now = Date.now()) {
    return Math.max(0, Combat.trainingDrillUntil(save, kind) - now);
  }

  // ── Per-kind dialog dressing: the painting each opens on and its label ────
  // Default paintings for each service; training also selects by discipline.
  // `modal` is a MODAL_KINDS key.
  // The scholar's Book Club uses one reading ledger across every school.
  // Each three Books collected (read automatically, bought ones included)
  // earns a tome, ordered by value and repeating after a full set.
  // Treasure pools do not own this shelf.
  // Keep tome claims separate from legacy scholarPrizes: that mixed shelf
  // awarded ordinary items too, so its index must not skip new tome prizes.
  const SCHOLAR_BOOKS_PER_PRIZE = 3;
  function scholarShelf() {
    return ITEMS.filter(item => isTome(item.id)).map(item => item.id)
      .sort((a, b) => (itemValue(a) - itemValue(b)) || (a < b ? -1 : a > b ? 1 : 0));
  }
  function booksRead(save) { return Math.max(0, Math.floor(Number(save && save.booksRead) || 0)); }
  function scholarTaken(save) { return Math.max(0, Math.floor(Number(save && save.scholarTomes) || 0)); }
  // The next tome — { id, index, booksAt, ready } — or null for an empty
  // shelf. The sequence repeats; booksAt is the lifetime reading milestone.
  function scholarNext(save, shelf = scholarShelf()) {
    const index = scholarTaken(save);
    if (!shelf.length) return null;
    const booksAt = (index + 1) * SCHOLAR_BOOKS_PER_PRIZE;
    return { id: shelf[index % shelf.length], index, booksAt, ready: booksRead(save) >= booksAt };
  }
  // Take the next earned prize off the shelf. The caller has already put it
  // in the bag (the bag may be full — app.js addToInv says so first).
  function scholarClaim(save, shelf = scholarShelf()) {
    const next = scholarNext(save, shelf);
    if (!next) return { ok: false, why: 'bare' };
    if (!next.ready) return { ok: false, why: 'unread', next };
    save.scholarTomes = next.index + 1;
    return { ok: true, id: next.id, index: next.index };
  }

  // One row per booth kind: `label` (its sign and dialog word), `modal` (the
  // modal_shell kind), `art` (the introduction painting) and `present` — the
  // scene method (app.js) that opens its dialog, `(sx, sy, o, dress)`. A
  // counter that sells off a shelf presents through `_presentStallOffer` with
  // its `stock(o)` and `title` columns; the chapel is no dialog of its own
  // (interactables.js' daily visit), so it names no presenter.
  const KIND_DIALOG = {
    inn:         { label: 'Inn',         modal: 'shop',     art: 'booth_inn_intro',         present: '_presentInn' },
    chapel:      { label: 'Chapel',      modal: 'treasure', art: 'booth_chapel_intro' },
    apothecary:  { label: 'Apothecary',  modal: 'shop',     art: 'booth_apothecary_intro',  present: '_presentStallOffer',
      stock: (o) => apothecaryStock(o), title: 'The apothecary has on the shelf:' },
    scriptorium: { label: 'Scriptorium', modal: 'shop',     art: 'booth_scriptorium_intro', present: '_presentStallOffer',
      stock: () => scriptoriumStock(), title: 'The scriptorium sells:' },
    guildhall:   { label: 'Guildhall',   modal: 'delivery', art: 'booth_guildhall_intro',   present: '_presentGuildhall' },
    curio:       { label: 'Curio Hall',  modal: 'trade',    art: 'booth_curio_intro',       present: '_presentCurio' },
    sundries:    { label: 'Sundries',    modal: 'shop',     art: 'booth_sundries_intro',    present: '_presentStallOffer',
      stock: (o) => sundriesStock(o), title: 'The counter has in stock:' },
    training:    { label: 'Training',    modal: 'shop',     art: 'booth_training_intro',    present: '_presentTraining' },
    scholar:     { label: 'Book Club',   modal: 'trade',    art: 'booth_scholar_intro',     present: '_presentScholar' },
  };  // The word a stall's sign and dialog wear: its kind's label, except a
  // training hall, which names its discipline ("Archery Training").
  function stallLabel(kind, o) {
    if (kind === 'training' && o) return `${Combat.TRAINING_KINDS[trainingKindFor(o)].label} Training`;
    return KIND_DIALOG[kind]?.label || null;
  }
  function stallArt(kind, o) { return KIND_DIALOG[kind]?.art; }

  // One receipt painting per service. Callers provide the exact committed
  // result; failed or cancelled transactions never show a receipt.
  const KIND_TRANSACTION = {
    inn:         { title: 'Rested',              art: 'booth_inn_used' },
    chapel:      { title: 'A blessing received', art: 'booth_chapel_used' },
    apothecary:  { title: 'Medicine bought',     art: 'booth_apothecary_used' },
    scriptorium: { title: 'From the scriptorium', art: 'booth_scriptorium_used' },
    guildhall:   { title: 'Bounty paid',         art: 'booth_guildhall_used' },
    curio:       { title: 'A curio donated',     art: 'booth_curio_used' },
    sundries:    { title: 'Supplies bought',     art: 'booth_sundries_used' },
    training:    { title: 'Training complete',  art: 'booth_training_used' },
    scholar:     { title: 'A tome earned',      art: 'booth_scholar_used' },
  };

  // One introduction per physical booth, followed by its live offer. State
  // the input and promised effect here; exact prices come from the offer.
  const KIND_STORY = {
    inn: { title: 'An inn', body: 'Fresh blankets cover a bed beneath the green awning. Pay coins to restore all missing HP, once a day at this inn.' },
    chapel: { title: 'A chapel', body: 'A small bell hangs beneath the blue canopy. Receive a free blessing gift here once a day; nothing is asked in return.' },
    apothecary: { title: 'An apothecary', body: 'The keeper grows herbs among the old foundations. Pay coins for a potion or antidote from the shelf.' },
    scriptorium: { title: 'A scriptorium', body: 'The scribe repairs pages salvaged after the Breaking. Pay coins for a Book to read, or a torch to carry.' },
    guildhall: { title: 'A guildhall', body: 'The keeper posts work as neighbours return. Defeat the posted creatures to earn coins; this hall offers one bounty a day.' },
    curio: { title: 'A curio hall', body: 'Recovered keepsakes fill the shelves beneath the crystal sign. Donate one of each missing curio; collection milestones bring back memories.' },
    sundries: { title: 'A sundries shop', body: 'Mended sacks and bundled tools fill the counter. Pay coins for the supplies offered here.' },
    training: { title: 'A training hall', body: 'Practice rings out beneath the crossed weapons. Pay coins for a permanent lesson when you have enough memories, or buy a temporary drill.' },
    scholar: { title: 'A book club', body: `You join the book club beneath the scholar’s open-book sign. Every ${SCHOLAR_BOOKS_PER_PRIZE} Books collected earns a tome; found and bought Books count, and no books or coins are spent to claim it.` },
  };

  root.Macros = {
    usedToday, markToday, serviceLedgerId, serviceUsedToday, markServiceToday,
    DAILY_VISIT_KINDS, visitKindForObject, rowUsed, rowWaitMs, markUsed, takenBy, waitLine,
    beginDailyVisit, dailyVisit, hireMercenary,
    daysSinceTaken, stillBare, restockWaitMs, ledgerKeyDay, LEDGER_KEEP_DAYS, stallPrice,
    INN_RATE, innCoinsPerEnergy, innPrice, innRest,
    CHAPEL_TIER_DROP, chapelRollTier,
    APOTHECARY_POTIONS, APOTHECARY_CURE, apothecaryStock,
    SUNDRIES_GEAR, SUNDRIES_SHIELDS, SUNDRIES_GEAR_PRICE_MUL, sundriesStock, isSundriesGear, sundriesGear,
    SCRIPTORIUM_BOOK, SCRIPTORIUM_STOCK, scriptoriumStock,
    BOUNTY_LADDER, BOUNTY_TIERS_PER_RUNG, BOUNTY_TIERS_PER_FOE, BOUNTY_MAX_FOES, BOUNTY_MATCH, BOUNTY_DIST_CELLS,
    bountyWeaponTier, bountyFor, bountyPay, slainByPlayer, bountyCleared,
    CURIO_COLLECTION, CURIO_MILESTONES, curioEligible, curioCollection, curioDonated, curioCount,
    curioNextMilestone, curioMilestoneKey, curioMissing, curioDonate,
    TRAINING_LESSON_PRICE, TRAINING_DRILL_PRICE, TRAINING_MEMORIES_PER_LEVEL, trainingKindFor, lessonMemoriesAt, lessonMemories, stallLabel, lessonPriceAt, lessonPrice, lessonPricesAll, drillPrice,
    buyLesson, buyDrill, drillLeftMs,
    SCHOLAR_BOOKS_PER_PRIZE, scholarShelf, booksRead, scholarTaken, scholarNext, scholarClaim,
    KIND_DIALOG, KIND_STORY, KIND_TRANSACTION, stallArt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
