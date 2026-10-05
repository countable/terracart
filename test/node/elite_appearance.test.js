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
    const project = (sx, sy) => ({ sx, sy });
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
})();
