// The road chip in the top HUD row: the road-repair ladder at a glance. Its
// numbers are Trail.progress over save.trail — the same pair the on-street
// counter prints — so the chip and the counter can't disagree.

test('road chip: reads the ladder through Trail.progress, Runner rungs included', () => {
  const app = APP_JS_SRC;
  assert.truthy(/roadChipProgress\(\) \{[\s\S]{0,200}?Trail\.progress\(st\.metres, st\.prizes, this\.save\?\.playerClass\)/.test(app),
    'the chip reads Trail.progress with the player\'s class');
  assert.truthy(/this\._buildMemoriesChip\(\);\s*this\._buildRoadChip\(\);/.test(app), 'built beside the memories chip');
  assert.truthy(/this\.updateMemoriesDOM\(\);\s*this\.updateRoadChipDOM\(\);/.test(app), 'repainted with the HUD');
  assert.truthy(/body\.modal-open #roadchip \{ opacity: 0\.25; pointer-events: none; \}/.test(app), 'dims under a dialog like its neighbours');
  // The numbers it would show, straight off the ladder.
  const p = Trail.progress(120, 1);
  assert.eq(p.target, 400, 'the second prize wants 400 m');
  assert.eq(Trail.progress(120, 1, 'runner').target, 200, 'a runner\'s rung is half');
});
