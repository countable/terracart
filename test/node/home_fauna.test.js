(() => {
  const animal = (kind, id, x = 0, y = 0, extra = {}) => ({ kind, id, x, y, ...extra });
  function fixture(groups, run) {
    const previous = WorldGen.tileCache;
    const entries = groups.map(creatures => ({ creatures }));
    WorldGen.tileCache = new Map(entries.map((entry, i) => [`${i},0`, entry]));
    const scene = { depth: 0, save: { caught: [] }, startWorldM: { x: 0, y: 0 }, _pestFreeZone: () => null };
    try { run(scene, entries); } finally { WorldGen.tileCache = previous; }
  }
  const active = (scene, c) => EnemySpawns.surfaceActive(scene, c);

  test('home fauna: the 250m boundary is a circle in metres, independent of cell size', () => {
    assert.eq(EnemySpawns.HOME_FAUNA_RADIUS_M, 250);
    const inside = animal('rabbit', 'inside', 149.9, 199.9);
    const edge = animal('rabbit', 'edge', 150, 200);
    const beyond = animal('rabbit', 'beyond', 250.01, 0);
    const squareCorner = animal('rabbit', 'corner', 200, 200);
    fixture([[inside, edge, beyond, squareCorner]], scene => {
      for (const cellM of [3, 7, 20]) {
        scene.cellM = cellM;
        EnemySpawns.refreshHomeFauna(scene);
        assert.falsy(active(scene, inside));
        assert.falsy(active(scene, edge), 'the circle includes its 250m boundary');
        assert.truthy(active(scene, beyond), 'just beyond 250m is outside');
        assert.truthy(active(scene, squareCorner), 'inside the bounding square but outside the circle');
      }
    });
  });

  test('home fauna: chickens remain while wildlife including rabbit and shore species is hidden', () => {
    const excluded = ['cow', 'cat', 'dog', 'rabbit', 'crow', 'raven', 'butterfly', 'horse', 'crab', 'gull', 'sea_turtle'];
    const creatures = excluded.map(kind => animal(kind, kind));
    const chickens = [animal('chicken', 'chicken-a'), animal('chicken', 'chicken-b')];
    fixture([[...creatures, ...chickens]], scene => {
      EnemySpawns.refreshHomeFauna(scene);
      for (const c of creatures) assert.falsy(active(scene, c), `${c.kind} is hidden by Home`);
      for (const c of chickens) assert.truthy(active(scene, c), 'chickens are not capped');
    });
  });

  test('home fauna: one deer across tiles, initial choice independent of tile iteration order', () => {
    for (const reversed of [false, true]) {
      const a = animal('deer', 'a-deer', 60), z = animal('deer', 'z-deer', 30);
      fixture(reversed ? [[a], [z]] : [[z], [a]], scene => {
        assert.eq(EnemySpawns.refreshHomeFauna(scene), a.id);
        assert.truthy(active(scene, a)); assert.falsy(active(scene, z));
      });
    }
  });

  test('home fauna: later tiles cannot replace a living selected deer or increase the cap', () => {
    const incumbent = animal('deer', 'z-deer', 80), newcomer = animal('deer', 'a-deer', 40);
    fixture([[incumbent]], scene => {
      EnemySpawns.refreshHomeFauna(scene);
      WorldGen.tileCache.set('new-tile', { creatures: [newcomer] });
      assert.eq(EnemySpawns.refreshHomeFauna(scene), incumbent.id);
      assert.truthy(active(scene, incumbent)); assert.falsy(active(scene, newcomer));
    });
  });

  test('home fauna: a deer dispatched at the garden takes the one slot from a resident', () => {
    const incumbent = animal('deer', 'a-deer', 80), pest = animal('deer', 'pest_deer_0_0_1000_7', 40);
    fixture([[incumbent]], scene => {
      assert.eq(EnemySpawns.refreshHomeFauna(scene), incumbent.id);
      WorldGen.tileCache.get('0,0').creatures.push(pest);
      assert.eq(EnemySpawns.refreshHomeFauna(scene), pest.id, 'the pump\'s deer is the one Home admits');
      assert.truthy(active(scene, pest)); assert.falsy(active(scene, incumbent), 'still one deer');
      scene.save.caught.push(pest.id);
      assert.eq(EnemySpawns.refreshHomeFauna(scene), incumbent.id, 'the resident returns once the pest is gone');
    });
  });

  test('home fauna: caught and dead deer cannot occupy the single live deer slot', () => {
    const caught = animal('deer', 'a-caught'), dead = animal('deer', 'b-dead', 0, 0, { _hp: 0 });
    const live = animal('deer', 'c-live', 0, 0, { _hp: 1 });
    fixture([[caught, dead, live]], scene => {
      scene.save.caught.push(caught.id);
      assert.eq(EnemySpawns.refreshHomeFauna(scene), live.id);
      scene.save.caught.push(live.id);
      assert.eq(EnemySpawns.refreshHomeFauna(scene), null, 'no replacement is manufactured');
      assert.eq(scene.save.caught.join(','), 'a-caught,c-live');
    });
  });

  test('home fauna: movement uses current positions and prevents excluded entrants', () => {
    const rabbit = animal('rabbit', 'rabbit', 260);
    const deer = animal('deer', 'resident', 20), visitor = animal('deer', 'visitor', 260);
    fixture([[rabbit, deer, visitor]], scene => {
      EnemySpawns.refreshHomeFauna(scene);
      assert.truthy(active(scene, rabbit)); assert.truthy(active(scene, visitor));
      assert.falsy(EnemySpawns.homeFaunaAllows(scene, rabbit, 240, 0), 'proposed rabbit step into the circle is rejected');
      assert.falsy(EnemySpawns.homeFaunaAllows(scene, visitor, 240, 0), 'another deer cannot step into the occupied circle');
      rabbit.x = visitor.x = 240;
      EnemySpawns.refreshHomeFauna(scene);
      assert.falsy(active(scene, rabbit)); assert.falsy(active(scene, visitor));
      deer.x = 260;
      assert.eq(EnemySpawns.refreshHomeFauna(scene), visitor.id, 'departing resident releases its slot');
      assert.truthy(active(scene, visitor));
      rabbit.x = 260;
      EnemySpawns.refreshHomeFauna(scene);
      assert.truthy(active(scene, rabbit), 'leaving the circle restores the original animal');
    });
  });

  test('home fauna: owned pets, summoned companions and NPCs are preserved', () => {
    const creatures = [animal('dog', 'pet', 0, 0, { pet: true }), animal('deer', 'pet-deer', 0, 0, { pet: true }),
      animal('spirit_raven', 'spirit'), animal('npc', 'npc'), animal('deer', 'wild-deer')];
    fixture([creatures], scene => {
      assert.eq(EnemySpawns.refreshHomeFauna(scene), 'wild-deer', 'owned deer does not take the wild slot');
      for (const c of creatures) assert.truthy(active(scene, c), c.id);
    });
  });

  test('home fauna: depth and home changes clear obsolete suppression', () => {
    const rabbit = animal('rabbit', 'rabbit', 0), other = animal('rabbit', 'other', 1000);
    fixture([[rabbit, other]], scene => {
      let anchor = { x: 0, y: 0 };
      scene._starterTrailAnchor = () => anchor;
      EnemySpawns.refreshHomeFauna(scene);
      assert.falsy(active(scene, rabbit)); assert.truthy(active(scene, other));
      scene.depth = 1;
      EnemySpawns.refreshHomeFauna(scene);
      assert.truthy(active(scene, rabbit), 'surface rule does not suppress cave animals');
      scene.depth = 0; anchor = { x: 1000, y: 0 };
      EnemySpawns.refreshHomeFauna(scene);
      assert.truthy(active(scene, rabbit)); assert.falsy(active(scene, other));
    });
  });

  test('home fauna: late Home capture and tame conversion invalidate cached visibility', () => {
    const rabbit = animal('rabbit', 'rabbit');
    fixture([[rabbit]], scene => {
      scene.startWorldM = null;
      EnemySpawns.refreshHomeFauna(scene, false);
      assert.truthy(active(scene, rabbit), 'no known anchor means no arbitrary suppression');
      scene.save.starterCratesAt = { x: 0, y: 0 };
      EnemySpawns.refreshHomeFauna(scene, false);
      assert.falsy(active(scene, rabbit), 'late captured Home applies to cached creatures');
      rabbit.pet = true;
      EnemySpawns.refreshHomeFauna(scene, false);
      assert.truthy(active(scene, rabbit), 'an owned animal cannot retain its old hidden flag');
    });
  });

  test('home fauna: sandbox uses the same wildlife rule', () => {
    const rabbit = animal('rabbit', 'rabbit');
    fixture([[rabbit]], scene => {
      scene._sandboxMode = true;
      EnemySpawns.refreshHomeFauna(scene);
      assert.falsy(active(scene, rabbit), 'sandbox must exercise the production Home filter');
    });
  });

  test('home fauna: eligibility never mutates generated identity, kind, position or cached arrays', () => {
    const creatures = [animal('rabbit', 'r', 12, 13), animal('deer', 'a', 30, 40), animal('deer', 'z', 50, 60)];
    const identity = creatures.map(c => `${c.id}:${c.kind}:${c.x},${c.y}`).join('|');
    fixture([creatures], (scene, entries) => {
      for (let i = 0; i < 3; i++) {
        EnemySpawns.refreshHomeFauna(scene);
        for (const c of creatures) active(scene, c);
      }
      assert.eq(entries[0].creatures, creatures, 'cached array is retained');
      assert.eq(creatures.length, 3, 'hidden candidates remain available outside the circle');
      assert.eq(creatures.map(c => `${c.id}:${c.kind}:${c.x},${c.y}`).join('|'), identity);
      assert.eq(scene.save.caught.length, 0, 'filtering never records a catch');
    });
  });

  test('home fauna: actual capture-wheel flee movement cannot bypass the Home boundary', () => {
    const start = SCENE_SRC.indexOf('\n  _drawWorkProgress() {');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.gte(start, 0);
    const draw = new Function('playerWorldM', 'worldMetersToAbsCell', 'cellInReach', 'absCellCenterMeters',
      `return ({${SCENE_SRC.slice(start + 1, end + 4)}})._drawWorkProgress;`)(
      () => ({ x: 260, y: 0 }), () => ({ cellIX: 0, cellIY: 0 }), () => true, () => ({ x: 0, y: 0 }));
    for (const [kind, x, pet, blocked] of [
      ['rabbit', 250.1, false, true], ['rabbit', 251, false, false],
      ['chicken', 250.1, false, false], ['rabbit', 250.1, true, false],
    ]) {
      const creature = animal(kind, 'catch-target', x, 0, { pet });
      fixture([[creature]], scene => {
        EnemySpawns.refreshHomeFauna(scene);
        const now = performance.now();
        Object.assign(scene, {
          _stopDownedActions() { return false; }, _drawSwordSwing() {}, _workProgressGfx: { clear() {} }, _strokeWorkRing() {}, _drawWorkTool() {},
          worldMetersToScreen: (x, y) => ({ x, y }),
          cancelWorkProgress() { this._workProgress = null; },
          _workProgress: { flee: creature, startT: now - 1000, _lastT: now - 100, durationMs: 10000 },
        });
        draw.call(scene);
        if (blocked) assert.eq(creature.x, x, 'capture flee cannot move excluded wildlife into the circle');
        else assert.lt(creature.x, x, 'valid flee movement continues normally');
        assert.eq(creature.y, 0);
      });
    }
  });
})();
