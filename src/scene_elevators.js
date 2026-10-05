// Home's elevator is a saved player overlay; it never changes cave generation.
class SceneElevators {
  _elevatorHomePosition() {
    const save = this.save;
    if (save.starterTrailer && save.starterTrailer.id === save.starterShopId) return save.starterTrailer;
    if (this._homePosMemo && this._homePosMemo.id === save.starterShopId) return this._homePosMemo.pos;
    for (const entry of WorldGen.tileCacheFor(0).values()) {
      const home = (entry.objects || []).find(o => o.id === save.starterShopId);
      if (home) return home;
    }
    return save.starterCratesAt || HomeArea.worldM;
  }

  openElevator(stair) {
    const depth = this.depth || 0;
    const { wrap, box, mount, mkBtn } = this.makeModalShell('elevator-modal', {
      kind: 'note', kindLabel: 'Elevator', art: 'progression_elevator', onClose: () => {},
    });
    const destinations = Elevators.isRepaired(this.save) ? [0, ...Elevators.unlockedFloors(this.save)].filter(floor => floor !== depth) : [];
    const description = document.createElement('p');
    description.textContent = Elevators.isRepaired(this.save)
      ? (Elevators.hasParts(this.save) ? 'The lift is fully repaired. Where would you like to go?' : 'The lift connects Home and level 1. Find the elevator parts in your tenth chest on level 1 to restore the deeper stops.')
      : 'Repair the lift with 9 wood and 9 stone to connect Home and level 1. Elevator parts from your tenth chest on level 1 restore the deeper stops.';
    box.appendChild(description);
    if (!Elevators.isRepaired(this.save) && (depth === 0 || depth === 1)) {
      const repair = mkBtn('Repair — 9 wood + 9 stone', true);
      repair.disabled = !Elevators.canRepair(this.save);
      repair.addEventListener('click', event => {
        event.stopPropagation();
        if ((this.depth || 0) !== depth || !Elevators.repair(this.save)) return;
        persistSave(this.save);
        this.buildInventoryDOM();
        wrap.remove();
        this.openElevator(stair);
      });
      box.appendChild(repair);
    }
    for (const floor of destinations) {
      const button = mkBtn(floor === 0 ? 'Home' : `Floor ${floor}`, true);
      button.style.display = 'block';
      button.style.width = '100%';
      button.style.marginBottom = '8px';
      button.addEventListener('click', event => {
        event.stopPropagation();
        if ((this.depth || 0) !== depth) { wrap.remove(); return; }
        if (floor > 0 && !Elevators.unlockedFloors(this.save).includes(floor)) return;
        const anchor = this.save.homeElevator || this._elevatorHomePosition();
        if (!anchor) return;
        wrap.remove();
        if (floor > 0) {
          const cell = this.cellAt(anchor.x, anchor.y);
          this.dugWallSet.add(`${floor}:${cellKeyFromAbsCell(cell.cellIX, cell.cellIY)}`);
        }
        this.changeDepth(floor - depth, { ...anchor, elevator: true });
      });
      box.appendChild(button);
    }
    const cancel = mkBtn('Cancel', false);
    cancel.addEventListener('click', event => { event.stopPropagation(); wrap.remove(); });
    box.appendChild(cancel);
    mount();
  }

