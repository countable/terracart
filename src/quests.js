// Each castle keeps the quest assigned on its first conversation. Assignment
// order chooses targets independently. A Bastion or a Ruin asks for ONE kill
// or hunt; its counter begins here, and one kill advances every matching
// active quest. Deliveries are a pool instead (creditDeliveries): each one
// credits exactly one Archive, including deliveries made before that Archive
// was first visited. Luxury jobs read the current Home score, never event
// totals. Completion never creates a job.
function questEnemies() {
  return Combat.enemyKinds().filter(kind => Combat.onQuestBoard(kind))
    .sort((a, b) => (Combat.monster(a)?.tier ?? 1) - (Combat.monster(b)?.tier ?? 1));
}

// "Slimes" / "deer": the target as a kind, for the flavour line.
function questPlural(q) {
  if (q.verb === 'hunt') return q.target === 'deer' ? 'deer' : q.target + 's';
  const name = Combat.enemyName(q.target);
  return name.endsWith('s') ? name + 'es' : name + 's';
}

// "a Slime" / "an Orc" / "a deer": the single target a kill or hunt names.
function questOne(q) {
  const name = q.verb === 'hunt' ? q.target : Combat.enemyName(q.target);
  return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
}

function questBody(q) {
  if (q.verb === 'kill') return `Defeat ${questOne(q)}.`;
  if (q.verb === 'hunt') return `Hunt ${questOne(q)}.`;
  if (q.verb === 'luxury') return `Furnish your active Home to ${q.need} luxury.`;
  return `Complete ${q.need} ${q.need === 1 ? 'delivery' : 'deliveries'}.`;
}

// A kill or hunt quest assigned when they asked for three or two drops to the
// single target every new one asks for; progress already made carries over.
function settleSingleTarget(q) {
  if (q.claimed || (q.verb !== 'kill' && q.verb !== 'hunt') || q.need === 1) return false;
  q.need = 1;
  q.have = Math.min(q.have, 1);
  q.body = questBody(q);
  return true;
}

// The hunt board names game that is hunted FOR something (its row's `drop`:
// meat from the deer and livestock, the rabbit's pelt, the crow's feather) —
// not a butterfly, game that a bare-handed tap takes but no board would
// send you after.
function questAnimals() {
  return Object.keys(SpriteLayout.CREATURE_BEHAVIOUR).filter(kind => SpriteLayout.isGame(kind) && SpriteLayout.creatureDrop(kind));
}

