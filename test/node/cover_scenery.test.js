// Raised scenery uses its own sight query, rather than the ground shadow
// projected through its crown. Canvas commands here also pin the bounded blits.
(() => {
  function fixture(heading = 0) {
    const canvases = [], calls = [], sight = [];
    const document = { createElement() {
      const c = { width: 0, height: 0 }, ctx = {
        setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
        drawImage(...args) { calls.push({ canvas: c, op: this.globalCompositeOperation, args }); },
        getImageData() { throw new Error('Silhouette protection must not read pixels back'); },
      };
      c.getContext = () => ctx; canvases.push(c); return c;
    } };
    const visibility = { CLEAR: 0, PARTIAL: 1, FULL: 2, PARTIAL_DARKNESS: .5, FULL_DARKNESS: 1,
      revision: s => s.sightRevision || 0,
      coverBetween(s, ax, ay, bx, by) { sight.push([ax, ay, bx, by]); return bx > ax + 10 ? 1 : 0; },
      sightCover() { throw new Error('Scenery must not conceal itself'); } };
    const run = new Function('document', 'playerWorldM', 'Visibility', 'HeadingUp', 'WorldLayers',
      'return (' + Render.protectCoverScenery.toString() + ');')(document, s => s.player, visibility,
      { angle: () => heading,
        _upright(sprite, angle, saved) {
          saved.push([sprite, sprite.x, sprite.y, sprite.rotation]);
          sprite.x += 10; sprite.y -= 5; sprite.rotation += angle;
          sprite._huFoot = { x: sprite.x, y: sprite.y };
        },
        _firstFoot: sprite => sprite._huFoot,
      }, WorldLayers);
    const source = {};
    const sprite = (object, depth, visible = true) => ({ visible, alpha: 1, depth,
      x: 32, y: 32, rotation: 0, _huFoot: { x: 32, y: 32 }, scaleX: 1, scaleY: 1, displayOriginX: 8, displayOriginY: 16,
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
  test('cover scenery: only visible blocker and actor subtract their silhouettes', () => {
    const f = fixture(); f.run(f.scene, f.cover);
    assert.eq(f.scene._coverScenery.rows.length, 2, 'covered scenery and hidden actors never become silhouettes');
    assert.eq(JSON.stringify(f.sight), '[[0,0,5,0],[0,0,20,0]]');
    assert.eq(f.cover.canvas.width, 200, 'source field remains separate');
    const output = f.calls.filter(call => call.canvas === f.canvases[0]);
    assert.eq(output[0].op, 'copy', 'begin with the finished pulled-back hatch');
    assert.truthy(output.slice(1).every(call => call.op === 'destination-out'), 'protection only removes hatch and cannot refill the clear band');
  });
  test('cover scenery: still frame reuses canvas and revision, movement retests exact body', () => {
    const f = fixture(), first = f.run(f.scene, f.cover), commands = f.calls.length;
    assert.eq(f.run(f.scene, f.cover).revision, first.revision);
    assert.eq(f.calls.length, commands, 'no repaint on still frame');
    assert.eq(f.sight.length, 2, 'no repeated rays on still frame');
    f.scene.player.x = 15;
    const changed = f.run(f.scene, f.cover);
    assert.truthy(changed.revision !== first.revision, 'body change within field cache can change scenery sight');
    assert.eq(f.scene._coverScenery.rows.length, 3, 'newly visible rear scenery joins the protected silhouettes');
    assert.eq(f.canvases.length, 2, 'reuses the two scratch canvases');
  });
  test('cover scenery: covered scenery never alters the pulled-back mask', () => {
    const f = fixture();
    f.scene.worldContainer.list = [f.far];
    const result = f.run(f.scene, f.cover);
    assert.eq(f.scene._coverScenery.rows.length, 0);
    const output = f.calls.filter(call => call.canvas === result.canvas);
    assert.eq(output.length, 1, 'only copy the original hatch; never fill or replace covered scenery');
    assert.eq(output[0].op, 'copy');
    assert.eq(output[0].args[0], f.cover.canvas);
    f.far._staticObject.x = 5;
    f.run(f.scene, f.cover);
    assert.eq(f.scene._coverScenery.rows.length, 1, 'moving a blocker into sight refreshes its protection');
    f.far._staticObject.x = 20;
    f.run(f.scene, f.cover);
    assert.eq(f.scene._coverScenery.rows.length, 0, 'moving it behind cover removes only its protection');
  });
  test('cover scenery: heading transforms align silhouettes and restore live sprite state', () => {
    const f = fixture(Math.PI / 4), before = f.scene.worldContainer.list.map(sprite =>
      [sprite, sprite.x, sprite.y, sprite.rotation, sprite._huFoot]);
    const order = f.scene.worldContainer.list.slice();
    const result = f.run(f.scene, f.cover);
    assert.eq(f.scene._coverScenery.rows[0][9], 42, 'mask uses the temporarily upright sprite transform');
    assert.eq(f.scene._coverScenery.rows[0][10], 27);
    for (let i = 0; i < before.length; i++) {
      const [sprite, x, y, rotation, foot] = before[i];
      assert.eq(sprite.x, x); assert.eq(sprite.y, y); assert.eq(sprite.rotation, rotation);
      assert.eq(sprite._huFoot, foot, 'restore the original grounding record');
      assert.eq(f.scene.worldContainer.list[i], order[i], 'do not reorder the live display list');
    }
    assert.eq(f.run(f.scene, f.cover).revision, result.revision, 'stable heading reuses the protected hatch');
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
