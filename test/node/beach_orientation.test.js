(() => {
  const drain = it => { let r; do { r = it.next(); } while (!r.done); return r.value; };
  const layer = rings => ({ extent: 4096, features: rings.map(geom => ({ type: 3, tags: { class: 'ocean' }, geom: [geom] })) });
  const rect = (x0,y0,x1,y1) => [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  test('beach orientation: the shrine approach points inland on all four shores', () => {
    for (const [water, direction] of [
      [rect(0,0,4096,1000), [0,1]], [rect(0,3000,4096,4096), [0,-1]],
      [rect(0,0,1000,4096), [1,0]], [rect(3000,0,4096,4096), [-1,0]],
    ]) {
      const a = { kind:'beach', gx:2048, gy:2048, key:42 };
      drain(ZoneCoverage.orientBeachesSteps([a], layer([water]), 0, 0));
      assert.eq(ZoneVariants.rotate(0,-1,ZoneVariants.rotation(a)).join(), direction.join());
      assert.eq(a.orientationSource, 'shoreline');
    }
  });
  test('beach orientation: buffered shoreline translation and source order preserve the frame', () => {
    const rings = [rect(3700,-500,4600,1800), rect(100,100,200,200)];
    const a = { kind:'beach', gx:4080, gy:2200, key:99 }, b = {...a};
    drain(ZoneCoverage.orientBeachesSteps([a], layer(rings), 0, 0));
    const shifted = rings.slice().reverse().map(r => r.slice().reverse().map(p => ({x:p.x-4096,y:p.y})));
    drain(ZoneCoverage.orientBeachesSteps([b], layer(shifted), 1, 0));
    assert.eq(a.rotation, b.rotation);
    assert.eq(a.orientationSource, 'shoreline');
  });
  test('beach orientation: a diagonal shore clipped at adjacent tile buffers retains its frame', () => {
    // One water polygon north of world-space y = .6*x + 500, independently
    // clipped to each tile's 64-unit MVT buffer. The POI's 80 m influence
    // crosses the seam although its nearest shoreline point is outside the
    // neighbouring tile's water buffer.
    const left = [{x:-64,y:-64},{x:4160,y:-64},{x:4160,y:2996},{x:-64,y:461.6}];
    const right = [{x:-64,y:-64},{x:4160,y:-64},{x:4160,y:4160},{x:2004,y:4160},{x:-64,y:2919.2}];
    const a = {kind:'beach', gx:3900, gy:3000, key:99}, b = {...a};
    drain(ZoneCoverage.orientBeachesSteps([a], layer([left]), 0, 0));
    drain(ZoneCoverage.orientBeachesSteps([b], layer([right]), 1, 0));
    assert.eq(a.rotation, 2, 'southward approach follows the true shoreline normal');
    assert.eq(b.rotation, a.rotation, 'the clipped endpoint must not rotate the neighbour west');
  });
  test('beach orientation: coverage publishes the shoreline frame on the dressed anchor', () => {
    const N = 32, a = { kind:'beach', gx:2048, gy:2048, lx:2048, ly:2048,
      key:42, owned:true, code:Zones.ZONE_KINDS.beach.code, R:70,
      upm:N * WorldGen.CELL_M / 4096 };
    const field = { anchors:[a], allAnchors:[a], idx:new Uint16Array(N*N), reach:[] };
    const result = drain(ZoneCoverage.buildSteps({ field, N, tx:0, ty:0, parks:[],
      grid:new Uint8Array(N*N).fill(WorldGen.T.SAND),
      waterLayer:layer([rect(0,0,4096,1000)]) }));
    assert.gt(result.coverage.filter(Boolean).length, 0);
    const beach = result.anchors.find(row => row.kind === 'beach');
    assert.eq(beach.orientationSource, 'shoreline');
    assert.eq(ZoneVariants.rotate(0,-1,ZoneVariants.rotation(beach)).join(), '0,1');
  });
  test('beach orientation: artificial clipping borders never supply a shoreline direction', () => {
    const a = {kind:'beach', gx:3900, gy:3000, key:99};
    const before = ZoneVariants.rotation(a);
    drain(ZoneCoverage.orientBeachesSteps([a], layer([rect(-64,-64,4160,4160)]), 0, 0));
    assert.eq(a.orientationSource, 'unresolved');
    assert.eq(ZoneVariants.rotation(a), before);
  });
  test('beach orientation: missing water evidence reports a deterministic fallback', () => {
    const a = { kind:'beach', gx:10, gy:20, key:123 };
    const before = ZoneVariants.rotation(a);
    drain(ZoneCoverage.orientBeachesSteps([a], null, 0, 0));
    assert.eq(a.orientationSource, 'unresolved');
    assert.eq(ZoneVariants.rotation(a), before);
  });
})();