const Quests = {
  get(save, key) { return save.quests?.byCastle?.[key] || null; },

  assign(save, key, variant) {
    const existing = this.get(save, key);
    if (existing) return existing;
    const verb = CastleStyles.questTypeFor(key, variant);
    if (!key || !verb) return null;
    if (!save.quests?.byCastle) save.quests = { byCastle: {}, assigned: {} };
    const state = save.quests;
    const order = state.assigned[verb] || 0;
    const q = { verb, event: verb, need: 1, have: 0, claimed: false };
    if (verb === 'kill') {
      const enemies = questEnemies();
      q.target = enemies[Math.min(order, enemies.length - 1)];
      q.title = 'Pest control';
      q.reward = 66;
    } else if (verb === 'hunt') {
      const animals = questAnimals();
      q.target = animals[order % animals.length];
      q.title = 'The hunt';
      q.reward = 40;
    } else if (verb === 'luxury') {
      q.title = 'A respectable address';
      q.need = 16;
      q.reward = 60;
      q.have = Furniture.luxuryOf(save, save.starterShopId);
    } else {
      q.title = 'Neighbourly';
      q.reward = q.need * 30;
    }
    q.body = questBody(q);
    state.assigned[verb] = order + 1;
    state.byCastle[key] = q;
    if (verb === 'deliver') this.creditDeliveries(save);
    return q;
  },

  // The castle conversation's read of its quest: assigns on first talk, and
  // brings an older save's quest up to the current rules (one kill or hunt,
  // deliveries from the pool) before it is shown.
  open(save, key, variant) {
    const q = this.assign(save, key, variant);
    if (!q) return null;
    settleSingleTarget(q);
    if (q.verb === 'deliver') this.creditDeliveries(save);
    if (q.verb === 'luxury' && !q.claimed) q.have = Furniture.luxuryOf(save, save.starterShopId);
    return q;
  },

  // THE DELIVERY POOL. save.deliveryCount is every delivery ever completed;
  // save.quests.deliveriesSpent is how many of them an Archive has already
  // been credited with. Each unspent delivery completes one active Archive
  // quest, oldest assignment first, so one delivery counts at one castle, and
  // an Archive first visited after some deliveries still takes credit for one.
  // Returns whether any quest moved.
  creditDeliveries(save) {
    const state = save.quests;
    if (!state?.byCastle) return false;
    const quests = Object.values(state.byCastle).filter(q => q.verb === 'deliver');
    // Saves from before the pool: under the old rule one delivery could fill
    // every active Archive at once, so seed the spent count from the Archives
    // already filled, never past the deliveries that exist.
    if (state.deliveriesSpent === undefined) {
      state.deliveriesSpent = Math.min(save.deliveryCount ?? 0,
        quests.filter(q => q.have >= q.need).length);
    }
    let changed = false;
    for (const q of quests) {
      if (q.claimed || q.have >= q.need) continue;
      if (state.deliveriesSpent >= (save.deliveryCount ?? 0)) break;
      q.have += 1;
      state.deliveriesSpent += 1;
      changed = true;
    }
    return changed;
  },

  // One sentence of colour under the quest's bold title, by verb. Derived
  // when shown, not saved, so quests assigned before it read the same.
  flavour(q) {
    if (!q) return '';
    if (q.verb === 'luxury') return "We don't admit rabble here!";
    if (q.verb === 'kill') return `${questPlural(q)} keep testing the bastion's walls, and the thin garrison would sleep easier with fewer of them about.`;
    if (q.verb === 'hunt') return `The ruin's cooks have promised the lane a proper supper, and the ${questPlural(q)} for it will not catch themselves.`;
    return "The archive keeps the town's letters moving, and this week it is a courier short.";
  },

  completedCount(save) {
    return Object.values(save.quests?.byCastle || {}).filter(q => q.claimed).length;
  },

  claim(save, key) {
    const q = this.get(save, key);
    if (!q || q.claimed) return null;
    if (q.verb === 'luxury') q.have = Furniture.luxuryOf(save, save.starterShopId);
    if (q.have < q.need) return null;
    q.claimed = true;
    return q;
  },

  // A completed action. A delivery is already in save.deliveryCount by the
  // time it arrives here, so it is credited from the pool like any other.
  onEvent(save, event, detail) {
    if (event === 'deliver') return this.creditDeliveries(save);
    let changed = false;
    for (const q of Object.values(save.quests?.byCastle || {})) {
      settleSingleTarget(q);
      if (q.verb === 'luxury') {
        if (!q.claimed) {
          const have = Furniture.luxuryOf(save, save.starterShopId);
          changed = changed || q.have !== have;
          q.have = have;
        }
        continue; // Placement events never accumulate luxury.
      }
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
// The first crop grows while the player restores a home. One potato feeds
// that home; Tilly's thanks finish the guided work, followed by a road hint.
// Completed actions are saved even when performed ahead of their lesson.
// Guidance adds no coins and never changes castle quests or ownership.
const STARTER_CHAIN = [
  {
    id: 's1_crate', event: 'pickup',
    title: 'Gather your supplies',
    body: 'Pick up nearby supplies, or open a supply crate and take its contents.',
    completion: 'These supplies will help you begin.',
  },
  {
    id: 's2_plant', event: 'plant',
    title: 'Plant your first seed',
    body: 'Choose a seed from your bag, stand on grass, then tap Till & plant.',
    completion: 'Your seed is planted. Now give it some water.',
  },
  {
    id: 's3_water', event: 'water',
    title: 'Water your seed',
    body: 'Tap your planted seed to water it and help it grow.',
    completion: 'That will help it grow. Let’s mend a house while we wait.',
  },
  {
    id: 's4_restore', event: 'restore',
    title: 'Rebuild a neighbour',
    body: 'Open the nearby rock crate, then use the rocks to repair a ruined house.',
    completion: 'A little more of the neighbourhood is home again.',
  },
  {
    id: 's5_tilly', event: 'tilly',
    title: 'Help Tilly settle in',
    body: 'Meet Tilly, then bring one potato to the restored house. Talk to her after she moves in.',
    completion: 'A roof, a meal and a neighbour. This is how a place becomes home.',
  },
  {
    id: 's6_roads', event: 'roads',
    title: 'Keep mending',
    body: 'You can repair the roads as you explore. Keep growing and mending.',
    completion: 'You know the way now. Keep growing, exploring and mending.',
  },
];

// The Spirit's hello before step 1. The bubble stays down until the opening
// (story slides, safety card, how-to card) has cleared and REVEAL_MS more has
// passed, then speaks each line for LINE_MS before the first instruction.
// Played once per save (save.starter.introduced), and only while the ladder
// is still on its first step.
const STARTER_INTRO = {
  lines: ['Hey, it’s me! Tori!', 'Yes, a dragon spirit living in your compass.'],
  revealMs: 5000,
  lineMs: 3500,
};

// Starter-chain half of the Quests API. Namespaced with a `starter` prefix so
// the castle-chain calls above keep their short names and no call site can
// accidentally drive the wrong ladder.
Object.assign(Quests, {
  _ss(save) {
    const recover = !save.starter || save.starter.sequence !== 'first-neighbour';
    if (!save.starter) save.starter = { step: 0, dismissed: false, sequence: 'first-neighbour', done: {} };
    const ss = save.starter;
    if (ss.sequence !== 'first-neighbour') {
      const old = Math.max(0, ss.step || 0);
      const complete = old >= 6;
      ss.step = complete ? STARTER_CHAIN.length
        : !ss.sequence && old === 2 && !(save.planted || []).length ? 1 : Math.min(old, 4);
      ss.done = Object.fromEntries(STARTER_CHAIN.slice(0, ss.step).map(step => [step.event, true]));
      ss.sequence = 'first-neighbour';
    }
    ss.done ||= {};
    if (!Number.isFinite(ss.step)) ss.step = 0;
    if (recover && (save.inv || []).some(row => row?.count > 0)) ss.done.pickup = true;
    if (recover && (save.planted || []).length) ss.done.plant = true;
    if (recover && ((save.planted || []).some(p => p.watered_t || (p.stage || 0) > 0) || save.hasHarvested)) ss.done.water = true;
    if (recover && Object.values(save.restoredHouses || {}).includes('plain')) ss.done.restore = true;
    while (ss.step < STARTER_CHAIN.length) {
      const event = STARTER_CHAIN[ss.step].event;
      if (event === 'roads' && ss.dismissed) ss.done.roads = true;
      if (!ss.done[event]) break;
      ss.step++;
    }
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

  // True once the player has hidden the Spirit (or finished the ladder). The
  // Spirit offers guidance, not an obligation — a player who knows the game can
  // dismiss it and never see it again.
  starterHidden(save) {
    return !!window.__sandboxSkipTutorial || !!this._ss(save).dismissed || this.starterAllDone(save);
  },

  // The hello lines still owed to this save; empty once heard, or for a save
  // that is already past step 1.
  starterIntroLines(save) {
    const ss = this._ss(save);
    return ss.introduced || (ss.step ?? 0) > 0 ? [] : STARTER_INTRO.lines;
  },

  starterMarkIntroduced(save) {
    this._ss(save).introduced = true;
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

  // Mark the whole ladder finished without walking it — used to keep the Spirit
  // off the screen of a save that predates the starter chain, and by the
  // sandbox, where the player is plainly not a beginner.
  starterSkipAll(save) {
    const ss = this._ss(save);
    ss.step = STARTER_CHAIN.length;
    ss.skipped = true;
  },

  starterIntroductionsReady(save) {
    if (!this.starterAllDone(save)) return false;
    return !!this._ss(save).chickenArrived || !!this._ss(save).skipped || !!window.__sandboxSkipTutorial
      || (typeof Difficulty !== 'undefined' && Difficulty.get().homeGreeter !== 'chicken');
  },

  // The first weapon ceremony follows the chicken's entrance, never its catch.
  starterIntroductionsReady(save) {
    if (!this.starterAllDone(save)) return false;
    return !!this._ss(save).chickenArrived || !!this._ss(save).skipped || !!window.__sandboxSkipTutorial
      || (typeof Difficulty !== 'undefined' && Difficulty.get().homeGreeter !== 'chicken');
  },

  // Record facts before checking the current instruction, so acting ahead is safe.
  onStarterEvent(save, event) {
    const ss = this._ss(save);
    const step = STARTER_CHAIN[ss.step];
    const fact = event;
    if (!STARTER_CHAIN.some(row => row.event === fact)) return null;
    ss.done[fact] = true;
    this._ss(save);
    return step && ss.step > STARTER_CHAIN.indexOf(step) ? step : null;
  },
});
