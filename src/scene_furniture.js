// Luxury is derived from durable placements, never the rendered object stream.
const Furniture = (() => {
  const ENERGY_PER_LUXURY_S = 0.1;
  const HOUSE_SLOTS = 4;
  function itemLuxury(itemId) {
    const spec = furnitureSpec(itemId);
    return spec ? Math.max(0, spec.luxury ?? itemTierOf(itemId) ** 2) : 0;
  }
  function houseFurniture(save, houseKey) {
    return (save?.houseFurniture?.[houseKey] || []).filter(r => furnitureSpec(r.itemId))
      .slice().sort((a, b) => itemLuxury(b.itemId) - itemLuxury(a.itemId));
  }
  function isNpcHouse(scene, house) {
    return (scene.depth || 0) === 0 && house?.kind === 'house'
      && house.id !== scene.save.starterShopId
      && Object.values(scene.save.npcHomes || {}).some(r => r.houseId === house.id);
  }
  // Validate both sides before moving either item. A full house returns its
  // least luxurious furnishing; an equal or weaker replacement stays in hand.
  function furnishHouse(scene, house, itemId) {
    const save = scene.save;
    if (!isNpcHouse(scene, house) || !furnitureSpec(itemId)
        || Inventory.ownedCount(save, itemId) < 1) return { accepted: false, reason: 'Choose furniture first.' };
    const current = houseFurniture(save, house.id);
    const replaced = current.length >= HOUSE_SLOTS ? current[current.length - 1] : null;
    if (replaced && itemLuxury(itemId) <= itemLuxury(replaced.itemId)) {
      return { accepted: false, reason: 'Choose a more luxurious item.' };
    }
    if (replaced && Inventory.roomFor(save, replaced.itemId) < 1) {
      return { accepted: false, reason: bagFullFor(replaced.itemId) };
    }
    if (Inventory.remove(save, itemId, 1) !== 1) return { accepted: false, reason: 'Choose furniture first.' };
    if (replaced) {
      Inventory.add(save, replaced.itemId, 1);
      current.splice(current.indexOf(replaced), 1);
    }
    let slot = 0;
    while (current.some(r => r.id === `${house.id}:furniture:${slot}`)) slot++;
    current.push({ id: `${house.id}:furniture:${slot}`, itemId,
      flip: !!(furnitureSpec(itemId).flip && scene._furnitureFlip) });
    (save.houseFurniture ||= {})[house.id] = current;
    recompute(scene);
    return { accepted: true, replaced };
  }
  function luxuryOf(save, houseKey = save?.starterShopId) {
    const score = save?.houseLuxury?.[houseKey]?.score;
    return Number.isFinite(score) ? Math.max(0, score) : 0;
  }
  function restBonus(luxury, elapsedS, rng = Math.random) {
    const mean = Math.max(0, luxury) * ENERGY_PER_LUXURY_S * Math.max(0, elapsedS);
    if (!Number.isFinite(mean)) return 0;
    const whole = Math.floor(mean), fraction = mean - whole;
    return whole + (fraction > 0 && rng() < fraction ? 1 : 0);
  }
  // Synthetic Homes reuse an id when moved. Adopted buildings retain their
  // world identity; their ownership grid remains authoritative when loaded.
  function footprintKey(save) {
    const st = save.starterTrailer;
    return JSON.stringify([save.starterShopId || null,
      st && st.id === save.starterShopId ? [st.x, st.y, !!st.adopted] : null,
      HomeArea.HOUSE.minCell, HomeArea.HOUSE.maxCell]);
  }
  function recompute(scene, entry = null, tx = null, ty = null) {
    const save = scene.save, houseKey = save.starterShopId, key = footprintKey(save);
    const cache = (scene.depth || 0) === 0 ? WorldGen.tileCache : WorldGen.tileCacheFor(0);
    const surface = (scene.depth || 0) === 0 ? scene : Object.assign(Object.create(scene), { depth: 0 });
    let score = 0;
    const counted = new Set();
    for (const record of save.furniture || []) {
      if (!PlacedFloor.onDepth(record, 0) || !furnitureSpec(record.itemId)) continue;
      const cell = worldMetersToAbsCell(scene, record.x, record.y);
      const tile = absCellToTile(scene, cell.cellIX, cell.cellIY);
      const grid = entry && tile.tx === tx && tile.ty === ty ? entry
        : cache.get(WorldGen.tileKey(tile.tx, tile.ty));
      if (grid?.grid && grid.owners && grid.ownerKeys) {
        PlacedFloor.furnitureIndoors(surface, record, grid);
        record.houseFootprintKey = key;
      } else if (record.houseFootprintKey !== key) {
        // An unloaded tile is unknown, not outdoors. An association validated
        // for this exact Home survives eviction; a moved Home cannot reuse it.
        continue;
      }
      if (!houseKey || record.houseKey !== houseKey || counted.has(record.id)) continue;
      // One saved furnishing contributes once, even when future footprints
      // cover several cells. The catalog owns explicit luxury overrides.
      counted.add(record.id);
      const spec = furnitureSpec(record.itemId);
      score += spec.luxury ?? itemTierOf(record.itemId) ** 2;
    }
    // The sole cache writer. Inactive Homes contribute nothing; furniture stays
    // at its saved world position when Home moves or another house is adopted.
    const next = {};
    for (const id of Object.keys(save.houseLuxury || {})) {
      next[id] = { score: 0, footprintKey: save.houseLuxury[id]?.footprintKey };
    }
    if (houseKey) next[houseKey] = { score, footprintKey: key };
    for (const id of Object.keys(save.houseFurniture || {})) {
      if (id === houseKey) continue;
      next[id] = { score: houseFurniture(save, id).slice(0, HOUSE_SLOTS)
        .reduce((sum, record) => sum + itemLuxury(record.itemId), 0) };
    }
    const changed = JSON.stringify(save.houseLuxury) !== JSON.stringify(next);
    save.houseLuxury = next;
    Quests.onEvent(save, 'luxury');
    MemoryStory.reconcileLuxury(scene);
    if (changed) persistSave(save);
    return score;
  }
  return { luxuryOf, recompute, footprintKey, restBonus, ENERGY_PER_LUXURY_S,
    HOUSE_SLOTS, itemLuxury, houseFurniture, isNpcHouse, furnishHouse };
})();

