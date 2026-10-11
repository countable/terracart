#!/usr/bin/env node
'use strict';
// Replay into a NEW run.js session; fail at the first observable divergence.
const fs = require('node:fs');
const endpoint = `http://127.0.0.1:${process.env.QA_PORT || 7732}/command`;
async function send(command) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
const menus = observation => (observation?.menus || []).map(menu => `${menu.kind}|${menu.text}`);
function resolveControl(expectedObservation, current, id) {
  const expected = expectedObservation?.controls?.find(control => control.id === id);
  if (!expected) throw Error(`Recorded control ${id} is missing from the transcript observation.`);
  const candidates = (current.controls || []).filter(control => !control.disabled &&
    (expected.domId ? control.domId === expected.domId :
      control.label === expected.label && control.slot === expected.slot && control.gear === expected.gear));
  if (candidates.length !== 1) throw Error(`Control missing/ambiguous: ${expected.label}`);
  return candidates[0].id;
}
function compareObservation(expected, actual, label) {
  if (!expected || !actual) throw Error(`${label}: observation missing.`);
  if (!!expected.ready !== !!actual.ready) throw Error(`${label}: readiness differs.`);
  if (JSON.stringify(menus(expected)) !== JSON.stringify(menus(actual))) throw Error(`${label}: visible menu differs.`);
  if (!!expected.position !== !!actual.position) throw Error(`${label}: player position missing.`);
  if (expected.position) {
    for (const axis of ['cellIX', 'cellIY']) if (expected.position[axis] !== actual.position[axis])
      throw Error(`${label}: player cell differs.`);
    if (expected.depth !== actual.depth) throw Error(`${label}: map depth differs.`);
  }
  if (expected.hud) {
    if (!actual.hud || expected.hud.money !== actual.hud.money || Math.abs(expected.hud.energy - actual.hud.energy) > 1)
      throw Error(`${label}: money/energy differs.`);
    if (expected.hud.objective !== actual.hud.objective) throw Error(`${label}: objective differs.`);
  }
  const inventory = observation => (observation.inventory || []).map(item => item && ({ slot: item.slot, id: item.id, count: item.count, selected: item.selected }));
  if (JSON.stringify(inventory(expected)) !== JSON.stringify(inventory(actual))) throw Error(`${label}: inventory differs.`);
}
async function main(file) {
  if (!file) throw Error('Usage: node tools/qa/replay.js /path/to/actions.jsonl');
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(JSON.parse);
  for (const row of rows) {
    if (row.error) throw Error(`Step ${row.step}: transcript contains a command exception; reproduce this step manually.`);
    let current = await send({ action: 'observe' });
    // Native boot/loading must finish before matching the recorded UI. Once
    // ready, divergence is evidence and is never repaired with guessed actions.
    for (let n = 0; n < 60 && row.before.ready && !current.ready; n++) {
      await new Promise(resolve => setTimeout(resolve, 500)); current = await send({ action: 'observe' });
    }
    const command = { ...row.command };
    if (command.action === 'activate') {
      let lastError;
      for (let n = 0; n < 21; n++) {
        try { command.control = resolveControl(row.before, current, row.command.control); lastError = null; break; }
        catch (error) { lastError = error; }
        if (current.ready || n === 20) break;
        await new Promise(resolve => setTimeout(resolve, 250)); current = await send({ action: 'observe' });
      }
      if (lastError) throw Error(`Step ${row.step}: ${lastError.message}`);
    }
    compareObservation(row.before, current, `Step ${row.step} before`);
    const result = await send(command);
    compareObservation(row.after, result.observation, `Step ${row.step} after`);
    if (row.result?.ok !== result.result?.ok || row.result?.reason !== result.result?.reason)
      throw Error(`Step ${row.step}: action outcome differs.`);
    // A frame-sized tolerance covers timer boundary rounding without allowing
    // a shortened wait to silently become a different progression test.
    if (Math.abs((row.simulatedMs || 0) - (result.simulatedMs || 0)) > 50)
      throw Error(`Step ${row.step}: simulated time differs by more than one frame.`);
    console.log(JSON.stringify({ replayed: row.step, simulatedMs: result.simulatedMs }));
  }
}
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { resolveControl, compareObservation };
