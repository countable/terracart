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

function earnTo(save, count) {
  while (MemoryStory.total(save) < count) save.discovered['earned:' + MemoryStory.total(save)] = 1;
}
function returnedScene(n = 0) {
  const scene = sceneFor(saveWith(n)); visit(scene); finish(scene); visit(scene); finish(scene);
  return scene;
}

test('memory arc act two: each ordered beat requires its lifetime threshold and fresh discovery', () => isolated(() => {
  const scene = returnedScene();
  for (const beat of MemoryStory.ACT2) {
    const unlockAt = Math.max(beat.minMemories, scene.save.memoryStory.act2Memory + 1);
    earnTo(scene.save, unlockAt - 1);
    visit(scene);
    assert.falsy(scene.save.memoryStory.visit.kind === 'act2', 'below threshold remains a recap');
    finish(scene);
    earnTo(scene.save, unlockAt);
    scene.save.memories = 0;
    visit(scene);
    assert.eq(scene.save.memoryStory.visit.kind, 'act2');
    assert.eq(scene.save.memoryStory.visit.beat, beat.id, 'beats keep authored order');
    assert.falsy(scene.save.memoryStory.act2Seen.includes(beat.id), 'opening does not complete beat');
    assert.eq(scene.modals[scene.modals.length - 1].body, beat.pages[0].body);
    finish(scene);
    assert.truthy(scene.save.memoryStory.act2Seen.includes(beat.id));
    assert.eq(scene.save.memoryStory.act2Memory, unlockAt);
    for (let click = 0; click < 3; click++) {
      visit(scene);
      assert.falsy(scene.save.memoryStory.visit.kind === 'act2', 'repeat clicks do not advance plot');
      finish(scene);
    }
    assert.eq(scene.save.memories, 0, 'wizard story never spends memories');
  }
  assert.eq(scene.save.memoryStory.act2Seen.length, MemoryStory.ACT2.length);
}));

test('memory arc act two: late arrival cannot exhaust unlocked beats by repeatedly reopening', () => isolated(() => {
  const scene = returnedScene(27);
  visit(scene);
  assert.falsy(scene.save.memoryStory.visit.kind === 'act2', 'first return establishes lifetime baseline');
  finish(scene);
  earnTo(scene.save, 28); visit(scene);
  assert.eq(scene.save.memoryStory.visit.beat, MemoryStory.ACT2[0].id);
  finish(scene);
  for (let i = 0; i < 5; i++) {
    visit(scene); assert.falsy(scene.save.memoryStory.visit.kind === 'act2'); finish(scene);
  }
  assert.eq(scene.save.memoryStory.act2Seen.length, 1);
  earnTo(scene.save, 29); visit(scene);
  assert.eq(scene.save.memoryStory.visit.beat, MemoryStory.ACT2[1].id); finish(scene);
  earnTo(scene.save, 30); visit(scene);
  assert.eq(scene.save.memoryStory.visit.kind, 'reveal', 'unseen beats never delay the thirtieth-memory reveal');
  finish(scene); assert.truthy(scene.save.memoryStory.revealed);
}));

test('memory arc act two: interrupted beat retains selected pages after earning thirty and spending', () => isolated(saved => {
  const beat = MemoryStory.ACT2.find(entry => entry.pages.length > 1);
  assert.truthy(beat, 'act two has a scene with multiple pages');
  const scene = returnedScene();
  for (const prior of MemoryStory.ACT2) {
    if (prior.id === beat.id) break;
    earnTo(scene.save, Math.max(prior.minMemories, scene.save.memoryStory.act2Memory + 1)); visit(scene); finish(scene);
  }
  earnTo(scene.save, beat.minMemories); visit(scene); dismiss(scene);
  const persisted = copy(saved[saved.length - 1]);
  assert.eq(persisted.memoryStory.visit.beat, beat.id);
  assert.eq(persisted.memoryStory.visit.page, 1);
  assert.falsy(persisted.memoryStory.act2Seen.includes(beat.id));
  earnTo(persisted, 30); persisted.memories = 0;
  const resumed = sceneFor(persisted); visit(resumed);
  assert.eq(resumed.modals[0].body, beat.pages[1].body, 'reload resumes selected beat, not new threshold');
  finish(resumed);
  assert.truthy(resumed.save.memoryStory.act2Seen.includes(beat.id));
  assert.falsy(resumed.save.memoryStory.revealed, 'finish the interrupted story first');
  visit(resumed); assert.eq(resumed.save.memoryStory.visit.kind, 'reveal'); finish(resumed);
  assert.eq(resumed.save.memories, 0);
}));

test('memory arc act two: old pending visit has valid stable recap and no fabricated completion', () => isolated(() => {
  const save = saveWith(24);
  save.memoryStory = { introDone: true, visits: 8, visit: { kind: 'visit', page: 0, count: 8 } };
  const scene = sceneFor(save); visit(scene);
  assert.truthy(scene.modals[0].body);
  finish(scene);
  assert.eq(scene.save.memoryStory.act2Seen.length, 0, 'legacy recap never marks new authored scenes seen');
  visit(scene);
  assert.eq(scene.save.memoryStory.visit.beat, MemoryStory.ACT2[0].id, 'legacy save can begin the new arc');
  finish(scene);
}));

