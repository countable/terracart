// Distances use WGS84 raw fixes, independent of player/control-stick position.
const eggFix = (meters, timestamp, accuracy = 4) => ({ lat: meters / 6371000 * 180 / Math.PI, lon: 0, accuracy, timestamp });
const eggSave = (count = 1) => ({ inv: [{ id: 'egg', count }], eggHatchM: 0 });

test('egg: slow GPS walks accumulate past the jitter threshold and survive reload', () => {
  const save = eggSave();
  let tracker = null;
  for (let m = 0; m <= 12; m++) {
    const fix = eggFix(m, m * 1000);
    tracker = EggHatch.track(save, tracker, fix, fix.timestamp).tracker;
  }
  assert.inRange(save.eggHatchM, 9.9, 10.1);
  const restored = JSON.parse(JSON.stringify(save));
  EggHatch.track(restored, null, eggFix(200, 20000), 20000);
  assert.eq(restored.eggHatchM, save.eggHatchM, 'first fix after reload earns nothing');
});

test('egg: stationary jitter does not incubate', () => {
  const save = eggSave();
  let tracker = null;
  for (let i = 0; i < 100; i++) {
    tracker = EggHatch.track(save, tracker, eggFix(i % 3, i * 1000), i * 1000).tracker;
  }
  assert.eq(save.eggHatchM, 0);
});

test('egg: inaccurate fixes, jumps, stale fixes and long gaps earn no metres', () => {
  for (const [fix, now] of [
    [eggFix(10, 10000, 80), 10000],
    [eggFix(100, 1000), 1000],
    [eggFix(10, 10000), 50000],
    [eggFix(50, 60000), 60000],
    [{ ...eggFix(10, 10000), lat: NaN }, 10000],
  ]) {
    const save = eggSave();
    const tracker = EggHatch.track(save, null, eggFix(0, 0), 0).tracker;
    EggHatch.track(save, tracker, fix, now);
    assert.eq(save.eggHatchM, 0);
  }
});

test('egg: duplicate timestamps cannot advance GPS progress', () => {
  const save = eggSave();
  const tracker = EggHatch.track(save, null, eggFix(0, 10000), 10000).tracker;
  const result = EggHatch.track(save, tracker, eggFix(10, 10000), 10000);
  assert.eq(result.tracker, tracker);
  assert.eq(save.eggHatchM, 0);
});

test('egg: no egg and a newly acquired egg cannot receive earlier walking', () => {
  const save = eggSave();
  const tracker = EggHatch.track(save, null, eggFix(0, 0), 0).tracker;
  save.inv = [];
  assert.eq(EggHatch.track(save, tracker, eggFix(10, 10000), 10000).tracker, null);
  Inventory.add(save, 'egg');
  EggHatch.track(save, tracker, eggFix(10, 10000), 10000);
  assert.eq(save.eggHatchM, 0, 'acquisition session invalidates old anchor');
});

test('egg: remaining distance rounds up and only one stacked egg incubates', () => {
  const save = eggSave(3);
  save.eggHatchM = EggHatch.METERS - 0.1;
  assert.eq(EggHatch.remaining(save), 1);
  assert.falsy(EggHatch.ready(save));
  const tracker = EggHatch.track(save, null, eggFix(0, 0), 0).tracker;
  EggHatch.track(save, tracker, eggFix(10, 10000), 10000);
  assert.eq(save.eggHatchM, EggHatch.METERS);
  assert.truthy(EggHatch.ready(save));
  assert.truthy(EggHatch.hatch(save, () => 0).ok);
  assert.eq(Inventory.count(save, 'egg'), 2);
  assert.eq(save.wildAnimals.length, 1);
  assert.falsy(save.wildAnimals[0].pet);
  assert.eq(save.eggHatchM, 0);
  assert.falsy(EggHatch.ready(save));
  EggHatch.track(save, tracker, eggFix(20, 20000), 20000);
  assert.eq(save.eggHatchM, 0, 'hatching resets GPS anchor for next egg');
});

test('egg: each baby kind can hatch, consuming exactly one egg', () => {
  const pets = babyItems();
  pets.forEach((petId, i) => {
    const save = eggSave();
    save.eggHatchM = EggHatch.METERS;
    const result = EggHatch.hatch(save, () => (i + 0.5) / pets.length);
    assert.truthy(result.ok);
    assert.eq(result.petId, petId);
    assert.eq(Inventory.count(save, petId), 0);
    assert.eq(result.creature.kind, ITEM_BY_ID[petId].base);
    assert.truthy(result.creature.raised);
    // Hatched WILD: not yet a pet, caught like any other by giving it its favourite.
    assert.falsy(result.creature.pet); assert.eq(Pets.list(save).length, 0);
    assert.truthy(Pets.canCatch(save, result.creature), 'a wild baby is caught with its favourite');
    assert.eq(Inventory.count(save, 'egg'), 0);
    assert.eq(save.eggHatchM, 0);
  });
});

