(() => {
  test('elevators: progress is per floor and the first low quota tier after nine opens unlocks it', () => {
    const save = {};
    for (let i = 0; i < 9; i++) assert.falsy(Elevators.recordChest(save, 3, i % 5 + 1));
    assert.eq(Elevators.unlockedFloors(save).length, 0);
    assert.falsy(Elevators.recordChest(save, 3, 5), 'a rare chest still has its normal loot');
    assert.falsy(Elevators.recordChest(save, 2, 1), 'another floor starts its own count');
    assert.truthy(Elevators.recordChest(save, 3, 2));
    assert.eq(Elevators.unlockedFloors(save).join(','), '3');
    assert.eq(save.elevators.chests[3], 11);
    assert.falsy(Elevators.recordChest(save, 3, 1), 'parts awarded only once');
    const restored = JSON.parse(JSON.stringify(save));
    SaveState.normalize(restored);
    assert.eq(Elevators.unlockedFloors(restored).join(','), '3');
    assert.eq(restored.elevators.chests[2], 1);
    for (const depth of [0, -1, 1.5, undefined]) assert.falsy(Elevators.recordChest(save, depth, 1));
    assert.eq(Object.keys(save.elevators.chests).sort().join(','), '2,3');
  });

  const chest = (id, depth = 1, tierSeed = 1) => ({ id, kind: 'chest', depth, tierSeed,
    x: 0, y: 0, fixedLoot: { id: 'potato', qty: 1 } });
  test('elevators: actual chest claims count once; parts consume the tenth chest even with a full bag', () => {
    const save = { opened: [], relics: {}, armor: {} };
    let room = 9, story, rewards = 0;
    const scene = makeScene({ invRoomFor: () => room, showChestRewardModal() { rewards++; },
      showMessageModal(m) { story = m; } });
    const ctx = makeCtx(scene, save);
    for (let i = 0; i < 9; i++) INTERACTABLES.chest.custom(ctx, chest('elevator_ordinary_' + i));
    assert.eq(rewards, 9);
    assert.eq(save.elevators.chests[1], 9);
    INTERACTABLES.chest.custom(ctx, chest('elevator_ordinary_0'));
    assert.eq(save.elevators.chests[1], 9, 'reopening is not progress');
    room = 0;
    INTERACTABLES.chest.custom(ctx, chest('elevator_parts'));
    assert.eq(story.body, 'You found the elevator parts for this floor! Now you can return here from home.');
    assert.eq(story.kind, 'story');
    assert.eq(rewards, 9, 'parts replace random loot');
    assert.eq(save.elevators.chests[1], 10);
    assert.eq(Elevators.unlockedFloors(save).join(','), '1');
    assert.includes(save.opened, 'elevator_parts');
    assert.truthy(ctx.dirty, 'the claim and route are persisted by the tap driver');
  });

  test('elevators: deep floors use the quota tier so depth bonuses cannot prevent parts', () => {
    const save = { opened: [], elevators: { chests: { 8: 9 }, floors: [] } };
    const low = chest('elevator_deep', 8, 2);
    assert.gt(chestTier(low), 2, 'deep chest displays a higher loot tier');
    let story;
    INTERACTABLES.chest.custom(makeCtx(makeScene({ showMessageModal(m) { story = m; } }), save), low);
    assert.eq(story.body, Elevators.PARTS_STORY);
    assert.eq(Elevators.unlockedFloors(save).join(','), '8');
  });

  test('elevators: leaving loot, smashing barrels and opening surface chests do not advance a floor', () => {
    const save = { opened: [], relics: {}, armor: {} };
    let modal;
    const scene = makeScene({ invRoomFor: () => 0, showChestRewardModal(m) { modal = m; } });
    const ctx = makeCtx(scene, save);
    const held = chest('elevator_held');
    INTERACTABLES.chest.custom(ctx, held);
    modal.actions[0].onClick();
    assert.falsy(save.elevators, 'a left chest was not spent');
    INTERACTABLES.chest.custom(ctx, { ...chest('elevator_barrel'), barrel: true });
    assert.falsy(save.elevators, 'a smashed barrel is not an opened chest');
    INTERACTABLES.chest.custom(ctx, chest('elevator_surface', 0));
    modal.actions[1].onClick();
    assert.falsy(save.elevators, 'surface opens are irrelevant');
    INTERACTABLES.chest.custom(ctx, held);
    modal.actions[1].onClick();
    assert.eq(save.elevators.chests[1], 1, 'discarding the held loot finally spends that chest');
  });
})();
