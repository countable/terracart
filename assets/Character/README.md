# Player appearance

Before choosing a calling at the wizard, the player uses `FarmerCyan.png` at
1.5×, with authored four-direction idle and walk poses from the same pack as
the classes. Once assigned, the saved `playerClass` selects:

| Calling | Sheet | Scale |
| --- | --- | --- |
| Hunter | BowmanCyan.png | 1.5× |
| Runner | AssasinCyan.png | 1.5× |
| Enforcer | SwordsmanCyan.png | 1.5× |
| Enchanter | MageCyan.png | 1.5× |

These 16px sheets have authored down, up, right and left poses in their first
four rows. The five-column sheets use column 0 for idle and columns 1–4 for
walking. Mage uses columns 0–3 for walking; columns 4–5 are blank. Their visible
bodies are 18–21px tall at 1.5×, close to the original player's 20px.

While `save.bikeUntil` is active, `CyanKnight.png` replaces the player appearance
at 1.25×. This 32px sheet has three-row blocks for down, right, left and up;
each block contains four idle, four walk and four attack frames. The game uses
idle and walk. It restores the calling (or cyan farmer) at timer expiry.
Dragon Powder takes visual priority over both; ending it restores the current
bicycle/class appearance. These skins retain their authored cyan colours;
combat flashes, low-energy tint and invisibility still apply.

`SpriteLayout.PLAYER_ART` owns frame lists, paths, scale and measured foot
placement. `playerArt` resolves saved state; `assets.js` derives preload entries
from the same table. Farmer, class and mount images were copied unchanged from the
provided art; original source packs remain untouched.

The original `Idle.png` and `Walk.png` are deleted (Sep 2026). The cyan farmer
is the BASE sheet: it is what the player wears until a calling's sheet is up,
what every multiplayer peer wears, and what the "How to play" card's demo strip
walks (index.html `#howto .demo`). `app.js` reads its frame, feet drop and
scale off `PLAYER_ART.farmer` for the footprints and the energy pop.
