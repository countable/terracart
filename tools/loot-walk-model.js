#!/usr/bin/env node
// Offline fixture census. The dashboard only reads the resulting small JSON.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
function loadGame() {
  const inert = new Proxy(function () {}, { get: (_, key) => key === Symbol.toPrimitive ? () => 0 : key === 'prototype' ? {} : inert, apply: () => inert, construct: () => inert });
  const context = { console, TextDecoder, Uint8Array, Uint16Array, Uint32Array, Float32Array, Float64Array, ArrayBuffer, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    performance: { now: () => Date.now() }, Phaser: inert, navigator: {}, location: { search: '', hostname: 'localhost' },
    document: { addEventListener() {}, getElementById: () => null, createElement: () => inert, documentElement: inert, body: inert },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, innerWidth: 390, innerHeight: 844,
    btoa: s => Buffer.from(s, 'latin1').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('latin1') };
  context.window = context; context.self = context;
  const ctx = vm.createContext(context);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="(src\/[^"?]+)(?:\?[^"]*)?"><\/script>/g)].map(m => m[1]);
  files.push('src/app.js');
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  vm.runInContext('disableSave();', ctx);
  return ctx;
}
function buildModel(ctx = loadGame()) {
  ctx.fixtureInputs = Array.from({ length: 9 }, (_, i) => {
    const tx = 2753 + i % 3, ty = 5565 + Math.floor(i / 3);
    return { tx, ty, bytes: new Uint8Array(fs.readFileSync(path.join(ROOT, 'test/fixtures', `${tx}_${ty}.pbf`))) };
  });
  return vm.runInContext(`(${census.toString()})()`, ctx);
}
function census() {
  const distancesM = [100, 500, 1000, 2000, 3000, 5000, 10000, 15000, 20000];
  const EDGE = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(5566));
  const home = { x: (2754 + 60.5) * EDGE, y: (5566 + 60.5) * EDGE };
  HomeArea.setOrigin(home.x, home.y);
  WorldGen.tileCache.clear();
  const scene = Object.create(MapScene.prototype);
  Object.assign(scene, { tileEdgeM: EDGE, depth: 0, save: {}, startWorldM: home, playerM: { x: 0, y: 0 },
    mPerPx: EDGE / WorldGen.TILE_PX, originPx: { x: home.x / (EDGE / WorldGen.TILE_PX), y: home.y / (EDGE / WorldGen.TILE_PX) },
    cellM: WorldGen.CELL_M, cellsForRow: WorldGen.cellsPerEdgeForTile, cellsPerTile: WorldGen.cellsPerEdgeForTile(5566),
    cellPx: 32, feetOffsetM: 0, peekM: { x: 0, y: 0 }, _popEnergy() {}, _cropRaidable: [], flash() {}, flashLoot() {} });
  const entries = fixtureInputs.map(({ tx, ty, bytes }) => {
    const layers = MVT.decodeTile(bytes), N = WorldGen.cellsPerEdgeForTile(ty);
    const e = Object.assign({ tx, ty, cellsPerEdge: N, tileEdgeM: EDGE, layers }, WorldGen.rasterizeTile(layers, N, tx, ty, EDGE));
    WorldGen.tileCache.set(WorldGen.tileKey(tx, ty), e);
    return e;
  });
  for (const e of entries) scene.spawnInTile(e, e.tx, e.ty);
  let walkableAreaM2 = 0;
  for (const e of entries) for (const cell of e.grid) if (WorldGen.isWalkable(cell)) walkableAreaM2 += (EDGE / e.cellsPerEdge) ** 2;
  const assumptions = { corridorWidthM: 40, routeEfficiency: 0.7, formula: 'count × (1 − exp(−distanceM × corridorWidthM × routeEfficiency / walkableAreaM2))',
    strategy: 'Exploration with occasional backtracking; interact with every discovered modeled reward once; successfully defeat discovered enemies.',
    scope: 'Surface roaming census; Home placed outside sample to avoid mixing starter guarantees into density. No caves, daily restocks, quest rewards, fixed starter rewards, skill gates, combat time or capacity limits. Distance is cumulative in-game walking, not radius from Home.',
    caveat: 'Uniform encounter exposure is an assumption, not a pathfinding simulation. Roads, clusters and player choices cause variation; 40 m search width and 70% efficiency are tunable estimates.' };
  const counts = n => distancesM.map(d => n * -Math.expm1(-d * assumptions.corridorWidthM * assumptions.routeEfficiency / walkableAreaM2));
  const rows = new Map(), sources = new Map(), enemies = new Map(), elites = new Map(), excluded = {};
  const bump = (id, label, source) => {
    if (!rows.has(id)) rows.set(id, { id, label, count: 0 });
    rows.get(id).count++;
    if (source) {
      const key = JSON.stringify(source);
      if (!sources.has(key)) sources.set(key, { id: 'source-' + sources.size, label, ...source, count: 0 });
      sources.get(key).count++;
    }
  };
  for (const e of entries) {
    const seen = new Set();
    for (const o of [...(e.objects || []), ...(e.zoneDress?.objects || [])]) {
      if (!o || seen.has(o.id)) continue; seen.add(o.id);
      if (o.kind === 'chest' && !(o.depth > 0)) {
        const look = chestLook(o);
        if (look.barrel) {
          const profile = barrelProfile(o);
          bump('barrel-' + profile.name, profile.name, { kind: 'barrel', object: { kind: o.kind, poiClass: o.poiClass, barrelDensity: o.barrelDensity, barrel: o.barrel, barrelStyle: profile.texKey }, profile: profile.name });
        } else if (look.macro?.kind === 'chapel') bump('chapel', 'Chapel alms', { kind: 'reward', context: 'chest:' + chestThemeForPoi(o.poiClass), opts: { tier: Macros.chapelRollTier(o), depth: 0 } });
        else if (look.bike || look.stand || look.macro) { const key = look.bike ? 'bike loan' : look.stand ? 'market stall' : look.macro.kind; excluded[key] = (excluded[key] || 0) + 1; }
        else if (o.crate || o.fixedLoot) { excluded['fixed supplies/rewards'] = (excluded['fixed supplies/rewards'] || 0) + 1; }
        else {
          const tier = chestTier(o), theme = chestThemeFor(o);
          bump('chest-t' + tier, 'Chest · tier ' + tier, { kind: 'reward', context: 'chest:' + theme, opts: { tier, depth: 0, venueProduct: venueProductFor(o) } });
        }
      } else if (o.kind === 'headstone' && Zones.headstoneHoards(o.id)) bump('headstone', 'Headstone hoards', { kind: 'reward', context: Zones.HEADSTONE_CONTEXT, opts: { tier: Zones.HEADSTONE_TIER, depth: 0 }, treasureGrant: true });
      else if (o.kind === 'grove_shrine') {
        const shrine = Shrines.kindForObject(o);
        if (shrine.reward === 'treasure') bump('shrine', 'Grove shrine gifts', { kind: 'reward', context: Zones.SHRINE_CONTEXT, treasureGrant: true });
        else if (shrine.reward === 'coins' && !shrine.fillScreen) bump('shrine-coins', 'Coin shrine payouts', { kind: 'coins', amount: potCoinsFor(o.poiDensity) });
        else excluded['shrine service/boon'] = (excluded['shrine service/boon'] || 0) + 1;
      }
      else if (o.kind === 'vista_scope') excluded['viewpoint scope (first-visit bag omitted)'] = (excluded['viewpoint scope (first-visit bag omitted)'] || 0) + 1;
    }
    const treasureIds = new Set();
    for (const t of [e.treasure, ...(e.parkingTreasures || []), ...(e.extraTreasures || [])]) {
      if (!t || treasureIds.has(t.id)) continue; treasureIds.add(t.id);
      bump('buried', 'Buried treasure marks', { kind: 'reward', context: 'treasure:default', opts: { depth: 0, ...(t.rollBonus > 0 ? { rollBonus: t.rollBonus } : {}) }, treasureGrant: true });
    }
    for (const enemy of e.creatures || []) if (Combat.isEnemyKind(enemy.kind)) {
      enemies.set(enemy.kind, (enemies.get(enemy.kind) || 0) + 1);
      const elite = Combat.isElite(enemy);
      const treasureChance = !elite && Combat.isMonster(enemy.kind) && Combat.spawnsUnderground(enemy.kind) ? Combat.MONSTER_TREASURE_CHANCE : 0;
      const dropId = SpriteLayout.creatureDrop(enemy.kind);
      bump('enemy-wages', 'Enemy kills / bounty payouts', { kind: 'enemy', enemyKind: enemy.kind, elite, eliteRank: enemy.eliteRank,
        amount: Combat.enemyBounty(enemy.kind, 0, Combat.powerMul(enemy) * (enemy._splitShare ?? 1)), dropId, treasureChance, shinyBonusAmount: enemy.shiny && dropId ? Math.max(10, Math.round(itemValue(enemy.kind) * 10)) : 0 });
      if (treasureChance) {
        bump('enemy-bonus', 'Enemy bonus treasure rolls');
        rows.get('enemy-bonus').probability = treasureChance;
      }
      if (dropId) bump('enemy-items', 'Enemy fixed item drops');
      if (elite) elites.set(enemy.kind, (elites.get(enemy.kind) || 0) + 1);
    }
  }
  if (elites.size) rows.set('elite-bonus', { id: 'elite-bonus', label: 'Elite signature drops', count: [...elites.values()].reduce((a,n) => a+n,0),
    expected: counts(1).map(p => [...elites.values()].reduce((s,n) => s + n*p,0)) });
  assumptions.combatNote = 'Every encountered enemy is defeated by the player and its coins collected; actual bounties, fixed drops and eligible 10% bonus rolls. Every elite grants a signature drop; the first of each kind also grants a memory.';
  assumptions.newStreetShare = 0.7;
  assumptions.roadMetresMultiplier = Trail.STICK_METRES_MUL;
  assumptions.roadNote = 'Normal non-Runner, keyboard/stick walking; 70% of travel restores new street, credited at shipping 40%; no scenic/boots bonuses. Road thresholds are conditional estimates.';
  const trailCounts = distancesM.map(d => Trail.bank(0, 0, d * assumptions.newStreetShare * assumptions.roadMetresMultiplier).prizes);
  rows.set('trail', { id: 'trail', label: 'Road prizes (keep one card)', count: null, expected: trailCounts, method: 'restoration ladder' });
  for (let n = 1; n <= trailCounts.at(-1); n++) sources.set('trail-' + n, { id: 'trail-' + n, label: 'Road prize ' + n, kind: 'trail', prizeNumber: n, count: 1, expected: trailCounts.map(v => v >= n ? 1 : 0) });
  const milestones = [
    { label: 'Starter loop', trigger: 'Open supplies → till → plant → restore a house → harvest → sell at Home; event driven, no fixed walking distance.', source: 'src/quests.js:STARTER_CHAIN' },
    { label: 'First tower unlock', trigger: MemoryStory.START_MEMORIES + ' lifetime memories plus visiting the restored tower.', source: 'src/memory_story.js:START_MEMORIES' },
    { label: 'Next tower chapter', trigger: MemoryStory.LEAVE_MEMORIES + ' lifetime memories and tower story progress.', source: 'src/memory_story.js:LEAVE_MEMORIES' },
    { label: 'Second tower revelation', trigger: MemoryStory.REVEAL_MEMORIES + ' lifetime memories plus visiting the second tower.', source: 'src/memory_story.js:REVEAL_MEMORIES' },
  ];
  return { version: 1, distancesM, milestones, source: { tileIds: entries.map(e => e.tx + '/' + e.ty), tileEdgeM: EDGE, areaM2: entries.length * EDGE ** 2, walkableAreaM2, difficulty: Difficulty.mode(), method: 'MVT.decodeTile → WorldGen.rasterizeTile → MapScene.spawnInTile; same roaming setup as tools/map-distribution.js' }, assumptions,
    coverage: counts(1), rows: [...rows.values()].map(r => ({ ...r, expected: r.expected || counts(r.count * (r.probability ?? 1)) })).sort((a,b) => a.id.localeCompare(b.id)),
    rewardSources: [...sources.values()].map(({opts, ...r}) => ({ ...r, ...(opts ? { options: opts } : {}), expected: r.expected || counts(r.count) })),
    enemies: [...enemies].map(([kind,count]) => ({ kind,count,expected:counts(count) })).sort((a,b) => b.count-a.count), excluded };
}
if (require.main === module) {
  const context = loadGame();
  const model = buildModel(context);
  model.source.generatedAt = new Date().toISOString();
  model.source.revision = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const out = process.argv[2] || path.join(__dirname, 'data', 'loot-walk-model.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
  const rewards = require('./loot-walk-rewards').buildRewards(context, model);
  fs.writeFileSync(path.join(path.dirname(out), 'loot-walk-rewards.json'), JSON.stringify(rewards, null, 2) + '\n');
  console.log(JSON.stringify({ out, rows: model.rows, enemies: model.enemies, source: model.source }, null, 2));
}
module.exports = { loadGame, buildModel };
