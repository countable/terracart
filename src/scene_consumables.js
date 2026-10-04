// The scene's CONSUMABLES — everything the player uses up from the bag:
//   · potions, tomes, scrolls and powders (drinkXxx / readXxx / useXxx) and
//     the timed states they leave (blight aura, shadow, torch, dragon skin);
//   · thrown items, the rope, the orb, the sapphire portal and eatSelected;
//   · the safety cards and concealment predicates (isUnnoticed / isTooFast)
//     the shadow powder and speed gate share;
//   · the telescope, crop watering/growth and the burn/feed confirms.
//
// Moved out of app.js (with the one-lane consumable routing: _useConsumable). The methods live on `class SceneConsumables`, a MIXIN:
// app.js installs them onto MapScene.prototype right after the class closes
// (installSceneMixin, from modal_shell.js), so callers still say `this.x()`.
// This file loads BEFORE app.js: the methods read app.js names and this.* at
// CALL time only.

// The tables the routing reads — TIMED_BUFF_HOOKS and CAST_ROWS (SUMMON_HOOK
// is the summons’ shared hooks) — live here beside _useTimedBuff / _castOnFoes.
// ── THE TIMED CONSUMABLES' OWN WORK ─────────────────────────────────────────
// What a CONSUMABLE_SPEC row with a `buff` does BESIDES extending its Buffs
// row (_useTimedBuff): keyed by the buff id, `before(scene, spec)` runs ahead
// of the extend and `after(scene, spec)` behind it. A row not listed here
// only extends. The summons (skeleton, wraith) reconcile the live ally
// around the extend through Companions.tick — the ally's lifetime is the
// expiry it reads (Companions.KINDS[kind].field is the Buffs row's `save`).
const SUMMON_HOOK = {
  before: (s, spec) => {
    const kind = spec.summonKind;
    Companions.tick(s, kind);   // expiry or defeat first, a stale live instance too
    if (!Companions.active(s.save, kind)) delete s.save.companionState?.[kind];
  },
  after: (s, spec) => Companions.tick(s, spec.summonKind),
};
const TIMED_BUFF_HOOKS = {
  // Immune from this instant: no half-pip of an earlier blow or burn lands later.
  immortal: { after: (s) => { s._incomingDamageFraction = 0; s.save.fireDamageRemainder = 0; } },
  fireResistance: { after: (s) => { Conditions.cure(s.save, 'burning'); s.save.fireDamageRemainder = 0; s._lavaAccum = 0; } },
  // The bar's cap moves with the body: current HP is capped (never healed), the skin resized.
  shrinking: { after: (s) => { Energy.set(s.save, s.save.energy, Energy.maxEnergy(s.save)); s._syncPlayerSkin(); s.updateEnergyDOM(); } },
  giant: { after: (s) => { s._syncPlayerSkin(); s.updateEnergyDOM(); } },
  // The truce ends the fight you are in: the melee wheel drops (the same
  // cancel the stairs use); arrows already in the air finish their flight.
  shadow: { after: (s) => { if (s._workProgress?.combat) s.cancelWorkProgress(); } },
  // Summoned now, not a frame later; a living bird's follow timer is
  // re-derived from the refreshed expiry by Companions.tick.
  raven: { after: (s) => s._tickSpiritRaven() },
  skeleton: SUMMON_HOOK,
  wraith: SUMMON_HOOK,
};
// ── "EVERY FOE IN SIGHT" ─────────────────────────────────────────────────────
// The screen-wide spells share one shape (_castOnFoes): the ENEMIES drawn
// inside the viewport (_onscreenEnemies — Combat.isEnemy, never a crow, a
// deer or a pet; the frost's `reach` scope is the lit plateau the tap gate
// accepts, cellInReach), ONE refusal when there are none ("No foe in sight —
// <noun> kept."), `before(scene)`, the row's `apply(scene, c, now, damage)`
// per foe (true for a kill), the spend, and the row's `note` when something
// was spent. `clock` is the status's own — perf for the rout lanes (fear,
// psychosis, the thunder's wander-off), wall for sleep and frost.
const CAST_ROWS = {
  // A white flash across the screen; THUNDER_DMG through _damageEnemy (the
  // one damage lane: popups, bar, bounty); whatever the bolt leaves standing
  // turns tail (monsterRout — the ordinary wander-off, away from the player
  // to the usual random range). A lair guard is on its own leash
  // (Lairs.guardState), so it takes the damage but holds its ruin.
  thunder_scroll: { noun: 'scroll', clock: 'perf',
    before: (s) => s.cameras?.main?.flash(THUNDER_FLASH_MS, 255, 255, 255),
    apply: (s, c, now, damage) => {
      if (s._damageEnemy(c, damage)) return true;
      if (!c.lair) monsterRout(c, now, s.cellM);
      return false;
    },
    note: (s, n, felled) => s.showMessageModal({
      title: 'You read the Scroll of Thunder',
      body: felled < n ? 'The sky splits. When your ears stop ringing, the surviving beasts are already fleeing.'
        : 'The sky splits. When your ears stop ringing, the beasts lie still.',
    }) },
  // The rout, away from the player, for the scroll's half minute (Combat.applyFear).
  fear_scroll: { noun: 'scroll', clock: 'perf',
    apply: (s, c, now) => { monsterRout(c, now, s.cellM); Combat.applyFear(c, CONSUMABLE_SPEC.fear_scroll.durationMs, now); },
    note: (s, n, felled, id) => s.flashLoot('The beasts turn and flee.', Combat.STATUS_LOOKS.fear.color, 1.8, id) },
  sleep_powder: { noun: 'powder', clock: 'wall',
    apply: (s, c, now) => Combat.applySleep(c, now),
    note: (s, n, felled, id) => s.flashLoot(`Sleep falls for ${shortDuration(CONSUMABLE_SPEC.sleep_powder.durationMs)}.`, '#bca5e8', 1.8, id) },
  // Every foe on screen loses its head (Combat.applyPsychosis — the
  // `psychotic` reason in wanderCreatures' rout lane: the flee pace on a
  // random heading each hop, no blow, no target). Weak on purpose: ten
  // seconds to get clear, or to get the first blow in.
  psychosis_powder: { noun: 'powder', clock: 'perf',
    apply: (s, c, now) => Combat.applyPsychosis(c, CONSUMABLE_SPEC.psychosis_powder.durationMs, now),
    note: (s, n, felled, id) => s.flashLoot(`Madness takes them for ${shortDuration(CONSUMABLE_SPEC.psychosis_powder.durationMs)}.`, Combat.STATUS_LOOKS.psychosis.color, 1.8, id) },
  // Every ENEMY standing IN REACH is CHILLED (Combat.applyFrost — a SLOW,
  // never a freeze: half pace, half cadence) for the powder's half minute.
  frost_powder: { noun: 'powder', clock: 'wall', scope: 'reach',
    apply: (s, c, now) => Combat.applyFrost(c, CONSUMABLE_SPEC.frost_powder.durationMs, now),
    note: (s, n, felled, id) => s.flashLoot(`❄ ${n} enem${n === 1 ? 'y' : 'ies'} chilled for ${shortDuration(CONSUMABLE_SPEC.frost_powder.durationMs)}`, '#9ad8ff', 1.8, id) },
};

