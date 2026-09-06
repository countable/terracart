// Cobble trails — the segment arithmetic (src/trail.js) and the worldgen
// naming pass that decides WHICH cells belong to which trail.
//
// app.js can't load headlessly (it needs Phaser), which is exactly why the
// arithmetic lives in trail.js: these run the real shipping numbers, not a
// copy of them that would drift the moment someone retunes the feel.

// ── The segment ladder ────────────────────────────────────────────────────
(() => {
  const T = Trail;
  const S = T.SEGMENT_CELLS;

  test('trail: a prize is about 200 metres of walking', () => {
    // The ladder is a DISTANCE wearing a cell count. trail.js loads before
    // worldgen.js so it can't do this division itself — this is the tripwire
    // that keeps the written-out number and the real cell size together.
    assert.eq(T.PRIZE_WALK_M, 200, 'the walk a prize costs');
    assert.eq(S, Math.round(T.PRIZE_WALK_M / WorldGen.CELL_M),
      `SEGMENT_CELLS is ${T.PRIZE_WALK_M}m of ${WorldGen.CELL_M}m cells`);
    const walkM = S * WorldGen.CELL_M;
    assert.inRange(walkM, T.PRIZE_WALK_M - 10, T.PRIZE_WALK_M + 10,
      `a segment is ${walkM}m on the ground`);
  });

  test('trail: about ten pebbles light up between prizes', () => {
    // The two halves of the same feel: render.js draws one stone per
    // COBBLE_SPACING_M of path, the ladder pays per PRIZE_WALK_M of it, so the
    // player watches ~10 stones come on and then gets something. Neither
    // number means anything without the other, so they're pinned together.
    assert.eq(Render.COBBLE_SPACING_M, 20, 'metres between pebbles');
    const pct = Render.pathStonePct(WorldGen.CELL_M);
    assert.eq(pct, Math.round(100 * WorldGen.CELL_M / Render.COBBLE_SPACING_M),
      'the share is derived from the cell size, not authored');
    const stones = S * pct / 100;
    assert.inRange(stones, 8, 12, `${stones} stones drawn per prize`);
  });

  test('trail: the pebble share follows the cell size', () => {
    // Cell size drifts with latitude (tileEdgeM / cellsPerEdge), which is why
    // the share is computed rather than authored: the SPACING is what stays
    // put, so smaller cells mean more of them per metre and a smaller share
    // carrying a stone. Never zero and never over 100 — a cell wider than the
    // spacing simply draws every stone.
    assert.lt(Render.pathStonePct(3.5), Render.pathStonePct(7),
      'half-size cells need half the share for the same spacing');
    assert.eq(Render.pathStonePct(40), 100, 'a huge cell draws every stone');
    assert.gt(Render.pathStonePct(0.1), 0, 'and a tiny one still draws some');
  });

  test('trail: a short trail counts against its own length', () => {
    // The canonical example: a 9-cell trail reads 1/9 … 9/9, never 1/S.
    for (let c = 1; c <= 9; c++) {
      const p = T.progress(9, c);
      assert.eq(p.pos, c, `stone ${c} is at position ${c}`);
      assert.eq(p.target, 9, 'and the target is the trail itself');
    }
  });

  test('trail: a long trail counts in segments and restarts', () => {
    const total = 2 * S + 12;            // two full segments and a remainder
    assert.eq(T.progress(total, 1).target, S, 'first segment wants a full one');
    assert.eq(T.progress(total, S).pos, S, 'the S-th stone closes it');
    assert.eq(T.progress(total, S + 1).pos, 1, 'the next restarts the count');
    assert.eq(T.progress(total, S + 1).target, S, 'and wants a full one too');
    assert.eq(T.progress(total, 2 * S + 1).pos, 1, 'and again on the third');
    assert.eq(T.progress(total, 2 * S + 1).target, 12, 'but the remainder wants 12');
    assert.eq(T.progress(total, total).pos, 12, 'the last stone closes it');
  });

  test('trail: prizes = ceil(length / segment)', () => {
    for (const [total, want] of [[1, 1], [S - 1, 1], [S, 1], [S + 1, 2],
                                 [2 * S, 2], [2 * S + 1, 3], [10 * S, 10]]) {
      assert.eq(T.maxPrizes(total), want, `a ${total}-cell trail offers ${want}`);
    }
  });

  test('trail: a prize lands on every segment boundary, remainder included', () => {
    // Two full segments and a 12-cell tail: paid at S, at 2S, and again when
    // the tail is lit.
    const total = 2 * S + 12;
    const paid = [];
    let last = 0;
    for (let c = 1; c <= total; c++) {
      const n = T.prizesEarned(total, c);
      if (n > last) { paid.push(c); last = n; }
    }
    assert.eq(paid.join(','), `${S},${2 * S},${total}`, 'prizes on each boundary');
    assert.eq(last, T.maxPrizes(total), 'and they add up to the trail\'s total');
  });

  test('trail: an exact multiple pays no extra prize at the end', () => {
    // Two whole segments — the remainder branch must not fire a third one
    // when the last stone is also the last of a full segment.
    assert.eq(T.prizesEarned(2 * S, 2 * S), 2, 'two prizes, not three');
    assert.eq(T.prizesEarned(2 * S, 2 * S), T.maxPrizes(2 * S), 'matches the ceiling');
  });

  test('trail: prizes never exceed the ceiling, even over-claimed', () => {
    // Defensive: a stale save could carry more stones than the rebuilt tile's
    // trail has cells. It must not mint prizes out of that.
    assert.eq(T.prizesEarned(9, 99), T.maxPrizes(9), 'capped at the ceiling');
    assert.eq(T.prizesEarned(0, 5), 0, 'a zero-length trail pays nothing');
    assert.eq(T.prizesEarned(S, 0), 0, 'and an unwalked one pays nothing');
  });

  test('trail: a stub too short to be worth walking pays nothing', () => {
    // Every cobble cell is named now (roads included), so without this floor
    // a two-cell service stub would pop the full treasure ceremony.
    assert.eq(T.MIN_TRAIL_CELLS, 8, 'the floor');
    assert.falsy(T.qualifies(7), 'a 7-cell stub does not qualify');
    assert.truthy(T.qualifies(8), 'an 8-cell trail does');
  });
})();

