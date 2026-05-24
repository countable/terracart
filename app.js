// map-game prototype boot.
// - Mobile-sized Phaser canvas (390x844), grass background.
// - Virtual GPS at 3586 Athalmer Rd, Kelowna BC.
// - WASD moves player at walking speed; camera = 11x11 game cells, 5m each.
// - Fetches OpenFreeMap z14 vector tiles, rasterizes to a 5m grid, draws around player.

const START_LON = -119.47870;
const START_LAT = 49.85438;
const VIEW_CELLS = 11;
const CELL_PX = 32;             // on-screen size of one 5m cell
const WALK_M_S = 1.4;           // ~5 km/h
const W = 390, H = 844;

// Terrain class -> color (placeholder until tileset frame mapping)
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

class MapScene extends Phaser.Scene {
  constructor() { super('map'); }

  preload() {
    this.load.spritesheet('idle', 'Character/Idle.png',
      { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('walk', 'Character/Walk.png',
      { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('trees', 'Objects/Maple Tree.png',
      { frameWidth: 32, frameHeight: 48 });
    this.load.image('house', 'Objects/House.png');
  }

  create() {
    // Camera & origin
    this.cameras.main.setBackgroundColor('#222');
    this.viewCenterX = W / 2;
    this.viewCenterY = H / 2;

    // World origin = start lat/lon at z14 mercator pixels.
    const origin = WorldGen.lonLatToWorldPx(START_LON, START_LAT, WorldGen.Z);
    this.originPx = origin;
    this.mPerPx = WorldGen.metersPerPixel(START_LAT, WorldGen.Z);
    this.cellM = WorldGen.CELL_M;
    this.cellsPerTile = WorldGen.cellsPerEdgeForLat(START_LAT);
    this.tileEdgeM = this.cellsPerTile * this.cellM;

    // ABSOLUTE world meters of the START location (anchored at NW corner of z14 tile(0,0)).
    this.startWorldM = {
      x: this.originPx.x * this.mPerPx,
      y: this.originPx.y * this.mPerPx,
    };

    // Player position in METERS relative to start (east, south positive).
    this.playerM = { x: 0, y: 0 };

    // Pool of object sprites
    this.objectSprites = [];
    this.objectsContainer = this.add.container(0, 0);

    // Tile grid container (one Rectangle per visible cell)
    this.cellGfx = this.add.graphics();
    this.objectsLayer = this.add.container(0, 0);

    // Player sprite (centered)
    this.anims.create({
      key: 'idle-anim',
      frames: this.anims.generateFrameNumbers('idle', { start: 0, end: 3 }),
      frameRate: 6, repeat: -1,
    });
    this.anims.create({
      key: 'walk-anim',
      frames: this.anims.generateFrameNumbers('walk', { start: 0, end: 5 }),
      frameRate: 10, repeat: -1,
    });
    this.player = this.add.sprite(this.viewCenterX, this.viewCenterY, 'idle', 0)
      .setScale(1.5)
      .play('idle-anim');

    // Input
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

    // HUD
    this.hud = document.getElementById('hud');
    this.banner = document.getElementById('banner');

    // Pre-load tile under player
    this.ensureTilesAround(this.playerM).catch(e => console.error(e));

    // Network online/offline reflects in banner
    window.addEventListener('offline', () => this.showBanner(true));
    window.addEventListener('online', () => this.showBanner(false));
  }

  showBanner(on) {
    this.banner.style.display = on ? 'block' : 'none';
  }

  // Convert player meter offset -> world MVT-tile + sub-tile cell coords.
  playerToWorldCell() {
    // World pixel coords at z14
    const wx = this.originPx.x + this.playerM.x / this.mPerPx;
    const wy = this.originPx.y + this.playerM.y / this.mPerPx;
    const tilePx = 256;
    const tx = Math.floor(wx / tilePx);
    const ty = Math.floor(wy / tilePx);
    // sub-tile cell coords
    const cellPxSize = tilePx / this.cellsPerTile;
    const cx = (wx - tx * tilePx) / cellPxSize;
    const cy = (wy - ty * tilePx) / cellPxSize;
    return { tx, ty, cx, cy };
  }

  async ensureTilesAround(playerM) {
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
      } catch (e) {
        anyFailed = true;
        console.warn('tile fetch failed', k, e.message);
      }
    }
    this.showBanner(anyFailed && !navigator.onLine);
  }

  update(_, dtMs) {
    const dt = dtMs / 1000;
    let vx = 0, vy = 0;
    const k = this.keys;
    if (k.A.isDown || k.LEFT.isDown) vx -= 1;
    if (k.D.isDown || k.RIGHT.isDown) vx += 1;
    if (k.W.isDown || k.UP.isDown) vy -= 1;
    if (k.S.isDown || k.DOWN.isDown) vy += 1;
    const moving = vx || vy;
    if (moving) {
      const n = Math.hypot(vx, vy);
      this.playerM.x += (vx / n) * WALK_M_S * dt;
      this.playerM.y += (vy / n) * WALK_M_S * dt;
      if (this.player.anims.currentAnim?.key !== 'walk-anim') this.player.play('walk-anim');
      if (vx < 0) this.player.setFlipX(true);
      else if (vx > 0) this.player.setFlipX(false);
    } else if (this.player.anims.currentAnim?.key !== 'idle-anim') {
      this.player.play('idle-anim');
    }

    // Lazy-load tiles as we move
    if (!this._lastTileCheck || dtMs > 0 && Math.hypot(this.playerM.x - (this._lastCheckM?.x ?? 0), this.playerM.y - (this._lastCheckM?.y ?? 0)) > 20) {
      this._lastCheckM = { ...this.playerM };
      this.ensureTilesAround(this.playerM).catch(() => {});
    }

    this.drawCells();
    this.drawObjects();
    this.updateHUD();
  }

  drawObjects() {
    // Gather all objects in loaded tiles, cull to a 2x viewport box, sort by Y, render.
    const halfW = (VIEW_CELLS / 2) * this.cellM + 30;
    const halfH = (VIEW_CELLS / 2) * this.cellM + 60;
    const list = [];
    // Player absolute world meters
    const pWorldX = this.startWorldM.x + this.playerM.x;
    const pWorldY = this.startWorldM.y + this.playerM.y;
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.objects) continue;
      for (const o of entry.objects) {
        const dx = o.x - pWorldX, dy = o.y - pWorldY;
        if (Math.abs(dx) > halfW || Math.abs(dy) > halfH) continue;
        list.push({ o, dx, dy });
      }
    }
    list.sort((a, b) => a.dy - b.dy);

    // Reuse pool
    let i = 0;
    for (const { o, dx, dy } of list) {
      let s = this.objectSprites[i];
      if (!s) {
        s = this.add.image(0, 0, 'house');
        this.objectsContainer.add(s);
        this.objectSprites.push(s);
      }
      s.setVisible(true);
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      if (o.kind === 'house') {
        if (s.texture.key !== 'house') s.setTexture('house');
        s.setOrigin(0.5, 0.85);
        s.setScale(0.55);
        s.setPosition(Math.round(sx), Math.round(sy));
      } else if (o.kind === 'tree') {
        if (s.texture.key !== 'trees') s.setTexture('trees');
        s.setFrame(Phaser.Math.Clamp(o.variant || 2, 0, 4));
        s.setOrigin(0.5, 0.95);
        s.setScale(0.85);
        s.setPosition(Math.round(sx), Math.round(sy));
      }
      i++;
    }
    for (; i < this.objectSprites.length; i++) this.objectSprites[i].setVisible(false);
  }

