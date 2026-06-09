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
