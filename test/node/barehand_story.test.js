// Equipment and completion, rather than a tap alone, decide which story is true.
(function () {
const lift = (sig) => {
  const start = SCENE_SRC.indexOf('\n  ' + sig);
  const end = SCENE_SRC.indexOf('\n  }\n', start);
  return SCENE_SRC.slice(start + 1, end + 4);
};
const methods = new Function('return ({' + [
  lift('_toolActionStory(action) {'),
  lift('_catchStory(creature) {'),
  lift('_barehandWorkStory(tool, startingTier, isTree = false) {'),
  lift('_storySplashOnce(key, { art, title, body, okLabel, onDismiss } = {}) {'),
  lift('_barehandMutter(toolSlot, worldX, worldY) {'),
].join(',') + '});')();
const sceneFor = (relics = {}) => {
  const modals = [];
  return makeScene({ ...methods, save: { relics }, modals,
    showMessageModal: entry => modals.push(entry) });
};

test('tool story requires its own owned tool, not an unrelated relic', () => {
  const s = sceneFor({ axe: { tier: 1 } });
  for (const action of ['till', 'dig', 'catch', 'sword', 'water', 'shoot', 'staff']) s._toolActionStory(action);
  assert.eq(s.modals.length, 0);
  assert.falsy(s.save.storySeen);
  s._toolActionStory('chop');
  assert.eq(s.modals[0].art, 'tool_chop');
  s.save.relics.hoe = { tier: 0 };
  s._toolActionStory('till');
  assert.eq(s.modals.length, 1);
  s.save.relics.hoe.tier = 1;
  s._toolActionStory('till');
  assert.eq(s.modals[1].art, 'tool_till');
});

test('chicken catch story uses its original art and voice with bare hands, once per save', () => {
  const s = sceneFor();
  s._catchStory({ kind: 'chicken' });
  assert.eq(s.modals[0].art, 'tool_catch_chicken');
  assert.eq(s.modals[0].body, '“You want to catch that chicken,” <em>beckons a voice inside you.</em>');
  s._catchStory({ kind: 'chicken' });
  assert.eq(s.modals.length, 1);
  assert.falsy(s.save.storySeen['tool:catch']);
  s.save.relics.bugnet = { tier: 1 };
  s._catchStory({ kind: 'cow' });
  assert.eq(s.modals[1].art, 'tool_catch', 'other targets keep generic net art');
  assert.truthy(/if \(catchCost && !scene\.spendEnergy[\s\S]{0,400}scene\._catchStory\?\.\(victim\)/.test(INTERACT_SRC), 'story follows the successful energy spend');
});

test('barehand story shares one independent key, tree artwork only for a tree', () => {
  const s = sceneFor();
  s._barehandWorkStory('axe', 0, true);
  assert.eq(s.modals[0].art, 'barehand_tree');
  assert.eq(s.save.storySeen['work:barehands'], 1);
  assert.falsy(s.save.storySeen['tool:chop']);
  s._barehandWorkStory('pick', 0);
  assert.eq(s.modals.length, 1);
  s.save.relics.axe = { tier: 1 };
  s._toolActionStory('chop');
  assert.eq(s.modals.length, 2);
  const generic = sceneFor();
  generic._barehandWorkStory('axe', 0, false);
  assert.eq(generic.modals[0].art, 'barehand_work');
  // Both bodies close on the one aside (owner's copy, Oct 2026).
  for (const body of [s.modals[0].body, generic.modals[0].body]) {
    assert.truthy(/disbelief\. \(but to be honest tools would be much less tiring!\)$/.test(body), 'ends on the aside: ' + body);
  }
  const equipped = sceneFor();
  equipped._barehandWorkStory('pick', 1);
  equipped._barehandWorkStory('bugnet', 0);
  assert.eq(equipped.modals.length, 0);
  equipped.depth = 1;
  equipped._barehandWorkStory('pick', 0);
  assert.eq(equipped.modals.length, 0, 'surface witness painting is not used underground');
});

const rock = id => ({ kind: 'mineralrock', id, x: 0, y: 0, caveVariant: 0 });
test('barehand mining story waits for completion and uses starting equipment', () => {
  const s = sceneFor();
  let complete;
  s.startWorkProgress = (x, y, callback) => { complete = callback; };
  runInteractable(makeCtx(s, s.save), rock('barehand-story-1'));
  assert.eq(s.modals.length, 0, 'running or cancelled work tells no success story');
  s.save.relics.pick = { tier: 1 };
  complete();
  assert.eq(s.modals[0].art, 'barehand_work', 'newly acquired pick did not perform this job');
  const failed = sceneFor();
  failed.spendEnergy = () => false;
  let starts = 0;
  failed.startWorkProgress = () => starts++;
  runInteractable(makeCtx(failed, failed.save), rock('barehand-story-2'));
  assert.eq(starts, 0);
  assert.eq(failed.modals.length, 0);
  const stale = sceneFor();
  let staleComplete;
  stale.startWorkProgress = (x, y, callback) => { staleComplete = callback; };
  const target = rock('already-mined');
  runInteractable(makeCtx(stale, stale.save), target);
  stale.brokenRockSet.add(target.id);
  staleComplete();
  assert.eq(stale.modals.length, 0, 'an already spent target is not new work');
});

test('equipped mining keeps its tool story if equipment changes mid-job', () => {
  const s = sceneFor({ pick: { tier: 1 } });
  let complete;
  s.startWorkProgress = (x, y, callback) => { complete = callback; };
  runInteractable(makeCtx(s, s.save), rock('barehand-story-3'));
  assert.eq(s.modals[0].art, 'tool_dig');
  delete s.save.relics.pick;
  complete();
  assert.eq(s.modals.length, 1);
  assert.falsy(s.save.storySeen['work:barehands']);
});
test('slow-grind tree story waits for accepted successful work', () => {
  const tree = { kind: 'tree', size: 'medium', species: 'pine', x: 0, y: 0 };
  let n = 0;
  do { tree.id = 'barehand-tree-' + n++; } while (treeAxeReqTier(tree) !== 1);
  const s = sceneFor();
  s.save.energy = SLOW_GRIND_ENERGY;
  let offer, complete;
  s.showOfferModal = opts => { offer = opts; };
  s.startWorkProgress = (x, y, callback) => { complete = callback; };
  runInteractable(makeCtx(s, s.save), tree);
  assert.truthy(offer);
  assert.falsy(complete, 'declining never starts work');
  assert.eq(s.modals.length, 0);
  offer.onAccept();
  assert.truthy(complete);
  assert.eq(s.modals.length, 0, 'cancelling the wheel leaves story unseen');
  complete();
  assert.eq(s.modals[0].art, 'barehand_tree');
  assert.truthy(tree.chopped);
});


// THE GRUNT (owner, Oct 2026): a job started with no tool in hand pops a
// short line on its cell — "Oof!", "Ghhhh!", "Need tools!" in turn — from the
// one wheel starter every job goes through, so no call site can forget it.
test('barehand mutter: a tool-less job grunts on its cell, in turn; an owned tool or a non-work wheel says nothing', () => {
  const N = 51, CELL_M = 7;
  const scene = (relics) => ({
    save: { relics }, cellM: CELL_M, cellsPerTile: N, mPerPx: CELL_M * N / WorldGen.TILE_PX,
    originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, feetOffsetM: 0,
    pops: [], _popCellNumber(text, color, ix, iy) { this.pops.push({ text, color, ix, iy }); },
    _barehandMutter: methods._barehandMutter,
  });
  const bare = scene({});
  const at = (CELL => (CELL + 0.5) * CELL_M)(3);
  for (const tool of ['pick', 'axe', 'hoe']) assert.truthy(bare._barehandMutter(tool, at, at), tool + ' grunts');
  assert.eq(bare.pops.map(p => p.text).join('|'), BAREHAND_MUTTERS.join('|'), 'the lines come in turn');
  assert.eq(bare.pops[0].ix, 3); assert.eq(bare.pops[0].iy, 3);
  for (const p of bare.pops) assert.eq(p.color, UI_DANGER_INK, 'in the hurt ink');
  assert.truthy(bare._barehandMutter('pick', at, at), 'and wrap round');
  assert.eq(bare.pops[3].text, BAREHAND_MUTTERS[0]);
  for (const line of BAREHAND_MUTTERS) assert.lte(line.length, MAP_MSG_MAX, 'fits a map line: ' + line);
  const owned = scene({ pick: { tier: 1 } });
  assert.falsy(owned._barehandMutter('pick', at, at), 'a Wood pick is a tool');
  assert.falsy(owned._barehandMutter('bugnet', at, at), 'the catch is bare-handed by nature');
  assert.falsy(owned._barehandMutter(null, at, at), 'a wheel with no tool slot');
  assert.eq(owned.pops.length, 0);
  assert.eq(BAREHAND_MUTTER_TOOLS.join(), 'axe,pick,hoe', 'the work tools the bare-hands story tells of');
  // Wired into the one wheel starter, right beside the badge it shares its gate with.
  assert.truthy(/startWorkProgress\(worldX, worldY, onComplete[^)]*\) \{\n\s+this\._setWorkProgressIcon\(toolSlot\);\n\s+this\._barehandMutter\?\.\(toolSlot, worldX, worldY\);/.test(SCENE_SRC),
    'every wheel start asks for the grunt');
});
})();
