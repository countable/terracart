// Portrait selection follows gameplay identity without asking Phaser for pixels.
test('character portraits: every portrait ships as a 128px square and sheets have sixteen cells', () => {
  for (const id of [...CharacterPortraits.PET_IDS, ...CharacterPortraits.NPC_IDS]) {
    const size = pngDims(`assets/portraits/${id}.png`);
    assert.truthy(size, id);
    assert.eq(size.w, 128, id);
    assert.eq(size.h, 128, id);
  }
  for (const sheet of ['pets', 'npcs-1', 'npcs-2']) {
    const size = pngDims(`assets/portraits/${sheet}.png`);
    assert.eq(size.w, 512, sheet);
    assert.eq(size.h, 512, sheet);
  }
});

test('character portraits: pet variants share canonical portraits, enemies retain sprite fallback', () => {
  for (const id of CharacterPortraits.PET_IDS) assert.eq(CharacterPortraits.pet(id), `assets/portraits/${id}.png`);
  assert.eq(CharacterPortraits.pet('shiny_cat'), CharacterPortraits.pet('cat'));
  assert.eq(CharacterPortraits.pet('shiny_baby_cat'), CharacterPortraits.pet('baby_cat'));
  assert.eq(CharacterPortraits.pet('baby_chicken'), CharacterPortraits.pet('chicken'));
  assert.eq(CharacterPortraits.pet('goblin'), null);
  assert.eq(CharacterPortraits.pet('baby_goblin'), null);
});

test('character portraits: every authored role and culture resolves its matching face', () => {
  for (const sheet of SpriteLayout.NPC_SHEETS.filter(s => s.role)) {
    for (const culture of sheet.cultures || ['village']) {
      const url = CharacterPortraits.npc({ role: sheet.role, culture });
      const slug = sheet.cultures ? sheet.idle.replace(/^npc_/, '').replace(/_idle$/, '') : sheet.role;
      assert.eq(url, `assets/portraits/${slug}.png`, `${sheet.role} in ${culture}`);
    }
  }
  assert.eq(CharacterPortraits.npc({ role: 'wanderer' }, { housed: true }), 'assets/portraits/wanderer_housed.png');
  assert.eq(CharacterPortraits.npc({ role: 'wizard' }), 'assets/portraits/wizard.png');
});

test('character portraits: paged NPC speech retains the face through Next', () => {
  const shown = [];
  MemoryStory.showPages({ showMessageModal: options => shown.push(options) }, ['one', 'two'],
    { title: 'Neighbour', portrait: 'assets/portraits/mason.png' });
  assert.eq(shown[0].portrait, 'assets/portraits/mason.png');
  shown[0].onDismiss();
  assert.eq(shown[1].portrait, shown[0].portrait);
  assert.eq(shown[1].body, 'two');
});
