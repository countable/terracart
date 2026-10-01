// Headless tests for the gear core (src/gear.js) — equip rules, the relic/armor
// offer roll, and the forge/smelt recipes extracted from app.js.

// Deterministic PRNG for the offer roll.
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('equip: a relic just sets its slot to the tier', () => {
  const save = { relics: {}, armor: {}, energy: 50, maxEnergy: 100 };
  Gear.equip(save, 'relic', 'pick', 3);
  assert.eq(save.relics.pick.tier, 3);
  assert.eq(save.energy, 50, 'relics don’t touch energy');
});

test('equip: armor fills its slot and never touches the energy bar', () => {
  // It used to raise the max-energy CAP and grant the freshly-unlocked
  // headroom as a delta. Armour soaks damage now — read live off save.armor
  // when a blow lands — so equipping banks nothing at all.
  const save = { relics: {}, armor: {}, energy: 40, maxEnergy: 100 };
  Gear.equip(save, 'armor', 'helmet', 3);
  assert.eq(save.armor.helmet.tier, 3, 'the slot is filled');
  assert.eq(save.energy, 40, 'no headroom granted');
  assert.eq(Energy.maxEnergy(save), 100, 'and no cap raised');
});

test('equip: a SECOND armor piece adds its own soak, and still no energy', () => {
  const save = { relics: {}, armor: {}, energy: 5, maxEnergy: 100 };
  Gear.equip(save, 'armor', 'helmet', 3);
  const afterHelmet = armorReduction(save.armor);
  Gear.equip(save, 'armor', 'boots', 2);
  assert.eq(afterHelmet, 3, 'a T3 helmet soaks 3 — one per tier');
  assert.eq(armorReduction(save.armor), 3 + 2, 'boots add their own tier on top');
  assert.eq(save.energy, 5, 'the bar is exactly where it was');
});

test('equip: a weapon relic (sword/bow/staff) becomes the active weapon', () => {
  // Only one weapon fights at a time (combat.js) — the newest one obtained or
  // upgraded wins by default (app.js WEAPON_SLOTS / Gear.WEAPON_SLOTS).
  const save = { relics: {}, armor: {} };
  Gear.equip(save, 'relic', 'sword', 1);
  assert.eq(save.activeWeapon, 'sword', 'first weapon obtained becomes active');
  Gear.equip(save, 'relic', 'bow', 1);
  assert.eq(save.activeWeapon, 'bow', 'a later weapon obtained switches to it');
  Gear.equip(save, 'relic', 'sword', 4);
  assert.eq(save.activeWeapon, 'sword', 'upgrading an owned weapon re-activates it');
});

test('equip: a non-weapon relic never touches activeWeapon', () => {
  const save = { relics: {}, armor: {}, activeWeapon: 'bow' };
  Gear.equip(save, 'relic', 'pick', 3);
  Gear.equip(save, 'armor', 'helmet', 2);
  assert.eq(save.activeWeapon, 'bow', 'gathering tools and armor are not weapons');
});

test('buildRelicOffer: returns a usable upgrade with a positive price', () => {
  const save = { relics: {}, armor: {} };
  const offer = Gear.buildRelicOffer(save, seeded(1));
  assert.truthy(offer, 'an offer exists when slots are empty');
  assert.truthy(offer.kind === 'relic' || offer.kind === 'armor');
  assert.gt(offer.tier, 0);
  assert.gt(offer.price, 0, 'priced');
});

test('buildRelicOffer: never offers a tier ≤ what the player already owns', () => {
  // Max everything out → no upgrade possible → null.
  const maxed = { relics: {}, armor: {} };
  for (const slot of Object.keys(RELIC_DEFS)) maxed.relics[slot] = { tier: 7 };
  for (const slot of Object.keys(ARMOR_DEFS)) maxed.armor[slot] = { tier: 7 };
  assert.eq(Gear.buildRelicOffer(maxed, seeded(2)), null, 'fully maxed → no offer');
  // A T5 pick → any pick offer must be T6+.
  const save = { relics: { pick: { tier: 5 } }, armor: {} };
  for (let s = 1; s <= 40; s++) {
    const o = Gear.buildRelicOffer(save, seeded(s));
    if (o && o.kind === 'relic' && o.slot === 'pick') assert.gt(o.tier, 5, 'pick offer beats the owned T5');
  }
});

test('buildRelicOffer: deterministic for a fixed seed', () => {
  const save = () => ({ relics: {}, armor: {} });
  const a = Gear.buildRelicOffer(save(), seeded(42));
  const b = Gear.buildRelicOffer(save(), seeded(42));
  assert.eq(JSON.stringify(a), JSON.stringify(b));
});

