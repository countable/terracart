#!/usr/bin/env node
// Render-mechanics profile: boots the shipping game in test/perf.html and
// compares steady-state render work after deterministic sandbox setup.
//
//   node tools/perf_mechanics.js [out.json]
//
// PROFILE_MS and BENCH_FRAMES tune the run. SCENARIOS accepts comma-separated
// names and includes their matched controls. PW_CHROMIUM selects Chromium.
// PORT defaults to a free port. Each scenario reloads one page in one browser,
// settles the sandbox, applies setup through shipping APIs, profiles with CDP,
// and runs a synchronous drawCells + drawObjects bench.
//
// Chromium may use Canvas when headless WebGL is unavailable. SwiftShader and
// headless cadence do not model phone GPU or battery cost. Compare scenarios
// from the same run. Read per-pass time, CPU deltas, and direct-draw deltas;
// do not treat requestAnimationFrame gaps as handset frame times.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || '/tmp/perf-mechanics/results.json');
const PROFILE_MS = +(process.env.PROFILE_MS || 6000);
const BENCH_FRAMES = +(process.env.BENCH_FRAMES || 40);
const PORT = +(process.env.PORT || 0);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function serve() {
  const server = http.createServer((req, res) => {
    let file;
    try { file = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0])); }
    catch { res.writeHead(400); return res.end(); }
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403); return res.end();
    }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

function fnKey(node) {
  const frame = node.callFrame;
  const url = (frame.url || '').replace(/^.*\//, '').replace(/\?.*$/, '');
  return `${frame.functionName || '(anonymous)'} ${url}:${frame.lineNumber + 1}`;
}

function digest(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  const self = new Map(), inclusive = new Map();
  let sampledMs = 0, idleMs = 0;
  for (let i = 0; i < (profile.samples || []).length; i++) {
    const ms = (profile.timeDeltas[i] || 0) / 1000;
    let id = profile.samples[i];
    const node = nodes.get(id);
    if (!node) continue;
    sampledMs += ms;
    if (node.callFrame.functionName === '(idle)') { idleMs += ms; continue; }
    const own = fnKey(node);
    self.set(own, (self.get(own) || 0) + ms);
    const seen = new Set();
    while (id != null) {
      const parent = nodes.get(id);
      if (!parent) break;
      const name = fnKey(parent);
      if (!seen.has(name)) inclusive.set(name, (inclusive.get(name) || 0) + ms);
      seen.add(name);
      id = parents.get(id);
    }
  }
  const top = map => [...map].sort((a, b) => b[1] - a[1]);
  return { sampledMs, idleMs, busyMs: sampledMs - idleMs, self: top(self), inclusive: top(inclusive) };
}

function normalizeBoot(snapshot) {
  return Object.fromEntries(Object.entries(snapshot.work || {}).map(([name, row]) => [name, {
    calls: row.n, avgMs: row.n ? row.sum / row.n : 0, worstMs: row.worst,
  }]));
}

async function bench(page) {
  return page.evaluate(frames => {
    const scene = window.__scene, boot = window.__boot;
    boot.reset();
    scene.drawCells(); scene.drawObjects();
    boot.reset();
    const start = performance.now();
    for (let i = 0; i < frames; i++) { scene.drawCells(); scene.drawObjects(); }
    const elapsedMs = performance.now() - start;
    const counts = Object.fromEntries(Object.entries(boot.counts).map(([name, row]) => [name, {
      calls: row.n, avg: row.n ? row.sum / row.n : 0, worst: row.worst,
    }]));
    const work = Object.fromEntries(Object.entries(boot.work).map(([name, row]) => [name, {
      calls: row.n, avgMs: row.n ? row.sum / row.n : 0, worstMs: row.worst,
    }]));
    return {
      frames, elapsedMs, warmMsPerFrame: elapsedMs / frames,
      candidates: {
        drawObjectsScanned: counts['drawObjects scanned']?.avg || 0,
        drawObjectsKept: counts['drawObjects kept']?.avg || 0,
        creaturesScanned: counts['drawObjects scanned creatures']?.avg || 0,
        crops: counts['crop candidates']?.avg || 0,
      },
      counts, work,
    };
  }, BENCH_FRAMES);
}

function idleSetup(page) {
  return page.evaluate(() => ({ mode: 'shipping sandbox state' }));
}

function nightLightsSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene, anchor = viewAnchorWorldM(scene);
    window.__DAYLIGHT = 0;
    scene.save.fires = Array.from({ length: 16 }, (_, i) => {
      const angle = i / 16 * Math.PI * 2;
      const radius = (2 + i % 4) * scene.cellM;
      return Campfires.light({
        x: anchor.x + Math.cos(angle) * radius,
        y: anchor.y + Math.sin(angle) * radius,
        depth: scene.depth || 0,
      });
    });
    if (scene.lightTex) scene.lightTex.__lightKey = null;
    return { fires: scene.save.fires.length, daylight: 0 };
  });
}

function combatCrowdSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene, anchor = playerWorldM(scene);
    const pc = scene.playerToWorldCell();
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
    const kinds = ['goblin', 'goblin_archer', 'skeleton', 'zombie', 'ghost', 'bat', 'spider'];
    const added = [];
    scene.save.immortalPotionUntil = Date.now() + 10 * 60 * 1000;
    scene.save.activeWeapon = null;
    for (let i = 0; i < 15; i++) {
      const angle = i / 15 * Math.PI * 2;
      const radius = (2.2 + (i % 3) * 0.8) * scene.cellM;
      const kind = kinds[i % kinds.length];
      const max = Combat.creatureMaxHp(kind);
      const creature = WorldGen.makeCreature(kind,
        anchor.x + Math.cos(angle) * radius,
        anchor.y + Math.sin(angle) * radius,
        `perf_combat_${kind}_${i}`,
        { depth: scene.depth || 0, shiny: i % 5 === 0, _hp: Math.max(1, max - 1) });
      entry.creatures.push(creature); added.push(creature);
    }
    return { addedEnemies: added.length, kinds: [...new Set(added.map(c => c.kind))] };
  });
}

function projectileSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene;
    scene.save.immortalPotionUntil = Date.now() + 10 * 60 * 1000;
    let serial = 0;
    const fire = () => {
      const anchor = playerWorldM(scene);
      for (let n = 0; n < 2; n++) {
        const angle = ((serial + n * 7) % 24) / 24 * Math.PI * 2;
        const slot = (serial + n) % 3 === 0 ? 'staff' : 'bow';
        const shot = Combat.spawnShot(slot, anchor.x, anchor.y,
          { x: Math.cos(angle), y: Math.sin(angle) }, scene.cellM, 1, 3, 8);
        if (shot) {
          shot._perf = true;
          shot.id = `perf_shot_${serial}_${n}`;
          scene._shots.push(shot);
        }
      }
      serial += 2;
    };
    for (let i = 0; i < 12; i++) fire();
    window.__perfScenarioTimer = setInterval(fire, 120);
    return { initialShots: scene._shots.length, shotsPerSecond: 16.7, slots: ['bow', 'staff'] };
  });
}

function particleBlastSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene, anchor = viewAnchorWorldM(scene);
    Particles.warm(scene, ['trailspark', 'timber', 'confetti', 'pain', 'rain']);
    let serial = 0, emitted = 0;
    const burst = () => {
      const angle = (serial % 12) / 12 * Math.PI * 2;
      const x = anchor.x + Math.cos(angle) * 2.5 * scene.cellM;
      const y = anchor.y + Math.sin(angle) * 2.5 * scene.cellM;
      emitted += scene._blastAt(x, y, {
        radiusCells: 2, colour: '#ff742d', sparks: 'trailspark', chips: 'timber', ringPx: 40,
      });
      const p = scene.worldMetersToScreen(x, y);
      emitted += Particles.burst(scene, serial % 2 ? 'confetti' : 'rain', p.x, p.y);
      serial++;
      window.__perfEmitted = emitted;
    };
    burst(); burst(); burst();
    window.__perfScenarioTimer = setInterval(burst, 350);
    return { initialBursts: 3, initialParticles: emitted, burstsPerSecond: 2.86,
      presets: ['trailspark', 'timber', 'confetti', 'rain'] };
  });
}

function cropsSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene, anchor = viewAnchorWorldM(scene);
    scene.save.planted = Array.from({ length: 200 }, (_, i) => {
      const ix = i % 14, iy = Math.floor(i / 14);
      return {
        x: anchor.x + (ix - 6.5) * scene.cellM,
        y: anchor.y + (iy - 6.5) * scene.cellM,
        crop: ['potato', 'carrot', 'corn', 'tomato'][i % 4],
        stage: MAX_GROWTH_STAGE,
        watered_t: 0,
        depth: scene.depth || 0,
      };
    });
    return { plantedCrops: scene.save.planted.length, uniqueCells: 196 };
  });
}

function creaturePlantCrowdSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene, anchor = viewAnchorWorldM(scene);
    const pc = scene.playerToWorldCell();
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
    const creatureKinds = ['chicken', 'cow', 'rabbit', 'deer', 'crow', 'butterfly', 'cat', 'dog'];
    const plantKinds = ['longgrass', 'shrub', 'mushroom', 'nettle'];
    for (let i = 0; i < 96; i++) {
      const ix = i % 12, iy = Math.floor(i / 12);
      entry.creatures.push(WorldGen.makeCreature(creatureKinds[i % creatureKinds.length],
        anchor.x + (ix - 5.5) * scene.cellM,
        anchor.y + (iy - 3.5) * scene.cellM,
        `perf_crowd_creature_${i}`, { depth: scene.depth || 0, shiny: false }));
    }
    for (let i = 0; i < 160; i++) {
      const ix = i % 13, iy = Math.floor(i / 13);
      entry.wildplants.push(WorldGen.makeWildplant(plantKinds[i % plantKinds.length],
        anchor.x + (ix - 6) * scene.cellM,
        anchor.y + (iy - 6) * scene.cellM,
        `perf_crowd_plant_${i}`, { _plantArt: plantKinds[i % plantKinds.length], depth: scene.depth || 0 }));
    }
    return { addedCreatures: 96, addedWildplants: 160, creatureKinds, plantKinds };
  });
}

function vinesSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene, anchor = viewAnchorWorldM(scene);
    let planted = 0;
    seats: for (let iy = -6; iy <= 6; iy++) for (let ix = -6; ix <= 6; ix++) {
      if ((ix * ix + iy * iy) > 42) continue;
      const vine = CreepingVines.plant(scene,
        anchor.x + ix * scene.cellM, anchor.y + iy * scene.cellM);
      if (vine) planted++;
      if (planted >= 80) break seats;
    }
    return { plantedVines: planted, colonyCap: CreepingVines.CONFIG.maxCells };
  });
}

function hazardsSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene;
    const fixtures = Sandbox.seedHazardState(scene, scene._sandboxHazardOrigin);
    scene.save.immortalPotionUntil = Date.now() + 10 * 60 * 1000;
    return {
      hazardFixtures: fixtures.length,
      types: fixtures.map(h => h.type || h.kind || h._sandboxProbe),
      depth: scene.depth,
    };
  });
}

function buildingSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene, snap = window.__perfSnap();
    return {
      destination: 'castle', displayChildren: snap.disp.deep,
      visibleObjectCandidates: snap.counts['drawObjects scanned']?.worst || 0,
      buildingShapes: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.buildingShapes || []).length, 0),
    };
  });
}

function dialogSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene;
    scene.showMessageModal({
      kind: 'talk', kindLabel: 'Profiler', title: 'Mechanics render profile', art: 'health_low',
      body: 'This open dialog measures the live map, compass frame, portrait, text, modal layout, and paused combat path. '.repeat(10),
    });
    return {
      modalCount: document.querySelectorAll('.game-modal').length,
      domNodes: document.querySelectorAll('*').length,
      compassHud: document.body.classList.contains('compass-hud'),
    };
  });
}

function caveRockSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene;
    const counts = { depth: scene.depth, objects: 0, wildplants: 0, creatures: 0,
      oreNodes: 0, flintNodes: 0, caveLights: 0, hazards: scene._sandboxHazardFixtures?.length || 0 };
    for (const entry of WorldGen.tileCache.values()) {
      counts.objects += (entry.objects || []).length;
      counts.wildplants += (entry.wildplants || []).length;
      counts.creatures += (entry.creatures || []).length;
      for (const object of entry.objects || []) {
        if (object.kind === 'mineralrock') counts.oreNodes++;
        if (object.rockMaterial === 'flint') counts.flintNodes++;
        if (Lighting.sourceKind(scene, object)) counts.caveLights++;
      }
      for (const plant of entry.wildplants || []) if (Lighting.sourceKind(scene, plant)) counts.caveLights++;
    }
    counts.playerLight = Lighting.playerKind(scene);
    return { underground: counts };
  });
}

function caveRockControlSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene;
    let removedOre = 0, removedLights = 0;
    for (const entry of WorldGen.tileCache.values()) {
      entry.objects = (entry.objects || []).filter(object => {
        const feature = object.kind === 'mineralrock' || !!Lighting.sourceKind(scene, object);
        if (feature) {
          if (object.kind === 'mineralrock') removedOre++;
          if (Lighting.sourceKind(scene, object)) removedLights++;
        }
        return !feature;
      });
      entry.wildplants = (entry.wildplants || []).filter(plant => {
        if (!Lighting.sourceKind(scene, plant)) return true;
        removedLights++; return false;
      });
    }
    return { underground: { depth: scene.depth, objects: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.objects || []).length, 0),
      wildplants: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.wildplants || []).length, 0),
      creatures: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.creatures || []).length, 0),
      oreNodes: 0, flintNodes: 0, caveLights: 0, hazards: scene._sandboxHazardFixtures?.length || 0,
      playerLight: Lighting.playerKind(scene), removedOre, removedLights } };
  });
}

function hazardsCaveControlSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene;
    const removed = scene._sandboxHazardFixtures?.length || 0;
    scene._environmentHazards = new Map();
    scene._pressureTraps = { plates: [], traps: [], visits: new Set() };
    scene._spiderWebRuntime = null;
    scene._sandboxHazardFixtures = [];
    for (const id of Object.keys(scene.save.caveIns || {})) {
      if (id.startsWith('sandbox-hazard:')) delete scene.save.caveIns[id];
    }
    return { underground: { depth: scene.depth,
      objects: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.objects || []).length, 0),
      wildplants: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.wildplants || []).length, 0),
      creatures: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.creatures || []).length, 0),
      oreNodes: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.objects || []).filter(o => o.kind === 'mineralrock').length, 0),
      flintNodes: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.objects || []).filter(o => o.rockMaterial === 'flint').length, 0),
      caveLights: 0, hazards: 0, removedHazards: removed, playerLight: Lighting.playerKind(scene) } };
  });
}

function hazardsCaveSetup(page) {
  return page.evaluate(() => {
    const scene = window.__scene;
    const fixtures = Sandbox.seedHazardState(scene, scene._sandboxHazardOrigin);
    const lists = EnvironmentHazards.lists(scene), pressure = PressureTraps.lists(scene);
    let caveLights = 0, oreNodes = 0, flintNodes = 0;
    for (const entry of WorldGen.tileCache.values()) {
      for (const object of entry.objects || []) {
        if (object.kind === 'mineralrock') oreNodes++;
        if (object.rockMaterial === 'flint') flintNodes++;
        if (Lighting.sourceKind(scene, object)) caveLights++;
      }
      for (const plant of entry.wildplants || []) if (Lighting.sourceKind(scene, plant)) caveLights++;
    }
    return { underground: { depth: scene.depth,
      objects: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.objects || []).length, 0),
      wildplants: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.wildplants || []).length, 0),
      creatures: [...WorldGen.tileCache.values()].reduce((n, e) => n + (e.creatures || []).length, 0),
      oreNodes, flintNodes, caveLights,
      hazards: fixtures.length, vents: lists.vents.length, caveins: lists.caveins.length,
      pressurePlates: pressure.plates.length, pressureTraps: pressure.traps.length,
      playerLight: Lighting.playerKind(scene) } };
  });
}

