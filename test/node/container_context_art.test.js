// Selected containers retain material/rewards; broken pots keep contextual shards.
test('containers: selected skins preserve material, rewards and contextual pot shards', () => {
  const contexts = [
    [{}, 0, 0],
    [{ _street: 'trade' }, 1, 0],
    [{ zoneVariant: 'pirate_cove' }, 2, 1],
    [{ zoneVariant: 'mystic_reef' }, 3, 1],
    [{ _street: 'burned' }, 4, 2],
    [{ _biome: WorldGen.T.INDUSTRIAL }, 5, 2],
    [{ _biome: WorldGen.T.WETLAND }, 6, 1],
    [{ _street: 'goblin_gang' }, 7, 2],
    [{ _street: 'pottery' }, 0, 1],
    [{ _biome: WorldGen.T.COMMERCIAL }, 3, 3],
    // The most specific recognized context wins; an unknown one falls back.
    [{ zoneVariant: 'pirate_cove', _street: 'burned', _biome: WorldGen.T.COMMERCIAL }, 2, 1],
    [{ zoneVariant: 'future-zone', _street: 'burned', _biome: WorldGen.T.COMMERCIAL }, 4, 2],
  ];
  const spec = Render.objectAppearance({ textures: { exists: () => true }, save: {} }, new Map(), false).RENDER_SPEC.chest;
  for (const [context, barrelFrame, potFrame] of contexts) {
    for (const [barrelStyle, frame] of [['barrel', barrelFrame], ['clay_pot', potFrame]]) {
      const o = { kind: 'chest', id: 'context-container', barrel: true, barrelStyle, ...context };
      const look = chestLook(o);
      assert.eq(look.texKey, barrelStyle, 'context never changes container material');
      assert.eq(spec.frame(o), look.frame, 'map and popup use the selected frame');
      assert.truthy(look.frame >= 0 && look.frame < (barrelStyle === 'barrel' ? 9 : 2));
      assert.eq(spec.key(o), barrelStyle);
      assert.truthy(SpriteLayout.ART_BOUNDS[`${barrelStyle}:${look.frame}`], 'each contextual frame has seating bounds');
      const ordinary = { kind: 'chest', id: o.id, barrel: true, barrelStyle };
      assert.eq(JSON.stringify(rollBarrel(o, () => 0.5)), JSON.stringify(rollBarrel(ordinary, () => 0.5)), 'cosmetics preserve loot');
      const reloaded = { ...o, _chestLook: undefined, _smashed: true, x: 999, y: -123 };
      assert.eq(chestLook(reloaded).frame, look.frame, 'reload preserves the selected intact frame');
      assert.eq(spec.frame(reloaded), frame, 'spent state retains contextual shards');
      if (barrelStyle === 'clay_pot') {
        assert.eq(spec.key(reloaded), 'clay_pot_smashed');
        assert.truthy(SpriteLayout.ART_BOUNDS[`clay_pot_smashed:${frame}`], 'matching shards seat correctly');
      }
    }
  }
});

test('containers: every approved look is reachable and stable by identity', () => {
  for (const [key, count] of [['barrel', 9], ['clay_pot', 2], ['box', 4]]) {
    const frames = new Set();
    for (let i = 0; i < 256; i++) {
      const o = { kind: 'chest', id: 'selected-container-' + i,
        barrel: key !== 'box', barrelStyle: key, crate: key === 'box' };
      const look = chestLook(o);
      frames.add(look.frame);
      assert.eq(chestLook({ ...o, _chestLook: undefined, x: 999 }).frame, look.frame);
      assert.eq(look.texKey, key);
    }
    assert.eq(frames.size, count, key + ' exposes all selected alternatives');
  }
});