test('buildRelicOffer: castle pricing collapses toward par as Bow tier climbs', () => {
  const base = { relics: {}, armor: {} };
  const bowed = { relics: { bow: { tier: 7 } }, armor: {} };
  // Compare the SAME pick by using a seed that lands on a non-bow slot, summed
  // over many seeds: mean castle price with a T7 bow should be < without.
  let sumBase = 0, sumBow = 0, n = 0;
  for (let s = 1; s <= 200; s++) {
    const o1 = Gear.buildRelicOffer(base, seeded(s), { isCastle: true });
    const o2 = Gear.buildRelicOffer(bowed, seeded(s), { isCastle: true });
    if (o1 && o2 && o1.slot === o2.slot && o1.tier === o2.tier && o1.slot !== 'bow') {
      sumBase += o1.price; sumBow += o2.price; n++;
    }
  }
  assert.gt(n, 0, 'had comparable offers');
  assert.lt(sumBow, sumBase, 'a maxed Bow discounts castle prices');
});

test('blacksmithRecipe: tools use the tier bar (≥5), jewelry uses gems+bar', () => {
  assert.eq(Gear.blacksmithRecipe('relic', 'pick', 0), null, 'tier 0 → no recipe');
  const wood = Gear.blacksmithRecipe('relic', 'pick', 1);
  assert.eq(JSON.stringify(wood), JSON.stringify([{ id: 'wood', qty: 5 }]), 'T1 pick = 5 wood');
  const iron = Gear.blacksmithRecipe('relic', 'pick', 3);
  assert.eq(JSON.stringify(iron), JSON.stringify([{ id: 'iron_bar', qty: 5 }]), 'T3 pick = 5 iron');
  assert.eq(Gear.blacksmithRecipe('relic', 'ring', 1), null, 'no wooden jewelry');
  const ringT3 = Gear.blacksmithRecipe('relic', 'ring', 3);
  assert.eq(ringT3[0].id, 'ruby', 'ring uses rubies');
  assert.eq(ringT3[0].qty, 2, 'geometric ramp: 2^(3-2)=2');
  assert.eq(ringT3[1].id, 'iron_bar', 'plus the tier bar');
  // Below the Frost tier every slot keeps its own gem, up to 16 at T6.
  const staffT6 = Gear.blacksmithRecipe('relic', 'staff', 6);
  assert.eq(staffT6[0].id, 'emerald', 'T6 staff still wants emeralds');
  assert.eq(staffT6[0].qty, 16, '2^(6-2)=16');
  // At T7 every jewelry slot is cut around diamonds instead — same quantity.
  for (const slot of ['ring', 'staff', 'amulet']) {
    const t7 = Gear.blacksmithRecipe('relic', slot, 7);
    assert.eq(t7[0].id, 'diamond', `T7 ${slot} wants diamonds`);
    assert.eq(t7[0].qty, 32, '2^(7-2)=32 — the ramp is unchanged');
    assert.eq(t7[1].id, 'frost_bar', 'plus the frost bar');
  }
});

test('smeltingRecipe + smeltUnlockedBars: T5+ bars, always available', () => {
  assert.eq(Gear.smeltingRecipe('iron_bar'), null, 'mined bars aren’t smeltable');
  assert.truthy(Gear.smeltingRecipe('frost_bar'), 'frost is smeltable');
  // The crafting shrine was removed — smelting is always available at the
  // blacksmith, so all three T5+ bars are unlocked with no shrine-level gate.
  assert.eq(
    JSON.stringify(Gear.smeltUnlockedBars()),
    JSON.stringify(['platinum_bar', 'crimson_bar', 'frost_bar']),
    'all three T5+ bars unlocked',
  );
});

test('blacksmith offers: the next rung per slot, every tier past it divided down, no relic/armour split', () => {
  assert.eq(Gear.SMITHY_NEXT_RUNG_BIAS, 4, 'each rung skipped quarters the odds');
  // Pick at Iron (3), axe bare, helmet at Copper (2), the rest bare.
  const save={relics:{pick:{tier:3},staff:{tier:1},amulet:{tier:1}},armor:{helmet:{tier:2}}};
  const W=Gear.relicOfferWeights(save,{isBlacksmith:true});
  const w=(kind,slot,tier)=>W.find(x=>x.c.kind===kind&&x.c.slot===slot&&x.c.tier===tier)?.w;
  assert.eq(w('relic','axe',1),1,'a bare tool slot: a wooden axe is the next rung at full weight');
  assert.eq(w('armor','boots',1),1,'a bare armour slot the same — no kind split at the smith');
  assert.eq(w('relic','pick',4),1/8,'the kitted pick\'s next rung carries only the low-tier curve');
  assert.eq(w('armor','helmet',3),1/4,'the Copper helmet\'s next rung likewise');
  assert.eq(w('relic','axe',2),1/2/4,'a wooden-slot Copper axe is one rung skipped: curve / 4');
  assert.eq(w('relic','axe',3),1/4/16,'two skipped: / 16');
  assert.eq(w('relic','staff',2),1/2,'a wooden staff\'s next FORGEABLE rung is Copper (no wooden jewellery): rank 0');
  assert.eq(w('relic','staff',3),1/4/4,'and Iron is one past it');
  assert.truthy(w('relic','axe',1)>w('relic','pick',4)&&w('armor','boots',1)>w('relic','pick',4),
    'missing wood pieces outweigh a finer upgrade for a kitted slot');
  // Every tier stays in the pool: bias, not a cut.
  assert.eq([...new Set(W.filter(x=>x.c.slot==='axe').map(x=>x.c.tier))].join(','),'1,2,3,4,5,6,7');
  assert.falsy(W.find(x=>x.c.slot==='ring'),'never the Ring');
  // The ordinary curve is untouched: a relic/armour split, no rank.
  const O=Gear.relicOfferWeights(save);
  const relicShare=O.filter(x=>x.c.kind==='relic').reduce((a,x)=>a+x.w,0);
  assert.inRange(relicShare,1-1e-9,1+1e-9,'relics normalised to one (armour the same): half the airtime each');
});

