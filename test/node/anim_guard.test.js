// A sprite sheet that fails to load must never take the boot down.
//
// Phaser builds an animation from a missing sheet with an EMPTY frame list and
// then throws the moment it is played (getFirstTick reads frames[0].duration):
// "undefined is not an object (evaluating 't.currentFrame.duration')" on the
// player's idle-down, the whole game dead on load. Reproduced in Chromium by
// answering assets/Character/Idle.png with a 504. Two halves: preload retries
// a failed catalog file once, and create() never builds an empty animation
// (a MISSING key is a no-op in play(), an empty one is the crash).
(function () {
const app = APP_JS_SRC;

test('anim guard: every animation goes through _createAnim, which refuses an empty sheet', () => {
  assert.eq((app.match(/this\.anims\.create\(/g) || []).length, 1,
    'the one anims.create is the one inside _createAnim — no raw create can build an empty animation');
  const m = app.match(/\n  _createAnim\(key, texKey, start, end, frameRate\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_createAnim exists');
  assert.truthy(/if \(!frames\.length\) \{[\s\S]*?return false;/.test(m[1]), 'no frames, no animation');
  assert.eq((app.match(/this\._createAnim\('/g) || []).length, 11, 'the eleven animations the game plays');
});

test('anim guard: preload retries a failed catalog asset once, under the same key', () => {
  const m = app.match(/\n  preload\(\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, 'preload');
  const b = m[1];
  assert.truthy(/this\.load\.on\('loaderror', \(file\) => \{/.test(b), 'listens for a failed file');
  assert.truthy(/retried\.has\(file\.key\)\) return;\s*\n\s*retried\.add\(file\.key\);/.test(b), 'once per key');
  assert.truthy(/this\.load\.spritesheet\(file\.key, url, \{ frameWidth: a\.frameWidth, frameHeight: a\.frameHeight \}\)/.test(b),
    'same key and framing, so the onLoad hook and every draw still find it');
  assert.truthy(/'retry=1'/.test(b), 'a fresh URL, so the same failed lookup cannot answer it');
});
})();
