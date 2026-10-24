# RA layered grass comparison

Four static alpha-tested grass variants (16, 20, 20 and 28 triangles per cell),
beside the current hedge wall at shared world scale. Open index.html over HTTP.
The normal-size strip uses exactly one CSS pixel per game unit; the cards and
interactive field enlarge the same meshes with nearest-neighbour textures.

Native grass is the shipped RA Jungle crop [112,496,16,16]; tree-wide-a is the
project's RA tree reference. The hedge sprite is the existing olive derivative,
not a native RA sprite. The wall uses copies of shipping wall_materials.js and
polygon_geometry.js, including the RA palette, original atlas UVs and bevel.
Its 11-unit height and 16-unit thickness match the runtime hedge profile. Source
snapshots are intentionally retained to make the review reproducible.

Other grass textures are code-native 16px stepped leaf clusters in the RA
six-colour foliage ramp. These are review proposals, not runtime replacements.
The lighter variants intentionally expose gaps, including parts of the chest;
this review does not silently hide objects with gameplay culling. All variants
remain still. The character is a scale placeholder.

Publish this directory to ~/.artifacts/ra-grass-study/. Browser verification:

```sh
node tools/ra-grass-study/check.cjs
```

VIEWER_URL overrides the local artifact URL; ART_OUTPUT changes the screenshot
directory (default /tmp/ra-grass-check). Test covers actual geometry counts,
six headings, retained texture uploads, selection, clearing, lighting, mobile
overflow, browser errors and WebGL errors.

RA sources © ElvGames, local licensed derivatives only.