test('blacksmith offers: with wooden slots missing, the forge mostly offers them over finer metal', () => {
  // Tools all at Iron, armour all bare.
  const save={relics:{},armor:{}};
  for(const slot of Object.keys(RELIC_DEFS)) save.relics[slot]={tier:3};
  const n=4000; let wooden=0, finer=0;
  for(let i=1;i<=n;i++) {
    const o=Gear.buildRelicOffer(save,seeded(i),{isBlacksmith:true});
    if(o.kind==='armor'&&o.tier===1) wooden++;
    if(o.kind==='relic') finer++;
  }
  // Four bare armour slots at weight 1 each against ELEVEN kitted tool slots
  // (every relic but the Ring) at 1/8 and less: about two in three offers
  // are the missing wooden armour, and the draw matches the pool's weights.
  const W=Gear.relicOfferWeights(save,{isBlacksmith:true});
  const total=W.reduce((a,x)=>a+x.w,0);
  const expectWood=W.filter(x=>x.c.kind==='armor'&&x.c.tier===1).reduce((a,x)=>a+x.w,0)/total;
  assert.inRange(expectWood,.6,.7,'the pool gives the bare slots about two thirds');
  assert.inRange(wooden/n,expectWood-.03,expectWood+.03,'and the seeded draws follow it');
  assert.lt(finer/n,.4,'Gold tools for an Iron kit are the minority, eleven slots and all');
  // All at Wood: Copper, the next rung everywhere, dominates (and Iron+ still turns up).
  const wood={relics:{},armor:{}};
  for(const slot of Object.keys(RELIC_DEFS)) wood.relics[slot]={tier:1};
  for(const slot of Object.keys(ARMOR_DEFS)) wood.armor[slot]={tier:1};
  let copper=0; const seen=new Set();
  for(let i=1;i<=n;i++) { const o=Gear.buildRelicOffer(wood,seeded(i),{isBlacksmith:true}); if(o.tier===2) copper++; seen.add(o.tier); }
  assert.inRange(copper/n,.84,.92,'about seven in eight offers are Copper');
  assert.truthy(seen.has(3)&&seen.has(4),'Iron and Gold still come up');
});

// The anvil never "rests": a smithy offers only what it can forge. Wooden
// jewellery has no recipe (blacksmithRecipe), and a seeded offer of it used to
// shut the forge for the whole hour bucket.
test('blacksmith offers: never a piece the anvil cannot forge', () => {
  const save={relics:{},armor:{}};   // every slot bare: wooden jewellery is on the ordinary menu
  let ordinaryWooden=0;
  for(let i=1;i<=3000;i++) {
    const o=Gear.buildRelicOffer(save,seeded(i));
    if(o.kind==='relic'&&(o.slot==='staff'||o.slot==='amulet')&&o.tier===1) ordinaryWooden++;
    const smith=Gear.buildRelicOffer(save,seeded(i),{isBlacksmith:true});
    assert.truthy(Gear.blacksmithRecipe(smith.kind,smith.slot,smith.tier),
      `seed ${i}: the smith offers a forgeable ${smith.slot} T${smith.tier}`);
  }
  assert.gt(ordinaryWooden,0,'the ordinary roll does offer wooden jewellery (a cash shop can sell it)');
  // Still an offer while anything forgeable is left; null only when nothing is.
  const maxed={relics:{},armor:{}};
  for(const slot of Object.keys(RELIC_DEFS)) maxed.relics[slot]={tier:7};
  for(const slot of Object.keys(ARMOR_DEFS)) maxed.armor[slot]={tier:7};
  assert.eq(Gear.buildRelicOffer(maxed,seeded(1),{isBlacksmith:true}),null,'nothing left to forge');
});

test('blacksmith offers: hourly shop lookup passes the bias only for the smith role', () => {
  const start=SCENE_SRC.indexOf('\n  peekOrBuildRelicOffer('),end=SCENE_SRC.indexOf('\n  }\n',start);
  assert.truthy(start>0&&end>start);
  const method=new Function(`return {${SCENE_SRC.slice(start+1,end+4)}};`)().peekOrBuildRelicOffer;
  const rng=seeded(42), house={kind:'house',id:'smith_test',tier:9};
  for(const role of ['blacksmith','market','trader',null]) {
    const scene={houseShopRole:()=>role,shopRng:()=>rng,buildRelicOffer:(actual,opts)=>({actual,opts})};
    const result=method.call(scene,house);
    assert.eq(result.actual,rng,'keeps the existing hourly/reroll seed');
    assert.eq(result.opts.isBlacksmith,role==='blacksmith');
  }
});
