// Orrin's optional relationship follows acknowledged visits, not raw counters.
(function () {
const talk = save => MemoryStory.archaeologistConversation(save);
const answer = (save, choice = 'listen') => {
  const page = talk(save);
  const result = MemoryStory.acknowledgeArchaeologist(save, page.id, choice);
  assert.truthy(result, 'valid answer advances one conversation');
  return { page, result };
};
const copy = value => JSON.parse(JSON.stringify(value));
const forbidAct1History = text => assert.falsy(/Tiamat|Frost Dragon Queen|planet|star chart|stolen eggs|destroyed this world/i.test(text), 'acquaintance is not a history lesson');

test('Orrin: first encounter requires no memories or restorations and reading is pure', () => {
  const save = {};
  const before = JSON.stringify(save), page = talk(save);
  assert.eq(page.topic, 'introduction');
  assert.truthy(/Orrin.*Dragon archaeologist/.test(page.body));
  assert.truthy(/stool/.test(page.body));
  assert.eq(MemoryStory.npcDialogue({ save }, { role: 'archaeologist' }), page.body);
  assert.eq(JSON.stringify(save), before, 'neither render path writes state');
  assert.eq(talk(save).id, page.id);
  answer(save, 'doubt');
  assert.eq(save.memoryStory.archaeologist.visits, 1);
  assert.truthy(save.memoryStory.archaeologist.seen.introduction);
  assert.falsy(talk(save).topic === 'introduction');
});

test('Orrin: high memories, towers, books and legacy revealed flag cannot bypass Act 1', () => {
  const save = { discovered: Object.fromEntries(Array.from({ length: 90 }, (_, i) => ['thing-' + i, 1])),
    restoredHouses: { first: 'wizard', second: 'wizard' }, wizardTowers: { firstId: 'first', secondId: 'second' },
    books: ['all'], memoryStory: { revealed: true } };
  for (let i = 0; i < 30; i++) {
    const { page, result } = answer(save, i % 2 ? 'doubt' : 'listen');
    forbidAct1History(page.body + ' ' + result.body);
  }
  assert.falsy(save.memoryStory.archaeologist.seen.peaceful_lives);
  assert.eq(save.memoryStory.archaeologist.visits, 30);
});

test('Orrin: actual tower introduction opens research one acknowledged topic at a time', () => {
  const save = { restoredHouses: { home: 'plain', second: 'plain' }, memoryStory: { introDone: true } };
  const topics = ['introduction', 'mending', 'peaceful_lives', 'hunting_accounts', 'other_planets', 'frost_queen', 'breaking_belief'];
  const heard = [];
  topics.forEach((topic, i) => {
    const page = talk(save);
    assert.eq(page.topic, topic);
    assert.eq(talk(save).id, page.id, 'repeated reads do not skip a topic');
    if (i < 5) assert.falsy(/Tiamat|Frost Dragon Queen/.test(page.body));
    if (topic === 'frost_queen') {
      assert.includes(page.body, 'Tiamat');
      assert.includes(page.body, 'Frost Dragon Queen');
      assert.includes(page.body, 'late wife');
      assert.includes(page.body, 'not why the war began');
    }
    heard.push(page.body, answer(save).result.body);
  });
  assert.eq(talk(save).topic, 'familiar');
  assert.falsy(/Tim is|your father|your sister|Ayo|you are a dragon/i.test(heard.join(' ')));
});

test('Orrin: completed legacy Act 3 reveal opens research but still requires meeting him', () => {
  const save = { memoryStory: { act3Started: true } };
  assert.eq(talk(save).topic, 'introduction');
  answer(save);
  assert.eq(talk(save).topic, 'peaceful_lives');
});

test('Orrin: reload preserves choices and stale or invalid acknowledgements never advance', () => {
  const save = {};
  const page = talk(save), untouched = JSON.stringify(save);
  assert.eq(MemoryStory.acknowledgeArchaeologist(save, page.id, 'invented'), null);
  assert.eq(MemoryStory.acknowledgeArchaeologist(save, 'old-id', 'listen'), null);
  assert.eq(JSON.stringify(save), untouched);
  answer(save, 'doubt');
  const reloaded = copy(save), state = JSON.stringify(reloaded);
  assert.eq(talk(reloaded).id, talk(save).id);
  assert.eq(MemoryStory.acknowledgeArchaeologist(reloaded, page.id, 'listen'), null);
  assert.eq(JSON.stringify(reloaded), state, 'double click after reload is still stale');
  assert.eq(reloaded.memoryStory.archaeologist.seen.introduction.choice, 'doubt');
});

test('Orrin: questions and contradiction advance the same friendship as agreement', () => {
  const listening = { memoryStory: { introDone: true } }, questioning = copy(listening);
  answer(listening); answer(questioning, 'doubt');
  for (let i = 0; i < 5; i++) {
    assert.eq(talk(listening).topic, talk(questioning).topic);
    const result = answer(questioning, 'contradict').result;
    assert.truthy(result.body.length > 20);
    answer(listening);
    assert.eq(listening.memoryStory.archaeologist.visits, questioning.memoryStory.archaeologist.visits);
  }
  assert.eq(talk(listening).topic, 'familiar');
  assert.eq(talk(questioning).topic, 'familiar');
  assert.falsy('affection' in questioning.memoryStory.archaeologist);
});

test('Orrin: mending and discoveries change later welcomes without inventing plot events', () => {
  const save = { memoryStory: { introDone: true, act3Started: true }, restoredHouses: {}, discovered: {} };
  for (let i = 0; i < 6; i++) answer(save);
  assert.eq(talk(save).topic, 'familiar');
  save.restoredHouses.a = 'plain';
  assert.eq(talk(save).topic, 'familiar', 'one roof does not unlock early mending');
  save.restoredHouses.b = 'plain';
  assert.eq(talk(save).topic, 'mending');
  answer(save);
  save.restoredHouses.c = 'plain';
  assert.includes(talk(save).body, 'Another roof');
  answer(save);
  save.discovered.flower = 1;
  assert.includes(talk(save).body, 'something new');
  for (let i = 0; i < 12; i++) {
    const { page, result } = answer(save);
    assert.falsy(/tower attack|white one|spoke dragon|your father|your sister|Ayo|you are a dragon/i.test(page.body + result.body));
  }
});

test('Orrin: old and malformed relationship state recovers without touching other progress', () => {
  for (const old of [undefined, null, [], 'old', { visits: NaN, seen: [] }]) {
    const save = { memoryStory: { introDone: true, act2Seen: ['right_order'], archaeologist: old } };
    const page = talk(save);
    assert.eq(page.topic, 'introduction');
    assert.truthy(MemoryStory.acknowledgeArchaeologist(save, page.id, 'listen'));
    assert.eq(save.memoryStory.introDone, true);
    assert.eq(save.memoryStory.act2Seen[0], 'right_order');
    assert.eq(save.memoryStory.archaeologist.visits, 1);
  }
});
test('Orrin: a remembered question changes a later research welcome', () => {
  const save = { memoryStory: { introDone: true } };
  answer(save); answer(save, 'doubt'); answer(save);
  assert.eq(talk(save).topic, 'other_planets');
  assert.includes(talk(save).body, 'I kept your question');
});

test('Orrin: acknowledged legacy topics stay complete after Bryn thanks the first roof', () => {
  const save = { restoredHouses: { one: 'plain' }, memoryStory: { wardenMet: true } };
  assert.eq(MemoryStory.npcDialogue({ save }, { role: 'warden' }), MemoryStory.FIRST_ROOF);
  save.restoredHouses.two = 'plain';
  assert.eq(MemoryStory.npcDialogue({ save }, { role: 'warden' }), MemoryStory.FIRST_ROOF);
  const legacy = { restoredHouses: { one: 'plain' }, memoryStory: {
    archaeologist: { visits: 2, seen: { introduction: { choice: 'listen' }, mending: { choice: 'listen' } } },
  } };
  assert.eq(talk(legacy).topic, 'labels');
  legacy.restoredHouses.two = 'plain';
  assert.eq(talk(legacy).topic, 'labels', 'the mending topic never replays');
});

test('Orrin: warden reputation follows meeting him and preserves the opening instructions', () => {
  const save = { restoredHouses: { home: 'plain', second: 'plain' }, memoryStory: { wardenMet: true } };
  const c = { role: 'warden' };
  const before = MemoryStory.npcDialogue({ save }, c);
  assert.falsy(/Orrin/.test(before));
  answer(save);
  const after = MemoryStory.npcDialogue({ save }, c);
  assert.truthy(after.startsWith(before));
  assert.includes(after, 'His dragon talk could get someone hurt.');
  save.restoredHouses = {};
  assert.eq(MemoryStory.npcDialogue({ save }, c), '“Mend a house. We’ll help.”');
});

})();
