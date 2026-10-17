// Containers retain their material/rewards while context chooses the skin.
test('containers: contextual skins preserve material, rewards and matched pot shards', () => {
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
      assert.eq(spec.frame(o), frame, 'render uses the contextual frame');
      assert.eq(spec.key(o), barrelStyle);
      assert.truthy(SpriteLayout.ART_BOUNDS[`${barrelStyle}:${frame}`], 'each contextual frame has seating bounds');
      const ordinary = { kind: 'chest', id: o.id, barrel: true, barrelStyle };
      assert.eq(JSON.stringify(rollBarrel(o, () => 0.5)), JSON.stringify(rollBarrel(ordinary, () => 0.5)), 'cosmetics preserve loot');
      const reloaded = { ...o, _chestLook: undefined, _smashed: true, x: 999, y: -123 };
      assert.eq(spec.frame(reloaded), frame, 'reload and spent state retain the frame');
      if (barrelStyle === 'clay_pot') {
        assert.eq(spec.key(reloaded), 'clay_pot_smashed');
        assert.truthy(SpriteLayout.ART_BOUNDS[`clay_pot_smashed:${frame}`], 'matching shards seat correctly');
      }
    }
  }
});