// Placed furniture shows its world frame and uses one lossless pickup transaction.
const FURNITURE_ABILITY_LABELS = {
  sleep: 'Sleep', wash: 'Wash', reflect: 'Reflect', craft: 'Craft', plant: 'Plant',
};

// Camera-only cut shared by sleep and teleport; no particles or movement state.
// Register before fading so even a synchronous camera stub cannot lose the event.
function cameraBlackout(scene, commit, { outMs = 700, inMs = 1300, onDone } = {}) {
  let committed = false;
  const once = () => {
    if (committed) return;
    committed = true;
    try { commit(); } finally {
      if (cam?.fadeIn) cam.fadeIn(inMs, 0, 0, 0);
      onDone?.();
    }
  };
  const cam = scene.cameras?.main;
  if (!cam?.fadeOut || !cam?.once || !cam?.fadeIn) { once(); return; }
  cam.once('camerafadeoutcomplete', once);
  cam.fadeOut(outMs, 0, 0, 0);
}

class SceneFurniture {
  pickupHouseFurniture(house, record) {
    const records = this.save.houseFurniture?.[house.id];
    if (!Furniture.isNpcHouse(this, house) || !records?.includes(record)) return false;
    if (Inventory.roomFor(this.save, record.itemId) < 1) {
      this.flashAtPlayer(bagFullFor(record.itemId));
      return false;
    }
    if (this.addToInv(record.itemId, 1, false, { notWild: true, deferRefresh: true }) !== 1) return false;
    records.splice(records.indexOf(record), 1);
    Furniture.recompute(this);
    this._finishInventoryChange();
    persistSave(this.save);
    return true;
  }

