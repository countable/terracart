# Neighbour art

`Citizen_woman0{1,2,3}` are the original citizen sheets: the story neighbours
by the trailer wear them untinted (Tilly at child scale), and any role without
a sheet of its own falls back to them in its zone's tint. `Orrin_old_man` is
PixelSerial's Old Man, seated by `tools/art/import_orrin.py`; it is Orrin's
alone. `Ayo_human` is `Citizen_woman03` with white hair and slate cloth, baked
by `tools/art/import_ayo_human.py`; it stands in for the reserved pack art below.

Every other `<role>_idle.png` / `<role>_walk.png` pair is one neighbour
role's look, made by `tools/art/import_npc_art.py` from licensed packs kept
outside the repo (`unused_art/`). The script seats the frames in the game's
48px cells (rows front, back, left, right; four columns) and bakes the
citizen-palette recolour from `tools/npc-recolour.js`. `SpriteLayout.NPC_SHEETS`
maps each sheet to its role and zones. Rerun the script rather than editing
these files by hand.

| Pack | Used for | Licence |
| --- | --- | --- |
| PixelSerial, RPG Top Down Characters | Orrin, Wayfinder, Peddler, Barterer, Mason, Fieldwalker, Ranger, Shrine Warden | `PixelSerial-LICENSE.txt` |
| Super Retro World Character Pack, by Gif (@gif_not_jif), Noiracide (@Noiracide) and Romi (@DessRomaric) | The other village, farm, market, woodland and shrine roles | `SuperRetroWorld-LICENCE.txt`; credit required |
| Foxi Characters, by TuneIn | The fox people of the grove | Commercial use allowed; no redistribution of the pack |

## Reserved for characters not yet in the game

Chosen in the NPC review (Oct 2026); keep these sources for them.

- Tim: Super Retro World #25 (character_25-32, first block), reds recoloured to
  the restored tower's violet. Alternatives: #20 recoloured violet, #3.
- Ayo, in human form: Super Retro World #2. Until it is imported she wears
  `Ayo_human` (a recolour of `Citizen_woman03`; see above).
- Dragon hunters: MiniWorldSprites `SwordsmanPurple`, the player's calling rig
  in Tim's violet.
