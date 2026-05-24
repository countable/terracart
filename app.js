// terracart prototype — gameplay layer on top of MVT-driven world.
// - Mobile-sized Phaser canvas (390x844). 11x11 viewport of 5m cells.
// - Real GPS (Geolocation API) if available + permitted; WASD fallback.
// - Tap player to lock/unlock GPS snap.
// - Random creatures spawn in grass/farmland cells (seeded per tile).
// - Tap creature → catch (added to farm). Tap ground with seed selected → plant.
// - Inventory bottom bar shows starter items; tap to select.

const START_LON = -119.47870;
const START_LAT = 49.85438;
const VIEW_CELLS = 11;
const CELL_PX = 32;
const WALK_M_S = 1.4;
const W = 390, H = 844;

const COLORS = {
  0: 0x5fa84a,  // grass
  1: 0x2e6a2e,  // forest
  2: 0xd9c98a,  // sand
  3: 0x3a78c2,  // water
  4: 0xc7a85b,  // farmland
  5: 0x8a8472,  // residential
  6: 0x7fbf63,  // park
  7: 0x444444,  // road
  8: 0x9a7a4a,  // path
  9: 0x8b4d3a,  // building
  10: 0x7d736b, // rock
};
const PLANTABLE = new Set([0, 4, 6]); // grass, farmland, park

const SAVE_KEY = 'terracart.save.v1';
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
  catch { return {}; }
}
function persistSave(s) { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); }

const ITEMS = [
  { id: 'carrot_seed', name: 'Carrot Seed', kind: 'seed', grows: 'carrot', icon: '🥕' },
  { id: 'tomato_seed', name: 'Tomato Seed', kind: 'seed', grows: 'tomato', icon: '🍅' },
  { id: 'corn_seed',   name: 'Corn Seed',   kind: 'seed', grows: 'corn',   icon: '🌽' },
  { id: 'net',         name: 'Net',         kind: 'tool', icon: '🪤' },
  { id: 'feed',        name: 'Feed',        kind: 'tool', icon: '🌾' },
];

class MapScene extends Phaser.Scene {
  constructor() { super('map'); }

