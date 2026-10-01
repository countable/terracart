// Ground fire uses absolute data cells, not camera cells. The permanent ledger
// survives tile eviction; an active index keeps the frame cost off old burns.
class SceneFire {
  _groundFireIndex() {
    if (this._groundFireSave !== this.save) {
      this._groundFireSave = this.save;
      this._groundFireActive = new Map();
      for (const [key, fire] of Object.entries(this.save.groundFire || {})) {
        if (!fire.extinguished) this._groundFireActive.set(key, fire);
      }
    }
    return this._groundFireActive;
  }

  _groundFireAtWorld(x, y) {
    const c = worldMetersToAbsCell(this, x, y);
    return this.save.groundFire?.[GroundFire.key(this.depth || 0, c.cellIX, c.cellIY)];
  }

  _groundFireFuel(cell) {
    if (cell.depth !== (this.depth || 0)) return [];
    const t = absCellToTile(this, cell.cellIX, cell.cellIY);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(t.tx, t.ty));
    if (!entry?._spawned) return [];
    const p = absCellCenterMeters(this, cell.cellIX, cell.cellIY);
    const half = (entry.tileEdgeM || this.tileEdgeM) / t.n / 2;
    const picked = setOf(this.save.picked), chopped = setOf(this.save.chopped);
    const burned = setOf(this.save.burnedObjects), fuel = [];
    for (const list of ['objects', 'wildplants']) {
      WorldGen.forEachItemInBox(entry, list, p.x - half, p.y - half, p.x + half, p.y + half, o => {
        if (!GroundFire.flammable(o) || o.chopped || chopped.has(o.id) || picked.has(o.id) || burned.has(o.id)) return;
        const c = worldMetersToAbsCell(this, o.x, o.y);
        if (c.cellIX === cell.cellIX && c.cellIY === cell.cellIY) fuel.push(o);
      });
    }
    return fuel;
  }

  _rememberGroundFire(fire) {
    fire.fuelIds = this._groundFireFuel(fire).filter(o => !GroundFire.survives(o)).map(o => o.id);
    this._groundFireIndex().set(GroundFire.key(fire.depth, fire.cellIX, fire.cellIY), fire);
    this._groundFireDirty = true;
  }

  _igniteGroundCell(cell, now = Date.now()) {
    const depth = cell.depth ?? this.depth ?? 0;
    if (!GroundFire.ignite(this.save, depth, cell.cellIX, cell.cellIY, now)) return false;
    this._rememberGroundFire(this.save.groundFire[GroundFire.key(depth, cell.cellIX, cell.cellIY)]);
    return true;
  }

  _igniteGroundAtWorld(x, y) {
    return this._igniteGroundCell(worldMetersToAbsCell(this, x, y));
  }

  // Split the ray at tile-row boundaries first: neighbouring Mercator rows
  // can have different cell sizes. Streets owns exact grid traversal, which
  // also catches a cell crossed only at a narrow corner.
  _igniteGroundSegment(x0, y0, x1, y1) {
    const a = worldMetersToTilePx(this, x0, y0), b = worldMetersToTilePx(this, x1, y1);
    const cuts = [0, 1], dy = b.y - a.y, T = WorldGen.TILE_PX;
    if (dy !== 0) {
      for (let row = Math.floor(Math.min(a.y, b.y) / T) + 1; row * T < Math.max(a.y, b.y); row++) {
        cuts.push((row * T - a.y) / dy);
      }
    }
    cuts.sort((u, v) => u - v);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i];
      const ty = Math.floor((a.y + dy * (lo + hi) / 2) / T);
      const n = this.cellsForRow ? this.cellsForRow(ty) : this.cellsPerTile;
      const line = [lo, hi].map(t => ({ x: a.x + (b.x - a.x) * t, y: a.y + dy * t - ty * T }));
      Streets.reachIntervals(line, 1, T / n, (ix, iy) => {
        const tx = Math.floor(ix / n);
        const c = tileCellToAbs(this, tx, ty, ix - tx * n, Math.max(0, Math.min(n - 1, iy)));
        this._igniteGroundCell(c);
        return false;
      });
    }
    this._igniteGroundAtWorld(x0, y0);
    this._igniteGroundAtWorld(x1, y1);
  }

  _explodeFlask(shot) {
    const c = worldMetersToAbsCell(this, shot.x, shot.y);
    const radius = CONSUMABLE_SPEC.explosive_flask.fireRadiusCells;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        this._igniteGroundCell(absCellOffset(this, c.cellIX, c.cellIY, dx, dy));
      }
    }
    persistSave(this.save);
  }

  _tickGroundFire() {
    if (!this.startWorldM) return;
    const now = Date.now(), records = this._groundFireIndex();
    let destroyed = null;
    GroundFire.step(this.save, now, {
      records: records.values(),
      neighbors: fire => {
        const cells = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) cells.push({ depth: fire.depth, ...absCellOffset(this, fire.cellIX, fire.cellIY, dx, dy) });
        }
        return cells;
      },
      flammable: cell => this._groundFireFuel(cell).length > 0,
      onIgnite: fire => this._rememberGroundFire(fire),
      onExtinguish: fire => {
        destroyed ||= new Set(this.save.burnedObjects || []);
        for (const id of fire.fuelIds || []) destroyed.add(id);
        for (const o of this._groundFireFuel(fire)) if (!GroundFire.survives(o)) destroyed.add(o.id);
        records.delete(GroundFire.key(fire.depth, fire.cellIX, fire.cellIY));
        this._streetFeetKey = null; // tar under stationary feet has gone
        this._groundFireDirty = true;
      },
    });
    if (destroyed) this.save.burnedObjects = [...destroyed];
    const px = this.startWorldM.x + this.playerM.x, py = this.startWorldM.y + this.playerM.y;
    if (GroundFire.active(this._groundFireAtWorld(px, py), now)) this._ignitePlayer();
    if (this._groundFireDirty) {
      this._groundFireDirty = false;
      persistSave(this.save);
    }
  }

  useExplosiveFlask() {
    const sel = getSelectedSlot(this.save);
    if (sel?.id !== 'explosive_flask' || !(sel.count > 0) || Combat.playerDowned(this.save.energy)) return false;
    const x = this.startWorldM.x + this.playerM.x, y = this.startWorldM.y + this.playerM.y;
    const heading = Combat.shotHeading('bow', x, y, this.facing);
    const shot = Combat.spawnExplosiveFlask(x, y, heading, this.cellM,
      Fog.REVEAL_CELLS * this.cellM, CONSUMABLE_SPEC.explosive_flask);
    if (!shot) return false;
    this._shots.push(shot);
    consumeSelected(this.save);
    persistSave(this.save);
    this.buildInventoryDOM();
    return true;
  }
}