  presentHouseFurniture(house, { resident, message, onClose = () => {} } = {}) {
    const occupied = Furniture.isNpcHouse(this, house);
    if (!occupied && !(house?.kind === 'house' && house.id !== this.save.starterShopId
        && (this.depth || 0) === 0 && Delivery.isSatisfied(this.save, house))) return false;
    const options = { resident, message, onClose };
    const { wrap, box, mount, mkBtn } = this.makeModalShell('house-furniture-modal', {
      kind: 'use', header: false, art: false, onClose,
    });
    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;margin:0 0 8px;';
    if (resident) {
      const face = document.createElement('img');
      face.className = 'house-resident-portrait';
      face.src = NPC.portrait(this, resident);
      face.alt = resident.name;
      face.width = face.height = 48;
      face.style.cssText = 'width:48px;height:48px;object-fit:contain;image-rendering:pixelated;';
      heading.appendChild(face);
    }
    const identity = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = resident?.name ? `${resident.name}'s home` : occupied ? 'Neighbour home' : 'Vacant house';
    title.style.cssText = 'font-size:18px;margin:0;';
    identity.appendChild(title);
    const score = document.createElement('div');
    score.textContent = `Luxury ${Furniture.luxuryOf(this.save, house.id)}`;
    score.style.cssText = 'font-size:14px;color:#d5b879;margin-top:4px;';
    identity.appendChild(score);
    heading.appendChild(identity);
    box.appendChild(heading);
    const benefit = resident && typeof NPCBenefits !== 'undefined' ? NPCBenefits.summary(this, resident) : '';
    const greeting = message || (!occupied ? 'Delivery received. This house is ready for an available neighbour.' : '');
    if (greeting || benefit) {
      const speech = document.createElement('p');
      speech.textContent = resident?.role === 'wanderer' ? 'Tilly sometimes helps you water your crops.'
        : [...new Set([greeting, benefit].filter(Boolean))].join(' ');
      speech.style.cssText = 'font-size:13px;line-height:1.35;margin:4px 0 8px;';
      box.appendChild(speech);
    }
    const grid = document.createElement('div');
    grid.className = 'house-furniture-slots';
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0 0;';
    const records = Furniture.houseFurniture(this.save, house.id);
    for (let i = 0; i < Furniture.HOUSE_SLOTS; i++) {
      const record = records[i], slot = document.createElement('div');
      slot.className = record ? 'house-furniture-slot occupied' : 'house-furniture-slot empty';
      slot.style.cssText = 'display:flex;flex-direction:column;justify-content:center;gap:4px;padding:6px;min-height:104px;box-sizing:border-box;border:1px solid #af9768;border-radius:10px;background:rgba(175,151,104,.08);';
      if (record) {
        const details = document.createElement('div');
        details.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;';
        const art = document.createElement('div');
        art.innerHTML = this.worldIconHTML('furniture', 24, furnitureFrame(record.itemId), 48);
        art.style.cssText = 'font-size:0;flex:0 0 24px;';
        art.style.transform = record.flip ? 'scaleX(-1)' : '';
        details.appendChild(art);
        const caption = document.createElement('div');
        caption.style.cssText = 'min-width:0;flex:1;text-align:left;';
        const name = document.createElement('div');
        name.textContent = itemName(record.itemId);
        name.style.cssText = 'font-size:11px;font-weight:700;line-height:1.2;overflow-wrap:anywhere;';
        caption.appendChild(name);
        const luxury = document.createElement('div');
        luxury.textContent = `${Furniture.itemLuxury(record.itemId)} luxury`;
        luxury.style.cssText = 'font-size:11px;color:#d5b879;margin-top:3px;';
        caption.appendChild(luxury);
        details.appendChild(caption);
        slot.appendChild(details);
        const pickup = mkBtn('Pick up', { variant: 'ghost', css: 'padding:4px 8px;min-height:32px;font-size:12px;' });
        pickup.addEventListener('click', () => {
          if (!this.pickupHouseFurniture(house, record)) return;
          wrap.remove();
          this.presentHouseFurniture(house, options);
        });
        slot.appendChild(pickup);
      } else {
        slot.style.borderStyle = 'dashed';
        const empty = document.createElement('div');
        empty.textContent = `Empty slot ${i + 1}`;
        empty.style.cssText = 'font-size:13px;opacity:.6;';
        slot.appendChild(empty);
      }
      grid.appendChild(slot);
    }
    box.appendChild(grid);
    mount();
    return true;
  }

  _furnitureAbilityAllowed(o) {
    const record = this._placedFurniture(o);
    if (!record) return false;
    if (furnitureSpec(record.itemId).ability === 'craft') return true;
    if (PlacedFloor.furnitureIndoors(this, record)) return true;
    this.flashAtPlayer('Use this inside your Home.');
    return false;
  }

  _bedSleepAllowed(record) {
    if (!this._furnitureAbilityAllowed(record)) return false;
    if (this._zeroEnergyLocked()) {
      this.flashAtPlayer('Too far gone for a bed.');
      return false;
    }
    if ((this.save.energy ?? 0) >= this.getMaxEnergy()) {
      this.flashAtPlayer("You're already rested.");
      return false;
    }
    return true;
  }

