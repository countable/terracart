#!/usr/bin/env node
// Event-driven synchronization measurements with two isolated shipping clients.
// Rendering/terrain are stubs; correction and damage accounting are production.
const assert = require('assert/strict');
const { pair } = require('./multiplayer-health-drift');
const results = [];
const round = n => Number(n.toFixed(6));
const distance = (a, b) => Math.hypot(a.enemy.x - b.enemy.x, a.enemy.y - b.enemy.y);
function record(name, a, b, extra = {}) {
  const r = { name, position_drift_m: round(distance(a, b)), health_drift_pp: round(Math.abs(a.hp() - b.hp()) * 100), ...extra };
  results.push(r); return r;
}
function pump(a, b) {
  // A tiny deterministic relay: only synchronization frames, sender stamping,
  // and no echo. The caller can inject explicit omissions/reordering separately.
  const sides = [a, b], cursors = [0, 0];
  return () => {
    for (let turn = 0; turn < 20; turn++) {
      let count = 0;
      for (let i = 0; i < 2; i++) while (cursors[i] < sides[i].wire.sent.length) {
        const frame = sides[i].wire.sent[cursors[i]++];
        if (!['hit', 'damage', 'state', 'seen', 'dead'].includes(frame.t)) continue;
        sides[1-i].receive(frame, sides[i].id); count++;
      }
      if (!count) return;
    }
    throw new Error('sync echo loop');
  };
}
function settle(a, b, ms = 2000, wire = () => {}) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000/60) {
    a.tick(1000/60); b.tick(1000/60); wire();
  }
}
function equalHealth(a, b) { assert(Math.abs(a.hp() - b.hp()) < 1e-6); }
function run() {
  results.length = 0;
  for (const drift of [0.25, 2, 20]) pair((a, b) => {
    b.enemy.x += drift;
    a.damage(0.1); a.tick(250);
    const hit = a.wire.hits()[0]; assert(hit.s, 'publisher hit must carry position');
    b.receive(hit, a.id);
    record(`publisher_hit_${drift}m_at_delivery`, a, b);
    settle(a, b, 100);
    record(`publisher_hit_${drift}m_after_100ms`, a, b);
    settle(a, b, 1900);
    const r = record(`publisher_hit_${drift}m_after_2s`, a, b);
    assert(r.position_drift_m <= Math.max(0.5, drift === 0.25 ? drift : 0)); equalHealth(a, b);
  });
  pair((a, b) => {
    b.enemy.x += 8;
    const wire = pump(a, b);
    b.damage(0.15); b.tick(250); wire(); settle(a, b, 2000, wire);
    record('nonpublisher_hit_publisher_reply_after_2s', a, b);
    assert(distance(a, b) <= 0.5); equalHealth(a, b);
  });
  pair((a, b) => {
    const startX = a.enemy.x;
    a.damage(0.1); a.tick(250); const old = a.wire.hits().at(-1);
    a.enemy.x += 8; a.damage(0.1); a.tick(250); const fresh = a.wire.hits().at(-1);
    b.receive(fresh, a.id); settle(a, b); b.receive(old, a.id); settle(a, b);
    record('reordered_hits_do_not_rewind_position', a, b, { publisher_displacement_m: a.enemy.x - startX });
    assert(distance(a, b) <= 0.5); equalHealth(a, b);
  });
  pair((a, b) => {
    a.damage(0.25); a.tick(250); // omit this wire frame
    a.damage(0.15); a.tick(250); b.receive(a.wire.hits().at(-1), a.id);
    b.receive(a.wire.hits().at(-1), a.id); // explicit application replay
    record('next_cumulative_hit_repairs_omission_and_replay', a, b); equalHealth(a, b);
  });
  pair((a, b) => {
    a.damage(0.2); b.damage(0.3); a.tick(250); b.tick(250);
    a.receive(b.wire.hits()[0], b.id); b.receive(a.wire.hits()[0], a.id);
    const wire = pump(a, b); wire(); settle(a, b, 1000, wire);
    record('concurrent_hits_and_snapshot_preserve_both', a, b);
    equalHealth(a, b); assert(Math.abs(a.hp() - 0.5) < 1e-6);
  });
  for (const trigger of ['join', 'resume', 'load']) pair((a, b) => {
    a.damage(0.25); a.tick(250); b.enemy.x += 20;
    // Start the forwarding cursor after the intentionally omitted damage.
    const wire = pump(a, b);
    a.wire.sent.length = 0; b.wire.sent.length = 0;
    if (trigger === 'load') {
      b.entry.creatures.length = 0; b.tick(1000); wire();
      b.entry.creatures.push(b.enemy);
    } else {
      if (trigger === 'resume') {
        b.ctx.Multiplayer.stop(b.scene); b.ctx.Multiplayer.start(b.scene);
        a.wire.recv({ t: 'leave', id: b.id }); b.id = 3;
        a.wire.recv({ t: 'join', id: b.id, enemySync: 1, x: (a.enemy.x + 40) / a.scene.mPerPx, y: a.enemy.y / a.scene.mPerPx, d: 0, e: 1 });
      }
      // A fresh welcome is the production join/resume reconciliation trigger.
      b.wire.recv({ t: 'welcome', id: b.id, enemySync: 1, peers: [{ id: a.id, x: a.enemy.x / a.scene.mPerPx, y: a.enemy.y / a.scene.mPerPx, d: 0, enemySync: 1, e: 1 }] });
    }
    settle(a, b, 3000, wire);
    record(`${trigger}_snapshot_after_3s`, a, b);
    equalHealth(a, b); assert(distance(a, b) <= 0.5);
  });
  pair((a, b) => {
    b.enemy.x += 20; const x = b.enemy.x;
    b.scene._cellBlocked = () => true;
    a.damage(0.1); a.tick(250); b.receive(a.wire.hits()[0], a.id); settle(a, b);
    record('blocked_destination_preserves_local_position', a, b);
    assert.equal(b.enemy.x, x); equalHealth(a, b);
  });
  pair((a, b) => {
    a.damage(0.1, 'lava'); b.damage(0.1, 'lava'); a.tick(250); b.tick(250);
    const wire = pump(a, b); wire(); settle(a, b, 1000, wire);
    record('environment_damage_single_publisher', a, b, { sent_damage_frames: a.wire.of('damage').length + b.wire.of('damage').length });
    equalHealth(a, b); assert(Math.abs(a.hp() - 0.9) < 1e-6);
  });
  // One deterministic moving-target encounter per delay, at 60 vs 30 FPS.
  // The remote player fix is sampled at 8 Hz and delayed independently of
  // enemy hit/state traffic. This is a bounded fixture, not population p95.
  for (const delay of [0, 100, 300]) for (const positionSync of [false, true]) pair((a, b) => {
    const origin = { x: a.enemy.x, y: a.enemy.y }, cursors = [0, 0], pending = [], samples = [];
    const target = t => ({ x: origin.x + 20 * Math.cos(t / 1000 * 0.24), y: origin.y + 20 * Math.sin(t / 1000 * 0.24) });
    const sides = [a, b], step = 1000 / 60;
    for (let frame = 0; frame <= 1200; frame++) {
      const now = frame * step;
      for (let i = 0; i < 2; i++) {
        if (i && frame % 2) continue;
        const side = sides[i], point = target(i ? Math.max(0, Math.floor((now - delay) / 125) * 125) : now);
        side.ctx.rosterEnemyMove(side.scene, side.enemy, side.ctx.EnemyRoster.get(side.enemy.kind), 1e9 + now,
          point.x, point.y, false, false, null, step * (i ? 2 : 1) / 1000);
        if (!i && frame > 0 && frame % 60 === 0) side.damage(0.001);
        side.tick(step * (i ? 2 : 1));
        while (cursors[i] < side.wire.sent.length) {
          const msg = { ...side.wire.sent[cursors[i]++] };
          if (!positionSync) {
            if (['state', 'seen'].includes(msg.t)) continue;
            delete msg.s;
          }
          if (['hit', 'damage', 'state', 'seen', 'dead'].includes(msg.t)) pending.push({ due: now + delay, msg, from: i });
        }
      }
      for (let j = 0; j < pending.length;) {
        const item = pending[j];
        if (item.due > now) { j++; continue; }
        sides[1-item.from].receive(item.msg, sides[item.from].id); pending.splice(j, 1);
      }
      if (frame % 6 === 0) {
        assert(Number.isFinite(distance(a, b))); samples.push(distance(a, b));
      }
    }
    const sorted = [...samples].sort((x, y) => x-y);
    record(`moving_target_hits_1hz_delay_${delay}ms_${positionSync ? 'synced' : 'control'}`, a, b, {
      duration_ms: 20000, fps_a: 60, fps_b: 30, target_updates_hz: 8, position_sync: positionSync,
      transport_delay_ms: delay, frames_in_flight_at_end: pending.length, p95_position_drift_m: round(sorted[Math.ceil(sorted.length * .95)-1]),
      max_position_drift_m: round(sorted.at(-1)), samples: samples.length,
    });
  });
  return { methodology: 'Two isolated shipping VM clients with distinct relay IDs, modern peer rosters, different scene origins, production damage and synchronization, and a deterministic sender-stamping fake wire. No browser, real relay, real terrain or clock/network jitter. Moving cases call shipping rosterEnemyMove with explicit frame dt and deterministic sampled targets; no full scene AI, combat targeting or elapsed-time scheduling. Distances are metres in the fixture world frame; these tests measure recovery from injected divergence, not live encounter separation. Resume explicitly stops/starts the client and receives a new relay ID; browser visibility is not exercised.', cases: results.length, results };
}
if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { run };
