// tools/map_review.js loads the game headlessly from the SAME module list
// this runner uses — it reads `const FILES = [...]` out of test/node/run.js.
// If that declaration moves or changes shape, the review tool breaks silently
// until someone runs it; this pins the handshake.
(function () {
test('map review: run.js still declares the module list the review tool reads', () => {
  assert.truthy(/const FILES = (\[[\s\S]*?\]);/.test(RUN_JS_SRC), 'const FILES = [...] in test/node/run.js');
  const list = RUN_JS_SRC.match(/const FILES = (\[[\s\S]*?\]);/)[1];
  assert.truthy(/'worldgen\.js'/.test(list) && /'traps\.js'/.test(list), 'with the generator and the trap spawner in it');
});
})();
