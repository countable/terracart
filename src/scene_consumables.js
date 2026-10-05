// The scene's CONSUMABLES — everything the player uses up from the bag:
//   · potions, tomes, scrolls and powders (drinkXxx / readXxx / useXxx) and
//     the timed states they leave (blight aura, shadow, torch, dragon skin);
//   · thrown items, the rope, the orb, the sapphire portal and eatSelected;
//   · the safety cards and concealment predicates (isUnnoticed / isTooFast)
//     the shadow powder and speed gate share;
//   · the telescope, crop watering/growth and the burn/feed confirms.
//
// Moved verbatim out of app.js. The methods live on `class SceneConsumables`, a MIXIN:
// app.js installs them onto MapScene.prototype right after the class closes
// (installSceneMixin, from modal_shell.js), so callers still say `this.x()`.
// This file loads BEFORE app.js: the methods read app.js names and this.* at
// CALL time only.

class SceneConsumables {
  // Eat one of the selected food stack (consumes 1, restores FOOD_ENERGY[id]).
  // Returns true if eaten, false if not edible / nothing selected.
  // Side-effects read their duration and radius from CONSUMABLE_SPEC.
  // === Consumables ============================================
  // Set out the Potion of Taming (consumed): every wandering producer inside its radius has
  // its home position re-anchored to ~3m from the player so it wanders toward you
  // over the next few seconds. Doesn't teleport — that would feel cheesy.
  // Shared tail for modal-feedback consumables (honey, book): consume the
  // selected item, persist, rebuild the inventory bar, and pop a message
  // modal. Returns true so callers can `return this._finishConsumable(...)`.
  // NOTE: eatSelected deliberately does NOT use this — it consumes mid-method
  // (before computing side-effects) and gives flash feedback + energy DOM.
  _finishConsumable(title, body, opts = {}) {
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    this.showMessageModal({ title, body });
    return true;
  }

