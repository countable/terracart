// THE BOSS ROUTINE's scene side (BossEncounters — src/boss_encounters.js —
// owns the records and their clock). Every frame _tickBossEncounters ends the
// player's own fights they can no longer be in (down, or off the fight's
// floor), resets whatever has ended (the citadel's _expireCitadelBattles; the
// serpent's _resetSerpent) and moves the live serpents. A won fight spends
// its trigger and drops its record (the citadel's claim in scene_shops.js;
// the serpent's _serpentDefeated here).
//
// THE SERPENT (a Serpent Idol's boss). Raised by _useSerpentIdol — never on
// the Major-and-Medium road group's kerb or junctions (SERPENT_ROAD_BITS) —
// it is one creature per piece (enemy_roster.js serpent_head / _body /
// _tail, ids `<key>_head`, `<key>_c<i>`, `<key>_tail`): the head snakes
// about the player inside the row's leashCells, the coils and the tail tip
// follow the head's own trail, and every coil touching the player bites for
// the row's dmg once a damageIntervalSeconds. Coils are struck like any foe
// (10 hp; a slain coil is a save.caught id, and the chain closes up behind
// it); the head and tail tip are untargetable. When only they are left it
// dies: the idol is consumed and a T4 boss chest (loot.js chestThemeFor —
// equipment or a unique relic) is left where the head fell. The chest is a
// save record (save.bossChests) until opened, so a tile rebuild keeps it.
// The pieces are never saved: a reload re-raises the survivors of a fight
// still on the clock beside the player.
//   SHARED (multiplayer.js `boss` frames): the starter's device drives the
// head and sends its pose; a nearby player ADOPTS the fight (_adoptSerpent —
// the same key, start and piece ids) and their copy's head follows that
// feed while its coils, bites and trail run here. The coils are shared
// enemies (EnemySpawns.isSharedId, while the fight is live), so every blow
// and kill lands on every copy. Each helper who sees it die gets a hoard of
// their own; only the starter's idol is spent. When the starter's fight
// ends, the feed stops and every adopted copy resets (BossEncounters staleMs).
const SERPENT_ROAD_BITS = () => WorldGen.ROAD_CLASS_MAJOR_BAND | WorldGen.ROAD_CLASS_MAJOR_BUFFER
  | WorldGen.ROAD_CLASS_JUNCTION_EXCLUDE;
const BOSS_CHEST_TIER = 4;
class SceneBoss {
  _tickBossEncounters(now = Date.now()) {
    const ended = BossEncounters.abandon(this.save,
      { depth: this.depth || 0, downed: Combat.playerDowned(this.save.energy) }, now);
    this._expireCitadelBattles(now);
    const serpents = BossEncounters.expire(this.save, 'serpent', now);
    for (const e of serpents) this._resetSerpent(e.key, e.record.depth || 0);
    if (serpents.length) persistSave(this.save);
    // Only the starter is told (an adopted copy just goes with its feed).
    const said = ended.find(e => e.record.own === true) || serpents.find(e => e.record.own === true);
    if (said) this.flashAtPlayer(BossEncounters.KINDS[said.kind].resetLine);
    this._tickSerpents(now);
    if (now - (this._bossChestCheckT || 0) > 1000) {
      this._bossChestCheckT = now;
      this._ensureBossChests();
    }
  }

  // Why the idol cannot be raised here and now, or null.
  _serpentIdolRefusal() {
    if (Inventory.count(this.save, 'serpent_idol') < 1) return 'No idol';
    if (Combat.playerDowned(this.save.energy)) return 'Too weak';
    if ((this.depth || 0) === Arena.DEPTH) return 'Not in the arena';
    if (BossEncounters.list(this.save).some(e => e.kind === 'serpent')) return 'The serpent is risen';
    const p = playerWorldM(this);
    if (RoadSafety.roadClassAt(this, p.x, p.y) & SERPENT_ROAD_BITS()) return 'Too near a busy road';
    return null;
  }

