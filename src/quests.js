// Single global quest chain. Completing all quests unseals the castle vault.
// All functions are pure (only read/write save.quests) — no Phaser / DOM deps.

const QUEST_CHAIN = [
  {
    id: 'q1_slimes',
    title: 'Pest Control',
    body: 'The castle guard is paying a bounty. Defeat 10 slimes pestering the farms.',
    type: 'kill', kind: 'slime', count: 10,
    reward: { money: 200 },
  },
  {
    id: 'q2_well',
    title: 'The Old Well',
    body: "Scouts report an ancient well somewhere on the map. Find it to earn the garrison's trust.",
    type: 'poi', poiClass: 'well',
    reward: { money: 400 },
  },
  {
    id: 'q3_sapphire',
    title: 'Depths of the Keep',
    body: 'The castle archivist needs a sapphire from the deep caves. Retrieve one from level 3 or below.',
    type: 'item', item: 'sapphire', minDepth: 3,
    reward: { money: 600 },
  },
];

const Quests = {
  _qs(save) {
    if (!save.quests) save.quests = { step: 0, progress: {} };
    return save.quests;
  },

  allDone(save) {
    return (this._qs(save).step ?? 0) >= QUEST_CHAIN.length;
  },

  current(save) {
    const step = this._qs(save).step ?? 0;
    return QUEST_CHAIN[step] ?? null;
  },

  progress(save) {
    const q = this.current(save);
    if (!q) return 0;
    return this._qs(save).progress?.[q.id] ?? 0;
  },

  isComplete(save) {
    const q = this.current(save);
    if (!q) return false;
    const prog = this.progress(save);
    return q.type === 'kill' ? prog >= q.count : prog >= 1;
  },

  // Advance to the next quest and return the completed quest's reward.
  advance(save) {
    const q = this.current(save);
    const qs = this._qs(save);
    qs.step = (qs.step ?? 0) + 1;
    return q?.reward ?? null;
  },

  // Call when a creature of the given kind is defeated. Returns true if this
  // kill completed the active quest.
  onKill(save, kind) {
    const q = this.current(save);
    if (!q || q.type !== 'kill' || q.kind !== kind) return false;
    const qs = this._qs(save);
    qs.progress = qs.progress || {};
    qs.progress[q.id] = Math.min(q.count, (qs.progress[q.id] ?? 0) + 1);
    return this.isComplete(save);
  },

  // Call when the player interacts with a POI of the given class. Returns true
  // if this visit completed the active quest.
  onPoiVisit(save, poiClass) {
    const q = this.current(save);
    if (!q || q.type !== 'poi' || q.poiClass !== poiClass) return false;
    if (this.isComplete(save)) return false; // already credited
    const qs = this._qs(save);
    qs.progress = qs.progress || {};
    qs.progress[q.id] = 1;
    return true;
  },

  // Call when an item is added to inventory. Returns true if this acquisition
  // completed the active quest.
  onItemAcquired(save, itemId, depth) {
    const q = this.current(save);
    if (!q || q.type !== 'item' || q.item !== itemId) return false;
    if ((depth ?? 0) < (q.minDepth ?? 0)) return false;
    if (this.isComplete(save)) return false; // already credited
    const qs = this._qs(save);
    qs.progress = qs.progress || {};
    qs.progress[q.id] = 1;
    return true;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// STARTER CHAIN — the first-session guidance ladder.
//
// Deliberately SEPARATE from QUEST_CHAIN above. The castle vault reads
// Quests.allDone(), which walks QUEST_CHAIN only, so adding steps here can
// never tighten (or loosen) the castle gate — the two ladders share nothing
// but this file. This one exists to answer "what do I do now?" for a player
// who just watched the intro, and it retires itself once the loop is learned.
//
// The steps trace one full pass of the economy — pick up supplies, till, plant,
// rebuild a neighbour, harvest, cash out — in the order the world actually
// affords them. `restore` sits BEFORE `harvest` on purpose: a fresh crop needs
// real time to mature, so the player gets something to do with the wood from
// the crates while the seed grows, instead of standing over a sprout.
//
// Each step is completed by an EVENT fired from the gameplay site that performs
// it (see scene.questEvent in app.js). Steps auto-advance on completion — there
// is no claim step — so the chip always shows the next thing to do.
//
// Rewards are small on purpose: $5 a step and $25 at the end, $50 across an
// entire first session, against a STARTING_MONEY of 50. Enough that finishing a
// step reads as progress, small enough that it can't outrun farming as an
// income source. Tune here — nothing else reads these numbers.
const STARTER_CHAIN = [
  {
    id: 's1_crate', event: 'chest',
    title: 'Gather your supplies',
    body: 'Supply crates were left along the road nearby. Open one.',
    reward: { money: 5 },
  },
  {
    id: 's2_till', event: 'till',
    title: 'Break ground',
    body: 'Tap a patch of open grass within reach to till it into soil.',
    reward: { money: 5 },
  },
  {
    id: 's3_plant', event: 'plant',
    title: 'Sow a seed',
    body: 'Select a seed from your bag, then tap your tilled soil to plant it.',
    reward: { money: 5 },
  },
  {
    id: 's4_restore', event: 'restore',
    title: 'Rebuild a neighbour',
    body: 'Ruined houses can be rebuilt with wood or stone. Tap a wreck to restore it.',
    reward: { money: 5 },
  },
  {
    id: 's5_harvest', event: 'harvest',
    title: 'Bring in the crop',
    body: 'Your seed grows a stage every 15 minutes. Tap it when it is ripe.',
    reward: { money: 5 },
  },
  {
    id: 's6_sell', event: 'sell',
    title: 'Cash out at Home',
    body: 'Selling only happens at Home. Carry your haul back and tap your house to sell.',
    reward: { money: 25 },
  },
];

// Starter-chain half of the Quests API. Namespaced with a `starter` prefix so
// the castle-chain calls above keep their short names and no call site can
// accidentally drive the wrong ladder.
Object.assign(Quests, {
  _ss(save) {
    if (!save.starter) save.starter = { step: 0, done: {}, dismissed: false };
    // A save written before the starter chain existed has the mid-game shape
    // already — treat it as a veteran and keep the chip off its screen.
    if (!save.starter.done) save.starter.done = {};
    return save.starter;
  },

  starterAllDone(save) {
    return (this._ss(save).step ?? 0) >= STARTER_CHAIN.length;
  },

  starterCurrent(save) {
    const step = this._ss(save).step ?? 0;
    return STARTER_CHAIN[step] ?? null;
  },

  starterStepIndex(save) {
    return Math.min(this._ss(save).step ?? 0, STARTER_CHAIN.length);
  },

  starterTotal() {
    return STARTER_CHAIN.length;
  },

  // True once the player has hidden the chip (or finished the ladder). The
  // chip is guidance, not an obligation — a player who knows the game can
  // dismiss it and never see it again.
  starterHidden(save) {
    return !!this._ss(save).dismissed || this.starterAllDone(save);
  },

  starterDismiss(save) {
    this._ss(save).dismissed = true;
  },

  // Mark the whole ladder finished without walking it — used to keep the chip
  // off the screen of a save that predates the starter chain, and by the
  // sandbox, where the player is plainly not a beginner.
  starterSkipAll(save) {
    const ss = this._ss(save);
    ss.step = STARTER_CHAIN.length;
  },

  // Fire a gameplay event at the starter ladder. Returns the step it just
  // completed (so the caller can show its reward), or null when the event
  // isn't what the current step is waiting for.
  onStarterEvent(save, event) {
    if (this.starterAllDone(save)) return null;
    const step = this.starterCurrent(save);
    if (!step || step.event !== event) return null;
    const ss = this._ss(save);
    ss.done[step.id] = true;
    ss.step = (ss.step ?? 0) + 1;
    return step;
  },
});
