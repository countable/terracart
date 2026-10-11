// An enemy tap never picks a fight. It names the foe and, when the foe is
// catchable and its favourite is the DEFAULT tier gem (items.js
// favouriteItems → gemForTier), what catching it takes: "Goblin\nLoves
// Amethyst". A charmed creature, a story foe, and a kind with an explicit
// ANIMAL_FOOD favourite (the slimes' sapphire — the Book's riddle) show the
// name alone. Every rendered line fits MAP_MSG_MAX.
test('monster taps: a foe shows its name, plus its tier gem when catchable, within the map copy budget', () => {
  const original = { world: globalThis.WorldGen, reach: globalThis.cellInReach,
    cell: globalThis.worldMetersToAbsCell };
  const handler = TAP_HANDLERS.find(h => h.name === 'creature');
  let hints = 0;
  try {
    globalThis.cellInReach = () => true;
    globalThis.worldMetersToAbsCell = () => ({ cellIX: 0, cellIY: 0 });
    for (const kind of Combat.enemyKinds()) {
      // The serpent's head and tail tip take no tap (Combat.isConcealed).
      if (SpriteLayout.isSummoned(kind) || EnemyRoster.get(kind)?.untargetable) continue;
      for (const charmed of [false, true]) {
        const target = { kind, id: `test_${kind}`, x: 0, y: 0, _disguiseRevealed: true,
          _charmUntil: charmed ? Date.now() + 60000 : 0 };
        globalThis.WorldGen = { ...original.world,
          forEachItem: (layer, visit) => { if (layer === 'creatures') visit(target); } };
        const messages = [], save = { caught: [], inv: [], selSlot: -1 };
        const scene = Object.assign(makeScene(), { save, cellM: 7, cellPx: 32,
          flash: text => messages.push(text),
          startCombat: () => { throw new Error('A name tap must not start combat'); } });
        const span = SpriteLayout.creatureTapSpanPx(kind);
        const wm = { x: 0, y: (span.top + span.bottom) / 2 * scene.cellM / scene.cellPx };
        assert.eq(handler.try({ scene, save, wm, sx: 0, sy: 0 }), true, kind);
        assert.eq(messages.length, 1, kind);
        const species = Pets.species(kind), row = EnemyRoster.get(species);
        const hinted = !charmed && Pets.catchable(target) && !favouriteOverride(species);
        const name = row?.name || itemName(kind);   // a foe's roster name ("Green Slime")
        const expected = hinted ? `${name}\nLoves ${itemName(gemForTier(row.tier))}` : name;
        assert.eq(messages[0], expected, `${kind}${charmed ? ' (charmed)' : ''}`);
        if (hinted) hints++;
        for (const line of messages[0].split('\n')) assert.lte([...line].length, MAP_MSG_MAX, `${kind}: ${line}`);
        assert.eq(Inventory.count(save, 'apple'), 0, 'nothing given');
      }
    }
    assert.gt(hints, 10, 'the roster\'s foes name their gem');
  } finally {
    globalThis.WorldGen = original.world;
    globalThis.cellInReach = original.reach;
    globalThis.worldMetersToAbsCell = original.cell;
  }
});

test('monster taps: the hint is the tier gem, never the slimes\' riddle', () => {
  const original = { world: globalThis.WorldGen, reach: globalThis.cellInReach,
    cell: globalThis.worldMetersToAbsCell };
  const handler = TAP_HANDLERS.find(h => h.name === 'creature');
  const tapOnce = (kind, extra = {}) => {
    const target = { kind, id: `hint_${kind}`, x: 0, y: 0, _disguiseRevealed: true, ...extra };
    globalThis.WorldGen = { ...original.world,
      forEachItem: (layer, visit) => { if (layer === 'creatures') visit(target); } };
    const messages = [], save = { caught: [], inv: [], selSlot: -1 };
    const scene = Object.assign(makeScene(), { save, cellM: 7, cellPx: 32, flash: text => messages.push(text) });
    const span = SpriteLayout.creatureTapSpanPx(kind);
    handler.try({ scene, save, wm: { x: 0, y: (span.top + span.bottom) / 2 * scene.cellM / scene.cellPx }, sx: 0, sy: 0 });
    return messages[0];
  };
  try {
    globalThis.cellInReach = () => true;
    globalThis.worldMetersToAbsCell = () => ({ cellIX: 0, cellIY: 0 });
    assert.eq(tapOnce('goblin'), 'Goblin\nLoves Amethyst');
    for (const slime of ['slime', 'cave_slime', 'purple_slime']) {
      assert.eq(tapOnce(slime), EnemyRoster.get(slime).name, `${slime}: the sapphire stays a riddle`);
    }
    assert.eq(tapOnce('red_demon'), EnemyRoster.get('red_demon').name, 'a story foe is not catchable: name only');
    assert.eq(tapOnce('goblin', { storyEncounter: 'x' }), 'Goblin', 'a story encounter: name only');
  } finally {
    globalThis.WorldGen = original.world;
    globalThis.cellInReach = original.reach;
    globalThis.worldMetersToAbsCell = original.cell;
  }
});
