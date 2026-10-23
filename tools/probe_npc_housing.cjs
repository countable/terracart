// Exercise delivery -> resident -> exterior furnishings in an isolated save.
// node tools/probe_npc_housing.cjs [http://127.0.0.1:8000/]
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const output = process.env.OUT_DIR || path.join(os.homedir(), '.artifacts', 'npc-housing');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 1100 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => {
      window.__DAYLIGHT = 1;
      sessionStorage.setItem('terracart.safetySeen', '1');
      localStorage.setItem('terracart.introSeen', '1');
      localStorage.setItem('terracart.howtoSeen', '1');
    });
    const url = new URL(process.argv[2] || 'http://127.0.0.1:8000/');
    url.searchParams.set('sandbox', 'true');
    url.searchParams.set('skipStory', 'true');
    url.searchParams.set('skipTutorial', 'true');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__scene?._bootOverlayGone, null, { timeout: 120000 });
    const report = await page.evaluate(() => {
      const s = __scene;
      s.scene.pause();
      document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto').forEach(e => { e.style.display = 'none'; });
      s._syncModalGate();
      s._setRestZoom(1, 1);
      const entry = [...WorldGen.tileCache.values()].find(e => e.objects?.some(o => o.id.includes('house_RESIDENTIAL_7_0')));
      const house = entry.objects.find(o => o.id.includes('house_RESIDENTIAL_7_0'));
      window.__housingProbe = { entry, house };
      s.playerM = { x: house.x - s.startWorldM.x + s.cellM, y: house.y - s.startWorldM.y + s.cellM * 1.5 };
      s.save.restoredHouses[house.id] = 'plain';
      s.save.discovered ||= {};
      delete s.save.discovered['house:' + house.id];
      s.save.npcHomes = {};
      s.save.npcMoveInAfter = {};
      s.save.deliveryCount = 2;
      s._storySplashOnce = () => {};
      // Use one already arrived villager, never a pending identity.
      for (const e of WorldGen.tileCache.values()) e.creatures = (e.creatures || []).filter(c => c.kind !== 'npc');
      const c = WorldGen.makeCreature('npc', house.x + s.cellM * 2, house.y + s.cellM * 2,
        'housing_probe_tilly', { ...NPC.storyNeighbour('housing_probe_tilly', 'wanderer'),
          homeX: house.x + s.cellM * 2, homeY: house.y + s.cellM * 2, _homeAnchor: '' });
      entry.creatures.push(c);
      // The real delivery transaction must schedule, but not immediately move.
      s.wantedProduce = () => ['potato'];
      Inventory.add(s.save, 'potato', 1);
      let delivery;
      const offer = s.showOfferModal;
      s.showOfferModal = options => { delivery = options; };
      s.presentDeliveryOffer(0, 0, house, () => {});
      s.showOfferModal = offer;
      delivery.onAccept();
      const scheduled = s.save.npcMoveInAfter[house.id];
      const immediate = NPC.houseNeighbours(s, { now: scheduled - 1 });
      const moved = NPC.houseNeighbours(s, { now: scheduled, offscreen: () => true });
      // Populate four slots, then replace the weakest through the actual
      // roof-tap handler, so placement and house interaction both get checked.
      s.save.houseFurniture = {};
      for (const itemId of ['bed_quilted', 'mirror_brass', 'rug_burgundy', 'bookshelf_frontier', 'lamp_floor']) {
        Inventory.add(s.save, itemId, 1);
        const slot = s.save.inv.findIndex(r => r.id === itemId && r.count > 0);
        s.save.selSlot = slot;
        const ctx = { scene: s, save: s.save, building: house, sx: 100, sy: 100,
          wm: { x: house.x, y: house.y }, dirty: false };
        TAP_HANDLERS.find(h => h.name === 'building-art').try(ctx);
      }
      s.save.selSlot = -1;
      s.drawCells(); s.drawObjects();
      return { immediate, moved, houseId: house.id, resident: NPC.residentOf(s.save, house).name,
        luxury: Furniture.luxuryOf(s.save, house.id),
        furniture: Furniture.houseFurniture(s.save, house.id).map(r => r.itemId),
        returned: Inventory.count(s.save, 'bed_quilted'), scheduled: Number.isFinite(scheduled) };
    });
    assert.equal(report.immediate, 0);
    assert.equal(report.moved, 1);
    assert.equal(report.resident, 'Tilly');
    assert.equal(report.luxury, 21);
    assert.equal(report.furniture.length, 4);
    assert(report.returned >= 1);
    assert(report.scheduled);
    // Render one frame without advancing the paused simulation.
    await page.evaluate(() => { __game.loop.wake(); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, 'resident-sign.png') });
    const plaque = page.locator('.resident-plaque').filter({ has: page.locator('img[alt="Tilly"]') });
    assert.equal(await plaque.count(), 1);
    await page.evaluate(() => {
      const s = __scene, { house } = __housingProbe;
      document.getElementById('offer-modal')?.remove();
      s.shopInteract(0, 0, house);
    });
    await page.waitForSelector('#house-furniture-modal');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#house-furniture-modal .house-furniture-slot').count(), 4);
    assert((await page.locator('#house-furniture-modal').innerText()).includes('Luxury 21'));
    await page.screenshot({ path: path.join(output, 'house-inspect.png') });
    // The same dialog must fit a phone without horizontal overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const geometry = await page.locator('#house-furniture-modal .modal-body').evaluate(e => ({
      width: e.clientWidth, scrollWidth: e.scrollWidth,
    }));
    assert.equal(geometry.width, geometry.scrollWidth);
    await page.screenshot({ path: path.join(output, 'house-inspect-mobile.png') });
    await page.locator('#house-furniture-modal [aria-label="Close panel"]').click();
    assert.equal(await page.locator('#house-furniture-modal').count(), 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report, geometry, errors }, null, 2));
    console.log(JSON.stringify({ ...report, geometry, errors, output }));
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
