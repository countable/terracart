// The scene's VENUES — the buildings you step into rather than shop at:
//   · macro stories and transactions, the inn, guildhall (and its bounty),
//     curio, scholar and training rooms;
//   · Home's sell / craft tabs, the fort's slot machine and castle wards;
//   · where Home is (homeWorldPos / inHomeRing) and the starter trailer.
//
// Moved out of app.js (bodies as the consolidation branch left them: receipts
// ride the ceremony queue, the bounty the one day ledger, Home's Craft the
// recipe counter). The methods live on `class SceneVenues`, a MIXIN:
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
  // A bounty can complete while a shop or story is open: the ceremony queue
  // keeps its receipt until that dialog ends, ahead of queued memories
  // (_drainBadgeStories drains the queue before MemoryStory).
  _macroTransaction(kind, body, onDismiss) {
    const d = Macros.KIND_DIALOG[kind], receipt = Macros.KIND_TRANSACTION[kind];
    if (!d || !receipt) return;
    this._enqueueCeremony('receipt', (done) => {
      this.showMessageModal({ kind: d.modal, kindLabel: d.label, art: receipt.art, title: receipt.title, body,
        onDismiss: () => { onDismiss?.(); done(); } });
      return true;
    });
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
    const names = b.kinds.map((k) => EnemyRoster.get(k)?.name || 'Slime');
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
  // Returns how many were seated (0: no ground; nothing is posted). The day it
  // belongs to is the one day ledger's GUILD_BOUNTY_LEDGER mark (app.js), not
  // a day field of its own.
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
    this._guildBounty = { id: b.id, pay: b.pay, foes };
    Macros.markToday(this.save, GUILD_BOUNTY_LEDGER, now);   // today's, in the one day ledger
    this.save.guildBounty = this._guildBounty;
    return foes.length;
  }
  // Today's bounty, if one is out: the live one, or the one the save kept
  // (a reload). A bounty from another UTC day (the day ledger's
  // GUILD_BOUNTY_LEDGER mark has lapsed) is dropped here.
  _guildBountyNow() {
    if (!this._guildBounty && this.save.guildBounty) this._guildBounty = this.save.guildBounty;
    const gb = this._guildBounty;
    if (gb && !Macros.usedToday(this.save, GUILD_BOUNTY_LEDGER)) {
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
    this.flashLoot(`Bounty paid! +${gb.pay}`, UI_GOLD, 1);
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
    if (!Macros.usedToday(this.save, GUILD_BOUNTY_LEDGER)) {
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
      if (left) this.flashAtPlayer('The bounty got away.');
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


  // BANK: today's deal at this counter (Macros.bankOfferKind — borrow or
  // invest), in three sizes (Macros.BANK_SHARES, a tab each; `share` is the
  // tab shown). A matured investment held HERE is collected first; the rules
  // and the ledger are src/macros.js's, the debt's collector _tickBankDebt.
  _presentBank(sx, sy, o, dress, share = 0, now = Date.now()) {
    const save = this.save;
    const inv = save.bankInvest;
    const pct = Math.round(Macros.BANK_INTEREST * 100);
    if (inv && inv.bank === o.id) {
      const pay = Macros.bankWithInterest(inv.principal);
      if (now < inv.due) {
        this.showMessageModal({ ...dress, kind: dress.kind, title: 'Your savings',
          body: `You have ${this.moneyHTML(inv.principal)} on deposit here. It returns ${this.moneyHTML(pay)} in ${shortDuration(inv.due - now)}.` });
        return;
      }
      this.showOfferModal({
        ...dress, kind: dress.kind, title: 'Your savings have matured:',
        get: `Collect ${this.moneyHTML(pay)}`,
        blurb: `Your ${this.moneyHTML(inv.principal)} deposit plus ${pct}% interest.`,
        canAfford: true, acceptLabel: 'Collect', cancelLabel: 'Later',
        onAccept: () => {
          const got = Macros.bankWithdraw(save, o);
          if (!got) return;
          persistSave(save);
          this._finishInventoryChange?.();
          this.flashLoot(`+${got}`, UI_GOLD, 1, null, this.coinIconEl());
          this._macroTransaction('bank', `You collected ${this.moneyHTML(got)}: your deposit and its interest.`);
        },
      });
      return;
    }
    const kind = Macros.bankOfferKind(o, now);
    const wait = shortDuration(msToNextUtcDay(now));
    if (kind === 'borrow') {
      const block = Macros.bankBorrowBlock(save, now);
      if (block === 'loan') {
        const l = save.bankLoan;
        this.showMessageModal({ ...dress, kind: dress.kind, title: 'The bank is lending today',
          body: `You already owe ${this.moneyHTML(l.owed)}. A collector comes for it in ${shortDuration(Math.max(0, l.due - now))}; the bank lends no more until it is settled.` });
        return;
      }
      if (block === 'today') {
        this.showMessageModal({ ...dress, kind: dress.kind, title: 'The bank is lending today',
          body: `The bank lends once a day. Come back in ${wait}.` });
        return;
      }
    } else if (inv) {
      this.showMessageModal({ ...dress, kind: dress.kind, title: 'The bank takes deposits today',
        body: `You already have ${this.moneyHTML(inv.principal)} on deposit at another bank. Collect it there first.` });
      return;
    }
    const cap = kind === 'borrow' ? Macros.bankBorrowCap(save) : Macros.bankInvestCap(save);
    const amounts = Macros.bankAmounts(cap);
    if (!amounts.length) {
      this.showMessageModal({ ...dress, kind: dress.kind, title: 'The bank takes deposits today',
        body: `Bring coins to invest. The bank returns them with ${pct}% interest after a day.` });
      return;
    }
    const pick = amounts[Math.min(share, amounts.length - 1)];
    const back = Macros.bankWithInterest(pick.amount);
    const term = shortDuration(Macros.BANK_TERM_MS);
    const borrow = kind === 'borrow';
    this.showOfferModal({
      ...dress, kind: dress.kind,
      title: borrow ? 'The bank is lending today:' : 'The bank takes deposits today:',
      tabs: amounts.map((a, i) => ({ label: `${a.label} · ${a.amount}`, active: a === pick,
        onSelect: () => this._presentBank(sx, sy, o, dress, i) })),
      get: `${borrow ? 'Borrow' : 'Invest'} ${this.moneyHTML(pick.amount)}`,
      blurb: borrow
        ? `Owe ${this.moneyHTML(back)} in ${term}. A pirate will come to collect it, and he fights if you refuse to pay. You can borrow up to ${Macros.BANK_BASE} coins plus ${Macros.BANK_PER_MEMORY} for each memory.`
        : `Collect ${this.moneyHTML(back)} from this bank after ${term}.`,
      canAfford: true,
      acceptLabel: borrow ? 'Borrow' : 'Invest', cancelLabel: 'Later',
      onAccept: () => {
        const done = borrow ? Macros.bankBorrow(save, o, pick.amount) : Macros.bankInvest(save, o, pick.amount);
        if (!done) return;
        persistSave(save);
        this._finishInventoryChange?.();
        if (borrow) this.flashLoot(`+${pick.amount}`, UI_GOLD, 1, null, this.coinIconEl());
        this._macroTransaction('bank', borrow
          ? `You borrowed ${this.moneyHTML(pick.amount)}. In ${term} a collector will ask for ${this.moneyHTML(back)}.`
          : `You deposited ${this.moneyHTML(pick.amount)}. Return here after ${term} to collect ${this.moneyHTML(back)}.`);
      },
    });
  }

  // THE DEBT COLLECTOR, asked each frame: once a bank loan falls due
  // (Macros.bankLoanDue), the first moment the player is about on the
  // surface with no dialog open, a pirate (Macros.BANK_COLLECTOR_KIND) steps
  // up BANK_COLLECTOR_DIST_CELLS away (never inside Home's ward, which would
  // rout him) and asks for the debt. He stands pacified while he asks
  // (`_pirateParleyPending`; pirates.js leaves a collector's flags alone).
  // Pay: the loan closes and he leaves. Refuse: the loan closes and he
  // fights. A reload before the answer brings a new collector.
  _tickBankDebt(now = Date.now()) {
    const pend = this._bankCollector;
    if (pend) {
      // Another dialog can replace the offer without its callback: ask again
      // once the screen is clear.
      if (pend.modal && !pend.modal.isConnected && !this._dialogOpen?.()) this._presentBankCollector(pend.c);
      return;
    }
    const loan = Macros.bankLoanDue(this.save, now);
    if (!loan || (this.depth || 0) !== 0 || this._dialogOpen?.() || this._passingOut || this.save.exhausted) return;
    if (now < (this._bankCollectorRetryAt || 0)) return;
    this._bankCollectorRetryAt = now + 3000;
    const homePos = this.homeWorldPos();
    const dest = this.findWalkableDestination(Macros.BANK_COLLECTOR_DIST_CELLS, {
      seed: 'bankdebt:' + loan.due, cls: 'enemy',
      accept: (x, y) => !homePos || Math.hypot(x - homePos.x, y - homePos.y) > HOME_R * this.cellM,
    });
    if (!dest) return;
    const { entry, tx, ty } = dest;
    const id = `debtor_${tx}_${ty}_${Math.floor(now)}`;
    const c = WorldGen.makeCreature(Macros.BANK_COLLECTOR_KIND, dest.x, dest.y, id,
      { shiny: false, debtCollector: true, _pirateParleyPending: true });
    entry.creatures = entry.creatures || [];
    entry.creatures.push(c);
    this._presentBankCollector(c);
  }
  _presentBankCollector(c) {
    const loan = this.save.bankLoan;
    if (!loan) { this._bankCollector = null; c._pirateParleyPending = false; return; }
    const pend = this._bankCollector = { c, modal: null };
    let settled = false;
    const settle = (pay) => {
      if (settled || this._bankCollector !== pend) return;
      settled = true;
      this._bankCollector = null;
      const paid = pay && Macros.bankLoanSettle(this.save, true);
      if (!paid) Macros.bankLoanSettle(this.save, false);
      persistSave(this.save);
      if (paid) {
        // His business is done: he leaves the street.
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(Math.floor(c.x / this.tileEdgeM), Math.floor(c.y / this.tileEdgeM)));
        const i = entry?.creatures?.indexOf(c) ?? -1;
        if (i >= 0) entry.creatures.splice(i, 1);
        this._finishInventoryChange?.();
        this.flashAtPlayer('The pirate pockets the coins and leaves.');
      } else {
        c._pirateParleyPending = false;
        this.flashAtPlayer('The pirate draws his cutlass!');
      }
    };
    const short = (this.save.money ?? 0) < loan.owed;
    this.showOfferModal({
      kind: 'trade', title: 'A debt collector',
      get: `Repay ${this.moneyHTML(loan.owed)}`,
      blurb: `“Arr! The bank sent me. You borrowed ${loan.principal} coins, and with interest you owe ${loan.owed}. Pay up, or we settle it with steel.”`
        + (short ? ' You do not have enough coins.' : ''),
      canAfford: !short,
      acceptLabel: `Pay ${loan.owed} coins`, cancelLabel: 'Refuse',
      onAccept: () => settle(true),
      onCancel: () => settle(false),
    });
    pend.modal = document.getElementById('offer-modal');
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
        this.flashLoot(line, UI_GOLD, 1, id);
        this._macroTransaction('curio', `You donated ${itemName(id)}. The collection now holds ${r.count} curios${r.milestone ? ', and a memory has returned' : ''}.`);
      },
    });
  }

  // One shared lending shelf. Keep credit and actions in view while the
  // catalog pages; transactions update in place so preparing several
  // spells never sends the player through a chain of confirmation dialogs.
  _presentScholar(sx, sy, o, dress) {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('scholar-modal', {
      kind: dress.kind, kindLabel: 'Book Club', art: dress.art,
    });
    const credit = document.createElement('div');
    credit.id = 'scholar-credit';
    credit.style.cssText = 'color:#ffe066;font-weight:700;margin-bottom:5px';
    box.appendChild(credit);
    const help = document.createElement('details');
    const helpTitle = document.createElement('summary');
    helpTitle.textContent = 'How lending works';
    helpTitle.style.cssText = 'font-size:11px;cursor:pointer;padding:3px 0 6px';
    help.appendChild(helpTitle);
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;line-height:1.4;opacity:.85;margin-bottom:7px';
    hint.textContent = 'Each collected Book gives 1 credit. Return tomes here or at another Book Club to free credit. Returns keep spell cooldowns.';
    help.appendChild(hint);
    box.appendChild(help);
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
    box.appendChild(tabs);
    const list = document.createElement('div');
    list.id = 'scholar-shelf';
    list.style.cssText = 'text-align:left;';
    list.setAttribute('aria-label', 'Tomes available to borrow');
    box.appendChild(list);
    let shelfPage = 0;
    const pager = document.createElement('div');
    pager.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;';
    const previous = mkBtn('Previous', { variant: 'ghost', css: 'padding:6px 9px;' });
    const pageLabel = document.createElement('span');
    pageLabel.style.fontSize = '11px';
    pageLabel.setAttribute('aria-live', 'polite');
    const next = mkBtn('Next', { variant: 'ghost', css: 'padding:6px 9px;' });
    pager.append(previous, pageLabel, next);
    box.appendChild(pager);
    const receipt = document.createElement('div');
    receipt.id = 'scholar-receipt';
    receipt.setAttribute('role', 'status');
    receipt.style.cssText = 'font-size:11px;min-height:15px;margin:6px 0;';
    box.appendChild(receipt);
    const close = mkBtn('Done', { variant: 'ghost' });
    close.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(close);
    let onLoanOnly = false;
    const allTab = mkBtn('All tomes', { variant: 'ghost', css: 'flex:1;padding:7px;' });
    const loansTab = mkBtn('On loan', { variant: 'ghost', css: 'flex:1;padding:7px;' });
    tabs.appendChild(allTab); tabs.appendChild(loansTab);
    const render = () => {
      const credits = Macros.scholarCredits(this.save);
      credit.textContent = `${credits.available} / ${credits.total} credits free · ${credits.used} on loan`;
      allTab.setAttribute('aria-pressed', String(!onLoanOnly));
      loansTab.setAttribute('aria-pressed', String(onLoanOnly));
      allTab.style.borderColor = !onLoanOnly ? '#ffe066' : '#555';
      loansTab.style.borderColor = onLoanOnly ? '#ffe066' : '#555';
      list.replaceChildren();
      const catalog = Macros.scholarCatalog(this.save);
      const rows = onLoanOnly ? catalog.filter(row => row.borrowed > 0) : catalog;
      shelfPage = Math.max(0, Math.min(shelfPage, rows.length - 1));
      previous._setEnabled(shelfPage > 0);
      next._setEnabled(shelfPage + 1 < rows.length);
      pageLabel.textContent = rows.length ? `${shelfPage + 1} / ${rows.length}` : '';
      pager.style.display = rows.length > 1 ? 'flex' : 'none';
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.textContent = onLoanOnly ? 'No tomes on loan. Browse the shelf to prepare your spells.' : 'The shelf is empty.';
        list.appendChild(empty);
      }
      for (const row of rows.slice(shelfPage, shelfPage + 1)) {
        const card = document.createElement('div');
        card.dataset.tome = row.id;
        card.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) 88px;gap:3px 8px;padding:8px 1px;border-top:1px solid #ffffff28;';
        const description = document.createElement('details');
        description.style.gridColumn = '1';
        const name = document.createElement('summary');
        name.style.cssText = 'display:flex;align-items:center;gap:7px;font-weight:700;cursor:pointer;';
        name.innerHTML = this.iconSpanHTML(row.id);
        const label = document.createElement('span');
        label.textContent = itemName(row.id);
        name.appendChild(label); description.appendChild(name); card.appendChild(description);
        const detail = document.createElement('div');
        detail.style.cssText = 'grid-column:1;font-size:11px;line-height:1.4;opacity:.9';
        const ownWait = Math.max(0, (this.save.tomeMagicCd?.[row.id] || 0) - Date.now());
        detail.textContent = `${row.borrowed} on loan`
          + (row.owned ? ` · ${row.owned} owned` : '')
          + (ownWait ? ` · Resting ${shortDuration(ownWait)}` : '')
          + (row.borrowed || row.owned ? ' · Copies share a cooldown.' : '');
        card.appendChild(detail);
        name.setAttribute('aria-label', `${itemName(row.id)} — spell details`);
        const effect = document.createElement('div');
        effect.style.cssText = 'font-size:11px;line-height:1.4;margin-bottom:6px;color:#9fe6ff;';
        effect.textContent = this._scholarSpellDetail(row.id);
        description.appendChild(effect);
        const reason = !row.unlocked ? `Unlocks at ${row.booksAt} Books · ${row.booksAt - Macros.booksRead(this.save)} more to collect`
          : row.why === 'credit' ? `Need ${Math.max(0, row.cost - credits.available)} more free credits`
          : row.why === 'full' ? 'Your bag cannot hold another copy.' : '';
        if (reason) {
          const why = document.createElement('div');
          why.textContent = reason;
          why.style.cssText = 'grid-column:1;font-size:11px;margin-bottom:3px;opacity:.8';
          card.appendChild(why);
        }
        const actions = document.createElement('div');
        actions.style.cssText = 'grid-column:2;grid-row:1 / span 3;display:flex;flex-direction:column;justify-content:center;gap:5px;';
        const transact = (action) => (e) => {
          e.stopPropagation();
          if (!wrap.isConnected) return;
          const r = this._scholarTransaction(action, row.id);
          receipt.textContent = r.ok
            ? `${action === 'borrow' ? 'Borrowed' : 'Returned'} ${itemName(row.id)} · ${r.cost} credits ${action === 'borrow' ? 'reserved' : 'freed'}`
            : 'The loan could not change. Check the updated shelf.';
          render();
          list.querySelector(`[data-tome="${row.id}"] button:not(:disabled)`)?.focus({ preventScroll: true });
        };
        const borrow = mkBtn(`Borrow · ${row.cost}`, { disabled: !row.canBorrow, css: 'flex:1;padding:8px 5px;' });
        borrow.setAttribute('aria-label', `Borrow ${itemName(row.id)} for ${row.cost} credits`);
        borrow.addEventListener('click', transact('borrow'));
        actions.appendChild(borrow);
        if (row.borrowed > 0) {
          const back = mkBtn('Return one', { variant: 'ghost', css: 'flex:1;padding:8px 5px;' });
          back.setAttribute('aria-label', `Return ${itemName(row.id)} and free ${row.cost} credits`);
          back.addEventListener('click', transact('return'));
          actions.appendChild(back);
        }
        card.appendChild(actions); list.appendChild(card);
      }
    };
    allTab.addEventListener('click', (e) => { e.stopPropagation(); onLoanOnly = false; shelfPage = 0; render(); });
    loansTab.addEventListener('click', (e) => { e.stopPropagation(); onLoanOnly = true; shelfPage = 0; render(); });
    previous.addEventListener('click', (e) => { e.stopPropagation(); shelfPage--; render(); });
    next.addEventListener('click', (e) => { e.stopPropagation(); shelfPage++; render(); });
    render();
    // Paging keeps each tome and its actions together in the fitted panel.
    mount();
  }

  _scholarSpellDetail(id) {
    const spec = CONSUMABLE_SPEC[id];
    const source = CONSUMABLE_SPEC[spec.tome?.of] || spec;
    const mul = spec.tome?.mul ?? 1;
    const effect = source.energy ? `Restores ${Math.floor(source.energy * mul)} HP.`
      : source.damage ? `Deals ${Math.floor(source.damage * mul)} damage to foes in sight.`
      : source.get;
    const duration = source.durationMs ? ` Lasts ${shortDuration(source.durationMs * (source === spec ? 1 : mul))}.` : '';
    const rest = spec.cooldownMs * (Wizard.isClass(this.save, 'enchanter') ? 0.5 : 1);
    return `${effect}${duration} Reusable; rests ${shortDuration(rest)} after casting.`;
  }

  _scholarTransaction(action, id) {
    const selected = getSelectedSlot(this.save)?.id;
    const result = action === 'borrow' ? Macros.scholarBorrow(this.save, id)
      : action === 'return' ? Macros.scholarReturn(this.save, id) : { ok: false, why: 'action' };
    if (!result.ok) return result;
    // Returning an earlier stack must not silently select a different spell.
    if (selected) this.save.selSlot = this.save.inv.findIndex(stack => stack.id === selected);
    this._clampSelSlot();
    this._finishInventoryChange();
    return result;
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
    const money = this.save.money ?? 0;
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
      blurb: hint,
      canAfford: lp != null && money >= lp && have >= need,
      acceptLabel: 'Train',
      cancelLabel: 'Later',
      secondary: {
        label: `Drill ${this.moneyHTML(dp, 12)}`,
        disabled: money < dp,   // a drill bought mid-drill EXTENDS it (Macros.buyDrill)
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
    if (st === 'shop') {
      return `The ${Shops.roleLabel('shop', this.shopLine(house).theme).toLowerCase()} has fresh stock:`;
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
  // The dialog opens with a house: Home is drawn from its footprint, not a
  // sprite, so the plain house art stands in for it.
  _homeKindIcon() {
    return this.worldIconHTML('house', 30, 'front') || undefined;
  }

  // SELL page: one item per tap from the selected stack — confirm first so
  // an accidental home tap can't silently dump a high-value item. Sword relic
  // scales the price from half (no sword) up to full base value at tier 7, and
  // the trailer takes a flat 25% off that (TRAILER_SELL_MUL, items.js). No shop
  // specialty bonus at home — it's a private sale, not a shopkeep's bid.
  presentHomeSell(sx, sy, targetId = null) {
    const sel = targetId == null ? this.save.inv[this.save.selSlot]
      : this.save.inv.find(stack => stack.id === targetId && stack.count > 0);
    const hasSel = sel && sel.id && Inventory.ownedCount(this.save, sel.id) > 0;
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
        blurb: sel && Macros.scholarLoaned(this.save, sel.id) > 0
          ? 'Return borrowed tomes at a Book Club. They cannot be sold.'
          : 'Pick a stack in your bag, then tap Home to sell it.',
        cost: '', canAfford: false, cancelLabel: 'Leave', acceptLabel: 'Sell',
        repeat: () => this.presentHomeSell(sx, sy, targetId),
        onAccept: () => {},
      });
      return;
    }
    if (ITEM_BY_ID[sel.id]?.progressionOnly) {
      this.showMessageModal({ kind: 'story', art: 'progression_portal', title: 'A journey still ahead', body: 'Keep this relic. There are places only it can open.' });
      return;
    }
    const unitPrice = trailerSellPrice(itemValue(sel.id));
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
        const have = Inventory.ownedCount(this.save, sellId);
        if (have <= 0) { this.flash('Gone — already used.', sx, sy); return; }
        if (Inventory.remove(this.save, sellId, 1) !== 1) return;
        this._clampSelSlot();
        const gain = unitPrice;
        addMoney(this.save, gain);
        if (!this.save.storySeen?.['sale:first']) this.save.firstSalePending = true;
        this._finishInventoryChange();
        this.flashLoot(`+${gain}`, UI_GOLD, 1, sellId);
        this.questEvent('sell');
        this._firstSaleStory();
      },
    });
  }

  // CRAFT page: one recipe of HOME_RECIPES (items.js) at a time, with a
  // direct recipe picker. `targetId` defaults to the first recipe the
  // bag can make, so the page opens on something usable.
  presentHomeCraft(sx, sy, targetId = null) {
    this._presentRecipePicker(sx, sy, {
      recipes: HOME_RECIPES, targetId,
      present: id => this.presentHomeCraft(sx, sy, id),
      kind: 'craft', kindIcon: this._homeKindIcon(),
      tabs: this._homeTabs('craft', sx, sy),
      acceptLabel: 'Craft', costLabel: 'Ingredients',
      onCraft: rec => {
        this._finishInventoryChange();
        this.flashLoot(`✨ ${itemName(rec.id)} ×1`, UI_GOLD, 1.25, rec.id);
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
          const rim = p.jackpot ? GOLD : UI_GREEN;
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
          result.style.color = UI_DANGER_INK;
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
  _forEachTowerNear(pc, fn) { this._forEachDerivedNear(pc, 'tower', fn); }
  // The houses of the 3×3 ring, off the same per-tile derived index.
  _forEachHouseNear(pc, fn) { this._forEachDerivedNear(pc, 'house', fn); }

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

  // Prefer the nearest existing house footprint, including a building whose
  // entrance is far from the player. Distance is to the polygon, not its object.
  _nearbyHomeBuilding(x, y) {
    let best = null, bestDistance = 2 * this.cellM;
    for (const [key, entry] of WorldGen.tileCache) {
      if (!entry?.buildingShapes || (entry.depth || 0) !== 0) continue;
      const [, tx, ty] = key.split('/').map(Number);
      const ox = tx * this.tileEdgeM, oy = ty * this.tileEdgeM;
      const houses = new Map((entry.objects || []).filter(o => o.kind === 'house'
        && o.id !== 'starter_trailer').map(o => [o.id, o]));
      for (const shape of entry.buildingShapes) {
        let house = houses.get(shape.key);
        const r = shape.ring;
        if (!shape.key || shape.key === 'starter_trailer' || shape.templeZone || !r || r.length < 6) continue;
        const px = x - ox, py = y - oy;
        let inside = false, distance = Infinity;
        for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
          const ax = r[j], ay = r[j + 1], bx = r[i], by = r[i + 1];
          if ((ay > py) !== (by > py) && px < ax + (py - ay) * (bx - ax) / (by - ay)) inside = !inside;
          const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
          const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
          distance = Math.min(distance, Math.hypot(px - ax - t * dx, py - ay - t * dy));
        }
        if (inside) distance = 0;
        if (!house && distance <= bestDistance) {
          // Some mapped footprints have no house object (castles and culled
          // neighbours). Keep their geometry and persist only a Home anchor.
          const owner = entry.ownerKeys?.indexOf(shape.key), n = entry.cellsPerEdge || this.cellsPerTile;
          let anchor = null, nearest = Infinity;
          if (owner > 0) for (let i = 0; i < (entry.owners?.length || 0); i++) {
            if (entry.owners[i] !== owner || !BUILDING_TYPES.has(entry.grid[i])) continue;
            const ax = ox + (i % n + 0.5) * this.cellM;
            const ay = oy + (Math.floor(i / n) + 0.5) * this.cellM;
            const d = (ax - x) ** 2 + (ay - y) ** 2;
            if (d < nearest) { nearest = d; anchor = { x: ax, y: ay }; }
          }
          if (!anchor) continue;
          house = { kind: 'house', id: shape.key, tier: shape.tier, ...anchor, _homeFootprint: true };
        }
        if (distance > bestDistance || (distance === bestDistance && best && String(house.id) >= String(best.id))) continue;
        best = house; bestDistance = distance;
      }
    }
    return best;
  }

  // A new 2×2 house may occupy only loaded, open ground. Existing buildings
  // are never overwritten, including those beyond the adoption radius.
  _homeSiteClear(x, y) {
    const at = worldMetersToAbsCell(this, x, y);
    const { minCell, maxCell } = HomeArea.HOUSE;
    for (let dy = minCell; dy <= maxCell; dy++) for (let dx = minCell; dx <= maxCell; dx++) {
      const c = absCellOffset(this, at.cellIX, at.cellIY, dx, dy);
      const t = absCellToTile(this, c.cellIX, c.cellIY);
      const e = WorldGen.tileCache.get(WorldGen.tileKey(t.tx, t.ty));
      const index = t.iy * t.n + t.ix, terrain = e?.grid?.[index];
      const st = this.save.starterTrailer;
      const movingOwn = st && !st.adopted && e?.ownerKeys?.[e.owners?.[index]] === st.id;
      if (terrain == null || (BUILDING_TYPES.has(terrain) && !movingOwn) || terrain === WorldGen.T.WATER
          || terrain === WorldGen.T.PIER || WorldGen.isCobbleTerrain(terrain)) return false;
    }
    return true;
  }

  // Shared nonmutating site search for placement and move confirmation.
  _newHomeSite(x, y, heading = 0) {
    const at = worldMetersToAbsCell(this, x, y);
    const offset = HomeArea.placementOffsets(heading).wagon;
    for (let r = 0; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = absCellOffset(this, at.cellIX, at.cellIY, offset.dx + dx, offset.dy + dy);
        const m = absCellCenterMeters(this, c.cellIX, c.cellIY);
        if (this._homeSiteClear(m.x, m.y)) return m;
      }
    }
    return null;
  }

  // Adopt a nearby building as-is. Only open starts receive a new 2×2 Home.
  // Both initial placement and "Move Home here" use this path.
  _placeHome(x, y, heading = 0) {
    const existing = this._nearbyHomeBuilding(x, y);
    const wagon = existing ? null : this._newHomeSite(x, y, heading);
    if (!existing && !wagon) return false;
    this.save.homeFirepit = null;
    this.save.homeFirepitPending = true;
    this.save.homePlacementHeading = heading;
    this._homePosMemo = null;
    if (existing) {
      this.save.starterShopId = existing.id;
      this.save.starterTrailer = existing._homeFootprint
        ? { id: existing.id, x: existing.x, y: existing.y, tier: existing.tier, adopted: true } : null;
      this._starterTrailerObj = null;
      this.ensureStarterTrailerObject();
    } else this._makeStarterTrailer(wagon.x, wagon.y);
    return true;
  }

  // A real compass reading unlocks placement once per save. Heading changes
  // never move the saved layout after its initial placement.
  _onFirstCompass() {
    if (!Number.isFinite(this._homeInitialHeading) && Number.isFinite(this._deviceCompass?.deg)) {
      this._homeInitialHeading = this._deviceCompass.deg;
    }
    if (this.save.homeCompassDetected) return;
    this.save.homeCompassDetected = true;
    this.save.homeFirepitPending = true;
    this._placePendingHomeFirepit();
    persistSave(this.save);
  }

  _placePendingHomeFirepit() {
    const save = this.save, trailer = this._homeFootingAnchor();
    if (!save.homeFirepitPending || (this.depth || 0) !== 0
        || !trailer || save.starterShopId !== trailer.id) return false;
    if (!save.homeCompassDetected) {
      // No heading yet: wait out HomeArea.FIREPIT_COMPASS_GRACE_MS, then
      // place anyway (the reading only ever confirms the same cell).
      const now = performance.now();
      this._firepitGraceT0 ??= now;
      if (now - this._firepitGraceT0 < HomeArea.FIREPIT_COMPASS_GRACE_MS) return false;
    }
    const at = worldMetersToAbsCell(this, trailer.x, trailer.y);
    const { firepit: offset, wagon } = HomeArea.placementOffsets(save.homePlacementHeading || 0);
    // The pit's cell: its turned offset if that ground takes it, else the
    // nearest cell round the player that does (HomeArea.firepitCandidates) —
    // a heading that points it at a road or the water must not cost a new
    // game its pit.
    let pit = null;
    for (const c of HomeArea.firepitCandidates(offset, wagon)) {
      const cell = absCellOffset(this, at.cellIX, at.cellIY, c.dx - wagon.dx, c.dy - wagon.dy);
      const m = absCellCenterMeters(this, cell.cellIX, cell.cellIY);
      if (this._firepitGroundOK(m.x, m.y)) { pit = m; break; }
    }
    // Do not relocate a saved lit fire into water or a road. An unsuitable
    // neighbourhood leaves an existing pit intact.
    if (pit) {
      const old = save.homeFirepit;
      for (const fire of save.fires || []) {
        if (old && PlacedFloor.onDepth(fire, 0) && sameAbsCell(this, fire.x, fire.y, old.x, old.y)) {
          fire.x = pit.x; fire.y = pit.y;
        }
      }
      save.homeFirepit = pit;
    }
    save.homeFirepitPending = false;
    this.clearHomeFooting();
    return true;
  }

  // May Home's firepit sit at (x, y)? Not in water, on a road or path, or on
  // a pier or any building. An unloaded tile cannot supply a safe site.
  _firepitGroundOK(x, y) {
    const c = worldMetersToTileCell(this, x, y);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(c.tx, c.ty));
    const t = entry?.grid?.[c.iy * c.n + c.ix];
    if (t == null) return false;
    return !BUILDING_TYPES.has(t) && t !== WorldGen.T.WATER && t !== WorldGen.T.PIER && !WorldGen.isCobbleTerrain(t);
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
    // wreck/shop skin in the renderer, so it draws as the player's house
    // regardless. `door` is the wall facing the player at placement.
    const door = HomeArea.doorSide(this.save.homePlacementHeading || 0);
    this.save.starterTrailer = { id, x, y, tier: WorldGen.T.BUILDING, address, door };
    // The trailer IS Home from here on — set before the inject.
    this.save.starterShopId = id;
    this._starterTrailerObj = null;            // force a rebuild on next inject
    this.ensureStarterTrailerObject();
  }

  // Keep the synthetic trailer present in its owning tile's object list, and
  // Home's footing clear. Runs every frame (cheap) so the trailer survives
  // reloads and tile eviction — worldgen output never contains it, so without
  // this it would vanish.
  ensureStarterTrailerObject() {
    // Surface-only. Underground, WorldGen.tileCache is repointed at the active
    // depth's cave map (setDepth), so injecting here would drop a phantom
    // trailer into a cave tile. The trailer lives on the surface — depth 0.
    if ((this.depth || 0) !== 0) return;
    // A reading may arrive before Home exists or while underground.
    if (this._placePendingHomeFirepit()) persistSave(this.save);
    // Older saves nudged this step-over prop toward the doorstep. Centre its
    // existing cell once per saved ring; carry its surface fire with it so
    // artwork, warmth and interactions keep one anchor without moving cells.
    const pit = this.save.homeFirepit;
    if (pit && this._centeredHomeFirepit !== pit) {
      const cell = worldMetersToAbsCell(this, pit.x, pit.y);
      const centre = absCellCenterMeters(this, cell.cellIX, cell.cellIY);
      for (const fire of this.save.fires || []) {
        if (PlacedFloor.onDepth(fire, 0) && sameAbsCell(this, fire.x, fire.y, pit.x, pit.y)) {
          fire.x = centre.x;
          fire.y = centre.y;
        }
      }
      pit.x = centre.x;
      pit.y = centre.y;
      this._centeredHomeFirepit = pit;
    }
    const st = this.save.starterTrailer;
    // Only inject while the trailer is actually the active Home. If the player
    // has since adopted a real house (starterShopId points elsewhere), a stale
    // starterTrailer must not keep spawning a phantom trailer in the world.
    if (st && this.save.starterShopId === st.id) {
      // Rebuild the in-memory object after a reload (or position change).
      if (!this._starterTrailerObj || this._starterTrailerObj.id !== st.id) {
        // The 2×2 footprint's centre lies half a cell northwest of its anchor.
        this._starterTrailerObj = { kind: 'house', x: st.x, y: st.y,
          tier: st.tier, id: st.id, address: st.address, _synthetic: true, _homeFootprint: !!st.adopted,
          footDx: st.adopted ? 0 : (HomeArea.HOUSE.minCell + HomeArea.HOUSE.maxCell) / 2,
          footDy: st.adopted ? 0 : (HomeArea.HOUSE.minCell + HomeArea.HOUSE.maxCell) / 2 };
      }
      const obj = this._starterTrailerObj;
      const { tx, ty } = worldMetersToTile(this, obj.x, obj.y);
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      if (entry && entry.objects && !entry.objects.some(o => o.id === obj.id)) entry.objects.push(obj);
    }
    this.clearHomeFooting();
    // The house's cells and ring go down AFTER the sweep, onto cleared ground.
    if (st && !st.adopted && this.save.starterShopId === st.id) this._stampHomeFootprint(st);
  }

  // YOUR HOUSE'S FOOTPRINT. Home's house (HomeArea.HOUSE) is stamped into the
  // built tile like a generated building: its cells painted T.BUILDING under
  // its own ownerKey (the id), flagged synthetic, and its ring pushed into
  // the tile's buildingShapes with the doorway's point, so the overlay draws
  // it (building_overlay.js drawHome), the spawn gate keeps spawns out of it,
  // the tap zone opens Home from any of its cells, and the clutter moat holds.
  // A per-player overlay on the built tile, never a generation input: a
  // rebuilt tile is a fresh entry and is stamped again. Once per (entry,
  // position) — `_homeHouse` on the entry. A footprint can straddle a seam:
  // every tile with a cell of it paints its cells; only the tile holding the
  // centre carries the ring, so the walls are drawn once.
  _stampHomeFootprint(st) {
    const hc = worldMetersToAbsCell(this, st.x, st.y);
    const stamp = `${st.id}@${hc.cellIX},${hc.cellIY}:2x2`;
    const { minCell, maxCell } = HomeArea.HOUSE, t = {};
    const byTile = new Map();
    for (let dy = minCell; dy <= maxCell; dy++) for (let dx = minCell; dx <= maxCell; dx++) {
      const c = absCellOffset(this, hc.cellIX, hc.cellIY, dx, dy);
      absCellToTile(this, c.cellIX, c.cellIY, t);
      const k = WorldGen.tileKey(t.tx, t.ty);
      let rec = byTile.get(k);
      if (!rec) byTile.set(k, rec = { tx: t.tx, ty: t.ty, idx: [], centre: false });
      rec.idx.push(t.iy * t.n + t.ix);
      if (!dx && !dy) rec.centre = true;
    }
    for (const [k, rec] of byTile) {
      const e = WorldGen.tileCache.get(k);
      if (!e?.grid || !e.owners || !e.ownerKeys || e._homeHouse === stamp) continue;
      let id = e.ownerKeys.indexOf(st.id);
      if (id < 0) id = e.ownerKeys.push(st.id) - 1;
      for (const i of rec.idx) {
        // Existing building cells are never overwritten by a synthetic Home.
        const under = BUILDING_TYPES.has(e.grid[i]) ? e.ownerKeys[e.owners[i]] : null;
        if (BUILDING_TYPES.has(e.grid[i]) && under !== st.id) continue;
        e.grid[i] = WorldGen.T.BUILDING;
        e.owners[i] = id;
        if (e.syntheticBuildingCells) e.syntheticBuildingCells[i] = 1;
      }
      // New arrays, so the overlay's cache (keyed on identity) repaints.
      e.buildingShapes = (e.buildingShapes || []).filter(sh => sh.key !== st.id);
      if (e.clearedShapes) e.clearedShapes = e.clearedShapes.filter(sh => sh.key !== st.id);
      if (rec.centre) {
        const ox = rec.tx * this.tileEdgeM, oy = rec.ty * this.tileEdgeM;
        const ring = HomeArea.houseRingM(st.x, st.y, this.cellM);
        const door = HomeArea.doorPointM(st.x, st.y, this.cellM,
          st.door || HomeArea.doorSide(this.save.homePlacementHeading || 0));
        e.buildingShapes.push({
          ring: Float32Array.from(ring.flatMap(p => [p.x - ox, p.y - oy])),
          tier: WorldGen.T.BUILDING, key: st.id, home: true,
          door: { x: door.x - ox, y: door.y - oy },
          areaM2: (maxCell - minCell + 1) ** 2 * this.cellM * this.cellM,
        });
      }
      e._homeHouse = stamp;
      this._lastBorderIX = null;
    }
  }
  // Lift the house's footprint off every loaded tile (Home is moving): its
  // cells go back to the ground round them the way a cleared house's do, and
  // its ring leaves both shape lists — a moved Home leaves no shadow.
  _unstampHomeFootprint() {
    const st = this.save.starterTrailer;
    if (!st || st.adopted) return;
    for (const e of WorldGen.tileCache.values()) {
      if (!e || !e._homeHouse) continue;
      this._eraseHomeBuildings(e, new Set([st.id]));
      if (e.clearedShapes) e.clearedShapes = e.clearedShapes.filter(sh => sh.key !== st.id);
      e._homeHouse = null;
    }
  }
  // Is the player INSIDE Home's house — standing on one of its cells (the
  // doorway row included)? Surface only; the house has no cellar.
  homeInside() {
    if ((this.depth || 0) !== 0 || !this.save.starterShopId || !this.playerM || !this.startWorldM) return false;
    const { x, y } = playerWorldM(this);
    const c = worldMetersToAbsCell(this, x, y);
    const t = absCellToTile(this, c.cellIX, c.cellIY);
    const e = WorldGen.tileCache.get(WorldGen.tileKey(t.tx, t.ty));
    if (!e?.grid || !e.owners || !e.ownerKeys) return false;
    const i = t.iy * t.n + t.ix;
    return BUILDING_TYPES.has(e.grid[i]) && e.ownerKeys[e.owners[i]] === this.save.starterShopId;
  }
  // The house round the player while they are inside it — its ring in world
  // metres and a key naming it — or null. lighting.js masks everything
  // outside that ring; the overlay takes the roof off.
  homeInterior() {
    if (!this.homeInside()) return null;
    const home = this.homeWorldPos();
    if (!home) return null;
    const { tx, ty } = worldMetersToTile(this, home.x, home.y);
    const e = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    const shape = e?.buildingShapes?.find(sh => sh.key === this.save.starterShopId);
    if (!shape?.ring || shape.ring.length < 6) return null;
    const ox = tx * this.tileEdgeM, oy = ty * this.tileEdgeM, ring = [];
    for (let i = 0; i < shape.ring.length; i += 2) ring.push({ x: ox + shape.ring[i], y: oy + shape.ring[i + 1] });
    return { ring, key: `${this.save.starterShopId}@${Math.round(home.x)},${Math.round(home.y)}` };
  }

  // Clear incidental clutter from Home's doorstep and firepit. Buildings,
  // their source footprints, and saved player objects always remain intact.
  clearHomeFooting() {
    if ((this.depth || 0) !== 0) return;
    const home = this._homeFootingAnchor();
    if (!home) return;
    const hc = worldMetersToAbsCell(this, home.x, home.y);
    const pit = this.save.homeFirepit;
    const pc = pit ? worldMetersToAbsCell(this, pit.x, pit.y) : null;
    const stamp = `${home.id}@${hc.cellIX},${hc.cellIY}` + (pc ? `/${pc.cellIX},${pc.cellIY}` : '');
    const cells = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      cells.push(absCellOffset(this, hc.cellIX, hc.cellIY, dx, dy));
    }
    if (pc) cells.push(pc);
    const onFooting = new Set(cells.map(c => c.cellIX + ',' + c.cellIY));
    const savedOwnerIds = SpawnOwnership.savedIds(this.save);
    const tag = stamp;
    // Only Home's own tile and its 8 neighbours can hold a cell of a building
    // on the footing, so the rest of the cache is skipped.
    const htx = Math.floor(home.x / this.tileEdgeM), hty = Math.floor(home.y / this.tileEdgeM);
    for (const [key, entry] of WorldGen.tileCache) {
      if (!entry || !entry.objects) continue;
      const parts = key.split('/');
      if (Math.abs(+parts[1] - htx) > 1 || Math.abs(+parts[2] - hty) > 1) continue;
      if (entry._homeFooting === tag && entry._homeFootingN === entry.objects.length) continue;
      for (let i = entry.objects.length - 1; i >= 0; i--) {
        const o = entry.objects[i];
        if (o === this._starterTrailerObj || o.id === home.id) continue;
        if (isBuilding(o.kind) || SpawnOwnership.isProtected(o, this.save, savedOwnerIds)) continue;
        const oc = worldMetersToAbsCell(this, o.x, o.y);
        if (onFooting.has(oc.cellIX + ',' + oc.cellIY)) entry.objects.splice(i, 1);
      }
      entry._homeFooting = tag;
      entry._homeFootingN = entry.objects.length;
    }
  }

  // Where Home stands, without resolving it (homeWorldPos resolves through
  // ensureStarterShopId, which calls back in here): the trailer record, or
  // the adopted house wherever it is loaded.
  _homeFootingAnchor() {
    const id = this.save.starterShopId;
    if (!id) return null;
    const st = this.save.starterTrailer;
    if (st && st.id === id) return st;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) if (o.kind === 'house' && o.id === id) return o;
    }
    return null;
  }

  // Erase every cell of the buildings keyed in `keys` from one built tile:
  // the cell takes the most common open ground bordering the erased cells
  // (a yard on a residential street, grass in a park; residential land when
  // nothing borders it), drops its owner, and the outline moves from
  // buildingShapes to clearedShapes (drawn as a 50% footprint shadow). A new buildingShapes array, so the overlay repaints, and
  // the ground layer redraws on this frame rather than the next cell crossing.
  _eraseHomeBuildings(entry, keys) {
    const g = entry.grid, own = entry.owners, ok = entry.ownerKeys;
    if (!g || !own || !ok) return;
    const ids = new Set();
    for (let o = 1; o < ok.length; o++) if (keys.has(ok[o])) ids.add(o);
    if (!ids.size) return;
    const gone = [];
    for (let i = 0; i < g.length; i++) {
      if (ids.has(own[i]) && BUILDING_TYPES.has(g[i])) gone.push(i);
    }
    if (!gone.length) return;
    const N = entry.cellsPerEdge || Math.round(Math.sqrt(g.length));
    const erased = new Set(gone);
    const open = (t) => !BUILDING_TYPES.has(t) && t !== WorldGen.T.WATER
      && t !== WorldGen.T.PIER && !WorldGen.isCobbleTerrain(t);
    const votes = new Map();
    for (const i of gone) {
      const ix = i % N, iy = (i - ix) / N;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = ix + dx, y = iy + dy;
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const j = y * N + x;
        if (erased.has(j) || !open(g[j])) continue;
        votes.set(g[j], (votes.get(g[j]) || 0) + 1);
      }
    }
    let fill = WorldGen.T.RESIDENTIAL, best = 0;
    for (const [type, n] of votes) if (n > best || (n === best && type < fill)) { fill = type; best = n; }
    for (const i of gone) {
      g[i] = fill;
      own[i] = 0;
      if (entry.syntheticBuildingCells) entry.syntheticBuildingCells[i] = 0;
    }
    if (entry.buildingShapes?.some(s => keys.has(s.key))) {
      // The outline moves to clearedShapes: the overlay draws it as a flat
      // shadow of the footprint the trailer cleared, not a building.
      entry.clearedShapes = (entry.clearedShapes || []).concat(entry.buildingShapes.filter(s => keys.has(s.key)));
      entry.buildingShapes = entry.buildingShapes.filter(s => !keys.has(s.key));
    }
    this._lastBorderIX = null;
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
        body: 'Home stands on the surface. Climb back up before moving it.' });
      return;
    }
    const { x: px, y: py } = playerWorldM(this);
    const footing = this._homeFootingAt(px, py);
    if (footing?.blocked) {
      this.showMessageModal({ title: 'Move Home',
        body: 'There is no clear space for Home here. Move to open ground or near a house.' });
      return;
    }
    const cost = Math.min(500, Math.floor((this.save.money ?? 0) / 2));
    this.showConfirmModal({
      id: 'move-home-modal',
      kind: 'build',
      title: 'Move Home here?',
      body: footing?.house
        ? 'Make this building your Home, keeping its existing footprint.'
        : 'Build Home here.',
      acceptLabel: `Move (${this.moneyHTML(cost, 12)})`,
      onAccept: () => {
        if (!this.moveHomeTrailerHere(px, py)) {
          this.showMessageModal({ title: 'Move Home', body: 'That spot is no longer available. Your Home has stayed where it is.' });
          return;
        }
        addMoney(this.save, -cost);
        this.updateHUD();
        Save.persist(this.save);
        this.flashLoot('🏠 Home moved!');
      },
    });
  }

  // A move adopts the nearby footprint or requires a clear 2×2 site.
  _homeFootingAt(x, y) {
    const house = this._nearbyHomeBuilding(x, y);
    if (house) return { house: house.id };
    return this._newHomeSite(x, y) ? null : { blocked: true };
  }

  // Relocate Home to the player's current position (_placeHome): the wagon
  // uses a nearby building or an open 2×2 site; other buildings stay intact. Works whether the current Home is a real
  // adopted house (it simply becomes a normal house again) or an existing
  // synthetic trailer (it moves). Surface-only — the confirm above guards
  // depth.
  moveHomeTrailerHere(x, y) {
    const p = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : playerWorldM(this);
    if (this._homeFootingAt(p.x, p.y)?.blocked) return false;
    this._unstampHomeFootprint();
    // Evict any previously injected trailer object from the loaded tiles.
    // ensureStarterTrailerObject only dedupes within the NEW owning tile, so
    // without this sweep a moved trailer leaves a phantom copy in its old
    // tile's object list until that tile is evicted.
    for (const e of WorldGen.tileCache.values()) {
      if (!e.objects) continue;
      const i = e.objects.findIndex((o) => o._synthetic && (o.id === 'starter_trailer' || o._homeFootprint));
      if (i >= 0) e.objects.splice(i, 1);
    }
    // playerM → absolute world metres (the space every object's x/y lives in).
    if (!this._placeHome(p.x, p.y)) return false;
    this._starterShopOk = true;
    return true;
  }

  isStarterBlacksmith(house) { return Houses.isStarterBlacksmith(this.save, house); }

  houseShopRole(house) { return Houses.houseShopRole(this.save, house); }

}
