#!/usr/bin/env python3
"""Check that pressing story OK preserves scroll geometry, including long copy."""
import argparse
import asyncio
import json
import os
from playwright.async_api import async_playwright


async def probe(args):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=args.chromium)
        page = await browser.new_page()
        await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
        await page.goto(args.url)
        await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxMode")
        await page.wait_for_timeout(2500)
        results = []
        for width, height in [(390, 844), (1100, 900)]:
            await page.set_viewport_size({'width': width, 'height': height})
            for long_copy in [False, True]:
                await page.evaluate("""longCopy => __game.scene.getScene('map').showMessageModal({
                  title:'Story', body:'A traveller appears on the path. '.repeat(longCopy ? 120 : 1),
                  art:'kind_note'})""", long_copy)
                await page.wait_for_timeout(400)
                body = page.locator('#message-modal .modal-body')
                await body.evaluate('(e) => e.scrollTop=e.scrollHeight')
                inspect = '(e) => ({height:e.clientHeight,scrollHeight:e.scrollHeight,width:e.clientWidth})'
                before = await body.evaluate(inspect)
                button = page.locator('#message-modal button')
                box = await button.bounding_box()
                await page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
                await page.mouse.down()
                await page.wait_for_timeout(100)
                pressed = await body.evaluate(inspect)
                assert before == pressed, {'before': before, 'pressed': pressed}
                assert (before['scrollHeight'] > before['height']) == long_copy, before
                await page.mouse.up()
                await page.wait_for_function("!document.getElementById('message-modal')")
                results.append(dict(viewport=[width, height], longCopy=long_copy, before=before, pressed=pressed))
        await browser.close()
        print(json.dumps(results))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000/?sandbox=true')
    parser.add_argument('--chromium', default=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
    asyncio.run(probe(parser.parse_args()))
