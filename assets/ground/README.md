# Ground atlas candidate

`terrain-atlas.png` is the built-in image generator's 8×8 sheet: 32 materials,
with a quiet base and a decorated tile for each. The paired material order
matches terrain IDs 0–31. `terrain-atlas.json` records the palette, frame bounds,
and provenance; `PROMPT.txt` contains the exact generation prompt.

The generator returned 1254×1254 pixels. Calculate crop boundaries by rounding
each grid fraction, rather than truncating a constant cell width. The preview
samples each cell at 24px before nearest-neighbour scaling to the 32px runtime
display size. The raw comparison also samples the original crop directly at 32px.

Open `tools/ground-atlas-viewer.html` through the local HTTP server to inspect
all materials, repetition, decoration, mixed neighbours, and transition layouts.
Raw generated art is a candidate input, not a guarantee of seamless tiling.
The comparison measures touching edge pixels; also inspect the interior edge
bands and repeated motifs at native size.

The atlas provides artwork for every terrain ID. It is not a replacement for
road polygon geometry, cave-wall elevation, masonry restoration/damage,
shoreline geometry, or the uncharted-terrain effect. Those systems have separate
rendering rules. The opt-in game trial is intentionally narrower than the sheet.

Ground detail must retain the existing biome colours and zone overrides. Prepare
image detail once during loading and layer it with the existing colour field;
never perform pixel readback on movement. Keep the border layer above the ground
texture layer. Images with unrelated base colours create conspicuous flat strips
where the border layer covers them.

Animated water should keep the shared eight-phase, 220ms clock and shoreline
foam. The runtime trial uses image detail beneath the existing periodic ripple
painter, whose geometry already joins across variants. Independently generated
animation frames or arbitrary scrolling crops do not guarantee spatial or
loop continuity. Pier water shares the water animation; its decking remains a
separate sprite. Lava retains its existing animated treatment.
