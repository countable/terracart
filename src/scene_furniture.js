// Placed furniture uses the inventory's art and one lossless pickup transaction.
const FURNITURE_ABILITY_LABELS = {
  sleep: 'Sleep', wash: 'Wash', reflect: 'Reflect', craft: 'Craft', plant: 'Plant',
};

class SceneFurniture {
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
    if (Inventory.roomFor(this.save, record.itemId) < 1) {
      this.flashAtPlayer(BAG_FULL_MSG);
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
    art.style.cssText = 'font-size:0;margin:0 auto 8px;width:112px;';
    art.innerHTML = this.iconSpanHTML(item.id, 112);
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
      const ability = mkBtn(`${FURNITURE_ABILITY_LABELS[spec.ability]} · Coming next`, { disabled: true });
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
