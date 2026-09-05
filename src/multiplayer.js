// Multiplayer presence — other players on the map, and location pings.
//
// A thin client for server/index.js (the relay). Nothing here touches the
// save except playerName / playerColor: each player keeps their own resources
// and progress, the relay only fans out "where I am" frames, and the only
// things another player can put on YOUR screen are their farmer and a ping.
//
// Why players can talk about places at all: the world is the same for
// everyone. Rocks, trees and wild plants are placed by worldgen.js from the
// map data and fixed hashes (WorldGen.makeRng over tile / OSM ids), not from
// Math.random — so "there's an iron rock by the church" means the same rock on
// every phone. Positions on the wire are z=14 world PIXELS
// (WorldGen.lonLatToWorldPx), the one frame every save agrees on whatever its
// home origin is.
//
// Depends on:
//   app.js    — scene fields: save, startWorldM, playerM, mPerPx, cellM, depth,
//               facing, _targetM, player (sprite; its mask + scale), viewCenterX/Y,
//               viewSize, _toast; textures 'idle' / 'walk' / 'bldg_shadow'; the
//               idle-*/walk-* animations.
//   render.js — worldMetersToScreen, screenToWorldMeters
//   coords.js — sameAbsCell
//   worldgen.js — WorldGen.forEachItem (ping labels)
//   items.js  — ITEM_BY_ID, TIER_BY_NUM (ping labels)
//   save.js   — persistSave
//
// Exports as global: Multiplayer
//   start(scene)              — connect once the save has a name; safe to call again
//   tick(scene)               — per frame: send position, draw peers + pings
//   consumeTap(scene, sx, sy) — true when ping mode ate the tap
//   ping(scene, wmx, wmy)     — ping a world-metre spot
//   setName(scene, name)      — rename (reconnects)
//   status()                  — 'off' | 'noname' | 'connecting' | 'online' | 'error'
//   cleanName / pickColor / toWorldPx / fromWorldPx / describeAt / edgeDot — pure, tested headlessly

