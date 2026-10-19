# Extending a pixel-art spritesheet with image generation

The best tested workflow is **enlarge → provide copied placement templates →
generate replacements → reduce → composite with the untouched original**.
Use this for new crops, tier variants, containers and similar small sprites.
It produces reviewable candidates, not guaranteed pixel-perfect atlases.

## Prepare the reference

1. Inspect the original at native size and identify the real frame dimensions,
   occupied cells, animation states, transparent padding and ground anchors.
   Do not assume every cell contains a distinct sprite.
2. Enlarge the relevant source region **exactly 4× using nearest-neighbor**.
   Each original pixel becomes one solid 4×4 block. A 16×16 source cell becomes
   a 64×64 working cell; do not introduce smoothing.
3. Put the enlarged reference on a transparent 1024×1024 canvas. Hide unrelated
   repeats, golden variants or other content that encourages unwanted duplicates.
   Keep the useful source art and palette visible.
4. Copy suitable existing sprites into the area to extend. These copies are
   **replacement templates**: they show the model the intended cell dimensions,
   positions, scale, padding, perspective and pose. Empty space plus numeric
   coordinates proved less reliable than concrete copied sprites.
5. Record exact template rectangles before generation. Keep coordinates aligned
   to the enlargement factor so extraction can be a fixed crop and exact reduction.
   Do not squeeze source art to fit the canvas or independently stretch axes.

For the chest trial, the 128×144 source occupied `(0, 0, 512, 576)` after
4× enlargement. Seven copies of the closed brown chest from source rectangle
`(0, 96, 16, 16)` occupied `(512 + 64*i, 0, 64, 64)` for `i=0…6`.
The new strip therefore occupied `(512, 0, 448, 64)`.

## Generate

The tested configuration is:

- Model: `gpt-image-2.5-sunburst`.
- Endpoint: Images API edit, supplying the prepared canvas as the image.
- Size: `1024x1024`.
- Quality: `high`.
- Background: `transparent`.
- Output format: `png`.
- No mask in the successful copied-template trials.

Use a tool that actually sends `background=transparent` to the edit API.
The local `~/.claude/skills/image-gen` wrapper, as inspected during these trials,
forces magenta-key removal whenever a reference is attached. That workflow can
leave magenta fringes; asking for transparency in the prompt does not override
its implementation. Check the current wrapper before using it.

The bundled imagegen CLI supports explicit edit parameters. With credentials
available in the process environment, the command shape is:

```sh
python3 ~/.codex/skills/.system/imagegen/scripts/image_gen.py edit \
  --model gpt-image-2.5-sunburst \
  --image reference-template.png \
  --prompt-file prompt.txt \
  --size 1024x1024 --quality high \
  --background transparent --output-format png \
  --no-augment --out result.png
```

Load configured credentials privately; never paste keys into prompts, reports
or source files. Tool paths and accepted options can change: inspect the local
skill and current model documentation before reproducing the command.

### Prompt template

```text
The attached canvas contains an unchanged reference at [rectangle] and copied
replacement templates at [rectangle / cell coordinates]. Replace ONLY those
copied templates with [ordered list of subjects or tiers]. Preserve the reference.

Keep each replacement in its exact template cell, with the same footprint,
ground anchor, pose, perspective and padding. Each cell is [native size × 4].
Every logical pixel is a solid 4×4 block. This image was enlarged exactly 4×
with nearest-neighbor; do not add finer details, antialiasing or smooth shading.
Match the reference palette, outlines and simple pixel clusters.

[Specify identities, colors, growth stages or closed/open states explicitly.]
Do not add variants, rows, decorations, labels or extra subjects. Do not enlarge
or spread the sprites to fill the canvas. Keep unused regions transparent.
Use real alpha, opaque sprite interiors and crisp edges. No colored backdrop,
checkerboard, glow or haze. Output 1024×1024.
```

Use the project's real tier or item definitions rather than inventing a palette.
Chest tiers are Wood, Copper, Iron, Gold, lavender-Platinum, Crimson and Frost;
`tierBadgeColor` in `src/items.js` owns their colors.

## Extract and validate

1. Retain the raw output, actual submitted input, prompt and API settings.
2. Inspect the **whole output before cropping**. A fixed crop can hide an extra
   column, truncate a shifted sprite or conceal rows extending past their template.
3. Measure scale and placement against the intended cell grid. Check the number
   and identity of populated cells, row spacing, padding, and base anchors.
   A nearly opaque alpha threshold can help measure sprite bodies when faint haze
   exists, but is not a substitute for inspecting the entire alpha channel.
4. Extract the recorded template rectangle and reduce **exactly 4:1 with
   nearest-neighbor**. Do not resize each sprite independently to make a failed
   layout appear correct. If alignment correction is necessary, record it explicitly.
5. Composite the new frames beside the **untouched original**, rather than keeping
   the model's redrawn reference. Verify original pixels are unchanged.
6. Review new and old sprites side by side at native size and at the same enlarged
   viewing scale. Check silhouette, apparent pixel size, palette and perspective.
7. Inspect transparency on both light and dark backgrounds. Native alpha is
   supported but these trials sometimes returned broad semi-transparent color
   haze. Chroma-key output sometimes retained magenta edges. Do not describe either
   as a clean cutout merely because it has an alpha channel.

For the approved chest strip, the fixed extraction produced a 112×16 PNG with
seven left-to-right 16×16 frames. No per-frame fitting or alpha cleanup was applied.

## What the trials established

- A large empty canvas encouraged extra variants and enlarged sprites.
- Asking for exact coordinates or 16×16 cells alone did not reliably enforce them.
- Copied sprite templates improved scale and placement.
- 2× enlargement helped, but the tested output still had oversized plants.
- 4× with copied templates gave the closest crop match in the tested samples.
- In one native-alpha comparison, 3× added an extra populated column and exceeded
  the intended rectangle by about 15 native pixels right and 7 down. The 4× sample
  stayed within the width and extended about 1 native pixel down.
- The seven-chest 4× sample kept its near-opaque artwork within the intended strip.
- These are individual samples, not a benchmark proving 4× always wins. Neither
  input fidelity nor an edit mask guarantees pixel-identical reference preservation.

## Integrate only the reviewed result

For game use, preserve existing frame semantics, update asset paths and measured
sprite bounds, and remove runtime recoloring when authored tier colors replace it.
Update preview tools that synthesize the old variants. Regenerate cache hashes and
run the repository's required sprite, test and browser checks. Generation trials
alone do not authorize replacing production art.

Reference experiments are archived on the shared artifact server:

- Crop comparison: <http://localhost:8765/crop-scale-trials/index.html>
- Native-alpha tests: <http://localhost:8765/crop-native-alpha/index.html>
- 3× comparison: <http://localhost:8765/crop-native-3x/index.html>
- Approved chest trial: <http://localhost:8765/chest-tier-4x/index.html>
