// The scene's SHOPS — every door that sells, buys, swaps or serves:
//   · shopInteract, the one entry a shop tap reaches, and the starter-shop
//     lookups (isStarterShop / ensureStarterShopId and the smith's two
//     starter slots);
//   · the offers it opens: the market stalls, deliveries (the
//     wishlist, knownDeliveryHouses / openDeliveryMenu), relic and themed
//     shops, the smelter, the wizard, the trader's barter, the castle's daily
//     service, the quest board, the fort unlock and the blacksmith's forge
//     (with its FORGE_CEREMONY story pane);
//   · the shop clock they share: shopBucketState / shopRng and
//     buildShopOffer (no per-hour deal cap; the trader alone rests a few
//     minutes after a deal — shops_math.js header).
// Plus the constants only they read.
//
// Moved verbatim out of app.js. The methods live on `class SceneShops`, a
// MIXIN: app.js installs them onto MapScene.prototype right after the class
// closes (installSceneMixin, from modal_shell.js), so every caller still says
// `this.shopInteract()` / `this.presentTraderOffer()` and nothing else
// changed. The consts stay plain top-level lexical globals (never window.X —
// see lexical_globals.test.js). This file loads BEFORE app.js, so an
// initializer here may only read literals or names defined above it; the
// methods read app.js names and this.* at CALL time only.
//
// What this is NOT: the pricing and stock rules (shops_math.js / shops.js,
// Rewards, Delivery, Houses own the numbers and who sells what), nor the
// dialogs themselves (makeModalShell / showOfferModal are SceneModals, in
// modal_shell.js). Home's own sell / craft tabs, the inn, guildhall, curio,
// training and fort slots are SceneVenues (scene_venues.js).

// THE SMITHY'S PREVIEW: what you receive is a big picture over its name, not
// a line-height icon beside it. The Smithy chip and the Forge / Smelt tab
// already say where you are, so neither offer carries a flavour title, and
// the picture IS the receiving side: only the price is captioned (You give).
const SMITHY_PREVIEW_PX = 56;
const smithyPreviewHTML = (iconHTML, name) =>
  `<div style="line-height:0;margin:2px 0 6px">${iconHTML}</div><div>${name}</div>`;
// THE TWO REFUSALS every counter shares, worded once: a purse that cannot
// cover a price (_spendMoney, the re-roll button, buildShopOffer's
// shortDenial) and a bag with no room for what is bought (named for the
// stack, so the player knows which one to thin — on its own line, so the
// longest catalogue name still fits MAP_MSG_MAX; economy_owners.test.js
// measures both).
const purseShort = (price) => `Purse too light — need ${price}.`;
const bagFullFor = (id) => `Bag full for\n${itemName(id)}.`;
// THE FORGE CEREMONY (presentBlacksmithOffer's onAccept): the piece just
// forged, large on the forge_done painting (a bare anvil, so the icon is the
// only piece in the picture), with the player’s first impression of the finished work.
const FORGE_CEREMONY = {
  kind: 'forge', art: 'forge_done', header: 'Forged!', iconPx: 64,
  sub: "The smith sets your finished gear on the counter. You feel the heat still rising from it.",
};
// Deliveries (plain-house produce-set turn-ins) pay this multiple of the set's
// summed full price — a 50% premium over selling the items individually.
const DELIVERY_BONUS_MULT = 1.5;
// The fort unlock wood ladder (FORT_UNLOCK_WOOD*) and what a wreck can be
// restored as (Houses.BUILD_OPTIONS) live in houses.js with the rules that read them.
// Delivery wishlists unlock higher tiers as the player's lifetime tally grows;
// the tier cap (PRODUCE_TIER_MIN/MAX, TIER_UNLOCK_EVERY) and the wishlist roll
// now live with the rest of the delivery logic in delivery.js (Delivery.tierCap).
// Trader BARTER deals hand the player this many of the offered item per deal,
// so swapping goods is twice as favourable as raw cash. CASH purchases are
// deliberately excluded (they hand over exactly 1): a ×2 cash bundle made the
// effective per-unit buy price ~0.6× base, which a mid-tier Sword (sell
// 0.5→1.0×) turned into a buy-then-resell money loop.
const TRADE_OFFER_QTY     = 2;
const CASTLE_TAX_GOLD = 10;
// Tool slots the starter blacksmith can forge a wooden (T1) relic for. All
// six have wooden-tier art via gearAssetPath. The smithy picks 2 at random
// (see starterSmithSlots) as the player's bootstrap tools.
const STARTER_SMITH_SLOTS = ['pickaxe', 'axe', 'hoe', 'fishing_rod', 'watering_can', 'net'];

class SceneShops {

  // Produce stand = a roadside MARKET (not a one-shot chest). It sells the
  // produce its awning advertises (loot.js produceStandFor → { item, frame })
  // BELOW par — a fresh stall undercuts the listed price rather than applying
  // the 1.2–3.0× buyPrice ramp, which is for restocking village shops. How far
  // below is ShopsMath.standPrice's business: the discount is capped by what
  // the player could resell for, so a stand can never be an arbitrage pump.
  // Each Buy tap purchases one item while the counter stays open.
  // The stall is never marked save.opened.
  presentMarketStandOffer(sx, sy, stand) {
    this._presentStallOffer(sx, sy, { items: [stand.item], title: 'The market stall sells fresh:' });
  }

  // THE STALL COUNTER — the one buy dialog every counter shares: the market
  // stall above, and the macro stalls that sell (the apothecary's potion and
  // cure, the sundries' supply, the scriptorium's Book and torch —
  // src/macros.js; the same price and no stock limit). A
  // counter of more than one item shows a tab per item. `items` are ids;
  // `index` is the tab shown; `kind` / `kindLabel` / `art` dress the dialog
  // (the market stall keeps the 'shop' kind's own painting).
  _presentStallOffer(sx, sy, opts) {
    // Single-modal guard — mirror shopInteract so rapid taps can't stack modals.
    if (document.getElementById('offer-modal')) return;
    const { items, index = 0, title, kind = 'shop', kindLabel, art } = opts;
    const id = items && items[index];
    if (!id) return;
    const item = ITEM_BY_ID[id];
    // The list price is the ladder's (ShopsMath.listPrice — only the Book
    // climbs, with every one bought); the stall discount comes off that.
    const listPrice = ShopsMath.listPrice(this.save, id);
    const unitPrice = ShopsMath.standPrice(this.save, listPrice);
    const iconHTML = this.iconSpanHTML(id);
    const itemName = item?.name || id;
    const money = () => this.save.money ?? 0;
    const room = () => this.invRoomFor(id);
    // Show what the stall is knocking off, so the discount reads as a deal
    // rather than as an arbitrary number. Suppressed at par (a maxed-out sword
    // pushes the price back up to the listed value — see ShopsMath.standPrice).
    const saved = (listPrice - unitPrice);
    const fmt = (q) => {
      const total = unitPrice * q;
      return {
        get: `${iconHTML} ${itemName} ×${q}`,
        cost: saved > 0 ? `${this.moneyHTML(total)} <span style="opacity:.6">(save ${this.moneyHTML(saved * q, 12)})</span>`
                        : this.moneyHTML(total),
        canAfford: money() >= total && q <= room(),
      };
    };
    const first = fmt(1);
    this.showOfferModal({
      kind: kind, kindLabel, art,
      title,
      tabs: items.length > 1 ? items.map((it, i) => ({
        label: ITEM_BY_ID[it]?.name || it, active: i === index,
        onSelect: () => this._presentStallOffer(sx, sy, { ...opts, index: i }),
      })) : undefined,
      get: first.get,
      cost: first.cost,
      canAfford: first.canAfford,
      acceptLabel: 'Buy',
      cancelLabel: 'Leave',
      repeat: () => this._presentStallOffer(sx, sy, opts),
      onCancel: () => this._revealPendingBookReads(),
      onAccept: () => {
        const want = 1;
        let take = Math.min(want, room());
        if (take <= 0) { this.flash(bagFullFor(id), sx, sy); return; }
        let pay = unitPrice * take;
        if (money() < pay) { this.flash(purseShort(pay), sx, sy); return; }
        take = this.addToInv(id, take, false, { notWild: true, deferRefresh: true, deferBookRead: true });
        if (!(take > 0)) return;
        pay = unitPrice * take;
        addMoney(this.save, -pay);
        if (id === 'book') ShopsMath.bookBought(this.save, take);
        this._settleDeal(null, [`${take}× ${itemName}\n−${pay}`, UI_GOLD, 1, id]);
      },
    });
  }

  // ─── What every closed deal shares ─────────────────────────────────
  // Pay `price` from the purse, or say why not (purseShort) and return false.
  _spendMoney(price, sx, sy) {
    if ((this.save.money ?? 0) < price) { this.flash(purseShort(price), sx, sy); return false; }
    addMoney(this.save, -price);
    return true;
  }
  // The last-chance downgrade guard on a piece of gear: by the time the
  // player taps Buy / Forge, the slot may have been upgraded elsewhere (a
  // chest, another shop). False, with the line, when the offer is no longer
  // an upgrade (Gear.canUpgrade).
  _gearUpgradeOk(offer, sx, sy) {
    if (Gear.canUpgrade(this.save, offer.kind, offer.slot, offer.tier)) return true;
    this.flash('Already carry a finer one.', sx, sy);
    return false;
  }
  // The tail of a closed deal: bank it against the house (`recordDeal` —
  // the shelf turns over, the re-roll ladder settles, the trader's cooldown
  // starts; null for a counter with no house), persist and redraw the bag
  // (the HUD's purse repaints on its own frame), then the loot toast —
  // flashLoot's arguments — when the deal has one.
  _settleDeal(recordDeal, loot) {
    if (recordDeal) recordDeal();
    this._finishInventoryChange();
    if (loot) this.flashLoot(...loot);
  }

  // A sundries counter's gear (Macros.sundriesGear): the next rung of its
  // weapon or shield line above what the player holds, at the counter's
  // gear price. Bought once per rung; a player holding the finest is told so.
  // Reached from presentMacro: a counter whose stock entry is `gear:<line>`
  // (Macros.isSundriesGear) opens this instead of the stall counter.
  _presentStallGear(sx, sy, opts) {
    if (document.getElementById('offer-modal')) return;
    const { entry, title, kind = 'shop', kindLabel, art } = opts;
    const offer = Macros.sundriesGear(this.save, entry);
    if (!offer) { this.flash('You carry the finest.', sx, sy); return; }
    const isItem = offer.kind === 'item';
    const name = isItem ? itemName(offer.id) : gearName(offer.kind, offer.slot, offer.tier);
    const icon = isItem ? this.iconSpanHTML(offer.id) : this.gearIconHTML(offer.kind, offer.slot, offer.tier, 24);
    const blurb = (isItem ? '' : (gearDef(offer.kind, offer.slot)?.blurb || ''))
      + `<div style="margin-top:6px">${tierBadgeHTML(offer.tier)}</div>`;
    this.showOfferModal({
      kind, kindLabel, art, title,
      get: `${icon} ${name}`,
      blurb,
      cost: this.moneyHTML(offer.price),
      canAfford: (this.save.money ?? 0) >= offer.price,
      disabledReason: isItem ? this._shopBagSpaceReason(offer.id, 1) : '',
      acceptLabel: 'Buy',
      cancelLabel: 'Leave',
      onAccept: () => {
        // The bag or the slot may have changed since the counter opened.
        const now = Macros.sundriesGear(this.save, entry);
        if (!now || now.kind !== offer.kind || now.slot !== offer.slot || now.id !== offer.id || now.tier !== offer.tier) {
          this.flash('Already carry a finer one.', sx, sy); return;
        }
        if (isItem && this.invRoomFor(offer.id) < 1) { this.flash(bagFullFor(offer.id), sx, sy); return; }
        if (!this._spendMoney(offer.price, sx, sy)) return;
        const { price, ...reward } = offer;
        Rewards.apply(this.save, reward, this, { notWild: true, deferRefresh: true });
        this.markRelicsDirty();
        this._settleDeal(null, [`${name}\n−${offer.price}`, UI_GOLD, 1.25]);
        this.updateHUD();
      },
    });
  }


