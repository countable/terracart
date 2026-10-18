// SCENE ART — the dialog-painting standard (modal_shell.js makeModalShell `art`,
// css/compass_panels.css; tools/gen_story_art.js
// scene()). Approved 4:3 paintings retain their complete composition above
// fitted, paged copy, without scrolling or legacy band modes.

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

test('scene art: dialog paintings use approved 4:3 composition', () => {
  assert.truthy(stems.size > 30, `the stems were collected (${stems.size})`);
  for (const stem of stems) {
    const d = webpDims(`assets/art/${stem}.webp`);
    assert.truthy(d, `${stem}.webp exists`);
    assert.truthy(Math.abs(d.w / d.h - 4 / 3) < .01, `${stem} is 4:3 (got ${d.w}x${d.h})`);
  }
});

test('scene art: kinds use paintings or character portraits', () => {
  const rows = [...kindsSrc.matchAll(/^  (\w+):\s+\{([^}]*)\}/gm)];
  assert.truthy(rows.length >= 20, 'the rows were read');
  for (const [, key, body] of rows) {
    if (key === 'story') {
      assert.truthy(/label: 'Story'/.test(body), 'the STORY label');
      assert.falsy(/art:/.test(body), 'a story always carries its own');
    } else if (key === 'spirit') {
      assert.truthy(/portrait: 'assets\/portraits\/dragon_spirit.png'/.test(body), 'the spirit uses the NPC portrait slot');
      assert.truthy(/portrait = portrait \|\| kRow\?\.portrait;/.test(shell), 'kind portraits reach the shared portrait layout');
      const size = pngDims('assets/portraits/dragon_spirit.png');
      assert.truthy(size, 'dedicated spirit portrait ships');
      assert.eq(size.w, 80, 'the spirit uses the shared portrait pixel scale');
      assert.eq(size.h, 80, 'the spirit fills an 80px square');
    } else if (key === 'talk') {
      assert.falsy(/art:/.test(body), 'a neighbour speaking always carries their portrait');
    } else {
      assert.truthy(new RegExp(`art: 'kind_${key}'`).test(body), `${key} opens on kind_${key}`);
    }
  }
  assert.truthy(/art = portrait \|\| art === false \? null : art \|\| kRow\?\.art;/.test(shell), 'the shell falls back to the kind row unless portrait or art:false supplies a dedicated layout');
});

test('scene art: a message with a painting is a STORY', () => {
  assert.truthy(/showMessageModal\(\{[^}]*kind = art \? 'story' : 'note'[^}]*\}\)/.test(shell),
    'art makes it a story; a plain message stays a note');
});