  // The item or booth is visible before the blackout. The modal holds input
  // while fading; only the callback at black may spend money or restore energy.
  _presentSleep({ art, itemId, commit }) {
    if (this._sleeping) return false;
    this._sleeping = true;
    let shell = null;
    const cam = this.cameras?.main;
    if (cam?.fadeOut && cam?.once && cam?.fadeIn && this.makeModalShell
        && typeof document !== 'undefined') {
      shell = this.makeModalShell('sleep-modal', { kind: 'use', kindLabel: 'Sleep', art: art || false });
      if (itemId) shell.box.innerHTML = this.worldIconHTML('furniture', 128, furnitureFrame(itemId), 256);
      shell.mount();
    }
    const cut = () => {
      if (shell) {
        shell.box.style.transition = 'opacity 700ms linear';
        shell.box.style.opacity = '0';
        shell.wrap.style.background = 'transparent';
      }
      cameraBlackout(this, () => { shell?.wrap.remove(); commit(); }, {
        onDone: () => { this._sleeping = false; },
      });
    };
    if (shell && this.time?.delayedCall) this.time.delayedCall(350, cut);
    else cut();
    return true;
  }

  useFurniture(o) {
    const record = this._placedFurniture(o);
    if (!record || !this._furnitureAbilityAllowed(record)) return false;
    const ability = furnitureSpec(record.itemId).ability;
    if (ability === 'wash') {
      const cleared = Conditions.clearDebuffs(this.save);
      this.flashAtPlayer(cleared ? 'Debuffs cleared.' : 'Cool, clear water.');
      this._syncStatusRow?.();
      persistSave(this.save);
      return true;
    }
    if (ability === 'sleep') {
      if (!this._bedSleepAllowed(record)) return false;
      return this._presentSleep({ itemId: record.itemId, commit: () => {
        if (!this._bedSleepAllowed(record)) return;
        this._restoreEnergy(this.getMaxEnergy() - (this.save.energy ?? 0));
        persistSave(this.save);
      } });
    }
    if (ability === 'reflect') { this._presentFurnitureReflect(record); return true; }
    if (ability === 'plant') { this.flashAtPlayer('Select a seed; tap the planter.'); return true; }
    return false;
  }

