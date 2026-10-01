# Utility icon sources

- `TrapDisarmKit.png`: unchanged `db32_rpg_items/scissors.png` from the local asset library; 16×16 metal cutters with red handles.
- `MagicTrap.png`: exported from `makeSprungTrapTexture` in `src/textures.js`, resized to 16×16 with nearest-neighbor sampling, then blended at 50% with `Lighting.KINDS.magic_trap.colour` while lifting metal highlights 1.65× and preserving dark recesses. Rebuild with `node tools/export_trap_icon.js` (Chromium and playwright-core required). The carried icon shows the jaws; a placed magic trap intentionally remains the existing discreet ground mark and glow.