test('scene art: shared crop above fitted copy without scrolling', () => {
  const from = shell.indexOf("body.className = 'modal-body'");
  const region = shell.slice(from, shell.indexOf('box.appendChild(body)', from));
  assert.truthy(region.includes('flex:1 1 auto;') && region.includes('overflow:hidden;'), 'the body fills the box without scrolling');
  assert.truthy(region.includes("viewport.className = 'modal-copy'") && region.includes('viewport.appendChild(into)'), 'copy has its own fitted viewport below the art');
  assert.falsy(/overflow-y:auto;/.test(region.replace(/scroll\n\s*\? '[^']*'/, '')), 'neither body nor copy scrolls — except the menu\'s `scroll` viewport');
  assert.truthy(region.includes("art ? 'margin:0;flex:0 0 auto;'"), 'copy follows the image region, including ceremonies');
  assert.truthy(region.includes('spacer.append(mosaicLayer, artLayer)'), 'painting and mosaic share the crop above copy');
  assert.truthy(shell.includes("backgroundSize = kind === 'story' ? 'cover' : '100% auto'"), 'crop scales uniformly without distortion');
  assert.truthy(shell.includes("backgroundPosition = 'center top'"), 'tall assets lose their bottom, keeping the subject');
  assert.falsy(/ART_BAND_|ART_DETAIL_FRAC|ART_FRAME_ASPECT|readShape/.test(shell), 'no legacy band layout or load-time shape switching');
});

test('scene art: generic Story is omitted and useful categories follow the image', () => {
  assert.truthy(shell.includes("art && kind === 'story' && (!kindLabel || kindLabel === 'Story')"), 'painted stories omit only the generic heading');
  assert.truthy(shell.includes('into.insertBefore(kindNode, into.firstChild)'), 'other category headings belong to the content below the image');
  const sceneShell = shell.slice(shell.indexOf('  makeModalShell('), shell.indexOf('  _placeSpeechBubble('));
  assert.truthy(sceneShell.includes('const resize = new ResizeObserver(scheduleFit)'), 'viewport changes refit the content');
  assert.truthy(sceneShell.includes('const changes = new MutationObserver(scheduleFit)'), 'live content changes refit the content');
  assert.truthy(sceneShell.includes('body.clientWidth * .9') && sceneShell.includes('Math.max(minimum, full - deficit)'), 'legacy art can give height to copy above its minimum');
  assert.truthy(sceneShell.includes("pages.className = 'modal-pages'") && sceneShell.includes('into.style.columnWidth'), 'long content uses pages at its original text size');
  // The ☰ menu is the one dialog that scrolls instead (owner, Oct 2026: "the
  // main menu shouldn't be paginated"): the shell's `scroll` option turns the
  // copy viewport into a scroller and the fit never pages it.
  assert.truthy(sceneShell.includes('if (!scroll && into.scrollHeight > viewport.clientHeight + 1) {'), 'a scrolling dialog never pages');
  assert.truthy(/viewport\.style\.cssText = scroll\n\s*\? 'flex:1 1 auto;min-height:0;overflow-y:auto;/.test(sceneShell), 'its viewport scrolls');
  assert.truthy(/makeModalShell\('menu-modal', \{\n(?:.*\n){0,4}.*scroll: true,/.test(SCENE_SRC), 'the menu dialog asks for it');
});

test('scene art: new generated scenes use full 4:3 compositions', () => {
  assert.truthy(/const SCENE_ASPECT = 4 \/ 3;/.test(STORY_ART_GEN_SRC), 'new scene generation is 4:3');
  assert.truthy(/size: '1536x1024', width: 512, aspect: SCENE_ASPECT/.test(STORY_ART_GEN_SRC), 'landscape source exports 4:3');
  assert.truthy(shell.includes('const minimum = fullFrameArt ? full'), 'approved frames are preserved while copy paginates');
  assert.truthy(shell.includes('fullFrameArt ? body.clientWidth / artAspect'), 'approved art height matches its intrinsic aspect');
});

test('scene art: reprocessing uses approved masters and never falls back when missing', () => {
  const from = STORY_ART_GEN_SRC.indexOf('function approvedMaster(name) {');
  const end = STORY_ART_GEN_SRC.indexOf('\n}\n', from) + 2;
  const files = new Set(['/archive/approved-story-art/cave_first.png']);
  const rows = new Map([['cave_first', { master_path: 'approved-story-art/cave_first.png' }]]);
  const resolveMaster = new Function('APPROVED', 'ART_ROOT', 'path', 'fs',
    STORY_ART_GEN_SRC.slice(from, end) + '; return approvedMaster;')(
      rows, '/archive', { resolve: (root, name) => `${root}/${name}` },
      { existsSync: name => files.has(name) });
  assert.eq(resolveMaster('cave_first'), '/archive/approved-story-art/cave_first.png');
  assert.eq(resolveMaster('coin_icon'), null, 'unapproved icons retain the legacy path');
  files.clear();
  let error;
  try { resolveMaster('cave_first'); } catch (e) { error = e; }
  assert.truthy(error && error.message.includes('approved master missing'), 'missing accepted art must fail rather than restore a rejected original');
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
  const i = src.indexOf('  changeDepth(delta, stair, options = {}) {');
  const body = src.slice(i, src.indexOf('\n  }\n', i));
  assert.truthy(/if \(delta > 0 && !caveFall\) \{\s*this\._storySplashOnce\('cave', \{\s*art: 'cave_first'/.test(body),
    'changeDepth (every way down: stairs, rope, portal) opens the cave story on a descent');
  assert.truthy(body.indexOf("_storySplashOnce('cave'") > body.indexOf('this.depth = target;'),
    'only after the descent actually happened (not on a refused one)');
});

test('pixel resolve: every dialog painting has an inline thumbnail', () => {
  const keys = new Set([...ART_THUMBS_SRC.matchAll(/^  (\w+): 'data:image\/webp;base64,[A-Za-z0-9+/=]+',$/gm)].map((m) => m[1]));
  const cutKeys = new Set([...ART_THUMBS_SRC.matchAll(/^  (\w+): \[$/gm)].map((m) => m[1]));
  const tones = new Set([...ART_THUMBS_SRC.matchAll(/^  (\w+): '#[0-9a-f]{6}',$/gm)].map((m) => m[1]));
  const aspects = Object.fromEntries([...ART_THUMBS_SRC.matchAll(/^  (\w+): ([0-9.]+),$/gm)].map(m => [m[1], Number(m[2])]));
  const used = new Set();
  for (const row of [...Object.values(Shrines.SHRINE_KINDS), ...Object.values(Shrines.REWARD_KINDS), ...Object.values(Macros.DAILY_VISIT_KINDS), ...Object.values(Macros.KIND_DIALOG), ...Object.values(Macros.KIND_TRANSACTION)]) used.add(row.art);
  for (const src of [SCENE_SRC, INTERACT_SRC, MODAL_SHELL_SRC_TEXT]) {
    for (const m of src.matchAll(/\bart: '([^']+)'/g)) used.add(m[1]);
  }
  for (const r of ['house', 'blacksmith', 'market', 'trader', 'wizard']) used.add('restore_' + r);
  assert.truthy(used.size > 30, `stems collected (${used.size})`);
  for (const stem of used) {
    const dims = webpDims(`assets/art/${stem}.webp`);
    assert.truthy(Math.abs(aspects[stem] - dims.w / dims.h) < 0.001, `${stem} has current aspect metadata`);
    assert.truthy(keys.has(stem), `${stem} has a thumbnail (node tools/art_thumbs.js)`);
    assert.truthy(tones.has(stem), `${stem} has a tone`);
    assert.truthy(cutKeys.has(stem), `${stem} has its baked resolve cuts`);
  }
  // ~1KB/piece: the 22×28 thumbnail plus its three coarser resolve cuts. The
  // cuts are baked rather than cut at runtime (toDataURL was ~200 ms), so
  // they ride here; keep the file this small — it loads with the code. The
  // cap tracks the piece count rather than a fixed number (about 850 bytes a
  // piece), so it grows only when paintings are actually added.
  assert.truthy(ART_THUMBS_SRC.length < keys.size * 950, 'the thumbnails stay small — they load with the code');
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
  const warm = new Function('ICON_SHEETS', 'RELIC_DEFS', 'ARMOR_DEFS', 'TIER_BY_NUM', 'gearAssetPath', 'IconNet', 'domIconSheet',
    'return ({' + body + '\n}})._prewarmModalIcons();');
  let queued;
  warm({ crops: { url: 'crops.png' }, duplicate: { url: 'crops.png' } },
    { axe: {} }, { helmet: {} }, { 1: {}, 2: {} },
    (kind, slot, tier) => `${kind}-${slot}-${tier}.png`,
    { prewarm(urls) { queued = urls; } }, url => ({ url }));
  assert.eq(queued.length, 5, 'deduplicated icon sheet and four gear icons');
  assert.truthy(queued.includes('crops.png') && queued.includes('armor-helmet-2.png'), 'icons are still warmed');
  assert.falsy(queued.some(url => url.includes('assets/art/')), 'paintings wait for an opened modal');
});