// ── Which cells belong to which trail, through the real rasterizer ────────
(function () {
const T = WorldGen.T;
const CPE = 64;
const TILE_EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const cellToMvt = (c) => c * CELL_MVT + CELL_MVT / 2;
const line = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
const whole = () => line([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]]);

// A park with a named footpath across the middle and a named street down the
// side, crossing each other — the case that a plain flood fill over the cobble
// mask gets wrong (it would merge both into one component).
function build() {
  return WorldGen.rasterizeTile([
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'park' }, geom: [whole()] },
    ] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'path' },   geom: [line([[8, 30], [56, 30]])] },
      { type: 2, tags: { class: 'street' }, geom: [line([[30, 8], [30, 56]])] },
    ] },
    { name: 'transportation_name', features: [
      { type: 2, tags: { name: 'Mill Lane' },  geom: [line([[8, 30], [56, 30]])] },
      { type: 2, tags: { name: 'Oak Street' }, geom: [line([[30, 8], [30, 56]])] },
    ] },
  ], CPE, 0, 0, TILE_EDGE_M);
}

const ROADISH = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH]);

test('trail names: a ROAD cell is claimable, not just a path cell', () => {
  // This is the whole "road cobbles work too now" change: before it, only
  // terrain 8 landed in pathNames and a street lit nothing.
  const e = build();
  let roadNamed = 0;
  for (let cy = 0; cy < CPE; cy++) {
    for (let cx = 0; cx < CPE; cx++) {
      const t = e.grid[cy * CPE + cx];
      if (t !== T.PATH && ROADISH.has(t) && e.pathNames[`${cx}_${cy}`]) roadNamed++;
    }
  }
  assert.gt(roadNamed, 20, 'the street\'s cells carry a trail name');
});

test('trail names: every cobble cell gets a name, and nothing else does', () => {
  const e = build();
  for (let cy = 0; cy < CPE; cy++) {
    for (let cx = 0; cx < CPE; cx++) {
      const t = e.grid[cy * CPE + cx];
      const named = !!e.pathNames[`${cx}_${cy}`];
      if (ROADISH.has(t)) assert.truthy(named, `cobble ${cx},${cy} is named`);
      else assert.falsy(named, `non-cobble ${cx},${cy} is not`);
    }
  }
});

test('trail names: two crossing streets stay two trails', () => {
  // A flood fill over the cobble mask would swallow both into one component
  // at the junction — a 400-cell blob with a single name. The wavefront keeps
  // each way's own identity.
  const e = build();
  const names = new Set(Object.values(e.pathNames));
  assert.truthy(names.has('Mill Lane'), 'the footpath kept its name');
  assert.truthy(names.has('Oak Street'), 'and the street kept its own');
  // Each name owns a run of cells long enough to actually pay out.
  const count = (n) => Object.values(e.pathNames).filter((v) => v === n).length;
  assert.gt(count('Mill Lane'), Trail.MIN_TRAIL_CELLS, 'Mill Lane is walkable');
  assert.gt(count('Oak Street'), Trail.MIN_TRAIL_CELLS, 'so is Oak Street');
});

test('trail names: an unnamed way still becomes its own trail', () => {
  // No transportation_name layer at all: the synthetic pass has to name the
  // component, or the way would be unclaimable.
  const e = WorldGen.rasterizeTile([
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'park' }, geom: [whole()] },
    ] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'path' }, geom: [line([[8, 20], [56, 20]])] },
    ] },
  ], CPE, 0, 0, TILE_EDGE_M);
  const names = new Set(Object.values(e.pathNames));
  assert.eq(names.size, 1, 'one trail');
  const only = [...names][0];
  assert.truthy(only.startsWith('trail#'), `synthetic id, got "${only}"`);
});
})();

// ── The prize is a CHOICE ─────────────────────────────────────────────────
// A segment pays two rolls and the player keeps ONE. Two rules carry it:
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
  const at = app.indexOf('_firePathCompletionReward(name, onDismiss) {');
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
