(function () {
const CELL = 7;
function shot() {
  return Combat.spawnFireball(0, 0, { x: 1, y: 0 }, CELL, CONSUMABLE_SPEC.fireball_scroll);
}
function fly(s, targets, options = {}, dt = 1 / 60) {
  let shots = [s], bursts = 0;
  const hits = [];
  for (let i = 0; i < 600 && shots.length; i++) {
    shots = Combat.stepShots(shots, dt, targets, CELL * Combat.HIT_RADIUS_CELLS,
      (enemy, projectile) => hits.push({ enemy, damage: projectile.damage }),
      { cellM: CELL, onExplode: () => bursts++, ...options });
  }
  assert.eq(shots.length, 0, 'projectile expires');
  assert.eq(bursts, 1, 'one impact burst');
  return hits;
}

test('fireball scroll: aimed cast carries fixed damage and large blast radius', () => {
  const s = shot(), spec = CONSUMABLE_SPEC.fireball_scroll;
  assert.eq(s.projectile, 'fireball');
  assert.eq(s.damage, spec.damage);
  assert.eq(s.blastRadiusM, spec.blastRadiusCells * CELL);
  assert.gt(s.blastRadiusM, s.radiusM);
  assert.gt(s.dotPx, 0);
  assert.eq(Combat.spawnFireball(0, 0, { x: 0, y: 0 }, CELL, spec), null);
});

test('fireball scroll: impact hits clustered enemies once, beyond the flight line', () => {
  const direct = { id: 'direct', x: 14, y: 0 };
  const side = { id: 'side', x: 14, y: 8 };
  const far = { id: 'far', x: 35, y: 8 };
  const hits = fly(shot(), [side, direct, far, side], {}, 1);
  assert.eq(hits.length, 2, 'large frame cannot skip first impact; duplicate is hit once');
  assert.truthy(hits.some(h => h.enemy === direct));
  assert.truthy(hits.some(h => h.enemy === side));
  assert.truthy(hits.every(h => h.damage === CONSUMABLE_SPEC.fireball_scroll.damage));
});

test('fireball scroll: wall impact explodes on near side and shields foes behind it', () => {
  const near = { id: 'near', x: 10, y: 8 };
  const behind = { id: 'behind', x: 22, y: 0 };
  const hits = fly(shot(), [near, behind], { blocked: x => x >= 14 && x <= 21 }, 1);
  assert.eq(hits.length, 1);
  assert.eq(hits[0].enemy, near);
});

test('fireball scroll: a miss detonates exactly at maximum range', () => {
  const s = shot();
  const side = { id: 'side', x: s.rangeM, y: 8 };
  const hits = fly(s, [side], {}, 10);
  assert.eq(hits.length, 1);
  assert.eq(hits[0].enemy, side);
  assert.truthy(Math.abs(s.x - s.rangeM) < 1e-7);
});

test('fireball scroll: current target eligibility governs collision and area damage', () => {
  const ally = { id: 'ally', x: 7, y: 0 };
  const foe = { id: 'foe', x: 35, y: 0 };
  const protectedFoe = { id: 'protected', x: 35, y: 7 };
  const hits = fly(shot(), [ally, foe, protectedFoe], { canHit: e => e === foe }, 1);
  assert.eq(hits.length, 1, 'ineligible target neither triggers early impact nor takes splash');
  assert.eq(hits[0].enemy, foe);
});

test('fireball scroll: explosion list reaches beyond auto-attack viewport targets', () => {
  const offscreen = { id: 'offscreen', x: 49, y: 0 };
  const side = { id: 'side', x: 49, y: 9 };
  const hits = fly(shot(), [], { explosiveTargets: [offscreen, side] });
  assert.eq(hits.length, 2);
  assert.truthy(hits.some(h => h.enemy === offscreen));
  assert.truthy(hits.some(h => h.enemy === side));
});
})();
