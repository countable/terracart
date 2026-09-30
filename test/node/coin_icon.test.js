// The HUD keeps its detailed jade coin; ground drops use coarse native-size art.

(function () {
const app = APP_JS_SRC;

// ── The asset ─────────────────────────────────────────────────────────────
test('coin icon: ground and HUD each load their intended artwork', () => {
  assert.truthy(/coin_drop:\s*\{ kind: 'image', path: 'assets\/Objects\/Approved\/coin_single_ground\.png' \}/.test(ASSETS_SRC),
    'ground drops load the flat mini coin');
  const mini = pngDims('assets/Objects/Approved/coin_single_ground.png');
  assert.eq(mini.w, Render.COIN_DROP_PX, 'mini coin renders at native width');
  const dims = pngDims('assets/Icons/coin.png');
  assert.truthy(dims, 'assets/Icons/coin.png exists and is a PNG');
  assert.eq(dims.w, 64, 'the coin is 64px wide');
  assert.eq(dims.h, 64, 'the coin is 64px tall');
});

test('coin icon: the baked coin_drop graphics block is gone from app.js', () => {
  assert.falsy(/generateTexture\('coin_drop'/.test(app),
    'no generateTexture bakes coin_drop any more');
  assert.falsy(/fillStyle\(0x6b4a00/.test(app),
    'the hand-drawn gold disc is gone');
});

test('coin icon: map size derives from each texture width', () => {
  assert.falsy(/setScale\(1\.5 \* pulse\)/.test(RENDER_SRC),
    'the old 16px-disc scale is gone');
  assert.truthy(/setScale\(pile.width \/ s\.width\)/.test(RENDER_SRC),
    'the draw uses the configured width and actual texture dimensions');
  assert.truthy(/const COIN_DROP_PX = 13;/.test(RENDER_SRC),
    'the mini coin uses an integer pixel width');
});

// ── No other face of money survives ───────────────────────────────────────
test('coin icon: no coin emoji remains anywhere in src/', () => {
  for (const [name, src] of Object.entries({
    'app.js': APP_JS_SRC, 'interact.js': INTERACT_SRC, 'interactables.js': INTERACTABLES_SRC,
    'items.js': ITEMS_JS_SRC, 'render.js': RENDER_SRC, 'assets.js': ASSETS_SRC,
  })) {
    assert.falsy(src.includes('🪙'), `${name} still draws money as the coin emoji`);
  }
});

test('coin icon: no money "$" remains in src/ strings (interpolation ${ } untouched)', () => {
  for (const [name, src] of Object.entries({
    'app.js': APP_JS_SRC, 'interact.js': INTERACT_SRC, 'interactables.js': INTERACTABLES_SRC,
  })) {
    src.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');          // comments may talk prices
      const m = code.match(/\$(?!\{)/);
      assert.falsy(m, `${name}:${i + 1} still carries a money $: ${line.trim().slice(0, 80)}`);
    });
  }
});

// ── The helpers and their call sites ──────────────────────────────────────
test('coin icon: the three helpers exist beside iconSpanHTML', () => {
  assert.truthy(/coinIconHTML\(px = 16\) \{\s*\n\s*return `<img src="assets\/Icons\/coin\.png"/.test(app),
    'coinIconHTML returns the coin <img> for modal / list HTML');
  assert.truthy(/moneyHTML\(n, px = 16\) \{\s*\n\s*return `\$\{this\.coinIconHTML\(px\)\} \$\{n\}`;/.test(app),
    'moneyHTML is the icon plus an amount');
  assert.truthy(/coinIconEl\(px = 28\) \{\s*\n\s*const el = document\.createElement\('img'\);/.test(app),
    'coinIconEl builds the same coin as a DOM element for flashLoot');
});

test('coin icon: pure-money flashLoots wear the coin element', () => {
  assert.truthy(/this\.flashLoot\(`Scattered \$\{drops\.length\} coins!`, '#ffe066', 1, null, this\.coinIconEl\(\)\)/.test(app),
    'the coin-burst toast');
  assert.truthy(/this\.flashLoot\(`\+\$\{CASTLE_TAX_GOLD\} taxes`, '#ffe066', 1, null, this\.coinIconEl\?\.\(\)\)/.test(app),
    'the castle taxes toast');
  assert.truthy(/this\.flashLoot\(`\+\$\{finished\.reward\}`, '#ffe066', 1, null, this\.coinIconEl\(\)\)/.test(app),
    'the quest-board reward toast');
  assert.truthy(/scene\.flashLoot\(`\$\{mark\} → \$\{reward\.amount\}`, '#ffe066', 1, null, scene\.coinIconEl\?\.\(\)\)/.test(INTERACT_SRC),
    'the treasure gold toast');
});

test('coin icon: money amounts in HTML go through moneyHTML', () => {
  assert.truthy(/kind: 'money',\s*\n\s*label: this\.moneyHTML\(cashCost\),/.test(app),
    'the shop offer label wears the coin');
  assert.truthy(/cost: this\.moneyHTML\(price\),/.test(app), 'a buy cost line wears the coin');
  assert.truthy(/get: this\.moneyHTML\(`\+\$\{unitPrice \* q\}`\),/.test(app),
    'a sell get line wears the coin');
  assert.truthy(/get: done \? `Reward: \$\{this\.moneyHTML\(q\.reward\)\}`/.test(app),
    'the quest-board reward line wears the coin');
  assert.truthy(/iconHTML: this\.coinIconHTML \? this\.coinIconHTML\(48\) : '',/.test(app),
    'a money reward card wears the 48px coin');
  assert.truthy(/iconHTML: scene\.coinIconHTML \? scene\.coinIconHTML\(48\) : '',/.test(INTERACTABLES_SRC),
    'the chest cash modal wears the coin');
  assert.truthy(/name: `\+\$\{result\.amount \|\| 0\}`, color: UI_GOLD,/.test(INTERACTABLES_SRC),
    'and its name is a bare amount, no $');
});

test('coin icon: the shop modal category glyph is the coin asset', () => {
  assert.truthy(/shop:\s*\{ coinIcon: true, label: 'Shop'[,}]/.test(MODAL_SHELL_SRC),
    'the MODAL_KINDS shop row asks for the coin');
  assert.truthy(/\} else if \(k\.coinIcon\) \{[\s\S]*?ico\.innerHTML = this\.coinIconHTML\(22\);/.test(MODAL_SHELL_SRC),
    'the kind header renders it');
});

// ── The HUD chip ──────────────────────────────────────────────────────────
test('coin icon: the HUD chip writes a bare number into #money-num', () => {
  assert.truthy(/document\.getElementById\('money-num'\) \|\| this\.moneyEl/.test(app),
    'the update targets #money-num, falling back to the chip itself');
  assert.truthy(/const money = `\$\{this\.save\.money \?\? 0\}`;/.test(app),
    'the number carries no $ - the icon is the symbol');
  assert.falsy(/const money = `\$\$\{this\.save\.money/.test(app),
    'the old "$N" chip text is gone');
});
})();


test('coin piles: pickup amounts select the exact quantity boundaries', () => {
  for (const [amount, texture] of [[undefined, 'coin_drop'], [0, 'coin_drop'], [1, 'coin_drop'],
    [2, 'coin_pile_small'], [10, 'coin_pile_small'], [11, 'coin_pile_medium'],
    [50, 'coin_pile_medium'], [51, 'coin_pile_large'], [75, 'coin_pile_large']]) {
    assert.eq(Render.coinPile({ amount }).texture, texture, `amount ${amount}`);
  }
  for (const row of Render.COIN_PILES) assert.lte(row.width, 30, 'fits a map cell');
});