  _presentFurnitureReflect(o) {
    const record = this._placedFurniture(o);
    if (!record || !this._furnitureAbilityAllowed(record)) return false;
    const { wrap, box, mount, mkBtn } = this.makeModalShell('furniture-reflect-modal', {
      kind: 'use', kindLabel: 'Reflect', kindIcon: this.iconSpanHTML(record.itemId, 32),
      art: false, onClose: () => {},
    });
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:flex-end;';
    const pickup = mkBtn('Pick up', { variant: 'ghost' });
    pickup.addEventListener('click', () => { if (this.pickupFurniture(record)) wrap.remove(); });
    top.appendChild(pickup); box.appendChild(top);
    const title = document.createElement('h2');
    title.textContent = 'Choose your robe colour';
    title.style.cssText = 'font-size:18px;margin:8px 0;'; box.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'furniture-colour-swatches';
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,44px);gap:10px;justify-content:center;margin:16px 0;';
    const swatches = [];
    const names = ['Gold', 'Sky blue', 'Mint', 'Rose', 'Lavender', 'Lemon', 'Peach', 'Turquoise', 'Silver', 'Lime'];
    const sync = () => swatches.forEach((button, i) => {
      const selected = Multiplayer.COLORS[i] === this.save.playerColor;
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = selected ? '✓' : '';
      button.style.outline = selected ? '2px solid white' : '';
    });
    Multiplayer.COLORS.forEach((color, i) => {
      const button = mkBtn('', { variant: 'ghost' });
      button.setAttribute('aria-label', names[i]); button.title = names[i];
      button.style.cssText = `width:44px;height:44px;min-width:0;padding:0;border:2px solid #263444;border-radius:10px;--robe-color:#${color.toString(16).padStart(6, '0')};color:#17212b;font-size:24px;outline-offset:2px;`;
      button.addEventListener('click', () => {
        if (!this._furnitureAbilityAllowed(record)) return;
        if (Multiplayer.setColor(this, color)) sync();
      });
      swatches.push(button); grid.appendChild(button);
    });
    sync(); box.appendChild(grid);
    const done = mkBtn('Done');
    done.addEventListener('click', () => wrap.remove()); box.appendChild(done);
    mount(); return true;
  }

  _placedFurniture(o) {
    return (this.save.furniture || []).find(record => record.id === o?.id
      && PlacedFloor.onDepth(record, this.depth) && furnitureSpec(record.itemId)) || null;
  }

  flipPlacedFurniture(o) {
    const record = this._placedFurniture(o);
    if (!record || !furnitureSpec(record.itemId).flip) return false;
    record.flip = !record.flip;
    for (const entry of WorldGen.tileCache.values()) {
      for (const live of entry.objects || []) {
        if (live.kind === 'furniture' && live.id === record.id
            && PlacedFloor.onDepth(live, this.depth)) live.flip = record.flip;
      }
    }
    // Modal callbacks run after the tap driver's save boundary.
    persistSave(this.save);
    this.drawObjects();
    return true;
  }

  pickupFurniture(o) {
    const record = this._placedFurniture(o);
    if (!record) return false;
    if ((this.save.planted || []).some(p => p.planter === record.id
        && PlacedFloor.onDepth(p, record.depth))) {
      this.flashAtPlayer('Harvest first.');
      return false;
    }
    if (Inventory.roomFor(this.save, record.itemId) < 1) {
      this.flashAtPlayer(bagFullFor(record.itemId));
      return false;
    }
    const accepted = this.addToInv(record.itemId, 1, false, { notWild: true, deferRefresh: true });
    // Keep the placed item until the bag confirms acceptance, including stale dialogs.
    if (accepted !== 1) return false;
    this.save.furniture.splice(this.save.furniture.indexOf(record), 1);
    for (const entry of WorldGen.tileCache.values()) {
      if (entry.objects) entry.objects = entry.objects.filter(live =>
        live.kind !== 'furniture' || live.id !== record.id || !PlacedFloor.onDepth(live, this.depth));
    }
    Furniture.recompute(this);
    this._finishInventoryChange();
    persistSave(this.save);
    this.drawObjects();
    return true;
  }

  presentFurniture(o) {
    const record = this._placedFurniture(o);
    if (!record) return false;
    const item = ITEM_BY_ID[record.itemId], spec = furnitureSpec(record.itemId);
    const { wrap, box, mount, mkBtn } = this.makeModalShell('furniture-modal', {
      kind: 'use', kindLabel: 'Furniture', kindIcon: this.iconSpanHTML(item.id, 32),
      art: false, onClose: () => {},
    });
    const pickupRow = document.createElement('div');
    pickupRow.className = 'furniture-pickup-row';
    pickupRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:6px;';
    const pickup = mkBtn('Pick up', { variant: 'ghost' });
    pickup.addEventListener('click', () => {
      if (this.pickupFurniture(record)) wrap.remove();
    });
    pickupRow.appendChild(pickup);
    box.appendChild(pickupRow);

    const art = document.createElement('div');
    art.className = 'furniture-art';
    art.style.cssText = 'font-size:0;margin:0 auto 8px;width:96px;';
    art.innerHTML = this.worldIconHTML('furniture', 96, furnitureFrame(item.id), 192);
    art.style.transform = record.flip ? 'scaleX(-1)' : '';
    box.appendChild(art);
    const name = document.createElement('div');
    name.style.cssText = 'font-size:18px;font-weight:700;line-height:1.2;';
    name.textContent = item.name;
    box.appendChild(name);
    const tier = document.createElement('div');
    tier.style.cssText = 'margin:7px 0;';
    tier.innerHTML = tierBadgeHTML(itemTierOf(item.id), 11);
    box.appendChild(tier);
    const description = document.createElement('div');
    description.style.cssText = 'font-size:13px;line-height:1.4;margin:8px 0 12px;';
    description.textContent = ITEM_EFFECTS[item.id] || '';
    box.appendChild(description);

    const actions = document.createElement('div');
    actions.className = 'furniture-actions';
    actions.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';
    if (spec.ability) {
      const ability = mkBtn(FURNITURE_ABILITY_LABELS[spec.ability]);
      ability.addEventListener('click', () => {
        if (this.useFurniture(record)) wrap.remove();
      });
      actions.appendChild(ability);
    }
    if (spec.flip) {
      const flip = mkBtn('Flip', { variant: 'ghost' });
      flip.addEventListener('click', () => {
        if (this.flipPlacedFurniture(record)) art.style.transform = record.flip ? 'scaleX(-1)' : '';
      });
      actions.appendChild(flip);
    }
    box.appendChild(actions);
    mount();
    return true;
  }
}