test('memory arc act two: stale dismissal cannot skip pages or offer the shop twice', () => isolated(() => {
  const scene = returnedScene();
  earnTo(scene.save, Math.max(1, MemoryStory.ACT2[0].minMemories)); visit(scene);
  const first = scene.modals[scene.modals.length - 1]; first.onDismiss();
  const count = scene.modals.length, page = scene.save.memoryStory.visit?.page;
  first.onDismiss();
  assert.eq(scene.modals.length, count); assert.eq(scene.save.memoryStory.visit?.page, page);
  const offers = scene.offers; finish(scene);
  const last = scene.modals[scene.modals.length - 1], completedOffers = scene.offers;
  last.onDismiss();
  assert.eq(scene.offers, completedOffers);
  assert.truthy(completedOffers >= offers);
  assert.eq(scene.save.memoryStory.act2Seen.filter(id => id === MemoryStory.ACT2[0].id).length, 1);
}));

test('memory arc act two: contradicting fragments require the particular wizard claim to be acknowledged', () => {
  for (const [memory, fragment] of Object.entries(MemoryStory.ACT2_MEMORIES)) {
    const record = { memory: Number(memory), label: 'a discovery' }, save = saveWith(Number(memory));
    const required = MemoryStory.ACT2.find(beat => beat.id === fragment.requires);
    assert.truthy(required, 'fragment prerequisite names an authored beat');
    const index = MemoryStory.ACT2.indexOf(required);
    save.memoryStory = { act2Seen: MemoryStory.ACT2.slice(0, index).map(beat => beat.id),
      visit: { kind: 'act2', beat: required.id, page: 0 } };
    assert.eq(MemoryStory.panel(record, save).body, MemoryStory.SCENES[memory].body,
      'opening the prerequisite without completing it does not change memories');
    save.memoryStory.act2Seen.push(required.id);
    assert.eq(MemoryStory.panel(record, save).body, fragment.body);
    save.memoryStory.revealed = true;
    assert.eq(MemoryStory.panel(record, save).body, MemoryStory.SCENES[memory].body,
      'the unresolved contradiction does not replace a memory after revelation');
  }
});

test('memory arc act two: survivors stay welcoming as acknowledged wizard scenes progress', () => {
  const save = saveWith(27);
  save.memoryStory = { introDone: true, act2Seen: [] };
  const scene = sceneFor(save); save.restoredHouses = { home: 1 };
  for (let i = 0; i <= MemoryStory.ACT2.length; i++) {
    save.memoryStory.act2Seen = MemoryStory.ACT2.slice(0, i).map(beat => beat.id);
    const expected = MemoryStory.SURVIVORS[Math.min(3, Math.floor(i / 2))];
    assert.eq(MemoryStory.npcDialogue(scene, { role: 'warden' }), expected);
    assert.eq(MemoryStory.npcDialogue(scene, { role: 'scout' }), expected);
    assert.eq(MemoryStory.npcDialogue(scene, { role: 'trader' }), null, 'other NPC roles keep their dialogue');
  }
  save.memoryStory.act2Seen = []; save.memoryStory.revealed = true;
  assert.eq(MemoryStory.survivorLine(save), MemoryStory.SURVIVORS[3]);
});

test('memory arc: ten authored milestones, two watched glimpses, and shipped art', () => {
  assert.eq(Object.keys(MemoryStory.SCENES).length, 10);
  const early = Object.values(MemoryStory.SCENES).map(p => p.body);
  assert.eq(early.filter(body => /watching you|being watched/.test(body)).length, 2);
  assert.falsy(/dragon|conquer/.test([...early, ...MemoryStory.INTRO.map(p => p.body), ...MemoryStory.ACT2.flatMap(beat => beat.pages.map(p => p.body))].join(' ')),
    'early scenes do not name the final twist');
  const panels = [MemoryStory.HOME, ...Object.values(MemoryStory.SCENES), ...MemoryStory.AFTER,
    ...MemoryStory.INTRO, MemoryStory.FIRST_RETURN, ...MemoryStory.ACT2.flatMap(beat => beat.pages), ...Object.values(MemoryStory.ACT2_MEMORIES), ...MemoryStory.REVEAL,
    MemoryStory.panel({ memory: 1, label: 'a flower' })];
  for (const panel of panels) assert.truthy(webpDims('assets/art/' + panel.art + '.webp'), panel.art);
  const reveal = MemoryStory.REVEAL.map(p => p.body).join(' ');
  for (const phrase of ['Warmonger', 'dragon', 'It was you', 'at his command', 'nearly killed',
    'your memory', 'conquer the other worlds']) assert.truthy(reveal.includes(phrase), phrase);
});
})();
