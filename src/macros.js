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
//   • the DAY LEDGER — save.coinBurstClaimed[id + Delivery.dayKey()], the
//     coin-burst / grove-shrine ledger, pruned of other days on every write
//     (inn, chapel, scriptorium's free page, guildhall). A chest id in it is
//     NOT spent (interactables.js isSpent — a macro is never spent);
//   • save.donated — the curio ids this save has given (progress, not world
//     state);
//   • save.trainingPerm / save.trainingBuffUntil — the damage the player
//     bought (read by combat.js Combat.trainingMul through app.js _attackMul).
// The stalls (apothecary, sundries, the scriptorium's Book) have no gate at
// all: a counter, like the market stall they share their dialog with.
//
// Depends on (call time): items.js (PRICES, ITEMS, ITEM_BY_ID,
// VIGOR_POTION_ENERGY), util.js (fnv1a, makeRng32), delivery.js (Delivery),
// shops.js (Shops.THEME_POOL), shops_math.js (ShopsMath.standPrice),
// loot.js (chestRollTier), combat.js (Combat.training*), energy.js (Energy),
// inventory.js (Inventory), save.js (addMoney).
(function (root) {
  'use strict';

  // ── The day ledger (the coin-burst one) ────────────────────────────────────
  function _day(now) { return Delivery.dayKey(now instanceof Date ? now : new Date(now ?? Date.now())); }
  function usedToday(save, id, now) {
    const m = save && save.coinBurstClaimed;
    return !!m && m[id + _day(now)] === 1;
  }
  function markToday(save, id, now) {
    const day = _day(now);
    const ledger = save.coinBurstClaimed = save.coinBurstClaimed || {};
    ledger[id + day] = 1;
    for (const k of Object.keys(ledger)) if (!k.endsWith(day)) delete ledger[k];
  }

  // What every stall counter charges for `id`: the market stall's price
  // (ShopsMath.standPrice — below par, never an arbitrage pump).
  function stallPrice(save, id) {
    return ShopsMath.standPrice(save, (typeof PRICES !== 'undefined' && PRICES[id]) || 1);
  }
  // A stable pick from `pool` for this POI — a hash of its id and a per-kind
  // salt, so every player's apothecary on that corner sells the same thing.
  function _pick(o, salt, pool) {
    return pool.length ? pool[fnv1a(String(o && o.id) + '|' + salt) % pool.length] : null;
  }

  // ── INN: rest to full for money, once a day per inn ───────────────────────
  // The price per point of energy is the Potion of Vigor's own
  // (PRICES.vigor_potion / VIGOR_POTION_ENERGY) × INN_RATE: cheaper than
  // carrying a potion, but you walk to it and it is once a day. Not Home's
  // passive rest (free, on HOME_R, gated on `working`): a one-shot purchase.
  const INN_RATE = 0.5;
  function innCoinsPerEnergy() {
    return PRICES.vigor_potion / VIGOR_POTION_ENERGY * INN_RATE;
  }
  function innPrice(missing) {
    const m = Math.max(0, Math.floor(missing || 0));
    return m > 0 ? Math.max(1, Math.ceil(m * innCoinsPerEnergy())) : 0;
  }
  // Rest `save` to `maxE` at inn `o`. Returns { ok, gain, price, why }:
  // why ∈ 'used' | 'full' | 'money'. Energy goes through Energy.set.
  function innRest(save, o, maxE, now) {
    if (usedToday(save, o.id, now)) return { ok: false, why: 'used' };
    const cur = save.energy ?? 0;
    const missing = Math.max(0, maxE - cur);
    if (missing <= 0) return { ok: false, why: 'full' };
    const price = innPrice(missing);
    if ((save.money ?? 0) < price) return { ok: false, why: 'money', price };
    addMoney(save, -price);
    Energy.set(save, maxE, maxE);
    markToday(save, o.id, now);
    return { ok: true, gain: (save.energy ?? 0) - cur, price };
  }

  // ── CHAPEL: daily alms, a tier humbler than the chest it replaced ────────
  // The roll is the chest's own (chestRollTier — Home's rings, the depth
  // bonus and the churchyard's ZONE_NEXUS_TIER_BONUS all still apply) less
  // CHAPEL_TIER_DROP, floored at T1: it pays every day, where the chest paid
  // once. Inside a churchyard (a nexus) that nets the old chest's tier.
  const CHAPEL_TIER_DROP = 1;
  function chapelRollTier(o) {
    return Math.max(1, chestRollTier(o.poiClass, o.x, o.y, o.depth, o.zoneNexus) - CHAPEL_TIER_DROP);
  }

  // ── APOTHECARY: a potion counter, and the cure ────────────────────────────
  // One T2 remedy per apothecary (a dentist is always Vigor), plus the
  // Antidote (T1 — the poison cure, src/conditions.js) at every counter. The
  // village Potion Shop keeps the higher tiers: nothing here is above T2.
  const APOTHECARY_POTIONS = ['vigor_potion', 'revive_potion', 'shield_potion', 'reach_potion'];
  const APOTHECARY_CURE = 'antidote';
  function apothecaryStock(o) {
    const potion = (o && o.poiClass === 'dentist') ? 'vigor_potion' : _pick(o, 'apothecary', APOTHECARY_POTIONS);
    return [potion, APOTHECARY_CURE].filter((id) => id && ITEM_BY_ID[id]);
  }

  // ── SUNDRIES: a supply counter ────────────────────────────────────────────
  // One supply item per shop, from the village Supply Shop's own line
  // (Shops.THEME_POOL.supply) less the Book, which is the Scriptorium's.
  const SUNDRIES_SKIP = new Set(['book']);
  function sundriesStock(o) {
    const pool = Shops.THEME_POOL.supply().filter((id) => !SUNDRIES_SKIP.has(id) && ITEM_BY_ID[id]);
    const id = _pick(o, 'sundries', pool);
    return id ? [id] : [];
  }

  // ── SCRIPTORIUM: a free page a day, and Books for sale ───────────────────
  // The page is the Book's own next page (app.js _bookRead — the PLAY_TIPS
  // curriculum and its bookmark) read without spending a Book, once per
  // scriptorium per UTC day (the day ledger). The Book is a stall item.
  const SCRIPTORIUM_BOOK = 'book';

  // ── GUILDHALL: one commission a day ───────────────────────────────────────
  // The board wants COMMISSION_ITEMS produce, drawn by the delivery rules — the
  // hall's bundle theme (Delivery.bundleTheme off its id) under the player's
  // own tier cap (Delivery.tierCap) — from a stream seeded by the hall's id AND
  // the UTC day, so it changes daily and two players at the same progress see
  // the same board. It pays `mul` (app.js DELIVERY_BONUS_MULT) × par, like a
  // household. One set, once a day per hall (the day ledger). It is a delivery,
  // not a sell page (selling stays at Home), and not a household (never "happy
  // for good": the ledger is the only memory).
  const COMMISSION_ITEMS = 2;
  function commissionWants(save, o, now) {
    const cap = Delivery.tierCap(save);
    const tierOk = (id) => ITEM_BY_ID[id] && Delivery.produceTier(id) <= cap;
    let pool = (Delivery.BUNDLE_THEMES[Delivery.bundleTheme(o)] || []).filter(tierOk);
    if (pool.length < COMMISSION_ITEMS) {
      pool = ITEMS.filter((i) => i.kind === 'produce').map((i) => i.id).filter(tierOk);
    }
    const rng = makeRng32(fnv1a(String(o && o.id) + '|commission|' + _day(now)));
    const picks = [];
    while (picks.length < COMMISSION_ITEMS && pool.length) {
      picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    return picks;
  }
  function commissionPay(wanted, mul) {
    return Math.max(1, Math.round(wanted.reduce((s, id) => s + Math.max(1, PRICES[id] ?? 1), 0) * mul));
  }
  // Hand the set in: { ok, gain, why } with why ∈ 'used' | 'missing'.
  function commissionDeliver(save, o, mul, now) {
    if (usedToday(save, o.id, now)) return { ok: false, why: 'used' };
    const wanted = commissionWants(save, o, now);
    if (!wanted.length || wanted.some((id) => Inventory.count(save, id) < 1)) return { ok: false, why: 'missing', wanted };
    for (const id of wanted) Inventory.remove(save, id, 1);
    const gain = commissionPay(wanted, mul);
    addMoney(save, gain);
    markToday(save, o.id, now);
    return { ok: true, gain, wanted };
  }

  // ── CURIO HALL: donate one of each thing, once ───────────────────────────
  // A NEW lane, and what it is NOT: not a sell page (selling stays at Home, and
  // an id pays here once per save, ever) and not a delivery (it wants whatever
  // you have not given yet, not a set). Any priced item but seeds pays
  // CURIO_DONATE_MUL × PRICES[id]; the ids given are save.donated, shared by
  // every hall (the collection is the player's, the halls are its doors).
  const CURIO_DONATE_MUL = 2;
  function curioEligible(id) {
    const it = ITEM_BY_ID[id];
    return !!it && it.kind !== 'seed' && (PRICES[id] ?? 0) > 0;
  }
  function curioCollection() { return ITEMS.filter((i) => curioEligible(i.id)).map((i) => i.id); }
  function curioDonated(save, id) { return (save.donated || []).includes(id); }
  function curioPay(id) { return Math.max(1, Math.round((PRICES[id] ?? 0) * CURIO_DONATE_MUL)); }
  // Give ONE `id`: { ok, gain, why } with why ∈ 'ineligible' | 'given' | 'none'.
  function curioDonate(save, id) {
    if (!curioEligible(id)) return { ok: false, why: 'ineligible' };
    if (curioDonated(save, id)) return { ok: false, why: 'given' };
    if (Inventory.count(save, id) < 1) return { ok: false, why: 'none' };
    Inventory.remove(save, id, 1);
    save.donated = [...(save.donated || []), id];
    const gain = curioPay(id);
    addMoney(save, gain);
    return { ok: true, gain };
  }

  // ── TRAINING HALL: buy damage, for good or for a day ─────────────────────
  // The bonus itself is combat.js's (Combat.trainingMul — +1% a lesson to
  // +25%, +10% for 24 h a drill). The prices are anchored on the Dragon
  // Powder (PRICES.dragon_powder — a minute of ×2 damage): a lesson starts at
  // one powder and each lesson owned adds TRAINING_LESSON_RAMP of one; a drill
  // is TRAINING_DRILL_PRICE_MUL of one.
  const TRAINING_LESSON_RAMP = 0.25;
  const TRAINING_DRILL_PRICE_MUL = 0.5;
  // The next lesson's price, or null once the cap is reached.
  function lessonPrice(save) {
    const k = Combat.trainingLessons(save);
    if (k >= Combat.TRAINING_PERM_MAX) return null;
    return Math.round(PRICES.dragon_powder * (1 + k * TRAINING_LESSON_RAMP));
  }
  // Every lesson's price, first to last (the Book tip's "all of them" sum).
  function lessonPricesAll() {
    const out = [];
    for (let k = 0; k < Combat.TRAINING_PERM_MAX; k++) out.push(Math.round(PRICES.dragon_powder * (1 + k * TRAINING_LESSON_RAMP)));
    return out;
  }
  function drillPrice() { return Math.round(PRICES.dragon_powder * TRAINING_DRILL_PRICE_MUL); }
  function buyLesson(save) {
    const price = lessonPrice(save);
    if (price == null) return { ok: false, why: 'cap' };
    if ((save.money ?? 0) < price) return { ok: false, why: 'money', price };
    addMoney(save, -price);
    save.trainingPerm = Combat.trainingLessons(save) + 1;
    return { ok: true, price };
  }
  // One drill at a time: the hall refuses another while one runs (the dialog
  // names the time left), so the bonus can never be bought twice over.
  function buyDrill(save, now = Date.now()) {
    if (Combat.trainingBuffActive(save, now)) return { ok: false, why: 'active' };
    const price = drillPrice();
    if ((save.money ?? 0) < price) return { ok: false, why: 'money', price };
    addMoney(save, -price);
    save.trainingBuffUntil = now + Combat.TRAINING_BUFF_MS;
    return { ok: true, price };
  }
  // Time left on the drill, ms (0 when none runs).
  function drillLeftMs(save, now = Date.now()) {
    return Math.max(0, (Number(save && save.trainingBuffUntil) || 0) - now);
  }

  // ── Per-kind dialog dressing: the painting each opens on and its label ────
  // Paintings are existing scene pieces (no macro has its own yet): the
  // closest subject each. `modal` is a MODAL_KINDS key.
  const KIND_DIALOG = {
    inn:         { label: 'Inn',         modal: 'shop',     art: 'castle_favour' },
    chapel:      { label: 'Chapel',      modal: 'treasure', art: 'zone_stones' },
    apothecary:  { label: 'Apothecary',  modal: 'shop',     art: 'kind_shop' },
    scriptorium: { label: 'Scriptorium', modal: 'shop',     art: 'book_read' },
    guildhall:   { label: 'Guildhall',   modal: 'delivery', art: 'kind_quest' },
    curio:       { label: 'Curio Hall',  modal: 'trade',    art: 'kind_relics' },
    sundries:    { label: 'Sundries',    modal: 'shop',     art: 'kind_supplies' },
    training:    { label: 'Training',    modal: 'shop',     art: 'tool_sword' },
  };
  // The first-tap story (app.js _storySplashOnce, key `macro:<kind>`): what
  // the place is, told once. No numbers — those are on the dialog and in the
  // Book.
  const KIND_STORY = {
    inn:         { title: 'An inn', body: 'A bed, a hearth and a keeper who takes coin. Once a day it will see you rested.' },
    chapel:      { title: 'A chapel', body: 'Somebody still tends it. Each day there are alms by the door for whoever comes, and the keeper watches you take them.' },
    apothecary:  { title: 'An apothecary', body: 'Shelves of small bottles, and a counter that never runs dry.' },
    scriptorium: { title: 'A scriptorium', body: 'The written word, kept. A page a day is yours to read here, and Books are for sale.' },
    guildhall:   { title: 'A guildhall', body: 'The board by the door posts one commission a day, and pays well for it.' },
    curio:       { title: 'A curio hall', body: 'The hall is rebuilding a collection. It pays for one of anything it lacks.' },
    sundries:    { title: 'A sundries shop', body: 'A counter of useful things, always stocked.' },
    training:    { title: 'A training hall', body: 'Lessons that stay with you, or a hard day’s drill that wears off by tomorrow.' },
  };

  root.Macros = {
    usedToday, markToday, stallPrice,
    INN_RATE, innCoinsPerEnergy, innPrice, innRest,
    CHAPEL_TIER_DROP, chapelRollTier,
    APOTHECARY_POTIONS, APOTHECARY_CURE, apothecaryStock,
    SUNDRIES_SKIP, sundriesStock,
    SCRIPTORIUM_BOOK,
    COMMISSION_ITEMS, commissionWants, commissionPay, commissionDeliver,
    CURIO_DONATE_MUL, curioEligible, curioCollection, curioDonated, curioPay, curioDonate,
    TRAINING_LESSON_RAMP, TRAINING_DRILL_PRICE_MUL, lessonPrice, lessonPricesAll, drillPrice,
    buyLesson, buyDrill, drillLeftMs,
    KIND_DIALOG, KIND_STORY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