class SceneConsumables {
  // Eat one of the selected food stack (consumes 1, restores FOOD_ENERGY[id]).
  // Returns true if eaten, false if not edible / nothing selected.
  // Side-effects read their duration and radius from CONSUMABLE_SPEC.
  // === Consumables ============================================
  // Set out the Potion of Taming (consumed): every wandering producer inside its radius has
  // its home position re-anchored to ~3m from the player so it wanders toward you
  // over the next few seconds. Doesn't teleport — that would feel cheesy.
  // ── THE SLOT GUARD ────────────────────────────────────────────────────────
  // The one test every Drink / Use / Read makes first: the selected stack is
  // `id` with something left — the slot, or null. The handlers ask it
  // themselves (a test drives them directly), so an empty or wrong selection
  // is refused in one place however the action was reached.
  _selectedConsumable(id) {
    const sel = getSelectedSlot(this.save);
    return sel && sel.id === id && (sel.count ?? 0) > 0 ? sel : null;
  }
  // The selected stack SPENT: one off the count, persisted, the bar redrawn.
  // Every consume of the selected slot ends here.
  _consumeSelected() {
    consumeSelected(this.save);
    this._finishInventoryChange();
    return true;
  }
  // Spend the selected consumable `id`. A SCROLL teaches its recipe first
  // (save.usedScrolls — only a successful use, never owning or crafting one).
  _spendScroll(id) {
    if (ITEM_BY_ID[id]?.scroll) {
      this.save.usedScrolls ||= [];
      if (!this.save.usedScrolls.includes(id)) this.save.usedScrolls.push(id);
    }
    return this._consumeSelected();
  }
  // Shared tail for modal-feedback consumables (honey, book): spend the
  // selected item and pop a message modal. Returns true so callers can
  // `return this._finishConsumable(...)`.
  // NOTE: eatSelected deliberately does NOT use this — it consumes mid-method
  // (before computing side-effects) and gives flash feedback + energy DOM.
  _finishConsumable(title, body) {
    this._consumeSelected();
    this.showMessageModal({ title, body });
    return true;
  }
  // Energy BACK on the bar (a heal, a tome, a revival): capped at the max,
  // the "+N" popped for what actually landed, the HUD refreshed. Returns
  // what landed.
  _restoreEnergy(amount) {
    const before = this.save.energy ?? 0;
    Energy.set(this.save, before + amount, this.getMaxEnergy());
    const gained = this.save.energy - before;
    if (gained > 0) this._popEnergy(gained);
    if (this.updateEnergyDOM) this.updateEnergyDOM();
    return gained;
  }
  // ── THE TIMED CONSUMABLE ─────────────────────────────────────────────────
  // Every CONSUMABLE_SPEC row with a `buff` (the potions, the powders, the
  // torch, the scrolls that summon) is used HERE and nowhere else: the slot
  // guard once; the row's expiry EXTENDED through the one writer
  // (Buffs.extend — max(now, until) + the row's durationMs: a second dose is
  // banked on top of what is left, never thrown away, never refused); the
  // buff's own work (TIMED_BUFF_HOOKS); the stack spent with the row's
  // `used` dialog. A tome reads for `mul` of the dose and spends nothing.
  _useTimedBuff(id, { mul = 1, spend = true } = {}) {
    const spec = CONSUMABLE_SPEC[id], buff = spec?.buff;
    if (!buff || (spend && !this._selectedConsumable(id))) return false;
    // The dialog's words are picked BEFORE the extend (the torch's title
    // says whether one was already burning).
    const used = spec.used || {}, text = (v) => (typeof v === 'function' ? v(this, spec) : v);
    const title = text(used.title), body = text(used.body);
    const hook = TIMED_BUFF_HOOKS[buff];
    hook?.before?.(this, spec);
    Buffs.extend(this.save, this, buff, spec.durationMs * mul);
    hook?.after?.(this, spec);
    if (!spend) return true;
    this._spendScroll(id);
    this.showMessageModal({ title, body });
    return true;
  }
  // One route from a CONSUMABLE_SPEC row to its action: a `buff` row is a
  // timed buff, a `tome` row is read, a CAST_ROWS row is cast on the foes in
  // sight; anything else names its own `method`.
  _useConsumable(id) {
    const row = CONSUMABLE_SPEC[id];
    if (!row) return false;
    if (row.tome) return this._readTome(id);
    if (row.buff) return this._useTimedBuff(id);
    if (CAST_ROWS[id]) return this._castOnFoes(id);
    return typeof this[row.method] === 'function' ? this[row.method]() : false;
  }

