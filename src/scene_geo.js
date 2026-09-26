// The scene's GEOGRAPHY — where the player is, and the world loaded around
// them. Two halves that meet at the fix:
//   · the GPS / sensor / lifecycle side: startSensors (the safety-splash
//     entry point), startGps (the fix → playerM target, the home-capture
//     reload and its 2-minute safety net), _retryGps, disableGpsForSession,
//     _warnStrandedOrigin, _attachCompass, and setupLifecycle (wake lock,
//     pause + release the watch on hide, offline rest and re-arm on return);
//   · the tile side: ensureTilesAround / _ensureTilesAroundPass (the 3x3
//     block around playerToWorldCell, the centre first and the neighbour ring
//     on idle), _whenIdle, _tileFailureKind, _scheduleTileRetry (the backoff
//     re-fetch), and the dumpTileDebug readout.
// Plus the constants only they read: ORIGIN_STRANDED_M, RING_IDLE_TIMEOUT_MS,
// TILE_RETRY_BASE_MS, TILE_RETRY_MAX_MS.
//
// Moved verbatim out of app.js. The methods live on `class SceneGeo`, a
// MIXIN: app.js installs them onto MapScene.prototype right after the class
// closes (installSceneMixin, from modal_shell.js), so every caller still says
// `this.startGps()` / `this.ensureTilesAround()` and nothing else changed.
// The consts stay plain top-level lexical globals (never window.X — see
// lexical_globals.test.js). This file loads BEFORE app.js, so an initializer
// here may only read literals or names defined above it; the methods read
// app.js names (_teleportOverride, GPS_SNAP_M, PROVISIONAL_ORIGIN_KEYS,
// START_LAT / START_LON, RENDER_SCALE, DEBUG, persistSave, …) and
// this.spawnInTile / this._applyDugWalls / this._placeStarterTrail / … at
// CALL time only.
//
// What this is NOT: the raw location watcher — src/geo.js owns the one
// watchPosition per page (Geo.subscribe / unsubscribe, the boot-time home
// capture in index.html shares it); this is the scene's CONSUMER of it. Not
// the projection either (coords.js: lonLatToLocalM, playerToWorldCell's
// frame), nor the origin freeze (START_LAT / START_LON / the teleport
// override stay at the top of app.js — the index.html boot gate depends on
// app.js freezing them at parse time). Not tile building: WorldGen.loadTile /
// rasterizeTile / fetchTileResponse make an entry; this only asks for the
// blocks and settles the banner. Not spawning: spawnInTile and the starter
// helpers it calls stay in app.js / starter.js. Not the haptics (the tap
// feedback, app.js) or the coordinate / starter guards (_worldPlaced,
// playerToWorldCell). See CLAUDE.md "The camera is not the player" (tile
// loading reads the PLAYER, never the camera anchor) and "A tile can be
// REBUILT under you" before changing the spawn gate in _ensureTilesAroundPass.

// How far a player can stand from their world's projection origin before that
// origin is definitively WRONG rather than merely far — see _warnStrandedOrigin.
// Only reachable by a save that never captured a home (its first GPS fix was
// too slow, or was denied and later granted): the world, Home and the starter
// trail were all built at the default map while the player is somewhere else
// entirely. 25 km is well past a day's walk and well past any GPS error.
const ORIGIN_STRANDED_M = 25000;
const RING_IDLE_TIMEOUT_MS = 400;
const TILE_RETRY_BASE_MS = 4000;
const TILE_RETRY_MAX_MS = 60000;

class SceneGeo {
  // Called from the safety-splash button click (or from create() if the
  // modal was already dismissed when the scene loaded). Idempotent: safe
  // to call repeatedly. The compass listener attach is gated on
  // window.__compassPerm because iOS gives us nothing without 'granted'.
  startSensors() {
    if (window.__compassPerm === 'granted') this._attachCompass();
    if (this.gpsWatchId == null) this.startGps();
  }

  // Re-arm the GPS watch after a background nap (the watch is released on
  // hide to save battery) — and, when the player denied location and has
  // since changed their mind in the browser's own settings, after that too.
  //
  // The gate is the PERMISSION, never how the watch has been behaving: a
  // transient TIMEOUT or POSITION_UNAVAILABLE used to leave the game refusing
  // to watch again for the rest of the session, which is exactly how a player
  // ends up parked at the default home with location switched on. A denial is
  // re-checked through the Permissions API (no second prompt, and no nagging
  // if the answer is still no) — a browser that lacks it keeps the old
  // behaviour of waiting for a reload.
  _retryGps() {
    if (window.__TEST_MODE || this._sandboxMode || _teleportOverride) return;
    if (this.gpsWatchId != null) return;
    if (!this._gpsDenied) { this.startGps(); return; }
    try {
      navigator.permissions?.query({ name: 'geolocation' }).then((st) => {
        if (!st || st.state === 'denied' || this.gpsWatchId != null) return;
        this._gpsDenied = false;
        this.startGps();
      }).catch(() => {});
    } catch (_) { /* no Permissions API — a reload re-asks */ }
  }

  // A save that never captured a home plays at the DEFAULT origin. Standing a
  // few streets from it is ordinary — that IS the default neighbourhood for
  // the players it was picked for. Standing a province away is not: the map,
  // Home, the starter crates and the objective arrow are all back there while
  // the player is here.
  //
  // It cannot be re-anchored under them: every coordinate this save has
  // written is metres in a frame scaled at the origin's latitude, so moving
  // the origin drifts the lot (which is why the capture window closes as soon
  // as the world places anything — see startGps). So this says it plainly,
  // once a session, and names the one control that rebuilds the farm here.
  _warnStrandedOrigin(fix) {
    if (this._strandedWarned || !fix) return;
    if (this.save.home || _teleportOverride || this._sandboxMode || window.__TEST_MODE) return;
    // Wait for the boot overlay to actually be gone — a dialog stacked under
    // it is a dialog nobody reads. A later fix re-offers it. This is the
    // overlay's OWN dismissal (_bootOverlayGone, set once the initial tile
    // load resolves), not just "a frame has rendered" (_bootStatusDone) — the
    // overlay now outlives the first frame on purpose (see create()).
    if (!this._bootOverlayGone) return;
    const d = Math.hypot(fix.x, fix.y);
    if (!(d >= ORIGIN_STRANDED_M)) return;
    this._strandedWarned = true;
    this.showMessageModal({
      title: 'Your farm is somewhere else',
      body: `This game was built around the default map — ${Math.round(d / 1000)} km from where you are `
          + `standing. Its first GPS fix didn't arrive in time to anchor the world on you.\n\n`
          + `You can walk around here, but Home, your starter crates and the objective arrow all point `
          + `back there.\n\nTo rebuild the farm where you are: ☰ menu › Reset this game.`,
      okLabel: 'Got it',
    });
  }

