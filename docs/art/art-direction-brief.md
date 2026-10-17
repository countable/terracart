# Dragon Hood: Art Direction

## Purpose
Guide new and revised art toward a consistent camera, pixel size, and palette. Improve consistency over time; exact proportions are secondary to readability on a small screen.

## Scope
World art, characters, enemies, and environmental effects. The supplied dungeon image is the visual reference for pixel treatment, three-quarter perspective, and restrained surface detail, not a requirement to make every area a dungeon.

![Pixel-art perspective and texture reference](direction-reference.png)

## World and mood
A bleak, dangerous post-apocalyptic fantasy world becomes cozy, bright, and welcoming under the player's influence. Steampunk machinery provides occasional accents, with richer concentrations in selected areas.

Unrestored places use weathered materials, subdued colour, and signs of neglect. Restored places look brighter and cleaner while retaining their material identity. Make the change readable at normal play scale. Additional repairs, greenery, or machinery changes depend on the site's design.

## Camera and scale
- The viewport uses a top-down square grid. Artwork starts overhead, tilted roughly 45 degrees toward a south camera: show crowns, backs and top surfaces with compressed front faces. This deliberately mixes perspectives rather than using a physically correct projection. Raised walls and traps retain enough upright height to show their faces.
- Raised surfaces reveal a front-facing wall or cliff below their top plane: a clear lip, shaded face, and grounded base. Tilled plots read as shallow depressions; shrine footings rise above their surroundings. Roads retain their softly blended edges without depression walls. Keep landscape terrain level for now.
- Keep the square map axes aligned with the screen. This is not an isometric diamond grid.
- Building sprites use a three-quarter top-down camera too: show substantial roof depth and tower tops, with shorter, foreshortened front walls. Keep entrances facing screen-bottom; avoid a face-on architectural elevation.
- Author new house sprites within 64×64 pixels and forts within 80×80 pixels. Use broad shapes, restrained trim and a single readable gambling emblem on the fort. Review exports at their actual pixel size; shrinking a detailed illustration does not make its detail appropriate for this resolution.
- Keep house and fort masses approximately balanced around upright world Z: compact footprints, centred roof crowns, balanced wings or towers. Doors and small role details can break symmetry. The viewing direction is about 45 degrees from Z, not aligned with it; retain the tilted top-down view and cardinal footprint alignment. Avoid large directional annexes and steep front-facing roofs that become jarring during compass rotation.
- Everything except roads, buildings, and game characters lives on a 24px tile grid, scaled to the device for a crisp pixel look. Larger tiled objects can span multiple cells.
- Match apparent pixel size across assets. Use crisp scaling for raster art; avoid mixing tiny detailed pixels with enlarged coarse pixels in neighbouring objects.
- The 24px grid is the art target. Source sprites may be 16px or 24px; the current runtime display cell is 32px (`src/sprite_layout.js` and `src/app.js`). These are separate sizes; assess assets together at their final display scale.
- Characters and enemies have chunky proportions and move continuously, including between cells, to accommodate GPS movement. The art grid does not constrain movement.

## Player concealment and story illustrations

Story/event illustrations intentionally differ from the main game world. These
rules govern dialog paintings, not map sprites, terrain, buildings or other
in-world assets; retain the world-art camera, scale and material rules above.

### Approved visual references

Use the four user-approved masters recorded with exact paths, roles and hashes
in [story-style-references.json](story-style-references.json). They are archived
under `~/.artifacts/terracart-art/story-style-references/`:

- **Cave:** Hood's appearance and slightly taller proportions; restrained brown/ochre light and irregular painterly pixel marks. Its dark edges convey entering a dark environment, not a general vignette rule.
- **Close sundries:** the approved shop style and framing, consistent Hood outfit, and fully concealed face. Keep the player cropped in the foreground and emphasize the keeper and counter.
- **Working without tools:** outdoor palette, painterly treatment and close action framing.
- **Original grove shrine:** unchanged reference for olive greens, mossy stone, foliage and forest light. Its old lower copy zone is not part of the style.

Supply actual reference images with every generation, plus the original scene
for content and framing. Include the cave or sundries reference whenever Hood
appears. Match each reference's stated role rather than mixing every palette
into every setting. Earlier unselected ten-scene remakes are comparison studies,
not style references. The original scene remains authoritative for its subjects,
objects, camera distance and narrative context.

### Style, framing and character rules

- Preserve limited colour, irregular softly painted pixel marks, subtle shade variation and atmosphere. Do not interpret pixel art as hard comic contours, uniform large blocks, flat posterization, brighter saturation or extra fine detail. Retain the originals' painterly quality while matching the approved masters.
- Target 4:3 landscape, with dialog copy and controls in a separate area below. Remove old reserved text zones; do not erase meaningful darkness inside a scene. Preserve the first two opening panels' formats (compass and nightmare, both animation frames each); the book-reading background is a separate UI asset.
- Preserve original camera distance and subject framing. A 4:3 image does not require a wider establishing shot or full-body player. Prefer a deliberate crop when it preserves the painting; regenerate when requested or when a specific composition problem requires it.
- Keep palettes contextual: warm restrained earth colours for village/outdoor scenes, olive greens for forest shrines, local lantern/fire light in dark settings. Ambiguous time of day does not mean gray weather or desaturation. At most suggest dawn/dusk subtly; avoid a visible sun disc, conspicuous sunset bands or strong time-specific shadows unless the scene requires them.
- Never show Hood's face or hair, including a cheek or nose in profile. Use opaque hood shadow or a rear view; no eyes or glowing eyes. Preserve the approved brown hood, short outer garment, belted clothing, backpack/bedroll, trousers and boots where visible, rather than substituting a floor-length robe.
- Hood reads as an ordinary adult beside people and furniture, with the cave reference's slight increase in height: proportionate hood/head, balanced torso and limbs, no miniature build. Do not widen the camera just to demonstrate those proportions.
- Keep the cave's original muted palette, irregular rock texture, quiet entrance composition and atmospheric dark edges. The approved cave reference changes framing and modestly adjusts Hood's height; it does not authorize brightening or filling every shadow.

## Spritesheet generation
- Generate spritesheets as an 8 × 8 grid of sprites: eight columns and eight rows, for 64 frames. Design each frame in a 24 × 24 px pixel-art style, with deliberate pixel clusters, crisp edges and restrained detail.
- A sheet of single-cell sprites is 192 × 192 px at the target resolution. Higher-resolution generations are enlarged working images; they must not introduce finer detail than the 24 × 24 px style can support. Review the extracted frames at their final game scale.
- Keep frame spacing, ground anchors and apparent pixel size consistent across the sheet. Use transparent backgrounds and keep artwork inside its assigned frame. Declare larger, multi-cell objects separately rather than squeezing them into a single-cell silhouette.
- The 8 × 8 layout is the generation convention, not a requirement to repack existing runtime sheets. Preserve the scale exceptions above for buildings, roads and characters; buildings still follow the three-quarter top-down camera rule.

## Colour, vectors, and light
- Use a shared, restrained palette across terrain, props, buildings, and actors. Coordinate material colours and shadow tones; reserve stronger colour and contrast for useful focal points and restoration.
- Vector art supports real-world road and building geometry. Smoother edges are acceptable; match the surrounding art's perspective, palette, and visual weight. A pixel-treated vector comparison is a future experiment.
- Preserve the strong existing lighting. Warm local lights help objects read against subdued surroundings; lighting supports the palette rather than hiding mismatched assets.

## Review at game scale
Check each addition beside existing art on a small screen: consistent camera, comparable pixel size, compatible colours, clear silhouette, and a legible unrestored/restored difference where applicable.
