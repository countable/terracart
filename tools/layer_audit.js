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
  const re = /this\.(\w+)\s*=\s*this\.add\.(graphics|container)\(/g;
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
  'poiHaloContainer',
  'padContainer',      // treasure plinths
  'shadowContainer',
  'atmosGroundGfx',    // biome haze over the ground
];

// Layers that draw STANDING things. These sit ABOVE the lighting layer on
// purpose: reach dims the ground, distance (atmosFalloffGfx) dims the sprites.
const SPRITES = ['worldContainer', 'rampartFrontGfx', 'towerContainer'];

const CHECKS = [
  {
    name: 'layers: the display list is actually parseable',
    run: () => {
      const layers = displayLayers();
      if (layers.length < 15) {
        throw new Error(`only found ${layers.length} display layers — the scanner is broken`);
      }
      const missing = [...GROUND, ...SPRITES, 'reachGfx', 'atmosFalloffGfx']
        .filter((n) => idx(layers, n) < 0);
      if (missing.length) {
        throw new Error(`layers not found in create(): ${missing.join(', ')}`);
      }
    },
  },
  {
    name: 'layers: the lighting layer covers every ground layer',
    run: () => {
      const layers = displayLayers();
      const lit = idx(layers, 'reachGfx');
      const below = GROUND.filter((n) => idx(layers, n) > lit);
      if (below.length) {
        throw new Error(`${below.join(', ')} draw ABOVE the lighting layer, so they stay bright ` +
          'outside the lit area — this is exactly how the biome seam borders ended up ' +
          'glowing in the dark. Move reachGfx above them in MapScene.create().');
      }
    },
  },
  {
    name: 'layers: the lighting layer stays below the standing sprites',
    run: () => {
      const layers = displayLayers();
      const lit = idx(layers, 'reachGfx');
      const above = SPRITES.filter((n) => idx(layers, n) < lit);
      if (above.length) {
        throw new Error(`${above.join(', ')} draw BELOW the lighting layer. Sprites are meant to ` +
          'keep full contrast against receding ground; distance dims them via atmosFalloffGfx, ' +
          'not reach.');
      }
    },
  },
  {
    name: 'layers: the distance falloff stays above the sprites',
    run: () => {
      const layers = displayLayers();
      const fall = idx(layers, 'atmosFalloffGfx');
      const above = SPRITES.filter((n) => idx(layers, n) > fall);
      if (above.length) {
        throw new Error(`${above.join(', ')} draw above atmosFalloffGfx, so distant objects would ` +
          'stay lit and read as stickers on darkening ground.');
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

module.exports = { CHECKS, displayLayers, GROUND, SPRITES };