  useHoney() {
    if (!this._selectedConsumable('taming_potion')) return false;
    const { x: pWX, y: pWY } = playerWorldM(this);
    let lured = 0;
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.creatures) continue;
      for (const c of entry.creatures) {
        if (this.save.caught.includes(c.id)) continue;
        if (!SpriteLayout.creatureProduce(c.kind)) continue;
        const d = Math.hypot(c.x - pWX, c.y - pWY);
        if (d > CONSUMABLE_SPEC.taming_potion.radiusM) continue;
        // Re-anchor the wander home toward the player. The wanderer's next
        // step picks a direction biased back toward _homeX/_homeY when it
        // drifts beyond ~3 cells, so this pulls them in over a few ticks.
        const ang = Math.atan2(pWY - c.y, pWX - c.x);
        const r = 3;   // place home 3m from player
        c._homeX = pWX + Math.cos(ang) * r;
        c._homeY = pWY + Math.sin(ang) * r;
        c._nextChooseT = 0;   // force a fresh step now
        lured++;
      }
    }
    return this._finishConsumable(
      '🍯 You set out the Potion of Taming',
      lured > 0 ? 'The sweet scent carries. Nearby creatures turn their noses toward you.' : 'The potion gleams in the quiet. Nothing stirs nearby.',
    );
  }

  // Pick the Book's payload: a directional chest hint, or the next page of
  // the PLAY_TIPS curriculum. Returns { title, body } and — for a page —
  // advances save.tipsRead, so the caller must persist afterward. Shared by
  // readBook (a book already sitting in an older save) and addToInv's
  // auto-read on pickup, so the two paths can't drift.
  //
  // THE COURSE COMES FIRST. The directional chest hint is a coin flip against
  // the tip, which was fine while tips were drawn at random — one payload was
  // as good as the other. Against an ORDERED list it competes with the
  // teaching: every hint is a book that taught nothing new, so a 50% flip
  // doubles the books needed to finish the course. So the hint only offers
  // itself once there is nothing left to teach (every page read at least
  // once). Nothing is lost by that — finding chests has its own dedicated
  // item, the Pairy, which reveals the nearest unfound one for five minutes
  // — and it gives the Book a second life instead of a rival payload.
  _bookRead() {
    const coursePending = (this.save.tipsRead ?? 0) < PLAY_TIPS.length;
    // Try the directional-hint branch first (coin flip), once the course is done.
    if (!coursePending && Math.random() < 0.5) {
      const chest = this.findNearestUnopenedChest();
      if (chest) {
        const { x: pWX, y: pWY } = playerWorldM(this);
        const dxM = chest.x - pWX, dyM = chest.y - pWY;
        const distM = Math.hypot(dxM, dyM);
        if (distM <= 250) {
          const ang = (Math.atan2(dyM, dxM) * 180 / Math.PI + 450) % 360;   // 0=N, CW
          const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
          const dir = dirs[Math.round(ang / 45) % 8];
          const placeName = chest.name ? rusticifyName(chest.name) : 'a chest';
          return { title: '📖 You crack open the book', body: `A faded sketch circles ${placeName}. An arrow points ${dir}.` };
        }
      }
    }
    // IN ORDER, NOT AT RANDOM. PLAY_TIPS is a curriculum — it runs from what
    // a player meets in the first hour (energy, the readouts, the farm) out
    // to the gates they reach hours later, and ends on the one riddle. A
    // uniform draw threw that ordering away and, worse, had no memory: with
    // 72 tips the birthday problem puts a repeat inside the first ~10 reads,
    // and reading the whole list took ~370 books on average. So the Book
    // walks the list instead, one page per read, and `save.tipsRead` is the
    // bookmark — persisted by the caller so it survives a reload, and
    // defaulted so a save from before this starts at page one.
    //
    // The cursor is stored UNWRAPPED and wrapped at read time: the list
    // grows, and a modulo taken at write time would scramble the bookmark
    // every time a tip was added.
    const read = this.save.tipsRead ?? 0;
    const page = read % PLAY_TIPS.length;
    this.save.tipsRead = read + 1;
    // Keep the bookmark in the save; the panel tells the page as a story. NO
    // TITLE LINE (owner, Oct 2026): the volume line in the page is the
    // heading, and "The worn book falls open" sat over it as a second one.
    // showMessageModal draws no title row for an empty title.
    return {
      title: '',
      body: bookPageHTML(page),
    };
  }

  // Read a book (consumed). Kept for saves that already have one sitting in
  // inventory from before books started auto-reading on pickup (addToInv).
  readBook() {
    if (!this._selectedConsumable('book')) return false;
    const { title, body } = this._bookRead();
    return this._finishConsumable(title, body);
  }

  // The auto-read fired by addToInv on pickup — framed as involuntary
  // ("your curiosity compels you") rather than readBook's deliberate "you
  // crack open the book", since nobody chose to read here — the read's own
  // title heads the panel.
  // `onDismiss` (optional) fires once THIS modal is tapped away — how
  // _revealPendingBookReads chains multiple reads one at a time instead of
  // stacking them.
  _presentBookRead(onDismiss) {
    const read = this._bookRead();   // mutates + the caller persists via this call
    persistSave(this.save);
    // The read's own lead-in ("The worn book falls open", or the sketch's
    // "You crack open the book") heads the panel, minus the emoji the plain
    // consumable path shows: a painted header is a label (CLAUDE.md).
    this.showMessageModal({
      title: read.title.replace(/^📖\s*/, ''),
      body: read.body,
      // A book read by firelight — the picture of the places of learning the
      // Book comes from, survivors sharing what they know.
      art: 'book_read',
      onDismiss,
    });
  }

  // Queues any book read(s) addToInv deferred (via { deferBookRead: true })
  // because the caller was about to show its own "you found a Book" modal
  // right after — call this from THAT modal's onDismiss. Each read is a
  // `read` ceremony: one at a time, each waiting for the last to close, and
  // ahead of the next trail prize in the queue (a read outranks a prize), so
  // a rare multi-book grant can't stack its own modals either. `onDone` (the
  // caller's own onDismiss — e.g. the prize queue's `done`) runs at once:
  // what it releases queues behind the reads.
  _revealPendingBookReads(onDone) {
    const n = this._pendingBookReads || 0;
    this._pendingBookReads = 0;
    for (let i = 0; i < n; i++) this._enqueueCeremony('read', (done) => { this._presentBookRead(done); return true; }, { defer: true });
    if (typeof onDone === 'function') onDone();
    this._drainCeremonies();
  }

  // ── The Tomes ─────────────────────────────────────────────────────────────
  // Story books' rarer siblings: READ for the effect of the potion one tier
  // below the tome, never consumed. Every tome but the Wall of Fire is its
  // row's `tome` column — _readTome gives its own buff or `mul` of `of`'s effect
  // (a timed buff's dose, the heal's energy, the storm's damage) and says
  // `flash`. TWO cooldowns: the SHARED activation lock (TOME_COOLDOWN_MS,
  // save.tomeReadyAt - food's eat-cooldown shape, but one hour and spanning
  // every tome: reading any one locks the button for all), and each tome's
  // OWN magic cooldown (CONSUMABLE_SPEC cooldownMs, save.tomeMagicCd[id])
  // scaled to the spell's power. HOME IS THE LIBRARY: inside Home's ring
  // (isRestingAtHome - the one predicate behind every Home-ring effect)
  // both are considered refreshed. A refused reading shows its wait
  // (Macros.waitLine - a timed gate needs a visible wait).
  // The wait on a tome — { ms, line } for the longer of the two locks, or
  // null when it may be read. _tomeReady flashes it; tomeUsable greys on it.
  _tomeWait(id) {
    const { x, y } = playerWorldM(this);
    if (this.isRestingAtHome(x, y)) return null;
    const now = Date.now();
    const shared = (this.save.tomeReadyAt ?? 0) - now, own = (this.save.tomeMagicCd?.[id] ?? 0) - now;
    if (shared > 0) return { ms: shared, line: 'The tomes rest' };
    if (own > 0) return { ms: own, line: 'This tome rests' };
    return null;
  }
  _tomeReady(id) {
    const wait = this._tomeWait(id);
    if (wait) this.flashAtPlayer(Macros.waitLine(wait.line, wait.ms));
    return !wait;
  }
  // The button gate (CONSUMABLE_SPEC usable): no flash, just grey.
  tomeUsable(id) { return !this._tomeWait(id); }
  _readTome(id) {
    const t = CONSUMABLE_SPEC[id]?.tome;
    if (!t || !this._selectedConsumable(id) || !this._tomeReady(id)) return false;
    const of = CONSUMABLE_SPEC[t.of];
    if (CONSUMABLE_SPEC[id].buff) this._useTimedBuff(id, { spend: false });
    else if (of.buff) this._useTimedBuff(t.of, { mul: t.mul, spend: false });
    else if (of.energy) this._restoreEnergy(Math.floor(of.energy * t.mul));
    else if (!this._castOnFoes(t.of, { damage: Math.floor(of.damage * t.mul), spend: false, noun: 'tome' })) return false;
    this._tomeSpent(id);
    this.flashAtPlayer(t.flash);
    return true;
  }
  _tomeSpent(id) {
    // THE ENCHANTER'S EDGE (wizard.js CLASSES): half-length cooldowns, both
    // the shared lock and the tome's own magic - the calling's whole benefit.
    const mul = (typeof Wizard !== 'undefined' && Wizard.isClass(this.save, 'enchanter')) ? 0.5 : 1;
    const now = Date.now();
    this.save.tomeReadyAt = now + TOME_COOLDOWN_MS * mul;
    (this.save.tomeMagicCd ||= {})[id] = now + (CONSUMABLE_SPEC[id]?.cooldownMs || 0) * mul;
    persistSave(this.save);
  }

  drinkHealingPotion() {
    if (!this._selectedConsumable('healing_potion')) return false;
    const restored = this._restoreEnergy(HEALING_POTION_ENERGY);
    return this._finishConsumable(
      '\u2728 You drink the Potion of Healing',
      restored > 0
        ? 'Warmth spreads through your arms. Your grip feels sure again.'
        : 'You were already brimming. The flask goes down anyway.',
    );
  }

  drinkAntidote() {
    if (!this._selectedConsumable('antidote')) return false;
    if (!Conditions.useAntidote(this.save)) {
      this.flashAtPlayer(kept('No debuffs', 'Antidote'));
      return false;
    }
    this._syncStatusRow();
    return this._finishConsumable('You drink the Antidote', 'The bitter draught burns your tongue. Every affliction falls away.');
  }

  drinkElixir() {
    if (!this._selectedConsumable('elixir')) return false;
    const before = this.save.energy ?? 0;
    if (!Conditions.useElixir(this.save)) {
      this.flashAtPlayer(before <= 0 ? 'Elixir cannot revive you.' : kept('No need', 'Elixir'));
      return false;
    }
    this._popEnergy(this.save.energy - before);
    this.updateEnergyDOM();
    this._syncStatusRow();
    return this._finishConsumable('You drink the Elixir', 'The draught glows against your lips. Strength returns as every affliction falls away.');
  }

  drinkTimePotion() {
    if (!this._selectedConsumable('time_potion')) return false;
    PlayerTime.reset(this);
    return this._finishConsumable('You drink the Potion of Time', 'All effects fade. Your items are ready again.');
  }

  // Poison Flask, drunk: the player's own `poison` row (_applyCondition —
  // the lesson, the row and the announcement), the flask spent either way;
  // a poison already running is refreshed to its full minute.
  drinkPoisonFlask() {
    if (!this._selectedConsumable('poison_flask')) return false;
    this._applyCondition('poison');
    return this._finishConsumable(`You drink the Poison Flask`,
      CONSUMABLE_SPEC.poison_flask.get);
  }

  // The Scroll of the Raven's bird (SpriteLayout.CREATURE_BEHAVIOUR.spirit_raven,
  // a slime-strength ally hunting the nearest foe or pest deer through
  // wanderCreatures' pet lane): only the EXPIRY reaches the save
  // (save.spiritRavenUntil, the `raven` buff), so the timer is honest across
  // a reload; the bird is session state this keeper holds at your side while
  // it runs. The scroll, the tome and player_time.js all call it, so it stays
  // a named method.
  _tickSpiritRaven() {
    Companions.tick(this, 'spirit_raven');
  }

  // Potion of Revival (T2) and Potion of Resurrection (T5): drunk while
  // DOWN, it stands you back up where you fell with REVIVE_ITEM_FRAC of the
  // bar — the field answer to the walk Home, and on hard the way out of the
  // zero-energy lockout besides the Crow Feather. Refused above zero (the Drink dialog
  // greys its button off the same test), so it can't be wasted as a top-up.
  drinkRevivePotion() {
    const sel = getSelectedSlot(this.save);
    const frac = sel && sel.id !== 'crow_feather' && REVIVE_ITEM_FRAC[sel.id];
    if (!frac || (sel.count ?? 0) <= 0) return false;
    if (!Combat.playerDowned(this.save.energy)) return false;
    this._restoreEnergy(Energy.reviveLevel(this.getMaxEnergy(), frac) - (this.save.energy ?? 0));
    const name = ITEM_BY_ID[sel.id]?.name || 'Potion of Revival';
    return this._finishConsumable(
      `\u2728 You drink the ${name}`,
      'Your eyes snap open. The ground presses cold against your palms as you rise.',
    );
  }

  // True while a Potion of Blight's minute runs. In the save like the other
  // potions (save.blightPotionUntil), so it survives a tile reload; the
  // timestamp self-expires.
  isBlightActive() {
    return (this.save.blightPotionUntil ?? 0) > Date.now();
  }

  // The Blight aura's bite: every ENEMY (Combat.isEnemy — never a crow, a deer
  // or a pet) whose centre is within BLIGHT_R_CELLS of the player's FEET
  // (playerM, never the camera anchor) loses BLIGHT_DPS × dt through
  // _damageEnemy — the one damage lane, so the "-N" popups, the health bar,
  // the regen stamp and the kill payout all come with it. Collected first and
  // hurt after: a kill removes the foe from its tile's array mid-scan.
  //
  // Timed off its own wall clock (like the melee wheel), not the frame's dt:
  // Phaser smooths and caps its delta, so a slow device would bite for less
  // than BLIGHT_DPS. Capped per step so a stalled tab can't land seconds of
  // bite at once.
  _tickBlightAura() {
    const nowT = performance.now();
    const lastT = this._blightLastT;
    this._blightLastT = nowT;
    if (!this.isBlightActive() || lastT == null) return;
    const dt = Math.min(0.25, (nowT - lastT) / 1000);
    if (!(dt > 0)) return;
    const { x: px, y: py } = playerWorldM(this);
    const rM = BLIGHT_R_CELLS * this.cellM;
    const caughtSet = setOf(this.save.caught);
    const pc = this.playerToWorldCell();
    const inside = [];
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, (c) => {
      const dx = c.x - px, dy = c.y - py;
      if (dx * dx + dy * dy > rM * rM) return;
      if (!Combat.isEnemy(c)) return;
      if (caughtSet.has(c.id)) return;
      inside.push(c);
    });
    // Mitigate one logical second, then integrate the rate. Applying a
    // minimum-one hit every frame would turn an aura into hundreds of DPS.
    for (const c of inside) {
      const rate = Combat.mitigate(BLIGHT_DPS, Combat.monster(c.kind)?.armor || 0);
      this._damageEnemy(c, rate * dt, 'player', { bypassArmor: true });
    }
  }

  // Frost follows the caster and reaches every other nearby body, using the
  // same non-refreshing ten-second debuff as an iceflower.
  _tickFrostAura() {
    const now = Date.now();
    if (Buffs.until('frostAura', this.save, this) <= now) return;
    const pc = this.playerToWorldCell(), creatures = [], caught = setOf(this.save.caught);
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, c => {
      if (!caught.has(c.id) && !c._surfaceInactive) creatures.push(c);
    });
    Combat.applyFrostAura(playerWorldM(this), creatures, this.cellM,
      CONSUMABLE_SPEC.tome_frost_aura.aura, now);
  }

  // True while a Dragon Powder is active. The buff is a 1-minute in-memory
  // timer (this._dragonUntil) — deliberately NOT persisted to the save, so a
  // refresh ends it. _walkRelics (the tier-8 legs) and interact.js's 2×-damage
  // check both route through here.
  isDragonActive() {
    return (this._dragonUntil ?? 0) > Date.now();
  }

  // Dragon Powder (the `dragon` buff): for its minute you wear a red dragon
  // and get its stats — tier-8 boots (DRAGON_WALK_COST_TIER, so the stick
  // walks faster and for less stamina than Frost boots can) and 2× attack
  // damage (interact.js halves the kill-wheel duration while in dragon
  // form). No flight, no separate movement mode: a dragon walks the way
  // everyone walks.

  // Growth Powder: every crop within 20 m springs ahead ONE stage on the spot,
  // watered or not (Crops.advanceWithin — the crop model stays in crops.js).
  // Refused, and the powder kept, when no unripe crop is in range: a scatter
  // that moved nothing is not a use.
  useGrowthPowder() {
    if (!this._selectedConsumable('growth_powder')) return false;
    const n = this.advanceCropsWithin(GROWTH_POWDER_R_M);
    if (n <= 0) {
      this.flash(`No crop within ${GROWTH_POWDER_R_M}m — kept.`,
        this.viewCenterX, this.viewCenterY);
      return false;
    }
    // THE BLAST — the same fanfare a street and a wreck get, scaled to what a
    // scatter of powder covers. advanceCropsWithin has already thrown a
    // 'sprout' over every plant that moved (the leaves ARE the growth); this
    // is the green ring around them, off the powder's own radius so the flash
    // says how far the scatter reached rather than going off at the feet. It
    // is thrown from the PLAYER's world point — the powder leaves the hand,
    // and the sweep it drives is centred there too (advanceCropsWithin reads
    // the same point), so the ring and the crops it sprang share a centre.
    const feet = playerWorldM(this);
    this._blastAt(feet.x, feet.y, {
      radiusCells: GROWTH_POWDER_R_M / this.cellM,
      ringPx: GROWTH_POWDER_R_M * CELL_PX / this.cellM,
      sparks: 'greenspark',
    });
    this._consumeSelected();
    this.flashLoot(`🌱 ${n} crop${n === 1 ? '' : 's'} sprang ahead`, UI_GREEN, 1.8, 'growth_powder');
    return true;
  }

  // ── THE SAFETY CARD ──────────────────────────────────────────────────────
  // A FULL-SCREEN card, bold, dismissed only by a tap. The REMINDERS: a short
  // one on RESUME after SAFETY_RESUME_GAP_MS in the background, and a short
  // one at DUSK (the sun crossing SAFETY_DUSK_DAYLIGHT, once a UTC day). The
  // long opening message is the loading screen itself (index.html #safety —
  // owner, Sep 2026: a card over the freshly loaded map got tapped away
  // unread; on the loading screen it is what there is to read). Every
  // version says the one thing the game most needs you to do: reach what is
  // out of reach with the STICK, never by stepping into the street. The shared
  // story shell frames its painting; the full-cover backdrop stays above every
  // other dialog and .game-modal keeps movement pads hidden underneath.
  _showSafetyCard(which) {
    if (window.__TEST_MODE || typeof document === 'undefined') return;
    const card = SAFETY_CARDS[which];
    const host = document.getElementById('game');
    if (!card || !host) return;
    const { wrap, box, mount } = this.makeModalShell('safety-card', {
      kind: 'story', kindLabel: 'Safety', art: 'safety_phone',
      zIndex: 400, wrapBg: 'rgba(12,9,6,0.96)',
      wrapExtra: 'cursor:pointer;',
      boxExtra: 'color:#fff4e0;font-weight:700;line-height:1.35;',
    });
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'safety-card-title');
    const title = document.createElement('div');
    title.id = 'safety-card-title';
    title.textContent = card.title;
    title.style.cssText = 'font-size:22px;font-weight:900;color:#ff8c3b;letter-spacing:1px;margin-bottom:10px;';
    box.appendChild(title);
    for (const line of card.lines) {
      const p = document.createElement('div');
      p.textContent = line;
      p.style.cssText = 'font-size:17px;margin:6px 0;max-width:340px;';
      box.appendChild(p);
    }
    const tap = document.createElement('div');
    tap.textContent = 'Tap to continue';
    tap.style.cssText = `margin-top:14px;font-size:15px;font-weight:800;color:${UI_GOLD};`
      + `border:2px solid ${UI_GOLD};border-radius:8px;padding:10px 18px;`;
    box.appendChild(tap);
    const done = (e) => { e?.stopPropagation?.(); e?.preventDefault?.(); wrap.remove(); };
    wrap.addEventListener('pointerup', done);
    wrap.addEventListener('click', done);
    mount();
  }
  // THE HEADS-UP BUZZ: wanderCreatures hands over the nearest hostile taking
  // an interest this tick; inside SAFETY_FOE_BUZZ_CELLS the phone vibrates,
  // at most once per SAFETY_FOE_BUZZ_GAP_MS (haptic — the save's switch).
  _foeHeadsUp(distM, now) {
    if (!(distM <= SAFETY_FOE_BUZZ_CELLS * this.cellM)) return;
    if (now - (this._foeBuzzT ?? -Infinity) < SAFETY_FOE_BUZZ_GAP_MS) return;
    this._foeBuzzT = now;
    this.haptic(SAFETY_FOE_BUZZ);
  }
  // The resume and dusk reminders. RESUME is stamped by the lifecycle's
  // visible transition (scene_geo.js onVis → _safetyOnResume); DUSK is read
  // here, throttled to SAFETY_TICK_MS, off Lighting.daylight — the same sun the
  // lightmap and the ghosts read — on the surface only.
  _safetyOnResume(hiddenMs) {
    if (hiddenMs >= SAFETY_RESUME_GAP_MS) this._showSafetyCard('resume');
  }
  _tickSafetyReminders(now = Date.now()) {
    if (now - (this._safetyTickT || 0) < SAFETY_TICK_MS) return;
    this._safetyTickT = now;
    if ((this.depth || 0) !== 0 || typeof Lighting === 'undefined' || !this._bootOverlayGone) return;
    const day = Lighting.daylight(this, now);
    const was = this._safetyLastDay;
    this._safetyLastDay = day;
    // Once a UTC day, in the one day ledger (a reload does not repeat it).
    if (was != null && was >= SAFETY_DUSK_DAYLIGHT && day < SAFETY_DUSK_DAYLIGHT && !Macros.usedToday(this.save, SAFETY_DUSK_LEDGER, now)) {
      Macros.markToday(this.save, SAFETY_DUSK_LEDGER, now);
      persistSave(this.save);
      this._showSafetyCard('dusk');
    }
  }

  // True while a Shadow Powder is active: the same in-memory timer the dragon
  // keeps (this._shadowUntil, NOT persisted — a refresh ends it). wanderCreatures
  // reads it to switch off every hostile's pursuit AND its hit; startCombat and
  // the ranged cadence read it too, so the player's own arm stays quiet for the
  // spell.
  isShadowActive() {
    return (this._shadowUntil ?? 0) > Date.now();
  }

  // Powder, collapse and passenger safety conceal the player from everyone.
  // Moss conceals them from creatures they have not struck during this boon.
  // With no creature, this also drives the player's faded appearance.
  isUnnoticed(creature = null) {
    const moss = Shrines.leverActive(this.save, 'hidden')
      && (!creature || creature._mossProvokedUntil !== this.save.boonUntil.hidden);
    return this.isShadowActive() || moss || Combat.playerDowned(this.save.energy) || this.isTooFast();
  }
  // TOO FAST: the player's real GPS track is running at a ride's pace,
  // sustained (util.js speedGateStep, stepped per fix by scene_geo.js
  // _trackSpeedGate). A THIRD reason on the unnoticed lane — nothing hunts a
  // passenger — and the gate every reward that wants a walker reads: no
  // street restores (_sweepStreets), so no trail metres, and no taps, so no
  // pickups (handleWorldTap).
  isTooFast() {
    return !!(this._speedGate && this._speedGate.tooFast
      && !this._speedGateStale());
  }
  // A gate whose last fix is long gone judges nothing (the phone stopped
  // reporting): util.js clears it on the next fix, this clears it NOW.
  _speedGateStale() {
    const g = this._speedGate;
    return !g || g.lastT == null || Date.now() - g.lastT > SPEED_GATE_STALE_MS;
  }
  // The card a trip of the gate shows — once per ride, never repeated while
  // it holds. A modal, not a toast: it has to be read, and it is the moment
  // the game has something to say about safety.
  _showPassengerCard() {
    this.showMessageModal?.({
      kind: 'note',
      title: 'Too fast — are you a passenger?',
      body: 'You are moving faster than anyone walks. While you ride, the street does not mend, nothing is picked up and nothing hunts you. '
        + 'If you are driving or cycling, put the phone away — the lane will wait for you on foot.',
    });
  }

  // True while a Torch burns: the same in-memory timer the dragon keeps
  // (this._torchUntil, NOT persisted — a refresh puts it out). Lighting.draw
  // reads it through Lighting.playerKind to stamp the `torch` row at the feet.
  // The Torch (the `torch` buff): for its three minutes the player's own light
  // reaches TORCH_RADIUS_MUL times as far — the `torch` row of Lighting.KINDS,
  // added on top of the reach ramp (light adds; the plateau, and so the tap
  // gate, are untouched). Never gated on depth: a torch by night on the
  // surface is fine, and free.
  isTorchActive() {
    return (this._torchUntil ?? 0) > Date.now();
  }

  // The ENEMIES (Combat.isEnemy, never a caught one) `where` accepts, over
  // the loaded tiles round the player.
  _enemiesWhere(where) {
    const caught = setOf(this.save.caught);
    const targets = [];
    const pc = this.playerToWorldCell();
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, c => {
      if (Combat.isEnemy(c) && !caught.has(c.id) && where(c)) targets.push(c);
    });
    return targets;
  }
  // …drawn inside the viewport (a draw-space test, Particles.onScreen on
  // worldMetersToScreen — not a reach test).
  _onscreenEnemies() {
    return this._enemiesWhere(c => {
      const p = this.worldMetersToScreen(c.x, c.y);
      return !!p && Particles.onScreen(this, p.x, p.y);
    });
  }
  // …standing IN REACH — the lit plateau the tap gate accepts (cellInReach).
  _enemiesInReach() {
    return this._enemiesWhere(c => {
      const fc = worldMetersToAbsCell(this, c.x, c.y);
      return cellInReach(this, fc.cellIX, fc.cellIY);
    });
  }
  // CAST row `id` on every foe its scope holds (CAST_ROWS above). Refused —
  // and the item kept — when none is there, or while downed (no reach). A
  // tome passes its own `damage`, `noun` and `spend: false`.
  _castOnFoes(id, { damage = CONSUMABLE_SPEC[id]?.damage, spend = true, noun } = {}) {
    const row = CAST_ROWS[id];
    if (!row || (spend && !this._selectedConsumable(id)) || Combat.playerDowned(this.save.energy)) return false;
    const reach = row.scope === 'reach';
    const targets = reach ? this._enemiesInReach() : this._onscreenEnemies();
    if (!targets.length) {
      this.flashAtPlayer(kept(reach ? 'No foe in reach' : 'No foe in sight', noun || row.noun));
      return false;
    }
    row.before?.(this);
    const now = row.clock === 'wall' ? Date.now() : performance.now();
    let felled = 0;
    for (const c of targets) if (row.apply(this, c, now, damage)) felled++;
    if (!spend) return true;
    this._spendScroll(id);
    row.note?.(this, targets.length, felled, id);
    return true;
  }

  useFireballScroll() {
    const sel = this._selectedConsumable('fireball_scroll');
    if (!sel || Combat.playerDowned(this.save.energy)) return false;
    const { x, y } = playerWorldM(this);
    const heading = Combat.shotHeading('bow', x, y, this.facing);
    const shot = Combat.spawnFireball(x, y, heading, this.cellM, CONSUMABLE_SPEC.fireball_scroll);
    if (!shot) return false;
    this._shots.push(shot);
    return this._spendScroll(sel.id);
  }

  // The map's mark EXTENDS like every timed thing (Buffs.laterOf): a second
  // map read inside the first's quarter hour banks the time on the new mark.
  useTreasureMap() {
    const sel = this._selectedConsumable('treasure_map');
    if (!sel) return false;
    const target = this.findNearestUnopenedChest([4, 5]);
    if (!target) {
      this.flashAtPlayer(kept('No treasure found', 'map'));
      return false;
    }
    this.save.treasureCompass = { x: target.x, y: target.y, targetId: target.id,
      depth: this.depth || 0, until: Buffs.laterOf(this.save.treasureCompass?.until, CONSUMABLE_SPEC.treasure_map.durationMs) };
    this._spendScroll(sel.id);
    this.flashLoot(`Treasure marked for ${shortDuration(CONSUMABLE_SPEC.treasure_map.durationMs)}.`, '#ffd166', 1.8, sel.id);
    return true;
  }

  throwCooldownLeft() {
    return Math.max(0, (this._throwReadyAt || 0) - performance.now());
  }

  throwActionLabel() {
    const left = this.throwCooldownLeft();
    return left > 0 ? `Throw · ${shortDuration(left)}` : 'Throw';
  }

  canThrowItem(id) {
    const sel = getSelectedSlot(this.save);
    return sel?.id === id && (sel.count ?? 0) > 0
      && !Combat.playerDowned(this.save.energy) && !this.isShadowActive()
      && this.throwCooldownLeft() <= 0;
  }

  // All hand throws share one deadline: swapping stacks or weapons cannot
  // bypass the last throw's recovery. Misses spend ammo; refused throws do not.
  // Reuse arrow flight/collision while keeping fixed damage independent of gear.
  _throwItem(id) {
    if (!this.canThrowItem(id)) return false;
    const potion = isPotion(id);
    const cfg = potion ? { damage: 0, projectile: id, throwCooldownMs: POTION_THROW_COOLDOWN_MS } : CONSUMABLE_SPEC[id];
    const { x, y } = playerWorldM(this);
    const heading = Combat.shotHeading('bow', x, y, this.facing);
    const shot = Combat.spawnShot('bow', x, y, heading, this.cellM,
      cfg.damage, 1, reachCells(this));
    if (!shot) return false;
    shot.projectile = cfg.projectile;
    if (potion) shot.potionId = id;
    if (cfg.effect) shot.effect = cfg.effect;
    this._shots.push(shot);
    this._throwReadyAt = performance.now() + cfg.throwCooldownMs;
    return this._consumeSelected();
  }

  useSpear() {
    return this._throwItem('throwing_spear');
  }

  useJavelin() {
    return this._throwItem('javelin');
  }

  useRock() {
    return this._throwItem('rubble');
  }

  useForgetmenot() {
    return this._throwItem('forgetmenot');
  }

  useWildrose() {
    return this._throwItem('wildrose');
  }

  // Ride / Dismount (items.js CONSUMABLE_SPEC.horse — an `immediate` row, so
  // nothing is spent). The skin follows from isRiding every frame
  // (SpriteLayout.playerArt), and so does the stick's speed and cost.
  toggleHorseRide() {
    const horse = Pets.ownedKind(this.save, 'horse');
    if (!horse || Pets.isDown(horse)) return false;
    this.save.riding = !isRiding(this.save);
    persistSave(this.save);
    if (this.save.riding) this.flash(`Stick ×${HORSE_RIDE.speedMul} speed, ×${HORSE_RIDE.energyMul} ⚡`);
    else this.flash('You dismount.');
    return true;
  }

  // A sapphire opens a descent and a brief return to the exact entry point.
  // The Return status chip stays available after spending the last gem.
  useSapphirePortal() {
    if (!this._selectedConsumable('sapphire')) return false;
    if ((this.save.energy ?? 0) <= 0) {
      this.flashAtPlayer('Too tired to open a portal.');
      return false;
    }
    const fromDepth = this.depth || 0;
    const depth = fromDepth + 1;
    if (typeof DungeonProgression !== 'undefined' && !DungeonProgression.canUseDescent(this.save, fromDepth, depth, 'sapphire')) {
      this.flashAtPlayer(fromDepth === 1 ? 'Use a rope or repair the elevator to go deeper.' : 'Solve five arena challenges to earn the Level 4 key.');
      return false;
    }
    const feet = playerWorldM(this), stair = { x: feet.x, y: feet.y + this.feetOffsetM };
    // A mined entry may still be solid rock below. Open that landing just as
    // rope does, before changeDepth asks the destination tile to render.
    const cell = this.cellAt(stair.x, stair.y);
    const landing = `${depth}:${cellKeyFromAbsCell(cell.cellIX, cell.cellIY)}`;
    const wasOpen = this.dugWallSet.has(landing);
    this.dugWallSet.add(landing);
    this.changeDepth(+1, stair);
    if (this.depth !== depth) {
      if (!wasOpen) this.dugWallSet.delete(landing);
      return false;
    }
    consumeSelected(this.save);
    this.save.sapphireReturn = { fromDepth, depth, ...stair,
      until: Date.now() + CONSUMABLE_SPEC.sapphire.returnMs };
    persistSave(this.save);
    this.buildInventoryDOM();
    this._syncStatusRow();
    return true;
  }

  sapphireReturnPortal(now = Date.now()) {
    const portal = this.save.sapphireReturn;
    if (!portal || !Number.isInteger(portal.fromDepth) || portal.fromDepth < 0
        || portal.depth !== portal.fromDepth + 1 || this.depth !== portal.depth
        || !Number.isFinite(portal.x) || !Number.isFinite(portal.y)
        || !Number.isFinite(portal.until) || portal.until <= now) return null;
    return portal;
  }

  returnThroughSapphire() {
    const portal = this.sapphireReturnPortal();
    if (!portal) return false;
    // The entry is a cell the player already occupied. No extra excavation,
    // gem or energy is needed to return, even with an exhausted energy bar.
    this.changeDepth(-1, { x: portal.x, y: portal.y });
    if (this.depth !== portal.fromDepth) return false;
    delete this.save.sapphireReturn;
    persistSave(this.save);
    this._syncStatusRow();
    return true;
  }

  // Rope: spend one to move a level UP (delta -1) or DOWN (delta +1), in
  // place — the Use-button dialog asks which way (the rope row of CONSUMABLE
  // in syncConsumableButton offers both). Up from the surface is refused:
  // there is nowhere to climb to. Down on an empty tank is refused here, the
  // same gate changeDepth applies to a staircase, so — like the sapphire —
  // the rope is only consumed once the move actually happens.
  //
  // THE LANDING CELL IS OPENED BEFORE THE MOVE. Cave levels mirror the
  // surface, so a floor cell here is floor on the next level too — except a
  // cell the player MINED, which is dug on this level only and solid rock one
  // level up or down. Stamping the landing into dugWalls at the target depth
  // lets _applyDugWalls (run over every tile of every ensureTilesAround pass,
  // cached or fresh, and a no-op on a cell that is floor already) open it as
  // the new level comes in, so the rope never lowers the player into the wall
  // of the tunnel they just dug. The surface has no walls to open.
  useRope(delta) {
    if (!this._selectedConsumable('rope')) return false;
    const target = (this.depth || 0) + delta;
    if (delta > 0 && typeof DungeonProgression !== 'undefined' && !DungeonProgression.canEnterDepth(this.save, target)) {
      this.flashAtPlayer('Solve five arena challenges to earn the Level 4 key.');
      return false;
    }
    if (target < 0) {
      this.flashAtPlayer('Nowhere to climb up here.');
      return false;
    }
    if (delta > 0 && (this.save.energy ?? 0) <= 0) {
      this.flashAtPlayer('Too tired to climb down.');
      return false;
    }
    // Synthetic "stair" at the player's own world cell, as the portal does:
    // changeDepth GPS-mirrors the feet onto it, so the move is straight up or
    // down with no sideways step.
    const feet = playerWorldM(this), anchor = { x: feet.x, y: feet.y + this.feetOffsetM, descentSource: 'rope' };
    let landingKey, landingWasOpen;
    if (target > 0) {
      const c = this.cellAt(anchor.x, anchor.y);
      landingKey = `${target}:${cellKeyFromAbsCell(c.cellIX, c.cellIY)}`;
      landingWasOpen = this.dugWallSet.has(landingKey);
      this.dugWallSet.add(landingKey);
    }
    this.changeDepth(delta, anchor);
    if (this.depth !== target) {
      if (landingKey && !landingWasOpen) this.dugWallSet.delete(landingKey);
      return false;
    }
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    return true;
  }
  useRopeUp()   { return this.useRope(-1); }
  useRopeDown() { return this.useRope(+1); }

  // Snapshot only unspent secrets currently on screen, including a peeked view.
  // The renderer replays their own short cue; the orb and rewards stay intact.
  useOrb() {
    if (!this._selectedConsumable('orb')) return false;
    const pc = this.playerToWorldCell();
    const spent = spentSets(this, this.save);
    const now = Date.now();
    const reveal = new Map();
    const collect = o => {
      if (isSpent(o, spent)) return;
      const at = worldMetersToScreen(this, o.x, o.y);
      if (at.x < this.viewLeft || at.x > this.viewLeft + this.viewSize
          || at.y < this.viewTop || at.y > this.viewTop + this.viewSize) return;
      reveal.set(o.id, now);
    };
    WorldGen.forEachItemNear('wildplants', pc.tx, pc.ty, o => {
      if (isNestBush(o.crop, o.id)) collect(o);
    });
    WorldGen.forEachItemNear('objects', pc.tx, pc.ty, o => {
      if (o.kind === 'mineralrock' && isGlintRock(o)) collect(o);
      if (o.kind === 'chest' && !spent.opened.has(o.id)) {
        const look = chestLook(o);
        // POIs share kind:'chest', but shops, barrels and services are not
        // unopened treasure. Match the actual chest/crate art only.
        if (look.texKey === 'chest' || look.texKey === 'box') collect(o);
      }
    });
    this._orbReveal = reveal;
    this.flashAtPlayer(reveal.size ? 'Hidden things stir.' : 'Nothing stirs nearby.');
    return true;
  }

  eatSelected() {
    const sel = getSelectedSlot(this.save);
    if (!sel || (sel.count ?? 0) <= 0) return false;
    // Hard mode's zero-energy lockout (see _zeroEnergyLocked): once the tank
    // is empty, a Crow Feather is the one food that still works — it revives
    // to REVIVE_ITEM_FRAC of the bar, less than reaching the trailer gives
    // (see the Home rest in update()). Every other food refuses outright while locked,
    // so eating around the lockout isn't an option.
    const locked = this._zeroEnergyLocked();
    const featherRevive = locked && sel.id === 'crow_feather';
    if (locked && !featherRevive) return false;
    // The bite cooldown (Energy.canEat — ten seconds between mouthfuls). The
    // same expression the Eat button greys itself on, so a tap can never do
    // what the button says it won't; the countdown ON the button is the whole
    // feedback, which is why this refuses silently rather than flashing a
    // toast over the cell the player is looking at. Potions never reach here —
    // they are drunk through syncConsumableButton's own methods.
    if (!Energy.canEat(this.save)) return false;
    const restore = featherRevive ? null : FOOD_ENERGY[sel.id];
    if (!featherRevive && restore == null) return false;
    if (Energy.fishRegenWait(this.save, sel.id)) return false;
    const { gained, extra } = this._consumeFoodEffects(sel.id, featherRevive);
    if (!ITEM_BY_ID[sel.id]?.reusable) consumeSelected(this.save);
    // Armed only now, after a bite has actually landed.
    Energy.startEatCooldown(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    this.updateEnergyDOM();
    // Quiet pop-up instead of a modal — eating is a frequent action and a
    // dismiss-tap every time would get old fast. Longer dwellMul so the
    // gain (+ any compass / water side-effect) is readable before fading.
    const flashMsg = Energy.fishRegenTotal(sel.id) || CONSUMABLE_SPEC[sel.id]?.eatLabel
      ? extra.trim() : `+${gained}⚡${extra}`;
    this.flashLoot(flashMsg, UI_GREEN, 1.8, sel.id);
    return true;
  }

  // Food effects are shared by eating and the Wayfarer's gift. The caller
  // owns inventory, cooldown and persistence; a shrine needs none of those gates.
  _consumeFoodEffects(id, featherRevive = false, now = Date.now()) {
    const restore = FOOD_ENERGY[id];
    // First taste of a new edible permanently grows the bar by its food tier
    // (Energy.tasteBonus; Energy.maxEnergy folds save.eaten into the cap). Recorded BEFORE the restore below so the new headroom is fillable
    // by this very bite.
    let firstTaste = false;
    this.save.eaten = this.save.eaten || [];
    if (!this.save.eaten.includes(id)) {
      this.save.eaten.push(id);
      firstTaste = true;
    }
    const before = this.save.energy ?? 0;
    const fish = Energy.fishRegenTotal(id);
    if (featherRevive) Energy.set(this.save, FEATHER_REVIVE_ENERGY);
    else if (fish) {
      this.getMaxEnergy(); // First taste raises the cap, without healing.
      Energy.startFishRegen(this.save, id, now);
    } else Energy.set(this.save, before + restore, this.getMaxEnergy());
    const gained = this.save.energy - before;
    // Special effects.
    let extra = fish ? `\nRegen: ${fish}⚡ over ${shortDuration(Energy.FISH_REGEN_MS)}` : '';
    // Every timed effect a food lends EXTENDS (Buffs.extend / laterOf — the
    // one rule): a second coffee inside the first banks its three minutes.
    if (id === 'pairy') {
      const target = this.findNearestUnopenedChest();
      if (target) {
        this.pairyCompass = { targetId: target.id, x: target.x, y: target.y,
          until: Buffs.laterOf(this.pairyCompass?.until, CONSUMABLE_SPEC.pairy.durationMs, now) };
        extra = `\n🧭 chest compass: ${shortDuration(this.pairyCompass.until - now)}`;
      } else {
        extra = `\n🧭 no chests nearby`;
      }
    } else if (id === 'rainberry') {
      const spec = CONSUMABLE_SPEC.rainberry;
      const { n: watered, jumped } = this.waterCropsWithin(spec.radiusM, spec.canTier);
      this._rainOver(spec.radiusM);
      extra = watered > 0 ? `\n💧 watered ${watered} crop${watered === 1 ? '' : 's'}` : '\n💧 no crops nearby';
      if (jumped > 0) extra += `\n🌱 ${jumped} sprang ahead a stage`;
    } else if (id === 'coffee') {
      Buffs.extend(this.save, this, 'coffee', CONSUMABLE_SPEC.coffee.durationMs, now);
      extra = `\n☕ faster stick walking, ${shortDuration(Buffs.until('coffee', this.save, this) - now)}`;
    } else if (id === 'dawnfruit') {
      Buffs.extend(this.save, this, 'dawnfruit', CONSUMABLE_SPEC.dawnfruit.durationMs, now);
      extra = `\nFull light and vision: ${shortDuration(Buffs.until('dawnfruit', this.save, this) - now)}`;
    } else if (id === 'miracle_lettuce') {
      const spec = CONSUMABLE_SPEC.miracle_lettuce;
      Buffs.extend(this.save, this, 'lettuce', spec.durationMs, now);
      extra = `\n+${spec.luckBonus} Luck: ${shortDuration(Buffs.until('lettuce', this.save, this) - now)}`;
    } else if (id === 'worldpeach' && Conditions.clearDebuffs(this.save)) {
      extra = '\nDebuffs cleared';
    }
    if (firstTaste) extra += `\n🍽 first taste: +${Energy.tasteBonus(id)} max ⚡`;
    return { gained, extra };
  }

  _tickShrineRegen(dt, now = Date.now()) {
    const gained = Energy.tickShrineRegen(this.save, this, dt, now);
    if (gained > 0) this.updateEnergyDOM();
  }

  _tickFishRegen(now = Date.now()) {
    const gained = Energy.tickFishRegen(this.save, now);
    if (gained > 0) this.updateEnergyDOM();
  }

  _telescopeSearch(category) {
    const objects = [], wildplants = [], creatures = [];
    for (const entry of WorldGen.tileCache.values()) {
      objects.push(...(entry.objects || []));
      wildplants.push(...(entry.wildplants || []));
      creatures.push(...(entry.creatures || []));
    }
    return Scenic.telescopeTarget(category, {
      player: playerWorldM(this),
      depth: this.depth || 0, objects, wildplants, creatures,
      save: this.save, sets: spentSets(this, this.save),
    });
  }

  presentTelescopeMenu(sx, sy, scope) {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('telescope-modal', {
      kind: 'note', kindLabel: 'Looking glass', art: Scenic.VISTA_STORY.story,
    });
    const prompt = document.createElement('p');
    prompt.textContent = 'You see... everything! Look for: treasure, danger or solace?';
    box.appendChild(prompt);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:12px;opacity:.85';
    status.textContent = `A golden dot marks your find for ${shortDuration(Scenic.TELESCOPE_DURATION_MS)}.`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap';
    for (const option of Scenic.TELESCOPE_OPTIONS) {
      const button = mkBtn(option.label, true, false);
      button.addEventListener('click', e => {
        e.stopPropagation();
        const target = this._telescopeSearch(option.id);
        if (!target) {
          status.textContent = 'Nothing like that in sight. Try another search or another lookout.';
          return;
        }
        this.save.telescopeCompass = target;
        persistSave(this.save);
        wrap.remove();
        this.flash('Follow the golden dot.', sx, sy);
      });
      row.appendChild(button);
    }
    box.appendChild(row);
    box.appendChild(status);
    const leave = mkBtn('Leave', false, false);
    leave.addEventListener('click', e => { e.stopPropagation(); wrap.remove(); });
    box.appendChild(leave);
    mount();
  }

  // Keep a moving find's bearing current while it is loaded. An unloaded
  // target keeps its last known position; absence from cache is not collection.
  _telescopeTrackedTarget(marker) {
    const id = marker.targetId;
    for (const field of ['opened', 'picked', 'chopped', 'caught', 'burnedObjects', 'brokenRocks']) {
      if ((this.save[field] || []).includes(id)) return null;
    }
    if (marker.category === 'shiny' && this.save.fruitPicked?.[id] >= marker.until - Scenic.TELESCOPE_DURATION_MS) return null;
    const field = marker.type === 'creature' ? 'creatures' : marker.type === 'wildplant' ? 'wildplants' : 'objects';
    for (const entry of WorldGen.tileCache.values()) {
      const target = (entry[field] || []).find(o => o.id === id);
      if (!target) continue;
      if (marker.type === 'creature') {
        if (target._surfaceInactive || target._hp <= 0 || target.hp <= 0) return null;
      } else if (isSpent(target, spentSets(this, this.save))) return null;
      marker.x = target.x;
      marker.y = target.y;
      marker.label = target.name || target.roleLabel || target.kind || marker.label;
      return target;
    }
    return marker;
  }

  // Find the nearest chest the player hasn't opened. Used by the pairy compass.
  findNearestUnopenedChest(tiers = null) {
    const sets = spentSets(this, this.save);
    // A macro stall (an inn, a chapel, … — loot.js macroFor) is a place,
    // not a chest to find; nor is a barrel, a bike rack or a pot of gold.
    return this._nearestObject((o) => o.kind === 'chest' && (!tiers || tiers.includes(chestTier(o))) && !isSpent(o, sets)
      && !(macroFor(o) || isBarrel(o) || isBikeRack(o) || isPotOfGold(o)));
  }

  // Water every planted crop within ${radius} meters of the player. Returns count.
  // Sets watered_t = now on cells that aren't already watered or at MAX_GROWTH_STAGE.
  // `canTier` is the can the soak counts as (the rainberry's Gold,
  // CONSUMABLE_SPEC.rainberry.canTier): the player's own can is used when it
  // is the better of the two, so owning a Frost can is never undercut.
  waterCropsWithin(radius, canTier = 0) {
    const { x: pWX, y: pWY } = playerWorldM(this);
    // The can's jump roll applies here too — a rainberry soaking the whole
    // plot is still the player watering, so it is still worth owning a can.
    const own = this.save.relics || {};
    const relics = (canTier > (own.watering_can?.tier || 0)) ? { ...own, watering_can: { ...(own.watering_can || {}), tier: canTier } } : own;
    const jumpedPlants = [];
    const out = Crops.waterWithin(this.save, pWX, pWY, radius, Date.now(), relics,
                                  Math.random, jumpedPlants);
    for (const p of jumpedPlants) this._burstAtWorld('sprout', p.x, p.y);
    return out;
  }

  // THE SHOWER: rain over the `radiusM` disc round the feet — the rainberry's
  // soak made visible (owner, Sep 2026: eating one showed only the toast).
  // A scatter of 'rain' bursts (particles.js), each launched RAIN_DROP_CELLS
  // above its ground point so the drops fall in and fade as they land. Off
  // the projection, never the viewport centre, and gated on screen per point
  // by _burstAt's caller contract (Particles.onScreen).
  _rainOver(radiusM) {
    if (typeof Particles === 'undefined' || !this.worldMetersToScreen || !this.startWorldM || !this.originPx) return 0;
    const { x: pWX, y: pWY } = playerWorldM(this);
    const cellM = this.cellM || 1;
    const points = Math.max(6, Math.min(RAIN_MAX_POINTS, Math.round(Math.PI * (radiusM / cellM) ** 2)));
    let n = 0;
    for (let i = 0; i < points; i++) {
      // Even over the disc (sqrt on the radius), a golden-angle turn per point.
      const r = radiusM * Math.sqrt((i + 0.5) / points), a = i * 2.399963;
      const p = this.worldMetersToScreen(pWX + Math.cos(a) * r, pWY + Math.sin(a) * r);
      if (!p) continue;
      const y = p.y - RAIN_DROP_CELLS * CELL_PX;
      if (!Particles.onScreen(this, p.x, y, CELL_PX * (RAIN_DROP_CELLS + 1))) continue;
      n += Particles.burst(this, 'rain', p.x, y);
    }
    return n;
  }

  // Spring every unripe crop within ${radius} metres of the player one stage
  // ahead, no watering involved (the Growth Powder). Returns the count.
  advanceCropsWithin(radius) {
    const { x: pWX, y: pWY } = playerWorldM(this);
    // Leaf flecks off each plant that sprang — the SAME cue the 15-minute
    // tick (advanceGrowth) and the can's jump (waterCropsWithin) throw, for
    // the same event. _burstAtWorld drops the ones off-screen, so a scatter
    // at the edge of a big plot only pays for the leaves you can see.
    const movedPlants = [];
    const n = Crops.advanceWithin(this.save, pWX, pWY, radius, movedPlants);
    for (const p of movedPlants) this._burstAtWorld('sprout', p.x, p.y);
    return n;
  }

  // Confirmation dialog shown BEFORE an item is fed to a creature, so a stray
  // tap never silently consumes food. It spells out exactly WHAT is being fed
  // to WHICH fauna (icon + name on each side) and runs onConfirm() only if the
  // player accepts; Cancel or a backdrop tap aborts without consuming anything.
  showFeedConfirm({ foodId, faunaKind, onConfirm }) {
    const foodName  = itemName(foodId);
    const faunaName = itemName(faunaKind);
    const side = (iconId, label) =>
      `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:3px">` +
        `${this.iconSpanHTML(iconId, 32)}<span style="font-size:11px">${label}</span></span>`;
    this.showConfirmModal({
      id: 'feed-confirm-modal',
      kind: 'farm',
      title: `Feed the ${faunaName}?`,
      body:
        `<div style="display:flex;align-items:center;justify-content:center;gap:12px">` +
          side(foodId, foodName) +
          `<span style="font-size:18px;opacity:.7">→</span>` +
          side(faunaKind, faunaName) +
        `</div>`,
      acceptLabel: 'Feed',
      onAccept: onConfirm,
    });
  }

  // Stats / Relics menu — shows energy and every equipped relic / armor slot.
  // Building-flavored title for an offer modal. Different building kinds
  // (castle / fort / market / trader / blacksmith / plain house) get their
  // own greeting so the player can tell at a glance what they walked into,
  // instead of every dialog reading "A trader offers:". `action` is one of:
  //   'buy'      → routine seed/produce/barter buy
  //   'relic'    → a relic offer (non-starter)
  //   'forge'    → blacksmith forge offer
  // Anything held over a campfire that the fire can't MAKE something of
  // (items.js CAMPFIRE_MAKES) is burned — one of it, after this confirm.
  // Tapped from interact.js 'fire-held' with the fire's world point. The
  // accept re-checks the hand: the selection can change while the dialog is
  // up, and only what is still held goes in. What the fire does with it is
  // items.js fireBurnOutcome: ash, a potion TRANSMUTED, or a potion that
  // EXPLODES (_potionBlast). The dialog hints, never names, which.
  presentBurnConfirm(id, fire = null) {
    if (document.getElementById('offer-modal')) return;
    const name = itemName(id);
    const out = fireBurnOutcome(id);
    this.showOfferModal({
      kind: 'fire',
      kindIcon: this.worldIconHTML('bonfire') || undefined,
      title: `Burn ${name}?`,
      getLabel: 'Into the fire',
      get: `${this.iconSpanHTML(id)} ${name} ×1`,
      blurb: out.transmute ? 'Something in it stirs at the heat.'
        : out.blastDmg ? 'It fizzes dangerously near the flame.'
        : 'It will not come back.',
      canAfford: true,
      acceptLabel: 'Burn',
      cancelLabel: 'Keep',
      onAccept: () => {
        const sel = getSelectedSlot(this.save);
        if (!sel || sel.id !== id || (sel.count ?? 0) <= 0) return;
        consumeSelected(this.save);
        if (out.transmute) {
          // One potion out, one in: a stack of one freed its own slot, and a
          // bigger stack still has it, so a refusal only ever means a full
          // bag with a new stack — hand the potion back rather than lose it.
          if (!this.addToInv(out.transmute, 1, false, { notWild: true })) {
            this.addToInv(id, 1, true, { notWild: true });
          } else {
            if (fire) this._burstAtWorld('greenspark', fire.x, fire.y);
            this.flashLoot(`✨ ${itemName(out.transmute)}`, '#c7a7ff', 1.4, out.transmute);
          }
        } else if (out.blastDmg) {
          this._potionBlast(out.blastDmg, fire);
        } else {
          this.flashLoot('🔥 burned', '#ffb070', 1, id);
        }
        persistSave(this.save);
        this.buildInventoryDOM();
      },
    });
  }

  // A potion that explodes in the fire (items.js fireBurnOutcome). A blow on
  // the body like any other: armour soaks it (Combat.playerDamage), nothing
  // comes off an empty bar, it flinches the sprite where it is banked and
  // pops its −N⚡ on the player's cell.
  _potionBlast(rawDmg, fire) {
    const before = this.save.energy ?? 0;
    if (fire) this._burstAtWorld('pain', fire.x, fire.y, { ringPx: CELL_PX / 3 });
    if (fire) this.flashAtWorld('💥 It exploded!', fire.x, fire.y);
    else this.flash('💥 It exploded!');
    if (Combat.playerDowned(before) || Conditions.damageImmune(this.save)) return 0;
    const dmg = Combat.playerDamage(rawDmg, this.save.armor);
    Energy.set(this.save, before - dmg);
    const lost = before - this.save.energy;
    this._flashPlayerHit(lost);
    this._popEnergy(-lost);
    this._warnIfTiring(before);
    if (this.updateEnergyDOM) this.updateEnergyDOM();
    return lost;
  }

  // ── THE MACRO STALLS (loot.js macroFor; the rules are src/macros.js) ─────
  // An in-building POI is a place you come BACK to: its tap is a service and
  // it is never consumed (no save.opened). interactables.js INTERACTABLES.chest
  // routes every kind here except the chapel, which pays through the chest
  // ceremony. Each kind's FIRST tap tells what the place is (the story
  // ledger, `macro:<kind>:<id>`) and opens the dialog when that is dismissed.
  presentMacro(sx, sy, o, macro = macroFor(o)) {
    if (!macro || document.getElementById('offer-modal')) return;
    const kind = macro.kind;
    if (this._macroStory(kind, () => this.presentMacro(sx, sy, o, macro), o)) return;
    // The kind's row names its presenter (`present`, a scene method); a
    // stall with a `stock` is the shared stall offer with that stock and the
    // row's `title`, the others take the place and its dress.
    const d = Macros.KIND_DIALOG[kind];
    if (!d?.present) return undefined;
    const dress = { boothKind: kind, kind: d.modal, kindLabel: Macros.stallLabel(kind, o) || d.label, art: Macros.stallArt(kind, o) };
    if (!d.stock) return this[d.present](sx, sy, o, dress);
    const stock = d.stock(o);
    const opts = { ...dress, items: stock, title: d.title };
    // A counter's GEAR entry (`gear:<line>`, Macros.isSundriesGear) sells a
    // rung of equipment, not a stack: its own buy (_presentStallGear).
    return Macros.isSundriesGear(stock[0])
      ? this._presentStallGear(sx, sy, { ...opts, entry: stock[0] })
      : this[d.present](sx, sy, opts);
  }
}
