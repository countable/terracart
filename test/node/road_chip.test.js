// The road chip in the top HUD row: the road-repair ladder at a glance. Its
// numbers are Trail.rewardProgress over save.trail — the same pair the on-street
// counter prints — so the chip and the counter can't disagree.

test('road chip: reads the ladder through Trail.rewardProgress, Runner rungs included', () => {
  const app = SCENE_SRC;
  assert.truthy(/roadChipProgress\(\) \{[\s\S]{0,200}?Trail\.rewardProgress\(st\.metres, st\.prizes, this\.save\?\.playerClass\)/.test(app),
    'the chip reads Trail.rewardProgress with the player\'s class');
  assert.truthy(/this\._buildMemoriesChip\(\);\s*this\._buildRoadChip\(\);/.test(app), 'built beside the memories chip');
  assert.truthy(/this\.updateMemoriesDOM\(\);\s*this\.updateRoadChipDOM\(\);/.test(app), 'repainted with the HUD');
  assert.truthy(/body\.modal-open #roadchip \{ opacity: 0\.25; pointer-events: none; \}/.test(app), 'dims under a dialog like its neighbours');
  // The numbers it would show, straight off the ladder.
  const p = Trail.rewardProgress(120, 1);
  assert.eq(p.target, 400, 'the second prize wants 400 m');
  assert.eq(Trail.rewardProgress(120, 1, 'runner').target, 200, 'a runner\'s rung is half');
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
  // The TRUE total (Trail.restoredMetres — the ladder's less the scenic
  // bonus, src/scenic.js): a kilometre by the water is one on the chip.
  assert.truthy(/_showRoadChipHelp\(\) \{[\s\S]{0,500}?Trail\.restoredMetres\(/.test(SCENE_SRC), 'the hint reads the total');
  assert.eq(Trail.restoredMetres({ metres: 120, prizes: 2 }), 720, 'no bonus: the ladder\'s total');
  assert.eq(Trail.restoredMetres({ metres: 120, prizes: 2, bonusM: 300 }), 420, 'a scenic bonus is not distance');
  assert.eq(Trail.restoredMetres(null), 0);
  // Longest plausible line still fits a map message.
  const line = `${9999}m to go · ${Trail.distanceLabel(999999)} fixed`;
  assert.lte(line.length, MAP_MSG_MAX, line);
});

test('energy chip: shows current / maximum from its first paint', () => {
  const expression = SCENE_SRC.match(/label\.textContent = (`\$\{cur\} \/ \$\{max\}`);/)[1];
  const readout = new Function('cur', 'max', 'return ' + expression);
  assert.eq(readout.call({ _compassHUD: true }, 20, 120), '20 / 120', 'dial shows current and maximum');
  assert.eq(readout.call({ _compassHUD: true }, 0, 150), '0 / 150', 'zero energy and capacity changes update both numerals');
  assert.eq(readout.call({ _compassHUD: false }, 20, 120), '20 / 120', 'first paint uses the same readout before compass installation');
});

test('road chip: an SVG road strip is the bar, the number small beneath, no icon', () => {
  const app = SCENE_SRC;
  assert.truthy(/el\.innerHTML = ROAD_CHIP_SVG \+ '<span class="road-num">0km<\/span>';/.test(app), 'strip then number');
  assert.truthy(/num\.textContent = total;/.test(app), 'the number is the total restored');
  assert.truthy(/clip\.setAttribute\('width', \(ROAD_CHIP_W \* frac\)/.test(app), 'the repave clip tracks the fraction');
  assert.truthy(!/🛣/.test(app.slice(app.indexOf('_buildRoadChip() {'), app.indexOf('_showRoadChipHelp() {'))), 'no emoji icon');
});

// THE BOOKS CHIP (owner, Oct 2026): the pages of the Book's course read so far,
// in the top row after the road chip, and a tap lists them to read again.
test('books chip: counts the pages read off the bookmark, built after the road chip, repainted with the HUD', () => {
  assert.eq(bookPagesRead({}).length, 0, 'nothing read');
  assert.eq(bookPagesRead({ tipsRead: 3 }).join(), '0,1,2', 'the first three pages, in course order');
  assert.eq(bookPagesRead({ tipsRead: PLAY_TIPS.length + 5 }).length, PLAY_TIPS.length, 'the course wraps; the shelf does not');
  assert.eq(bookPagesRead({ tipsRead: -2 }).length, 0);
  assert.truthy(/^.+ · .+$/.test(bookPageLabel(0)), 'a row names the volume and its author: ' + bookPageLabel(0));
  const app = SCENE_SRC;
  assert.truthy(/this\._buildRoadChip\(\);\s*this\._buildBookChip\(\);/.test(app), 'built after the road chip');
  assert.truthy(/this\.updateRoadChipDOM\(\);\s*this\.updateBookChipDOM\(\);/.test(app), 'repainted with the HUD');
  assert.truthy(/body\.modal-open #bookchip \{ opacity: 0\.25; pointer-events: none; \}/.test(app), 'dims under a dialog like its neighbours');
  assert.truthy(/const n = bookPagesRead\(this\.save\)\.length;/.test(app), 'the count is the shelf\'s');
  // A row reopens its page on the parchment page with no title line, and the
  // list comes back when that page is tapped away; rereading moves no bookmark.
  assert.truthy(/this\.showMessageModal\(\{ title: '', body: bookPageHTML\(page\), bookPage: true, okLabel: 'Back to books',\n\s+onDismiss: \(\) => this\._showBooksRead\(shelfPage\) \}\);/.test(app), 'a row rereads the page and returns to the same shelf page');
  assert.falsy(/_showBooksRead\(shelfPage = 0\) \{[\s\S]*?tipsRead[\s\S]*?\n  \}\n/.test(app.slice(app.indexOf('  _showBooksRead(shelfPage = 0) {'), app.indexOf('  _showBooksRead(shelfPage = 0) {') + 2500)), 'the shelf never writes the bookmark');
});
