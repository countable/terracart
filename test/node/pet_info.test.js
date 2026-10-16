(() => {
  const Scene = new Function('CharacterPortraits', `${ALL_SRC['scene_pets.js']}; return ScenePets;`)({
    pet: kind => kind === 'dog' ? 'dog-portrait.png' : null,
  });
  const element = tag => ({ tag, style: {}, children: [], events: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(event, fn) { this.events[event] = fn; },
    remove() { this.removed = true; },
    click() { this.events.click?.({ stopPropagation() {} }); },
  });
  function open(kind, check) {
    const original = document.createElement;
    document.createElement = element;
    try {
      const scene = new Scene();
      scene.save = { released: [], wildAnimals: [], caught: [], inv: [] };
      const pet = Pets.bond(scene.save, { id: 'info-test', kind, x: 1, y: 1, _hp: 2 });
      pet.bonuses.attack = 3;
      pet.accessories.collar = 'pet_collar';
      const shell = { wrap: element('div'), box: element('div'), mounted: false };
      scene.makeModalShell = (id, options) => {
        shell.id = id; shell.options = options;
        return { ...shell, mount() { shell.mounted = true; },
          mkBtn: label => Object.assign(element('button'), { textContent: label }) };
      };
      scene.renderItemIcon = (id, size) => Object.assign(element('sprite'), { id, size });
      scene.presentPetMenu = id => { scene.returnedTo = id; };
      scene.presentPetInfo(pet.id);
      check(scene, shell, pet);
    } finally { document.createElement = original; }
  }

  test('pet feeding: PetNip is offered, consumed once and opens standard pleased speech', () => {
    open('dog', (scene, _shell, pet) => {
      Inventory.add(scene.save,'petnip',2);
      scene.iconSpanHTML = (id,size) => `<span data-kind="${id}" data-size="${size}"></span>`;
      scene._petChanged = () => {};
      let offer, speech;
      scene.showOfferModal = options => { offer=options; };
      scene.showMessageModal = options => { speech=options; };
      scene.presentPetFoodMenu(pet.id);
      assert.truthy(offer.choices.find(c => c.key === 'petnip'));
      offer.onAccept('petnip');
      assert.eq(Inventory.count(scene.save,'petnip'),1);
      assert.eq(pet.bonuses.maxHp,1);
      assert.eq(speech.kind,'talk'); assert.truthy(speech.body.includes('dog-portrait.png'));
      assert.truthy(speech.body.includes('width="128"'), 'large art stays in the speech body');
      assert.truthy(speech.body.includes('pleased'));
      speech.onDismiss(); assert.eq(scene.returnedTo,pet.id);
    });
  });
  test('pet feeding: converted enemies get large sprite art in pleased speech', () => {
    open('goblin', (scene, _shell, pet) => {
      scene.iconSpanHTML = (id,size) => `${id}:${size}`;
      let speech; scene.showMessageModal = options => { speech=options; };
      scene.presentPetPleased(pet.id,'petnip');
      assert.eq(speech.kind,'talk'); assert.truthy(speech.body.includes('goblin:128'));
    });
  });
  test('pet info: individual HP and damage include bonuses and accessories', () => {
    open('dog', (scene, shell, pet) => {
      assert.truthy(shell.mounted);
      assert.eq(shell.id, 'pet-info-modal');
      const portrait = shell.box.children.find(c => c.tag === 'div').children[0];
      assert.eq(portrait.src, 'dog-portrait.png');
      assert.eq(portrait.width, 128);
      assert.eq(portrait.alt, itemName(pet.kind));
      const stats = shell.box.children.find(c => c.tag === 'dl').children;
      assert.eq(stats[1].textContent, `${pet.hp} / ${Combat.maxHp(pet)}`);
      assert.eq(stats[3].textContent, String(Combat.petBlow(pet)));
      assert.truthy(shell.box.children.find(c => c.tag === 'p').textContent.includes('loyal'));
      shell.box.children.find(c => c.tag === 'button').click();
      assert.truthy(shell.wrap.removed);
      assert.eq(scene.returnedTo, pet.id);
    });
  });

  test('pet info: converted enemies use their existing main sprite', () => {
    open('goblin', (_scene, shell) => {
      const sprite = shell.box.children.find(c => c.tag === 'div').children[0];
      assert.eq(sprite.tag, 'sprite');
      assert.eq(sprite.id, 'goblin');
      assert.eq(sprite.size, 128);
    });
  });

  test('pet info: the selected pet menu opens information for that individual', () => {
    open('dog', (scene, shell, pet) => {
      shell.box.children.length = 0;
      scene.presentPetInfo = id => { scene.openedInfoFor = id; };
      Scene.prototype.presentPetMenu.call(scene, pet.id);
      const action = shell.box.children.find(c => c.textContent === 'View info');
      assert.truthy(action);
      action.click();
      assert.truthy(shell.wrap.removed);
      assert.eq(scene.openedInfoFor, pet.id);
    });
  });

  test('pet info: capture Close returns to the map without opening an inventory menu', () => {
    open('dog', (scene, shell, pet) => {
      shell.box.children.length = 0;
      scene.presentPetInfo(pet.id, { fromCatch: true });
      const close = shell.box.children.find(c => c.textContent === 'Close');
      assert.truthy(close);
      close.click();
      assert.truthy(shell.wrap.removed);
      assert.falsy(scene.returnedTo);
    });
  });
})();