const scenarios = [
  { name: 'idle', zone: 'plaza', how: 'Player stands in the shipping plaza sandbox.', setup: idleSetup },
  { name: 'night_lights', zone: 'plaza', control: 'idle', how: 'Harness forces daylight to zero and places 16 active Campfires.light rows around the camera.', setup: nightLightsSetup },
  { name: 'practice_control', zone: 'practice', controlOnly: true, how: 'Matched no-setup control for practice-yard mechanics.', setup: idleSetup },
  { name: 'combat_crowd', zone: 'practice', control: 'practice_control', how: 'Harness adds 15 canonical WorldGen enemies around an immortal, unequipped player.', setup: combatCrowdSetup },
  { name: 'projectiles', zone: 'practice', control: 'practice_control', how: 'Harness maintains bow arrows and staff bolts through Combat.spawnShot at 16.7 shots/s.', setup: projectileSetup },
  { name: 'particle_blasts', zone: 'practice', control: 'practice_control', how: 'Harness repeats the shipping _blastAt path plus pooled confetti/rain bursts at 2.86 bursts/s.', setup: particleBlastSetup },
  { name: 'farmland_control', zone: 'farmland', controlOnly: true, how: 'Matched no-setup control for saved crops.', setup: idleSetup },
  { name: 'crops_200', zone: 'farmland', control: 'farmland_control', how: 'Harness places 200 mature save.planted records in the visible 14 by 15 cell area.', setup: cropsSetup },
  { name: 'forest_control', zone: 'forest', controlOnly: true, how: 'Matched no-setup control for creature and plant density.', setup: idleSetup },
  { name: 'creature_plant_crowd', zone: 'forest', control: 'forest_control', how: 'Harness adds 96 canonical neutral creatures and 160 canonical wildplants in view.', setup: creaturePlantCrowdSetup },
  { name: 'hazards_control', zone: 'hazards', controlOnly: true, how: 'Matched no-setup control for planted creeping vines.', setup: idleSetup },
  { name: 'creeping_vines', zone: 'hazards', control: 'hazards_control', how: 'Harness plants up to 80 independent colonies through CreepingVines.plant in visible eligible cells.', setup: vinesSetup },
  { name: 'hazards_deep', zone: 'hazards-deep', how: 'Sandbox.seedHazardState runs the depth-3 vent, cave-in, ball, and wall hazard fixtures.', setup: hazardsSetup },
  { name: 'cave_rock_control', zone: 'cave-rock', controlOnly: true, how: 'Matched depth-2 control with ore and placed object lights removed.', setup: caveRockControlSetup },
  { name: 'cave_rock', zone: 'cave-rock', control: 'cave_rock_control', how: 'Depth-2 mining destination keeps its authored ore, flint, and placed cave lights.', setup: caveRockSetup },
  { name: 'hazards_cave_control', zone: 'hazards-cave', controlOnly: true, how: 'Matched depth-2 control with runtime hazard fixtures cleared.', setup: hazardsCaveControlSetup },
  { name: 'hazards_cave', zone: 'hazards-cave', control: 'hazards_cave_control', how: 'Depth-2 hazard lab runs its shipping vent and pressure-trap fixtures.', setup: hazardsCaveSetup },
  { name: 'dense_castle', zone: 'castle', how: 'Player stands at the authored castle destination with live building overlays and objects.', setup: buildingSetup },
  { name: 'dialog_hud', zone: 'plaza', control: 'idle', how: 'The shipping showMessageModal path holds a long illustrated talk over the compass HUD.', setup: dialogSetup },
];
const requestedScenarios = new Set(String(process.env.SCENARIOS || '').split(',').map(s => s.trim()).filter(Boolean));
if (requestedScenarios.size) {
  requestedScenarios.add('idle');
  for (const scenario of scenarios) if (requestedScenarios.has(scenario.name) && scenario.control) requestedScenarios.add(scenario.control);
}
const runScenarios = requestedScenarios.size
  ? scenarios.filter(scenario => requestedScenarios.has(scenario.name)) : scenarios;

