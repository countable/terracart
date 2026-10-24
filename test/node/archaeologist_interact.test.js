// The relationship advances through an acknowledged reply, not a portrait read.
(function () {
const speaker = () => ({ kind: 'npc', id: 'orrin-ui', name: 'Orrin', role: 'archaeologist', roleLabel: 'Dragon archaeologist', _portrait: 'portrait' });
const scene = save => ({ save, offers: [], replies: [], _dialogOpen: () => false,
  addToInv(id, qty) { return Inventory.add(save, id, qty).accepted; },
  showChestRewardModal(m) { this.offers.push(m); }, showMessageModal(m) { this.replies.push(m); } });

test('Orrin interaction: opening and leaving preserve the first conversation', () => {
  const save = {}, s = scene(save), c = speaker();
  const initial = MemoryStory.archaeologistConversation(save);
  NPC.interact(s, c, 0, 0);
  assert.eq(s.offers.length, 1);
  assert.eq(s.offers[0].sub, initial.body);
  assert.eq(MemoryStory.archaeologistConversation(save).id, initial.id);
  s.offers[0].actions.find(a => a.label === 'Another time').onClick();
  assert.eq(MemoryStory.archaeologistConversation(save).id, initial.id, 'leaving does not spend the introduction');
  assert.eq(s.replies.length, 0);
});

test('Orrin interaction: a reply persists once and uses the NPC portrait', () => {
  const s = scene({}), c = speaker();
  const persist = globalThis.persistSave;
  const saves = [];
  globalThis.persistSave = save => saves.push(JSON.stringify(save));
  try {
    NPC.interact(s, c, 0, 0);
    const first = s.offers[0].actions[0];
    first.onClick();
    assert.eq(saves.length, 1);
    assert.eq(s.offers.length, 2);
    assert.eq(s.offers[1].portrait, 'assets/portraits/archaeologist.png', 'dedicated character portrait overrides the cached sprite portrait');
    assert.truthy(s.offers[1].sub);
    assert.eq(s.offers[1].name, itemName('table_oak'));
    first.onClick();
    assert.eq(saves.length, 1, 'a double click cannot advance a second conversation');
    assert.eq(s.offers.length, 2);
    const restored = JSON.parse(saves[0]);
    assert.eq(MemoryStory.archaeologistConversation(restored).id, MemoryStory.archaeologistConversation(s.save).id);
    NPC.interact(s, c, 0, 0);
    assert.eq(Inventory.count(restored, 'table_oak'), 1, 'gift persists with the introduction');
    assert.truthy(s.offers[2].sub !== s.offers[0].sub, 'returning visitor gets the next encounter');
  } finally { globalThis.persistSave = persist; }
});

test('Orrin interaction: busy screens and wounds preserve relationship state', () => {
  const s = scene({}), c = speaker();
  const id = MemoryStory.archaeologistConversation(s.save).id;
  s._dialogOpen = () => true;
  NPC.interact(s, c, 0, 0);
  assert.eq(s.offers.length, 0);
  s._dialogOpen = () => false;
  s.save.npcRestUntil = { [c.id]: Date.now() + 60000 };
  NPC.interact(s, c, 0, 0);
  assert.eq(s.offers.length, 0);
  assert.eq(s.replies[0].body, NPC.RESTING_LINE);
  assert.eq(MemoryStory.archaeologistConversation(s.save).id, id);
});
})();
