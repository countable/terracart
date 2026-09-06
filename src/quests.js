// Single global quest chain. Completing all quests unseals the castle vault.
// All functions are pure (only read/write save.quests) — no Phaser / DOM deps.

// ── THE CASTLE BOARD ────────────────────────────────────────────────────────
// THREE SLOTS, always full, refilled from a generator. Every castle is pinned
// to one slot for life, so a castle always has a job and it is never the job
// the castle down the road is offering — which is what makes walking to a
// different one worth doing.
//
// This replaced a hand-written chain of three: kill 10 slimes, find a well,
// bring a sapphire up from depth 3. Ten slimes was most of an evening for the
// FIRST thing the game asks of you, and when the three were done the board had
// nothing left to say. Many small jobs beat three big ones: the opener is now
// a single slime, and the work grows with the number you have finished.
const QUEST_SLOTS = 3;

// Rank = quests completed. Every size and every reward is derived from it, so
// the ladder is one number and there is no per-quest tuning to drift.
//   need   = clamp(ceil(base * (1 + rank * k)), 1, max)
//   reward = round(need * unit * (1 + rank * 0.15))
// `unit` is what one of a thing is worth, and it is the only place a template
// says anything about value: restoring a wreck pays many times what tilling a
// cell does because it costs many times as much.
const QUEST_REWARD_RAMP = 0.15;

// The verbs. `event` is the gameplay event that credits one unit (see
// scene.questEvent and the onKill / onPoiVisit hooks), so
// adding a verb here is a template plus a call site, not a new subsystem.
const QUEST_TEMPLATES = [
  { id: 'kill',    event: 'kill',    base: 1, k: 0.6,  max: 12, unit: 22, weight: 3,
    title: 'Pest control',
    body: (q) => `The garrison is paying a bounty. Defeat ${q.need} ${_plural(_enemyName(q.target), q.need)}.` },
  { id: 'harvest', event: 'harvest', base: 2, k: 0.5,  max: 15, unit: 10, weight: 3,
    title: 'Fill the stores',
    body: (q) => `The kitchens are short. Bring in ${q.need} ${_plural('crop', q.need)}.` },
  { id: 'plant',   event: 'plant',   base: 3, k: 0.5,  max: 20, unit: 6,  weight: 2,
    title: 'Sow the season',
    body: (q) => `Put ${q.need} ${_plural('seed', q.need)} in the ground.` },
  { id: 'till',    event: 'till',    base: 4, k: 0.5,  max: 24, unit: 4,  weight: 2,
    title: 'Break ground',
    body: (q) => `Turn ${q.need} ${_plural('patch', q.need)} of earth into soil.` },
  { id: 'chest',   event: 'chest',   base: 2, k: 0.4,  max: 10, unit: 14, weight: 2,
    title: 'Salvage rights',
    body: (q) => `Open ${q.need} ${_plural('chest', q.need)} out in the world.` },
  { id: 'sell',    event: 'sell',    base: 1, k: 0.7,  max: 8,  unit: 18, weight: 2,
    title: 'Trade run',
    body: (q) => `Cash out at Home ${q.need === 1 ? 'once' : `${q.need} times`}.` },
  { id: 'restore', event: 'restore', base: 1, k: 0.3,  max: 4,  unit: 70, weight: 1,
    title: 'Rebuild a neighbour',
    body: (q) => `Raise ${q.need} ruined ${_plural('house', q.need)} back up.` },
  { id: 'poi',     event: 'poi',     base: 1, k: 0,    max: 1,  unit: 55, weight: 1,
    title: 'Scouting report',
    body: (q) => `Scouts want eyes on ${_a(q.target)}. Find one and report back.` },
];

