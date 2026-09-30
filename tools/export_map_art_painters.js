#!/usr/bin/env node
// Bundle the shipping Canvas2D painters for the offline map-art dashboard.
// The export hook exposes private road passes without changing runtime code.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function bundle() {
  const buildingProposal = JSON.parse(read('docs/art/map-building-preview.json'));
  const groundProposals = Object.fromEntries(JSON.parse(read('docs/art/map-audit-ground.json')).rows
    .filter(row => row.terrainId != null).map(row => [row.terrainId,row.proposedColor]));
  const groundPatternOpacity = Object.fromEntries(JSON.parse(read('docs/art/map-audit-ground.json')).rows
    .filter(row => row.patternOpacity != null).map(row => [row.terrainId,row.patternOpacity]));
  const app = read('src/app.js');
  const colorsMatch = app.match(/const COLORS = (\{[\s\S]*?\n\});/);
  if (!colorsMatch) throw new Error('Cannot find shipping terrain colours');
  const colors = vm.runInNewContext('(' + colorsMatch[1] + ')');
  const util = read('src/util.js');
  const tokens = {};
  for (const key of ['UI_TREASURE', 'UI_LAMP_GOLD', 'UI_LAMP_GLOW']) {
    const match = util.match(new RegExp('const ' + key + '\\s*=\\s*([\'\"])(#[0-9a-fA-F]+)\\1'));
    if (!match) throw new Error('Cannot find shipping colour token ' + key);
    tokens[key] = match[2];
  }
  let road = read('src/road_overlay.js');
  road = road.replace('const RAIL_COLOR =', 'let RAIL_COLOR =');
  const hook = '  global.RoadOverlay = {';
  if (!road.includes(hook)) throw new Error('Cannot find road painter export');
  road = road.replace(hook, `  global.MapArtRoadPasses = {
    commitBase, commitRestored, emitRailDecor,
    ROAD_COLOR, PATH_COLOR, RAIL_COLOR, RESTORED_ROAD_COLOR, RESTORED_PATH_COLOR,
    ALPHA, RESTORED_ALPHA,
    withRailColor(color, draw) {
      const original = RAIL_COLOR;
      RAIL_COLOR = color;
      try { return draw(); } finally { RAIL_COLOR = original; }
    }
  };\n${hook}`);
  let building = read('src/building_overlay.js');
  const buildingHook = 'global.BuildingOverlay = { draw, enabled, setEnabled };';
  if (!building.includes(buildingHook)) throw new Error('Cannot find building painter export');
  building = building.replace(buildingHook, 'global.BuildingOverlay = { draw, enabled, setEnabled, rebuild };');
  const functionText = (source, name, indent = '') => {
    const start = source.indexOf(indent + 'function ' + name + '(');
    const end = source.indexOf('\n' + indent + '}', start);
    if (start < 0 || end < 0) throw new Error('Cannot extract painter dependency ' + name);
    return source.slice(start, end + indent.length + 2);
  };
  const render = read('src/render.js');
  const renderValues = {};
  for (const key of ['BUILDING_FACE_COLOR', 'BUILDING_FACE_PX', 'GRID_LINE']) {
    const match = render.match(new RegExp('const ' + key + ' = (\\{[^\\n]+\\});'));
    if (!match) throw new Error('Cannot find building appearance ' + key);
    renderValues[key] = vm.runInNewContext('(' + match[1] + ')');
  }
  return `/* Generated from the shipping Canvas2D painters. No network dependencies. */
;(function(global) {
  const window = {};
  const WorldGen = { PATH_CLASSES: new Set(['path','footway','track','pedestrian','cycleway','steps']), T: { WATER:3 } };
  const SpriteLayout = { CELL_PX:32 };
  const CELL_PX = 32;
  const COLORS = ${JSON.stringify(colors)};
  const MAP_ART_BUILDING_PROPOSAL = ${JSON.stringify(buildingProposal)};
  const MAP_ART_GROUND_PROPOSALS = ${JSON.stringify(groundProposals)};
  const MAP_ART_GROUND_PATTERN_OPACITY = ${JSON.stringify(groundPatternOpacity)};
  const { UI_TREASURE, UI_LAMP_GOLD, UI_LAMP_GLOW } = ${JSON.stringify(tokens)};
  const lerp = (a,b,t) => a + (b-a)*t;
  const clamp = (value,lo,hi) => Math.max(lo,Math.min(hi,value));
  const cssOf = n => '#' + (n >>> 0).toString(16).padStart(6,'0');
  const Render = ${JSON.stringify(renderValues)};
  const _reviewSalt = 0;
${functionText(read('src/worldgen.js'), 'makeRng', '  ')}
  WorldGen.makeRng = makeRng;
${functionText(util, 'rgbaOf')}
${functionText(util, 'luminance')}
  const overlayProjection = () => ({ projX:x=>x,projY:y=>y,minX:-64,maxX:192,minY:-64,maxY:192 });
${read('src/biome_profiles.js')}
  const BiomeProfiles = window.BiomeProfiles;
${read('src/textures.js').replace('const TILLED_COLOR =', 'let TILLED_COLOR =')}
${road}
${building}
${read('tools/map_art_procedural.js')}
})(globalThis);\n`;
}

module.exports = { bundle };
if (require.main === module) process.stdout.write(bundle());
