// A golden cauldron (coin-burst POI) once tapped today is SPENT, the same
// state as an opened chest: hidden and unlit until the UTC day rolls.

test('cauldron: a pot tapped today is spent, yesterday\'s is not', () => {
  const today = String(Delivery.dayKey());
  const pot = { kind: 'chest', id: 'c_12_34', poiClass: 'atm' };
  const save = { coinBurstClaimed: { [pot.id + today]: 1, ['c_9_9' + '20000101']: 1 } };
  const sets = spentSets(null, save);
  assert.truthy(isSpent(pot, sets), 'used today: hidden');
  assert.falsy(isSpent({ kind: 'chest', id: 'c_9_9', poiClass: 'atm' }, sets), 'a stale day is back');
  assert.falsy(isSpent(pot, spentSets(null, {})), 'never tapped: standing');
});

test('cauldron: the draw pass hides and unlights it through the same set', () => {
  const src = RENDER_SRC;
  assert.truthy(/const burstSet = coinBurstUsedSet\(scene\.save\);/.test(src), 'built once per frame');
  assert.truthy(/!openedSet\.has\(o\.id\) && !burstSet\.has\(o\.id\)\) LIGHTS\.consider/.test(src), 'no POI glow');
  assert.truthy(/opened: openedSet,\s*burst: burstSet,/.test(src), 'and isSpent culls the sprite');
});
