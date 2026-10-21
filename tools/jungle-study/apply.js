window.applyJungle = async () => {
  const s = __scene;
  async function load(src) {
    const im = new Image();
    im.src = src;
    await im.decode();
    return im;
  }
  const root =
    '/extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets/';
  const jungle = await load(root + 'RA_Jungle.png'),
    water = await load(root + 'RA_Animated_Water.png');
  const ids = ['grass', 'olive', 'bridge', 'lamp'];
  const images = {};
  for (const id of ids) images[id] = await load('/__jungle/crops/' + id + '.png');
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 80;
    c.getContext('2d').drawImage(jungle, i * 64, 0, 64, 80, 0, 0, 64, 80);
    images['tree' + i] = c;
  }
  for (const [id, r] of Object.entries({
    rocktiny: [368, 560],
    rockmid: [432, 560],
    rockbig: [352, 496],
  })) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    c.getContext('2d').drawImage(jungle, ...r, 16, 16, 0, 0, 16, 16);
    images[id] = c;
  }
  for (const [id, img] of Object.entries(images)) {
    s.textures.addImage('jungle_' + id, img);
  }
  const spec = Render.objectAppearance(s, {}).RENDER_SPEC;
  spec.tree = {
    ...spec.tree,
    key: (o) => 'jungle_tree' + o.jungleIndex,
    frame: 0,
    scale: 2,
    origin: [0, 0],
    seat: false,
    groundAtOrigin: true,
    dxPx: (o) => o.jungleOffset[0],
    dyPx: (o) => o.jungleOffset[1],
    shadow: false,
  };
  spec.torch = { ...spec.torch, key: 'jungle_lamp', frame: 0, scale: 2, shadow: false };
  spec.mineralrock = {
    ...spec.mineralrock,
    key: (o) => 'jungle_rock' + o.jungleRock,
    frame: 0,
    scale: 2,
    origin: [0.5, 0.5],
    seat: false,
    groundAtOrigin: true,
    dxPx: 0,
    dyPx: 0,
    shadow: false,
  };
  const oldProps = Render.drawLowPolyProps;
  Render.drawLowPolyProps = (sc, items) =>
    oldProps(
      sc,
      items.filter((it) => !it.o.jungleRock),
    );
  const oldTint = Render.spriteTint;
  Render.spriteTint = (o, sc, key) => (o.jungleRock ? 0xffffff : oldTint(o, sc, key));
  s._objectAppearanceOwner = {};
  const options = {
    x: 80,
    y: 528,
    tileSize: 16,
    inner: { nw: [144, 544], ne: [128, 544], sw: [144, 528], se: [128, 528] },
  };
  const atlas = JungleAutotile.buildDualAtlas(jungle, options);
  const calm = document.createElement('canvas');
  calm.width = water.width;
  calm.height = water.height;
  const wc = calm.getContext('2d');
  wc.drawImage(water, 0, 0);
  const wd = wc.getImageData(0, 0, calm.width, calm.height);
  for (let i = 0; i < wd.data.length; i += 4) {
    const r = wd.data[i],
      g = wd.data[i + 1],
      b = wd.data[i + 2];
    if (wd.data[i + 3] && g > r && b >= g * 0.85 && g >= 70) {
      wd.data[i] = 53;
      wd.data[i + 1] = 75;
      wd.data[i + 2] = 76;
    }
  }
  wc.putImageData(wd, 0, 0);
  const waterAtlas = JungleAutotile.buildDualAtlas(calm, {
    x: 0,
    y: 64,
    tileSize: 16,
    inner: { nw: [32, 48], ne: [0, 48], sw: [32, 16], se: [0, 16] },
  });
  // Bake one bounded atlas before drawing. Cell crossings only select frames.
  const combined = document.createElement('canvas');
  combined.width = combined.height = 256;
  const combinedContext = combined.getContext('2d');
  combinedContext.imageSmoothingEnabled = false;
  for (let om = 0; om < 16; om++)
    for (let wm = 0; wm < 16; wm++) {
      const x = wm * 16,
        y = om * 16;
      combinedContext.drawImage(images.grass, x, y);
      for (const [a, m] of [
        [atlas, om],
        [waterAtlas, wm],
      ]) {
        const f = a.frames[m];
        combinedContext.drawImage(a.canvas, f.x, f.y, 16, 16, x, y, 16, 16);
      }
    }
  const groundTexture = s.textures.addCanvas('jungle_ground', combined);
  for (let om = 0; om < 16; om++)
    for (let wm = 0; wm < 16; wm++) groundTexture.add(om * 16 + wm, 0, wm * 16, om * 16, 16, 16);
  const cells = new Map(__fixture.grid.map((c) => [c.x + ',' + c.y, c.groundType]));
  const get = (x, y) => cells.get(x + ',' + y) ?? 1;
  window.__jungleGround = () => {
    s.borderGfx.clear();
    s.borderContainer.setVisible(false);
    s.cellGfx.clear();
    for (const ns of s.noisePool) {
      if (!ns.visible) continue;
      const x = Math.round((ns.x - s.viewCenterX) / 32),
        y = Math.round((ns.y - s.viewCenterY + 26) / 32);
      const om = JungleAutotile.dualMaskAt(x, y, get, (v) => v === 4),
        wm = JungleAutotile.dualMaskAt(x, y, get, (v) => v === 3);
      ns.setTexture('jungle_ground', om * 16 + wm)
        .setDisplaySize(32, 32)
        .setAlpha(1)
        .clearTint()
        .setPosition(ns.x + 32, ns.y + 32);
    }
    for (const cs of s.cobblePool || [])
      if (cs.visible) cs.setTexture('jungle_bridge').setDisplaySize(32, 32);
  };
  __draw();
  window.__jungleAtlasAudit = {
    algorithm: 'dual-grid marching squares',
    masks: 16,
    groundMaskField: 'groundType',
    combinedGroundFrames: Object.keys(groundTexture.frames).length - 1,
    sourceTilePixels: 16,
    displayTilePixels: 32,
    sourceArtResampled: false,
    water:
      'source palette dominant pigment replaces animated ripple pixels for reference calm water',
  };
};
