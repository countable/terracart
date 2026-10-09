// Terracart presence relay.
//
// One tiny WebSocket server that lets players SEE each other. It holds no game
// state: every client keeps its own save, and the server only fans out
// "where I am" messages, plus five enemy frames (hit, seen, dead, battle,
// aggro) so nearby players' copies of the same deterministic enemy take the
// same damage, die together, fight the same castle battle and chase the same
// player. What it does own is the roster — it assigns ids, pins each
// socket's name + colour from its hello, and tells everyone when a player
// arrives or leaves — so a client can never impersonate another.
//
// Wire protocol (JSON text frames, one object per frame):
//   client → server
//     { t:'hello', name, color, x, y, fx, fy, m, d, e, g, v }  first frame; name required
//     { t:'p', x, y, fx, fy, m, d, e, g, v }          position update (≤ MAX_MSGS_PER_S)
//     { t:'ping', x, y, label }                       "look here" (≤ 1 per PING_GAP_MS)
//     { t:'hit', id, f, left, d, k? }                 my side damaged enemy `id`   ┐
//     { t:'seen', ids:[id...], d }                    these enemies are alive here │ ≤ MAX_ENEMY_FRAMES_PER_S
//     { t:'dead', ids:[id...], d }                    these enemies are dead (reply)│ together; extras
//     { t:'battle', key, startedAt, d }               my castle battle is on       │ dropped, not fatal
//     { t:'aggro', eid, pid, d }                      enemy `eid` is after player `pid` ┘
//   server → client
//     { t:'welcome', id, peers:[<peer>...] }          reply to hello; peers = everyone else
//     { t:'join',  ...<peer> }                        someone new said hello
//     { t:'p',     id, x, y, fx, fy, m, d, e, g, v }  a peer moved (within INTEREST_PX only)
//     { t:'ping',  id, name, color, x, y, label }     a peer pinged a spot (within INTEREST_PX)
//     { t:'hit',   id, eid, f, left, d, k? }          a peer damaged enemy `eid` (within INTEREST_PX)
//     { t:'seen',  id, ids, d }                       a peer has these enemies loaded, alive (within INTEREST_PX)
//     { t:'dead',  id, ids, d }                       a peer knows these enemies are dead (within INTEREST_PX)
//     { t:'battle', id, key, startedAt, d }           a peer's castle battle (within INTEREST_PX)
//     { t:'aggro', id, eid, pid, d }                  a peer's copy of `eid` targets `pid` (within INTEREST_PX)
//     { t:'leave', id }                               a peer's socket closed
//     { t:'error', reason }                           then the socket is closed
//   <peer> = { id, name, color, x, y, fx, fy, m, d, e, g, v }
//
// Coordinates are z=14 Web-Mercator world PIXELS (WorldGen.lonLatToWorldPx) —
// absolute, so two saves anchored at different homes still agree on where a
// player stands. fx/fy is the facing vector, m = 1 while walking, d = cave
// depth (0 = surface). Clients only draw peers at their own depth.
// e is the player's energy (their health) as a fraction of its cap, clamped to
// [0, 1] (1 when absent — an old client); g the targeting flags the enemy AI
// reads about a player (src/multiplayer.js TARGET_FLAGS: downed, hidden, kerb,
// warded, fireside), an integer 0..MAX_FLAGS (0 when malformed); v the cells
// the player's gear takes off an enemy's vision, an integer 0..MAX_VISION_CUT.
// A hit's `id`/`eid` is the enemy's deterministic creature id, `f` the damage
// as a fraction of its max HP (0 < f ≤ 1), `left` the sender's resulting HP
// fraction, and `k: 1` says the sender's side KILLED it — authoritative: every
// receiver kills its copy whatever HP it shows (a kill may carry f = 0, e.g.
// when the killing damage was already sent). A malformed enemy frame is
// dropped, never fatal; a client that does not know a frame type ignores it,
// so old clients keep working.
// `seen` / `dead` carry 1..MAX_IDS enemy ids (same charset): a client
// announces the enemies it has newly loaded, and any peer that knows one is
// dead answers to everyone nearby, so a player who missed a kill learns it.
// `battle` names a castle (CASTLE_KEY_RE — src/houses.js CASTLE_KEY_RE) and
// the epoch-ms its battle started; receivers adopt or merge it (the earlier
// start wins). `aggro` says the sender's copy of enemy `eid` chose player
// `pid` (a relay id) as its target.
//
// Run: node index.js            (PORT env, default 8787)
// Test: node test.js

