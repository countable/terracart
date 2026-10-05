/* global loadGame, Shrines, Macros, SpriteLayout, ASSETS, Combat, CONSUMABLE_SPEC,
          ZoneVariants, StreetVariants, shortDuration, BIKE_RACK_SPEED_MUL */
'use strict';
(async () => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const label = id => id.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  try {
    await loadGame();
    if (!Shrines.SHRINE_KINDS || !Shrines.REWARD_KINDS || !Macros.DAILY_VISIT_KINDS) throw new Error('The shrine or daily-visit definitions are missing. Reload after the game data has been updated.');
    const effect = row => {
      const effects = {
        pairy: () => 'Consumes the effects of one Pairy immediately, including its treasure compass.',
        light: () => 'Personal torch light.',
        reach: () => 'Full-screen reach and illumination.',
        shield: () => `Incoming damage ×${CONSUMABLE_SPEC.shield_potion.damageMul}, before armour.`,
        hidden: () => 'Monsters ignore you until attacked. Fauna and pets do not flee while being caught.',
        melee: () => `+${Combat.TRAINING_KINDS.melee.drill} melee damage and +${Combat.TRAINING_KINDS.ranged.drill} bow damage.`,
        fortune: () => `+${Math.round(Shrines.FORTUNE_LUCK_BONUS * 100)} percentage points of luck on treasure rolls.`,
        mining: () => 'Frost mining speed. Tool-tier access limits are unchanged.',
        work: () => `${Shrines.WORK_SPEED_MUL}× all work speed. Tool-tier access limits are unchanged.`,
        regen: () => `Regenerate ${Shrines.REGEN_PER_SECOND} HP per second.`,
        wand: () => `Virtual T${Shrines.WAND_TIER} wand; a stronger owned wand is preserved. Choose another weapon freely.`,
      };
      if (effects[row.lever]) return effects[row.lever]();
      if (row.reward === 'bike') return `${BIKE_RACK_SPEED_MUL}× walking speed.`;
      if (row.effect) return row.effect;
      if (row.reward === 'book') return 'Read one page of the Book.';
      if (row.reward === 'treasure') return 'Receive a sacred-grove treasure roll.';
      return row.effect || 'See game definition.';
    };
    const zoneName = id => ZoneVariants.byId(id)?.name || label(id);
    const streetName = id => StreetVariants.VARIANT_BY_ID[id]?.name || label(id);
    const rows = [
      ...Object.entries(Shrines.SHRINE_KINDS).map(([id, row]) => ({ ...row, id, group:'boon',
        sprites:[SpriteLayout.groveShrineArt({ shrineKind:id })],
        locations:[...(row.locations || []), ...(row.zones || []).map(id => `Zone: ${zoneName(id)}`), ...(row.streets || []).map(id => `Street/path: ${streetName(id)}`)] })),
      ...Object.entries(Shrines.REWARD_KINDS).map(([id, row]) => ({ ...row, id, group:'reward',
        sprites:row.sprite ? [{ key:row.sprite, frame:0, scale:1.6 }] : id === 'grove' ? SpriteLayout.GROVE_SHRINE_ART : [{ key:'waystone', frame:0, scale:1.6 }],
        locations:row.locations || (id === 'grove' ? ['Mapped parks and sacred groves without a named idol variant'] : ['Pilgrim street endpoints']) })),
      ...Object.entries(Macros.DAILY_VISIT_KINDS).filter(([, row]) => !Object.values(Shrines.REWARD_KINDS).includes(row)).map(([id, row]) => ({ ...row, id:`visit_${id}`, group:'daily',
        sprites:[typeof row.sprite === 'string' ? { key:row.sprite, frame:0, scale:1.6 } : row.sprite],
        locations:row.locations || [] })),
    ].map((row, order) => ({ ...row, order, effect:effect(row), duration:row.durationMs ? shortDuration(row.durationMs) : 'Immediate reward' }));
    const images = new Map();
    const frames = new Map();
    async function crop(spec) {
      if (!spec?.key || !ASSETS[spec.key]) throw new Error(`Missing map asset definition: ${spec?.key || 'daily visit sprite'}`);
      const asset = ASSETS[spec.key];
      if (!images.has(asset.path)) images.set(asset.path, new Promise((resolve, reject) => {
        const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Could not load ${asset.path}`)); img.src = '../' + asset.path;
      }));
      const img = await images.get(asset.path), w = asset.frameWidth || img.naturalWidth, h = asset.frameHeight || img.naturalHeight;
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const frame = spec.frame || 0, cols = img.naturalWidth / w;
      canvas.getContext('2d').drawImage(img, frame % cols * w, Math.floor(frame / cols) * h, w, h, 0, 0, w, h);
      return { src:canvas.toDataURL(), w, h, ...spec };
    }
    await Promise.all(rows.map(async row => frames.set(row.id, await Promise.all(row.sprites.map(crop)))));
    $('rules').innerHTML = `<p>Daily visits use the UTC-day ledger. Sites keep their ambient light after a visit; the extra availability pulse disappears when today’s reward is claimed. Idol boons refresh to the later expiry without stacking in strength. Paid companion offers follow their own price and duration. A painted story panel appears on each successful shrine or idol visit.</p><p>Each special street independently has a <b>${Math.round(Shrines.STREET_SHRINE_CHANCE * 100)}% shrine chance</b>, with no shared tile cap; scenic paths cap them at <b>${Shrines.SCENIC_SHRINES_PER_TILE} per tile</b>. Zone idols and mapped park shrines use their separate configured placements.</p>`;
    function sprites(row) {
      return frames.get(row.id).map(frame => {
        const scale = Number($('scale').value);
        return `<figure><img class="sprite" alt="${esc(frame.name || row.name)} map sprite" src="${frame.src}" style="width:${frame.w * scale}px;height:${frame.h * scale}px"><figcaption>${esc(frame.name || '')}<br>${frame.w} × ${frame.h} px</figcaption></figure>`;
      }).join('');
    }
    function draw() {
      const query = $('search').value.trim().toLowerCase(), group = $('kind').value;
      const shown = rows.filter(row => (group === 'all' || row.group === group) && [row.name,row.effect,row.body,...row.locations].join(' ').toLowerCase().includes(query));
      shown.sort((a,b) => $('sort').value === 'name' ? a.name.localeCompare(b.name) : $('sort').value === 'duration' ? (b.durationMs || 0) - (a.durationMs || 0) || a.name.localeCompare(b.name) : a.order - b.order);
      $('status').textContent = `${shown.length} of ${rows.length} sites · ${rows.filter(row => row.group === 'boon').length} idol boons, ${rows.filter(row => row.group === 'reward').length} shrine rewards, ${rows.filter(row => row.group === 'daily').length} other daily visits`;
      $('rows').innerHTML = shown.map(row => `<tr data-site="${esc(row.id)}"><td class="name"><b>${esc(row.name)}</b><br><span class="tag">${{boon:'Idol boon',reward:'Shrine reward',daily:'Daily visit'}[row.group]}</span><br><small>${esc(row.id)}</small></td><td><div class="sprites">${sprites(row)}</div></td><td><b>${esc(row.duration)}</b>${row.price != null ? `<div>${esc(row.price)} coins</div>` : ''}<p>${esc(row.effect)}</p><small>Once per UTC day</small></td><td class="locations">${row.locations.map(v => `<div>${esc(v)}</div>`).join('') || '<small>See owning game definition</small>'}</td><td><button class="painting" data-preview="${esc(row.id)}" aria-label="Preview ${esc(row.name)} story panel"><img src="../assets/art/${esc(row.art)}.webp" alt="${esc(row.name)} story painting" loading="lazy"></button><span class="artmissing">Painting not available</span></td><td class="copy">${esc(row.body)}</td></tr>`).join('');
      document.querySelectorAll('.painting img').forEach(img => { img.onerror = () => img.parentElement.classList.add('missing'); });
      document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => preview(rows.find(row => row.id === button.dataset.preview))));
    }
    function preview(row) {
      const path = `../assets/art/${row.art}.webp`;
      $('panel-title').textContent = row.name; $('panel-body').textContent = row.body;
      $('panel-art').src = path; $('panel-art').alt = row.name + ' story painting'; $('panel-art').hidden = false;
      $('panel-art').onerror = () => { $('panel-art').hidden = true; };
      $('full-art').href = path; $('preview').showModal();
    }
    ['search','kind','sort','scale'].forEach(id => $(id).addEventListener(id === 'search' ? 'input' : 'change', draw));
    $('reset').addEventListener('click', () => { $('search').value = ''; $('kind').value = 'all'; $('sort').value = 'order'; $('scale').value = '3'; draw(); });
    $('close').addEventListener('click', () => $('preview').close());
    $('preview').addEventListener('click', event => { if (event.target === $('preview')) $('preview').close(); });
    draw();
  } catch (error) {
    $('status').textContent = `Unable to load this sheet: ${error.message}. Serve the repository over HTTP and reload.`;
    $('status').classList.add('error'); console.error(error);
  }
})();
