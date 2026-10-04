(function () {
  test('drill: daily touch grants one minute of mining with a status countdown', () => {
    const scene = makeScene(), save = { energy: 50 };
    const o = { kind: 'grove_shrine', shrineKind: 'drill', id: 'drill-test', x: 0, y: 0 };
    const before = Date.now();
    runInteractable(makeCtx(scene, save), o);
    assert.inRange(save.boonUntil.mining, before + 60000, Date.now() + 60000);
    assert.truthy(Macros.usedToday(save, o.id));
    assert.truthy(Buffs.active(save, scene).some(r => r.id === 'mining'));
    save.boonUntil.mining = 0;
    runInteractable(makeCtx(scene, save), o);
    assert.eq(save.boonUntil.mining, 0, 'same shrine cannot renew it today');
    assert.eq(Lighting.sourceKind(scene, o), 'shrine_drill', 'light remains after use');
  });

  test('drill: frost mining speed expires without changing tools or other work', () => {
    const save = { relics: { pickaxe: { tier: 1 }, axe: { tier: 1 } } };
    const owned = JSON.stringify(save.relics), now = 1000;
    Shrines.grant(save, 'drill', now);
    const frost = toolDurationMs({ pickaxe: { tier: 7 } }, 'pickaxe');
    assert.eq(Gear.workDurationMs(save, 4000, now, 'pickaxe'), frost);
    assert.eq(Gear.workDurationMs(save, 4000, now, 'axe'), 4000);
    assert.eq(Gear.workDurationMs(save, 9000, now, null), 9000);
    assert.eq(Gear.workDurationMs(save, 4000, now + 60000, 'pickaxe'), 4000);
    assert.eq(JSON.stringify(Gear.effectiveRelics(save, now)), owned);
    assert.truthy(INTERACTABLES.mineralrock.gate({ kind: 'mineralrock', yieldTier: 6, requiredTier: 5 }, save));
    save.boonUntil.work = now + 60000;
    assert.eq(Gear.workDurationMs(save, 4000, now, 'pickaxe'), frost / Shrines.WORK_SPEED_MUL);
  });

  test('shrines: bike stands and gold pots use the shared shrine designation', () => {
    for (const [poiClass, id] of [['bicycle_parking', 'bike'], ['atm', 'gold']]) {
      const o = { kind: 'chest', poiClass };
      assert.eq(Shrines.kindForObject(o), Shrines.REWARD_KINDS[id]);
      assert.eq(Macros.visitKindForObject(o), Shrines.kindForObject(o));
      assert.eq(Shrines.kindForObject({ ...o, depth: 1 }), null, 'cave chest mirrors are ordinary chests');
    }
  });
})();
