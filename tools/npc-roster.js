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
      foxi: { name: 'Foxi Characters', frames: '16×16, 4 rows, 4-frame walk, no idle', licence: 'Commercial use. No redistribution.' },
    };
    // A sheet: image, cell size, standing column, rows in sheet order, pack, game scale.
    // Body height target is the player's 18px: PixelSerial and SRW at 1.0, MiniWorld at 1.5.
    const rpg = (dir, file, label) => ({ label, pack: 'pixelserial', src: `${RPG}${dir}/${file}.png`, fw: 32, fh: 32, col: 0, scale: 1 });
    const srw = (n, label, recolour) => {
      const k = (n - 1) % 8, file = ['character_1-8', 'character_9-16', 'character_17-24', 'character_25-32'][(n - 1) >> 3];
      return { label, pack: 'srw', src: `${SRW}${file}.png`, fw: 16, fh: 20, ox: (k % 4) * 48, oy: (k >> 2) * 80, col: 1, scale: 1, recolour };
    };
    const mw = (path, label) => ({ label, pack: 'miniworld', src: MW + path, fw: 16, fh: 16, col: 0, scale: 1.5 });
    const fox = (name, label = name) => ({ label, pack: 'foxi', src: `${UA}Foxi_Characters/${/^(Lena|Rachel|Roxana|Flora|Elena)$/.test(name) ? 'Fem' : 'Masc'}_Characters/${name}.png`, fw: 16, fh: 16, col: 0, scale: 1.15 });
    // The game's own citizen sheets, untinted, for story neighbours who keep them.
    const ordinary = SpriteLayout.NPC_SHEETS.filter(s => !s.role);
    const citizen = (i, label) => ({ label, pack: 'citizen', src: '../' + ordinary[i].path, fw: SpriteLayout.NPC_FRAME.width, fh: SpriteLayout.NPC_FRAME.height, col: 0, scale: SpriteLayout.CREATURE_ART.npc.scale, fixedTint: 0xffffff });

    // Proposals by `zone:role`: one pick per role, so every role has its own
    // appearance, plus optional runner-ups. A label shown in several zones
    // (Peddler, Lamplighter) is one role and keeps one look everywhere. The viewer flags a sheet that two
    // picks share or that RESERVED holds for a named character.
    const FARMER = rpg('Farmer', 'farmer', 'Farmer');
    const PROPOSALS = {
      'village:scout': { art: [rpg('Blue Haired Woman', 'blue_haired_woman', 'Blue Haired Woman')] },
      'village:merchant': { art: [rpg('Blonde Man', 'blonde_man', 'Blonde Man')], note: 'Plain clothes; the shop dialog carries the trade.' },
      'village:trader': { art: [rpg('Blonde Woman', 'blonde_woman', 'Blonde Woman')], alts: [srw(12, 'SRW #12'), srw(5, 'SRW #5')] },
      'village:scholar': { art: [srw(4, 'SRW #4 bearded elder')], note: 'An elder who remembers before the Breaking.' },
      'village:mason': { art: [rpg('Viking Man', 'viking_man', 'Viking Man')], note: 'No builder in the pool. The sturdiest labourer stands in.' },
      'village:lamplighter': { art: [srw(19, 'SRW #19 caped')], note: 'Nothing in the pool carries a light; the cape reads as someone out at night. Same look in every zone.' },
      'farm:scout': { art: [FARMER] },
      'farm:merchant': { art: [srw(22, 'SRW #22 green hair')], alts: [srw(5, 'SRW #5 pink hair'), srw(12, 'SRW #12 pink hair')], note: 'Green for seed and sprout.' },
      'farm:trader': { art: [srw(6, 'SRW #6 orange hair')], alts: [srw(10, 'SRW #10 blonde'), srw(15, 'SRW #15 red hair')], note: 'Harvest colours.' },
      'farm:mason': { art: [srw(9, 'SRW #9 headband')], note: 'A barn raiser built for lifting.' },
      'market:merchant': { art: [rpg('Blonde Man', 'blonde_man', 'Blonde Man')], alts: [rpg('Chef', 'chef', 'Chef')], note: 'Same look as the village Peddler: one role.' },
      'market:trader': { art: [srw(14, 'SRW #14')], alts: [srw(16, 'SRW #16'), srw(6, 'SRW #6')] },
      'market:scout': { art: [srw(17, 'SRW #17')] },
      'market:mason': { art: [srw(23, 'SRW #23')], note: 'No builder in the pool. Broad shoulders stand in.' },
      'market:lamplighter': { art: [srw(19, 'SRW #19 caped')], note: 'Same look in every zone.' },
      'woodland:scout': { art: [rpg('Viking Woman', 'viking_woman', 'Viking Woman')], note: 'Furs and braids read as someone who lives outdoors.' },
      'woodland:trader': { art: [srw(7, 'SRW #7')], alts: [srw(1, 'SRW #1'), srw(21, 'SRW #21 golden hair')] },
      'woodland:scholar': { art: [srw(18, 'SRW #18')] },
      // No elves: fox people live in the grove variant (GROVE below), and the
      // hooded elves differed by cap colour alone.
      'shrine:scholar': { art: [srw(11, 'SRW #11 blue hair')], alts: [srw(3, 'SRW #3 purple caster')], note: 'With the elves gone, the label should drop "Elven" (proposed: Shrine Lorekeeper).' },
      'shrine:scout': { art: [rpg('Knight', 'knight', 'Knight')], alts: [srw(13, 'SRW #13 horned helm'), srw(3, 'SRW #3 purple caster')], note: 'A guard in a helmet reads as a warden at a glance.' },
      'shrine:trader': { art: [srw(16, 'SRW #16 green hair')], alts: [srw(21, 'SRW #21 golden hair'), srw(15, 'SRW #15 red hair')], note: 'Forest colours and a satchel; reads as someone who gathers in the grove.' },
      'shrine:keeper': { art: [srw(26, 'SRW #26 white hood')], alts: [srw(12, 'SRW #12 pink hair'), rpg('Bride', 'bride', 'Bride (veil)')], note: 'White and red hood reads as a temple attendant. Sweeps the step and lights the lantern.' },
      // Story neighbours by the trailer (NPC.STORY_ROLES).
      // Story neighbours by the trailer (NPC.STORY_ROLES) keep the original
      // citizen art, one sheet each, untinted; the child is one of them scaled.
      'trailer:warden': { art: [citizen(2, 'Citizen 3, untinted')], look: 'Green hood over fair hair, round glasses, green dress.' },
      'trailer:witness': { art: [citizen(1, 'Citizen 2, untinted')], look: 'Pale grey hood and hair, red dress.' },
      'trailer:believer': { art: [citizen(0, 'Citizen 1, untinted')], look: 'Cream hood over red hair, brown dress.' },
      'trailer:wanderer': { art: [citizen(0, 'Citizen 1, untinted, child scale')], look: 'Cream hood over red hair, child-sized.', note: 'The believer\'s sheet at CHILD_SCALE; size alone sets them apart.' },
    };
    // Story neighbours with their own dialogue get a fixed name like Orrin's.
    // Proposals only until they land in NPC.STORY_ROLES and docs/story.txt.
    const NAME_PROPOSALS = { warden: 'Bryn', witness: 'Maud', wanderer: 'Tilly', believer: 'Edda' };
    // What each role does when tapped (NPC.dialogue / MemoryStory.npcDialogue).
    const DOES = {
      scout: 'Points out a discovery within 250 m. After 9 memories passes on the rumour; from act 2 tells of the Breaking.',
      scholar: 'Reads a tip aloud from a scorched book page.',
      merchant: 'Opens the zone\'s themed shop.',
      trader: 'Offers a swap.',
      keeper: 'Tells the story of the zone they keep.',
      mason: 'Counts the roofs mended so far and points to the nearest wreck.',
      lamplighter: 'Counts the lamps burning brighter for you; they fade if you stay away.',
      warden: 'At the trailer from the start. Explains the safe area, welcomes you after the first roof, warns about Orrin\'s dragon talk, and passes on the rumour at 9 memories.',
      witness: 'Arrives at 6 memories. Tells of the night the roofs fell and names the Warmonger; in act 2 notices you have not aged.',
      wanderer: 'Arrives at 9 memories. Homeless until the next roof after you meet; then housed, then settled with something in the pot.',
      believer: 'Arrives at 3 memories. Praises Tim and follows his tower: urges you to raise it, waits at the locked door, insists he went ahead when it goes cold.',
      archaeologist: 'At a dig 250 m from Home from the start. Clumsy and careful; argues dragons are peaceful, through a conversation that unlocks over time.',
    };
    // Story cast from docs/story.txt that has no NPC kind yet.
    const PLANNED = [
      { label: 'Tim', named: true, zone: 'tower', look: 'White beard, violet hooded cap.', does: 'At the tower once it is the fifteenth restoration. Trades memories for power and callings; teaches the Hood to hunt.', blurb: 'Kindly old wizard; Tiamat in human form', art: [srw(25, 'SRW #25, violet', 'violet')],
        alts: [srw(20, 'SRW #20, violet', 'violet'), srw(3, 'SRW #3 purple caster'), mw('Soldiers/Ranged/PurpleRanged/MagePurple.png', 'MiniWorld MagePurple')],
        note: 'Recolour the reds to the restored tower\'s violet; in red #25 reads as Santa. His hood echoes the Hood\'s: one quiet family hint. #20 is a sterner bearded elder. #3 is younger and reads as a wizard at once. MagePurple matches the player rig but hides the face, leaving the portrait empty.' },
      { label: 'Ayo', named: true, zone: 'caves', look: 'White hair, pale blue and white cloth, faintly fey.', does: 'Met in person only at the end: an enemy to fight or an ally to reach.', blurb: 'The white dragon in human form, as she walked the world scouting', art: [srw(2, 'SRW #2')], note: 'White hair and pale cloth, faintly fey. Nothing dragon-shaped.' },
      { label: 'Dragon hunters', zone: 'tower', look: 'Violet soldier, the player\'s own rig.', does: 'Gather at the tower once it stands and go into the caves in Tim\'s name.', blurb: 'The survivors\' bravest, armed at Tim\'s tower', art: [mw('Soldiers/Melee/PurpleMelee/SwordsmanPurple.png', 'MiniWorld SwordsmanPurple')],
        alts: [mw('Soldiers/Melee/PurpleMelee/SpearmanPurple.png', 'SpearmanPurple'), mw('Soldiers/Ranged/PurpleRanged/BowmanPurple.png', 'BowmanPurple'), srw(13, 'SRW #13 horned helm')], note: 'One look for the role. The callings the player buys from Tim, in his violet instead of cyan.' },
    ];
    // Proposed grove variant of the shrine zone: fox people, with role names
    // of their own so they never read as the shrine's roles.
    const GROVE = [
      { role: 'scout', label: 'Fox Tracker', art: [fox('Lucas')], alts: [fox('Ian')], look: 'Brown fox, green tunic.' },
      { role: 'scholar', label: 'Fox Storyteller', art: [fox('Flora')], alts: [fox('Lena')], look: 'White fox, dark dress.' },
      { role: 'trader', label: 'Fox Trader', art: [fox('Marcos')], alts: [fox('Sean')], look: 'Blue fox, yellow shirt.' },
      { role: 'keeper', label: 'Den Keeper', art: [fox('Elena')], alts: [fox('Roxana')], look: 'Golden fox, green vest.' },
    ];
    // Source art already spoken for by a named character.
    const keyOf = a => `${a.src}|${a.ox || 0}|${a.oy || 0}${a.child ? '|child' : ''}`;
    const RESERVED = new Map([[keyOf(rpg('Old Man', 'old_man', '')), 'Orrin']]);

    // Current art straight from the game's tables. A sheet with a `role`
    // belongs to that role only; the rest are the shared citizen pool.
    const npcArt = SpriteLayout.CREATURE_ART.npc;
    const asSheet = (s, label) => ({ label, pack: 'citizen', src: '../' + s.path, fw: SpriteLayout.NPC_FRAME.width, fh: SpriteLayout.NPC_FRAME.height, col: 0, scale: npcArt.scale, fixedTint: s.tint });
    const currentSheets = SpriteLayout.NPC_SHEETS.filter(s => !s.role).map((s, i) => asSheet(s, `Citizen ${i + 1}`));
    const roleSheets = Object.fromEntries(SpriteLayout.NPC_SHEETS.filter(s => s.role).map(s => [s.role, asSheet(s, s.path.split('/').pop().replace(/_idle\.png$/, ''))]));
    const hex = n => '#' + n.toString(16).padStart(6, '0');
    const rows = [];
    for (const [zone, p] of Object.entries(NPC.PROFILES)) {
      const counts = {};
      for (const r of p.roles) counts[r] = (counts[r] || 0) + 1;
      for (const [role, n] of Object.entries(counts)) {
        const prop = PROPOSALS[`${zone}:${role}`] || { art: [] };
        rows.push({ id: `${zone}:${role}`, status: 'game', label: NPC.LABELS[zone][role], zone, role, share: n / p.roles.length, tints: p.colors, current: currentSheets, art: prop.art, alts: prop.alts || [], does: DOES[role], note: prop.note || '' });
      }
    }
    // Story neighbours wear a village identity at their role's art scale; a
    // role with its own sheet keeps it and has nothing to propose.
    const village = NPC.PROFILES.village;
    for (const [role, row] of Object.entries(NPC.STORY_ROLES || {})) {
      const own = roleSheets[role];
      const prop = PROPOSALS[`trailer:${role}`] || { art: [], note: own ? 'Already has its own art.' : '' };
      const k = row.artScale || 1;
      const scaled = list => list.map(a => ({ ...a, scale: a.scale * k, child: k < 1 }));
      const name = row.name || NAME_PROPOSALS[role];
      rows.push({ id: `trailer:${role}`, status: 'game', named: !!name, label: name || row.label, zone: 'trailer',
        role: `${row.label}${name && !row.name ? ' · proposed name' : ''} · from ${row.minMemories} memories`, share: null, does: DOES[role],
        look: own ? 'Bald, white moustache, green vest (PixelSerial Old Man).' : prop.look,
        ownArt: !!own, tints: own ? [] : village.colors, current: own ? [own] : scaled(currentSheets), art: prop.childArt ? prop.art : scaled(prop.art), alts: prop.childArt ? (prop.alts || []) : scaled(prop.alts || []), note: prop.note || '' });
    }
    // The neighbour the Hood saves from a goblin archer (StoryEncounters):
    // today a random village identity, so their name and look vary by save.
    rows.push({ id: 'story:hunted', status: 'game', named: true, label: 'Jory', zone: 'home', role: 'Hunted neighbour · proposed name · after the sixth rebuilt home', share: null,
      tints: village.colors, current: currentSheets, art: [srw(1, 'SRW #1 headband')], alts: [srw(5, 'SRW #5 pink hair'), srw(10, 'SRW #10 blonde')],
      look: 'Orange hair, blue headband.', does: 'Appears after the sixth rebuilt home, hunted by a goblin archer. Asks for help; once the archer falls, thanks you with a starfruit seed.',
      note: 'Young and scrappy enough to have been running from an archer. A fixed look makes the rescue recognisable later.' });
    const shrine = NPC.PROFILES.shrine;
    for (const g of GROVE) rows.push({ id: `grove:${g.role}`, status: 'planned', label: g.label, zone: 'grove', role: `${g.role} · proposed grove variant of the shrine zone`, share: null,
      tints: shrine.colors, current: currentSheets, art: g.art, alts: g.alts, look: g.look, does: DOES[g.role], note: 'Groves spawn shrine neighbours today; this splits them out as fox people.' });
    for (const p of PLANNED) rows.push({ id: 'story:' + p.label, status: 'planned', named: !!p.named, label: p.label, zone: p.zone, role: p.blurb, share: null, tints: [], current: [], art: p.art, alts: p.alts || [], look: p.look, does: p.does, note: p.note });

    // Who holds each source sheet: picks first, then reservations.
    const owners = new Map();
    for (const r of rows) for (const a of r.art) owners.set(keyOf(a), [...(owners.get(keyOf(a)) || []), r]);
    const nameOf = r => r.named || r.status === 'planned' || r.zone === 'trailer' ? r.label : `${r.label} (${r.zone})`;
    // Named characters first: their art is theirs alone.
    rows.sort((a, b) => (b.named ? 1 : 0) - (a.named ? 1 : 0));
    for (const r of rows) {
      r.clashes = [...new Set(r.art.flatMap(a => [
        ...(owners.get(keyOf(a)) || []).filter(o => o.label !== r.label).map(nameOf),
        ...(RESERVED.has(keyOf(a)) ? [`${RESERVED.get(keyOf(a))} (reserved)`] : []),
      ]))];
      // One role, one look: the same label in another zone must use the same picks.
      const look = r.art.map(keyOf).sort().join();
      r.differs = rows.filter(o => o !== r && o.label === r.label && o.art.map(keyOf).sort().join() !== look).map(o => o.zone);
      r.alts = r.alts.map(a => {
        const taken = [...new Set((owners.get(keyOf(a)) || []).map(o => o.label))],
          held = [...taken, ...(RESERVED.has(keyOf(a)) ? [RESERVED.get(keyOf(a))] : [])];
        return held.length ? { ...a, label: `${a.label} · used by ${held.join(', ')}` } : a;
      });
    }

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
    // Citizen palette draft (npc-recolour.js): measured once from the citizen sheets.
    const paletteRef = Promise.all(SpriteLayout.NPC_SHEETS.filter(s => !s.role).map(s => load('../' + s.path)))
      .then(ims => NpcRecolour.reference(ims.filter(Boolean)));
    async function draw(sheet, { rowsToShow = 1, tint = null, zoom }) {
      const im = await load(sheet.src);
      const fig = document.createElement('figure');
      if (!im) { fig.innerHTML = `<span class="missing">Missing in unused_art</span><figcaption>${esc(sheet.label)}</figcaption>`; return fig; }
      const src = document.createElement('canvas'); src.width = sheet.fw * rowsToShow; src.height = sheet.fh;
      const sx = src.getContext('2d');
      for (let r = 0; r < rowsToShow; r++) sx.drawImage(im, (sheet.ox || 0) + sheet.col * sheet.fw, (sheet.oy || 0) + r * sheet.fh, sheet.fw, sheet.fh, r * sheet.fw, 0, sheet.fw, sheet.fh);
      let px = sx.getImageData(0, 0, src.width, src.height);
      if (sheet.recolour === 'violet') recolourViolet(px.data);
      if ($('palette').value === 'citizen' && sheet.pack !== 'citizen') {
        sx.putImageData(px, 0, 0); NpcRecolour.apply(src, await paletteRef); px = sx.getImageData(0, 0, src.width, src.height);
      }
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
    $('summary').innerHTML = [[inGame.length, 'roles in game'], [rows.filter(r => (r.art.length || r.ownArt) && !r.clashes.length && !r.differs.length).length + ' / ' + rows.length, 'roles with their own look'], [currentSheets.length + Object.keys(roleSheets).length, 'sheets in use'], [new Set(rows.flatMap(r => r.art.map(keyOf))).size, 'proposed sheets'], [rows.filter(r => r.named).length, 'named characters']]
      .map(([n, label]) => `<div class="metric"><strong>${n}</strong>${label}</div>`).join('');

    let selected = rows[0]?.id;
    const zoom = () => Number($('zoom').value);
    // Appearance from the row's own description, else the proposed pick's label.
    const about = r => {
      const look = r.look || r.art.map(a => a.label).join(', ');
      return `${look ? `<b>Looks:</b> ${esc(look)}` : ''}${r.does ? `<br><b>Does:</b> ${esc(r.does)}` : ''}`;
    };
    async function render() {
      const q = $('search').value.trim().toLowerCase(), zone = $('zone').value, status = $('status').value;
      const shown = rows.filter(r => (zone === 'all' || r.zone === zone) && (status === 'all' || (status === 'named' ? r.named : r.status === status))
        && (!q || [r.label, r.zone, r.role, ...r.art.map(a => a.label + ' ' + PACKS[a.pack].name)].join(' ').toLowerCase().includes(q)));
      $('count').textContent = `${shown.length} of ${rows.length} rows`;
      if (shown.length && !shown.some(r => r.id === selected)) selected = shown[0].id;
      $('rows').innerHTML = shown.length ? shown.map(r => `<tr data-id="${esc(r.id)}" tabindex="0" class="${r.id === selected ? 'selected' : ''}">
        <td class="role"><b>${esc(r.label)}</b><span class="kind">${esc(r.role)}</span><br>${r.named ? '<span class="tag keep">Named</span>' : ''}${r.status === 'planned' ? '<span class="tag planned">Planned</span>' : ''}</td>
        <td>${esc(r.zone)}${r.tints.length ? '<br>' + r.tints.map(t => `<span class="swatch" style="background:${hex(t)}" title="Tint ${hex(t)}"></span>`).join('') : ''}</td>
        <td data-sort-value="${r.share ?? ''}">${r.share == null ? '—' : Math.round(r.share * 100) + '%'}</td>
        <td><div class="sprites" data-current></div></td>
        <td><div class="sprites" data-proposed></div>${r.clashes.length ? `<span class="tag warn">Shared with ${esc(r.clashes.join(', '))}</span>` : ''}${r.differs.length ? `<span class="tag warn">Looks different in ${esc(r.differs.join(', '))}</span>` : ''}${r.alts.length ? `<span class="tag">${r.alts.length} alternative${r.alts.length > 1 ? 's' : ''}</span>` : ''}</td>
        <td class="about">${about(r)}</td>
        <td>${[...new Set(r.art.map(a => PACKS[a.pack].name))].map(esc).join('<br>') || `<span class="muted">${r.ownArt ? 'In game' : 'No proposal'}</span>`}</td></tr>`).join('')
        : '<tr><td colspan="7" class="empty">No NPCs match these filters.</td></tr>';
      SortableTables.refresh($('rows').closest('table'));
      await Promise.all([...$('rows').rows].filter(tr => tr.dataset.id).map(tr => {
        const r = rows.find(x => x.id === tr.dataset.id);
        return Promise.all([
          r.current.length ? fill(tr.querySelector('[data-current]'), r.current, s => ({ zoom: zoom(), tint: s.fixedTint ?? r.tints[r.current.indexOf(s) % r.tints.length] ?? null })) : (tr.querySelector('[data-current]').innerHTML = '<span class="muted">Not in game</span>'),
          r.art.length ? fill(tr.querySelector('[data-proposed]'), r.art, { zoom: zoom() }) : (tr.querySelector('[data-proposed]').innerHTML = `<span class="muted">${r.ownArt ? 'Keeps own art' : 'No match in the pool'}</span>`),
        ]);
      }));
      detail();
    }
    async function detail() {
      const r = rows.find(x => x.id === selected);
      if (!r) { $('detail').innerHTML = '<h2>No selection</h2><p>Select a row to compare its art.</p>'; return; }
      $('detail').innerHTML = `<div class="eyebrow">${esc(r.zone)}${r.named ? ' · named' : ''}${r.status === 'planned' ? ' · planned' : ''}</div><h2>${esc(r.label)}</h2><p class="note">${esc(r.role)}</p><p class="note">${about(r)}</p>
        ${r.current.length ? '<h3>Current, untinted and in each zone tint</h3><div class="sprites" id="dCur"></div>' : ''}
        <h3>Proposed, sheet rows 0–3</h3>${r.clashes.length ? `<p class="warn">Shared with ${esc(r.clashes.join(', '))}</p>` : ''}${r.differs.length ? `<p class="warn">Looks different in ${esc(r.differs.join(', '))}</p>` : ''}<div class="sprites" id="dProp"></div>
        ${r.alts.length ? '<h3>Alternatives</h3><div class="sprites" id="dAlt"></div>' : ''}
        ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}`;
      const z = Math.min(zoom(), 3);
      if (r.current.length) {
        const variants = [...r.current.map(s => ({ ...s, label: s.label + ' (untinted)' })), ...r.tints.map((t, i) => ({ ...r.current[i % r.current.length], label: `Tint ${hex(t)}`, tint: t }))];
        await fill($('dCur'), variants, s => ({ zoom: z, rowsToShow: 4, tint: s.tint ?? null }));
      }
      if (r.art.length) await fill($('dProp'), r.art, { zoom: z, rowsToShow: 4 }); else $('dProp').innerHTML = `<span class="muted">${r.ownArt ? 'Keeps own art' : 'No match in the pool'}</span>`;
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
