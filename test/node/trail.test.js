// Cobble trails — ONE LADDER for the whole world (src/trail.js) and the
// counter that reports it. Prizes used to be per named way per tile, each with
// its own segment length, remainder and "too short to pay" floor; now a stone
// is a stone wherever it is picked up.
//
// app.js can't load headlessly (it needs Phaser), which is exactly why the
// arithmetic lives in trail.js: these run the real shipping numbers, not a
// copy of them that would drift the moment someone retunes the feel.

// ── The ladder ────────────────────────────────────────────────────────────
(() => {
  const T = Trail;
  const S = T.GOAL_STEP;

  test('trail: the first prize wants ten stones', () => {
    // The user-facing promise. Pinned as a literal so a retune is a deliberate
    // edit here.
    assert.eq(S, 10, 'GOAL_STEP');
    assert.eq(T.goalFor(0), 10, 'the first goal');
  });

  test('trail: each prize asks ten more stones than the last', () => {
    for (const [won, want] of [[0, 10], [1, 20], [2, 30], [9, 100]]) {
      assert.eq(T.goalFor(won), want, `after ${won} prizes the goal is ${want}`);
    }
  });

  test('trail: a stone is about twenty metres of walking', () => {
    // The two halves of the same feel: render.js draws one stone per
    // COBBLE_SPACING_M and only a drawn stone counts, so the first prize is a
    // couple of hundred metres and the tenth is a proper expedition. Neither
    // number means anything without the other, so they are pinned together.
    assert.eq(Render.COBBLE_SPACING_M, 20, 'metres between stones');
    const firstWalkM = T.goalFor(0) * Render.COBBLE_SPACING_M;
    assert.inRange(firstWalkM, 150, 250, `the first prize is ${firstWalkM}m`);
  });

  test('trail: the counter reads stones banked over the current goal', () => {
    assert.eq(T.progress(0, 0).target, 10, 'a fresh save wants 10');
    assert.eq(T.progress(7, 0).pos, 7, 'and reads what has been banked');
    assert.eq(T.progress(3, 2).target, 30, 'after two prizes it wants 30');
  });

  test('trail: banking stones counts them and pays on the goal', () => {
    let st = T.bank(0, 0, 9);
    assert.eq(st.stones, 9, 'nine banked');
    assert.eq(st.owed, 0, 'and nothing owed yet');
    st = T.bank(st.stones, st.prizes, 1);
    assert.eq(st.owed, 1, 'the tenth stone pays');
    assert.eq(st.prizes, 1, 'one prize won');
    assert.eq(st.stones, 0, 'and the count starts again');
  });

  test('trail: the remainder carries into the next goal', () => {
    // A sweep lights a whole disc of stones at once, so a goal is routinely
    // crossed mid-sweep — the stones past it belong to the next walk, not to
    // the bin.
    const st = T.bank(8, 0, 5);
    assert.eq(st.prizes, 1, 'the goal was crossed');
    assert.eq(st.stones, 3, 'and the three stones past it carried over');
    assert.eq(st.owed, 1, 'one prize owed');
  });

  test('trail: one sweep can cross more than one goal', () => {
    // 10 for the first, 20 for the second, 30 for the third = 60, and each
    // crossing lengthens the next goal — so this is a loop over the NEW goal,
    // not a division.
    const st = T.bank(0, 0, 60);
    assert.eq(st.prizes, 3, 'three prizes');
    assert.eq(st.owed, 3, 'all three owed at once');
    assert.eq(st.stones, 0, 'exactly consumed');
    const one = T.bank(0, 0, 29);
    assert.eq(one.prizes, 1, '29 stones is one prize');
    assert.eq(one.stones, 19, 'and 19 toward the next');
  });

  test('trail: banking is defensive about junk', () => {
    // A hand-edited or half-migrated save must not mint prizes.
    assert.eq(T.bank(0, 0, 0).owed, 0, 'no stones, no prize');
    assert.eq(T.bank(-5, -5, -5).owed, 0, 'negatives read as zero');
    assert.eq(T.bank(0, 0, 1000).prizes, 13, 'a huge sweep still walks the ladder');
  });

  test('trail: the reward improves with every prize, then stops climbing', () => {
    // opts.rollBonus is extra boost-chain steps; one to begin with and one more
    // per prize won. Capped, because a chain step stops buying tiers at the
    // context ceiling and turns into consolation coins after that.
    assert.eq(T.rollBonusFor(0), T.PRIZE_ROLL_BONUS, 'the first prize gets the base bonus');
    assert.eq(T.rollBonusFor(1), T.PRIZE_ROLL_BONUS + 1, 'the second gets one more');
    assert.eq(T.rollBonusFor(3), T.PRIZE_ROLL_BONUS + 3, 'and so on');
    assert.eq(T.rollBonusFor(99), T.PRIZE_ROLL_BONUS_MAX, 'up to the cap');
    assert.gt(T.PRIZE_ROLL_BONUS_MAX, T.PRIZE_ROLL_BONUS, 'which leaves room to climb');
  });

  test('trail: nothing per-path survives', () => {
    // The old machinery: a segment cap, a per-trail counter, a minimum trail
    // length, a prizes-earned-per-trail sum. Its absence is the feature.
    for (const gone of ['SEGMENT_CELLS', 'MIN_TRAIL_CELLS', 'segmentIndex',
                        'segmentTarget', 'maxPrizes', 'prizesEarned', 'qualifies']) {
      assert.eq(T[gone], undefined, `Trail.${gone} is gone`);
    }
  });
})();