  preload() {
    this.load.spritesheet('idle', 'Character/Idle.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('walk', 'Character/Walk.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('trees','Objects/Maple Tree.png', { frameWidth: 32, frameHeight: 48 });
    this.load.image('house', 'Objects/House.png');
    this.load.spritesheet('chicken', 'Farm Animals/Chicken Red.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('crops',   'Objects/Spring Crops.png',     { frameWidth: 16, frameHeight: 16 });
  }

  create() {
    this.save = Object.assign(
      { caught: [], planted: [], inv: ['carrot_seed','tomato_seed','corn_seed','net','feed',null], selSlot: 0 },
      loadSave()
    );

    this.cameras.main.setBackgroundColor('#222');
    this.viewCenterX = W / 2;
    this.viewCenterY = H / 2 - 40;            // raise to leave room for inventory bar
    this.viewLeft = this.viewCenterX - (VIEW_CELLS / 2) * CELL_PX;
    this.viewTop  = this.viewCenterY - (VIEW_CELLS / 2) * CELL_PX;
    this.viewSize = VIEW_CELLS * CELL_PX;

    const origin = WorldGen.lonLatToWorldPx(START_LON, START_LAT, WorldGen.Z);
    this.originPx = origin;
    this.mPerPx = WorldGen.metersPerPixel(START_LAT, WorldGen.Z);
    this.cellM = WorldGen.CELL_M;
    this.cellsPerTile = WorldGen.cellsPerEdgeForLat(START_LAT);
    this.tileEdgeM = WorldGen.tileEdgeMeters(START_LAT);
    this.startWorldM = {
      x: this.originPx.x * this.mPerPx,
      y: this.originPx.y * this.mPerPx,
    };

    this.playerM = { x: 0, y: 0 };
    this.gpsM = null;
    this.gpsLocked = false;
    this.gpsAvailable = false;

    // Layers
    this.cellGfx = this.add.graphics();
    this.plantedContainer = this.add.container(0, 0);
    this.objectsContainer = this.add.container(0, 0);
    this.creaturesContainer = this.add.container(0, 0);

    this.objectPool = [];
    this.plantedPool = [];
    this.creaturePool = [];

    // Viewport mask clips everything inside the 11x11 area.
    const maskG = this.make.graphics({ x: 0, y: 0, add: false });
    maskG.fillStyle(0xffffff);
    maskG.fillRect(this.viewLeft, this.viewTop, this.viewSize, this.viewSize);
    const mask = maskG.createGeometryMask();
    this.cellGfx.setMask(mask);
    this.plantedContainer.setMask(mask);
    this.objectsContainer.setMask(mask);
    this.creaturesContainer.setMask(mask);

    const frame = this.add.graphics();
    frame.lineStyle(2, 0x000000, 0.6)
      .strokeRect(this.viewLeft - 1, this.viewTop - 1, this.viewSize + 2, this.viewSize + 2);

    // Animations
    this.anims.create({ key: 'idle-anim', frames: this.anims.generateFrameNumbers('idle', { start: 0, end: 3 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: 'walk-anim', frames: this.anims.generateFrameNumbers('walk', { start: 0, end: 5 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'chicken-idle', frames: this.anims.generateFrameNumbers('chicken', { start: 0, end: 1 }), frameRate: 3, repeat: -1 });

    // Player sprite
    this.player = this.add.sprite(this.viewCenterX, this.viewCenterY, 'idle', 0)
      .setScale(1.5)
      .play('idle-anim')
      .setMask(mask)
      .setInteractive({ useHandCursor: true });
    this.player.on('pointerdown', (pointer, lx, ly, event) => {
      event.stopPropagation();
      this.toggleGpsLock();
    });

    // Keyboard
    this.keys = this.input.keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      UP: Phaser.Input.Keyboard.KeyCodes.UP,
      DOWN: Phaser.Input.Keyboard.KeyCodes.DOWN,
      LEFT: Phaser.Input.Keyboard.KeyCodes.LEFT,
      RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    });

    // World tap (player handler runs first and stops propagation)
    this.input.on('pointerdown', (p) => this.handleWorldTap(p.x, p.y));

    // HUD + banner + inventory
    this.hud = document.getElementById('hud');
    this.banner = document.getElementById('banner');
    this.buildInventoryDOM();

    // Boot tile load
    this.ensureTilesAround().catch(e => console.error(e));

    // Network status
    window.addEventListener('offline', () => this.showBanner(true));
    window.addEventListener('online', () => this.showBanner(false));

    // GPS watch (best-effort)
    this.startGps();
  }

  // === GPS ===
  startGps() {
    if (!navigator.geolocation) return;
    this.gpsAvailable = true;
    try {
      this.gpsWatchId = navigator.geolocation.watchPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          const dxM = (longitude - START_LON) * 111320 * Math.cos(START_LAT * Math.PI / 180);
          const dyM = -(latitude - START_LAT) * 111320;
          this.gpsM = { x: dxM, y: dyM };
          if (!this.gpsLocked) this.playerM = { ...this.gpsM };
        },
        err => { console.warn('GPS error', err.message); this.gpsAvailable = false; },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    } catch { this.gpsAvailable = false; }
  }
  toggleGpsLock() {
    this.gpsLocked = !this.gpsLocked;
    if (!this.gpsLocked && this.gpsM) this.playerM = { ...this.gpsM };
    this.player.setTint(this.gpsLocked ? 0xffe080 : 0xffffff);
    this.flash(this.gpsLocked ? 'GPS locked' : 'GPS unlocked', this.viewCenterX, this.viewCenterY - 30);
  }

  // === Tiles ===
  showBanner(on) { this.banner.style.display = on ? 'block' : 'none'; }

  playerToWorldCell() {
    const wx = this.originPx.x + this.playerM.x / this.mPerPx;
    const wy = this.originPx.y + this.playerM.y / this.mPerPx;
    const tilePx = 256;
    const tx = Math.floor(wx / tilePx);
    const ty = Math.floor(wy / tilePx);
    const cellPxSize = tilePx / this.cellsPerTile;
    const cx = (wx - tx * tilePx) / cellPxSize;
    const cy = (wy - ty * tilePx) / cellPxSize;
    return { tx, ty, cx, cy };
  }

  async ensureTilesAround() {
    const cell = this.playerToWorldCell();
    const needed = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      needed.add(`${cell.tx + dx}/${cell.ty + dy}`);
    }
    let anyFailed = false;
    for (const k of needed) {
      const [tx, ty] = k.split('/').map(Number);
      try {
        const entry = await WorldGen.loadTile(tx, ty, START_LAT);
        if (entry.status === 'loading') await entry.promise;
        if (!entry.creatures) this.spawnInTile(entry, tx, ty);
      } catch (e) {
        anyFailed = true;
        console.warn('tile fetch failed', k, e.message);
      }
    }
    this.showBanner(anyFailed && !navigator.onLine);
  }

  // === Spawns ===
  spawnInTile(entry, tx, ty) {
    const rng = WorldGen.makeRng(tx * 0x1f1f1f1f ^ ty * 0x12345);
    const creatures = [];
    const N = entry.cellsPerEdge;
    const want = 4 + Math.floor(rng() * 6);
    for (let i = 0; i < want; i++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        const t = entry.grid[cy * N + cx];
        if (t === 0 || t === 4 || t === 6) {
          const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
          const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
          const id = `${tx}_${ty}_${i}`;
          if (this.save.caught.includes(id)) break;
          creatures.push({ x: wmx, y: wmy, kind: 'chicken', id });
          break;
        }
      }
    }
    entry.creatures = creatures;
  }

  // === Tick ===
  update(_, dtMs) {
    const dt = dtMs / 1000;
    let vx = 0, vy = 0;
    const k = this.keys;
    if (k.A.isDown || k.LEFT.isDown) vx -= 1;
    if (k.D.isDown || k.RIGHT.isDown) vx += 1;
    if (k.W.isDown || k.UP.isDown) vy -= 1;
    if (k.S.isDown || k.DOWN.isDown) vy += 1;
    const moving = vx || vy;
    if (moving && (this.gpsLocked || !this.gpsM)) {
      const n = Math.hypot(vx, vy);
      this.playerM.x += (vx / n) * WALK_M_S * dt;
      this.playerM.y += (vy / n) * WALK_M_S * dt;
      if (this.player.anims.currentAnim?.key !== 'walk-anim') this.player.play('walk-anim');
      if (vx < 0) this.player.setFlipX(true);
      else if (vx > 0) this.player.setFlipX(false);
    } else if (this.player.anims.currentAnim?.key !== 'idle-anim') {
      this.player.play('idle-anim');
    }

    if (!this._lastCheckM ||
        Math.hypot(this.playerM.x - this._lastCheckM.x, this.playerM.y - this._lastCheckM.y) > 20) {
      this._lastCheckM = { ...this.playerM };
      this.ensureTilesAround().catch(() => {});
    }

    this.drawCells();
    this.drawObjects();
    this.updateHUD();
  }

  // === Drawing ===
  drawCells() {
    const g = this.cellGfx;
    g.clear();
    const half = (VIEW_CELLS - 1) / 2;
    const pc = this.playerToWorldCell();
    const fracX = pc.cx - Math.floor(pc.cx);
    const fracY = pc.cy - Math.floor(pc.cy);
    for (let row = 0; row < VIEW_CELLS; row++) {
      for (let col = 0; col < VIEW_CELLS; col++) {
        const ox = col - half;
        const oy = row - half;
        const wcx = pc.cx + ox + pc.tx * this.cellsPerTile;
        const wcy = pc.cy + oy + pc.ty * this.cellsPerTile;
        const tx = Math.floor(wcx / this.cellsPerTile);
        const ty = Math.floor(wcy / this.cellsPerTile);
        const ix = Math.floor(wcx - tx * this.cellsPerTile);
        const iy = Math.floor(wcy - ty * this.cellsPerTile);
        const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
        let type = 0;
        if (entry && entry.grid) type = entry.grid[iy * this.cellsPerTile + ix] || 0;
        const color = COLORS[type] ?? 0x5fa84a;
        const sx = this.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2;
        const sy = this.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2;
        g.fillStyle(color, 1);
        g.fillRect(Math.round(sx), Math.round(sy), CELL_PX, CELL_PX);
      }
    }
    g.lineStyle(1, 0x000000, 0.08);
    for (let i = 0; i <= VIEW_CELLS; i++) {
      const x = this.viewLeft + i * CELL_PX;
      const y = this.viewTop + i * CELL_PX;
      g.lineBetween(x, this.viewTop, x, this.viewTop + this.viewSize);
      g.lineBetween(this.viewLeft, y, this.viewLeft + this.viewSize, y);
    }
  }

  worldMetersToScreen(wmx, wmy) {
    const pWorldX = this.startWorldM.x + this.playerM.x;
    const pWorldY = this.startWorldM.y + this.playerM.y;
    return {
      x: this.viewCenterX + ((wmx - pWorldX) / this.cellM) * CELL_PX,
      y: this.viewCenterY + ((wmy - pWorldY) / this.cellM) * CELL_PX,
    };
  }
  screenToWorldMeters(sx, sy) {
    const dx = (sx - this.viewCenterX) / CELL_PX * this.cellM;
    const dy = (sy - this.viewCenterY) / CELL_PX * this.cellM;
    return {
      x: this.startWorldM.x + this.playerM.x + dx,
      y: this.startWorldM.y + this.playerM.y + dy,
    };
  }

  drawObjects() {
    const halfM = (VIEW_CELLS / 2 + 1) * this.cellM;
    const pWorldX = this.startWorldM.x + this.playerM.x;
    const pWorldY = this.startWorldM.y + this.playerM.y;
    const objList = [], creatureList = [], plantedList = [];
    for (const entry of WorldGen.tileCache.values()) {
      if (entry.objects) {
        for (const o of entry.objects) {
          const dx = o.x - pWorldX, dy = o.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          objList.push({ o, dx, dy });
        }
      }
      if (entry.creatures) {
        for (const c of entry.creatures) {
          if (this.save.caught.includes(c.id)) continue;
          const dx = c.x - pWorldX, dy = c.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          creatureList.push({ c, dx, dy });
        }
      }
    }
    for (const p of this.save.planted) {
      const dx = p.x - pWorldX, dy = p.y - pWorldY;
      if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
      plantedList.push({ p, dx, dy });
    }

    objList.sort((a, b) => a.dy - b.dy);
    this.renderPool(this.objectPool, this.objectsContainer, objList, (s, item) => {
      const { o, dx, dy } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      if (o.kind === 'house') {
        if (s.texture.key !== 'house') s.setTexture('house');
        s.setOrigin(0.5, 0.85).setScale(0.5).setPosition(Math.round(sx), Math.round(sy));
      } else if (o.kind === 'tree') {
        if (s.texture.key !== 'trees') s.setTexture('trees');
        s.setFrame(Phaser.Math.Clamp(o.variant || 2, 0, 4));
        s.setOrigin(0.5, 0.95).setScale(0.85).setPosition(Math.round(sx), Math.round(sy));
      }
    });

    this.renderPool(this.plantedPool, this.plantedContainer, plantedList, (s, item) => {
      const { p, dx, dy } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      const elapsedMs = Date.now() - p.t;
      const stages = 3;
      const stageMs = 20 * 1000;
      const stage = Math.min(stages - 1, Math.floor(elapsedMs / stageMs));
      const cropRow = ({ carrot: 0, tomato: 1, corn: 2 })[p.crop] ?? 0;
      const frame = cropRow * 14 + stage;
      if (s.texture.key !== 'crops') s.setTexture('crops');
      s.setFrame(frame);
      s.setOrigin(0.5, 0.7).setScale(1.6).setPosition(Math.round(sx), Math.round(sy));
    });

    this.renderPool(this.creaturePool, this.creaturesContainer, creatureList, (s, item) => {
      const { c, dx, dy } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      if (s.texture.key !== 'chicken') {
        s.setTexture('chicken');
        s.play('chicken-idle');
      }
      s.setOrigin(0.5, 0.9).setScale(1).setPosition(Math.round(sx), Math.round(sy));
    });
  }

  renderPool(pool, container, list, configure) {
    let i = 0;
    for (const item of list) {
      let s = pool[i];
      if (!s) {
        s = this.add.sprite(0, 0, 'idle', 0);
        container.add(s);
        pool.push(s);
      }
      s.setVisible(true);
      configure(s, item);
      i++;
    }
    for (; i < pool.length; i++) pool[i].setVisible(false);
  }

  // === Interaction ===
  handleWorldTap(sx, sy) {
    if (sx < this.viewLeft || sx > this.viewLeft + this.viewSize ||
        sy < this.viewTop  || sy > this.viewTop  + this.viewSize) return;

    const wm = this.screenToWorldMeters(sx, sy);
    const pWorldX = this.startWorldM.x + this.playerM.x;
    const pWorldY = this.startWorldM.y + this.playerM.y;

    // 1) Catch a creature within 4m
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.creatures) continue;
      for (const c of entry.creatures) {
        if (this.save.caught.includes(c.id)) continue;
        if (Math.hypot(c.x - wm.x, c.y - wm.y) < 4) {
          this.catchCreature(c, sx, sy);
          return;
        }
      }
    }
    // 2) Harvest planted crop
    for (let idx = 0; idx < this.save.planted.length; idx++) {
      const p = this.save.planted[idx];
      if (Math.hypot(p.x - wm.x, p.y - wm.y) < 4) {
        const elapsedMs = Date.now() - p.t;
        if (elapsedMs >= 40 * 1000) {
          this.save.planted.splice(idx, 1);
          this.flash(`+1 ${p.crop}`, sx, sy);
          persistSave(this.save);
        } else {
          const s = Math.ceil((40 * 1000 - elapsedMs) / 1000);
          this.flash(`growing (${s}s)`, sx, sy);
        }
        return;
      }
    }
    // 3) Plant seed if seed selected and within 15m
    const sel = this.save.inv[this.save.selSlot];
    const item = ITEMS.find(it => it.id === sel);
    if (item && item.kind === 'seed') {
      if (Math.hypot(wm.x - pWorldX, wm.y - pWorldY) > 15) { this.flash('too far', sx, sy); return; }
      const cell = this.cellAt(wm.x, wm.y);
      if (!PLANTABLE.has(cell.type)) { this.flash("can't plant here", sx, sy); return; }
      const cwmx = Math.floor(wm.x / this.cellM) * this.cellM + this.cellM / 2;
      const cwmy = Math.floor(wm.y / this.cellM) * this.cellM + this.cellM / 2;
      if (this.save.planted.some(p => Math.abs(p.x - cwmx) < 0.1 && Math.abs(p.y - cwmy) < 0.1)) {
        this.flash('already planted', sx, sy); return;
      }
      this.save.planted.push({ x: cwmx, y: cwmy, crop: item.grows, t: Date.now() });
      persistSave(this.save);
      this.flash(`planted ${item.grows}`, sx, sy);
    } else {
      this.flash(item ? `${item.name} —` : '·', sx, sy);
    }
  }
  cellAt(wmx, wmy) {
    const wx = this.originPx.x + (wmx - this.startWorldM.x) / this.mPerPx;
    const wy = this.originPx.y + (wmy - this.startWorldM.y) / this.mPerPx;
    const tx = Math.floor(wx / 256), ty = Math.floor(wy / 256);
    const ix = Math.floor((wx - tx * 256) / (256 / this.cellsPerTile));
    const iy = Math.floor((wy - ty * 256) / (256 / this.cellsPerTile));
    const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
    return { tx, ty, ix, iy, type: entry && entry.grid ? entry.grid[iy * this.cellsPerTile + ix] : 0 };
  }
  catchCreature(c, sx, sy) {
    this.save.caught.push(c.id);
    persistSave(this.save);
    this.flash(`caught ${c.kind}!`, sx, sy);
  }

  flash(text, x, y) {
    const t = this.add.text(x, y, text, {
      font: '12px monospace', color: '#ffffff', backgroundColor: '#000a',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1).setDepth(100);
    this.tweens.add({
      targets: t, y: y - 30, alpha: 0, duration: 900,
      onComplete: () => t.destroy(),
    });
  }

  updateHUD() {
    const pc = this.playerToWorldCell();
    const lat = START_LAT + (-this.playerM.y) / 111320;
    const lon = START_LON + this.playerM.x / (111320 * Math.cos(START_LAT * Math.PI / 180));
    const loaded = [...WorldGen.tileCache.values()].filter(t => t.status === 'ready').length;
    const gps = this.gpsAvailable ? (this.gpsLocked ? 'LOCKED' : (this.gpsM ? 'live' : 'waiting')) : 'wasd';
    this.hud.textContent =
      `${lat.toFixed(5)}, ${lon.toFixed(5)}   gps:${gps}\n` +
      `tile ${pc.tx}/${pc.ty}   tiles:${loaded}   caught:${this.save.caught.length}   plots:${this.save.planted.length}`;
  }

  buildInventoryDOM() {
    const game = document.getElementById('game');
    let bar = document.getElementById('inv');
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.id = 'inv';
    bar.style.cssText = 'position:absolute;bottom:48px;left:0;right:0;display:flex;justify-content:center;gap:4px;padding:6px;z-index:6;pointer-events:auto;';
    for (let i = 0; i < this.save.inv.length; i++) {
      const slot = document.createElement('button');
      const id = this.save.inv[i];
      const item = ITEMS.find(it => it.id === id);
      slot.dataset.slot = i;
      slot.style.cssText = 'width:44px;height:44px;background:#222a;border:2px solid #555;border-radius:6px;font-size:22px;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;';
      slot.textContent = item ? item.icon : '·';
      slot.title = item ? item.name : 'empty';
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.save.selSlot = i; persistSave(this.save);
        this.refreshInventoryHighlight();
      });
      bar.appendChild(slot);
    }
    game.appendChild(bar);
    this.refreshInventoryHighlight();
  }
  refreshInventoryHighlight() {
    const bar = document.getElementById('inv');
    if (!bar) return;
    [...bar.children].forEach((el, i) => {
      el.style.borderColor = (i === this.save.selSlot) ? '#ffd866' : '#555';
      el.style.background  = (i === this.save.selSlot) ? '#553a' : '#222a';
    });
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W, height: H,
  backgroundColor: '#000',
  pixelArt: true,
  scene: [MapScene],
  scale: { mode: Phaser.Scale.NONE },
});
