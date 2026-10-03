(() => {
  test('fire elemental: inhabits the lava floor infernal regions only', () => {
    const context = { kinds: EnemyHabitats.FAMILIES.infernal };
    for (let depth = 1; depth <= 12; depth++) {
      assert.eq(EnemySpawns.caveRows(depth, context).some(r => r.id === 'fire_elemental'),
        depth === WorldGen.LAVA_DEPTH);
    }
    const kinds = new Set(Array.from({length:100}, (_, i) => EnemySpawns.caveKind(WorldGen.LAVA_DEPTH, i/100, context)));
    assert.truthy(kinds.has('fire_elemental'));
    assert.eq(EnemyRoster.get('fire_elemental').surface, null);
  });
  test('fire elemental: survives fire and burns the player on a successful melee hit', () => {
    const c = {kind:'fire_elemental',id:'fire-test',x:0,y:0};
    const scene = {cellM:7,depth:WorldGen.LAVA_DEPTH,save:{energy:100,armor:{}},
      cellAt:()=>({loaded:true,type:WorldGen.T.CAVE_FLOOR}),_cellBlocked:()=>false,_nearAny:()=>false,
      _losePlayerEnergy(n) { this.save.energy -= n; return n; },
      _applyCondition(id) { Conditions.apply(this.save,id); }};
    assert.falsy(Combat.canBurn(c));
    const row=EnemyRoster.get(c.kind);
    rosterEnemyAttack(scene,c,row,1000,1,0,false,0.1);
    assert.eq(scene.save.energy,100,'windup precedes hit');
    rosterEnemyAttack(scene,c,row,1400,1,0,false,0.1);
    assert.lt(scene.save.energy,100);
    assert.truthy(Conditions.active(scene.save,'burning'));
  });
})();
