test('Book pacing: the lifetime-memory boundary allows one last Book and reopens with a memory', () => {
  const save = { booksRead: 5, memories: 0, discovered: { first: true, second: true } };
  const opts = { theme: 'school', save };
  assert.eq(ChestThemes.resolve('books', 1, opts).group, 'books', 'equality still allows a Book');
  save.booksRead++;
  assert.eq(ChestThemes.resolve('books', 1, opts).group, 'torch', 'one above the boundary pauses Books');
  save.memories = 999;
  assert.eq(ChestThemes.resolve('plainBook', 2, opts).group, 'torch', 'unspent currency cannot unlock Books');
  save.discovered.third = true;
  save.memories = 0;
  assert.eq(ChestThemes.resolve('books', 1, opts).group, 'books', 'a recovered memory reopens Books even if spent');
  assert.eq(ChestThemes.resolve('books', 1, { save: {} }).group, 'books', 'fresh saves can find Books');
});

test('Book pacing: all themed chest tiers and fallback paths still pay a non-Book reward while ahead', () => {
  const save = { booksRead: 4, discovered: {}, relics: {}, armor: {} };
  const rng = bookRng(713);
  for (const theme of Object.keys(ChestThemes.themes)) {
    for (const depth of [0, 1]) for (let tier = 1; tier <= 5; tier++) {
      const opts = { theme, depth, tier, chestTier: tier, save };
      for (const group of Object.keys(ChestThemes.weights(theme, tier, opts))) {
        const resolved = ChestThemes.resolve(group, tier, opts);
        assert.falsy(resolved.ids.includes('book'), `${theme}/${tier}/${depth}/${group} cannot bypass the gate`);
      }
      for (let i = 0; i < 50; i++) {
        const reward = resolveChestReward(theme, { tier, bracket: 0, jackpotApplied: 0 }, save, rng, opts);
        assert.truthy(reward, 'a blocked Book does not empty the chest');
        assert.falsy(reward.id === 'book', `${theme}/${tier}/${depth} cannot award a Book`);
      }
    }
  }
});
