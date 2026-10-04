// Individual pets share one panel whether carried, following or resting at Home.
class ScenePets {
  _petChanged() {
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.creatures) continue;
      entry.creatures = entry.creatures.filter(c => {
        if (!c.pet) return true;
        const row = Pets.get(this.save, c.id);
        if (!row || row.carried) return false;
        Pets.tick(this.save,c);
        Object.assign(c, row, { _hp: row.hp });
        return true;
      });
    }
    for (const id of this._travellingPets?.keys() || []) {
      if (!Pets.get(this.save, id) || Pets.get(this.save, id).carried) this._travellingPets.delete(id);
    }
    this._petFollowCheck = 0;
    Companions.tickPets(this);
    persistSave(this.save);
    this.buildInventoryDOM();
  }

  presentPetMenu(id) {
    const pet = Pets.get(this.save, id);
    if (!pet) return;
    for (const row of Pets.list(this.save)) Pets.tick(this.save,row);
    const { wrap, box, mount, mkBtn } = this.makeModalShell('pet-modal', { kind: 'farm', kindLabel: 'Pet' });
    const title = document.createElement('p');
    title.textContent = itemName(pet.kind);
    box.appendChild(title);
    const status = document.createElement('p');
    const resting = Pets.isDown(pet);
    const mode = resting ? `Resting · ${shortDuration(pet.recoverUntil - Date.now())}`
      : pet.carried ? 'Carried' : pet.stayHome ? 'Staying home' : 'Following';
    status.textContent = `${mode} · Energy ${Math.ceil(pet.hp)}/${Combat.maxHp(pet)} · Favourite fed ✓`;
    box.appendChild(status);
    const add = (label, fn, disabled = false) => {
      const b = mkBtn(label, false, disabled);
      b.style.margin = '3px';
      b.addEventListener('click', e => { e.stopPropagation(); if (b.disabled) return; wrap.remove(); fn(); });
      box.appendChild(b);
    };
    const foods = (this.save.inv || []).filter(s => s.count > 0 && animalLikesFood(pet.kind, s.id));
    add('Feed favourite', () => this.presentPetFoodMenu(id), !foods.length);
    if (pet.carried) {
      add('Bring along', () => {
        const at = playerWorldM(this);
        const point = characterFreePoint(this, pet, at.x, at.y);
        if (!point) { this.flashAtPlayer('No room to set your pet down.'); return; }
        const abs = worldMetersToAbsCell(this, point.x, point.y);
        const pc = absCellToTile(this, abs.cellIX, abs.cellIY);
        Pets.deploy(this.save, id, { ...point, tx: pc.tx, ty: pc.ty, depth: this.depth || 0, stayHome: false });
        this._petChanged();
      }, resting);
    } else {
      add('Carry', () => { Pets.carry(this.save, pet); this._petChanged(); });
      add(pet.stayHome ? 'Follow me' : 'Stay here', () => {
        pet.stayHome = !pet.stayHome;
        pet.petHomeX = pet.x; pet.petHomeY = pet.y;
        this._petChanged();
      }, resting);
    }
    if (Pets.species(pet.kind) === 'horse') add(isRiding(this.save) ? 'Dismount' : 'Ride', () => {
      this.save.riding = !isRiding(this.save); this._petChanged();
    }, resting);
    const gear = document.createElement('p');
    gear.textContent = ['collar', 'charm'].map(slot => `${slot}: ${ITEM_BY_ID[pet.accessories?.[slot]]?.name || 'none'}`).join(' · ');
    box.appendChild(gear);
    add('Accessories', () => this.presentPetAccessories(id));
    add('Release into the wild', () => this.showConfirmModal({ kind: 'farm', title: 'Release this pet?',
      body: 'It will stop being your pet. Its accessories return to your bag.', acceptLabel: 'Release',
      onAccept: () => {
        const at = playerWorldM(this);
        const point = characterFreePoint(this,pet,at.x,at.y);
        if (!point) { this.flashAtPlayer('No safe space to release it.'); return; }
        const abs = worldMetersToAbsCell(this,point.x,point.y);
        const pc = absCellToTile(this,abs.cellIX,abs.cellIY);
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx,pc.ty));
        if (!entry?.creatures) { this.flashAtPlayer('Wait for the map to load.'); return; }
        if (!Pets.release(this.save, id)) { this.flashAtPlayer('Make room for its accessories.'); return; }
        const wild = this.save.wildAnimals.find(r => r.id === id);
        Object.assign(wild,point,{tx:pc.tx,ty:pc.ty,depth:this.depth || 0});
        entry.creatures.push(WorldGen.makeCreature(wild.kind,wild.x,wild.y,wild.id,{...wild,_hp:wild.hp}));
        if (Pets.species(pet.kind) === 'horse') this.save.riding = false;
        this._petChanged();
      }, onCancel: () => this.presentPetMenu(id),
    }), resting);
    add('Close', () => {});
    mount();
  }

  presentPetFoodMenu(id) {
    const pet = Pets.get(this.save, id);
    if (!pet) return;
    const choices = (this.save.inv || []).filter(s => s.count > 0 && animalLikesFood(pet.kind, s.id))
      .map(s => ({ key: s.id, label: itemName(s.id), iconHTML: this.iconSpanHTML(s.id, 24) }));
    this.showOfferModal({ kind: 'farm', title: 'Favourite food', get: 'Restore your pet’s energy.',
      choices, canAfford: choices.length > 0, acceptLabel: 'Feed', cancelLabel: 'Back',
      onCancel: () => this.presentPetMenu(id), onAccept: food => {
        if (Inventory.count(this.save, food) > 0 && Pets.feed(this.save, pet, food)) Inventory.remove(this.save, food, 1);
        this._petChanged(); this.presentPetMenu(id);
      },
    });
  }

  presentPetAccessories(id) {
    const pet = Pets.get(this.save, id);
    if (!pet) return;
    const choices = ITEMS.filter(it => it.petAccessory && Inventory.count(this.save, it.id) > 0)
      .map(it => ({ key: it.id, label: it.name, iconHTML: this.iconSpanHTML(it.id, 24),
        info: Object.entries(it.petAccessory.stats).map(([stat, value]) => `+${value} ${{ maxHp: 'maximum energy', armor: 'defence', attack: 'attack', regen: 'recovery' }[stat]}`).join(', ') }));
    for (const [slot, item] of Object.entries(pet.accessories || {})) {
      if (item) choices.push({ key: 'remove:' + slot, label: 'Remove ' + ITEM_BY_ID[item].name });
    }
    this.showOfferModal({ kind: 'farm', title: 'Pet accessories', get: 'One collar and one charm per pet.',
      choices, canAfford: choices.length > 0, acceptLabel: 'Apply', cancelLabel: 'Back',
      onCancel: () => this.presentPetMenu(id), onAccept: key => {
        const ok = key.startsWith('remove:') ? Pets.unequip(this.save, id, key.slice(7)) : Pets.equip(this.save, id, key);
        if (!ok) this.flashAtPlayer('Make room for the old accessory.');
        this._petChanged(); this.presentPetMenu(id);
      },
    });
  }
}
