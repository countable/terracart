// The "Scouting report" quest (verb 'poi') is credited by exactly one hook —
// Quests.onPoiVisit — and for most of its life that hook had exactly ONE call
// site: the well interactable, hardcoded to the literal string 'well'.
// QUEST_POIS names SEVEN targets ('well', 'fountain', 'library', 'museum',
// 'park', 'place_of_worship', 'playground'); the other six could be rolled
// onto the board (the 'poi' template has weight 1 in a 16-wide bag — roughly
// 1 in 20 generated slots) but nothing anywhere could ever complete them: a
// slot would sit there forever with no way to claim it.
//
// The fix: library/museum/park/place_of_worship/playground/fountain all
// reach the player as plain kind:'chest' objects carrying that class as
// o.poiClass (worldgen.js's POI 'USEFUL' set feeds loot.js's POI_CATEGORY /
// chestTier), so the chest interactable's markOpened() now also reports the
// chest's poiClass to Quests.onPoiVisit — see src/interactables.js. 'well'
// keeps its own dedicated path (a kind:'well' object, not a chest).
//
// The invariant this file pins is the one that would have caught the bug AND
// will catch the next one: for every entry in the real QUEST_POIS array —
// not a hand-copied list that could silently drift from it — there must be
// some reachable in-game action that credits a live quest targeting it.
(() => {
  // A save with exactly one live quest: a 'poi' quest targeting `target`,
  // parked in slot 0. Slots 1/2 stay null so _qs() back-fills them with
  // generated jobs the first time anything reads the board — harmless, they
  // just must not be 'poi' quests that could get credited by mistake and
  // mask a real failure. verb/event mirror what Quests.generate() actually
  // produces for a 'poi' template quest (quests.js ~line 143-154).
  function saveWithPoiQuest(target, extra) {
    return Object.assign({
      inv: [], opened: [], relics: {},
      quests: {
        gen: 1, done: 0,
        slots: [
          { id: 'q0', slot: 0, gen: 0, verb: 'poi', event: 'poi', need: 1, have: 0, target, reward: 55 },
          null, null,
        ],
      },
    }, extra);
  }

  const poiQuest = (save) => save.quests.slots[0];

  // The shared makeScene() stub (test/node/run.js) has no questEvent method —
  // it exists to drive INTERACTABLES directly, and most of its callers never
  // need the castle-board hookup. The two tests below check the 'chest' verb
  // alongside 'poi', so they need the real link: scene.questEvent(event) is
  // app.js' one-liner (Quests.onEvent(this.save, event); see app.js ~8111) —
  // reproduced here against the closed-over `save`, not `this.save`, since
  // the stub scene is never given a .save property by makeCtx.
  function makeQuestScene(save, over) {
    return Object.assign(makeScene(), {
      questEvent(event) { Quests.onEvent(save, event); },
    }, over);
  }

  // The one reachable action for each QUEST_POIS target, driven through the
  // REAL runInteractable dispatcher — never Quests.onPoiVisit called by hand,
  // since the bug was never in onPoiVisit itself, only in who calls it.
  function performReachableAction(target) {
    const scene = makeScene();
    const save = saveWithPoiQuest(target);
    const ctx = makeCtx(scene, save);
    if (target === 'well') {
      runInteractable(ctx, { kind: 'well', id: 'w1', x: 0, y: 0 });
    } else {
      // fixedLoot forces the deterministic item-payout branch of the chest
      // handler (the same shape a starter supply crate uses) so the test
      // doesn't depend on the rarity roll in pickReward() — every branch that
      // actually spends the chest (item / relic / gold / fits / overflow-take)
      // routes through the same markOpened(), so this exercises the real fix.
      runInteractable(ctx, {
        kind: 'chest', id: 'c_' + target, x: 0, y: 0,
        poiClass: target, fixedLoot: { id: 'wood', qty: 1 },
      });
    }
    return poiQuest(save);
  }

  test('QUEST_POIS: a real, non-empty target list (sanity — the invariant below is only as good as this)', () => {
    assert.truthy(Array.isArray(QUEST_POIS), 'QUEST_POIS is an array');
    assert.gt(QUEST_POIS.length, 0, 'QUEST_POIS is non-empty');
  });

  // THE invariant. Parametrized over the real array, not one hardcoded
  // target — this is what makes it catch the NEXT class added to the list,
  // not just re-prove the one that was already found broken.
  for (const target of QUEST_POIS) {
    test(`QUEST_POIS invariant: "${target}" has a reachable action that credits its quest`, () => {
      const q = performReachableAction(target);
      assert.truthy(q.have >= q.need,
        `a poi-quest targeting "${target}" was not credited by any reachable action — ` +
        `this target is on the board but uncompletable`);
    });
  }

  test('chest interactable: poiClass reported to Quests.onPoiVisit on open (not just the well)', () => {
    // Pins the actual mechanism of the fix, not just its external effect: a
    // chest whose poiClass matches a live poi-quest's target credits it.
    const q = performReachableAction('museum');
    assert.eq(q.have, 1, 'exactly one credit');
  });

  test('chest interactable: a poiClass that does NOT match the live target does not credit it', () => {
    // e.g. opening a museum chest while the board wants eyes on a park.
    const scene = makeScene();
    const save = saveWithPoiQuest('park');
    runInteractable(makeCtx(scene, save), {
      kind: 'chest', id: 'c1', x: 0, y: 0, poiClass: 'museum', fixedLoot: { id: 'wood', qty: 1 },
    });
    assert.eq(poiQuest(save).have, 0, 'mismatched poiClass must not credit');
  });

  test('chest interactable: a chest with no poiClass at all is inert for the poi quest', () => {
    // Starter crates and other poiClass-less chests must not accidentally
    // satisfy a 'poi' quest — onPoiVisit(save, undefined) must no-op.
    const scene = makeScene();
    const save = saveWithPoiQuest('library');
    runInteractable(makeCtx(scene, save), {
      kind: 'chest', id: 'c1', x: 0, y: 0, crate: true, fixedLoot: { id: 'wood', qty: 1 },
    });
    assert.eq(poiQuest(save).have, 0, 'no poiClass → no credit');
  });

  test('one chest open credits BOTH a live "chest" quest and a live "poi" quest exactly once each', () => {
    // Guards against double-crediting across quest TYPES on a single tap:
    // scene.questEvent('chest') and Quests.onPoiVisit(save, poiClass) are two
    // separate onEvent() passes over two DIFFERENT event names ('chest' vs
    // 'poi'), so a chest slot can never see a poi credit or vice versa.
    const save = {
      inv: [], opened: [], relics: {},
      quests: { gen: 2, done: 0, slots: [
        { id: 'q0', slot: 0, gen: 0, verb: 'chest', event: 'chest', need: 3, have: 0, reward: 14 },
        { id: 'q1', slot: 1, gen: 0, verb: 'poi',   event: 'poi',   need: 1, have: 0, target: 'library', reward: 55 },
        null,
      ] },
    };
    const scene = makeQuestScene(save);
    const chestObj = { kind: 'chest', id: 'c1', x: 0, y: 0, poiClass: 'library', fixedLoot: { id: 'wood', qty: 1 } };
    runInteractable(makeCtx(scene, save), chestObj);
    assert.eq(save.quests.slots[0].have, 1, 'chest quest credited exactly once');
    assert.eq(save.quests.slots[1].have, 1, 'poi quest credited exactly once');
  });

  test('re-tapping an already-opened chest does not credit either quest again', () => {
    const save = {
      inv: [], opened: [], relics: {},
      quests: { gen: 2, done: 0, slots: [
        { id: 'q0', slot: 0, gen: 0, verb: 'chest', event: 'chest', need: 3, have: 0, reward: 14 },
        { id: 'q1', slot: 1, gen: 0, verb: 'poi',   event: 'poi',   need: 1, have: 0, target: 'library', reward: 55 },
        null,
      ] },
    };
    const scene = makeQuestScene(save);
    const chestObj = { kind: 'chest', id: 'c1', x: 0, y: 0, poiClass: 'library', fixedLoot: { id: 'wood', qty: 1 } };
    runInteractable(makeCtx(scene, save), chestObj);
    runInteractable(makeCtx(scene, save), chestObj);   // second tap: "Picked clean already."
    assert.eq(save.quests.slots[0].have, 1, 'chest quest still only credited once');
    assert.eq(save.quests.slots[1].have, 1, 'poi quest still only credited once');
  });

  test('overflow "leave for later" does not credit the poi quest until the loot is actually taken', () => {
    // A chest whose loot doesn't fit offers TAKE/LEAVE. Leaving it must not
    // spend the chest (save.opened stays untouched), so it must not credit
    // the poi quest either — only actually claiming it (markOpened) may.
    const scene = makeScene({ invRoomFor: () => 0 });
    const save = saveWithPoiQuest('museum');
    let actions = null;
    scene.showChestRewardModal = (opts) => { actions = opts.actions; };
    const chestObj = {
      kind: 'chest', id: 'c1', x: 0, y: 0, poiClass: 'museum',
      fixedLoot: { id: 'wood', qty: 99 },
    };
    runInteractable(makeCtx(scene, save), chestObj);
    assert.truthy(Array.isArray(actions), 'overflow modal was shown');
    assert.eq(poiQuest(save).have, 0, 'not credited while the modal is still up');

    actions.find((a) => a.label === 'Leave for later').onClick();
    assert.eq(poiQuest(save).have, 0, 'leaving it for later does not credit');
    assert.falsy(save.opened.includes('c1'), 'and the chest is not marked opened');
  });
})();
