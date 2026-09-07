// THE DIAMOND IS THE FROST JEWEL.
//
// The gem ladder was sapphire 4 / ruby 5 / emerald 6 with nothing at the top:
// the Frost (T7) mineralrock rolled a T6 emerald or a T5 ruby, and a T7 ring
// was cut around 32 rubies like a bigger T6. The diamond fills the rung —
// mined from the T7 rock as its headline gem, and what every T7 piece of
// jewelry (ring / staff / amulet) is cut around instead of the slot's own gem.
//
// Registering it also surfaced that the three older gem rows pointed at the
// wrong stones: Gemstones.png row 0 runs cyan diamond, red ruby, purple shard,
// blue sapphire, orange topaz, green emerald, pink quartz (frames 0..6 —
// checked against the decoded pixels: frame 0's body is rgb(0,205,249),
// frame 1's rgb(235,38,46), frame 3's rgb(0,146,221), frame 5's
// rgb(126,196,51)), and the rows read ruby 0 / emerald 3 / sapphire 4. The
// diamond wanting frame 0 is what made the collision visible, so the four
// frames are pinned together here.

(function () {
const app = APP_JS_SRC;
const inter = INTERACTABLES_SRC;

// ── Registry ────────────────────────────────────────────────────────────────
test('diamond: is the T7 mineral at the top of the gem ladder, with a price and an effect line', () => {
  const it = ITEM_BY_ID.diamond;
  assert.truthy(it, 'diamond is registered');
  assert.eq(it.name, 'Diamond', 'display name');
  assert.eq(it.kind, 'mineral', 'kind — the rarity class the rocks and chests draw from');
  assert.eq(it.baseTier, 7, 'baseTier — Frost');
  assert.eq(BASE_TIER.diamond, 7, 'BASE_TIER row');
  assert.eq(BASE_TIER.sapphire, 4, 'the ladder below it: sapphire 4');
  assert.eq(BASE_TIER.ruby, 5, 'ruby 5');
  assert.eq(BASE_TIER.emerald, 6, 'emerald 6');
  assert.truthy(PRICES.diamond > PRICES.emerald, 'worth more than the emerald below it');
  assert.truthy(PRICES.diamond > PRICES.platinum_bar, 'worth more than a platinum bar');
  assert.truthy(PRICES.diamond < PRICES.crimson_bar, 'but a smelted crimson bar still out-prices it');
  assert.truthy(/frost/i.test(ITEM_EFFECTS.diamond || ''), 'ITEM_EFFECTS names it the Frost jewel');
  assert.truthy(!('icon' in it), 'no emoji icon field — it renders as its sprite everywhere');
  // Where it comes from and what it is for live on the item line, not in a
  // Book tip (a tip that restates a description is a wasted read).
  assert.truthy(/ore/i.test(ITEM_EFFECTS.diamond) && /jewel/i.test(ITEM_EFFECTS.diamond), 'the line says where and what for');
  assert.falsy(PLAY_TIPS.some(t => /\bDiamonds?\b/.test(t)), 'no Book tip restates it');
});

test('diamond: two-table icon rule — MINERAL_ICON_SHEET → ICON_SHEETS → the real 112×64 gem sheet', () => {
  const src = MINERAL_ICON_SHEET.diamond;
  assert.truthy(src, 'MINERAL_ICON_SHEET.diamond');
  assert.eq(src.sheet, 'gems', 'on the shared gem sheet');
  assert.eq(src.frame, 0, 'frame 0 — the cut cyan-white diamond at the head of row 0');
  const row = app.match(new RegExp(`\\n  ${src.sheet}:\\s*\\{ url: '([^']+)',\\s*cols: (\\d+),\\s*srcW: (\\d+),\\s*srcH: (\\d+)\\s*\\}`));
  assert.truthy(row, `ICON_SHEETS has a '${src.sheet}' row (else the icon falls through to Crops.png)`);
  const cols = Number(row[2]), srcW = Number(row[3]), srcH = Number(row[4]);
  const dims = pngDims(row[1]);
  assert.truthy(dims, `${row[1]} exists and is a PNG`);
  assert.eq(dims.w, srcW, 'srcW matches the file');
  assert.eq(dims.h, srcH, 'srcH matches the file');
  assert.eq(srcW / cols, 16, '16px columns');
  const frames = cols * (srcH / 16);
  assert.truthy(src.frame >= 0 && src.frame < frames, `frame ${src.frame} is inside the ${frames}-frame sheet`);
  // inventoryIconSource is the lookup every surface goes through.
  const via = inventoryIconSource('diamond');
  assert.truthy(via && via.sheet === 'gems' && via.frame === 0, 'inventoryIconSource resolves the same row');
});

test('diamond: the four gems are four DIFFERENT stones on row 0 of the sheet', () => {
  // Row 0 order (pixel-verified, see the header): 0 diamond, 1 ruby, 3
  // sapphire, 5 emerald. Frames 2 / 4 / 6 are a purple shard, an orange
  // topaz and a pink quartz — no item wears those.
  const expect = { diamond: 0, ruby: 1, sapphire: 3, emerald: 5 };
  const cols = 7;
  const seen = new Set();
  for (const [id, frame] of Object.entries(expect)) {
    const src = MINERAL_ICON_SHEET[id];
    assert.eq(src.sheet, 'gems', `${id} on the gem sheet`);
    assert.eq(src.frame, frame, `${id} is frame ${frame}`);
    assert.truthy(src.frame < cols, `${id} is on row 0 (the plain stones, not an outlined or mask duplicate)`);
    assert.truthy(!seen.has(src.frame), `${id} does not share a frame with another gem`);
    seen.add(src.frame);
  }
});

// ── Drop source ─────────────────────────────────────────────────────────────
test('diamond: the T7 mineralrock lists the diamond FIRST — it is the Frost rock\'s headline gem', () => {
  const m = inter.match(/const GEM_BY_TIER = \{([^}]*)\};/);
  assert.truthy(m, 'GEM_BY_TIER exists in the mineralrock handler');
  const table = m[1];
  const t7 = table.match(/7:\s*\[([^\]]*)\]/);
  assert.truthy(t7, 'a tier-7 row');
  const gems = t7[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.eq(gems[0], 'diamond', 'diamond is the primary (first) entry');
  assert.truthy(gems.includes('emerald'), 'the emerald stays as its secondary');
  for (const g of gems) assert.truthy(ITEM_BY_ID[g] && ITEM_BY_ID[g].kind === 'mineral', `${g} is a real mineral`);
  // The rungs below are untouched — one gem each, in ladder order.
  assert.truthy(/4:\s*\['sapphire'\]/.test(table), 'T4 → sapphire');
  assert.truthy(/5:\s*\['ruby'\]/.test(table), 'T5 → ruby');
  assert.truthy(/6:\s*\['emerald'\]/.test(table), 'T6 → emerald');
  // …and the roll really reads the list (pickFromArray), so "first" is a
  // real primary only because the list is what gets rolled.
  assert.truthy(/const gemId = pickFromArray\(gems\);/.test(inter), 'the drop rolls GEM_BY_TIER[t]');
});

// ── Gear ────────────────────────────────────────────────────────────────────
test('diamond: every T7 jewelry recipe is cut around diamonds — the ramp and the bar unchanged', () => {
  for (const slot of ['ring', 'staff', 'amulet']) {
    const r = Gear.blacksmithRecipe('relic', slot, 7);
    assert.truthy(Array.isArray(r) && r.length === 2, `${slot} T7 has a gem line and a bar line`);
    assert.eq(r[0].id, 'diamond', `${slot} T7 wants diamonds`);
    assert.eq(r[0].qty, 32, `${slot} T7 keeps the 2^(7-2) quantity`);
    assert.eq(r[1].id, 'frost_bar', `${slot} T7 plus one frost bar`);
    assert.eq(r[1].qty, 1, 'one bar');
    // Every ingredient resolves in the catalogue — the smithy modal names
    // them through ITEM_BY_ID and renders them through the icon tables.
    for (const line of r) {
      assert.truthy(ITEM_BY_ID[line.id], `${line.id} is a real item`);
      assert.truthy(inventoryIconSource(line.id), `${line.id} has an icon source`);
    }
  }
  // Below T7 each slot keeps its own gem — the diamond is the Frost rung only.
  const own = { ring: 'ruby', staff: 'emerald', amulet: 'sapphire' };
  for (const [slot, gem] of Object.entries(own)) {
    for (let t = 2; t <= 6; t++) {
      const r = Gear.blacksmithRecipe('relic', slot, t);
      assert.eq(r[0].id, gem, `${slot} T${t} still wants ${gem}`);
      assert.eq(r[0].qty, Math.pow(2, t - 2), `${slot} T${t} ramp`);
    }
  }
  // Tools never ask for a gem.
  const pick = Gear.blacksmithRecipe('relic', 'pick', 7);
  assert.eq(JSON.stringify(pick), JSON.stringify([{ id: 'frost_bar', qty: 7 }]), 'a T7 pick is bars only');
});

// ── Deliveries ──────────────────────────────────────────────────────────────
test('diamond: sits in the mining wishlist pool, in ladder order beside the frost bar', () => {
  const pool = Delivery.BUNDLE_THEMES.mining;
  const i = pool.indexOf('diamond');
  assert.truthy(i > 0, 'diamond is in the mining pool');
  assert.truthy(i > pool.indexOf('emerald'), 'after the emerald');
  assert.truthy(i > pool.indexOf('crimson_bar'), 'after the T6 bar');
  assert.eq(pool[i + 1], 'frost_bar', 'immediately before the frost bar — gem then bar, per tier');
  assert.eq(Delivery.produceTier('diamond'), 7, 'the pool reads its tier from the catalogue');
});

// ── Rarity ──────────────────────────────────────────────────────────────────
test('diamond: the rarity picker can hand one out of a mineral-heavy cave chest', () => {
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // T5 is the cave chest (chestTierMod's top row): its chain reaches T5 on
  // its own and its maxTier is 7, so only a jackpot climbs the last two
  // rungs — rare by design, which is why the seed count is generous.
  let seen = 0;
  for (let s = 1; s <= 6000; s++) {
    const r = pickReward('chest:health', { relics: {}, armor: {} }, seeded(s), { tier: 5 });
    if (r && r.kind === 'item' && r.id === 'diamond') {
      seen++;
      assert.eq(r.tier, 7, 'rolled as a T7 item');
      assert.eq(r.cls, 'mineral', 'from the mineral class');
      assert.truthy(r.qty >= 1, 'at least one');
    }
  }
  assert.truthy(seen > 0, 'diamond rolled at least once in 6000 T5 health chests');
});
})();
