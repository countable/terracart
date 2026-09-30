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
function visit(scene) { MemoryStory.visitWizard(scene, () => scene.offers++); }
function dismiss(scene) { scene.modals[scene.modals.length - 1].onDismiss(); }
function finish(scene) {
  for (let guard = 0; scene._wizardStoryOpen && guard < 10; guard++) dismiss(scene);
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

test('memory arc: three-page wizard introduction resumes at the unacknowledged page', () => isolated(saved => {
  const scene = sceneFor(saveWith(12)); visit(scene);
  assert.eq(scene.modals[0].body, MemoryStory.INTRO[0].body);
  assert.truthy(scene.modals[0].mustAcknowledge);
  visit(scene); assert.eq(scene.modals.length, 1, 'duplicate interaction does not restart');
  dismiss(scene);
  assert.eq(saved[saved.length - 1].memoryStory.visit.page, 1);
  const resumed = sceneFor(copy(saved[saved.length - 1])); visit(resumed);
  assert.eq(resumed.modals[0].body, MemoryStory.INTRO[1].body);
  dismiss(resumed);
  assert.eq(resumed.modals[1].body, MemoryStory.INTRO[2].body);
  assert.eq(resumed.offers, 0, 'shop waits until all three pages are acknowledged');
  dismiss(resumed);
  assert.eq(resumed.offers, 1); assert.truthy(resumed.save.memoryStory.introDone);
  assert.eq(resumed.save.memoryStory.visits, 1); assert.eq(resumed.save.memoryStory.visit, null);
  assert.eq(resumed.save.memories, 12);
}));

test('memory arc: a later wizard page failure preserves progress and permits retry', () => isolated(() => {
  const scene = sceneFor(saveWith(3)); visit(scene);
  scene.showMessageModal = () => { throw new Error('modal unavailable'); };
  let threw = false;
  try { dismiss(scene); } catch (_) { threw = true; }
  assert.truthy(threw); assert.falsy(scene._wizardStoryOpen);
  assert.eq(scene.save.memoryStory.visit.page, 1);
  scene.showMessageModal = panel => scene.modals.push(panel);
  visit(scene);
  assert.eq(scene.modals[1].body, MemoryStory.INTRO[1].body);
  finish(scene); assert.eq(scene.offers, 1);
}));

test('memory arc: first return promises the right things without requiring a purchase', () => isolated(() => {
  const scene = sceneFor(saveWith(0)); visit(scene); finish(scene);
  visit(scene);
  assert.truthy(scene.modals[3].body.includes('I can help you remember the right things.'));
  finish(scene);
  assert.eq(scene.save.memoryStory.visits, 2); assert.eq(scene.save.memories, 0);
  visit(scene);
  assert.eq(scene.modals[4].title, 'More important work');
  assert.truthy(scene.modals[4].body); finish(scene);
}));

test('memory arc: memory thirty asks for a return but does not itself reveal the dragon', () => isolated(() => {
  const scene = sceneFor(saveWith(30)); MemoryStory.enqueue(scene.save, 30);
  MemoryStory.drain(scene);
  assert.truthy(scene.modals[0].body.includes('Return to the wizard.'));
  assert.falsy(/dragon|conquer/i.test(scene.modals[0].body));
  dismiss(scene); assert.falsy(scene.save.memoryStory.revealed);
  visit(scene); finish(scene);
  assert.eq(scene.modals.length, 4, 'first meeting still has only the three introductory pages');
  assert.falsy(scene.save.memoryStory.revealed);
}));

test('memory arc: first return at thirty includes promise then full reveal and survives reload', () => isolated(saved => {
  const scene = sceneFor(saveWith(30)); visit(scene); finish(scene); visit(scene);
  assert.eq(scene.modals[3].body, MemoryStory.FIRST_RETURN.body);
  dismiss(scene);
  assert.eq(scene.modals[4].body, MemoryStory.REVEAL[0].body);
  dismiss(scene);
  const resumed = sceneFor(copy(saved[saved.length - 1])); visit(resumed);
  assert.eq(resumed.modals[0].body, MemoryStory.REVEAL[1].body);
  assert.falsy(resumed.save.memoryStory.revealed);
  finish(resumed);
  assert.truthy(resumed.save.memoryStory.revealed);
  assert.eq(resumed.offers, 1); assert.eq(resumed.save.memories, 30);
  visit(resumed); finish(resumed);
  assert.eq(resumed.modals.length, 3, 'subsequent return has one ordinary page');
  assert.eq(resumed.modals[2].title, 'A silence between you');
}));

test('memory arc: later return reveals at thirty lifetime memories even when none remain unspent', () => isolated(() => {
  const scene = sceneFor(saveWith(29)); visit(scene); finish(scene); visit(scene); finish(scene);
  visit(scene); finish(scene); assert.falsy(scene.save.memoryStory.revealed);
  scene.save.discovered.thirtieth = 1; scene.save.memories = 0;
  const before = scene.modals.length; visit(scene); finish(scene);
  assert.eq(scene.modals.length - before, 3);
  assert.truthy(scene.save.memoryStory.revealed); assert.eq(scene.save.memories, 0);
}));

test('memory arc: ten authored milestones, two watched glimpses, and shipped art', () => {
  assert.eq(Object.keys(MemoryStory.SCENES).length, 10);
  const early = Object.values(MemoryStory.SCENES).map(p => p.body);
  assert.eq(early.filter(body => /watching you|being watched/.test(body)).length, 2);
  assert.falsy(/dragon|conquer/.test([...early, ...MemoryStory.INTRO.map(p => p.body)].join(' ')),
    'early scenes do not name the final twist');
  const panels = [MemoryStory.HOME, ...Object.values(MemoryStory.SCENES), ...MemoryStory.AFTER,
    ...MemoryStory.INTRO, MemoryStory.FIRST_RETURN, ...MemoryStory.REVEAL,
    MemoryStory.panel({ memory: 1, label: 'a flower' })];
  for (const panel of panels) assert.truthy(webpDims('assets/art/' + panel.art + '.webp'), panel.art);
  const reveal = MemoryStory.REVEAL.map(p => p.body).join(' ');
  for (const phrase of ['Warmonger', 'dragon', 'It was you', 'at his command', 'nearly killed',
    'your memory', 'conquer the other worlds']) assert.truthy(reveal.includes(phrase), phrase);
});
})();