'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8787;
// Position updates are only relayed to peers within this many z=14 px of the
// mover (~6.7 m/px at 45°N → 300 px ≈ 2 km). Joins and leaves go to everyone
// so rosters stay exact; a client drops any peer it hasn't heard from in a
// while (see src/multiplayer.js PEER_STALE_MS), which is how a peer that has
// simply walked out of range disappears.
const INTEREST_PX = 300;
const NAME_MAX = 16;
const LABEL_MAX = 32;
// Pings are a shout, not a stream: one per player every PING_GAP_MS, extras dropped.
const PING_GAP_MS = 2000;
// Inbound frames per second per socket before we cut it off — the client
// sends at ≤ 10 Hz plus a 5 s heartbeat, so 30 is generous.
const MAX_MSGS_PER_S = 30;
// Enemy frames (hit, seen, dead, battle, aggro) are a share of that budget,
// capped on their own: a client batches its damage per enemy and sends ≤ 12
// hits, 1 seen, ≤ 2 dead replies, ≤ 1 battle and ≤ 4 aggro frames a second
// (src/multiplayer.js), so frames past this cap are dropped silently rather
// than closing the socket. 8 Hz positions + 20 stays inside MAX_MSGS_PER_S.
const MAX_ENEMY_FRAMES_PER_S = 20;
const ENEMY_ID_RE = /^[A-Za-z0-9_:.%-]{1,96}$/;   // src/enemy_spawns.js SHARED_ID_RE
const MAX_IDS = 32;
// A full seen/dead batch can contain 32 × 96-character IDs (over 3 KiB
// including JSON). Keep the transport bound above that legal protocol size.
const MAX_PAYLOAD_BYTES = 4096;
const CASTLE_KEY_RE = /^b_-?\d{1,9}_-?\d{1,9}$/;    // src/houses.js CASTLE_KEY_RE
const MAX_FLAGS = 255;        // presence `g`: a byte of targeting flags
const MAX_VISION_CUT = 15;    // presence `v`: cells off an enemy's sight
// A socket that has not answered a ping in this long is dead (phone locked,
// tunnel dropped) — close it so its ghost leaves the roster.
const PING_MS = 20000;
// A socket that connects but never says hello is holding a slot for nothing.
const HELLO_DEADLINE_MS = 10000;
// Keep one stalled receiver from retaining an unlimited stream of frames.
// Positions become obsolete as soon as a newer position arrives; roster and
// ping frames still go through until the hard byte cap closes the socket.
const POSITION_BUFFER_BYTES = 64 * 1024;
const MAX_OUTBOUND_BYTES = 256 * 1024;
const SLOW_PING_LIMIT = 2;

function sendFrame(ws, msg) {
  if (ws.readyState !== ws.OPEN) return;
  const frame = JSON.stringify(msg);
  const queued = ws.bufferedAmount + Buffer.byteLength(frame);
  if (queued > MAX_OUTBOUND_BYTES) { ws.terminate(); return; }
  if (msg.t === 'p' && queued > POSITION_BUFFER_BYTES) return;
  ws.send(frame);
}

function checkSlowConsumer(ws) {
  ws.slowPings = ws.bufferedAmount >= POSITION_BUFFER_BYTES ? (ws.slowPings || 0) + 1 : 0;
  if (ws.slowPings < SLOW_PING_LIMIT) return false;
  ws.terminate();
  return true;
}

