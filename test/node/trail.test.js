// STREET RESTORATION's ladder — ONE for the whole world (src/trail.js), the
// counter that reports it, and the sweep that feeds it. Prizes used to be per
// named way per tile, each with its own segment length, remainder and "too
// short to pay" floor; now a metre is a metre wherever it is restored.
//
// app.js can't load headlessly (it needs Phaser), which is exactly why the
// arithmetic lives in trail.js and streets.js: these run the real shipping
// numbers — and, through run.js's lift, the real shipping SWEEP — rather than
// a copy that would drift the moment someone retunes the feel.

// ── The ladder, in METRES ─────────────────────────────────────────────────
(() => {
  const T = Trail;
  const S = T.GOAL_STEP_M;

  test('trail: the first prize wants two hundred metres of street', () => {
    // The user-facing promise. Pinned as a literal so a retune is a deliberate
    // edit here — and it is the walk the ladder always asked for: the counter
    // used to want ten lit pebbles at one per 20 m, which is this number said
    // in the unit that was underneath it all along (see the stones→metres fold
    // in savemigrate.js).
    assert.eq(S, 200, 'GOAL_STEP_M');
    assert.eq(T.goalFor(0), 200, 'the first goal');
  });

  test('trail: each prize asks two hundred metres more than the last', () => {
    for (const [won, want] of [[0, 200], [1, 400], [2, 600], [9, 2000]]) {
      assert.eq(T.goalFor(won), want, `after ${won} prizes the goal is ${want} m`);
    }
  });

  test('trail: the stones vocabulary is gone', () => {
    // The ladder counts restored METRES now. A `GOAL_STEP` left behind as an
    // alias is how a caller keeps banking pebble counts against a metre goal
    // and pays a prize every ten metres.
    assert.eq(T.GOAL_STEP, undefined, 'Trail.GOAL_STEP is gone');
    assert.eq(T.bank(0, 0, 5).stones, undefined, 'and bank() reports metres, not stones');
    assert.eq(T.bank(0, 0, 5).metres, 5, 'which is what it is called');
  });

  test('trail: ONE formatter draws every number the walk shows', () => {
    // The counter that pops on the street and the prize ceremony's sub-line
    // print the same walk. Two formatters is how the two came to disagree
    // about which rung had just been paid.
    assert.eq(T.label(137, 200), '137/200 m', 'the notation');
    assert.eq(T.progress(137.4183, 0).label, '137/200 m',
      'a float position rounds — restoration is exact, the toast is not');
    assert.eq(T.progress(137.6, 0).label, '138/200 m', 'rounded, not floored');
    assert.eq(T.readout(T.bank(150, 0, 60)).label, T.label(200, 200),
      'and the paying sweep reads through the same one');
  });

  test('trail: the counter reads metres banked over the current goal', () => {
    assert.eq(T.progress(0, 0).target, 200, 'a fresh save wants 200 m');
    assert.eq(T.progress(70, 0).pos, 70, 'and reads what has been banked');
    assert.eq(T.progress(30, 2).target, 600, 'after two prizes it wants 600');
    // The position is the exact float; only the label rounds it.
    assert.eq(T.progress(12.5, 0).pos, 12.5, 'fractional metres survive');
  });

  test('trail: the counter on a paying sweep reads the goal it completed, full', () => {
    // The ladder grows by GOAL_STEP_M a rung, so the moment the first prize
    // opened the counter read "60/400 m" — the carried remainder against the
    // next goal — beside a ceremony that had paid at 200. The paying sweep's
    // readout is the completed goal, full; the remainder shows next sweep.
    assert.eq(T.readout(T.bank(160, 0, 100)).pos, 200, 'the first goal, complete');
    assert.eq(T.readout(T.bank(160, 0, 100)).target, 200, 'and the target is that goal');
    const next = T.bank(160, 0, 100);
    const after = { metres: next.metres, prizes: next.prizes, owed: 0 };
    assert.eq(T.readout(after).target, 400, 'the next sweep reads against the next rung');
    assert.eq(T.readout(after).pos, 60, 'with the carried remainder');
    // A sweep that crosses two goals at once reads the LAST one it completed.
    const two = T.bank(190, 0, 420);
    assert.eq(two.owed, 2);
    assert.eq(T.readout(two).target, 400, 'the second rung, full');
    assert.eq(T.readout(two).pos, 400);
    // No payout: plain progress.
    const p = T.readout(T.bank(0, 0, 140));
    assert.eq(p.pos, 140); assert.eq(p.target, 200);
    assert.eq(T.readout(null).target, 200, 'nothing banked reads as a fresh rung');
    assert.eq(T.readout(null).label, '0/200 m', 'and says so');
  });

  test('trail: banking metres counts them and pays on the goal', () => {
    let st = T.bank(0, 0, 180);
    assert.eq(st.metres, 180, 'a hundred and eighty banked');
    assert.eq(st.owed, 0, 'and nothing owed yet');
    st = T.bank(st.metres, st.prizes, 20);
    assert.eq(st.owed, 1, 'the two-hundredth metre pays');
    assert.eq(st.prizes, 1, 'one prize won');
    assert.eq(st.metres, 0, 'and the count starts again');
  });

  test('trail: the ladder is measured, not counted', () => {
    // Restoration is exact float arclength (src/streets.js), so a sweep
    // routinely banks a fraction of a metre. Rounding it away would lose most
    // of a short walk; rounding it up would pay for street nobody restored.
    const st = T.bank(150.5, 0, 30.25);
    assert.eq(st.metres, 180.75, 'the fraction is kept, to the metre and past it');
    const pay = T.bank(199.5, 0, 1.25);
    assert.eq(pay.owed, 1, 'and it still crosses the goal exactly on the metre');
    assert.inRange(pay.metres, 0.749, 0.751, 'with the fraction carried over');
  });

  test('trail: the remainder carries into the next goal', () => {
    // A sweep restores a whole disc of street at once, so a goal is routinely
    // crossed mid-sweep — the metres past it belong to the next walk, not to
    // the bin.
    const st = T.bank(160, 0, 100);
    assert.eq(st.prizes, 1, 'the goal was crossed');
    assert.eq(st.metres, 60, 'and the sixty metres past it carried over');
    assert.eq(st.owed, 1, 'one prize owed');
  });

  test('trail: one sweep can cross more than one goal', () => {
    // 200 for the first, 400 for the second, 600 for the third = 1200, and
    // each crossing lengthens the next goal — so this is a loop over the NEW
    // goal, not a division.
    const st = T.bank(0, 0, 1200);
    assert.eq(st.prizes, 3, 'three prizes');
    assert.eq(st.owed, 3, 'all three owed at once');
    assert.eq(st.metres, 0, 'exactly consumed');
    const one = T.bank(0, 0, 580);
    assert.eq(one.prizes, 1, '580 m is one prize');
    assert.eq(one.metres, 380, 'and 380 toward the next');
  });

  test('trail: banking is defensive about junk', () => {
    // A hand-edited or half-migrated save must not mint prizes.
    assert.eq(T.bank(0, 0, 0).owed, 0, 'no metres, no prize');
    assert.eq(T.bank(-5, -5, -5).owed, 0, 'negatives read as zero');
    assert.eq(T.bank(NaN, 0, 40).metres, 40, 'a NaN total starts from nothing');
    assert.eq(T.bank(40, 0, NaN).metres, 40, 'and a NaN gain adds nothing');
    assert.eq(T.bank(0, 0, Infinity).owed, 0, 'an infinite sweep mints no prizes at all');
    assert.eq(T.bank(0, 0, 20000).prizes, 13, 'a huge walk still walks the ladder');
    assert.eq(T.progress(NaN, 0).pos, 0, 'and the counter never reads NaN');
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
  // The header: the survivors' thanks, one constant for all three shapes of
  // the ceremony, with the count it paid at on the pick's flavour line.
  assert.truthy(/const TRAIL_PRIZE_HEADER = 'Thank you for repairing the roads!';/.test(app),
    'the header constant');
  assert.truthy(/const header = TRAIL_PRIZE_HEADER;/.test(body), 'the ceremony uses it');
  assert.eq((body.match(/header,/g) || []).length, 3, 'all three shapes carry the header');
  // The flavour line prints the walk through Trail.label — the ONE formatter
  // the street counter also prints with — so the ceremony and the number that
  // was on the street a moment ago can't disagree about the rung just paid.
  assert.truthy(/const goal = Trail\.goalFor\(Math\.max\(0, \(n \| 0\) - 1\)\);/.test(body),
    'the goal just completed');
  assert.truthy(/const walked = Trail\.label\(goal, goal\);/.test(body),
    'formatted by Trail.label, never a second `${x}/${y} m`');
  assert.truthy(/sub: `\$\{walked\} restored · \$\{choices\.length\} finds — one is yours<br>\$\{next\}`/.test(body),
    'the pick says how much street was restored');
  // EVERY shape of the ceremony names the next rung — a prize that pays
  // without saying where the ladder goes next is a dead end.
  assert.eq((body.match(/sub: (next|`|card\.sub)/g) || []).length, 3,
    'all three shapes carry a sub line');
  assert.eq((body.match(/\$\{next\}|sub: next/g) || []).length, 3,
    'and all three print the next rung');
  assert.truthy(/const next = trailNextPrizeLine\(n \| 0\);/.test(body),
    'through the one formatter, off Trail.goalFor');
  assert.falsy(/cobbles walked/.test(body), 'nothing counts pebbles any more');
});

// ── THE FIRST PRIZE IS AN ONION SEED ──────────────────────────────────────
// Prize #1 is not rolled. What the road pays in is seeds, and the first rung
// says so out loud rather than sampling a pool that could hand a new player
// coins and leave them none the wiser.
test('trail prize: the first rung is the onion seed, and only the first', () => {
  const first = Trail.firstPrize(1);
  assert.truthy(first, 'rung one is fixed');
  assert.eq(first.id, 'onion_seed', 'an onion seed');
  assert.eq(first.id, Trail.FIRST_PRIZE_ID, 'through the constant');
  assert.truthy(ITEM_BY_ID[first.id], 'which is a real item');
  assert.eq(ITEM_BY_ID[first.id].kind, 'seed', 'of the class the road pays in');
  assert.eq(first.tier, ITEM_BY_ID[first.id].baseTier, 'carrying its own tier');
  assert.gt(first.qty, 1, 'as a pack, since seeds are planted in bulk');
  assert.eq(first.kind, 'item', 'in exactly the shape pickReward returns');
  assert.eq(first.jackpot, 0);
  assert.eq(first.consolation, 0);
  for (const n of [0, 2, 3, 10]) assert.falsy(Trail.firstPrize(n), `rung ${n} is rolled`);
});

test('trail prize: the fixed first rung pays out through the ordinary claim', () => {
  const s = scene();
  const card = s._claimTrailReward(Trail.firstPrize(1));
  assert.truthy(card, 'it draws a card like any other reward');
  assert.eq(s.taken.length, 1, 'and lands in the bag');
  assert.eq(s.taken[0][0], 'onion_seed');
  assert.eq(s.taken[0][1], Trail.FIRST_PRIZE_QTY, 'as the whole pack');
});

test('trail prize: the ceremony rolls the ROAD pool, and rung one skips the roll', () => {
  const app = APP_JS_SRC;
  const at = app.indexOf('_fireTrailPrize(n, onDismiss) {');
  const body = app.slice(at, app.indexOf('\n  _trailChoiceLabel', at));
  assert.truthy(/pickReward\(Trail\.PRIZE_CONTEXT, this\.save, undefined, \{ rollBonus: bonus \}\)/.test(body),
    'the pool is trail.js\'s, never a chest context named here');
  assert.falsy(/chest:lowtier/.test(body), 'the ladder no longer borrows the lowtier chest curve');
  assert.truthy(/const fixed = Trail\.firstPrize \? Trail\.firstPrize\(n\) : null;/.test(body),
    'rung one is asked for first');
  assert.truthy(/const choices = fixed \? \[fixed\]/.test(body), 'and short-circuits the roll');
});

test('trail prize: every ceremony says where the next rung is', () => {
  // The ladder grows by GOAL_STEP_M a rung, so the promise under the prize is
  // Trail.goalFor — never a retyped number, and never absent.
  for (const won of [0, 1, 5]) {
    const line = trailNextPrizeLine(won);
    assert.truthy(line.includes(`${Trail.goalFor(won)}m`), 'quotes the next rung off Trail');
    assert.truthy(/better prize/.test(line), 'and promises the step up the roll bonus buys');
  }
  assert.eq(trailNextPrizeLine(1), `Repair ${Trail.GOAL_STEP_M * 2}m more for a better prize.`,
    'the second rung asks a step more than the first');
});

test('trail counter: the street reads Trail.readout of the bank, not raw progress', () => {
  const app = APP_JS_SRC;
  const at = app.indexOf('  _bankStreetMetres(addedM, at, now) {');
  assert.gt(at, 0, 'found the bank');
  const body = app.slice(at, app.indexOf('\n  }\n', at));
  assert.truthy(/this\._toast\(Trail\.readout\(out\)\.label, \{/.test(body),
    'the paying sweep reads the completed goal, full — and through the one formatter');
  assert.falsy(/Trail\.progress\(/.test(body), 'raw progress is not what the street shows');
});
})();
// ── The counter lands ON the street ───────────────────────────────────────
// The "N/M m" is drawn over the stretch that just came back, in the colour a
// restored street is made of, instead of popping at the screen centre in the
// pale treasure ink. The seating (_worldToastAt) is lifted out of app.js and
// run for real, because it is a PROJECTION — the thing a peek drag breaks when
// someone measures it off the player instead of the camera anchor.
(() => {
const { _worldToastAt, _cellToastAt } = __trailCounter;
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
  _worldToastAt,
  _cellToastAt,
}, over || {});

test('street counter: it sits on the stretch, lifted clear of the carriageway', () => {
  const s = counterScene();
  // A point 30 m east and 12 m south of where the world starts — an arbitrary
  // place ALONG A WAY, not a cell centre: that is the whole point of the world
  // seating, since a restored stretch ends where the dwell ended.
  const wx = s.startWorldM.x + 30, wy = s.startWorldM.y + 12;
  const out = s._worldToastAt(wx, wy, STREET_COUNTER_LIFT_PX);
  const at = worldMetersToScreen(s, wx, wy);
  assert.eq(out.x, Math.round(at.x), 'horizontally on the stretch');
  // The note tier hangs its text from `y`, so the number sits ABOVE the
  // carriageway rather than across it — about half a cell up, never a whole one.
  assert.lt(out.y, at.y, 'above the street');
  near(at.y - out.y, CELL_PX * 0.6, CELL_PX * 0.25, 'by about half a cell');
});

test('street counter: a peek moves the number with the street, not with the player', () => {
  // The QC rule that keeps biting: a draw pass measured off the body tears its
  // layer off the ground under a peek drag. The counter is drawn AT a world
  // point, so it must slide with the ground exactly as the band under it does.
  const s = counterScene();
  const wx = s.startWorldM.x + 30, wy = s.startWorldM.y + 12;
  const before = s._worldToastAt(wx, wy, STREET_COUNTER_LIFT_PX);
  s.peekM = { x: 3 * s.cellM, y: 0 };      // camera three cells east
  const after = s._worldToastAt(wx, wy, STREET_COUNTER_LIFT_PX);
  near(before.x - after.x, 3 * CELL_PX, 1, 'the street slid three cells west on screen');
  assert.eq(before.y, after.y, 'and not vertically');
});

test('street counter: an unprojectable point falls back to the centred toast', () => {
  // A sweep before the camera exists, or a headless scene: an empty options
  // object is the toast's own default, which is where the counter used to pop.
  const s = counterScene({ startWorldM: null });
  assert.eq(Object.keys(s._worldToastAt(4, 4, 10)).length, 0, 'no override');
  const ok = counterScene();
  assert.eq(Object.keys(ok._worldToastAt(NaN, 4, 10)).length, 0, 'no point, no override');
  assert.eq(Object.keys(ok._cellToastAt(null, null, 10)).length, 0, 'nor a missing cell');
});

test('street counter: the number wears the restored street\'s own ink', () => {
  // One constant, three readers: the chips and the sparks a restoration throws
  // (particles.js) and the number counting it are all UI_STREET_INK, so the
  // debris and the figure over it can never end up different colours. Pinned
  // as source text — app.js needs Phaser and can't load headlessly.
  assert.eq(UI_STREET_INK, '#e8e2d6', 'pale stone');
  assert.eq(typeof UI_TRAIL_LIT, 'undefined', 'and the lit-pebble violet is gone');
  assert.truthy(/color: UI_STREET_INK,\s*\n\s*\.\.\.\(at \? this\._worldToastAt\(/.test(APP_JS_SRC),
    'the counter is drawn in it, on the stretch');
  assert.falsy(/`\$\{pos\}\/\$\{target\}`, \{ tier: 'note', color: UI_TREASURE_INK \}/
    .test(APP_JS_SRC), 'the old centred treasure-ink toast is gone');
});
})();

// ── A STREET has to be IN SIGHT, and the walk home doesn't count ──────────
// A stretch of road comes back by SIGHT, not by clipping the edge of the
// bubble in passing: it must sit inside the lit reach, CONTINUOUSLY, for
// PATH_STONE_DWELL_MS. Two things fall out of that and both are pinned here —
// leaving the reach restarts the clock from zero, and the auto-walk home (the
// character walking ITSELF back to the GPS fix) earns no sight at all, because
// that is the game moving the body rather than the player looking at anything.
//
// The whole sweep is lifted out of app.js and run for real against the
// shipping reach maths (coords.js) and the shipping interval algebra
// (streets.js), over a synthetic MVT transportation layer — so a rule that
// drifts here is a rule that drifted in the game.
(() => {
const SW = __trailCounter;
const N = 51;
const CELL_M = 7;
const TILE_EDGE_M = N * CELL_M;              // 357 m — one tile, 51 cells of 7 m
const EXTENT = 4096;
// The projection and the cell grid have to AGREE, exactly as they do in the
// game: cellPxSize × mPerPx is cellM there (tileEdgeM / cellsPerEdge), so the
// stub derives mPerPx from the same identity rather than picking a number.
const M_PER_PX = CELL_M * N / WorldGen.TILE_PX;
// The player stands at the centre of cell (25, 25).
const MID_M = 25.5 * CELL_M;

// ONE straight way, right across the tile through the player's row, as MVT
// integers. Arclength along it IS its x in metres, which is what makes the
// expected intervals readable.
const straightWay = () => ({
  id: 7, type: 2, tags: { class: 'minor' },
  geom: [[{ x: 0, y: EXTENT / 2 }, { x: EXTENT, y: EXTENT / 2 }]],
});

const sweepScene = (over) => Object.assign({
  depth: 0,
  save: { energy: 10, reachUpgrades: 0 },
  cellM: CELL_M,
  cellsPerTile: N,
  mPerPx: M_PER_PX,
  originPx: { x: 0, y: 0 },
  startWorldM: { x: 0, y: 0 },
  feetOffsetM: 0,
  playerM: { x: MID_M, y: MID_M },
  peekM: { x: 0, y: 0 },
  toasts: [],
  _toast(text, opts) { this.toasts.push({ text, opts }); },
  drained: 0,
  _drainTrailPrizes() { this.drained += 1; },
  // The one-time first-repair dialog (app.js _showTrailIntro → showMessageModal).
  // Recorded and dismissed straight away, so the sweep's prize queue drains
  // through the same path it does in the game.
  intros: [],
  showMessageModal(o) { this.intros.push(o); if (typeof o.onDismiss === 'function') o.onDismiss(); },
  // The BLAST (app.js _blastAt) the sweep fires: the real method, with only
  // its particle half stubbed, so the test reads what the sweep actually threw
  // and where.
  bursts: [],
  _burstAtWorld(kind, wmx, wmy, opts) { this.bursts.push({ kind, wmx, wmy, opts }); return 1; },
  ...SW,
}, over || {});

// Run `fn` with the clock frozen, over a tile carrying one transportation way.
const withStreet = (fn, feature) => {
  const key = WorldGen.tileKey(0, 0);
  WorldGen.tileCache.set(key, {
    cellsPerEdge: N,
    tileEdgeM: TILE_EDGE_M,
    layers: [{
      name: 'transportation', extent: EXTENT,
      features: [feature || straightWay()],
    }],
  });
  const realNow = Date.now;
  let t = 1e12;
  Date.now = () => t;
  try { return fn({ at: (ms) => { t = 1e12 + ms; }, tileKey: key }); }
  finally { Date.now = realNow; WorldGen.tileCache.delete(key); }
};

// Total metres of street restored in the save, however many lines it spans.
const restoredM = (s) => {
  let sum = 0;
  for (const tile of Object.values(s.save.streets || {})) {
    for (const flat of Object.values(tile)) sum += Streets.totalM(Streets.unflatten(flat));
  }
  return sum;
};
const restoredIvs = (s, tileKey) => {
  const tile = (s.save.streets || {})[tileKey] || {};
  return Object.values(tile).map((flat) => Streets.unflatten(flat));
};

test('streets: a stretch seen for less than two seconds is not rebuilt', () => {
  withStreet((clock) => {
    const s = sweepScene();
    clock.at(0);                       s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS - 1); s._sweepStreets();
    assert.eq(restoredM(s), 0, 'still derelict a millisecond short');
    assert.eq(s.toasts.length, 0, 'and nothing banked');
  });
});

test('streets: two seconds in the bubble and the stretch in reach comes back', () => {
  withStreet((clock, ) => {
    const s = sweepScene();
    clock.at(0);                   s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS); s._sweepStreets();
    const got = restoredM(s);
    assert.gt(got, 0, 'the reach really does cover some street');
    // EXACTLY the cells the reach outline covers, no more: the reach is
    // 2.5 cells + 1 m, so on the player's own row that is cells 23..27 — five
    // cells, 35 m — and the arclength along this way IS its x in metres.
    const iv = restoredIvs(s, WorldGen.tileKey(0, 0));
    assert.eq(iv.length, 1, 'one line, one row in the save');
    assert.eq(iv[0].length, 1, 'and one unbroken stretch of it');
    const [a, b] = iv[0][0];
    assert.inRange(a, 23 * CELL_M - 0.01, 23 * CELL_M + 0.01, 'starts at the western rim cell');
    assert.inRange(b, 28 * CELL_M - 0.01, 28 * CELL_M + 0.01, 'and ends at the eastern one');
    assert.inRange(got, 35 - 0.01, 35 + 0.01, 'five cells of street');
    // Every restored metre is inside the lit reach, measured the way the
    // outline is: no metre may come back that the player could not have
    // touched.
    const reachM = reachRadiusM(s);
    const p = playerReachCell(s);
    assert.lte(Math.abs(b - MID_M), reachM + CELL_M, 'nothing past the bubble');
    assert.truthy(cellInReach(s, p.cellIX + 2, p.cellIY), 'the rim cell is in reach');
    assert.falsy(cellInReach(s, p.cellIX + 3, p.cellIY), 'the one past it is not');

    // The ladder banked exactly what came back.
    assert.inRange(s.save.trail.metres, got - 0.01, got + 0.01, 'the metres are the ladder');
    assert.eq(s.toasts.length, 1, 'one counter for the whole step, not one per piece');
    assert.eq(s.toasts[0].text, Trail.progress(s.save.trail.metres, 0).label, 'reading the walk');
    assert.eq(s.toasts[0].opts.color, UI_STREET_INK, 'in the street ink');
    assert.eq(s.toasts[0].opts.tier, 'note');

    // ONE blast for the step — chips, sparks and the lightmap flash — at a
    // point ON the way, not at the player and not at a cell centre.
    const chips = s.bursts.filter((x) => x.kind === 'stone');
    const sparks = s.bursts.filter((x) => x.kind === 'trailspark');
    assert.eq(chips.length, 1, 'one chip burst per sweep');
    assert.eq(sparks.length, 1, 'one spark ring per sweep');
    assert.eq(s.bursts.length, 2, 'nothing else');
    assert.eq((s._blasts || []).length, 1, 'and one lightmap flash');
    assert.eq(s._blasts[0].radiusCells, BLAST_STONE_R_CELLS, 'a restoration\'s own width');
    assert.eq(chips[0].wmx, s._blasts[0].wmx, 'the chips and the flash share the point');
    assert.eq(chips[0].wmy, s._blasts[0].wmy);
    assert.inRange(chips[0].wmx, a, b, 'which sits on the stretch that came back');
    assert.inRange(chips[0].wmy, MID_M - 0.01, MID_M + 0.01, 'on the way itself');

    // Standing there longer restores nothing more — the stretch is spent.
    clock.at(PATH_STONE_DWELL_MS * 5); s._sweepStreets();
    assert.inRange(restoredM(s), got - 0.01, got + 0.01, 'a rebuilt street stays rebuilt');
    assert.eq(s.toasts.length, 1, 'and banks nothing twice');
  });
});

test('streets: a peek drag does not widen the sweep', () => {
  // The camera rule, both directions: a reach test moved onto the anchor would
  // let a peek rebuild three cells further than the arm reaches.
  const runOne = (peek) => withStreet((clock) => {
    const s = sweepScene({ peekM: peek });
    clock.at(0);                   s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS); s._sweepStreets();
    return restoredM(s);
  });
  const plain = runOne({ x: 0, y: 0 });
  const peeked = runOne({ x: 3 * CELL_M, y: 0 });
  assert.gt(plain, 0, 'the plain sweep restored something');
  assert.eq(peeked, plain, 'and a three-cell peek restores exactly the same metres');
  assert.truthy(/const p = playerReachCell\(this\);/.test(APP_JS_SRC),
    'the sweep measures from the reach cell');
  const scan = APP_JS_SRC.slice(APP_JS_SRC.indexOf('  _rescanStreets(p, reachM, now, sight) {'));
  assert.falsy(/peekM|viewAnchor/.test(scan.slice(0, scan.indexOf('\n  }\n'))),
    'and the scan never reads the camera anchor');
});

test('streets: leaving the bubble restarts the clock from zero', () => {
  withStreet((clock) => {
    const s = sweepScene();
    clock.at(0);    s._sweepStreets();
    // Walk well clear along the way, then come back: the stretch by the start
    // is new again.
    clock.at(1500); s.playerM.x += 12 * CELL_M; s._sweepStreets();
    clock.at(1600); s.playerM.x -= 12 * CELL_M; s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS); s._sweepStreets();
    assert.eq(restoredM(s), 0, 'the first look bought nothing');
    clock.at(1600 + PATH_STONE_DWELL_MS); s._sweepStreets();
    assert.gt(restoredM(s), 0, 'two seconds from the RETURN, not from the first glimpse');
  });
});

test('streets: the auto-walk home earns none of it', () => {
  withStreet((clock) => {
    const s = sweepScene({ _driftingHome: true });
    clock.at(0);                       s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS * 3); s._sweepStreets();
    assert.eq(restoredM(s), 0, 'a character walking itself home rebuilds nothing');
    assert.eq(s.toasts.length, 0, 'and banks nothing');
  });
});

test('streets: a drift home mid-watch drops the clock it was holding', () => {
  withStreet((clock) => {
    const s = sweepScene();
    clock.at(0);    s._sweepStreets();
    // One frame of the walk home, then the player takes over again.
    clock.at(1900); s._driftingHome = true;  s._sweepStreets();
    clock.at(1901); s._driftingHome = false; s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS); s._sweepStreets();
    assert.eq(restoredM(s), 0, 'the interrupted watch bought nothing');
    clock.at(1901 + PATH_STONE_DWELL_MS); s._sweepStreets();
    assert.gt(restoredM(s), 0, 'the clock restarted when the player did');
  });
});

test('streets: no light, no watch — a cave and a flat battery rebuild nothing', () => {
  withStreet((clock) => {
    for (const over of [{ depth: 2 }, { save: { energy: 0, reachUpgrades: 0 } }]) {
      const s = sweepScene(over);
      clock.at(0);                       s._sweepStreets();
      clock.at(PATH_STONE_DWELL_MS * 2); s._sweepStreets();
      assert.eq(restoredM(s), 0, 'nothing rebuilt');
      assert.eq(s._streetSweepKey, null, 'and no watch list left behind');
      assert.eq(s._streetLines, null);
    }
  });
});

test('streets: rail is never rebuilt, and a parking aisle is', () => {
  // The overlay DRAWS a parking aisle, so it restores like any other way; a
  // railway is not a street to rebuild at all.
  const run = (cls) => withStreet((clock) => {
    const s = sweepScene();
    clock.at(0);                   s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS); s._sweepStreets();
    return restoredM(s);
  }, { id: 9, type: 2, tags: { class: cls, service: 'parking_aisle' }, geom: straightWay().geom });
  assert.eq(run('rail'), 0, 'a railway is left alone');
  assert.eq(run('transit'), 0, 'and so is a tramway');
  assert.gt(run('service'), 0, 'a parking aisle comes back like any street');
});

test('streets: only the tile SQUARE is ever paid for', () => {
  // MVT geometry runs past the tile edge into the buffer, and the same metres
  // come back inside the neighbour tile's copy of the way. Restoring buffer
  // metres would pay twice for every way that crosses a tile edge.
  const buffered = {
    id: 11, type: 2, tags: { class: 'minor' },
    // Starts a quarter-tile OUTSIDE the square (negative x) and runs east.
    geom: [[{ x: -EXTENT / 4, y: EXTENT / 2 }, { x: EXTENT, y: EXTENT / 2 }]],
  };
  withStreet((clock) => {
    const s = sweepScene({ playerM: { x: 1.5 * CELL_M, y: MID_M } });
    clock.at(0);                   s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS); s._sweepStreets();
    const iv = restoredIvs(s, WorldGen.tileKey(0, 0))[0];
    assert.truthy(iv && iv.length, 'the near end of the way came back');
    // Arclength is measured from the line's FIRST vertex, which is a quarter
    // tile west of the square, so nothing under that offset may be restored.
    const buffer = EXTENT / 4 * (TILE_EDGE_M / EXTENT);
    assert.gte(iv[0][0], buffer - 0.01, 'not one metre of the buffer');
  }, buffered);
});

test('streets: the prize fires at two hundred metres, wherever they were restored', () => {
  withStreet((clock) => {
    // 180 m already banked: one sweep of the 35 m in reach carries it past the
    // first goal, which is what the ceremony queue is for.
    const s = sweepScene({ save: { energy: 10, reachUpgrades: 0, trail: { metres: 180, prizes: 0 } } });
    clock.at(0);                   s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS); s._sweepStreets();
    assert.eq(s.save.trail.prizes, 1, 'the first prize is won');
    assert.eq(s._trailPrizeQueue.length, 1, 'one ceremony queued');
    assert.eq(s._trailPrizeQueue[0], 1, 'and it is the FIRST prize\'s ordinal');
    assert.eq(s.drained, 1, 'the queue is drained once');
    // The counter on a paying sweep reads the goal it completed, full, so the
    // street and the ceremony beside it print the same rung.
    assert.eq(s.toasts[0].text, Trail.label(Trail.GOAL_STEP_M, Trail.GOAL_STEP_M),
      'the counter reads the completed goal');
    assert.inRange(s.save.trail.metres, 14.99, 15.01, 'with the remainder carried');
  });
});

test('streets: the counter is throttled, but a paying sweep never waits', () => {
  // Walking along a street restores metres on nearly every frame; a number
  // redrawn sixty times a second is a flicker, not a readout. The ladder banks
  // regardless — only the toast waits.
  const s = sweepScene();
  s.save.trail = { metres: 0, prizes: 0 };
  s._bankStreetMetres(10, null, 1000);
  assert.eq(s.toasts.length, 1, 'the first step shows');
  s._bankStreetMetres(10, null, 1000 + STREET_COUNTER_MIN_MS - 1);
  assert.eq(s.toasts.length, 1, 'a step inside the window is silent');
  assert.inRange(s.save.trail.metres, 19.99, 20.01, 'but it still banked');
  s._bankStreetMetres(10, null, 1000 + STREET_COUNTER_MIN_MS);
  assert.eq(s.toasts.length, 2, 'and the next one past it shows');
  // A sweep that PAYS jumps the queue: its readout is the goal just completed,
  // which is the number the ceremony opening beside it also prints.
  s._bankStreetMetres(Trail.GOAL_STEP_M, null, 1000 + STREET_COUNTER_MIN_MS + 1);
  assert.eq(s.toasts.length, 3, 'a paying sweep is never throttled away');
  assert.eq(s.toasts[2].text, Trail.label(Trail.GOAL_STEP_M, Trail.GOAL_STEP_M));
});

test('streets: the live pass previews the dwell and shines on the rebuild', () => {
  // Two things the baked canvases can't carry, because they change every
  // frame: the clean carriageway creeping in while the dwell runs, and the
  // white run down a stretch the instant it comes back.
  const real = RoadOverlay.drawLive;
  let seen = [];
  RoadOverlay.drawLive = (scene, runs) => { seen = runs.map((r) => ({ ...r })); };
  // The live pass runs from drawRoadGeometry, AFTER RoadOverlay.draw has moved
  // the container it strokes into — so a frame is the sweep and then the draw.
  const frame = (s) => { s._sweepStreets(); s._drawStreetLive(); };
  try {
    withStreet((clock) => {
      const s = sweepScene();
      clock.at(0); frame(s);
      assert.eq(seen.length, 0, 'nothing to preview in the frame sight opened');

      clock.at(PATH_STONE_DWELL_MS / 2); frame(s);
      assert.eq(seen.length, 1, 'one preview run');
      assert.inRange(seen[0].alpha, STREET_PREVIEW_ALPHA / 2 - 0.01, STREET_PREVIEW_ALPHA / 2 + 0.01,
        'at half the dwell, half the preview alpha');
      assert.eq(seen[0].colour, undefined, 'in the way\'s own restored colour');
      assert.eq(seen[0].tags.class, 'minor', 'carrying the class the width is read from');
      assert.gte(seen[0].pts.length, 2, 'as a polyline');
      // WORLD metres, on the way: this tile's origin is (0,0), so the preview
      // sits on the row the street runs along.
      for (const q of seen[0].pts) {
        assert.inRange(q.y, MID_M - 0.01, MID_M + 0.01, 'every point is on the way');
      }

      clock.at(PATH_STONE_DWELL_MS); frame(s);
      const shine = seen.filter((r) => r.colour === 0xffffff);
      assert.eq(shine.length, 1, 'the rebuilt stretch shines white');
      // STREET_SHINE_ALPHA, not white: the gleam is a nod over the new
      // surface, and at the width a trunk road is stroked at a full-white run
      // whited the carriageway out every few paces of an ordinary walk.
      assert.inRange(shine[0].alpha, STREET_SHINE_ALPHA - 0.01, STREET_SHINE_ALPHA + 0.01,
        'brightest at the instant it lands, at the shine\'s own ceiling');
      assert.lt(STREET_SHINE_ALPHA, 1, 'which is well under full white');
      assert.eq(seen.filter((r) => r.colour !== 0xffffff).length, 0,
        'and the preview stops drawing over the clean band the same frame');

      clock.at(PATH_STONE_DWELL_MS + STREET_SHINE_MS / 2); frame(s);
      // Eased out (the square of the remaining life), so the gleam spends most
      // of its clock on the way to gone rather than half-lit behind the player.
      assert.inRange(seen[0].alpha, STREET_SHINE_ALPHA * 0.25 - 0.01,
                     STREET_SHINE_ALPHA * 0.25 + 0.01, 'the shine fades over its own clock');
      clock.at(PATH_STONE_DWELL_MS + STREET_SHINE_MS); frame(s);
      assert.eq(seen.length, 0, 'and is gone when it burns out');
    });
    // Walking into a cave clears the live layer rather than freezing a preview
    // on the ground.
    withStreet((clock) => {
      const s = sweepScene();
      clock.at(0); frame(s);
      clock.at(PATH_STONE_DWELL_MS / 2); frame(s);
      assert.gt(seen.length, 0, 'a preview is up');
      s.depth = 2; frame(s);
      assert.eq(seen.length, 0, 'and the cave clears it');
    });
  } finally {
    RoadOverlay.drawLive = real;
  }
});

test('streets: the sweep is memoised on the reach cell, and the ripen runs every frame', () => {
  // The SCAN is the expensive half — a grid traversal per line of every way in
  // the 3×3 tiles — and standing still can't bring fresh street into the
  // bubble. The RIPEN half is waiting on the clock, not the player, so it runs
  // regardless.
  const src = APP_JS_SRC.slice(APP_JS_SRC.indexOf('  _sweepStreets() {'));
  const body = src.slice(0, src.indexOf('\n  }\n'));
  assert.truthy(/const sweepKey = `\$\{p\.cellIX\},\$\{p\.cellIY\},\$\{Math\.round\(reachM\)\}`;/.test(body),
    'the memo key is the reach cell plus the radius');
  assert.truthy(/if \(this\._streetSweepKey !== sweepKey\) \{[\s\S]*?this\._rescanStreets\(/.test(body),
    'and only a change rescans');
  assert.truthy(/this\._ripenStreets\(now, sight\);/.test(body),
    'while the ripen runs every frame');
  // The live pass is NOT in the sweep: it strokes into the container
  // RoadOverlay.draw positions, and the sweep runs earlier in update() — so it
  // hangs off drawRoadGeometry, after the draw.
  assert.truthy(/drawRoadGeometry\(\) \{\n\s+if \(typeof RoadOverlay === 'undefined'\) return;\n\s+RoadOverlay\.draw\(this\);[\s\S]{0,400}?this\._drawStreetLive\(\);/.test(APP_JS_SRC),
    'and the live pass runs after the overlay draw, every frame');
  assert.falsy(/_drawStreetLive/.test(body), 'never from the sweep itself');
});

// ── THE FIRST REPAIR ──────────────────────────────────────────────────────
// One sweep of the shipping pass.
const sweep = (s) => { s._sweepStreets(); };

// Restoration has no tap and no tool, so the first stretch to come back under
// a new player is an unexplained flash and a number. The one-time dialog is
// what turns it into an invitation — once per SAVE, and never for someone
// already halfway up the ladder.
test('streets: the first metres ever banked open the one-time dialog', () => {
  withStreet((clock) => {
    const s = sweepScene();
    clock.at(0); sweep(s);
    clock.at(PATH_STONE_DWELL_MS); sweep(s);
    assert.eq(s.intros.length, 1, 'the dialog opened on the first metres');
    assert.eq(s.intros[0].title, TRAIL_INTRO_TITLE, 'with the greeting title');
    assert.truthy(s.save.trail.greeted, 'and the save remembers it');
    // The rung it promises is Trail's own, never a retyped 200.
    assert.truthy(s.intros[0].body.includes(`${Trail.GOAL_STEP_M}m`),
      'quoting the rung the ladder actually pays at');
    assert.truthy(/arteries of civilization/.test(s.intros[0].body), 'in the survivors\' voice');
    // …and never again.
    s.playerM = { x: MID_M + CELL_M * 3, y: MID_M };
    clock.at(PATH_STONE_DWELL_MS * 2); sweep(s);
    clock.at(PATH_STONE_DWELL_MS * 3); sweep(s);
    assert.eq(s.intros.length, 1, 'and never opens a second time');
  });
});

test('streets: the greeting waits for a clear screen, and asks again', () => {
  // The first sweep can land seconds into a brand new session — exactly when
  // the how-to card is up. A dialog opened behind that one is a dialog nobody
  // reads, and the save's one greeting would be spent on it.
  withStreet((clock) => {
    const s = sweepScene();
    const body = { classList: { has: true, contains(c) { return c === 'modal-open' && this.has; } } };
    const realBody = document.body;
    document.body = body;
    try {
      clock.at(0); sweep(s);
      clock.at(PATH_STONE_DWELL_MS); sweep(s);
      assert.eq(s.intros.length, 0, 'nothing opens behind the card');
      assert.falsy(s.save.trail.greeted, 'and the greeting is not spent');
      assert.gt(s.save.trail.metres, 0, 'though the metres still bank');
      body.classList.has = false;
      s.playerM = { x: MID_M + CELL_M * 3, y: MID_M };
      clock.at(PATH_STONE_DWELL_MS * 2); sweep(s);
      clock.at(PATH_STONE_DWELL_MS * 3); sweep(s);
      assert.eq(s.intros.length, 1, 'and the next sweep with a clear screen asks again');
      assert.truthy(s.save.trail.greeted, 'spending it then');
    } finally { document.body = realBody; }
  });
});

test('streets: a save already up the ladder is never introduced to it', () => {
  withStreet((clock) => {
    const s = sweepScene({ save: { energy: 10, reachUpgrades: 0,
                                   trail: { metres: 40, prizes: 2, greeted: true } } });
    clock.at(0); sweep(s);
    clock.at(PATH_STONE_DWELL_MS); sweep(s);
    assert.gt(s.save.trail.metres, 40, 'it still banks');
    assert.eq(s.intros.length, 0, 'but says nothing');
  });
});

test('streets: a prize on the greeting sweep waits for the dialog to close', () => {
  withStreet((clock) => {
    // A save one metre short of a rung, greeted for the first time on the very
    // sweep that pays it. The ceremony must not open on top of the dialog.
    const s = sweepScene({ save: { energy: 10, reachUpgrades: 0,
                                   trail: { metres: Trail.GOAL_STEP_M - 1, prizes: 0 } } });
    const order = [];
    s.showMessageModal = (o) => { order.push('intro'); s.intros.push(o); o.onDismiss?.(); };
    s._drainTrailPrizes = () => { order.push('prize'); s.drained += 1; };
    clock.at(0); sweep(s);
    clock.at(PATH_STONE_DWELL_MS); sweep(s);
    assert.eq(s.intros.length, 1, 'the dialog opened');
    assert.eq(s.save.trail.prizes, 1, 'and the sweep really did pay a rung');
    assert.eq(order.join(','), 'intro,prize', 'and the ceremony followed it, never beside it');
  });
});
})();
