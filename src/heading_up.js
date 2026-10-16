// Heading-up map (default; `?headingUp=false` keeps north up). The map turns like a car
// GPS so the way the phone faces is always the top of the screen, instead of
// the facing arrow swinging over a north-up map.
//
// Everything stays in the north-up 1× view the rest of the game measures in;
// this file only turns the picture and un-turns the input:
//   · the main camera rotates about the view centre (MapScene._applyMapZoom);
//   · a second, unrotated camera draws UI (depth ≥ UI_DEPTH and the chrome
//     here), so toasts and the work wheel stay readable;
//   · the map is clipped to the circle inscribed in the 11×11 square — the
//     only shape that a turned square always covers;
//   · upright sprites are turned back for the render and re-sorted by their
//     on-screen feet (prerender), then put back exactly (postrender), so no
//     game code ever sees a counter-rotated sprite;
//   · taps (_unzoomPt), the peek drag and the stick / keys go through
//     toWorldVec back into north-up.
// Without a device compass, Q / E turn a fake heading for desktop trials.
//
// Art is authored for a south camera; ground geometry and its lighting turn
// with the world while standing sprites retain their upright silhouettes.

const HeadingUp = {
  UI_DEPTH: 90,
  // Ease toward the compass: time constant, top speed, and a dead zone so a
  // hand's tremor doesn't swim the world.
  TAU_S: 0.15,
  MAX_DEG_S: 240,
  DEAD_DEG: 3,
  KEY_STEP_DEG: 15,

  enabled: (() => {
    try {
      const v = new URLSearchParams(location.search).get('headingUp');
      return !/^(false|0|no)$/i.test(v);
    } catch (_) { return true; }
  })(),

  active(scene) {
    return HeadingUp.enabled && !!scene?._headingUp;
  },

  hasGps(scene) {
    // gpsAvailable means a watch was started, not that a position arrived.
    // The debug GPS stick also supplies real scene fixes through gpsM.
    return !!scene.gpsM || (typeof Geo !== 'undefined' && Geo.hasFix);
  },

  directionLocked(scene) {
    return !HeadingUp.hasGps(scene) || !!scene._compassDirectionLocked;
  },

  toggleLock(scene) {
    if (HeadingUp.hasGps(scene)) {
      scene._compassDirectionLocked = !scene._compassDirectionLocked;
      scene._huTurning = false;
      scene._syncCompassLock?.();
      return;
    }
    if (scene._compassGpsRequest || typeof Geo === 'undefined') return;
    // Subscribe to the page's one watch. This also works in the sandbox,
    // where detecting GPS must not relocate the authored test world.
    const finish = (captured) => {
      HeadingUp.cancelGpsRequest(scene);
      if (captured) scene._compassDirectionLocked = false;
      scene._huTurning = false;
      scene._syncCompassLock?.();
    };
    scene._compassGpsRequest = Geo.subscribe(() => finish(true), () => finish(false));
    scene._syncCompassLock?.();
  },

  cancelGpsRequest(scene) {
    if (scene._compassGpsRequest) Geo.unsubscribe(scene._compassGpsRequest);
    scene._compassGpsRequest = null;
  },

  // Map rotation in radians (the camera's): the world turns by -heading.
  angle(scene) {
    return HeadingUp.active(scene) ? (scene.mapRot || 0) : 0;
  },

  // Screen-space vector → north-up world vector.
  toWorldVec(scene, x, y) {
    const a = HeadingUp.angle(scene);
    if (!a) return { x, y };
    const c = Math.cos(a), s = Math.sin(a);
    return { x: c * x + s * y, y: -s * x + c * y };
  },

  // North-up world vector → the direction it points on the turned screen.
  toScreenVec(scene, x, y) {
    const a = HeadingUp.angle(scene);
    if (!a) return { x, y };
    const c = Math.cos(a), s = Math.sin(a);
    return { x: c * x - s * y, y: s * x + c * y };
  },

  // The heading the map is drawn at, as a north-up world unit vector: what
  // screen-up points at. The facing chevron uses it so it stays exactly up
  // while the map eases after the compass.
  facing(scene) {
    return HeadingUp.toWorldVec(scene, 0, -1);
  },

  // North-up view point → where it is drawn on screen (about the view centre).
  toScreenPt(scene, x, y) {
    const a = HeadingUp.angle(scene);
    if (!a) return { x, y };
    const c = Math.cos(a), s = Math.sin(a);
    const dx = x - scene.viewCenterX, dy = y - scene.viewCenterY;
    return { x: scene.viewCenterX + c * dx - s * dy, y: scene.viewCenterY + s * dx + c * dy };
  },

  // Map anchor to the unrotated UI camera. Lift stays vertically above its
  // anchor instead of orbiting it when the heading changes.
  toOverlayPt(scene, x, y, lift = 0) {
    if (!HeadingUp.active(scene)) return { x, y: y + lift };
    const p = HeadingUp.toScreenPt(scene, x, y), z = scene.mapZoom || 1;
    return { x: scene.viewCenterX + (p.x - scene.viewCenterX) * z,
      y: scene.viewCenterY + (p.y - scene.viewCenterY) * z + lift * z };
  },

  install(scene) {
    if (!HeadingUp.enabled || scene._headingUp) return;
    scene._headingUp = true;
    scene.mapRot = 0;
    scene._compassDirectionLocked = false;
    // Phaser's two-corner camera cull assumes positive axes. At a half turn
    // its bounds invert and visible sprites disappear. World pools already
    // cull by map distance; the viewport/mask remains the final clip.
    const main = scene.cameras.main;
    const previousCull = main.disableCull, previousRoundPixels = main.roundPixels;
    main.disableCull = true;
    // Camera.preRender floors scroll when roundPixels is true, moving the
    // solved rotation centre by up to one world pixel every frame. Preserve
    // fractional scroll so map art, UI projection and inverse taps agree.
    main.roundPixels = false;
    const cx = scene.viewCenterX, cy = scene.viewCenterY, r = scene.viewSize / 2;

    scene.uiCam = scene.cameras.add(0, 0, W * RENDER_SCALE, H * RENDER_SCALE);
    applyRenderScale(scene.uiCam);

    // The square frame and its vignette give way to a round window.
    for (const g of scene._mapChrome || []) g.setVisible(false);
    const cover = scene.add.graphics().setDepth(89);
    cover._huUI = true;
    cover.fillStyle(0x000000, 1);
    const corners = [[-1, -1, Math.PI, 1.5 * Math.PI], [1, -1, 1.5 * Math.PI, 2 * Math.PI],
      [1, 1, 0, 0.5 * Math.PI], [-1, 1, 0.5 * Math.PI, Math.PI]];
    for (const [sx, sy, a0, a1] of corners) {
      const pts = [{ x: cx + sx * (r + 1), y: cy + sy * (r + 1) }];
      for (let i = 0; i <= 24; i++) {
        const a = a0 + (a1 - a0) * i / 24;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      cover.fillPoints(pts, true);
    }
    for (let i = 0; i < 10; i++) {
      cover.lineStyle(1, 0x000000, 0.4 * (1 - i / 10) ** 2);
      cover.strokeCircle(cx, cy, r - i);
    }
    cover.lineStyle(2, 0x000000, 0.6).strokeCircle(cx, cy, r);
    // A north tick on the rim, so you can still tell where north went.
    scene._huNorth = scene.add.graphics().setDepth(91);
    scene._huNorth._huUI = true;
    // Says so when no compass reading has arrived, so a still map reads as a
    // missing sensor rather than a broken turn.
    scene._huNoCompass = scene.add.text(cx, cy + r - 22, 'no compass — tap the map', {
      ...phaserFontUI('11px'), color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(91);
    scene._huNoCompass._huUI = true;

    // Desktop trial: Q / E turn a fake heading when no compass reports.
    scene.input.keyboard?.on('keydown', (e) => {
      if (scene._deviceCompass) return;
      const step = e.key === 'q' || e.key === 'Q' ? -1 : e.key === 'e' || e.key === 'E' ? 1 : 0;
      if (!step) return;
      const deg = (((scene.compassDeg ?? 0) + step * HeadingUp.KEY_STEP_DEG) % 360 + 360) % 360;
      scene.compassDeg = deg;
      const rad = deg * Math.PI / 180;
      scene.facing = { x: Math.sin(rad), y: -Math.cos(rad) };
    });

    const pre = () => HeadingUp._preRender(scene);
    const post = () => HeadingUp._postRender(scene);
    scene.game.events.on('prerender', pre);
    scene.game.events.on('postrender', post);
    scene.events.once('shutdown', () => {
      scene.game.events.off('prerender', pre);
      scene.game.events.off('postrender', post);
      scene._headingUp = false;
      main.disableCull = previousCull;
      main.roundPixels = previousRoundPixels;
    });
  },

  // Once per frame, before the camera is applied.
  tick(scene, dt) {
    if (!HeadingUp.active(scene)) return;
    const deg = scene.compassDeg;
    scene._syncCompassLock?.();
    if (deg != null && !HeadingUp.directionLocked(scene)) {
      const target = -deg * Math.PI / 180;
      let diff = target - scene.mapRot;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const dead = HeadingUp.DEAD_DEG * Math.PI / 180;
      if (Math.abs(diff) > dead || scene._huTurning) {
        scene._huTurning = Math.abs(diff) > dead / 4;
        let step = diff * (1 - Math.exp(-dt / HeadingUp.TAU_S));
        const max = HeadingUp.MAX_DEG_S * Math.PI / 180 * dt;
        step = Math.max(-max, Math.min(max, step));
        scene.mapRot = Math.atan2(Math.sin(scene.mapRot + step), Math.cos(scene.mapRot + step));
      }
    }
    scene._huNoCompass.setVisible(!scene._deviceCompass && deg == null);
    const g = scene._huNorth;
    g.clear();
    // The silver chassis supplies the same true-north needle above the map.
    if (scene._compassHUD) return;
    const r = scene.viewSize / 2, a = scene.mapRot - Math.PI / 2;
    const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
    const tx = scene.viewCenterX + ux * (r - 2), ty = scene.viewCenterY + uy * (r - 2);
    const bx = scene.viewCenterX + ux * (r - 16), by = scene.viewCenterY + uy * (r - 16);
    g.fillStyle(0xe8453c, 1).lineStyle(1.5, 0x000000, 0.8);
    g.fillTriangle(tx, ty, bx + px * 6, by + py * 6, bx - px * 6, by - py * 6);
    g.strokeTriangle(tx, ty, bx + px * 6, by + py * 6, bx - px * 6, by - py * 6);
  },

  // Appearance inputs are a view of simulation state, never mutations of it.
  appearanceActor(scene, actor) {
    const angle = HeadingUp.angle(scene);
    if (!angle) return actor;
    const view = Object.create(actor);
    const axes = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const axis = axes[actor._facing] || axes.down;
    const dir = HeadingUp.toScreenVec(scene, ...axis);
    view._facing = Math.abs(dir.x) > Math.abs(dir.y)
      ? (dir.x < 0 ? 'left' : 'right') : (dir.y < 0 ? 'up' : 'down');
    const mirror = HeadingUp.toScreenVec(scene, actor._faceFlip ? -1 : 1, 0);
    view._faceFlip = Math.abs(dir.x) > 1e-6 ? dir.x < 0 : mirror.x < 0;
    view._heading = (Number.isFinite(actor._heading) ? actor._heading : 0) + angle;
    if (actor.kind === 'npc') {
      const delta = HeadingUp.toScreenVec(scene,
        (actor._targetX ?? actor.x) - (actor._startX ?? actor.x),
        (actor._targetY ?? actor.y) - (actor._startY ?? actor.y));
      view._startX = actor.x; view._startY = actor.y;
      view._targetX = actor.x + delta.x; view._targetY = actor.y + delta.y;
    }
    return view;
  },

  _isUI(o) {
    return o._huUI ?? (o.depth >= HeadingUp.UI_DEPTH);
  },

  _preRender(scene) {
    if (!HeadingUp.active(scene)) return;
    WallPerspective.update(scene);
    const main = scene.cameras.main, ui = scene.uiCam;
    const a = scene.mapRot || 0;
    const saved = scene._huSaved = [];
    for (const o of scene.children.list) {
      const isUI = HeadingUp._isUI(o);
      o.cameraFilter = isUI ? main.id : ui.id;
      // UI pinned to a spot on the map (a tap toast, the work wheel) follows
      // the spot round; the round window's own chrome does not.
      if (isUI && (a || (scene.mapZoom || 1) !== 1) && o._huUI === undefined && o.visible
          && (o._huAnchor || HeadingUp._inMap(scene, o.x, o.y))) {
        saved.push([o, o.x, o.y, o.rotation]);
        const anchor = o._huAnchor || o;
        const p = HeadingUp.toOverlayPt(scene, anchor.x, anchor.y);
        const z = scene.mapZoom || 1;
        o.x = p.x + (o.x - anchor.x) * z;
        o.y = p.y + (o.y - anchor.y) * z;
      }
    }
    if (!a) {
      if (HeadingUp.PROP_DEBUG) HeadingUp._drawPropDebug(scene, a);
      return;
    }
    // All body-attached effects share the actual ground anchor, including
    // transparent frame padding and flight lift.
    if (scene.playerWorldContainer && scene.playerScreen) {
      scene.playerWorldContainer._huAnchor = scene.playerScreen();
    }
    const up = (o) => HeadingUp._upright(o, -a, saved);
    for (const c of [scene.worldContainer, scene.labelContainer, scene.coinContainer, scene._sandboxLabels]) {
      if (c) for (const o of c.list) up(o);
    }
    // Contact shadows remain flat ellipses below upright art. Their centres
    // move with the map, but the ellipse must not turn sideways with it.
    for (const o of scene.shadowContainer?.list || []) {
      if (o.type === 'Image' || o.type === 'Sprite') {
        // Without a renderer-set anchor a shadow turns about where it is this
        // frame. Never keep that point: an unpooled shadow (the player's, a
        // peer's) moves on, and a stale anchor throws it off its owner.
        const own = !o._huAnchor;
        if (own) o._huAnchor = { x: o.x, y: o.y };
        up(o);
        if (own) o._huAnchor = null;
      }
    }
    // Feet lower on the TURNED screen draw in front; ground decals
    // (Render.sortWorldDepth's decal lane, scene._worldDecalCount) stay first.
    const wc = scene.worldContainer;
    if (wc) {
      const g = scene._worldDecalCount || 0;
      scene._huOrder = wc.list.slice();
      const s = Math.sin(a), c = Math.cos(a);
      const key = new Map();
      for (const o of wc.list) {
        const f = o._huFoot || HeadingUp._firstFoot(o);
        key.set(o, f ? s * f.x + c * f.y : 0);
      }
      // A raised player must clear the supporting step-over prop at every
      // compass heading; standing props retain ordinary feet ordering.
      const player = scene.playerWorldContainer;
      if (player && key.has(player)) {
        for (const o of wc.list) {
          if (o.visible && o._stepSupport) key.set(player, Math.max(key.get(player), key.get(o) + 0.001));
        }
      }
      wc.list.sort((p, q) => {
        const pg = p.depth < g, qg = q.depth < g;
        if (pg || qg) return pg && qg ? p.depth - q.depth : pg ? -1 : 1;
        return key.get(p) - key.get(q) || p.depth - q.depth;
      });
    }
    if (HeadingUp.PROP_DEBUG) HeadingUp._drawPropDebug(scene, a);
  },

  // ?propDebug=1: outline every standing prop where this frame turned it, on
  // the unrotated UI camera (cyan solid, yellow faded). An outline with no
  // art inside means the sprite was placed but the device did not draw it.
  PROP_DEBUG: typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('propDebug') === '1',
  _drawPropDebug(scene, a) {
    let g = scene._huPropDebug;
    if (!g) {
      g = scene._huPropDebug = scene.add.graphics().setDepth(92);
      g._huUI = true;
      g.cameraFilter = scene.cameras.main.id;
    }
    g.clear();
    let label = scene._huPropDebugText;
    if (!label) {
      label = scene._huPropDebugText = scene.add.text(scene.viewCenterX, scene.viewTop + 4, '', {
        ...phaserFontUI('10px'), color: '#38e8ff', backgroundColor: 'rgba(0,0,0,0.7)',
        padding: { x: 3, y: 2 },
      }).setOrigin(0.5, 0).setDepth(92);
      label._huUI = true;
      label.cameraFilter = scene.cameras.main.id;
    }
    let props = 0, turned = 0, faded = 0;
    const z = scene.mapZoom || 1;
    const walk = (list) => {
      for (const o of list) {
        if (o.type === 'Container') { walk(o.list); continue; }
        if (!o._staticObject || !o.visible) continue;
        props++;
        if (o.alpha < 1) faded++;
        if (!o._huFoot) continue;
        turned++;
        const f = o._huFoot, p = HeadingUp.toOverlayPt(scene, f.x, f.y);
        // _upright turned the sprite about its foot; its upright box keeps
        // the frame's offsets from that foot.
        const w = o.displayWidth, h = o.displayHeight;
        const ox = o.x - f.x, oy = o.y - f.y;
        const c = Math.cos(a), s = Math.sin(a);
        const rx = c * ox - s * oy, ry = s * ox + c * oy;
        const x0 = p.x + (rx - o.originX * w) * z, y0 = p.y + (ry - o.originY * h) * z;
        g.lineStyle(1, o.alpha < 1 ? 0xffe14a : 0x38e8ff, 0.9).strokeRect(x0, y0, w * z, h * z);
      }
    };
    walk(scene.worldContainer?.list || []);
    const shadows = (scene.shadowPool || []).filter(s => s.visible).length;
    label.setText(`propDebug v2 · ${Math.round(a * 180 / Math.PI)}° · props ${props} turned ${turned} faded ${faded} · shadows ${shadows}`);
  },

  _postRender(scene) {
    const saved = scene._huSaved;
    if (saved) {
      for (let i = saved.length - 1; i >= 0; i--) {
        const [o, x, y, rot] = saved[i];
        o.x = x; o.y = y; o.rotation = rot;
        o._huFoot = null;
      }
      scene._huSaved = null;
    }
    const order = scene._huOrder;
    if (order && scene.worldContainer) {
      const wc = scene.worldContainer;
      // Children added or removed mid-frame keep their own places.
      if (order.length === wc.list.length) wc.list.splice(0, wc.list.length, ...order);
      scene._huOrder = null;
    }
  },

  _inMap(scene, x, y) {
    const h = scene.viewSize / 2;
    return Math.abs(x - scene.viewCenterX) <= h && Math.abs(y - scene.viewCenterY) <= h;
  },

  // Turn standing art back around its explicit ground anchor. Legacy art
  // falls back to frame feet; only identity grouping containers recurse.
  _upright(o, rot, saved) {
    if (!o.visible || o._worldLayer === WorldLayers.GROUND_DECAL || o._worldLayer === WorldLayers.GROUNDCOVER) return;
    if (o.type === 'Container') {
      if (!o._huAnchor && o.x === 0 && o.y === 0 && !o.rotation
          && (o.scaleX ?? 1) === 1 && (o.scaleY ?? 1) === 1) {
        for (const ch of o.list) HeadingUp._upright(ch, rot, saved);
        return;
      }
    } else if (o.type !== 'Sprite' && o.type !== 'Image' && o.type !== 'Text') return;
    saved.push([o, o.x, o.y, o.rotation]);
    let fx = o._huAnchor?.x ?? o.x, fy = o._huAnchor?.y ?? o.y;
    if (!o._huAnchor && o.type !== 'Container' && o.type !== 'Text' && !o.rotation) {
      fx += (0.5 - o.originX) * o.displayWidth * (o.flipX ? -1 : 1);
      fy += (1 - o.originY) * o.displayHeight;
    }
    const c = Math.cos(rot), s = Math.sin(rot);
    const dx = o.x - fx, dy = o.y - fy;
    o.x = fx + c * dx - s * dy;
    o.y = fy + s * dx + c * dy;
    o.rotation += rot;
    // Seated props pivot at their cell centre; their visible foot remains
    // screen-down from it for occlusion, just like the upright artwork.
    const footDy = o._huAnchor?.footDy || 0;
    o._huFoot = { x: fx - s * footDy, y: fy + c * footDy };
  },

  _firstFoot(o) {
    if (o._huFoot) return o._huFoot;
    if (o.type === 'Container') {
      for (const ch of o.list) { const f = HeadingUp._firstFoot(ch); if (f) return f; }
    }
    return null;
  },
};
