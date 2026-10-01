test('burned objects: destroyed plants, bushes and tar remain spent', () => {
  const objects = [
    { id: 'grass', kind: 'wildplant', crop: 'longgrass' },
    { id: 'shrub', kind: 'wildplant', crop: 'shrub' },
    { id: 'bush', kind: 'tree', size: 'bush' },
    { id: 'tar', kind: 'tar' },
  ];
  const save = { burnedObjects: objects.map(o => o.id) };
  const sets = spentSets(null, save);
  for (const o of objects) {
    assert.truthy(isSpent(o, sets), `${o.kind} stays gone after a reload`);
    assert.eq(runInteractable({ save }, o), 'skip', 'destroyed object cannot intercept a tap');
  }
  assert.falsy(isSpent({ id: 'tree', kind: 'tree' }, sets), 'surviving tree remains usable');
});

test('burned objects: unloaded fuel disappears on old burned ground when rebuilt', () => {
  const now = Date.now();
  const fire = { litAt: now - 30000, until: now - 1000, fuelIds: [] };
  const save = { groundFire: { old: fire } };
  const scene = { save, startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, mPerPx: 1,
    _groundFireAtWorld: () => fire };
  const grass = { id: 'late-grass', kind: 'wildplant', crop: 'longgrass', x: 0, y: 0 };
  assert.truthy(isSpent(grass, spentSets(scene, save)), 'expiry removes fuel absent at ignition');
  assert.eq(runInteractable({ scene, save }, grass), 'skip');
  assert.falsy(isSpent({ id: 'tree', kind: 'tree', x: 0, y: 0 }, spentSets(scene, save)), 'trees survive');
  fire.until = now + 10000;
  assert.falsy(isSpent(grass, spentSets(scene, save)), 'fuel remains visible while fire burns');
  scene.save = { groundFire: {} };
  scene._groundFireAtWorld = () => { throw new Error('empty ledger must skip coordinate work'); };
  assert.falsy(isSpent(grass, spentSets(scene, scene.save)));
  assert.falsy(isSpent(grass, spentSets({}, save)), 'partial scene stubs have no cell lookup');
});
