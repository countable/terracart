#!/usr/bin/env node
// Export a real parking-lane rasterization and zone-dressing fixture. The
// dashed source lines are an audit aid only; runtime roads stay removed.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..'), ctx = { console, performance, addEventListener() {} };
ctx.window = ctx;
vm.createContext(ctx);
for (const name of ['enemy_roster', 'sprite_layout', 'util', 'zone_variant_data', 'zone_variants', 'streets', 'street_variants', 'biome_profiles', 'items', 'interactables', 'zones', 'zone_coverage', 'zone_dressing', 'worldgen', 'scenic', 'road_overlay']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
}
// Candidate compositions belong only to this export tool, never shipping data.
const draftId = process.argv[2];
const settings = JSON.parse(fs.readFileSync(path.join(root, 'docs/art/quarry-variants.draft.json'), 'utf8'));
const {min: minPatch, max: maxPatch} = settings.patchSizeCells;
const foundationSize = settings.foundationSizeCells;
const draftIds = ['quarry-crater', 'quarry-abandoned', 'quarry-strip-mine', 'quarry-stronghold'];
if (draftId && !draftIds.includes(draftId)) throw new Error(`Unknown quarry preview: ${draftId}`);
const WG = ctx.WorldGen, tx = 2622, ty = 5615, extent = 4096;
const N = WG.cellsPerEdgeForTile(ty), tileEdgeM = N * WG.CELL_M;
const side = 37, origin = Math.floor((N - side) / 2);
const cell = (x, y) => ({ x: (origin + x + .5) * extent / N, y: (origin + y + .5) * extent / N });
const source = [[[7,8],[28,8]],[[7,15],[28,15]],[[7,22],[28,22]],[[7,29],[28,29]],[[7,8],[7,29]]];
const layers = [
  { name: 'landuse', extent, features: [{ type: 3, tags: { class: 'residential' },
    geom: [[cell(-1,-1),cell(side,-1),cell(side,side),cell(-1,side),cell(-1,-1)]] }] },
  { name: 'transportation', extent, features: [{ type: 2,
    tags: { class: 'service', service: 'parking_aisle' }, geom: source.map(line => line.map(([x,y]) => cell(x,y))) }] },
];
const tile = WG.rasterizeTile(layers, N, tx, ty, tileEdgeM);
const anchors = tile.zone?.anchors || [], coverage = [];
for (let y=0;y<side;y++) for(let x=0;x<side;x++) {
  const i=(origin+y)*N+origin+x;
  if (anchors[(tile.zone?.coverage?.[i] || 0)-1]?.kind === 'quarry') coverage.push([x,y]);
}
if (!coverage.length) throw new Error('Parking lanes produced no Quarry coverage');
let objects = (tile.zoneDress?.objects || []).filter(o=>o.zoneVariant==='quarry').map(o=>({
  cell:[Math.floor((o.x-tx*tileEdgeM)/WG.CELL_M)-origin,Math.floor((o.y-ty*tileEdgeM)/WG.CELL_M)-origin],
  material:o.deposit==='crystal'?'crystal':'stone',
}));
if (!objects.length) throw new Error('Quarry fixture produced no background rocks');
if ((tile.streetIndex?.lines || []).length) throw new Error('Removed parking lanes survived as roads');
const terrain = [], landmarks = [];
if (draftId) {
  objects = [];
  const covered = new Set(coverage.map(c => c.join(','))), occupied = new Set();
  // Cell-local hash keeps the same fixture stable across exports and additions.
  const noise = (x, y, salt = 0) => {
    let h = Math.imul(x + 173, 374761393) ^ Math.imul(y + 719, 668265263) ^ salt;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const place = (x, y, material) => {
    const key = `${x},${y}`;
    if (!covered.has(key) || occupied.has(key)) return false;
    occupied.add(key);
    objects.push({ cell: [x, y], material });
    return true;
  };
  // Pack whole, small compositions into the footprint. Leave a cell between
  // modules; never crop a foundation wall or doorway at the coverage edge.
  const reserved = new Set();
  const fits = (left, top, size) => {
    for (let y=top; y<top+size; y++) for (let x=left; x<left+size; x++) {
      if (!covered.has(`${x},${y}`) || reserved.has(`${x},${y}`)) return false;
    }
    return true;
  };
  if (draftId !== 'quarry-crater') for (let top=0; top<side; top++) for (let left=0; left<side; left++) {
    const preferred = draftId === 'quarry-stronghold' ? foundationSize : minPatch + Math.floor(noise(left, top, 97) * (maxPatch-minPatch+1));
    let size = preferred;
    while (size >= minPatch && !fits(left, top, size)) size--;
    if (size < minPatch || (draftId === 'quarry-stronghold' && size !== foundationSize)) continue;
    for (let y=top-1; y<=top+size; y++) for (let x=left-1; x<=left+size; x++) reserved.add(`${x},${y}`);
    const right=left+size-1, bottom=top+size-1;
    const cx=left+Math.floor(size/2), cy=top+Math.floor(size/2);
    const module = { kind: 'patch', bounds: [left,top,right,bottom], size };
    landmarks.push(module);
    if (draftId === 'quarry-abandoned') {
      for (let y=top; y<=bottom; y++) for (let x=left; x<=right; x++) {
        if (x!==cx && (y===top || x===left) && noise(x,y,71)<.65) place(x,y,'stone');
      }
      place(cx,cy,noise(left,top,41)<.5?'equipment':'driftwood');
    } else if (draftId === 'quarry-strip-mine') {
      for (let y=top; y<=bottom; y+=2) for (let x=left; x<=right; x++) {
        if (x!==cx) place(x,y,'stone');
      }
    } else if (draftId === 'quarry-stronghold') {
      module.kind='foundation';
      module.doors=[[cx,bottom]];
      for (let y=top; y<=bottom; y++) for (let x=left; x<=right; x++) {
        if ((x===left || x===right || y===top || y===bottom) && !(x===cx && y===bottom)) place(x,y,'stone');
      }
    }
  }
  // Keep finite finds site-wide, so smaller repeating modules do not multiply
  // the rewards or guards. Put them inside separate modules where possible.
  const centres=landmarks.map(m=>[m.bounds[0]+Math.floor(m.size/2),m.bounds[1]+Math.floor(m.size/2)]);
  if (draftId==='quarry-crater') {
    // A single elliptical crater follows the available footprint's dimensions.
    // Clip its fractured rim and vents to coverage, never to a fixed patch grid.
    const xs=coverage.map(c=>c[0]), ys=coverage.map(c=>c[1]);
    const left=Math.min(...xs), right=Math.max(...xs), top=Math.min(...ys), bottom=Math.max(...ys);
    const cx=(left+right)/2, cy=(top+bottom)/2;
    const rx=Math.max(1,(right-left)/2-1), ry=Math.max(1,(bottom-top)/2-1);
    landmarks.push({kind:'crater',bounds:[left,top,right,bottom],centre:[cx,cy],radii:[rx,ry]});
    const bowl=[];
    for (const [x,y] of coverage) {
      const distance=Math.hypot((x-cx)/rx,(y-cy)/ry);
      const entrance=y>cy && Math.abs(x-cx)<=Math.max(1,rx*.12);
      if (distance>=.82 && distance<=1.04 && !entrance && noise(x,y)<.78) place(x,y,'stone');
      if (distance<.65 && !entrance) bowl.push([x,y]);
    }
    const vents=bowl.filter(([x,y])=>noise(x,y,23)<.035);
    for (const cell of vents) terrain.push({cell,kind:'lava'});
    const finds=bowl.sort((a,b)=>noise(...a,59)-noise(...b,59)).slice(0,2);
    for (const [x,y] of finds) place(x,y,'crimson_ore');
  } else if (draftId==='quarry-abandoned') {
    for (const [x,y] of centres.slice(0,2)) place(x,y+1,'tool_crate');
  } else if (draftId==='quarry-strip-mine') {
    // The previous sample's vein rule is retained as the reference abundance.
    // Keep one quarter of its candidates; the remaining deposits are stone.
    const candidates=objects.filter(o=>{
      const [x,y]=o.cell;
      return (x+y)%7===0 || (y%7===2 && x>23);
    }).sort((a,b)=>noise(...a.cell,113)-noise(...b.cell,113));
    const target=Math.round(candidates.length*settings.sapphireAbundanceMultiplier);
    for (const o of candidates.slice(0,target)) o.material='crystal';
  } else if (draftId==='quarry-stronghold') {
    for (const [x,y] of centres.slice(0,3)) place(x,y,'goblin');
    for (const [x,y] of centres.slice(0,3)) place(x+1,y,'treasure_x');
    for (const foundation of landmarks) for (const door of foundation.doors) {
      if (!covered.has(door.join(',')) || occupied.has(door.join(','))) throw new Error('Blocked foundation doorway');
    }
  }
  for (const object of objects) if (!covered.has(object.cell.join(','))) throw new Error('Object outside quarry coverage');
  if (new Set(objects.map(o => o.cell.join(','))).size !== objects.length) throw new Error('Overlapping quarry objects');
  const count = material => objects.filter(o => o.material === material).length;
  if (draftId === 'quarry-crater' && count('crimson_ore') !== 2) throw new Error('Crater requires two crimson ore deposits');
  if (draftId === 'quarry-abandoned' && count('tool_crate') !== 2) throw new Error('Abandoned quarry requires two one-off tool crates');
  if (draftId === 'quarry-stronghold' && (count('goblin') !== 3 || count('treasure_x') !== 3)) throw new Error('Stronghold requires three goblins and three X marks');
}
process.stdout.write(JSON.stringify({ side, bufferM: ctx.ZoneCoverage.QUARRY_BUFFER_M, coverage,
  sourceLines:source.map(line=>line.map(([x,y])=>[x+.5,y+.5])), objects,
  ...(draftId ? { draftId, terrain, landmarks } : {}) }));
