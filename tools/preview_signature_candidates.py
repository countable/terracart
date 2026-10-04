"""Existing signature art and interactions, separate from unimplemented art ideas.

Art resolves through preview_zone_variants.material_art. Interaction descriptions
are audited against interact.js, interactables.js, sprite_layout.js and
enemy_roster.js; they describe existing behavior, not proposed habitat ownership.
"""


def signature_candidate(slot, terrain):
    """Return the shipping candidate's art and mechanic, or None for new art."""
    if slot.get('artProposal'):
        return None
    candidate = slot['proposedThing']['id']
    shiny = candidate.endswith(':shiny')
    parts = candidate.split(':')
    family, kind = parts[:2]
    result = {}

    if family == 'creature':
        mechanics = {
            'butterfly': 'Catch with a net. A released butterfly pollinates nearby crops.',
            'cow': 'Catch with a net or favorite food; feed plant produce for milk.',
            'horse': 'Catch with a net or favorite food, then use the horse from inventory as a mount.',
            'sea_turtle': 'Catch with a net or favorite food, then release it as a tame animal.',
            'raven': 'A coin thief that swoops at the player. Fight it before it steals a coin and flies away.',
            'cat': 'Catch or tame it; a tame cat follows the player and hunts crop-raiding crows.',
            'deer': 'Hunt for meat. Deer raid crops and charge back when hunted; scarecrows repel them.',
            'crow': 'Hunt for a feather, or keep it away from crops with a scarecrow or tame cat.',
            'rabbit': 'Catch with a net or favorite food, then release it as a tame animal.',
            'golden_slime': 'Fight an orbiting enemy while avoiding the damaging trail it leaves behind.',
            'metal_slime': 'Chase and defeat a fleeing, non-attacking slime for a large coin bounty.',
            'bat': 'Fight a flying cave enemy for its combat rewards.',
            'fire_elemental': 'Fight a pursuing cave enemy whose attacks inflict burning; it is immune to lava.',
        }
        result = {'material': {'kind': kind}, 'mechanic': mechanics[kind]}
    elif family == 'wildplant':
        mechanics = {
            'nut': 'Pick the nut; eat it for energy or use it as animal food.',
            'starflower': 'Pick the flower to keep or sell.',
            'shell': 'Pick up the shell instantly to keep or sell.',
            'driftwood': 'Pick it up to receive wood.',
            'marigold': 'Pick the flower to keep or sell.',
            'forgetmenot': 'Pick the flower to keep or sell.',
            'rainberry': 'Harvest and eat it for energy; eating one also waters nearby crops.',
            'longgrass': 'Harvest long grass; cutting it has a small chance to reveal a coin.',
            'mushroom': 'Pick the mushroom for food. It also acts as a small light while growing.',
        }
        result = {'material': {'kind': 'wildplant', 'crop': kind}, 'mechanic': mechanics[kind]}
        if kind == 'mushroom' and terrain == 'CAVE_FLOOR':
            result = {'art': {'sheet': 'props', 'frames': [127]},
                      'mechanic': mechanics[kind],
                      'note': 'Existing blue cave art; picking it gives the same Mushroom item as surface mushrooms.'}
    elif family == 'tree':
        result = {'material': {'kind': 'tree', 'species': kind, 'size': 'medium'},
                  'mechanic': 'Chop with an axe for wood; tree size and tool quality determine the work required.'}
    elif family == 'fruittree':
        label = {'apple': 'apples', 'worldpeach': 'worldpeaches'}[kind]
        result = {'material': {'kind': 'fruittree', 'species': kind},
                  'mechanic': f'Harvest 1–2 {label} without spending energy; the tree fruits again after 24 hours.'}
    elif family == 'mineralrock':
        # MINERAL_TIERS in items.js; material_art reads the live frame table.
        tier = {'plain': 1, 'copper': 2, 'iron': 3, 'gold': 4, 'platinum': 5, 'crimson': 6, 'frost': 7}[kind]
        mechanic = ('Mine for stone rubble, with a chance of bonus finds.' if tier == 1 else
                    f'Mine for a {kind} bar and flint; better picks reduce the work and energy required.')
        result = {'material': {'kind': 'mineralrock', 'yieldTier': tier}, 'mechanic': mechanic}
    elif family == 'barrel':
        style = {'clay_pot': 'clay_pot', 'ordinary': 'barrel'}[kind]
        result = {'material': {'kind': 'chest', 'barrelStyle': style},
                  'mechanic': 'Smash once to collect its loot; the broken container does not restock.'}
    elif family == 'item' and kind == 'goldenfish':
        # This inventory asset is registered in app.js, outside ASSETS.
        result = {'art': {'sheet': 'icon_goldenfish', 'frames': [0]},
                  'mechanic': 'Catch by fishing at a valid water spot; a shiny catch gives bonus coins and a memory.',
                  'note': 'A fishing result, not an object placed on the pier.'}
    else:
        raise ValueError(f'No existing signature preview for {candidate} in {terrain}')

    if shiny:
        suffix = 'Shiny sparkle variant of the same base art; not a recolor.'
        result['note'] = (result.get('note', '') + ' ' + suffix).strip()
        if family == 'creature':
            result['mechanic'] += ' A shiny catch also gives bonus coins and a memory.'
    return result
