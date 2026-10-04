#!/usr/bin/env python3
"""Smoke-test the running sandbox in an isolated Chromium profile.

Requires Python Playwright and Chromium. Pass --output to retain screenshots
and the report; no existing browser saves are read or changed.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright


async def probe(args):
    args.output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True, executable_path=args.chromium)
        page = await browser.new_page(viewport={'width': 1100, 'height': 900})
        errors, failed = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('response', lambda response: failed.append([response.status, response.url])
                if response.status >= 400 else None)
        await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
        await page.goto(args.url, wait_until='domcontentloaded')
        await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxLabelData?.length", timeout=60000)
        await page.wait_for_timeout(3000)
        seeded = await page.evaluate("""() => {
          const s=__game.scene.getScene('map');
          const plants=[...WorldGen.tileCache.values()].flatMap(e=>e.creatures||[])
            .filter(c=>c.id.includes('_PRACTICE_plant_'));
          return {plants:plants.map(c=>({id:c.id,scale:PotionEffects.scaleMul(c)})),
            fireCount:Object.keys(s.save.groundFire||{}).length};
        }""")
        assert sorted(c['scale'] for c in seeded['plants']) == [0.5, 1, 1.5], seeded
        assert seeded['fireCount'] > 0, seeded
        await page.screenshot(path=str(args.output/'desktop.png'))
        results = await page.evaluate("""() => {
          const s=__game.scene.getScene('map'); s.scene.pause();
          const results=[];
          for (const id of s.save.inv.filter(i=>ITEM_BY_ID[i.id]?.potion).map(i=>i.id)) {
            s.save.selSlot=s.save.inv.findIndex(i=>i.id===id); s._throwReadyAt=0;
            const stack=s.save.inv[s.save.selSlot], before=stack.count;
            const ok=s._throwItem(id);
            results.push({id,ok,spent:before-stack.count,shot:s._shots.at(-1)?.potionId});
          }
          s._shots=[];
          for (const [id,method] of [['fireball_scroll','useFireballScroll'],
              ['fear_scroll','useFearScroll'],['treasure_map','useTreasureMap']]) {
            s.save.selSlot=s.save.inv.findIndex(i=>i.id===id);
            results.push({id,ok:s[method]()});
          }
          s.scene.resume(); return results;
        }""")
        assert all(r['ok'] and r.get('spent', 1) == 1 and r.get('shot', r['id']) == r['id'] for r in results), results
        await page.wait_for_timeout(800)  # Let the fireball trail render before impact isolation.
        impacts = await page.evaluate("""() => {
          const s=__game.scene.getScene('map'); s.scene.pause(); s._shots=[];
          const target=[...WorldGen.tileCache.values()].flatMap(e=>e.creatures||[])
            .find(c=>c.id.includes('_PRACTICE_plant_3'));
          const results=[];
          for (const id of ['speed_potion','time_potion']) {
            s.save.selSlot=s.save.inv.findIndex(i=>i.id===id); s._throwReadyAt=0;
            if(id==='time_potion') target._nextShotT=performance.now()+60000;
            if(!s._throwItem(id)) throw new Error('Impact throw refused');
            const shot=s._shots.at(-1); shot.x=target.x; shot.y=target.y;
            s._combatTick(0.016);
            results.push({id,consumed:!s._shots.includes(shot),
              speedActive:!!(target.speedPotionUntil>Date.now()),cooldown:target._nextShotT||0});
            s._shots=[];
          }
          s.scene.resume(); return results;
        }""")
        assert impacts[0]['consumed'] and impacts[0]['speedActive'], impacts
        assert impacts[1]['consumed'] and not impacts[1]['speedActive'] and impacts[1]['cooldown'] == 0, impacts
        await page.wait_for_timeout(2500)
        await page.screenshot(path=str(args.output/'fireball.png'))
        # Story arrivals hide the inventory while their message is open.
        await page.evaluate("__game.scene.getScene('map').scene.pause()")
        for _ in range(15):
            modal = page.locator('#message-modal')
            if not await modal.count():
                break
            await modal.get_by_role('button', name='OK', exact=True).click()
            await page.wait_for_timeout(150)
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.locator('#inv-tabs button[data-cat="magic"]').click()
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(args.output/'mobile-magic.png'))
        report = dict(seeded=seeded, actions=results, impacts=impacts, errors=errors, failedRequests=failed)
        (args.output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
        await browser.close()
        assert not errors and not failed, report
        print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000/index.html?sandbox=true&sandboxScene=PRACTICE')
    parser.add_argument('--chromium', default=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
    parser.add_argument('--output', type=Path, default=Path.home()/'.artifacts'/'sandbox-mechanics')
    asyncio.run(probe(parser.parse_args()))
