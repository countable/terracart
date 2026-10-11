// The sky floor (WorldGen.SKY_DEPTH) is one level above a grove: a white copy
// of the park where the hidden-way trial is walked on the map itself.
// TemplePuzzles owns the route and its rules; this mixin feeds it the
// player's cell steps and draws the route on the ground. An unfinished trial
// never survives a reload; the temple gift is paid once by Temples.complete.
class SceneSky {
  // Boot returns an interrupted trial to the temple door it climbed from.
  _recoverSkyRun() {
    if (this.save.depth !== WorldGen.SKY_DEPTH) return;
    const back = this.save.skyRun?.return;
    this.save.depth = 0;
    delete this.save.skyRun;
    if (back) this._skyPlace(back);
    persistSave(this.save);
  }
  _skyFeet() {
    const p = playerWorldM(this);
    p.y += this.feetOffsetM || 0;
    return p;
  }
  _skyPlace(point) {
    this.playerM.x = point.x - this.startWorldM.x;
    this.playerM.y = point.y - this.startWorldM.y - (this.feetOffsetM || 0);
    this.syncMoveTarget?.();
  }
  _skyCellCentre(plan, c) {
    return { x: plan.x + (c.x + .5) * plan.cellM, y: plan.y + (c.y + .5) * plan.cellM };
  }
  // plan: TempleLayout.plan's seat (world metres) with kind 'path'.
  enterSkyTrial(temple, plan) {
    if (plan?.kind !== 'path' || (this.depth || 0) !== 0 || Combat.playerDowned(this.save.energy) || this.isTooFast?.()) return false;
    const state = TemplePuzzles.create(plan);
    if (!state) return false;
    this.save.skyRun = { return: this._skyFeet() };
    this._skyTrial = { temple, plan, state };
    this._realmSwitchDepth(WorldGen.SKY_DEPTH, this._skyCellCentre(plan, state.pointA));
    this.flashAtPlayer?.(`The hidden way: memorize the glowing route from A to B. It fades in ${TemplePuzzles.PATH_REVEAL_SECONDS} seconds.`);
    return true;
  }
  exitSky() {
    if (this.depth !== WorldGen.SKY_DEPTH) return false;
    const back = this.save.skyRun?.return || this._skyFeet();
    this._skyTrial = null;
    delete this.save.skyRun;
    this._realmSwitchDepth(0, back);
    return true;
  }
  // A step that leaves the route (or the trial square) starts the preview over
  // from A, the same reset TemplePuzzles.move applies to a wrong turn.
  _skyRestart(run, message) {
    run.state = TemplePuzzles.create(run.plan);
    this._skyPlace(this._skyCellCentre(run.plan, run.state.pointA));
    this.flashAtPlayer?.(message || 'The path faded. Memorize it and try again.');
  }
  _tickSky(dt) {
    if (this.depth !== WorldGen.SKY_DEPTH) { this._skyTrial = null; return; }
    const run = this._skyTrial;
    if (!run) { this.exitSky(); return; }
    if (run.state.status !== 'playing' || this._dialogOpen?.() || document.hidden) return;
    run.state = TemplePuzzles.tick(run.state, Math.max(0, Math.min(.1, Number(dt) || 0)));
    const { plan } = run;
    // Memorizing: the player waits on A until the route fades.
    if (run.state.revealRemaining > 0) { this._skyPlace(this._skyCellCentre(plan, run.state.player)); return; }
    const feet = this._skyFeet();
    const at = { x: Math.floor((feet.x - plan.x) / plan.cellM), y: Math.floor((feet.y - plan.y) / plan.cellM) };
    // A frame can cross a corner or more than one cell: judge each cardinal step.
    let dx = at.x - run.state.player.x, dy = at.y - run.state.player.y;
    while (dx || dy) {
      const sx = Math.sign(dx), sy = sx ? 0 : Math.sign(dy);
      dx -= sx; dy -= sy;
      const next = TemplePuzzles.move(run.state, sx, sy);
      if (next.status === 'fallen') { this._skyRestart(run); return; }
      if (next.phase === 'reveal') { this._skyRestart(run, next.event); return; }
      run.state = next;
      if (next.status === 'won') {
        this.flashAtPlayer?.('The hidden way is complete. Tap A or B to return to the ground.');
        Temples.complete(this, run.temple, TemplePuzzles.winCondition(run.plan));
        return;
      }
    }
  }
  _tapSkyExit(sx, sy) {
    const run = this._skyTrial;
    if (this.depth !== WorldGen.SKY_DEPTH || !run) return false;
    const tap = this.screenToWorldMeters(sx, sy);
    const cells = run.state.status === 'won' ? [run.state.pointA, run.state.pointB] : [run.state.pointA];
    const exit = cells.map(c => this._skyCellCentre(run.plan, c))
      .find(p => sameAbsCell(this, tap.x, tap.y, p.x, p.y));
    if (!exit) return false;
    const feet = this._skyFeet();
    if (Math.hypot(feet.x - exit.x, feet.y - exit.y) > 12) { this.flashAtPlayer('Move closer to the way down.'); return true; }
    this.exitSky();
    return true;
  }
  // Ground layer (cobbleContainer, like slime trails): the trial square, the
  // route while it is revealed, the steps already taken, and A/B markers.
  _drawSky() {
    const run = this._skyTrial, shown = this.depth === WorldGen.SKY_DEPTH && !!run;
    this._skyGfx?.clear();
    for (const label of this._skyLabels || []) label.setVisible(false);
    if (!shown) return;
    if (!this._skyGfx) {
      this._skyGfx = this.add.graphics();
      this.cobbleContainer.add(this._skyGfx);
    }
    this._skyLabels ||= [];
    const g = this._skyGfx, s = run.state, plan = run.plan;
    let labelIndex = 0;
    const label = (x, y, text, hud = false) => {
      let t = this._skyLabels[labelIndex];
      if (!t) { t = this.add.text(0, 0, '', { fontSize: '12px' }).setMask(this.cellGfx.mask); this._skyLabels[labelIndex] = t; }
      labelIndex++;
      t.setVisible(true).setPosition(x, y).setText(text).setOrigin(hud ? 0 : .5).setDepth(hud ? 89 : 9)
        .setStyle({ color: hud ? '#ffe3a1' : '#5c451f', backgroundColor: hud ? '#22383fdd' : null,
          fontStyle: hud ? 'normal' : 'bold', wordWrap: { width: this.viewSize - 16 } });
    };
    const rect = (c, inset = 0) => {
      const a = this.worldMetersToScreen(plan.x + c.x * plan.cellM, plan.y + c.y * plan.cellM);
      const b = this.worldMetersToScreen(plan.x + (c.x + 1) * plan.cellM, plan.y + (c.y + 1) * plan.cellM);
      return { x: a.x + inset, y: a.y + inset, w: b.x - a.x - inset * 2, h: b.y - a.y - inset * 2 };
    };
    const fill = (c, colour, alpha, inset = 1) => { const r = rect(c, inset); g.fillStyle(colour, alpha); g.fillRect(r.x, r.y, r.w, r.h); return r; };
    const square = rect({ x: 0, y: 0 }), far = rect({ x: s.size - 1, y: s.size - 1 });
    g.lineStyle(2, 0xd9c27a, .8);
    g.strokeRect(square.x, square.y, far.x + far.w - square.x, far.y + far.h - square.y);
    if (s.revealRemaining > 0) {
      const fade = Math.min(1, s.revealRemaining);
      for (const c of s.path) fill(c, 0x5fc7e6, .8 * fade, 2);
    }
    for (const c of s.path.slice(1, s.pathIndex + 1)) fill(c, 0xe6c97b, .35, 3);
    const marks = [[s.pointA, 'A'], [s.pointB, 'B']];
    for (const [c, text] of marks) {
      const r = fill(c, 0xe6c97b, .9, 4);
      label(r.x + r.w / 2, r.y + r.h / 2, s.status === 'won' ? `${text}⇩` : c === s.pointA ? 'A⇩' : text);
    }
    const hud = s.status === 'won' ? 'The hidden way · Complete. Tap A or B to return to the ground.'
      : s.revealRemaining > 0 ? `The hidden way · Memorize the route: ${Math.ceil(s.revealRemaining)}s`
      : 'The hidden way · Walk the route from A to B. A wrong step resets it.';
    label(this.viewLeft + 8, this.viewTop + 8, hud, true);
  }
}
