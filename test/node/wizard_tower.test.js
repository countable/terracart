// The wizard tower's WIRING in app.js (the offers themselves are src/wizard.js,
// pinned for real in wizard.test.js). Until Sep 2026 the tower sold one strict
// ladder — Inner Light, Full Measure, Keen Eye — out of app.js's own
// wizardLadder, paid in Discovery badges from the bag. Now:
//
//   • presentWizardOffer ALWAYS shows Wizard.offers — two track cards, or the
//     four callings on the third purchase — each with its icon, what it
//     grants and its price in memories, greyed when the player is short.
//   • _buyWizardOffer re-validates through Wizard.buy and pays through the
//     scene's ONE memories writer (spendMemories, handed in as the `spend`
//     hook), equips the Keen Eye Ring, refreshes the energy cap for Vigour,
//     and opens the reward ceremony as kind 'wizard'.
//   • The calling reaches the mechanics: every player call of Combat.shotDamage
//     / meleeDps / meleeSwingDamage and Trail.bank / readout / goalFor carries
//     save.playerClass, and an Enchanter can CHANNEL a timed potion.
//
// app.js needs Phaser, so its methods are lifted out of APP_JS_SRC and run on
// a stub scene (the memory_story.test.js idiom); the rest is pinned as source.

(function () {
const app = APP_JS_SRC;

const lift = (sig, what) => {
  const start = app.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : app.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${what} in app.js`);
  return app.slice(start + 1, end + 4);
};

const PRESENT_SRC = lift('presentWizardOffer(sx, sy, recordDeal) {', 'presentWizardOffer');
const BUY_SRC = lift('_buyWizardOffer(key, sx, sy, recordDeal) {', '_buyWizardOffer');
const UNSPENT_SRC = lift('memoriesUnspent() {', 'memoriesUnspent');
const SPEND_SRC = lift('spendMemories(n) {', 'spendMemories');
const HELP_SRC = lift('showMemoriesHelp() {', 'showMemoriesHelp');
const MET_SRC = lift('_metWizard() {', '_metWizard');

// ── A just-enough DOM for the modal builder ───────────────────────────────
function fakeEl(tag) {
  const el = {
    tag, style: { cssText: '' }, dataset: {}, children: [], className: '',
    disabled: false, textContent: '', innerHTML: '', _on: {},
    appendChild(c) { el.children.push(c); return c; },
    addEventListener(ev, fn) { el._on[ev] = fn; },
    remove() { el.removed = true; },
    click() { el._on.click && el._on.click({ stopPropagation() {} }); },
  };
  return el;
}
const walk = (el, out = []) => { out.push(el); for (const c of el.children || []) walk(c, out); return out; };

function withDom(fn) {
  const real = globalThis.document.createElement;
  globalThis.document.createElement = fakeEl;
  try { return fn(); } finally { globalThis.document.createElement = real; }
}

function mkScene(save) {
  const methods = new Function('persistSave', 'UI_TREASURE', 'UI_CONTROL_DIM',
    `return class { ${PRESENT_SRC}\n${BUY_SRC}\n${UNSPENT_SRC}\n${SPEND_SRC}\n${HELP_SRC}\n${MET_SRC} }`);
  const s = new (methods((sv) => { s.persisted = (s.persisted || 0) + 1; }, '#treasure', '#gold'))();
  s.save = save;
  s.flashes = [];
  s.flash = (m) => s.flashes.push(m);
  s.iconSpanHTML = () => '';
  s.shells = [];
  s.makeModalShell = (id, opts) => {
    const wrap = fakeEl('div'), box = fakeEl('div');
    const shell = { id, opts, wrap, box, mounted: false };
    s.shells.push(shell);
    return { wrap, box, mount: () => { shell.mounted = true; },
             mkBtn: (label, primary, disabled) => Object.assign(fakeEl('button'), { innerHTML: label, disabled }) };
  };
  s.rewards = [];
  s.showChestRewardModal = (o) => s.rewards.push(o);
  s.equips = [];
  s._equipGear = (...a) => s.equips.push(a);
  s.chip = 0; s.updateMemoriesDOM = () => { s.chip++; };
  s.energyDOM = 0; s.updateEnergyDOM = () => { s.energyDOM++; };
  s.inv = 0; s.buildInventoryDOM = () => { s.inv++; };
  s.messages = [];
  s.showMessageModal = (o) => s.messages.push(o);
  return s;
}
const cardsOf = (shell) => walk(shell.box).filter((e) => e.className === 'wizard-choice');

// ── The modal ─────────────────────────────────────────────────────────────
test('wizard tower: the modal shows Wizard.offers as priced, greyable cards (kind wizard)', () => {
  const save = { memories: 7, relicSalt: 42, relics: {} };
  const s = mkScene(save);
  withDom(() => s.presentWizardOffer(0, 0, () => {}));
  assert.eq(s.shells.length, 1, 'one dialog');
  const sh = s.shells[0];
  assert.eq(sh.opts.kind, 'wizard', 'declares the wizard kind');
  assert.truthy(/const MODAL_KINDS = \{[\s\S]*?\n  wizard:/.test(MODAL_SHELL_SRC), 'which is a MODAL_KINDS row');
  assert.truthy(sh.mounted, 'mounted');
  const texts = walk(sh.box).map((e) => e.textContent + '|' + e.innerHTML).join('\n');
  assert.truthy(texts.includes(Wizard.INTRO), 'the wizard speaks of memories');
  assert.truthy(/7 unspent memories/.test(texts), 'and the player sees what they hold');
  const offers = Wizard.offers(save);
  const cards = cardsOf(sh);
  assert.eq(cards.map((c) => c.dataset.key).join(), offers.map((o) => o.key).join(), 'one card per offer, in order');
  assert.eq(cards.length, 2, 'two tracks a visit');
  for (let i = 0; i < cards.length; i++) {
    const o = offers[i], c = cards[i];
    assert.truthy(c.innerHTML.includes(o.icon), `${o.key}: its icon`);
    assert.truthy(c.innerHTML.includes(o.name), `${o.key}: what it grants`);
    assert.truthy(new RegExp(`\\s${o.cost}</div>$`).test(c.innerHTML), `${o.key}: its price`);
    assert.eq(c.disabled, !o.canAfford, `${o.key}: greyed exactly when unaffordable`);
  }
  assert.truthy(/grid-template-columns:1fr 1fr/.test(walk(sh.box).find((e) => e.className === 'wizard-choices').style.cssText),
    'side by side');
});

test('wizard tower: on the third purchase the table is the four callings', () => {
  const save = { memories: 1, relicSalt: 1, relics: {}, wizardBuys: 2 };
  const s = mkScene(save);
  withDom(() => s.presentWizardOffer(0, 0, () => {}));
  const cards = cardsOf(s.shells[0]);
  assert.eq(cards.map((c) => c.dataset.key).join(), Wizard.CLASSES.map((c) => c.key).join(), 'all four');
  for (const c of cards) assert.truthy(c.disabled, 'one memory buys no calling');
  const texts = walk(s.shells[0].box).map((e) => e.textContent).join('\n');
  assert.truthy(/calling/.test(texts), 'the ask names the choice');
});

test('wizard tower: nothing left → a short flash, no dialog', () => {
  const save = { memories: 99, relics: { ring: { tier: 7 } }, reachUpgrades: 6, qtyUpgrades: 99,
                 vigourUpgrades: Wizard.VIGOUR_MAX, playerClass: 'hunter' };
  const s = mkScene(save);
  withDom(() => s.presentWizardOffer(0, 0, () => {}));
  assert.eq(s.shells.length, 0);
  assert.eq(s.flashes.join(), 'The wizard has nothing left.');
});

test('wizard tower: a card click buys through _buyWizardOffer', () => {
  const save = { memories: 50, relicSalt: 3, relics: {} };
  const s = mkScene(save);
  const bought = [];
  s._buyWizardOffer = (k) => bought.push(k);
  withDom(() => s.presentWizardOffer(0, 0, () => {}));
  const card = cardsOf(s.shells[0])[1];
  card.click();
  assert.eq(bought.join(), card.dataset.key, 'the clicked key is bought');
  assert.truthy(s.shells[0].wrap.removed, 'and the dialog closes');
});

// ── The purchase ──────────────────────────────────────────────────────────
test('wizard tower: a purchase pays ONCE through spendMemories and shows the ceremony', () => {
  const save = { memories: 12, relicSalt: 9, relics: {} };
  const s = mkScene(save);
  const o = Wizard.offers(save)[0];
  let spends = 0;
  const realSpend = s.spendMemories.bind(s);
  s.spendMemories = (n) => { spends++; return realSpend(n); };
  let deals = 0;
  const r = s._buyWizardOffer(o.key, 0, 0, () => { deals++; });
  assert.truthy(r, 'bought');
  assert.eq(spends, 1, 'the one writer paid');
  assert.eq(save.memories, 12 - o.cost, 'exactly the price, once');
  assert.eq(deals, 1, 'recordDeal');
  assert.truthy(s.persisted >= 1, 'persisted');
  assert.truthy(s.chip > 0 && s.inv > 0, 'chip and bag repainted');
  assert.eq(s.rewards.length, 1);
  assert.eq(s.rewards[0].kind, 'wizard', 'the ceremony is the wizard kind');
  assert.eq(s.rewards[0].header, o.header);
  assert.eq(s.rewards[0].name, o.name);
});

test('wizard tower: Keen Eye equips the Ring, Vigour refreshes the bar, a calling is written', () => {
  const eyeOnly = { memories: 5, relics: {}, reachUpgrades: 6, qtyUpgrades: 99,
                    vigourUpgrades: Wizard.VIGOUR_MAX, playerClass: 'hunter' };
  const s = mkScene(eyeOnly);
  s._buyWizardOffer('eye', 0, 0, () => {});
  assert.eq(JSON.stringify(s.equips), JSON.stringify([['relic', 'ring', 1]]), 'through _equipGear');
  const vigOnly = { memories: 2, relics: { ring: { tier: 7 } }, reachUpgrades: 6, qtyUpgrades: 99, playerClass: 'hunter' };
  const v = mkScene(vigOnly);
  v._buyWizardOffer('vigour', 0, 0, () => {});
  assert.eq(vigOnly.vigourUpgrades, 1);
  assert.truthy(v.energyDOM > 0, 'the energy gauge repaints its new cap');
  const due = { memories: 3, relics: {}, wizardBuys: 2 };
  const c = mkScene(due);
  c._buyWizardOffer('enchanter', 0, 0, () => {});
  assert.eq(due.playerClass, 'enchanter');
  assert.eq(due.memories, 0);
  assert.eq(c.rewards[0].header, Wizard.offers({ wizardBuys: 2, relics: {} }).find((o) => o.key === 'enchanter').header,
    'the ceremony names the calling');
});

test('wizard tower: a stale card or a short purse refuses with a short flash, nothing spent', () => {
  const save = { memories: 4, relicSalt: 9, relics: {} };
  const s = mkScene(save);
  const five = Wizard.offers(save).find((o) => o.cost === 5);
  assert.eq(s._buyWizardOffer(five.key, 0, 0, () => { throw new Error('no deal'); }), null);
  assert.eq(s.flashes.pop(), 'Not enough memories.');
  const gone = Wizard.TRACKS.map((t) => t.key).find((k) => !Wizard.offers(save).some((o) => o.key === k));
  assert.eq(s._buyWizardOffer(gone, 0, 0, () => { throw new Error('no deal'); }), null);
  assert.eq(s.flashes.pop(), 'The wizard has moved on.');
  assert.eq(save.memories, 4, 'nothing spent');
  for (const m of ['Not enough memories.', 'The wizard has moved on.', 'The wizard has nothing left.'])
    assert.lte([...m].length, MAP_MSG_MAX, m);
});

test('wizard tower: save.memories has one writer down — spendMemories, handed to Wizard.buy', () => {
  assert.truthy(/Wizard\.buy\(this\.save, key, \{ spend: \(n\) => this\.spendMemories\(n\) \}\)/.test(BUY_SRC),
    'the spend hook is spendMemories');
  const writes = [...app.matchAll(/save\.memories\s*=(?!=)/g)].map((m) => m.index);
  const bank = app.indexOf('\n  _bankDiscovery(key, label) {');
  const spend = app.indexOf('\n  spendMemories(n) {');
  assert.eq(writes.length, 2, 'two writes in all of app.js');
  assert.truthy(writes[0] > bank && writes[0] < app.indexOf('\n  }\n', bank), 'one is the ledger banking a memory');
  assert.truthy(writes[1] > spend && writes[1] < app.indexOf('\n  }\n', spend), 'the other is spendMemories');
});

test('wizard tower: the old ladder and the bag badges are gone; the tap still routes here', () => {
  for (const gone of ['wizardLadder', 'wizardNextRung', 'wizardQtyLuckAt', 'WIZARD_UPGRADE_COST', 'QTY_UPGRADE_MAX',
    "Inventory.count(this.save, 'discovery')", 'syncInnerLightRing', 'presentInnerLightOffer'])
    assert.falsy(app.includes(gone), `${gone} is gone`);
  for (const [name, src] of [['gear.js', GEAR_JS_SRC], ['items.js', ITEMS_JS_SRC]])
    assert.falsy(/wizardLadder/.test(src), `${name} comments no longer point at wizardLadder`);
  assert.truthy(/this\.presentWizardOffer\(sx, sy, recordDeal\);/.test(app), 'the wizard tap goes to the offers');
  assert.truthy(/get REACH_UPGRADE_MAX\(\) \{ return Wizard\.REACH_UPGRADE_MAX; \}/.test(app),
    'the reach cap is wizard.js\'s number');
});

test('wizard tower: the ring stays the tower\'s exclusive gift', () => {
  assert.truthy(/if \(slot === 'ring'\) continue;/.test(GEAR_JS_SRC),
    'no shop, smithy or castle offer may roll a Ring');
});

test('wizard tower: the chosen calling shows in the memories explainer', () => {
  const s = mkScene({ memories: 0, discovered: {}, playerClass: 'runner' });
  s.memoriesTotal = () => 0;
  s.showMemoriesHelp();
  const runner = Wizard.CLASSES.find((c) => c.key === 'runner');
  assert.truthy(s.messages[0].body.includes(`Your calling: ${runner.icon} ${runner.name} — ${runner.blurb()}`));
  const none = mkScene({ memories: 0, discovered: {} });
  none.memoriesTotal = () => 0;
  none.showMemoriesHelp();
  assert.falsy(/calling/.test(none.messages[0].body), 'no calling, no line');
});

// ── The calling reaches the mechanics ─────────────────────────────────────
test('classes: every player call site passes save.playerClass', () => {
  const pins = [
    [/Combat\.shotDamage\(relics, slot, this\.save\.playerClass\)/, 'the bow / staff shot (Hunter)'],
    [/Combat\.meleeDps\(this\.save\.relics, this\.save\.playerClass\)/, 'the melee estimate (Enforcer)'],
    [/Combat\.meleeSwingDamage\(this\.save\.relics, this\.isDragonActive\(\) \? 2 : 1, this\.save\.playerClass\)/, 'the melee blow (Enforcer)'],
    [/Trail\.bank\(st\.metres, st\.prizes, addedM, this\.save\.playerClass\)/, 'the ladder bank (Runner)'],
    [/Trail\.readout\(out, this\.save\.playerClass\)/, 'the street counter'],
    [/Trail\.goalFor\(Math\.max\(0, \(n \| 0\) - 1\), this\.save\.playerClass\)/, 'the ceremony goal'],
    [/trailNextPrizeLine\(n \| 0, this\.save\.playerClass\)/, 'the next-rung line'],
    [/trailIntroBody\(this\.save\.playerClass\)/, 'the first-repair greeting'],
  ];
  for (const [re, what] of pins) assert.truthy(re.test(app), what);
  // No player call is left without it.
  // (A call is one line in app.js; the line must name the class.)
  const code = app.split('\n').filter((l) => !/^\s*\/\//.test(l));
  const calls = code.filter((l) => /(Combat\.(shotDamage|meleeDps|meleeSwingDamage)|Trail\.(bank|readout|goalFor|progress))\(/.test(l));
  assert.gte(calls.length, 8, 'found the calls');
  // magicTrapDamage is the one shotDamage call that is NOT the player's own
  // weapon: a Magic Trap is a tier-2 bow shot fired by the trap, so no
  // calling (a Hunter's bow bonus) applies to it.
  for (const l of calls) {
    if (/BASE_TIER\.magic_trap/.test(l)) continue;
    assert.truthy(/playerClass/.test(l), `class threaded: ${l.trim()}`);
  }
});

test('classes: the trail copy quotes the Runner\'s shorter rungs', () => {
  assert.eq(trailNextPrizeLine(0, 'runner'), `Repair ${Trail.goalFor(0, 'runner')}m more for a better prize.`);
  assert.truthy(Trail.goalFor(0, 'runner') < Trail.goalFor(0), 'a runner\'s rung is shorter');
  assert.truthy(trailIntroBody('runner').includes(`${Trail.goalFor(0, 'runner')}m`), 'the greeting too');
  assert.truthy(trailIntroBody().includes(`${Trail.GOAL_STEP_M}m`), 'and no class reads the plain ladder');
});

// ── The Enchanter's channel ───────────────────────────────────────────────
const FINISH_SRC = lift('_finishConsumable(title, body, opts = {}) {', '_finishConsumable');
const CHANNEL_SRC = lift('channelPotion(id, method) {', 'channelPotion');
const SPEND_E_SRC = lift('spendEnergy(cost, sx, sy, cell = null) {', 'spendEnergy');
const HOLD_SRC = lift('_holdRest(now = performance.now()) {', '_holdRest');
const DRINKS = {
  reach_potion: ['drinkReachPotion', 'reachPotionUntil'],
  speed_potion: ['drinkSpeedPotion', 'speedPotionUntil'],
  shield_potion: ['drinkShieldPotion', 'shieldPotionUntil'],
  blight_potion: ['drinkBlightPotion', 'blightPotionUntil'],
};
const DRINK_SRC = Object.values(DRINKS).map(([m]) => lift(`${m}(opts = {}) {`, m)).join('\n');

function potionScene({ id = 'reach_potion', count = 2, energy = 50, cls = 'enchanter' } = {}) {
  const methods = new Function('persistSave', 'MINUTE_MS', 'REACH_POTION_MS', 'SPEED_POTION_MS', 'SHIELD_POTION_MS',
    'BLIGHT_MS', 'BLIGHT_R_CELLS', 'BLIGHT_DPS', 'REST_SETTLE_S', 'TOO_TIRED_MSG',
    `return class { ${FINISH_SRC}\n${CHANNEL_SRC}\n${SPEND_E_SRC}\n${HOLD_SRC}\n${DRINK_SRC} }`);
  const s = new (methods(() => {}, 60000, 60000, 60000, 60000, 60000, 3, 5, 3, 'Too tired — eat or rest.'))();
  s.save = { inv: [{ id, count }], selSlot: 0, energy, playerClass: cls };
  s.flashes = []; s.flash = (m) => s.flashes.push(m);
  s.pops = []; s._popEnergy = (d, at) => s.pops.push([d, at]);
  s._cellAtScreen = () => ({ ix: 4, iy: 5 });
  s._warnIfTiring = () => {};
  s.updateEnergyDOM = () => {};
  s.buildInventoryDOM = () => {};
  s.playerScreen = () => ({ x: 10, y: 20 });
  s.playerBodyDy = () => 0;
  s.messages = []; s.showMessageModal = (o) => s.messages.push(o);
  return s;
}

test('enchanter: channelling a timed potion applies its timer, keeps the flask, spends energy', () => {
  const cost = Wizard.ENCHANTER_ENERGY_COST;
  for (const [id, [method, field]] of Object.entries(DRINKS)) {
    const s = potionScene({ id });
    const before = Date.now();
    assert.eq(s.channelPotion(id, method), true, `${id} channelled`);
    assert.eq(s.save.inv[0].count, 2, `${id}: the flask is not drunk`);
    assert.gte(s.save[field], before, `${id}: its timer runs`);
    assert.eq(s.save.energy, 50 - cost, `${id}: paid ${cost}⚡`);
    assert.eq(JSON.stringify(s.pops), JSON.stringify([[-cost, { ix: 4, iy: 5 }]]), `${id}: popped on a cell`);
    assert.truthy(s._restHoldUntil > 0, `${id}: a channel is work — it holds the rest`);
    assert.truthy(/channel/.test(s.messages[0].title), `${id}: the modal says channel`);
    assert.truthy(/flask stays full/.test(s.messages[0].body), `${id}: and that the flask is kept`);
  }
});

test('enchanter: drinking still consumes; a channel is refused for others, a short bar, a stale pick', () => {
  const d = potionScene();
  d.drinkReachPotion();
  assert.eq(d.save.inv[0].count, 1, 'a plain drink consumes one');
  assert.eq(d.save.energy, 50, 'and costs no energy');
  const other = potionScene({ cls: 'hunter' });
  assert.eq(other.channelPotion('reach_potion', 'drinkReachPotion'), false, 'only an enchanter channels');
  assert.eq(other.save.energy, 50); assert.eq(other.save.reachPotionUntil, undefined);
  const tired = potionScene({ energy: Wizard.ENCHANTER_ENERGY_COST - 1 });
  assert.eq(tired.channelPotion('reach_potion', 'drinkReachPotion'), false, 'a short bar refuses');
  assert.eq(tired.flashes.join(), 'Too tired — eat or rest.', 'with the standard message');
  assert.eq(tired.save.reachPotionUntil, undefined, 'and no timer');
  assert.eq(tired.save.inv[0].count, 2);
  const stale = potionScene({ id: 'speed_potion' });
  assert.eq(stale.channelPotion('reach_potion', 'drinkReachPotion'), false, 'the live pick must match the dialog');
  assert.eq(stale.save.energy, 50, 'nothing taken for a drink that would refuse');
});

test('enchanter: the Use dialog offers Channel on exactly the timed potions', () => {
  const sync = lift('syncConsumableButton() {', 'syncConsumableButton');
  const rows = [...sync.matchAll(/^\s+([a-z_]+):\s+\{[^\n]*channel: true/gm)].map((m) => m[1]).sort();
  assert.eq(rows.join(), Object.keys(DRINKS).sort().join(), 'the four timed potions, no more');
  assert.truthy(/entry\.channel && typeof Wizard !== 'undefined'\s*\n\s*&& Wizard\.isClass\(this\.save, 'enchanter'\)/.test(sync),
    'only for an enchanter');
  assert.truthy(/label: `Channel −\$\{cost\}⚡`/.test(sync), 'priced on the button');
  assert.truthy(/const cost = Wizard\.ENCHANTER_ENERGY_COST;/.test(sync), 'off wizard.js');
  assert.truthy(/disabled: \(this\.save\.energy \?\? 0\) < cost/.test(sync), 'greyed when the bar is short');
  assert.truthy(/this\.channelPotion\(id, fn\)/.test(sync), 'and it channels the dialog\'s own potion');
});
})();
