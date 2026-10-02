// THE OPENING PLAYS FOR EVERY GAME, not once per device.
//
// A fresh game opens on three story slides (a nightmare, trailer, then wrecked
// neighbourhood), then the safety / "Go to my location" CTA, then the how-to
// card. Whether that has happened is remembered in localStorage —
// `terracart.introSeen` for the slides, `terracart.howtoSeen` for the card —
// which is per-DEVICE storage answering a per-GAME question. "Reset THIS game"
// cleared both and replayed the opening; "+ New game" did NOT, so the second
// game a player ever started opened straight on the location CTA with no story
// and no how-to at all.
//
// The fix is ONE writer of the two keys (`replayOpening`), called by every
// path that boots a game from nothing, rather than a second copy of the pair
// inside the new-game handler — a copy is what drifts when a third such path
// arrives. index.html needs a DOM to run, so the wiring is pinned as SOURCE
// TEXT (the same trick feet_anchor.test.js and street_lamps.test.js use).

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

test('opening: the FULL sequence is three slides, in order, each with its own art', () => {
  // "Full" is the point of this file: the bug showed as an opening that was
  // partly there (the CTA, then the world) with the story and the how-to
  // missing, so what the sequence IS gets pinned beside the flag that plays it.
  const slides = html.slice(html.indexOf('const STORY_SLIDES = ['), html.indexOf('let __storyStarted'));
  const arts = [...slides.matchAll(/assets\/art\/(story_\w+)\.webp/g)].map((m) => m[1]);
  assert.eq(arts.length, 3, 'three slides');
  assert.eq(arts[0], 'story_nightmare', 'the nightmare comes before waking');
  assert.eq(arts[1], 'story_wake', 'then the trailer');
  assert.eq(arts[2], 'story_wrecks', 'then the neighbourhood');
  assert.truthy(/text: '', btn: 'wake up', nightmare: true/.test(slides), 'the dream has only its wake-up CTA');
  assert.truthy(/btn: 'Next'/.test(slides) && /btn: "Let's go"/.test(slides),
    'the last slide says where it is going, the first just turns the page');
  // Every banner is a real file with real pixels (the vm sandbox has no fs —
  // webpDims is run.js's bridge, beside the pngDims the item icons use).
  for (const stem of arts) {
    const d = webpDims('assets/art/' + stem + '.webp');
    assert.truthy(d && d.w > 0 && d.h > 0, `assets/art/${stem}.webp exists`);
  }
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
test('opening: wake up fades in with the end of the zoom, taps during the fade skip, early ones do not', () => {
  const start = html.indexOf('    const STORY_WAKE_FADE_MS');
  const end = html.indexOf('    // Is one of the boot overlays', start);
  const source = html.slice(start, end);
  // The clock: the button comes up over the last STORY_WAKE_FADE_MS of the
  // STORY_PAN_MS push, quickly — a wait you can see the end of, not a slow
  // reveal from the first frame — and the CSS reads the same numbers.
  const num = (name) => Number(new RegExp(`const ${name} = (\\d+);`).exec(source)?.[1]);
  const fadeMs = num('STORY_WAKE_FADE_MS'), panMs = num('STORY_PAN_MS');
  assert.truthy(fadeMs >= 800 && fadeMs <= 2000, `a quick fade (${fadeMs}ms)`);
  assert.truthy(panMs >= 6000, `over a long push (${panMs}ms)`);
  assert.truthy(/const STORY_WAKE_DELAY_MS = STORY_PAN_MS - STORY_WAKE_FADE_MS;/.test(source), 'the fade ends with the push');
  assert.truthy(/animation: nightmare-pan var\(--nightmare-pan-ms, 8s\)/.test(html), 'the push reads its length from the script');
  assert.truthy(/animation: wake-reveal var\(--wake-fade-ms\) ease-in var\(--wake-delay-ms, 0ms\) both;/.test(html),
    'the reveal holds invisible through the delay (both), then fades over the fade');
  for (const reduced of [false, true]) {
    const nodes = {};
    for (const id of ['story', 'story-art', 'story-text', 'story-next']) nodes[id] = {
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
    assert.eq(btn.textContent, 'wake up');
    assert.truthy(nodes.story.classes.has('nightmare'), 'nightmare gets the opaque backdrop and camera treatment');
    assert.truthy(text.hidden);
    assert.eq(btn.disabled, !reduced);
    if (!reduced) {
      assert.eq(delay, panMs - fadeMs, 'the button is held only while it is still fully invisible');
      assert.truthy(btn.classes.has('nightmare-wake'));
      click();
      assert.eq(btn.textContent, 'wake up', 'invisible CTA cannot advance');
      ready();
      assert.falsy(btn.disabled, 'tappable from the first frame of its fade — a tap mid-fade skips');
    }
    click();
    assert.eq(btn.textContent, 'Next');
    assert.falsy(nodes.story.classes.has('nightmare'), 'normal story panes restore their original framing');
    assert.falsy(btn.classes.has('nightmare-wake'));
    assert.falsy(text.hidden);
    assert.falsy(btn.disabled);
    click();
    assert.eq(btn.textContent, "Let's go");
    assert.falsy(done);
    click();
    assert.truthy(done && stored && nodes.story.removed);
  }
  assert.truthy(/@keyframes wake-reveal/.test(html));
  assert.truthy(/prefers-reduced-motion: reduce/.test(html));
});

})();
