(() => {
  const SL = SpriteLayout;
  test('player art: unassigned and unknown classes keep the original player', () => {
    for (const save of [undefined, null, {}, { playerClass: 'wizard' },
      { playerClass: 'mounted' }, { playerClass: '__proto__' }, { playerClass: 'constructor' }]) {
      assert.eq(SL.playerArt(save, 1000), null);
    }
  });

  test('player art: each calling activates only after the wizard accepts its purchase', () => {
    const paths = { hunter: 'BowmanCyan.png', runner: 'AssasinCyan.png',
      enforcer: 'SwordsmanCyan.png', enchanter: 'MageCyan.png' };
    for (const cls of Wizard.CLASSES) {
      const save = { memories: 0, wizardBuys: 2, relicSalt: 12345, relics: {} };
      assert.eq(Wizard.buy(save, cls.key), null, 'unaffordable calling is refused');
      assert.eq(SL.playerArt(save, 1000), null, 'refusal does not change appearance');
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
      assert.eq(SL.playerArt(save, 2000), SL.PLAYER_ART[playerClass] || null);
      assert.eq(SL.playerArt(save, 2001), SL.PLAYER_ART[playerClass] || null);
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
    const source = APP_JS_SRC.match(new RegExp('^  ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'))[0];
    return new Function('SpriteLayout', 'PLAYER_FEET_DROP_PX', 'Lighting', 'WALK_TIRED_SLOW_MUL',
      'return ({' + source + '}).' + name)(SL, 12, { lowEnergyFrac: () => 0 }, 0.5);
  };
  const sync = sceneMethod('_syncPlayerSkin'), play = sceneMethod('_playDirected');
  const makeScene = (save) => {
    const player = {
      anims: {}, setScale(n) { this.scale = n; },
      setFlipX(v) { this.flipX = v; }, play(key) { this.anims.currentAnim = { key }; },
    };
    return { save, player, playerScale: 1, _spriteDir: { x: 0, y: 1 },
      textures: { exists: () => true }, anims: { get: () => ({ frames: [1] }) },
      _syncPlayerSkin: sync };
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

  test('player art: unavailable sheet or animations safely fall back to original art', () => {
    const scene = makeScene({ playerClass: 'hunter' });
    scene.textures.exists = () => false;
    play.call(scene, scene.player, 'walk', -1, 0);
    assert.eq(scene.player.anims.currentAnim.key, 'walk-side');
    assert.eq(scene.player.flipX, true); assert.eq(scene.player.scale, 1);
    scene.textures.exists = () => true; scene.anims.get = () => null;
    play.call(scene, scene.player, 'idle', 0, -1);
    assert.eq(scene.player.anims.currentAnim.key, 'idle-up');
    assert.eq(scene._playerArt, null);
  });

  test('player art: dragon remains visually dominant over an active bicycle', () => {
    const scene = makeScene({ playerClass: 'enchanter', bikeUntil: Date.now() + 60000 });
    scene._dragonActive = true; scene.player.scale = 2;
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
