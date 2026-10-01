/* global loadGame, NPC, SpriteLayout, SortableTables */
'use strict';
// NPC viewer: the game's neighbour roles beside proposed replacement art.
// Roles, labels, zone shares, tints and current sheets come from the game.
// PACKS and PROPOSALS below are review data only; nothing here ships.
(async () => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  try {
    await loadGame();
    const UA = '../unused_art/';
    const RPG = UA + 'RPG Top Down Character Asset Pack - FULL/RPG Top Down Characters - Full version/';
    const SRW = UA + 'SuperRetroWorld_CharacterPack_Full/sprite/';
    const MW = UA + 'MiniWorldSprites/Characters/';
    const PACKS = {
      citizen: { name: 'Citizen (in game)', frames: '48×48 cells, 6 frames, idle + walk sheets', licence: 'Shipping art' },
      pixelserial: { name: 'PixelSerial RPG Top Down', frames: '32×32, 4 rows idle + 4 rows walk, 4 frames', licence: 'Commercial use. No redistribution. Credit optional.' },
      srw: { name: 'Super Retro World', frames: '16×20, 4 rows, 3-frame walk, no idle', licence: 'Commercial use. Credit required: Gif, Noiracide, Romi. No redistribution.' },
      miniworld: { name: 'MiniWorldSprites', frames: '16×16, same rig as the player callings', licence: 'Already used for player art' },
    };
    // A sheet: image, cell size, standing column, rows in sheet order, pack, game scale.
    // Body height target is the player's 18px: PixelSerial and SRW at 1.0, MiniWorld at 1.5.
    const rpg = (dir, file, label) => ({ label, pack: 'pixelserial', src: `${RPG}${dir}/${file}.png`, fw: 32, fh: 32, col: 0, scale: 1 });
    const srw = (n, label, recolour) => {
      const k = (n - 1) % 8, file = ['character_1-8', 'character_9-16', 'character_17-24', 'character_25-32'][(n - 1) >> 3];
      return { label, pack: 'srw', src: `${SRW}${file}.png`, fw: 16, fh: 20, ox: (k % 4) * 48, oy: (k >> 2) * 80, col: 1, scale: 1, recolour };
    };
    const mw = (path, label) => ({ label, pack: 'miniworld', src: MW + path, fw: 16, fh: 16, col: 0, scale: 1.5 });

    // Proposals by `zone:role`. Keep rows short: a pick, optional runner-ups, one note.
    const FARMER = rpg('Farmer', 'farmer', 'Farmer');
    const SCHOLARS = [rpg('Old Man', 'old_man', 'Old Man'), rpg('Old Woman', 'old_woman', 'Old Woman')];
    const PROPOSALS = {
      'village:scout': { art: [rpg('Blonde Woman', 'blonde_woman', 'Blonde Woman'), rpg('Blue Haired Woman', 'blue_haired_woman', 'Blue Haired Woman')], keepCurrent: true, note: 'Keep the current citizens in the village pool alongside these.' },
      'village:scholar': { art: SCHOLARS, note: 'Elders read as people who remember before the Breaking.' },
      'village:merchant': { art: [rpg('Blonde Man', 'blonde_man', 'Blonde Man')], note: 'Plain clothes; the shop dialog carries the trade.' },
      'village:trader': { art: [rpg('Blonde Man', 'blonde_man', 'Blonde Man')], keepCurrent: true },
      'farm:scout': { art: [FARMER] },
      'farm:merchant': { art: [FARMER] },
      'farm:trader': { art: [FARMER] },
      'market:scout': { art: [rpg('Blue Haired Woman', 'blue_haired_woman', 'Blue Haired Woman')], keepCurrent: true },
      'market:merchant': { art: [rpg('Chef', 'chef', 'Chef')], note: 'Apron reads as someone selling food and supplies.' },
      'market:trader': { art: [rpg('Chef', 'chef', 'Chef'), rpg('Blonde Man', 'blonde_man', 'Blonde Man')] },
      'woodland:scout': { art: [rpg('Viking Man', 'viking_man', 'Viking Man'), rpg('Viking Woman', 'viking_woman', 'Viking Woman')], note: 'Furs and braids read as people who live outdoors.' },
      'woodland:scholar': { art: SCHOLARS },
      'woodland:trader': { art: [rpg('Viking Woman', 'viking_woman', 'Viking Woman')] },
      'shrine:scout': { art: [srw(27, 'SRW #27 green hood')], note: 'The only pointed-eared people in the pool. Brighter than PixelSerial; compare in game before committing.' },
      'shrine:scholar': { art: [srw(31, 'SRW #31 lilac hood')] },
      'shrine:trader': { art: [srw(28, 'SRW #28 blue hood')] },
      'shrine:keeper': { art: [srw(30, 'SRW #30 red hood'), srw(29, 'SRW #29 amber hood')], note: 'Sweeps the step and lights the lantern; same elf family as the warden.' },
      'village:mason': { art: [rpg('Viking Man', 'viking_man', 'Viking Man')], note: 'No builder in the pool. The sturdiest labourer stands in until one turns up.' },
      'farm:mason': { art: [FARMER], note: 'A barn raiser reads as a farmer with a job to do.' },
      'market:mason': { art: [rpg('Viking Man', 'viking_man', 'Viking Man')], note: 'No builder in the pool.' },
      'village:lamplighter': { art: [], keepCurrent: true, note: 'No match: nothing in the pool carries a light. Keep the citizens.' },
      'market:lamplighter': { art: [], keepCurrent: true, note: 'No match: nothing in the pool carries a light. Keep the citizens.' },
      // Story neighbours by the trailer (NPC.STORY_ROLES).
      'trailer:warden': { art: [rpg('Soldier', 'soldier', 'Soldier'), rpg('Knight', 'knight', 'Knight')], note: 'Keeps the safe area. The soldier reads as a guard without a title.' },
      'trailer:witness': { art: [rpg('Old Woman', 'old_woman', 'Old Woman')], note: 'Remembers the night the roofs fell, and swears the Hood has not aged since.' },
      'trailer:wanderer': { art: [rpg('Blonde Kid Girl', 'blonde_kid_girl', 'Blonde Kid Girl'), rpg('Viking Kid Boy', 'viking_kid_boy', 'Viking Kid Boy')], childArt: true, note: 'These sheets are drawn child-sized. Drop CHILD_SCALE for them, or the child shrinks twice.' },
      'trailer:believer': { art: [rpg('Nun', 'nun', 'Nun')], note: 'Devotion in the clothes; lauds the wizard to anyone who will listen.' },
    };
    // Story cast from docs/story.txt. None has an NPC kind yet.
    const PLANNED = [
      { label: 'Tim', zone: 'tower', blurb: 'Kindly old wizard; Tiamat in human form', art: [srw(25, 'SRW #25, violet', 'violet')], alts: [mw('Soldiers/Ranged/PurpleRanged/MagePurple.png', 'MiniWorld MagePurple'), rpg('Old Man', 'old_man', 'PixelSerial Old Man')], note: 'Recolour the reds to the restored tower\'s violet; in red he reads as Santa. His hood echoes the Hood\'s: one quiet family hint. MagePurple matches the player rig but hides the face, leaving the portrait empty.' },
      { label: 'Ayo, human form', zone: 'caves', blurb: 'The white dragon, as she walked the world scouting', art: [srw(2, 'SRW #2')], alts: [], note: 'White hair and pale cloth, faintly fey. Nothing dragon-shaped. Foxi Lena was considered and rejected: fox ears point to the wrong animal.' },
      { label: 'Dragon hunters', zone: 'tower', blurb: 'The survivors\' bravest, armed at Tim\'s tower', art: ['Swordsman', 'Spearman', 'Axeman'].map(n => mw(`Soldiers/Melee/PurpleMelee/${n}Purple.png`, n)).concat(mw('Soldiers/Ranged/PurpleRanged/BowmanPurple.png', 'Bowman')), alts: [rpg('Knight', 'knight', 'PixelSerial Knight'), rpg('Viking Woman', 'viking_woman', 'PixelSerial Viking Woman')], note: 'The same sheets as the callings the player buys from Tim, in his violet instead of cyan. Skip the Musketeer. Use the PixelSerial pair for named hunters who need a face.' },
    ];

    // Current art straight from the game's tables.
    const npcArt = SpriteLayout.CREATURE_ART.npc;
    const currentSheets = SpriteLayout.NPC_SHEETS.map((s, i) => ({
      label: `Citizen ${i + 1}`, pack: 'citizen', src: '../' + s.path, fw: SpriteLayout.NPC_FRAME.width, fh: SpriteLayout.NPC_FRAME.height, col: 0, scale: npcArt.scale,
    }));
    const hex = n => '#' + n.toString(16).padStart(6, '0');
    const rows = [];
    for (const [zone, p] of Object.entries(NPC.PROFILES)) {
      const counts = {};
      for (const r of p.roles) counts[r] = (counts[r] || 0) + 1;
      for (const [role, n] of Object.entries(counts)) {
        const prop = PROPOSALS[`${zone}:${role}`] || { art: [] };
        rows.push({ id: `${zone}:${role}`, status: 'game', label: NPC.LABELS[zone][role], zone, role, share: n / p.roles.length, tints: p.colors, current: currentSheets, art: prop.art, alts: [], keepCurrent: prop.keepCurrent, note: prop.note || '' });
      }
    }
    // Story neighbours wear a village identity at their role's art scale.
    const village = NPC.PROFILES.village;
    for (const [role, row] of Object.entries(NPC.STORY_ROLES || {})) {
      const prop = PROPOSALS[`trailer:${role}`] || { art: [] };
      const k = row.artScale || 1;
      rows.push({ id: `trailer:${role}`, status: 'game', label: row.label, zone: 'trailer', role: `${role} · from ${row.minMemories} memories`, share: null, tints: village.colors,
        current: currentSheets.map(s => ({ ...s, scale: s.scale * k })), art: prop.childArt ? prop.art : prop.art.map(a => ({ ...a, scale: a.scale * k })), alts: [], keepCurrent: prop.keepCurrent, note: prop.note || '' });
    }
    for (const p of PLANNED) rows.push({ id: 'story:' + p.label, status: 'planned', label: p.label, zone: p.zone, role: p.blurb, share: null, tints: [], current: [], art: p.art, alts: p.alts, note: p.note });

    // Image cache; a missing pack resolves to null so the page still renders.
    const images = new Map();
    const load = src => {
      if (!images.has(src)) images.set(src, new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = encodeURI(src); }));
      return images.get(src);
    };
    function recolourViolet(data) {
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), s = max ? (max - min) / max : 0;
        let h = 0;
        if (max !== min) h = max === r ? ((g - b) / (max - min) + 6) % 6 / 6 : max === g ? ((b - r) / (max - min) + 2) / 6 : ((r - g) / (max - min) + 4) / 6;
        if (s <= 0.35 || (h >= 0.06 && h <= 0.92)) continue;
        // Shift saturated reds to violet (hue 0.78), keeping saturation and value.
        const v = max, hh = 0.78 * 6, f = hh - Math.floor(hh), p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
        const [R, G, B] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][Math.floor(hh) % 6];
        data[i] = R * 255; data[i + 1] = G * 255; data[i + 2] = B * 255;
      }
    }
    // Draw one sheet: rows 0..n-1 of the standing column, cropped to the union of
    // their opaque bounds, multiplied by `tint` like Phaser's world tint.
    async function draw(sheet, { rowsToShow = 1, tint = null, zoom }) {
      const im = await load(sheet.src);
      const fig = document.createElement('figure');
      if (!im) { fig.innerHTML = `<span class="missing">Missing in unused_art</span><figcaption>${esc(sheet.label)}</figcaption>`; return fig; }
      const src = document.createElement('canvas'); src.width = sheet.fw * rowsToShow; src.height = sheet.fh;
      const sx = src.getContext('2d');
      for (let r = 0; r < rowsToShow; r++) sx.drawImage(im, (sheet.ox || 0) + sheet.col * sheet.fw, (sheet.oy || 0) + r * sheet.fh, sheet.fw, sheet.fh, r * sheet.fw, 0, sheet.fw, sheet.fh);
      const px = sx.getImageData(0, 0, src.width, src.height);
      if (sheet.recolour === 'violet') recolourViolet(px.data);
      if (tint != null) for (let i = 0; i < px.data.length; i += 4) { px.data[i] *= ((tint >> 16) & 255) / 255; px.data[i + 1] *= ((tint >> 8) & 255) / 255; px.data[i + 2] *= (tint & 255) / 255; }
      sx.putImageData(px, 0, 0);
      // Crop each facing to its own columns but share one vertical band, so
      // feet stay level and facings sit a fixed gap apart.
      let y0 = src.height, y1 = 0;
      const cols = [];
      for (let r = 0; r < rowsToShow; r++) {
        let x0 = sheet.fw, x1 = 0;
        for (let y = 0; y < src.height; y++) for (let x = 0; x < sheet.fw; x++) if (px.data[(y * src.width + r * sheet.fw + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
        if (x1 > x0) cols.push([r * sheet.fw + x0, x1 - x0]);
      }
      if (!cols.length) { cols.push([0, src.width]); y0 = 0; y1 = src.height; }
      const k = sheet.scale * zoom, pad = 4, gap = 6, h = Math.round((y1 - y0) * k);
      const out = document.createElement('canvas'); out.className = 'spr';
      out.width = cols.reduce((w, [, cw]) => w + Math.round(cw * k), 0) + gap * (cols.length - 1) + pad * 2; out.height = h + pad * 2;
      const ox = out.getContext('2d'); ox.imageSmoothingEnabled = false;
      let dx = pad;
      for (const [cx, cw] of cols) { ox.drawImage(src, cx, y0, cw, y1 - y0, dx, pad, Math.round(cw * k), h); dx += Math.round(cw * k) + gap; }
      out.setAttribute('role', 'img'); out.setAttribute('aria-label', sheet.label);
      fig.append(out);
      const cap = document.createElement('figcaption'); cap.textContent = sheet.label; fig.append(cap);
      return fig;
    }
    async function fill(el, sheets, opts) {
      const figs = await Promise.all(sheets.map(s => draw(s, typeof opts === 'function' ? opts(s) : opts)));
      el.replaceChildren(...figs);
    }

    const zones = [...new Set(rows.map(r => r.zone))];
    $('zone').insertAdjacentHTML('beforeend', zones.map(z => `<option value="${z}">${z[0].toUpperCase() + z.slice(1)}</option>`).join(''));
    $('packs').innerHTML = Object.values(PACKS).map(p => `<tr><th>${esc(p.name)}</th><td>${esc(p.frames)}</td><td>${esc(p.licence)}</td></tr>`).join('');
    const inGame = rows.filter(r => r.status === 'game');
    $('summary').innerHTML = [[inGame.length, 'roles in game'], [Object.keys(NPC.PROFILES).length, 'zones'], [currentSheets.length, 'sheets in use'], [new Set(rows.flatMap(r => r.art.map(a => a.src + (a.oy || 0) + (a.ox || 0)))).size, 'proposed sheets'], [PLANNED.length, 'planned story roles']]
      .map(([n, label]) => `<div class="metric"><strong>${n}</strong>${label}</div>`).join('');

    let selected = rows[0]?.id;
    const zoom = () => Number($('zoom').value);
    async function render() {
      const q = $('search').value.trim().toLowerCase(), zone = $('zone').value, status = $('status').value;
      const shown = rows.filter(r => (zone === 'all' || r.zone === zone) && (status === 'all' || r.status === status)
        && (!q || [r.label, r.zone, r.role, ...r.art.map(a => a.label + ' ' + PACKS[a.pack].name)].join(' ').toLowerCase().includes(q)));
      $('count').textContent = `${shown.length} of ${rows.length} rows`;
      $('rows').innerHTML = shown.length ? shown.map(r => `<tr data-id="${esc(r.id)}" tabindex="0" class="${r.id === selected ? 'selected' : ''}">
        <td class="role"><b>${esc(r.label)}</b><span class="kind">${esc(r.role)}</span>${r.status === 'planned' ? '<br><span class="tag planned">Planned</span>' : ''}</td>
        <td>${esc(r.zone)}${r.tints.length ? '<br>' + r.tints.map(t => `<span class="swatch" style="background:${hex(t)}" title="Tint ${hex(t)}"></span>`).join('') : ''}</td>
        <td data-sort-value="${r.share ?? ''}">${r.share == null ? '—' : Math.round(r.share * 100) + '%'}</td>
        <td><div class="sprites" data-current></div></td>
        <td><div class="sprites" data-proposed></div>${r.keepCurrent ? '<span class="tag keep">Keep current too</span>' : ''}</td>
        <td>${[...new Set(r.art.map(a => PACKS[a.pack].name))].map(esc).join('<br>') || '<span class="muted">No proposal</span>'}</td></tr>`).join('')
        : '<tr><td colspan="6" class="empty">No NPCs match these filters.</td></tr>';
      SortableTables.refresh($('rows').closest('table'));
      await Promise.all([...$('rows').rows].filter(tr => tr.dataset.id).map(tr => {
        const r = rows.find(x => x.id === tr.dataset.id);
        return Promise.all([
          r.current.length ? fill(tr.querySelector('[data-current]'), r.current, s => ({ zoom: zoom(), tint: r.tints[r.current.indexOf(s) % r.tints.length] })) : (tr.querySelector('[data-current]').innerHTML = '<span class="muted">Not in game</span>'),
          r.art.length ? fill(tr.querySelector('[data-proposed]'), r.art, { zoom: zoom() }) : (tr.querySelector('[data-proposed]').innerHTML = '<span class="muted">No match in the pool</span>'),
        ]);
      }));
      detail();
    }
    async function detail() {
      const r = rows.find(x => x.id === selected);
      if (!r) { $('detail').innerHTML = '<h2>No selection</h2><p>Select a row to compare its art.</p>'; return; }
      $('detail').innerHTML = `<div class="eyebrow">${esc(r.zone)}${r.status === 'planned' ? ' · planned' : ''}</div><h2>${esc(r.label)}</h2><p class="note">${esc(r.role)}</p>
        ${r.current.length ? '<h3>Current, untinted and in each zone tint</h3><div class="sprites" id="dCur"></div>' : ''}
        <h3>Proposed, sheet rows 0–3</h3><div class="sprites" id="dProp"></div>
        ${r.alts.length ? '<h3>Runner-ups</h3><div class="sprites" id="dAlt"></div>' : ''}
        ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}`;
      const z = Math.min(zoom(), 3);
      if (r.current.length) {
        const variants = [...r.current.map(s => ({ ...s, label: s.label + ' (untinted)' })), ...r.tints.map((t, i) => ({ ...r.current[i % r.current.length], label: `Tint ${hex(t)}`, tint: t }))];
        await fill($('dCur'), variants, s => ({ zoom: z, rowsToShow: 4, tint: s.tint ?? null }));
      }
      if (r.art.length) await fill($('dProp'), r.art, { zoom: z, rowsToShow: 4 }); else $('dProp').innerHTML = '<span class="muted">No match in the pool</span>';
      if (r.alts.length) await fill($('dAlt'), r.alts, { zoom: z, rowsToShow: 4 });
    }
    const pick = tr => { if (!tr?.dataset.id) return; selected = tr.dataset.id; for (const x of $('rows').rows) x.classList.toggle('selected', x === tr); detail(); };
    $('rows').addEventListener('click', e => pick(e.target.closest('tr')));
    $('rows').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target.closest('tr')); } });
    for (const el of document.querySelectorAll('.controls input,.controls select')) el.addEventListener('input', render);
    $('reset').onclick = () => { $('search').value = ''; $('zone').value = 'all'; $('status').value = 'all'; SortableTables.clear($('rows').closest('table')); render(); };
    await render();
  } catch (err) {
    $('count').textContent = 'Could not load the game: ' + err.message;
    console.error(err);
  }
})();
