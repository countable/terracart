// Render.arrivalAlpha — an object put down INSIDE the view fades in.
//
// A late Overpass bin swaps a tile already on screen for one carrying its
// detected trees; a spawn pass adds to a tile the player is looking at; a
// rebuild lays new records. Each used to pop its sprites in whole ("trees
// sometimes suddenly appear", owner, Oct 2026). An object whose first frame
// finds it nearer the anchor than the inner view rises from clear over the
// tile reveal's own time; one first seen at the rim walked in, and draws
// whole at once.
(() => {
  const FADE = Number(RENDER_SRC.match(/const UNMAPPED_REVEAL_MS = (\d+);/)[1]);
  const INNER = 12.5;   // a cell short of a 3.5-cell rim at 5 m cells, in metres

  test('arrival fade: an object first drawn well inside the view fades in over the tile reveal time', () => {
    const o = {};
    assert.eq(Render.arrivalAlpha(o, 2, 1, 1000, INNER), 0, 'clear on its first frame');
    assert.truthy(Render.arriving(o), 'marked as arriving');
    assert.inRange(Render.arrivalAlpha(o, 2, 1, 1000 + FADE / 2, INNER) - 0.5, -1e-9, 1e-9, 'half way at half the reveal time');
    assert.eq(Render.arrivalAlpha(o, 2, 1, 1000 + FADE, INNER), 1, 'whole at the reveal time');
    assert.falsy(Render.arriving(o), 'the fade is over');
    assert.eq(Render.arrivalAlpha(o, 2, 1, 1000 + FADE + 1, INNER), 1, 'and stays whole');
    assert.eq(Object.keys(o).length, 0, 'nothing is written on the record (it may be a save record)');
  });

  test('arrival fade: an object entering at the rim, or seen before, draws whole at once', () => {
    const edge = {};
    assert.eq(Render.arrivalAlpha(edge, 0, INNER + 0.5, 1000, INNER), 1, 'past the inner view: it walked in');
    assert.eq(Render.arrivalAlpha(edge, 0, 2, 1200, INNER), 1, 'and never fades as it comes nearer');
    const seen = {};
    Render.arrivalAlpha(seen, 0, INNER + 1, 0, INNER);
    assert.eq(Render.arrivalAlpha(seen, 0, 0, 5000, INNER), 1, 'a record drawn before is not an arrival');
    assert.falsy(Render.arriving(seen));
    const diagonal = {};
    assert.eq(Render.arrivalAlpha(diagonal, 9, 9, 1000, INNER), 1, 'the rim is a distance, not a box');
    const corner = {};
    assert.eq(Render.arrivalAlpha(corner, 8, 8, 1000, INNER), 0, 'inside it on the diagonal still fades');
  });

  test('arrival fade: a record re-minted every frame (a lamp, a scarecrow, a stump) fades once, then stays whole', () => {
    // placedAs builds a fresh record per pass; keyed by identity each frame's
    // copy was a new arrival and a lit lamp inside the view never rose from clear.
    const frame = (ms, dist) => {
      Render.mintedArrivalFrame();
      const o = Render.mintedArrival({ kind: '_streetlamp', id: 'lamp_1.00_2.00' });
      return Render.arrivalAlpha(o, 0, dist, ms, INNER);
    };
    assert.eq(frame(1000, INNER + 1), 1, 'walked in at the rim: whole');
    assert.eq(frame(1016, 2), 1, 'and still whole on later frames as a fresh copy nearer the player');
    assert.eq(frame(5000, 2), 1, 'long after');
    Render.mintedArrivalFrame();
    Render.mintedArrivalFrame();   // two passes without it: it left the view
    assert.eq(frame(6000, 2), 0, 'one put down inside the view fades in');
    assert.eq(frame(6000 + FADE, 2), 1, 'over the reveal time, across fresh copies');
    const scarecrow = Render.mintedArrival({ kind: '_scarecrow', id: 'lamp_1.00_2.00' });
    assert.eq(Render.arrivalAlpha(scarecrow, 0, 2, 6000 + FADE, INNER), 0, 'keys are per kind as well as id');
  });

  test('arrival fade: the sprite pass fades the body and its shadow, sizes the inner view by the live zoom, and never reuses a fading sprite', () => {
    assert.truthy(/s\.setAlpha\(Render\.arrivalAlpha\(o, dx, dy, nowMs, arrivalInnerM\)\);/.test(RENDER_SRC), 'the body');
    assert.eq((RENDER_SRC.match(/s\.setAlpha\(s\.alpha \* Render\.arrivalAlpha\(o, dx, dy, nowMs, arrivalInnerM\)\);/g) || []).length, 2,
      'the prop and building shadows');
    assert.truthy(/const arrivalInnerM = Math\.max\(scene\.cellM, \(VIEW_CELLS \/ \(2 \* \(scene\.mapZoom \|\| 1\)\) - 1\) \* scene\.cellM\);/.test(RENDER_SRC),
      'a cell short of the visible rim at the live zoom');
    assert.truthy(/\|\| Render\.arriving\(item\.o\)\) return false;/.test(RENDER_SRC), 'a still frame reconfigures a fading sprite');
    assert.truthy(/const o = Render\.mintedArrival\(\{ kind, x: p\.x/.test(RENDER_SRC), 'placedAs records take a stable arrival key');
    assert.truthy(/o: Render\.mintedArrival\(\{ \.\.\.o, kind: 'tree_stump'/.test(RENDER_SRC), 'and so does a stump view');
  });
})();
