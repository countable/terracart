const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const [width, height] of [[320,568], [390,844], [844,390]]) {
      const page = await browser.newPage({viewport:{width,height}, serviceWorkers:'block'});
      await page.addInitScript(() => { window.__TEST_MODE = true; });
      await page.goto((process.env.TEST_URL || 'http://127.0.0.1:8012/') + '?sandbox=true');
      await page.waitForFunction(() => window.__scene?.save, {timeout:60000});
      for (const theme of ['seed','supply','potion','book','pet','relic']) {
        await page.evaluate(theme => {
          document.querySelectorAll('.game-modal').forEach(el=>el.remove());
          const s=__scene;
          s.save.money=100000;s.save.inv=[];s.save.relics={};s.save.armor={};
          const house={id:`shelf-${theme}`,kind:'npc',shopTheme:theme};
          window.__shelfHouse=house;
          s.presentThemedShop(0,0,house,()=>ShopsMath.recordDeal(s.save,house));
        },theme);
        await page.waitForTimeout(150);
        assert.equal(await page.locator('.shop-shelf-row').count(),3);
        const measure=()=>page.evaluate(()=>{
          const el=document.getElementById('offer-modal'), body=el.querySelector('.modal-copy'),content=el.querySelector('.modal-content');
          return {fit:content.scrollHeight<=body.clientHeight+2,scroll:content.scrollHeight,body:body.clientHeight};
        });
        assert((await measure()).fit,`${width} ${theme} fit: ${JSON.stringify(await measure())}`);
        const before=await page.evaluate(()=>JSON.parse(JSON.stringify(__scene.shopBucketState(__shelfHouse).shelf)));
        const buy=page.locator('.shop-shelf-row button').first();
        if (await buy.count() && await buy.isEnabled()) {
          await buy.click();
          await page.waitForTimeout(100);
          const after=await page.evaluate(()=>__scene.shopBucketState(__shelfHouse).shelf);
          assert.deepEqual(after[1],before[1],`${theme} second slot unchanged`);
          assert.deepEqual(after[2],before[2],`${theme} third slot unchanged`);
          assert.equal(await page.locator('.shop-shelf-row').count(),3);
          const saved=await page.evaluate(()=>{
            const s=__scene,cur=s.shopBucketState(__shelfHouse);cur.rerolls=4;
            s.presentThemedShop(0,0,__shelfHouse,()=>ShopsMath.recordDeal(s.save,__shelfHouse));
            return cur.deals;
          });
          const next=page.locator('.shop-shelf-row button').first();
          if(await next.isEnabled()) {
            await next.click();
            const result=await page.evaluate(()=>({deals:__scene.shopBucketState(__shelfHouse).deals,penalty:__scene.shopBucketState(__shelfHouse).rerolls}));
            assert.equal(result.deals,saved+1);assert.equal(result.penalty,3);
          }
        }
        if (theme !== 'relic') {
          await page.evaluate(() => {
            const s=__scene, ids=[...new Set(s.shopBucketState(__shelfHouse).shelf.filter(Boolean).map(o=>o.id))];
            s.save.inv=ids.map(id=>({id,count:Inventory.stackCapFor(s.save,id)}));
            s.presentThemedShop(0,0,__shelfHouse,()=>ShopsMath.recordDeal(s.save,__shelfHouse));
          });
          await page.waitForTimeout(100);
          assert((await measure()).fit,`${width} ${theme} full-bag fit: ${JSON.stringify(await measure())}`);
          assert.equal(await page.locator('.shop-shelf-row button:enabled').count(),0,'full stacks disable buying');
        }
      }
      console.log(`${width}x${height}: six shelf themes fit; purchases keep two slots and reduce penalty`);
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
