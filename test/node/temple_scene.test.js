(() => {
  test('temple scene: combat uses borrowed equipment without granting ownership', () => {
    const previousPhaser = globalThis.Phaser;
    globalThis.Phaser = { Scene: class {} };
    try {
      for (const kind of ['duel', 'tower']) {
        for (const active of [true, false]) {
          const save = { energy: 100, relics: {}, boonUntil: { wand: active ? Date.now() + 60000 : 1 } };
          let trial;
          const source = { save, scene: {
            manager: { getScene() {}, add(_key, scene) { trial = scene; } },
            pause() {}, resume() {},
          } };
          TempleScene.enter(source, {}, { kind, size: 7, seed: 0, x: 0, y: 0, cellM: 7 });
          trial.draw = () => {};
          trial.restartTrial();
          trial.state.enemies = [{ id: 'guard', x: 2, y: 5, hp: 1000, maxHp: 1000, frost: 0 }];
          trial.update(0, 0);
          const expected = active ? Combat.shotDamage({ staff: { tier: Shrines.WAND_TIER } }, 'staff')
            : Combat.meleeSwingDamage({}, 1, undefined, 'sword');
          assert.gt(expected, 0);
          assert.eq(trial.state.enemies[0].hp, 1000 - expected, `${kind}: ${active ? 'borrowed staff' : 'expired boon'}`);
          assert.eq(JSON.stringify(save.relics), '{}', 'trial does not grant the temporary staff');
        }
      }
    } finally { globalThis.Phaser = previousPhaser; }
  });
})();

test('temple scene: reaper uses roster stats and falling returns to ground without claiming', () => {
  const old = globalThis.Phaser; globalThis.Phaser = {Scene: class {}};
  try {
    let trial, stopped = 0, message;
    const source = {save: {energy:100}, flash(text) {message = text;}, scene: {
      manager: {getScene() {}, add(_key, s) {trial = s;}}, pause() {}, resume() {},
    }};
    TempleScene.enter(source, {}, {kind:'duel', enemyKind:'giant_reaper', size:7, x:0, y:0, cellM:7});
    trial.scene = {stop() {stopped++;}}; trial.draw = () => {};
    trial.restartTrial();
    assert.eq(trial.state.enemies[0].hp, Combat.maxHp({kind:'giant_reaper'}));
    assert.eq(trial.state.config.enemyDamage, Combat.playerDamage(Combat.monster('giant_reaper').dmg, undefined, 1));
    trial.state.enemies[0].hp = 1;
    trial.state.player.x = 0;
    trial.accept(TemplePuzzles.move(trial.state, -1, 0));
    assert.eq(stopped, 1); assert.truthy(message.includes('ground')); assert.falsy(trial.rewarded);
    trial.restartTrial();
    assert.eq(trial.state.status, 'playing');
    assert.eq(trial.state.enemies[0].hp, Combat.maxHp({kind:'giant_reaper'}));
  } finally {globalThis.Phaser = old;}
});
