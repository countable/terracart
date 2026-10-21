test('flat roof rims: acute Kelowna returns keep short decorative joins', () => {
  const layer = MVT.decodeTile(FIXTURE_TILES['2753_5567']).find(l => l.name === 'building');
  const feature = layer.features.find(f => f.id === 2228921780);
  // Exact ring from the real-lot review. One source unit is about .385 m;
  // translate only, retaining its narrow slots and acute front returns.
  const source = feature.geom[138], origin = source[0];
  const ring = source.map(p => ({ x: (p.x - origin.x) * 1.76, y: (p.y - origin.y) * 1.76 }));
  for (const points of [ring, [...ring].reverse()]) {
    const mesh = BuildingLowPoly.geometry(points, 'flat', 15);
    const rim = mesh.faces.filter(f => f.rim), shade = mesh.faces.filter(f => f.rimShade);
    assert.gt(rim.length, 0, 'repair retains the rim');
    assert.gt(shade.length, 0, 'repair retains the inner shade');
    for (const faces of [rim, shade]) for (const face of faces) for (const p of face.points) {
      const distance = Math.min(...mesh.ring.map(q => Math.hypot(p.x - q.x, p.y - q.y)));
      const width = face.rim ? BuildingLowPoly.LOOK.flatRim : BuildingLowPoly.LOOK.flatShade;
      assert.lte(distance, width * 2 + 1e-7, 'acute corner cannot grow a long inward spike');
    }
  }
  const square = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
  assert.eq(JSON.stringify(BuildingStyles.inset(square, 4, 2)), JSON.stringify(BuildingStyles.inset(square, 4)),
    'ordinary right-angle joins retain their exact geometry');
});
