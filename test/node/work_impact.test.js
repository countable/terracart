// Work recoil follows the visible strike, affects only its target, and keeps
// the tree trunk planted as the canopy sways.
(function () {
  const job = (toolSlot) => ({ toolSlot, worldX: 20, worldY: 30,
    startT: 1000, durationMs: 4000 });
  const target = (kind) => ({ kind, x: 20, y: 30 });
  const sprite = () => ({ x: 80, y: 45, rotation: 0,
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setRotation(rotation) { this.rotation = rotation; return this; },
  });

  test('work impact: recoil begins at each strike and rests before the next', () => {
    for (const slot of ['axe', 'pickaxe']) {
      const wp = job(slot), look = Render.WORK_LOOKS[slot], hit = look.impact;
      const object = target(hit.kind), time = wp.startT + hit.atMs;
      assert.eq(Render.workImpactPose(wp, object, wp.startT - 1), null);
      assert.eq(Render.workImpactPose(wp, object, time - 1), null, 'no recoil during windup');
      const pose = Render.workImpactPose(wp, object, time + hit.ms / 4);
      assert.truthy(pose, 'recoil follows the strike');
      assert.truthy(pose.rotation || pose.x || pose.y, 'target moves during recoil');
      assert.eq(Render.workImpactPose(wp, object, time + hit.ms), null, 'recoil ends');
      const next = Render.workImpactPose(wp, object, time + hit.ms / 4 + look.beatMs);
      assert.eq(next.rotation, pose.rotation, 'next tool stroke repeats the recoil');
      assert.eq(next.x, pose.x); assert.eq(next.y, pose.y);
    }
  });

  test('work impact: only the matching tree or rock responds to an active job', () => {
    for (const slot of ['axe', 'pickaxe']) {
      const wp = job(slot), look = Render.WORK_LOOKS[slot], object = target(look.impact.kind);
      const now = wp.startT + look.impact.atMs + 50;
      assert.eq(Render.workImpactPose(null, object, now), null, 'cancelled work');
      assert.eq(Render.workImpactPose({ ...wp, combat: {} }, object, now), null, 'combat is separate');
      assert.eq(Render.workImpactPose(wp, object, wp.startT + wp.durationMs), null, 'completed work');
      assert.eq(Render.workImpactPose(wp, { ...object, x: 21 }, now), null, 'adjacent column');
      assert.eq(Render.workImpactPose(wp, { ...object, y: 31 }, now), null, 'adjacent row');
      assert.eq(Render.workImpactPose(wp, { ...object, kind: 'house' }, now), null, 'wrong object');
      for (const toolSlot of ['hoe', 'net', 'fishing_rod']) {
        assert.eq(Render.workImpactPose({ ...wp, toolSlot }, object, now), null, 'wrong tool');
      }
    }
  });

  test('work impact: tree sway and rock shake settle down after the strike', () => {
    for (const slot of ['axe', 'pickaxe']) {
      const wp = job(slot), impact = Render.WORK_LOOKS[slot].impact;
      const pose = (fraction) => Render.workImpactPose(wp, target(impact.kind),
        wp.startT + impact.atMs + fraction * impact.ms);
      const early = pose(0.25), late = pose(0.75);
      if (slot === 'axe') {
        assert.eq(early.x, 0); assert.eq(early.y, 0, 'trunk does not translate');
        assert.lt(Math.abs(late.rotation), Math.abs(early.rotation), 'sway loses energy');
      } else {
        assert.eq(early.rotation, 0, 'rock shakes without rotating');
        assert.lt(Math.abs(late.x), Math.abs(early.x), 'shake loses energy');
        assert.lte(early.y, 0, 'rock stays above its seat');
      }
    }
  });

  test('work impact: tree rotation preserves the trunk pivot', () => {
    const tree = sprite(), pivot = { x: 80, y: 80 };
    const trunkOffset = { x: pivot.x - tree.x, y: pivot.y - tree.y };
    Render.applyWorkImpact(tree, { rotation: 0.06, x: 0, y: 0 }, pivot.x, pivot.y);
    const cos = Math.cos(tree.rotation), sin = Math.sin(tree.rotation);
    const trunkX = tree.x + trunkOffset.x * cos - trunkOffset.y * sin;
    const trunkY = tree.y + trunkOffset.x * sin + trunkOffset.y * cos;
    assert.inRange(trunkX - pivot.x, -1e-9, 1e-9, 'trunk remains on world x');
    assert.inRange(trunkY - pivot.y, -1e-9, 1e-9, 'trunk remains on world y');
    assert.truthy(tree.x !== 80, 'canopy actually sways');
  });

  test('work impact: rock displacement preserves its orientation', () => {
    const rock = sprite();
    Render.applyWorkImpact(rock, { rotation: 0, x: 1.5, y: -0.5 }, 80, 80);
    assert.eq(rock.x, 81.5); assert.eq(rock.y, 44.5); assert.eq(rock.rotation, 0);
  });

  test('work impact: pooled target returns upright when work stops', () => {
    const tree = Object.assign(sprite(), {
      setVisible() { return this; }, setAlpha() { return this; },
      setAngle(angle) { this.rotation = angle * Math.PI / 180; return this; },
      setScale() { return this; }, setFlipX() { return this; }, clearTint() {},
    });
    const pool = [tree], object = target('tree'), wp = job('axe');
    function draw(activeJob) {
      Render.renderPool({}, pool, {}, [object], (s, o) => {
        s.setPosition(80, 45);
        Render.applyWorkImpact(s, Render.workImpactPose(activeJob, o, 1250), 80, 80);
      });
    }
    draw(wp);
    assert.truthy(tree.rotation !== 0, 'working tree sways');
    draw(null);
    assert.eq(tree.rotation, 0, 'pooled rotation reset after cancellation');
    assert.eq(tree.x, 80); assert.eq(tree.y, 45, 'original seat restored');
  });
})();

// A logged bush (a timber wildplant under the axe) sways like a tree: the
// same recoil about its foot, never the rock's sideways jolt.
(function () {
  test('work impact: a bush being logged sways like a tree', () => {
    const wp = { toolSlot: 'axe', worldX: 20, worldY: 30, startT: 1000, durationMs: 4000 };
    const hit = Render.WORK_LOOKS.axe.impact, time = wp.startT + hit.atMs + hit.ms / 4;
    const bush = { kind: 'wildplant', crop: 'shrub', x: 20, y: 30 };
    const tree = { kind: 'tree', x: 20, y: 30 };
    const a = Render.workImpactPose(wp, bush, time), b = Render.workImpactPose(wp, tree, time);
    assert.truthy(a && a.rotation, 'the bush recoils');
    assert.eq(a.rotation, b.rotation, 'the same sway as the tree'); assert.eq(a.x, 0); assert.eq(a.y, 0);
    assert.eq(Render.workImpactPose(wp, { kind: 'wildplant', crop: 'shrub', x: 21, y: 30 }, time), null, 'only the bush under the wheel');
    assert.eq(Render.workImpactPose({ ...wp, toolSlot: 'pickaxe' }, bush, time), null, 'the pick does not shake a bush');
    assert.truthy(/Render\.applyWorkImpact\(s, Render\.workImpactPose\(scene\._workProgress, p, performance\.now\(\)\),\s*s\.x, s\.y \+ \(1 - oy\) \* s\.displayHeight\)/.test(RENDER_SRC),
      'the wildplant pass applies it about the foot');
  });
})();