const Multiplayer = (function () {
  // Where the relay lives. A page served from localhost talks to a local
  // `node server/index.js`; anything else (the GitHub Pages build) uses the
  // Vultr box behind Caddy's auto-TLS — see server/deploy/README.md.
  // Override with window.MP_SERVER_URL (set in index.html) for testing.
  const DEFAULT_URL = 'wss://155-138-151-254.sslip.io';   // server/deploy/create_instance.sh output
  const SEND_HZ = 8;             // position frames per second while moving
  const HEARTBEAT_MS = 5000;     // resend even when still, so peers don't go stale
  const PEER_STALE_MS = 20000;   // drop a peer we haven't heard from (out of range / gone)
  const PING_TTL_MS = 300000;    // how long a ping marker stays on the map (5 min)
  const PING_ARROW_MAX_M = 300;  // an off-screen ping within this many metres gets an edge arrow
  const PING_ARROW_INSET = 14;   // how far inside the view edge the arrow sits
  const PEER_NEAR_M = 300;       // a peer within this many metres is "near": counted on the
                                 // HUD chip, and dotted on the view edge while off-screen —
                                 // one number so the chip and the rim can't disagree
  const PEER_DOT_INSET = 5;      // dot centre this far inside the view edge — its outline clears the mask
  const PEER_DOT_R = 3;          // dot radius, px
  const RECONNECT_MIN_MS = 2000, RECONNECT_MAX_MS = 30000;
  const NAME_MAX = 16;
  // Light tints so the farmer's art stays readable: a tint multiplies, so the
  // sprite's whites take the colour and its darks barely move.
  const COLORS = [0xffd28a, 0x9fd8ff, 0xb8ffb0, 0xffb3e6, 0xe0c3ff, 0xfff59f, 0xffb38a, 0x9ff5e6, 0xd0d0d0, 0xc8ff8a];

  // ── pure helpers (mirrored in server/index.js; keep the two in step) ─────
  function cleanName(raw) {
    if (typeof raw !== 'string') return '';
    // Clamp by code point, not UTF-16 unit, so a trailing emoji isn't split.
    return Array.from(raw.replace(/[^\P{C}]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).join('');
  }
  function pickColor(rng = Math.random) {
    return COLORS[Math.floor(rng() * COLORS.length) % COLORS.length];
  }
  // Absolute z=14 world px of the local player (what goes on the wire).
  // Exact, at any distance from this save's own origin: playerM is projected
  // out of the GPS fix through the map's Web-Mercator (coords.js
  // lonLatToLocalM), so dividing by mPerPx undoes exactly that — no matter
  // where the peer reading it anchored THEIR world.
  function toWorldPx(scene) {
    return {
      x: (scene.startWorldM.x + scene.playerM.x) / scene.mPerPx,
      y: (scene.startWorldM.y + scene.playerM.y) / scene.mPerPx,
    };
  }
  // Wire px → absolute world metres in THIS save's frame (worldMetersToScreen's input).
  function fromWorldPx(scene, px, py) {
    return { x: px * scene.mPerPx, y: py * scene.mPerPx };
  }
  function hexCss(n) { return '#' + (n & 0xffffff).toString(16).padStart(6, '0'); }

  // Where an edge marker for something off-screen sits: the point on the
  // square view edge along the line from the view centre toward it, `inset`
  // px inside so the marker's art isn't sliced by the mask. vx/vy is the
  // screen-space offset from the view centre; returns offsets from the centre,
  // or null for a zero vector (nothing to point at). Pure — the peer edge dot
  // draws from it, and the tests pin it.
  function edgeDot(vx, vy, half, inset) {
    const m = Math.max(Math.abs(vx), Math.abs(vy));
    if (!(m > 0)) return null;
    const k = (half - inset) / m;
    return { x: vx * k, y: vy * k };
  }

  // What's at a world-metre spot, in the words a player would use: the object
  // in that cell, else the wild plant, else a creature standing there, else
  // nothing. Used as the default ping label.
  function describeAt(scene, wmx, wmy) {
    const same = (o) => sameAbsCell(scene, wmx, wmy, o.x, o.y);
    const obj = WorldGen.forEachItem('objects', (o) => (same(o) ? o : null));
    if (obj) {
      if (obj.kind === 'mineralrock') {
        const t = (typeof TIER_BY_NUM !== 'undefined') && TIER_BY_NUM[obj.yieldTier];
        return t ? `${t.name} rock` : 'Rock';
      }
      if (obj.kind === 'tree' || obj.kind === 'fruittree') {
        return obj.species ? `${obj.species[0].toUpperCase()}${obj.species.slice(1)} tree` : 'Tree';
      }
      if (obj.kind === 'chest') return 'Chest';
      if (obj.name) return String(obj.name);
      return obj.kind[0].toUpperCase() + obj.kind.slice(1).replace(/_/g, ' ');
    }
    const wp = WorldGen.forEachItem('wildplants', (p) => (same(p) ? p : null));
    if (wp) {
      const it = (typeof ITEM_BY_ID !== 'undefined') && ITEM_BY_ID[wp.crop];
      return it ? it.name : String(wp.crop);
    }
    const cr = WorldGen.forEachItem('creatures', (c) => (same(c) ? c : null));
    if (cr) return cr.kind[0].toUpperCase() + cr.kind.slice(1).replace(/_/g, ' ');
    return '';
  }

  // ── state ────────────────────────────────────────────────────────────────
  const S = {
    scene: null, ws: null, id: null, status: 'off',
    peers: new Map(),     // id → { id, name, color, x, y, fx, fy, m, d, seenAt, dx, dy, spr, lbl, sh }
    pings: [],            // { id, name, color, x, y, label, at, gfx, txt }
    lastSend: 0, lastSent: null,
    backoff: RECONNECT_MIN_MS, retryTimer: null, stopped: false,
    container: null, pingMode: false, btn: null,
    everOnline: false,    // the HUD chip stays hidden until the relay has answered once
  };

  function serverUrl() {
    if (typeof window !== 'undefined' && window.MP_SERVER_URL) return window.MP_SERVER_URL;
    const h = (typeof location !== 'undefined' && location.hostname) || '';
    if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'ws://localhost:8787';
    return DEFAULT_URL;
  }

  function posFrame(scene) {
    const p = toWorldPx(scene);
    const f = scene.facing || { x: 0, y: 1 };
    const moving = !!(scene._targetM && Math.hypot(scene._targetM.x - scene.playerM.x, scene._targetM.y - scene.playerM.y) > 0.2);
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), fx: +f.x.toFixed(2), fy: +f.y.toFixed(2), m: moving ? 1 : 0, d: scene.depth || 0 };
  }
  function send(msg) {
    if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(msg));
  }

  // ── connection ───────────────────────────────────────────────────────────
  function start(scene) {
    S.scene = scene;
    S.stopped = false;
    if (!cleanName(scene.save.playerName)) { setStatus('noname'); return; }
    if (!scene.save.playerColor) { scene.save.playerColor = pickColor(); persistSave(scene.save); }
    ensureLayer(scene);
    ensureButton(scene);
    if (S.ws) return;
    connect();
    if (!S._lifecycle) {
      S._lifecycle = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { S.ws?.close(); }
        else if (!S.stopped) {
          // Coming back from a locked screen or an app switch is not the relay
          // failing, so don't make the player serve the escalating backoff for
          // it: reset to the floor, then reconnect (or, if the socket we asked
          // to close is still closing, let its onclose retry — now at 2 s).
          S.backoff = RECONNECT_MIN_MS;
          if (!S.ws) connect();
        }
      });
    }
  }
  function connect() {
    if (S.retryTimer) { clearTimeout(S.retryTimer); S.retryTimer = null; }
    let ws;
    try { ws = new WebSocket(serverUrl()); } catch (e) { setStatus('error'); scheduleRetry(); return; }
    S.ws = ws;
    setStatus('connecting');
    ws.onopen = () => {
      const sc = S.scene;
      send({ t: 'hello', name: cleanName(sc.save.playerName), color: sc.save.playerColor, ...posFrame(sc) });
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      handle(msg);
    };
    ws.onclose = () => {
      if (S.ws !== ws) return;
      S.ws = null; S.id = null;
      clearPeers();
      if (S.stopped) { setStatus('off'); return; }
      if (S.status !== 'error') setStatus('connecting');
      if (document.visibilityState !== 'hidden') scheduleRetry();
    };
    ws.onerror = () => { setStatus('error'); };
  }
  function scheduleRetry() {
    if (S.retryTimer || S.stopped) return;
    S.retryTimer = setTimeout(() => { S.retryTimer = null; if (!S.ws) connect(); }, S.backoff);
    S.backoff = Math.min(RECONNECT_MAX_MS, S.backoff * 2);
  }
  function setStatus(st) {
    S.status = st;
    paintButton();
  }
  function status() { return S.status; }

  function handle(msg) {
    const now = performance.now();
    switch (msg.t) {
      case 'welcome':
        S.id = msg.id; S.backoff = RECONNECT_MIN_MS; S.everOnline = true; setStatus('online');
        for (const p of msg.peers || []) upsertPeer(p, now);
        break;
      case 'join': upsertPeer(msg, now); break;
      case 'p': {
        const p = S.peers.get(msg.id);
        if (p) { Object.assign(p, { x: msg.x, y: msg.y, fx: msg.fx, fy: msg.fy, m: msg.m, d: msg.d }); p.seenAt = now; }
        break;
      }
      case 'leave': dropPeer(msg.id); break;
      case 'ping': addPing(msg, now); break;
      case 'error': setStatus('error'); break;
    }
  }
  function upsertPeer(p, now) {
    let cur = S.peers.get(p.id);
    if (!cur) { cur = { id: p.id, dx: null, dy: null }; S.peers.set(p.id, cur); }
    Object.assign(cur, { name: p.name, color: p.color, x: p.x, y: p.y, fx: p.fx, fy: p.fy, m: p.m, d: p.d, seenAt: now });
    paintButton();
  }
  function dropPeer(id) {
    const p = S.peers.get(id);
    if (!p) return;
    hidePeerArt(p, true);
    S.peers.delete(id);
    paintButton();
  }
  function hidePeerArt(p, destroy) {
    if (!p.spr) return;
    if (destroy) { p.spr.destroy(); p.lbl.destroy(); p.sh.destroy(); p.spr = p.lbl = p.sh = null; }
    else { p.spr.setVisible(false); p.lbl.setVisible(false); p.sh.setVisible(false); }
  }
  // How far a peer is from the player, in world metres. Infinity before the
  // scene is up so nothing counts as near while there's nothing to measure from.
  function peerDistM(p) {
    const sc = S.scene;
    if (!sc) return Infinity;
    const wm = fromWorldPx(sc, p.x, p.y);
    return Math.hypot(wm.x - (sc.startWorldM.x + sc.playerM.x),
                      wm.y - (sc.startWorldM.y + sc.playerM.y));
  }
  // "Near" = heard from recently AND within PEER_NEAR_M. The relay only
  // forwards moves within INTEREST_PX, so a peer that walked out of range
  // goes quiet — it stays in the roster (its next frame in range revives it).
  // Recency alone used to be the whole test, which put "1 near" on the HUD
  // chip for a player half a suburb away; now the chip, the edge dot and the
  // ping arrow all agree on the same 300 m.
  const isNear = (p, now) => now - p.seenAt < PEER_STALE_MS && peerDistM(p) <= PEER_NEAR_M;
  function nearCount(now) { let n = 0; for (const p of S.peers.values()) if (isNear(p, now)) n++; return n; }
  function clearPeers() { for (const id of [...S.peers.keys()]) dropPeer(id); }

  // ── drawing ──────────────────────────────────────────────────────────────
  // One container, masked to the map view like every world layer, at depth
  // 9.8: above the world (0) so a peer stands on the ground, just under the
  // local farmer (10) so you always read as "in front" when you overlap.
  function ensureLayer(scene) {
    if (S.container) return;
    S.container = scene.add.container(0, 0).setDepth(9.8);
    if (scene.player?.mask) S.container.setMask(scene.player.mask);
    // One shared Graphics for every peer's edge dot, cleared each frame.
    S.dotGfx = scene.add.graphics();
    S.container.add(S.dotGfx);
  }
  function makePeerArt(scene, p) {
    p.sh = scene.add.image(0, 0, 'bldg_shadow').setOrigin(0.5, 0.5).setDisplaySize(17, 6).setAlpha(0.34);
    p.spr = scene.add.sprite(0, 0, 'idle', 0).setScale(scene.playerScale || 1).setTint(p.color);
    p.spr.play('idle-down');
    p.lbl = scene.add.text(0, 0, p.name, {
      font: fontMono('bold 10px'), color: hexCss(p.color),
      stroke: '#000', strokeThickness: 3, padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 1);
    S.container.add([p.sh, p.spr, p.lbl]);
  }
  function playDirected(spr, base, fx, fy) {
    let dir = 'down', flip = false;
    if (Math.abs(fx) > Math.abs(fy)) { dir = 'side'; flip = fx < 0; }
    else if (fy < 0) dir = 'up';
    const key = `${base}-${dir}`;
    if (spr.anims.currentAnim?.key !== key) spr.play(key);
    spr.setFlipX(flip);
  }
  function drawPeers(scene, now, dt) {
    const half = scene.viewSize / 2 + 24;
    S.dotGfx?.clear();
    // Time-based easing (~90% of the way in 150 ms) so a peer walks the same
    // on a 30 fps phone as at 60, instead of a per-frame fraction.
    const k = 1 - Math.exp(-dt / 0.065);
    for (const p of S.peers.values()) {
      // Quiet for too long → out of range (or a dead tab the relay hasn't
      // reaped yet). Free its art but keep the roster entry — see isNear.
      if (!isNear(p, now)) { if (p.spr) { hidePeerArt(p, true); paintButton(); } continue; }
      const wm = fromWorldPx(scene, p.x, p.y);
      const s = worldMetersToScreen(scene, wm.x, wm.y);
      // Ease toward the newest fix so 8 Hz updates read as a walk, not hops.
      if (p.dx == null || Math.hypot(s.x - p.dx, s.y - p.dy) > 96) { p.dx = s.x; p.dy = s.y; }
      else { p.dx += (s.x - p.dx) * k; p.dy += (s.y - p.dy) * k; }
      const onScreen = (p.d || 0) === (scene.depth || 0)
        && Math.abs(p.dx - scene.viewCenterX) < half && Math.abs(p.dy - scene.viewCenterY) < half;
      if (!onScreen) { hidePeerArt(p, false); drawPeerDot(scene, p); continue; }
      if (!p.spr) makePeerArt(scene, p);
      const walking = p.m && (now - p.seenAt) < 1500;
      playDirected(p.spr, walking ? 'walk' : 'idle', p.fx, p.fy);
      // (dx, dy) is the peer's fix on screen, and their FEET stand on it —
      // the sprite rises playerFeetNudgeY above it exactly like the local
      // player's (app.js), the contact shadow sits on it, and the name tag
      // floats a fixed gap over the head (23px above the sprite centre).
      p.spr.setPosition(p.dx, p.dy + scene.playerFeetNudgeY).setVisible(true);
      p.sh.setPosition(p.dx, p.dy - 1).setVisible(true);
      p.lbl.setPosition(p.dx, p.dy + scene.playerFeetNudgeY - 23).setVisible(true);
    }
  }

  // An off-screen NEAR peer (within PEER_NEAR_M — isNear gates the caller, so
  // no distance check here) shows as a small dot in their colour on the very
  // edge of the view, in the direction they are — so a friend a street over
  // registers without a name label cluttering the rim. Same clamp the ping
  // edge arrow uses (the point where the centre→peer line leaves the square),
  // just further out: a dot needs less clearance than an arrow plus its
  // distance label. A peer on another depth is skipped — they aren't on your
  // map.
  function drawPeerDot(scene, p) {
    if (!S.dotGfx) return;
    if ((p.d || 0) !== (scene.depth || 0)) return;
    const e = edgeDot(p.dx - scene.viewCenterX, p.dy - scene.viewCenterY,
      scene.viewSize / 2, PEER_DOT_INSET);
    if (!e) return;
    const x = scene.viewCenterX + e.x, y = scene.viewCenterY + e.y;
    // Dark halo first so the dot reads on pale terrain, like every rim marker.
    S.dotGfx.fillStyle(0x000000, 0.55).fillCircle(x, y, PEER_DOT_R + 1.5);
    S.dotGfx.fillStyle(p.color, 0.95).fillCircle(x, y, PEER_DOT_R);
  }

  // ── pings ────────────────────────────────────────────────────────────────
  function addPing(msg, now) {
    const scene = S.scene;
    const mine = msg.id === S.id;
    const ping = { id: msg.id, name: msg.name, color: msg.color, x: msg.x, y: msg.y, label: msg.label || '', at: now };
    // Replace an older ping from the same player — one marker per person.
    S.pings = S.pings.filter(q => { if (q.id === ping.id) { q.gfx?.destroy(); q.txt?.destroy(); return false; } return true; });
    S.pings.push(ping);
    if (!mine) {
      const wm = fromWorldPx(scene, ping.x, ping.y);
      const dx = wm.x - (scene.startWorldM.x + scene.playerM.x), dy = wm.y - (scene.startWorldM.y + scene.playerM.y);
      const dist = Math.round(Math.hypot(dx, dy));
      const arrow = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
      scene._toast?.(`📍 ${ping.name}: ${ping.label || 'here'} · ${dist} m ${arrow}`, { tier: 'sub', color: hexCss(ping.color) });
    }
  }
  function drawPings(scene, now) {
    if (!S.pings.length) return;
    for (let i = S.pings.length - 1; i >= 0; i--) {
      const q = S.pings[i];
      if (now - q.at > PING_TTL_MS) { q.gfx?.destroy(); q.txt?.destroy(); S.pings.splice(i, 1); }
    }
    const half = scene.viewSize / 2;
    for (const q of S.pings) {
      const wm = fromWorldPx(scene, q.x, q.y);
      const s = worldMetersToScreen(scene, wm.x, wm.y);
      if (!q.gfx) {
        q.gfx = scene.add.graphics();
        q.txt = scene.add.text(0, 0, '', {
          font: fontMono('bold 10px'), color: hexCss(q.color),
          stroke: '#000', strokeThickness: 3, padding: { x: 2, y: 1 },
        }).setOrigin(0.5, 1);
        S.container.add([q.gfx, q.txt]);
      }
      const t = (now - q.at) / 1000;
      const vx = s.x - scene.viewCenterX, vy = s.y - scene.viewCenterY;
      q.gfx.clear();
      if (Math.abs(vx) <= half && Math.abs(vy) <= half) {
        // On screen: a ring that breathes over the cell, and a bobbing label —
        // a marker that moves reads as "look here" where a static one reads
        // as terrain.
        const bob = Math.sin(t * 4) * 3;
        const r = 12 + 4 * (0.5 + 0.5 * Math.sin(t * 3));
        q.gfx.lineStyle(2, q.color, 0.9).strokeCircle(s.x, s.y, r);
        q.gfx.lineStyle(1, 0x000000, 0.5).strokeCircle(s.x, s.y, r + 1.5);
        setPingText(q, `📍 ${q.name}${q.label ? ': ' + q.label : ''}`);
        q.txt.setOrigin(0.5, 1).setPosition(s.x, s.y - 18 + bob).setVisible(true);
        continue;
      }
      // Off screen: an arrow on the view edge pointing at the spot, with the
      // remaining distance, so a nearby ping can be walked to. Beyond
      // PING_ARROW_MAX_M the marker just waits at its spot — no arrow.
      const dxm = wm.x - (scene.startWorldM.x + scene.playerM.x);
      const dym = wm.y - (scene.startWorldM.y + scene.playerM.y);
      const dist = Math.hypot(dxm, dym);
      if (dist > PING_ARROW_MAX_M) { q.txt.setVisible(false); continue; }
      const kk = (half - PING_ARROW_INSET) / Math.max(Math.abs(vx), Math.abs(vy));
      const ex = scene.viewCenterX + vx * kk, ey = scene.viewCenterY + vy * kk;
      const cos = Math.cos(Math.atan2(vy, vx)), sin = Math.sin(Math.atan2(vy, vx));
      const len = 9 + 2 * (0.5 + 0.5 * Math.sin(t * 3));   // same breath as the ring
      const tipX = ex + cos * len, tipY = ey + sin * len;
      const ax = ex - cos * len - sin * 6, ay = ey - sin * len + cos * 6;
      const bx = ex - cos * len + sin * 6, by = ey - sin * len - cos * 6;
      q.gfx.fillStyle(q.color, 0.95).fillTriangle(tipX, tipY, ax, ay, bx, by);
      q.gfx.lineStyle(1, 0x000000, 0.6).strokeTriangle(tipX, tipY, ax, ay, bx, by);
      setPingText(q, `📍 ${q.name} · ${Math.round(dist)} m`);
      // Label sits inward of the arrow, clamped so it never clips the mask.
      const tw = q.txt.width / 2 + 2, th = q.txt.height / 2 + 2;
      const tx = Math.min(scene.viewCenterX + half - tw, Math.max(scene.viewCenterX - half + tw, ex - cos * 24));
      const ty = Math.min(scene.viewCenterY + half - th, Math.max(scene.viewCenterY - half + th, ey - sin * 24));
      q.txt.setOrigin(0.5, 0.5).setPosition(tx, ty).setVisible(true);
    }
  }
  // Re-rendering a Phaser text is the expensive part; only do it on change.
  function setPingText(q, s) {
    if (q._txtStr === s) return;
    q._txtStr = s;
    q.txt.setText(s);
  }
  function ping(scene, wmx, wmy) {
    if (S.status !== 'online') { scene._toast?.('Not connected', { tier: 'note' }); return false; }
    const label = describeAt(scene, wmx, wmy);
    send({ t: 'ping', x: +(wmx / scene.mPerPx).toFixed(2), y: +(wmy / scene.mPerPx).toFixed(2), label });
    // Show it locally right away (the relay never echoes to the sender).
    addPing({ id: S.id, name: scene.save.playerName, color: scene.save.playerColor,
              x: wmx / scene.mPerPx, y: wmy / scene.mPerPx, label }, performance.now());
    scene._toast?.(`📍 Pinged ${label || 'this spot'}`, { tier: 'note' });
    return true;
  }
  // Ping mode: tap 📍, then tap the map. The armed button says exactly that.
  function consumeTap(scene, sx, sy) {
    if (!S.pingMode) return false;
    S.pingMode = false;
    paintButton();
    const half = scene.viewSize / 2;
    if (Math.abs(sx - scene.viewCenterX) > half || Math.abs(sy - scene.viewCenterY) > half) return false;
    const wm = screenToWorldMeters(scene, sx, sy);
    ping(scene, wm.x, wm.y);
    return true;
  }

  // ── HUD button ───────────────────────────────────────────────────────────
  // Bottom-left, opposite the Eat / Use buttons. Shows who's around and arms
  // ping mode; hidden until the relay is reachable so an offline player
  // never sees a dead control.
  function ensureButton(scene) {
    if (S.btn || typeof document === 'undefined') return;
    const btn = document.createElement('button');
    btn.id = 'mp-btn';
    btn.className = 'hud-action';
    btn.style.cssText =
      'position:fixed;' +
      'bottom:calc(4px + env(safe-area-inset-bottom, 0px));' +
      'left:calc(var(--phone-left, 0px) + 8px);z-index:7;' +
      'display:none;align-items:center;gap:6px;' +   // shown by paintButton; body.modal-open hides it (index.html)
      'padding:6px 10px;border-radius:8px;cursor:pointer;' +
      'color:#9fd8ff;border:2px solid #3a6c8c;background:rgba(10,20,30,.85);' +
      'font:700 12px ui-monospace,monospace;';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (S.status !== 'online') return;
      S.pingMode = !S.pingMode;
      paintButton();
      if (S.pingMode) scene._toast?.('Tap the map to ping a spot for other players', { tier: 'note' });
    });
    document.body.appendChild(btn);
    S.btn = btn;
  }
  function paintButton() {
    const btn = S.btn;
    if (!btn) return;
    // Invisible until the relay has answered once this page load: an
    // unreachable server must not leave a dead "connecting…" chip on screen.
    if (S.status === 'noname' || S.status === 'off' || !S.everOnline) { btn.style.display = 'none'; return; }
    btn.style.display = 'flex';
    // Glyphs only, no words: 📍 arms a ping (the arming toast explains the
    // tap), 👥 N is who's near. Armed shows a bare 📍… under the gold rim.
    const n = nearCount(performance.now());
    if (S.status !== 'online') { btn.textContent = '👥 …'; btn.style.opacity = '.6'; return; }
    btn.style.opacity = '1';
    btn.textContent = S.pingMode ? '📍…' : `📍 · 👥 ${n}`;
    btn.style.borderColor = S.pingMode ? '#ffd24a' : '#3a6c8c';
  }

  // ── per-frame ────────────────────────────────────────────────────────────
  function tick(scene) {
    if (S.status === 'noname' && cleanName(scene.save.playerName)) start(scene);
    if (!S.container) return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - (S.lastTick || now)) / 1000);
    S.lastTick = now;
    if (S.status === 'online') {
      const f = posFrame(scene);
      const prev = S.lastSent;
      const changed = !prev || f.x !== prev.x || f.y !== prev.y || f.fx !== prev.fx || f.fy !== prev.fy || f.m !== prev.m || f.d !== prev.d;
      if ((changed && now - S.lastSend >= 1000 / SEND_HZ) || now - S.lastSend >= HEARTBEAT_MS) {
        send({ t: 'p', ...f }); S.lastSend = now; S.lastSent = f;
      }
    }
    drawPeers(scene, now, dt);
    drawPings(scene, now);
    // "Near" moves with DISTANCE now, not just joins/leaves — walking toward
    // or away from someone must move the chip's count, so repaint on change.
    const n = nearCount(now);
    if (n !== S._nearN) { S._nearN = n; paintButton(); }
  }

  function setName(scene, name) {
    const n = cleanName(name);
    if (!n) return false;
    scene.save.playerName = n;
    if (!scene.save.playerColor) scene.save.playerColor = pickColor();
    persistSave(scene.save);
    // The relay pins the name at hello, so a rename means a fresh hello.
    if (S.ws) { const ws = S.ws; S.ws = null; ws.onclose = null; ws.close(); clearPeers(); }
    S.status = 'off';
    start(scene);
    return true;
  }

  return { start, tick, consumeTap, ping, setName, status,
           cleanName, pickColor, toWorldPx, fromWorldPx, describeAt, edgeDot,
           COLORS, NAME_MAX, PEER_NEAR_M, PEER_DOT_INSET, PEER_DOT_R,
           _state: S };
})();
if (typeof window !== 'undefined') window.Multiplayer = Multiplayer;
