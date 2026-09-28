// tools/map-review.html runs the game's own code in the browser to review
// what the world generator places. Two handshakes it depends on:
//
// THE REVIEW SALT. The world has no global seed (CLAUDE.md "The world is
// GENERATED"); the review page's Reroll XORs a salt into WorldGen's makeRng.
// It must be 0 in the game — so no game code may ever call setReviewSalt —
// and at 0 every seed must be exactly what it was.
//
// THE MODULE LIST. The page loads the modules index.html lists, in order,
// then app.js — reading the script tags out of index.html at load.
(function () {
test('map review: no game code sets the review salt', () => {
  assert.truthy(typeof WorldGen.setReviewSalt === 'function', 'the hook exists');
  for (const [name, src] of [['app.js', APP_JS_SRC], ['interact.js', INTERACT_SRC], ['render.js', RENDER_SRC]]) {
    assert.falsy(/setReviewSalt\(/.test(src), `${name} never calls it`);
  }
  assert.truthy(/let _reviewSalt = 0;/.test(WORLDGEN_SRC), 'and it starts at 0');
});

test('map review: at salt 0 every seed is unchanged, and a salt reseeds', () => {
  const a = WorldGen.makeRng(12345)();
  WorldGen.setReviewSalt(0);
  assert.eq(WorldGen.makeRng(12345)(), a, 'salt 0 is the identity');
  WorldGen.setReviewSalt(0xabc);
  const b = WorldGen.makeRng(12345)();
  WorldGen.setReviewSalt(0);
  assert.truthy(a !== b, 'a salt rolls a different world');
  assert.eq(WorldGen.makeRng(12345)(), a, 'and clearing it restores the shipped one');
});

test('tool pages: the shared loader\'s own pattern still finds the game\'s modules in index.html', () => {
  // tools/game-loader.js (map-review.html, balancing.html) reads index.html's
  // script tags with THIS regex — lifted from the loader, not retyped.
  const m = GAME_LOADER_SRC.match(/html\.matchAll\((\/.+\/g)\)/);
  assert.truthy(m, 'the loader\'s script-tag pattern');
  const re = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')), 'g');
  const srcs = [...INDEX_HTML_SRC.matchAll(re)].map((x) => x[1]);
  assert.truthy(srcs.includes('src/worldgen.js') && srcs.includes('src/rarity.js') && srcs.includes('src/scene_creatures.js'),
    'the generator, the loot roll and spawnInTile\'s module are found');
  assert.truthy(/const APP_SRC = 'src\/app\.js/.test(INDEX_HTML_SRC), 'app.js is still the boot line\'s (the loader appends it)');
});
})();
