// SCENE ART — the dialog-painting standard (modal_shell.js makeModalShell `art`,
// ART_FRAME_ASPECT / ART_DETAIL_FRAC / ART_BAND_*; tools/gen_story_art.js
// scene()). Every dialog opens on a painting — its caller's, or its kind's
// MODAL_KINDS default. The piece IS the box: cut to the box's shape, subject
// in the top ART_DETAIL_FRAC, the copy bottom-anchored over a scrim and capped
// at the quiet zone so it can never climb onto the subject; copy too long for
// the quiet zone switches the dialog to THE BAND by measurement.

(function () {
const app = APP_JS_SRC;
// The shell, MODAL_KINDS and the ART_* frame consts live in modal_shell.js.
const shell = MODAL_SHELL_SRC;
const kindsSrc = shell.slice(shell.indexOf('const MODAL_KINDS = {'), shell.indexOf('\n};', shell.indexOf('const MODAL_KINDS = {')));

// Every stem a dialog can open on: the literal `art: '…'`s, the kind rows'
// defaults, and the restore roles (built as 'restore_' + role).
const stems = new Set();
for (const m of app.matchAll(/\bart: '([^']+)'/g)) stems.add(m[1]);
for (const m of shell.matchAll(/\bart: '([^']+)'/g)) stems.add(m[1]);
for (const m of INTERACT_SRC.matchAll(/\bart: '([^']+)'/g)) stems.add(m[1]);
for (const r of ['house', 'blacksmith', 'market', 'trader', 'wizard']) stems.add('restore_' + r);

test('scene art: every dialog painting is cut to the dialog box shape', () => {
  assert.truthy(stems.size > 30, `the stems were collected (${stems.size})`);
  for (const stem of stems) {
    const d = webpDims(`assets/art/${stem}.webp`);
    assert.truthy(d, `${stem}.png exists`);
    assert.truthy(Math.abs(d.w / d.h - 352 / 448) < 0.01, `${stem} is 11:14 (got ${d && d.w}x${d && d.h})`);
  }
});

test('scene art: every kind has a default painting, except STORY, which brings its own', () => {
  const rows = [...kindsSrc.matchAll(/^  (\w+):\s+\{([^}]*)\}/gm)];
  assert.truthy(rows.length >= 20, 'the rows were read');
  for (const [, key, body] of rows) {
    if (key === 'story') {
      assert.truthy(/label: 'Story'/.test(body), 'the STORY label');
      assert.falsy(/art:/.test(body), 'a story always carries its own');
    } else {
      assert.truthy(new RegExp(`art: 'kind_${key}'`).test(body), `${key} opens on kind_${key}`);
    }
  }
  assert.truthy(/art = art \|\| kRow\?\.art;/.test(shell), 'the shell falls back to the kind row');
});

test('scene art: a message with a painting is a STORY', () => {
  assert.truthy(/showMessageModal\(\{ title, body, okLabel = 'OK', onDismiss, art, kind = art \? 'story' : 'note' \}\)/.test(shell),
    'art makes it a story; a plain message stays a note');
});

test('scene art: the content region is capped at the quiet zone and scrolls inside it', () => {
  assert.truthy(/const ART_DETAIL_FRAC = 0\.\d+;/.test(shell), 'the detail line is one constant');
  assert.truthy(/max-height:\$\{Math\.round\(\(1 - ART_DETAIL_FRAC\) \* 100\)\}%;/.test(shell),
    'the body never grows past the quiet zone');
  assert.truthy(/margin-top:auto;[^`]*`\s*\+\s*'overflow-y:auto/.test(shell), 'bottom-anchored, scrolling');
});

test('scene art: text-heavy copy moves to THE BAND by measurement', () => {
  assert.truthy(/const ART_BAND_FRAC = ART_DETAIL_FRAC - ART_BAND_FROM;/.test(shell),
    'the band shows the subject line, the sky above it gives');
  const i = shell.indexOf('TEXT-HEAVY → THE BAND');
  assert.truthy(i > 0, 'mount() decides');
  const tail = shell.slice(i, i + 400);
  assert.truthy(/body\.scrollHeight > body\.clientHeight/.test(tail), 'it measures the copy');
  assert.truthy(/paintScene\(true\)/.test(tail), 'and repaints as the band');
  assert.truthy(/\(1 - ART_BAND_FRAC\)/.test(tail), 'with the band\'s taller content region');
});

test('scene art: the hero becomes a bare label chip — no emoji, no sprite', () => {
  const i = shell.indexOf('if (k && art) {');
  assert.truthy(i > 0, 'the art branch of the kind header');
  const branch = shell.slice(i, shell.indexOf('} else if (k) {', i));
  assert.truthy(/kindLabel \?\? k\.label/.test(branch), 'the label');
  assert.falsy(/k\.icon/.test(branch), 'no emoji glyph');
  assert.falsy(/kindIcon/.test(branch), 'the painting is the picture; no sprite in the corner');
});

test('scene art: the old banner strip is gone', () => {
  assert.falsy(/dialogArtHTML/.test(app + shell), 'no strip seating left');
  assert.falsy(/SCENE_ART/.test(app + shell), 'no half-rolled-out registry left');
});

test('scene art: the lore rides in the generator, one hint per piece at most', () => {
  const gen = STORY_ART_GEN_SRC;
  assert.truthy(/const LORE = \{/.test(gen), 'the LORE table');
  assert.truthy(/const scene = \(subject, lore\) =>/.test(gen), 'scene() takes one hint');
  assert.truthy(/LORE\[lore\]/.test(gen), 'and appends it');
});
})();

test('cave story: the first descent below the surface tells its story, once', () => {
  const src = APP_JS_SRC;
  const i = src.indexOf('  changeDepth(delta, stair) {');
  const body = src.slice(i, src.indexOf('\n  }\n', i));
  assert.truthy(/if \(delta > 0\) \{\s*this\._storySplashOnce\('cave', \{\s*art: 'cave_first'/.test(body),
    'changeDepth (every way down: stairs, rope, portal) opens the cave story on a descent');
  assert.truthy(body.indexOf("_storySplashOnce('cave'") > body.indexOf('this.depth = target;'),
    'only after the descent actually happened (not on a refused one)');
});
