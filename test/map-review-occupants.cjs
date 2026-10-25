const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args:['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = process.env.REVIEW_BASE_URL || 'http://localhost:8765';
    await page.goto(`${base}/tools/map-review.html?lat=49.88&lon=-119.48&r=0&fixtures=1&geometry=off`);
    await page.waitForFunction(() => window.__world && !building, null, { timeout:120000 });
    const at = await page.evaluate(() => {
      const e = __world.tiles[0], n = e.cellsPerEdge, cell = Math.floor(n/2);
      const x = (e.tx + (cell+.5)/n)*EDGE, y = (e.ty + (cell+.5)/n)*EDGE;
      e.objects.push({id:'review-click-prop',kind:'mineralrock',name:'<review prop>',x,y});
      e.creatures.push({id:'review-click-enemy',kind:'slime',name:'Review enemy',x,y,hp:7});
      state.markersOff = true;
      for (const layer of Object.values(state.layers)) map.removeLayer(layer);
      const ll = toLL(x,y,EDGE);
      map.setView(ll,19,{animate:false});
      const point = map.latLngToContainerPoint(ll), box = map.getContainer().getBoundingClientRect();
      return {x:box.left+point.x,y:box.top+point.y};
    });
    await page.mouse.click(at.x,at.y);
    const popup = page.locator('.leaflet-popup-content');
    await popup.waitFor();
    const text = await popup.innerText();
    assert.match(text,/In this tile/);
    assert.match(text,/<review prop>/);
    assert.match(text,/review-click-prop/);
    assert.match(text,/Review enemy/);
    assert.match(text,/Type: Enemy/);
    assert.match(text,/HP: 7 \/ \d+/);
    assert.match(text,/Base damage:/);
    assert.match(text,/review-click-enemy/);
    assert.match(text,/Ground/);
    assert.equal(await popup.locator('review').count(),0,'object names are escaped');
    assert.equal(await popup.getByRole('link',{name:'Open in game'}).count(),1);
    assert.deepEqual(errors,[]);
    console.log('Tile clicks inspect overlapping props and enemies with markers hidden, retaining ground and game launch.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
