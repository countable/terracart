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

test('road chip: the tap hint adds every metre restored (Trail.totalMetres)', () => {
  // Paid goals 200 + 400, plus 120 banked toward the third.
  assert.eq(Trail.totalMetres(120, 2), 720);
  assert.eq(Trail.totalMetres(120, 2, 'runner'), 420, 'a runner\'s paid rungs are half');
  assert.eq(Trail.totalMetres(0, 0), 0);
  assert.eq(Trail.distanceLabel(0), '0km');
  assert.eq(Trail.distanceLabel(720), '0.72km');
  assert.eq(Trail.distanceLabel(1480), '1.4km', 'floored, never rounded up past what is done');
  assert.eq(Trail.distanceLabel(1500), '1.5km');
  assert.eq(Trail.distanceLabel(26400), '26km', 'two significant figures');
  assert.eq(Trail.distanceLabel(134000), '130km');
  assert.truthy(/_showRoadChipHelp\(\) \{[\s\S]{0,500}?Trail\.totalMetres\(/.test(APP_JS_SRC), 'the hint reads the total');
  // Longest plausible line still fits a map message.
  const line = `${9999}m to go · ${Trail.distanceLabel(999999)} fixed`;
  assert.lte(line.length, MAP_MSG_MAX, line);
});

test('energy chip: the readout has no denominator', () => {
  assert.truthy(/label\.textContent = `⚡\$\{cur\}`;/.test(APP_JS_SRC), 'just ⚡N');
  assert.truthy(!/⚡\$\{cur\}\/\$\{max\}/.test(APP_JS_SRC), 'no /max');
});

test('road chip: an SVG road strip is the bar, the number small beneath, no icon', () => {
  const app = APP_JS_SRC;
  assert.truthy(/el\.innerHTML = ROAD_CHIP_SVG \+ '<span class="road-num">0km<\/span>';/.test(app), 'strip then number');
  assert.truthy(/num\.textContent = total;/.test(app), 'the number is the total restored');
  assert.truthy(/clip\.setAttribute\('width', \(ROAD_CHIP_W \* frac\)/.test(app), 'the repave clip tracks the fraction');
  assert.truthy(!/🛣/.test(app.slice(app.indexOf('_buildRoadChip() {'), app.indexOf('_showRoadChipHelp() {'))), 'no emoji icon');
});
