// Rendering contracts for work effects: compact translucent progress, repeating
// tool motions with rests, and no invented tool art when a slot is unowned.
(function () {
  test('work wheel: solid sectors cover one disc at 50% opacity without overlap', () => {
    for (const progress of [0, 0.25, 0.5, 1]) {
      const sectors = [];
      let alpha, from, to, center, radius;
      const g = {
        fillStyle(_color, value) { alpha = value; },
        beginPath() { center = null; },
        moveTo(x, y) { center = { x, y }; },
        arc(x, y, r, a, b) { from = a; to = b; radius = r;
          assert.eq(x, 43); assert.eq(y, 61); },
        lineTo() {}, closePath() {},
        fillPath() { sectors.push({ alpha, from, to, center, radius }); },
      };
      Render.drawWorkWheel(g, 43, 61, progress);
      assert.gt(sectors.length, 0, 'there is a filled wheel even at zero progress');
      let covered = 0;
      for (const sector of sectors) {
        assert.eq(sector.alpha, 0.5, 'all parts have the same requested opacity');
        assert.eq(sector.radius, 7, 'compact wheel radius');
        assert.truthy(sector.center, 'sector connects to its centre without a hole');
        assert.eq(sector.center.x, 43); assert.eq(sector.center.y, 61);
        assert.gt(sector.to - sector.from, 0, 'each painted sector has positive area');
        covered += sector.to - sector.from;
      }
      assert.inRange(covered - 2 * Math.PI, -1e-9, 1e-9, 'one disc, without overlapping opacity');
      if (sectors.length === 2) {
        const ordered = sectors.slice().sort((a, b) => a.from - b.from);
        assert.inRange(ordered[0].to - ordered[1].from, -1e-9, 1e-9,
          'filled and remaining sectors meet exactly');
      }
    }
  });

  test('work tools: axe, hoe, pickaxe and net swing, rest and repeat at the target', () => {
    for (const slot of ['axe', 'hoe', 'pickaxe', 'net']) {
      const look = Render.WORK_LOOKS[slot];
      assert.truthy(look, slot + ' has a work animation');
      assert.gt(look.beatMs, look.ms, 'each swing has a short rest');
      const first = Render.workToolPose(slot, 0);
      const middle = Render.workToolPose(slot, look.ms / 2);
      assert.truthy(first && middle, 'tool is visible during the swing');
      assert.truthy(first.rotation !== middle.rotation, slot + ' actually rotates');
      assert.lt(middle.scale, 1, 'tool art stays smaller than the original icon');
      assert.eq(Render.workToolPose(slot, (look.ms + look.beatMs) / 2), null,
        'tool hides between swings');
      const repeat = Render.workToolPose(slot, look.beatMs);
      assert.eq(repeat.rotation, first.rotation, 'next beat starts another swing');
      assert.eq(repeat.x, first.x); assert.eq(repeat.y, first.y);
    }
  });

  function lift(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start, 'found ' + signature);
    return SCENE_SRC.slice(start + 1, end + 4);
  }
  function harness() {
    const clock = { time: 100, now() { return this.time; } };
    const made = [];
    const drawable = () => {
      const object = { arcs: 0, drops: 0, destroy() { this.destroyed = true; },
        arc() { this.arcs++; }, fillCircle() { this.drops++; } };
      for (const name of ['setPosition', 'setVisible', 'setRotation', 'setOrigin',
        'setScale', 'setAlpha', 'setDepth', 'setTexture', 'lineStyle', 'beginPath',
        'strokePath', 'clear', 'fillStyle']) {
        object[name] = function (...args) { this[name + 'Args'] = args; return this; };
      }
      made.push(object);
      return object;
    };
    const methods = new Function('performance', 'WORK_TOOL_ALPHA', 'worldMetersToAbsCell',
      'absCellCenterMeters', 'return {' + [
        '_drawWorkTool(wp, cx, cy, now) {', '_playWatering(worldX, worldY) {', '_drawWatering() {',
      ].map(lift).join(',') + '};')(clock, 0.5,
        (_scene, x, y) => ({ cellIX: Math.floor(x / 10), cellIY: Math.floor(y / 10) }),
        (_scene, x, y) => ({ x: x * 10 + 5, y: y * 10 + 5 }));
    const scene = Object.assign({ save: { relics: {} },
      _toolTexture: (slot, tier) => `${slot}:${tier}`,
      textures: { exists: () => true },
      worldMetersToScreen: (x, y) => ({ x: x * 2, y: y * 3 }),
      add: { graphics: drawable, image: drawable },
      _workProgressIcon: drawable(), _workToolGfx: drawable(),
    }, methods);
    return { scene, clock, made };
  }

  test('work tools: owned art animates at the target; missing tools use the generic sweep', () => {
    for (const slot of ['axe', 'hoe', 'pickaxe', 'net']) {
      const { scene } = harness();
      const wp = { toolSlot: slot, startT: 100 };
      scene._workProgressToolKey = `${slot}:4`;
      scene._drawWorkTool(wp, 200, 300, 200);
      const icon = scene._workProgressIcon;
      assert.eq(icon.setTextureArgs[0], `${slot}:4`, 'owned texture is used');
      assert.eq(icon.setVisibleArgs[0], true);
      assert.inRange(icon.setPositionArgs[0], 180, 220, 'work originates next to target');
      assert.inRange(icon.setPositionArgs[1], 280, 320);
      assert.eq(scene._workToolGfx.arcs, 0, 'owned tool replaces generic sweep');
      scene._workProgressToolKey = null;
      scene._drawWorkTool(wp, 200, 300, 200);
      assert.eq(icon.setVisibleArgs[0], false, 'old owned art is hidden');
      assert.eq(scene._workToolGfx.arcs, 1, 'unowned tool draws one mercenary-style sweep');
    }
  });

  test('watering: owned can pours once on the cell and destroys its transient art', () => {
    const { scene, clock } = harness();
    scene.save.relics.watering_can = { tier: 4 };
    scene._playWatering(22, 34);
    assert.eq(scene._wateringEffects.length, 1, 'one effect per watering');
    const effect = scene._wateringEffects[0];
    assert.eq(effect.texture, 'watering_can:4', 'actual owned tier');
    assert.eq(effect.x, 25); assert.eq(effect.y, 35);
    clock.time += effect.durationMs * 0.4;
    scene._drawWatering();
    assert.truthy(effect.icon, 'can is rendered');
    assert.gt(effect.gfx.drops, 0, 'water falls onto the cell');
    const firstIcon = effect.icon;
    clock.time += 10;
    scene._drawWatering();
    assert.eq(effect.icon, firstIcon, 'successive frames reuse the same pour');
    clock.time = effect.startT + effect.durationMs;
    scene._drawWatering();
    assert.eq(scene._wateringEffects.length, 0, 'pour finishes without a work wheel');
    assert.truthy(effect.icon.destroyed && effect.gfx.destroyed, 'transient objects cleaned up');
    scene._drawWatering();
    assert.eq(scene._wateringEffects.length, 0, 'pour does not repeat');
  });

  test('watering: no can uses one generic sweep without inventing can art', () => {
    const { scene, clock } = harness();
    scene._toolTexture = () => { throw new Error('Unowned can must not request art'); };
    scene._playWatering(22, 34);
    const effect = scene._wateringEffects[0];
    clock.time += 100;
    scene._drawWatering();
    assert.eq(effect.icon, undefined);
    assert.eq(effect.gfx.arcs, 1);
    assert.eq(effect.gfx.drops, 0, 'bare hands use the generic effect');
    clock.time = effect.startT + effect.durationMs;
    scene._drawWatering();
    assert.eq(scene._wateringEffects.length, 0);
    assert.truthy(effect.gfx.destroyed);
  });
})();
