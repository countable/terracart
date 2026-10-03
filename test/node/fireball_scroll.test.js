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

test('fireball scroll: a long frame ignites the launch, traversed cells and endpoint', () => {
  const s = shot(), cells = new Set();
  fly(s, [], { onFireCell: (x, y, projectile) => {
    assert.eq(projectile, s);
    cells.add(Math.floor((x + 1e-8) / CELL));
  } }, 10);
  for (let x = 0; x <= Math.floor(s.rangeM / CELL); x++) assert.truthy(cells.has(x), `trail cell ${x}`);
});

test('fireball scroll: blocked cells and cells past impact never ignite', () => {
  const samples = [];
  fly(shot(), [], { blocked: x => x >= 14,
    onFireCell: x => samples.push(x) }, 10);
  assert.eq(samples[0], 0);
  assert.truthy(samples.every(x => x < 14));
  assert.gt(samples.length, 1);
});

test('fireball scroll: ignition segments continuously cover a diagonal flight', () => {
  const s = Combat.spawnFireball(3, 5, { x: 3, y: 4 }, CELL, CONSUMABLE_SPEC.fireball_scroll);
  let lastX = s.x, lastY = s.y, count = 0;
  fly(s, [], { onFireSegment: (x0, y0, x1, y1, projectile) => {
    assert.eq(projectile, s);
    assert.eq(x0, lastX);
    assert.eq(y0, lastY);
    lastX = x1; lastY = y1; count++;
  } }, 10);
  assert.eq(lastX, s.x);
  assert.eq(lastY, s.y);
  assert.gt(count, 1);
});

test('explosive flask: a miss flies over obstacles to the exact vision edge', () => {
  const spec = CONSUMABLE_SPEC.explosive_flask;
  const s = Combat.spawnExplosiveFlask(3, 5, { x: 3, y: 4 }, CELL, 43, spec);
  const foe = { id: 'foe', x: 3 + 0.6 * 50, y: 5 + 0.8 * 50 };
  let fireSamples = 0;
  const hits = fly(s, [foe], { blocked: () => true, onFireCell: () => fireSamples++ }, 10);
  assert.eq(hits.length, 0, 'cannot strike a foe beyond maximum range');
  assert.eq(fireSamples, 0, 'flask does not leave a fire trail');
  assert.inRange(Math.hypot(s.x - 3, s.y - 5), 43 - 1e-7, 43 + 1e-7);
  assert.eq(s.projectile, 'explosive_flask');
  assert.eq(spec.fireRadiusCells, 1);
});

test('explosive flask: long frame hits the nearest foe for 30 without splash damage', () => {
  const s = Combat.spawnExplosiveFlask(0, 0, { x: 1, y: 0 }, CELL, 43, CONSUMABLE_SPEC.explosive_flask);
  const near = { id: 'near', x: 14, y: 0 };
  const far = { id: 'far', x: 28, y: 0 };
  const side = { id: 'side', x: 14, y: 4 };
  const events = [];
  const alive = Combat.stepShots([s], 10, [far, side, near, near], CELL,
    (e, projectile) => {
      events.push('hit');
      assert.eq(e, near);
      assert.eq(projectile.damage, 30);
      assert.eq(projectile.x, near.x - projectile.radiusM);
    }, { cellM: CELL, blocked: () => true, onExplode: projectile => {
      events.push('explode');
      assert.eq(projectile.x, near.x - projectile.radiusM, 'ground fire centers on impact');
    } });
  assert.eq(alive.length, 0);
  assert.eq(events.join(','), 'hit,explode', 'one direct hit then one explosion');
});

test('explosive flask: exact sweep catches a grazing foe between samples', () => {
  const s = Combat.spawnExplosiveFlask(0, 0, { x: 1, y: 0 }, CELL, 43, CONSUMABLE_SPEC.explosive_flask);
  const foe = { id: 'graze', x: 12.123, y: s.radiusM - 0.000001 };
  const hits = fly(s, [foe], {}, 10);
  assert.eq(hits.length, 1);
  assert.eq(hits[0].enemy, foe);
  const impactX = foe.x - Math.sqrt(s.radiusM * s.radiusM - foe.y * foe.y);
  assert.inRange(s.x, impactX - 1e-8, impactX + 1e-8);
});

test('explosive flask: eligibility and expanded target list govern direct impact', () => {
  const s = Combat.spawnExplosiveFlask(0, 0, { x: 1, y: 0 }, CELL, 43, CONSUMABLE_SPEC.explosive_flask);
  const ally = { id: 'ally', x: 7, y: 0 };
  const foe = { id: 'foe', x: 28, y: 0 };
  const hits = fly(s, [ally], { explosiveTargets: [ally, foe], canHit: e => e === foe }, 10);
  assert.eq(hits.length, 1);
  assert.eq(hits[0].enemy, foe);
  assert.eq(s.x, foe.x - s.radiusM);
});

test('explosive flask: range snapshots vision and invalid casts are refused', () => {
  const spec = CONSUMABLE_SPEC.explosive_flask;
  assert.eq(Combat.spawnExplosiveFlask(0, 0, { x: 0, y: 0 }, CELL, 20, spec), null);
  for (const range of [0, -1, Infinity, NaN]) {
    assert.eq(Combat.spawnExplosiveFlask(0, 0, { x: 1, y: 0 }, CELL, range, spec), null);
  }
  const s = Combat.spawnExplosiveFlask(0, 0, { x: 1, y: 0 }, CELL, 21, spec);
  let bursts = 0;
  const alive = Combat.stepShots([s], 0.01, [], CELL, () => {}, { cellM: CELL, onExplode: () => bursts++ });
  assert.eq(alive.length, 1);
  assert.eq(bursts, 0);
  assert.eq(s.rangeM, 21);
});
})();
