#!/usr/bin/env node
// Quantify health/death divergence with two isolated real game clients and a
// deterministic fake wire. Reuse the headless bootstrap and combat scene-method
// harness so production code, not a second damage implementation, is exercised.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const ROOT = path.resolve(__dirname, '..');
function client() {
  const runner = fs.readFileSync(path.join(ROOT, 'test/node/run.js'), 'utf8');
  const marker = 'const testFiles =';
  assert(runner.includes(marker), 'headless bootstrap marker moved');
  const ctx = new Function('require', '__dirname', runner.slice(0, runner.indexOf(marker)) + '\nreturn ctx;')(
    require, path.join(ROOT, 'test/node'));
  const hitTests = fs.readFileSync(path.join(ROOT, 'test/node/multiplayer_hits.test.js'), 'utf8');
  const helpers = hitTests.slice(0, hitTests.indexOf("test('multiplayer hits:"));
  vm.runInContext(helpers + `
    globalThis.healthHarness = { harness, online, withRelay, withTile, foe,
      advance(scene, ms) { clock += ms; scene._peerUprightPieces = [];
        scene.viewSize = 352; scene.viewCenterX = scene.viewCenterY = 176;
        Multiplayer.tick(scene); },
      near(scene) { scene.playerToWorldCell = () => ({ tx: TX, ty: TY }); }
    }; })();`, ctx);
  return ctx;
}
// Each scenario gets independent saves, caches, singleton multiplayer state,
// clocks and connections. Only JSON wire frames cross their boundary.
function pair(fn) {
  const ca = client(), cb = client();
  const a = ca.healthHarness, b = cb.healthHarness;
  return a.withTile(ea => b.withTile(eb => {
    const sa = a.harness().scene, sb = b.harness().scene;
    a.online(sa); b.online(sb); a.near(sa); b.near(sb);
    return a.withRelay(sa, wa => b.withRelay(sb, wb => {
      const fa = a.foe(ea), fb = b.foe(eb);
      // Real peer rosters are essential: publisher selection must not see two
      // independent clients both claiming relay id 1. Rendering stays stubbed.
      const art = () => {
        const obj = new Proxy({ anims: { currentAnim: null } }, {
          get(target, key) { return key in target ? target[key] : () => obj; },
        });
        return obj;
      };
      for (const scene of [sa, sb]) {
        scene.startWorldM = { x: fa.x, y: fa.y };
        scene.mPerPx = 10;
        scene.save.energy = 100;
        scene.cellAt = () => ({ loaded: true, type: ca.WorldGen.T.GRASS });
        scene._cellBlocked = () => false;
        scene._nearAny = () => false;
        scene.worldContainer = scene.shadowContainer = { add() {} };
        for (const kind of ['image', 'sprite', 'text']) scene.add[kind] = art;
      }
      sb.startWorldM = { x: fa.x - 1000, y: fa.y + 2000 };
      sb.playerM = { x: 1040, y: -2000 };
      const roster = (id, x) => ({ id, x: x / sa.mPerPx, y: fa.y / sa.mPerPx, d: 0, name: `Client ${id}`, color: 0x9fd8ff, e: 1, enemySync: 1 });
      wa.recv({ t: 'welcome', id: 1, enemySync: 1, peers: [roster(2, fa.x + 40)] });
      wb.recv({ t: 'welcome', id: 2, enemySync: 1, peers: [roster(1, fa.x)] });
      const side = (ctx, h, scene, wire, enemy, entry, id) => ({ ctx, h, scene, wire, enemy, entry, id,
        tick(ms = 1000) { h.advance(scene, ms); },
        damage(fraction, source = 'player') { scene._damageEnemy(enemy, ctx.Combat.maxHp(enemy) * fraction, source, { exact: true }); },
        hp() { return ctx.Combat.hpFraction(enemy); },
        dead() { return scene.save.caught.includes(enemy.id); },
        receive(frame, sender) {
          const msg = { ...frame, id: sender };
          if (['hit', 'damage', 'state'].includes(frame.t)) msg.eid = frame.id;
          wire.recv(msg);
        },
      });
      return fn(side(ca, a, sa, wa, fa, ea, 1), side(cb, b, sb, wb, fb, eb, 2));
    }));
  }));
}
const results = [];
const round = n => Number(n.toFixed(9));
function record(name, a, b, extra = {}) {
  const r = { name, hp_a_pct: round(a.hp() * 100), hp_b_pct: round(b.hp() * 100),
    drift_pp: round(Math.abs(a.hp() - b.hp()) * 100), alive_mismatch: a.dead() !== b.dead(), ...extra };
  results.push(r); return r;
}
function close(r, expected) { assert(Math.abs(r.drift_pp - expected) < 1e-7, `${r.name}: ${r.drift_pp} vs ${expected}`); }
function run() {
  results.length = 0;
  pair((a, b) => {
    a.damage(0.25); a.tick(250);
    b.receive(a.wire.hits()[0], 1);
    close(record('single_hit_delivered', a, b), 0);
  });
  pair((a, b) => {
    for (let i = 0; i < 100; i++) {
      a.damage(0.003349); a.tick(250); b.receive(a.wire.hits().at(-1), 1);
    }
    close(record('100_separate_rounding_sensitive_hits', a, b, { hits: 100, fraction_per_hit: 0.003349 }), 0);
  });
  pair((a, b) => {
    for (let i = 0; i < 100; i++) a.damage(0.003349);
    a.tick(250); b.receive(a.wire.hits()[0], 1);
    close(record('100_hits_batched_into_one_frame', a, b), 0);
  });
  pair((a, b) => {
    a.damage(0.2); b.damage(0.3); a.tick(250); b.tick(250);
    a.receive(b.wire.hits()[0], 2); b.receive(a.wire.hits()[0], 1);
    close(record('simultaneous_hits_delivered', a, b), 0);
  });
  pair((a, b) => {
    a.damage(0.25); a.tick(250);
    b.receive(a.wire.hits()[0], 1); b.receive(a.wire.hits()[0], 1);
    close(record('duplicate_nonlethal_frame', a, b, { fault: 'application-level replay, not normal TCP behavior' }), 0);
  });
  pair((a, b) => {
    a.damage(0.2); a.tick(250); a.damage(0.3); a.tick(250);
    b.receive(a.wire.hits()[1], 1); b.receive(a.wire.hits()[0], 1);
    close(record('reordered_nonlethal_frames', a, b), 0);
  });
  pair((a, b) => {
    a.damage(0.25); a.tick(250);
    close(record('delayed_hit_in_flight', a, b, { delay_ms: 2000 }), 25);
    b.tick(2000); b.receive(a.wire.hits()[0], 1);
    close(record('delayed_hit_after_delivery', a, b), 0);
  });
  for (const ms of [29000, 30000, 31000]) pair((a, b) => {
    a.damage(0.25); a.tick(250); b.entry.creatures.length = 0;
    b.receive(a.wire.hits()[0], 1);
    b.entry.creatures.push(b.enemy); b.tick(ms);
    close(record(`unloaded_hit_load_after_${ms}ms`, a, b, { unloaded_ms: ms }), ms < 30000 ? 0 : 25);
  });
  pair((a, b) => {
    a.damage(0.25); a.tick(250); // Wire drops this frame.
    for (let i = 0; i < 6; i++) { a.tick(10000); b.tick(10000); }
    close(record('dropped_nonlethal_hit_after_60s', a, b), 25);
    // Keep omitting responses through reconnect; requesting repair alone cannot deliver it.
    b.ctx.Multiplayer.stop(b.scene); b.ctx.Multiplayer.start(b.scene);
    b.wire.recv({ t: 'welcome', id: 2, enemySync: 1, peers: [{ id: 1, enemySync: 1, x: a.enemy.x / a.scene.mPerPx, y: a.enemy.y / a.scene.mPerPx, d: 0, e: 1 }] }); b.tick(10000);
    close(record('dropped_nonlethal_hit_after_reconnect', a, b), 25);
    a.damage(0.25); a.tick(1000); b.receive(a.wire.hits().at(-1), 1);
    close(record('later_nonlethal_hit_repairs_omission', a, b), 0);
    a.damage(1); b.receive(a.wire.hits().at(-1), 1);
    close(record('later_kill_repairs_hp_and_alive', a, b), 0);
    assert(a.dead() && b.dead());
  });
  pair((a, b) => {
    a.damage(1); // Wire drops kill; B still sees full health.
    assert(record('dropped_kill_before_reconciliation', a, b).alive_mismatch);
    b.tick(1000); a.receive(b.wire.of('seen').at(-1), 2); a.tick(600);
    b.receive(a.wire.of('dead').at(-1), 1);
    close(record('seen_dead_repairs_dropped_kill', a, b, { simulated_repair_ms: 1600 }), 0);
    assert(a.dead() && b.dead());
  });
  for (const ms of [299000, 300000]) pair((a, b) => {
    a.damage(1); b.entry.creatures.length = 0; b.receive(a.wire.hits()[0], 1);
    b.entry.creatures.push(b.enemy); b.tick(ms);
    close(record(`unloaded_kill_load_after_${ms}ms`, a, b), ms < 300000 ? 0 : 100);
  });
  pair((a, b) => {
    b.enemy.shiny = true;
    a.damage(0.25); a.tick(250); b.receive(a.wire.hits()[0], 1);
    close(record('different_max_hp_pools_fraction_preserved', a, b, {
      max_hp_a: a.ctx.Combat.maxHp(a.enemy), max_hp_b: b.ctx.Combat.maxHp(b.enemy),
    }), 0);
  });
  pair((a, b) => {
    a.damage(0.25); a.tick(250); // Omitted nonlethal frame.
    const lastDamage = a.enemy._lastDamagedT;
    a.ctx.Combat.healIfRested(a.enemy, lastDamage + a.ctx.Combat.REST_HEAL_MS - 1);
    close(record('rest_heal_at_20min_minus_1ms', a, b), 25);
    assert(a.ctx.Combat.healIfRested(a.enemy, lastDamage + a.ctx.Combat.REST_HEAL_MS));
    close(record('rest_heal_at_20min', a, b, { mechanism: 'local rest healing, not multiplayer reconciliation' }), 0);
  });
  pair((a, b) => {
    a.damage(0.25, 'lava'); a.tick(1000); b.tick(1000);
    const frames = a.wire.of('damage');
    assert(frames.length >= 1);
    for (const frame of frames) b.receive(frame, a.id);
    close(record('asymmetric_environment_damage_delivered', a, b, { sent_damage_frames: frames.length }), 0);
  });
  return { methodology: 'Two isolated VM clients, production Multiplayer/Combat and lifted scene damage/defeat methods; mocked WebSocket, rendering and local clocks. HP difference is percentage points of each copy max HP. No relay-server, browser, movement, or automatic passive-heal simulation (rest cases explicitly invoke Combat.healIfRested). Dropped and duplicated frames model application omission/replay or connection gaps, not random TCP loss. The 60s idle and reconnect checks tick Multiplayer but intentionally deliver no repair traffic; the companion sync probe exercises those repairs.',
    cases: results.length, results };
}
if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run, pair };