  ensureHomeElevatorObject() {
    if ((this.depth || 0) !== 0) { this.ensureDungeonElevatorObject(); return; }
    const home = this._elevatorHomePosition();
    if (!home) return;
    const homeKey = `${this.save.starterShopId || 'home'}@${home.x},${home.y}`;
    const previous = this.save.homeElevator;
    if (previous && previous.homeKey !== homeKey) {
      for (const entry of WorldGen.tileCache.values()) {
        if (entry.objects) entry.objects = entry.objects.filter(o => o.id !== previous.id);
      }
      delete this.save.homeElevator;
      this._homeElevatorChecked = null;
    }
    const saved = this.save.homeElevator;
    const now = Date.now();
    if (this._homeElevatorRetryAt > now && this._homeElevatorRetryKey === homeKey) return;
    const ownedStamp = ['planted', 'tilled', 'placedRocks', 'fires', 'scarecrows', 'fruittrees']
      .map(key => this.save[key]?.length || 0).join(',');
    if (saved) {
      const tile = worldMetersToTile(this, saved.x, saved.y);
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tile.tx, tile.ty));
      if (!entry?._spawned) return;
      const checked = this._homeElevatorChecked;
      if (checked?.entry === entry && checked.objects === entry.objects && checked.count === entry.objects.length
          && checked.ownedStamp === ownedStamp) return;
    }
    const anchor = worldMetersToAbsCell(this, home.x, home.y);
    const taken = new Set(), owned = new Set();
    const cellKey = c => `${c.cellIX}_${c.cellIY}`;
    const mark = (object, target) => {
      if (!object || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return;
      for (const c of SpawnOwnership.footprintCells(this, object)) target.add(cellKey(c));
    };
    const ids = SpawnOwnership.savedIds(this.save);
    for (const entry of WorldGen.tileCache.values()) {
      for (const list of ['objects', 'wildplants', 'extraTreasures', 'parkingTreasures']) {
        for (const object of entry[list] || []) {
          if (object.id === saved?.id) continue;
          mark(object, taken);
          if (SpawnOwnership.isProtected(object, this.save, ids)) mark(object, owned);
        }
      }
      if (entry.treasure) mark(entry.treasure, taken);
    }
    for (const list of ['planted', 'fruittrees', 'fires', 'scarecrows']) {
      for (const object of this.save[list] || []) if (PlacedFloor.onDepth(object, 0)) {
        mark(object, taken); mark(object, owned);
      }
    }
    for (const list of ['tilled', 'placedRocks']) for (const key of this.save[list] || []) {
      taken.add(key); owned.add(key);
    }
    const plot = this.save.starterPlotAt;
    if (plot && Number.isFinite(plot.x)) {
      const a = worldMetersToAbsCell(this, plot.x, plot.y);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const key = cellKey(absCellOffset(this, a.cellIX, a.cellIY, dx, dy));
        taken.add(key); owned.add(key);
      }
    }
    const eligible = (cell, occupied) => {
      const t = absCellToTile(this, cell.cellIX, cell.cellIY);
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(t.tx, t.ty));
      if (!entry?._spawned || !entry.grid || occupied.has(cellKey(cell))) return null;
      const n = entry.cellsPerEdge;
      if (!WorldGen.isSpawnCell(entry.grid, n, n, t.ix, t.iy,
          { roadMask: entry.roadMask, spawnWhy: entry.spawnWhy }, 'cave')) return null;
      if (WorldGen.privateVetoAt?.(t.tx, t.ty, t.ix, t.iy)) return null;
      return { entry, point: absCellCenterMeters(this, cell.cellIX, cell.cellIY) };
    };
    let seat = saved && eligible(worldMetersToAbsCell(this, saved.x, saved.y), owned);
    if (!seat) {
      // A fixed ring order makes the first free, legal cell beside Home stable.
      // The two-cell minimum leaves the trailer's entire one-cell moat clear.
      for (let r = 2; r <= 5 && !seat; r++) {
        for (let dy = -r; dy <= r && !seat; dy++) for (let dx = -r; dx <= r && !seat; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          seat = eligible(absCellOffset(this, anchor.cellIX, anchor.cellIY, dx, dy), taken);
        }
      }
      if (!seat) {
        this._homeElevatorRetryKey = homeKey;
        this._homeElevatorRetryAt = now + 1000;
        return;
      }
      if (saved) for (const entry of WorldGen.tileCache.values()) {
        if (entry.objects) entry.objects = entry.objects.filter(o => o.id !== saved.id);
      }
      this.save.homeElevator = { homeKey, id: `home_elevator:${homeKey}`, ...seat.point };
      if (typeof persistSave === 'function') persistSave(this.save);
    }
    const record = this.save.homeElevator;
    const object = { kind: 'staircase', elevator: true, dir: 'down', depth: 0, id: record.id, x: record.x, y: record.y,
      _synthetic: true, playerOwned: true };
    SpawnOwnership.reconcileEntry(this, seat.entry, [object]);
    if (!seat.entry.objects.some(o => o.id === object.id)) seat.entry.objects.push(object);
    this._homeElevatorChecked = { entry: seat.entry, objects: seat.entry.objects,
      count: seat.entry.objects.length, ownedStamp };
  }
  ensureDungeonElevatorObject() {
    const depth = this.depth || 0;
    if (!Elevators.FLOORS.includes(depth) || depth === 0) return;
    const anchor = this.save.homeElevator || this._elevatorHomePosition();
    if (!anchor) return;
    const cell = this.cellAt(anchor.x, anchor.y);
    this.dugWallSet.add(`${depth}:${cellKeyFromAbsCell(cell.cellIX, cell.cellIY)}`);
    const tile = worldMetersToTile(this, anchor.x, anchor.y);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tile.tx, tile.ty));
    if (!entry?._spawned) return;
    const id = `dungeon_elevator:${depth}`;
    if (!(entry.objects || []).some(o => o.id === id)) {
      entry.objects = entry.objects || [];
      entry.objects.push({ kind: 'staircase', elevator: true, dir: 'up', depth, id,
        x: anchor.x, y: anchor.y, _synthetic: true, playerOwned: true });
    }
  }

}
