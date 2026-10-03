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
// VIGOR_POTION_ENERGY), util.js (fnv1a, makeRng32), delivery.js (Delivery),
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
  // and short enough that the save does not grow.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const LEDGER_KEEP_DAYS = (typeof CRATE_RESTORE_MAX_DAYS === 'number') ? CRATE_RESTORE_MAX_DAYS : 7;
  function _date(now) { return now instanceof Date ? now : new Date(now ?? Date.now()); }
  function _day(now) { return Delivery.dayKey(_date(now)); }
  // A ledger key's day as a UTC day number (days since the epoch), or NaN.
  function ledgerKeyDay(key) {
    const m = /(\d{4})(\d{2})(\d{2})$/.exec(String(key));
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : NaN;
  }
  function usedToday(save, id, now) {
    const m = save && save.coinBurstClaimed;
    return !!m && m[id + _day(now)] === 1;
  }
  function markToday(save, id, now) {
    const day = _day(now);
    const ledger = save.coinBurstClaimed = save.coinBurstClaimed || {};
    ledger[id + day] = 1;
    const today = Math.floor(_date(now).getTime() / DAY_MS);
    for (const k of Object.keys(ledger)) {
      const d = ledgerKeyDay(k);
      if (!(today - d < LEDGER_KEEP_DAYS)) delete ledger[k];
    }
  }
  // Daily places share one ledger and one story ceremony. Pending dialogs
  // are scene state only: leaving loot behind never spends the day's visit.
  const DAILY_VISIT_KINDS = {
    wagon: { name: 'Mercenary wagon', art: 'visit_wagon', sprite: 'wagon', light: 0xf2d9a0,
      reward: 'companion', effect: 'A mercenary fights beside you',
      get price() { return root.Companions.KINDS.mercenary.hireCost; },
      get durationMs() { return root.Companions.KINDS.mercenary.durationMs; },
      locations: ['Old-trade-road bus stops'],
      body: 'The mercenary takes your coins and lifts his sword. He falls into step beside you.' },
    bike: { name: "Courier's post", art: 'visit_bike', sprite: 'bike_rack', light: 0xaadbd1,
      reward: 'bike', effect: 'Faster walking', locations: ['Mapped bicycle parking'], get durationMs() { return BIKE_RACK_MS; },
      spent: 'Horse is out.',
      body: 'A saddled horse waits at the post. You mount up and ride through the ruins.' },
    gold: { name: 'Pot of gold', art: 'visit_gold', sprite: 'potofgold', light: 0xffd778,
      reward: 'coins', effect: 'Scattered coins', durationMs: 0,
      locations: ['Mapped ATMs'],
      body: 'You lift the heavy lid. Coins spill across the ground.' },
  };
  function visitKindForObject(o) {
    const shrine = root.Shrines?.kindForObject(o);
    if (shrine) return shrine;
    if (!o || o.kind !== 'chest' || typeof chestLook !== 'function') return null;
    const look = chestLook(o);
    return look.wagon ? DAILY_VISIT_KINDS.wagon : look.bike ? DAILY_VISIT_KINDS.bike
      : look.coin ? DAILY_VISIT_KINDS.gold : null;
  }
  function beginDailyVisit(ctx, o, { row = visitKindForObject(o), held = false } = {}) {
    const { scene, save, sx, sy } = ctx;
    const pending = scene._dailyVisits || (scene._dailyVisits = new Set());
    if (!held && usedToday(save, o.id)) {
      scene.flash(`${row?.spent || 'Already visited.'} ${shortDuration(msToNextUtcDay())}.`, sx, sy);
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
          if (ctx.dirty && typeof persistSave === 'function') persistSave(save);
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
      scene.flash(`Need $${row.price} to hire.`, sx, sy);
      visit.finish();
      return true;
    }
    if (typeof scene.showConfirmModal !== 'function') { visit.finish(); return true; }
    let settled = false;
    scene._mercenaryHirePending = true;
    scene.showConfirmModal({ id: 'mercenary-hire', title: row.name, art: row.art,
      body: `Hire a mercenary for $${row.price}? He follows you and fights enemies for ${shortDuration(row.durationMs)}.`,
      acceptLabel: `Hire · $${row.price}`, cancelLabel: 'Later',
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
        if (typeof persistSave === 'function') persistSave(save);
        scene._finishInventoryChange?.();
        visit.present();
      },
    });
    return true;
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
    const t = _date(now).getTime();
    for (let k = 0; k < LEDGER_KEEP_DAYS; k++) {
      if (m[id + Delivery.dayKey(new Date(t - k * DAY_MS))] === 1) return k;
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
    const t = _date(now).getTime();
    return msToNextUtcDay(t) + (n - 1 - k) * DAY_MS;
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
  // (PRICES.vigor_potion / VIGOR_POTION_ENERGY) × INN_RATE: cheaper than
  // carrying a potion, but you walk to it and it is once a day. Not Home's
  // passive rest (free, on HOME_R, gated on `working`): a one-shot purchase.
  const INN_RATE = 0.5;
  function innCoinsPerEnergy() {
    return PRICES.healing_potion / VIGOR_POTION_ENERGY * INN_RATE;
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
  // One remedy per apothecary (a dentist is always Vigor), plus the
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
    const day = _day(now);
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
  // Is a posted bounty cleared? Every foe id is in save.caught (resolveDefeat's
  // one mark).
  function bountyCleared(save, foeIds) {
    const caught = new Set((save && save.caught) || []);
    return foeIds.length > 0 && foeIds.every((id) => caught.has(id));
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
    'flint_shard', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar',
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
    save.training = save.training || {};
    save.training[kind] = Combat.trainingLevel(save, kind) + 1;
    return { ok: true, price };
  }
  // One drill at a time per discipline: the hall refuses another while one
  // runs (the dialog names the time left), so it can never be bought twice over.
  function buyDrill(save, kind, now = Date.now()) {
    if (!Combat.TRAINING_KINDS[kind]) return { ok: false, why: 'kind' };
    if (Combat.trainingBuffActive(save, kind, now)) return { ok: false, why: 'active' };
    const price = drillPrice();
    if ((save.money ?? 0) < price) return { ok: false, why: 'money', price };
    addMoney(save, -price);
    save.trainingDrills = save.trainingDrills || {};
    save.trainingDrills[kind] = now + Combat.TRAINING_BUFF_MS;
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

  const KIND_DIALOG = {
    inn:         { label: 'Inn',         modal: 'shop',     art: 'booth_inn_intro' },
    chapel:      { label: 'Chapel',      modal: 'treasure', art: 'booth_chapel_intro' },
    apothecary:  { label: 'Apothecary',  modal: 'shop',     art: 'booth_apothecary_intro' },
    scriptorium: { label: 'Scriptorium', modal: 'shop',     art: 'booth_scriptorium_intro' },
    guildhall:   { label: 'Guildhall',   modal: 'delivery', art: 'booth_guildhall_intro' },
    curio:       { label: 'Curio Hall',  modal: 'trade',    art: 'booth_curio_intro' },
    sundries:    { label: 'Sundries',    modal: 'shop',     art: 'booth_sundries_intro' },
    training:    { label: 'Training',    modal: 'shop',     art: 'booth_training_intro' },
    scholar:     { label: 'Book Club',   modal: 'trade',    art: 'booth_scholar_intro' },
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
    DAILY_VISIT_KINDS, visitKindForObject, beginDailyVisit, dailyVisit, hireMercenary,
    daysSinceTaken, stillBare, restockWaitMs, ledgerKeyDay, LEDGER_KEEP_DAYS, stallPrice,
    INN_RATE, innCoinsPerEnergy, innPrice, innRest,
    CHAPEL_TIER_DROP, chapelRollTier,
    APOTHECARY_POTIONS, APOTHECARY_CURE, apothecaryStock,
    SUNDRIES_GEAR, SUNDRIES_SHIELDS, SUNDRIES_GEAR_PRICE_MUL, sundriesStock, isSundriesGear, sundriesGear,
    SCRIPTORIUM_BOOK, SCRIPTORIUM_STOCK, scriptoriumStock,
    BOUNTY_LADDER, BOUNTY_TIERS_PER_RUNG, BOUNTY_TIERS_PER_FOE, BOUNTY_MAX_FOES, BOUNTY_MATCH, BOUNTY_DIST_CELLS,
    bountyWeaponTier, bountyFor, bountyPay, bountyCleared,
    CURIO_COLLECTION, CURIO_MILESTONES, curioEligible, curioCollection, curioDonated, curioCount,
    curioNextMilestone, curioMilestoneKey, curioMissing, curioDonate,
    TRAINING_LESSON_PRICE, TRAINING_DRILL_PRICE, TRAINING_MEMORIES_PER_LEVEL, trainingKindFor, lessonMemoriesAt, lessonMemories, stallLabel, lessonPriceAt, lessonPrice, lessonPricesAll, drillPrice,
    buyLesson, buyDrill, drillLeftMs,
    SCHOLAR_BOOKS_PER_PRIZE, scholarShelf, booksRead, scholarTaken, scholarNext, scholarClaim,
    KIND_DIALOG, KIND_STORY, KIND_TRANSACTION, stallArt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
