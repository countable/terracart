// Relay tests: boots the real server on an ephemeral port and drives it with
// real ws clients. `node test.js` — exit 0 on pass, 1 on any failure.
'use strict';

const assert = require('assert');
const WebSocket = require('ws');
const { createServer, cleanName, cleanLabel, INTEREST_PX, MAX_MSGS_PER_S,
        sendFrame, checkSlowConsumer, POSITION_BUFFER_BYTES, MAX_OUTBOUND_BYTES, SLOW_PING_LIMIT } = require('./index.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ── helpers ────────────────────────────────────────────────────────────────
function boot() {
  const { server, relay } = createServer();
  return new Promise(res => server.listen(0, () => {
    const url = `ws://127.0.0.1:${server.address().port}`;
    res({ url, close: async () => { await relay.close(); await new Promise(r => server.close(r)); } });
  }));
}
// A client that queues every inbound frame so tests can await them in order.
function connect(url) {
  const ws = new WebSocket(url);
  const queue = [], waiters = [];
  ws.on('message', d => { const m = JSON.parse(d); const w = waiters.shift(); w ? w(m) : queue.push(m); });
  const next = (ms = 2000) => new Promise((res, rej) => {
    if (queue.length) return res(queue.shift());
    const t = setTimeout(() => rej(new Error('timed out waiting for a frame')), ms);
    waiters.push(m => { clearTimeout(t); res(m); });
  });
  const none = (ms = 150) => new Promise((res, rej) => {
    if (queue.length) return rej(new Error('unexpected frame: ' + JSON.stringify(queue[0])));
    const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); res(); }, ms);
    const w = m => { clearTimeout(t); rej(new Error('unexpected frame: ' + JSON.stringify(m))); };
    waiters.push(w);
  });
  const send = o => ws.send(JSON.stringify(o));
  const closed = new Promise(res => ws.on('close', code => res(code)));
  return new Promise((res, rej) => {
    ws.on('open', () => res({ ws, send, next, none, closed }));
    ws.on('error', rej);
  });
}
async function hello(url, name, extra = {}) {
  const c = await connect(url);
  c.send({ t: 'hello', name, color: 0x9fd8ff, x: 0, y: 0, fx: 0, fy: 1, m: 0, d: 0, ...extra });
  c.welcome = await c.next();
  assert.strictEqual(c.welcome.t, 'welcome');
  return c;
}

// ── tests ──────────────────────────────────────────────────────────────────
test('cleanName strips control chars, collapses space, clamps length', () => {
  assert.strictEqual(cleanName('  Ada  Lovelace  '), 'Ada Lovelace');
  assert.strictEqual(cleanName('x'.repeat(40)).length, 16);
  assert.strictEqual(cleanName(''), '');
  assert.strictEqual(cleanName(42), '');
  assert.strictEqual(cleanName('\u200b '), '');
  // Clamp by code point: 15 chars + an emoji stays whole, no lone surrogate.
  assert.strictEqual(cleanName('x'.repeat(15) + '😀'), 'x'.repeat(15) + '😀');
  assert.strictEqual(cleanLabel('Blackberry bush by the church gate'), 'Blackberry bush by the church ga');
});

test('outbound queue drops obsolete positions, recovers, and caps control frames', () => {
  const ws = {
    OPEN: 1, readyState: 1, bufferedAmount: 0, frames: [], terminated: 0,
    send(frame) { this.frames.push(JSON.parse(frame)); this.bufferedAmount += Buffer.byteLength(frame); },
    terminate() { this.terminated++; this.readyState = 3; },
  };
  ws.bufferedAmount = POSITION_BUFFER_BYTES - 1;
  sendFrame(ws, { t: 'p', x: 1 });
  assert.strictEqual(ws.frames.length, 0, 'position skipped before queue crosses soft cap');
  sendFrame(ws, { t: 'join', id: 1 });
  assert.strictEqual(ws.frames.length, 1, 'control frame survives soft pressure');
  ws.bufferedAmount = 0; // transport drained
  sendFrame(ws, { t: 'p', x: 2 });
  assert.deepStrictEqual(ws.frames[1], { t: 'p', x: 2 }, 'position resumes after drain');
  ws.bufferedAmount = MAX_OUTBOUND_BYTES - 1;
  sendFrame(ws, { t: 'ping', label: 'too much' });
  assert.strictEqual(ws.terminated, 1, 'control frame cannot grow queue past hard cap');
  assert.strictEqual(ws.frames.length, 2);
});

test('heartbeat reaps persistently slow receivers, but a drained queue resets strikes', () => {
  const ws = { bufferedAmount: POSITION_BUFFER_BYTES, slowPings: 0, terminated: 0,
               terminate() { this.terminated++; } };
  assert.ok(SLOW_PING_LIMIT > 1);
  assert.strictEqual(checkSlowConsumer(ws), false);
  ws.bufferedAmount = 0;
  assert.strictEqual(checkSlowConsumer(ws), false);
  assert.strictEqual(ws.slowPings, 0);
  ws.bufferedAmount = POSITION_BUFFER_BYTES;
  for (let i = 1; i < SLOW_PING_LIMIT; i++) assert.strictEqual(checkSlowConsumer(ws), false);
  assert.strictEqual(checkSlowConsumer(ws), true);
  assert.strictEqual(ws.terminated, 1);
});

