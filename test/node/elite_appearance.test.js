(function () {
  test('elite arrival: visible packs announce once, with dialogs deferring the announcement', () => {
    const calls = [];
    let ready = false;
    const scene = { viewLeft: 0, viewTop: 0, viewSize: 300, flashEliteAppearance(n) {
      if (!ready) return false;
      calls.push(n);
      return true;
    } };
    const item = (id, dx = 100, extra = {}) => ({ c: { id, kind: 'goblin', shiny: true, ...extra }, dx, dy: 100 });
    const project = (x, y) => ({ x, y });   // drawObjects' project: coords.js deltaMToScreen
    const list = [item('a'), item('b'), item('offscreen', 500), item('plain', 100, { shiny: false }),
      item('pet_companion', 100, { pet: true }), item('hidden', 100, { _burrowed: true })];
    Render.announceElites(scene, list, project);
    assert.eq(scene._announcedElites.size, 0);
    ready = true;
    Render.announceElites(scene, list, project);
    assert.eq(calls.join(','), '2');
    Render.announceElites(scene, [], project);
    Render.announceElites(scene, list, project);
    assert.eq(calls.length, 1, 'leaving and returning does not replay');
    Render.announceElites(scene, [item('offscreen')], project);
    assert.eq(calls.join(','), '2,1', 'first visible appearance announces');
  });

  test('elite rune circle: placed from the projection drawObjects really returns', () => {
    // drawObjects' project is coords.js deltaMToScreen, which returns {x, y}.
    // Reading {sx, sy} off it placed every ring (and judged every arrival) at
    // NaN: the elite was unmarked. No pass may read it that way.
    assert.falsy(/const \{ sx, sy \} = project\(/.test(RENDER_SRC), 'no pass reads {sx, sy} off project');
    assert.truthy(/item\.band === 'outer' \? 'elite_ring' : 'elite_ring_inner'/.test(RENDER_SRC), 'the ring pass draws the baked rune circle');
    assert.truthy(/bakeRingBand = \(key, periodDeg, path\) => \{[\s\S]{0,400}?bakeCanvas\(this, key,/.test(SCENE_SRC), 'baked once, top-down, at boot');
  });
})();