  shopInteract(sx, sy, house) {
    // Single-modal guard: if a confirmation modal is already open, ignore the tap so
    // rapid double-taps can't stack two modals or stale closures.
    if (document.getElementById('offer-modal') || document.getElementById('slots-modal')) return;
    // Wreck → restoration modal (the player picks what it becomes —
    // Houses.BUILD_OPTIONS). Every tier-9 small house starts as a wreck (see
    // save.restoredHouses); the trailer is exempt and forts / castles never
    // wreck. Every pick costs the same stone (Houses.wreckRestoreCost).
    if (house && this._isHouseWreck && this._isHouseWreck(house)) {
      this.presentWreckRestoreModal(sx, sy, house);
      return;
    }
    // Fort → sealed until unsealed with a one-time wood payment, just like a
    // wreck house pays masonry. Pay FORT_UNLOCK_WOOD and the quartermaster
    // opens for good (recorded in save.unlockedForts).
    if (house && this._isFortLocked && this._isFortLocked(house)) {
      this.presentFortUnlockModal(sx, sy, house);
      return;
    }
    // Castle → sealed until the player solves the job on its quest board
    // (_isBuildingSealed); the sealed modal IS that board.
    if (house && this._isBuildingSealed && this._isBuildingSealed(house)) {
      this.presentSealedBuildingModal(sx, sy, house);
      return;
    }
    // House routing:
    //   HOME (starter trailer)  → the Home panel: a SELL page and a CRAFT
    //                              page (presentHomeSell / presentHomeCraft).
    //                              A tap holding a stack opens on Sell, an
    //                              empty-handed tap on Craft.
    //   Every other house       → only its PRIMARY interaction (buy /
    //                              trade / smith / relic). Selling
    //                              anywhere but home is intentionally
    //                              gated so the player has a reason to
    //                              come home with their haul.
    const isHome = !!house && this.isStarterShop(house);
    const sel = this.save.inv[this.save.selSlot];
    const hasSel = sel && sel.id && (sel.count ?? 0) > 0;
    if (isHome) {
      if (hasSel) this.presentHomeSell(sx, sy);
      else this.presentHomeCraft(sx, sy);
      return;
    }
    // A FORT runs a slot machine (presentFortSlots) — before the deal cap and
    // the flower charm: every spin is paid at its fair price, so there is
    // nothing to ration and nothing a charm could discount.
    if (house && house.tier === 11) {
      this.presentFortSlots(sx, sy, house);
      return;
    }
    const castle = isCastle(house);
    const isStarterSmith = this.isStarterBlacksmith(house);
    // The role the player picked at the wreck, frozen in the ledger (falls
    // back to the address-derived type for legacy saves). Returns
    // 'blacksmith' for the starter smithy too, so the forge branch fires.
    const shopType = this.houseShopRole(house);
    if (shopType === 'wizard' && MemoryStory.towerAccess(this.save, house) !== 'open') {
      MemoryStory.visitWizard(this, () => {}, house);
      return;
    }
    // A TURRET trades nothing: its archer is the castle turret lane
    // (app.js _turretFire) and a tap only says so.
    if (shopType === 'turret') {
      this.showMessageModal({ kind: 'build', title: 'Turret',
        body: 'An archer leans over the battlement and nods. Anything hostile that comes within bowshot of these walls is their business.' });
      return;
    }
    const isFort = !!house && house.tier === 11;
    // A delivery host (plain house, no shop role) takes ONE delivery ever
    // (Delivery.isSatisfied), and render.js shows its wishlist over the roof.
    const isDeliveryHost = !castle && !isFort && !shopType && !isStarterSmith && !!house;
    // There is no per-hour deal cap (shops_math.js header). A deal is still
    // RECORDED against the house — it settles the shop: the shelf turns over
    // (the deal count is in shopRng's seed), the re-roll ladder drops back to
    // its base rung, and the trader's cooldown starts — called from inside
    // every accept path.
    const recordDeal = () => { ShopsMath.recordDeal(this.save, house); };
    // THE ONE CLOCK ON A DOOR: a role with a row in ShopsMath.DEAL_COOLDOWN_MS
    // (the trader) rests briefly after a closed deal. The wait is printed in
    // the shared notation, same number the peddler speaks (npc.js interact).
    // A role with no row never reaches the flash.
    const dealWait = house ? ShopsMath.dealWaitMs(this.save, house, shopType) : 0;
    if (dealWait > 0) {
      this.flash(`${shopType} busy — back in ${shortDuration(dealWait)}`, sx, sy);
      return;
    }
    // FLOWER GIFT — tapping a CASH shop (market / fort storefront / castle
    // vault) with Flowers selected offers to charm the keeper: one bouquet
    // buys half prices at THIS building for SHOP_CHARM_MS. Only cash shops —
    // a bouquet at a barter trader / wizard / delivery house would buy
    // nothing, so those never offer to take one. Checked after the cooldown
    // gate so a bouquet can't be spent on a shut door, and skipped while a charm
    // is already running so repeat taps don't burn the stack. A RESTORED
    // castle is excluded too — it sells nothing to discount, only
    // the daily rest/tax favour (see presentCastleServiceOffer).
    if (house && house.id != null && sel && sel.id === 'flowers' && (sel.count ?? 0) > 0
        && ((castle && !this.isCastleClaimed(house)) || shopType === 'market')
        && this.shopCharmMul(house) === 1) {
      this.showOfferModal({
        kind: 'shop',
        title: 'Charm the shopkeeper?',
        get: 'A bouquet may soften the shopkeeper’s prices.',
        cost: `1× ${this.iconSpanHTML('flowers')} Flowers`,
        canAfford: true,
        acceptLabel: 'Gift',
        onAccept: () => {
          if (Inventory.remove(this.save, 'flowers', 1) < 1) {
            this.flash('Gone — already used.', sx, sy);
            return;
          }
          this._clampSelSlot();
          this.save.shopCharm = this.save.shopCharm || {};
          // Prune spent charms while we're here so the map can't grow without
          // bound across many gifts.
          for (const k of Object.keys(this.save.shopCharm)) {
            if (this.save.shopCharm[k] <= Date.now()) delete this.save.shopCharm[k];
          }
          this.save.shopCharm[house.id] = Date.now() + SHOP_CHARM_MS;
          this._settleDeal(null, ['💐 charmed — half prices!', '#ff8aff', 1.2, 'flowers']);
          // Straight back into the shop so the discounted offer is in hand.
          this.shopInteract(sx, sy, house);
        },
      });
      return;
    }
    // THE RENOVATION PERMIT (Houses.PERMIT_ID) in hand at a ranked building:
    // the masons offer to raise it one rank (Houses.renovateTo decides
    // whether that rank is open — the memory ladder, the line's own cap),
    // and the permit is spent with the work. A refused permit says why on
    // the map and the tap falls through to the shop as usual.
    if (house && house.id != null && sel && sel.id === Houses.PERMIT_ID && (sel.count ?? 0) > 0 && shopType && shopType !== 'turret' && !castle) {
      const to = Houses.renovateTo(this.save, house);
      if (to.tier) {
        const label = Shops.roleLabel(shopType, shopType === 'market' ? this.marketTheme(house).theme : null) || 'shop';
        this.showOfferModal({
          kind: 'build',
          title: 'Renovate the building?',
          get: `Masons raise the ${label.toLowerCase()} a rank: ${tierBadgeHTML(to.tier, 11)}`,
          cost: `1× ${this.iconSpanHTML(Houses.PERMIT_ID)} ${ITEM_BY_ID[Houses.PERMIT_ID]?.name || 'Renovation Permit'}`,
          canAfford: true,
          acceptLabel: 'Renovate',
          cancelLabel: 'Later',
          onAccept: () => {
            if (Inventory.remove(this.save, Houses.PERMIT_ID, 1) < 1) {
              this.flash('Gone — already used.', sx, sy);
              return;
            }
            this._clampSelSlot();
            const tier = Houses.renovate(this.save, house);
            this._finishInventoryChange();
            if (tier) this.flashLoot(`🏗️ renovated — ${TIER_BADGE_NAMES[tier]}!`, UI_GOLD, 1.2, Houses.PERMIT_ID);
            // Straight back into the shop so the new shelf is in hand.
            this.shopInteract(sx, sy, house);
          },
        });
        return;
      }
      if (to.why === 'memories') this.flash(`Needs ${to.need} memories`, sx, sy);
      else if (to.why === 'line') this.flash('This line goes no higher', sx, sy);
      else if (to.why === 'top') this.flash('Already the top rank', sx, sy);
    }
    // Plain houses — small residential without a shop role and not the
    // starter blacksmith — are delivery sites only. Each wants a SET of 1-3
    // produce and buys it as a bundle: one of each, full price, no sword
    // sellMul. They don't sell anything. Their
    // sign shows the wanted icons so the player can scout a street and gather
    // the matching set.
    if (isDeliveryHost) {
      this.presentDeliveryOffer(sx, sy, house, recordDeal);
      return;
    }
    // Selling is HOME-ONLY (handled above). Every other house runs straight
    // into its primary interaction below — selected-item taps no longer
    // open a sell modal here. The player has to bring the haul back to
    // their trailer to cash out.
    // BUY — generate an offer and present a confirmation modal.
    // Special tracks come BEFORE the regular seed/produce rotation:
    //   (a) Claimed castle — the castellan's favour (presentCastleServiceOffer).
    //   (b) Blacksmith     — forges relics from bars (presentBlacksmithOffer).
    //   (c) Regular house  — 10% chance to swap the normal offer for a relic.
    // (Home / starter trailer is handled at the top of this function — it
    // only sells, never buys.)
    if (castle) {
      // The seal above admits claimed castles, whose castellan offers a daily favour.
      this.presentCastleServiceOffer(sx, sy, house);
      return;
    }
    if (shopType === 'blacksmith') {
      // Starter blacksmith: forge the two random wooden tools (see
      // starterSmithSlots) one at a time before falling through to the
      // random-relic forge. Custom recipe (not bar-based) so blacksmithRecipe
      // stays T2+ for every other smithy.
      if (isStarterSmith) {
        const woodOffer = this.starterBlacksmithOffer();
        if (woodOffer) {
          const recipe = this.starterBlacksmithRecipe(woodOffer.slot);
          this.presentBlacksmithOffer(sx, sy, woodOffer, recordDeal, house, { recipe, noReroll: true });
          return;
        }
      }
      const offer = this.peekOrBuildRelicOffer(house);
      if (offer) { this.presentBlacksmithOffer(sx, sy, offer, recordDeal, house); return; }
      // No offer means no piece left above what the player wears (Gear
      // buildRelicOffer) — the anvil never "rests" on the clock, so there is
      // no wait to name: waiting would not change the answer.
      this.flash('Nothing left to forge.', sx, sy);
      return;
    }
    // Traders are barter-only with their own seeded offer (qty scales to a
    // target value) and a re-roll secondary — fully self-contained branch.
    if (shopType === 'trader') {
      this.presentTraderOffer(sx, sy, house, recordDeal);
      return;
    }
    // Wizard tower (the first story tower). The
    // mage sees power in the player's memories and spends them on his gifts.
    // See presentWizardOffer.
    if (shopType === 'wizard') {
      MemoryStory.visitWizard(this, () => {
        this.presentWizardOffer(sx, sy, recordDeal);
      }, house);
      return;
    }
    // THEMED SHOPS (role key 'market') sell one line each — seed, supply,
    // potion, ore, relic or pet, by restore order — see presentThemedShop.
    if (shopType === 'market') {
      this.presentThemedShop(sx, sy, house, recordDeal);
      return;
    }
    // SEEDED, not Math.random: this coin decides WHAT the shop is selling, so
    // an unseeded flip let the player reopen a fort until it came up relic.
    // Its own lane, so it can't consume a roll the offer itself needs.
    // (house is always a real object from the tap dispatch, but everything
    // around here is written null-tolerant, so keep the unseeded fallback.)
    const swapRoll = house?.id ? this.shopRng(house, 'relicswap')() : Math.random();
    if (!shopType && swapRoll < 0.10) {
      const relicOffer = this.peekOrBuildRelicOffer(house);
      if (relicOffer) { this.presentRelicOffer(sx, sy, relicOffer, recordDeal, house, false); return; }
    }
    // Each remaining storefront (a fort's quartermaster) has a deterministic
    // "shop kind" derived from the house (_houseSeed — its id, never its
    // frame metres): ~30% sell PRODUCE (harvested crops), the rest sell SEEDS
    // from the rotating buyIndex. Same house always offers the same category,
    // for every player.
    const houseSeed = this._houseSeed(house);
    const sellsProduce = !!houseSeed && ((houseSeed * 2654435761) >>> 0) % 10 < 3;
    let id;
    if (sellsProduce) {
      // Cycle through produce, weighted toward the buyIndex so it still rotates.
      const produceIds = Object.keys(CROP_ROW);
      id = produceIds[((this.save.buyIndex ?? 0) + (houseSeed >>> 8)) % produceIds.length];
    } else {
      id = BUY_LIST[(this.save.buyIndex ?? 0) % BUY_LIST.length];
    }
    const baseValue = itemValue(id);
    const item = ITEM_BY_ID[id];
    // Every cash storefront (markets + generic houses) buys for money now;
    // barter lives only in the dedicated 'trader' shop kind (presentTraderOffer
    // above). buildShopOffer always returns a cash offer.
    const offer = this.buildShopOffer(id, baseValue, { house });
    if (!offer) {
      this.flash('Nothing on the shelf.', sx, sy);
      return;
    }
    // Cash purchases hand over exactly ONE unit — the ×2 TRADE_OFFER_QTY
    // bundle is barter-only (see presentTraderOffer) so cash buys can't be
    // flipped at a profit. Low-tier seeds still ship a few extra (planted in
    // bulk; a starter nicety, not an arbitrage vector at $3 a pack).
    const buyQty = 1 + (isLowTierSeed(id) ? LOW_TIER_SEED_QTY_BONUS : 0);
    this.showOfferModal({
      kind: 'shop',
      title: this.buildingFlavorTitle(house, 'buy'),
      ...NPC.offerArt(this, house),
      cancelLabel: 'Later',
      get: `${this.iconSpanHTML(id)} ${item?.name || id} ×${buyQty}`,
      cost: offer.label,
      canAfford: offer.canAfford(),
      disabledReason: this._shopBagSpaceReason(id, buyQty),
      onAccept: () => {
        if (!offer.canAfford()) { this.flash(offer.shortDenial, sx, sy); return; }
        if (this.invRoomFor(id) < buyQty) { this.flash(bagFullFor(id), sx, sy); return; }
        offer.consume();
        this.addToInv(id, buyQty, false, { notWild: true, deferRefresh: true });
        this.save.buyIndex = (this.save.buyIndex ?? 0) + 1;
        // The loud loot pop, so a purchase reads as a real gain; the sprite
        // shows the bought item.
        this._settleDeal(recordDeal, [`${buyQty}× ${item?.name || id}\n${offer.shortGain}`, UI_GOLD, 1, id]);
      },
    });
  }

