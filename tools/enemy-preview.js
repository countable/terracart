/* global loadGame, Lairs, EnemyRoster, SpriteLayout, ASSETS, recolorEnemyPixels, ArtPreviewColour, EnemyHabitats, ZoneVariantData */
'use strict';
(async () => {
  const status = document.querySelector('#status');
  try {
    await loadGame();
    if (!SpriteLayout.creatureAppearance) throw new Error('This preview needs SpriteLayout.creatureAppearance from the current game.');
    const response = await fetch('../docs/art/art-direction.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load the world palette.');
    const { palette: worldPalette } = await response.json();
    if (!worldPalette?.length) throw new Error('The world palette is empty.');
    const colour = document.querySelector('#colour');
    const search = document.querySelector('#search');
    const tier = document.querySelector('#tier');
    const linkParams = new URLSearchParams(location.search);
    search.value = linkParams.get('enemy') || linkParams.get('search') || '';
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

    for (const value of [...new Set(rows.map(row => row.tier))].sort((a, b) => a - b)) {
      const option = document.createElement('option'); option.value = value; option.textContent = `Tier ${value}`; tier.append(option);
    }
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
    function habitatMemberships(row) {
      return Object.values(Lairs.GROUPS)
        .filter(group => group.members.some(member => member.kind === row.id))
        .map(group => `${group.label}: ${group.story}`);
    }
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
        const treated = document.createElement('canvas');
        treated.width = sheet.width; treated.height = sheet.height;
        treated.getContext('2d').drawImage(sheet, 0, 0);
        ArtPreviewColour.recolour(treated, worldPalette, { strength: .25, preserveLuminance: true });
        painted.set(key, { original: sheet, palette: treated });
      }
      const card = document.createElement('article'); card.className = 'enemy';
      const title = document.createElement('h2'); title.textContent = row.name;
      const kind = document.createElement('div'); kind.className = 'kind'; kind.textContent = row.id;
      const views = document.createElement('div'); views.className = 'views';
      const previews = ['original', 'palette'].map(mode => {
        const view = document.createElement('div'); view.className = 'view';
        const label = document.createElement('div'); label.className = 'view-label';
        label.textContent = mode === 'original' ? 'Original game colours' : '25% world palette';
        const stage = document.createElement('div'); stage.className = 'stage';
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-label', `${row.name}: ${label.textContent} at game scale`);
        stage.append(canvas); view.append(label, stage); views.append(view);
        return { mode, view, stage, canvas, sheet: painted.get(key)[mode] };
      });
      const meta = document.createElement('div'); meta.className = 'meta';
      const scaleInfo = document.createElement('strong'); scaleInfo.className = 'scale-factor';
      const geometry = document.createElement('div');
      const frameInfo = document.createElement('div'); frameInfo.className = 'frame';
      const support = document.createElement('div');
      support.textContent = art.directions ? 'Authored direction and state frames' : 'Uses the game’s available cycle; no invented directional art';
      const stats = document.createElement('div'); stats.className = 'meta stats';
      stats.textContent = `Tier ${row.tier} · HP ${row.hp} · armour ${row.armor} · damage ${row.dmg} × ${row.attackHits} · ${row.attackType}, range ${row.range} cells · attack interval ${row.damageIntervalSeconds}s · speed ${row.movement.speedMetersPerSecond} m/s`;
      const habitats = document.createElement('div'); habitats.className = 'meta habitats';
      const zoneName = id => ZoneVariantData.variants.find(zone => zone.id === id)?.name || id.replaceAll('_', ' ');
      const memberships = table => Object.entries(table).filter(([, kinds]) => kinds.includes(row.id)).map(([id]) => zoneName(id));
      const details = [
        row.surface ? `Surface: ${row.surface.biomes.join(', ')}; ${row.surface.time}; ${row.surface.minDistance}–${row.surface.maxDistance ?? '∞'} m` : 'No general surface spawn',
        row.cave ? `Caves: depth ${row.cave.minDepth}–${row.cave.maxDepth ?? '∞'} (${row.cave.depthRule})` : 'No general cave spawn',
        ['Authored garrisons', habitatMemberships(row)],
        ['Zone encounters', memberships(EnemyHabitats.SURFACE_FAMILIES)],
        ['Building habitats', memberships(EnemyHabitats.BUILDING_FAMILIES)],
        ['Cave habitats', memberships(EnemyHabitats.FAMILIES)],
        ['Zone guards', ZoneVariantData.variants.filter(zone => zone.guards?.kind === row.id || zone.guards?.choices?.includes(row.id)).map(zone => zone.name)],
      ];
      if (row.ability?.type === 'split') details.push(`Splits after a direct hit if both halves retain at least ${row.ability.minHp} HP and space is available; remaining HP is shared; cooldown ${row.ability.cooldownSeconds}s. Burning does not trigger a split.`);
      for (const detail of details) {
        if (Array.isArray(detail) && !detail[1].length) continue;
        const line = document.createElement('div');
        line.textContent = Array.isArray(detail) ? `${detail[0]}: ${detail[1].join(', ')}` : detail;
        habitats.append(line);
      }
      meta.append(scaleInfo, geometry, frameInfo, support); card.append(title, kind, views, stats, habitats, meta); gallery.append(card);
      cards.push({ row, card, art, asset, previews, scaleInfo, geometry, frameInfo, support });
    }
    let clock = 0, lastTime = performance.now();
    function draw(now) {
      const instanceScale = Number(scaleInput.value);
      if (!Number.isFinite(instanceScale) || instanceScale <= 0) return;
      gallery.classList.toggle('comparing', colour.value === 'compare');
      for (const { row, card, art, asset, previews, scaleInfo, geometry, frameInfo, support } of cards) {
        if (card.hidden) continue;
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
        const authored = (art.directions?.[direction.value] || art.directions?.[directionKey])?.[state.value];
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
        for (const { mode, view, canvas, stage, sheet } of previews) {
          view.hidden = colour.value !== 'compare' && colour.value !== mode;
          if (view.hidden) continue;
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
        }
        const formatScale = value => Number(value.toFixed(3));
        scaleInfo.textContent = `Scale: ${formatScale(scale)}× (${formatScale(SpriteLayout.creatureScale(row.id))}× enemy × ${formatScale(SpriteLayout.creatureInstScale(creature))}× instance)`;
        geometry.textContent = `${fw}×${fh} source · ${Number((fw * scale).toFixed(2))}×${Number((fh * scale).toFixed(2))} px frame`;
        frameInfo.textContent = `Frame ${appearance.frame}${appearance.flipX ? ' · mirrored' : ''} · opacity ${SpriteLayout.creatureAlpha(row.id)}`;
      }
    }
    function filterCards() {
      const query = search.value.trim().toLowerCase().replaceAll('_', ' ');
      for (const { row, card } of cards) {
        card.hidden = !(row.name + ' ' + row.id.replaceAll('_', ' ') + ' ' + habitatMemberships(row).join(' ')).toLowerCase().includes(query)
          || (tier.value !== '' && String(row.tier) !== tier.value);
      }
      const count = cards.filter(({ card }) => !card.hidden).length;
      document.querySelector('#empty').hidden = count > 0;
      status.textContent = `${count} of ${rows.length} creatures shown. Current runtime roster and stats; 25% palette preview available; 32 px reference grid.`;
      draw(clock);
    }
    for (const control of [search, tier]) control.addEventListener('input', filterCards);
    function tick(now) {
      if (animate.checked) clock += now - lastTime;
      lastTime = now; draw(clock); requestAnimationFrame(tick);
    }
    for (const control of [direction, state, scaleInput, colour]) control.addEventListener('input', () => { clock = 0; draw(clock); });
    window.exportEnemyPreview = () => {
      draw(clock);
      const copy = document.documentElement.cloneNode(true);
      copy.querySelectorAll('script,.controls').forEach(el => el.remove());
      copy.querySelector('#status').textContent = `Snapshot: ${direction.value}, ${state.value}, instance size ${scaleInput.value}×. ${cards.filter(({ card }) => !card.hidden).length} of ${rows.length} creatures. Colour: ${colour.selectedOptions[0].textContent}. Search: ${search.value || "all"}; tier: ${tier.value || "all"}.`;
      const originals = [...document.querySelectorAll('.stage canvas')];
      copy.querySelectorAll('.stage canvas').forEach((canvas, i) => {
        const image = document.createElement('img'); image.src = originals[i].toDataURL('image/png');
        image.alt = originals[i].getAttribute('aria-label');
        image.style.cssText = originals[i].style.cssText; canvas.replaceWith(image);
      });
      copy.querySelectorAll('.enemy[hidden],.view[hidden]').forEach(el => el.remove());
      return '<!doctype html>\n' + copy.outerHTML;
    };
    document.querySelector('#export').disabled = false;
    document.querySelector('#export').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([window.exportEnemyPreview()], { type: 'text/html' }));
      const link = document.createElement('a'); link.href = url; link.download = 'enemy-preview.html'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    filterCards();
    document.documentElement.dataset.previewReady = 'true';
    requestAnimationFrame(tick);
  } catch (error) {
    status.className = 'error'; status.textContent = error.message; console.error(error);
  }
})();
