# Modular giant serpent — draft prototype

Recommended direction: use eight authored directions on overlapping body pieces, following a distance-sampled history of the head. This preserves the game's chunky pixels and fixed south-facing light better than rotating a single painted piece. The comparison page runs both renderers against the same simulation.

This is a standalone experiment, not a deployed enemy. Nothing is registered in game rendering, combat, spawning, collision, saves or asset loading. The existing approved coiled giant-serpent sheets remain unchanged.

## Open and experiment

Open `index.html` locally or serve this directory with a static HTTP server. Drag on either scene to steer. Use the route menu for winding movement, sharp corners, a hairpin and a straight line ending at rest. Turn back requests a bounded U-turn. Pause checks an idle body. The optional curved-piece toggle is deliberately experimental.

The world is a square grid with screen-aligned axes. Art uses the game's overhead-dominant view tilted toward the south at roughly 45 degrees. Each scene uses 24px logical cells and a 32px parts atlas; the serpent centerline spans about 7.5 cells. Browser resizing is for review only; production should use the game's common pixel scale.

## Art and assembly

`parts-source.png` was generated with the built-in image tool using the approved `LargeDirectionalV2/giant-serpent-source.png` as its explicit identity/style reference. `prompt.txt` preserves the prompt. `export.cjs` makes the 256×128 native atlas with nearest-neighbour sampling and a one-pixel transparent border. All 32 frames are nonempty and retain actual alpha.

Rows are head, straight body, curved body, tail. Columns are E, SE, S, SW, W, NW, N, NE. The model produced tail tips pointing in the named direction, so the renderer deliberately selects the opposite direction for the trailing tail. `frames.json` records that convention. Head, neck, segments and tail overlap; there is no whole-snake baked animation.

The default body has 19 pieces between head and tail, sampled every 9px of travelled distance. A body position comes from the head's retained spatial trail, not from a fixed number of previous rendered frames. Samples interpolate between cumulative-distance history points. History is bounded to 260px. Stopping adds no trail points and leaves all body positions unchanged.

A 120Hz fixed simulation step bounds turn speed and makes identical elapsed simulation time agree at 30, 60 and 144 rendered FPS. Each body heading comes from nearby samples of the same trail. The head follows goals with a maximum turn rate rather than snapping at sharp waypoint corners. The actual moving trail is recorded, so the body follows that rounded route. Reversing changes the goal behind the head; it does not invert the body chain or teleport the tail.

Each part sorts by its own ground Y alongside the two test posts, with a stable segment-index tie break. The head's small visual height offset does not affect the ground depth. Sorting the entire long serpent as one object would fail when opposite ends pass either side of a prop.

## Compared approaches

| Approach | Result | Main tradeoff |
|---|---|---|
| A: eight authored directions, overlapping native pieces | Recommended prototype basis. Top surfaces and lighting stay in world orientation; pixel grid remains intact. | Direction switches at 45-degree boundaries, slight contour jitter and visible repeated collars. |
| B: rotate/stretch a single east-facing body and tail | Continuous tangent changes and minimal artwork. | Rotates the painted highlight/underside, shears pixels on diagonals; reads less consistently with the fixed camera. |
| Optional authored curve pieces | Demonstrates art substitution at turns. | Generated bends do not provide calibrated incoming/outgoing sockets; can bulge. Off by default. |

A deforming mesh/ribbon is a viable third production approach for smoother art, but was researched rather than implemented here. It needs deliberate UV mapping, pixel sampling, and separate handling of the head/tail and crossings.

## Tested and limitations

Run `node assets/Enemy/SegmentedSerpent/test.cjs` from the repository. Twelve focused checks pass: frame-rate equivalence, idle stability, straight spacing, winding/sharp/hairpin continuity, reversal, history sampling density, atlas alpha/borders, centerline coverage by actual directional body alpha at the default spacing, tail/body overlap in all eight directions, and actual alpha coverage along body/tail junctions throughout winding, sharp and hairpin routes. `test-results.json` stores the results. No game suite was run because this draft has no runtime integration.

Chromium also loaded the page with no JavaScript errors, rendered both methods, exercised all four route selectors plus reversal, joints, curved pieces and FPS controls. `preview.png` shows the winding comparison. Source/native atlas, winding/hairpin screenshots and all eight straight headings were visually inspected. `tail-directions.png` records the eight-heading check.

The draft demonstrates contiguous motion, but is not final production art. Repeated outlined end collars create an armoured/beaded appearance: paint socket ends without internal dark rims, then tune overlap to hide remaining seams. Eight-way swaps visibly snap at heading boundaries. Curved sprites need socket calibration before use. Alpha tests cover straight and turning body/tail centerlines, not every pixel of the outer silhouette or experimental curved-piece combination. At 9px spacing, 307,800 sampled turning junction positions had no uncovered centerline pixels; all eight tail/body pairs share at least 64 opaque pixels. Visual checks found no detached sections. Outline scalloping and authored-direction snaps remain.

Self-intersections use ground-Y sorting only. This is adequate for a flat creature, but intentional over/under coils need explicit crossing/elevation state. There is no wall avoidance, self-collision, attack extension, damage-zone ownership, network synchronization, navigation, camera culling or game depth integration. Pointer steering may leave the scene; restart returns to a preset. The FPS menu caps rendering at the requested rate; it cannot exceed the display's refresh rate. Numerical tests independently check 144 FPS.

## Research and source rationale

- [Godot PathFollow2D](https://docs.godotengine.org/en/stable/classes/class_pathfollow2d.html) defines progress as distance along a path and discusses interpolation of cached points, including sharp-turn sampling limitations. This supports distance-based chain sampling; storing the travelled trail is this prototype's application of that principle.
- [Godot CanvasItem](https://docs.godotengine.org/en/stable/classes/class_canvasitem.html#class-canvasitem-property-y-sort-enabled) documents ordering items by Y and the distinction between sorting a subtree as one object versus independently sorting children. This motivates sorting serpent sections separately.
- [Clint Bellanger, Isometric Tiles Math](https://clintbellanger.net/articles/isometric_math/) is primary material from the Flare engine author: keep simulation in map coordinates and project only for rendering. Isometric games can apply the same path/parts technique before projection. Dragon Hood keeps screen-aligned square coordinates; the isometric diamond transform is deliberately not adopted.
- [Spine mesh attachments](https://us.esotericsoftware.com/spine-meshes) explains image meshes and deformation as a compositional alternative to rigid sprites. A mesh could remove repeated joints, at the cost of a more involved pixel-art rendering pipeline.
- [Spine runtime rendering](https://us.esotericsoftware.com/spine-unity-rendering) describes attachment draw order and ordering between rendered meshes. It supports treating layer order as an explicit concern, rather than assuming a whole segmented creature has one depth.

These sources establish techniques and tradeoffs. They are not evidence that a particular commercial isometric serpent uses this implementation.

## Spacing and tail revision

Body section spacing is now 9 logical pixels (2px farther apart). Tail frames use measured direction-specific sockets at the broad base rather than the centre of their 32px cells. In the rotated comparison, the east tail socket rotates with its art. The direction and sampling model are unchanged. The frame map records all eight socket coordinates.
