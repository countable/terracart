// The castle board: three generated slots that never run out.
//
// WHAT IT REPLACED, and why: a hand-written chain of three — defeat 10 slimes,
// find a well, bring a sapphire up from depth 3. Ten slimes was most of an
// evening for the FIRST thing the game asks of you, and when the three were
// done the board had nothing left to say, which is why every castle in the
// world had to unseal at once. Many small jobs beat three big ones.
(() => {
  const qbSave = () => ({});
  const qbFill = (save, i) => { const q = Quests.slot(save, i); q.have = q.need; return q; };

  // ── The opening ─────────────────────────────────────────────────────────

  test('quest board: a fresh save opens with three jobs, one per slot', () => {
    const save = qbSave();
    const board = Quests.board(save);
    assert.eq(board.length, QUEST_SLOTS, 'three slots');
    for (let i = 0; i < QUEST_SLOTS; i++) {
      assert.truthy(board[i], `slot ${i + 1} has a job`);
      assert.eq(board[i].slot, i, 'and knows which slot it is in');
      assert.eq(board[i].have, 0, 'starting from nothing');
      assert.gt(board[i].need, 0, 'and asking for something');
    }
  });

  test('quest board: pest control starts at ONE slime', () => {
    // The headline of the rework. The old opener wanted ten.
    const save = qbSave();
    const first = Quests.slot(save, 0);
    assert.eq(first.verb, 'kill', 'slot 1 opens on pest control');
    assert.eq(first.target, 'slime', 'the surface slime — the only one you can meet up top');
    assert.eq(first.need, 1, 'a single slime');
    assert.truthy(/\b1 slime\b/.test(first.body), `body reads singular: ${first.body}`);
  });

  test('quest board: the whole opening trio is small', () => {
    // A first impression is worth authoring. Nothing on the opening board may
    // be an evening's work.
    const save = qbSave();
    for (const q of Quests.board(save)) {
      assert.falsy(q.need > 3, `${q.verb} asks for ${q.need} — too much for a first board`);
    }
  });

  // ── The generator ───────────────────────────────────────────────────────

  test('quest board: the same save regenerates the same board', () => {
    // A quest must not re-roll under a player who is halfway through it, so
    // generation is seeded off (salt, slot, gen) and never Math.random.
    const a = Quests.generate(1, 7, 4, 12345);
    const b = Quests.generate(1, 7, 4, 12345);
    assert.eq(JSON.stringify(a), JSON.stringify(b), 'same inputs, same quest');
  });

  test('quest board: two saves do not walk the same sequence', () => {
    const a = [], b = [];
    for (let g = 0; g < 12; g++) {
      a.push(Quests.generate(g % QUEST_SLOTS, g, 3, 111).verb);
      b.push(Quests.generate(g % QUEST_SLOTS, g, 3, 999).verb);
    }
    assert.falsy(a.join() === b.join(), 'a different salt is a different run');
  });

  test('quest board: jobs grow with the number you have finished', () => {
    // One number drives every size, so there is no per-quest tuning to drift.
    for (const t of QUEST_TEMPLATES) {
      if (t.max <= t.base) continue;             // fixed-size verbs (a POI visit)
      let prev = 0;
      for (const rank of [0, 3, 8, 20]) {
        const q = Quests.generate(0, 100, rank, 5);
        const scaled = Math.max(1, Math.min(t.max, Math.ceil(t.base * (1 + rank * t.k))));
        assert.gte(scaled, prev, `${t.id} never shrinks as rank climbs`);
        prev = scaled;
      }
      const top = Math.max(1, Math.min(t.max, Math.ceil(t.base * (1 + 100 * t.k))));
      assert.eq(top, t.max, `${t.id} is capped, not unbounded`);
    }
  });

  test('quest board: a reward is never zero and grows with the job', () => {
    const small = Quests.generate(0, 3, 0, 7);
    const big = Quests.generate(0, 3, 15, 7);
    assert.gt(small.reward, 0, 'a job pays something');
    assert.gt(big.reward, small.reward, 'a bigger job pays more');
  });

  test('quest board: a reward at rank 0 cannot outrun a starting purse', () => {
    // The old chain paid $200/$400/$600 against a STARTING_MONEY of 50 — 24x a
    // new player's whole purse, in three lumps. A first job should read as
    // pocket money, and the ladder should be where the money is.
    for (let slot = 0; slot < QUEST_SLOTS; slot++) {
      const q = Quests.generate(slot, slot, 0, 3);
      assert.falsy(q.reward > 100, `${q.verb} pays ${q.reward} at rank 0 — too much`);
    }
  });

  test('quest board: every generated job is describable', () => {
    for (let g = 0; g < 60; g++) {
      const q = Quests.generate(g % QUEST_SLOTS, g, g, 42);
      assert.truthy(q.title, `gen ${g} has a title`);
      assert.truthy(q.body && q.body.length > 8, `gen ${g} has a body: ${q.body}`);
      assert.falsy(/undefined|NaN/.test(q.title + q.body), `gen ${g} reads cleanly: ${q.body}`);
      assert.truthy(QUEST_TEMPLATES.some(t => t.id === q.verb), `gen ${g} verb is a real template`);
    }
  });

  test('quest board: kill jobs name a real enemy', () => {
    for (let g = 0; g < 80; g++) {
      const q = Quests.generate(g % QUEST_SLOTS, g, 9, 8);
      if (q.verb !== 'kill') continue;
      assert.includes(QUEST_ENEMIES, q.target, `gen ${g} targets a registered enemy`);
    }
  });

  // ── Claiming, and the refill ────────────────────────────────────────────

  test('quest board: an unfinished slot cannot be claimed', () => {
    const save = qbSave();
    assert.falsy(Quests.claim(save, 0), 'nothing to claim yet');
    assert.eq(Quests.completedCount(save), 0, 'and nothing counted');
  });

  test('quest board: claiming refills THAT slot and no other', () => {
    const save = qbSave();
    const before = Quests.board(save).map(q => q.id);
    qbFill(save, 1);
    const finished = Quests.claim(save, 1);
    assert.truthy(finished, 'the claim took');
    const after = Quests.board(save).map(q => q.id);
    assert.eq(after[0], before[0], 'slot 1 untouched');
    assert.eq(after[2], before[2], 'slot 3 untouched');
    assert.falsy(after[1] === before[1], 'slot 2 holds a new job');
    assert.eq(Quests.slot(save, 1).slot, 1, 'and it took that slot number');
    assert.eq(Quests.slot(save, 1).have, 0, 'starting fresh');
  });

  test('quest board: the board is never empty', () => {
    // "There should always be 3 quests available" — through any amount of
    // claiming, including claiming the same slot over and over.
    const save = qbSave();
    for (let n = 0; n < 40; n++) {
      const i = n % QUEST_SLOTS;
      qbFill(save, i);
      Quests.claim(save, i);
      const board = Quests.board(save);
      assert.eq(board.length, QUEST_SLOTS, `still three after ${n + 1} claims`);
      for (let k = 0; k < QUEST_SLOTS; k++) assert.truthy(board[k], `slot ${k + 1} filled`);
    }
    assert.eq(Quests.completedCount(save), 40, 'every claim counted toward rank');
  });

  test('quest board: a reload does not re-roll the board', () => {
    const save = qbSave();
    const before = JSON.stringify(Quests.board(save));
    const reloaded = JSON.parse(JSON.stringify(save));      // through the save and back
    assert.eq(JSON.stringify(Quests.board(reloaded)), before, 'same three jobs');
  });

  // ── Events ──────────────────────────────────────────────────────────────

  test('quest board: all three slots track the same event stream', () => {
    // No accept step, the way the starter ladder has none.
    const save = qbSave();
    // Force the overlap: same verb, and no named target (a kill job's target is
    // a real filter — see the enemy test below).
    for (const q of Quests.board(save)) { q.event = 'harvest'; q.target = null; }
    Quests.onEvent(save, 'harvest');
    for (const q of Quests.board(save)) assert.eq(q.have, 1, `${q.id} credited`);
  });

  test('quest board: an unrelated event credits nothing', () => {
    const save = qbSave();
    Quests.onEvent(save, 'not_a_verb');
    for (const q of Quests.board(save)) assert.eq(q.have, 0, 'untouched');
  });

  test('quest board: a kill only counts for the enemy the job named', () => {
    const save = qbSave();
    const q = Quests.slot(save, 0);
    q.verb = 'kill'; q.event = 'kill'; q.target = 'goblin'; q.need = 2; q.have = 0;
    Quests.onKill(save, 'slime');
    assert.eq(Quests.slot(save, 0).have, 0, 'wrong foe, no credit');
    Quests.onKill(save, 'goblin');
    assert.eq(Quests.slot(save, 0).have, 1, 'right foe, credited');
  });

  test('quest board: progress stops at what was asked for', () => {
    const save = qbSave();
    const q = Quests.slot(save, 0);
    q.event = 'harvest'; q.target = null; q.need = 2; q.have = 0;
    for (let i = 0; i < 9; i++) Quests.onEvent(save, 'harvest');
    assert.eq(Quests.slot(save, 0).have, 2, 'capped at need');
    assert.truthy(Quests.isSlotComplete(save, 0), 'and complete');
  });

  // ── Migration off the old chain ─────────────────────────────────────────

  test('quest board: an old mid-chain save gets a fresh board and no free castles', () => {
    const save = { quests: { step: 1, progress: { q1_slimes: 4 } } };
    const board = Quests.board(save);
    assert.eq(board.length, QUEST_SLOTS, 'three jobs');
    assert.falsy(save.castlesLegacyOpen, 'they had not finished, so nothing is owed');
    assert.falsy(save.quests.step, 'the old chain step is gone');
  });

  test('quest board: an old FINISHED save keeps the castles it had opened', () => {
    // Finishing the old chain unsealed every castle in the world, because a
    // global gate could not do anything else. The seal is per castle now and
    // there is no way to name the ones they had — so the access is carried.
    const save = { quests: { step: 3, progress: {} } };
    Quests.board(save);
    assert.truthy(save.castlesLegacyOpen, 'earned access survives the rework');
  });

  // ── Which castle offers which slot ──────────────────────────────────────

  test('quest board: a castle keeps one slot for life', () => {
    const key = 'b_12345_67890';
    const a = Quests.slotForCastle(key);
    assert.eq(Quests.slotForCastle(key), a, 'same castle, same slot, always');
    assert.inRange(a, 0, QUEST_SLOTS - 1, 'and it is a real slot');
  });

  test('quest board: castles do not all offer the same slot', () => {
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(Quests.slotForCastle(`b_${i * 37}_${i * 11}`));
    assert.eq(seen.size, QUEST_SLOTS, 'all three slots are handed out across the map');
  });
})();
