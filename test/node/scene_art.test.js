// SCENE ART — the dialog-painting standard (app.js makeModalShell `art`,
// ART_FRAME_ASPECT / ART_DETAIL_FRAC / SCENE_ART; tools/gen_story_art.js
// scene()). A scene piece IS the dialog box: cut to the box's shape, subject
// in the top ART_DETAIL_FRAC, the copy bottom-anchored over a scrim and
// capped at the quiet zone so it can never climb onto the subject.

(function () {
const app = APP_JS_SRC;
const stems = (() => {
  const m = app.match(/const SCENE_ART = new Set\(\[([^\]]*)\]\)/);
  assert.truthy(m, 'SCENE_ART is declared');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
})();

test('scene art: every SCENE_ART piece is cut to the dialog box shape', () => {
  assert.truthy(stems.length > 0, 'at least the pilot');
  for (const stem of stems) {
    const d = pngDims(`assets/art/${stem}.png`);
    assert.truthy(d, `${stem}.png exists`);
    assert.truthy(Math.abs(d.w / d.h - 352 / 448) < 0.01, `${stem} is 11:14 (got ${d.w}x${d.h})`);
  }
});

test('scene art: the content region is capped at the quiet zone and scrolls inside it', () => {
  assert.truthy(/const ART_DETAIL_FRAC = 0\.\d+;/.test(app), 'the detail line is one constant');
  assert.truthy(/max-height:\$\{Math\.round\(\(1 - ART_DETAIL_FRAC\) \* 100\)\}%;/.test(app),
    'the body never grows past the quiet zone');
  assert.truthy(/margin-top:auto;[^`]*`\s*\+\s*'overflow-y:auto/.test(app), 'bottom-anchored, scrolling');
});

test('scene art: a scene dialog drops the emoji hero for a label chip', () => {
  const i = app.indexOf('if (k && art) {');
  assert.truthy(i > 0, 'the art branch of the kind header');
  const branch = app.slice(i, app.indexOf('} else if (k) {', i));
  assert.truthy(/kindNode\.textContent = kindLabel \?\? k\.label;/.test(branch), 'the label only');
  assert.falsy(/k\.icon/.test(branch), 'no emoji glyph');
});

test('scene art: showMessageModal routes only SCENE_ART stems into the frame', () => {
  const s = app.slice(app.indexOf('  showMessageModal({'), app.indexOf('  showFeedConfirm('));
  assert.truthy(/art: SCENE_ART\.has\(art\) \? art : undefined/.test(s), 'scene pieces fill the box');
  assert.truthy(/SCENE_ART\.has\(art\) \? '' : this\.dialogArtHTML\(art\)/.test(s),
    'an old banner keeps its strip until it is repainted');
});
})();
