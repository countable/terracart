// First companions wait for a clear screen. Queue at acquisition, never when
// starting a catch: failed catches and a full bag have no story to tell.
const PetStories = (() => {
  const BODIES = {
    chicken: 'The chicken settles down with a soft cluck. You have a little company now.',
    cow: 'The cow watches you with patient eyes. For a moment, neither of you needs to hurry.',
    cat: 'The cat brushes against your hand. You feel a soft purr beneath its fur.',
    dog: 'A wagging tail answers your outstretched hand. You are no longer travelling alone.',
    deer: 'The deer holds still beside you. You hardly dare breathe as its fear gives way to trust.',
    rabbit: 'A small nose twitches against your hand. The rabbit settles into the crook of your arm.',
    crow: 'The crow tilts its head and croaks. Its claws curl gently around your wrist.',
    butterfly: 'Delicate wings pause beside you. Even something so small can make the world feel less empty.',
    crab: 'The crab raises a claw, then settles beside you. You choose to take that as a greeting.',
    horse: 'The horse lowers its head to your hand. The road ahead feels a little less lonely.',
    sea_turtle: 'The turtle rests quietly beside you. There is comfort in a companion who takes their time.',
    slime: 'The slime gives a gentle wobble. Whatever was hiding beneath its trembling, it seems to trust you now.',
  };

  function kindFor(id) {
    const item = ITEM_BY_ID[id];
    if (item) return item.kind === 'animal' ? item.base || id : null;
    return id !== 'npc' && !SpriteLayout.isSummoned(id) && SpriteLayout.creatureArt(id) ? id : null;
  }

  function queue(scene, id) {
    const kind = kindFor(id);
    if (!kind || scene.save.storySeen?.['pet:' + kind]) return false;
    const pending = scene.save.petStoriesPending = scene.save.petStoriesPending || [];
    if (pending.includes(kind)) return false;
    pending.push(kind);
    persistSave(scene.save);
    return true;
  }

  function drain(scene) {
    const pending = scene.save.petStoriesPending;
    if (!pending?.length || scene._passingOut) return false;
    // Do not build a portrait while another dialog owns the screen.
    scene._syncModalGate?.();
    if (document.body?.classList?.contains('modal-open')) return false;
    while (pending.length) {
      const kind = pending[0];
      if (!kindFor(kind) || scene.save.storySeen?.['pet:' + kind]) {
        pending.shift();
        persistSave(scene.save);
        continue;
      }
      const name = ITEM_BY_ID[kind]?.name || Combat.monster(kind)?.name
        || kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const bodyKind = SpriteLayout.baseKind(kind);
      const body = BODIES[kind] || BODIES[bodyKind]
        || 'Your new companion settles beside you. You reach out slowly, and it stays.';
      const art = PetStoryArt.forKind(scene, kind);
      if (!art) return false;
      if (!scene._storySplashOnce('pet:' + kind, {
        art, title: 'Your first ' + name.toLowerCase(), body,
      })) return false;
      pending.shift();
      persistSave(scene.save);
      return true;
    }
    return false;
  }

  return { kindFor, queue, drain };
})();
