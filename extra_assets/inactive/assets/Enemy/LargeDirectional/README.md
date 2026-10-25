# Large directional enemies

Six generated art drafts: bugbear, troll, giant bear, ogre, giant reaper and
giant serpent. Each enemy has its own 32×32-frame sheet, eight columns by four
rows. Rows face north, east, south and west; columns 0–3 walk, and columns 4–7
show attack anticipation, windup, impact and recovery. Walking for the serpent
is slithering; the reaper glides.

Placement follows the top-down square grid. Artwork uses the roughly
45-degree view from the south specified in CLAUDE.md's shared design rules.
North-facing sprites show their backs. The existing big-monster and brute
sheets guide the proportions, palette and pixel density; the earlier
LargeAttack sheet supplies character identities.

Generated with the built-in imagegen tool. `prompts.json` records the prompts
and references; `*-source.png` preserves the original outputs. Native sheets
use nearest-neighbor export with a one-pixel transparent frame border.
`frames.json` records frame indices and suggested
timings. `index.html` previews the animations and provides downloads.

These sheets are not connected to gameplay. On integration, use the existing
creature scale and animation tables so the enemies can render larger than one
cell without changing their 32×32 source frames.
