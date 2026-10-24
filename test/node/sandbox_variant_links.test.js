test('sandbox variant links: every shipping nexus and road has an exact, non-destructive launch URL', () => {
  for (const [type, rows] of [['nexus', ZoneVariants.rows], ['road', StreetVariants.STREET_VARIANTS]]) {
    for (const row of rows) {
      const url = new URL(SandboxDestinations.variantHref(type, row.id), 'http://localhost/');
      assert.truthy(url.pathname.endsWith('/tools/floor-viewer.html'));
      assert.eq(url.searchParams.get('sandboxType'), type);
      assert.eq(url.searchParams.get('sandboxVariant'), row.id);
      assert.eq(url.searchParams.get('play'), 'true');
      assert.falsy(url.searchParams.has('reset'), 'launches never clear another saved game');
      const selected = FloorViewerVariants.exactSelection(type, row.id);
      assert.eq([...selected.nexuses, ...selected.roads][0].id, row.id);
      assert.eq(selected.nexuses.length + selected.roads.length, 1);
    }
  }
  assert.eq(SandboxDestinations.variantHref('other', 'orchard'), null);
  assert.eq(SandboxDestinations.variantHref('nexus', '../index.html'), null);
});

test('sandbox exact variants: choosing one nexus keeps other kinds and path assignments natural', async () => {
  const V = FloorViewerVariants;
  const originalPick = ZoneVariants.pick, originalRoad = StreetVariants.variantFor;
  const before = ZoneVariants.pick({kind:'stones', gx:100, gy:200});
  const selection = V.exactSelection('nexus', 'marine_meadow');
  await V.withSelection(0, selection, async () => {
    assert.eq(ZoneVariants.pick({kind:'grove', gx:100, gy:200}).id, 'marine_meadow');
    assert.eq(ZoneVariants.pick({kind:'stones', gx:100, gy:200}), before);
    assert.eq(StreetVariants.variantFor('key', '', 'minor'), originalRoad('key', '', 'minor'));
    const index = {pathSections:[{variant:'parkpath'}], lines:[]};
    WorldGen.runSteps(StreetVariants.applyPathScenicSteps(index, null));
    assert.eq(index.pathSections[0].variant, 'parkpath', 'a Nexus launch cannot erase path assignments');
  });
  assert.eq(ZoneVariants.pick, originalPick);
  assert.eq(StreetVariants.variantFor, originalRoad);
});

test('sandbox exact variants: a road selection forces only its own size and restores the selector', async () => {
  const original = StreetVariants.variantFor;
  await FloorViewerVariants.withSelection(0, FloorViewerVariants.exactSelection('road', 'pottery'), async () => {
    assert.eq(StreetVariants.variantFor('key', '', 'minor'), 'pottery');
    assert.eq(StreetVariants.variantFor('key', '', 'path'), original('key', '', 'path'));
    assert.eq(StreetVariants.variantFor('key', '', 'major'), null);
  });
  assert.eq(StreetVariants.variantFor, original);
});
