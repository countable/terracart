// THE RAVEN IS THE HOUSES' CROP RAIDER (owner, Oct 2026: "where are the crop
// eating ravens? those should be the residential ones"). A roster thief
// (coins) that, while it is not after the player, flies the crow's raid —
// scene_creatures.js _foeCasesCrop routes it to _wildCrowTick ahead of
// rosterEnemyMove. Crows keep the open country (GRASS) and the groves.
(function () {

const FOE_CASES_SRC = (() => {
  const i = SCENE_SRC.indexOf('  _foeCasesCrop(c, now, distM, unnoticed) {\n');
  const j = SCENE_SRC.indexOf('\n  }\n', i);
  assert.gte(i, 0, '_foeCasesCrop exists');
  return SCENE_SRC.slice(i + '  _foeCasesCrop(c, now, distM, unnoticed) {\n'.length, j);
})();
const cases = (self, c, now, distM, unnoticed = false) =>
  new Function('c', 'now', 'distM', 'unnoticed', FOE_CASES_SRC).call(self, c, now, distM, unnoticed);
const scene = (planted) => ({ cellM: 1, depth: 0, save: { planted }, _cropRaidable: (p) => p.crop !== 'potato' });

test('raven raid: the raven row raids crops and turns from a scarecrow, like the crow', () => {
  const beh = SpriteLayout.creatureBehaviour('raven');
  assert.truthy(beh.raidsCrops, 'the raven row says it raids crops');
  assert.truthy(SpriteLayout.creatureAvoids('raven', 'scarecrow'), 'a scarecrow turns it');
  assert.truthy(beh.animal, 'still a wild animal under its roster movement');
});

test('raven raid: it cases a nearby field only while it is not after the player', () => {
  const crop = { x: 2, y: 0, crop: 'berry' };
  const c = { x: 0, y: 0, kind: 'raven' };
  assert.truthy(cases(scene([crop]), c, 0, 100), 'player out of sight: it works the field');
  assert.truthy(cases(scene([crop]), c, 0, 1, true), 'an unnoticed player does not distract it');
  assert.falsy(cases(scene([crop]), c, 0, 1), 'a player in sight turns it back into the thief');
  assert.falsy(cases(scene([]), c, 0, 100), 'no crops: its roster mover keeps it');
  assert.falsy(cases(scene([{ x: 2, y: 0, crop: 'potato' }]), c, 0, 100), 'never a potato');
  assert.falsy(cases(scene([{ x: RAID_NOTICE_CELLS + 5, y: 0, crop: 'berry' }]), c, 0, 100),
    'a field past RAID_NOTICE_CELLS goes unnoticed');
  assert.truthy(cases(scene([]), { ...c, _departUntilT: 500 }, 0, 1), 'a sated raider finishes its retreat');
  assert.falsy(cases(scene([crop]), { x: 0, y: 0, kind: 'slime' }, 0, 100), 'only rows that raid crops');
});

test('raven raid: wanderCreatures asks _foeCasesCrop before the roster mover (source pin)', () => {
  const i = SCENE_SRC.indexOf('this._foeCasesCrop(c, now, distM, unnoticed)');
  const j = SCENE_SRC.indexOf('rosterEnemyMove(this, c, rosterRow, now');
  assert.gte(i, 0, 'the call exists');
  assert.lt(i, j, 'and runs ahead of the roster mover');
  assert.truthy(/if \(!routed && !lairState && !npcTarget && !isTame && SpriteLayout\.creatureBehaviour\(c\.kind\)\?\.raidsCrops/.test(SCENE_SRC),
    'a routed, garrisoned, NPC-hunting or tame raven never raids');
});

test('raven raid: crows keep grassland and groves; ravens hold the houses', () => {
  const kinds = (name) => HabitatSpawns.faunaRows(HabitatSpawns.landProfile(name)).map(r => r.kind);
  assert.includes(kinds('GRASS'), 'crow');
  assert.includes(kinds('RESIDENTIAL'), 'raven');
  assert.falsy(kinds('RESIDENTIAL').includes('crow'), 'no crows among the houses');
  const raven = HabitatSpawns.faunaRows(HabitatSpawns.landProfile('RESIDENTIAL')).find(r => r.kind === 'raven');
  assert.gte(raven.weight, 2, 'a common sight, not a rarity');
  const T = WorldGen.T;
  for (const t of [T.GRASS, T.PARK]) assert.truthy(HabitatSpawns.allows('crow', t), `crow on ${t}`);
  assert.falsy(HabitatSpawns.allows('crow', T.RESIDENTIAL));
});

})();
