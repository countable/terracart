(() => {
  const SL = SpriteLayout;
  test('player art: unassigned and unknown classes use the cyan farmer', () => {
    for (const save of [undefined, null, {}, { playerClass: 'wizard' },
      { playerClass: 'mounted' }, { playerClass: '__proto__' }, { playerClass: 'constructor' }]) {
      assert.eq(SL.playerArt(save, 1000), SL.PLAYER_ART.farmer);
    }
  });

  test('player art: each calling activates only after the wizard accepts its purchase', () => {
    const paths = { hunter: 'BowmanCyan.png', runner: 'AssasinCyan.png',
      enforcer: 'SwordsmanCyan.png', enchanter: 'MageCyan.png' };
    for (const cls of Wizard.CLASSES) {
      const save = { memories: 0, wizardBuys: 2, relicSalt: 12345, relics: {} };
      assert.eq(Wizard.buy(save, cls.key), null, 'unaffordable calling is refused');
      assert.eq(SL.playerArt(save, 1000), SL.PLAYER_ART.farmer, 'refusal does not change appearance');
      save.memories = Wizard.CLASS_COST;
      assert.truthy(Wizard.buy(save, cls.key), cls.key + ' purchase');
      const art = SL.playerArt(save, 1000);
      assert.eq(art, SL.PLAYER_ART[cls.key]);
      assert.truthy(art.path.endsWith(paths[cls.key]), cls.key + ' uses its intended character');
      assert.eq(SL.playerArt(JSON.parse(JSON.stringify(save)), 1000), art, 'restored save needs no extra skin flag');
    }
  });

  test('player art: bicycle temporarily overrides every calling and restores it at exact expiry', () => {
    for (const playerClass of [undefined, ...Wizard.CLASSES.map(c => c.key)]) {
      const save = { playerClass, bikeUntil: 2000 };
      assert.eq(SL.playerArt(save, 1999), SL.PLAYER_ART.mounted);
      assert.eq(SL.playerArt(save, 2000), SL.PLAYER_ART[playerClass] || SL.PLAYER_ART.farmer);
      assert.eq(SL.playerArt(save, 2001), SL.PLAYER_ART[playerClass] || SL.PLAYER_ART.farmer);
      assert.eq(save.playerClass, playerClass, 'mounting never replaces the saved calling');
    }
  });

  test('player art: directional frame lists fit the real sheets and avoid unused Mage columns', () => {
    for (const [kind, art] of Object.entries(SL.PLAYER_ART)) {
      const dims = pngDims(art.path);
      assert.truthy(dims, kind + ' asset exists');
      assert.eq(dims.w % art.fw, 0); assert.eq(dims.h % art.fh, 0);
      const count = dims.w / art.fw * dims.h / art.fh;
      for (const dir of ['down', 'up', 'left', 'right']) {
        const pose = art.directions[dir];
        assert.truthy(pose, kind + ' has authored ' + dir);
        for (const state of ['idle', 'walk']) {
          assert.gt(pose[state].length, 0);
          for (const frame of pose[state]) {
            assert.truthy(Number.isInteger(frame) && frame >= 0 && frame < count, kind + '/' + dir + '/' + state);
            if (kind === 'enchanter') assert.truthy(frame % 6 < 4, 'Mage columns 4 and 5 are blank');
          }
        }
      }
    }
  });

  // Execute the shipping scene methods with a small sprite stub. This checks
  // texture switching, fallback, and direction retention without Phaser/GPS.
  const sceneMethod = (name) => {
    const source = SCENE_SRC.match(new RegExp('^  ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'))[0];
    return new Function('SpriteLayout', 'PLAYER_FEET_DROP_PX', 'Lighting', 'WALK_TIRED_SLOW_MUL',
      'PlayerRobeArt', 'return ({' + source + '}).' + name)(SL, 12, { lowEnergyFrac: () => 0 }, 0.5,
        { resolve: (scene, art, color) => scene._playerRobeArt?.get(art.sheet)?.get(color) || art });
  };
  const sync = sceneMethod('_syncPlayerSkin'), play = sceneMethod('_playDirected');
  const makeScene = (save) => {
    const player = {
      anims: {}, setScale(n) { this.scale = n; },
      setFlipX(v) { this.flipX = v; }, play(key) { this.anims.currentAnim = { key }; },
    };
    return { save, player, playerScale: 1, _spriteDir: { x: 0, y: 1 },
      textures: { exists: () => true }, anims: { get: () => ({ frames: [1] }) },
      _syncPlayerSkin: sync, _idleGlance: () => null };
  };

  test('player art: directional playback uses authored sides and keeps facing when stopped', () => {
    const scene = makeScene({ playerClass: 'runner' });
    play.call(scene, scene.player, 'walk', -1, 0);
    assert.eq(scene.player.anims.currentAnim.key, 'player_runner-walk-left');
    assert.eq(scene.player.flipX, false);
    play.call(scene, scene.player, 'idle');
    assert.eq(scene.player.anims.currentAnim.key, 'player_runner-idle-left');
    play.call(scene, scene.player, 'walk', 1, 0);
    assert.eq(scene.player.anims.currentAnim.key, 'player_runner-walk-right');
    assert.eq(scene.player.scale, SL.PLAYER_ART.runner.scale);
    assert.eq(scene.playerFeetNudgeY, -SL.PLAYER_ART.runner.footDrop * SL.PLAYER_ART.runner.scale);
  });

  test('player art: cached robe colours retain class, facing, mount and animation geometry', () => {
    const scene = makeScene({ playerClass: 'runner', playerColor: Multiplayer.COLORS[0] });
    const art = SL.PLAYER_ART.runner;
    const robe = { ...art, sheet: art.sheet + '_robe_ffd28a', robeColor: scene.save.playerColor };
    scene._playerRobeArt = new Map([[art.sheet, new Map([[scene.save.playerColor, robe]])]]);
    play.call(scene, scene.player, 'walk', -1, 0);
    assert.eq(scene._playerArt, robe);
    assert.eq(scene.player.anims.currentAnim.key, robe.sheet + '-walk-left');
    assert.eq(scene.playerFeetNudgeY, -art.footDrop * art.scale);
    scene.save.playerColor = Multiplayer.COLORS[1];
    play.call(scene, scene.player, 'idle');
    assert.eq(scene.player.anims.currentAnim.key, art.sheet + '-idle-left');
    scene.save.bikeUntil = Date.now() + 10000;
    play.call(scene, scene.player, 'walk', 0, -1);
    assert.eq(scene._playerArt, SL.PLAYER_ART.mounted);
    assert.eq(scene.save.playerClass, 'runner');
  });

  test('player art: asset load reads pixels once and caches every swatch with only cloth changed', () => {
    const pixels = new Uint8ClampedArray([
      52, 154, 164, 255, 78, 188, 185, 255, 108, 216, 213, 128,
      211, 160, 97, 255, 129, 129, 129, 255, 0, 0, 0, 0,
    ]);
    let reads = 0;
    const output = [];
    const document = { createElement: () => ({ getContext: () => ({
      drawImage() {}, getImageData() { reads++; return { data: pixels.slice() }; },
      putImageData(image) { output.push(Array.from(image.data)); },
    }) }) };
    const window = {};
    new Function('window', 'EnemyRoster', 'SpriteLayout', 'Multiplayer', 'document', ASSETS_SRC)(
      window, EnemyRoster, SL, Multiplayer, document);
    const textures = new Set(), animations = [];
    const scene = {
      textures: { get: () => ({ getSourceImage: () => ({ width: 6, height: 1 }) }),
        exists: key => textures.has(key), addSpriteSheet: key => textures.add(key) },
      _createAnim: (...args) => animations.push(args),
    };
    const art = SL.PLAYER_ART.runner;
    window.ASSETS[art.sheet].onLoad(scene);
    window.ASSETS[art.sheet].onLoad(scene);
    assert.eq(reads, 1, 'no second read or crossing-time baking');
    assert.eq(textures.size, Multiplayer.COLORS.length);
    assert.eq(animations.length, Multiplayer.COLORS.length * 8);
    for (let i = 0; i < Multiplayer.COLORS.length; i++) {
      const color = Multiplayer.COLORS[i], result = output[i];
      assert.eq(result.slice(4, 7).join(), [color >> 16 & 255, color >> 8 & 255, color & 255].join());
      assert.eq(result.slice(12).join(), Array.from(pixels.slice(12)).join(), 'skin, metal and transparent pixels unchanged');
      assert.eq(result[11], 128, 'cloth alpha unchanged');
      const variant = window.PlayerRobeArt.resolve(scene, art, color);
      assert.eq(variant.directions, art.directions);
      assert.eq(variant.robeColor, color);
    }
  });

  test('player art: standing still keeps the last walking direction, whatever the compass says', () => {
    const scene = makeScene({ playerClass: 'runner' });
    play.call(scene, scene.player, 'walk', -1, 0);
    scene.compassDeg = 20; scene.facing = { x: 0.34, y: -0.94 };
    play.call(scene, scene.player, 'idle');
    assert.eq(scene.player.anims.currentAnim.key, 'player_runner-idle-left', 'turning the phone never spins the sprite');
    play.call(scene, scene.player, 'walk', 0, 1);
    assert.eq(scene.player.anims.currentAnim.key, 'player_runner-walk-down');
  });

  test('player art: the opening glance looks down, left, right and down, then hands over to walking', () => {
    const source = SCENE_SRC.match(/^  _idleGlance\(\) \{[\s\S]*?^  \}/m)[0];
    const GLANCE = (APP_JS_SRC.match(/static PLAYER_GLANCE = (\[[\s\S]*?\]);/) || [])[1];
    assert.truthy(GLANCE, 'one table holds the glance');
    let now = 0;
    const glance = new Function('MapScene', 'HeadingUp', 'performance', 'return ({' + source + '})._idleGlance')(
      { PLAYER_GLANCE: eval(GLANCE) }, { toWorldVec: (s, x, y) => ({ x, y }) }, { now: () => now });
    const scene = makeScene({ playerClass: 'runner' });
    scene._idleGlance = glance;
    let open = true;
    scene._dialogOpen = () => open;
    const pose = () => { play.call(scene, scene.player, 'idle'); return scene.player.anims.currentAnim.key.split('-').pop(); };
    now = 5000;
    assert.eq(pose(), 'down', 'faces the camera while a dialog covers the map');
    open = false;
    const seen = [];
    for (now = 6000; now < 9000; now += 50) { const p = pose(); if (seen[seen.length - 1] !== p) seen.push(p); }
    assert.eq(seen.join(','), 'down,left,right,down', 'the look round, once');
    play.call(scene, scene.player, 'walk', 1, 0);
    assert.eq(pose(), 'right', 'from then on the pose is the last step');
  });

  test('player art: unavailable sheet or animations safely fall back to the cyan farmer', () => {
    // The farmer is the base sheet every save starts on: while a calling's
    // sheet or cycles are missing, its authored four-direction cycles stand
    // in — never a mirrored side pose, never the retired Idle/Walk sheets.
    const scene = makeScene({ playerClass: 'hunter' });
    scene.textures.exists = () => false;
    play.call(scene, scene.player, 'walk', -1, 0);
    assert.eq(scene.player.anims.currentAnim.key, 'player_farmer-walk-left');
    assert.eq(scene.player.flipX, false); assert.eq(scene.player.scale, 1);
    scene.textures.exists = () => true; scene.anims.get = () => null;
    play.call(scene, scene.player, 'idle', 0, -1);
    assert.eq(scene.player.anims.currentAnim.key, 'player_farmer-idle-up');
    assert.eq(scene._playerArt, null);
  });

  test('player art: the retired Idle/Walk sheets are gone, and nothing asks for them', () => {
    assert.falsy(pngDims('assets/Character/Idle.png'), 'Idle.png deleted');
    assert.falsy(pngDims('assets/Character/Walk.png'), 'Walk.png deleted');
    assert.falsy(/Idle\.png|Walk\.png|'idle-down'|'walk-side'|`\$\{baseKey\}-\$\{dir\}`/.test(SCENE_SRC), 'app.js');
    assert.falsy(/Idle\.png|Walk\.png|'idle-down'|`\$\{base\}-\$\{dir\}`/.test(ALL_SRC['multiplayer.js']), 'multiplayer.js');
    assert.falsy(/Character\/(Idle|Walk)\.png/.test(ALL_SRC['assets.js']), 'assets.js');
    assert.falsy(/Idle\.png|Walk\.png/.test(INDEX_HTML_SRC), 'the how-to card');
    assert.truthy(/FarmerCyan\.png/.test(INDEX_HTML_SRC), 'which walks the cyan farmer instead');
    // The base constants app.js keeps for the body are the farmer's own row.
    const f = SL.PLAYER_ART.farmer;
    assert.eq(PLAYER_FEET_DROP_PX, f.footDrop); assert.eq(PLAYER_FRAME_PX, f.fh); assert.eq(PLAYER_ART_SCALE, f.scale);
  });

  test('player art: dragon remains visually dominant over an active bicycle', () => {
    const scene = makeScene({ playerClass: 'enchanter', bikeUntil: Date.now() + 60000 });
    scene._dragonActive = true; scene.dragonScale = 2; scene.player.scale = 2;
    play.call(scene, scene.player, 'walk', -1, 0);
    assert.eq(scene.player.anims.currentAnim.key, 'dragon-fly');
    assert.eq(scene.player.flipX, true); assert.eq(scene.player.scale, 2);
    scene._dragonActive = false;
    play.call(scene, scene.player, 'idle');
    assert.eq(scene.player.anims.currentAnim.key, 'player_mounted-idle-left');
    scene.save.bikeUntil = 0;
    play.call(scene, scene.player, 'idle');
    assert.eq(scene.player.anims.currentAnim.key, 'player_enchanter-idle-left');
  });
})();