test('hello → welcome with the current roster; late joiner is announced', async () => {
  const s = await boot();
  try {
    const a = await hello(s.url, 'Ada', { x: 10, y: 20 });
    assert.deepStrictEqual(a.welcome.peers, []);
    const b = await hello(s.url, 'Bob');
    assert.strictEqual(b.welcome.peers.length, 1);
    assert.strictEqual(b.welcome.peers[0].name, 'Ada');
    assert.strictEqual(b.welcome.peers[0].x, 10);
    assert.strictEqual(b.welcome.peers[0].color, 0x9fd8ff);
    const join = await a.next();
    assert.strictEqual(join.t, 'join');
    assert.strictEqual(join.name, 'Bob');
    assert.strictEqual(join.id, b.welcome.id);
    assert.notStrictEqual(a.welcome.id, b.welcome.id);
    a.ws.close(); b.ws.close();
  } finally { await s.close(); }
});

test('position updates relay to nearby peers only, never back to the sender', async () => {
  const s = await boot();
  try {
    const a = await hello(s.url, 'Ada', { x: 0, y: 0 });
    const near = await hello(s.url, 'Near', { x: 50, y: 50 });
    const far = await hello(s.url, 'Far', { x: INTEREST_PX * 3, y: 0 });
    await a.next(); await a.next();       // joins for Near + Far
    await near.next();                    // join for Far
    a.send({ t: 'p', x: 1, y: 2, fx: 1, fy: 0, m: 1, d: 0 });
    const p = await near.next();
    assert.deepStrictEqual(p, { t: 'p', id: a.welcome.id, x: 1, y: 2, fx: 1, fy: 0, m: 1, d: 0 });
    await far.none();
    await a.none();
    a.ws.close(); near.ws.close(); far.ws.close();
  } finally { await s.close(); }
});

test('a closed socket leaves for everyone', async () => {
  const s = await boot();
  try {
    const a = await hello(s.url, 'Ada');
    const b = await hello(s.url, 'Bob');
    await a.next();                       // join
    b.ws.close();
    const leave = await a.next();
    assert.deepStrictEqual(leave, { t: 'leave', id: b.welcome.id });
    a.ws.close();
  } finally { await s.close(); }
});

test('server pins name and colour; the client cannot rewrite them in a position frame', async () => {
  const s = await boot();
  try {
    const a = await hello(s.url, 'Ada');
    const b = await hello(s.url, 'Bob');
    await a.next();
    b.send({ t: 'p', x: 1, y: 1, name: 'Ada', color: 0, id: a.welcome.id });
    const p = await a.next();
    assert.strictEqual(p.id, b.welcome.id);
    assert.strictEqual(p.name, undefined);
    assert.strictEqual(p.color, undefined);
    a.ws.close(); b.ws.close();
  } finally { await s.close(); }
});

test('rejects: empty name, position before hello, bad JSON', async () => {
  const s = await boot();
  try {
    for (const [frame, reason] of [
      [JSON.stringify({ t: 'hello', name: '   ' }), 'name'],
      [JSON.stringify({ t: 'p', x: 1 }), 'hello-first'],
      ['{nope', 'json'],
    ]) {
      const c = await connect(s.url);
      c.ws.send(frame);
      const err = await c.next();
      assert.deepStrictEqual(err, { t: 'error', reason });
      assert.strictEqual(await c.closed, 1008);
    }
  } finally { await s.close(); }
});

test('pings reach nearby peers with the sender\'s name + colour; a second ping inside the gap is dropped', async () => {
  const s = await boot();
  try {
    const a = await hello(s.url, 'Ada');
    const b = await hello(s.url, 'Bob', { x: 10, y: 10 });
    const far = await hello(s.url, 'Far', { x: INTEREST_PX * 3, y: 0 });
    await a.next(); await a.next(); await b.next();
    a.send({ t: 'ping', x: 5, y: 6, label: 'Iron rock' });
    const p = await b.next();
    assert.deepStrictEqual(p, { t: 'ping', id: a.welcome.id, name: 'Ada', color: 0x9fd8ff, x: 5, y: 6, label: 'Iron rock' });
    await far.none();
    a.send({ t: 'ping', x: 7, y: 8, label: 'again' });
    await b.none();
    await a.none();
    a.ws.close(); b.ws.close(); far.ws.close();
  } finally { await s.close(); }
});

test('a flooding client is cut off', async () => {
  const s = await boot();
  try {
    const a = await hello(s.url, 'Ada');
    // Twice the budget: a refill tick can land mid-burst, so one budget's
    // worth alone could slip through without ever overflowing.
    for (let i = 0; i < 2 * MAX_MSGS_PER_S + 5; i++) a.send({ t: 'p', x: i, y: 0 });
    const err = await a.next();
    assert.deepStrictEqual(err, { t: 'error', reason: 'rate' });
    assert.strictEqual(await a.closed, 1008);
  } finally { await s.close(); }
});

test('GET / reports the online count', async () => {
  const s = await boot();
  try {
    const a = await hello(s.url, 'Ada');
    const r = await fetch(s.url.replace('ws:', 'http:'));
    assert.deepStrictEqual(await r.json(), { ok: true, online: 1 });
    a.ws.close();
  } finally { await s.close(); }
});

// ── runner ─────────────────────────────────────────────────────────────────
(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e}`); }
  }
  console.log(failed ? `\n${failed} failed` : `\n${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