// A single enemy at rank 0 — "pest control starts with just a single of each" —
// and a different foe each time the verb comes up. The surface slime leads
// because it is the only one you can meet without going underground.
const QUEST_ENEMIES = ['slime', 'cave_slime', 'purple_slime', 'goblin', 'goblin_archer'];
const QUEST_ENEMY_NAMES = {
  slime: 'slime', cave_slime: 'cave slime', purple_slime: 'purple slime',
  goblin: 'goblin', goblin_archer: 'goblin archer',
};
// POI classes worth sending somebody to look at. Common enough to exist in a
// real neighbourhood, distinct enough to be a destination.
const QUEST_POIS = ['well', 'fountain', 'library', 'museum', 'park', 'place_of_worship', 'playground'];
// Exposed as a global (mirrors the "IIFE modules' window.X exports" pattern
// described at the top of interactables.js) purely for the headless test
// bundle: test/node/run.js's BRIDGE re-exports QUEST_TEMPLATES/QUEST_ENEMIES
// this same way, but QUEST_POIS was never added because nothing outside this
// file used to read the raw target list. poi_quest.test.js needs the REAL
// array, not a hand-copied one — a copy is exactly the kind of thing that
// drifts silently the next time a target is added here, which is the whole
// class of bug this file's onEvent()/onPoiVisit() plumbing just got bitten by
// (see interactables.js' markOpened for the fix). In the browser this line is
// a no-op duplicate of the lexical binding every later <script> tag already
// sees; only the node vm harness — which reloads each test file in its own
// separate vm.runInContext call — needs the property on the shared global.
if (typeof window !== 'undefined') window.QUEST_POIS = QUEST_POIS;
const QUEST_POI_NAMES = {
  well: 'an old well', fountain: 'a fountain', library: 'a library', museum: 'a museum',
  park: 'a park', place_of_worship: 'a chapel', playground: 'a playground',
};

const _plural = (w, n) => (n === 1 ? w : (w.endsWith('s') ? w + 'es' : w + 's'));
const _enemyName = (k) => QUEST_ENEMY_NAMES[k] || k;
const _a = (k) => QUEST_POI_NAMES[k] || k;

// The opening three, authored rather than rolled. A first impression is worth
// writing by hand, and this one has to say "these are small" — one slime, one
// crop, two chests — before the generator takes over at gen 3.
const QUEST_OPENERS = [
  { t: 'kill', target: 'slime' },
  { t: 'harvest' },
  { t: 'chest' },
];

