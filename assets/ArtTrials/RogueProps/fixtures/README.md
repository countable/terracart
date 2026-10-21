# Approved Rogue Adventure fixtures

`source/` contains the final approved native-size review PNGs. These are the
runtime artwork masters: generated replacements have already been cropped and
reduced to their approved dimensions. `source/approved.json` records their review
provenance and SHA-256 hashes. It does not require the original private artifact
paths to rebuild this package.

Run `python3 tools/art/export_ra_fixtures.py` from the repository root. The script
copies the approved pixels without resizing, quantization, alpha thresholding,
or recoloring, and packs the multi-frame shrine/elevator/waystone sheets.
`manifest.json` supplies runtime keys, sheet geometry and seating bounds measured
with the sprite audit's alpha threshold (16). Partial alpha in generated masters
is preserved; the threshold affects seating bounds only.

Install these mappings only for the Rogue Adventure art profile. The separate
elevator atlas leaves every baseline progression frame unchanged. Waystone frame
1 keeps the baseline lit art; only reviewed frame 0 is replaced. Stairs remain
visuals for the existing up/down access actions. Shrine frame numbers remain
unchanged, so saved shrine identities and boons retain their meaning.

The 24×36 votive uses the regular shrine display scale (16/15); stairs and
24×36 elevator frames use scale 1. The unlit-lamp proposal deliberately contains
only the remaining post/stem within its 16×32 canvas. Broken pots and retired
flat crate proposals are excluded.
