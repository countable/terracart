// Display-layer audit — pins the order of the world's draw layers.
//
// Phaser draws a scene's display list in INSERTION order, so the sequence of
// `this.x = this.add.graphics() / this.add.container()` calls in MapScene's
// create() *is* the z-order. Nothing in the code says so out loud, which makes
// it very easy to add a layer in a reasonable-looking place and silently break
// something drawn three hundred lines away.
//
// The bug that motivated it: the out-of-reach dim — the wash that makes
// "outside the lit area" mean something — was painted into cellGfx, the
// BOTTOM-most layer. It could only darken the base terrain fill. Every piece
// of ground decoration above it (biome seam borders, cobbles, road letters,
// POI halos, treasure pads) stayed at full brightness outside the lit area,
// and the biome boundaries in particular read as glowing lines in the dark.
// Forcing the dim to alpha 1.0 made it obvious: the road strip, the pale
// cobbles and the road lettering all punched straight through a fully opaque
// black wash.
//
// These checks are about ORDER ONLY. They deliberately do not care how many
// layers exist or what any of them paint — just that the ones whose stacking
// carries meaning stay in the right sequence relative to each other.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// The display list, in insertion order: every `this.<name> = this.add.<kind>()`
// in source order. setDepth() overrides are handled separately below.
function displayLayers() {
  const src = fs.readFileSync(path.resolve(ROOT, 'src/app.js'), 'utf8');
  const re = /this\.(\w+)\s*=\s*this\.add\.(graphics|container|renderTexture)\(/g;
  const out = [];
  const seen = new Set();
  for (const m of src.matchAll(re)) {
    // Aliases (plantedContainer = worldContainer) are plain assignments and
    // don't match; a genuine re-creation of the same name would, so keep the
    // FIRST occurrence, which is the one that fixes its place in the list.
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    // A layer given an explicit depth is no longer ordered by insertion, so it
    // is not part of this ordering contract.
    const tail = src.slice(m.index, src.indexOf('\n', m.index) + 1);
    if (/setDepth\(/.test(tail)) continue;
    out.push(m[1]);
  }
  return out;
}

const idx = (layers, name) => layers.indexOf(name);

// Layers that draw GROUND: the terrain and everything decorating it. All of
// these must sit below the lighting layer, or the dim cannot reach them.
const GROUND = [
  'cellGfx',           // base terrain fill
  'gridGfx',           // dashed cell grid
  'borderGfx',         // biome seam borders  <- the reported bug
  'cobbleContainer',   // road / path stones
  'letterContainer',   // road name lettering
  'roadGeomContainer',
  'padContainer',      // treasure plinths
  'shadowContainer',
  'atmosGroundGfx',    // biome haze over the ground
];

// Layers that draw STANDING things. These sit ABOVE the reach layer (its
// white outline is ground-level) and BELOW the lightmap, which dims a sprite
// with the ground it stands on — the darkness used to sit below the sprites
// and exempt them, and a house outside the bubble read as a sticker on dark
// ground.
const SPRITES = ['worldContainer', 'rampartFrontGfx', 'towerContainer'];

// The LIGHTMAP (src/lighting.js): every light added into one texture,
// multiplied over the world. Above every ground layer, the halo and the
// sprites; below the labels, which are UI and stay crisp in the dark.
const LIGHT = 'lightMap';

// poiHaloContainer draws the POI ring "ping" (render.js), whose entire job is
// to read as a place from across the map. It sits ABOVE reachGfx (so the
// outline never crosses it) but still BELOW the standing sprites and the
// lightmap, so it fades with distance like everything else. See the comment
// at its creation in MapScene.create() for the full story.
const HALO = ['poiHaloContainer'];

// Fog of war sits at the very TOP of the world display list. Every darkening
// pass before it had to learn the same lesson: a dim only reaches what is
// BELOW it (the out-of-reach wash started in cellGfx and left the biome seams
// glowing; the distance falloff had to move above the sprites so rim objects
// stopped reading as stickers on dark ground). Fog makes the strongest claim of
// the three — "you have not been here" — so it must cover the sprites AND the
// label layer, which is otherwise crisp UI and would name a shop the player has
// never found.
const FOG = 'fogContainer';
const BELOW_FOG = [...GROUND, ...SPRITES, ...HALO,
  'reachGfx', LIGHT, 'atmosRimGfx', 'labelContainer', 'tierGfx'];

const CHECKS = [
  {
    name: 'layers: the display list is actually parseable',
    run: () => {
      const layers = displayLayers();
      if (layers.length < 15) {
        throw new Error(`only found ${layers.length} display layers — the scanner is broken`);
      }
      const missing = [...BELOW_FOG, FOG].filter((n) => idx(layers, n) < 0);
      if (missing.length) {
        throw new Error(`layers not found in create(): ${missing.join(', ')}`);
      }
    },
  },
  {
    name: 'layers: the reach layer covers every ground layer',
    run: () => {
      const layers = displayLayers();
      const lit = idx(layers, 'reachGfx');
      const below = GROUND.filter((n) => idx(layers, n) > lit);
      if (below.length) {
        throw new Error(`${below.join(', ')} draw ABOVE the reach layer, so they would cover the ` +
          'reach outline — the tap affordance. Move reachGfx above them in MapScene.create().');
      }
    },
  },
  {
    name: 'layers: the reach layer stays below the standing sprites',
    run: () => {
      const layers = displayLayers();
      const lit = idx(layers, 'reachGfx');
      const above = SPRITES.filter((n) => idx(layers, n) < lit);
      if (above.length) {
        throw new Error(`${above.join(', ')} draw BELOW the reach layer, so the outline would be ` +
          'drawn over a tree standing on it.');
      }
    },
  },
  {
    name: 'layers: the lightmap covers the ground, the halo and the sprites',
    run: () => {
      const layers = displayLayers();
      const light = idx(layers, LIGHT);
      const above = [...GROUND, ...HALO, ...SPRITES, 'reachGfx'].filter((n) => idx(layers, n) > light);
      if (above.length) {
        throw new Error(`${above.join(', ')} draw above ${LIGHT}, so they would stay lit outside ` +
          'every light — the darkness only reaches what is below it. This is how the biome seams ' +
          'once glowed in the dark and rim objects read as stickers on dark ground. Move lightMap ' +
          'after them in MapScene.create().');
      }
    },
  },
  {
    name: 'layers: the lightmap stays below the labels',
    run: () => {
      const layers = displayLayers();
      const light = idx(layers, LIGHT);
      if (idx(layers, 'labelContainer') < light) {
        throw new Error('labelContainer draws below the lightmap — POI name tablets are UI and ' +
          'must stay crisp in the dark.');
      }
    },
  },
  {
    name: 'layers: the POI halo stays above the reach layer',
    run: () => {
      const layers = displayLayers();
      const lit = idx(layers, 'reachGfx');
      const below = HALO.filter((n) => idx(layers, n) < lit);
      if (below.length) {
        throw new Error(`${below.join(', ')} draw BELOW the reach layer, so the reach outline ` +
          'would cross the POI ping. Move it above reachGfx in MapScene.create().');
      }
    },
  },
  {
    name: 'layers: the POI halo stays below the sprites and the lightmap',
    run: () => {
      const layers = displayLayers();
      const light = idx(layers, LIGHT);
      const above = HALO.filter((n) => idx(layers, n) > light || SPRITES.some((s) => idx(layers, n) > idx(layers, s)));
      if (above.length) {
        throw new Error(`${above.join(', ')} draw above the standing sprites or the lightmap — ` +
          'the halo fades with distance like everything else and sits under the chest it marks.');
      }
    },
  },
  {
    name: 'layers: the fog covers every world layer, labels included',
    run: () => {
      const layers = displayLayers();
      const fog = idx(layers, FOG);
      const above = BELOW_FOG.filter((n) => idx(layers, n) > fog);
      if (above.length) {
        throw new Error(`${above.join(', ')} draw ABOVE the fog layer, so they stay fully lit ` +
          'over land the player has never visited. A label or tier pip poking through the fog ' +
          'gives away a place that has not been found yet; a sprite doing it is the same bug ' +
          'that left biome seams glowing outside the reach bubble. Move fogContainer last in ' +
          'MapScene.create().');
      }
    },
  },
  {
    name: 'layers: the fog pass paints onto the fog layer, not the terrain',
    run: () => {
      const src = fs.readFileSync(path.resolve(ROOT, 'src/render.js'), 'utf8');
      const start = src.indexOf('if (scene.fogTex && scene.fogImage && scene.fogContainer)');
      if (start < 0) throw new Error('render.js no longer routes the fog pass through a fog layer');
      // Bound the block at the end of drawCells (the only `\n};` at column 0
      // after it) — slicing to EOF would sweep in every later draw function.
      const end = src.indexOf('\n};', start);
      if (end < 0) throw new Error('could not find the end of the fog block in render.js');
      const block = src.slice(start, end);
      const stray = block.match(/(?<![\w.])g\.(fillRect|fillStyle)/g);
      if (stray) {
        throw new Error(`${stray.length} fog pass(es) paint onto the terrain layer — they would ` +
          'only darken the base fill, leaving every sprite and label lit.');
      }
      // The wash is a canvas texture now, painted by paintFogTexture, which
      // lives OUTSIDE this block — so the scan above can no longer see where it
      // lands. Pin the handover instead: the block calls the painter with the
      // scene, and the painter writes scene.fogTex and nothing else.
      if (!/paintFogTexture\(scene,/.test(block)) {
        throw new Error('the fog block no longer calls paintFogTexture(scene, …) — the wash takes '
          + 'its target off the scene, and this is what pins that it is the fog layer\'s texture.');
      }
      const painter = src.slice(src.indexOf('function paintFogTexture('));
      const painterEnd = painter.indexOf('\n}');
      const body = painter.slice(0, painterEnd);
      if (!/const tex = scene\.fogTex,/.test(body)) {
        throw new Error('paintFogTexture no longer paints scene.fogTex — a wash on any lower layer '
          + 'leaves the sprites and labels above it lit.');
      }
      // ...and the image that shows it has to live in the fog container, or the
      // texture is right and its z-order is not.
      const app = fs.readFileSync(path.resolve(ROOT, 'src/app.js'), 'utf8');
      if (!/this\.fogContainer\.add\(this\.fogImage\)/.test(app)) {
        throw new Error('the fog image is not added to fogContainer in MapScene.create() — the '
          + 'ordering check above pins the container, so the wash has to be inside it.');
      }
    },
  },
  {
    name: 'layers: the reach passes paint onto the lighting layer, not the terrain',
    run: () => {
      const src = fs.readFileSync(path.resolve(ROOT, 'src/render.js'), 'utf8');
      const start = src.indexOf('const gr = scene.reachGfx');
      if (start < 0) {
        throw new Error('render.js no longer routes the reach passes through a lighting layer');
      }
      const end = src.indexOf('if (rgt) gr.lineBetween', start);
      if (end < 0) throw new Error('could not find the end of the reach block in render.js');
      const block = src.slice(start, end);
      // A bare `g.` in this block means a pass slipped back onto the terrain
      // graphics — the original bug, one call at a time.
      const stray = block.match(/(?<![\w.])g\.(fillRect|fillStyle|lineStyle|lineBetween)/g);
      if (stray) {
        throw new Error(`${stray.length} reach pass(es) still paint onto the terrain layer ` +
          `(${[...new Set(stray)].join(', ')}) — they will not darken ground decoration.`);
      }
    },
  },
];

module.exports = { CHECKS, displayLayers, GROUND, SPRITES, HALO, LIGHT, FOG, BELOW_FOG };
