#!/usr/bin/env node
// Render procedural preview seats through the shipping implementation.
const fs = require('fs');
require('../src/terrain.js');
const { generator, materials } = JSON.parse(fs.readFileSync(0, 'utf8'));
const points = TerrainLayouts.generate(generator);
process.stdout.write(JSON.stringify(TerrainLayouts.assign(points, generator, materials)));
