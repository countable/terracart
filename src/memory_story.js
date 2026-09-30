// The recovered past follows the lifetime discovery ledger, never the purse.
// Pending pages live in the save and are acknowledged, not consumed on open.
// All paintings are existing game assets; the truth stays at the tower until
// memory 30. A return visit, not a purchase, advances the wizard's voice.
const MemoryStory = (() => {
  const HOME = {
    title: 'A neighbour at the gate', art: 'revive_found',
    body: 'My children still ask when we can go home. I kept the key, though there is hardly a door left. If you can mend these houses, we can come back. We still have hands to help.',
  };
  const RUMOUR = 'They say a wise man lives somewhere around here. Nobody I know has seen him. Perhaps he knows why the old roads feel so familiar to you.';
  const SCENES = {
    3: { art: 'story_wrecks', title: 'The name in the smoke',
      body: 'A bell rings through smoke. Someone gathers a child against their chest and whispers a name: the Warmonger. You wake from the glimpse with your hands clenched, though you cannot remember what they held.' },
    6: { art: 'kind_memory', title: 'The window behind you',
      body: 'For a moment, the broken windows shine as they once did. In one of them, a still figure seems to be watching you. You turn. There is only an empty frame, and the uneasy sense that someone expected you to notice.' },
    9: { art: 'book_read', title: 'A voice by the old road',
      body: 'You remember a voice beside a shuttered house: “There is a wise man around here, so they say. No one has seen him in years.” The words return more clearly than the face that spoke them. Somewhere, a door is waiting.' },
    12: { art: 'story_wrecks', title: 'What the Warmonger left',
      body: 'Roofs fall in a line of fire. The people below call the thing above them the Warmonger, but smoke hides its shape. A quiet voice gives an order. You feel the need to obey before the memory breaks.' },
    15: { art: 'restore_house', title: 'A place at the table',
      body: 'A small table stands in a house with its roof still whole. Someone has left a place for you. When you try to remember their face, the picture slips away. Behind you, a latch clicks. You are certain you were being watched.' },
    18: { art: 'kind_memory', title: 'The hand at your shoulder',
      body: 'A hand rests on your shoulder. “Not that part,” a familiar voice murmurs. A doorway full of frightened people fades, replaced by the bright feeling of victory. You cannot tell which picture was yours.' },
    21: { art: 'story_wrecks', title: 'Beneath the battle',
      body: 'The ground rises to meet you. Bells, broken stone, and a pain too large for the body you have now. Someone calls for you to get up. They sound less frightened for you than for what they are about to lose.' },
    24: { art: 'revive_wake', title: 'A second beginning',
      body: 'You are being carried away from a battlefield. Your skin feels strange, your hands impossibly small. The voice beside you says, “There is still enough left.” When you reach for its owner, the memory goes dark.' },
    27: { art: 'kind_wizard', title: 'Beyond this ruined land',
      body: 'Maps cover a table: not towns, but skies you do not recognise. A finger passes over them. “Once you are whole again.” You recognise the cadence, but not the face beyond the table.' },
    30: { art: 'kind_memory', title: 'The memory he kept',
      body: 'The quiet voice, the falling roofs, the maps of unfamiliar skies: the fragments refuse to stay apart. One face is still missing. You know where to ask for it. Return to the wizard.' },
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
  // One new beat per return with a fresh discovery, never per shop click.
  // Thresholds use lifetime memories; a completed beat cannot be bought twice
  // or rewound by spending. Late tower arrivals may reach the reveal sooner.
  const ACT2 = [
    { id: 'silver_lining', minMemories: 0, pages: [
      { art: 'kind_wizard', title: 'A silver lining', body: '“Monsters have a silver lining. They make you strong for what’s to come.”\n\nHe notices the damage to your weapon before the tear in your sleeve.' },
    ] },
    { id: 'stronger_hands', minMemories: 12, pages: [
      { art: 'restore_wizard', title: 'Work for other hands', body: '“The survivors have roofs now. Let them learn to mend their own shutters.”\n\nHis tone softens. “There are things out there that kindness alone cannot stop. That is why we are doing this.”' },
    ] },
    { id: 'right_order', minMemories: 15, pages: [
      { art: 'story_wrecks', title: 'The burning street', body: '“Close your eyes. Tell me about the street.”\n\nA woman reaches from a doorway. You remember her mouth opening, her child pulled behind her. You cannot remember what she said.' },
      { art: 'kind_memory', title: 'In the right order', body: '“You arrived before the flames,” he says. “They were calling for help.”\n\nHe asks you to picture it again. This time, her raised hand seems to welcome you. The child is harder to see.' },
    ] },
    { id: 'useful_memories', minMemories: 18, pages: [
      { art: 'kind_wizard', title: 'What remains useful', body: '“Do not strain after every face. Remember the weight in your hands. The moment your enemy gave way.”\n\nYou try to return to the doorway. His fingers tighten around your wrist. “Stay with the victory.”' },
    ] },
    { id: 'hesitation', minMemories: 21, pages: [
      { art: 'kind_wizard', title: 'An old habit', body: '“When I tell you to move, move. Doubt can cost us everything.”\n\nYour body starts to rise before you decide to stand. He smiles. “Some good habits survive even this.”' },
    ] },
    { id: 'little_lives', minMemories: 24, pages: [
      { art: 'restore_wizard', title: 'Their little lives', body: '“They will ask for another roof, another basket, another day. Their little lives will take all of yours if you allow it.”\n\nHe pushes a chair into place for you. “Sit. We have more important work.”' },
    ] },
    { id: 'what_comes_next', minMemories: 27, pages: [
      { art: 'kind_wizard', title: 'What comes next', body: 'A map lies open beneath his hand. You recognise none of its coastlines.\n\n“When I have you back—” He pauses. “When you have your strength back, this land will seem very small.”' },
    ] },
  ];
  // These fragments contradict a version the player actually heard him give.
  // Before that visit, the original fragments remain ambiguous and complete.
  const ACT2_MEMORIES = {
    18: { requires: 'right_order', art: 'story_wrecks', title: 'The hand in the doorway', body: 'The wizard said she was welcoming you. Now the doorway returns. Her hand is not raised in greeting. It is braced against the door, trying to keep something out.' },
    21: { requires: 'useful_memories', art: 'kind_memory', title: 'The word beneath the word', body: 'You reach for the victory he told you to remember. A voice breaks through it: “Please.” For an instant you hear who is afraid of whom. Then his calm explanation returns.' },
    24: { requires: 'hesitation', art: 'revive_wake', title: 'An older grip', body: 'He called it a good habit. You remember the same grip beside a battlefield, your hand turning when his did. You try to remember what you wanted. Nothing comes.' },
    27: { requires: 'little_lives', art: 'kind_wizard', title: 'A mark on a map', body: '“Their little lives.” You remember those words above a map of unfamiliar shores. A tiny mark stands for a whole town. His finger covers it. The people vanish beneath it.' },
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
  const REVEAL = [
    { art: 'story_wrecks', title: 'The shape above the roofs', body: 'The wizard reaches for the thirtieth memory, and the missing sky opens inside you. Vast wings blot out the sun. Fire leaves your own throat. The thing the villagers called the Warmonger was a dragon. It was you.' },
    { art: 'kind_wizard', title: 'The voice that gave the order', body: 'The wizard stands beneath those wings, speaking the words that bind your will to his. You burned this world at his command. In the last battle you were nearly killed. Your dragon form broke, and with it went your memory.' },
    { art: 'kind_memory', title: 'What he wanted back', body: 'You see him bending over your smaller body, choosing which memories to return and which to turn aside. He did not want the land restored. He wanted his dragon restored, ready to conquer the other worlds on his maps.\n\nThe wizard draws back his hand. “You were not meant to remember that.”' },
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
    if (n === 30 && save?.memoryStory?.revealed) return { ...AFTER[0], kind: 'memory' };
    if (n > 0 && n % 3 === 0) {
      const alternate = ACT2_MEMORIES[n];
      const curated = alternate && save?.memoryStory?.act2Seen?.includes(alternate.requires) && !save.memoryStory.revealed;
      return { ...((curated && ACT2_MEMORIES[n]) || SCENES[n] || AFTER[(Math.floor(n / 3) - 11) % AFTER.length]), kind: 'memory' };
    }
    return { art: 'discovery_badge', kind: 'memory', title: 'A memory returns',
      body: `A glimpse of a memory comes back as you find ${record.label}.` };
  }
  function enqueueHome(scene, npc) {
    // Existing adventures do not receive a belated first-morning greeting.
    if (total(scene.save) || Object.keys(scene.save.restoredHouses || {}).length) return;
    const s = state(scene.save);
    if (s.homeSeen || s.pending.some(p => p.id === 'home')) return;
    const { id, name, npcVariant, tint } = npc;
    s.pending.unshift({ id: 'home', npc: { id, name, npcVariant, tint, role: 'warden' } });
    persistSave(scene.save);
  }
  function drain(scene) {
    const s = scene.save.memoryStory;
    if (!s?.pending?.length || scene._memoryStoryOpen) return false;
    if (document.body?.classList?.contains('modal-open')) return false;
    const record = s.pending[0];
    let p = record.id === 'home' ? { ...HOME } : panel(record, scene.save);
    if (record.npc && scene.textures && typeof NPC !== 'undefined') {
      p.art = NPC.portrait(scene, record.npc);
      p.title = `${record.npc.name} · Neighbour`;
    }
    scene._memoryStoryOpen = true;
    try {
      scene.showMessageModal({ ...p, mustAcknowledge: true, onDismiss: () => {
        if (s.pending[0] === record) s.pending.shift();
        if (record.id === 'home') s.homeSeen = true;
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
      if (total(scene.save) >= 9 && !scene.save.memoryStory?.introDone) return RUMOUR;
      if (scene.save.memoryStory?.introDone) return survivorLine(scene.save);
      return 'There is lamplight in a house that was dark yesterday. My children saw it first. Thank you. We can begin again.';
    }
    // The fixed ninth scene guarantees the rumour; a neighbour repeats it
    // without replacing every scholar's or trader's ordinary conversation.
    if (c.role === 'scout' && total(scene.save) >= 9 && !scene.save.memoryStory?.introDone) return RUMOUR;
    if (c.role === 'scout' && scene.save.memoryStory?.introDone) return survivorLine(scene.save);
    return null;
  }
  function survivorLine(save) {
    const s = state(save);
    return SURVIVORS[s.revealed ? 3 : Math.min(3, Math.floor(s.act2Seen.length / 2))];
  }
  function wizardSequence(save) {
    const s = state(save);
    if (s.visit) return s.visit;
    const count = s.visits;
    let kind;
    if (!s.introDone) kind = 'intro';
    else if (count === 1) kind = 'return';
    else if (total(save) >= 30 && !s.revealed) kind = 'reveal';
    else {
      const next = ACT2.find(beat => !s.act2Seen.includes(beat.id));
      if (!s.revealed && next && total(save) >= next.minMemories
        && total(save) > (s.act2Memory ?? -1)) {
        return (s.visit = { kind: 'act2', beat: next.id, memory: total(save), page: 0, count });
      }
      kind = 'visit';
    }
    return (s.visit = { kind, page: 0, count, memory: total(save) });
  }
  function pagesFor(save, visit) {
    if (visit.kind === 'intro') return INTRO;
    if (visit.kind === 'reveal') return REVEAL;
    if (visit.kind === 'act2') {
      const beat = ACT2.find(row => row.id === visit.beat);
      if (beat) return beat.pages;
    }
    if (visit.kind === 'return') {
      // If the first return already has 30 memories, hear his promise and
      // its contradiction in the same visit. Arrival never spends memories.
      return total(save) >= 30 && !state(save).revealed ? [FIRST_RETURN, ...REVEAL] : [FIRST_RETURN];
    }
    if (state(save).revealed) return [{ art: 'kind_wizard', title: 'A silence between you',
      body: '“There is still strength I can give you,” the wizard says. For the first time, he does not tell you what it should be used for.' }];
    return [{ art: 'kind_wizard', title: 'More important work', body: VISITS[Math.min(state(save).act2Seen.length, VISITS.length - 1)] }];
  }
  function visitWizard(scene, offer) {
    if (scene._wizardStoryOpen) return;
    const s = state(scene.save), visit = wizardSequence(scene.save);
    persistSave(scene.save);
    const pages = pagesFor(scene.save, visit);
    const show = () => {
      scene._wizardStoryOpen = true;
      const i = Math.max(0, Math.min(pages.length - 1, Math.floor(visit.page || 0)));
      visit.page = i;
      try { scene.showMessageModal({ ...pages[i], kind: visit.kind === 'reveal' || (visit.kind === 'return' && i > 0) ? 'memory' : 'wizard',
        mustAcknowledge: true, okLabel: i + 1 < pages.length ? 'Next' : 'Continue', onDismiss: () => {
          if (s.visit !== visit || (visit.page || 0) !== i) return;
          visit.page = i + 1;
          if (visit.page < pages.length) { persistSave(scene.save); show(); return; }
          if (visit.kind === 'intro') s.introDone = true;
          if (visit.kind === 'reveal' || (visit.kind === 'return' && pages.length > 1)) s.revealed = true;
          if (visit.kind === 'act2') {
            if (ACT2.some(beat => beat.id === visit.beat) && !s.act2Seen.includes(visit.beat)) s.act2Seen.push(visit.beat);
          }
          if (visit.kind === 'act2' || visit.kind === 'return') s.act2Memory = visit.memory ?? total(scene.save);
          s.visits = visit.count + 1;
          s.visit = null;
          scene._wizardStoryOpen = false;
          persistSave(scene.save);
          offer();
        } }); } catch (error) { scene._wizardStoryOpen = false; throw error; }
    };
    try { show(); } catch (error) { scene._wizardStoryOpen = false; throw error; }
  }
  return { HOME, RUMOUR, SCENES, AFTER, INTRO, FIRST_RETURN, ACT2, ACT2_MEMORIES, SURVIVORS, VISITS, REVEAL,
    state, total, enqueue, panel, enqueueHome, drain, npcDialogue, survivorLine,
    wizardSequence, pagesFor, visitWizard };
})();
