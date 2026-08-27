// Terracart presence relay.
//
// One tiny WebSocket server that lets players SEE each other. It holds no game
// state: every client keeps its own save, and the server only fans out
// "where I am" messages. What it does own is the roster — it assigns ids,
// pins each socket's name + colour from its hello, and tells everyone when a
// player arrives or leaves — so a client can never impersonate another.
//
// Wire protocol (JSON text frames, one object per frame):
//   client → server
//     { t:'hello', name, color, x, y, fx, fy, m, d }  first frame; name required
//     { t:'p', x, y, fx, fy, m, d }                   position update (≤ MAX_MSGS_PER_S)
//     { t:'ping', x, y, label }                       "look here" (≤ 1 per PING_GAP_MS)
//   server → client
//     { t:'welcome', id, peers:[<peer>...] }          reply to hello; peers = everyone else
//     { t:'join',  ...<peer> }                        someone new said hello
//     { t:'p',     id, x, y, fx, fy, m, d }           a peer moved (within INTEREST_PX only)
//     { t:'ping',  id, name, color, x, y, label }     a peer pinged a spot (within INTEREST_PX)
//     { t:'leave', id }                               a peer's socket closed
//     { t:'error', reason }                           then the socket is closed
//   <peer> = { id, name, color, x, y, fx, fy, m, d }
//
// Coordinates are z=14 Web-Mercator world PIXELS (WorldGen.lonLatToWorldPx) —
// absolute, so two saves anchored at different homes still agree on where a
// player stands. fx/fy is the facing vector, m = 1 while walking, d = cave
// depth (0 = surface). Clients only draw peers at their own depth.
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
// A socket that has not answered a ping in this long is dead (phone locked,
// tunnel dropped) — close it so its ghost leaves the roster.
const PING_MS = 20000;

function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  // Printable characters only; collapse runs of whitespace; clamp length.
  return raw.replace(/[^\P{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}
function cleanColor(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 0xffffff ? n : 0xffffff;
}
function num(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function createRelay(server) {
  const wss = new WebSocketServer({ server, maxPayload: 1024 });
  const clients = new Map();   // id → { ws, id, name, color, x, y, fx, fy, m, d, alive, budget }
  let nextId = 1;

  const peerView = (c) => ({ id: c.id, name: c.name, color: c.color, x: c.x, y: c.y, fx: c.fx, fy: c.fy, m: c.m, d: c.d });
  const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  const broadcast = (msg, except) => { for (const c of clients.values()) if (c !== except) send(c.ws, msg); };
  const applyPos = (c, msg) => {
    c.x = num(msg.x, c.x); c.y = num(msg.y, c.y);
    c.fx = num(msg.fx, c.fx); c.fy = num(msg.fy, c.fy);
    c.m = msg.m ? 1 : 0; c.d = Math.max(0, num(msg.d, c.d) | 0);
  };
  const fail = (ws, reason) => { send(ws, { t: 'error', reason }); ws.close(1008, reason); };
  // Fan a frame out to everyone within earshot of `me` (never back to me).
  const nearby = (me, out) => {
    for (const c of clients.values()) {
      if (c === me) continue;
      if (Math.hypot(c.x - me.x, c.y - me.y) <= INTEREST_PX) send(c.ws, out);
    }
  };

  wss.on('connection', (ws) => {
    let me = null;
    ws.budget = MAX_MSGS_PER_S;   // inbound frames left this second (refilled below)
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });

    ws.on('message', (data) => {
      if (--ws.budget < 0) return fail(ws, 'rate');
      let msg;
      try { msg = JSON.parse(data); } catch { return fail(ws, 'json'); }
      if (!msg || typeof msg !== 'object') return fail(ws, 'json');

      if (!me) {
        if (msg.t !== 'hello') return fail(ws, 'hello-first');
        const name = cleanName(msg.name);
        if (!name) return fail(ws, 'name');
        me = { ws, id: nextId++, name, color: cleanColor(msg.color), x: 0, y: 0, fx: 0, fy: 1, m: 0, d: 0 };
        applyPos(me, msg);
        clients.set(me.id, me);
        send(ws, { t: 'welcome', id: me.id, peers: [...clients.values()].filter(c => c !== me).map(peerView) });
        broadcast({ t: 'join', ...peerView(me) }, me);
        return;
      }
      if (msg.t === 'p') {
        applyPos(me, msg);
        nearby(me, { t: 'p', id: me.id, x: me.x, y: me.y, fx: me.fx, fy: me.fy, m: me.m, d: me.d });
        return;
      }
      if (msg.t === 'ping') {
        const now = Date.now();
        if (now - (me.lastPingAt || 0) < PING_GAP_MS) return;
        me.lastPingAt = now;
        nearby(me, { t: 'ping', id: me.id, name: me.name, color: me.color,
                     x: num(msg.x), y: num(msg.y), label: cleanName(msg.label).slice(0, LABEL_MAX) });
      }
      // Unknown frames are ignored, not fatal.
    });

    ws.on('close', () => {
      if (!me) return;
      clients.delete(me.id);
      broadcast({ t: 'leave', id: me.id });
      me = null;
    });
    ws.on('error', () => ws.terminate());
  });

  // Refill everyone's per-second frame budget; ping to reap dead sockets.
  const budgetTimer = setInterval(() => { for (const c of wss.clients) c.budget = MAX_MSGS_PER_S; }, 1000);
  const pingTimer = setInterval(() => {
    for (const c of wss.clients) {
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

module.exports = { createServer, createRelay, cleanName, cleanColor, INTEREST_PX, NAME_MAX, MAX_MSGS_PER_S, PING_GAP_MS };
