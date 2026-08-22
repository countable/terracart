// terrain_mirror.test.js — pins that biome_profiles.js' hand-mirrored terrain
// enum never drifts from worldgen.js' real one.
//
// biome_profiles.js is deliberately loaded BEFORE worldgen.js (see its header
// comment: "Depends on: nothing... so this module has no load-order
// dependency on worldgen"), so it can't just read WorldGen.T at load time —
// it keeps its own bare-number copy instead. That copy is exactly the kind of
// thing that drifts silently: add a terrain code to one enum, forget the
// other, and every BiomeProfiles.get()/allows() call for the new code falls
// through to a wrong family with no error anywhere.
//
// Both enums are already exported on their module's public API (WorldGen.T,
// BiomeProfiles.T), so this pins them value-for-value with no bridging needed.

test('terrain enum mirror: BiomeProfiles.T matches WorldGen.T key-for-key', () => {
  const real = WorldGen.T;
  const mirror = BiomeProfiles.T;
  const realKeys = Object.keys(real).sort();
  const mirrorKeys = Object.keys(mirror).sort();
  assert.eq(JSON.stringify(mirrorKeys), JSON.stringify(realKeys),
    'BiomeProfiles.T is missing or has extra keys vs WorldGen.T');
  for (const k of realKeys) {
    assert.eq(mirror[k], real[k], `BiomeProfiles.T.${k} diverged from WorldGen.T.${k}`);
  }
});
