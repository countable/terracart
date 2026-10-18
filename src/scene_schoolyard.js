// Walk-on schoolyard game; the round belongs to this scene, never the save.
class SceneSchoolyard {
  _tickSchoolyard(dt) {
    if (this.depth !== 0) {
      this._schoolyardRound = null;
      this._schoolyardOnFlag = null;
      return;
    }
    const now = performance.now();
    if (!this._schoolyardFields || now >= (this._schoolyardScanAt || 0)) {
      this._schoolyardFields = SchoolyardFields.fields(this);
      this._schoolyardScanAt = now + 1000;
    }
    if (this._dialogOpen() || document.hidden || Combat.playerDowned(this.save.energy)) return;
    const feet = playerWorldM(this); feet.y += this.feetOffsetM;
    const cell = this.cellAt(feet.x, feet.y);
    const grounded = !Conditions.flying(this.save);
    const flag = grounded && this._schoolyardFields.find(f => f.cellIX === cell.cellIX && f.cellIY === cell.cellIY);
    const entering = flag && this._schoolyardOnFlag !== flag.id;
    this._schoolyardOnFlag = flag ? flag.id : null;
    if (entering && !this._schoolyardRound?.run.active) {
      this._schoolyardRound = { field: flag, run: SchoolyardGame.start() };
      this.flashAtPlayer('Go! Blue +1/sec · Purple +5 · Red −3/sec');
    }
    const round = this._schoolyardRound;
    if (!round?.run.active) return;
    const tile = grounded && round.field.cells.find(c => c.cellIX === cell.cellIX && c.cellIY === cell.cellIY);
    SchoolyardGame.tick(round.run, tile || { x: -1, y: -1 }, Math.max(0, dt));
    if (!round.run.active) this.flashAtPlayer(`Time! Score: ${round.run.score}. Step off and onto the flag to replay.`);
  }

  _drawSchoolyard() {
    const g = this._schoolyardGraphics ||= this.add.graphics().setDepth(8).setMask(this.cellGfx.mask);
    g.clear();
    const hud = this._schoolyardHUD ||= this.add.text(0, 0, '', {
      fontSize: '12px', color: '#ffffff', backgroundColor: '#17102ddd', padding: { x: 6, y: 4 },
    }).setDepth(89);
    hud._huUI = true;
    hud.setVisible(false);
    const flags = this._schoolyardFlags ||= [];
    flags.forEach(f => f.setVisible(false));
    if (this.depth !== 0) return;
    let count = 0;
    for (const field of this._schoolyardFields || []) {
      const p = absCellCenterMeters(this, field.cellIX, field.cellIY);
      const at = this.worldMetersToScreen(p.x, p.y);
      if (at.x < this.viewLeft - 32 || at.x > this.viewLeft + this.viewSize + 32 ||
          at.y < this.viewTop - 32 || at.y > this.viewTop + this.viewSize + 32) continue;
      let flag = flags[count];
      if (!flag) flag = flags[count] = this.add.image(0, 0, 'castle_flag').setOrigin(.5, 1).setDepth(9).setMask(this.cellGfx.mask);
      count++;
      flag.setPosition(at.x, at.y).setVisible(true).setTint(0x8edbff);
    }
    const round = this._schoolyardRound;
    if (!round) return;
    const { run, field } = round, S = SchoolyardGame.SPEC;
    const until = S.period - run.elapsed % S.period;
    hud.setVisible(true).setPosition(this.viewLeft + 10, this.viewTop + 38)
      .setWordWrapWidth(this.viewSize - 32)
      .setText(run.active
        ? `Score ${run.score} · ${Math.ceil(SchoolyardGame.remaining(run))}s\nEast → in ${until.toFixed(1)}s · outlines = next\nBlue +${S.blueRate}/s · Purple +${S.purpleBonus} · Red ${S.redRate}/s`
        : `Time! Score ${run.score}\nStep off and onto the flag to replay`);
    if (!run.active) return;
    const colors = { blue: 0x419dff, red: 0xff505e, purple: 0xb574ff };
    // The pulse is visual only: a dim tile keeps its scoring color.
    const pulse = .35 + .2 * (1 + Math.sin(run.elapsed * Math.PI * 4)) / 2;
    for (const c of field.cells) {
      const p = absCellCenterMeters(this, c.cellIX, c.cellIY);
      const at = this.worldMetersToScreen(p.x, p.y);
      const size = Math.abs(this.worldMetersToScreen(p.x + this.cellM, p.y).x - at.x) - 2;
      const color = SchoolyardGame.color(run, c.x, c.y);
      const next = SchoolyardGame.color(run, c.x, c.y, true);
      g.lineStyle(1, 0xabb8c9, .25); g.strokeRect(at.x-size/2, at.y-size/2, size, size);
      if (color) { g.fillStyle(colors[color], pulse); g.fillRect(at.x-size/2, at.y-size/2, size, size); }
      if (next) { g.lineStyle(2, colors[next], .9); g.strokeRect(at.x-size/2+3, at.y-size/2+3, size-6, size-6); }
    }
  }
}