function cleanName(raw) {
  return cleanText(raw, NAME_MAX);
}
function cleanLabel(raw) { return cleanText(raw, LABEL_MAX); }
// Printable characters only; collapse runs of whitespace; clamp by code point
// (not UTF-16 unit) so a trailing emoji isn't split into a lone surrogate.
function cleanText(raw, max) {
  if (typeof raw !== 'string') return '';
  return Array.from(raw.replace(/[^\P{C}]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}
function cleanColor(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 0xffffff ? n : 0xffffff;
}
function num(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}
// Presence extras: a malformed value falls back rather than failing the frame.
function cleanEnergy(v, fallback = 1) {
  return Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100 : fallback;
}
function cleanSmallInt(v, max, fallback = 0) {
  return Number.isInteger(v) && v >= 0 ? Math.min(max, v) : fallback;
}
// A well-formed battle's relayed fields, or null to drop it.
function cleanBattle(msg) {
  const { key, startedAt, d } = msg;
  if (typeof key !== 'string' || !CASTLE_KEY_RE.test(key)) return null;
  if (!Number.isSafeInteger(startedAt) || startedAt <= 0) return null;
  if (!Number.isInteger(d) || d < 0) return null;
  return { key, startedAt, d };
}
// A well-formed aggro's relayed fields, or null to drop it.
function cleanAggro(msg) {
  const { eid, pid, d } = msg;
  if (typeof eid !== 'string' || !ENEMY_ID_RE.test(eid)) return null;
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (!Number.isInteger(d) || d < 0) return null;
  return { eid, pid, d };
}
// A well-formed hit's relayed fields, or null to drop it.
function cleanHit(msg) {
  const { id, f, left, d, k } = msg;
  if (k !== undefined && k !== 0 && k !== 1) return null;
  const kill = k === 1;
  if (typeof id !== 'string' || !ENEMY_ID_RE.test(id)) return null;
  if (!Number.isFinite(f) || f < 0 || f > 1 || (f === 0 && !kill)) return null;
  if (!Number.isFinite(left) || left < 0 || left > 1) return null;
  if (!Number.isInteger(d) || d < 0) return null;
  return kill ? { eid: id, f, left, d, k: 1 } : { eid: id, f, left, d };
}
// A well-formed seen / dead list's relayed fields, or null to drop it.
function cleanIds(msg) {
  const { ids, d } = msg;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS) return null;
  if (!ids.every((id) => typeof id === 'string' && ENEMY_ID_RE.test(id))) return null;
  if (!Number.isInteger(d) || d < 0) return null;
  return { ids, d };
}

// The enemy frames: one shared budget, each with its own cleaner.
// A Map, not an object literal: `constructor` or `__proto__` is no frame type.
const ENEMY_FRAMES = new Map([['hit', cleanHit], ['seen', cleanIds], ['dead', cleanIds],
                              ['battle', cleanBattle], ['aggro', cleanAggro]]);

function createRelay(server) {
  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES });
  const clients = new Map();   // id → { ws, id, name, color, x, y, fx, fy, m, d, e, g, v, lastPingAt }
                               // (the liveness flag + frame budget live on ws itself: ws.alive / ws.budget)
  let nextId = 1;

  const peerView = (c) => ({ id: c.id, name: c.name, color: c.color, x: c.x, y: c.y, fx: c.fx, fy: c.fy, m: c.m, d: c.d,
                             e: c.e, g: c.g, v: c.v });
  const broadcast = (msg, except) => { for (const c of clients.values()) if (c !== except) sendFrame(c.ws, msg); };
  const applyPos = (c, msg) => {
    c.x = num(msg.x, c.x); c.y = num(msg.y, c.y);
    c.fx = num(msg.fx, c.fx); c.fy = num(msg.fy, c.fy);
    c.m = msg.m ? 1 : 0; c.d = Math.max(0, num(msg.d, c.d) | 0);
    c.e = cleanEnergy(msg.e); c.g = cleanSmallInt(msg.g, MAX_FLAGS); c.v = cleanSmallInt(msg.v, MAX_VISION_CUT);
  };
  const fail = (ws, reason) => { sendFrame(ws, { t: 'error', reason }); if (ws.readyState === ws.OPEN) ws.close(1008, reason); };
  // Fan a frame out to everyone within earshot of `me` (never back to me).
  const nearby = (me, out) => {
    for (const c of clients.values()) {
      if (c === me) continue;
      if (Math.hypot(c.x - me.x, c.y - me.y) <= INTEREST_PX) sendFrame(c.ws, out);
    }
  };

  wss.on('connection', (ws) => {
    let me = null;
    ws.budget = MAX_MSGS_PER_S;   // inbound frames left this second (refilled below)
    ws.enemyBudget = MAX_ENEMY_FRAMES_PER_S;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const helloTimer = setTimeout(() => { if (!me) ws.terminate(); }, HELLO_DEADLINE_MS);
    helloTimer.unref();

    ws.on('message', (data) => {
      if (--ws.budget < 0) return fail(ws, 'rate');
      let msg;
      try { msg = JSON.parse(data); } catch { return fail(ws, 'json'); }
      if (!msg || typeof msg !== 'object') return fail(ws, 'json');

      if (!me) {
        if (msg.t !== 'hello') return fail(ws, 'hello-first');
        const name = cleanName(msg.name);
        if (!name) return fail(ws, 'name');
        me = { ws, id: nextId++, name, color: cleanColor(msg.color), x: 0, y: 0, fx: 0, fy: 1, m: 0, d: 0, e: 1, g: 0, v: 0 };
        applyPos(me, msg);
        clients.set(me.id, me);
        sendFrame(ws, { t: 'welcome', id: me.id, peers: [...clients.values()].filter(c => c !== me).map(peerView) });
        broadcast({ t: 'join', ...peerView(me) }, me);
        return;
      }
      if (msg.t === 'p') {
        applyPos(me, msg);
        nearby(me, { t: 'p', id: me.id, x: me.x, y: me.y, fx: me.fx, fy: me.fy, m: me.m, d: me.d, e: me.e, g: me.g, v: me.v });
        return;
      }
      if (msg.t === 'ping') {
        const now = Date.now();
        if (now - (me.lastPingAt || 0) < PING_GAP_MS) return;
        me.lastPingAt = now;
        nearby(me, { t: 'ping', id: me.id, name: me.name, color: me.color,
                     x: num(msg.x), y: num(msg.y), label: cleanLabel(msg.label) });
        return;
      }
      if (ENEMY_FRAMES.has(msg.t)) {
        const body = ENEMY_FRAMES.get(msg.t)(msg);
        if (!body || --ws.enemyBudget < 0) return;
        nearby(me, { t: msg.t, id: me.id, ...body });
        return;
      }
      // Unknown frames are ignored, not fatal.
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (!me) return;
      clients.delete(me.id);
      broadcast({ t: 'leave', id: me.id });
      me = null;
    });
    ws.on('error', () => ws.terminate());
  });

  // Refill everyone's per-second frame budget; ping to reap dead sockets.
  const budgetTimer = setInterval(() => { for (const c of wss.clients) { c.budget = MAX_MSGS_PER_S; c.enemyBudget = MAX_ENEMY_FRAMES_PER_S; } }, 1000);
  const pingTimer = setInterval(() => {
    for (const c of wss.clients) {
      if (checkSlowConsumer(c)) continue;
      if (!c.alive) { c.terminate(); continue; }
      c.alive = false;
      c.ping();
    }
  }, PING_MS);
  budgetTimer.unref(); pingTimer.unref();

  wss.on('close', () => { clearInterval(budgetTimer); clearInterval(pingTimer); });
  return {
    wss,
    clients,
    close: () => new Promise(res => { for (const c of wss.clients) c.terminate(); wss.close(() => res()); }),
  };
}

// Plain HTTP on the same port: GET / reports how many players are online, so a
// browser tab (or a deploy check) can tell the service is up without a socket.
function createServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, online: relay.clients.size }));
  });
  const relay = createRelay(server);
  return { server, relay };
}

if (require.main === module) {
  const { server } = createServer();
  server.listen(PORT, () => console.log(`terracart relay listening on :${PORT}`));
}

// What server/test.js drives; nothing else requires this module.
module.exports = { createServer, cleanName, cleanLabel, cleanHit, cleanIds, cleanBattle, cleanAggro, cleanEnergy, cleanSmallInt,
                   INTEREST_PX, MAX_MSGS_PER_S, MAX_ENEMY_FRAMES_PER_S, MAX_IDS, MAX_FLAGS, MAX_VISION_CUT,
                   sendFrame, checkSlowConsumer, POSITION_BUFFER_BYTES, MAX_OUTBOUND_BYTES, SLOW_PING_LIMIT };