  useHoney() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'taming_potion' || (sel.count ?? 0) <= 0) return false;
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
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
        const pWX = this.startWorldM.x + this.playerM.x;
        const pWY = this.startWorldM.y + this.playerM.y;
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
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'book' || (sel.count ?? 0) <= 0) return false;
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

  // Fires any book read(s) addToInv deferred (via { deferBookRead: true })
  // because the caller was about to show its own "you found a Book" modal
  // right after — call this from THAT modal's onDismiss so the read shows
  // once it's closed instead of stacking on top of it. No-op (calls
  // `onDone` straight away) when nothing is queued — every non-book pickup
  // never touches _pendingBookReads. Reads run ONE AT A TIME, each waiting
  // for the last to be dismissed, so a rare multi-book grant can't stack
  // its own modals either; `onDone` (e.g. draining the next trail prize)
  // only fires after the last one closes.
  _revealPendingBookReads(onDone) {
    let remaining = this._pendingBookReads || 0;
    this._pendingBookReads = 0;
    const showNext = () => {
      if (remaining <= 0) { if (typeof onDone === 'function') onDone(); return; }
      remaining--;
      this._presentBookRead(showNext);
    };
    showNext();
  }

  // Drink a Potion of Reach (consumed): light up the whole visible view for
  // 1 minute. coords.js' reachRadiusM checks save.reachPotionUntil and, while
  // it's in the future, returns a full-screen radius regardless of energy — so
  // the lit silhouette AND every tap-accept gate cover everything on screen.
  // Stored in `save` (not just in-memory) so the buff survives tile reloads
  // within the minute; the timestamp self-expires, so a stale save is harmless.
  // `opts` rides through to _finishConsumable like the other drinks.
  drinkReachPotion(opts = {}) {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'reach_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.reachPotionUntil = Date.now() + REACH_POTION_MS;
    return this._finishConsumable(
      `✨ You drink the Potion of Reach`,
      'A shiver runs through your fingers. Even the far edge of the world feels close enough to touch.',
      opts,
    );
  }

  // ── The Tomes ─────────────────────────────────────────────────────────────
  // Story books' rarer siblings: READ for the effect of the potion one tier
  // below the tome, never consumed. TWO cooldowns: the SHARED activation
  // lock (TOME_COOLDOWN_MS, save.tomeReadyAt - food's eat-cooldown shape,
  // but one hour and spanning every tome: reading any one locks the button
  // for all), and each tome's OWN magic cooldown (CONSUMABLE_SPEC
  // cooldownMs, save.tomeMagicCd[id]) scaled to the spell's power. HOME IS
  // THE LIBRARY: inside Home's ring (isRestingAtHome - the one predicate
  // behind every Home-ring effect) both are considered refreshed. A refused
  // reading shows its wait (shortDuration - a timed gate needs a visible
  // wait).
  _tomeReady(id) {
    const px = this.startWorldM.x + this.playerM.x, py = this.startWorldM.y + this.playerM.y;
    if (this.isRestingAtHome(px, py)) return true;
    const now = Date.now();
    const shared = (this.save.tomeReadyAt ?? 0) - now;
    if (shared > 0) {
      const ps = this.playerScreen();
      this.flash(`The tomes rest — ${shortDuration(shared)}`, ps.x, ps.y + this.playerBodyDy());
      return false;
    }
    const own = (this.save.tomeMagicCd?.[id] ?? 0) - now;
    if (own > 0) {
      const ps = this.playerScreen();
      this.flash(`This tome rests — ${shortDuration(own)}`, ps.x, ps.y + this.playerBodyDy());
      return false;
    }
    return true;
  }
  // The button gate (CONSUMABLE_SPEC usable): no flash, just grey.
  tomeUsable(id) {
    const px = this.startWorldM.x + this.playerM.x, py = this.startWorldM.y + this.playerM.y;
    if (this.isRestingAtHome(px, py)) return true;
    const now = Date.now();
    return (this.save.tomeReadyAt ?? 0) <= now && (this.save.tomeMagicCd?.[id] ?? 0) <= now;
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
  readTomeSight() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'tome_reach' || (sel.count ?? 0) <= 0) return false;
    if (!this._tomeReady('tome_reach')) return false;
    this.save.reachPotionUntil = Date.now() + REACH_POTION_MS * TOME_EFFECT_MUL;
    this._tomeSpent('tome_reach');
    this.flash('✨ The sight tome opens', this.viewCenterX, this.viewCenterY);
    return true;
  }
  readTomeRaven() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'tome_raven' || (sel.count ?? 0) <= 0) return false;
    if (!this._tomeReady('tome_raven')) return false;
    this.save.spiritRavenUntil = Date.now() + SPIRIT_RAVEN_MS * TOME_EFFECT_MUL;
    this._tickSpiritRaven();   // a living bird's follow timer re-derives from the save
    this._tomeSpent('tome_raven');
    this.flash('✨ A raven leaves the page', this.viewCenterX, this.viewCenterY);
    return true;
  }
  readTomeStorm() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'tome_thunder' || (sel.count ?? 0) <= 0) return false;
    if (!this._tomeReady('tome_thunder')) return false;
    const caughtSet = setOf(this.save.caught);
    const pc = this.playerToWorldCell();
    const targets = [];
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, (c) => {
      if (!Combat.isEnemy(c) || caughtSet.has(c.id)) return;
      const p = this.worldMetersToScreen(c.x, c.y);
      if (p && Particles.onScreen(this, p.x, p.y)) targets.push(c);
    });
    if (targets.length === 0) {
      this.flash('No foe in sight — tome kept', this.viewCenterX, this.viewCenterY);
      return false;
    }
    this.cameras?.main?.flash(THUNDER_FLASH_MS, 255, 255, 255);
    const now = performance.now();
    let felled = 0;
    for (const c of targets) {
      if (this._damageEnemy(c, TOME_THUNDER_DMG)) { felled++; continue; }
      if (!c.lair) monsterRout(c, now, this.cellM);
    }
    this._tomeSpent('tome_thunder');
    this.flash('⚡ The storm tome speaks', this.viewCenterX, this.viewCenterY);
    return true;
  }
  readTomeSpeed() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'tome_speed' || (sel.count ?? 0) <= 0) return false;
    if (!this._tomeReady('tome_speed')) return false;
    this.save.speedPotionUntil = Date.now() + SPEED_POTION_MS * TOME_EFFECT_MUL;
    this._tomeSpent('tome_speed');
    this.flash('✨ The speed tome opens', this.viewCenterX, this.viewCenterY);
    return true;
  }
  readTomeShield() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'tome_shielding' || (sel.count ?? 0) <= 0) return false;
    if (!this._tomeReady('tome_shielding')) return false;
    this.save.shieldPotionUntil = Date.now() + SHIELD_POTION_MS * TOME_EFFECT_MUL;
    this._tomeSpent('tome_shielding');
    this.flash('✨ The shield tome opens', this.viewCenterX, this.viewCenterY);
    return true;
  }
  readTomeHealing() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'tome_healing' || (sel.count ?? 0) <= 0) return false;
    if (!this._tomeReady('tome_healing')) return false;
    const max = this.getMaxEnergy();
    const restored = Math.min(TOME_HEALING_ENERGY, max - (this.save.energy ?? 0));
    Energy.set(this.save, (this.save.energy ?? 0) + TOME_HEALING_ENERGY, max);
    if (restored > 0) this._popEnergy(restored);
    if (this.updateEnergyDOM) this.updateEnergyDOM();
    this._tomeSpent('tome_healing');
    this.flash('✨ The healing tome opens', this.viewCenterX, this.viewCenterY);
    return true;
  }
  readTomeBlight() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'tome_blight' || (sel.count ?? 0) <= 0) return false;
    if (!this._tomeReady('tome_blight')) return false;
    this.save.blightPotionUntil = Date.now() + BLIGHT_MS * TOME_EFFECT_MUL;
    this._tomeSpent('tome_blight');
    this.flash('✨ The blight tome opens', this.viewCenterX, this.viewCenterY);
    return true;
  }


  drinkHealingPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'healing_potion' || (sel.count ?? 0) <= 0) return false;
    const max = this.getMaxEnergy();
    const restored = Math.min(HEALING_POTION_ENERGY, max - (this.save.energy ?? 0));
    Energy.set(this.save, (this.save.energy ?? 0) + HEALING_POTION_ENERGY, max);
    if (restored > 0) this._popEnergy(restored);
    if (this.updateEnergyDOM) this.updateEnergyDOM();
    return this._finishConsumable(
      '\u2728 You drink the Potion of Healing',
      restored > 0
        ? 'Warmth spreads through your arms. Your grip feels sure again.'
        : 'You were already brimming. The flask goes down anyway.',
    );
  }

  drinkAntidote() {
    const sel = getSelectedSlot(this.save);
    if (sel?.id !== 'antidote' || !(sel.count > 0)) return false;
    if (!Conditions.useAntidote(this.save)) {
      this.flash('No debuffs — Antidote kept.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    this._syncStatusRow();
    return this._finishConsumable('You drink the Antidote', 'The bitter draught burns your tongue. Every affliction falls away.');
  }

  drinkElixir() {
    const sel = getSelectedSlot(this.save);
    if (sel?.id !== 'elixir' || !(sel.count > 0)) return false;
    const before = this.save.energy ?? 0;
    if (!Conditions.useElixir(this.save)) {
      if (before <= 0) this.flash('Elixir cannot revive you.', this.viewCenterX, this.viewCenterY);
      else this.flash('No need — Elixir kept.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    this._popEnergy(this.save.energy - before);
    this.updateEnergyDOM();
    this._syncStatusRow();
    return this._finishConsumable('You drink the Elixir', 'The draught glows against your lips. Strength returns as every affliction falls away.');
  }

  // Potion of Speed: a minute of tier-9 boot walking, even without either
  // — the stick moves you faster and costs almost no stamina (_walkRelics
  // reads speedPotionUntil).
  drinkSpeedPotion(opts = {}) {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'speed_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.speedPotionUntil = Date.now() + SPEED_POTION_MS;
    return this._finishConsumable(
      `\u2728 You drink the Potion of Speed`,
      'Warmth races down to your toes. The road slips beneath your feet.',
      opts,
    );
  }

  drinkTimePotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'time_potion' || (sel.count ?? 0) <= 0) return false;
    PlayerTime.reset(this);
    return this._finishConsumable('You drink the Potion of Time', 'All effects fade. Your items are ready again.');
  }

  drinkProtectionPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'protection_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.protectionPotionUntil = Date.now() + CONSUMABLE_SPEC.protection_potion.durationMs;
    return this._finishConsumable(`You drink the Potion of Protection`,
      CONSUMABLE_SPEC.protection_potion.get);
  }

  // Potion of Hardworking: pulls the Harvest Idol's `work` lever
  // (Shrines.extend — the one writer, so it extends the idol's countdown
  // rather than keeping a clock of its own; the `work` row of Buffs.KINDS
  // shows it as "Hardworking" either way).
  drinkHardworkingPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'hardworking_potion' || (sel.count ?? 0) <= 0) return false;
    Shrines.extend(this.save, 'work', CONSUMABLE_SPEC.hardworking_potion.durationMs, Date.now(), this);
    return this._finishConsumable(`You drink the Potion of Hardworking`,
      CONSUMABLE_SPEC.hardworking_potion.get);
  }

  // Poison Flask, drunk: the player's own `poison` row (_applyCondition —
  // the lesson, the row and the announcement), the flask spent either way;
  // a poison already running is refreshed to its full minute.
  drinkPoisonFlask() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'poison_flask' || (sel.count ?? 0) <= 0) return false;
    this._applyCondition('poison');
    return this._finishConsumable(`You drink the Poison Flask`,
      CONSUMABLE_SPEC.poison_flask.get);
  }

  drinkImmortalPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'immortal_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.immortalPotionUntil = Date.now() + CONSUMABLE_SPEC.immortal_potion.durationMs;
    this._incomingDamageFraction = 0;
    this.save.fireDamageRemainder = 0;
    return this._finishConsumable(`You drink the Potion of Immortal`,
      `Immune to all damage for ${shortDuration(CONSUMABLE_SPEC.immortal_potion.durationMs)}.`);
  }

  drinkFireResistancePotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'fire_resistance_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.fireResistancePotionUntil = Date.now() + CONSUMABLE_SPEC.fire_resistance_potion.durationMs;
    Conditions.cure(this.save, 'burning');
    this.save.fireDamageRemainder = 0;
    this._lavaAccum = 0;
    return this._finishConsumable(
      `You drink the Potion of Fire Resistance`,
      `Immune to fire for ${shortDuration(CONSUMABLE_SPEC.fire_resistance_potion.durationMs)}.`,
    );
  }

  drinkShrinkingPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'shrinking_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.shrinkingPotionUntil = Date.now() + CONSUMABLE_SPEC.shrinking_potion.durationMs;
    Energy.set(this.save, this.save.energy, Energy.maxEnergy(this.save));
    this._syncPlayerSkin();
    this.updateEnergyDOM();
    return this._finishConsumable(`You drink the Potion of Shrinking`,
      `Half size, maximum HP and melee damage; +${CONSUMABLE_SPEC.shrinking_potion.visionCells} stealth for ${shortDuration(CONSUMABLE_SPEC.shrinking_potion.durationMs)}.`);
  }

  drinkGiantPotion() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'giant_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.giantPotionUntil = Date.now() + CONSUMABLE_SPEC.giant_potion.durationMs;
    this._syncPlayerSkin();
    this.updateEnergyDOM();
    return this._finishConsumable(
      `You drink the Potion of Giant`,
      `+${CONSUMABLE_SPEC.giant_potion.maxHpBonus} maximum HP and +${CONSUMABLE_SPEC.giant_potion.damageBonus} melee damage for ${shortDuration(CONSUMABLE_SPEC.giant_potion.durationMs)}.`,
    );
  }

  drinkShieldPotion(opts = {}) {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'shielding_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.shieldPotionUntil = Date.now() + SHIELD_POTION_MS;
    return this._finishConsumable(
      `\u2728 You drink the Potion of Shielding`,
      'A cool shimmer settles over your skin, taking the sting from claw and fang.',
      opts,
    );
  }

  // Scroll of the Raven: SPIRIT_RAVEN_MS of a slime-strength ally
  // (SpriteLayout.CREATURE_BEHAVIOUR.spirit_raven) hunting the nearest foe or
  // pest deer through wanderCreatures' pet lane. Only the EXPIRY reaches the
  // save (save.spiritRavenUntil), so the timer is honest across a reload; the
  // bird is session state that _tickSpiritRaven keeps at your side while it
  // runs. Reading again while one is out refreshes the timer on the SAME
  // bird — never a second raven.
  readRavenScroll() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'raven_scroll' || (sel.count ?? 0) <= 0) return false;
    this.save.spiritRavenUntil = Date.now() + SPIRIT_RAVEN_MS;
    // Summoned now, not a frame later; a living bird's follow timer (its
    // lifetime) is re-derived from the refreshed expiry by Companions.tick.
    this._tickSpiritRaven();
    this._spendScroll('raven_scroll');
    this.showMessageModal({ title: 'You read the Scroll of the Raven',
      body: 'A raven of smoke and starlight shakes itself out of the parchment. It settles beside you, watching the beasts with hungry eyes.' });
    return true;
  }

  readSummoningScroll() {
    const sel = getSelectedSlot(this.save);
    const id = sel?.id, spec = CONSUMABLE_SPEC[id], kind = spec?.summonKind;
    const row = Companions.KINDS[kind];
    if (!row || (sel.count ?? 0) <= 0) return false;
    // Reconcile expiry or defeat before refreshing, including a stale live instance.
    Companions.tick(this, kind);
    const refreshing = Companions.active(this.save, kind);
    if (!refreshing) delete this.save.companionState?.[kind];
    this.save[row.field] = Date.now() + row.durationMs;
    Companions.tick(this, kind);
    this._spendScroll(id);
    this.showMessageModal({ title: `You read the ${ITEM_BY_ID[id].name}`, body: spec.get });
    return true;
  }

  // Raven scroll and tome callers share the companion keeper (player_time.js
  // calls it too, so it stays a named method).
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
    const before = this.save.energy ?? 0;
    Energy.set(this.save, Math.max(before, Energy.reviveLevel(this.getMaxEnergy(), frac)));
    this._popEnergy(this.save.energy - before);
    if (this.updateEnergyDOM) this.updateEnergyDOM();
    const name = ITEM_BY_ID[sel.id]?.name || 'Potion of Revival';
    return this._finishConsumable(
      `\u2728 You drink the ${name}`,
      'Your eyes snap open. The ground presses cold against your palms as you rise.',
    );
  }

  drinkBlightPotion(opts = {}) {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'blight_potion' || (sel.count ?? 0) <= 0) return false;
    this.save.blightPotionUntil = Date.now() + BLIGHT_MS;
    return this._finishConsumable(
      `\u2728 You drink the Potion of Blight`,
      'A crimson haze seeps from your skin. Nearby beasts shudder in its wake.',
      opts,
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
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
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

  // True while a Dragon Powder is active. The buff is a 1-minute in-memory
  // timer (this._dragonUntil) — deliberately NOT persisted to the save, so a
  // refresh ends it. _walkRelics (the tier-8 legs) and interact.js's 2×-damage
  // check both route through here.
  isDragonActive() {
    return (this._dragonUntil ?? 0) > Date.now();
  }

  // Dragon Powder: for ONE MINUTE you wear a red dragon and get its stats —
  // tier-8 boots (DRAGON_WALK_COST_TIER, so the stick walks faster
  // and for less stamina than Frost boots can) and 2× attack damage
  // (interact.js halves the kill-wheel duration while in dragon form). No
  // flight, no separate movement mode: a dragon walks the way everyone walks.
  useDragonPowder() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'dragon_powder' || (sel.count ?? 0) <= 0) return false;
    this._dragonUntil = Date.now() + DRAGON_POWDER_MS;
    return this._finishConsumable(
      '🐉 You toss the Dragon Powder',
      'Scales ripple across your skin. Heat swells in your chest, and the ground shakes beneath your claws.',
    );
  }

  // Growth Powder: every crop within 20 m springs ahead ONE stage on the spot,
  // watered or not (Crops.advanceWithin — the crop model stays in crops.js).
  // Refused, and the powder kept, when no unripe crop is in range: a scatter
  // that moved nothing is not a use.
  useGrowthPowder() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'growth_powder' || (sel.count ?? 0) <= 0) return false;
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
    this._blastAt(this.startWorldM.x + this.playerM.x, this.startWorldM.y + this.playerM.y, {
      radiusCells: GROWTH_POWDER_R_M / this.cellM,
      ringPx: GROWTH_POWDER_R_M * CELL_PX / this.cellM,
      sparks: 'greenspark',
    });
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    this.flashLoot(`🌱 ${n} crop${n === 1 ? '' : 's'} sprang ahead`, '#a7ffb0', 1.8, 'growth_powder');
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
    tap.style.cssText = 'margin-top:14px;font-size:15px;font-weight:800;color:#ffe066;'
      + 'border:2px solid #ffe066;border-radius:8px;padding:10px 18px;';
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
    const key = utcDayKey(now);
    if (was != null && was >= SAFETY_DUSK_DAYLIGHT && day < SAFETY_DUSK_DAYLIGHT && this._safetyDuskKey !== key) {
      this._safetyDuskKey = key;
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

  useShadowPowder() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'shadow_powder' || (sel.count ?? 0) <= 0) return false;
    this._shadowUntil = Date.now() + SHADOW_POWDER_MS;
    // The truce ends the fight you are in: the melee wheel drops (the same
    // cancel the stairs use); arrows already in the air finish their flight.
    if (this._workProgress?.combat) this.cancelWorkProgress();
    return this._finishConsumable(
      '🌑 You cast the Shadow Powder',
      'The dark folds around you. Hungry eyes pass you by.',
    );
  }

  // True while a Torch burns: the same in-memory timer the dragon keeps
  // (this._torchUntil, NOT persisted — a refresh puts it out). Lighting.draw
  // reads it through Lighting.playerKind to stamp the `torch` row at the feet.
  isTorchActive() {
    return (this._torchUntil ?? 0) > Date.now();
  }

  // Torch: for TORCH_MS the player's own light reaches TORCH_RADIUS_MUL times
  // as far — the `torch` row of Lighting.KINDS, added on top of the reach ramp
  // (light adds; the plateau, and so the tap gate, are untouched). Lighting
  // one while another burns EXTENDS from the current end rather than wasting
  // what is left. Never gated on depth: a torch by night on the surface is
  // fine, and free.
  useTorch() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'torch' || (sel.count ?? 0) <= 0) return false;
    const now = Date.now();
    const burning = this.isTorchActive();
    this._torchUntil = Math.max(now, this._torchUntil ?? 0) + TORCH_MS;
    return this._finishConsumable(
      burning ? '🔥 You light another Torch' : '🔥 You light the Torch',
      'The flame takes with a soft roar. Shadows retreat beyond the reach of your footsteps.',
    );
  }

  // Scroll of Thunder: a white flash across the screen, and every ENEMY
  // (Combat.isEnemy — never a crow, a deer or a pet) VISIBLE on it — drawn
  // inside the viewport, so this one is a draw-space test (Particles.onScreen
  // on worldMetersToScreen), not a reach test — takes THUNDER_DMG through
  // _damageEnemy (the one damage lane: popups, bar, bounty). Whatever the bolt
  // leaves standing turns tail (monsterRout — the ordinary wander-off, away
  // from the player to the usual random range). A lair guard is on its own
  // leash (Lairs.guardState), so it takes the damage but holds its ruin.
  // Refused, and the scroll kept, when nothing hostile is in sight.
  readThunderScroll() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'thunder_scroll' || (sel.count ?? 0) <= 0) return false;
    const caughtSet = setOf(this.save.caught);
    const pc = this.playerToWorldCell();
    const targets = [];
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, (c) => {
      if (!Combat.isEnemy(c) || caughtSet.has(c.id)) return;
      const p = this.worldMetersToScreen(c.x, c.y);
      if (p && Particles.onScreen(this, p.x, p.y)) targets.push(c);
    });
    if (targets.length === 0) {
      this.flash('No foe in sight — scroll kept.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    this.cameras?.main?.flash(THUNDER_FLASH_MS, 255, 255, 255);
    const now = performance.now();
    let felled = 0;
    for (const c of targets) {
      if (this._damageEnemy(c, THUNDER_DMG)) { felled++; continue; }
      if (!c.lair) monsterRout(c, now, this.cellM);
    }
    const n = targets.length;
    this._spendScroll('thunder_scroll');
    this.showMessageModal({
      title: 'You read the Scroll of Thunder',
      body: felled < n ? 'The sky splits. When your ears stop ringing, the surviving beasts are already fleeing.' : 'The sky splits. When your ears stop ringing, the beasts lie still.',
    });
    return true;
  }

  // Only successful uses teach a recipe; owning or crafting a scroll does not.
  _spendScroll(id) {
    this.save.usedScrolls ||= [];
    if (!this.save.usedScrolls.includes(id)) this.save.usedScrolls.push(id);
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    return true;
  }

  _onscreenEnemies() {
    const caught = setOf(this.save.caught);
    const targets = [];
    const pc = this.playerToWorldCell();
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, c => {
      if (!Combat.isEnemy(c) || caught.has(c.id)) return;
      const p = this.worldMetersToScreen(c.x, c.y);
      if (p && Particles.onScreen(this, p.x, p.y)) targets.push(c);
    });
    return targets;
  }

  useFireballScroll() {
    const sel = getSelectedSlot(this.save);
    if (sel?.id !== 'fireball_scroll' || !(sel.count > 0)
        || Combat.playerDowned(this.save.energy)) return false;
    const x = this.startWorldM.x + this.playerM.x;
    const y = this.startWorldM.y + this.playerM.y;
    const heading = Combat.shotHeading('bow', x, y, this.facing);
    const shot = Combat.spawnFireball(x, y, heading, this.cellM, CONSUMABLE_SPEC.fireball_scroll);
    if (!shot) return false;
    this._shots.push(shot);
    return this._spendScroll(sel.id);
  }

  useFearScroll() {
    const sel = getSelectedSlot(this.save);
    if (sel?.id !== 'fear_scroll' || !(sel.count > 0)
        || Combat.playerDowned(this.save.energy)) return false;
    const targets = this._onscreenEnemies();
    if (!targets.length) {
      this.flash('No foe in sight — scroll kept.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    const now = performance.now();
    for (const c of targets) {
      monsterRout(c, now, this.cellM);
      c._fearUntilT = now + CONSUMABLE_SPEC.fear_scroll.durationMs;
      c._startX = c._targetX = c.x;
      c._startY = c._targetY = c.y;
      c._attackWindupUntil = c._lungeWindupUntil = c._abilityWindupUntil = 0;
      Combat.flagStatus(c, Combat.STATUS_LOOKS.fear, now);
    }
    this._spendScroll(sel.id);
    this.flashLoot('The beasts turn and flee.', '#c77dff', 1.8, sel.id);
    return true;
  }

  useSleepPowder() {
    const sel = getSelectedSlot(this.save);
    if (sel?.id !== 'sleep_powder' || !(sel.count > 0)
        || Combat.playerDowned(this.save.energy)) return false;
    const targets = this._onscreenEnemies();
    if (!targets.length) {
      this.flash('No foe in sight — powder kept.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    const now = Date.now();
    for (const c of targets) Combat.applySleep(c, now);
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    this.flashLoot(`Sleep falls for ${shortDuration(CONSUMABLE_SPEC.sleep_powder.durationMs)}.`, '#bca5e8', 1.8, sel.id);
    return true;
  }

  // Powder of Psychosis (T1): every foe on screen loses its head for
  // PSYCHOSIS_POWDER_MS (Combat.applyPsychosis — the `psychotic` reason in
  // wanderCreatures' rout lane: the flee pace on a random heading each hop,
  // no blow, no target). Weak on purpose: ten seconds to get clear, or to
  // get the first blow in. Refused — and kept — when no foe is in sight.
  usePsychosisPowder() {
    const sel = getSelectedSlot(this.save);
    if (sel?.id !== 'psychosis_powder' || !(sel.count > 0)
        || Combat.playerDowned(this.save.energy)) return false;
    const targets = this._onscreenEnemies();
    if (!targets.length) {
      this.flash('No foe in sight — powder kept.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    const now = performance.now();
    for (const c of targets) Combat.applyPsychosis(c, PSYCHOSIS_POWDER_MS, now);
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    this.flashLoot(`Madness takes them for ${shortDuration(PSYCHOSIS_POWDER_MS)}.`, Combat.STATUS_LOOKS.psychosis.color, 1.8, sel.id);
    return true;
  }

  useTreasureMap() {
    const sel = getSelectedSlot(this.save);
    if (sel?.id !== 'treasure_map' || !(sel.count > 0)) return false;
    const target = this.findNearestTreasureMark();
    if (!target) {
      this.flash('No treasure found — map kept.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    this.save.treasureCompass = { x: target.x, y: target.y, targetId: target.id,
      kind: 'treasure', depth: this.depth || 0, until: Date.now() + CONSUMABLE_SPEC.treasure_map.durationMs };
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
    const x = this.startWorldM.x + this.playerM.x;
    const y = this.startWorldM.y + this.playerM.y;
    const heading = Combat.shotHeading('bow', x, y, this.facing);
    const shot = Combat.spawnShot('bow', x, y, heading, this.cellM,
      cfg.damage, 1, reachCells(this));
    if (!shot) return false;
    shot.projectile = cfg.projectile;
    if (potion) shot.potionId = id;
    if (cfg.effect) shot.effect = cfg.effect;
    this._shots.push(shot);
    this._throwReadyAt = performance.now() + cfg.throwCooldownMs;
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    return true;
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

  // Frost Powder: every ENEMY (Combat.isEnemy — never a crow, a deer or a pet)
  // standing IN REACH — the lit plateau the tap gate accepts, cellInReach —
  // is frozen for FROST_POWDER_MS: wanderCreatures skips it (no step, no hit)
  // and render.js tints it ice until c._frozenUntil passes. Its in-flight hop
  // is pinned where it stands so the thaw doesn't snap it a half-step on.
  // Refused, and the powder kept, when nothing hostile is in reach.
  useFrostPowder() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'frost_powder' || (sel.count ?? 0) <= 0) return false;
    const caughtSet = setOf(this.save.caught);
    const pc = this.playerToWorldCell();
    const targets = [];
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, (c) => {
      if (!Combat.isEnemy(c)) return;
      if (caughtSet.has(c.id)) return;
      const fc = worldMetersToAbsCell(this, c.x, c.y);
      if (!cellInReach(this, fc.cellIX, fc.cellIY)) return;
      targets.push(c);
    });
    if (targets.length === 0) {
      this.flash('No foe in reach — powder kept.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    const until = Date.now() + FROST_POWDER_MS;
    for (const c of targets) {
      c._frozenUntil = until;
      c._startX = c._targetX = c.x;
      c._startY = c._targetY = c.y;
      Combat.flagStatus(c, Combat.STATUS_LOOKS.frozen);
    }
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    const n = targets.length;
    this.flashLoot(`❄ ${n} enem${n === 1 ? 'y' : 'ies'} frozen for ${shortDuration(FROST_POWDER_MS)}`, '#9ad8ff', 1.8, 'frost_powder');
    return true;
  }

  // Ride / Dismount (items.js CONSUMABLE_SPEC.horse — an `immediate` row, so
  // nothing is spent). The skin follows from isRiding every frame
  // (SpriteLayout.playerArt), and so does the stick's speed and cost.
  toggleHorseRide() {
    const sel = getSelectedSlot(this.save);
    if (!sel || (ITEM_BY_ID[sel.id]?.base || sel.id) !== 'horse' || (sel.count ?? 0) <= 0) return false;
    this.save.riding = !isRiding(this.save);
    persistSave(this.save);
    if (this.save.riding) this.flash(`Stick ×${HORSE_RIDE.speedMul} speed, ×${HORSE_RIDE.energyMul} ⚡`);
    else this.flash('You dismount.');
    return true;
  }

  // A sapphire opens a descent and a brief return to the exact entry point.
  // The Return status chip stays available after spending the last gem.
  useSapphirePortal() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'sapphire' || (sel.count ?? 0) <= 0) return false;
    if ((this.save.energy ?? 0) <= 0) {
      this.flash('Too tired to open a portal.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    const fromDepth = this.depth || 0;
    const depth = fromDepth + 1;
    const stair = {
      x: this.startWorldM.x + this.playerM.x,
      y: this.startWorldM.y + this.playerM.y + this.feetOffsetM,
    };
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
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'rope' || (sel.count ?? 0) <= 0) return false;
    const target = (this.depth || 0) + delta;
    if (target < 0) {
      this.flash('Nowhere to climb up here.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    if (delta > 0 && (this.save.energy ?? 0) <= 0) {
      this.flash('Too tired to climb down.', this.viewCenterX, this.viewCenterY);
      return false;
    }
    // Synthetic "stair" at the player's own world cell, as the portal does:
    // changeDepth GPS-mirrors the feet onto it, so the move is straight up or
    // down with no sideways step.
    const anchor = {
      x: this.startWorldM.x + this.playerM.x,
      y: this.startWorldM.y + this.playerM.y + this.feetOffsetM,
    };
    if (target > 0) {
      const c = this.cellAt(anchor.x, anchor.y);
      this.dugWallSet.add(`${target}:${cellKeyFromAbsCell(c.cellIX, c.cellIY)}`);
    }
    consumeSelected(this.save);
    this.buildInventoryDOM();
    this.changeDepth(delta, anchor);
    return true;
  }
  useRopeUp()   { return this.useRope(-1); }
  useRopeDown() { return this.useRope(+1); }

  // Snapshot only unspent secrets currently on screen, including a peeked view.
  // The renderer replays their own short cue; the orb and rewards stay intact.
  useOrb() {
    const sel = getSelectedSlot(this.save);
    if (!sel || sel.id !== 'orb' || !(sel.count > 0)) return false;
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
    if (reveal.size) this.flash('Hidden things stir.', this.viewCenterX, this.viewCenterY);
    else this.flash('Nothing stirs nearby.', this.viewCenterX, this.viewCenterY);
    return true;
  }

  eatSelected() {
    const sel = getSelectedSlot(this.save);
    if (!sel || (sel.count ?? 0) <= 0) return false;
    // Ordinary food never revives a downed player, in either mode. Only a
    // Crow Feather can be eaten at zero energy, restoring its flat one point.
    const locked = Combat.playerDowned(this.save.energy);
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
    this.flashLoot(flashMsg, '#a7ffb0', 1.8, sel.id);
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
    if (id === 'pairy') {
      const target = this.findNearestUnopenedChest();
      if (target) {
        this.pairyCompass = { targetId: target.id, x: target.x, y: target.y,
          until: now + CONSUMABLE_SPEC.pairy.durationMs };
        extra = `\n🧭 chest compass: ${shortDuration(CONSUMABLE_SPEC.pairy.durationMs)}`;
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
      this.save.coffeeUntil = now + COFFEE_BUFF_MS;
      extra = `\n☕ faster stick walking, ${shortDuration(COFFEE_BUFF_MS)}`;
    } else if (id === 'dawnfruit') {
      this.save.dawnfruitUntil = Math.max(this.save.dawnfruitUntil || 0, now + CONSUMABLE_SPEC.dawnfruit.durationMs);
      extra = `\nFull light and vision: ${shortDuration(this.save.dawnfruitUntil - now)}`;
    } else if (id === 'miracle_lettuce') {
      const spec = CONSUMABLE_SPEC.miracle_lettuce;
      this.save.miracleLettuceUntil = Math.max(this.save.miracleLettuceUntil || 0, now + spec.durationMs);
      extra = `\n+${spec.luckBonus} Luck: ${shortDuration(this.save.miracleLettuceUntil - now)}`;
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
      player: { x: this.startWorldM.x + this.playerM.x, y: this.startWorldM.y + this.playerM.y },
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
      return target;
    }
    return marker;
  }

  // Treasure bearings include unrevealed and rock-covered marks, but never a
  // claimed mark or another level. tileCache belongs to the current level.
  findNearestTreasureMark(onscreen = false) {
    const found = setOf(this.save.foundTreasures);
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    let best = null, distance = Infinity;
    let entries = WorldGen.tileCache.values();
    if (onscreen) {
      const pc = this.playerToWorldCell();
      entries = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx + dx, pc.ty + dy));
        if (entry) entries.push(entry);
      }
    }
    for (const entry of entries) {
      for (const tr of [entry.treasure, ...(entry.parkingTreasures || []), ...(entry.extraTreasures || [])]) {
        if (!tr || found.has(tr.id) || (tr.depth != null && tr.depth !== (this.depth || 0))) continue;
        if (onscreen) {
          const p = this.worldMetersToScreen(tr.x, tr.y);
          if (Math.abs(p.x - this.viewCenterX) > this.viewSize / 2
              || Math.abs(p.y - this.viewCenterY) > this.viewSize / 2) continue;
        }
        const d = (tr.x - px) ** 2 + (tr.y - py) ** 2;
        if (d < distance) { best = tr; distance = d; }
      }
    }
    return best;
  }

  // A short needle stays attached to the player's feet, even while peeking.
  // Stop at a nearby mark instead of drawing past it.
  _drawTreasureNeedle(target) {
    if (!target) return;
    const player = this.playerScreen();
    const point = this.worldMetersToScreen(target.x, target.y);
    const dx = point.x - player.x, dy = point.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return;
    const length = Math.min(CELL_PX * 0.7, distance);
    this.facingGfx.lineStyle(2, 0xff5555, 0.95);
    this.facingGfx.lineBetween(player.x, player.y,
      player.x + dx / distance * length, player.y + dy / distance * length);
  }

  // Find the nearest chest the player hasn't opened. Used by the pairy compass.
  findNearestUnopenedChest(tiers = null) {
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
    const sets = spentSets(this, this.save);
    let best = null, bestD2 = Infinity;
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind !== 'chest') continue;
        if (tiers && !tiers.includes(chestTier(o))) continue;
        if (isSpent(o, sets)) continue;
        // A macro stall (an inn, a chapel, … — loot.js macroFor) is a place,
        // not a chest to find; nor is a barrel, a bike rack or a pot of gold.
        if (macroFor(o) || isBarrel(o) || isBikeRack(o) || isPotOfGold(o)) continue;
        const dx = o.x - pWX, dy = o.y - pWY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { best = o; bestD2 = d2; }
      }
    }
    return best;
  }

  // Water every planted crop within ${radius} meters of the player. Returns count.
  // Sets watered_t = now on cells that aren't already watered or at MAX_GROWTH_STAGE.
  // `canTier` is the can the soak counts as (the rainberry's Gold,
  // CONSUMABLE_SPEC.rainberry.canTier): the player's own can is used when it
  // is the better of the two, so owning a Frost can is never undercut.
  waterCropsWithin(radius, canTier = 0) {
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
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
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
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
    const pWX = this.startWorldM.x + this.playerM.x;
    const pWY = this.startWorldM.y + this.playerM.y;
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
    const d = Macros.KIND_DIALOG[kind];
    const dress = { boothKind: kind, kind: d.modal, kindLabel: Macros.stallLabel(kind, o) || d.label, art: Macros.stallArt(kind, o) };
    switch (kind) {
      case 'inn':         return this._presentInn(sx, sy, o, dress);
      case 'apothecary':  return this._presentStallOffer(sx, sy,
        { ...dress, items: Macros.apothecaryStock(o), title: 'The apothecary has on the shelf:' });
      case 'sundries': {
        const stock = Macros.sundriesStock(o);
        const opts = { ...dress, title: 'The counter has in stock:' };
        return Macros.isSundriesGear(stock[0])
          ? this._presentStallGear(sx, sy, { ...opts, entry: stock[0] })
          : this._presentStallOffer(sx, sy, { ...opts, items: stock });
      }
      case 'scriptorium': return this._presentStallOffer(sx, sy,
        { ...dress, items: Macros.scriptoriumStock(), title: 'The scriptorium sells:' });
      case 'guildhall':   return this._presentGuildhall(sx, sy, o, dress);
      case 'curio':       return this._presentCurio(sx, sy, o, dress);
      case 'training':    return this._presentTraining(sx, sy, o, dress);
      case 'scholar':     return this._presentScholar(sx, sy, o, dress);
      default:            return undefined;
    }
  }
}
