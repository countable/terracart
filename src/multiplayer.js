// Multiplayer presence — other players on the map, location pings, and
// shared damage to the enemies nearby players fight.
//
// A thin client for server/index.js (the relay). Nothing here touches the
// save except playerName / playerColor, through resolveDefeat a foe a peer
// killed, and a castle battle a peer started (Houses.adoptCitadelBattle):
// each player keeps their own resources and progress, the relay only fans
// out "where I am", "I hit that enemy", "my battle is on" and "that foe is
// after X" frames, and the only things another player can put on YOUR screen
// are their farmer (with a health bar while hurt), a ping, the blows they
// land on the enemies you both see, and those enemies going after them.
//
// Shared hits work because enemies are deterministic too: the same id on the
// same seat for everyone (Combat.maxHp is the same pool on every client up to
// a thrown potion, which is why a hit travels as a FRACTION of max HP). Each
// client still runs its own enemy AI; only its own side's damage is sent
// (Combat.isSharedHit), batched per enemy, and an own-side kill is announced
// with `k: 1`, which kills every receiver's copy whatever HP it shows. A
// received hit lands as source Combat.PEER_SOURCE: shown like any blow, never
// sent on, and its kill pays nothing here (app.js resolveDefeat). Only a
// world-shared creature takes part (EnemySpawns.isSharedId: not a ghost, a
// split half or anything else minted per device). A player who missed a
// death learns it: each loaded shared enemy is periodically announced in a `seen`
// frame, and a peer whose save holds it dead answers `dead` to everyone near.
//
// CASTLE BATTLES are shared too: a citadel battle (Houses.startCitadelBattle)
// is announced in a `battle` frame on start and every BATTLE_MS while it runs;
// a nearby player with no battle there ADOPTS it with the same start
// (Houses.adoptCitadelBattle — two starts merge to the earlier), so everyone
// in it shares one deadline and expires together. While the battle is live
// its guards are shared enemies (EnemySpawns.isSharedId with the save), and a
// guard's hit, kill or death is taken only from a peer whose own battle frame
// names the same start (battleShared). Each participant claims the castle in
// its own save when it sees every guard down.
//
// SHARED TARGETING: every device simulates every enemy, so a shared foe picks
// the SAME player on all of them (enemyTarget — nearest eligible player, a tie
// band broken by lowest relay id, sticky). A copy whose target is a peer
// chases that peer's spot and its attack does nothing here (creature_ai.js
// peerFeint); on the peer's own device the same foe hurts them normally. A
// device that picks or switches a target says so (`aggro`) and the others
// adopt it. What the rule reads about a player travels in the presence frame:
// `g` (TARGET_FLAGS), `v` (gear's cut to enemy sight) and `e`, the player's
// energy as a fraction of its cap — also drawn as a bar over a hurt peer.
//
// A PARTY MEETS BIGGER GROUPS: the zone encounter groups round this player
// grow with the number of near players (scaleParty → EnemyHabitats.
// scaleEncounters), on every device alike, by draws off the group id.
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
//               facing, _targetM, playerScale, worldContainer, shadowContainer, viewCenterX/Y,
//               viewSize, _toast; the 'bldg_shadow' texture; the cyan
//               farmer's sheet and directional animations
//               (SpriteLayout.PLAYER_ART.farmer — every peer wears it).
//   render.js — worldMetersToScreen, screenToWorldMeters
//   coords.js — sameAbsCell
//   worldgen.js — WorldGen.forEachItem / forEachItemNear (ping labels, shared enemies)
//   combat.js — Combat (shared hits: isSharedHit, PEER_SOURCE, maxHp, hpFraction)
//   enemy_spawns.js — EnemySpawns.isSharedId / SHARED_ID_RE, surfaceActive
//   enemy_habitats.js — EnemyHabitats.scaleEncounters (a party's bigger groups)
//   coords.js — eachTile3x3
//   houses.js — Houses (citadel battles: isCitadelKey, adoptCitadelBattle, citadelBattleActive)
//   castle_styles.js — CastleStyles (a battle toast's castle name)
//   energy.js — Energy.maxEnergy (published health)
//   creature_ai.js — inKerbAt, wardTrip, CREATURE_SIM_CELLS (target flags, sight)
//   app.js    — FIRE_REST_R; scene._drawEnemyHealthBar, _npcWardContext,
//               isUnnoticed, _nearAny, _expireCitadelBattles, _lastLairT
//   util.js   — setOf
//   items.js  — ITEM_BY_ID, TIER_BY_NUM (ping labels), jewelryVisionReduction
//   save.js   — persistSave
//
// Exports as global: Multiplayer
//   start(scene)              — connect once the save has opted in (save.multiplayer,
//                               the ☰ toggle) and has a name; safe to call again
//   stop(scene)               — leave: close the socket, drop peers and pings
//   tick(scene)               — per frame: send position, draw peers + pings
//   consumeTap(scene, sx, sy) — true when ping mode ate the tap
//   ping(scene, wmx, wmy)     — ping a world-metre spot
//   setName(scene, name)      — rename (reconnects if online)
//   reportHit(scene, c, dealt, source) — own-side damage to an enemy (app.js _damageEnemy, the pet bite)
//   reportKill(scene, c, source)       — own-side kill (app.js resolveDefeat)
//   applyHit(scene, msg)               — a peer's hit frame onto this client's copy
//   enemyTarget(scene, c, px, py)      — the peer a shared foe is after (a body for
//                                        scene_creatures.js's npcTarget lane), or null
//                                        for "the local player, as today"
//   onBattle(scene, msg) / onAggro(scene, msg) — a peer's battle / aggro frame
//   (seen / dead / battle / aggro sends run inside tick: see "shared enemies")
//   pickTarget / localTargetState      — pure halves of the target rule, tested headlessly
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
  // Shared hits: damage to one enemy is summed and sent at most every
  // HIT_FLUSH_MS (an aura or a burn lands every frame), ≤ HIT_MAX_PER_S frames
  // a second in all — inside the relay's enemy budget. Kills take priority.
  const HIT_FLUSH_MS = 250;
  const HIT_MAX_PER_S = 12;
  const ENEMY_MAX_PER_S = 20;
  const HIT_F_MIN = 1e-4;        // the wire's resolution: f is rounded to 4 places
  // Seen / dead: shared enemies are announced at most once a
  // SEEN_MS, ≤ SEEN_MAX_IDS ids a frame (the relay's cap); a knower answers
  // after DEAD_JITTER_MIN..MAX_MS unless another peer answered for that id
  // within DEAD_HEARD_MS. All of it stays inside the relay's
  // MAX_ENEMY_FRAMES_PER_S with the hits.
  const SEEN_MS = 1000;
  const SEEN_RETRY_MS = 10000;
  const RECEIVED_HIT_TTL_MS = 30000, RECEIVED_DEAD_TTL_MS = 300000;
  const RECEIVED_MAX = 512;
  const SEEN_MAX_IDS = 32;
  const DEAD_JITTER_MIN_MS = 100, DEAD_JITTER_MAX_MS = 600;
  const DEAD_HEARD_MS = 2000;
  // Battles: an active citadel battle is re-announced every BATTLE_MS so a
  // late arrival joins; an adoption or a later start heard is answered after
  // BATTLE_REPLY_MS at most (≤ 1 battle frame a second in all).
  const BATTLE_MS = 5000;
  const BATTLE_REPLY_MS = 1000;
  // Aggro: ≤ AGGRO_MAX_PER_S frames a second, the newest pick per enemy
  // (coalesced while it waits). Two announcements for one enemy inside
  // AGGRO_TIE_MS are a conflict and the LOWER pid wins; past that window the
  // newer announcement wins. Entries older than AGGRO_TTL_MS are forgotten.
  const AGGRO_MAX_PER_S = 4;
  const AGGRO_TIE_MS = 1000;
  const AGGRO_TTL_MS = 30000;
  // The target rule, in cells: candidates within TARGET_TIE_CELLS of the
  // nearest are a tie (lowest id wins); a held target is kept until another
  // is nearer by more than TARGET_STICKY_CELLS, and until it is past the
  // foe's sight by TARGET_KEEP_CELLS — so a few metres of network lag can't flip it.
  const TARGET_TIE_CELLS = 0.5;
  const TARGET_STICKY_CELLS = 2;
  const TARGET_KEEP_CELLS = 1;
  // What the target rule reads about a player, one bit each, published as
  // presence `g`. Any bit set: no shared foe picks that player.
  //   downed  — energy at 0 (Combat.playerDowned)
  //   hidden  — the scene's unnoticed lane (isUnnoticed: Shadow Powder, the
  //             Moss boon, a collapse, riding too fast)
  //   kerb    — feet in a major road's kerb buffer (inKerbAt — the kerb ends chases)
  //   warded  — inside Home's ring or a claimed castle's (wardTrip, HOME_R)
  //   fireside — resting by a campfire (FIRE_REST_R — the ring NPC.canTarget refuses)
  // Gear's cut to enemy sight (jewelryVisionReduction) rides as presence `v`.
  const TARGET_FLAGS = Object.freeze({ downed: 1, hidden: 2, kerb: 4, warded: 8, fireside: 16 });
  const VISION_CUT_MAX = 15;          // server/index.js MAX_VISION_CUT
  // Party size: how often the zone encounter groups round this player are
  // grown to the number of players here (EnemyHabitats.scaleEncounters).
  const PARTY_SCAN_MS = 1000;
  const GROUP_RETRY_MS = 10000;
  const GROUP_MAX_PLAYERS = 32;   // server/index.js MAX_GROUP_PARTY
  const GROUP_MAX_RECORDS = 2048;
  const GROUP_TTL_MS = 5 * 60 * 1000;
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
    const p = playerWorldM(scene);
    return { x: p.x / scene.mPerPx, y: p.y / scene.mPerPx };
  }
  // Wire px → absolute world metres in THIS save's frame (worldMetersToScreen's input).
  function fromWorldPx(scene, px, py) {
    return { x: px * scene.mPerPx, y: py * scene.mPerPx };
  }
  // int → '#rrggbb': cssOf, from util.js.

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
      if (isTreeLike(obj.kind)) {
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
    hits: new Map(),      // enemy id → { c, f, d }: own-side damage not yet sent
    hitFlushT: 0, hitTimes: [], enemyTimes: [],
    seenIds: new Map(),   // id → last announcement, for the active depth
    seenScanT: 0, seenDepth: null,
    received: new Map(),  // depth:id:sender:battles → deferred damage/death
    deadPending: new Map(),   // depth:id → { id, d }: our answer after jitter
    deadHeard: new Map(),     // depth:id → when a peer last said it was dead
    deadReplyAt: 0,
    battleSent: new Map(),    // castle key → { startedAt, at }: our last battle frame
    battleDue: new Set(),     // castle keys to announce at the next reply slot
    peerBattles: new Map(),   // peer id → Map(castle key → startedAt) from their battle frames
    aggro: new Map(),         // enemy id → { pid, at, seq, own, d }: the newest accepted announcement
    aggroQueue: new Map(),    // enemy id → { pid, d }: our picks waiting for a send slot
    aggroSeq: 0, aggroWindowT: 0, aggroSent: 0,
    local: null,              // { e, g, v }: this player's published health and target flags
    partyScanT: 0,
    groupSizes: new Map(), // received encounter id → { p, until }; surface only
    groupSent: new WeakMap(), // loaded group → { p, at, epoch }; cannot be evicted by remote reports
    groupEpoch: 0,
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
    const t = S.local = localTargetState(scene);
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), fx: +f.x.toFixed(2), fy: +f.y.toFixed(2), m: moving ? 1 : 0, d: scene.depth || 0,
             e: t.e, g: t.g, v: t.v };
  }
  // What this player publishes for the target rule and the peers' health
  // bars: energy as a fraction of its cap (Energy.maxEnergy — the one cap),
  // to two places; TARGET_FLAGS; gear's sight cut. Each read is the predicate
  // the local enemy AI asks, so a peer's copy of a foe judges this player as
  // the foe on this device would.
  function localTargetState(scene) {
    const save = scene.save || {};
    const p = playerWorldM(scene);
    const max = typeof Energy !== 'undefined' ? Energy.maxEnergy(save) : (save.maxEnergy || 100);
    const e = Math.round(Math.min(1, Math.max(0, (Number(save.energy) || 0) / (max || 1))) * 100) / 100;
    let g = 0;
    if (Combat.playerDowned(save.energy)) g |= TARGET_FLAGS.downed;
    if (scene.isUnnoticed?.()) g |= TARGET_FLAGS.hidden;
    if (scene.tileEdgeM > 0 && typeof inKerbAt === 'function' && inKerbAt(scene, p.x, p.y)) g |= TARGET_FLAGS.kerb;
    const w = scene._npcWardContext;
    if (w && typeof wardTrip === 'function' && wardTrip(p, w.home, w.castles, w.radius2)) g |= TARGET_FLAGS.warded;
    if (typeof FIRE_REST_R !== 'undefined' && scene._nearAny?.('fires', p.x, p.y, FIRE_REST_R)) g |= TARGET_FLAGS.fireside;
    const cut = typeof jewelryVisionReduction === 'function' ? jewelryVisionReduction(save) : 0;
    const v = Math.min(VISION_CUT_MAX, Math.max(0, Math.round(Number(cut) || 0)));
    return { e, g, v };
  }
  function send(msg) {
    if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(msg));
  }

  // All enemy channels share the relay's cap, regardless of where their
  // individual timers fall. A full budget leaves work queued for the next tick.
  function sendEnemy(msg, now) {
    S.enemyTimes = S.enemyTimes.filter(t => now - t < 1000);
    if (S.enemyTimes.length >= ENEMY_MAX_PER_S) return false;
    send(msg);
    S.enemyTimes.push(now);
    return true;
  }

  // ── connection ───────────────────────────────────────────────────────────
  function start(scene) {
    S.scene = scene;
    // Multiplayer is OPT-IN, per game, from the ☰ menu. A game that hasn't
    // opted in never connects and is never asked for a name — the name is
    // asked for at the toggle, the moment it starts to mean something.
    if (!scene.save.multiplayer) { stop(scene); return; }
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
  // Leave the relay: no socket, no retry, no peers or pings on the map. The
  // chip hides itself on 'off' (paintButton).
  function stop(scene) {
    if (scene) S.scene = scene;
    S.stopped = true;
    if (S.retryTimer) { clearTimeout(S.retryTimer); S.retryTimer = null; }
    if (S.ws) { const ws = S.ws; S.ws = null; S.id = null; ws.onclose = null; ws.close(); }
    clearPeers();
    if (S.scene) S.scene._peerUprightPieces = [];
    for (const p of S.pings) { p.gfx?.destroy(); p.txt?.destroy(); }
    S.pings = [];
    S.pingMode = false;
    setStatus('off');
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
  function handle(msg) {
    const now = performance.now();
    switch (msg.t) {
      case 'welcome':
        S.id = msg.id; S.backoff = RECONNECT_MIN_MS; S.everOnline = true;
        S.groupEpoch++;
        S.seenIds.clear(); S.seenScanT = 0;   // announce what we see again to whoever is here now
        for (const p of msg.peers || []) upsertPeer(p, now, false);
        setStatus('online'); // one HUD count after the whole roster is ready
        break;
      case 'join':
        S.seenIds.clear();
        S.groupEpoch++;
        upsertPeer(msg, now); break;
      case 'p': {
        const p = S.peers.get(msg.id);
        if (p) { Object.assign(p, { x: msg.x, y: msg.y, fx: msg.fx, fy: msg.fy, m: msg.m, d: msg.d }, presenceExtras(msg)); p.seenAt = now; }
        break;
      }
      case 'leave': dropPeer(msg.id); S.peerBattles.delete(msg.id); break;
      case 'battle': onBattle(S.scene, msg); break;
      case 'aggro': onAggro(S.scene, msg, now); break;
      case 'group': onGroup(msg, now); break;
      case 'ping': addPing(msg, now); break;
      case 'hit': applyHit(S.scene, msg); break;
      case 'seen': onSeen(S.scene, msg, now); break;
      case 'dead': onDead(S.scene, msg, now); break;
      case 'error': setStatus('error'); break;
    }
  }
  function upsertPeer(p, now, repaint = true) {
    let cur = S.peers.get(p.id);
    if (!cur) { cur = { id: p.id, dx: null, dy: null }; S.peers.set(p.id, cur); }
    Object.assign(cur, { name: p.name, color: p.color, x: p.x, y: p.y, fx: p.fx, fy: p.fy, m: p.m, d: p.d, seenAt: now }, presenceExtras(p));
    if (repaint) paintButton();
  }
  // A peer's health and target flags, as the relay clamps them; an old
  // client (or a relay that predates them) reads as full health, no flags.
  function presenceExtras(m) {
    const e = Number(m.e);
    return {
      e: Number.isFinite(e) ? Math.min(1, Math.max(0, e)) : 1,
      g: Number.isInteger(m.g) && m.g >= 0 ? m.g : 0,
      v: Number.isInteger(m.v) && m.v >= 0 ? Math.min(VISION_CUT_MAX, m.v) : 0,
    };
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
    const wm = fromWorldPx(sc, p.x, p.y), me = playerWorldM(sc);
    return Math.hypot(wm.x - me.x, wm.y - me.y);
  }
  // "Near" = heard from recently AND within PEER_NEAR_M. The relay only
  // forwards moves within INTEREST_PX, so a peer that walked out of range
  // goes quiet — it stays in the roster (its next frame in range revives it).
  // The chip, the edge dot and the ping arrow all agree on the same distance.
  const isNear = (p, now) => now - p.seenAt < PEER_STALE_MS && peerDistM(p) <= PEER_NEAR_M;
  function nearCount(now) { let n = 0; for (const p of S.peers.values()) if (isNear(p, now)) n++; return n; }
  function clearPeers() { for (const id of [...S.peers.keys()]) dropPeer(id); clearEnemySync(); }

  // ── shared enemies: hits, kills, "seen" and "dead" ───────────────────────
  // Lost frames (a reconnect, the relay's cap) are accepted: hits are deltas,
  // so two players striking at once both land; a kill is its own frame, and a
  // death anyone missed is learnt again through seen → dead.
  // Only a world-shared creature (EnemySpawns.isSharedId) is ever sent or
  // touched — both ends ask the same predicate, with their own save (a
  // citadel guard is shared only while that save's battle for it is live).
  const sharedEnemy = (c, save) => EnemySpawns.isSharedId(c, save) && Combat.isEnemyKind(c.kind) && !Combat.isTame(c);
  const shareable = (c, save) => sharedEnemy(c, save) && Combat.isEnemy(c);
  const validId = (id) => typeof id === 'string' && EnemySpawns.SHARED_ID_RE.test(id);
  const round4 = (v) => Math.round(v * 1e4) / 1e4;
  function clearEnemySync() {
    S.hits.clear(); S.hitTimes = []; S.enemyTimes = []; S.hitFlushT = 0;
    S.seenIds.clear(); S.seenScanT = 0; S.seenDepth = null;
    S.deadPending.clear(); S.deadHeard.clear(); S.deadReplyAt = 0; S.received.clear();
    S.battleSent.clear(); S.battleDue.clear(); S.peerBattles.clear();
    S.aggro.clear(); S.aggroQueue.clear(); S.local = null; S.partyScanT = 0; S.groupSizes.clear(); S.groupSent = new WeakMap(); S.groupEpoch = 0;
  }
  function hitFrame(id, f, left, d, kill) {
    const frame = { t: 'hit', id, f: round4(Math.min(1, Math.max(0, f))), left: round4(Math.min(1, Math.max(0, left))), d };
    if (kill) frame.k = 1;
    return frame;
  }
  // AN ASSIST (owner, Oct 2026): a peer's kill of a foe this client's own
  // side damaged within ASSIST_MS pays this client the kill's loot too
  // (resolveDefeat) — never its ledger credit. Stamped on every own-side
  // blow, online or not, so a reconnect mid-fight still counts.
  const ASSIST_MS = 60000;
  function assisted(c, now = Date.now()) {
    return Number.isFinite(c?._ownHitAt) && now - c._ownHitAt <= ASSIST_MS;
  }
  function reportHit(scene, c, dealt, source) {
    if (dealt > 0 && c && Combat.isSharedHit(source)) c._ownHitAt = Date.now();
    if (S.status !== 'online' || !(dealt > 0) || !Combat.isSharedHit(source) || !shareable(c, scene.save)) return false;
    let h = S.hits.get(c.id);
    if (!h) S.hits.set(c.id, h = { c, f: 0, d: scene.depth || 0 });
    h.f += dealt / (Combat.maxHp(c) || 1);
    return true;
  }
  // Called from resolveDefeat for every death; only an own-side kill of a
  // shared enemy announces itself (`k: 1`, authoritative for every receiver),
  // carrying whatever of its damage was still unsent.
  function reportKill(scene, c, source) {
    if (S.status !== 'online' || !Combat.isSharedHit(source) || !shareable(c, scene.save)) return false;
    const h = S.hits.get(c.id);
    S.hits.set(c.id, { c, f: h ? h.f : 0, d: scene.depth || 0, kill: true });
    flushHits(performance.now(), true);
    return true;
  }
  function flushHits(now, urgent = false) {
    if (!S.hits.size || (!urgent && now - S.hitFlushT < HIT_FLUSH_MS)) return;
    S.hitFlushT = now;
    // A rolling window also fits inside the relay's independently phased
    // second. Burst kills wait their turn instead of flooding the socket.
    S.hitTimes = S.hitTimes.filter(t => now - t < 1000);
    const pending = [...S.hits].sort((a, b) => Number(!!b[1].kill) - Number(!!a[1].kill));
    for (const [id, h] of pending) {
      if (S.hitTimes.length >= HIT_MAX_PER_S) break;
      if (!sharedEnemy(h.c, S.scene?.save)) { S.hits.delete(id); continue; }
      if (!h.kill && h.f < HIT_F_MIN) continue;
      if (!sendEnemy(hitFrame(id, h.f, h.kill ? 0 : Combat.hpFraction(h.c), h.d, h.kill), now)) break;
      S.hits.delete(id);
      S.hitTimes.push(now);
    }
  }
  // The loaded creatures (this level's tile cache) with any of `ids`.
  function findCreatures(ids) {
    const out = new Map();
    WorldGen.forEachItem('creatures', (o) => {
      if (ids.has(o.id) && !out.has(o.id)) out.set(o.id, o);
      return out.size === ids.size;
    });
    return out;
  }
  // A peer's hit onto this client's copy: the shared enemy with that id at
  // this depth among the loaded tiles, or deferred until its tile arrives.
  // A visible foe takes it through _damageEnemy (bar, number); one
  // a per-player overlay hides (_surfaceInactive) takes it silently. `k`
  // kills the copy outright, whatever HP it shows, as a peer's kill
  // (resolveDefeat pays nothing for it and announces nothing). A citadel
  // guard takes it only from a sender fighting this save's battle there
  // (battleShared: the sender's `msg.id` and its battle frames).
  function applyHit(scene, msg, c = null, defer = true) {
    if (!scene || !scene.save || !msg || !validId(msg.eid)) return false;
    if (!Number.isInteger(msg.d) || msg.d < 0) return false;
    const f = Number(msg.f);
    if (!(f >= 0 && f <= 1)) return false;
    if ((scene.save.caught || []).includes(msg.eid)) return false;
    if (msg.d === (scene.depth || 0)) c = c || findCreatures(new Set([msg.eid])).get(msg.eid);
    if (msg.d !== (scene.depth || 0) || !c) {
      if (defer) rememberHit(msg, performance.now());
      return false;
    }
    if (!sharedEnemy(c, scene.save)) return false;
    if (c.castle && !battleShared(scene.save, msg.id, c.castle)) return false;
    const peer = Combat.PEER_SOURCE;
    const amount = f * Combat.maxHp(c);
    let dead = false;
    if (amount > 0) {
      if (c._surfaceInactive) {
        Combat.damageDealt(c, amount, { exact: true });
        c._lastDamagedT = Date.now();
        if (Combat.hp(c) <= 0) { scene.resolveDefeat(c, peer); dead = true; }
      } else {
        dead = !!scene._damageEnemy(c, amount, peer, { exact: true });
      }
    }
    if (msg.k === 1 && !dead) { c._hp = 0; scene.resolveDefeat(c, peer); }
    return true;
  }

  function rememberHit(msg, now) {
    const battles = new Map(S.peerBattles.get(msg.id) || []);
    const generation = JSON.stringify([...battles]);
    const key = `${msg.d}:${msg.eid}:${msg.id}:${generation}`, old = S.received.get(key);
    const kill = msg.k === 1 || old?.k === 1;
    S.received.delete(key);
    S.received.set(key, { id: msg.id, eid: msg.eid, d: msg.d,
      battles, f: Math.min(1, (old?.f || 0) + Number(msg.f)),
      k: kill ? 1 : 0, until: now + (kill ? RECEIVED_DEAD_TTL_MS : RECEIVED_HIT_TTL_MS) });
    while (S.received.size > RECEIVED_MAX) S.received.delete(S.received.keys().next().value);
  }
  function applyReceived(scene, now) {
    const ids = new Set();
    for (const [key, h] of S.received) {
      if (now >= h.until || scene.save.caught?.includes(h.eid)) S.received.delete(key);
      else if (h.d === (scene.depth || 0)) ids.add(h.eid);
    }
    if (!ids.size) return;
    const found = findCreatures(ids);
    for (const [key, h] of S.received) {
      if (h.d !== (scene.depth || 0)) continue;
      const c = found.get(h.eid);
      if (!c) continue;
      S.received.delete(key);
      // A cached kill from an expired battle must not kill its next garrison.
      if (c.castle && h.battles.get(c.castle) !== scene.save.citadelBattles?.[c.castle]?.startedAt) continue;
      applyHit(scene, h, c, false);
    }
  }

  // Reconcile repeatedly: a friend can enter relay range after both initial
  // scans, and a tile or hidden garrison can become available mid-fight.
  // Oldest announcements go first so large groups cannot starve their tail.
  function scanSeen(scene, now) {
    if (now - S.seenScanT < SEEN_MS) return;
    S.seenScanT = now;
    applyReceived(scene, now);
    const d = scene.depth || 0;
    if (S.seenDepth !== d) { S.seenDepth = d; S.seenIds.clear(); }
    const pc = scene.playerToWorldCell?.();
    if (!pc) return;
    const caught = setOf(scene.save.caught), live = new Set(), candidates = [];
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, (c) => {
      if (live.has(c.id) || caught.has(c.id) || !sharedEnemy(c, scene.save) || !(Combat.hp(c) > 0)) return;
      live.add(c.id);
      const last = S.seenIds.get(c.id) ?? -Infinity;
      if (now - last >= SEEN_RETRY_MS) candidates.push({ id: c.id, last });
    });
    for (const id of S.seenIds.keys()) if (!live.has(id)) S.seenIds.delete(id);
    const ids = candidates.sort((a, b) => a.last - b.last).slice(0, SEEN_MAX_IDS).map(c => c.id);
    if (!ids.length) return;
    if (sendEnemy({ t: 'seen', ids, d }, now)) for (const id of ids) S.seenIds.set(id, now);
  }
  // DEAD: a peer saw ids this save holds dead (save.caught: a world-shared
  // id is dead for good once there). The defeats that can come back are a
  // citadel guard's: one of this save's battle guards is answered only to an
  // asker fighting the same battle (battleShared), and the asker's end takes
  // a guard's death only from a sender that is (applyHit) — which also covers
  // a castle this save has claimed, whose battle and guard list are gone.
  // The answer goes to every nearby peer, after a small jitter, and is
  // dropped for any id another peer answered meanwhile (DEAD_HEARD_MS).
  function onSeen(scene, msg, now) {
    if (!scene || !scene.save || !Array.isArray(msg.ids) || !Number.isInteger(msg.d)) return;
    const caught = setOf(scene.save.caught);
    let any = false;
    for (const id of msg.ids) {
      const key = `${msg.d}:${id}`;
      if (!validId(id) || !caught.has(id) || S.deadPending.has(key)) continue;
      const castle = guardBattleKey(scene.save, id);
      if (castle && !battleShared(scene.save, msg.id, castle)) continue;
      if (now - (S.deadHeard.get(key) ?? -Infinity) < DEAD_HEARD_MS) continue;
      S.deadPending.set(key, { id, d: msg.d });
      any = true;
    }
    if (any && !(S.deadReplyAt > now)) {
      S.deadReplyAt = now + DEAD_JITTER_MIN_MS + Math.random() * (DEAD_JITTER_MAX_MS - DEAD_JITTER_MIN_MS);
    }
  }
  function flushDead(now) {
    if (!S.deadPending.size || now < S.deadReplyAt) return;
    for (const [id] of S.deadPending) {
      if (now - (S.deadHeard.get(id) ?? -Infinity) < DEAD_HEARD_MS) S.deadPending.delete(id);
    }
    if (!S.deadPending.size) return;
    // One depth per frame (the asker's); others wait for the next reply slot.
    const d = S.deadPending.values().next().value.d;
    const ids = [];
    for (const { id, d: dd } of S.deadPending.values()) {
      if (dd !== d) continue;
      ids.push(id);
      if (ids.length >= SEEN_MAX_IDS) break;
    }
    if (!sendEnemy({ t: 'dead', ids, d }, now)) return;
    for (const id of ids) { const key = `${d}:${id}`; S.deadPending.delete(key); S.deadHeard.set(key, now); }
    S.deadReplyAt = now + DEAD_JITTER_MAX_MS;
  }
  // A peer says these are dead: each loaded shared copy dies as a peer's
  // kill (pays nothing, announces nothing), and our own pending answer for
  // them stands down.
  function onDead(scene, msg, now) {
    if (!scene || !scene.save || !Array.isArray(msg.ids) || !Number.isInteger(msg.d) || msg.d < 0) return;
    const ids = new Set(msg.ids.filter(validId));
    const found = msg.d === (scene.depth || 0) ? findCreatures(ids) : new Map();
    for (const id of ids) {
      const key = `${msg.d}:${id}`;
      S.deadHeard.set(key, now); S.deadPending.delete(key);
      const hit = { id: msg.id, eid: id, f: 0, d: msg.d, k: 1 };
      if (found.has(id)) applyHit(scene, hit, found.get(id));
      else if (!scene.save.caught?.includes(id)) rememberHit(hit, now);
    }
    if (S.deadHeard.size > 512) {
      for (const [id, t] of S.deadHeard) if (now - t >= DEAD_HEARD_MS) S.deadHeard.delete(id);
    }
  }

  // ── shared castle battles ────────────────────────────────────────────────
  // Is peer `pid` fighting THIS save's live battle at `key` — its last battle
  // frame named the same start? Both ends of a hit, kill or death on a
  // citadel guard ask it, so a guard's defeat only ever moves between saves
  // whose battles expire (and undo it) at the same instant.
  function battleShared(save, pid, key) {
    const b = save?.citadelBattles?.[key];
    if (!b || !Houses.citadelBattleActive(save, key)) return false;
    return S.peerBattles.get(pid)?.get(key) === b.startedAt;
  }
  // The castle whose live battle lists `id` among its guards (or as the root
  // of a split or a summon — `${guard}_…`), else null.
  function guardBattleKey(save, id) {
    for (const [key, b] of Object.entries(save?.citadelBattles || {})) {
      if ((b.guardIds || []).some(g => id === g || id.startsWith(g + '_'))) return key;
    }
    return null;
  }
  // A peer's battle: remember its start for battleShared, then adopt or
  // merge it into this save (Houses.adoptCitadelBattle — the earlier start
  // wins). Adopting wakes the garrison now and tells everyone near which
  // start this save holds; hearing a LATER start than ours answers it with
  // ours, so the late starter merges back.
  function onBattle(scene, msg) {
    if (!scene || !scene.save || msg.d !== 0 || !Houses.isCitadelKey(msg.key)) return false;
    if (!Number.isSafeInteger(msg.startedAt) || !Number.isInteger(msg.id)) return false;
    let theirs = S.peerBattles.get(msg.id);
    if (!theirs) S.peerBattles.set(msg.id, theirs = new Map());
    theirs.set(msg.key, msg.startedAt);
    scene._expireCitadelBattles?.();
    const result = Houses.adoptCitadelBattle(scene.save, msg.key, msg.startedAt);
    if (result) {
      persistSave(scene.save);
      scene._lastLairT = -Infinity;
      S.battleDue.add(msg.key);
      if (result === 'adopted') {
        const who = S.peers.get(msg.id)?.name || 'Another player';
        scene._toast?.(`⚔️ ${who} is storming the ${CastleStyles.get(msg.key).name} — join the fight`, { tier: 'sub' });
      }
    } else {
      const ours = scene.save.citadelBattles?.[msg.key];
      if (ours && ours.startedAt < msg.startedAt && Houses.citadelBattleActive(scene.save, msg.key)) S.battleDue.add(msg.key);
    }
    return result;
  }
  // Announce every live, unclaimed battle on this save: a new start at once,
  // a held one every BATTLE_MS, a due answer at most every BATTLE_REPLY_MS.
  // Citadels stand on the surface, so only from depth 0.
  function flushBattles(scene, now) {
    if ((scene.depth || 0) !== 0) return;
    for (const [key, b] of Object.entries(scene.save.citadelBattles || {})) {
      if (!Houses.isCitadelKey(key) || !Houses.citadelBattleActive(scene.save, key)
          || Houses.isCastleClaimed(scene.save, { castle: key })) continue;
      const last = S.battleSent.get(key);
      const fresh = !last || last.startedAt !== b.startedAt;
      const due = !fresh && S.battleDue.has(key) && now - last.at >= BATTLE_REPLY_MS;
      if (!fresh && !due && now - last.at < BATTLE_MS) continue;
      if (!sendEnemy({ t: 'battle', key, startedAt: b.startedAt, d: 0 }, now)) break;
      S.battleSent.set(key, { startedAt: b.startedAt, at: now });
      S.battleDue.delete(key);
    }
  }

  // ── shared targeting ─────────────────────────────────────────────────────
  // THE TARGET RULE, pure: `cands` are the eligible players in range, each
  // { id, d } (d = metres from the foe's copy); `cur` the id it holds. The
  // nearest wins, every candidate within TARGET_TIE_CELLS of the nearest ties
  // and the LOWEST id among them takes it; a held target stays unless the
  // winner is nearer than it by more than TARGET_STICKY_CELLS. Order of
  // `cands` never matters, so every device with the same inputs agrees.
  function pickTarget(cands, cur, cellM) {
    let near = null;
    for (const k of cands) if (!near || k.d < near.d) near = k;
    if (!near) return null;
    const band = near.d + TARGET_TIE_CELLS * cellM;
    let win = null;
    for (const k of cands) if (k.d <= band && (!win || k.id < win.id)) win = k;
    const held = cur != null ? cands.find(k => k.id === cur) : null;
    if (held && !(win.d < held.d - TARGET_STICKY_CELLS * cellM)) return held.id;
    return win.id;
  }
  // How far a shared foe looks for a player, in cells: its row's sight, or
  // the sim bubble for a kind that has none (and never past it — nothing
  // beyond CREATURE_SIM_CELLS thinks at all).
  function targetSightCells(kind) {
    const raw = Combat.monster(kind)?.visionCells;
    const bubble = typeof CREATURE_SIM_CELLS !== 'undefined' ? CREATURE_SIM_CELLS : 12;
    return typeof raw === 'number' && raw > 0 ? Math.min(raw, bubble) : bubble;
  }
  // WHO A SHARED FOE IS AFTER. Null — "the local player, exactly as today" —
  // offline, with no peer near on this depth, for a foe that isn't shared,
  // or when the rule picks the local player or nobody. Otherwise the peer's
  // body for the npcTarget lane (scene_creatures.js): { peer: true, pid, x, y }
  // in this save's world metres, at the peer's last fix. An adopted
  // announcement (onAggro) is held until that player is no longer a
  // candidate; a pick of our own is announced (queueAggro).
  function enemyTarget(scene, c, px, py) {
    if (S.status !== 'online' || S.id == null || !S.peers.size || !scene?.save) return null;
    if (!shareable(c, scene.save)) return null;
    const now = performance.now(), d = scene.depth || 0, cellM = scene.cellM;
    const sight = targetSightCells(c.kind);
    const cur = c._mpTgt ?? null;
    const cands = [];
    const consider = (id, x, y, g, v) => {
      if (g) return;
      const dist = Math.hypot(x - c.x, y - c.y);
      const r = Math.max(0, sight - v) * cellM;
      if (dist <= r || (id === cur && dist <= r + TARGET_KEEP_CELLS * cellM)) cands.push({ id, d: dist, x, y });
    };
    let peers = 0;
    for (const p of S.peers.values()) {
      if ((p.d || 0) !== d || !isNear(p, now)) continue;
      peers++;
      const wm = fromWorldPx(scene, p.x, p.y);
      consider(p.id, wm.x, wm.y, p.g | 0, p.v | 0);
    }
    if (!peers) { c._mpTgt = null; c._mpAdopted = false; return null; }
    const me = S.local || localTargetState(scene);
    consider(S.id, px, py, me.g, me.v);
    const has = (id) => cands.some(k => k.id === id);
    let choice = cur, adopted = !!c._mpAdopted;
    const ann = S.aggro.get(c.id);
    if (ann && ann.d === d && ann.seq !== c._mpAnn) {
      c._mpAnn = ann.seq;
      if (!ann.own && has(ann.pid)) { choice = ann.pid; adopted = true; }
    }
    if (choice != null && !has(choice)) { choice = null; adopted = false; }
    if (choice == null || !adopted) {
      const next = pickTarget(cands, choice, cellM);
      if (next !== choice) adopted = false;
      choice = next;
    }
    const changed = choice !== cur;
    c._mpTgt = choice; c._mpAdopted = adopted && choice != null;
    if (changed && choice != null && !adopted) queueAggro(c.id, choice, d, now);
    if (choice == null || choice === S.id) return null;
    const k = cands.find(q => q.id === choice);
    const body = c._mpBody ||= { peer: true, kind: 'peer' };
    body.pid = choice; body.id = `peer:${choice}`; body.x = k.x; body.y = k.y;
    return body;
  }
  // Our pick for enemy `eid`: recorded as the newest announcement (so a
  // conflicting one heard inside AGGRO_TIE_MS is judged against it) and
  // queued for the next send slot, the newest pick per enemy.
  function queueAggro(eid, pid, d, now) {
    S.aggro.set(eid, { pid, at: now, seq: ++S.aggroSeq, own: true, d });
    S.aggroQueue.set(eid, { pid, d });
  }
  function flushAggro(now) {
    if (!S.aggroQueue.size) return;
    if (now - S.aggroWindowT >= 1000) { S.aggroWindowT = now; S.aggroSent = 0; }
    for (const [eid, a] of S.aggroQueue) {
      if (S.aggroSent >= AGGRO_MAX_PER_S) break;
      if (!sendEnemy({ t: 'aggro', eid, pid: a.pid, d: a.d }, now)) break;
      S.aggroQueue.delete(eid);
      S.aggroSent++;
    }
  }
  // A peer's copy of `eid` picked player `pid`. THE CONFLICT RULE: against
  // an announcement for the same enemy inside AGGRO_TIE_MS (ours or anyone's)
  // the lower pid wins; otherwise the newer announcement stands. Accepted, it
  // is adopted by enemyTarget on the foe's next tick if `pid` is a candidate
  // there (an eligible player this device knows, or this player); a pick of
  // ours it overrules is not sent.
  function onAggro(scene, msg, now) {
    if (!validId(msg.eid) || !Number.isInteger(msg.pid) || msg.pid <= 0 || !Number.isInteger(msg.d)) return false;
    const prev = S.aggro.get(msg.eid);
    if (prev && prev.pid !== msg.pid && now - prev.at < AGGRO_TIE_MS && prev.pid < msg.pid) return false;
    S.aggro.set(msg.eid, { pid: msg.pid, at: now, seq: ++S.aggroSeq, own: false, d: msg.d });
    if (prev && prev.own && prev.pid !== msg.pid) S.aggroQueue.delete(msg.eid);
    if (S.aggro.size > 512) for (const [id, a] of S.aggro) if (now - a.at >= AGGRO_TTL_MS) S.aggro.delete(id);
    return true;
  }

  // ── a party's encounters ────────────────────────────────────────────────
  // P, the players fighting here: this one plus every NEAR peer (isNear —
  // the HUD chip's own count) on this depth. 1 offline.
  function partyCount(scene, now) {
    if (S.status !== 'online') return 1;
    let n = 1;
    for (const p of S.peers.values()) if ((p.d || 0) === (scene.depth || 0) && isNear(p, now)) n++;
    return n;
  }
  // A max-register per encounter: lower, duplicate and reordered reports
  // cannot shrink a live fight. Keep early reports until its tile has spawned;
  // loaded groups renew and periodically reannounce their high-water mark.
  function rememberGroup(id, p, now) {
    let record = S.groupSizes.get(id);
    if (!record || record.until <= now) record = { p, until: 0 };
    else if (p > record.p) record.p = p;
    record.until = now + GROUP_TTL_MS;
    S.groupSizes.delete(id);
    S.groupSizes.set(id, record);
    while (S.groupSizes.size > GROUP_MAX_RECORDS) S.groupSizes.delete(S.groupSizes.keys().next().value);
    return record;
  }
  function onGroup(msg, now = performance.now()) {
    if (msg.d !== 0 || !Array.isArray(msg.groups) || !msg.groups.length || msg.groups.length > SEEN_MAX_IDS) return false;
    if (msg.groups.some(g => !g || !validId(g.id) || !Number.isInteger(g.p) || g.p < 2 || g.p > GROUP_MAX_PLAYERS)) return false;
    for (const g of msg.groups) rememberGroup(g.id, g.p, now);
    return true;
  }
  // Each device proposes its local party size, then grows each group to the
  // largest proposal it knows. ID-seeded generation supplies the same extras;
  // no member list travels. This is eventual agreement, not a shared AI tick.
  function scaleParty(scene, now) {
    if (S.status !== 'online' || now - S.partyScanT < PARTY_SCAN_MS) return;
    S.partyScanT = now;
    for (const [id, g] of S.groupSizes) if (g.until <= now) S.groupSizes.delete(id);
    if ((scene.depth || 0) !== 0 || typeof EnemyHabitats === 'undefined') return;
    const players = Math.min(GROUP_MAX_PLAYERS, partyCount(scene, now));
    const pc = scene.playerToWorldCell?.();
    if (!pc) return;
    const caught = setOf(scene.save.caught), due = [];
    eachTile3x3(pc.tx, pc.ty, (tx, ty) => {
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      // Group records precede the final base population during sliced spawn.
      if (!entry?._spawned) return;
      const { added } = EnemyHabitats.scaleEncounters(entry, g => {
        const p = Math.max(players, g.players, S.groupSizes.get(g.id)?.p || 1);
        if (p > 1) {
          const sent = S.groupSent.get(g);
          if (!sent || p > sent.p || sent.epoch !== S.groupEpoch || now - sent.at >= GROUP_RETRY_MS) {
            due.push({ id: g.id, p, g, at: sent?.at ?? -Infinity });
          }
        }
        return p;
      }, caught);
      if (!added.length) return;
      const have = new Set((entry.creatures ||= []).map(c => c.id));
      for (const c of added) {
        if (have.has(c.id)) continue;
        EnemySpawns.surfaceActive(scene, c);
        entry.creatures.push(c);
        have.add(c.id);
      }
    });
    // Oldest first: dense tiles finish before already-announced groups retry.
    // A busy combat budget leaves these due for the next scan, never lost.
    due.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const batch = due.slice(0, SEEN_MAX_IDS);
    if (batch.length && sendEnemy({ t: 'group', groups: batch.map(({ id, p }) => ({ id, p })), d: 0 }, now)) {
      for (const row of batch) S.groupSent.set(row.g, { p: row.p, at: now, epoch: S.groupEpoch });
    }
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  // Names, pings and edge dots remain in the masked annotation layer. Peer
  // bodies join the world painter pass; their contact shadows stay on ground.
  function ensureLayer(scene) {
    if (S.container) return;
    S.container = scene.add.container(0, 0).setDepth(9.8);
    const mask = scene.worldContainer?.mask || scene.player?.mask;
    if (mask) S.container.setMask(mask);
    // One shared Graphics for every peer's edge dot, cleared each frame, and
    // one for every peer's health bar.
    S.dotGfx = scene.add.graphics();
    S.barGfx = scene.add.graphics();
    S.container.add(S.dotGfx);
    S.container.add(S.barGfx);
  }
  function makePeerArt(scene, p) {
    p.sh = scene.add.image(0, 0, 'bldg_shadow').setOrigin(0.5, 0.5).setDisplaySize(17, 6).setAlpha(0.34);
    // A peer is always the cyan farmer (callings are not shared), tinted its
    // colour, at the farmer's own scale.
    const art = SpriteLayout.PLAYER_ART.farmer;
    p.spr = scene.add.sprite(0, 0, art.sheet, 0).setScale(art.scale).setTint(p.color);
    playDirected(p.spr, 'idle', 0, 1);
    p.lbl = scene.add.text(0, 0, p.name, {
      font: fontUI('bold 10px'), color: cssOf(p.color),
      stroke: '#000', strokeThickness: 3, padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 1);
    scene.shadowContainer.add(p.sh);
    scene.worldContainer.add(p.spr);
    S.container.add(p.lbl);
  }
  // The farmer's sheet authors all four directions, so nothing is mirrored.
  function playDirected(spr, base, fx, fy) {
    let dir = 'down';
    if (Math.abs(fx) > Math.abs(fy)) dir = fx < 0 ? 'left' : 'right';
    else if (fy < 0) dir = 'up';
    const key = `${SpriteLayout.PLAYER_ART.farmer.sheet}-${base}-${dir}`;
    if (spr.anims.currentAnim?.key !== key) spr.play(key);
  }
  function drawPeers(scene, now, dt) {
    const half = scene.viewSize / 2 + 24;
    S.dotGfx?.clear();
    S.barGfx?.clear();
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
      // Use the eased feet position, not the latest network fix: depth must
      // change when the visible body crosses a trunk, including during peeks.
      const feet = screenToWorldMeters(scene, p.dx, p.dy);
      scene._peerUprightPieces.push({
        sprite: p.spr, groundY: feet.y, rank: 3,
        wallSeat: { x: feet.x, halfW: scene.cellM / 2 },   // judged against angled walls like the player (Render.seatAgainstWalls)
      });
      p.sh.setPosition(p.dx, p.dy - 1).setVisible(true);
      p.lbl.setPosition(p.dx, p.dy + scene.playerFeetNudgeY - 23).setVisible(true);
      drawPeerHealth(scene, p);
    }
  }
  // A HURT PEER'S BAR: the enemy health bar (app.js _drawEnemyHealthBar —
  // the one bar, its size SpriteLayout.HEALTH_BAR_*), centred under the name
  // tag, over the head, only while their energy is below full — the way a
  // foe's bar shows only once it is hurt, so a party at full strength reads
  // as names alone. A downed peer shows the empty track.
  function drawPeerHealth(scene, p) {
    if (!S.barGfx || !scene._drawEnemyHealthBar || !(p.e < 1)) return;
    const top = Math.round(p.dy + scene.playerFeetNudgeY - 23) + 1;
    scene._drawEnemyHealthBar(S.barGfx, Math.round(p.dx), top, p.e, 1);
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
      const wm = fromWorldPx(scene, ping.x, ping.y), me = playerWorldM(scene);
      const dx = wm.x - me.x, dy = wm.y - me.y;
      const dist = Math.round(Math.hypot(dx, dy));
      const arrow = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
      scene._toast?.(`📍 ${ping.name}: ${ping.label || 'here'} · ${dist} m ${arrow}`, { tier: 'sub', color: cssOf(ping.color) });
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
          font: fontUI('bold 10px'), color: cssOf(q.color),
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
      const me = playerWorldM(scene);
      const dxm = wm.x - me.x, dym = wm.y - me.y;
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
      'font:700 12px var(--font-ui);';
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
    scene._peerUprightPieces = [];
    if (S.status === 'noname' && cleanName(scene.save.playerName)) start(scene);
    if (!S.container) return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - (S.lastTick || now)) / 1000);
    S.lastTick = now;
    if (S.status === 'online') {
      const f = posFrame(scene);
      const prev = S.lastSent;
      const changed = !prev || f.x !== prev.x || f.y !== prev.y || f.fx !== prev.fx || f.fy !== prev.fy || f.m !== prev.m || f.d !== prev.d
        || f.e !== prev.e || f.g !== prev.g || f.v !== prev.v;
      if ((changed && now - S.lastSend >= 1000 / SEND_HZ) || now - S.lastSend >= HEARTBEAT_MS) {
        send({ t: 'p', ...f }); S.lastSend = now; S.lastSent = f;
      }
      scaleParty(scene, now);
      flushHits(now);
      scanSeen(scene, now);
      flushDead(now);
      flushBattles(scene, now);
      flushAggro(now);
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

  return { start, stop, tick, assisted, ASSIST_MS, consumeTap, setName, reportHit, reportKill, applyHit,
           enemyTarget, pickTarget, localTargetState, onBattle, onAggro, battleShared, partyCount, scaleParty, onGroup, PARTY_SCAN_MS, GROUP_RETRY_MS, GROUP_MAX_PLAYERS,
           TARGET_FLAGS, TARGET_TIE_CELLS, TARGET_STICKY_CELLS, TARGET_KEEP_CELLS,
           BATTLE_MS, BATTLE_REPLY_MS, AGGRO_MAX_PER_S, AGGRO_TIE_MS,
           HIT_FLUSH_MS, HIT_MAX_PER_S, SEEN_MS, SEEN_RETRY_MS, SEEN_MAX_IDS, DEAD_JITTER_MAX_MS, DEAD_HEARD_MS,
           cleanName, pickColor, toWorldPx, fromWorldPx, describeAt, edgeDot,
           COLORS, NAME_MAX, PEER_NEAR_M, PEER_DOT_INSET };
})();
if (typeof window !== 'undefined') window.Multiplayer = Multiplayer;
