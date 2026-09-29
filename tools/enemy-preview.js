/* global loadGame, EnemyRoster, SpriteLayout, ASSETS, recolorEnemyPixels */
'use strict';
(async () => {
  const status = document.querySelector('#status');
  try {
    await loadGame();
    if (!SpriteLayout.creatureAppearance) throw new Error('This preview needs SpriteLayout.creatureAppearance from the current game.');
    const gallery = document.querySelector('#gallery');
    const direction = document.querySelector('#direction');
    const state = document.querySelector('#state');
    const scaleInput = document.querySelector('#instance-scale');
    const animate = document.querySelector('#animate');
    const images = new Map();
    const painted = new Map();
    const minWidth = 192, minHeight = 160;
    const dpr = window.devicePixelRatio || 1;
    const rows = [...EnemyRoster.ROWS];
    if (!rows.some(row => row.id === 'fire_slime')) rows.push({ id: 'fire_slime', name: 'Fire Slime' });
    const cards = [];
    const imageFor = (url) => {
      if (!images.has(url)) images.set(url, new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load ${url}`));
        image.src = '../' + url;
      }));
      return images.get(url);
    };
    for (const row of rows) {
      const art = SpriteLayout.creatureArt(row.id);
      const asset = ASSETS[art.sheet];
      if (!asset) throw new Error(`No runtime sheet for ${row.id}: ${art.sheet}`);
      const tint = SpriteLayout.creatureTint(row.id);
      const key = `${art.sheet}:${tint}`;
      if (!painted.has(key)) {
        const image = await imageFor(asset.path);
        const sheet = document.createElement('canvas');
        sheet.width = image.naturalWidth; sheet.height = image.naturalHeight;
        const ctx = sheet.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, sheet.width, sheet.height);
        // Palette belongs to the loaded texture, including shared variant sheets.
        const palette = EnemyRoster.get(art.sheet)?.palette;
        if (palette) recolorEnemyPixels(pixels.data, palette);
        const rgb = [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255];
        for (let i = 0; i < pixels.data.length; i += 4) {
          for (let ch = 0; ch < 3; ch++) pixels.data[i + ch] = Math.round(pixels.data[i + ch] * rgb[ch] / 255);
        }
        ctx.putImageData(pixels, 0, 0);
        painted.set(key, sheet);
      }
      const card = document.createElement('article'); card.className = 'enemy';
      const title = document.createElement('h2'); title.textContent = row.name;
      const kind = document.createElement('div'); kind.className = 'kind'; kind.textContent = row.id;
      const stage = document.createElement('div'); stage.className = 'stage';
      const canvas = document.createElement('canvas');
      canvas.width = minWidth * dpr; canvas.height = minHeight * dpr;
      canvas.setAttribute('aria-label', row.name + ' at game scale');
      stage.append(canvas);
      const meta = document.createElement('div'); meta.className = 'meta';
      const geometry = document.createElement('div');
      const frameInfo = document.createElement('div'); frameInfo.className = 'frame';
      const support = document.createElement('div');
      support.textContent = art.directions ? 'Authored direction and state frames' : 'Uses the game’s available cycle; no invented directional art';
      meta.append(geometry, frameInfo, support); card.append(title, kind, stage, meta); gallery.append(card);
      cards.push({ row, art, asset, canvas, stage, geometry, frameInfo, support, sheet: painted.get(key) });
    }
    let clock = 0, lastTime = performance.now();
    function draw(now) {
      const instanceScale = Number(scaleInput.value);
      if (!Number.isFinite(instanceScale) || instanceScale <= 0) return;
      for (const { row, art, asset, canvas, stage, geometry, frameInfo, support, sheet } of cards) {
        const move = state.value === 'move';
        const attack = state.value === 'attack';
        const cycleStart = Math.floor(now / 1000) * 1000;
        const vector = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[direction.value];
        const creature = {
          kind: row.id, id: row.id, artScale: instanceScale,
          _facing: direction.value, _faceFlip: direction.value === 'left',
          _moveUntil: move ? now + 1000 : 0,
          _stepT0: move ? cycleStart : null, _hopMs: move ? 1000 : 0,
          _startX: 0, _startY: 0, _targetX: move ? vector[0] : 0, _targetY: move ? vector[1] : 0,
          _attackT0: attack ? cycleStart : null, _attackUntil: attack ? cycleStart + 1000 : 0,
        };
        const appearance = SpriteLayout.creatureAppearance(creature, now);
        const directionKey = ['left', 'right'].includes(direction.value) ? 'side' : direction.value;
        const authored = art.directions?.[directionKey]?.[state.value];
        support.textContent = authored
          ? `Authored ${direction.value} ${state.value} frames`
          : `No authored ${direction.value} ${state.value} cycle; game fallback shown`;
        const scale = SpriteLayout.creatureScale(row.id, SpriteLayout.creatureInstScale(creature));
        const fw = asset.frameWidth, fh = asset.frameHeight;
        // Keep actual game pixels even for large instances. Grow the canvas,
        // then let the card scroll horizontally instead of shrinking the sprite.
        const float = SpriteLayout.creatureFloat(row.id);
        const width = Math.max(minWidth, Math.ceil(fw * scale + 64));
        const height = Math.max(minHeight, Math.ceil(fh * scale + float + 64));
        const pixelWidth = Math.ceil(width * dpr), pixelHeight = Math.ceil(height * dpr);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth; canvas.height = pixelHeight;
        }
        canvas.style.width = stage.style.width = `${width}px`;
        canvas.style.height = stage.style.height = `${height}px`;
        const cols = sheet.width / fw;
        const x = (appearance.frame % cols) * fw, y = Math.floor(appearance.frame / cols) * fh;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = '#324737'; ctx.lineWidth = 1;
        for (let line = 0; line <= width; line += 32) { ctx.beginPath(); ctx.moveTo(line + 0.5, 0); ctx.lineTo(line + 0.5, height); ctx.stroke(); }
        for (let line = 0; line <= height; line += 32) { ctx.beginPath(); ctx.moveTo(0, line + 0.5); ctx.lineTo(width, line + 0.5); ctx.stroke(); }
        ctx.save(); ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = SpriteLayout.creatureAlpha(row.id);
        const foot = SpriteLayout.creatureFoot(row.id);
        ctx.translate(width / 2, height - 32 - fh * scale * (1 - foot) - float);
        if (appearance.flipX) ctx.scale(-1, 1);
        ctx.drawImage(sheet, x, y, fw, fh, -fw * scale / 2, -fh * scale * SpriteLayout.creatureFoot(row.id), fw * scale, fh * scale);
        ctx.restore();
        geometry.textContent = `${fw}×${fh} source · ${Number(scale.toFixed(3))}× scale · ${Number((fw * scale).toFixed(2))}×${Number((fh * scale).toFixed(2))} px frame`;
        frameInfo.textContent = `Frame ${appearance.frame}${appearance.flipX ? ' · mirrored' : ''} · opacity ${SpriteLayout.creatureAlpha(row.id)}`;
      }
    }
    function tick(now) {
      if (animate.checked) clock += now - lastTime;
      lastTime = now; draw(clock); requestAnimationFrame(tick);
    }
    for (const control of [direction, state, scaleInput]) control.addEventListener('input', () => { clock = 0; draw(clock); });
    window.exportEnemyPreview = () => {
      draw(clock);
      const copy = document.documentElement.cloneNode(true);
      copy.querySelectorAll('script,.controls').forEach(el => el.remove());
      copy.querySelector('#status').textContent = `Snapshot: ${direction.value}, ${state.value}, instance size ${scaleInput.value}×. ${rows.length} creatures.`;
      const originals = [...document.querySelectorAll('.stage canvas')];
      copy.querySelectorAll('.stage canvas').forEach((canvas, i) => {
        const image = document.createElement('img'); image.src = originals[i].toDataURL('image/png');
        image.alt = originals[i].getAttribute('aria-label');
        image.style.cssText = originals[i].style.cssText; canvas.replaceWith(image);
      });
      return '<!doctype html>\n' + copy.outerHTML;
    };
    document.querySelector('#export').disabled = false;
    document.querySelector('#export').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([window.exportEnemyPreview()], { type: 'text/html' }));
      const link = document.createElement('a'); link.href = url; link.download = 'enemy-preview.html'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    status.textContent = `${rows.length} creatures loaded. Runtime scale, frame selection and colours; 32 px reference grid.`;
    document.documentElement.dataset.previewReady = 'true';
    requestAnimationFrame(tick);
  } catch (error) {
    status.className = 'error'; status.textContent = error.message; console.error(error);
  }
})();