function collectErrors(page, state) {
  page.on('pageerror', error => state.pageErrors.push({ scenario: state.current, text: String(error) }));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text(), url = message.location().url || '';
    if (/^Failed to load resource:.*\b(?:404|504)\b/.test(text)
      && (/\/test\/fixtures\//.test(url) || /tiles\.openfreemap\.org\//.test(url) || /favicon\.ico/.test(url))) return;
    state.consoleErrors.push({ scenario: state.current, text, url });
  });
}

async function waitReady(page) {
  await page.evaluate(() => window.__perfReady);
  await page.waitForFunction(() => window.__scene?.cellsPerTile && window.__perfSnap, null, { timeout: 30000 });
}

function topFunctionDeltas(scenario, idle) {
  const normalize = result => {
    const frames = Math.max(1, result.frameCounts.updates);
    return new Map(result._cpuSelf.map(([name, ms]) => [name, ms / frames]));
  };
  const base = normalize(idle), current = normalize(scenario), out = [];
  for (const [name, ms] of current) {
    const delta = ms - (base.get(name) || 0);
    if (delta > 0.005) out.push({ name, addedMsPerUpdate: delta });
  }
  return out.sort((a, b) => b.addedMsPerUpdate - a.addedMsPerUpdate).slice(0, 5);
}

function makeAnalysis(results) {
  const byName = new Map(results.scenarios.map(row => [row.name, row]));
  const idle = byName.get('idle');
  if (!idle) return [];
  return results.scenarios.filter(row => !row.controlOnly).map(row => {
    const controlName = row.control || 'idle';
    const control = byName.get(controlName) || idle;
    return {
      name: row.name, control: controlName,
      addedBusyMsPerUpdate: row.cpuDigest.busyMsPerUpdate - control.cpuDigest.busyMsPerUpdate,
      addedUpdateMs: (row.bootTicks['update (all)']?.avgMs || 0) - (control.bootTicks['update (all)']?.avgMs || 0),
      addedRenderMs: (row.bootTicks['phaser render']?.avgMs || 0) - (control.bootTicks['phaser render']?.avgMs || 0),
      addedBenchMs: row.bench.warmMsPerFrame - control.bench.warmMsPerFrame,
      addedBusyVsIdleMsPerUpdate: row.cpuDigest.busyMsPerUpdate - idle.cpuDigest.busyMsPerUpdate,
      topFunctionDeltas: topFunctionDeltas(row, control),
    };
  }).sort((a, b) => b.addedBusyMsPerUpdate - a.addedBusyMsPerUpdate);
}

