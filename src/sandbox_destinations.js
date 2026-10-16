// Shared destinations for sandbox query strings and design-dashboard links.
// Positions stay in sandbox.js; these names refer to its scenes and captions.
(function (root) {
  const scriptURL = typeof document !== 'undefined' ? document.currentScript?.src : null;
  const gameURL = scriptURL ? new URL('../index.html', scriptURL).href : 'index.html';
  const entries = [
    { id: 'cave-rock', label: 'L1 mining and flint', scene: 'ROCK', depth: 1 },
    { id: 'flint-field', label: 'Flint Field', scene: 'FLINT_FIELD' },
    { id: 'services', label: 'Service counters', scene: 'SERVICES' },
    ...[['inn', 'INN'], ['chapel', 'CHAPEL'], ['training', 'TRAINING'], ['sports-service', 'SPORTS'],
      ['guild', 'GUILD'], ['curio', 'CURIO'], ['general-store', 'GENERAL STORE'],
      ['book-club', 'BOOK CLUB'], ['apothecary', 'APOTHECARY'], ['bank', 'BANK']]
      .map(([id, sub]) => ({ id, label: sub, scene: 'SERVICES', sub })),
    ...['SWOOP', 'TRAPS', 'LUNGE', 'THEFT', 'FLEE', 'ENGULF', 'SPLIT', 'BREATH', 'BLAST', 'ELITE', 'POSSESSED', 'ASCENDANT']
      .map(sub => ({ id: `combat-${sub.toLowerCase()}`, label: sub, scene: 'COMBAT', sub })),
    { id: 'plaza', label: 'Player plaza', scene: 'PLAZA', aliases: ['grass', 'home'] },
    { id: 'encounters', label: 'Recent enemy encounters', scene: 'RESTORATION', sub: 'RECENT ENEMIES' },
    { id: 'strip-mine', label: 'Strip mine', scene: 'QUARRY', sub: 'STRIP MINE' },
    { id: 'ruins', label: 'Ruin walls', scene: 'QUARRY', sub: 'RUIN WALLS' },
    { id: 'restoration', label: 'Restoration and recent enemies', scene: 'RESTORATION' },
    { id: 'meadow', label: 'Meadow', scene: 'ZONES', sub: 'MEADOW' },
    { id: 'crater', label: 'Destroyed crater', scene: 'ZONES', sub: 'CRATER', aliases: ['quarry-crater'] },
    { id: 'hazards', label: 'Webs and sinkhole', scene: 'HAZARDS' },
    { id: 'cave-entrance', label: 'Cave entrance and return stairs', scene: 'HAZARDS', sub: 'CAVE ENTRANCE' },
    { id: 'cavein', label: 'Cave-in warning', scene: 'HAZARDS', sub: 'CAVE-IN ARRIVAL', depth: 1 },
    { id: 'hazards-cave', label: 'Cave hazard lab', scene: 'HAZARDS', depth: 1 },
    { id: 'hazards-deep', label: 'Deep hazard lab', scene: 'HAZARDS', depth: 2 },
    { id: 'practice', label: 'Combat practice', scene: 'PRACTICE' },
    { id: 'forage', label: 'Herbs and poisonberries', scene: 'FORAGE' },
    { id: 'poisonberries', label: 'Poisonberry harvest and feeding', scene: 'FORAGE', sub: 'POISONBERRIES' },
    { id: 'herbs', label: 'Herbs and grass regrowth', scene: 'FORAGE', sub: 'HERBS AND REGROWTH' },
    { id: 'brewing', label: 'Magic Shop brewing', scene: 'RESTORATION', sub: 'MAGIC SHOP' },
    { id: 'forest', label: 'Forest', scene: 'FOREST' },
    { id: 'orchard', label: 'Orchard', scene: 'ORCHARD' },
    { id: 'rock', label: 'Ore deposits', scene: 'ROCK' },
    { id: 'barnyard', label: 'Barnyard', scene: 'BARNYARD' },
    { id: 'paddock', label: 'Petting paddock', scene: 'PADDOCK' },
    { id: 'beach', label: 'Beach and pier', scene: 'BEACH', aliases: ['sand', 'water', 'pier', 'shore'] },
    { id: 'wetland', label: 'Wetland', scene: 'MARSH', sub: 'WETLAND' },
    { id: 'golf', label: 'Golf course', scene: 'MARSH', sub: 'GOLF' },
    { id: 'farmland', label: 'Farmland', scene: 'FARMLAND', aliases: ['farm'] },
    { id: 'residential', label: 'Residential street', scene: 'RESIDENTIAL', aliases: ['wasteland'] },
    { id: 'school', label: 'School', scene: 'CIVIC', sub: 'SCHOOL' },
    { id: 'commercial', label: 'Commercial block', scene: 'CIVIC', sub: 'COMMERCIAL' },
    { id: 'industrial', label: 'Industrial block', scene: 'CIVIC', sub: 'INDUSTRIAL' },
    { id: 'smallhouse', label: 'Houses', scene: 'SMALLHOUSE', aliases: ['building'] },
    { id: 'park', label: 'Park', scene: 'RECREATION', sub: 'PARK' },
    { id: 'playground', label: 'Playground', scene: 'RECREATION', sub: 'PLAYGROUND' },
    { id: 'pitch', label: 'Sports pitch', scene: 'RECREATION', sub: 'PITCH' },
    { id: 'castle', label: 'Castle', scene: 'CASTLE', sub: 'CASTLE', aliases: ['building_large'] },
    { id: 'open-fort', label: 'Unlocked fort slots', scene: 'CASTLE', sub: 'OPEN FORT' },
    { id: 'fort', label: 'Fort', scene: 'CASTLE', sub: 'FORT', aliases: ['building_med'] },
    { id: 'grove', label: 'Sacred grove', scene: 'ZONES', sub: 'SACRED GROVE', aliases: ['ancient_grove'] },
    { id: 'stones', label: 'Old stones', scene: 'ZONES', sub: 'OLD STONES', aliases: ['churchyard', 'ordered_graves'] },
    { id: 'tar', label: 'Tar yard', scene: 'ZONES', sub: 'TAR YARD', aliases: ['tar_yard', 'black_ring'] },
    ...[
      ['hedgerow', 'Hedgerow'], ['lantern', 'Lantern row'], ['burned', 'Burned row'],
      ['toadstool', 'Toadstool lane'], ['overgrown', 'Overgrown road'],
      ['orchard', 'Orchard road'], ['pilgrim', 'Pilgrim road'], ['golden', 'Golden road'],
      ['thorny', 'Thorny Way'], ['snare', 'Snare lane'], ['goblin_gang', 'Goblin Gang Street'], ['barricade', 'Barricade road'],
    ].map(([variant, label]) => ({ id: `${variant}-road`, label, road: variant,
      aliases: [`road:${variant}`, ...(variant === 'orchard' ? [] : [variant])] })),
    { id: 'parkpath', label: 'Park path', roadName: 'Common Walk', aliases: ['path', 'road:parkpath'] },
    { id: 'trade-road', label: 'Old trade road', roadName: 'Old Trade Road', aliases: ['road_md', 'road:street_bandit'] },
    { id: 'ancient-highway', label: 'Ancient highway', roadName: 'Ancient Highway', aliases: ['road_lg', 'road:major', 'road:street_highway'] },
    { id: 'market-road', label: 'Market close', roadName: 'Market Close', aliases: ['road', 'road:minor'] },
  ];
  const normalize = value => String(value || '').trim().toLowerCase().replace(/[ _]+/g, '-');
  const byName = new Map();
  for (const entry of entries) for (const name of [entry.id, entry.label, ...(entry.aliases || [])]) {
    byName.set(normalize(name), entry);
  }
  const find = key => byName.get(normalize(key)) || null;
  function href(key) {
    const entry = find(key);
    return entry ? `${gameURL}?sandbox=true&sandboxZone=${encodeURIComponent(entry.id)}` : null;
  }
  root.SandboxDestinations = { entries, find, href };
})(typeof globalThis !== 'undefined' ? globalThis : this);
