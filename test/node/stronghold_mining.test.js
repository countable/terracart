(function () {
  test('stronghold mining: masonry is removed only when pick work completes', () => {
    const save = { relics: { pick: { tier: 1 } } };
    let complete, tool;
    const scene = makeScene({ save,
      startWorkProgress(x, y, callback, duration, cost, slot) {
        complete = callback; tool = slot;
      },
    });
    const wall = { id: 'stronghold-mining-wall', kind: 'stronghold_wall', x: 0, y: 0, variant: 0 };
    const ctx = makeCtx(scene, save);
    assert.eq(runInteractable(ctx, wall), true);
    assert.eq(tool, 'pick');
    assert.falsy(isSpent(wall, spentSets(scene, save)), 'starting or cancelling work leaves the wall standing');
    assert.eq(scene.invCount('rockfruit'), 0);
    complete();
    assert.truthy(scene.brokenRockSet.has(wall.id));
    assert.truthy(isSpent(wall, spentSets(scene, save)), 'render and collision share the mining ledger');
    assert.gt(scene.invCount('rockfruit'), 0, 'ruin masonry gives stone');
    const count = scene.invCount('rockfruit');
    complete();
    runInteractable(ctx, wall);
    assert.eq(scene.invCount('rockfruit'), count, 'a spent wall cannot be mined twice');
    const reloaded = makeScene({ save, brokenRockSet: new Set([...scene.brokenRockSet]) });
    assert.truthy(isSpent({ ...wall }, spentSets(reloaded, save)), 'regenerated masonry respects restored broken IDs');
  });
})();
