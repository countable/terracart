// THE STORY PAUSE: while a story dialog is up (app.js _storyDialogOpen) the
// player takes no damage — Conditions.setDialogShield feeds the one immunity
// every damage site asks (damageImmune) — and hostiles hold still
// (scene_creatures.js wanderCreatures). Shops stay dangerous.
(function () {
  test('story pause: the dialog shield makes that save immune, and only that save', () => {
    const save = { energy: 50 }, other = { energy: 50 }, foe = { kind: 'goblin' };
    assert.falsy(Conditions.damageImmune(save));
    Conditions.setDialogShield(save, true);
    assert.truthy(Conditions.damageImmune(save), 'shielded while the story is open');
    assert.truthy(Conditions.fireImmune(save), 'fire too');
    assert.falsy(Conditions.damageImmune(other), 'another save is not');
    assert.falsy(Conditions.damageImmune(foe), 'a creature never is');
    assert.eq(Combat.incomingDamage(save, 10), 0, 'a blow lands for nothing');
    assert.falsy('dialogShield' in save, 'nothing is written into the save');
    Conditions.setDialogShield(save, false);
    assert.falsy(Conditions.damageImmune(save), 'closing the story lifts it');
    assert.gt(Combat.incomingDamage(save, 10), 0);
  });

  test('story pause: story kinds and overlays pause; a shop does not', () => {
    const kinds = SCENE_SRC.match(/const STORY_DIALOG_KINDS = new Set\(\[([^\]]*)\]\)/)[1];
    for (const k of ['story', 'note', 'memory']) assert.truthy(kinds.includes(`'${k}'`), k);
    for (const k of ['shop', 'trade', 'forge']) assert.falsy(kinds.includes(`'${k}'`), k);
    const ids = SCENE_SRC.match(/const STORY_DIALOG_IDS = new Set\(\[([^\]]*)\]\)/)[1];
    assert.truthy(ids.includes("'story'") && ids.includes("'howto'"));
    assert.truthy(/this\._storyPause = this\._storyDialogOpen\(\);\s*Conditions\.setDialogShield\(this\.save, this\._storyPause\);/.test(SCENE_SRC),
      'read each frame and fed to the shield');
    assert.truthy(/if \(enemy && this\._storyPause\) \{ c\._moving = false; Combat\.cancelCreatureAction\(c\); return; \}/.test(SCENE_SRC),
      'hostiles hold still and drop their wind-up');
  });
})();