// ── Only a DRAWN stone lights and counts ──────────────────────────────────
// The activation primitive, lifted out of app.js and run for real. A cobble
// cell the renderer thinned away is not a stone: every cobble cell used to
// light and count, so a "10/10" could land after three visible stones had come
// on and the number meant nothing the player could see.
(() => {
const { _activatePathStone } = __trailCounter;
const T = WorldGen.T;
const N = 51;

// A tile of solid footpath, cached where the shipping code looks for it.
const withTile = (fn, terrain = T.PATH) => {
  const key = WorldGen.tileKey(0, 0);
  WorldGen.tileCache.set(key, { grid: new Uint8Array(N * N).fill(terrain), cellsPerEdge: N });
  const scene = { save: {}, cellM: 7, cellsPerTile: N, _activatePathStone };
  try { return fn(scene, key); } finally { WorldGen.tileCache.delete(key); }
};

test('trail stones: a cell the renderer draws no pebble on never lights', () => {
  withTile((scene) => {
    let lit = 0, drawn = 0;
    // Inside ONE tile: past cellsPerEdge the abs cell wraps to a local key
    // already lit, which is a real thing (a neighbouring tile) but not what
    // this test is asking about.
    for (let ix = 0; ix < N; ix++) {
      const shown = Render.cobbleShown(ix, 4, T.PATH, scene.cellM);
      if (shown) drawn++;
      if (scene._activatePathStone(0, 0, ix, 4)) lit++;
      assert.eq(scene._activatePathStone(0, 0, ix, 4), false, 'and never lights twice');
    }
    assert.eq(lit, drawn, 'exactly the drawn stones lit');
    assert.gt(drawn, 0, 'some of the row really is drawn');
    assert.lt(drawn, N, 'and some of it really is thinned away');
  });
});

test('trail stones: ground that is not a cobble is not a stone', () => {
  withTile((scene) => {
    let lit = 0;
    for (let ix = 0; ix < N; ix++) if (scene._activatePathStone(0, 0, ix, 4)) lit++;
    assert.eq(lit, 0, 'a park lights nothing at all');
  }, T.PARK);
});

test('trail stones: a street is a trail too', () => {
  withTile((scene) => {
    let lit = 0;
    for (let ix = 0; ix < N; ix++) if (scene._activatePathStone(0, 0, ix, 6)) lit++;
    assert.gt(lit, 0, 'road cobbles light as well as footpath ones');
  }, T.ROAD);
});

test('trail stones: the save keeps a flat list of lit cells, nothing per path', () => {
  withTile((scene, key) => {
    for (let ix = 0; ix < N; ix++) scene._activatePathStone(0, 0, ix, 4);
    const tile = scene.save.pathStones[key];
    assert.truthy(Array.isArray(tile), 'a plain array of "ix_iy"');
    assert.truthy(tile.every((k) => /^\d+_\d+$/.test(k)), 'and nothing else in it');
  });
});

test('trail stones: an uncached tile lights nothing', () => {
  const scene = { save: {}, cellM: 7, _activatePathStone };
  assert.eq(scene._activatePathStone(9, 9, 3, 3), false, 'no grid, no stone');
});
})();