  // The idol's use (items.js CONSUMABLE_SPEC.serpent_idol `method`). Raising
  // never spends it; _serpentDefeated does.
  _useSerpentIdol() {
    const why = this._serpentIdolRefusal();
    if (why) { this.flashAtPlayer(kept(why, 'idol')); return false; }
    const now = Date.now(), key = `serpent_${now}`;
    if (!BossEncounters.start(this.save, 'serpent', key, { depth: this.depth || 0 }, now)) return false;
    this._spawnSerpent(key);
    persistSave(this.save);
    this.flashAtPlayer('The serpent rises!');
    return true;
  }

  // Every live piece of serpent `key`, wherever its tile entry is.
  _serpentPieces(key) {
    const prefix = `${key}_`, out = { head: null, tail: null, coils: [] };
    for (const entry of WorldGen.tileCache.values()) for (const c of entry.creatures || []) {
      if (!String(c.id).startsWith(prefix)) continue;
      if (c.kind === 'serpent_head') out.head = c;
      else if (c.kind === 'serpent_tail') out.tail = c;
      else out.coils.push(c);
    }
    out.coils.sort((a, b) => a.segIndex - b.segIndex);
    return out;
  }

  // Seat the head SPAWN_CELLS from the player at a random bearing, the body
  // laid straight out behind it; slain coils (save.caught) stay slain.
  // `at` ({ x, y, h }) seats the head on a fed pose (an adopted fight).
  _spawnSerpent(key, at = null) {
    const row = BossEncounters.KINDS.serpent, cellM = this.cellM;
    const p = playerWorldM(this), entry = this._serpentHostEntry(p);
    if (!entry) return false;
    const a = at ? at.h + Math.PI : Math.random() * Math.PI * 2, r = row.spawnCells * cellM;
    const hx = at ? at.x : p.x + Math.cos(a) * r, hy = at ? at.y : p.y + Math.sin(a) * r;
    const heading = a + Math.PI, back = { x: Math.cos(a), y: Math.sin(a) };
    const caught = setOf(this.save.caught || []);
    const piece = (kind, id, i, d, extra = {}) => {
      if (caught.has(id)) return;
      entry.creatures.push(WorldGen.makeCreature(kind, hx + back.x * d, hy + back.y * d, id,
        { shiny: false, boss: key, segIndex: i, _heading: heading, _sharedId: true, ...extra }));
    };
    piece('serpent_head', `${key}_head`, -1, 0, { _trail: [{ x: hx, y: hy }, {
      x: hx + back.x * (row.coils + 2) * row.spacingCells * cellM,
      y: hy + back.y * (row.coils + 2) * row.spacingCells * cellM }] });
    for (let i = 0; i < row.coils; i++) {
      piece('serpent_body', `${key}_c${i}`, i, (i + 1) * row.spacingCells * cellM, { _splitShare: 1 / row.coils });
    }
    piece('serpent_tail', `${key}_tail`, row.coils, (row.coils + 1) * row.spacingCells * cellM);
    return true;
  }

