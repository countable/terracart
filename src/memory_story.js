// The recovered past follows the lifetime discovery ledger, never the purse.
// Pending pages live in the save and are acknowledged, not consumed on open.
// All paintings are existing game assets; the truth stays at the tower until
// memory 30 at the second tower. Tower identity and lifetime memories gate acts.
const MemoryStory = (() => {
  const START_MEMORIES = 9, LEAVE_MEMORIES = 21, REVEAL_MEMORIES = 30;
  const ABANDONED_NOTE = 'come to me when you are ready.';
  const LOCKED = { art: 'restore_wizard', title: 'The sealed tower',
    body: 'You count nine small stars above the lock and press your hand against the cold door. It will not open until nine memories have returned.' };
  const ABANDONED = { art: 'restore_wizard', title: 'An abandoned tower',
    body: 'You find cold ashes, bare shelves and a note where the wizard used to sit. You read the few words twice: “' + ABANDONED_NOTE + '”' };
  const EMPTY = { art: 'restore_wizard', title: 'An empty tower',
    body: 'You knock and listen to the sound travel through the tower. No one answers; the wizard must be elsewhere.' };
  // THE FIRST WORDS ARE THE WARDEN'S, ON A TAP. This page is what the safe
  // area's warden says while nothing is mended yet (npcDialogue below). It
  // used to be pushed onto the pending queue by the warden's own seating and
  // splashed over the map on the first morning; it never is now (Sep 2026,
  // owner's call): the player walks up to the one neighbour on screen and
  // taps them. drain() drops a queued 'home' record from an older save.
  const HOME = {
    title: 'A neighbour at the gate', art: 'revive_found',
    body: 'My children still ask when we can go home. I kept the key, though there is hardly a door left. If you can mend these houses, we can come back. We still have hands to help.',
  };
  const RUMOUR = 'They say a wise man lives somewhere around here. Nobody I know has seen him. Perhaps he knows why the old roads feel so familiar to you.';
  // THE STORY NEIGHBOURS by the starting trailer (NPC.STORY_ROLES; Starter
  // placeSafeAreaWarden seats them). Each keeps to one thread of the story
  // and moves with the act, never ahead of it: the survivor knows the
  // Warmonger only as the night the roofs went, the believer never learns
  // what the player learns at the second tower — the irony is the player's.
  const NEIGHBOURS = {
    witness: {
      1: 'Nobody heard an army. There was a bell, then smoke, then no roofs anywhere. They call whatever did it the Warmonger. I never saw its face.',
      2: 'The Warmonger took every roof in one night. You are putting them back one at a time. That is the only answer to it I have ever heard.',
      3: 'Some nights I think the Warmonger is still out there. Then I see lamplight in a mended window, and I stop thinking about it.',
    },
    // The wanderer is a CHILD (NPC.STORY_ROLES — drawn at CHILD_SCALE): short
    // sentences, one thing at a time, a door remembered before a house.
    wanderer: {
      homeless: 'We sleep under whichever wall is driest. I had a room once, with my name on the door. Now there is only the door.',
      housed: 'Did you see? A roof! A real one, with a lamp under it. I slept inside last night. I forgot what rain sounds like on a roof.',
      settled: 'I have a bed now, and a window. Knock when you go past. There is always something in the pot.',
    },
    believer: {
      ruin: 'Before the fire a wise wizard watched over this land. His tower fell with the rest. Mend enough of these wrecks and you will find it. Restore it, and perhaps he comes back and saves us all.',
      locked: 'His tower stands again! The door will not open for me, but he is in there, I know it. He will come out when the time is right.',
      open: 'You have spoken with him? Then there is hope for all of us. He never turned anyone away.',
      abandoned: 'The tower is cold again. He has not left us. A wise man does not leave. He goes ahead.',
      moved: 'They say he keeps a new tower now. When you see him, tell him we still light a candle for him every night.',
    },
  };
  const SCENES = {
    3: { art: 'story_wrecks', title: 'The name in the smoke',
      body: 'You hear a bell through the smoke and see someone clutch a child, whispering the name Warmonger. Your hands are clenched when the glimpse passes, but you cannot remember what they held.' },
    6: { art: 'kind_memory', title: 'The window behind you',
      body: 'You see the broken windows whole for a moment, with a still figure watching you from one of them. When you turn, the frame is empty, and you wonder whether you were meant to notice.' },
    9: { art: 'book_read', title: 'A voice by the old road',
      body: 'You remember someone beside a shuttered house speaking of a wise man nearby whom nobody has seen in years. The voice is clearer than the face, and you wonder whether he knows why these roads feel familiar.' },
    12: { art: 'story_wrecks', title: 'What the Warmonger left',
      body: "You feel heat against your face as roofs fall along the street, with someone shouting the name Warmonger. You cannot tell which side of the flames you are on." },
    15: { art: 'restore_house', title: 'The table beneath the roof',
      body: 'You see supper left on a table as the windows turn white and the roof folds inward. Someone stands still beyond the fire, and you have the uncomfortable feeling of being watched.' },
    18: { art: 'kind_memory', title: 'The hand at your shoulder',
      body: 'You see a woman pull a child behind her as flames climb a doorway and a quiet voice orders someone forward. You try to see who obeys, but the doorway falls first.' },
    21: { art: 'story_wrecks', title: 'Beneath the battle',
      body: 'You fall through smoke towards a broken town while someone orders you to rise. The pain feels too large for the body you have now, and you cannot move.' },
    24: { art: 'revive_wake', title: 'A second beginning',
      body: 'You feel yourself being carried from a battlefield, with strange skin and hands that seem much too small. A voice beside you says there is still enough left, but the memory goes dark before you can see who is speaking.' },
    27: { art: 'kind_wizard', title: 'Beyond this ruined land',
      body: 'You see maps of unfamiliar skies spread across a table and a finger moving over them. Someone speaks of when you will be whole again, in a voice you recognise without knowing why.' },
    30: { art: 'kind_memory', title: 'The memory he kept',
      body: 'You can almost fit the quiet voice, the falling roofs and the strange maps together, but one face is still missing. You need to return to the wizard’s new tower and ask him.' },
  };
  const AFTER = [
    { art: 'restore_house', title: 'A memory worth keeping', body: 'You close your eyes and can still picture the doorway you repaired. You know who will live behind it, which makes this memory easier to hold.' },
    { art: 'trail_intro', title: 'The road you chose', body: 'You remember this road without anyone left to walk it. Now you can hear people along it, and you find yourself listening for a little longer.' },
    { art: 'home_sell', title: 'Small things remain', body: 'You remember warm bread, a doorstep and someone calling you in from the rain. You do not know why these little things return so clearly, but you are glad they do.' },
  ];
  const INTRO = [
    { art: 'restore_wizard', title: 'Someone has been waiting', body: 'You reach for the tower door, and it opens before you knock. The old man knows about the houses you repaired and seems pleased that you found him.' },
    { art: 'kind_wizard', title: 'A promise of help', body: 'You listen as the wizard offers to help you grow strong enough to face what lies beyond the roads. Restoring the land together sounds easier than doing it alone.' },
    { art: 'kind_memory', title: 'Come back with memories', body: 'You feel his hand close around yours as he explains that each memory brings back a little more of you. He asks you to return when you remember more, so he can help you reach that strength.' },
  ];
  const FIRST_RETURN = { art: 'kind_wizard', title: 'The right things', body: 'You hear him offer to help you remember the right things, though you had not known there could be wrong ones. He says memories return out of order and asks you to bring him anything that troubles you.' };
  // Milestones unlock at fixed lifetime counts and belong to one tower.
  // A return catches up eligible pages together. The first tower closes at 21;
  // missed first-tower conversations never move into the new location.
  const ACT2 = [
    { id: 'silver_lining', minMemories: 12, tower: 'first', pages: [
      { art: 'kind_wizard', title: 'A silver lining', body: 'You listen as he explains that monsters make you stronger for what comes next. His eyes go to the damage on your weapon before the tear in your sleeve.' },
    ] },
    { id: 'stronger_hands', minMemories: 15, tower: 'first', pages: [
      { art: 'restore_wizard', title: 'Work for other hands', body: 'You think of the houses while he tells you the survivors can mend their own shutters now. He says kindness cannot stop everything out there, and you wonder which things he means.' },
    ] },
    { id: 'right_order', minMemories: 15, tower: 'first', pages: [
      { art: 'story_wrecks', title: 'The burning street', body: 'You close your eyes at his request and try to remember the street. A woman reaches from a doorway with a child behind her, but you cannot hear what she is saying.' },
      { art: 'kind_memory', title: 'In the right order', body: 'You listen as he says you arrived before the flames and the people were calling for help. When you picture the doorway again, the raised hand seems to welcome you, though the child is harder to see.' },
    ] },
    { id: 'useful_memories', minMemories: 18, tower: 'first', pages: [
      { art: 'kind_wizard', title: 'What remains useful', body: 'You try to picture the woman again, but his fingers tighten around your wrist. He asks you to remember the weight in your hands and the moment your enemy gave way instead.' },
    ] },
    { id: 'hesitation', minMemories: 18, tower: 'first', pages: [
      { art: 'wizard_cold', title: 'An old habit', body: 'You begin to stand as soon as he tells you to move, before you have decided to. He smiles at what he calls a good habit, and you sit with the odd feeling that your body heard him first.' },
    ] },
    { id: 'little_lives', minMemories: 24, tower: 'second', pages: [
      { art: 'wizard_cold', title: 'Their little lives', body: 'You think of roofs and baskets as he says the survivors’ little lives will take all of yours if you let them. He pulls out a chair for more important work, and you cannot quite see why theirs matters less.' },
    ] },
    { id: 'what_comes_next', minMemories: 27, tower: 'second', pages: [
      { art: 'wizard_map', title: 'What comes next', body: 'You look down at a map whose coastlines you do not recognise while he begins to speak of having you back. He changes it to having your strength back, but you keep noticing the first words.' },
    ] },
  ];
  // These fragments contradict a version the player actually heard him give.
  // Before that visit, the original fragments remain ambiguous and complete.
  const ACT2_MEMORIES = {
    18: { requires: 'right_order', art: 'memory_doorway', title: 'The hand in the doorway', body: 'You remember the wizard saying the woman was welcoming you, but now you can see her hand braced against the door. She is trying to shut it when the roof gives way.' },
    21: { requires: 'useful_memories', art: 'kind_memory', title: 'The word beneath the word', body: 'You reach for the victory he told you to remember and hear someone pleading through the burning roofs. Then the street goes quiet, and you cannot make it fit the way he told it.' },
    24: { requires: 'hesitation', art: 'memory_grip', title: 'An older grip', body: 'You remember his hand beside a battlefield, turning yours whenever his moved. He called it a good habit, but you cannot remember wanting to follow.' },
    27: { requires: 'little_lives', art: 'wizard_map', title: 'A mark on a map', body: 'You remember him speaking of little lives above a map of unfamiliar shores. His finger covers a mark for a whole town, and you think of how many people must fit beneath it.' },
  };
  // A repeat visit holds the current voice instead of advancing or cycling
  // back to an earlier, kinder wizard. These pages never grant an upgrade.
  const VISITS = [
    'You listen as he asks you to explore unfamiliar land and bring back what you remember. It is comforting to think someone can help you make sense of it.',
    'You think of the creatures that once frightened you while he points out how much more you can face. You had not noticed all the little changes in yourself.',
    'You picture the village as he says it can spare you for a while. He wants you to look farther away for the parts of yourself still missing.',
    'You try to hold the details still while he explains that a wounded mind can resist a simple answer. They seemed clearer before you started explaining them.',
    'You listen as he tells you to keep only what made you strong. You wonder where the faces you remember are meant to go.',
    'You hear that you used to trust him more quickly. You search his face for something familiar, but cannot find it yet.',
    'You think of the people waiting outside while he says they have had enough of your time. There is work he wants you to finish here.',
    'You hear him say there is very little left between you and what you were. You try to picture it and still cannot.',
  ];
  const SURVIVORS = [
    'The children have been practising how to thank you. Come by before supper, or they will have to start again tomorrow.',
    'You look tired. There is bread on the table. It is only bread, but you do not have to earn it.',
    'You need not fix anything today. Sit with us a while. We saved you a place.',
    'Whatever you have remembered, you are the one who opened our door again. It is still open to you.',
  ];
  const DRAGON_DECLARATION = 'You hear him call you both dragons, the ruling species of the stars, and claim this planet as his own. To him you are a sword nearly restored, with fire breath to recover from the demons on dungeon level 9.';
  const REVEAL = [
    { art: 'wizard_dragon', title: 'The shape behind the mask', body: 'You watch the old man stay seated as he explains that this human shape is all he has left. Then you remember the fire above the town leaving your own throat, and understand that you were the Warmonger.' },
    { art: 'wizard_dragon', title: 'His planet', body: DRAGON_DECLARATION },
    { art: 'cave_first', title: 'Act III · The fire below', body: 'You remember burning this world at his command before your dragon form and memories were taken, and can see how carefully he has chosen what to return. Your fire waits below, but you do not have to use it as he wants.' },
  ];
  function state(save) {
    const s = save.memoryStory && typeof save.memoryStory === 'object'
      ? save.memoryStory : (save.memoryStory = {});
    if (!Array.isArray(s.pending)) s.pending = [];
    if (!Array.isArray(s.act2Seen)) s.act2Seen = [];
    if (!Number.isFinite(s.visits) || s.visits < 0) s.visits = 0;
    return s;
  }
  function total(save) { return Object.keys(save.discovered || {}).length; }
  function enqueue(save, n, label) {
    const s = state(save), id = `memory:${n}`;
    if (!s.pending.some(p => p.id === id)) s.pending.push({ id, memory: n, label: label || 'something new' });
    return s.pending;
  }
  function panel(record, save) {
    const n = record.memory;
    if (n === 30 && save?.memoryStory?.act3Started) return { ...AFTER[0], kind: 'memory' };
    if (n > 0 && n % 3 === 0) {
      const alternate = ACT2_MEMORIES[n];
      const curated = alternate && save?.memoryStory?.act2Seen?.includes(alternate.requires) && !save.memoryStory.act3Started;
      return { ...((curated && ACT2_MEMORIES[n]) || SCENES[n] || AFTER[(Math.floor(n / 3) - 11) % AFTER.length]), kind: 'memory' };
    }
    return { art: 'discovery_badge', kind: 'memory', title: 'A memory returns',
      body: `You feel a small piece of the past return with ${record.label}. You try to hold it still before it fades.` };
  }
  function drain(scene) {
    const s = scene.save.memoryStory;
    if (!s?.pending?.length || scene._memoryStoryOpen) return false;
    // A 'home' record queued by an older save: the warden says it on a tap
    // now, so it leaves the queue unshown.
    if (s.pending.some(p => p.id === 'home')) {
      s.pending = s.pending.filter(p => p.id !== 'home');
      persistSave(scene.save);
      if (!s.pending.length) return false;
    }
    if (document.body?.classList?.contains('modal-open')) return false;
    const record = s.pending[0];
    let p = panel(record, scene.save);
    if (record.npc && scene.textures && typeof NPC !== 'undefined') {
      p.art = NPC.portrait(scene, record.npc);
      p.title = `${record.npc.name} · Neighbour`;
    }
    scene._memoryStoryOpen = true;
    try {
      scene.showMessageModal({ ...p, mustAcknowledge: true, onDismiss: () => {
        if (s.pending[0] === record) s.pending.shift();
        scene._memoryStoryOpen = false;
        persistSave(scene.save);
      } });
    } catch (error) { scene._memoryStoryOpen = false; throw error; }
    return true;
  }
  function npcDialogue(scene, c) {
    if (c.role === 'warden') {
      const repaired = Object.keys(scene.save.restoredHouses || {}).length;
      if (!repaired) return HOME.body + '\n\n' + NPC.WARDEN_LINE;
      if (total(scene.save) >= 9 && act(scene.save) === 1) return RUMOUR;
      if (act(scene.save) >= 2) return survivorLine(scene.save);
      return 'There is lamplight in a house that was dark yesterday. My children saw it first. Thank you. We can begin again.';
    }
    if (c.role === 'witness') return NEIGHBOURS.witness[act(scene.save)];
    if (c.role === 'wanderer') return wandererLine(scene, c);
    if (c.role === 'believer') return believerLine(scene.save);
    // The fixed ninth scene guarantees the rumour; a neighbour repeats it
    // without replacing every scholar's or trader's ordinary conversation.
    if (c.role === 'scout' && total(scene.save) >= 9 && act(scene.save) === 1) return RUMOUR;
    if (c.role === 'scout' && act(scene.save) >= 2) return survivorLine(scene.save);
    return null;
  }
  // The wanderer is homeless until the NEXT restoration after the player
  // first meets them: the first talk stamps the restoration count of the day
  // (save.memoryStory.met[id]); one more roof after that and they are housed.
  function wandererLine(scene, c) {
    const s = state(scene.save), mended = Object.keys(scene.save.restoredHouses || {}).length;
    if (!s.met || typeof s.met !== 'object') s.met = {};
    if (!Number.isFinite(s.met[c.id])) {
      s.met[c.id] = mended;
      if (typeof persistSave === 'function') persistSave(scene.save);
    }
    if (mended <= s.met[c.id]) return NEIGHBOURS.wanderer.homeless;
    return act(scene.save) >= 2 ? NEIGHBOURS.wanderer.settled : NEIGHBOURS.wanderer.housed;
  }
  // The believer follows the tower itself (Houses.wizardTowerIds and the
  // memory gates towerAccess reads), one step behind the player.
  function believerLine(save) {
    const towers = Houses.wizardTowerIds(save), memories = total(save);
    if (act(save) === 3 || towers.secondId) return NEIGHBOURS.believer.moved;
    if (!towers.firstId) return NEIGHBOURS.believer.ruin;
    if (memories >= LEAVE_MEMORIES) return NEIGHBOURS.believer.abandoned;
    if (memories < START_MEMORIES) return NEIGHBOURS.believer.locked;
    return NEIGHBOURS.believer.open;
  }
  function survivorLine(save) {
    const s = state(save);
    return SURVIVORS[s.act3Started ? 3 : Math.min(3, Math.floor(s.act2Seen.length / 2))];
  }
  function act(save) {
    if (save.memoryStory?.act3Started) return 3;
    return Houses.wizardTowerIds(save).firstId && total(save) >= START_MEMORIES ? 2 : 1;
  }
  function towerAccess(save, house) {
    const identity = Houses.wizardTowerIdentity(save, house);
    if (!identity) return 'empty';
    if (total(save) < START_MEMORIES) return 'locked';
    if (identity === 'first' && total(save) >= LEAVE_MEMORIES) return 'abandoned';
    return 'open';
  }
  function objective(save) {
    const towers = Houses.wizardTowerIds(save), memories = total(save);
    if (act(save) === 3) return typeof DragonStory !== 'undefined' ? DragonStory.objective(save) : null;
    if (towers.firstId && memories < START_MEMORIES) return 'Recover nine memories to enter the Wizard Tower.';
    if (memories >= LEAVE_MEMORIES && towers.firstId && !towers.secondId) return 'Find the wizard’s new tower among the wrecks you restore.';
    if (memories >= REVEAL_MEMORIES && towers.secondId) return 'Return to the wizard’s new tower.';
    if (act(save) === 2) return 'Bring your returning memories to the wizard.';
    return null;
  }
  function eligibleBeats(save, house) {
    const identity = Houses.wizardTowerIdentity(save, house), seen = state(save).act2Seen;
    return ACT2.filter(beat => beat.tower === identity && total(save) >= beat.minMemories && !seen.includes(beat.id));
  }
  function wizardSequence(save, house) {
    const s = state(save), access = towerAccess(save, house), towerId = String(house?.id ?? '');
    if (access !== 'open') {
      // Abandonment takes precedence even over a half-read first-tower visit.
      if (s.visit && (!s.visit.towerId || s.visit.towerId === towerId)) s.visit = null;
      return { kind: access, page: 0, towerId };
    }
    const identity = Houses.wizardTowerIdentity(save, house);
    const revealDue = identity === 'second' && total(save) >= REVEAL_MEMORIES && !s.act3Started;
    if (s.visit) {
      const sameTower = !s.visit.towerId || s.visit.towerId === towerId;
      const currentReveal = s.visit.kind === 'reveal' && s.visit.revealVersion === 2;
      if ((!s.act3Started || s.visit.kind === 'visit') && sameTower && (!revealDue || currentReveal) && (s.visit.kind !== 'reveal' || currentReveal)) {
        s.visit.towerId = towerId;
        return s.visit;
      }
      s.visit = null;
    }
    let kind;
    if (s.act3Started) kind = 'visit';
    else if (revealDue) kind = 'reveal';
    else if (!s.introDone) kind = 'intro';
    else if (s.visits === 1) kind = 'return';
    else kind = eligibleBeats(save, house).length ? 'milestone' : 'visit';
    const beats = kind === 'milestone' || kind === 'return' ? eligibleBeats(save, house).map(beat => beat.id) : [];
    return (s.visit = { kind, beats, page: 0, count: s.visits, towerId,
      memory: total(save), revealVersion: kind === 'reveal' ? 2 : undefined });
  }
  function pagesFor(save, visit) {
    if (visit.kind === 'locked') return [LOCKED];
    if (visit.kind === 'abandoned') return [ABANDONED];
    if (visit.kind === 'empty') return [EMPTY];
    if (visit.kind === 'intro') return INTRO;
    if (visit.kind === 'reveal') return REVEAL;
    const beats = visit.beats || (visit.beat ? [visit.beat] : []);
    const pages = beats.flatMap(id => ACT2.find(beat => beat.id === id)?.pages || []);
    if (visit.kind === 'return') return [FIRST_RETURN, ...pages];
    if ((visit.kind === 'milestone' || visit.kind === 'act2') && pages.length) return pages;
    if (save.memoryStory?.act3Started) return [{ art: 'wizard_dragon', title: 'The fire below',
      body: typeof DragonStory !== 'undefined' && DragonStory.unlocked(save)
        ? 'You feel the warmth behind your teeth as he says you are beginning to resemble yourself. His eyes move past you, as though he is looking for something much farther away.'
        : 'You hear him repeat that the demons on dungeon level nine have your fire. You try to imagine breathing it again.' }];
    return [{ art: 'kind_wizard', title: 'More important work', body: VISITS[Math.min(state(save).act2Seen.length, VISITS.length - 1)] }];
  }
  function visitWizard(scene, offer, house) {
    if (scene._wizardStoryOpen) return;
    const s = state(scene.save), visit = wizardSequence(scene.save, house);
    persistSave(scene.save);
    const pages = pagesFor(scene.save, visit), blocked = ['locked', 'abandoned', 'empty'].includes(visit.kind);
    const show = () => {
      scene._wizardStoryOpen = true;
      const i = Math.max(0, Math.min(pages.length - 1, Math.floor(visit.page || 0)));
      visit.page = i;
      let dismissed = false;
      const panel = pages[i];
      try { scene.showMessageModal({ ...panel,
        kind: visit.kind === 'reveal' ? 'memory' : 'wizard',
        mustAcknowledge: true, okLabel: i + 1 < pages.length ? 'Next' : blocked ? 'Leave' : 'Continue', onDismiss: () => {
          if (dismissed || (!blocked && (s.visit !== visit || visit.page !== i))) return;
          dismissed = true;
          if (blocked) { scene._wizardStoryOpen = false; return; }
          visit.page = i + 1;
          if (visit.page < pages.length) { persistSave(scene.save); show(); return; }
          if (visit.kind === 'intro') s.introDone = true;
          if (visit.kind === 'reveal') { s.revealed = true; s.act3Started = true; }
          for (const id of visit.beats || (visit.beat ? [visit.beat] : [])) {
            if (ACT2.some(beat => beat.id === id) && !s.act2Seen.includes(id)) s.act2Seen.push(id);
          }
          s.visits = (visit.count ?? s.visits) + 1;
          s.visit = null;
          scene._wizardStoryOpen = false;
          persistSave(scene.save);
          scene.updateObjectiveDOM?.();
          offer();
        } }); } catch (error) { scene._wizardStoryOpen = false; throw error; }
    };
    try { show(); } catch (error) { scene._wizardStoryOpen = false; throw error; }
  }
  return { START_MEMORIES, LEAVE_MEMORIES, REVEAL_MEMORIES, ABANDONED_NOTE, LOCKED, ABANDONED, EMPTY,
    HOME, RUMOUR, NEIGHBOURS, SCENES, AFTER, INTRO, FIRST_RETURN, ACT2, ACT2_MEMORIES, SURVIVORS, VISITS, REVEAL, DRAGON_DECLARATION,
    state, total, enqueue, panel, drain, npcDialogue, wandererLine, believerLine, survivorLine, act, towerAccess, objective,
    eligibleBeats, wizardSequence, pagesFor, visitWizard };
})();
