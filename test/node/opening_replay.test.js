// THE OPENING PLAYS FOR EVERY GAME, not once per device.
//
// A fresh game opens on the two story slides (the trailer, then the wrecked
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
                         html.indexOf('// Two-slide opening story shown once'));
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
  const iNew = html.indexOf("const name = prompt('Name your new game:'");
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

test('opening: the FULL sequence is two slides, in order, each with its own art', () => {
  // "Full" is the point of this file: the bug showed as an opening that was
  // partly there (the CTA, then the world) with the story and the how-to
  // missing, so what the sequence IS gets pinned beside the flag that plays it.
  const slides = html.slice(html.indexOf('const STORY_SLIDES = ['), html.indexOf('let __storyStarted'));
  const arts = [...slides.matchAll(/assets\/art\/(story_\w+)\.png/g)].map((m) => m[1]);
  assert.eq(arts.length, 2, 'two slides');
  assert.eq(arts[0], 'story_wake', 'the trailer first');
  assert.eq(arts[1], 'story_wrecks', 'then the neighbourhood');
  assert.truthy(/btn: 'Next'/.test(slides) && /btn: "Let's go"/.test(slides),
    'the last slide says where it is going, the first just turns the page');
  // Both banners are real files with real pixels (the vm sandbox has no fs —
  // pngDims is run.js's bridge, the same one the item icons are checked with).
  for (const stem of arts) {
    const d = pngDims('assets/art/' + stem + '.png');
    assert.truthy(d && d.w > 0 && d.h > 0, `assets/art/${stem}.png exists`);
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
})();
