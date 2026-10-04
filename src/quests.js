// Each castle keeps the quest assigned on its first conversation. Assignment
// order advances each quest type independently; completion never creates a job.
function questEnemies() {
  return Combat.enemyKinds().filter(kind => Combat.onQuestBoard(kind))
    .sort((a, b) => (Combat.monster(a)?.tier ?? 1) - (Combat.monster(b)?.tier ?? 1));
}

function questAnimals() {
  return Object.keys(SpriteLayout.CREATURE_BEHAVIOUR).filter(kind => SpriteLayout.isGame(kind));
}

const Quests = {
  get(save, key) { return save.quests?.byCastle?.[key] || null; },

  assign(save, key, variant) {
    const existing = this.get(save, key);
    if (existing) return existing;
    const verb = CastleStyles.get(variant).questType;
    if (!key || !verb) return null;
    if (!save.quests?.byCastle) save.quests = { byCastle: {}, assigned: {} };
    const state = save.quests;
    const order = state.assigned[verb] || 0;
    const q = { verb, event: verb, need: verb === 'kill' ? 3 : verb === 'hunt' ? 2 : order + 1,
      have: 0, claimed: false };
    if (verb === 'kill') {
      const enemies = questEnemies();
      q.target = enemies[Math.min(order, enemies.length - 1)];
      q.title = 'Pest control';
      const name = Combat.enemyName(q.target);
      q.body = `Defeat 3 ${name.endsWith('s') ? name + 'es' : name + 's'}.`;
      q.reward = 66;
    } else if (verb === 'hunt') {
      const animals = questAnimals();
      q.target = animals[order % animals.length];
      q.title = 'The hunt';
      q.body = `Hunt 2 ${q.target === 'deer' ? 'deer' : q.target + 's'}.`;
      q.reward = 40;
    } else {
      q.title = 'Neighbourly';
      q.body = `Complete ${q.need} ${q.need === 1 ? 'delivery' : 'deliveries'}.`;
      q.reward = q.need * 30;
    }
    state.assigned[verb] = order + 1;
    state.byCastle[key] = q;
    return q;
  },

  completedCount(save) {
    return Object.values(save.quests?.byCastle || {}).filter(q => q.claimed).length;
  },

  claim(save, key) {
    const q = this.get(save, key);
    if (!q || q.claimed || q.have < q.need) return null;
    q.claimed = true;
    return q;
  },

  onEvent(save, event, detail) {
    let changed = false;
    for (const q of Object.values(save.quests?.byCastle || {})) {
      if (q.claimed || q.event !== event || q.have >= q.need) continue;
      if (q.target && detail?.target !== q.target) continue;
      q.have = Math.min(q.need, q.have + 1);
      changed = true;
    }
    return changed;
  },

  onKill(save, kind) {
    return this.onEvent(save, SpriteLayout.isGame(kind) ? 'hunt' : 'kill', { target: kind });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// STARTER CHAIN — the first-session guidance ladder.
//
// Separate from castle quests and citadel battles: tutorial steps never
// change castle ownership. This answers "what do I do now?" for a player
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
    body: 'Supply crates line the road nearby. Open one.',
    reward: { money: 5 },
  },
  {
    id: 's2_till', event: 'till',
    title: 'Break ground',
    body: 'Turn a patch of grass into a bed for seeds.',
    reward: { money: 5 },
  },
  {
    id: 's3_plant', event: 'plant',
    title: 'Sow a seed',
    body: 'A seed from your bag belongs in that fresh earth.',
    reward: { money: 5 },
  },
  {
    id: 's4_restore', event: 'restore',
    title: 'Rebuild a neighbour',
    body: 'A ruined house waits for your hands to mend it.',
    reward: { money: 5 },
  },
  {
    id: 's5_harvest', event: 'harvest',
    title: 'Bring in the crop',
    body: 'Water your young crop whenever the soil dries, until it is ready to gather.',
    reward: { money: 5 },
  },
  {
    id: 's6_sell', event: 'sell',
    title: 'Cash out at Home',
    body: 'Bring your harvest Home, where someone will pay for it.',
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
