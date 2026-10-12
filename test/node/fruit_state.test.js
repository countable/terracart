(() => {
  const day = 24 * 60 * 60 * 1000;
  // A fruit stage is a quarter of the shared one-day window: six hours.
  const stage = Crops.FRUIT_STAGE_MS;
  const planted = { planted: true, planted_t: 1000 };

  test('fruit state: wild trees are immediately ready until picked', () => {
    const state = Crops.fruitTreeState({}, undefined, 1000);
    assert.eq(state.stage, 4);
    assert.eq(state.mature, true);
    assert.eq(state.ready, true);
    assert.eq(state.remainingMs, 0);
  });

  test('fruit state: fruit and timber saplings share one one-day window', () => {
    assert.eq(Crops.FRUIT_STAGE_MS * 4, PLANTED_TREE_GROW_MS);
    assert.eq(PLANTED_TREE_GROW_MS, day, 'a sapling is grown in a day');
  });

  test('fruit state: planted trees advance every six hours and mature at one day', () => {
    for (let s = 0; s < 4; s++) {
      const state = Crops.fruitTreeState(planted, undefined, 1000 + s * stage);
      assert.eq(state.stage, s);
      assert.eq(state.mature, false);
      assert.eq(state.ready, false);
      assert.eq(state.remainingMs, (4 - s) * stage);
    }
    const before = Crops.fruitTreeState(planted, undefined, 1000 + day - 1);
    assert.eq(before.stage, 3);
    assert.eq(before.remainingMs, 1);
    const ripe = Crops.fruitTreeState(planted, undefined, 1000 + day);
    assert.eq(ripe.stage, 4);
    assert.eq(ripe.ready, true);
    assert.eq(ripe.remainingMs, 0);
  });

  test('fruit state: a pick regrows exactly after 24 hours without changing maturity', () => {
    const pickedAt = 1000 + 5 * day;
    for (const tree of [{}, planted]) {
      const waiting = Crops.fruitTreeState(tree, pickedAt, pickedAt + day - 1);
      assert.eq(waiting.stage, 4);
      assert.eq(waiting.mature, true);
      assert.eq(waiting.ready, false);
      assert.eq(waiting.remainingMs, 1);
      assert.eq(Crops.fruitTreeState(tree, pickedAt, pickedAt + day).ready, true);
      assert.eq(Crops.fruitTreeState(tree, pickedAt, pickedAt + 2 * day).remainingMs, 0);
    }
  });

  test('fruit state: mature apple and peach flower for the final 12 hours before harvest', () => {
    const hour = 60 * 60 * 1000, pickedAt = 1000 + 5 * day;
    assert.eq(Crops.FRUIT_BLOSSOM_MS, 12 * hour);
    for (const species of ['apple', 'worldpeach']) {
      for (const tree of [{ species }, { ...planted, species }]) {
        for (const [elapsed, blossoming, ready] of [
          [0, false, false], [12 * hour - 1, false, false],
          [12 * hour, true, false], [day - 1, true, false],
          [day, false, true], [day + 1, false, true],
        ]) {
          const state = Crops.fruitTreeState(tree, pickedAt, pickedAt + elapsed);
          assert.eq(state.blossoming, blossoming, `${species} at ${elapsed}ms`);
          assert.eq(state.ready, ready);
          assert.eq(state.stage, 4, 'regrowth preserves maturity');
        }
        assert.eq(Crops.fruitTreeState(tree, undefined, pickedAt).blossoming, false);
      }
    }
    assert.eq(Crops.fruitTreeState(planted, undefined, 1000 + 3 * stage).blossoming,
      false, 'saplings retain their growth-stage artwork');
  });

  test('fruit state: future planting dates cannot produce a negative art frame', () => {
    const state = Crops.fruitTreeState(planted, undefined, 0);
    assert.eq(state.stage, 0);
    assert.eq(state.ready, false);
    assert.eq(state.remainingMs, day + 1000);
  });
})();