  // The "starter shop" is the building closest to the player's spawn — the
  // player's Home. Tap it to sell from your stash; the starter blacksmith
  // (nearest house to Home) handles wooden-tool crafting. Pick it once and
  // memoize in save.starterShopId so reloads + roaming keep the same shop.
  isStarterShop(house) {
    if (!house || !house.id) return false;
    this.ensureStarterShopId();
    return this.save.starterShopId === house.id;
  }

  // Resolve (and self-heal) save.starterShopId: the player's Home. Home is the
  // house nearest the player's ACTUAL location — their first GPS fix — NOT the
  // fixed map origin (startWorldM, anchored at START_LAT/LON): a player who
  // starts far from START_LAT would get a trailer off-screen near the origin.
  //
  // Once a GPS fix is in, the rule is "what you can see is home":
  //   • if any house is visible ON-SCREEN, adopt the nearest one as the trailer;
  //   • if NO house is on-screen, synthesize a trailer under the player.
  // "On-screen" = within the VIEW_CELLS-square map viewport centred on the
  // player (HALF_VIEW_M each way). This replaces an earlier fixed-metres radius:
  // tying it to the viewport means the player always either sees the house that
  // became their trailer, or gets one dropped on themselves — never a Home left
  // sitting off-screen that they can't find. Tiles stream in asynchronously, so
  // before concluding "nothing on-screen" we wait for every tile the viewport
  // overlaps to be ready (the viewport is far smaller than a tile, so that's the
  // player's own tile, plus its neighbours when they sit near a tile edge — all
  // kept loaded by the 3×3 ensureTilesAround). A previously chosen home that is
  // still loaded is kept so the trailer is stable across roaming and reloads
  // (even once it scrolls off-screen), while a stale origin-anchored memo (whose
  // tile never loads near the new spawn) self-heals. Cheap after it locks in via
  // the _starterShopOk early-out; called lazily (isStarterShop) and every frame
  // from Render.drawObjects.
  ensureStarterShopId() {
    if (this._starterShopOk) return;
    // A fresh save is still waiting to anchor its home origin to the first GPS
    // fix (startGps reloads once it arrives) — don't place the trailer yet, it
    // would be positioned against the provisional origin we're about to drop.
    if (this._homeCapturePending) return;
    // A synthetic trailer from a prior session — restore it and lock in.
    if (this.save.starterTrailer && this.save.starterShopId === this.save.starterTrailer.id) {
      this.ensureStarterTrailerObject();
      this._starterShopOk = true;
      // ensureStarterTrailerObject can self-heal onto a real house that has
      // since appeared on the trailer's own footing (its own comment above
      // explains why) — save.starterTrailer is then null and starterShopId
      // already names the adopted house, so don't re-freeze the crate anchor
      // at the trailer's old, no-longer-Home position.
      if (this.save.starterTrailer) {
        // Heal a save whose home capture failed (no save.home): anchor the
        // starter crate trail on Home, where the player actually is — the
        // origin-keyed anchor would sit on a tile that never loads.
        this._setStarterCratesAt(this.save.starterTrailer.x, this.save.starterTrailer.y);
      }
      return;
    }
    // Anchor on the player's real position: their GPS fix (gpsM, in playerM's
    // frame). A sandbox session may have no fix at all — fall back to the
    // player's current position so Home still resolves.
    const anchor = this.gpsM || (this._sandboxMode ? this.playerM : null);
    if (!anchor) return;                       // no fix yet — wait for one
    const ax = this.startWorldM.x + anchor.x;
    const ay = this.startWorldM.y + anchor.y;
    // "On-screen" = within the visible map viewport (a VIEW_CELLS square centred
    // on the player). Half-extent each way, in world metres.
    const HALF_VIEW_M = (VIEW_CELLS / 2) * this.cellM;
    const cur = this.save.starterShopId;
    let nearestId = null, nearestD2 = Infinity, curFound = false;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'house' || !o.id) continue;
        if (o.id === cur) curFound = true;       // track the current Home anywhere (roaming)
        const dx = o.x - ax, dy = o.y - ay;
        // Only houses inside the viewport count toward "the nearest visible one".
        if (Math.abs(dx) > HALF_VIEW_M || Math.abs(dy) > HALF_VIEW_M) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) { nearestD2 = d2; nearestId = o.id; }
      }
    }
    // An existing home that is still loaded → keep it (stable across roaming,
    // even once it scrolls off-screen). A stale far memo simply isn't loaded near
    // the new spawn, so curFound is false and we re-resolve below.
    // _setStarterCratesAt on each lock-in below is the no-home heal: it
    // no-ops for anchored saves, and freezes the crate trail at the player's
    // real position for a save whose home capture failed (see
    // _starterTrailAnchor).
    if (cur != null && curFound) {
      this._starterShopOk = true;
      this._setStarterCratesAt(ax, ay);
      return;
    }
    // A house is visible on-screen → adopt the nearest one as the trailer.
    if (nearestId != null) {
      this.save.starterShopId = nearestId;
      this.save.starterTrailer = null;         // drop any prior synthetic trailer
      this._starterShopOk = true;
      this._setStarterCratesAt(ax, ay);
      return;
    }
    // No house on-screen. Don't synthesize until every tile the viewport overlaps
    // is ready — otherwise we might be staring at a half-streamed map and would
    // drop a trailer on top of a house that simply hadn't arrived. The viewport
    // is tiny next to a tile, so this is the player's own tile, plus its
    // neighbours when they sit near a tile edge (all kept loaded by
    // ensureTilesAround). Check the four viewport corners.
    const tileReadyAt = (offMx, offMy) => {
      const { tx, ty } = localMetersToTile(this, anchor.x + offMx, anchor.y + offMy);
      const t = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      return t && (!t.status || t.status === 'ready');
    };
    for (const ox of [-HALF_VIEW_M, HALF_VIEW_M])
      for (const oy of [-HALF_VIEW_M, HALF_VIEW_M])
        if (!tileReadyAt(ox, oy)) return;        // a viewport tile is still streaming — wait
    // Drop a trailer under the player.
    this._makeStarterTrailer(ax, ay);
    this._starterShopOk = true;
    this._setStarterCratesAt(ax, ay);
  }


  // The line and tier a themed shop (role key 'market') sells: its place in
  // the save's restore order of shops, through Shops.themeAt — seed, supply,
  // potion, ore, relic, then round again a tier up (the Book and Pet lines
  // are one-off stamps, Shops.SOLO_LINES). The tutorial's market
  // (Houses.BUILD_OPTIONS, from the third rebuild) is the first shop, so it is still the
  // beginner's T1 seed shop. The sign, the offer title, the restoration card
  // and the stock all read this one answer.
  marketTheme(house) {
    if (house?.kind === 'npc') return { theme: house.shopTheme, tier: 1 };
    return Shops.lineFor(this.save, house);
  }

  // Every restored delivery house currently asking for a bundle (not satisfied
  // today), nearest first, with its wanted produce + distance in metres. Drives
  // the delivery menu (openDeliveryMenu). Home / forts / castles / wrecks are
  // excluded — only plain residential delivery houses appear.
  knownDeliveryHouses() {
    const { x: pWX, y: pWY } = playerWorldM(this);
    const out = [];
    const seen = new Set();
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'house' || !o.id || seen.has(o.id)) continue;
        if (o.tier === 11 || o.tier === 12) continue;             // forts / civic slabs
        if (this.houseShopRole(o) !== null) continue;             // only plain (no shop role)
        if (this._isHouseWreck && this._isHouseWreck(o)) continue; // still a wreck
        if (this.isStarterShop(o)) continue;                      // home sells, doesn't ask
        if (this.isHouseSatisfied(o)) continue;                   // fed once, happy for good
        const wanted = this.wantedProduce(o);
        if (!wanted.length) continue;
        seen.add(o.id);
        const dx = o.x - pWX, dy = o.y - pWY;
        out.push({ id: o.id, x: o.x, y: o.y, wanted, dist: Math.hypot(dx, dy) });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  // Delivery list overlay: tap a row to aim the white waypoint arrow at that
  // house. Opened from the ☰ menu's "Deliveries" button (wired in index.html).
  openDeliveryMenu() {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('delivery-menu',
      { textAlign: 'left', onClose: () => {}, kind: 'delivery' });
    // No title line — the kind header already says DELIVERY.
    const houses = this.knownDeliveryHouses();
    if (!houses.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:.7;text-align:center;padding:10px 4px;font:12px ui-monospace,monospace;';
      empty.textContent = 'No delivery requests nearby. Restore a house to start.';
      box.appendChild(empty);
    } else {
      // One row per house: a ghost button (modal_shell mkBtn — the one
      // factory) laid out as a two-line row, its label the HTML below.
      const rowCss = 'display:flex;align-items:center;gap:8px;width:100%;margin:3px 0;padding:8px;'
        + 'background:#222a;color:#fff;font:12px ui-monospace,monospace;text-align:left;';
      for (const h of houses) {
        // Icons alone told you nothing: three unlabelled sprites and a
        // distance, so you couldn't tell what a run needed, what it paid, or
        // which of five rows you could actually complete. Name every item,
        // show how many of each you're carrying against the one needed, and
        // price the set.
        const icons = h.wanted.map(id => this.iconSpanHTML(id)).join(' ');
        const names = h.wanted.map(id => itemName(id)).join(' + ');
        const have = h.wanted.map(id => Inventory.count(this.save, id));
        const ready = have.every(n => n >= 1);
        // Say what's MISSING rather than printing a have/need ratio per item —
        // "5/1 Coal 5/1 Wood" parses as arithmetic, not as an answer to "can I
        // do this run?".
        const missing = h.wanted
          .filter((id, i) => have[i] < 1)
          .map(id => itemName(id));
        const stock = missing.length ? `need ${missing.join(', ')}` : '✓ you have everything';
        const setPrice = Math.max(1, Math.round(
          h.wanted.reduce((sum, id) => sum + Math.max(1, itemValue(id)), 0) * DELIVERY_BONUS_MULT));
        const row = mkBtn(
          `<span style="flex:1;min-width:0;">`
          + `<span style="display:flex;align-items:center;gap:4px;">${icons}`
          + `<b style="font-weight:700;">${names}</b></span>`
          + `<span style="display:block;font-size:11px;margin-top:2px;`
          + `color:${ready ? 'var(--green)' : '#ddd'};opacity:${ready ? '1' : '.75'};">`
          + `${stock}</span></span>`
          + `<span style="white-space:nowrap;text-align:right;">`
          + `<b style="color:var(--gold);">${this.moneyHTML(`+${setPrice}`)}</b><br>`
          + `<span style="opacity:.7;font-size:11px;">${Math.round(h.dist)}m ›</span></span>`,
          { variant: 'ghost', css: rowCss });
        // A row you can complete right now reads as ready.
        if (ready) row.style.borderColor = '#4a8c4a';
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          // Point the white waypoint arrow at this house (cleared automatically
          // once the player reaches it or it's satisfied — see the update loop).
          this.deliveryCompass = { id: h.id, x: h.x, y: h.y };
          wrap.remove();
          this.flashAtPlayer('following the white arrow');
        });
        box.appendChild(row);
      }
    }
    // Every other modal ends in a button; this one was backdrop-tap only, on a
    // box that fills most of the width.
    const close = mkBtn('Close');
    close.style.marginTop = '10px';
    close.style.width = '100%';
    close.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(close);
    mount();
  }

  // Pick the starter pair once; repeat visits and reloads keep the same tools.
  starterSmithSlots() {
    if (!Array.isArray(this.save.starterSmithSlots) || this.save.starterSmithSlots.length !== 2) {
      const pool = shuffleInPlace([...STARTER_SMITH_SLOTS]);
      this.save.starterSmithSlots = [pool[0], pool[1]];
      persistSave(this.save);
    }
    return this.save.starterSmithSlots;
  }

  starterBlacksmithRecipe(slot) {
    if (STARTER_SMITH_SLOTS.includes(slot)) {
      return [{ id: 'wood', qty: 5 }];
    }
    return null;
  }

  // Next of the two random wooden tools the player still needs. Returns null
  // once both are owned so the caller falls through to the normal random-relic
  // forge — the smithy keeps doing useful business after the starter pair.
  starterBlacksmithOffer() {
    for (const slot of this.starterSmithSlots()) {
      if (!(this.save.relics?.[slot]?.tier)) {
        return { kind: 'relic', slot, tier: 1 };
      }
    }
    return null;
  }

  // ─── Deliveries: plain houses only buy specific produce ──────────────
  // UTC day stamp ("YYYYMMDD") — the ONE day key every day-gated thing on the
  // scene reads (delivery wishlists + happy state, the coin-burst POI cap), so
  // every "back in <wait>" counts down to the same rollover (msToNextUtcDay).
  // The castle favour is NOT day-gated: it runs on its own twelve-hour clock
  // (Houses.CASTLE_SERVICE_MS).
  // Delivery wishlist logic lives in delivery.js (headlessly tested). These stay
  // as scene methods because render.js + the interact/present handlers call them
  // as scene.wantedProduce(o) / scene.isHouseSatisfied(o) / etc. The day key
  // itself is utcDayKey(), asked directly.

  // 1-3 produce ids this plain house wants — locked to its FIRST ask for the
  // life of the house (pinned in save.houseWishlists by delivery.js, cached on
  // the house so the render sign and interact handler agree). The first
  // restored houses walk delivery.js's scripted ladder, which opens with five
  // single-item asks before any bundle.
  wantedProduce(house) {
    return Delivery.wantedProduce(this.save, house);
  }

  // True once this house has had a bundle delivered — it is happy for good.
  isHouseSatisfied(house) {
    return Delivery.isSatisfied(this.save, house);
  }

  // Each household requests one of each listed item, delivered together once.
  // Recheck the complete order before removing anything from the live bags.
  presentDeliveryOffer(sx, sy, house, recordDeal) {
    // Already fed — one delivery per house, ever. The household stays happy
    // (and its callout stays a smiling face) for good.
    if (this.isHouseSatisfied(house)) {
      this.flash('A happy household.', sx, sy);
      return;
    }
    const wanted = this.wantedProduce(house);
    if (!wanted.length) { this.flash('Nobody home.', sx, sy); return; }
    const invCount = (id) => Inventory.count(this.save, id);
    const hasOrder = () => wanted.every(id => invCount(id) >= 1);
    if (!hasOrder()) {
      // Only what is still missing — not the whole list (Delivery.missingLine).
      const { line } = Delivery.missingLine(wanted, invCount, id => itemName(id));
      this.flash(line, sx, sy);
      return;
    }
    // Price of one complete set = sum of each wanted item's full price, plus a
    // delivery premium (DELIVERY_BONUS_MULT) so delivering the set beats selling
    // the items individually. Drives both the modal display and the payout.
    const setPrice = Math.max(1, Math.round(
      wanted.reduce((sum, id) => sum + Math.max(1, itemValue(id)), 0) * DELIVERY_BONUS_MULT));
    // Keep each icon beside its name and requested count, including bundles.
    const requested = wanted.map(id =>
      `<div style="display:flex;align-items:center;gap:8px;text-align:left;">` +
      `${this.iconSpanHTML(id)}<span style="flex:1;min-width:0">${itemName(id)}</span>` +
      `<span style="flex:none">×1</span></div>`).join('');
    this.showOfferModal({
      kind: 'delivery',
      getLabel: 'Reward',
      costLabel: 'Requested',
      cancelLabel: 'Later',
      get: this.moneyHTML(`+${setPrice}`),
      cost: `<div style="display:grid;gap:6px;font-size:13px;">${requested}</div>`,
      canAfford: true,
      acceptLabel: 'Deliver',
      onAccept: () => {
        // A stale or repeated accept must not pay for an incomplete order.
        if (this.isHouseSatisfied(house)) return;
        if (!hasOrder()) {
          const { line } = Delivery.missingLine(wanted, invCount, id => itemName(id));
          this.flash(line, sx, sy);
          return;
        }
        for (const id of wanted) Inventory.remove(this.save, id, 1);
        this._clampSelSlot();
        const gain = setPrice;
        addMoney(this.save, gain);
        // Lifetime delivery tally — each completed SET counts as one delivery.
        // Gates the castle vault and ramps the delivery produce tier (see
        // delivery.js / shopGateInfo). The FIRST delivery ever is also a
        // story moment, so catch the tally before it moves off zero.
        const wasFirstDelivery = (this.save.deliveryCount ?? 0) === 0;
        this.save.deliveryCount = (this.save.deliveryCount ?? 0) + 1;
        // One household served — a castle job may be counting them.
        this.questEvent('deliver');
        // The FIRST delivery to this household is a discovery: one memory
        // per house, ever, through the same ledger a shiny find uses
        // (keyed `house:<id>` so a house can't collide with an item id).
        const firstHere = this._bankDiscovery(`house:${house.id}`,
          'a first delivery to a new household');
        // That ledger key IS the household's "fed" record (Delivery.isSatisfied
        // reads it): it stops asking and shows a smiling face for good.
        this._settleDeal(recordDeal, [`+${gain}`, UI_GOLD, 1, wanted[0]]);
        // A new door gets the same fanfare as any other memory — the
        // shiny-find banner + burst, not a bare flash — so every "first time"
        // moment in the game reads the same way (see the elite-kill call site).
        if (firstHere) this.flashShiny(gain, true, '🏠 NEW DOOR 🏠');
        if (wasFirstDelivery) {
          this._storySplashOnce('delivery', {
            art: 'delivery_first',
            title: 'First delivery',
            body: "The basket leaves your palms, and green coins take its place. Tears of relief well in your neighbour's eyes.",
          });
        }
      },
    });
  }

  // An offer is never persisted: it is re-derived from the shop's seeded
  // stream, so it "stays on display" until the player buys it, re-rolls it,
  // or the hour bucket turns.
  //
  // ─── Shop clock helpers ──────────────────────────────────────────
  // Shop hour-bucket scheduling + the seeded per-bucket RNG live in
  // shops_math.js (ShopsMath.*); these stay as scene methods because the
  // present* handlers call them as this.shopX(…). Nothing here answers "is
  // the shop open": the bucket only rotates the offer and eases the re-roll
  // ladder (ShopsMath.bucketState); the trader's short cooldown is asked of
  // ShopsMath.dealWaitMs at the two dispatchers, not here.
  // Flower charm multiplier — see Houses.shopCharmMul (the gift branch asks
  // it alone, so a charm is never bought twice).
  shopCharmMul(house) { return Houses.shopCharmMul(this.save, house); }
  // What every price here multiplies by: the charm's hour times the Magic
  // Hammer's standing cut on a shiny building — see Houses.priceMul.
  priceMul(house) { return Houses.priceMul(this.save, house); }
  // A price or material count after the carried guild badge for this place's
  // guild (items.js guildDiscounted, Houses.guildRole) — every deal a shop,
  // smithy or trader quotes passes through here once.
  guildPrice(house, n) { return guildDiscounted(this.save, Houses.guildRole(this.save, house), n); }
  shopBucketState(house) {
    return ShopsMath.bucketState(this.save, house);
  }
  // The stream turns over with each deal this bucket — a purchase takes the
  // offer with it (ShopsMath.rng, recordDeal).
  shopRng(house, lane = '') {
    return ShopsMath.rng(this.save, house, lane, Date.now());
  }

  // Build a relic/armor offer for a specific house, derived purely from the
  // seeded RNG so the same shop in the same bucket always shows the same
  // offer — no need to persist the offer object. Re-roll bumps cur.rerolls
  // which pivots the seed lane; a purchase pivots it too (cur.deals).
  // opts.maxTier caps the roll at a themed relic shop's tier (Gear.buildRelicOffer).
  // A smithy also hands over its tier (Shops.smithTier): the anvil forges
  // within one rank of it and leans to its own (Gear.relicOfferWeights).
  peekOrBuildRelicOffer(house, opts = {}) {
    const castle = isCastle(house);
    const isBlacksmith = !castle && this.houseShopRole(house) === 'blacksmith';
    const smithTier = isBlacksmith ? Shops.smithTier(this.save, house) : undefined;
    if (!house?.id) return this.buildRelicOffer(Math.random, { isCastle: castle, isBlacksmith, smithTier, ...opts });
    const rng = this.shopRng(house, 'relic');
    return this.buildRelicOffer(rng, { isCastle: castle, isBlacksmith, smithTier, ...opts });
  }

  // Pick a random relic OR armor piece the player can actually use — meaning
  // their current slot is empty or holds a strictly lower tier. Returns null
  // if no upgrade is possible (caller falls through to the usual seed offer).
  // Tier is biased low so most offers are wood/copper; rare materials are rare.
  // `rng` defaults to Math.random — pass a seeded one for stable per-bucket offers.
  buildRelicOffer(rng = Math.random, opts = {}) {
    // Relic/armor offer roll lives in gear.js (Gear.buildRelicOffer) — armor +
    // relic pools normalised to ~50% airtime each, low-tier biased, castle vs
    // regular pricing. Kept as a scene method so peekOrBuildRelicOffer (which
    // threads the seeded shopRng) calls it the same way. Unique jewelry is not
    // gear and never enters this offer lane.
    return Gear.buildRelicOffer(this.save, rng, opts);
  }

  // THE "Re-roll" secondary button every shop shares: the relic stall, the
  // smithy, the themed shelf and the trader. All pivot the same seed lane
  // (curState.rerolls); `opts.cost` is the shop's ladder (ShopsMath
  // themedRerollCost / smithyRerollCost / traderRerollCost — one family),
  // `opts.peek` its next offer (the capped relic roll by default; the themed
  // shelf's next item; the trader's next barter) and `present` the method
  // that re-renders it. `opts.current` is what is on display: the draw goes
  // through ShopsMath.rerollPeek, which re-draws (for free) until it is
  // something else. The purse is checked BEFORE the peek, which climbs the
  // ladder, so a short purse never pays a rung.
  _makeRerollSecondary(house, sx, sy, emptyMsg, present, opts) {
    const curState = house?.id ? this.shopBucketState(house) : null;
    const rerollCost = opts.cost(curState?.rerolls || 0);
    const peek = opts.peek || (() => this.peekOrBuildRelicOffer(house));
    return {
      label: `Re-roll<br><span style="font-weight:400;font-size:10px;opacity:.85">${this.moneyHTML(rerollCost, 12)}</span>`,
      disabled: (this.save.money ?? 0) < rerollCost,
      onClick: () => {
        if ((this.save.money ?? 0) < rerollCost) { this.flash(purseShort(rerollCost), sx, sy); return; }
        const next = ShopsMath.rerollPeek(curState, peek, opts.current);
        if (!next) { this.flash(emptyMsg, sx, sy); return; }
        addMoney(this.save, -rerollCost);
        persistSave(this.save);
        present(next);
      },
    };
  }

  // A THEMED SHOP's visit: its own tier or a batch from one tier below,
  // seeded on the shop's hour like every offer, priced through buildShopOffer
  // (the 1.2–3.0× markup over PRICES, so a shop always asks above list), with a
  // re-roll that starts at $2 and grows ×1.5 (ShopsMath.themedRerollCost). The
  // relic line hands off to the relic offer — capped at the shop's tier, never
  // at or below what the player wears — with the same cheap re-roll.
  presentThemedShop(sx, sy, house, recordDeal) {
    const { theme, tier } = this.marketTheme(house);
    const cost = ShopsMath.themedRerollCost;
    if (theme === 'relic') {
      const peek = () => this.peekOrBuildRelicOffer(house, { maxTier: tier });
      const offer = peek();
      if (!offer) { this.flash('Nothing here beats your kit.', sx, sy); return; }
      this.presentRelicOffer(sx, sy, offer, recordDeal, house, true, { cost, peek });
      return;
    }
    const id = this.themedShopPick(house);
    if (!id) { this.flash('Nothing on the shelf.', sx, sy); return; }
    this._presentThemedItem(sx, sy, house, recordDeal, id);
  }

  // The item a themed shop is selling right now — its own seeded lane, so it
  // holds for the hour and a re-roll (which bumps the bucket's rerolls, part
  // of the seed) moves it on.
  themedShopPick(house) {
    const { theme, tier } = this.marketTheme(house);
    const rng = house?.id ? this.shopRng(house, 'theme') : Math.random;
    return Shops.pickThemed(theme, tier, rng);
  }

  // How many items this themed shop can stock — the list themedShopPick
  // draws from.
  _themedStockCount(house) {
    const { theme, tier } = this.marketTheme(house);
    return Shops.themedOfferStock(theme, tier).length;
  }

  // The rank badge under an offer — a shop's line tier, a smithy's, a
  // trader's (Shops.shopTier); nothing for a role with none.
  shopTierBadgeHTML(house) {
    const role = this.houseShopRole(house);
    const tier = role === 'market' ? this.marketTheme(house).tier : Shops.shopTier(this.save, house, role);
    if (tier == null) return '';
    return `<div style="margin-top:6px">${tierBadgeHTML(tier)}</div>`;
  }

  // Cash and capacity are separate requirements: a full bag must not paint
  // an affordable price red or silently disable the purchase.
  _shopBagSpaceReason(id, qty) {
    if (this.invRoomFor(id) >= qty) return '';
    const held = Inventory.count(this.save, id);
    const cap = Inventory.stackCapFor(this.save, id);
    return `Not enough bag space: holding ${held}/${cap}. This purchase needs room for ${qty}. Use or sell some, or equip a larger bag.`;
  }

  _presentThemedItem(sx, sy, house, recordDeal, id) {
    const item = ITEM_BY_ID[id];
    // The base is the ladder's (ShopsMath.listPrice — the Book climbs with
    // every one bought; everything else is its itemValue).
    const { tier } = this.marketTheme(house);
    const quantityRng = house?.id ? this.shopRng(house, 'theme-quantity') : Math.random;
    const units = Shops.themedQuantity(id, tier, quantityRng);
    const offer = this.buildShopOffer(id, units * ShopsMath.listPrice(this.save, id, itemValue(id)), { house });
    // Lower-tier batches buy multiple units; seed units retain their bonus.
    const buyQty = units * (1 + (isLowTierSeed(id) ? LOW_TIER_SEED_QTY_BONUS : 0));
    this.showOfferModal({
      kind: 'shop',
      title: this.buildingFlavorTitle(house, 'buy'),
      ...NPC.offerArt(this, house),
      cancelLabel: 'Later',
      get: `${this.iconSpanHTML(id)} ${item?.name || id} ×${buyQty}`,
      blurb: this.shopTierBadgeHTML(house),
      cost: offer.label,
      canAfford: offer.canAfford(),
      disabledReason: this._shopBagSpaceReason(id, buyQty),
      onAccept: () => {
        if (!offer.canAfford()) { this.flash(offer.shortDenial, sx, sy); return; }
        if (this.invRoomFor(id) < buyQty) { this.flash(bagFullFor(id), sx, sy); return; }
        offer.consume();
        this.addToInv(id, buyQty, false, { notWild: true, deferRefresh: true });
        if (id === 'book') ShopsMath.bookBought(this.save, buyQty);
        this._settleDeal(recordDeal, [`${buyQty}× ${item?.name || id}\n${offer.shortGain}`, UI_GOLD, 1, id]);
      },
      // Include lower-tier batch stock when deciding whether another item
      // is available to re-roll to.
      secondary: this._themedStockCount(house) > 1
        ? this._makeRerollSecondary(house, sx, sy, 'Shelves are bare for now.',
            (nextId) => this._presentThemedItem(sx, sy, house, recordDeal, nextId),
            { cost: ShopsMath.themedRerollCost, peek: () => this.themedShopPick(house), current: id })
        : undefined,
    });
  }

  // Present a relic/armor offer. Re-roll is only shown at castles — regular
  // houses + the starter shop hide it. The offer is derived from the bucket
  // seed via peekOrBuildRelicOffer, so no per-tap persistence is needed; the
  // re-roll button bumps cur.rerolls which pivots the seed lane.
  presentRelicOffer(sx, sy, offer, recordDeal, house, allowReroll = false, rerollOpts = {}) {
    const name = gearName(offer.kind, offer.slot, offer.tier);
    const iconHtml = this.gearIconHTML(offer.kind, offer.slot, offer.tier, 24);
    const blurb = (gearDef(offer.kind, offer.slot)?.blurb || '') + this.shopTierBadgeHTML(house);
    // The charm's hour and the hammer's standing cut (floor $1) — priceMul —
    // then a guild badge takes its share off (guildPrice).
    const price = this.guildPrice(house, Math.max(1, Math.ceil(offer.price * this.priceMul(house))));
    this.showOfferModal({
      kind: 'relics',
      title: this.buildingFlavorTitle(house, 'relic'),
      cancelLabel: 'Later',
      get: `${iconHtml} ${name}`,
      blurb,
      cost: this.moneyHTML(price),
      canAfford: (this.save.money ?? 0) >= price,
      acceptLabel: 'Buy',
      onAccept: () => {
        if (!this._gearUpgradeOk(offer, sx, sy)) return;
        if (!this._spendMoney(price, sx, sy)) return;
        this._equipGear(offer.kind, offer.slot, offer.tier);
        this.markRelicsDirty();
        this._settleDeal(recordDeal, [`${name}\n−${price}`, UI_GOLD, 1.25]);
      },
      // Pivot the seed lane so the next peekOrBuildRelicOffer returns
      // something else — no per-house cache to invalidate.
      secondary: allowReroll
        ? this._makeRerollSecondary(house, sx, sy, 'Stalls are empty for now.',
            next => this.presentRelicOffer(sx, sy, next, recordDeal, house, true, rerollOpts),
            { ...rerollOpts, current: offer })
        : undefined,
    });
  }

  // Blacksmith recipes (gear.js Gear.blacksmithRecipe): an array of
  // { id, qty } ingredient entries for forging the given (kind, slot, tier)
  // relic/armor. Recipe rules:
  //   • Tools / weapons / armor / utility — pay max(5, tier) of the
  //     tier-matched bar. The low tiers (T1 wood, T2 copper, T3 iron,
  //     T4 gold, T5 platinum) all cost 5; crimson (T6) / frost (T7) keep
  //     ramping to 6 / 7 so nothing high-tier got cheaper. T2..T4 bars are
  //     mined; T5..T7 bars (platinum / crimson / frost) are SMELTED from
  //     their flowers, so the flower bond is implicit through the bar req.
  //   • Jewelry slot (staff) - geometric gem cost
  //     (1, 2, 4, 8, 16 from T2..T6) of the slot-specific gem:
  //       staff -> emerald
  //     plus 1 of the tier-matched bar. Every T7 slot uses 32 diamonds.
  // (The starter shop's T1 wooden pick / axe / hoe use a separate cheap
  // bootstrap recipe — see starterBlacksmithRecipe — and don't pass here.)
  // Forge + smelt recipes live in gear.js and the present* shop modals call
  // Gear.blacksmithRecipe / Gear.smeltingRecipe / Gear.smeltUnlockedBars
  // directly — three scene methods that only forwarded are gone.

  // Smelt tab at the blacksmith. Focuses ONE unlocked top bar at a time, with a
  // repeatable Smelt button, consuming one recipe’s ingredients per tap. The
  // modal's ‹ › `pager` pages through the other unlocked bars, and a Forge /
  // Smelt tab row (forgeBack re-opens the forge tab) lets the player toggle
  // back without leaving the shop. `target` defaults to the highest unlocked
  // bar the player can currently afford, so the modal opens on something usable.
  presentSmeltOffer(sx, sy, house, recordDeal, forgeBack, target = null) {
    const bars = Gear.smeltUnlockedBars();
    const tabs = [
      { label: 'Forge', active: false, onSelect: forgeBack },
      { label: 'Smelt', active: true,  onSelect: () => {} },
    ];
    if (!bars.length) {
      this.showOfferModal({
        kind: 'forge',
        title: 'Nothing to smelt',
        cancelLabel: 'Leave',
        get: 'No ingredients yet',
        blurb: 'The crucible waits for something worth melting.',
        cost: '',
        canAfford: false,
        acceptLabel: 'Close',
        tabs,
        onAccept: () => {},
      });
      return;
    }
    // One bar's recipe, each count trimmed by a guild badge (guildPrice).
    const recipeFor = (id) => Gear.smeltingRecipe(id).map(r => ({ ...r, qty: this.guildPrice(house, r.qty) }));
    const covered = (id) => recipeFor(id).every(r => Inventory.count(this.save, r.id) >= r.qty);
    // Default focus: the highest unlocked bar the player can afford ≥1 of,
    // else the highest unlocked, so the modal opens on something usable
    // rather than a bar they lack ingredients for (the pager still reaches
    // the others). An explicit `target` (from the pager) wins as long as it
    // is actually unlocked.
    if (!target || !bars.includes(target)) target = bars.slice().reverse().find(covered) || bars[bars.length - 1];
    const outItem = ITEM_BY_ID[target];
    // The ‹ › pager walks the unlocked bars (wraps around).
    const idx = bars.indexOf(target);
    const pageTo = (id) => () => this.presentSmeltOffer(sx, sy, house, recordDeal, forgeBack, id);
    this._presentRecipeOffer(sx, sy, {
      recipe: recipeFor(target),
      cancelLabel: 'Leave',
      get: smithyPreviewHTML(this.iconSpanHTML(target, SMITHY_PREVIEW_PX), `1× ${outItem?.name || target}`),
      canAfford: this.invRoomFor(target) >= 1,
      acceptLabel: 'Smelt',
      tabs,
      repeat: () => this.presentSmeltOffer(sx, sy, house, recordDeal, forgeBack, target),
      pager: {
        index: idx, count: bars.length,
        onPrev: pageTo(bars[(idx - 1 + bars.length) % bars.length]),
        onNext: pageTo(bars[(idx + 1) % bars.length]),
      },
      refuse: () => {
        if (this.invRoomFor(target) >= 1) return false;
        this.flash(bagFullFor(target), sx, sy);
        return true;
      },
      produce: () => {
        this.addToInv(target, 1, false, { notWild: true, deferRefresh: true });
        this._settleDeal(recordDeal, [`✨ ${outItem?.name || target} ×1`, UI_GOLD, 1.25, target]);
      },
    });
  }

  // THE RECIPE COUNTER — the one presenter for "give these ingredients, take
  // that": the crucible (presentSmeltOffer) and the forge
  // (presentBlacksmithOffer); Home's Craft page (app.js presentHomeCraft) is
  // its third caller-to-be. It owns the held count, the coloured cost line
  // (green where the bag covers an ingredient, red where it is short), the
  // shortfall line that names the ingredient and how many more are wanted —
  // 'not enough' made the player close the modal and count their own bag,
  // with the recipe line right there on screen in red — and the consume
  // step. The caller owns what comes out (`produce`, after the ingredients
  // are gone) and any guard of its own (`refuse`, run first: a bag with no
  // room, a slot already finer; true refuses). `recipe` is [{ id, qty }] with
  // the counts already trimmed by a guild badge; `canAfford` may add the
  // caller's own condition. Everything else rides through to showOfferModal.
  _presentRecipeOffer(sx, sy, { recipe, produce, refuse, canAfford = true, ...modal }) {
    const held = (id) => Inventory.count(this.save, id);
    const short = () => recipe.find(r => held(r.id) < r.qty);
    const cost = recipe.map(r => `<span style="color:${held(r.id) >= r.qty ? UI_GREEN : UI_DANGER_INK}">`
      + `${r.qty}× ${this.iconSpanHTML(r.id)} ${itemName(r.id)}</span>`).join(' + ');
    this.showOfferModal({
      kind: 'forge',
      costLabel: 'You give',
      ...modal,
      cost,
      canAfford: canAfford && !short(),
      onAccept: () => {
        if (refuse && refuse()) return;
        const missing = short();
        if (missing) { this.flash(`Need ${missing.qty - held(missing.id)} more ${itemName(missing.id)}`, sx, sy); return; }
        for (const r of recipe) Inventory.remove(this.save, r.id, r.qty);
        this._clampSelSlot();
        produce();
      },
    });
  }

  // ─── Wizard tower: memories into power ──────────────────────────
  // The wizard draws power from the player's MEMORIES (save.memories, the
  // unspent count — memoriesUnspent) and turns it into rungs of power. What
  // is on the table is src/wizard.js's business, never re-derived here:
  //   • Wizard.offers(save) — TWO track offers a visit (Inner Light, Full
  //     Measure, Keen Eye, Vigour; seeded, stable until a purchase), or all
  //     four CLASS offers when the calling is due (the third purchase).
  //   • Wizard.buy(save, key, { spend }) — re-validates the pick against the
  //     LIVE table and the LIVE count, writes the rung / calling, and tells
  //     us whether `energyCap` changed (Vigour raises Energy.maxEnergy).
  //
  // ONE WRITER. buy() is handed spendMemories as its `spend` hook, so the
  // counter still goes down in exactly one place on the scene (which
  // repaints the HUD chip and persists); buy() only decrements save.memories
  // itself when no hook is given (the headless wizard.test.js).
  //
  presentWizardOffer(sx, sy, recordDeal) {
    const offers = Wizard.offers(this.save);
    if (!offers.length) {
      this.flash('The wizard has nothing left.', sx, sy);
      return;
    }
    const have = this.memoriesUnspent();
    const calling = offers[0].kind === 'class';
    const mem = (px) => this.iconSpanHTML('memory', px);
    const { wrap, box, mount, mkBtn } = this.makeModalShell('offer-modal',
      { onClose: () => {}, kind: 'wizard' });
    const intro = document.createElement('div');
    intro.style.cssText = `font-size:13px;margin-bottom:4px;color:${UI_GOLD}`;
    intro.textContent = Wizard.INTRO;
    box.appendChild(intro);
    const ask = document.createElement('div');
    ask.style.cssText = 'opacity:.75;font-size:11px;margin-bottom:6px';
    ask.textContent = calling ? 'Choose your calling — once, for good:'
                              : 'He offers you a choice:';
    box.appendChild(ask);
    const purse = document.createElement('div');
    purse.className = 'wizard-memories';
    purse.style.cssText = 'font-size:12px;margin-bottom:10px';
    purse.innerHTML = `${mem(14)} ${have} unspent ${have === 1 ? 'memory' : 'memories'}`;
    box.appendChild(purse);
    // The choices: side by side (two tracks), a 2×2 grid (four callings), or
    // one card when a single track is left. Each card is the button.
    const grid = document.createElement('div');
    grid.className = 'wizard-choices';
    grid.style.cssText = 'display:grid;gap:8px;margin-bottom:10px;'
      + `grid-template-columns:${offers.length > 1 ? '1fr 1fr' : '1fr'};`;
    for (const o of offers) {
      const card = document.createElement('button');
      card.className = 'wizard-choice';
      card.dataset.key = o.key;
      card.style.cssText =
        'display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 6px;'
        + 'border-radius:8px;border:2px solid ' + (o.canAfford ? UI_CONTROL_DIM : '#444') + ';'
        + 'background:#231d16;color:#fff;font:12px ui-monospace,monospace;cursor:pointer;';
      const what = o.sub;
      card.innerHTML =
        `<div style="font-size:24px;line-height:1.1">${o.icon}</div>`
        + `<div style="font-weight:700;color:${UI_GOLD}">${o.title}</div>`
        + `<div style="font-size:11px;line-height:1.3">${what}</div>`
        + `<div style="margin-top:2px;font-weight:700">${mem(12)} ${o.cost}</div>`;
      if (!o.canAfford) {
        card.disabled = true;
        card.style.opacity = '0.4';
        card.style.cursor = 'not-allowed';
      }
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        wrap.remove();
        this._buyWizardOffer(o.key, sx, sy, recordDeal);
      });
      grid.appendChild(card);
    }
    box.appendChild(grid);
    const later = mkBtn('Later', false, false);
    later.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(later);
    mount();
  }

  // The purchase behind a wizard card. Wizard.buy re-reads the live table
  // and the live count (so a modal left open can't buy a rung already taken
  // or overspend), and pays through spendMemories — the scene's one writer.
  _buyWizardOffer(key, sx, sy, recordDeal) {
    const shown = Wizard.offers(this.save).find((o) => o.key === key);
    if (!shown) { this.flash('The wizard has moved on.', sx, sy); return null; }
    if (this.memoriesUnspent() < shown.cost) { this.flash('Not enough memories.', sx, sy); return null; }
    const r = Wizard.buy(this.save, key, { spend: (n) => this.spendMemories(n) });
    if (!r) { this.flash('The wizard has moved on.', sx, sy); return null; }
    recordDeal();
    // The reach silhouette redraws every frame from reachRadiusM, so a wider
    // reach shows on the next frame with no explicit invalidation; a Vigour
    // rung moves Energy.maxEnergy, which the gauge reads live.
    persistSave(this.save);
    if (this.buildInventoryDOM) this.buildInventoryDOM();
    if (this.updateMemoriesDOM) this.updateMemoriesDOM();
    if (r.energyCap && this.updateEnergyDOM) this.updateEnergyDOM();
    const o = r.offer;
    this.showChestRewardModal({
      kind: 'wizard',
      header: o.header,
      iconHTML: `<span style="font-size:40px;line-height:1">${o.icon}</span>`,
      name: o.name,
      sub: o.sub,
      color: UI_TREASURE,
    });
    return r;
  }

  // ─── Reach / Inner Light cap ─────────────────────────────────────
  // Six +0.5-cell steps carry reach from 2 cells to 5. They're claimed
  // EXCLUSIVELY at the wizard tower's Inner Light track (src/wizard.js,
  // which owns the number).
  get REACH_UPGRADE_MAX() { return Wizard.REACH_UPGRADE_MAX; }

  // Trader offer: barter-only, qty scaled to a target trade value. The trader
  // picks an item to give the player, picks an asking item from inventory,
  // then asks for whatever count of it hits a target value (1.0..2.0× of the
  // offered item's base price). Seeded by (house, bucket, rerolls, deals) so
  // the offer is stable until the player buys, walks away through a bucket
  // flip, or pays the re-roll cost. THE DEAL IS IN THE SEED (ShopsMath.rng,
  // as at every shop): the goods on offer are what the trader hands over, so
  // once a trade closes the trader holds something else — the next offer,
  // and the sign over the roof, name new goods instead of the stack just
  // bartered away.
  //
  // The GIVE side is drawn first and on its own (traderGivePick) because the
  // sign over the roof names the trader for it — "Rockfruit Trader" (render.js
  // _houseSignText via Shops.roleLabel). Both read the same pick off the same
  // rng lane, so the sign can't advertise a different item than the modal
  // hands over; the ask side is drawn afterwards from the same stream, so the
  // offer itself is unchanged by the split.
  // A storefront's fixed per-house seed (the produce-vs-seeds flip, and the
  // trader's sign). Hashed off the house's ID — generated from tile + cell or
  // its OSM id — never its x/y: those are frame metres, and the frame is per
  // save, so a position hash gave the same shop a different trade in every
  // player's world (CLAUDE.md "Every player sees the SAME generated world").
  // 0 for a house with no id (the unseeded fallback).
  _houseSeed(house) {
    return (house && house.id != null) ? (fnv1a(String(house.id)) >>> 0) : 0;
  }
  traderGivePick(house) {
    if (!house?.id) return null;
    const rng = this.shopRng(house, 'trader');
    // Every non-gear item at this trader's rank can appear on the counter.
    const tier = Shops.traderTier(this.save, house);
    const ids = Shops.traderStock(tier);
    const giveId = ids[Math.floor(rng() * ids.length)];
    if (!giveId) return null;
    return { rng, giveId };
  }
  // Display name of what a trader currently offers, for its sign — null when
  // there is no offer to name (the sign then falls back to a bare "Trader").
  traderGoodsName(house) {
    const swap = this.peekTraderGearSwap(house);
    if (swap) return this._tradePieceName(swap.get);
    const pick = this.traderGivePick(house);
    if (!pick) return null;
    return itemName(pick.giveId);
  }
  // Sometimes the trader swaps equipment instead (Gear.traderGearSwap): on
  // its own seed lane, so the barter stream below draws what it always did.
  // `id` names the swap for ShopsMath.offerKey, so a re-roll moves past it.
  peekTraderGearSwap(house) {
    if (!house?.id) return null;
    const swap = Gear.traderGearSwap(this.save, this.shopRng(house, 'trader_gear'), Shops.traderTier(this.save, house));
    if (!swap) return null;
    const key = (p) => [p.kind, p.slot || p.id, p.tier].join(':');
    return { ...swap, gearSwap: true, id: `swap/${key(swap.give)}/${key(swap.get)}` };
  }
  _tradePieceName(p) {
    return p.kind === 'item' ? itemName(p.id) : gearName(p.kind, p.slot, p.tier);
  }
  _tradePieceHTML(p) {
    return p.kind === 'item'
      ? `${this.iconSpanHTML(p.id)} ${this._tradePieceName(p)}`
      : `${this.gearIconHTML(p.kind, p.slot, p.tier, 20)} ${this._tradePieceName(p)}`;
  }
  peekOrBuildTraderOffer(house) {
    const swap = this.peekTraderGearSwap(house);
    if (swap) return swap;
    const pick = this.traderGivePick(house);
    if (!pick) return null;
    const { rng, giveId } = pick;
    const baseValue = Math.max(1, itemValue(giveId));
    // Target trade value the trader considers appropriate — a shiny trader's
    // (the Magic Hammer's) asks for less of your stack, priceMul.
    const target = baseValue * (1.0 + rng()) * this.priceMul(house);
    // Asking item: ShopsMath.traderAsk — usually a stack that already
    // covers the count, otherwise anything owned, then the wishlist; never a
    // count the bag's stack cap could not hold. Every catalogue item is
    // worth what itemValue says (the unpriced live animals and saplings
    // included), so a deer is never asked for by the dozen at $1.
    const ask = ShopsMath.traderAsk({
      rng, giveId, target,
      inv: this.save.inv,
      prices: itemValues(),
      isItem: (id) => Object.hasOwn(Shops.traderPrices(), id),
      capFor: (id) => Inventory.stackCapFor(this.save, id),
    });
    if (!ask) return null;
    const { askId } = ask;
    return { giveId, askId, askQty: this.guildPrice(house, ask.askQty) };
  }

  presentTraderOffer(sx, sy, house, recordDeal) {
    const offer = this.peekOrBuildTraderOffer(house);
    if (!offer) { this.flash('Nothing to trade for.', sx, sy); return; }
    if (offer.gearSwap) { this._presentTraderGearSwap(sx, sy, house, recordDeal, offer); return; }
    const giveItem = ITEM_BY_ID[offer.giveId];
    const askItem  = ITEM_BY_ID[offer.askId];
    const heldCount = () => Inventory.count(this.save, offer.askId);
    // Low-tier seeds barter in a slightly larger bundle (planted in bulk).
    const giveQty = TRADE_OFFER_QTY
      + (isLowTierSeed(offer.giveId) ? LOW_TIER_SEED_QTY_BONUS : 0);
    this.showOfferModal({
      kind: 'trade',
      // Spell out who gives what so the barter can't be read backwards:
      // "Trader offers <giveItem> for your <askItem>".
      title: 'The trader offers:',
      ...NPC.offerArt(this, house),
      forLabel: 'for your',
      cancelLabel: 'Later',
      get: `${this.iconSpanHTML(offer.giveId)} ${giveItem?.name || offer.giveId} ×${giveQty}`,
      cost: `${offer.askQty}× ${this.iconSpanHTML(offer.askId)} ${askItem?.name || offer.askId}`,
      canAfford: heldCount() >= offer.askQty,
      onAccept: () => {
        if (heldCount() < offer.askQty) {
          this.flash(`Need ${offer.askQty - heldCount()} more ${askItem?.name || offer.askId}`, sx, sy);
          return;
        }
        Inventory.remove(this.save, offer.askId, offer.askQty);
        this._clampSelSlot();
        this.addToInv(offer.giveId, giveQty, false, { notWild: true, deferRefresh: true });
        this.save.buyIndex = (this.save.buyIndex ?? 0) + 1;
        this._settleDeal(recordDeal, [
          `${giveQty}× ${giveItem?.name || offer.giveId}\n−${offer.askQty} ${askItem?.name || offer.askId}`,
          UI_GOLD, 1, offer.giveId,
        ]);
      },
      secondary: this._traderRerollSecondary(sx, sy, house, recordDeal, offer),
    });
  }

  // The gear swap's modal: same title, art and re-roll as the barter.
  _presentTraderGearSwap(sx, sy, house, recordDeal, offer) {
    const { give, get } = offer;
    this.showOfferModal({
      kind: 'trade',
      title: 'The trader offers:',
      ...NPC.offerArt(this, house),
      forLabel: 'for your',
      cancelLabel: 'Later',
      get: this._tradePieceHTML(get),
      blurb: `<div style="margin-top:6px">${tierBadgeHTML(get.tier)}</div>`,
      cost: this._tradePieceHTML(give),
      canAfford: Gear.traderSwapValid(this.save, offer),
      onAccept: () => {
        if (!Gear.traderSwapValid(this.save, offer)) { this.flash('That swap has gone.', sx, sy); return; }
        if (get.kind === 'item' && this.invRoomFor(get.id) < 1) { this.flash(bagFullFor(get.id), sx, sy); return; }
        Gear.surrenderPiece(this.save, give);
        Rewards.apply(this.save, get, this, { notWild: true, deferRefresh: true });
        this.markRelicsDirty();
        this._clampSelSlot();
        this._settleDeal(recordDeal, [`${this._tradePieceName(get)}\n−${this._tradePieceName(give)}`, UI_GOLD, 1.25]);
      },
      secondary: this._traderRerollSecondary(sx, sy, house, recordDeal, offer),
    });
  }

  // The trader's re-roll, shared by the barter and the gear swap: the
  // common button on the trader's ladder (ShopsMath.traderRerollCost, the
  // smithy's). The peek settles the bucket's rerolls / skips on a DIFFERENT
  // offer; the re-present reads the same record back and shows that one.
  _traderRerollSecondary(sx, sy, house, recordDeal, offer) {
    return this._makeRerollSecondary(house, sx, sy, 'Nothing to trade for.',
      () => this.presentTraderOffer(sx, sy, house, recordDeal),
      { cost: ShopsMath.traderRerollCost, peek: () => this.peekOrBuildTraderOffer(house), current: offer });
  }

  // REST: a flat CASTLE_REST_ENERGY, once per Houses.CASTLE_SERVICE_MS. Silent (no-op) while the favour is
  // still spent or the castle isn't claimed; the modal that calls this never
  // offers the choice in either case.
  _castleRest(sx, sy, house) {
    if (!this.isCastleClaimed(house) || this._castleServiceUsed(house)) return;
    const maxE = this.getMaxEnergy();
    const cur = this.save.energy ?? 0;
    const gain = CASTLE_REST_ENERGY;
    Energy.set(this.save, cur + gain, maxE);
    this._markCastleServiceUsed(house);
    if (typeof persistSave === 'function') persistSave(this.save);
    this.buildInventoryDOM();
    // A gain to the BODY: it lands on the player's own cell (_popEnergy's
    // default), not on the castle the modal was opened from.
    this._popEnergy(Math.max(0, Math.min(gain, maxE - cur)));
  }
  // COLLECT: a flat CASTLE_TAX_GOLD from the crown's coffers instead of rest.
  _castleTax(sx, sy, house) {
    if (!this.isCastleClaimed(house) || this._castleServiceUsed(house)) return;
    addMoney(this.save, CASTLE_TAX_GOLD);
    this._markCastleServiceUsed(house);
    if (typeof persistSave === 'function') persistSave(this.save);
    this.buildInventoryDOM();
    this.flashLoot(`+${CASTLE_TAX_GOLD} taxes`, UI_GOLD, 1, null, this.coinIconEl?.());
  }
  // The castellan's greeting and offer. A RESTORED castle (the player solved
  // its quest — see showQuestBoard/_claimCastle) no longer sells relics: it's
  // home turf, so instead of a trade it's a favour, once per
  // Houses.CASTLE_SERVICE_MS — the one timer on any building you trade at.
  presentCastleServiceOffer(sx, sy, house) {
    if (this._castleServiceUsed(house)) {
      // A timed gate names its wait, never "later" — the one refusal shape
      // every recurring site takes (Macros.waitLine, the castle row's `spent`
      // prefix): "The castellan is away — 12h".
      this.flash(Macros.waitLine(Macros.DAILY_VISIT_KINDS.castle.spent, this._castleServiceWaitMs(house)), sx, sy);
      return;
    }
    this.showOfferModal({
      kind: 'shop',
      title: 'Thank you for visiting us, my lord.',
      // The castellan at his gate — the survivor who runs the place you
      // restored, greeting the player the banner flew for.
      art: 'castle_favour',
      get: 'My lord, which kindness may we offer?',
      blurb: `Whichever you pick, it won't be on offer again for ${shortDuration(Houses.CASTLE_SERVICE_MS)}.`,
      canAfford: true,
      acceptLabel: `Rest +${CASTLE_REST_ENERGY}⚡`,
      secondary: {
        label: `Collect ${this.moneyHTML(CASTLE_TAX_GOLD, 12)} taxes`,
        onClick: () => this._castleTax(sx, sy, house),
      },
      cancelLabel: 'Later',
      onAccept: () => this._castleRest(sx, sy, house),
    });
  }

  // A castle keeps the job assigned on its first conversation. Citadels open
  // through their garrison instead and never enter the quest ledger.
  showQuestBoard(sx, sy, house) {
    const key = this._castleKey(house);
    if (!key || this.isCastleClaimed(house)) return;
    const style = CastleStyles.get(key);
    if (style.guards) {
      this._checkCitadelClaims();
      if (this.isCastleClaimed(house)) return;
      this.showOfferModal({
        kind: 'quest', title: style.name, get: 'Defeat the guards',
        blurb: 'Clear the garrison to open this citadel.',
        canAfford: false, acceptLabel: 'Guarded', cancelLabel: 'Later',
      });
      return;
    }
    const q = Quests.assign(this.save, key, style.id);
    if (!q) return;
    persistSave(this.save);
    const done = q.have >= q.need;
    this.showOfferModal({
      kind: 'quest',
      title: done ? 'Quest complete!' : q.title,
      get: done ? `Reward: ${this.moneyHTML(q.reward)}` : `${q.have} / ${q.need}`,
      blurb: q.body,
      canAfford: done,
      acceptLabel: done ? 'Claim Reward' : 'Locked',
      cancelLabel: 'Later',
      onAccept: () => {
        const finished = Quests.claim(this.save, key);
        if (!finished) return;
        if (finished.reward) addMoney(this.save, finished.reward);
        const claimed = this._claimCastle(house);
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flashLoot(`+${finished.reward}`, UI_GOLD, 1, null, this.coinIconEl());
        if (claimed) {
          const splashed = this._storySplashOnce('castle:' + key, {
            art: 'castle_claim', title: 'The castle is yours',
            body: "The vault door grinds open, and your banner rises above the gate. You step inside.",
          });
          if (!splashed) {
            this.flash('The castle vault is yours.', sx, sy);
          }
        }
      },
    });
  }

  _claimCitadel(key) {
    if (!Houses.claimCastle(this.save, { castle: key })) return false;
    persistSave(this.save);
    this.flashAtPlayer('The citadel is yours.');
    return true;
  }

  _checkCitadelClaims() {
    if ((this.depth || 0) !== 0) return;
    const pc = this.playerToWorldCell(), ring = [];
    eachTile3x3(pc.tx, pc.ty, (tx, ty) => {
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      if (entry) ring.push({ entry, tx, ty });
    });
    Lairs.claimClearedCitadels(ring, setOf(this.save.caught), key => this._claimCitadel(key));
  }

  // True iff `house` is a fort the player hasn't unsealed yet — see Houses.isFortLocked.
  _isFortLocked(house) { return Houses.isFortLocked(this.save, house); }

  // Pay-to-unseal modal for a locked fort. Costs FORT_UNLOCK_WOOD wood, mirrors
  // the wreck-restore flow: shown even when unaffordable (so the player sees
  // the price), re-checks stock on accept, then records the unlock and plays
  // the same restoration fanfare.
  presentFortUnlockModal(sx, sy, house) {
    const need = this._fortUnlockCost();
    const heldCount = Inventory.count(this.save, 'wood');
    const canAfford = heldCount >= need;
    this.showOfferModal({
      kind: 'build',
      title: 'Unseal this fort?',
      cancelLabel: 'Later',
      get: '🛡️ the fort quartermaster',
      blurb: 'Behind the gate, the quartermaster’s reels still turn.',
      cost: `${need}× ${this.iconSpanHTML('wood')} ${ITEM_BY_ID['wood']?.name || 'Wood'}`
        + (canAfford ? '' : ` <span style="opacity:.7">(have ${heldCount})</span>`),
      canAfford,
      acceptLabel: 'Unseal',
      onAccept: () => {
        // Re-check stock at accept time — the player might have spent the wood
        // elsewhere while the modal was open.
        const have = Inventory.count(this.save, 'wood');
        if (have < need) { this.flash(`Need ${need - have} more ${itemName('wood')}`, sx, sy); return; }
        Inventory.remove(this.save, 'wood', need);
        this._clampSelSlot();
        this.save.unlockedForts = this.save.unlockedForts || {};
        this.save.unlockedForts[house.id] = true;
        persistSave(this.save);
        this.buildInventoryDOM();
        if (this.showChestRewardModal) {
          this.showChestRewardModal({
            kind: 'build',
            // Same trade the Restored! card makes: the fort_unseal banner
            // carries the picture, so the building sprite icon goes.
            iconHTML: '',
            art: 'fort_unseal',
            header: 'Unsealed!',
            name: 'You unsealed a Fort',
            sub: "The gate opens in a cloud of dust. The quartermaster waves you over to his clattering reels.",
            color: UI_GREEN, accent: UI_GREEN,
          });
        } else {
          this.flashLoot('🛡️ unsealed', UI_GREEN, 1.25);
        }
      },
    });
  }

  presentBlacksmithOffer(sx, sy, offer, recordDeal, house, opts = {}) {
    // recipe override lets the starter blacksmith define T1 wooden recipes
    // (rockfruit + tree) without loosening the T2+ bar requirement in
    // blacksmithRecipe — keeps every other smithy on the original ladder.
    const listed = opts.recipe || Gear.blacksmithRecipe(offer.kind, offer.slot, offer.tier);
    // Unreachable for a seeded smithy offer (Gear.buildRelicOffer skips what
    // the anvil cannot forge); kept as a guard for a hand-built one.
    // A guild badge trims each ingredient's count (guildPrice).
    const recipe = listed && listed.map(r => ({ ...r, qty: this.guildPrice(house, r.qty) }));
    if (!recipe) {
      this.flash('Nothing to forge here.', sx, sy);
      return;
    }
    const name = gearName(offer.kind, offer.slot, offer.tier);
    const iconHtml = this.gearIconHTML(offer.kind, offer.slot, offer.tier, SMITHY_PREVIEW_PX);
    // Re-roll mirrors the relic-offer flow (shared via _makeRerollSecondary):
    // cost = ShopsMath.smithyRerollCost (×1.5 a roll), bumps curState.rerolls so the next
    // peekOrBuildRelicOffer returns a different forge target. Suppressed for
    // the starter blacksmith — the wooden-tool queue is sequential, not
    // random, so there's nothing to re-roll into.
    const secondary = opts.noReroll ? undefined
      : this._makeRerollSecondary(house, sx, sy, 'nothing else to forge',
          next => this.presentBlacksmithOffer(sx, sy, next, recordDeal, house),
          { cost: ShopsMath.smithyRerollCost, current: offer });
    // Forge / Smelt tab row — only on a normal smithy (not the starter
    // wooden-tool queue). Switching to Smelt re-presents this same forge
    // offer as the "back" target so the player can toggle freely.
    const tabs = (!opts.noReroll && Gear.smeltUnlockedBars().length)
      ? [
          { label: 'Forge', active: true,  onSelect: () => {} },
          { label: 'Smelt', active: false, onSelect: () =>
              this.presentSmeltOffer(sx, sy, house, recordDeal,
                () => this.presentBlacksmithOffer(sx, sy, offer, recordDeal, house, opts)) },
        ]
      : undefined;
    this._presentRecipeOffer(sx, sy, {
      recipe,
      cancelLabel: 'Later',
      get: smithyPreviewHTML(iconHtml, name),
      blurb: this._trailRewardBlurb(offer),
      acceptLabel: 'Forge',
      tabs,
      secondary,
      refuse: () => !this._gearUpgradeOk(offer, sx, sy),
      produce: () => {
        this._equipGear(offer.kind, offer.slot, offer.tier);
        this.markRelicsDirty();
        // Forging settles the smithy like any closed deal (ShopsMath.recordDeal):
        // the re-roll cost drops back to the base rung and the next forge
        // target is a fresh draw.
        this._settleDeal(recordDeal);
        // The forge's story pane: the forged piece's own art (not a coin),
        // large on the forge painting, with the finishing moment (FORGE_CEREMONY).
        const { iconPx, ...ceremony } = FORGE_CEREMONY;
        this.showChestRewardModal({
          ...ceremony,
          iconHTML: this.gearIconHTML(offer.kind, offer.slot, offer.tier, iconPx),
          name,
          color: UI_GOLD, accent: '#ffb347',
        });
      },
    });
  }

  // Build a shop offer for buying ${id} (baseValue = itemValue(id)). Always a
  // CASH price, so the two trade idioms map cleanly onto shop types: MARKETS (and every
  // generic cash storefront) want money, TRADERS barter (their own qty-scaled
  // path in presentTraderOffer). opts.house names the shop asking: it seeds
  // the markup roll off that shop's hour bucket (so the price holds for the
  // hour) and applies its flower-charm discount; with no house the markup is
  // a plain roll and there is no charm to apply.
  buildShopOffer(id, baseValue, opts = {}) {
    // Pricing (the 1.2–3.0× markup) lives in ShopsMath.buyPrice; the
    // offer object's afford/consume closures stay here (they bind this.save).
    // Seed the markup roll off the shop's hour bucket when we know which shop
    // is asking. buyPrice spans 1.2x-3.0x base, so on Math.random the player
    // could close and reopen the modal until the price came up cheap — the
    // markup is part of the offer, and the offer holds for the hour.
    const priceRng = (opts.house && opts.house.id)
      ? this.shopRng(opts.house, 'price')
      : undefined;
    // The charm's hour and the hammer's standing cut (floor $1) — see priceMul —
    // then a guild badge takes its share off (guildPrice).
    const cashCost = this.guildPrice(opts.house, Math.max(1,
      Math.ceil(ShopsMath.buyPrice(this.save, baseValue, priceRng) * this.priceMul(opts.house))));
    return {
      kind: 'money',
      label: this.moneyHTML(cashCost),
      shortGain: `−${cashCost}`,
      shortDenial: purseShort(cashCost),
      canAfford: () => (this.save.money ?? 0) >= cashCost,
      consume: () => { addMoney(this.save, -cashCost); },
    };
  }
}