test('egg: unavailable hatches leave inventory and progress intact', () => {
  assert.eq(EggHatch.hatch(eggSave()).reason, 'not_ready');
  assert.eq(EggHatch.hatch({ inv: [], eggHatchM: EggHatch.METERS }).reason, 'no_egg');
});

test('egg: the GPS consumer saves progress and refreshes the selected Hatch action', () => {
  let saved = 0, refreshed = 0;
  const document = { hidden: false };
  const track = new Function('EggHatch', '_teleportOverride', 'document', 'persistSave',
    SCENE_GEO_SRC + '; return SceneGeo.prototype._trackEggHatch;')(EggHatch, null, document, () => saved++);
  const scene = { save: eggSave(), playerM: { x: 9999, y: 9999 }, syncConsumableButton: () => refreshed++ };
  scene.save.selSlot = 0;
  const now = Date.now();
  const pos = (m, timestamp) => ({ coords: { latitude: eggFix(m, timestamp).lat, longitude: 0, accuracy: 4 }, timestamp });
  track.call(scene, pos(0, now - 10000));
  track.call(scene, pos(10, now));
  assert.inRange(scene.save.eggHatchM, 9.9, 10.1);
  assert.eq(saved, 1);
  assert.eq(refreshed, 1);
  for (const flag of ['_sandboxMode', '_gpsManualOverride']) {
    scene[flag] = true;
    track.call(scene, pos(20, now));
    assert.eq(scene._eggHatchTracker, null);
    scene[flag] = false;
  }
  document.hidden = true;
  track.call(scene, pos(30, now));
  assert.eq(saved, 1, 'hidden/manual/sandbox fixes earn nothing');
});

test('egg: losing the last egg clears incubation before another egg arrives', () => {
  const save = eggSave();
  save.eggHatchM = 300;
  Inventory.remove(save, 'egg');
  assert.eq(save.eggHatchM, 0);
  Inventory.add(save, 'egg');
  assert.eq(EggHatch.remaining(save), EggHatch.METERS);
});

test('shiny egg: separate stack hatches a non-shiny green dragon baby', () => {
  const save = eggSave(2);
  Inventory.add(save, 'shiny_egg', 2);
  save.eggHatchM = 123;
  save.shinyEggHatchM = EggHatch.METERS;
  const result = EggHatch.hatch(save, () => 0, { x: 1, y: 2, tx: 0, ty: 0 }, 'shiny_egg');
  assert.truthy(result.ok);
  assert.eq(result.petId, 'baby_green_dragon');
  assert.eq(result.creature.kind, 'green_dragon');
  assert.eq(result.creature.shiny, false);
  assert.truthy(SpriteLayout.isBabyPet(result.creature));
  assert.truthy(Pets.canCatch(save, result.creature));
  assert.truthy(Pets.likes(result.creature, 'meat'));
  assert.eq(Inventory.count(save, 'egg'), 2);
  assert.eq(Inventory.count(save, 'shiny_egg'), 1);
  assert.eq(save.eggHatchM, 123);
  assert.eq(save.shinyEggHatchM, 0);
});

test('shiny egg: walking, reload and reacquisition keep incubation independent', () => {
  const save = eggSave();
  let result = EggHatch.trackAll(save, null, eggFix(0, 0), 0);
  Inventory.add(save, 'shiny_egg');
  result = EggHatch.trackAll(save, result.tracker, eggFix(10, 10000), 10000);
  assert.inRange(save.eggHatchM, 9.9, 10.1);
  assert.eq(save.shinyEggHatchM, 0);
  result = EggHatch.trackAll(save, result.tracker, eggFix(20, 20000), 20000);
  assert.inRange(save.shinyEggHatchM, 9.9, 10.1);
  const restored = JSON.parse(JSON.stringify(save));
  EggHatch.trackAll(restored, null, eggFix(30, 30000), 30000);
  assert.eq(restored.shinyEggHatchM, save.shinyEggHatchM);
  Inventory.remove(save, 'shiny_egg');
  assert.eq(save.shinyEggHatchM, 0);
  Inventory.add(save, 'shiny_egg');
  EggHatch.trackAll(save, result.tracker, eggFix(30, 30000), 30000);
  assert.eq(save.shinyEggHatchM, 0);
  assert.inRange(save.eggHatchM, 29.9, 30.1);
});