// ── The prize is a CHOICE ─────────────────────────────────────────────────
// A prize pays two rolls and the player keeps ONE. Two rules carry it:
// the options must actually differ (Trail.rollChoices), and NOTHING may be
// granted until the player picks — the roll they turn down was never theirs.
// The second rule is the one that would silently break: the option not taken
// still has to be drawn, so the drawing half must pay nothing at all. Both
// halves are the real app.js methods, lifted by run.js and run on a stub
// scene, so this tests what ships rather than a transcription of it.
(() => {
const T = Trail;
const { _trailRewardCard, _claimTrailReward } = __trailPrize;

// A scene stub carrying just what the two methods touch.
const scene = (over = {}) => ({
  save: { money: 0, inv: [], relics: {} },
  taken: [],
  addToInv(id, qty) { this.taken.push([id, qty]); },
  iconSpanHTML: (id) => `<i>${id}</i>`,
  gearIconHTML: (kind, slot, tier) => `<i>${kind}:${slot}:${tier}</i>`,
  markRelicsDirty() {},
  _trailRewardCard, _claimTrailReward,
  ...over,
});

test('trail prize: two of a kind is not a choice', () => {
  // Gold is gold and the same item is the same card, however the quantity
  // lands — rolling either twice has to keep looking rather than offer the
  // player a decision with one answer.
  const gold = () => ({ kind: 'gold', amount: 7 });
  assert.eq(T.rollChoices(gold).length, 1, 'gold twice collapses to one option');
  let n = 0;
  const sameItem = () => ({ kind: 'item', id: 'potato', qty: ++n });
  assert.eq(T.rollChoices(sameItem).length, 1, 'the same item at a new qty is the same card');
});

test('trail prize: two different finds are offered as two', () => {
  const rolls = [{ kind: 'gold', amount: 7 }, { kind: 'item', id: 'potato', qty: 2 }];
  let i = 0;
  const out = T.rollChoices(() => rolls[i++] || null);
  assert.eq(out.length, 2, 'both are offered');
  assert.eq(out[0].kind, 'gold', 'in the order they rolled');
  assert.eq(out[1].id, 'potato', 'and the second is the other one');
});

test('trail prize: a gold roll and a gear roll are told apart by slot and tier', () => {
  const pairs = [
    [{ kind: 'relic', slot: 'axe', tier: 2 }, { kind: 'relic', slot: 'axe', tier: 2 }, 1],
    [{ kind: 'relic', slot: 'axe', tier: 2 }, { kind: 'relic', slot: 'axe', tier: 3 }, 2],
    [{ kind: 'relic', slot: 'axe', tier: 2 }, { kind: 'armor', slot: 'axe', tier: 2 }, 2],
  ];
  for (const [a, b, want] of pairs) {
    let i = 0;
    const got = T.rollChoices(() => [a, b][i++] ?? b);
    assert.eq(got.length, want, `${T.rewardKey(a)} vs ${T.rewardKey(b)} → ${want} option(s)`);
  }
});

test('trail prize: a picker with nothing to give ends the search', () => {
  assert.eq(T.rollChoices(() => null).length, 0, 'no rolls, no prize');
  let i = 0;
  assert.eq(T.rollChoices(() => (i++ ? null : { kind: 'gold', amount: 3 })).length, 1,
    'one roll then empty → one option, not an infinite retry');
  assert.eq(T.rollChoices(null).length, 0, 'no picker at all is survivable');
});

test('trail prize: an unkeyable roll is never folded into another', () => {
  // A reward shape trail.js does not recognise must not be treated as a
  // duplicate — that would drop a prize the player earned.
  const odd = () => ({ kind: 'mystery' });
  assert.eq(T.rollChoices(odd).length, T.PRIZE_CHOICES, 'both odd rolls survive');
});

test('trail prize: rolling stops at PRIZE_CHOICES even when every roll differs', () => {
  let n = 0;
  const out = T.rollChoices(() => ({ kind: 'item', id: `x${n++}`, qty: 1 }));
  assert.eq(out.length, T.PRIZE_CHOICES, 'never more than the offer');
  assert.eq(T.PRIZE_CHOICES, 2, 'and the offer is two');
});

test('trail prize: DRAWING an option grants nothing', () => {
  // The whole point: the option the player does not take is rendered too.
  const s = scene();
  for (const reward of [{ kind: 'item', id: 'potato', qty: 3 },
                        { kind: 'gold', amount: 50 },
                        { kind: 'relic', slot: 'axe', tier: 4 }]) {
    const card = s._trailRewardCard(reward);
    assert.truthy(card && card.name, `${reward.kind} draws a card`);
  }
  assert.eq(s.taken.length, 0, 'nothing reached the bag');
  assert.eq(s.save.money, 0, 'no money moved');
  assert.falsy(s.save.relics.axe, 'no gear was equipped');
});

test('trail prize: CLAIMING pays exactly the option taken', () => {
  const s = scene();
  const card = s._claimTrailReward({ kind: 'item', id: 'potato', qty: 3 });
  assert.eq(s.taken.length, 1, 'one payout');
  assert.eq(s.taken[0][0], 'potato', 'the item taken');
  assert.eq(s.taken[0][1], 3, 'at its rolled quantity');
  assert.truthy(card && card.name, 'and the claim hands back the card to announce');
  assert.eq(card.qty, '× 3', 'quantity shown as the player sees it');

  const g = scene();
  g._claimTrailReward({ kind: 'gold', amount: 50 });
  assert.eq(g.save.money, 50, 'gold lands in the purse');

  const r = scene();
  r._claimTrailReward({ kind: 'relic', slot: 'axe', tier: 4 });
  assert.eq(r.save.relics.axe?.tier, 4, 'gear is equipped');
});

test('trail prize: consolation coins ride with the option taken, not the other', () => {
  const s = scene();
  s._claimTrailReward({ kind: 'item', id: 'potato', qty: 1, consolation: 9 });
  assert.eq(s.save.money, 9, 'the claimed roll pays its consolation');
  const d = scene();
  d._trailRewardCard({ kind: 'item', id: 'potato', qty: 1, consolation: 9 });
  assert.eq(d.save.money, 0, 'the drawn-but-unclaimed roll pays nothing');
});

test('trail prize: an unrecognised reward draws no card and pays nothing', () => {
  const s = scene();
  assert.falsy(s._trailRewardCard({ kind: 'mystery' }), 'no card');
  assert.falsy(s._claimTrailReward({ kind: 'mystery' }), 'no claim');
  assert.falsy(s._trailRewardCard(null), 'and null is survivable');
  assert.eq(s.save.money, 0, 'nothing paid out');
});

// app.js can't load headlessly, so the wiring AROUND those two methods — that
// the pick is what pays, and that the modal offering it can't be dismissed
// without choosing — is pinned as source text.
test('trail prize: the payout hangs off the button, not the offer', () => {
  const app = APP_JS_SRC;
  const at = app.indexOf('_fireTrailPrize(n, onDismiss) {');
  assert.gt(at, 0, 'found the prize path');
  const body = app.slice(at, app.indexOf('\n  _trailChoiceLabel', at));
  assert.truthy(/actions: choices\.map\(/.test(body), 'the choice opens as an actions modal');
  assert.truthy(/onClick: \(\) => \{\s*\n\s*const card = this\._claimTrailReward\(reward\);/.test(body),
    'and each option only pays when its own button is clicked');
  // The modal shell gives an actions dialog no tap-to-dismiss, so a stray tap
  // can't drop the prize — pin that the offer really is the actions variant.
  assert.truthy(/Take your pick/.test(body), 'the offer names itself as a pick');
});
})();
// ── The counter lands ON the stone ────────────────────────────────────────
// The "N/M" is drawn over the cobble that just lit, in the colour that stone
// lights up in, instead of popping at the screen centre in the pale treasure
// ink. The seating (_trailCounterAt) is lifted out of app.js and run for real,
// because it is a PROJECTION — the thing a peek drag breaks when someone
// measures it off the player instead of the camera anchor.
(() => {
const { _trailCounterAt } = __trailCounter;
const near = (a, b, eps, m) => assert.inRange(a, b - eps, b + eps, m);

// Same shape as peek_drag.test.js's scene — round numbers, shipping cellM.
const counterScene = (over) => Object.assign({
  startWorldM: { x: 10000, y: 20000 },
  mPerPx: 10,
  originPx: { x: 1000, y: 2000 },
  cellsPerTile: 51,
  cellM: 7,
  playerM: { x: 0, y: 0 },
  peekM: { x: 0, y: 0 },
  viewCenterX: 176,
  viewCenterY: 200,
  worldMetersToScreen(wmx, wmy) { return worldMetersToScreen(this, wmx, wmy); },
  _trailCounterAt,
}, over || {});

// The cell the player is standing in, so the maths below has a known answer.
const homeCell = (s) => worldMetersToAbsCell(
  s, s.startWorldM.x + s.playerM.x, s.startWorldM.y + s.playerM.y);

test('trail counter: it sits on the cobble, lifted clear of the stone', () => {
  const s = counterScene();
  const c = homeCell(s);
  const out = s._trailCounterAt(c.cellIX + 2, c.cellIY);
  const stone = worldMetersToScreen(s, ...(() => {
    const m = absCellCenterMeters(s, c.cellIX + 2, c.cellIY);
    return [m.x, m.y];
  })());
  assert.eq(out.x, Math.round(stone.x), 'horizontally centred on the stone');
  // The note tier hangs its text from `y`, so the number sits ABOVE the pebble
  // rather than across it — about half a cell up, never a whole one.
  assert.lt(out.y, stone.y, 'above the stone');
  near(stone.y - out.y, CELL_PX * 0.6, CELL_PX * 0.25, 'by about half a cell');
});

test('trail counter: a peek moves the number with its stone, not with the player', () => {
  // The QC rule that keeps biting: a draw pass measured off the body tears its
  // layer off the ground under a peek drag. The counter is drawn AT a world
  // cell, so it must slide with the ground exactly as the cobble under it does.
  const s = counterScene();
  const c = homeCell(s);
  const before = s._trailCounterAt(c.cellIX + 2, c.cellIY);
  s.peekM = { x: 3 * s.cellM, y: 0 };      // camera three cells east
  const after = s._trailCounterAt(c.cellIX + 2, c.cellIY);
  const shift = before.x - after.x;
  near(shift, 3 * CELL_PX, 1, 'the stone slid three cells west on screen');
  assert.eq(before.y, after.y, 'and not vertically');
});

test('trail counter: an unprojectable cell falls back to the centred toast', () => {
  // A sweep before the camera exists, or a headless scene: an empty options
  // object is the toast's own default, which is where the counter used to pop.
  const s = counterScene({ startWorldM: null });
  assert.eq(Object.keys(s._trailCounterAt(4, 4)).length, 0, 'no override');
  const ok = counterScene();
  assert.eq(Object.keys(ok._trailCounterAt(null, null)).length, 0, 'no cell, no override');
});

test('trail counter: the number wears the lit stone\'s own colour', () => {
  // One constant, two readers: app.js bakes the lit-cobble texture from
  // UI_TRAIL_LIT and the counter is drawn in it, so the stone and the number
  // over it can never end up different blues. Pinned as source text — app.js
  // needs Phaser and can't load headlessly.
  assert.eq(UI_TRAIL_LIT, '#9a8cff', 'the lit violet');
  assert.truthy(/cctx\.fillStyle = UI_TRAIL_LIT;/.test(APP_JS_SRC),
    'the lit-cobble texture is baked from it');
  assert.truthy(/color: UI_TRAIL_LIT,\s*\n\s*\.\.\.this\._trailCounterAt\(/
    .test(APP_JS_SRC), 'and the counter is drawn in it, at the stone');
  assert.falsy(/`\$\{pos\}\/\$\{target\}`, \{ tier: 'note', color: UI_TREASURE_INK \}/
    .test(APP_JS_SRC), 'the old centred treasure-ink toast is gone');
});
})();
