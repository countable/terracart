// Corvids keep their own ground: crows the open country (GRASS landcover, and
// the grove Nexus profiles — a park is always a Nexus), ravens the houses.
// The residential crop raider is the deer, not a bird.
(function () {
test('corvid habitats: crows keep grassland and groves; ravens hold the houses', () => {
  const kinds = (name) => HabitatSpawns.faunaRows(HabitatSpawns.landProfile(name)).map(r => r.kind);
  assert.includes(kinds('GRASS'), 'crow');
  assert.includes(kinds('RESIDENTIAL'), 'raven');
  assert.includes(kinds('RESIDENTIAL'), 'deer');
  assert.falsy(kinds('RESIDENTIAL').includes('crow'), 'no crows among the houses');
  const T = WorldGen.T;
  for (const t of [T.GRASS, T.PARK]) assert.truthy(HabitatSpawns.allows('crow', t), `crow on ${t}`);
  assert.falsy(HabitatSpawns.allows('crow', T.RESIDENTIAL));
  assert.falsy(SpriteLayout.creatureBehaviour('raven').raidsCrops, 'the raven steals coins, not crops');
});
})();
