// Ground fire uses absolute data cells, not camera cells. The permanent ledger
// survives tile eviction; an active index keeps the frame cost off old burns.
// The two conditions a creature carries (_tickUnitCondition): who it is on
// (`carries`), the per-frame stamp, what the row's tick levies (the burn
// re-stoked by the ground it stands on, the poison's bite), who gave it
// (`by`) and the kill source when nobody did.
const UNIT_CONDITIONS = {
  burning: { carries: c => Combat.canBurn(c), tickedAt: '_fireTickT', by: '_burnBy', source: 'burn',
    tick(scene, c, now) {
      const exposure = scene._fireExposureAtWorld(c.x, c.y);
      if (exposure) Combat.ignite(c, now, exposure);
      return Combat.burnTick(c, now, !!exposure);
    } },
  poison: { carries: c => !!c._poisonState, tickedAt: '_poisonTickT', by: '_poisonBy', source: 'poison',
    tick(scene, c, now) { return Combat.poisonTick(c, now); } },
};
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

  _igniteGroundAtWorld(x, y, excludedCell = null) {
    const cell = worldMetersToAbsCell(this, x, y);
    if (excludedCell && cell.cellIX === excludedCell.cellIX && cell.cellIY === excludedCell.cellIY) return false;
    return this._igniteGroundCell(cell);
  }

  _igniteFireballTrail(shot, x0, y0, x1 = x0, y1 = y0) {
    // Snapshot the launch cell before the shot moves, so casting is safe
    // even from a cell edge or while the player is walking.
    shot.launchCell ||= worldMetersToAbsCell(this, shot.x, shot.y);
    this._igniteGroundSegment(x0, y0, x1, y1, shot.launchCell);
  }

  // Split the ray at tile-row boundaries first: neighbouring Mercator rows
  // can have different cell sizes. Streets owns exact grid traversal, which
  // also catches a cell crossed only at a narrow corner.
  _igniteGroundSegment(x0, y0, x1, y1, excludedCell = null) {
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
        if (!excludedCell || c.cellIX !== excludedCell.cellIX || c.cellIY !== excludedCell.cellIY) this._igniteGroundCell(c);
        return false;
      });
    }
    this._igniteGroundAtWorld(x0, y0, excludedCell);
    this._igniteGroundAtWorld(x1, y1, excludedCell);
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
    const { x: px, y: py } = playerWorldM(this);
    if (GroundFire.active(this._groundFireAtWorld(px, py), now)) this._ignitePlayer();
    if (this._groundFireDirty) {
      this._groundFireDirty = false;
      persistSave(this.save);
    }
  }

  _fireExposureAtWorld(x, y) {
    if (this.save.groundFire && GroundFire.active(this._groundFireAtWorld(x, y), Date.now())) return 'fire';
    if (this._nearAny('fires', x, y, FIRE_TOUCH_CELLS)) return 'fire';
    if ((this.depth === 0 || this.depth === WorldGen.LAVA_DEPTH) && this.cellAt) {
      const cell = this.cellAt(x, y);
      if (cell.loaded && cell.type === WorldGen.T.CAVE_LAVA) return 'lava';
    }
    return null;
  }

  _playerFireExposure() {
    if (!this.startWorldM || Combat.playerDowned(this.save.energy)) return false;
    const feet = playerWorldM(this);
    return !!this._fireExposureAtWorld(feet.x, feet.y);
  }

  // A CREATURE'S CONDITION TICK — the burn and the poison, one skeleton
  // (UNIT_CONDITIONS, the two rows of Conditions.DEFINITIONS a foe can
  // carry): once per frame per body, never a spent or a caught one, the
  // row's bite through the one dispatch (_damageBurningUnit: an NPC's rest,
  // a pet's retreat, a foe's bar and bounty). Who lit or poisoned it names
  // the kill: the player's torch or flask is a player kill. Every nearby body
  // takes fire exposure before its movement/AI branch, including neighbours,
  // caught-in-progress animals and chilled creatures.
  _tickUnitCondition(c, now, id) {
    const row = UNIT_CONDITIONS[id];
    if (!c || !row.carries(c) || c._spent || this.save.caught?.includes(c.id) || c[row.tickedAt] === now) return false;
    c[row.tickedAt] = now;
    // Who gave it, read BEFORE the tick (a burn that ends forgets its lighter).
    const source = c[row.by] === 'player' ? 'player' : row.source;
    const damage = row.tick(this, c, now);
    return damage > 0 && this._damageBurningUnit(c, damage, source, now);
  }
  _tickUnitFire(c, now) { return this._tickUnitCondition(c, now, 'burning'); }
  _tickUnitPoison(c, now) { return this._tickUnitCondition(c, now, 'poison'); }

  _damageBurningUnit(c, damage, source, now) {
    // NPCs use their existing wounded/resting state, rather than a health bar.
    if (c.kind === 'npc') { NPC.hit(this, c, Date.now(), damage); return false; }
    if (!Combat.isAlly(c)) {
      const dead = this._damageEnemy(c, damage, source, { bypassArmor: true });
      if (dead && this._workProgress?.flee === c) this.cancelWorkProgress();
      return dead;
    }
    const dealt = Combat.damageDealt(c, damage, { bypassArmor: true });
    if (dealt > 0) this._popDamageNumber(c, dealt);
    c._lastDamagedT = Date.now();
    if (Combat.hp(c) > 0) return false;
    // A downed ally takes its kind's rule (Companions.knockedOut).
    return Companions.knockedOut(this, c, now);
  }

  readTomeFirewall() {
    if (!this._selectedConsumable('tome_fire_wall') || Combat.playerDowned(this.save.energy)) return false;
    if (!this._tomeReady('tome_fire_wall')) return false;
    const facing = this.facing;
    if (!facing || !Number.isFinite(facing.x) || !Number.isFinite(facing.y) || !Math.hypot(facing.x, facing.y)) return false;
    // The compass is continuous; snap its heading to the eight cell directions.
    const angle = Math.round(Math.atan2(facing.y, facing.x) / (Math.PI / 4)) * Math.PI / 4;
    const dx = Math.round(Math.cos(angle)), dy = Math.round(Math.sin(angle));
    const feet = playerWorldM(this);
    const player = worldMetersToAbsCell(this, feet.x, feet.y);
    const radius = (CONSUMABLE_SPEC.tome_fire_wall.lengthCells - 1) / 2;
    const now = Date.now();
    let lit = 0;
    const mid = absCellOffset(this, player.cellIX, player.cellIY, dx, dy);
    for (let offset = -radius; offset <= radius; offset++) {
      const cell = absCellOffset(this, player.cellIX, player.cellIY, dx - dy * offset, dy + dx * offset);
      if (cell.cellIX === player.cellIX && cell.cellIY === player.cellIY) continue;
      if (this._igniteGroundCell(cell, now)) lit++;
    }
    if (!lit) {
      this.flashAtPlayer('No fresh ground — tome kept');
      return false;
    }
    this._tomeSpent('tome_fire_wall');
    this.flashAtCell('A wall of fire rises', mid.cellIX, mid.cellIY);
    return true;
  }

  useExplosiveFlask() {
    const sel = getSelectedSlot(this.save);
    if (sel?.id !== 'explosive_flask' || !(sel.count > 0) || Combat.playerDowned(this.save.energy)) return false;
    const { x, y } = playerWorldM(this);
    const heading = Combat.shotHeading('bow', x, y, this.facing);
    const shot = Combat.spawnExplosiveFlask(x, y, heading, this.cellM,
      Fog.REVEAL_CELLS * this.cellM, CONSUMABLE_SPEC.explosive_flask);
    if (!shot) return false;
    this._shots.push(shot);
    this._consumeSelected();
    return true;
  }
}
