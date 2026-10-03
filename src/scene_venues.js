// The scene's VENUES — the buildings you step into rather than shop at:
//   · macro stories and transactions, the inn, guildhall (and its bounty),
//     curio, scholar and training rooms;
//   · Home's sell / craft tabs, the fort's slot machine and castle wards;
//   · where Home is (homeWorldPos / inHomeRing) and the starter trailer.
//
// Moved verbatim out of app.js. The methods live on `class SceneVenues`, a MIXIN:
// app.js installs them onto MapScene.prototype right after the class closes
// (installSceneMixin, from modal_shell.js), so callers still say `this.x()`.
// This file loads BEFORE app.js: the methods read app.js names and this.* at
// CALL time only.

class SceneVenues {
  // Each physical booth introduces its service once per save (_storySplashOnce).
  // True when it opened now; `onDismiss` runs when it is tapped away.
  _macroStory(kind, onDismiss, o) {
    const st = Macros.KIND_STORY[kind];
    const d = Macros.KIND_DIALOG[kind];
    if (!st || !d || o?.id == null) return false;
    return this._storySplashOnce('macro:' + kind + ':' + o.id, { art: Macros.stallArt(kind, o), title: st.title, body: st.body, onDismiss });
  }

  // Successful services share one receipt surface, after the state is committed.
  // A bounty can complete while a shop or story is open: keep its receipt
  // until that dialog ends, ahead of queued memories in _drainBadgeStories.
  _macroTransaction(kind, body, onDismiss) {
    const d = Macros.KIND_DIALOG[kind], receipt = Macros.KIND_TRANSACTION[kind];
    if (!d || !receipt) return;
    (this._macroReceipts ||= []).push({ kind: d.modal, kindLabel: d.label,
      art: receipt.art, title: receipt.title, body, onDismiss });
    this._drainMacroTransactions();
  }
  _drainMacroTransactions() {
    if (!this._macroReceipts?.length) return false;
    this._syncModalGate?.();
    if (document.body?.classList?.contains('modal-open')) return false;
    this.showMessageModal(this._macroReceipts.shift());
    return true;
  }

  // INN: rest to full for coin, once a UTC day per inn (Macros.innRest — the
  // Potion of Healing's coins per energy × INN_RATE). A purchase, not a passive
  // rest: it is not gated on `working`, and it is not Home's (HOME_R). Hard
  // mode's empty-tank lockout refuses it like food and the fire.
  _presentInn(sx, sy, o, dress) {
    const wait = shortDuration(msToNextUtcDay());
    if (Macros.serviceUsedToday(this.save, o.id)) { this.flash(`Rested. Back in ${wait}.`, sx, sy); return; }
    if (this._zeroEnergyLocked()) { this.flash('Too far gone for a bed.', sx, sy); return; }
    const maxE = this.getMaxEnergy();
    const missing = Math.max(0, maxE - (this.save.energy ?? 0));
    if (missing <= 0) { this.flash('You\'re already rested.', sx, sy); return; }
    const price = Macros.innPrice(missing);
    this.showOfferModal({
      ...dress, kind: dress.kind,
      title: 'The innkeeper offers a bed:',
      get: 'Wake with your strength restored',
      blurb: `One night a day at this inn. The next is in ${wait}.`,
      cost: this.moneyHTML(price),
      canAfford: (this.save.money ?? 0) >= price,
      acceptLabel: 'Rest',
      cancelLabel: 'Later',
      onAccept: () => {
        const cur = this.save.energy ?? 0;
        const r = Macros.innRest(this.save, o, this.getMaxEnergy());
        if (!r.ok) {
          if (r.why === 'money') this.flash(`need ${r.price}`, sx, sy);
          return;
        }
        this._finishInventoryChange();
        if (this.updateEnergyDOM) this.updateEnergyDOM();
        // A gain to the BODY: it lands on the player's own cell.
        this._popEnergy(Math.max(0, (this.save.energy ?? 0) - cur));
        this._macroTransaction('inn', `You paid ${this.moneyHTML(r.price)} and restored ${r.gain} HP. You are fully rested.`);
      },
    });
  }

