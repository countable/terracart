#!/usr/bin/env python3
"""Probe one-order household deliveries and their mobile/desktop layout."""
import argparse
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright


async def probe(args):
    args.output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=args.chromium)
        page = await browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
        await page.goto(args.url)
        await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxMode")
        await page.wait_for_timeout(2500)
        results = []
        for width, height in [(390, 844), (1100, 900)]:
            await page.set_viewport_size({'width': width, 'height': height})
            await page.evaluate("""() => {
              const s=__game.scene.getScene('map');
              s.scene.pause();
              s.save.discoveryLedger ||= {};
              s.wantedProduce=()=>['marigold','forgetmenot','wildrose'];
              s.isHouseSatisfied=()=>false;
              s.presentDeliveryOffer(0,0,{id:'probe-house'},()=>{});
            }""")
            await page.wait_for_timeout(500)
            buttons = await page.locator('#offer-modal button').all_text_contents()
            assert buttons == ['Later', 'Deliver'], buttons
            geometry = await page.locator('#offer-modal .modal-body').evaluate('(e)=>({height:e.clientHeight,scrollHeight:e.scrollHeight,width:e.clientWidth,scrollWidth:e.scrollWidth})')
            assert geometry['height'] == geometry['scrollHeight'], geometry
            assert geometry['width'] == geometry['scrollWidth'], geometry
            await page.screenshot(path=str(args.output/f'delivery-{width}.png'))
            results.append(dict(viewport=[width, height], buttons=buttons, geometry=geometry))
            await page.get_by_role('button', name='Later', exact=True).click()
        assert not errors, errors
        await browser.close()
        print(json.dumps(results))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000/?sandbox=true')
    parser.add_argument('--chromium', default=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
    parser.add_argument('--output', type=Path, default=Path.home()/'.artifacts'/'sandbox-mechanics')
    asyncio.run(probe(parser.parse_args()))
