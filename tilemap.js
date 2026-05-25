// Tile art from Tileset Spring.png. 12 cols x 20 rows of 16x16 frames; only cols 8-11 have content.
// The sheet is organized as five 4x4 auto-tile patches stacked vertically. For each patch the
// "full interior" frame (all 4 neighbors same terrain) is the bottom-right cell of the patch.
// Frame index = row * 12 + col.  Patches:
//   rows  0-3 cols 8-11 : GRASS        (interior frame 47  = row 3, col 11)
//   rows  4-7 cols 8-11 : PARK         (interior frame 95)
//   rows  8-11 cols 8-11: SAND         (interior frame 143)
//   rows 12-15 cols 8-11: FARMLAND     (interior frame 191 — duplicate of sand sheet, slightly different)
//   rows 16-19 cols 8-11: FOREST       (interior frame 239 — grass-with-dirt-edges)
// Terrain classes WATER, RESIDENTIAL, ROAD, PATH, BUILDING, ROCK have no art in this sheet —
// they stay as flat color in app.js. TILLED is rendered using the SAND interior frame.
window.TileMap = {
  KEY: 'terrain',
  PATH: 'Tileset/Tileset Spring.png',
  FRAME_W: 16, FRAME_H: 16,
  FRAMES: {
    0: 47,    // GRASS
    1: 239,   // FOREST
    2: 143,   // SAND
    4: 191,   // FARMLAND
    6: 95     // PARK
  },
  TILLED_FRAME: 143   // dirt — overrides the underlying terrain frame for tilled cells
};
