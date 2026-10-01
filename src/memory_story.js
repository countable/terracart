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
  // THE WARDEN'S FIRST WORDS, ON A TAP. This page is what the safe area's
  // warden says the first time the player talks to her, whenever she arrives
  // (npcDialogue below; save.memoryStory.wardenMet). It
  // used to be pushed onto the pending queue by the warden's own seating and
  // splashed over the map on the first morning; it never is now (Sep 2026,
  // owner's call): the player walks up to the one neighbour on screen and
  // taps them. drain() drops a queued 'home' record from an older save.
  // NEIGHBOUR COPY (CLAUDE.md, Dialogs): spoken words in curly quotes, an
  // action in <em> on its own line, the body HTML; a talk that needs two
  // panels is an ARRAY of pages (NPC.dialogue shows them with "Next"). The
  // vocabulary is the story bible's (docs/story.txt): the Breaking, fifty
  // years, Mending Lane, the wizard the old folk call Tim. The hood is
  // looked at and never asked about twice.
  const HOME = {
    title: 'A neighbour at the gate', art: 'revive_found',
    body: '<em>Looks at your hood, then past it, down the lane.</em>\n“Nobody comes to Mending Lane any more, stranger.”\n<em>Holds up a key.</em>\n“My children still ask when we can go home. I kept this, though there is hardly a door left for it.”',
  };
  // The second page of the warden's first talk — the safe area, after the
  // plea. NPC.WARDEN_LINE is the one owner of the safe-area sentence.
  const wardenWelcome = () => '“Mend one house and we come back. We still have hands.”\n<em>Nods at the quiet grass round the trailer.</em>\n' + NPC.WARDEN_LINE;
  const FIRST_ROOF = '<em>Eyes red, and not hiding it.</em>\n“Lamplight, in a window that was dark fifty years. My children saw it first. We can begin again.”';
  const RUMOUR = '<em>Lowers their voice.</em>\n“They say a wise man lives somewhere round here. Old Tim, the elders call him. Nobody I know has seen him.”\n“You walk these roads like you have walked them before. Perhaps he knows why.”';
  // THE STORY NEIGHBOURS by the starting trailer (NPC.STORY_ROLES; Starter
  // placeSafeAreaWarden seats them). Each keeps to one thread of the story
  // and moves with the act, never ahead of it: the survivor knows the
  // Warmonger only as the night the roofs went, the believer never learns
  // what the player learns at the second tower — the irony is the player's.
  const NEIGHBOURS = {
    // The survivor is the ELDER of the bible: in act 2 they are the one who
    // notices the Hood has not aged — foreshadowing, never the secret.
    witness: {
      1: ['<em>Stares at the wrecks rather than at you.</em>\n“Nobody heard an army. A bell, then smoke, then no roofs anywhere. The Breaking, we call it.”\n“They call what did it the Warmonger. I never saw its face.”'],
      2: ['“Every roof in one night, fifty years back. You put them back one at a time.”\n<em>Almost smiles.</em>\n“That is the only answer to the Warmonger I have ever heard.”',
        '<em>Squints at you.</em>\n“I have known this lane since the first years after. You have not changed a day in it. Odd, that.”'],
      3: ['“Some nights I think it is still out there.”\n<em>Watches a mended window glow.</em>\n“Then I see that, and I stop.”'],
    },
    // The wanderer is a CHILD (NPC.STORY_ROLES — drawn at CHILD_SCALE): short
    // sentences, one thing at a time, a door remembered before a house.
    wanderer: {
      homeless: '<em>The child looks up at your hood, then quickly away.</em>\n“We sleep under whichever wall is driest.”\n“I had a room once. My name was on the door. Now there is only the door.”',
      housed: '<em>Runs up, out of breath.</em>\n“Did you see? A roof! A real one, with a lamp under it.”\n“I slept inside last night. Rain sounds different on a roof. I forgot that.”',
      settled: '“I have a bed now, and a window.”\n<em>Tugs the edge of your hood, then lets go.</em>\n“Is it warm under there? Mum says not to ask.”\n“Knock when you go past. There is always something in the pot.”',
    },
    believer: {
      ruin: '<em>Hands clasped.</em>\n“Before the Breaking a wise wizard watched over this land. Tim, the old folk called him. His tower fell with the rest.”\n“Mend enough wrecks and you will find it. Raise it, and he will come back for us. I know it.”',
      locked: '<em>Points down the lane, beaming.</em>\n“His tower stands again! The door will not open for me. He is in there. He will come out when the time is right.”',
      open: '“You have spoken with him?”\n<em>Touches your sleeve.</em>\n“Then there is hope for all of us. He never turned anyone away.”\n<em>A pause.</em>\n“Did he ask after us? No. He would be busy.”',
      abandoned: '<em>Has not slept.</em>\n“The tower is cold again. He has not left us. A wise man does not leave. He goes ahead.”',
      moved: '“They say he keeps a new tower now, out among the wrecks.”\n<em>Presses a candle stub into your hand, then takes it back.</em>\n“Tell him we still light one for him. Every night.”',
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
    '<em>Children’s voices carry from a mended house.</em>\n“They have been practising how to thank you. Come by before supper, or they start again tomorrow.”',
    '<em>Looks at the shadow under your hood.</em>\n“You look tired. There is bread on the table. It is only bread. You do not have to earn it.”',
    '“Fix nothing today.”\n<em>Moves along the bench.</em>\n“Sit a while. We saved you a place.”',
    '<em>Does not ask what you saw at the tower.</em>\n“Whatever you remembered up there, you are the one who opened our door. It is still open.”',
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
  // Orrin remembers acknowledged conversations, never taps or modal reads.
  // No affection score: questions and disagreement count as time spent together.
  const ARCHAEOLOGIST_TOPICS = {
    introduction: {
      title: 'A stool at the dig',
      body: 'Orrin. Dragon archaeologist. Mind the little stool; it has already defeated me twice. Oh—my satchel. The potsherds are all right, are they? Good. My knee can wait. People call me a crackpot, but you are welcome to sit.',
      choices: [
        { id: 'listen', label: 'Take a seat.', response: 'Thank you. Most people have somewhere else to be before I finish my name. There is a pencil somewhere—no, never mind. We can talk without one.' },
        { id: 'doubt', label: 'A dragon archaeologist?', response: 'An unlikely occupation, I know. I brush dirt off old things and try not to break them further. You need not find me convincing to share the stool.' },
        { id: 'help', label: 'Help free the satchel.', response: 'That buckle again. Thank you for rescuing the archaeologist before the archaeology. I shall remember which came first.' },
      ],
    },
    mending: {
      title: 'A place among the papers',
      body: 'You have been putting houses back together. I noticed. I cleared you a seat among the papers; the papers have returned, but that is easily fixed. How are your hands holding up?',
      choices: [
        { id: 'listen', label: 'Sit with him a while.', response: 'There. No work required of you here. I can move my own papers, though it may take me several attempts.' },
        { id: 'doubt', label: 'There is still so much broken.', response: 'Yes. A repaired roof does not make the rest disappear. It does give someone a dry place from which to look at it. That matters too.' },
        { id: 'tired', label: 'Your hands are tired.', response: 'Then leave them in your lap. I was about to ask you to hold something, and I am glad you told me before I did.' },
      ],
    },
    labels: {
      title: 'The wrong bag',
      body: 'You have caught me labelling my lunch as pottery. The pottery has the lunch label, which explains a disappointing moment earlier. Would you hold these two bags apart while I put matters right?',
      choices: [
        { id: 'listen', label: 'Help sort the labels.', response: 'Much better. Thank you for staying. I usually discover this sort of thing alone, and then have nobody to tell but the pots.' },
        { id: 'doubt', label: 'How do you keep the finds straight?', response: 'Fair question. Every find has a drawing and a place marked in the notebook as well as its label. The notebook is more reliable than my lunch.' },
      ],
    },
    odd_remark: {
      title: 'An unlikely opinion',
      body: 'I do not think dragons wake up wanting to be horrible. Mind you, I have never been there when one woke up. Ah, my pencil! Behind my ear. I was blaming the stool.',
      choices: [
        { id: 'listen', label: 'Let him finish.', response: 'That was the whole thought, I am afraid. Thank you for letting it get to the end anyway.' },
        { id: 'doubt', label: 'That is not much to go on.', response: 'No, it is not. You are allowed to say so. I would rather you stayed and asked than nodded on your way out.' },
      ],
    },
    peaceful_lives: {
      title: 'The small figures',
      body: 'I saved this drawing for you. See the little shapes beside the large one? I think they are young dragons being sheltered, though that broken edge makes it uncertain. Everyone looks for weapons in these carvings. I keep finding what might be ordinary lives.',
      choices: [
        { id: 'listen', label: 'Look at the drawing.', response: 'This hollow might be a nest. Might be: I have written that twice now. I want dragons to have lived peacefully, but wanting is not another piece of evidence.' },
        { id: 'doubt', label: 'Could they be something else?', response: 'They could. Stones, perhaps, or something the missing piece would explain. I shall keep your question beside the drawing instead of hiding the broken edge.' },
        { id: 'contradict', label: 'Parents can be cruel too.', response: 'Quite right. A creature can care for its own and hurt someone else. This is a reason to look closer, not a pardon for every dragon.' },
      ],
    },
    hunting_accounts: {
      title: 'Before the first weapon',
      body: 'Most of these old accounts begin with someone going out to kill a dragon. I keep wondering what the dragon was doing before that. A few mention stolen eggs or a home entered by hunters; I suspect that explains some attacks, though it cannot explain every one.',
      choices: [
        { id: 'listen', label: 'What do the accounts omit?', response: 'The dragon’s ordinary day, usually. And sometimes the people who were hurt. Both omissions matter; I must not replace one with the other.' },
        { id: 'doubt', label: 'An old account could be wrong.', response: 'Certainly. A hunter can boast, a witness can misremember, and an archaeologist can prefer a comfortable answer. We should compare what they actually saw.' },
        { id: 'contradict', label: 'It does not excuse harm.', response: 'No. Tell me who was hurt before I start explaining a creature’s reasons. Understanding an attack does not undo it.' },
      ],
    },
    other_planets: {
      title: 'Different skies',
      body: 'These star charts and inscriptions seem to describe other planets. I have never been to any of them; some of the translations disagree. Still, beneath different skies I keep finding drawings of little hollows for eggs. They seem to have spent a great deal of time making homes.',
      choices: [
        { id: 'listen', label: 'Ask about the charts.', response: 'This mark may describe a journey, or a season. I had called it a conquest in an older note. I have crossed that out until I know more.' },
        { id: 'doubt', label: 'Are they really planets?', response: 'I cannot be entirely sure. The charts and the repeated words support it, but I should show you the uncertain translation alongside the tidy one.' },
        { id: 'contradict', label: 'Homes and wars can coexist.', response: 'They can. That is worth keeping beside the drawing. A home is evidence of a home, not proof of an innocent life.' },
      ],
    },
    frost_queen: {
      title: 'A disputed history',
      body: 'The name here is Tiamat. These pieces describe his war against the Frost Dragon Queen, his wife, who later accounts call his late wife. They tell me those things, but not why the war began, how she died, or how to make sense of it.',
      choices: [
        { id: 'listen', label: 'Ask what else the pieces say.', response: 'Less than I wish. I have put the conflicting accounts side by side. A queen’s title is not enough to identify every white dragon in a later story.' },
        { id: 'doubt', label: 'Could the accounts be mistaken?', response: 'Some may be. The marriage and the war recur in more than one account; the reasons do not agree. I will not mend that gap by making up a family.' },
        { id: 'contradict', label: 'Dragons chose to make that war.', response: 'Yes. Peace can be possible without being chosen. I must keep that distinction, even when it spoils the answer I wanted.' },
      ],
    },
    breaking_belief: {
      title: 'What he wants to be true',
      body: 'I do not believe dragons destroyed this world as people say they did. That is my belief, not something these fragments prove. I know it hurts people to hear it, and I must listen when they tell me what they lost.',
      choices: [
        { id: 'listen', label: 'Listen without agreeing.', response: 'You have let me finish without promising I am right. I appreciate that more than I have managed to say. If you learn something that does not fit, there is room for it here.' },
        { id: 'doubt', label: 'You want them to be innocent.', response: 'I do. Everyone seems to want them dead, and I have leaned too far the other way. Wanting innocence is not the same as looking at what happened.' },
        { id: 'contradict', label: 'Believe survivors too.', response: 'They do. Their losses are not mistakes in my theory. I can question a conclusion without questioning whether someone’s home burned.' },
      ],
    },
  };
  function archaeologistState(save) {
    const value = save?.memoryStory?.archaeologist;
    const s = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      ...s,
      visits: Number.isSafeInteger(s.visits) && s.visits >= 0 ? s.visits : 0,
      seen: s.seen && typeof s.seen === 'object' && !Array.isArray(s.seen) ? { ...s.seen } : {},
      lastMemories: Number.isFinite(s.lastMemories) ? s.lastMemories : 0,
      lastRestored: Number.isFinite(s.lastRestored) ? s.lastRestored : 0,
    };
  }
  function archaeologistConversation(save) {
    const s = archaeologistState(save);
    const restored = Object.keys(save?.restoredHouses || {}).length;
    // A high ledger alone does not mean the player ever met the wizard.
    // act3Started also supports old saves which completed the reveal before
    // the runtime enforced the first introduction; revealed alone does not.
    const research = save?.memoryStory?.introDone === true || save?.memoryStory?.act3Started === true;
    let topic;
    if (!s.seen.introduction) topic = 'introduction';
    else if (restored > 0 && !s.seen.mending) topic = 'mending';
    else if (research) topic = ['peaceful_lives', 'hunting_accounts', 'other_planets', 'frost_queen', 'breaking_belief']
      .find(id => !s.seen[id]);
    else topic = ['labels', 'odd_remark'].find(id => !s.seen[id]);
    let entry = topic && ARCHAEOLOGIST_TOPICS[topic];
    if (topic === 'other_planets' && ['doubt', 'contradict'].includes(s.seen.peaceful_lives?.choice)) {
      entry = { ...entry, body: 'I kept your question beside the first drawing. It helped me leave the uncertain parts of this one visible. ' + entry.body };
    }
    if (!entry) {
      topic = 'familiar';
      const welcome = restored > s.lastRestored
        ? 'Another roof has come back since you were here. I noticed before I noticed that I was wearing my satchel inside out. There is a place for you beside the papers.'
        : total(save) > s.lastMemories
          ? 'You have found something new since we last sat together. You need not bring me every discovery; I would like to know how you are, too.'
          : [
            'I kept your place clear. Well, nearly clear. How are your hands? You may leave them quite idle while we talk.',
            'There you are. I found the pencil, lost the label, and remembered that you might visit. Two successes out of three.',
            'You have a little dust caught on your hood. I would offer my clean cloth, but I appear to have used it for wrapping stones. Sit a while anyway.',
          ][s.visits % 3];
      entry = { title: 'A familiar visitor', body: welcome, choices: [
        { id: 'listen', label: 'Stay a little while.', response: 'I am glad you came. We need not solve anything before you go.' },
        { id: 'doubt', label: 'You still have questions.', response: 'Good. I have space in the notebook, and you have a seat even when we disagree.' },
        { id: 'tired', label: 'You could use a rest.', response: 'Then rest. The stones have waited a long time already; they can manage without either of us for a while.' },
      ] };
    }
    // Include the current visit revision: an old modal cannot acknowledge a
    // later repeat or advance twice. Copy choices so UI cannot change canon.
    return { id: `orrin:${s.visits}:${topic}`, topic, title: entry.title, body: entry.body,
      choices: entry.choices.map(({ id, label }) => ({ id, label })) };
  }
  function acknowledgeArchaeologist(save, id, choiceId) {
    if (!save || typeof save !== 'object' || Array.isArray(save)) return null;
    const conversation = archaeologistConversation(save);
    if (conversation.id !== id || !conversation.choices.some(choice => choice.id === choiceId)) return null;
    const s = archaeologistState(save), topic = conversation.topic;
    const response = ARCHAEOLOGIST_TOPICS[topic]?.choices.find(choice => choice.id === choiceId)?.response
      || ({ listen: 'I am glad you came. We need not solve anything before you go.',
        doubt: 'Good. I have space in the notebook, and you have a seat even when we disagree.',
        tired: 'Then rest. The stones have waited a long time already; they can manage without either of us for a while.' })[choiceId];
    s.seen[topic] = { choice: choiceId, visit: s.visits + 1 };
    s.visits++;
    s.lastChoice = choiceId;
    s.lastMemories = total(save);
    s.lastRestored = Object.keys(save.restoredHouses || {}).length;
    if (!save.memoryStory || typeof save.memoryStory !== 'object' || Array.isArray(save.memoryStory)) save.memoryStory = {};
    save.memoryStory.archaeologist = s;
    return { body: response, conversationId: id, choiceId };
  }

  function npcDialogue(scene, c) {
    if (c.role === 'archaeologist') return archaeologistConversation(scene.save).body;
    if (c.role === 'warden') {
      const repaired = Object.keys(scene.save.restoredHouses || {}).length;
      // Bryn arrives at three memories, usually after the first roof, so her
      // opening is keyed to meeting her, not to an unmended lane.
      const s = state(scene.save);
      if (!s.wardenMet) {
        s.wardenMet = true;
        if (typeof persistSave === 'function') persistSave(scene.save);
        return [HOME.body, wardenWelcome()];
      }
      if (!repaired) return wardenWelcome();
      if (total(scene.save) >= 9 && act(scene.save) === 1) return RUMOUR;
      if (act(scene.save) >= 2) return survivorLine(scene.save);
      return FIRST_ROOF + (archaeologistState(scene.save).seen.introduction
        ? '\n\n“Orrin means well. Most of us call him a crackpot; I worry someone will trust his dragon talk and get hurt.”' : '');
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
    HOME, FIRST_ROOF, RUMOUR, NEIGHBOURS, SCENES, AFTER, INTRO, FIRST_RETURN, ACT2, ACT2_MEMORIES, SURVIVORS, VISITS, REVEAL, DRAGON_DECLARATION,
    state, total, enqueue, panel, drain, npcDialogue, wandererLine, believerLine, survivorLine, act, towerAccess, objective,
    eligibleBeats, wizardSequence, pagesFor, visitWizard, archaeologistConversation, acknowledgeArchaeologist };
})();
