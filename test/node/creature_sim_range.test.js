// THE CREATURE SIM BUBBLE — how far from the player a creature keeps thinking.
//
// wanderCreatures culls on one radius before it does anything else: outside it
// a creature does not wander, hunt, leech, shoot or eat a crop — it is frozen
// at its last position until the player comes back. So the radius is not a
// performance detail, it is the edge of the simulated world, and two things
// have to hold or it reads as a cheat.
//
//   1. It has to clear the VIEWPORT with real margin. The corner of an
//      11-cell view sits at VIEW_CELLS/2 * √2 ≈ 7.8 cells; the bubble used to
//      stop at 8, a tenth of a cell past the glass, which is exactly where the
//      seam shows — a deer frozen mid-stride starts walking as it crosses the
//      corner, and a monster stalking you only begins the stalk once you can
//      already see it. CREATURE_SIM_CELLS is 12: about half a viewport of
//      margin, so things arrive already in motion.
//
//   2. Anything DISPATCHED at the player must land inside it. The crop-raiding
//      crow pump seats its bird "just off-screen" and the code promised it
//      "flies toward the nearest crop next tick" — while seating it at exactly
//      12 cells, i.e. ON the rim of the cull that decides whether it thinks at
//      all. The bird sat frozen out in the dark until the player happened to
//      walk at it. PEST_CROW_SPAWN_CELLS (10) has to stay strictly between the
//      viewport corner and the bubble, and this is the test that says so.
//
// The constants are lifted by run.js along with the source text of the three
// lines that use them (app.js's per-frame loop can't load headlessly), so a
// re-typed number or a cull moved onto the camera anchor fails here.
(function () {

  const VIEW_CORNER_CELLS = (VIEW_CELLS / 2) * Math.SQRT2;

  test('sim bubble: the cull clears the viewport corner with margin', () => {
    assert.gt(CREATURE_SIM_CELLS, VIEW_CORNER_CELLS,
      'a creature frozen inside the viewport would be seen standing still');
    // Half a viewport of margin is the point: 8 cells cleared the corner too,
    // and that is the version this rule exists to keep from coming back.
    assert.gte(CREATURE_SIM_CELLS - VIEW_CORNER_CELLS, VIEW_CELLS / 4,
      'the margin is too thin — things will visibly start moving as they appear');
  });

  test('sim bubble: the cull reads the constant, not a re-typed number', () => {
    assert.truthy(CREATURE_CULL_SRC.includes('CREATURE_SIM_CELLS * this.cellM'),
      'RANGE_M must resolve through CREATURE_SIM_CELLS so the pin above binds');
    assert.truthy(CREATURE_CULL_SRC.includes('RANGE_SQ = RANGE_M * RANGE_M'),
      'the loop compares squared distances against the squared radius');
  });

  test('sim bubble: it is measured from the FEET, not the camera anchor', () => {
    // The camera rule (CLAUDE.md): a peek drag moves where the world is DRAWN
    // from, never where the player IS. Waking creatures on the anchor would let
    // a drag start a stalk three cells further out than the player can reach.
    assert.truthy(CREATURE_FEET_SRC.includes('this.startWorldM.x + this.playerM.x'),
      'the sim origin must be the player, not viewAnchorWorldM');
    assert.falsy(/viewAnchor|peekM|viewCenter/.test(CREATURE_FEET_SRC),
      'the camera crept into the sim origin');
  });

  test('crow pump: the dispatched bird lands off-screen but inside the bubble', () => {
    assert.gt(PEST_CROW_SPAWN_CELLS, VIEW_CORNER_CELLS,
      'the player would watch the crow pop into being');
    assert.lt(PEST_CROW_SPAWN_CELLS, CREATURE_SIM_CELLS,
      'seated on or past the cull the crow spawns FROZEN — the bug this pins');
    // Strictly inside is not enough on its own: a bird one hair inside the rim
    // is one player step from being culled again before it has flown anywhere.
    assert.gte(CREATURE_SIM_CELLS - PEST_CROW_SPAWN_CELLS, 1,
      'leave the crow at least a cell of room inside the bubble');
    assert.truthy(PEST_CROW_SPAWN_SRC.includes('PEST_CROW_SPAWN_CELLS * this.cellM'),
      'the spawn radius must resolve through the constant the pins above read');
  });

})();