const Quests = {
  _qs(save) {
    if (!save.quests || !Array.isArray(save.quests.slots)) {
      // MIGRATION off the old three-quest chain ({ step, progress }). The step
      // is dropped — the jobs it counted no longer exist — but a player who
      // FINISHED it had every castle in the world unsealed, because that was
      // the only thing a global gate could do. The seal is per castle now, and
      // there is no way to name the castles they had opened (a castle's key
      // comes from the tile, which may not be loaded, or ever again). So the
      // earned access is carried as a flag: they keep what they had, and every
      // castle claimed from here is claimed the new way.
      const oldStep = save.quests && typeof save.quests.step === 'number' ? save.quests.step : -1;
      if (oldStep >= 3) save.castlesLegacyOpen = true;
      save.quests = { slots: [], gen: 0, done: Math.max(0, oldStep) };
    }
    const q = save.quests;
    if (typeof q.gen !== 'number') q.gen = 0;
    if (typeof q.done !== 'number') q.done = 0;
    // Top the board up. A slot is never left empty: the moment one is claimed
    // the next job takes its number, which is the whole point of numbering them.
    while (q.slots.length < QUEST_SLOTS) q.slots.push(null);
    for (let i = 0; i < QUEST_SLOTS; i++) {
      if (!q.slots[i]) q.slots[i] = this.generate(i, q.gen++, q.done, save.relicSalt || 0);
    }
    return q;
  },

  // Which slot a castle offers. Deterministic from its stable key, so a castle
  // keeps its slot for life and two castles side by side rarely share one.
  slotForCastle(key) {
    if (!key) return 0;
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) % QUEST_SLOTS;
  },

  // THE GENERATOR. Pure and seeded off (salt, slot, gen), so the same board
  // comes back after a reload — a quest must not re-roll under a player who is
  // halfway through it — and two saves don't walk the same sequence.
  generate(slot, gen, rank, salt) {
    const seed = (((+salt || 0) * 2654435761) ^ (slot * 40503) ^ ((gen + 1) * 2246822519)) >>> 0;
    let x = seed || 1;
    const rnd = () => {
      x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
    // The authored opening trio, one per slot, before the roll takes over.
    const opener = gen < QUEST_SLOTS ? QUEST_OPENERS[slot] : null;
    let tpl;
    if (opener) tpl = QUEST_TEMPLATES.find(t => t.id === opener.t);
    if (!tpl) {
      const bag = [];
      for (const t of QUEST_TEMPLATES) for (let i = 0; i < t.weight; i++) bag.push(t);
      tpl = bag[Math.floor(rnd() * bag.length)] || QUEST_TEMPLATES[0];
    }
    const need = Math.max(1, Math.min(tpl.max,
      Math.ceil(tpl.base * (1 + rank * tpl.k))));
    const q = {
      id: `q${gen}`, slot, gen, verb: tpl.id, event: tpl.event, need, have: 0,
      reward: Math.round(need * tpl.unit * (1 + rank * QUEST_REWARD_RAMP)),
    };
    if (tpl.id === 'kill') {
      q.target = (opener && opener.target)
        || QUEST_ENEMIES[Math.min(QUEST_ENEMIES.length - 1, Math.floor(rnd() * (1 + Math.min(rank, 4))))];
    }
    if (tpl.id === 'poi') q.target = QUEST_POIS[Math.floor(rnd() * QUEST_POIS.length)];
    q.title = tpl.title;
    q.body = tpl.body(q);
    return q;
  },

  // The whole board — always QUEST_SLOTS long, never a hole in it.
  board(save) { return this._qs(save).slots.slice(); },
  slot(save, i) { return this._qs(save).slots[i] || null; },
  isSlotComplete(save, i) {
    const q = this.slot(save, i);
    return !!q && q.have >= q.need;
  },
  completedCount(save) { return this._qs(save).done; },

  // Claim slot `i`: pay out and put the NEXT job in that number. Returns the
  // finished quest (for the toast), or null if it wasn't ready.
  claim(save, i) {
    if (!this.isSlotComplete(save, i)) return null;
    const q = this._qs(save);
    const done = q.slots[i];
    q.done++;
    q.slots[i] = this.generate(i, q.gen++, q.done, save.relicSalt || 0);
    return done;
  },

  // One gameplay event, offered to every live slot. All three track at once —
  // there is no accept step, the same way the starter ladder has none — and the
  // generator avoids putting one verb in two slots, so double credit is rare by
  // construction rather than by a rule here.
  onEvent(save, event, detail) {
    const q = this._qs(save);
    let any = false;
    for (const s of q.slots) {
      if (!s || s.event !== event || s.have >= s.need) continue;
      if (s.target && detail && detail.target && detail.target !== s.target) continue;
      if (s.target && (!detail || detail.target == null)) continue;
      s.have = Math.min(s.need, s.have + 1);
      any = true;
    }
    return any;
  },

  // The two hooks the gameplay sites already call, kept so no call site has
  // to know the board exists.
  onKill(save, kind) { return this.onEvent(save, 'kill', { target: kind }); },
  onPoiVisit(save, poiClass) { return this.onEvent(save, 'poi', { target: poiClass }); },
};

// ─────────────────────────────────────────────────────────────────────────────
// STARTER CHAIN — the first-session guidance ladder.
//
// Deliberately SEPARATE from the castle board above. A castle is unsealed by
// claiming a quest AT it, which reads save.claimedCastles and nothing here, so
// adding steps to this ladder can never tighten (or loosen) a castle gate —
// the two share nothing but this file. This one exists to answer "what do I do now?" for a player
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
    // Says the LOOP, because the loop is what the player has to know. The old
    // copy — "grows a stage every 15 minutes, tap it when it is ripe" — read
    // as one wait: sow, come back, harvest. What actually happens is four
    // rounds of tap-to-water plus a 15-minute hold each (Crops.advanceGrowth
    // only advances a WATERED plant, and clears the watering as it does), so a
    // player who took the old line at its word came back to a plant that had
    // not moved and no explanation of why.
    body: 'Tap the plant to water it. It grows a stage 15 min later, then '
        + 'wants watering again — four times over to ripe.',
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
    // (Older saves also carry a write-only `done` map here; nothing reads it.)
    if (!save.starter) save.starter = { step: 0, dismissed: false };
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

  // Undo a dismissal — the ☰ menu's "Show objectives" entry. Dismissing used to
  // be one tap on a 13px × and permanently ended the ladder for that save, with
  // nothing anywhere to bring it back.
  starterShow(save) {
    this._ss(save).dismissed = false;
  },
  // Is the ladder dismissed but not actually finished? Only then is there
  // anything for "Show objectives" to restore.
  starterDismissed(save) {
    return !!this._ss(save).dismissed && !this.starterAllDone(save);
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
    ss.step = (ss.step ?? 0) + 1;
    return step;
  },
});
