// Portrait selection follows gameplay identity without asking Phaser for pixels.
test('character portraits: every portrait ships as an 80px square and sheets have sixteen cells', () => {
  for (const id of [...CharacterPortraits.PET_IDS, ...CharacterPortraits.NPC_IDS]) {
    const size = pngDims(`assets/portraits/${id}.png`);
    assert.truthy(size, id);
    assert.eq(size.w, CharacterPortraits.CELL_PX, id);
    assert.eq(size.h, CharacterPortraits.CELL_PX, id);
  }
  for (const sheet of ['pets', 'npcs-1', 'npcs-2']) {
    const size = pngDims(`assets/portraits/${sheet}.png`);
    assert.eq(size.w, 320, sheet);
    assert.eq(size.h, 320, sheet);
  }
});

test('character portraits: speech bubbles draw the face at its cell size with pixelated edges', () => {
  // The bubble once shrank the 80px cell to a blurred 54px. It now shows the
  // cell 1:1, so the face reads at phone width and no resampling touches it.
  const px = `${CharacterPortraits.CELL_PX}px`;
  const rule = SPEECH_CSS_SRC.match(/^\.speech-dialog \.modal-portrait \{([^}]*)\}/m);
  assert.truthy(rule, 'the bubble sizes its portrait');
  assert.truthy(rule[1].includes(`width:${px}!important`), `width is the cell (${rule[1]})`);
  assert.truthy(rule[1].includes(`height:${px}!important`), `height is the cell (${rule[1]})`);
  assert.truthy(rule[1].includes(`flex:0 0 ${px}!important`), `the flex basis is the cell (${rule[1]})`);
  assert.falsy(/image-rendering/.test(rule[1]), 'the bubble keeps the shell\'s pixelated rendering');
  assert.truthy(/image\.className = 'modal-portrait';[\s\S]{0,600}image-rendering:pixelated;/.test(SCENE_SRC), 'the shell renders portraits pixelated');
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

test('character portraits: scrolling NPC speech retains one face for all paragraphs', () => {
  const shown = [];
  MemoryStory.showPages({ showMessageModal: options => shown.push(options) }, ['one', 'two'],
    { ...NPC.speech({ name: 'Bryn', roleLabel: 'Mason' }), portrait: 'assets/portraits/mason.png' });
  assert.eq(shown[0].portrait, 'assets/portraits/mason.png');
  shown[0].onDismiss();
  assert.eq(shown.length, 1);
  // Every page keeps the role beside the name, without a separate title row.
  for (const page of shown) {
    assert.eq(page.kind, 'talk'); assert.eq(page.kindLabel, 'Bryn, Mason'); assert.eq(page.title, undefined);
  }
  assert.truthy(/talk:\s*\{ icon: '💬', label: 'Talk' \}/.test(SCENE_SRC), 'the talk kind is the chat bubble');
  assert.eq(shown[0].body, 'one\n\ntwo');
});
