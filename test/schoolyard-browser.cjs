// Focused Phaser smoke check; placement and scoring have separate pure tests.
// Run against a local server: node test/schoolyard-browser.cjs [base URL]
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/test/tests.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
      test('schoolyard: real Phaser flag, board, HUD and end state', scene => {
        scene.depth = 0;
        scene._dialogOpen = () => false;
        scene.save.energy = 100;
        const feet = playerWorldM(scene); feet.y += scene.feetOffsetM;
        const center = scene.cellAt(feet.x, feet.y);
        const field = { id: 'smoke-school', cellIX: center.cellIX, cellIY: center.cellIY, cells: [] };
        for (let y=0;y<7;y++) for(let x=0;x<7;x++)
          field.cells.push({ ...absCellOffset(scene,center.cellIX,center.cellIY,x-3,y-3),x,y });
        scene._schoolyardFields = [field];
        scene._schoolyardScanAt = Infinity;
        scene._schoolyardRound = null;
        scene._schoolyardOnFlag = null;
        scene._tickSchoolyard(0);
        assert.truthy(scene._schoolyardRound?.run.active, 'walking on flag starts');
        scene._drawSchoolyard();
        assert.truthy(scene._schoolyardFlags[0].visible, 'flag rendered');
        assert.truthy(scene._schoolyardHUD.text.includes('Score 0'), 'live score rendered');
        assert.truthy(scene._schoolyardHUD.text.includes('East'), 'movement cue rendered');
        assert.truthy(scene._schoolyardGraphics.commandBuffer.length > 0, 'tile pattern rendered');
        SchoolyardGame.tick(scene._schoolyardRound.run, null, 30);
        scene._drawSchoolyard();
        assert.truthy(scene._schoolyardHUD.text.includes('Time!'), 'final score rendered');
        assert.eq(scene._schoolyardGraphics.commandBuffer.length, 0, 'tile glow cleared at end');
        scene.depth = 1;
        scene._tickSchoolyard(0);
        scene._drawSchoolyard();
        assert.falsy(scene._schoolyardHUD.visible, 'HUD hidden underground');
        assert.falsy(scene._schoolyardFlags[0].visible, 'flag hidden underground');
      });
    ` }));
    await page.goto(`${process.argv[2] || 'http://127.0.0.1:8000'}/test/harness.html`);
    await page.waitForFunction(() => document.querySelector('#summary')?.textContent.trim(), { timeout: 120000 });
    console.log(await page.locator('#summary').innerText());
    const failures = await page.locator('.case.fail').allTextContents();
    if (failures.length) throw new Error(failures.join('\n'));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
