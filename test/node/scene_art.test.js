// SCENE ART — the dialog-painting standard (modal_shell.js makeModalShell `art`,
// ART_FRAME_ASPECT / ART_DETAIL_FRAC / ART_BAND_*; tools/gen_story_art.js
// scene()). Every dialog opens on a painting — its caller's, or its kind's
// MODAL_KINDS default. The piece IS the box: cut to the box's shape, subject
// in the top ART_DETAIL_FRAC, the copy bottom-anchored over a scrim and capped
// at the quiet zone so it can never climb onto the subject; copy too long for
// the quiet zone switches the dialog to THE BAND by measurement.

(function () {
const app = SCENE_SRC;
// The shell, MODAL_KINDS and the ART_* frame consts live in modal_shell.js.
const shell = SCENE_SRC;
const kindsSrc = shell.slice(shell.indexOf('const MODAL_KINDS = {'), shell.indexOf('\n};', shell.indexOf('const MODAL_KINDS = {')));

// Every stem a dialog can open on: the literal `art: '…'`s, the kind rows'
// defaults, and the restore roles (built as 'restore_' + role).
const stems = new Set(Object.values(NPC.STORY_ROLES).flatMap(row => [row.art, row.housedArt]).filter(Boolean));
for (const m of app.matchAll(/\bart: '([^']+)'/g)) stems.add(m[1]);
for (const m of shell.matchAll(/\bart: '([^']+)'/g)) stems.add(m[1]);
for (const m of INTERACT_SRC.matchAll(/\bart: '([^']+)'/g)) stems.add(m[1]);
for (const r of ['house', 'blacksmith', 'market', 'trader', 'wizard']) stems.add('restore_' + r);
for (const row of [...Object.values(Shrines.SHRINE_KINDS), ...Object.values(Shrines.REWARD_KINDS), ...Object.values(Macros.DAILY_VISIT_KINDS), ...Object.values(Macros.KIND_DIALOG), ...Object.values(Macros.KIND_TRANSACTION)]) stems.add(row.art);

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
  assert.truthy(/showMessageModal\(\{ title, body, okLabel = 'OK', onDismiss, art, kind = art \? 'story' : 'note', kindLabel, mustAcknowledge = false \}\)/.test(shell),
    'art makes it a story; a plain message stays a note');
});

test('scene art: the content region is capped at the quiet zone and scrolls inside it', () => {
  assert.truthy(/const ART_DETAIL_FRAC = 0\.\d+;/.test(shell), 'the detail line is one constant');
  assert.truthy(/max-height:\$\{Math\.round\(\(1 - ART_DETAIL_FRAC\) \* 100\)\}%;/.test(shell),
    'the body never grows past the quiet zone');
  const region = shell.slice(shell.indexOf("body.className = 'modal-body'"), shell.indexOf('let into = body'));
  assert.truthy(region.includes('margin-top:auto;') && region.includes('overflow-y:auto;'), 'bottom-anchored, scrolling');
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

// NO LORE ON HOLY OR GRAVE GROUND (Sep 2026): a demon hint on a church, a
// chapel, a shrine or a grave reads as the game calling the place demonic.
// scene() throws on such a pairing; every sacred piece here carries none.
test('scene art: no lore hint on a chapel, church, shrine or grave painting', () => {
  const gen = STORY_ART_GEN_SRC;
  const re = gen.match(/const LORE_FREE_SUBJECT = (\/.*\/i);/);
  assert.truthy(re, 'the one subject rule');
  const SACRED = new RegExp(re[1].slice(1, -2), 'i');
  assert.truthy(/if \(lore && LORE_FREE_SUBJECT\.test\(subject\)\) \{\s*throw/.test(gen), 'scene() refuses the pairing');
  // Every scene(...) call: its subject strings and its lore argument.
  const calls = [...gen.matchAll(/^  (\w+): scene\(([\s\S]*?)\),?\n(?=  \w+:|\n|  \/\/|\})/gm)];
  assert.gt(calls.length, 30, `the pieces were read (${calls.length})`);
  const sacred = [];
  for (const [, key, body] of calls) {
    const strs = body.match(/'(?:[^'\\]|\\.)*'/g) || [];
    const last = strs.length > 1 && /,\s*'\w+'\s*$/.test(body) ? strs[strs.length - 1].slice(1, -1) : null;
    const lore = last && /^[a-z]+$/.test(last) && new RegExp(`^  ${last}:`, 'm').test(gen) ? last : null;
    const subject = (lore ? strs.slice(0, -1) : strs).join(' ');
    if (SACRED.test(subject)) { sacred.push(key); assert.eq(lore, null, `${key} carries no lore (${lore})`); }
  }
  for (const key of ['zone_stones', 'zone_grove']) assert.includes(sacred, key);
  for (const key of ['booth_chapel_intro', 'booth_chapel_used']) assert.includes(sacred, key);
  assert.eq(Macros.KIND_DIALOG.chapel.art, 'booth_chapel_intro', 'the chapel has dedicated lore-free art');
});
})();

