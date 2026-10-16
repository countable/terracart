// THE OPENING PLAYS FOR EVERY GAME, not once per device.
//
// A fresh game opens on four story slides, then the safety / "Go to my
// location" CTA, then the how-to card. Whether that has happened is remembered
// in localStorage (`terracart.introSeen`, `terracart.howtoSeen`): per-DEVICE
// storage answering a per-GAME question, so "+ New game" must replay it too.
//
// There is ONE writer of the two keys (`replayOpening`), called by every path
// that boots a game from nothing; a second copy is what drifts. index.html
// needs a DOM, so the wiring is pinned as SOURCE TEXT (as feet_anchor.test.js
// and street_lamps.test.js do).

(function () {
const html = INDEX_HTML_SRC;

const INTRO_KEY = "'terracart.introSeen'";
const HOWTO_KEY = "'terracart.howtoSeen'";
const count = (needle) => html.split(needle).length - 1;

test('opening: the two "seen" keys have exactly ONE writer that clears them', () => {
  const src = html.slice(html.indexOf('function replayOpening() {'),
                         html.indexOf('// Opening dream, then the trailer'));
  assert.truthy(src.length > 0, 'index.html declares replayOpening');
  assert.truthy(src.includes(`localStorage.removeItem(${INTRO_KEY})`), 'it clears the story flag');
  assert.truthy(src.includes(`localStorage.removeItem(${HOWTO_KEY})`), 'and the how-to flag');
  // Both keys are cleared in ONE place. A second copy is how "+ New game" and
  // "Reset THIS game" came to disagree about what starting a game means.
  assert.eq(count(`removeItem(${INTRO_KEY})`), 1, 'one place clears the story flag');
  assert.eq(count(`removeItem(${HOWTO_KEY})`), 1, 'and one place clears the how-to flag');
});

test('opening: every path that boots a game from nothing replays it', () => {
  // "+ New game": createSave points the registry at an empty slot and the page
  // reloads into it — a game from nothing, so the opening is due. The call has
  // to come BEFORE the reload that boots it.
  const iNew = html.indexOf("createSave();");
  assert.gt(iNew, 0, 'index.html has a "+ New game" handler');
  const newGame = html.slice(iNew, html.indexOf('buildSavesMenu();', iNew));
  assert.truthy(/replayOpening\(\);\s*\n\s*location\.reload\(\);/.test(newGame),
    '"+ New game" replays the opening, then reloads');
  // "Reset THIS game": the same, through the same writer rather than its own
  // pair of removeItem calls.
  const iReset = html.indexOf("document.getElementById('reset-save')");
  assert.gt(iReset, 0, 'and a "Reset THIS game" handler');
  const reset = html.slice(iReset, html.indexOf('// 2) Map-tile caches.', iReset));
  assert.truthy(/replayOpening\(\);/.test(reset), 'the reset handler asks the same writer');
  assert.eq(count('replayOpening();'), 2, 'two callers — the two ways to start a game from nothing');
});

test('opening: the gate that reads the flag and the line that sets it spell the same key', () => {
  // A typo either way is invisible: the story would replay for ever, or never
  // again. Both ends are pinned against the one key name.
  assert.truthy(html.includes(`freshIntro = !localStorage.getItem(${INTRO_KEY})`),
    'the start flow plays the story when the flag is absent');
  assert.truthy(html.includes(`localStorage.setItem(${INTRO_KEY}, '1')`),
    'and the last slide is what sets it');
  assert.truthy(html.includes(`seen = !!localStorage.getItem(${HOWTO_KEY})`),
    'the how-to card reads its own flag');
  assert.truthy(html.includes(`localStorage.setItem(${HOWTO_KEY}, '1')`),
    'and sets it when the card is closed');
});

test('opening: the FULL sequence is four slides, in order, each with its own art', () => {
  // "Full" is the point of this file: the bug showed as an opening that was
  // partly there (the CTA, then the world) with the story and the how-to
  // missing, so what the sequence IS gets pinned beside the flag that plays it.
  const slides = html.slice(html.indexOf('const STORY_SLIDES = ['), html.indexOf('let __storyStarted'));
  const arts = [...slides.matchAll(/assets\/art\/(story_\w+)\.webp/g)].map((m) => m[1])
    .filter(stem => !stem.endsWith('_frame2'));
  assert.eq(arts.length, 4, 'four slides');
  assert.eq(arts[0], 'story_compass', 'discovery comes before the dream');
  assert.eq(arts[1], 'story_nightmare', 'the nightmare comes before waking');
  assert.eq(arts[2], 'story_wake', 'then the trailer');
  assert.eq(arts[3], 'story_wrecks', 'then the neighbourhood');
  assert.truthy(/text: 'That night you enter fitful dreams...', btn: 'wake up', nightmare: true/.test(slides),
    'the call to wake is spoken over the dream, beside its wake-up CTA');
  assert.truthy(/btn: 'Next'/.test(slides) && /btn: "Let's go"/.test(slides),
    'the last slide says where it is going, the first just turns the page');
  // Every banner is a real file with real pixels (the vm sandbox has no fs —
  // webpDims is run.js's bridge, beside the pngDims the item icons use).
  for (const stem of arts) {
    const d = webpDims('assets/art/' + stem + '.webp');
    assert.truthy(d && d.w > 0 && d.h > 0, `assets/art/${stem}.webp exists`);
  }
});

test('opening: all four frame pairs align and describe the image once', () => {
  for (const stem of ['story_compass', 'story_nightmare', 'story_wake', 'story_wrecks']) {
    const first = webpDims(`assets/art/${stem}.webp`);
    const second = webpDims(`assets/art/${stem}_frame2.webp`);
    assert.truthy(first && second, `${stem}: both animation frames ship`);
    assert.eq(second.w, first.w, `${stem}: matching width avoids jumps during fades`);
    assert.eq(second.h, first.h, `${stem}: matching height avoids jumps during fades`);
  }
  assert.eq((html.match(/class="story-frame-next"[^>]*alt="" aria-hidden="true"/g) || []).length, 4,
    'second frames do not repeat descriptions to screen readers');
  assert.truthy(html.includes('animation: story-crossfade 1.2s ease-in-out 1.5s forwards;'),
    'ordinary frame pairs wait 1.5 seconds and fade once, holding their final frame');
  assert.truthy(/#story \.story-frame-next \{ animation: none; \}/.test(html),
    'reduced motion leaves the first frame still');
});

test('opening: dragon heads and flames alternate continuously while the dream is open', () => {
  const rule = html.match(/#story\.nightmare \.story-frame-next\s*\{([^}]+)\}/)?.[1] || '';
  assert.truthy(/animation-iteration-count:\s*infinite/.test(rule), 'movement continues beyond the camera push');
  assert.truthy(/animation-direction:\s*alternate/.test(rule), 'the second painting fades back to the first');
});

test('opening: the story plays FIRST, and the safety CTA waits for its last slide', () => {
  // The CTA is hidden for the duration and shown again by the story's own
  // onDone — so a brand-new player is never asked for their location over a
  // sentence they are still reading.
  const flow = html.slice(html.indexOf('let freshIntro = false;'), html.indexOf('// Reset THIS game:'));
  assert.truthy(/if \(safetyEl\) safetyEl\.style\.display = 'none';/.test(flow), 'the CTA is hidden first');
  assert.truthy(/startStory\(\(\) => \{ if \(safetyEl\) safetyEl\.style\.display = 'flex'; \}\);/.test(flow),
    'and comes back when the last slide clears');
});
test('opening: wake up is available immediately during the zoom', () => {
  const start = html.indexOf('    const STORY_PAN_MS');
  const end = html.indexOf('    // Is one of the boot overlays', start);
  const source = html.slice(start, end);
  assert.falsy(/wake-reveal|STORY_WAKE_DELAY_MS/.test(html), 'no delayed wake button');
  for (const reduced of [false, true]) {
    const nodes = {};
    for (const id of ['story', 'story-art', 'story-text', 'story-next', 'story-skip']) nodes[id] = {
      style: { setProperty() {} }, classes: new Set(), handlers: {},
      classList: { toggle(key, on) { if (on) nodes[id].classes.add(key); else nodes[id].classes.delete(key); } },
      addEventListener(type, cb) { this.handlers[type] = cb; }, remove() { this.removed = true; },
    };
    let ready, delay, done = false, stored = false;
    const startStory = new Function('document', 'window', 'localStorage', 'setTimeout', 'clearTimeout', source + '\nreturn startStory;')(
      { getElementById: id => nodes[id] }, { matchMedia: () => ({ matches: reduced }) },
      { setItem: () => { stored = true; } }, (cb, ms) => { ready = cb; delay = ms; }, () => {});
    startStory(() => { done = true; });
    const btn = nodes['story-next'], text = nodes['story-text'];
    const click = () => btn.handlers.click({ stopPropagation() {} });
    assert.eq(btn.textContent, 'Next');
    assert.eq(text.textContent, 'You find a strange compass, engraved with dragons and stars.');
    assert.falsy(btn.disabled, 'discovery can advance immediately');
    assert.truthy(nodes.story.classes.has('story-fullscreen'), 'discovery is borderless fullscreen');
    assert.falsy(nodes.story.classes.has('compass-story'), 'discovery precedes the compass panel');
    click();
    assert.eq(btn.textContent, 'wake up');
    assert.truthy(nodes.story.classes.has('nightmare'), 'nightmare gets the opaque backdrop and camera treatment');
    assert.falsy(text.hidden, 'the dream carries the call to wake');
    assert.eq(text.textContent, 'That night you enter fitful dreams...');
    assert.falsy(btn.disabled, 'wake up can advance immediately');
    assert.eq(delay, undefined, 'no button timer');
    click();
    assert.eq(btn.textContent, 'Next');
    assert.eq(text.textContent, 'You check the compass. You wake up in an unfamiliar trailer, memories a blur.');
    assert.falsy(nodes.story.classes.has('nightmare'));
    assert.truthy(nodes.story.classes.has('compass-story'), 'awakening is inside the compass');
    assert.falsy(nodes.story.classes.has('story-fullscreen'), 'awakening leaves fullscreen');
    assert.falsy(btn.classes.has('nightmare-wake'));
    assert.falsy(text.hidden);
    assert.falsy(btn.disabled);
    click();
    assert.eq(btn.textContent, "Let's go");
    assert.truthy(nodes.story.classes.has('compass-story'), 'later opening pages remain in the compass');
    assert.falsy(done);
    click();
    assert.truthy(done && stored && nodes.story.removed);
  }
  // "Skip intro" finishes the opening from the discovery or dream,
  // with its button immediately available.
  for (const skipFromDream of [false, true]) {
    const nodes = {};
    for (const id of ['story', 'story-art', 'story-text', 'story-next', 'story-skip']) nodes[id] = {
      style: { setProperty() {} }, handlers: {}, classList: { toggle() {} },
      addEventListener(type, cb) { this.handlers[type] = cb; }, remove() { this.removed = true; },
    };
    let done = false, stored = false;
    const startStory = new Function('document', 'window', 'localStorage', 'setTimeout', 'clearTimeout', source + '\nreturn startStory;')(
      { getElementById: id => nodes[id] }, { matchMedia: () => ({ matches: false }) },
      { setItem: () => { stored = true; } }, () => {}, () => {});
    startStory(() => { done = true; });
    if (skipFromDream) nodes['story-next'].handlers.click({ stopPropagation() {} });
    nodes['story-skip'].handlers.click({ stopPropagation() {} });
    assert.truthy(done && stored && nodes.story.removed, 'skip ends the opening and marks it seen');
  }
  assert.truthy(/<\/div>\s*<\/div>\s*<button id="story-skip"[^>]*>Skip intro<\/button>\s*<\/div>/.test(html),
    'the skip link sits on the mask itself, after the story panel, not inside it');
  assert.truthy(/prefers-reduced-motion: reduce/.test(html));
});

})();
