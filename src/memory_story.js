// The recovered past follows the lifetime discovery ledger, never the purse.
// Pending pages live in the save and are acknowledged, not consumed on open.
// All paintings are existing game assets; the truth stays at the tower until
// memory 30 at the second tower. Tower identity and lifetime memories gate acts.
const MemoryStory = (() => {
  const START_MEMORIES = 9, LEAVE_MEMORIES = 21, REVEAL_MEMORIES = 30;
  const ABANDONED_NOTE = 'come to me when you are ready.';
  const LOCKED = { art: 'restore_wizard', title: 'The sealed tower',
    body: 'Nine small stars are carved above the lock. The door will not yield until nine memories have returned.' };
  const ABANDONED = { art: 'restore_wizard', title: 'An abandoned tower',
    body: 'The fire is cold. The shelves are bare. A note waits where the wizard used to sit.\n\n“' + ABANDONED_NOTE + '”' };
  const EMPTY = { art: 'restore_wizard', title: 'An empty tower',
    body: 'No one answers. The wizard is elsewhere.' };
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
      body: 'A bell rings through smoke. Someone gathers a child against their chest and whispers a name: the Warmonger. You wake from the glimpse with your hands clenched, though you cannot remember what they held.' },
    6: { art: 'kind_memory', title: 'The window behind you',
      body: 'For a moment, the broken windows shine as they once did. In one of them, a still figure seems to be watching you. You turn. There is only an empty frame, and the uneasy sense that someone expected you to notice.' },
    9: { art: 'book_read', title: 'A voice by the old road',
      body: 'You remember a voice beside a shuttered house: “There is a wise man around here, so they say. No one has seen him in years.” The words return more clearly than the face that spoke them. Somewhere, a door is waiting.' },
    12: { art: 'story_wrecks', title: 'What the Warmonger left',
      body: 'A street splits beneath a line of fire. Roofs fall one after another. Someone shouts “Warmonger!” You feel the heat against your face, but cannot tell which side of the flames you are on.' },
    15: { art: 'restore_house', title: 'The table beneath the roof',
      body: 'A family leaves supper untouched as the windows turn white. The roof folds inward. On the far side of the fire, someone stands perfectly still. Even inside the memory, you feel you are being watched.' },
    18: { art: 'kind_memory', title: 'The hand at your shoulder',
      body: 'Flames climb a doorway. A woman pulls a child behind her as a quiet voice says, “Forward.” You try to remember who obeyed. The doorway collapses before you can see.' },
    21: { art: 'story_wrecks', title: 'Beneath the battle',
      body: 'The town lies broken beneath a burning sky. You fall through smoke into the ruins. The pain is too large for the body you have now. Someone orders you to rise. Nothing in you answers.' },
    24: { art: 'revive_wake', title: 'A second beginning',
      body: 'You are being carried away from a battlefield. Your skin feels strange, your hands impossibly small. The voice beside you says, “There is still enough left.” When you reach for its owner, the memory goes dark.' },
    27: { art: 'kind_wizard', title: 'Beyond this ruined land',
      body: 'Maps cover a table: not towns, but skies you do not recognise. A finger passes over them. “Once you are whole again.” You recognise the cadence, but not the face beyond the table.' },
    30: { art: 'kind_memory', title: 'The memory he kept',
      body: 'The quiet voice, the falling roofs, the maps of unfamiliar skies: the fragments refuse to stay apart. One face is still missing. You know where to ask for it. Return to the wizard’s new tower.' },
  };
  const AFTER = [
    { art: 'restore_house', title: 'A memory worth keeping', body: 'A repaired doorway holds its shape when you close your eyes. This time, the memory belongs to the people who will live behind it.' },
    { art: 'trail_intro', title: 'The road you chose', body: 'You remember a road with no one left to walk it. Voices carry along it now. You hold on to their sound.' },
    { art: 'home_sell', title: 'Small things remain', body: 'Warm bread, a familiar doorstep, someone calling you in from the rain. The small things return without anyone telling you which ones matter.' },
  ];
  const INTRO = [
    { art: 'restore_wizard', title: 'Someone has been waiting', body: 'The tower door opens before you knock. “You have brought light back to those houses,” the old man says. “I hoped you would find your way here.”' },
    { art: 'kind_wizard', title: 'A promise of help', body: '“We can restore this land together. But there are things beyond those roads that your present strength cannot face. Let me help you become stronger.”' },
    { art: 'kind_memory', title: 'Come back with memories', body: '“Each memory brings a little of you back. Bring them to me, and I can put that strength within your reach.” His hand closes around yours for a moment. “Come back when you remember more.”' },
  ];
  const FIRST_RETURN = { art: 'kind_wizard', title: 'The right things', body: '“I can help you remember the right things.”\n\n“Memories seldom return in order. If something troubles you, bring it here. We need not leave you alone with it.”' };
  // Milestones unlock at fixed lifetime counts and belong to one tower.
  // A return catches up eligible pages together. The first tower closes at 21;
  // missed first-tower conversations never move into the new location.
  const ACT2 = [
    { id: 'silver_lining', minMemories: 12, tower: 'first', pages: [
      { art: 'kind_wizard', title: 'A silver lining', body: '“Monsters have a silver lining. They make you strong for what’s to come.”\n\nHe notices the damage to your weapon before the tear in your sleeve.' },
    ] },
    { id: 'stronger_hands', minMemories: 15, tower: 'first', pages: [
      { art: 'restore_wizard', title: 'Work for other hands', body: '“The survivors have roofs now. Let them learn to mend their own shutters.”\n\nHis tone softens. “There are things out there that kindness alone cannot stop. That is why we are doing this.”' },
    ] },
    { id: 'right_order', minMemories: 15, tower: 'first', pages: [
      { art: 'story_wrecks', title: 'The burning street', body: '“Close your eyes. Tell me about the street.”\n\nA woman reaches from a doorway. You remember her mouth opening, her child pulled behind her. You cannot remember what she said.' },
      { art: 'kind_memory', title: 'In the right order', body: '“You arrived before the flames,” he says. “They were calling for help.”\n\nHe asks you to picture it again. This time, her raised hand seems to welcome you. The child is harder to see.' },
    ] },
    { id: 'useful_memories', minMemories: 18, tower: 'first', pages: [
      { art: 'kind_wizard', title: 'What remains useful', body: '“Do not strain after every face. Remember the weight in your hands. The moment your enemy gave way.”\n\nYou try to return to the doorway. His fingers tighten around your wrist. “Stay with the victory.”' },
    ] },
    { id: 'hesitation', minMemories: 18, tower: 'first', pages: [
      { art: 'wizard_cold', title: 'An old habit', body: '“When I tell you to move, move. Doubt can cost us everything.”\n\nYour body starts to rise before you decide to stand. He smiles. “Some good habits survive even this.”' },
    ] },
    { id: 'little_lives', minMemories: 24, tower: 'second', pages: [
      { art: 'wizard_cold', title: 'Their little lives', body: '“They will ask for another roof, another basket, another day. Their little lives will take all of yours if you allow it.”\n\nHe pushes a chair into place for you. “Sit. We have more important work.”' },
    ] },
    { id: 'what_comes_next', minMemories: 27, tower: 'second', pages: [
      { art: 'wizard_map', title: 'What comes next', body: 'A map lies open beneath his hand. You recognise none of its coastlines.\n\n“When I have you back—” He pauses. “When you have your strength back, this land will seem very small.”' },
    ] },
  ];
  // These fragments contradict a version the player actually heard him give.
  // Before that visit, the original fragments remain ambiguous and complete.
  const ACT2_MEMORIES = {
    18: { requires: 'right_order', art: 'memory_doorway', title: 'The hand in the doorway', body: 'The wizard said she was welcoming you. Now the burning doorway returns. Her hand is braced against the door. The roof gives way before she can close it.' },
    21: { requires: 'useful_memories', art: 'kind_memory', title: 'The word beneath the word', body: 'You reach for the victory he told you to remember. Through the burning roofs, a voice breaks through: “Please.” The whole street falls silent. This is not how he told it.' },
    24: { requires: 'hesitation', art: 'memory_grip', title: 'An older grip', body: 'He called it a good habit. You remember the same grip beside a battlefield, your hand turning when his did. You try to remember what you wanted. Nothing comes.' },
    27: { requires: 'little_lives', art: 'wizard_map', title: 'A mark on a map', body: '“Their little lives.” You remember those words above a map of unfamiliar shores. A tiny mark stands for a whole town. His finger covers it. The people vanish beneath it.' },
  };
  // A repeat visit holds the current voice instead of advancing or cycling
  // back to an earlier, kinder wizard. These pages never grant an upgrade.
  const VISITS = [
    '“Go where the land is unfamiliar. Bring back what returns to you. We will make sense of it together.”',
    '“Notice what you can face now that once frightened you. That is the work beginning to show.”',
    '“The village can spare you for a while. There are still parts of yourself waiting beyond it.”',
    '“Do not worry if the details shift. A wounded mind often resists the simplest explanation.”',
    '“Hold on to what made you strong. The rest will only distract you.”',
    '“You were quicker to trust me once. It will come back.”',
    '“They have enough of you for now. Let us finish what we began.”',
    '“Almost. There is very little left between you and what you were.”',
  ];
  const SURVIVORS = [
    'The children have been practising how to thank you. Come by before supper, or they will have to start again tomorrow.',
    'You look tired. There is bread on the table. It is only bread, but you do not have to earn it.',
    'You need not fix anything today. Sit with us a while. We saved you a place.',
    'Whatever you have remembered, you are the one who opened our door again. It is still open to you.',
  ];
  const DRAGON_DECLARATION = 'I am a dragon, and so are you. We are the alpha species of the stars, and this planet is mine. You are my sword, nearly restored. Collect your fire breath on level 9 of the dungeon from the demons there.';
  const REVEAL = [
    { art: 'wizard_dragon', title: 'The shape behind the mask', body: 'The old man stays seated. His voice loses its warmth. “This shape is all I have left,” he says. “Do not mistake it for what I am.”\n\nThe fire above the ruined town returns to you. It left your own throat. The Warmonger was you.' },
    { art: 'wizard_dragon', title: 'His planet', body: '“' + DRAGON_DECLARATION + '”' },
    { art: 'cave_first', title: 'Act III · The fire below', body: 'You burned this world at his command. Your dragon form and your memory were taken from you. He has been choosing what to give back.\n\nYour fire waits below. What you do with it need not be his choice.' },
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
      body: `A glimpse of a memory comes back as you find ${record.label}.` };
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
        ? '“Your fire has returned. You begin to resemble yourself.” His gaze moves past you, toward the distant stars.'
        : '“Level nine. The demons have kept your fire long enough.”' }];
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
