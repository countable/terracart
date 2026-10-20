// Exercise the persistent narrative state machine without Phaser or purchases.
(function () {
const copy = value => JSON.parse(JSON.stringify(value));
const saveWith = (n = 0) => ({ memories: n, discovered: Object.fromEntries(
  Array.from({ length: n }, (_, i) => ['discovery:' + i, 1])) });
function sceneFor(save) {
  return { save, modals: [], offers: 0, depth: 0,
    startWorldM: { x: 100, y: 100 }, playerM: { x: 0, y: 0 },
    inHomeRing: (x, y) => Math.hypot(x - 100, y - 100) <= 28,
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
    assert.eq(panel.body.includes('Half-formed images, nothing is clear yet.'), n % 3 !== 0,
      'an ordinary memory says it is half-formed; a milestone scene does not');
    assert.truthy(panel.body && panel.art, 'post-thirty milestones remain complete scenes');
  }
  assert.eq(save.memories, 0, 'narrative does not grant or spend currency');
}));

test('memory arc: luxury panels preserve every numbered scene and the second-tower reveal gate', () => isolated(() => {
  for (const n of [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]) {
    const save = saveWith(n);
    const pending = MemoryStory.enqueue(save, n, 'Living like a Neighbour', 'luxury:4');
    MemoryStory.enqueue(save, n, 'duplicate', 'luxury:4');
    assert.eq(pending.length, 2, 'one domestic panel and one numbered scene, without duplicates');
    assert.eq(MemoryStory.panel(pending[0], save).title, 'Living like a Neighbour');
    assert.eq(MemoryStory.panel(pending[1], save).title, MemoryStory.SCENES[n].title);
    assert.eq(MemoryStory.panel(pending[1], save).body, MemoryStory.SCENES[n].body);
    assert.eq(save.memories, n, 'queuing the extra scene grants no extra memory');
    assert.falsy(save.memoryStory.act3Started, 'neither queued panel opens the reveal');
  }
  const save = towerSave(30, true);
  assert.eq(MemoryStory.wizardSequence(save, firstTower).kind, 'abandoned');
  assert.eq(MemoryStory.wizardSequence(save, secondTower).kind, 'reveal');
}));

