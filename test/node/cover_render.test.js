// Rendering must conceal the same covered targets as interactions (any cover
// hides what stands behind it) and reuse its hatch mask between changes.
(function () {
  function fixture(coverAt = () => 2) {
    let revision = 1, allocations = 0, clears = 0, samples = 0, uploads = 0, blits = 0, images = 0;
    const rasters = [], strokes = [];
    const document = { createElement(kind) {
      assert.eq(kind, 'canvas'); allocations++;
      const ctx = {
        globalAlpha: 1,
        clearRect() { clears++; },
        createImageData(width, height) {
          images++;
          return { width, height, data: new Uint8ClampedArray(width * height * 4) };
        },
        putImageData(image) {
          uploads++;
          rasters.push({ width: image.width, height: image.height, data: Array.from(image.data) });
        },
        drawImage() { blits++; },
        fillRect() {},
        beginPath() { this.lines = []; },
        moveTo(x, y) { this.from = [x, y]; },
        lineTo(x, y) { this.lines.push([this.from, [x, y]]); },
        stroke() { strokes.push({ colour: this.strokeStyle, width: this.lineWidth,
          alpha: this.globalAlpha, lines: this.lines }); },
        getImageData() { throw new Error('Cover must never read pixels back'); },
      };
      return { width: 0, height: 0, getContext: () => ctx };
    } };
    const visibility = { CLEAR: 0, PARTIAL: 1, FULL: 2, PARTIAL_DARKNESS: .5, FULL_DARKNESS: 1,
      revision: () => revision,
      observer(scene, q) { const p = scene.playerM; return { x: (Math.floor(p.x / q) + .5) * q, y: (Math.floor(p.y / q) + .5) * q }; },
      sightCover(scene, ax, ay, x, y) { samples++; return coverAt(x, y); },
    };
    const start = LIGHTING_SRC.indexOf('  function coverFrame(scene, ax, ay, W, H) {');
    const end = LIGHTING_SRC.indexOf('\n  function draw(scene, ax, ay, halfM) {', start);
    assert.gte(start, 0, 'fog mask helpers exist');
    const frame = new Function('Combat', 'Visibility', 'document', 'playerWorldM', 'CELL_PX', 'FOG_SUB', 'fogWisp', 'fogSample',
      LIGHTING_SRC.slice(start, end) + '\nreturn coverFrame;')(
      Combat, visibility, document, scene => scene.playerM, 32, FOG_SUB, fogWisp, fogSample);
    const scene = { depth: 0, cellM: 4, playerM: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      viewCenterX: 0, viewCenterY: 0, viewLeft: 0, viewTop: 0 };
    return { scene, frame, rasters, strokes, bumpRevision() { revision++; },
      stats: () => ({ allocations, clears, samples, uploads, blits, images }) };
  }


  test('cover render: downed view drops obstruction shading and restores it on revival', () => {
    const f = fixture(() => 1);
    f.scene.save = { energy: 10 };
    const alive = f.frame(f.scene, 0, 0, 128, 64);
    assert.truthy(alive);
    f.scene.save.energy = 0;
    assert.eq(f.frame(f.scene, 0, 0, 128, 64), null);
    f.scene.save.energy = 1;
    assert.eq(f.frame(f.scene, 0, 0, 128, 64).key, alive.key);
  });

  const alphas = raster => raster.data.filter((value, i) => i % 4 === 3);

  test('cover render: covered targets are removed in place, clear targets keep their order', () => {
    const start = RENDER_SRC.indexOf('Render.coverHidden = function');
    const end = RENDER_SRC.indexOf('\nRender.drawObjects =', start);
    const render = new Function('Visibility',
      'const Render = {};\n' + RENDER_SRC.slice(start, end) + '\nreturn Render;')(
      { hidden: (scene, x) => x !== 0 });
    for (const field of ['o', 'p', 'tr', 'h']) {
      const list = [2, 0, 1, 0, 2].map((x, i) => ({ [field]: { x, y: i } }));
      const first = list[1], second = list[3], original = list;
      render.cullCovered({}, list, field);
      assert.eq(list, original, 'reuse the existing sprite list');
      assert.eq(list.length, 2);
      assert.eq(list[0], first);
      assert.eq(list[1], second);
      assert.truthy(render.coverHidden({}, { x: 1, y: 0 }), 'partial cover hides');
      assert.truthy(render.coverHidden({}, { x: 2, y: 0 }));
    }
  });

  test('cover render: partial and full cover use a hard mask at either depth', () => {
    for (const [cover, depth, alpha] of [[0, 0, 0], [1, 0, 255], [2, 0, 255], [1, 1, 255], [2, 1, 255]]) {
      const f = fixture(() => cover);
      f.scene.depth = depth;
      f.frame(f.scene, 0, 0, 128, 64);
      const raster = f.rasters[0];
      assert.eq(raster.data[raster.data.length - 1], alpha, `cover ${cover}, depth ${depth}: far interior`);
      assert.truthy(alphas(raster).every(a => a === 0 || a === 255), 'no softened mask boundary');
      const stroke = f.strokes[0];
      assert.eq(stroke.colour, 'rgb(24,29,26)');
      assert.eq(stroke.width, 2);
      assert.eq(stroke.alpha, .32);
      for (const [[x0,y0],[x1,y1]] of stroke.lines) {
        assert.gt(y1,y0); assert.eq(x1-x0, -(y1-y0), 'single-direction 45 degree diagonals');
      }
    }
  });

  test('cover render: one-cell pullback excludes the nearest covered band and thin strips', () => {
    const f = fixture(x => x < 8 ? 0 : 1);
    f.frame(f.scene, 0, 0, 128, 64);
    const raster = f.rasters[0];
    const at = (x,y) => raster.data[(y*raster.width+x)*4+3];
    // Half-cell samples x=6,7,8 have world centres 9,11,13 metres.
    assert.eq(at(5,2), 0, 'clear ground');
    assert.eq(at(6,2), 0, 'first hidden half-cell omitted');
    assert.eq(at(7,2), 0, 'second hidden half-cell omitted');
    assert.eq(at(8,2), 255, 'cover beyond one full cell retained');
    const thin = fixture(x => Math.abs(x-9)<1 ? 1 : 0);
    thin.frame(thin.scene,0,0,128,64);
    assert.truthy(alphas(thin.rasters[0]).every(a=>a===0), 'a thin strip cannot bridge clear inward samples');
  });

  test('cover render: mask and diagonal phase remain world-aligned when the camera scrolls', () => {
    const f = fixture(x => x < 8 ? 0 : 2);
    f.frame(f.scene,0,0,128,64);
    const initial=f.rasters[0], first=f.strokes[0];
    f.frame(f.scene,2,0,128,64);
    const scrolled=f.rasters[1],second=f.strokes[1];
    for(let y=0;y<initial.height;y++)for(let x=0;x<initial.width-1;x++){
      assert.eq(initial.data[(y*initial.width+x+1)*4+3],scrolled.data[(y*scrolled.width+x)*4+3]);
    }
    const period=12*Math.SQRT2;
    const phaseShift=((second.lines[0][0][0]-first.lines[0][0][0]+16)%period+period)%period;
    assert.lt(Math.min(phaseShift,period-phaseShift),1e-9,'diagonal phase shifts by one half-cell with the window');
  });

  test('cover render: stationary and subcell camera frames reuse the mask; movement, depth and blockers redraw', () => {
    const f = fixture();
    const first = f.frame(f.scene, 0, 0, 128, 64);
    const samples = f.stats().samples;
    const still = f.frame(f.scene, 0, 0, 128, 64);
    assert.eq(still.canvas, first.canvas);
    assert.eq(still.key, first.key);
    assert.eq(f.stats().samples, samples, 'stationary frames perform no sight sampling');
    assert.eq(f.stats().uploads, 1);
    assert.eq(f.stats().blits, 1);
    const camera = f.frame(f.scene, .25, 0, 128, 64);
    assert.eq(camera.canvas, first.canvas);
    assert.eq(f.stats().uploads, 1, 'subcell camera movement changes only the final blit position');
    assert.eq(f.stats().blits, 1, 'no raster scaling while the world-aligned mask is reusable');
    assert.eq(f.stats().samples, samples);
    assert.eq(camera.x - first.x, -2);
    assert.truthy(camera.key !== first.key, 'lightmap must upload the changed blit position');
    f.scene.playerM.x = .25;
    const glide = f.frame(f.scene, .25, 0, 128, 64);
    assert.eq(f.stats().uploads, 1, 'movement inside one eighth-cell observer step reuses the mask');
    assert.eq(glide.key, camera.key);
    f.scene.playerM.x = .5;
    const moved = f.frame(f.scene, .25, 0, 128, 64);
    assert.eq(f.stats().uploads, 2, 'an observer step changes sight');
    assert.truthy(moved.key !== camera.key);
    f.bumpRevision();
    const changed = f.frame(f.scene, .25, 0, 128, 64);
    assert.eq(f.stats().uploads, 3, 'mining or removing a blocker changes sight');
    assert.truthy(changed.key !== moved.key);
    f.scene.depth = 1;
    const cave = f.frame(f.scene, .25, 0, 128, 64);
    assert.eq(f.stats().uploads, 4, 'depth changes darkness and geometry');
    assert.truthy(cave.key !== changed.key);
    assert.eq(f.stats().allocations, 2, 'all updates reuse the raster canvas and scaled mask canvas');
    assert.eq(f.stats().images, 1, 'redraws reuse the existing pixel array');
  });
})();
