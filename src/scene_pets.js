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
    add('View info', () => this.presentPetInfo(id));
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

  presentPetInfo(id) {
    const pet = Pets.get(this.save, id);
    if (!pet) return;
    Pets.tick(this.save, pet);
    const { wrap, box, mount, mkBtn } = this.makeModalShell('pet-info-modal', { kind: 'note', kindLabel: 'Pet info', art: false, story: true });
    const name = itemName(pet.kind);
    const title = document.createElement('h2');
    title.textContent = name;
    title.style.cssText = 'margin:0 0 6px;font-size:18px;line-height:1.2;';
    box.appendChild(title);
    const portrait = document.createElement('div');
    portrait.style.cssText = 'width:128px;height:128px;margin:6px auto;border-radius:12px;overflow:hidden;background:#18251d;';
    const art = typeof CharacterPortraits !== 'undefined' ? CharacterPortraits.pet(pet.kind) : null;
    if (art) {
      const img = document.createElement('img');
      img.src = art; img.alt = name; img.width = 128; img.height = 128;
      img.style.cssText = 'display:block;width:128px;height:128px;image-rendering:pixelated;';
      img.addEventListener('error', () => { img.remove(); portrait.appendChild(this.renderItemIcon(pet.kind, 128, 'block')); }, { once: true });
      portrait.appendChild(img);
    } else portrait.appendChild(this.renderItemIcon(pet.kind, 128, 'block'));
    box.appendChild(portrait);
    const descriptions = {
      chicken: 'A curious little companion with a soft cluck and a busy beak.',
      cow: 'Patient eyes and a gentle nudge make even a long journey feel quieter.',
      cat: 'An independent companion who stays close on soft, silent paws.',
      dog: 'A loyal companion with an eager nose and a warmly wagging tail.',
      deer: 'A watchful woodland companion, learning to trade fear for trust.',
      rabbit: 'A bright-eyed bundle of soft fur, twitching whiskers and quick feet.',
      butterfly: 'A delicate companion whose fluttering wings bring a little colour to the road.',
      crab: 'A determined shore companion who meets the world with raised claws.',
      horse: 'A sure-footed companion, always ready for the open road.',
      sea_turtle: 'A quiet traveller with a sturdy shell and an unhurried pace.',
      green_dragon: 'A green-winged companion, growing into the strength hidden in its shining egg.',
      slime: 'A soft, wobbling companion who has learned to trust your hand.',
    };
    const description = document.createElement('p');
    description.style.cssText = 'margin:8px 0;line-height:1.35;';
    description.textContent = descriptions[Pets.species(pet.kind)]
      || 'Once a wild foe, now a trusted companion at your side.';
    box.appendChild(description);
    const stats = document.createElement('dl');
    stats.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:6px 16px;margin:8px 0;text-align:left;';
    const number = value => String(Math.round(value * 10) / 10);
    const values = [
      ['HP', `${number(pet.hp)} / ${number(Combat.maxHp(pet))}`],
      ['Damage per hit', number(Combat.petBlow(pet))],
      ['Defence bonus', number(Pets.stats(pet).armor)],
      ['Status', Pets.isDown(pet) ? 'Resting' : pet.carried ? 'Carried' : pet.stayHome ? 'Staying home' : 'Following'],
    ];
    for (const [label, value] of values) {
      const term = document.createElement('dt'), detail = document.createElement('dd');
      term.textContent = label; detail.textContent = value;
      detail.style.cssText = 'margin:0;font-weight:bold;';
      stats.appendChild(term); stats.appendChild(detail);
    }
    box.appendChild(stats);
    const back = mkBtn('Back');
    back.addEventListener('click', e => { e.stopPropagation(); wrap.remove(); this.presentPetMenu(id); });
    box.appendChild(back);
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