test('memory arc: a luxury panel survives reload until acknowledged before its numbered scene', () => isolated(() => {
  const save = saveWith(3);
  MemoryStory.enqueue(save, 3, 'Living like a Craftsperson', 'luxury:16');
  const scene = sceneFor(copy(save));
  assert.truthy(MemoryStory.drain(scene));
  assert.eq(scene.modals[0].title, 'Living like a Craftsperson');
  assert.eq(scene.save.memoryStory.pending.length, 2, 'opening does not consume either page');
  dismiss(scene);
  assert.truthy(MemoryStory.drain(scene));
  assert.eq(scene.modals[1].title, MemoryStory.SCENES[3].title);
  dismiss(scene);
  assert.eq(scene.save.memoryStory.pending.length, 0);
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

test('memory arc: memories earned away wait through reload until home on the surface', () => isolated(() => {
  const scene = sceneFor(saveWith(6));
  MemoryStory.enqueue(scene.save, 6, 'a flower');
  scene.playerM.x = 500;
  assert.falsy(MemoryStory.drain(scene));
  assert.eq(scene.modals.length, 0);
  assert.eq(scene.save.memoryStory.pending.length, 1);
  const resumed = sceneFor(copy(scene.save));
  resumed.depth = 1;
  assert.falsy(MemoryStory.drain(resumed), 'underground coordinates are not Home');
  resumed.depth = 0;
  assert.truthy(MemoryStory.drain(resumed));
  assert.eq(resumed.modals[0].title, MemoryStory.SCENES[6].title);
  dismiss(resumed);
  assert.eq(resumed.save.memoryStory.pending.length, 0);
  assert.falsy(MemoryStory.drain(resumed), 'acknowledged once');
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
  assert.eq(scene.modals.length, 2); assert.eq(scene.offers, 1);
  assert.eq(scene.save.memories, 0);
}));

test('memory arc: intro stays pending until dismissal and resumes legacy section indexes', () => isolated(saved => {
  const scene = sceneFor(towerSave(9)); visit(scene);
  visit(scene); assert.eq(scene.modals.length, 1);
  assert.truthy(scene.modals[0].mustAcknowledge);
  assert.eq(scene.modals[0].sections.length, MemoryStory.INTRO.length);
  assert.falsy(scene.save.memoryStory.introDone);
  const legacy = copy(saved[saved.length - 1]); legacy.memoryStory.visit.page = 1;
  const resumed = sceneFor(legacy); visit(resumed);
  assert.eq(resumed.modals[0].sections[0].body, MemoryStory.INTRO[1].body);
  finish(resumed); assert.eq(resumed.modals.length, 1); assert.eq(resumed.offers, 1);
  visit(resumed);
  assert.truthy(resumed.modals[1].body.includes('help you remember the right things'));
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
  assert.eq(scene.modals[1].sections[0].body, MemoryStory.FIRST_RETURN.body);
  assert.eq(scene.save.memoryStory.visit.beats.length, 5); finish(scene);
  assert.eq(scene.save.memoryStory.act2Seen.length, 5);
  visit(scene); assert.eq(scene.save.memoryStory.visit.kind, 'visit'); finish(scene);
}));

test('memory arc: pending bundled milestones keep frozen selection and ignore repeated dismissal', () => isolated(saved => {
  const scene = introduced(15); visit(scene);
  const currentPage = scene.save.memoryStory.visit.page;
  const resumed = sceneFor(copy(saved[saved.length - 1])); earnTo(resumed.save, 18); visit(resumed);
  assert.eq(resumed.save.memoryStory.visit.page, currentPage);
  assert.falsy(resumed.save.memoryStory.visit.beats.includes('hesitation'));
  const final = resumed.modals[0];
  finish(resumed);
  const offers = resumed.offers;
  final.onDismiss(); assert.eq(resumed.offers, offers);
  visit(resumed); assert.truthy(resumed.save.memoryStory.visit.beats.includes('hesitation')); finish(resumed);
}));

test('memory arc: abandonment at twenty-one overrides an interrupted introduction and prevents upgrades', () => isolated(saved => {
  const scene = sceneFor(towerSave(20)); visit(scene);
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
  assert.truthy(resumed.modals[1].sections.some(section => section.body.includes(MemoryStory.DRAGON_DECLARATION)));
  const reloaded = sceneFor(copy(saved[saved.length - 1])); visit(reloaded, secondTower);
  assert.eq(reloaded.modals[0].sections[0].body, MemoryStory.REVEAL[0].body);
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

test('memory arc: failed conversation remains retryable without acknowledgement', () => isolated(() => {
  const scene = sceneFor(towerSave(9));
  scene.showMessageModal = () => { throw new Error('modal unavailable'); };
  let threw = false; try { visit(scene); } catch (_) { threw = true; }
  assert.truthy(threw); assert.falsy(scene._wizardStoryOpen);
  assert.eq(scene.save.memoryStory.visit.page, 0);
  assert.falsy(scene.save.memoryStory.introDone);
  scene.showMessageModal = panel => scene.modals.push(panel);
  visit(scene); assert.eq(scene.modals[0].sections[0].body, MemoryStory.INTRO[0].body); finish(scene);
}));

test('memory arc: stale acknowledgement stops before later sections or completion', () => {
  const shown = [], acknowledged = []; let completed = false;
  MemoryStory.showPages({ showMessageModal: panel => shown.push(panel) }, ['first', 'second', 'third'], {
    from: 1, onTurn: i => { acknowledged.push(i); return false; }, onDone: () => { completed = true; },
  });
  assert.eq(shown.length, 1); assert.eq(shown[0].body, 'second\n\nthird');
  assert.eq(acknowledged.length, 0, 'opening does not acknowledge');
  shown[0].onDismiss(); shown[0].onDismiss();
  assert.eq(acknowledged.join(), '1'); assert.falsy(completed);
});

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

test('memory arc: ten milestones and the dragon declaration have painted art and no early spoilers', () => {
  assert.eq(Object.keys(MemoryStory.SCENES).length, 10);
  assert.includes(MemoryStory.REVEAL[0].body, 'The wizard stays seated');
  assert.includes(MemoryStory.REVEAL[0].body, 'human shape is all he has left');
  assert.falsy(/wings|red scales|nearly killed/.test(MemoryStory.REVEAL.map(p => p.body).join(' ')),
    "Tim has not regained dragon form; Hood's lost form is not blamed on battle wounds");
  const early = Object.values(MemoryStory.SCENES).map(p => p.body);
  assert.eq(early.filter(body => /watching you|being watched/.test(body)).length, 2);
  assert.falsy(/dragon|conquer/.test([...early, ...MemoryStory.ACT2.flatMap(beat => beat.pages.map(p => p.body))].join(' ')));
  for (const fact of ['both dragons', 'ruling species of the stars', 'planet as his own', 'sword nearly restored', 'fire breath', 'demons on dungeon level 9']) {
    assert.includes(MemoryStory.DRAGON_DECLARATION, fact, 'revelation preserves ' + fact);
  }
  for (const panel of [MemoryStory.HOME, MemoryStory.LOCKED, MemoryStory.ABANDONED, MemoryStory.EMPTY,
    ...Object.values(MemoryStory.SCENES), ...MemoryStory.AFTER, ...MemoryStory.INTRO, MemoryStory.FIRST_RETURN,
    ...MemoryStory.ACT2.flatMap(beat => beat.pages), ...Object.values(MemoryStory.ACT2_MEMORIES), ...MemoryStory.REVEAL]) {
    assert.truthy(webpDims('assets/art/' + panel.art + '.webp'), panel.art);
  }
});
})();
