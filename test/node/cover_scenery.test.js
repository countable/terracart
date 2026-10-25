// Raised scenery uses its own sight query, rather than the ground shadow
// projected through its crown. Canvas commands here also pin the bounded blits.
(() => {
  function fixture() {
    const canvases = [], calls = [], sight = [];
    const document = { createElement() {
      const c = { width: 0, height: 0 }, ctx = {
        setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
        drawImage(...args) { calls.push({ canvas: c, op: this.globalCompositeOperation, args }); },
      };
      c.getContext = () => ctx; canvases.push(c); return c;
    } };
    const visibility = { CLEAR: 0, PARTIAL: 1, FULL: 2, PARTIAL_DARKNESS: .5, FULL_DARKNESS: 1,
      revision: s => s.sightRevision || 0,
      coverBetween(s, ax, ay, bx, by) { sight.push([ax, ay, bx, by]); return bx > ax + 10 ? 1 : 0; },
      sightCover() { throw new Error('Scenery must not conceal itself'); } };
    const run = new Function('document', 'playerWorldM', 'Visibility', 'HeadingUp', 'WorldLayers',
      'return (' + Render.protectCoverScenery.toString() + ');')(document, s => s.player, visibility,
      { angle: () => 0 }, WorldLayers);
    const source = {};
    const sprite = (object, depth, visible = true) => ({ visible, alpha: 1, depth,
      x: 32, y: 32, scaleX: 1, scaleY: 1, displayOriginX: 8, displayOriginY: 16,
      _staticObject: object, frame: { source: { image: source }, cutX: 0, cutY: 0,
        cutWidth: 16, cutHeight: 16, realWidth: 16, realHeight: 16, x: 0, y: 0 },
      getWorldTransformMatrix() { return { a: 1, b: 0, c: 0, d: 1, e: this.x, f: this.y }; },
    });
    const near = sprite({x: 5, y: 0}, 0), far = sprite({x: 20, y: 0}, 1);
    const actor = sprite(null, 2), hiddenActor = sprite(null, 3, false);
    const scene = { player: { x: 0, y: 0 }, viewLeft: 0, viewTop: 0,
      worldContainer: { list: [near, far, actor, hiddenActor] } };
    const cover = { canvas: { width: 200, height: 200 }, x: 0, y: 0, key: 'field' };
    return { run, scene, cover, near, far, actor, calls, sight, canvases };
  }
  test('cover scenery: visible blocker and visible actor stay clear; rear tree receives cover', () => {
    const f = fixture(); f.run(f.scene, f.cover);
    assert.eq(f.scene._coverScenery.rows.length, 3, 'hidden actors never become silhouettes');
    assert.eq(JSON.stringify(f.scene._coverScenery.rows.map(row => row[14])), '[0,0.5,0]');
    assert.eq(JSON.stringify(f.sight), '[[0,0,5,0],[0,0,20,0]]');
    assert.eq(f.cover.canvas.width, 200, 'source field remains separate');
    assert.truthy(f.calls.some(call => call.op === 'lighter'), 'replacement alpha adds to the retained background on faded art');
  });
  test('cover scenery: still frame reuses canvas and revision, movement retests exact body', () => {
    const f = fixture(), first = f.run(f.scene, f.cover), commands = f.calls.length;
    assert.eq(f.run(f.scene, f.cover).revision, first.revision);
    assert.eq(f.calls.length, commands, 'no repaint on still frame');
    assert.eq(f.sight.length, 2, 'no repeated rays on still frame');
    f.scene.player.x = 15;
    const changed = f.run(f.scene, f.cover);
    assert.truthy(changed.revision !== first.revision, 'body change within field cache can change scenery sight');
    assert.eq(JSON.stringify(f.scene._coverScenery.rows.map(row => row[14])), '[0,0,0]');
    assert.eq(f.canvases.length, 2, 'reuses the two scratch canvases');
  });
  test('cover scenery: silhouette composites are bounded to sprite area', () => {
    const f = fixture(); const result = f.run(f.scene, f.cover);
    const blits = f.calls.filter(call => call.canvas === result.canvas && call.args[0] === f.canvases[1]);
    assert.truthy(blits.length > 0);
    for (const call of blits) {
      assert.eq(call.args.length, 9);
      assert.truthy(call.args[3] <= 18 && call.args[4] <= 18, 'small sprite never composites full viewport');
    }
  });
})();