async function main() {
  if (!(PROFILE_MS > 0) || !(BENCH_FRAMES > 0)) throw new Error('PROFILE_MS and BENCH_FRAMES must be positive');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const server = await serve();
  const results = {
    environment: {
      profileMs: PROFILE_MS, benchFrames: BENCH_FRAMES,
      browser: process.env.PW_CHROMIUM || '/usr/bin/chromium',
      note: 'Headless Chromium with SwiftShader flags. Compare scenarios within this run; GPU and battery cost are not measured.',
    },
    scenarios: [], pageErrors: [], consoleErrors: [], skipped: [],
  };
  const errorState = { current: 'boot', pageErrors: results.pageErrors, consoleErrors: results.consoleErrors };
  let browser;
  try {
    const executablePath = process.env.PW_CHROMIUM || '/usr/bin/chromium';
    browser = await chromium.launch({ executablePath, headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    collectErrors(page, errorState);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });

    for (const scenario of runScenarios) {
      errorState.current = scenario.name;
      const url = `http://127.0.0.1:${server.address().port}/test/perf.html?` + new URLSearchParams({
        sandbox: 'true', sandboxZone: scenario.zone, reset: 'true', skipStory: 'true',
        skipTutorial: 'true', overpass: 'off',
      });
      console.log(`\n[${scenario.name}] loading ${scenario.zone}`);
      try {
        await page.goto(url, { timeout: 60000 });
        await waitReady(page);
        const setup = await scenario.setup(page);
        await page.waitForTimeout(750);
        const directBench = await bench(page);
        await page.evaluate(() => window.__boot.reset());
        await cdp.send('Profiler.start');
        await page.waitForTimeout(PROFILE_MS);
        const profile = (await cdp.send('Profiler.stop')).profile;
        const snapshot = await page.evaluate(() => window.__perfSnap());
        const cpu = digest(profile);
        const updates = snapshot.work['update (all)']?.n || 0;
        const renders = snapshot.work['phaser render']?.n || 0;
        const raf = snapshot.live.n || 0;
        const result = {
          name: scenario.name, how: scenario.how, setup,
          control: scenario.control || null, controlOnly: !!scenario.controlOnly,
          objectCounts: {
            tiles: snapshot.objs.tiles, objects: snapshot.objs.objects,
            underground: setup?.underground || null,
            wildplants: snapshot.objs.wildplants, creatures: snapshot.objs.creatures,
            displayChildren: snapshot.disp.deep,
            scannedPerDraw: snapshot.counts['drawObjects scanned']?.sum / Math.max(1, snapshot.counts['drawObjects scanned']?.n || 0) || 0,
            keptPerDraw: snapshot.counts['drawObjects kept']?.sum / Math.max(1, snapshot.counts['drawObjects kept']?.n || 0) || 0,
            graphics: snapshot.objs.gfx, pools: snapshot.objs.pools,
          },
          frameCounts: { updates, renders, raf },
          bootTicks: normalizeBoot(snapshot),
          cpuDigest: {
            sampledMs: cpu.sampledMs, idleMs: cpu.idleMs, busyMs: cpu.busyMs,
            busyMsPerUpdate: cpu.busyMs / Math.max(1, updates),
            busyMsPerRender: cpu.busyMs / Math.max(1, renders),
            busyMsPerRaf: cpu.busyMs / Math.max(1, raf),
            selfTop: cpu.self.slice(0, 15).map(([name, ms]) => ({ name, ms, msPerUpdate: ms / Math.max(1, updates) })),
            inclusiveTop: cpu.inclusive.slice(0, 15).map(([name, ms]) => ({ name, ms, msPerUpdate: ms / Math.max(1, updates) })),
          },
          bench: directBench,
          _cpuSelf: cpu.self,
        };
        results.environment.renderer ||= snapshot.renderer;
        results.scenarios.push(result);
        console.log(`${snapshot.renderer}: update ${(result.bootTicks['update (all)']?.avgMs || 0).toFixed(2)} ms, render ${(result.bootTicks['phaser render']?.avgMs || 0).toFixed(2)} ms, CPU ${result.cpuDigest.busyMsPerUpdate.toFixed(2)} ms/update, direct ${result.bench.warmMsPerFrame.toFixed(2)} ms/frame`);
      } catch (error) {
        try { await cdp.send('Profiler.stop'); } catch (_) {}
        results.skipped.push({ name: scenario.name, reason: String(error) });
        console.error(`[${scenario.name}] skipped: ${error}`);
      }
      fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    }

    results.analysis = makeAnalysis(results);
    for (const row of results.scenarios) delete row._cpuSelf;
    results.validation = {
      passed: results.scenarios.length === runScenarios.length && !results.pageErrors.length && !results.consoleErrors.length,
      measured: results.scenarios.length, requested: runScenarios.length,
    };
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    console.log('\n=== scenario deltas vs matched control (ms per game update) ===');
    console.log('scenario (control)                         busy     update     render     direct');
    for (const row of results.analysis) {
      const label = `${row.name} (${row.control})`;
      console.log(`${label.padEnd(42)} ${row.addedBusyMsPerUpdate.toFixed(2).padStart(8)} ${row.addedUpdateMs.toFixed(2).padStart(10)} ${row.addedRenderMs.toFixed(2).padStart(10)} ${row.addedBenchMs.toFixed(2).padStart(10)}`);
      console.log('  ' + row.topFunctionDeltas.slice(0, 3).map(f => `${f.name} +${f.addedMsPerUpdate.toFixed(2)}`).join(' | '));
    }
    if (results.skipped.length) console.log('\nskipped: ' + results.skipped.map(s => `${s.name}: ${s.reason}`).join('; '));
    if (results.pageErrors.length || results.consoleErrors.length) {
      console.log(`\nruntime errors: ${results.pageErrors.length} page, ${results.consoleErrors.length} console`);
    }
    console.log(`\nSaved ${OUT}`);
    if (!results.validation.passed) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
