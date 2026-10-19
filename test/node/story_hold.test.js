// The story hold (app.js _storyHeld): unprompted panels wait while the player
// is mid-interaction (a tap in the last STORY_IDLE_MS; walking is not one),
// then come up in order as a run, which the taps that dismiss them do not
// end. The badge counts what is held. Methods are lifted out of SCENE_SRC
// and run on a stub scene (the memory_story.test.js idiom).
(function () {
  const app = SCENE_SRC;
  const lift = (sig) => {
    const start = app.indexOf('\n  ' + sig);
    const end = start < 0 ? -1 : app.indexOf('\n  }\n', start);
    assert.truthy(start > 0 && end > start, `found ${sig} in app.js`);
    return app.slice(start + 1, end + 4);
  };
  const IDLE = Number(/const STORY_IDLE_MS = (\d+);/.exec(app)?.[1]);
  const SRC = ['_enqueueCeremony(kind, open, { key, hold, defer = false } = {}) {', '_drainCeremonies() {',
    '_storyHeld() {', '_noteInteraction(target) {', '_pendingStoryCount() {', '_tickStoryHold() {']
    .map(lift).join('\n');

  function mkScene() {
    const K = new Function('STORY_IDLE_MS', `return class { ${SRC} }`)(IDLE);
    const s = new K();
    s.save = {};
    // At Home by default: memory panels open only there (MemoryStory.atHome).
    s.depth = 0; s.playerM = { x: 0, y: 0 }; s.startWorldM = { x: 0, y: 0 }; s.inHomeRing = () => true;
    s.busy = false;
    s._dialogOpen = () => s.busy;
    s.badge = [];
    s._syncStoryBadge = (n) => s.badge.push(n);
    s.opened = [];
    s.story = (label) => (done) => { s.opened.push(label); s.busy = true; s._close = () => { s.busy = false; done(); }; return true; };
    return s;
  }
  const target = (inside = []) => ({ closest: (sel) => sel.split(',').some((q) => inside.includes(q.trim())) || null });
  const withNow = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };

  test('story hold: three idle seconds', () => {
    assert.eq(IDLE, 3000);
  });

  test('story hold: luxury memories wait for the furniture interaction and keep their title', () => withNow(1000, () => {
    const s = mkScene();
    s._noteInteraction(target());
    MemoryStory.enqueue(s.save, 1, 'Living like a Neighbour', 'luxury:4');
    s.showMessageModal = panel => { s.opened.push(panel); };
    assert.falsy(MemoryStory.drain(s), 'placement interaction holds the milestone');
    s._tickStoryHold();
    assert.eq(s.badge.at(-1), 1, 'the held domestic memory uses the existing badge');
    withNow(1000 + IDLE + 1, () => {
      assert.truthy(MemoryStory.drain(s));
      assert.eq(s.opened[0].title, 'Living like a Neighbour');
      assert.truthy(s.opened[0].mustAcknowledge);
    });
  }));

  test('story hold: a recent tap holds unprompted panels, never a receipt; idle releases them in order', () => withNow(1000, () => {
    const s = mkScene();
    s._noteInteraction(target());
    s._enqueueCeremony('story', s.story('first sale'));
    s._enqueueCeremony('prize', s.story('trail prize'));
    assert.eq(s.opened.length, 0, 'mid-interaction: held');
    s._enqueueCeremony('receipt', s.story('receipt'));
    assert.eq(s.opened.join(), 'receipt', 'the player\'s own receipt does not wait');
    s._close();
    assert.eq(s.opened.join(), 'receipt', 'the held panels still wait');
    s.save.memoryStory = { pending: [{ memory: 1 }] };
    s._tickStoryHold();
    assert.eq(s.badge.at(-1), 3, 'the badge counts the prize, the story and the memory');
    s.inHomeRing = () => false;
    s._tickStoryHold();
    assert.eq(s.badge.at(-1), 2, 'away from Home the memory is not waiting on the hold, so it is not counted');
    s.inHomeRing = () => true;
    // Walking is not a tap: the stick is excluded.
    withNow(1000 + IDLE - 1, () => s._noteInteraction(target(['#move-pad'])));
    withNow(1000 + IDLE + 1, () => {
      s._tickStoryHold();
      assert.truthy(s._storyRun, 'idle on a clear screen starts the run');
      s._drainCeremonies();
      assert.eq(s.opened.at(-1), 'trail prize', 'in queue order');
      s._noteInteraction(target(['.game-modal']));   // the OK on the prize's own dialog
      s._close();
      assert.eq(s.opened.at(-1), 'first sale', 'the dismissing tap does not hold back the next');
    });
  }));

  test('story hold: a tap outside a dialog ends the run; the badge tap starts it', () => withNow(5000, () => {
    const s = mkScene();
    s._enqueueCeremony('story', s.story('a'));
    assert.eq(s.opened.join(), 'a', 'idle player: opens at once, and starts the run');
    assert.truthy(s._storyRun);
    s._enqueueCeremony('story', s.story('b'));
    s._close();
    assert.eq(s.opened.join(), 'a,b');
    s._noteInteraction(target());
    assert.falsy(s._storyRun, 'a map tap ends the run');
    s._enqueueCeremony('story', s.story('c'));
    s._close();
    assert.eq(s.opened.join(), 'a,b', 'held again');
    s._noteInteraction(target(['#story-badge']));
    assert.falsy(s._storyRun, 'the badge tap itself is not interaction');
    s._storyRun = true;   // what _releaseStories sets before draining
    s._drainCeremonies();
    assert.eq(s.opened.join(), 'a,b,c');
  }));

  test('story hold: a memory banked away from Home neither shows on the badge nor starts a run', () => withNow(9000, () => {
    const s = mkScene();
    s.inHomeRing = () => false;
    s.save.memoryStory = { pending: [{ memory: 1 }] };
    s._tickStoryHold();
    assert.eq(s.badge.at(-1), 0, 'nothing the badge could open here');
    assert.falsy(s._storyRun, 'and no run starts, so the other lanes keep their idle wait');
    s.inHomeRing = () => true;
    s._tickStoryHold();
    assert.eq(s.badge.at(-1), 1, 'back inside the ring it counts again');
  }));

  test('story hold: every unprompted lane asks MemoryStory.storyHeld; the tick and badge are wired', () => {
    const scene = { _storyHeld: () => true, save: { memoryStory: { pending: [{ id: 'memory:1', memory: 1, label: 'x' }] } },
      showMessageModal: () => { throw new Error('held'); } };
    assert.falsy(MemoryStory.drain(scene), 'a held memory waits');
    assert.truthy(/storyHeld\(scene\)/.test(ALL_SRC['pet_stories.js']), 'pet stories wait');
    assert.truthy(/!held\(scene\)/.test(ALL_SRC['story_encounters.js']), 'Maud\'s greeting waits');
    assert.truthy(/this\._tickStoryHold\(\);\s*this\._drainBadgeStories\(\);/.test(app), 'the gate tick runs the hold first');
    assert.truthy(/this\._buildStoryBadge\(\);/.test(ALL_SRC['scene_create.js']), 'the badge is built in create()');
  });
})();
