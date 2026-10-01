/* global loadGame, NPC, SpriteLayout, SortableTables */
'use strict';
// NPC viewer: every neighbour role and named story character the game can
// show, with the art it wears now. Roles, labels, zone shares, names and
// sheets come from the game (NPC.PROFILES / LABELS / STORY_ROLES,
// SpriteLayout.NPC_SHEETS); DOES and LOOKS below only describe them.
(async () => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  try {
    await loadGame();
    // What each role does when tapped (NPC.dialogue / MemoryStory.npcDialogue).
    const DOES = {
      scout: 'Points out a discovery within 250 m. After 9 memories passes on the rumour; from act 2 tells of the Breaking.',
      scholar: 'Reads a tip aloud from a scorched book page.',
      merchant: 'Opens the zone\'s themed shop.',
      trader: 'Offers a swap.',
      keeper: 'Tells the story of the zone they keep.',
      mason: 'Counts the roofs mended so far and points to the nearest wreck.',
      lamplighter: 'Counts the lamps burning brighter for you; they fade if you stay away.',
      warden: 'Arrives at 3 memories. Her first talk is the family\'s plea and the safe area; later she celebrates mended roofs, warns about Orrin\'s dragon talk and passes on the rumour at 9 memories.',
      witness: 'Arrives at 6 memories near you, hunted by a goblin archer. Once saved she gives a starfruit seed and stays there; then tells of the night the roofs fell, and in act 2 notices you have not aged.',
      wanderer: 'The one neighbour on the first morning. Homeless until the next roof after you meet; then housed, then settled with something in the pot.',
      believer: 'Arrives at 9 memories. Praises Tim and follows his tower: urges you to raise it, waits at the locked door, insists he went ahead when it goes cold.',
      archaeologist: 'At a dig 250 m from Home from the start. Clumsy and careful; argues dragons are peaceful, through a conversation that unlocks over time.',
    };
    // How each sheet looks, keyed by its idle texture.
    const LOOKS = {
      npc_0_idle: 'Cream hood over red hair, brown dress.', npc_1_idle: 'Pale grey hood and hair, red dress.',
      npc_2_idle: 'Green hood over fair hair, round glasses, green dress.', orrin_idle: 'Bald, white moustache, green vest.',
      npc_wayfinder_idle: 'Dark blue hair, red top.', npc_peddler_idle: 'Fair hair, red jacket.', npc_barterer_idle: 'Fair hair in buns, pale dress.',
      npc_storykeeper_idle: 'White beard and headband.', npc_mason_idle: 'Red beard, horned helmet.', npc_lamplighter_idle: 'Blue hair, long cape.',
      npc_fieldwalker_idle: 'Wide-brimmed hat, overalls.', npc_seed_seller_idle: 'Green hair, orange tunic.', npc_harvest_trader_idle: 'Orange hair, orange dress.',
      npc_barn_raiser_idle: 'Spiky brown hair, grey headgear.', npc_market_trader_idle: 'Brown hair, plain tunic.', npc_town_guide_idle: 'Orange hair, red headband.',
      npc_stonemason_idle: 'Orange hair, broad shoulders.', npc_ranger_idle: 'Red braids, furs.', npc_forager_idle: 'Green hair, dark skin.',
      npc_lorekeeper_idle: 'Lilac hair, patterned robe.', npc_shrine_warden_idle: 'Grey helmet and armour.', npc_shrine_lorekeeper_idle: 'Blue hair, white robe.',
      npc_shrine_trader_idle: 'Green hair, satchel.', npc_shrine_keeper_idle: 'White and red hood.',
      npc_fox_tracker_idle: 'Brown fox, green tunic.', npc_fox_storyteller_idle: 'White fox, dark dress.', npc_fox_trader_idle: 'Blue fox, yellow shirt.', npc_den_keeper_idle: 'Golden fox, green vest.',
    };

    const npcArt = SpriteLayout.CREATURE_ART.npc;
    const asSheet = (s, scale = 1) => ({ key: s.idle, label: s.path.split('/').pop().replace(/_idle\.png$/, ''), src: '../' + s.path, fw: 48, fh: 48, scale: npcArt.scale * scale, tint: s.tint });
    const citizens = SpriteLayout.NPC_SHEETS.filter(s => !s.role);
    // A row's art: its own sheet, or the shared citizens in the zone's tints.
    const artFor = (c, scale) => {
      const own = SpriteLayout.npcSheet(c);
      return own.role ? [asSheet(own, scale)] : citizens.map(s => asSheet(s, scale));
    };
    const hex = n => '#' + n.toString(16).padStart(6, '0');
    const rows = [];
    // Story neighbours first: each has a name and a look of its own.
    for (const [role, row] of Object.entries(NPC.STORY_ROLES || {})) {
      const c = NPC.storyNeighbour(`npc_${role}_0_0`, role);
      rows.push({ id: `story:${role}`, named: true, label: row.name || row.label, zone: row.arrives ? 'rescue' : row.radiusM ? 'dig site' : 'trailer',
        role: `${row.label} · from ${row.minMemories} memories`, share: null, tints: [], art: artFor(c, row.artScale || 1), does: DOES[role] });
    }
    // Zone roles. One label is one role (Peddler, Lamplighter): a single row
    // lists every zone it appears in, with that zone's share.
    for (const [zone, p] of Object.entries(NPC.PROFILES)) {
      const counts = {};
      for (const r of p.roles) counts[r] = (counts[r] || 0) + 1;
      for (const [role, n] of Object.entries(counts)) {
        const label = NPC.LABELS[zone][role], same = rows.find(r => r.label === label && !r.named);
        if (same) { same.zones.push(zone); same.shares.push([zone, n / p.roles.length]); continue; }
        const art = artFor({ role, zone });
        rows.push({ id: `${zone}:${role}`, label, zone, zones: [zone], role, shares: [[zone, n / p.roles.length]],
          tints: art.some(a => a.tint == null) ? p.colors : [], art, does: DOES[role] });
      }
    }
    const lookOf = r => r.art.length === 1 ? LOOKS[r.art[0].key] || '' : 'One of the citizens, in the zone\'s tint.';
    const about = r => `${lookOf(r) ? `<b>Looks:</b> ${esc(lookOf(r))}` : ''}${r.does ? `<br><b>Does:</b> ${esc(r.does)}` : ''}`;
    const zonesOf = r => r.zones || [r.zone];

    const images = new Map();
    const load = src => {
      if (!images.has(src)) images.set(src, new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = encodeURI(src); }));
      return images.get(src);
    };
    // Draw a sheet's standing frame for the first `rowsToShow` facings (front,
    // back, left, right), each cropped to its own columns on one shared
    // vertical band so feet stay level, multiplied by `tint` like Phaser.
    async function draw(sheet, { rowsToShow = 1, tint = null, zoom, label = sheet.label }) {
      const im = await load(sheet.src);
      const fig = document.createElement('figure');
      if (!im) { fig.innerHTML = `<span class="missing">Missing image</span><figcaption>${esc(label)}</figcaption>`; return fig; }
      const src = document.createElement('canvas'); src.width = sheet.fw * rowsToShow; src.height = sheet.fh;
      const sx = src.getContext('2d');
      for (let r = 0; r < rowsToShow; r++) sx.drawImage(im, 0, r * sheet.fh, sheet.fw, sheet.fh, r * sheet.fw, 0, sheet.fw, sheet.fh);
      const px = sx.getImageData(0, 0, src.width, src.height);
      const t = sheet.tint ?? tint;
      if (t != null) for (let i = 0; i < px.data.length; i += 4) { px.data[i] *= ((t >> 16) & 255) / 255; px.data[i + 1] *= ((t >> 8) & 255) / 255; px.data[i + 2] *= (t & 255) / 255; }
      sx.putImageData(px, 0, 0);
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
      out.setAttribute('role', 'img'); out.setAttribute('aria-label', label);
      fig.append(out);
      const cap = document.createElement('figcaption'); cap.textContent = label; fig.append(cap);
      return fig;
    }
    const fill = async (el, jobs) => el.replaceChildren(...await Promise.all(jobs.map(([s, o]) => draw(s, o))));

    const zones = [...new Set(rows.flatMap(zonesOf))];
    $('zone').insertAdjacentHTML('beforeend', zones.map(z => `<option value="${esc(z)}">${esc(z[0].toUpperCase() + z.slice(1))}</option>`).join(''));
    $('summary').innerHTML = [[rows.filter(r => !r.named).length, 'neighbour roles'], [rows.filter(r => r.named).length, 'named characters'],
      [Object.keys(NPC.PROFILES).length, 'zones'], [new Set(rows.flatMap(r => r.art.map(a => a.key))).size, 'sheets in use']]
      .map(([n, label]) => `<div class="metric"><strong>${n}</strong>${label}</div>`).join('');

    let selected = rows[0]?.id;
    const zoom = () => Number($('zoom').value);
    // Shared citizens show once per zone tint; an own sheet shows once.
    const jobsFor = (r, opts) => r.tints.length ? r.art.map((s, i) => [s, { ...opts, tint: r.tints[i % r.tints.length] }]) : r.art.map(s => [s, opts]);
    async function render() {
      const q = $('search').value.trim().toLowerCase(), zone = $('zone').value, status = $('status').value;
      const shown = rows.filter(r => (zone === 'all' || zonesOf(r).includes(zone)) && (status === 'all' || (status === 'named') === !!r.named)
        && (!q || [r.label, r.role, ...zonesOf(r), lookOf(r)].join(' ').toLowerCase().includes(q)));
      $('count').textContent = `${shown.length} of ${rows.length} rows`;
      if (shown.length && !shown.some(r => r.id === selected)) selected = shown[0].id;
      $('rows').innerHTML = shown.length ? shown.map(r => `<tr data-id="${esc(r.id)}" tabindex="0" class="${r.id === selected ? 'selected' : ''}">
        <td class="role"><b>${esc(r.label)}</b><span class="kind">${esc(r.role)}</span>${r.named ? '<br><span class="tag keep">Named</span>' : ''}</td>
        <td>${esc(zonesOf(r).join(', '))}${r.tints.length ? '<br>' + r.tints.map(t => `<span class="swatch" style="background:${hex(t)}" title="Tint ${hex(t)}"></span>`).join('') : ''}</td>
        <td data-sort-value="${r.shares?.[0][1] ?? ''}">${r.shares ? r.shares.map(([z, v]) => `${Math.round(v * 100)}% ${esc(z)}`).join('<br>') : '—'}</td>
        <td><div class="sprites" data-art></div></td>
        <td class="about">${about(r)}</td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">No NPCs match these filters.</td></tr>';
      SortableTables.refresh($('rows').closest('table'));
      await Promise.all([...$('rows').rows].filter(tr => tr.dataset.id).map(tr => {
        const r = rows.find(x => x.id === tr.dataset.id);
        return fill(tr.querySelector('[data-art]'), jobsFor(r, { zoom: zoom() }));
      }));
      detail();
    }
    async function detail() {
      const r = rows.find(x => x.id === selected);
      if (!r) { $('detail').innerHTML = '<h2>No selection</h2><p>Select a row to see its art.</p>'; return; }
      $('detail').innerHTML = `<div class="eyebrow">${esc(zonesOf(r).join(' · '))}${r.named ? ' · named' : ''}</div><h2>${esc(r.label)}</h2><p class="note">${esc(r.role)}</p><p class="note">${about(r)}</p>
        <h3>Front, back, left, right</h3><div class="sprites" id="dArt"></div>`;
      const z = Math.min(zoom(), 3);
      await fill($('dArt'), r.tints.length
        ? r.art.flatMap(s => r.tints.map(t => [s, { zoom: z, rowsToShow: 4, tint: t, label: `${s.label}, tint ${hex(t)}` }]))
        : r.art.map(s => [s, { zoom: z, rowsToShow: 4 }]));
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