  // The tile entry under the player: the serpent's pieces live there, so
  // they load and unload with the fight's ground, not where it began.
  _serpentHostEntry(p = playerWorldM(this)) {
    const t = worldMetersToTile(this, p.x, p.y);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(t.tx, t.ty));
    return entry && (entry.creatures ||= []) ? entry : null;
  }

  // Off the fight's own floor too: a player who walks down a stair leaves the
  // serpent in the surface's cache, which is not the current one.
  _resetSerpent(key, depth = this.depth || 0) {
    const prefix = `${key}_`;
    const entries = new Set([...WorldGen.tileCache.values(), ...(WorldGen.tileCacheFor?.(depth)?.values() || [])]);
    for (const entry of entries) {
      if (entry.creatures) entry.creatures = entry.creatures.filter(c => !String(c.id).startsWith(prefix));
    }
    this.save.caught = (this.save.caught || []).filter(id => !String(id).startsWith(prefix));
  }

  _tickSerpents(now) {
    const live = BossEncounters.list(this.save, now).filter(e => e.kind === 'serpent'
      && (e.record.depth || 0) === (this.depth || 0));
    const t = performance.now(), dt = Math.min(0.1, Math.max(0, (t - (this._serpentT ?? t)) / 1000));
    this._serpentT = t;
    for (const e of live) this._tickSerpent(e.key, dt, t, e.record);
  }

  // ANOTHER PLAYER'S SERPENT (multiplayer.js onBoss): `pose` is its head in
  // this save's world metres ({ x, y, h }), `startedAt` the starter's clock.
  // The first frame adopts the fight (BossEncounters start, own: false) and
  // raises this copy on the pose; every frame refreshes the feed. Refused
  // while this player has a serpent of their own up, or after it is over.
  _adoptSerpent(key, startedAt, depth, pose, now = Date.now()) {
    if ((depth || 0) !== (this.depth || 0)) return false;
    let record = BossEncounters.get(this.save, 'serpent', key);
    if (!record) {
      if (BossEncounters.list(this.save, now).some(e => e.kind === 'serpent')) return false;
      if (now >= startedAt + BossEncounters.KINDS.serpent.durationMs) return false;
      record = BossEncounters.start(this.save, 'serpent', key, { own: false, depth: depth || 0 }, startedAt);
      if (!record) return false;
      persistSave(this.save);
    }
    if (record.own === true || !BossEncounters.active(this.save, 'serpent', key, now)) return false;
    record.heardAt = now;
    record.pose = { x: pose.x, y: pose.y, h: pose.h };
    return true;
  }

  _tickSerpent(key, dt, t, record = BossEncounters.get(this.save, 'serpent', key)) {
    const kind = BossEncounters.KINDS.serpent, cellM = this.cellM;
    const fed = record?.own !== true ? record?.pose : null;
    if (record?.own !== true && !fed) return;
    let pieces = this._serpentPieces(key);
    if (!pieces.head) {
      // A reload or an unloaded tile: re-raise the survivors beside the
      // player (an adopted copy: on the starter's last pose).
      if (!this._spawnSerpent(key, fed)) return;
      pieces = this._serpentPieces(key);
    }
    const caught = setOf(this.save.caught || []);
    const coils = pieces.coils.filter(c => !caught.has(c.id) && !(c._hp <= 0));
    if (!coils.length) { this._serpentDefeated(key, pieces); return; }
    const head = pieces.head, row = EnemyRoster.get('serpent_head');
    const p = playerWorldM(this), leash = row.movement.leashCells * cellM;
    // Keep every piece in the player's tile entry (see _serpentHostEntry).
    const host = this._serpentHostEntry(p);
    if (host) for (const entry of WorldGen.tileCache.values()) {
      if (entry === host || !entry.creatures?.some(c => c.boss === key)) continue;
      host.creatures.push(...entry.creatures.filter(c => c.boss === key));
      entry.creatures = entry.creatures.filter(c => c.boss !== key);
    }
    if (fed) {
      // AN ADOPTED COPY's head goes where the starter's is (a jump past
      // SNAP_CELLS is a reload or a lost stretch of feed: seat it there).
      const gap = Math.hypot(fed.x - head.x, fed.y - head.y);
      if (gap > 3 * cellM) { head.x = fed.x; head.y = fed.y; }
      else { const u = Math.min(1, dt * 8); head.x += (fed.x - head.x) * u; head.y += (fed.y - head.y) * u; }
      head._heading = fed.h;
    } else {
    // THE HEAD: a new goal when it arrives or its time is up — mostly a point
    // on the ring inside the leash, sometimes straight through the player —
    // and always back toward the player once it strays past the leash.
    const far = Math.hypot(head.x - p.x, head.y - p.y) > leash;
    const g = head._goal;
    if (far || !g || t > head._goalUntil || Math.hypot(g.x - head.x, g.y - head.y) < 0.6 * cellM) {
      if (far || Math.random() < kind.throughP) {
        const j = Math.random() * Math.PI * 2;
        head._goal = { x: p.x + Math.cos(j) * 0.4 * cellM, y: p.y + Math.sin(j) * 0.4 * cellM };
      } else {
        const j = Math.random() * Math.PI * 2, r = (kind.ringCells[0] + Math.random() * (kind.ringCells[1] - kind.ringCells[0])) * cellM;
        head._goal = { x: p.x + Math.cos(j) * r, y: p.y + Math.sin(j) * r };
      }
      head._goalUntil = t + kind.goalMs;
    }
    const want = Math.atan2(head._goal.y - head.y, head._goal.x - head.x);
    let turn = want - head._heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const maxTurn = kind.turnRadPerS * dt;
    head._heading += Math.max(-maxTurn, Math.min(maxTurn, turn));
    const step = row.movement.speedMetersPerSecond * dt * Combat.paceMul(head);
    head.x += Math.cos(head._heading) * step;
    head.y += Math.sin(head._heading) * step;
    }
    // THE TRAIL the body follows: the head's own path, newest first, sampled
    // by distance and trimmed to the chain's length.
    const trail = head._trail;
    if (Math.hypot(head.x - trail[0].x, head.y - trail[0].y) >= 0.15 * cellM) trail.unshift({ x: head.x, y: head.y });
    else { trail[0].x = head.x; trail[0].y = head.y; }
    const sample = (d) => {
      let prev = trail[0];
      for (let i = 1; i < trail.length; i++) {
        const cur = trail[i], len = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        if (d <= len) { const u = len ? d / len : 0; return { x: prev.x + (cur.x - prev.x) * u, y: prev.y + (cur.y - prev.y) * u }; }
        d -= len; prev = cur;
      }
      return { x: prev.x, y: prev.y };
    };
    const spacing = kind.spacingCells * cellM, chain = [...coils, pieces.tail].filter(Boolean);
    chain.forEach((c, k) => {
      const d = (k + 1) * spacing, at = sample(d), ahead = sample(Math.max(0, d - 0.2 * cellM));
      c.x = at.x; c.y = at.y;
      c._heading = Math.atan2(ahead.y - at.y, ahead.x - at.x);
    });
    const need = (chain.length + 2) * spacing;
    for (let i = 1, total = 0; i < trail.length; i++) {
      total += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
      if (total >= need) { trail.length = Math.max(2, i + 1); break; }
    }
    // THE BITE: each coil on the player, once a damageIntervalSeconds.
    if (Combat.playerDowned(this.save.energy) || this._storyPause) return;
    const reach = kind.touchCells * cellM, coil = EnemyRoster.get('serpent_body');
    for (const c of coils) {
      if (Math.hypot(c.x - p.x, c.y - p.y) > reach || t < (c._touchNextT || 0)) continue;
      c._touchNextT = t + coil.damageIntervalSeconds * 1000;
      foeBlowLands(this, c, Combat.meleeBlow(c, coil.dmg));
    }
  }

  // Only the head and tail tip are left: the serpent dies. The starter's idol
  // is spent, the record goes, and a hoard is left where the head fell — one
  // for every player who saw it die, in their own save.
  _serpentDefeated(key, pieces) {
    const head = pieces.head, own = BossEncounters.get(this.save, 'serpent', key)?.own === true;
    this._resetSerpent(key);
    delete BossEncounters.store(this.save, 'serpent')?.[key];
    if (own) Inventory.remove(this.save, 'serpent_idol', 1);
    const id = `${key}_hoard`;
    (this.save.bossChests ||= {})[id] = { x: head.x, y: head.y, depth: this.depth || 0 };
    this._ensureBossChests();
    persistSave(this.save);
    this.buildInventoryDOM?.();
    this.flashAtPlayer('The serpent falls. Its hoard is yours.');
  }

  // Seat every unopened boss chest of this floor into its loaded tile; an
  // opened one's record goes.
  _ensureBossChests() {
    const chests = this.save.bossChests;
    if (!chests) return;
    const opened = setOf(this.save.opened || []);
    for (const [id, rec] of Object.entries(chests)) {
      if (opened.has(id)) { delete chests[id]; continue; }
      if ((rec.depth || 0) !== (this.depth || 0)) continue;
      const tile = worldMetersToTile(this, rec.x, rec.y);
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tile.tx, tile.ty));
      if (!entry || entry.objects?.some(o => o.id === id)) continue;
      (entry.objects ||= []).push({ kind: 'chest', id, x: rec.x, y: rec.y, name: 'Serpent hoard',
        bossChest: true, chestTopUp: true, tierSeed: BOSS_CHEST_TIER, _synthetic: true, playerOwned: true });
    }
  }
}
