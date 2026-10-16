// Baked-bloom metal reflection. Source-aligned layers work at arbitrary phone
// dimensions; no screenshot atlas, runtime blur, canvas, or pixel readback.
const CompassShine = {
  install(scene, body) {
    if (scene._compassShine) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const layers = [], sources = [
      [body, '::before', 'reference-carving-tile'],
      [body.querySelector('.compass-header'), null, 'reference-header'],
      [body.querySelector('.compass-footer'), null, 'reference-footer'],
      [body.querySelector('.compass-upper-join'), '::before', 'reference-shoulders'],
      [body.querySelector('.compass-lower-join'), '::before', 'reference-join'],
    ];
    for (const [source, pseudo, name] of sources) {
      if (!source) continue;
      const surface = document.createElement('div');
      surface.className = 'compass-shine-surface';
      surface.setAttribute('aria-hidden', 'true');
      const emission = document.createElement('div');
      emission.className = 'compass-shine-emission';
      emission.style.backgroundImage = `url("assets/ui/compass/shine/${name}.webp")`;
      surface.append(emission);
      // The base stays behind all endcaps. Each other emission is a child of
      // its own art surface, inheriting that surface's mask and occlusion.
      source.prepend(surface);
      layers.push({ source, pseudo, surface, emission });
    }
    let raf = 0, layoutRaf = 0, lastTime = 0, destroyed = false;
    let width = 0, height = 0, visible = false, pitch = .5, roll = 0;
    let targetPitch = .5, targetRoll = 0, baseBeta = null, baseGamma = null;
    let hasSensor = false, bodyClass = document.body.className;
    function paint() {
      const beamWidth = width * (.75 + pitch * .8);
      body.style.setProperty('--compass-shine-width', `${beamWidth.toFixed(2)}px`);
      body.style.setProperty('--compass-shine-height', `${(height * (.7 + pitch * .9)).toFixed(2)}px`);
      body.style.setProperty('--compass-shine-x', `${((width - beamWidth) / 2 + roll * width / 217).toFixed(2)}px`);
    }
    function canMove() { return !destroyed && visible && !document.hidden && !reduced.matches; }
    function wake() { if (canMove() && !raf) { lastTime = 0; raf = requestAnimationFrame(tick); } }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; lastTime = 0; }
    function tick(time) {
      raf = 0;
      if (!canMove()) return;
      if (lastTime && time - lastTime < 32) { raf = requestAnimationFrame(tick); return; }
      const dt = lastTime ? Math.min(80, time - lastTime) : 33.3;
      lastTime = time;
      if (!hasSensor) {
        targetPitch = .5 + .25 * Math.sin(time / 18000);
        targetRoll = 22 * Math.sin(time / 23000);
      }
      const easing = 1 - Math.exp(-dt / 160);
      pitch += (targetPitch - pitch) * easing;
      roll += (targetRoll - roll) * easing;
      paint();
      if (!hasSensor || Math.abs(targetPitch - pitch) > .0005 || Math.abs(targetRoll - roll) > .02) raf = requestAnimationFrame(tick);
    }
    function layout() {
      layoutRaf = 0;
      if (destroyed) return;
      const rect = body.getBoundingClientRect();
      width = rect.width; height = rect.height;
      visible = width > 0 && height > 0 && document.body.classList.contains('compass-hud');
      for (const { source, pseudo, surface, emission } of layers) {
        const style = getComputedStyle(source, pseudo);
        surface.hidden = Boolean(pseudo && (style.content === 'none' || style.content === 'normal' || style.display === 'none')); 
        // Copy the same resolved CSS geometry rather than duplicate the layout
        // formulas. Parent masks already wrap non-pseudo source surfaces.
        if (pseudo) {
          for (const key of ['top', 'right', 'bottom', 'left', 'width', 'height', 'maskImage', 'maskPosition', 'maskSize', 'maskRepeat']) surface.style[key] = style[key];
        } else surface.style.inset = '0';
        for (const key of ['backgroundSize', 'backgroundPosition', 'backgroundRepeat']) emission.style[key] = style[key];
      }
      // Geometry is read only on install/resize, never in the animation loop.
      for (const { surface, emission } of layers) {
        const box = surface.getBoundingClientRect();
        emission.style.setProperty('--compass-shine-local-x', `${box.left - rect.left}px`);
        emission.style.setProperty('--compass-shine-local-y', `${box.top - rect.top}px`);
      }
      paint(); stop(); wake();
    }
    function queueLayout() { if (!destroyed && !layoutRaf) layoutRaf = requestAnimationFrame(layout); }
    function orientation(event) {
      // The existing safety gesture owns sensor permission. This listener only
      // consumes events already granted to the game; it never prompts the user.
      if (destroyed || document.hidden || reduced.matches || !Number.isFinite(event.beta)) return;
      const gamma = Number.isFinite(event.gamma) ? event.gamma : 0;
      if (baseBeta === null) { baseBeta = event.beta; baseGamma = gamma; }
      const betaDelta = ((event.beta - baseBeta + 540) % 360) - 180;
      const gammaDelta = gamma - baseGamma;
      const angle = (window.screen?.orientation?.angle || 0) * Math.PI / 180;
      const forward = betaDelta * Math.cos(angle) + gammaDelta * Math.sin(angle);
      const sideways = gammaDelta * Math.cos(angle) - betaDelta * Math.sin(angle);
      targetPitch = Math.max(0, Math.min(1, .5 + forward / 90));
      targetRoll = Math.max(-45, Math.min(45, sideways));
      hasSensor = true; wake();
    }
    function visibility() { stop(); if (!document.hidden) wake(); }
    function motionPreference() { stop(); if (reduced.matches) { pitch = .5; roll = 0; paint(); } else wake(); }
    const resize = new ResizeObserver(queueLayout);
    resize.observe(body);
    for (const { source } of layers) if (source !== body) resize.observe(source);
    const classes = new MutationObserver(() => {
      if (document.body.className !== bodyClass) { bodyClass = document.body.className; queueLayout(); }
    });
    classes.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', queueLayout);
    window.addEventListener('deviceorientation', orientation, { passive: true });
    window.addEventListener('deviceorientationabsolute', orientation, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    reduced.addEventListener('change', motionPreference);
    function destroy() {
      destroyed = true; stop(); cancelAnimationFrame(layoutRaf);
      resize.disconnect(); classes.disconnect();
      window.removeEventListener('resize', queueLayout);
      window.removeEventListener('deviceorientation', orientation);
      window.removeEventListener('deviceorientationabsolute', orientation);
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', motionPreference);
      for (const { surface } of layers) surface.remove();
      delete scene._compassShine;
    }
    scene._compassShine = { destroy };
    scene.events?.once('shutdown', destroy);
    layout();
  }
};
