test('step support rises and falls symmetrically from any direction without movement history', () => {
  const rock = { kind: 'mineralrock', x: 30, y: -20 };
  const at = (dx, dy) => ObstacleStep.sample(30 + dx * 10, -20 + dy * 10, [rock], 10).liftPx;
  assert.eq(at(0, 0), 4);
  assert.eq(at(0.25, 0), 0, 'outer edge is a quarter-cell radius');
  assert.eq(at(0.3, 0), 0, 'outside the middle half-cell stays grounded');
  assert.gt(at(0.2, 0), 0);
  assert.eq(at(0.2, 0), at(0, -0.2));
  assert.eq(at(0.2, 0), at(-0.2, 0));
  const paused = at(0.2, 0);
  at(0, 0); // Walking forward and reversing returns exactly to the same height.
  assert.eq(at(0.2, 0), paused);
  assert.inRange(Math.abs(at(0.2, 0) - at(Math.sqrt(0.02), Math.sqrt(0.02))), 0, 1e-12);
});

test('step bands follow horizontal/vertical wall atlas connections, not full tiles', () => {
  const horizontal = { kind: 'stronghold_wall', variant: 0, x: 0, y: 0 };
  const vertical = { ...horizontal, variant: 1 };
  const at = (o, x, y) => ObstacleStep.sample(x, y, [o], 1).liftPx;
  assert.eq(at(horizontal, 0.45, 0), 5);
  assert.eq(at(horizontal, 0, 0.45), 0);
  assert.eq(at(vertical, 0.45, 0), 0);
  assert.eq(at(vertical, 0, 0.45), 5);
  assert.gt(at(horizontal, 0, 0.25), 0);
  assert.lt(at(horizontal, 0, 0.25), 5);
});

test('connected walls keep a flat support across cell seams and list both supports', () => {
  const walls = [0, 1, 2].map(x => ({ kind: 'stronghold_wall', variant: 0, x, y: 0 }));
  for (let x = 0; x <= 2; x += 0.025) assert.eq(ObstacleStep.sample(x, 0, walls, 1).liftPx, 5);
  assert.eq(ObstacleStep.sample(0.5, 0, walls, 1).supports.length, 2);
  assert.eq(ObstacleStep.sample(0.5, 0, [...walls, ...walls], 1).liftPx, 5);
});

test('corner and junction support respects arms and leaves unused corners on ground', () => {
  const corner = { kind: 'stronghold_wall', variant: 2, x: 0, y: 0 }; // E+S
  const at = (o, x, y) => ObstacleStep.sample(x, y, [o], 1).liftPx;
  assert.eq(at(corner, 0.5, 0), 5);
  assert.eq(at(corner, 0, 0.5), 5);
  assert.eq(at(corner, -0.5, 0), 0);
  assert.eq(at(corner, 0.5, 0.5), 0);
  const cross = { ...corner, variant: 10 };
  for (const [x, y] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) assert.eq(at(cross, x, y), 5);
});

test('bushes are centred, joined hedges follow their rendered frame, short plants stay flat', () => {
  const bush = { kind: 'wildplant', crop: 'shrub', x: 0, y: 0 };
  const hedge = { ...bush, _plantArt: 'zone_hedge', _hedgeFrame: 1 };
  assert.eq(ObstacleStep.sample(0, 0, [bush], 1).liftPx, 3);
  assert.eq(ObstacleStep.sample(0.45, 0, [hedge], 1).liftPx, 0);
  assert.eq(ObstacleStep.sample(0, 0.45, [hedge], 1).liftPx, 6);
  for (const crop of ['longgrass', 'mushroom', 'flint']) assert.eq(ObstacleStep.profile({ ...bush, crop }), null);
  assert.eq(ObstacleStep.profile({ kind: 'tree', size: 'large' }), null);
  assert.eq(ObstacleStep.profile({ kind: 'tar' }), null);
  assert.eq(ObstacleStep.profile({ kind: 'zone_prop', variant: 40 }), null);
  assert.eq(ObstacleStep.speedMul({liftPx: 3}), 0.7);
  assert.eq(ObstacleStep.speedMul({liftPx: 0}), 1);
  assert.eq(ObstacleStep.sample(0, 0, [], 1).liftPx, 0);
  assert.eq(ObstacleStep.sample(0, 0, [bush], 0).liftPx, 0);
});

test('support stays continuous at top and approach boundaries; balance vanishes while stopped', () => {
  const rock = { kind: 'mineralrock', x: 0, y: 0 };
  const p = ObstacleStep.profile(rock);
  const at = x => ObstacleStep.sample(x, 0, [rock], 1).liftPx;
  assert.lt(Math.abs(at(p.top - 1e-6) - at(p.top + 1e-6)), 1e-8);
  assert.lt(Math.abs(at(p.radius - 1e-6) - at(p.radius + 1e-6)), 1e-8);
  assert.eq(ObstacleStep.balance(0.3, 0), 0);
  assert.inRange(ObstacleStep.balance(0.3, 1), -0.035, 0.035);
  assert.eq(ObstacleStep.balance(0.3, 2), ObstacleStep.balance(0.3, 1));
});