  // === Power / lifecycle ===
  // Keep the screen awake while the game is foreground, and pause the game +
  // GPS watch whenever the tab is backgrounded. The OS automatically releases
  // the wake lock when the tab loses visibility, so it has to be re-requested
  // on each visibility→visible transition.
  setupLifecycle() {
    // Wake Lock — best-effort; not all browsers support it (e.g. iOS < 16.4).
    this._wakeLock = null;
    const acquireWakeLock = async () => {
      if (!('wakeLock' in navigator)) return;
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
      } catch (e) {
        // User-facing failure modes: page not visible, battery saver, etc.
        // No need to surface — the screen just times out normally.
        this._wakeLock = null;
      }
    };
    acquireWakeLock();

    // Visibility lifecycle: pause game + GPS when hidden, resume on return.
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        // Pause Phaser's render+update loop — saves CPU/battery while backgrounded.
        if (this.game && !this.game.isPaused) this.game.pause();
        // Stop tracking GPS — by far the biggest battery drain — and re-arm
        // on return so a fresh fix is taken. Releasing the subscription
        // doesn't tear the watch down instantly: Geo holds it for a short
        // grace period, so a quick app-switch and back rejoins the SAME watch
        // instead of starting a new one (a new watch means another location
        // prompt on browsers whose grant is per page session).
        if (this.gpsWatchId != null) {
          Geo.unsubscribe(this.gpsWatchId);
          this.gpsWatchId = null;
        }
        // Snapshot the moment we paused. Phaser stops calling update() while
        // hidden, so the per-frame heartbeat freezes — anchor lastSeenAt here
        // so the next visible-transition (or page reload) measures from now.
        // Fog reveals are persisted on a throttle (see _revealFog); this is
        // the trailing flush that catches the tail of the walk before the tab
        // goes away.
        if (typeof Fog !== 'undefined') Fog.flush(this.save);
        this.save.lastSeenAt = Date.now();
        persistSave(this.save);
      } else {
        // Foregrounded after a background nap. Resume the game loop FIRST:
        // everything after this line is nice-to-have, and a throw from any of
        // it (applyOfflineRest builds Phaser text + tweens) used to escape the
        // event handler before resume() ran — leaving the game paused forever,
        // a dead screen that no longer took taps. Guard the rest so one bad
        // step can't skip the others either.
        if (this.game && this.game.isPaused) this.game.resume();
        try {
          // Pro-rate energy restoration by the gap, just like a fresh page
          // load would do in create().
          if (this.save.lastSeenAt && !window.__TEST_MODE) {
            this.applyOfflineRest(Math.max(0, Date.now() - this.save.lastSeenAt));
          }
          this.save.lastSeenAt = Date.now();
          persistSave(this.save);
          this._retryGps();
          // A block that came back short waits out its backoff while hidden
          // (see _scheduleTileRetry). Coming back is the likeliest moment for
          // the network to be good again, so take it from the top rather than
          // sitting on a minute-long delay in front of an empty map.
          if (this._tileRetryMs) {
            this._tileRetryMs = 0;
            if (this._tileRetryTimer) { clearTimeout(this._tileRetryTimer); this._tileRetryTimer = null; }
            this.ensureTilesAround().catch(() => {});
          }
          // Wake lock is auto-released on hide; re-acquire on return.
          if (!this._wakeLock) acquireWakeLock();
        } catch (e) { this._reportLoopError?.(e); }
      }
    };
    document.addEventListener('visibilitychange', onVis);
  }

  // Latch manual control: once the player moves themselves (keyboard, or a
  // SPACE / T teleport) we stop letting GPS yank them back to their physical
  // location for the rest of the session. Idempotent — safe to call every
  // frame from the movement loop. Drops any in-flight GPS ease so the current
  // manual move isn't fought. NOT persisted (session-scoped); a reload resumes
  // live GPS.
  disableGpsForSession() {
    if (this._gpsManualOverride) return;
    this._gpsManualOverride = true;
    this.syncMoveTarget();   // drop the last GPS target so it can't keep pulling
    if (this.gpsAvailable) {
      this.flash('GPS off — manual control', this.viewCenterX, this.viewCenterY - 40);
    }
  }

  // === GPS ===
  startGps() {
    // Sandbox mode parks the player at a synthetic biome-grid plot and uses
    // keyboard / joystick movement only — GPS would snap them away to their
    // real-world coords on first fix.
    if (this._sandboxMode) return;
    // A teleport preset relocates the world origin; live GPS would immediately
    // snap the player back to their real location, so leave it off while an
    // override is active (same rationale as sandbox above).
    if (_teleportOverride) { this.gpsAvailable = false; return; }
    if (!navigator.geolocation) return;
    // Already watching (or the subscription is being re-armed) — never stack a
    // second watch: on browsers that grant location per page session rather
    // than per origin, every extra watchPosition can mean another prompt.
    if (this.gpsWatchId != null) return;
    this.gpsAvailable = true;
    // Safety net: if no fix ever arrives, stop waiting for home capture after
    // 2 min so the start flow falls back to the default origin rather than
    // hang forever. Generous on purpose: a cold GPS start indoors routinely
    // takes 30-60 s, and giving up early permanently anchors the save at the
    // default home — the starter-chest trail then spawns half a world from
    // the player (the post-reset "my loot boxes are missing" bug). While
    // capture is pending nothing is placed or adopted (ensureStarterShopId
    // waits), so the only cost of patience is Home appearing a little later.
    // Armed here — not in create() — so the clock starts when GPS actually
    // starts watching; the opening story + safety splash can hold sensors
    // off far longer than that.
    // The net only lets the WORLD get on with it (_homeCapturePending);
    // _homeCaptureArmed stays set, so a fix that finally lands at 3 minutes
    // still becomes this save's home as long as nothing has been placed yet.
    if (this._homeCapturePending && !this._homeCaptureTimer) {
      this._homeCaptureTimer = setTimeout(() => {
        if (!this._homeCapturePending) return;
        this._homeCapturePending = false;
        // Placement unblocked — this save carries on at the current (default)
        // origin, so freeze the starter crate trail there now. The spawn
        // tile usually rasterized minutes ago, so this retro-places it.
        if (!this.save.home && !this.save.starterShopId) {
          this._setStarterCratesAt(this.startWorldM.x, this.startWorldM.y);
        }
      }, 120000);
    }
    // One watch per page, shared through Geo (src/geo.js) — index.html's
    // boot-time home capture uses the same one, so a fresh start asks the
    // player for their location exactly once.
    try {
      this.gpsWatchId = Geo.subscribe(
        pos => {
          const { latitude, longitude } = pos.coords;
          // First GPS fix on a brand-new save: freeze THIS location as the
          // save's home origin and reload so the whole projection re-anchors
          // here. Only reload after VERIFYING the write landed (read it back) —
          // otherwise a failed localStorage write would loop on every fix.
          // (Fallback path only: index.html normally captures home BEFORE
          // app.js loads, so no reload — and no second location prompt — is
          // needed. This runs when that boot gate gave up waiting and the
          // fix landed afterwards.)
          // The window closes the moment the world puts something down: after
          // that the origin is load bearing (every saved coordinate is metres
          // in a frame scaled at the origin's latitude), so moving it would
          // drift the lot. Until then a late fix is still welcome — that is
          // what stops a slow first fix leaving the save marooned at the
          // default home for good.
          if (this._homeCaptureArmed && this._worldPlaced()) this._homeCaptureArmed = false;
          if (this._homeCaptureArmed) {
            this._homeCapturePending = false;
            this._homeCaptureArmed = false;
            this.save.home = { lat: latitude, lon: longitude };
            // The 2-minute net may already have dropped this save's whole
            // starter kit at the default origin on the way here — the crate
            // anchor, the soil plot, the provisioned trees/rocks/wrecks. All
            // of it is metres in the frame we are about to replace, so drop it
            // and let the reloaded world lay it down again on the player
            // (_starterTrailAnchor / _carveStarterPlot / _provisionStarterHome
            // each re-freeze from scratch when their field is empty).
            for (const k of PROVISIONAL_ORIGIN_KEYS) this.save[k] = null;
            let ok = false;
            try {
              persistSave(this.save);
              if (typeof flushSave === 'function') flushSave();
              const rb = loadSave();
              ok = !!(rb && rb.home && rb.home.lat === latitude && rb.home.lon === longitude);
            } catch (_) { ok = false; }
            if (ok) {
              // One-shot flag for the reload: the player answered the safety
              // splash seconds ago, so the reloaded page skips it and reuses
              // the same compass-permission answer (sessionStorage — gone once
              // the browsing session ends, so a later cold load asks again).
              try { sessionStorage.setItem('terracart.skipSafety', window.__compassPerm || 'granted'); } catch (_) {}
              location.reload(); return;
            }
            // write/readback failed — don't loop; carry on with current origin.
          }
          // Project the fix the way the MAP is projected (coords.js
          // lonLatToLocalM — exact Web-Mercator), not with a flat metres-per-
          // degree approximation: the flat one only agrees with the map at the
          // origin and drifts as you walk away from it, which put a player
          // metres off their own map after a long walk and a province off it on
          // a save that never captured a home.
          const fix = lonLatToLocalM(this, longitude, latitude);
          const prev = this.gpsM;
          this.gpsM = { x: fix.x, y: fix.y };
          // A fix in hand: GPS is live again, whatever transient error the
          // watch reported earlier (see the error handler — a cold start
          // routinely TIMEOUTs once before the first fix lands).
          this.gpsAvailable = true;
          // Nothing left to anchor, and the player is nowhere near the world
          // they were given? Say so — it can't be fixed under them.
          this._warnStrandedOrigin(this.gpsM);
          // A manual-control takeover this session (WASD / arrow keys / SPACE /
          // T teleport) owns movement entirely: skip the GPS-driven target
          // write so the keyboard isn't fighting the watcher. gpsM still tracks
          // so the HUD's gps-live check and the facing fallback below keep
          // working. Debug controls no longer opt out — they only make stick
          // walking free (see _steerManual) — and neither does a dragon, which
          // is now a stat buff rather than a flight mode.
          if (this._gpsManualOverride) {
            // intentionally no target / playerM write
          } else {
            // THE FIX IS THE TARGET — plus whatever the stick has walked you
            // off it (_manualOffsetM). The body walks toward that in
            // _followStep: underground through rock it mines out, on the
            // surface as a plain walk. Adding the offset rather than
            // overwriting the target is what lets stick walking survive the
            // next fix a second later instead of being yanked straight back.
            // A fresh fix counts as a steer, so it also resumes any pursuit
            // paused by a tap-interrupt.
            const off = this._manualOffsetM;
            // Is this fix a jump too big to have been WALKED? Measure in the
            // GPS's own frame — body minus the stick offset — so walking 200 m
            // off the GPS by hand doesn't read as a 200 m GPS jump and snap
            // you home.
            const bodyGpsX = this.playerM.x - off.x;
            const bodyGpsY = this.playerM.y - off.y;
            if (!prev || Math.hypot(this.gpsM.x - bodyGpsX,
                                    this.gpsM.y - bodyGpsY) > GPS_SNAP_M) {
              // First fix of the session, or a real jump (see GPS_SNAP_M) —
              // place the body outright and drop the stick offset: the
              // character is being re-anchored on the true position, and
              // keeping the offset would just walk it back off again. At
              // EVERY depth: underground the placement carves the landing
              // cell out of the rock (_placeBodyOnFix), so a snap never
              // leaves the player standing inside a wall — the same rule
              // the walk home applies past the same gap (_driftHome).
              off.x = 0; off.y = 0;
              // The first fix of the session is the world simply arriving,
              // not a trip the player takes — it gets no cut, only a real
              // jump off an already-placed body does.
              if (prev) this._teleportCut(() => this._placeBodyOnFix());
              else this._placeBodyOnFix();
            }
            this._targetM = { x: this.gpsM.x + off.x, y: this.gpsM.y + off.y };
            this._followPaused = false;
          }
          if (prev) {
            const ddx = this.gpsM.x - prev.x, ddy = this.gpsM.y - prev.y;
            // Only use movement as facing fallback when there's no compass.
            if ((ddx || ddy) && this.compassDeg == null) this.facing = { x: ddx, y: ddy };
          }
        },
        err => {
          console.warn('GPS error', err.message);
          // The HUD's "have we actually got GPS?" line only. NOT a latch: it
          // goes true again on the next fix, and nothing decides whether to
          // keep watching from it. It used to, and that cost a player their
          // GPS for the whole session — a cold start TIMEOUTs once (below)
          // before the first fix, and the visibility handler then refused to
          // re-arm the watch after the first app-switch, freezing the farmer
          // wherever it stood (on a fresh save: the default home, half a
          // country from the player).
          this.gpsAvailable = false;
          // Only a hard permission denial stops the watch. Transient
          // errors — TIMEOUT (err.code 3, guaranteed within 10 s by the
          // watch's `timeout` option on a cold GPS start) and
          // POSITION_UNAVAILABLE (2) — must NOT: cancelling home capture here
          // froze the save's origin at the DEFAULT home, so when the real fix
          // finally arrived the starter-chest trail + cleared tutorial pocket
          // had spawned on the default spawn tile, nowhere near the player
          // (classic symptom right after a save reset).
          if (err && err.code === 1 /* PERMISSION_DENIED */) {
            this._gpsDenied = true;
            // Let the dead subscription go: the watch will never fire again,
            // and holding it stops a later grant (Settings → Location, then
            // back to the tab) from arming a fresh one — see _retryGps.
            if (this.gpsWatchId != null) { Geo.unsubscribe(this.gpsWatchId); this.gpsWatchId = null; }
            this._homeCapturePending = false;
            this._homeCaptureArmed = false;
            // No GPS for this save — it plays out at the current (default)
            // origin, so freeze the starter crate trail there (retro-places
            // onto the already-rasterized spawn tile).
            if (!this.save.home && !this.save.starterShopId) {
              this._setStarterCratesAt(this.startWorldM.x, this.startWorldM.y);
            }
          }
        }
      );
      if (this.gpsWatchId == null) this.gpsAvailable = false;
    } catch { this.gpsAvailable = false; }
  }
  // Device compass: prefer absolute-orientation events (Android), fall back to
  // webkitCompassHeading (iOS), then to non-absolute `deviceorientation` as a
  // last resort. Stores smoothed degrees CW-from-north in this.compassDeg.
  //
  // Three things this handles that the naive version didn't:
  //  1. Once we get a TRUE absolute reading, we lock to it — later non-absolute
  //     events (which are relative to whatever the device booted into) are
  //     ignored. Conversely if we only ever get non-absolute, we KEEP accepting
  //     them (the previous code latched after one reading → compass froze).
  //  2. Screen-orientation correction: alpha is reported relative to the
  //     device's natural orientation. When the player rotates to landscape,
  //     we subtract screen.orientation.angle so north stays north.
  //  3. Exponential-moving-average low-pass — raw readings jitter ±5–10°.
  //     Smooth toward the new reading via the shorter arc on the 360° circle.
  //
  // Permission is requested in index.html on the safety-splash button click
  // (the only iOS-honoured user gesture in our boot flow); this method just
  // attaches listeners. Idempotent — bails out if called twice.
  _attachCompass() {
    if (this._compassAttached) return;
    this._compassAttached = true;
    let sawAbsolute = false;
    const onOrient = (e) => {
      let deg = null;
      let absoluteThisEvent = false;
      if (typeof e.webkitCompassHeading === 'number') {
        // iOS: tilt-compensated and CW from true north. Use directly.
        deg = e.webkitCompassHeading % 360;
        absoluteThisEvent = true;
      } else if (e.absolute && typeof e.alpha === 'number') {
        // alpha is CCW from north; flip to CW.
        deg = (360 - e.alpha) % 360;
        absoluteThisEvent = true;
      } else if (typeof e.alpha === 'number' && !sawAbsolute) {
        // Best-effort non-absolute fallback — keep updating every event until
        // (and unless) a true-absolute source appears.
        deg = (360 - e.alpha) % 360;
      }
      if (deg == null || Number.isNaN(deg)) return;
      if (absoluteThisEvent) sawAbsolute = true;
      // Subtract the screen rotation so a landscape-held phone still points
      // north correctly. screen.orientation.angle ∈ {0,90,180,270}.
      const screenAngle = (window.screen?.orientation?.angle) ?? 0;
      deg = (deg - screenAngle + 360) % 360;
      // Smooth the HEADING UNIT VECTOR, not the degrees — avoids the
      // wraparound special-case entirely and is symmetric in all directions
      // (smoothing degrees subtly biases towards 180° because of how the
      // shortest-arc fold interacts with averaged drift).
      //
      // Time-constant low-pass: alpha = dt / (TAU + dt). Devices fire at very
      // different rates (~60 Hz Android, ~10 Hz iOS), so a fixed per-event
      // alpha gives wildly different convergence speeds. TAU is the response
      // time constant (~63% of the way to a new reading) in milliseconds —
      // small enough to feel realtime while still absorbing per-event jitter.
      const now = performance.now();
      const dt = this._lastOrientT ? (now - this._lastOrientT) : 16;
      this._lastOrientT = now;
      const TAU = 40;
      const alpha = dt / (TAU + dt);
      const rad = deg * Math.PI / 180;
      const fx = Math.sin(rad), fy = -Math.cos(rad);   // unit vector in screen coords
      if (!this._facingSmooth) {
        this._facingSmooth = { x: fx, y: fy };
      } else {
        this._facingSmooth.x += (fx - this._facingSmooth.x) * alpha;
        this._facingSmooth.y += (fy - this._facingSmooth.y) * alpha;
      }
      // Re-normalise so the magnitude stays 1 (EMA of two points on a circle
      // produces a chord; without renormalising the smoothed vector shrinks
      // toward 0 during fast rotation).
      const m = Math.hypot(this._facingSmooth.x, this._facingSmooth.y) || 1;
      this.facing = { x: this._facingSmooth.x / m, y: this._facingSmooth.y / m };
      this.compassDeg = (Math.atan2(this.facing.x, -this.facing.y) * 180 / Math.PI + 360) % 360;
    };
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
  }

  // Debug: dump what worldgen actually produced for the tile under the player,
  // in a copyable form (routed through the #errbar overlay). DevTools isn't
  // reachable on a phone, so this is how we see how a real-world feature (e.g.
  // a rec centre) is tagged in the OpenFreeMap vector data — which layer it
  // lands in, its class/subclass, whether it carries a name, and what terrain
  // the rasteriser painted under the player.
  dumpTileDebug() {
    try {
      // Optional name search: scan EVERY loaded tile for features whose name
      // contains a substring (case-insensitive) and report the exact layer +
      // class/subclass each came in as. This is how we locate a specific
      // real-world place (e.g. a rec centre) and see how the vector data tags
      // it — even when it sits in a neighbouring tile or under a class we'd
      // never guess. Blank input falls through to the current-tile dump.
      let filter = null;
      try { filter = window.prompt('Find feature by name (blank = dump current tile):', ''); } catch (_) {}
      if (filter && filter.trim()) {
        const q = filter.trim().toLowerCase();
        const hits = [];
        const cache = WorldGen.tileCache;
        if (cache) for (const [k, entry] of cache) {
          for (const l of (entry.layers || [])) for (const f of (l.features || [])) {
            const nm = f.tags && f.tags.name;
            if (nm && nm.toLowerCase().includes(q)) {
              hits.push(`${k} [${l.name}] t${f.type} class=${f.tags.class || '-'} sub=${f.tags.subclass || '-'}: ${nm}`);
            }
          }
          for (const o of (entry.objects || [])) {
            if (o.kind === 'chest' && o.name && o.name.toLowerCase().includes(q)) {
              hits.push(`${k} CHEST poiClass=${o.poiClass}: ${o.name}`);
            }
          }
        }
        const text = hits.length ? hits.join('\n') : `no loaded feature name contains "${q}"\n(walk the area first so its tiles load)`;
        try { console.log('[tiledebug search]\n' + text); } catch (_) {}
        if (window.showError) window.showError(`SEARCH "${q}" (${hits.length} hit${hits.length === 1 ? '' : 's'})`, text);
        return;
      }
      const { tx, ty, cx, cy } = this.playerToWorldCell();
      const key = WorldGen.tileKey(tx, ty);
      const entry = WorldGen.tileCache && WorldGen.tileCache.get(key);
      const T = WorldGen.T || {};
      const TNAME = {};
      for (const k in T) TNAME[T[k]] = k;
      const out = [];
      // LAYOUT first. There is no console on a phone, and the whole UI scale is
      // derived from the viewport (index.html fitGame / layOutVertically), so
      // "the UI looks zoomed out" is unanswerable without these numbers — iOS
      // Safari in particular changes innerHeight as its toolbar collapses,
      // which moves the scale with it.
      try {
        const vv = window.visualViewport;
        out.push(`layout: inner=${window.innerWidth}x${window.innerHeight}`
          + (vv ? ` visual=${Math.round(vv.width)}x${Math.round(vv.height)}` : '')
          + ` dpr=${window.devicePixelRatio}`
          + ` scale=${(window.__gameCssScale || 1).toFixed(4)}`
          + ` canvas=${game.canvas.width}x${game.canvas.height}@${RENDER_SCALE.toFixed(2)}`
          + ` standalone=${!!(window.navigator.standalone
              || (window.matchMedia && matchMedia('(display-mode: standalone)').matches))}`);
      } catch (_) {}
      out.push(`tile ${key}  cell(${Math.floor(cx)},${Math.floor(cy)})  depth=${this.depth}`);
      // Location / GPS status — explains why the world might be pinned to the
      // Kelowna home origin instead of following the player's real GPS. Any of
      // these will keep GPS fixes from moving the player:
      //   teleport  — a preset override is active (GPS is force-disabled)
      //   manualOvr — WASD/arrows/teleport were used this session (GPS write skipped)
      //   gpsAvail=false / gpsM=none — no GPS fix has been applied
      let tp = null;
      try { tp = JSON.parse(localStorage.getItem('terracart.teleport') || 'null'); } catch (_) {}
      const gm = this.gpsM ? `(${Math.round(this.gpsM.x)},${Math.round(this.gpsM.y)})m` : 'none';
      const originSrc = _teleportOverride ? ('TELEPORT ' + (tp && tp.name || '?')) : (_saveHome ? 'saved-home' : 'default-home/GPS');
      out.push(`origin: ${START_LAT.toFixed(5)},${START_LON.toFixed(5)} (${originSrc})`);
      out.push(`gpsAvail=${this.gpsAvailable} gpsFix=${gm} manualOvr=${!!this._gpsManualOverride} denied=${!!this._gpsDenied} watching=${this.gpsWatchId != null} sandbox=${!!this._sandboxMode}`);
      out.push(`homePending=${!!this._homeCapturePending} homeArmed=${!!this._homeCaptureArmed} saveHome=${this.save && this.save.home ? this.save.home.lat.toFixed(4) + ',' + this.save.home.lon.toFixed(4) : 'none'}`);
      // Starter-trail forensics — which mode the trail pass took when it last
      // ran this session (recorded in _placeStarterTrail), plus a live census
      // of every starter chest actually in the cache and whether the save has
      // it opened. Together these answer "why are there no crates along my
      // road" from a phone, which nothing else on screen can.
      try {
        const sca = this.save && this.save.starterCratesAt;
        out.push('trail anchor: ' + (sca ? `(${Math.round(sca.x)},${Math.round(sca.y)})m` : 'NOT SET')
          + `  salt=${this.save && this.save.relicSalt != null ? this.save.relicSalt : 'none'}`);
        out.push('trail: ' + (this._trailDebug || '(pass has not run this session)'));
        const spa = this.save && this.save.starterPondAt;
        out.push('pond: ' + (spa ? `(${Math.round(spa.x)},${Math.round(spa.y)})m` : 'NOT SET')
          + '  ' + (this._pondDebug || '(pass has not run this session)'));
        const openedIds = new Set((this.save && this.save.opened) || []);
        const rows2 = [];
        if (WorldGen.tileCache) for (const [, e2] of WorldGen.tileCache) {
          for (const o of ((e2 && e2.objects) || [])) {
            if (o.kind !== 'chest' || !String(o.id).startsWith('chest_start')) continue;
            rows2.push(`${o.id}@(${Math.round(o.x)},${Math.round(o.y)})m`
              + (openedIds.has(o.id) ? ' OPENED' : ''));
          }
        }
        out.push('starter chests: ' + (rows2.join('; ') || 'NONE IN CACHE'));
      } catch (_) {}
      out.push(`playerM=(${Math.round(this.playerM.x)},${Math.round(this.playerM.y)})`);
      const tgt = this._targetM
        ? `(${Math.round(this._targetM.x)},${Math.round(this._targetM.y)}) d=${Math.round(Math.hypot(this._targetM.x - this.playerM.x, this._targetM.y - this.playerM.y))}m`
        : 'none';
      out.push(`walkTarget=${tgt} paused=${!!this._followPaused}`);
      // How far the stick has walked the player off their real (GPS) position.
      const off = this._manualOffsetM || { x: 0, y: 0 };
      out.push(`stickOffset=(${Math.round(off.x)},${Math.round(off.y)}) `
        + `${Math.round(Math.hypot(off.x, off.y))}m  `
        + `speed=${steerSpeedMul(this._walkRelics())}× `
        + `cost=${steerEnergyCost(this._walkRelics())}/cell`);
      if (!entry || !entry.grid) {
        out.push('(tile not loaded — stand on the spot, then dump)');
        if (window.showError) window.showError('TILE DEBUG', out.join('\n'));
        return;
      }
      const cpe = entry.cellsPerEdge;
      const icx = clamp(Math.floor(cx), 0, cpe - 1);
      const icy = clamp(Math.floor(cy), 0, cpe - 1);
      const under = entry.grid[icy * cpe + icx];
      out.push(`under player: ${TNAME[under] ?? '?'} (${under})`);
      // 7×7 terrain-code window centred on the player cell.
      const rows = [];
      for (let dy = -3; dy <= 3; dy++) {
        let r = '';
        for (let dx = -3; dx <= 3; dx++) {
          const xx = icx + dx, yy = icy + dy;
          r += (xx < 0 || yy < 0 || xx >= cpe || yy >= cpe)
            ? '..' : String(entry.grid[yy * cpe + xx]).padStart(2, '0');
          r += ' ';
        }
        rows.push(r.trimEnd());
      }
      out.push('grid 7x7 (codes):\n' + rows.join('\n'));
      if (WorldGen.overpassTileInfo) {
        try { out.push('overpass: ' + WorldGen.overpassTileInfo(tx, ty)); } catch (_) {}
      }
      const layers = entry.layers || [];
      out.push('layers: ' + layers.map(l => l.name).join(', '));
      // Per-layer class/subclass histogram for the polygon-ish + poi layers.
      const interesting = new Set(['landcover', 'landuse', 'park', 'building', 'poi', 'transportation']);
      for (const l of layers) {
        if (!interesting.has(l.name)) continue;
        const classes = new Map();
        for (const f of l.features) {
          const c = (f.tags && (f.tags.class || f.tags.subclass)) || '(none)';
          classes.set(c, (classes.get(c) || 0) + 1);
        }
        out.push(`[${l.name}] ` + [...classes.entries()].map(([c, n]) => `${c}:${n}`).join(' '));
      }
      // Every NAMED feature, minus street names + bus stops (pure noise) — this
      // is where a rec centre / civic building shows, with the layer + class it
      // came in as. No cap, so nothing hides past a truncation.
      const named = [];
      for (const l of layers) {
        if (l.name === 'transportation_name') continue;   // street names — noise
        for (const f of (l.features || [])) {
          const nm = f.tags && f.tags.name;
          if (!nm) continue;
          const cls = f.tags.class || f.tags.subclass || '?';
          if (cls === 'bus') continue;                    // dozens of bus stops — noise
          named.push(`${l.name}/${cls}: ${nm}`);
        }
      }
      if (named.length) out.push(`named (${named.length}, excl. streets/bus):\n` + named.join('\n'));
      const chests = (entry.objects || []).filter(o => o.kind === 'chest');
      if (chests.length) {
        out.push('chests: ' + chests.map(c => `${c.poiClass}${c.name ? ('=' + c.name) : ''}`).slice(0, 40).join(' | '));
      }
      const text = out.join('\n');
      try { console.log('[tiledebug]\n' + text); } catch (_) {}
      if (window.showError) window.showError('TILE DEBUG (copy me)', text);
    } catch (e) {
      if (window.showError) window.showError('tile debug failed', (e && e.stack) || String(e));
    }
  }

  async ensureTilesAround() {
    const cell = this.playerToWorldCell();
    // ONE PASS PER CENTRE AT A TIME. Measured on a real phone: the centre tile
    // was fetched, decoded and rasterized THREE times over — two concurrent
    // passes at boot, then a third when the Overpass bin landed and evicted it
    // — and the duplicates cost ~8 s of the load, most of it while the player
    // was already trying to play. Nothing called ensureTilesAround twice on
    // purpose; create(), the warmOverpass re-entry, the walk check and the
    // tile-failure retry simply all can, and none of them knew about each
    // other. A pass already running for this centre IS the answer to a second
    // ask, so hand it back rather than starting a rival.
    const passKey = `${cell.tx}/${cell.ty}/${this.depth || 0}`;
    if (this._tilePass && this._tilePassKey === passKey) return this._tilePass;
    this._tilePassKey = passKey;
    this._tilePass = this._ensureTilesAroundPass(cell)
      .finally(() => { if (this._tilePassKey === passKey) { this._tilePass = null; } });
    return this._tilePass;
  }

  async _ensureTilesAroundPass(cell) {
    const needed = new Set();
    eachTile3x3(cell.tx, cell.ty, (tx, ty) => needed.add(`${tx}/${ty}`));
    // The tile the player is standing in — the only one they can see or reach
    // right now, and so the only one worth making them wait for.
    const centreKey = `${cell.tx}/${cell.ty}`;
    // Overpass is fired only for the centre tile (the one the player is in).
    // Neighbours get their Overpass fetch when the player walks into them and
    // they become the centre tile on the next ensureTilesAround call.
    // warmOverpass resolves true when the bin landed after the tile had
    // already rasterized without it (cold cache — e.g. right after a save
    // reset) and evicted the stale entry; re-run so the rebuilt tile (now
    // with its real-world trees) loads even if the player is standing still.
    const warmed = WorldGen.warmOverpass(cell.tx, cell.ty, START_LAT);
    if (warmed && typeof warmed.then === 'function') {
      warmed.then((evicted) => { if (evicted) this.ensureTilesAround().catch(() => {}); });
    }
    // THREE outcomes, not two, and only one of them is the player's problem.
    //   centreFailed — the tile the player is STANDING IN could not be built.
    //     That is the only failure they can see: the other eight are ground
    //     they might walk onto in a few minutes. Banner.
    //   anyRetry     — something in the block isn't whole yet: a real failure
    //     anywhere, or a tile held back by WorldGen's own backoff. Retry, but
    //     say nothing.
    //   permanent    — the server ANSWERED, with a 4xx. There is nothing to
    //     retry and nothing was unreachable, so neither of the above.
    let centreFailed = false, centreWhy = "";
    let anyRetry = false;
    // Fetch/decode/rasterize the whole 3×3 block CONCURRENTLY rather than one
    // tile at a time. This used to be a serial `for...of` with an `await`
    // inside — on a cold cache every neighbour is a real network round trip,
    // so 9 tiles paid 9× the latency back to back, which is where the ~5s
    // blank-map stretch after boot came from. Nothing here depends on load
    // order (each tile only reads/writes its own entry; the one cross-tile
    // read, dedup, already tolerates tiles racing each other — see
    // collectDedupIndex), so there's nothing to lose by firing them together.
    let doneCount = 0;
    const total = needed.size;
    const buildOne = async (k) => {
      const [tx, ty] = k.split('/').map(Number);
      let entry = null;
      try {
        entry = await WorldGen.loadTile(tx, ty, START_LAT);
        if (entry.status === 'loading') await entry.promise;
        // Surface fauna on depth 0; hostile wandering monsters underground.
        //
        // GATED ON _spawned, NOT ON entry.creatures. The two look
        // interchangeable — the spawn pass sets creatures, so creatures means
        // it ran — right up until a tile is REBUILT. rebuildTileWithBin
        // (an Overpass bin landing after the tile rasterized without one)
        // constructs a fresh entry and carries the live creatures across,
        // because their positions and tamed state cannot be reconstructed. So
        // the replacement arrived already looking spawned, this call skipped
        // it, and everything ELSE the pass places was silently gone: the
        // starter crates first of all, plus the buried X, the extra treasure
        // scatter and the fruit-tree objects. It read as the crates vanishing
        // a few seconds into the session ("something loaded over them") and
        // coming back on refresh — because on reload the bin is already
        // cached, the tile builds with it first time, and no rebuild happens.
        // A flag the rebuild does not carry says what the carried state
        // cannot: this entry has not been through the spawn pass.
        // The player's own up-staircases (Home's, and the one under the
        // starter ladder) go down BEFORE the cave spawn pass. They are
        // `_synthetic` — not part of the level's generated layer — so the pass
        // neither anchors on them nor lets them refuse a seat (that would
        // reshuffle the cave for everyone else); it CULLS whatever it draws
        // onto one (heldByPlayer). Nothing spawns on a stair cell.
        if (this.depth > 0) {
          this._ensureHomeUpStair(entry, tx, ty);
          this._ensureLadderUpStairs(entry, tx, ty);
        }
        if (this.depth === 0 && !entry._spawned) this.spawnInTile(entry, tx, ty);
        else if (this.depth > 0 && !entry._spawned) this.spawnCaveCreatures(entry, tx, ty, this.depth);
        // Re-open any walls the player has already mined on this level (the
        // home up-staircase is guaranteed above, before the spawn pass).
        if (this.depth > 0) {
          this._applyDugWalls(entry, tx, ty);
          // A body placed on a far fix (_placeBodyOnFix) usually lands on a
          // tile that hasn't loaded yet; open the cell under it now if the
          // grid put rock there.
          this._carveLanding({ tx, ty });
        }
      } catch (e) {
        const kind = this._tileFailureKind(e, entry);
        if (kind !== 'permanent') anyRetry = true;
        if (kind === 'failed' && k === centreKey) { centreFailed = true; centreWhy = e.message; }
        console.warn('tile fetch failed', k, e.message, `(${kind})`);
        window.__boot?.mark(`tile ${k} failed: ${e.message} (${kind})`);
      } finally {
        // Feeds the boot overlay's progress bar for the one stretch it used
        // to have no visibility into (index.html hands off to this call the
        // instant the world is on screen — see the create() call site). A
        // no-op once the overlay has vanished, so this is harmless to call
        // for every later ensureTilesAround too (walking into a new tile,
        // depth changes, …).
        doneCount++;
        window.__bootStatus?.(0.9 + 0.1 * (doneCount / total), 'Loading the map…');
      }
    };
    // Show the banner when THE GROUND UNDER THE PLAYER failed, not merely when
    // some tile in the block did. It is raised on a failure rather than on
    // navigator.onLine because a captive portal, a blocked or DNS-failed tile
    // host, a 5xx, a corporate proxy or a VPN all keep onLine true, and the
    // player was left with a featureless green field, no message and no retry.
    //
    // But eight of the nine tiles in a block are ground the player cannot see
    // and will not reach for minutes — a tile is 222 cells across and the
    // viewport is 11 — so a flaky ring tile told a player standing on
    // perfectly good terrain that the map was unreachable. That is the "we
    // keep hitting it" case. The ring still retries; it just does it quietly,
    // and if the player does walk that way the tile becomes the centre and
    // earns the banner then.
    const settle = () => {
      this.showBanner(centreFailed, centreWhy);
      this._tilesReady = [...WorldGen.tileCache.values()].filter(t => t.status === 'ready').length;
      this._scheduleTileRetry(anyRetry);
    };

    // THE CENTRE TILE FIRST, and hand control back the moment it is done.
    //
    // A tile build is one uninterruptible 300-800 ms chunk of rasterize on the
    // main thread. Awaiting all nine before returning meant the player waited
    // through nine of them — measured at ~5 s of frozen UI on the boot path,
    // with the overlay up and nothing responding — for eight tiles of ground
    // they cannot see. The viewport is 11 cells across and a tile is 222, so
    // the centre tile alone is already ~400× what is on screen; the ring is
    // walking headroom, minutes away at 1.4 m/s.
    //
    // So: await the centre, settle, return. The ring streams in behind, one
    // chunk per painted frame (worldgen's heavy-phase chain), and settles
    // again when it lands. One ring pass at a time — walking into a new tile
    // re-enters here, and stacking ring passes would put the pile-up back.
    const _endCentre = window.__boot?.begin('centre tile (blocks the boot)');
    await buildOne(centreKey);
    _endCentre?.(centreKey);
    settle();
    const ring = [...needed].filter(k => k !== centreKey);
    if (!ring.length || this._ringBuild) return;
    this._ringBuild = (async () => {
      // One at a time, each waiting for an IDLE moment first. Fired together
      // they queue straight onto the heavy chain and spend the player's first
      // seconds of play the same way the boot did — a 300-800 ms stall, eight
      // times, while they are trying to walk. The ring is walking headroom a
      // tile wide (~1.5 km, minutes away at 1.4 m/s), so it can afford to wait
      // for gaps. requestIdleCallback picks the gaps; the timeout is the floor
      // that keeps it moving on a busy thread, and the rAF fallback covers
      // browsers without it.
      const endRing = window.__boot?.begin('neighbour ring (in the background)');
      for (const k of ring) {
        await this._whenIdle();
        await buildOne(k);
      }
      endRing?.(`${ring.length} tiles`);
    })().catch(() => {}).then(() => { this._ringBuild = null; settle(); });
  }

  // Resolve on the next idle slice, or after RING_IDLE_TIMEOUT_MS at the
  // latest. A tile build overruns any idle deadline on its own (it is one
  // uninterruptible chunk), so this is about picking a better MOMENT, not
  // about fitting inside the budget.
  _whenIdle() {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(), { timeout: RING_IDLE_TIMEOUT_MS });
      } else if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(resolve, RING_IDLE_TIMEOUT_MS));
      } else {
        setTimeout(resolve, RING_IDLE_TIMEOUT_MS);
      }
    });
  }

  // Re-fetch a block that came back short, on a backoff, until it is whole.
  //
  // Nothing used to. The only automatic re-fetch in the game is the 20 m walk
  // check in update(), so a player standing still kept whatever the boot load
  // managed — and the boot load is the one that fires all nine tiles at once
  // into a cold cache. One bad moment there (a captive portal, a phone still
  // handing off from cell to wifi, the tile host shedding a burst) left a
  // brand-new player on a featureless green field: no houses, no POIs and —
  // because the trail is laid when the anchor tile rasterizes — no starter
  // crates either. Measured: the host recovered 25 s in and the game had still
  // fetched nothing two minutes later. A veteran never sees it; their tiles
  // are already in IndexedDB.
  //
  // Failures evict themselves in WorldGen, so a retry is a genuine re-fetch.
  // One timer at a time, reset the moment a pass comes back whole.
  // What KIND of tile failure this was — the one place the three are told
  // apart, so the banner and the retry can't come to different conclusions.
  //
  //   'held'      WorldGen's own per-tile backoff handed back a _transient
  //               entry whose promise is already rejected. A deliberate hold,
  //               not a new failure. Retry, say nothing. Counting it as a
  //               failure is why the banner flapped up during a perfectly
  //               healthy load: one flaky tile poisons every pass that touches
  //               it for TILE_RETRY_MS, and the ring makes several.
  //   'permanent' The host ANSWERED, with a 4xx. Retrying asks the same
  //               question every 60 s forever, and "can't reach the map" is a
  //               lie about a server that replied — this is how one dud tile
  //               kept the banner up for a whole session.
  //   'failed'    Everything else: offline, DNS, a 5xx, a captive portal, a
  //               timeout. Retry, and if it was the tile the player is
  //               standing in, tell them.
  //
  // The _transient flag is read off the ENTRY because that is the object
  // carrying it: it is deliberately never put in tileCache, so looking it up
  // there could not work (and the key it was looked up by was the wrong shape
  // besides — "tx/ty" against cache keys of "z/tx/ty").
  _tileFailureKind(err, entry) {
    const msg = (err && err.message) || '';
    if ((entry && entry._transient) || /backoff/.test(msg)) return 'held';
    if (/HTTP 4\d\d/.test(msg)) return 'permanent';
    return 'failed';
  }

  _scheduleTileRetry(anyFailed) {
    if (window.__TEST_MODE) return;
    if (!anyFailed) {
      this._tileRetryMs = 0;
      if (this._tileRetryTimer) { clearTimeout(this._tileRetryTimer); this._tileRetryTimer = null; }
      return;
    }
    if (this._tileRetryTimer) return;
    this._tileRetryMs = this._tileRetryMs
      ? Math.min(TILE_RETRY_MAX_MS, this._tileRetryMs * 2)
      : TILE_RETRY_BASE_MS;
    this._tileRetryTimer = setTimeout(() => {
      this._tileRetryTimer = null;
      // Backgrounded: the game loop is paused and the radio is the player's to
      // spend, so wait rather than fetch. Coming back re-arms immediately
      // (see the visibilitychange handler), which is when it matters anyway.
      if (typeof document !== 'undefined' && document.hidden) {
        this._scheduleTileRetry(true);
        return;
      }
      this.ensureTilesAround().catch(() => {});
    }, this._tileRetryMs);
  }
}
