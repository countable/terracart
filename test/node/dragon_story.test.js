(function () {
  const copy = x => JSON.parse(JSON.stringify(x));
  function scene() {
    return { depth: 9, cellM: 7, save: { energy: 100, memoryStory: { act3Started: true } },
      _shots: [], _cellBlocked: () => false, _attackMul: () => 1,
      showMessageModal(m) { this.modal = m; } };
  }
  function unlock(s) { return DragonStory.defeated(s, { kind: 'red_demon' }, 'player'); }
  const foe = (x = 14, y = 0) => ({ kind: 'zombie', id: 'target', x, y });

  test('dragon story: all existing demons can yield the power on dungeon level nine', () => {
    const available = EnemySpawns.caveRows(9).map(row => row.id);
    for (const kind of ['red_demon', 'purple_demon', 'armoured_demon']) {
      assert.includes(available, kind, 'objective has real level-nine enemies');
      const s = scene();
      assert.truthy(DragonStory.defeated(s, {kind}, 'player'));
      assert.truthy(DragonStory.unlocked(s.save));
      assert.truthy(s.save.dragonStory.pending);
    }
  });

  test('dragon story: exact depth, Act 3 and player or pet credit gate recovery', () => {
    for (const depth of [0, 5, 8, 10]) {
      const s = scene();s.depth = depth;
      assert.falsy(unlock(s));
    }
    const before = scene(); before.save.memoryStory.act3Started = false;
    assert.falsy(unlock(before));
    const wrong = scene(); assert.falsy(DragonStory.defeated(wrong, {kind:'red_dragon'}, 'player'));
    for (const source of ['turret', 'lava', 'light']) {
      const s = scene(); assert.falsy(DragonStory.defeated(s, {kind:'red_demon'}, source));
    }
    const pet = scene(); assert.truthy(DragonStory.defeated(pet, {kind:'purple_demon'}, 'pet'));
  });

  test('dragon story: recovery is permanent and duplicate kills cannot repeat its reward', () => {
    const s = scene();assert.truthy(DragonStory.objective(s.save).includes('level 9'));
    unlock(s);s.save = copy(s.save);
    assert.truthy(DragonStory.unlocked(s.save));assert.eq(DragonStory.objective(s.save), null);
    assert.falsy(unlock(s));
    assert.truthy(DragonStory.drain(s));assert.truthy(s.modal.mustAcknowledge);
    assert.truthy(s.save.dragonStory.pending, 'opening is not acknowledgment');
    const resumed = scene();resumed.save = copy(s.save);
    assert.truthy(DragonStory.drain(resumed));resumed.modal.onDismiss();
    assert.falsy(resumed.save.dragonStory.pending);
    assert.truthy(DragonStory.unlocked(resumed.save));
    assert.falsy(unlock(resumed));assert.falsy(DragonStory.drain(resumed));
  });

  test('dragon story: reward waits behind dialogs and retries failed presentation', () => {
    const s = scene();unlock(s);s._dialogOpen = () => true;
    assert.falsy(DragonStory.drain(s));assert.falsy(s.modal);
    s._dialogOpen = () => false;s.showMessageModal = () => {throw new Error('not ready');};
    let error = false;try {DragonStory.drain(s);} catch (_) {error = true;}
    assert.truthy(error);assert.falsy(s._dragonStoryOpen);assert.truthy(s.save.dragonStory.pending);
    s.showMessageModal = m => {s.modal = m;};assert.truthy(DragonStory.drain(s));
    assert.falsy(DragonStory.drain(s), 'no duplicate while card is open');
  });

  test('dragon story: innate fire uses existing shot pipeline without powder, gear or inventory', () => {
    const s = scene();unlock(s);
    const shot = DragonStory.tick(s, 10000, 0, 0, [foe()]);
    const dragon = EnemyRoster.get('red_dragon');
    assert.truthy(shot);assert.eq(s._shots[0], shot);assert.eq(shot.damage, dragon.dmg);
    assert.eq(shot.rangeM, dragon.range * s.cellM);assert.eq(shot.slot, 'staff');
    assert.falsy(shot.pierce);assert.falsy(shot.hostile);assert.truthy(Combat.isPlayerKill(Combat.shotSource(shot)));
    assert.eq(s.save.energy, 100);assert.falsy(s.save.inv);assert.falsy(s.save.relics);
    assert.eq(DragonStory.tick(s, 10001, 0, 0, [foe()]), null);
    assert.truthy(DragonStory.tick(s, 10000 + dragon.damageIntervalSeconds * 1000, 0, 0, [foe()]));
  });

  test('dragon story: breathing selects nearest visible enemy and honors wall, range and downed gates', () => {
    const s = scene();unlock(s);
    s._cellBlocked = (x,y) => y === 0 && x >= 3;
    const shot = DragonStory.tick(s, 10000, 0, 0, [foe(14,0),foe(0,21)]);
    assert.truthy(shot);assert.eq(shot.vx,0);assert.eq(shot.vy,1);
    const blocked = scene();unlock(blocked);blocked._cellBlocked = () => true;
    assert.eq(DragonStory.tick(blocked,10000,0,0,[foe()]),null);
    blocked._cellBlocked = () => false;
    assert.eq(DragonStory.tick(blocked,10000,0,0,[foe(100)]),null);
    blocked.save.energy = 0;assert.eq(DragonStory.tick(blocked,10000,0,0,[foe()]),null);
    const locked = scene();assert.eq(DragonStory.tick(locked,10000,0,0,[foe()]),null);
  });

  test('dragon story: flame stops against cave rock and damages ordinary targets through Combat', () => {
    const s = scene();unlock(s);const target = foe();
    const shot = DragonStory.tick(s,10000,0,0,[target]);let hits=0;
    const blocked = Combat.stepShots([shot],2, [target], 3, () => hits++,
      {cellM:s.cellM,blocked:x=>x>=7});
    assert.eq(blocked.length,0);assert.eq(hits,0);
    const next = DragonStory.tick(s,20000,0,0,[target]);
    const before=Combat.hp(target);
    Combat.stepShots([next],2,[target],3,(c,hit)=>{hits++;Combat.damageDealt(c,hit.damage);}, {cellM:s.cellM,blocked:()=>false});
    assert.eq(hits,1);assert.lt(Combat.hp(target),before);
  });
})();