  drawCells() {
    const g = this.cellGfx;
    g.clear();
    const half = (VIEW_CELLS - 1) / 2;
    // player world-cell (fractional)
    const pc = this.playerToWorldCell();
    // For each viewport cell, find its absolute world cell and its source tile
    for (let row = 0; row < VIEW_CELLS; row++) {
      for (let col = 0; col < VIEW_CELLS; col++) {
        // viewport cell offset from center (in cells)
        const ox = col - half;
        const oy = row - half;
        // absolute world cell coords (continuous)
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

        // screen position: player at (W/2, H/2); offset by (ox-frac, oy-frac) * CELL_PX
        const fracX = pc.cx - Math.floor(pc.cx);
        const fracY = pc.cy - Math.floor(pc.cy);
        const sx = this.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2;
        const sy = this.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2;
        g.fillStyle(color, 1);
        g.fillRect(Math.round(sx), Math.round(sy), CELL_PX, CELL_PX);
      }
    }
    // grid lines (subtle)
    g.lineStyle(1, 0x000000, 0.08);
    for (let i = 0; i <= VIEW_CELLS; i++) {
      const x = this.viewCenterX - (VIEW_CELLS / 2) * CELL_PX + i * CELL_PX;
      const y = this.viewCenterY - (VIEW_CELLS / 2) * CELL_PX + i * CELL_PX;
      g.lineBetween(x, this.viewCenterY - (VIEW_CELLS / 2) * CELL_PX,
                    x, this.viewCenterY + (VIEW_CELLS / 2) * CELL_PX);
      g.lineBetween(this.viewCenterX - (VIEW_CELLS / 2) * CELL_PX, y,
                    this.viewCenterX + (VIEW_CELLS / 2) * CELL_PX, y);
    }
  }

  updateHUD() {
    const pc = this.playerToWorldCell();
    const lat = START_LAT + (-this.playerM.y) / 111320;
    const lon = START_LON + this.playerM.x / (111320 * Math.cos(START_LAT * Math.PI / 180));
    const loaded = [...WorldGen.tileCache.values()].filter(t => t.status === 'ready').length;
    this.hud.textContent =
      `lat ${lat.toFixed(5)}  lon ${lon.toFixed(5)}\n` +
      `player m=(${this.playerM.x.toFixed(1)}, ${this.playerM.y.toFixed(1)})  ` +
      `tile z14/${pc.tx}/${pc.ty}  cell ${pc.cx.toFixed(1)},${pc.cy.toFixed(1)}\n` +
      `tiles loaded: ${loaded}  cells/tile: ${this.cellsPerTile}`;
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
