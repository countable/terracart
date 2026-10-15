// Load only in a sandbox tab. Uses the real compass listener and GPS consumer;
// no real sensors, save coordinates or multiplayer traffic are required.
window.installHeadingHarness = function installHeadingHarness() {
  const scene = window.__scene;
  if (!scene?._sandboxMode) throw new Error('Heading harness requires ?sandbox=true');
  if (window.headingHarness) return window.headingHarness;
  scene._attachCompass();
  const origin = { ...scene.playerM };
  let frozen = false;
  let textProbe = null, lootProbe = null, iconProbe = null;
  const redraw = () => {
    scene.drawCells();
    scene.drawRoadGeometry();
    scene.drawBuildingGeometry();
    scene.drawObjects();
    scene._playDirected(scene.player, 'idle');
    scene._drawWorkProgress();
    scene._applyMapZoom();
  };
  function sensor(deg) {
    const e = new Event('deviceorientationabsolute');
    // The listener corrects for display orientation, just as on a real phone.
    const physical = (deg + (screen.orientation?.angle || 0) + 360) % 360;
    Object.defineProperties(e, { alpha: { value: (360 - physical) % 360 }, absolute: { value: true } });
    window.dispatchEvent(e);
  }
  const api = {
    scene,
    freeze(on = true) {
      frozen = on;
      if (on) scene.scene.pause(); else scene.scene.resume();
    },
    // x/y are metre offsets from the sandbox's starting GPS fix; positive y
    // is south. snap is for reproducible fixtures, not the interactive GPS walk.
    gps(x, y, snap = false) {
      scene._gpsSimulated = true;
      scene._gpsManualOverride = false;
      scene._manualOffsetM = { x: 0, y: 0 };
      if (snap) scene.gpsM = null;
      scene._applyGpsFix({ x: origin.x + x, y: origin.y + y });
      if (snap) { scene.peekM = { x: 0, y: 0 }; redraw(); }
      return { gps: { ...scene.gpsM }, target: { ...scene._targetM } };
    },
    async heading(deg, ms = 1000) {
      const start = performance.now();
      let prev = start;
      do {
        const now = performance.now();
        sensor(deg);
        if (frozen) {
          HeadingUp.tick(scene, Math.min(.1, Math.max(.001, (now - prev) / 1000)));
          scene._applyMapZoom();
        }
        prev = now;
        await new Promise(requestAnimationFrame);
      } while (performance.now() - start < ms);
      redraw();
      await new Promise(requestAnimationFrame);
      return { compass: scene.compassDeg, rotation: scene.mapRot };
    },
    zoom(value) { scene.mapZoom = value; redraw(); },
    peek(x, y) { scene.peekM = { x, y }; redraw(); },
    redraw,
    // A long-running static job to check the actual work renderer without
    // completing an interaction or awarding items.
    work(dx = 1, dy = 0) {
      scene._workProgress = { worldX: scene.startWorldM.x + scene.playerM.x + dx * scene.cellM,
        worldY: scene.startWorldM.y + scene.playerM.y + dy * scene.cellM,
        durationMs: 3600000, startT: performance.now(), onComplete() {} };
      redraw();
    },
    clearWork() { scene.cancelWorkProgress(); },
    // Real toast and DOM loot paths, held still so each compass/zoom frame
    // compares the same annotations. No inventory or game progress changes.
    text() {
      textProbe?.destroy(); lootProbe?.destroy(); iconProbe?.remove();
      const wp = scene._workProgress;
      const feet = wp ? scene.worldMetersToScreen(wp.worldX, wp.worldY) : scene.playerScreen();
      textProbe = scene._toast('WORK TARGET', { tier: 'cell', x: feet.x, y: feet.y - 24,
        anchor: feet, stack: false });
      iconProbe = document.createElement('span');
      iconProbe.textContent = '◆';
      iconProbe.style.cssText = 'width:28px;height:28px;font-size:24px;color:#ffd45c;';
      const original = scene._toast;
      scene._toast = function(...args) { lootProbe = original.apply(this, args); return lootProbe; };
      try { scene.flashLoot('LOOT PROBE', undefined, 1000, null, iconProbe); }
      finally { scene._toast = original; }
      for (const t of [textProbe, lootProbe]) {
        scene.tweens.killTweensOf(t);
        t.setAlpha(1).setScale(1);
      }
      scene.events.emit('update');
    },
    clearText() { textProbe?.destroy(); lootProbe?.destroy(); iconProbe?.remove(); textProbe=lootProbe=iconProbe=null; },
    // Test both camera projection and the production inverse tap mapping.
    measure() {
      scene._applyMapZoom();
      const main = scene.cameras.main;
      main.preRender();
      const points = [[0,0], [32,0], [0,32], [-48,-16]];
      let projectionError = 0, tapError = 0;
      for (const [dx,dy] of points) {
        const x = scene.viewCenterX + dx, y = scene.viewCenterY + dy;
        const actual = main.matrix.transformPoint(x - main.scrollX, y - main.scrollY);
        const expected = HeadingUp.toOverlayPt(scene, x, y);
        projectionError = Math.max(projectionError, Math.hypot(actual.x / RENDER_SCALE - expected.x, actual.y / RENDER_SCALE - expected.y));
        const back = scene._unzoomPt(expected);
        tapError = Math.max(tapError, Math.hypot(back.x-x, back.y-y));
      }
      let workError = null;
      if (scene._workProgress) {
        const original = scene._strokeWorkRing;
        let painted;
        scene._strokeWorkRing = function(g,x,y,...rest) { painted={x,y}; return original.call(this,g,x,y,...rest); };
        try { scene._drawWorkProgress(); } finally { scene._strokeWorkRing=original; }
        const wp=scene._workProgress, c=worldMetersToAbsCell(scene,wp.worldX,wp.worldY);
        const cell=absCellCenterMeters(scene,c.cellIX,c.cellIY);
        const p=scene.worldMetersToScreen(cell.x,cell.y);
        // Independent camera-matrix oracle; do not test the helper against itself.
        const actual=main.matrix.transformPoint(p.x-main.scrollX,p.y-main.scrollY);
        if (painted) workError=Math.hypot(painted.x-actual.x/RENDER_SCALE,painted.y-actual.y/RENDER_SCALE);
      }
      const before=scene.playerWorldContainer;
      const stored={x:before.x,y:before.y,rotation:before.rotation};
      const textRest = textProbe && { x:textProbe.x, y:textProbe.y };
      const lootRest = lootProbe && { x:lootProbe.x, y:lootProbe.y };
      scene.events.emit('update'); // refresh actual DOM icon placement while paused
      HeadingUp._preRender(scene);
      scene.uiCam.preRender();
      const uiPoint = (x,y) => {
        const p=scene.uiCam.matrix.transformPoint(x-scene.uiCam.scrollX,y-scene.uiCam.scrollY);
        return { x:p.x/RENDER_SCALE, y:p.y/RENDER_SCALE };
      };
      let textError=null, lootError=null, domError=null;
      if (textProbe) {
        const a=textProbe._huAnchor;
        const p=main.matrix.transformPoint(a.x-main.scrollX,a.y-main.scrollY);
        const actual=uiPoint(textProbe.x,textProbe.y), z=scene.mapZoom||1;
        textError=Math.hypot(actual.x-p.x/RENDER_SCALE-(textRest.x-a.x)*z,
          actual.y-p.y/RENDER_SCALE-(textRest.y-a.y)*z);
      }
      if (lootProbe) {
        const p=uiPoint(lootProbe.x,lootProbe.y);
        lootError=Math.hypot(p.x-lootRest.x,p.y-lootRest.y);
        const b=lootProbe.getBounds(), r=gameScreenRect();
        const actual=iconProbe.getBoundingClientRect();
        const expectedX=r.left+(b.left+(10+36/2)*lootProbe.scaleX)*r.width/W;
        const expectedY=r.top+(b.top+b.bottom)/2*r.height/H;
        domError=Math.hypot(actual.left+actual.width/2-expectedX,actual.top+actual.height/2-expectedY);
      }
      const foot=before._huFoot, expectedFoot=scene.playerScreen();
      const playerFootError=foot ? Math.hypot(foot.x-expectedFoot.x,foot.y-expectedFoot.y) : 0;
      const uprightError=Math.abs(before.rotation + HeadingUp.angle(scene));
      HeadingUp._postRender(scene);
      const restoreError=Math.hypot(before.x-stored.x,before.y-stored.y,before.rotation-stored.rotation);
      return { heading:scene.compassDeg, rotation:scene.mapRot, zoom:scene.mapZoom || 1,
        projectionError,tapError,workError,textError,lootError,domError,playerFootError,uprightError,restoreError,
        disableCull:main.disableCull,visibleWorld:scene.worldContainer.list.filter(o=>o.visible).length,
        fogVisible:scene.fogImage.visible };
    },
  };
  window.headingHarness=api;
  return api;
};