test('cave story: the first descent below the surface tells its story, once', () => {
  const src = SCENE_SRC;
  const i = src.indexOf('  changeDepth(delta, stair) {');
  const body = src.slice(i, src.indexOf('\n  }\n', i));
  assert.truthy(/if \(delta > 0\) \{\s*this\._storySplashOnce\('cave', \{\s*art: 'cave_first'/.test(body),
    'changeDepth (every way down: stairs, rope, portal) opens the cave story on a descent');
  assert.truthy(body.indexOf("_storySplashOnce('cave'") > body.indexOf('this.depth = target;'),
    'only after the descent actually happened (not on a refused one)');
});

test('pixel resolve: every dialog painting has an inline thumbnail', () => {
  const keys = new Set([...ART_THUMBS_SRC.matchAll(/^  (\w+): 'data:image\/webp;base64,[A-Za-z0-9+/=]+',$/gm)].map((m) => m[1]));
  const cutKeys = new Set([...ART_THUMBS_SRC.matchAll(/^  (\w+): \[$/gm)].map((m) => m[1]));
  const tones = new Set([...ART_THUMBS_SRC.matchAll(/^  (\w+): '#[0-9a-f]{6}',$/gm)].map((m) => m[1]));
  const used = new Set();
  for (const row of [...Object.values(Shrines.SHRINE_KINDS), ...Object.values(Shrines.REWARD_KINDS), ...Object.values(Macros.DAILY_VISIT_KINDS), ...Object.values(Macros.KIND_DIALOG), ...Object.values(Macros.KIND_TRANSACTION)]) used.add(row.art);
  for (const src of [SCENE_SRC, INTERACT_SRC, MODAL_SHELL_SRC_TEXT]) {
    for (const m of src.matchAll(/\bart: '([^']+)'/g)) used.add(m[1]);
  }
  for (const r of ['house', 'blacksmith', 'market', 'trader', 'wizard']) used.add('restore_' + r);
  assert.truthy(used.size > 30, `stems collected (${used.size})`);
  for (const stem of used) {
    assert.truthy(keys.has(stem), `${stem} has a thumbnail (node tools/art_thumbs.js)`);
    assert.truthy(tones.has(stem), `${stem} has a tone`);
    assert.truthy(cutKeys.has(stem), `${stem} has its baked resolve cuts`);
  }
  // ~1KB/piece: the 22×28 thumbnail plus its three coarser resolve cuts. The
  // cuts are baked rather than cut at runtime (toDataURL was ~200 ms), so
  // they ride here; keep the file this small — it loads with the code. The
  // cap tracks the piece count rather than a fixed number (about 850 bytes a
  // piece), so it grows only when paintings are actually added.
  assert.truthy(ART_THUMBS_SRC.length < keys.size * 900, 'the thumbnails stay small — they load with the code');
});

test('pixel resolve: an uncached painting resolves out of its tone, then fades in', () => {
  const src = MODAL_SHELL_SRC_TEXT;
  assert.truthy(/ART_TONES\[art\]/.test(src), 'it opens on the painting\'s solid tone');
  assert.truthy(/const ART_CUT_WIDTHS = \[3,6,11,22\];/.test(ART_THUMBS_SRC), 'coarse to fine, ending on the thumbnail');
  assert.truthy(/const cuts = mosaicCuts\(art\);/.test(src), 'the cuts are the baked ones');
  assert.falsy(/toDataURL/.test(src), 'nothing is cut at runtime — toDataURL was ~200 ms of main thread');
  assert.truthy(/modal-art-waiting/.test(src) && /\.modal-art-waiting \{ animation: modal-art-breathe/.test(INDEX_HTML_SRC),
    'the last cut breathes while it still waits');
  assert.truthy(/if \(img\.complete\) \{\s*artLayer\.style\.opacity = '1';/.test(src), 'a cached painting is simply there');
  assert.truthy(/img\.onload = \(\) => \{\s*timers\.forEach\(clearTimeout\);/.test(src), 'on load the steps stop');
  assert.truthy(/position:relative;z-index:1;/.test(src), 'the copy sits above the art layers');
  assert.truthy(INDEX_HTML_SRC.indexOf('src/art_thumbs.js') < INDEX_HTML_SRC.indexOf('src/modal_shell.js'),
    'index.html loads the thumbnails before the shell');
});

test('preload: paintings keep their on-demand address without joining the icon warmup', () => {
  assert.eq(sceneArtUrl('house'), 'assets/art/house.webp', 'one address for a painting');
  const portrait = 'data:image/png;base64,dGVzdA==';
  assert.eq(sceneArtUrl(portrait), portrait, 'generated tinted portraits keep their data URL');
  assert.falsy(/`assets\/art\/\$\{art\}\.webp`/.test(MODAL_SHELL_SRC_TEXT), 'the shell builds no second one');
  const i = SCENE_SRC.indexOf('  _prewarmModalIcons() {');
  const body = SCENE_SRC.slice(i, SCENE_SRC.indexOf('\n  }\n', i));
  const warm = new Function('ICON_SHEETS', 'RELIC_DEFS', 'ARMOR_DEFS', 'TIER_BY_NUM', 'gearAssetPath', 'IconNet',
    'return ({' + body + '\n}})._prewarmModalIcons();');
  let queued;
  warm({ crops: { url: 'crops.png' }, duplicate: { url: 'crops.png' } },
    { axe: {} }, { helmet: {} }, { 1: {}, 2: {} },
    (kind, slot, tier) => `${kind}-${slot}-${tier}.png`,
    { prewarm(urls) { queued = urls; } });
  assert.eq(queued.length, 5, 'deduplicated icon sheet and four gear icons');
  assert.truthy(queued.includes('crops.png') && queued.includes('armor-helmet-2.png'), 'icons are still warmed');
  assert.falsy(queued.some(url => url.includes('assets/art/')), 'paintings wait for an opened modal');
});
