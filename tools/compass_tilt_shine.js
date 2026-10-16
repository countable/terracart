// Development-only experiment. The production entry point never loads this file.
(() => {
  const $ = selector => document.querySelector(selector);
  const frame = $('#preview'), status = $('#status'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(location.search);
  const runtime = params.get('runtime') || document.currentScript.dataset.runtime || '../';
  const base = new URL(runtime, location.href);
  const bakedBase = new URL('compass-shine-baked/', document.currentScript.src);
  if (base.origin !== location.origin) throw new Error('Preview runtime must be same-origin');
  localStorage.setItem('terracart.introSeen', '1');
  localStorage.setItem('terracart.howtoSeen', '1');
  sessionStorage.setItem('terracart.safetySeen', '1');
  frame.src = new URL('index.html?sandbox=true&sandboxZone=restoration', base);
  let layer, band, baked, raf = 0, lastTime = 0, current = .5, target = .5, sensor = false, baseline = null, lastBeta = null, lastGamma = null, rollBaseline = null, sideTilt = 0;
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
      style.textContent = `.tilt-shine-mask{position:absolute;inset:0;overflow:hidden;pointer-events:none;isolation:isolate;mask-image:radial-gradient(circle calc(var(--compass-map-size) / 2) at 50% calc(var(--compass-map-top) + var(--compass-map-size) / 2),transparent calc(100% - 2px),#000 100%);mix-blend-mode:soft-light}.tilt-shine-band{position:absolute;left:-25%;top:-30%;width:150%;height:60%;will-change:transform;background:linear-gradient(166deg,transparent 15%,rgba(154,196,226,.04) 28%,rgba(202,221,235,.20) 40%,rgba(255,246,211,.58) 48%,rgba(242,249,255,.8) 50%,rgba(194,225,245,.25) 54%,rgba(177,204,230,.07) 67%,transparent 80%);pointer-events:none}.tilt-shine-baked{position:absolute;inset:0;background-size:100% 100%;background-repeat:no-repeat;mask-repeat:no-repeat;mask-position:center top;mask-size:100% 100%}.tilt-shine-mask[data-baked=true] .tilt-shine-band{display:none}`;
      doc.head.append(style);
      layer = doc.createElement('div'); layer.className = 'tilt-shine-mask'; layer.setAttribute('aria-hidden', 'true');
      band = doc.createElement('div'); band.className = 'tilt-shine-band'; layer.append(band);
      baked = doc.createElement('div'); baked.className = 'tilt-shine-baked'; baked.style.maskImage = `url("${new URL('overhead-beam.png', bakedBase)}")`; layer.append(baked);
      updateBake();
      doc.querySelector('#compass-body').append(layer);
      layer.style.opacity = $('#strength').value / 100;
      applyBlend();
      status.textContent = 'Ready · metal only; map and controls retain their original appearance.';
      window.shineProbe = { setAngle, setRoll, get stats() { return { writes, frames, jsMs, elapsed, mode, current, target, sensor }; }, layer, band };
      wake();
    };
    doc.head.append(script);
  }, 200);
  function updateBake() {
    if (baked) baked.style.backgroundImage = `url("${new URL('highlight-' + $('#size').value.replace(',', 'x') + '.webp', bakedBase)}")`;
  }
  function applyBlend() {
    if (!layer) return;
    const blend = $('#blend').value;
    layer.dataset.baked = String(blend === 'baked');
    baked.hidden = blend !== 'baked';
    layer.style.mixBlendMode = blend === 'baked' ? 'normal' : blend;
    // Multiply can only shade the existing texture. Soft light keeps its dark
    // grooves while lifting the ridges; neither reconstructs surface normals.
    band.style.background = blend === 'multiply'
      ? 'linear-gradient(166deg,transparent 15%,rgba(55,70,87,.25) 30%,rgba(32,42,54,.85) 50%,rgba(55,70,87,.25) 68%,transparent 80%)'
      : blend === 'soft-light'
        ? 'linear-gradient(166deg,transparent 15%,rgba(40,55,75,.30) 30%,rgba(225,239,255,.65) 42%,rgba(255,250,235,1) 50%,rgba(225,239,255,.65) 58%,rgba(40,55,75,.30) 70%,transparent 85%)'
        : '';
  }
  $('#blend').onchange = applyBlend;
  function wake() { if (!raf && layer && !document.hidden) { lastTime = 0; raf = requestAnimationFrame(tick); } }
  function tick(time) {
    raf = 0;
    if (document.hidden) return;
    // A slow reflection needs at most 30 visual updates per second.
    if (lastTime && time - lastTime < 32) { raf = requestAnimationFrame(tick); return; }
    const start = performance.now(), dt = lastTime ? Math.min(time - lastTime, 80) : 33.3;
    lastTime = time; elapsed += dt;
    if (mode === 'drift' && !reduced.matches) { target = .5 + .25 * Math.sin(time / 18000); sideTilt = 22 * Math.sin(time / 23000); }
    current += (target - current) * (1 - Math.exp(-dt / 160));
    const travel = current * 220 - 20;
    band.style.transform = `translate3d(0,${travel.toFixed(3)}%,0)`;
    // Keep emissive texels fixed to the chassis. Only a prefiltered beam mask
    // moves: no runtime blur/readback. Mask edits may repaint; phone profiling
    // remains necessary. This is stylized overhead light, not surface ray tracing.
    const width = 75 + current * 80, reach = 70 + current * 90;
    baked.style.maskSize = `${width.toFixed(2)}% ${reach.toFixed(2)}%`;
    baked.style.maskPosition = `calc(50% + ${(sideTilt * 1.8).toFixed(2)}px) 0px`;
    writes++; frames++; jsMs += performance.now() - start;
    if (frames % 60 === 0) $('#stats').textContent = `${writes} animation updates · ${(jsMs / frames).toFixed(3)} ms JS/update\nFixed groove-gated bloom; overhead tapered beam.\nNo extra WebGL context or per-frame texture upload.`;
    if (mode !== 'off' && ((mode === 'drift' && !reduced.matches) || Math.abs(target - current) > .0005)) raf = requestAnimationFrame(tick);
  }
  function setRoll(value) { sideTilt = value; $('#roll').value = value; $('#roll-value').textContent = `${Math.round(value)}°`; wake(); }
  $('#roll').oninput = event => { mode = 'manual'; sensor = false; $('#mode').value = mode; if (layer) layer.hidden = false; setRoll(Number(event.target.value)); };
  function setAngle(value) {
    target = Math.max(0, Math.min(1, .5 + value / 90));
    $('#angle').value = value; $('#angle-value').textContent = `${Math.round(value)}°`; wake();
  }
  $('#angle').oninput = event => { mode = 'manual'; sensor = false; $('#mode').value = mode; layer && (layer.hidden = false); setAngle(Number(event.target.value)); };
  $('#mode').onchange = event => { mode = event.target.value; sensor = false; if (layer) layer.hidden = mode === 'off'; wake(); };
  $('#strength').oninput = event => { if (layer) layer.style.opacity = event.target.value / 100; };
  $('#size').onchange = event => { const [width, height] = event.target.value.split(','); frame.style.width = width + 'px'; frame.style.height = height + 'px'; updateBake(); };
  $('#calibrate').onclick = () => { baseline = lastBeta; rollBaseline = lastGamma; setAngle(0); setRoll(0); };
  $('#sensor').onclick = async () => {
    if (!window.isSecureContext) { status.textContent = 'Device tilt needs HTTPS. Manual angle and desktop drift still work.'; return; }
    if (!window.DeviceOrientationEvent) { status.textContent = 'This browser has no device orientation support. Use the angle slider.'; return; }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') { status.textContent = 'Tilt permission was declined. The angle slider still works.'; return; }
      sensor = true; baseline = null; rollBaseline = null; mode = 'manual'; $('#mode').value = mode; if (layer) layer.hidden = false;
      status.textContent = 'Tilt enabled · waiting for motion. Recenter at your normal viewing angle.';
    } catch (error) { status.textContent = `Tilt unavailable: ${error.message}. Use the angle slider.`; }
  };
  window.addEventListener('deviceorientation', event => {
    if (!sensor || !Number.isFinite(event.beta) || document.hidden) return;
    lastBeta = event.beta; if (baseline === null) baseline = lastBeta;
    if (Number.isFinite(event.gamma)) { lastGamma = event.gamma; if (rollBaseline === null) rollBaseline = lastGamma; setRoll(Math.max(-45, Math.min(45, lastGamma - rollBaseline))); }
    // Wrap crossing ±180° rather than jumping to the opposite side.
    const delta = ((lastBeta - baseline + 540) % 360) - 180;
    setAngle(Math.max(-45, Math.min(45, delta)));
    status.textContent = 'Device tilt active · overhead reflection follows pitch and side tilt.';
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake(); });
  reduced.addEventListener('change', () => { if (reduced.matches && mode === 'drift') { mode = 'manual'; $('#mode').value = mode; } wake(); });
  window.addEventListener('pagehide', () => { clearInterval(timer); cancelAnimationFrame(raf); });
})();
