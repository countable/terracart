// Development-only experiment. The production entry point never loads this file.
(() => {
  const $ = selector => document.querySelector(selector);
  const frame = $('#preview'), status = $('#status'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(location.search);
  const runtime = params.get('runtime') || document.currentScript.dataset.runtime || '../';
  const base = new URL(runtime, location.href);
  if (base.origin !== location.origin) throw new Error('Preview runtime must be same-origin');
  localStorage.setItem('terracart.introSeen', '1');
  localStorage.setItem('terracart.howtoSeen', '1');
  sessionStorage.setItem('terracart.safetySeen', '1');
  frame.src = new URL('index.html?sandbox=true&sandboxZone=restoration', base);
  let layer, band, raf = 0, lastTime = 0, current = .5, target = .5, sensor = false, baseline = null, lastBeta = null;
  let mode = reduced.matches ? 'manual' : 'drift', writes = 0, frames = 0, jsMs = 0, elapsed = 0;
  $('#mode').value = mode;
  const timer = setInterval(() => {
    if (!frame.contentWindow.__scene?._bootOverlayGone) return;
    clearInterval(timer);
    const doc = frame.contentDocument, script = doc.createElement('script');
    script.src = new URL('tools/compass_hud_harness.js', base);
    script.onload = () => {
      frame.contentWindow.installCompassHudHarness().preview('active');
      const style = doc.createElement('style');
      // A fixed aperture mask and a translated gradient: no per-frame pixel readback,
      // canvas upload, layout query, shader context, or animation of the mask itself.
      style.textContent = `.tilt-shine-mask{position:absolute;inset:0;overflow:hidden;pointer-events:none;isolation:isolate;mask-image:radial-gradient(circle calc(var(--compass-map-size) / 2) at 50% calc(var(--compass-map-top) + var(--compass-map-size) / 2),transparent calc(100% - 2px),#000 100%);mix-blend-mode:screen}.tilt-shine-band{position:absolute;left:-25%;top:-30%;width:150%;height:60%;will-change:transform;background:linear-gradient(166deg,transparent 15%,rgba(154,196,226,.04) 28%,rgba(202,221,235,.20) 40%,rgba(255,246,211,.58) 48%,rgba(242,249,255,.8) 50%,rgba(194,225,245,.25) 54%,rgba(177,204,230,.07) 67%,transparent 80%);pointer-events:none}`;
      doc.head.append(style);
      layer = doc.createElement('div'); layer.className = 'tilt-shine-mask'; layer.setAttribute('aria-hidden', 'true');
      band = doc.createElement('div'); band.className = 'tilt-shine-band'; layer.append(band);
      doc.querySelector('#compass-body').append(layer);
      layer.style.opacity = $('#strength').value / 100;
      status.textContent = 'Ready · metal only; map and controls retain their original appearance.';
      window.shineProbe = { setAngle, get stats() { return { writes, frames, jsMs, elapsed, mode, current, target, sensor }; }, layer, band };
      wake();
    };
    doc.head.append(script);
  }, 200);
  function wake() { if (!raf && layer && !document.hidden) { lastTime = 0; raf = requestAnimationFrame(tick); } }
  function tick(time) {
    raf = 0;
    if (document.hidden) return;
    // A slow reflection needs at most 30 visual updates per second.
    if (lastTime && time - lastTime < 32) { raf = requestAnimationFrame(tick); return; }
    const start = performance.now(), dt = lastTime ? Math.min(time - lastTime, 80) : 33.3;
    lastTime = time; elapsed += dt;
    if (mode === 'drift' && !reduced.matches) target = .5 + .43 * Math.sin(time / 18000);
    current += (target - current) * (1 - Math.exp(-dt / 160));
    band.style.transform = `translate3d(0,${(current * 220 - 20).toFixed(3)}%,0)`;
    writes++; frames++; jsMs += performance.now() - start;
    if (frames % 60 === 0) $('#stats').textContent = `${writes} transform writes · ${(jsMs / frames).toFixed(3)} ms JS/update\nOne moving gradient; static circular aperture mask.\nNo extra WebGL context or per-frame texture upload.`;
    if (mode !== 'off' && ((mode === 'drift' && !reduced.matches) || Math.abs(target - current) > .0005)) raf = requestAnimationFrame(tick);
  }
  function setAngle(value) {
    target = Math.max(0, Math.min(1, .5 + value / 90));
    $('#angle').value = value; $('#angle-value').textContent = `${Math.round(value)}°`; wake();
  }
  $('#angle').oninput = event => { mode = 'manual'; sensor = false; $('#mode').value = mode; layer && (layer.hidden = false); setAngle(Number(event.target.value)); };
  $('#mode').onchange = event => { mode = event.target.value; sensor = false; if (layer) layer.hidden = mode === 'off'; wake(); };
  $('#strength').oninput = event => { if (layer) layer.style.opacity = event.target.value / 100; };
  $('#size').onchange = event => { const [width, height] = event.target.value.split(','); frame.style.width = width + 'px'; frame.style.height = height + 'px'; };
  $('#calibrate').onclick = () => { baseline = lastBeta; setAngle(0); };
  $('#sensor').onclick = async () => {
    if (!window.isSecureContext) { status.textContent = 'Device tilt needs HTTPS. Manual angle and desktop drift still work.'; return; }
    if (!window.DeviceOrientationEvent) { status.textContent = 'This browser has no device orientation support. Use the angle slider.'; return; }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') { status.textContent = 'Tilt permission was declined. The angle slider still works.'; return; }
      sensor = true; baseline = null; mode = 'manual'; $('#mode').value = mode; if (layer) layer.hidden = false;
      status.textContent = 'Tilt enabled · waiting for motion. Recenter at your normal viewing angle.';
    } catch (error) { status.textContent = `Tilt unavailable: ${error.message}. Use the angle slider.`; }
  };
  window.addEventListener('deviceorientation', event => {
    if (!sensor || !Number.isFinite(event.beta) || document.hidden) return;
    lastBeta = event.beta; if (baseline === null) baseline = lastBeta;
    // Wrap crossing ±180° rather than jumping to the opposite side.
    const delta = ((lastBeta - baseline + 540) % 360) - 180;
    setAngle(Math.max(-45, Math.min(45, delta)));
    status.textContent = 'Device tilt active · reflection follows forward/back angle.';
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake(); });
  reduced.addEventListener('change', () => { if (reduced.matches && mode === 'drift') { mode = 'manual'; $('#mode').value = mode; } wake(); });
  window.addEventListener('pagehide', () => { clearInterval(timer); cancelAnimationFrame(raf); });
})();
