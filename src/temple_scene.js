// The upper temple is an isolated scene: surface simulation is paused until exit.
(function (root) {
  'use strict';
  const KEY = 'grove-temple';
  const TITLES = { blocks: 'Chromatic stones', tower: 'The three ascents', path: 'The hidden way', duel: 'The grove champion', ballista: 'Guard the heart' };
  const HELP = {
    blocks: 'Push each stone onto its matching pressure plate. Tap a neighboring cell or use arrow keys. Retry resets a trapped stone.',
    tower: 'Reach the golden ladder three times. Walls and monsters change each ascent. Your weapon attacks adjacent guards automatically.',
    path: 'Memorize the blue cells, then follow that exact route from A to B. The route disappears before you can move.',
    duel: 'Defeat the elite grove champion. Move next to it to attack automatically; step away to evade.',
    ballista: 'Protect the center from wall drones. Frost arrows fire automatically along your compass heading. Without a compass, tap to aim or use Q / E.',
  };
  const COLORS = { red: 0xe36c78, blue: 0x619ee8, green: 0x7bc896 };

  function enter(parent, temple, plan) {
    if (!root.Phaser || !root.TemplePuzzles || parent._templeSceneActive) return false;
    const manager = parent.scene.manager;
    if (manager.getScene(KEY)) manager.remove(KEY);
    const trial = new GroveScene(parent, temple, plan);
    parent._templeSceneActive = true;
    parent.scene.pause();
    try { manager.add(KEY, trial, true); }
    catch (error) { parent._templeSceneActive = false; parent.scene.resume(); throw error; }
    return true;
  }

  // Defined lazily so loading this module remains safe in the Node test harness.
  function GroveScene(parent, temple, plan) {
    const scene = new root.Phaser.Scene({ key: KEY });
    scene.source = parent;
    scene.temple = temple;
    scene.plan = plan;
    scene.depth = -1;
    scene.cellM = plan.cellM;
    scene.nexusOrigin = { x: plan.x, y: plan.y };
    scene.create = create;
    scene.update = update;
    scene.restartTrial = restartTrial;
    scene.accept = accept;
    scene.draw = draw;
    scene.point = point;
    scene.leave = leave;
    return scene;
  }
  function create() {
    if (typeof applyRenderScale === 'function') applyRenderScale(this.cameras.main);
    this.cameras.main.setBackgroundColor('#142529');
    this.gfx = this.add.graphics();
    this.labels = this.add.container();
    this.labelPool = [];
    this.actorPool = [];
    this.title = this.add.text(0, 0, '', { fontFamily: FONT_UI_STACK, fontSize: '25px', color: '#fff8df', align: 'center' }).setOrigin(.5, 0);
    this.help = this.add.text(0, 0, HELP[this.plan.kind], { fontFamily: FONT_UI_STACK, fontSize: '13px', color: '#c8d7d9', align: 'center', lineSpacing: 4 }).setOrigin(.5, 0);
    this.statusText = this.add.text(0, 0, '', { fontFamily: FONT_UI_STACK, fontSize: '14px', color: '#f6e1a7', align: 'center', lineSpacing: 5 }).setOrigin(.5, 0);
    const button = (label, callback) => this.add.text(0, 0, label, { fontFamily: FONT_UI_STACK, fontSize: '15px', color: '#ffffff', backgroundColor: '#345454', padding: { x: 18, y: 12 } })
      .setOrigin(.5).setInteractive({ useHandCursor: true }).on('pointerdown', (_p, _x, _y, event) => { event?.stopPropagation(); callback(); });
    this.exitButton = button('Return to ground', () => this.leave());
    this.retryButton = button('Retry trial', () => this.restartTrial());
    this.aim = { ...(this.source.facing || { x: 0, y: -1 }) };
    this.keys = this.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT,Q,E,ESC');
    this.input.on('pointerdown', pointer => {
      const at = this.source._gamePt ? this.source._gamePt(pointer) : pointer;
      if (at.y > this.visibleBottom - 85 || !this.state || this.state.status !== 'playing') return;
      const a = (at.x - this.ox) / this.tw, b = (at.y - this.oy) / this.th;
      const x = Math.round((a + b) / 2), y = Math.round((b - a) / 2);
      if (this.state.kind === 'ballista') {
        if (this.source.compassDeg == null) this.aim = { x: x - this.state.player.x, y: y - this.state.player.y };
      } else this.accept(root.TemplePuzzles.move(this.state, x - this.state.player.x, y - this.state.player.y));
    });
    this.hadModalClass = document.body.classList.contains('modal-open');
    document.body.classList.add('modal-open');
    const onSourceShutdown = () => this.scene.stop();
    this.source.events.once('shutdown', onSourceShutdown);
    this.events.once('shutdown', () => {
      this.source.events.off('shutdown', onSourceShutdown);
      this.source._templeSceneActive = false;
      if (!this.hadModalClass) document.body.classList.remove('modal-open');
      this.source._syncModalGate?.();
      if (this.source.scene.isPaused()) this.source.scene.resume();
      this.source.updateHUD?.();
    });
    this.restartTrial();
  }
  function restartTrial() {
    if (this.rewarded) return;
    const combat = root.Combat, save = this.source.save;
    const enemyKind = this.plan.enemyKind || 'cave_slime';
    const elite = this.plan.kind === 'duel' && !this.plan.enemyKind;
    const foe = combat.monster(enemyKind);
    this.state = root.TemplePuzzles.create(this.plan, {
      playerHp: Math.max(1, save.energy ?? 100),
      enemyHp: combat.maxHp({ kind: enemyKind, shiny: elite }),
      enemyDamage: combat.playerDamage(foe.dmg * (elite ? combat.ELITE_MUL : 1), save.armor, 1, save.mode),
      enemyStepSeconds: this.plan.enemyKind ? foe.damageIntervalSeconds : 1,
      shotSpeed: combat.SHOT.bow.speedCps, shotRange: combat.SHOT.bow.rangeCells,
      shotInterval: this.plan.kind === 'ballista' ? combat.fireIntervalMs('bow') / 1000 : .01,
    });
    this.attackClock = 0;
    this.moveClock = 0;
    this.message = '';
    this.draw();
  }
  function accept(next) {
    if (!next) return;
    this.state = next;
    this.playerM = { x: this.plan.x + (next.player.x + .5) * this.cellM,
      y: this.plan.y + (next.player.y + .5) * this.cellM };
    if (next.event) this.message = next.event;
    if (next.status === 'fallen') {
      this.leave();
      this.source.flash?.(next.event);
      return;
    }
    if (next.status === 'won' && !this.rewarded) {
      this.rewarded = true;
      root.Temples.complete(this.source, this.temple);
    }
  }
  function update(_time, delta) {
    if (!this.state) return;
    const dt = Math.min(delta / 1000, .1), k = this.keys;
    if (k && root.Phaser.Input.Keyboard.JustDown(k.ESC)) { this.leave(); return; }
    this.moveClock -= dt;
    if (this.moveClock <= 0 && this.state.status === 'playing' && k) {
      const dx = k.RIGHT.isDown ? 1 : k.LEFT.isDown ? -1 : 0;
      const dy = dx ? 0 : k.DOWN.isDown ? 1 : k.UP.isDown ? -1 : 0;
      if (dx || dy) { this.accept(root.TemplePuzzles.move(this.state, dx, dy)); this.moveClock = .17; }
    }
    if (this.state.status === 'fallen') return;
    if (this.source.compassDeg != null) this.aim = { ...this.source.facing };
    else if (k && (k.Q.isDown || k.E.isDown)) {
      const angle = Math.atan2(this.aim.y, this.aim.x) + dt * (k.E.isDown ? 1 : -1) * 2;
      this.aim = { x: Math.cos(angle), y: Math.sin(angle) };
    }
    this.accept(root.TemplePuzzles.tick(this.state, dt));
    this.attackClock -= dt;
    const s = this.state, combat = root.Combat, save = this.source.save;
    if (s.status === 'playing' && this.attackClock <= 0) {
      if (s.kind === 'ballista') {
        this.accept(root.TemplePuzzles.attack(s, this.aim, combat.shotDamage({ bow: { tier: 7 } }, 'bow')));
        this.attackClock = combat.fireIntervalMs('bow') / 1000;
      } else if (s.kind === 'duel' || s.kind === 'tower') {
        const foe = s.enemies.find(e => Math.abs(e.x - s.player.x) + Math.abs(e.y - s.player.y) <= 1);
        if (foe) {
          const slot = root.Gear?.activeWeapon(save) || 'sword';
          const ranged = combat.SHOT[slot];
          const relics = root.Gear.effectiveRelics(save);
          const damage = ranged ? combat.shotDamage(relics, slot, save.playerClass) : combat.meleeSwingDamage(relics, 1, save.playerClass, slot);
          this.accept(root.TemplePuzzles.attack(s, { x: foe.x - s.player.x, y: foe.y - s.player.y }, damage));
          this.attackClock = (ranged ? combat.fireIntervalMs(slot) : combat.meleeIntervalMs(slot)) / 1000;
        }
      }
    }
    this.draw();
  }
  function point(x, y, lift = 0) { return { x: this.ox + (x - y) * this.tw, y: this.oy + (x + y) * this.th - lift }; }
  function draw() {
    const s = this.state;
    if (!s) return;
    // The CSS phone layout clips a slice of the logical canvas. Backing-store
    // pixels and the full 844px canvas are both larger than that visible slice.
    const css = document.documentElement.style;
    const top = parseFloat(css.getPropertyValue('--view-top')) || 0;
    const h = parseFloat(css.getPropertyValue('--view-h')) || (typeof H === 'number' ? H : 844);
    const w = typeof W === 'number' ? W : 352, g = this.gfx;
    this.visibleBottom = top + h;
    this.tw = Math.max(10, Math.min(35, (w - 36) / (s.size * 2), (h - 285) / s.size));
    this.th = this.tw * .5;
    this.ox = w / 2;
    this.oy = top + Math.max(165, (h - (s.size - 1) * this.tw) / 2);
    this.title.setPosition(w / 2, top + 52).setFontSize(w < 380 ? 21 : 25).setText(this.plan.enemyKind === 'giant_reaper' ? 'The churchyard reaper' : TITLES[s.kind]);
    this.help.setText(this.plan.enemyKind === 'giant_reaper'
      ? 'Defeat the giant reaper. Move next to it to attack automatically. Beyond the marble is missing floor: stepping off returns you to the ground and resets the trial.'
      : HELP[s.kind]);
    this.help.setPosition(w / 2, top + 88).setWordWrapWidth(Math.min(w - 32, 620));
    this.exitButton.setPosition(w * .31, this.visibleBottom - 34);
    this.retryButton.setPosition(w * .75, this.visibleBottom - 34).setVisible(!this.rewarded);
    g.clear();
    let labelCount = 0, actorCount = 0;
    const label = (x, y, text, color = '#263d42', size = 13) => {
      let item = this.labelPool[labelCount++];
      if (!item) {
        item = this.add.text(0, 0, '', { fontFamily: FONT_UI_STACK, fontStyle: 'bold' }).setOrigin(.5);
        this.labelPool.push(item); this.labels.add(item);
      }
      item.setPosition(x, y).setText(text).setColor(color).setFontSize(size).setVisible(true);
    };
    const actor = (x, y, key, frame, tint, width) => {
      if (!key || !this.textures.exists(key)) return false;
      let item = this.actorPool[actorCount++];
      if (!item) { item = this.add.image(0, 0, key); this.actorPool.push(item); }
      item.setTexture(key, frame).setPosition(x, y).setTint(tint).setVisible(true);
      item.setScale(width / item.width);
      return true;
    };
    const diamond = (x, y, color, inset = 1, lift = 0) => {
      const p = this.point(x, y, lift), a = this.tw - inset, b = this.th - inset / 2;
      g.fillStyle(color).lineStyle(1, 0xa6b8b8, .65);
      g.beginPath(); g.moveTo(p.x, p.y - b); g.lineTo(p.x + a, p.y); g.lineTo(p.x, p.y + b); g.lineTo(p.x - a, p.y); g.closePath(); g.fillPath(); g.strokePath();
      return p;
    };
    for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) {
      const p = diamond(x, y, (x + y) % 2 ? 0xe9eee9 : 0xfafaf1);
      g.lineStyle(1, 0x9eafab, .18); g.lineBetween(p.x - this.tw * .5, p.y, p.x + this.tw * .3, p.y + this.th * .25);
    }
    if (s.kind === 'path' && s.revealRemaining > 0) for (const p of s.path) diamond(p.x, p.y, 0x8bd4e7, 3);
    for (const p of s.plates) { const at = diamond(p.x, p.y, COLORS[p.color], 5); label(at.x, at.y, p.color[0].toUpperCase()); }
    for (const p of s.walls) { diamond(p.x, p.y, 0x6b7d7e, 1, 7); }
    for (const p of s.blocks) { const at = diamond(p.x, p.y, COLORS[p.color], 3, 9); label(at.x, at.y, p.color[0].toUpperCase(), '#ffffff'); }
    for (const [p, text] of [[s.pointA, 'A'], [s.pointB, 'B'], [s.ladder, '⇧']]) if (p) { const at = diamond(p.x, p.y, 0xe6c97b, 3); label(at.x, at.y, text, '#5c451f', 18); }
    if (s.center) diamond(s.center.x, s.center.y, 0x96d6d2, 2);
    for (const e of s.enemies) {
      const p = this.point(e.x, e.y, 8), r = this.tw * .3;
      const art = root.SpriteLayout?.CREATURE_ART[s.kind === 'ballista' ? 'bee' : (this.plan.enemyKind || 'cave_slime')];
      const tint = e.frost > 0 ? 0x8edaf5 : e.elite ? 0xffe3a0 : (art?.tint || 0xffffff);
      if (!actor(p.x, p.y, art?.sheet, art?.directions?.down?.idle?.[0] ?? 0, tint, this.tw * 1.15)) {
        g.fillStyle(tint); g.fillCircle(p.x, p.y, r);
      }
      if (e.elite) label(p.x, p.y - r - 9, '♛', '#f4d487');
      g.fillStyle(0x233536); g.fillRect(p.x - r, p.y + r + 3, r * 2, 3);
      g.fillStyle(0xe794a6); g.fillRect(p.x - r, p.y + r + 3, r * 2 * e.hp / e.maxHp, 3);
    }
    for (const shot of s.shots) {
      const a = this.point(shot.x, shot.y, 7), b = this.point(shot.x + shot.dx * .45, shot.y + shot.dy * .45, 7);
      g.lineStyle(3, shot.frost ? 0x8edaff : 0xe6c67d); g.lineBetween(a.x, a.y, b.x, b.y);
    }
    const p = this.point(s.player.x, s.player.y, 9);
    const sourcePlayer = this.source.player;
    if (!actor(p.x, p.y - 3, sourcePlayer?.texture?.key, sourcePlayer?.frame?.name ?? 0, 0xffffff, this.tw * 1.25)) {
      g.fillStyle(0x243d42); g.fillCircle(p.x, p.y + 6, this.tw * .27);
      g.fillStyle(0xf2cc93); g.fillCircle(p.x, p.y - 3, this.tw * .2);
    }
    if (s.kind === 'ballista') {
      const len = Math.hypot(this.aim.x, this.aim.y) || 1;
      const b = this.point(s.player.x + this.aim.x / len * 1.4, s.player.y + this.aim.y / len * 1.4, 9);
      g.lineStyle(5, 0xb88850); g.lineBetween(p.x, p.y, b.x, b.y);
      g.lineStyle(1, 0x99e2ee, .65); const c = this.point(s.player.x + this.aim.x / len * 4, s.player.y + this.aim.y / len * 4, 9); g.lineBetween(b.x, b.y, c.x, c.y);
    }
    let progress = `${this.plan.enemyKind === 'giant_reaper' ? 'Old Stones' : 'Grove'} Nexus · Floor +1`;
    if (s.kind === 'tower') progress += ` · Ascent ${s.round}/3 · Health ${Math.ceil(s.player.hp)}`;
    if (s.kind === 'duel') progress += ` · Health ${Math.ceil(s.player.hp)}`;
    if (s.kind === 'path') progress += s.revealRemaining > 0 ? ` · Memorize: ${Math.ceil(s.revealRemaining)}s` : ' · Follow the hidden route';
    if (s.kind === 'ballista') progress += `\nHeart ${s.centerHp}/100 · Drones ${s.defeated}/${s.totalDrones}`;
    if (s.status !== 'playing') progress = s.status === 'won' ? 'Trial complete · The temple’s gift is yours.\nReturn to the ground when ready.' : 'Trial failed · Retry to begin again.';
    this.statusText.setPosition(w / 2, this.visibleBottom - 117).setWordWrapWidth(w - 24).setText(progress);
    for (let i = labelCount; i < this.labelPool.length; i++) this.labelPool[i].setVisible(false);
    for (let i = actorCount; i < this.actorPool.length; i++) this.actorPool[i].setVisible(false);
  }
  function leave() { this.scene.stop(); }
  root.TempleScene = { enter };
})(typeof window !== 'undefined' ? window : globalThis);