  // GUILDHALL: one MONSTER BOUNTY a UTC day per hall (Macros.bountyFor — the
  // hall's and the day's pack, sized by the player's weapon). Accepting seats
  // the pack at findWalkableDestination(BOUNTY_DIST_CELLS) and marks the day
  // (the ledger — one offer a day, taken or lost). Each kill pays its own
  // wage through resolveDefeat; clearing the pack pays Macros.bountyPay on top
  // (_guildBountyDefeat). THE PACK WAITS UNTIL THE DAY ENDS (owner, Sep 2026):
  // no leash that cancels it when you walk off — a reward that vanishes
  // unless you chase it wherever it runs is exactly the push into the street
  // the safety audit named. It is seated on the player's SIDE of any major
  // road, off the kerb buffer (findWalkableDestination, `foe`), is kept in
  // the save (save.guildBounty: the day, the pay, each foe's kind and seat) so
  // a reload or an evicted tile puts it back where it stood, and stands down
  // only when the UTC day turns — _tickGuildBounty.
  _presentGuildhall(sx, sy, o, dress) {
    const wait = shortDuration(msToNextUtcDay());
    if (this._guildBountyNow()) { this.flash('Finish the hunt first.', sx, sy); return; }
    if (Macros.serviceUsedToday(this.save, o.id)) { this.flash(`Board empty. Back in ${wait}.`, sx, sy); return; }
    const b = Macros.bountyFor(this.save, o);
    const names = b.kinds.map((k) => Combat.monster(k)?.name || 'Slime');
    const counts = {};
    for (const n of names) counts[n] = (counts[n] || 0) + 1;
    const list = Object.entries(counts).map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ');
    this.showOfferModal({
      ...dress, kind: dress.kind,
      title: 'Today\'s bounty:',
      get: `Clear ${list} nearby`,
      cost: `pays ${this.moneyHTML(b.pay, 12)} on top of each kill`,
      blurb: `Take the hunt. The beasts will wait until the board changes in ${wait}.`,
      canAfford: true,
      acceptLabel: 'Take it',
      cancelLabel: 'Later',
      onAccept: () => {
        if (Macros.serviceUsedToday(this.save, o.id) || this._guildBountyNow()) return;
        const n = this._spawnGuildBounty(b);
        if (!n) { this.flash('No clear ground here.', sx, sy); return; }
        Macros.markServiceToday(this.save, o.id);
        persistSave(this.save);
        const line = n > 1 ? `${n} foes close by!` : 'A foe close by!';
        this.flash(line, sx, sy);
      },
    });
  }
  // Seat bounty `b`'s pack: the first foe on the destination cell, the rest on
  // free cells beside it (WorldGen.relocateToSpawnCell under the same shared
  // rule, each seat claimed so none stack). Ordinary enemies — the kind's own
  // row, not shiny — tagged `bounty` with the bounty id, with ids minted off
  // the clock (`guildfoe_<tx>_<ty>_…`, pruned from save.caught like a ghost's).
  // Returns how many were seated (0: no ground; nothing is posted).
  _spawnGuildBounty(b, now = Date.now()) {
    const homePos = this.homeWorldPos();
    const packClass = b.kinds.some((k) => creatureSpawnClass(k) === 'fastEnemy') ? 'fastEnemy' : 'enemy';
    const dest = this.findWalkableDestination(Macros.BOUNTY_DIST_CELLS, {
      seed: b.id,
      // Alive and hostile: the pack's seat class (a fast pack keeps off the
      // kerb too — creatureSpawnClass). Same side of any major road is
      // walkableDestination's own rule.
      cls: packClass,
      // Never inside Home's ward ring — it would only rout them.
      accept: (x, y) => !homePos || Math.hypot(x - homePos.x, y - homePos.y) > HOME_R * this.cellM,
    });
    if (!dest) return 0;
    const { entry, tx, ty, n: N } = dest;
    const edge = this.tileEdgeM, cm = edge / N;
    const base = entry._spawnOpts;
    const used = new Set();
    // The pack's other seats: the shared rule at each foe's own class, never
    // stacked, and never on this player's live private-ground veto (a
    // vetoed cell reads as taken).
    const opts = { ...base, occupied: { has: (k) => used.has(k) || !!(base.occupied && base.occupied.has(k))
      || WorldGen.privateVetoAt(tx, ty, k % N, Math.floor(k / N)) } };
    const foes = [];
    entry.creatures = entry.creatures || [];
    b.kinds.forEach((kind, i) => {
      const seat = i === 0 ? { ix: dest.ix, iy: dest.iy }
        : WorldGen.relocateToSpawnCell(entry.grid, N, N, dest.ix, dest.iy, opts, 2, creatureSpawnClass(kind));
      if (!seat) return;
      used.add(seat.iy * N + seat.ix);
      const id = `guildfoe_${tx}_${ty}_${Math.floor(now)}_${i}`;
      const x = tx * edge + (seat.ix + 0.5) * cm, y = ty * edge + (seat.iy + 0.5) * cm;
      entry.creatures.push(WorldGen.makeCreature(kind, x, y, id, { shiny: false, bounty: b.id }));
      foes.push({ id, tx, ty, kind, x, y });
    });
    if (!foes.length) return 0;
    this._guildBounty = { id: b.id, pay: b.pay, day: utcDayKey(now), foes };
    this.save.guildBounty = this._guildBounty;
    return foes.length;
  }
  // Today's bounty, if one is out: the live one, or the one the save kept
  // (a reload). A bounty from another UTC day is dropped here.
  _guildBountyNow() {
    if (!this._guildBounty && this.save.guildBounty) this._guildBounty = this.save.guildBounty;
    const gb = this._guildBounty;
    if (gb && gb.day !== utcDayKey()) {
      this._guildBounty = null;
      delete this.save.guildBounty;
      return null;
    }
    return gb || null;
  }
  // A bounty foe fell (resolveDefeat): when the whole pack is down, pay the
  // hall's reward — once; the pack is forgotten on payment.
  _guildBountyDefeat(victim) {
    const gb = this._guildBounty || this.save.guildBounty;
    if (!gb || victim.bounty !== gb.id) return;
    // Marked on the pack itself as well as in save.caught: the caught-prune
    // drops a guildfoe marker once its tile leaves the cache, and the pack
    // must not put a slain foe back (_tickGuildBounty).
    for (const f of gb.foes) if (f.id === victim.id) f.dead = true;
    if (!gb.foes.every((f) => f.dead) && !Macros.bountyCleared(this.save, gb.foes.map((f) => f.id))) return;
    this._guildBounty = null;
    delete this.save.guildBounty;
    addMoney(this.save, gb.pay);
    this.updateHUD?.();
    persistSave(this.save);
    this.flashLoot(`Bounty paid! +${gb.pay}`, '#ffe066', 1);
    this._macroTransaction('guildhall', `The hunt is complete. You received ${this.moneyHTML(gb.pay)}, in addition to the coins from each defeated foe.`);
  }
  // THE BOUNTY WAITS, asked each frame there is one: it stands down only when
  // the UTC day turns (no payout — "The bounty got away."). Walking off, the
  // stairs and a reload do NOT end it: a foe missing from its loaded tile (an
  // evicted and re-built tile, or a reload) is put back on the seat it was
  // given, unless it died. Underground it waits for the surface.
  _tickGuildBounty() {
    const gb = this._guildBounty || this.save.guildBounty;
    if (!gb) return;
    if (gb.day !== utcDayKey()) {
      const caught = new Set(this.save.caught || []);
      let left = 0;
      for (const f of gb.foes) {
        if (f.dead || caught.has(f.id)) continue;
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(f.tx, f.ty));
        const c = entry && entry.creatures && entry.creatures.find((k) => k.id === f.id);
        if (c) entry.creatures.splice(entry.creatures.indexOf(c), 1);
        left++;
      }
      this._guildBounty = null;
      delete this.save.guildBounty;
      if (left) this.flash('The bounty got away.', this.viewCenterX, this.viewCenterY - 40);
      return;
    }
    this._guildBounty = gb;
    if ((this.depth || 0) !== 0 || !gb.foes[0] || gb.foes[0].x == null) return;
    const caught = new Set(this.save.caught || []);
    for (const f of gb.foes) {
      if (f.dead || caught.has(f.id)) continue;
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(f.tx, f.ty));
      if (!entry || !entry._spawned || !entry.creatures) continue;
      if (entry.creatures.some((k) => k.id === f.id)) continue;
      entry.creatures.push(WorldGen.makeCreature(f.kind, f.x, f.y, f.id, { shiny: false, bounty: gb.id }));
    }
  }


  // CURIO HALL: the ONE shared collection (Macros.CURIO_COLLECTION — things
  // that keep). Hold a listed thing the collection lacks and tap to give ONE;
  // nothing is paid. At each of Macros.CURIO_MILESTONES given, a MEMORY
  // (_bankDiscovery, `curio:<n>` — once per save; its story rides the memory
  // queue). Not a sell page and not a delivery: see src/macros.js.
  _presentCurio(sx, sy, o, dress) {
    const have = Macros.curioCount(this.save);
    const next = Macros.curioNextMilestone(have);
    const progress = next != null ? `${have} / ${next} — next memory at ${next}`
      : `${have} / ${Macros.curioCollection().length} given`;
    const sel = getSelectedSlot(this.save);
    const id = sel && (sel.count ?? 0) > 0 ? sel.id : null;
    if (!id || !Macros.curioEligible(id) || Macros.curioDonated(this.save, id)) {
      const missing = Macros.curioMissing(this.save).map((m) => itemName(m));
      const lacks = missing.length ? `It still lacks: ${missing.join(', ')}.` : 'The collection is whole.';
      const why = id && Macros.curioDonated(this.save, id) ? 'It has one of those already. '
        : id ? 'It does not collect that. ' : '';
      this.showMessageModal({
        kind: dress.kind, art: dress.art, title: `The curio hall: ${progress}`,
        body: `${why}Hold a thing it lacks and tap the hall. ${lacks}`,
      });
      return;
    }
    this.showOfferModal({
      ...dress, kind: dress.kind,
      title: `The curio hall: ${progress}`,
      get: next != null && have + 1 === next ? 'A memory returns' : 'A place in the collection',
      cost: `${this.iconSpanHTML(id)} ${itemName(id)} ×1`,
      blurb: 'Donate this to the collection. Something familiar stirs among the dusty shelves.',
      canAfford: true,
      acceptLabel: 'Donate',
      cancelLabel: 'Keep',
      onAccept: () => {
        const r = Macros.curioDonate(this.save, id);
        if (!r.ok) { this.flash(`${r.why === 'given' ? 'The hall has one already.' : 'Nothing to donate.'}`, sx, sy); return; }
        this._clampSelSlot();
        this._finishInventoryChange();
        if (r.milestone) {
          this._bankDiscovery(Macros.curioMilestoneKey(r.milestone),
            `the ${r.milestone}th curio given to the hall`);
        }
        const nx = Macros.curioNextMilestone(r.count);
        const line = nx != null ? `Donated! ${r.count} / ${nx}` : `Donated! ${r.count} given`;
        this.flashLoot(line, '#ffe066', 1, id);
        this._macroTransaction('curio', `You donated ${itemName(id)}. The collection now holds ${r.count} curios${r.milestone ? ', and a memory has returned' : ''}.`);
      },
    });
  }

  // The Book Club rewards each three Books collected with the next tome.
  // All schools share reading and claim progress; the shelf repeats.
  _presentScholar(sx, sy, o, dress) {
    const shelf = Macros.scholarShelf();
    const read = Macros.booksRead(this.save);
    const next = Macros.scholarNext(this.save, shelf);
    const title = `The book club: ${read} ${read === 1 ? 'book' : 'books'} read`;
    if (!next) {
      this.showMessageModal({ kind: dress.kind, art: dress.art, title,
        body: 'The scholar has no tomes on the shelf today.' });
      return;
    }
    if (!next.ready) {
      const need = next.booksAt - read;
      this.showMessageModal({ kind: dress.kind, art: dress.art, title,
        body: `The next prize is ${itemName(next.id)}, at ${next.booksAt} books. Read ${need} more. `
          + `Every ${Macros.SCHOLAR_BOOKS_PER_PRIZE} books earns a tome. Found and bought books both count; the tome shelf repeats after a full set.` });
      return;
    }
    this.showOfferModal({
      ...dress, kind: dress.kind, title,
      get: `${this.iconSpanHTML(next.id)} ${itemName(next.id)} ×1`,
      cost: `${next.booksAt} books read`,
      blurb: 'The scholar lifts the next tome down from the shelf and sets it before you.',
      canAfford: true,
      disabledReason: this.invRoomFor(next.id) < 1
        ? 'Your bag cannot hold another copy of this tome. Equip a larger bag to collect it.' : '',
      acceptLabel: 'Collect',
      cancelLabel: 'Later',
      onAccept: () => {
        // Another open offer may already have collected this milestone.
        const current = Macros.scholarNext(this.save, shelf);
        if (!current?.ready || current.index !== next.index) return;
        // Credit the milestone only after the complete prize fits; refresh
        // and persist once, with both the tome and claim ledger updated.
        if (!this.addToInv(next.id, 1, false, { notWild: true, deferRefresh: true })) return;
        Macros.scholarClaim(this.save, shelf);
        this._finishInventoryChange();
        this.flashLoot('Tome collected', '#ffe066', 1, next.id);
        this._macroTransaction('scholar', `You received ${itemName(next.id)} for ${next.booksAt} books collected. Your books remain yours.`);
      },
    });
  }

  // TRAINING HALL: one DISCIPLINE per hall (Macros.trainingKindFor — melee,
  // ranged or magic damage, max energy, attack speed; Combat.TRAINING_KINDS).
  // A LEVEL for good (money AND memories recovered — Macros.buyLesson) or a
  // day-long DRILL (money only, one at a time). All of it lands in
  // Combat.trainingBonus, read by _attackFlat, trainingIntervalMul and
  // Energy.maxEnergy.
  _presentTraining(sx, sy, o, dress) {
    const kind = Macros.trainingKindFor(o);
    const row = Combat.TRAINING_KINDS[kind];
    const lp = Macros.lessonPrice(this.save, kind);
    const need = Macros.lessonMemories(this.save, kind);
    const have = this.memoriesTotal();
    const dp = Macros.drillPrice();
    const left = Macros.drillLeftMs(this.save, kind);
    const money = this.save.money ?? 0;
    const drillLine = left > 0 ? ` Drill again in ${shortDuration(left)}.` : '';
    const hint = row.unit === 'energy' ? 'Your breath deepens with each lesson.'
      : row.unit !== 'dmg' ? 'Your hands begin to move before you think.'
      : 'The master adjusts your stance. The next strike feels surer.';
    const refresh = () => {
      this._finishInventoryChange();
      if (row.unit === 'energy' && this.updateEnergyDOM) this.updateEnergyDOM();
    };
    this.showOfferModal({
      ...dress, kind: dress.kind,
      title: `The master teaches ${row.label.toLowerCase()}:`,
      get: lp != null ? 'A lesson that stays with you' : 'The master has taught you all they can',
      cost: lp != null ? `${this.moneyHTML(lp)} · ${need} memories required` : undefined,
      blurb: `${hint}${drillLine}`,
      canAfford: lp != null && money >= lp && have >= need,
      acceptLabel: 'Train',
      cancelLabel: 'Later',
      secondary: {
        label: `Drill ${this.moneyHTML(dp, 12)}`,
        disabled: left > 0 || money < dp,
        onClick: () => {
          const r = Macros.buyDrill(this.save, kind);
          if (!r.ok) { if (r.why === 'money') this.flash(`need ${r.price}`, sx, sy); return; }
          refresh();
          this.flash(`Drilled for ${shortDuration(Combat.TRAINING_BUFF_MS)}.`, sx, sy);
          this._macroTransaction('training', `You paid ${this.moneyHTML(r.price)} for a ${row.label.toLowerCase()} drill. Its bonus lasts ${shortDuration(Combat.TRAINING_BUFF_MS)}.`);
        },
      },
      onAccept: () => {
        const r = Macros.buyLesson(this.save, kind, this.memoriesTotal());
        if (!r.ok) {
          if (r.why === 'money') this.flash(`need ${r.price}`, sx, sy);
          else if (r.why === 'memories') this.flash(`need ${r.need} memories`, sx, sy);
          return;
        }
        refresh();
        this.flash(`${row.label} level ${Combat.trainingLevel(this.save, kind)}!`, sx, sy);
        this._macroTransaction('training', `You paid ${this.moneyHTML(r.price)} and reached ${row.label.toLowerCase()} level ${Combat.trainingLevel(this.save, kind)}. This lesson is permanent.`);
      },
    });
  }

  buildingFlavorTitle(house, action) {
    const castle = isCastle(house);
    const isFort   = !!house && house.tier === 11;
    const st = (!castle && !isFort && house) ? this.houseShopRole(house) : null;
    if (action === 'forge')   return 'The blacksmith will forge:';
    if (action === 'relic') {
      if (castle) return "The castle's vault holds:";
      if (isFort)   return 'The fort quartermaster offers a relic:';
      if (st === 'wizard') return 'The wizard conjures a relic:';
      return 'A villager offers a relic:';
    }
    // 'buy'
    if (castle) return "From the castle's vault:";
    if (isFort)   return 'The fort quartermaster offers:';
    // Named for its line, so the words match the sign outside: "The potion
    // shop has fresh stock:".
    if (st === 'market') {
      return `The ${Shops.roleLabel('market', this.marketTheme(house).theme).toLowerCase()} has fresh stock:`;
    }
    if (st === 'trader')     return 'The trader proposes a barter:';
    if (st === 'blacksmith') return 'The blacksmith has on hand:';
    if (st === 'wizard')     return 'The wizard conjures a relic:';
    return 'A villager offers:';
  }
  // ── HOME: a Sell page and a Craft page ───────────────────────────────
  // The trailer's panel, as the blacksmith's Forge / Smelt is: sibling
  // offer modals joined by a tab row, each tab re-presenting the other. A
  // new page is a new tab here and a present* method beside these two.
  _homeTabs(active, sx, sy) {
    return [
      { label: 'Sell',  active: active === 'sell',  onSelect: () => this.presentHomeSell(sx, sy) },
      { label: 'Craft', active: active === 'craft', onSelect: () => this.presentHomeCraft(sx, sy) },
    ];
  }
  // The dialog opens with Home's own sprite when Home is the trailer; an
  // adopted house falls back to the category glyph.
  _homeKindIcon() {
    const st = this.save.starterTrailer;
    return (st && st.id === this.save.starterShopId)
      ? (this.worldIconHTML('house_trailer', 30) || undefined) : undefined;
  }

  // SELL page: one item per tap from the selected stack — confirm first so
  // an accidental home tap can't silently dump a high-value item. Sword relic
  // scales the price from half (no sword) up to full base value at tier 7, and
  // the trailer takes a flat 25% off that (TRAILER_SELL_MUL, items.js). No shop
  // specialty bonus at home — it's a private sale, not a shopkeep's bid.
  presentHomeSell(sx, sy, targetId = null) {
    const sel = targetId == null ? this.save.inv[this.save.selSlot]
      : this.save.inv.find(stack => stack.id === targetId && stack.count > 0);
    const hasSel = sel && sel.id && (sel.count ?? 0) > 0;
    const tabs = this._homeTabs('sell', sx, sy);
    const kindIcon = this._homeKindIcon();
    // Nothing sellable in hand: the page says what it is for rather than
    // flashing a stock phrase — selling is home-only, the single most
    // easily-missed rule in the economy.
    if (!hasSel) {
      this.showOfferModal({
        kind: 'shop', kindIcon, tabs, art: 'home_sell',
        title: 'Sell from your stash',
        get: targetId ? 'Sold out' : 'Nothing picked to sell',
        blurb: 'Pick a stack in your bag, then tap Home to sell it.',
        cost: '', canAfford: false, cancelLabel: 'Leave', acceptLabel: 'Sell',
        repeat: () => this.presentHomeSell(sx, sy, targetId),
        onAccept: () => {},
      });
      return;
    }
    const unitPrice = trailerSellPrice(PRICES[sel.id] ?? 1);
    const item = ITEM_BY_ID[sel.id];
    const sellId = sel.id;
    const iconHTML = this.iconSpanHTML(sellId);
    const itemName = item?.name || sellId;
    this.showOfferModal({
      kind: 'shop', kindIcon, tabs, art: 'home_sell',
      title: 'Sell from your stash?',
      get: this.moneyHTML(`+${unitPrice}`),
      cost: `1× ${iconHTML} ${itemName}`,
      canAfford: true,
      acceptLabel: 'Sell',
      cancelLabel: 'Leave',
      repeat: () => this.presentHomeSell(sx, sy, sellId),
      onAccept: () => {
        const have = Inventory.count(this.save, sellId);
        if (have <= 0) { this.flash('Gone — already used.', sx, sy); return; }
        Inventory.remove(this.save, sellId, 1);
        this._clampSelSlot();
        const gain = unitPrice;
        addMoney(this.save, gain);
        if (!this.save.storySeen?.['sale:first']) this.save.firstSalePending = true;
        this._finishInventoryChange();
        this.flashLoot(`+${gain}`, '#ffe066', 1, sellId);
        this.questEvent('sell');
        this._firstSaleStory();
      },
    });
  }

  // CRAFT page: one recipe of HOME_RECIPES (items.js) at a time, with a
  // Craft button and the ‹ › pager that walks the rest — the smithy's
  // Smelt page, pointed at Home. `targetId` defaults to the first recipe the
  // bag can make, so the page opens on something usable.
  presentHomeCraft(sx, sy, targetId = null) {
    const held = (id) => Inventory.count(this.save, id);
    const ingredientCap = (r) => recipeCap(r.cost, held);
    const capOf = (r) => Math.min(ingredientCap(r), Math.max(0, this.invRoomFor(r.id)));
    const locked = (r) => homeRecipeLocked(this.save, r.id);
    const recipes = HOME_RECIPES.filter(r => !locked(r));
    const rec = recipes.find(r => r.id === targetId)
      || recipes.find(r => capOf(r) >= 1) || recipes[0];
    const cap = capOf(rec);
    const outName = itemName(rec.id);
    const learnVerb = ITEM_BY_ID[rec.id]?.scroll ? 'Use' : 'Find';
    const costLine = rec.cost.map(c => {
      const ok = held(c.id) >= c.qty;
      return `<span style="color:${ok ? '#a7ffb0' : '#ff8a7a'}">`
        + `${c.qty}× ${this.iconSpanHTML(c.id)} ${itemName(c.id)}</span>`;
    }).join(' + ');
    const idx = recipes.indexOf(rec);
    const n = recipes.length;
    const pageTo = (r) => () => this.presentHomeCraft(sx, sy, r.id);
    this.showOfferModal({
      kind: 'craft', kindIcon: this._homeKindIcon(),
      tabs: this._homeTabs('craft', sx, sy),
      title: 'Make something at home:',
      cancelLabel: 'Leave',
      get: `1× ${this.iconSpanHTML(rec.id)} ${outName}`,
      blurb: ITEM_EFFECTS[rec.id] ? `✦ ${ITEM_EFFECTS[rec.id]}` : undefined,
      cost: costLine,
      canAfford: cap >= 1,
      acceptLabel: 'Craft',
      getLabel: 'You make', costLabel: 'You use',
      repeat: () => this.presentHomeCraft(sx, sy, rec.id),
      pager: {
        index: idx, count: n, showIndex: false,
        onPrev: pageTo(recipes[(idx - 1 + n) % n]),
        onNext: pageTo(recipes[(idx + 1) % n]),
      },
      onAccept: () => {
        if (locked(rec)) { this.flash(`${learnVerb} a ${outName} first.`, sx, sy); return; }
        if (this.invRoomFor(rec.id) < 1) {
          this.flash(`Bag full for ${outName}.`, sx, sy);
          return;
        }
        if (ingredientCap(rec) < 1) {
          const missing = rec.cost.find(c => held(c.id) < c.qty);
          const short = missing ? missing.qty - held(missing.id) : 0;
          this.flash(missing ? `Need ${short} more ${itemName(missing.id)}.`
                             : 'Not enough to craft.', sx, sy);
          return;
        }
        for (const c of rec.cost) Inventory.remove(this.save, c.id, c.qty);
        this._clampSelSlot();
        this.addToInv(rec.id, 1, false, { notWild: true, deferRefresh: true });
        this._finishInventoryChange();
        this.flashLoot(`✨ ${outName} ×1`, '#ffe066', 1.25, rec.id);
      },
    });
  }

  // ─── FORT SLOTS ───────────────────────────────────────────────────────────
  // A fort's quartermaster runs a three-reel slot machine. The maths — the
  // day's three prizes, the jackpot and its pair payout, the fair stake, a
  // spin — is ShopsMath's (slotPrizes / slotMachine / slotSpin); this is the
  // machine. The prizes are not listed on its face: the reels are the show.
  // Prizes come from what a find can be (seeds, produce, consumables,
  // minerals) at their catalog worth (PRICES), which is what the stake is
  // priced on. A natural triple pays double of anything that stacks — every
  // prize today; a relic, which is one of a kind, would not.
  fortSlotMachine(house) {
    const kinds = new Set(FORT_SLOT_KINDS);
    const cands = ITEMS.filter((it) => kinds.has(it.kind) && (PRICES[it.id] ?? 0) > 0
      && !FORT_SLOT_EXCLUDE.has(it.id)).map((it) => it.id);
    const ids = ShopsMath.slotPrizes(`slots:${house.id}:${utcDayKey()}`, cands);
    return ShopsMath.slotMachine(ids, (id) => PRICES[id] ?? 0,
      (id) => ITEM_BY_ID[id]?.kind !== 'relic');
  }

  // One reel symbol as HTML: a prize's own icon, or the star.
  _slotSymbolHTML(sym, px) {
    if (!sym.star) return this.iconSpanHTML(sym.id, px);
    const sh = ICON_SHEETS.pickup;
    const k = px / 16;
    const col = FORT_SLOT_STAR_FRAME % sh.cols, row = Math.floor(FORT_SLOT_STAR_FRAME / sh.cols);
    return `<span style="display:inline-block;vertical-align:middle;width:${px}px;height:${px}px;`
      + `image-rendering:pixelated;background-image:url('${sh.url}');`
      + `background-size:${sh.srcW * k}px ${sh.srcH * k}px;background-position:-${col * px}px -${row * px}px"></span>`;
  }

  // Three stars: a memory for each of the first SLOT_STAR_BADGES
  // times — keyed slots:stars:1..N in the discovery ledger, so the count IS the
  // ledger and nothing new reaches the save — then SLOT_STAR_JACKPOT_COINS.
  // Returns the line the machine prints.
  _payStarJackpot(mul = 1) {
    const found = this.save.discovered || {};
    let n = 0;
    while (n < ShopsMath.SLOT_STAR_BADGES && found[`slots:stars:${n + 1}`]) n++;
    if (n < ShopsMath.SLOT_STAR_BADGES) {
      this._bankDiscovery(`slots:stars:${n + 1}`, 'three stars on a fort slot machine');
      return 'THREE STARS! A memory returns';
    }
    const coins = ShopsMath.SLOT_STAR_JACKPOT_COINS * mul;   // deluxe doubles the coin
    addMoney(this.save, coins);
    this.updateHUD();
    return `THREE STARS! +${coins} coin`;
  }

  presentFortSlots(sx, sy, house) {
    const m = this.fortSlotMachine(house);
    if (!m.prizes.length) { this.flash('The machine is broken.', sx, sy); return; }
    const { wrap, box, mount, mkBtn } = this.makeModalShell('slots-modal',
      { kind: 'slots' });
    const GOLD = '#ffd24a';
    const TITLE = "The quartermaster's slot machine — three of a kind wins, and a star completes a pair:";
    const title = document.createElement('div');
    title.style.cssText = 'opacity:.75;font-size:11px;margin-bottom:8px';
    title.textContent = TITLE;
    box.appendChild(title);
    // DELUXE (ShopsMath.slotDeluxeNext): two stars beside the jackpot light
    // the machine up for the next SLOT_DELUXE_SPINS spins, every prize that
    // doubles paid twice over. The count lives in the save (save.slotDeluxe)
    // so walking away doesn't end it, and one count serves every fort.
    const deluxeLeft = () => Math.max(0, this.save.slotDeluxe | 0);
    const plainBox = box.style.cssText;
    const reelStyle = (el, on) => {
      el.style.border = `2px solid ${on ? GOLD : '#666'}`;
      el.style.background = on ? 'radial-gradient(circle,#3a2c08,#0d0b09)' : '#0d0b09';
      el.style.boxShadow = on ? `0 0 10px ${GOLD}88, inset 0 0 10px #000` : 'inset 0 0 10px #000';
    };
    // The reels.
    const reelRow = document.createElement('div');
    reelRow.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-bottom:8px;';
    const reels = [];
    for (let r = 0; r < ShopsMath.SLOT_REELS; r++) {
      const el = document.createElement('div');
      el.style.cssText = 'width:58px;height:58px;display:flex;align-items:center;justify-content:center;'
        + 'border-radius:8px;';
      reelStyle(el, false);
      el.innerHTML = this._slotSymbolHTML(m.symbols[r % m.symbols.length], 34);
      reelRow.appendChild(el);
      reels.push(el);
    }
    box.appendChild(reelRow);
    const result = document.createElement('div');
    result.style.cssText = 'min-height:18px;font-weight:700;margin-bottom:8px;';
    box.appendChild(result);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;justify-content:center;';
    const later = mkBtn('Later', false, false);
    const spin = mkBtn(`Spin ${this.moneyHTML(m.cost, 12)}`, true, false);
    row.appendChild(later);
    row.appendChild(spin);
    box.appendChild(row);
    // The fancy face: a gold rim and glow on the cabinet and the reels, and the
    // title turned into the countdown. The cabinet is redrawn after every
    // settle; the reels only at rest (on open) and when a spin starts, so a
    // win's lit reels stay lit until the next pull.
    const paintDeluxe = (withReels) => {
      const n = deluxeLeft();
      if (n > 0) {
        box.style.cssText = plainBox + `;border:2px solid ${GOLD};`
          + `box-shadow:0 0 24px ${GOLD}aa, inset 0 0 18px ${GOLD}33;`
          + 'background:linear-gradient(160deg,#3a2a0a,#1a1408 55%,#2e2208);';
        title.style.opacity = '1';
        title.style.color = GOLD;
        title.style.fontWeight = '700';
        title.textContent = `✨ DELUXE ✨ ${n} spin${n === 1 ? '' : 's'} left — prizes doubled`;
      } else {
        box.style.cssText = plainBox;
        title.style.opacity = '.75';
        title.style.color = '';
        title.style.fontWeight = '';
        title.textContent = TITLE;
      }
      if (withReels) reels.forEach((el) => reelStyle(el, n > 0));
    };
    let spinning = false;
    const timers = [];
    const setSpinEnabled = () => {
      const ok = !spinning && (this.save.money ?? 0) >= m.cost;
      spin._setEnabled(ok);   // mkBtn's one enabled/disabled look
      later._setEnabled(!spinning);
    };
    later.addEventListener('click', (e) => {
      e.stopPropagation();
      if (spinning) return;
      timers.forEach(clearTimeout);
      wrap.remove();
    });
    spin.addEventListener('click', (e) => {
      e.stopPropagation();
      if (spinning) return;
      if ((this.save.money ?? 0) < m.cost) { result.textContent = `Need ${m.cost} coin.`; return; }
      addMoney(this.save, -m.cost);
      this.updateHUD();
      persistSave(this.save);
      spinning = true;
      setSpinEnabled();
      result.textContent = '';
      // The spin's deluxe state is fixed when it is paid for, and the count
      // moves on at once (persisted), so closing mid-spin can't dodge it.
      const wasDeluxe = deluxeLeft() > 0;
      const out = ShopsMath.slotSpin(m, Math.random, wasDeluxe);
      this.save.slotDeluxe = ShopsMath.slotDeluxeNext(deluxeLeft(), out);
      persistSave(this.save);
      reels.forEach((el) => reelStyle(el, wasDeluxe));
      // Each reel flickers through random prizes, then stops in turn.
      reels.forEach((el, r) => {
        const tick = setInterval(() => {
          const p = m.symbols[Math.floor(Math.random() * m.symbols.length)];
          el.innerHTML = this._slotSymbolHTML(p, 34);
        }, FORT_SLOT_TICK_MS);
        timers.push(setTimeout(() => {
          clearInterval(tick);
          el.innerHTML = this._slotSymbolHTML(m.symbols[out.reels[r]], 34);
          if (r === reels.length - 1) settle();
        }, FORT_SLOT_FIRST_STOP_MS + r * FORT_SLOT_STOP_GAP_MS));
        timers.push(tick);
      });
      const settle = () => {
        spinning = false;
        // Light the reels that paid: every reel on a prize win (the star that
        // completed it included), the jackpots of a jackpot pair, the stars.
        const light = (color, which) => reels.forEach((el, r) => {
          if (!which(m.symbols[out.reels[r]])) return;
          el.style.borderColor = color; el.style.boxShadow = `0 0 12px ${color}`;
        });
        if (out.deluxe) {
          light(GOLD, (sym) => sym.star || sym.jackpot);
          result.style.color = GOLD;
          // The machine's other memory (beside SLOT_STAR_BADGES of three
          // stars): the FIRST deluxe ever, one ledger key, so it pays once.
          const firstDeluxe = this._bankDiscovery('slots:deluxe', 'the first deluxe on a fort slot machine');
          result.textContent = (wasDeluxe
            ? `DELUXE again! Back to ${ShopsMath.SLOT_DELUXE_SPINS} spins`
            : `DELUXE! ${ShopsMath.SLOT_DELUXE_SPINS} spins, prizes doubled`)
            + (firstDeluxe ? ' — and a memory returns' : '');
          if (firstDeluxe) persistSave(this.save);
          this.flashJackpot(1, '✨ DELUXE ✨');
        } else if (out.starJackpot) {
          light(GOLD, () => true);
          result.style.color = GOLD;
          result.textContent = this._payStarJackpot(out.doubled ? ShopsMath.SLOT_DELUXE_MUL : 1);
          this.flashJackpot(1, '✨ THREE STARS ✨');
          persistSave(this.save);
        } else if (out.won >= 0) {
          const p = m.symbols[out.won];
          const name = itemName(p.id);
          const rim = p.jackpot ? GOLD : '#a7ffb0';
          light(rim, () => true);
          // As many as fit go in the bag; the rest is paid in coin at the
          // worth the stake was priced on.
          const qty = out.qty || 1;
          const fit = Math.min(qty, Math.max(0, this.invRoomFor(p.id)));
          if (fit > 0) this.addToInv(p.id, fit, false, { notWild: true, deferRefresh: true });
          const paid = (qty - fit) * p.value;
          if (paid > 0) { addMoney(this.save, paid); this.updateHUD(); }
          const what = qty > 1 ? `${qty}× ${name}` : name;
          result.style.color = rim;
          result.textContent = (p.jackpot ? `JACKPOT! ${what}` : `You win: ${what}`)
            + (out.natural && out.doubled ? ' (natural + deluxe)'
              : out.natural && qty > 1 ? ' (natural — double)'
              : out.doubled ? ' (deluxe — double)' : '')
            + (paid > 0 ? ` — bag full, ${paid} coin for the rest` : '');
          const tag = qty > 1 ? ` ×${qty}` : '';
          const line = p.jackpot ? `🎰 JACKPOT${tag}` : `🎰 You win${tag}`;   // ≤ 13 chars
          this.flashLoot(line, rim, p.jackpot ? 1.5 : 1.2, p.id);
          if (p.jackpot) this.flashJackpot(1, '✨ JACKPOT ✨');
          this._finishInventoryChange();
        } else if (out.coins > 0) {
          // Two jackpots (not three, no star to finish them), or two stars.
          addMoney(this.save, out.coins);
          this.updateHUD();
          persistSave(this.save);
          const twoStars = out.reels.filter((i) => m.symbols[i].star).length === 2;
          light(GOLD, twoStars ? (sym) => sym.star : (sym) => sym.jackpot);
          result.style.color = GOLD;
          result.textContent = (twoStars ? `Two stars! +${out.coins} coin` : `So close! +${out.coins} coin`)
            + (wasDeluxe ? ' (deluxe ×2)' : '');
        } else {
          result.style.color = '#ff8a7a';
          result.textContent = 'No match.';
        }
        paintDeluxe(false);
        setSpinEnabled();
      };
    });
    paintDeluxe(true);
    setSpinEnabled();
    mount();
  }

  // WHERE HOME IS, in absolute world metres — the synthetic starter trailer's
  // own position, or the object of the real house adopted in its place (both
  // are save.starterShopId) — or null when Home isn't placed yet, or its tile
  // isn't loaded, or the player is underground.
  //   SURFACE ONLY, for the reason _nearAny refuses to let a placed ward cross
  // depths: the world is GPS-mirrored down the levels, so a Home on the
  // surface must not light, warm or ward a cave at the same (x, y).
  //   MEMOISED on the home id, because all three of Home's effects ask this
  // every frame and the adopted-house branch is a walk of every object in
  // every cached tile. Only a HIT is memoised: a miss means the house's tile
  // simply isn't loaded yet, and caching that would leave Home dark and
  // unwarded until the player adopted somewhere else.
  // The turrets of every castle the player has claimed, near the player —
  // the ward points wanderCreatures adds beside Home. SURFACE ONLY, like
  // homeWorldPos (a surface castle must not ward the cave under it). Rescanned
  // on the turret's own cadence (TURRET_SCAN_MS): claims change rarely, and
  // the objects near the player only as the player walks.
  _castleWardPoints(now, pc) {
    if ((this.depth || 0) !== 0 || !pc) return [];
    const memo = this._castleWardScan;
    if (memo && now - memo.t < TURRET_SCAN_MS && memo.tx === pc.tx && memo.ty === pc.ty) return memo.list;
    const list = [];
    this._forEachTowerNear(pc, (o) => {
      if (o.kind === 'tower' && this.isClaimedKey(o.castle)) list.push(o);
    });
    this._castleWardScan = { t: now, tx: pc.tx, ty: pc.ty, list };
    return list;
  }

  // Every turret ('tower' object) in the 3×3 tile ring about `pc`. The two
  // turret scans (_castleWardPoints, _turretFire) re-ran every TURRET_SCAN_MS
  // — the ward one on every wander tick, enemies or not — and each walked the
  // nine tiles' WHOLE object lists (tens of thousands in a town) for the
  // handful of turrets. The turrets are derived once per tile instead
  // (util.js derivedObjects), so a rebuilt or edited tile re-derives by itself.
  _forEachTowerNear(pc, fn) {
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const e = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx + dtx, pc.ty + dty));
        if (!e) continue;
        for (const o of derivedObjects(e, '_towers', (o) => o.kind === 'tower')) fn(o);
      }
    }
  }
  // The houses of the 3×3 ring, off the same per-tile derived index idiom.
  _forEachHouseNear(pc, fn) {
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const e = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx + dtx, pc.ty + dty));
        if (!e) continue;
        for (const o of derivedObjects(e, '_houses', (o) => o.kind === 'house')) fn(o);
      }
    }
  }

  homeWorldPos() {
    if ((this.depth || 0) !== 0) return null;
    this.ensureStarterShopId();
    const homeId = this.save.starterShopId;
    if (!homeId) return null;
    const st = this.save.starterTrailer;
    if (st && st.id === homeId) return st;   // O(1) — the common case
    const memo = this._homePosMemo;
    if (memo && memo.id === homeId) return memo.pos;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'house' || o.id !== homeId) continue;
        this._homePosMemo = { id: homeId, pos: o };
        return o;
      }
    }
    return null;
  }

  // Is the player resting AT their Home? Drives the faster HOME_FULL_REST_S
  // energy-rest rate. It is a DISTANCE test — anywhere inside Home's ring
  // (HOME_R), exactly like the campfire's _nearAny('fires', …, FIRE_REST_R) —
  // because Home is a campfire you own: the same ring rests you, lights you
  // and turns enemies away.
  //   Both adopted houses and the trailer rest you on the DOORSTEP, which is
  // where the player stands while farming the plot two cells away.
  isRestingAtHome(pWX, pWY) {
    return this.inHomeRing(pWX, pWY);
  }
  // Is the world point (x, y) inside Home's ring (HOME_R)? THE one distance
  // test behind every effect of the ring that is asked about a point — the
  // rest above.
  // Surface only, through homeWorldPos; no Home, no ring.
  inHomeRing(x, y) {
    const home = this.homeWorldPos();
    if (!home) return false;
    const r = HOME_R * this.cellM;
    const dx = home.x - x, dy = home.y - y;
    return dx * dx + dy * dy <= r * r;
  }
  // May a raider (the deer) eat this crop? Its kind (Crops.raiderEats —
  // never potato). Home's yard is NOT a refuge (owner, Oct 2026): a deer may
  // walk into Home's ring and graze the beds by the door like any field —
  // a garden no deer ever visits is no garden to defend. Every crop-raid
  // test — the deer's notice, its graze, the pest pump's "is there a field
  // worth sending one at" — reads this and nothing else.
  _cropRaidable(p) {
    return raiderEatsCrop(p);
  }

  // Build a synthetic "trailer" house at (wmx, wmy), snapped to the cell-grid
  // centre like every real placed object. Worldgen never emits this object, so
  // its position is persisted to save.starterTrailer and re-injected into the
  // owning tile on every load by ensureStarterTrailerObject().
  _makeStarterTrailer(wmx, wmy) {
    // Snap through the shared cell helpers (coords.js) so the trailer lands on
    // the same cell centre every other placed object resolves to.
    const { cellIX, cellIY } = worldMetersToAbsCell(this, wmx, wmy);
    const { x, y } = absCellCenterMeters(this, cellIX, cellIY);
    const id = 'starter_trailer';
    const address = ((Math.round(x) ^ Math.round(y)) >>> 0) % 1000;
    // tier = T.BUILDING (a plain small house); the starter role overrides the
    // wreck/shop skin in the renderer, so it draws as the trailer regardless.
    this.save.starterTrailer = { id, x, y, tier: WorldGen.T.BUILDING, address };
    // The trailer IS Home from here on — set before the inject, which only
    // runs for the active Home. That inject may ADOPT a real house standing on
    // this very cell instead (it nulls save.starterTrailer and points
    // starterShopId at the house), so callers must never read
    // save.starterTrailer back after this: Home is starterShopId.
    this.save.starterShopId = id;
    this._starterTrailerObj = null;            // force a rebuild on next inject
    this.ensureStarterTrailerObject();
  }

  // Keep the synthetic trailer present in its owning tile's object list. Runs
  // every frame (cheap) so the trailer survives reloads and tile eviction —
  // worldgen output never contains it, so without this it would vanish.
  ensureStarterTrailerObject() {
    const st = this.save.starterTrailer;
    if (!st) return;
    // Surface-only. Underground, WorldGen.tileCache is repointed at the active
    // depth's cave map (setDepth), so injecting here would drop a phantom
    // trailer into a cave tile. The trailer lives on the surface — depth 0.
    if ((this.depth || 0) !== 0) return;
    // Only inject while the trailer is actually the active Home. If the player
    // has since adopted a real house (starterShopId points elsewhere), a stale
    // starterTrailer must not keep spawning a phantom trailer in the world.
    if (this.save.starterShopId !== st.id) return;
    // Rebuild the in-memory object after a reload (or position change).
    if (!this._starterTrailerObj || this._starterTrailerObj.id !== st.id) {
      this._starterTrailerObj = { kind: 'house', x: st.x, y: st.y,
        tier: st.tier, id: st.id, address: st.address, _synthetic: true };
    }
    const obj = this._starterTrailerObj;
    const { tx, ty } = worldMetersToTile(this, obj.x, obj.y);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry || !entry.objects) return;      // owning tile not loaded yet
    // A real house can land on the trailer's exact footing after this tile is
    // REBUILT: its cross-tile house dedup outcome depends on which neighbour
    // tiles happen to be cached at build time (a tile can be REBUILT under
    // you — see CLAUDE.md), so the same footing can dedupe the house away on
    // the build that ran when the trailer was first synthesized and keep it
    // on a later rebuild (or a reload, which starts the cache cold again).
    // Without this, the synthetic trailer stays locked in forever — it is
    // never re-evaluated once adopted — so the phantom trailer and the real
    // house end up sharing one cell. Defer to the real house instead.
    const real = entry.objects.find(o => o.kind === 'house' && o.id !== obj.id && !o._synthetic
      && sameAbsCell(this, o.x, o.y, st.x, st.y));
    if (real) {
      const i = entry.objects.indexOf(this._starterTrailerObj);
      if (i >= 0) entry.objects.splice(i, 1);
      this.save.starterTrailer = null;
      this._starterTrailerObj = null;
      this.save.starterShopId = real.id;
      this._setStarterCratesAt(real.x, real.y);
      return;
    }
    let present = false;
    for (const o of entry.objects) { if (o.id === obj.id) { present = true; break; } }
    if (!present) entry.objects.push(obj);
    this.clearHomeTrailerOverlap();
  }

  // Nothing sits inside the Home trailer. Its art is the 108×75 trailer PNG at
  // scale 0.6 — 65×45 px centred on its cell — so it covers its own cell whole
  // and reaches ~32px sideways and ~22px up/down into all eight neighbours. A
  // crate, tree or rock in any of those cells is drawn half-buried in the
  // trailer, which reads as a glitch rather than scenery.
  //
  // Worldgen already keeps a one-cell moat clear of scatter objects around
  // every building cell, but the trailer is synthetic: it paints no building
  // terrain, so that pass never sees it. This is the same moat, applied
  // wherever the trailer actually stands (including after "Move Home here").
  //
  // Buildings are left alone — a real house that happens to be next door is
  // part of the neighbourhood, and deleting one would take its shop with it.
  // So is ground flora: wild plants draw small and low, and the starter-area
  // clearing deliberately keeps the player's real yard planting.
  //
  // Each tile is scanned once per (trailer position, object count) — cheap
  // enough for the per-frame caller, and re-runs whenever a tile gains objects
  // (a starter crate trail seating late, an Overpass decoration arriving).
  clearHomeTrailerOverlap() {
    const st = this.save.starterTrailer;
    if (!st || (this.depth || 0) !== 0) return;
    if (this.save.starterShopId !== st.id) return;   // trailer isn't Home any more
    const home = worldMetersToAbsCell(this, st.x, st.y);
    const stamp = `${st.id}@${home.cellIX},${home.cellIY}`;
    const savedOwnerIds = SpawnOwnership.savedIds(this.save);
    // Only the trailer's own tile and its 8 neighbours can hold a cell in the
    // moat, so the rest of the cache is skipped without touching its objects.
    const htx = Math.floor(st.x / this.tileEdgeM), hty = Math.floor(st.y / this.tileEdgeM);
    for (const [key, entry] of WorldGen.tileCache) {
      if (!entry || !entry.objects) continue;
      const parts = key.split('/');
      if (Math.abs(+parts[1] - htx) > 1 || Math.abs(+parts[2] - hty) > 1) continue;
      if (entry._trailerMoat === stamp && entry._trailerMoatN === entry.objects.length) continue;
      for (let i = entry.objects.length - 1; i >= 0; i--) {
        const o = entry.objects[i];
        if (o === this._starterTrailerObj || isBuilding(o.kind) ||
            SpawnOwnership.isProtected(o, this.save, savedOwnerIds)) continue;
        const oc = worldMetersToAbsCell(this, o.x, o.y);
        if (Math.abs(oc.cellIX - home.cellIX) <= 1 && Math.abs(oc.cellIY - home.cellIY) <= 1) {
          entry.objects.splice(i, 1);
        }
      }
      entry._trailerMoat = stamp;
      entry._trailerMoatN = entry.objects.length;
    }
  }

  // ☰ menu → "Move Home here". Confirmation dialog for relocating the Home
  // trailer to the player's current position. The move costs HALF the player's
  // current coins, capped at $500 — always affordable by construction, so the
  // dialog never needs a can't-afford state; it just shows the price.
  confirmMoveHomeTrailer() {
    // The trailer lives on the surface (ensureStarterTrailerObject is
    // depth-0-only), so relocating from inside a cave would silently target
    // the surface spot above the player. Refuse with an explanation instead.
    if ((this.depth || 0) !== 0) {
      this.showMessageModal({ title: 'Move Home',
        body: 'Your trailer stays on the surface — it has never been much of a caver. Climb back up before moving Home.' });
      return;
    }
    const cost = Math.min(500, Math.floor((this.save.money ?? 0) / 2));
    this.showConfirmModal({
      id: 'move-home-modal',
      kind: 'build',
      title: 'Move Home here?',
      body:
        'Settle your trailer here.',
      acceptLabel: `Move (${this.moneyHTML(cost, 12)})`,
      onAccept: () => {
        addMoney(this.save, -cost);
        this.moveHomeTrailerHere();
        this.updateHUD();
        if (typeof persistSave === 'function') persistSave(this.save);
        this.flashLoot('🏠 Home moved!');
      },
    });
  }

  // Relocate Home to the player's current position by (re)synthesizing the
  // starter trailer there. Works whether the current Home is a real adopted
  // house (it simply becomes a normal house again) or an existing synthetic
  // trailer (it moves). Surface-only — the confirm above guards depth.
  moveHomeTrailerHere() {
    // Evict any previously injected trailer object from the loaded tiles.
    // ensureStarterTrailerObject only dedupes within the NEW owning tile, so
    // without this sweep a moved trailer leaves a phantom copy in its old
    // tile's object list until that tile is evicted.
    for (const e of WorldGen.tileCache.values()) {
      if (!e.objects) continue;
      const i = e.objects.findIndex((o) => o._synthetic && o.id === 'starter_trailer');
      if (i >= 0) e.objects.splice(i, 1);
    }
    // playerM → absolute world metres (the space every object's x/y lives in).
    const ax = this.startWorldM.x + this.playerM.x;
    const ay = this.startWorldM.y + this.playerM.y;
    this._makeStarterTrailer(ax, ay);
    this._starterShopOk = true;
  }

  isStarterBlacksmith(house) { return Houses.isStarterBlacksmith(this.save, house); }

  houseShopRole(house) { return Houses.houseShopRole(this.save, house); }

  _hasBlacksmith() { return Houses.hasBlacksmith(this.save); }
}
