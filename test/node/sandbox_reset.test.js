(() => {
  const source = INDEX_HTML_SRC.split('// Sandbox local reset must run')[1].split('// End sandbox local reset.')[0];
  function reset(search) {
    const data = new Map([['terracart.saves', 'registry'], ['terracart.save.v4.one', 'save'],
      ['terracart.save.v4.two', 'other slot'], ['terracart.teleport', 'position'],
      ['terracart.howtoSeen', '1'], ['another-app', 'keep']]);
    const storage = { get length() { return data.size; }, key: i => [...data.keys()][i], removeItem: key => data.delete(key) };
    new Function('window', 'location', 'localStorage', '// Sandbox local reset must run' + source)({}, { search }, storage);
    return data;
  }
  test('sandbox reset: explicit flag clears every game slot and preference, preserving other apps', () => {
    const data = reset('?sandbox=true&sandboxZone=castle&reset=true');
    assert.eq(data.size, 1); assert.eq(data.get('another-app'), 'keep');
  });
  test('sandbox reset: normal play and links without an explicit reset preserve storage', () => {
    for (const query of ['?reset=true', '?sandbox=false&reset=true', '?sandbox=0&reset=true',
      '?sandbox=no&reset=true', '?sandbox=true', '?sandbox=true&reset=false', '?sandbox=true&reset=1']) {
      assert.eq(reset(query).size, 6, query);
    }
  });
  test('sandbox reset: supported sandbox aliases also reset', () => {
    for (const value of ['', '1', 'yes', 'TRUE']) assert.eq(reset(`?sandbox=${value}&reset=true`).size, 1);
  });
  test('sandbox skip story: explicit sandbox-only flag is independent of reset', () => {
    for (const [search, expected] of [['?sandbox=true&skipStory=true', true],
      ['?sandbox=true&reset=true&skipStory=true', true], ['?skipStory=true', false],
      ['?sandbox=false&skipStory=true', false], ['?sandbox=true&skipStory=false', false]]) {
      const window = {};
      new Function('window', 'location', 'localStorage', '// Sandbox local reset must run' + source)(window, { search }, { length: 0 });
      assert.eq(window.__sandboxSkipStory, expected, search);
    }
  });
  test('sandbox reset: executes before boot and settings readers', () => {
    assert.lt(INDEX_HTML_SRC.indexOf('// Sandbox local reset must run'), INDEX_HTML_SRC.indexOf('// Boot recovery stays inline:'));
  });
})();
