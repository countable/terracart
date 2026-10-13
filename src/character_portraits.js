// Transparent 80px portraits, displayed at 128px with crisp pixel edges.
// Sheets are retained as the authored source; dialogs fetch just the
// character's cell, independently of world textures.
const CharacterPortraits = (() => {
  const PET_IDS = Object.freeze([
    'chicken', 'cow', 'cat', 'dog', 'deer', 'rabbit', 'butterfly', 'crab',
    'horse', 'sea_turtle', 'green_dragon', 'slime',
    'baby_cat', 'baby_dog', 'baby_cow', 'baby_green_dragon',
  ]);
  const NPC_IDS = Object.freeze([
    'warden', 'witness', 'wanderer', 'believer', 'archaeologist', 'stranger', 'wanderer_housed', 'wizard',
    'wayfinder', 'peddler', 'barterer', 'storykeeper', 'mason', 'lamplighter', 'fieldwalker', 'seed_seller',
    'harvest_trader', 'barn_raiser', 'market_trader', 'town_guide', 'stonemason', 'ranger', 'forager', 'lorekeeper',
    'shrine_warden', 'shrine_lorekeeper', 'shrine_trader', 'shrine_keeper',
    'fox_tracker', 'fox_storyteller', 'fox_trader', 'den_keeper',
  ]);
  const url = id => `assets/portraits/${id}.png`;
  function pet(kind) {
    const id = String(kind || '').replace(/^shiny_/, '');
    if (PET_IDS.includes(id)) return url(id);
    const adult = id.replace(/^baby_/, '');
    return PET_IDS.includes(adult) ? url(adult) : null;
  }
  function npc(c, { housed = false } = {}) {
    if (!c) return null;
    if (c.role === 'wanderer' && housed) return url('wanderer_housed');
    if (NPC_IDS.includes(c.role) && ['warden', 'witness', 'wanderer', 'believer', 'archaeologist', 'stranger', 'wizard'].includes(c.role)) return url(c.role);
    const sheet = SpriteLayout.npcSheet({ ...c, culture: c.culture || 'village' });
    const id = sheet.idle.replace(/^npc_/, '').replace(/_idle$/, '');
    if (NPC_IDS.includes(id)) return url(id);
    // Unassigned citizen variants retain the matching citizen appearance.
    return url(['believer', 'witness', 'warden'][c.npcVariant] || 'believer');
  }
  return { PET_IDS, NPC_IDS, pet, npc };
})();
if (typeof module !== 'undefined') module.exports = CharacterPortraits;
