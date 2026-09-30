// Exercise the persistent narrative state machine without Phaser or purchases.
(function () {
const copy = value => JSON.parse(JSON.stringify(value));
const saveWith = (n = 0) => ({ memories: n, discovered: Object.fromEntries(
  Array.from({ length: n }, (_, i) => ['discovery:' + i, 1])) });
function sceneFor(save) {
  return { save, modals: [], offers: 0,
    showMessageModal(panel) { this.modals.push(panel); } };
}
function isolated(fn) {
  const originalPersist = globalThis.persistSave, originalBody = document.body;
  const saved = [];
  globalThis.persistSave = save => saved.push(copy(save));
  document.body = { classList: { contains: () => false } };
  try { fn(saved); } finally {
    globalThis.persistSave = originalPersist; document.body = originalBody;
  }
}
const firstTower = { id: 'tower:first', kind: 'house' }, secondTower = { id: 'tower:second', kind: 'house' };
function visit(scene, house = firstTower) { MemoryStory.visitWizard(scene, () => scene.offers++, house); }
function dismiss(scene) { scene.modals[scene.modals.length - 1].onDismiss(); }
function finish(scene) {
  for (let guard = 0; scene._wizardStoryOpen && guard < 20; guard++) dismiss(scene);
  assert.falsy(scene._wizardStoryOpen, 'wizard sequence finishes');
}

test('memory arc: every third lifetime discovery replaces the default, even after spending', () => isolated(() => {
  const save = saveWith(0);
  for (let n = 1; n <= 42; n++) {
    save.discovered['unique:' + n] = 1;
    save.memories = 0; // Spent memories never rewind the story.
    const pending = MemoryStory.enqueue(save, MemoryStory.total(save), 'a flower');
    MemoryStory.enqueue(save, MemoryStory.total(save), 'duplicate');
    assert.eq(pending.length, n, 'duplicate pending milestone is not queued twice');
    const panel = MemoryStory.panel(pending[n - 1]);
    assert.eq(panel.kind, 'memory', 'special scenes keep the memory presentation');
    assert.eq(panel.title === 'A memory returns', n % 3 !== 0);
    assert.truthy(panel.body && panel.art, 'post-thirty milestones remain complete scenes');
  }
  assert.eq(save.memories, 0, 'narrative does not grant or spend currency');
}));

test('memory arc: queue waits behind other modals and persists through reload until acknowledged', () => isolated(saved => {
  const save = saveWith(3);
  MemoryStory.enqueue(save, 2, 'a leaf'); MemoryStory.enqueue(save, 3, 'a bell');
  const scene = sceneFor(save);
  document.body.classList.contains = () => true;
  assert.falsy(MemoryStory.drain(scene)); assert.eq(save.memoryStory.pending.length, 2);
  document.body.classList.contains = () => false;
  assert.truthy(MemoryStory.drain(scene));
  assert.truthy(scene.modals[0].mustAcknowledge);
  assert.falsy(MemoryStory.drain(scene), 'an open scene is not duplicated');
  assert.eq(save.memoryStory.pending.length, 2, 'opening does not consume it');
  const resumed = sceneFor(copy(save));
  assert.truthy(MemoryStory.drain(resumed));
  assert.eq(resumed.modals[0].body, scene.modals[0].body);
  dismiss(resumed);
  assert.eq(saved[saved.length - 1].memoryStory.pending.length, 1);
  assert.truthy(MemoryStory.drain(resumed));
  assert.eq(resumed.modals[1].title, MemoryStory.SCENES[3].title);
  dismiss(resumed);
  assert.falsy(MemoryStory.drain(resumed));
  assert.eq(resumed.save.memories, 3);
}));

test('memory arc: failed memory modal remains retryable', () => isolated(() => {
  const scene = sceneFor(saveWith(3)); MemoryStory.enqueue(scene.save, 3);
  scene.showMessageModal = () => { throw new Error('modal unavailable'); };
  let threw = false;
  try { MemoryStory.drain(scene); } catch (_) { threw = true; }
  assert.truthy(threw); assert.falsy(scene._memoryStoryOpen);
  assert.eq(scene.save.memoryStory.pending.length, 1);
  scene.showMessageModal = panel => scene.modals.push(panel);
  assert.truthy(MemoryStory.drain(scene));
}));

function towerSave(n, second = false) {
  const save = saveWith(n);
  save.restoredHouses = { [firstTower.id]: 'wizard' };
  if (second) save.restoredHouses[secondTower.id] = 'wizard';
  save.wizardTowers = { firstId: firstTower.id, secondId: second ? secondTower.id : null };
  return save;
}
function earnTo(save, count) {
  while (MemoryStory.total(save) < count) save.discovered['earned:' + MemoryStory.total(save)] = 1;
}
function introduced(n = 9, second = false) {
  const scene = sceneFor(towerSave(n, second)); visit(scene); finish(scene); return scene;
}

test('memory arc: both first tower and nine lifetime memories are needed for Act II', () => isolated(() => {
  assert.eq(MemoryStory.act(saveWith(30)), 1);
  const scene = sceneFor(towerSave(8));
  assert.eq(MemoryStory.act(scene.save), 1);
  visit(scene); finish(scene);
  assert.eq(scene.offers, 0); assert.falsy(scene.save.memoryStory.introDone);
  assert.eq(scene.modals[0].body, MemoryStory.LOCKED.body);
  earnTo(scene.save, 9); scene.save.memories = 0;
  assert.eq(MemoryStory.act(scene.save), 2);
  visit(scene); finish(scene);
  assert.eq(scene.modals.length, 4); assert.eq(scene.offers, 1);
  assert.eq(scene.save.memories, 0);
}));

test('memory arc: intro resumes its unacknowledged page and first return keeps exact promise', () => isolated(saved => {
  const scene = sceneFor(towerSave(9)); visit(scene);
  visit(scene); assert.eq(scene.modals.length, 1);
  assert.truthy(scene.modals[0].mustAcknowledge); dismiss(scene);
  const resumed = sceneFor(copy(saved[saved.length - 1])); visit(resumed);
  assert.eq(resumed.modals[0].body, MemoryStory.INTRO[1].body);
  finish(resumed); assert.eq(resumed.modals.length, 2); assert.eq(resumed.offers, 1);
  visit(resumed);
  assert.truthy(resumed.modals[2].body.includes('I can help you remember the right things.'));
  finish(resumed); assert.eq(resumed.save.memories, 9);
}));

test('memory arc: every eligible milestone at the current tower is bundled and acknowledged once', () => isolated(() => {
  const scene = introduced(); visit(scene); finish(scene);
  for (const [memories, ids] of [[12, ['silver_lining']], [15, ['stronger_hands', 'right_order']],
    [18, ['useful_memories', 'hesitation']]]) {
    earnTo(scene.save, memories); visit(scene);
    assert.eq(scene.save.memoryStory.visit.kind, 'milestone');
    assert.eq(JSON.stringify(scene.save.memoryStory.visit.beats), JSON.stringify(ids));
    assert.falsy(ids.some(id => scene.save.memoryStory.act2Seen.includes(id)));
    finish(scene);
    assert.truthy(ids.every(id => scene.save.memoryStory.act2Seen.includes(id)));
    visit(scene); assert.eq(scene.save.memoryStory.visit.kind, 'visit'); finish(scene);
  }
}));

test('memory arc: late first return bundles all eligible beats without extra discovery or repeat clicks', () => isolated(() => {
  const scene = introduced(18); visit(scene);
  assert.eq(scene.save.memoryStory.visit.kind, 'return');
  assert.eq(scene.modals[3].body, MemoryStory.FIRST_RETURN.body);
  assert.eq(scene.save.memoryStory.visit.beats.length, 5); finish(scene);
  assert.eq(scene.save.memoryStory.act2Seen.length, 5);
  visit(scene); assert.eq(scene.save.memoryStory.visit.kind, 'visit'); finish(scene);
}));

test('memory arc: interrupted bundled milestones resume with frozen selection and ignore stale callbacks', () => isolated(saved => {
  const scene = introduced(15); visit(scene); dismiss(scene);
  const stale = scene.modals[scene.modals.length - 1]; dismiss(scene);
  const currentPage = scene.save.memoryStory.visit.page;
  stale.onDismiss(); assert.eq(scene.save.memoryStory.visit.page, currentPage);
  const resumed = sceneFor(copy(saved[saved.length - 1])); earnTo(resumed.save, 18); visit(resumed);
  assert.eq(resumed.save.memoryStory.visit.page, currentPage);
  assert.falsy(resumed.save.memoryStory.visit.beats.includes('hesitation'));
  finish(resumed);
  const final = resumed.modals[resumed.modals.length - 1], offers = resumed.offers;
  final.onDismiss(); assert.eq(resumed.offers, offers);
  visit(resumed); assert.truthy(resumed.save.memoryStory.visit.beats.includes('hesitation')); finish(resumed);
}));

test('memory arc: abandonment at twenty-one overrides an interrupted introduction and prevents upgrades', () => isolated(saved => {
  const scene = sceneFor(towerSave(20)); visit(scene); dismiss(scene);
  const resumed = sceneFor(copy(saved[saved.length - 1])); earnTo(resumed.save, 21);
  assert.eq(MemoryStory.towerAccess(resumed.save, firstTower), 'abandoned');
  visit(resumed);
  assert.eq(resumed.save.memoryStory.visit, null);
  assert.truthy(resumed.modals[0].body.includes('come to me when you are ready.'));
  finish(resumed); assert.eq(resumed.offers, 0);
  assert.falsy(resumed.save.memoryStory.introDone);
}));

test('memory arc: only canonical second tower continues later milestones and upgrades', () => isolated(() => {
  const scene = sceneFor(towerSave(27, true));
  scene.save.memoryStory = { introDone: true, visits: 2 };
  visit(scene, { id: 'random:tower' }); finish(scene); assert.eq(scene.offers, 0);
  visit(scene, firstTower); finish(scene); assert.eq(scene.offers, 0);
  visit(scene, secondTower);
  assert.eq(JSON.stringify(scene.save.memoryStory.visit.beats), JSON.stringify(['little_lives', 'what_comes_next']));
  finish(scene); assert.eq(scene.offers, 1);
  visit(scene, secondTower); finish(scene); assert.eq(scene.offers, 2);
  assert.eq(scene.save.memoryStory.act2Seen.length, 2, 'first-location backlog is not replayed here');
}));

test('memory arc: thirty memories only reveal at the second tower, overriding old pending beats', () => isolated(saved => {
  const scene = sceneFor(towerSave(29, true));
  scene.save.memoryStory = { introDone: true, visits: 2 };
  visit(scene, secondTower);
  const resumed = sceneFor(copy(saved[saved.length - 1])); earnTo(resumed.save, 30);
  visit(resumed, firstTower); finish(resumed);
  assert.eq(resumed.offers, 0); assert.falsy(resumed.save.memoryStory.act3Started);
  visit(resumed, secondTower);
  assert.eq(resumed.save.memoryStory.visit.kind, 'reveal');
  assert.eq(resumed.save.memoryStory.visit.revealVersion, 2);
  dismiss(resumed);
  assert.truthy(resumed.modals[2].body.includes(MemoryStory.DRAGON_DECLARATION));
  const reloaded = sceneFor(copy(saved[saved.length - 1])); visit(reloaded, secondTower);
  assert.eq(reloaded.modals[0].body, MemoryStory.REVEAL[1].body);
  assert.eq(MemoryStory.act(reloaded.save), 2);
  finish(reloaded); assert.eq(MemoryStory.act(reloaded.save), 3);
  assert.eq(reloaded.offers, 1); assert.eq(reloaded.save.memories, 29);
  visit(reloaded, secondTower); assert.eq(reloaded.save.memoryStory.visit.kind, 'visit'); finish(reloaded);
}));

test('memory arc: old revealed flag and first visit at thirty cannot skip the second-location reveal', () => isolated(() => {
  const scene = sceneFor(towerSave(30, true)); scene.save.memoryStory = { revealed: true };
  assert.eq(MemoryStory.act(scene.save), 2);
  visit(scene, secondTower); assert.eq(scene.save.memoryStory.visit.kind, 'reveal'); finish(scene);
  assert.truthy(scene.save.memoryStory.act3Started);
  assert.eq(MemoryStory.panel({ memory: 30 }, scene.save).body, MemoryStory.AFTER[0].body);
}));

test('memory arc: failed later page remains retryable with saved progress', () => isolated(() => {
  const scene = sceneFor(towerSave(9)); visit(scene);
  scene.showMessageModal = () => { throw new Error('modal unavailable'); };
  let threw = false; try { dismiss(scene); } catch (_) { threw = true; }
  assert.truthy(threw); assert.falsy(scene._wizardStoryOpen);
  scene.showMessageModal = panel => scene.modals.push(panel);
  visit(scene); assert.eq(scene.modals[1].body, MemoryStory.INTRO[1].body); finish(scene);
}));

test('memory arc: contradictory fragments require their acknowledged claim, and stop after Act III', () => {
  for (const [memory, fragment] of Object.entries(MemoryStory.ACT2_MEMORIES)) {
    const record = { memory: Number(memory) }, save = towerSave(Number(memory));
    save.memoryStory = { act2Seen: [], visit: { beat: fragment.requires } };
    assert.eq(MemoryStory.panel(record, save).body, MemoryStory.SCENES[memory].body);
    save.memoryStory.act2Seen.push(fragment.requires);
    assert.eq(MemoryStory.panel(record, save).body, fragment.body);
    save.memoryStory.act3Started = true;
    assert.eq(MemoryStory.panel(record, save).body, MemoryStory.SCENES[memory].body);
  }
});

test('memory arc: ten milestones and the dragon declaration reuse existing art without early spoilers', () => {
  assert.eq(Object.keys(MemoryStory.SCENES).length, 10);
  const early = Object.values(MemoryStory.SCENES).map(p => p.body);
  assert.eq(early.filter(body => /watching you|being watched/.test(body)).length, 2);
  assert.falsy(/dragon|conquer/.test([...early, ...MemoryStory.ACT2.flatMap(beat => beat.pages.map(p => p.body))].join(' ')));
  assert.eq(MemoryStory.DRAGON_DECLARATION, 'I am a dragon, and so are you. We are the alpha species of the stars, and this planet is mine. You are my sword, nearly restored. Collect your fire breath on level 9 of the dungeon from the demons there.');
  for (const panel of [MemoryStory.HOME, MemoryStory.LOCKED, MemoryStory.ABANDONED, MemoryStory.EMPTY,
    ...Object.values(MemoryStory.SCENES), ...MemoryStory.AFTER, ...MemoryStory.INTRO, MemoryStory.FIRST_RETURN,
    ...MemoryStory.ACT2.flatMap(beat => beat.pages), ...Object.values(MemoryStory.ACT2_MEMORIES), ...MemoryStory.REVEAL]) {
    assert.truthy(webpDims('assets/art/' + panel.art + '.webp'), panel.art);
  }
});
})();
