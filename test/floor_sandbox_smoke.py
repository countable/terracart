"""Browser regression for the floor viewer → playable sandbox handoff.

Run with python3 test/floor_sandbox_smoke.py [--url http://localhost:8765].
"""
import argparse
import asyncio
import json

from playwright.async_api import async_playwright


async def main(base_url):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path='/usr/bin/chromium',
            headless=True,
            args=['--no-sandbox'],
        )
        page = await browser.new_page(viewport={'width': 1100, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.add_init_script("""
            sessionStorage.setItem('terracart.skipSafety', 'granted');
            sessionStorage.setItem('terracart.safetySeen', '1');
            localStorage.setItem('terracart.introSeen', '1');
        """)

        async def wait_for_sandbox():
            await page.wait_for_function(
                "window.__game?.scene.getScene('map')?._sandboxMode",
                timeout=90000,
            )

        async def wait_for_play_button():
            await page.wait_for_function(
                "!document.querySelector('#playSandbox').disabled",
                timeout=90000,
            )

        for depth in [0, 2, 6]:
            errors.clear()
            await page.goto(f'{base_url}/tools/floor-viewer.html?seed=1')
            await page.wait_for_function(
                "document.querySelector('#status').textContent.startsWith('Ready')",
                timeout=90000,
            )
            if depth:
                await page.locator('#floorSeg button').nth(depth).click()
                await wait_for_play_button()
            if await page.locator('#vPlus').is_enabled():
                await page.locator('#vPlus').click()
                await wait_for_play_button()
            original = await page.evaluate("""depth => {
                const entry = WorldGen.tileCacheFor(depth).get(WorldGen.tileKey(0, 0));
                return {
                    grid: Array.from(entry.grid),
                    objects: entry.objects.map(object => object.id),
                };
            }""", depth)
            await page.evaluate("""() => {
                localStorage.setItem('terracart.save.v4.floor-test', JSON.stringify({coins: 12345}));
                localStorage.setItem('terracart.saves', JSON.stringify({
                    active: 'floor-test',
                    slots: [{
                        id: 'floor-test', key: 'terracart.save.v4.floor-test',
                        name: 'Test', createdAt: 1, lastPlayedAt: 1,
                    }],
                }));
            }""")
            await page.locator('#playSandbox').click()
            await wait_for_sandbox()
            await page.wait_for_timeout(2500)
            result = await page.evaluate("""() => {
                const scene = __game.scene.getScene('map');
                const entry = WorldGen.tileCache.get(WorldGen.tileKey(0, 0));
                return {
                    depth: scene.depth,
                    pos: scene.playerToWorldCell(),
                    grid: Array.from(entry.grid),
                    objects: entry.objects.map(object => object.id),
                    kit: scene.save.relics,
                    errors: document.querySelector('#bootload-cap')?.textContent,
                };
            }""")
            assert result['depth'] == depth, result
            assert result['pos']['tx'] == 0 and result['pos']['ty'] == 0, result['pos']
            overlap = len(set(original['objects']) & set(result['objects']))
            print(json.dumps({
                'depth': depth,
                'pos': result['pos'],
                'gridChanges': sum(a != b for a, b in zip(original['grid'], result['grid'])),
                'originalObjects': len(original['objects']),
                'keptObjects': overlap,
                'errors': errors,
                'kit': result['kit'],
            }), flush=True)
            assert not errors, errors
            assert original['grid'] == result['grid']
            assert overlap == len(original['objects'])

            if depth == 0:
                before = await page.evaluate("JSON.stringify(__game.scene.getScene('map').playerM)")
                pad = await page.locator('#move-pad').bounding_box()
                await page.mouse.move(pad['x'] + pad['width'] * .85, pad['y'] + pad['height'] * .5)
                await page.mouse.down()
                await page.wait_for_timeout(700)
                await page.mouse.up()
                after = await page.evaluate("JSON.stringify(__game.scene.getScene('map').playerM)")
                assert before != after, 'Player should move'
            await page.evaluate("persistSave(__game.scene.getScene('map').save); flushSave()")
            assert await page.evaluate(
                "JSON.parse(localStorage.getItem('terracart.save.v4.floor-test')).coins"
            ) == 12345
            await page.reload()
            await wait_for_sandbox()
            assert await page.evaluate("__game.scene.getScene('map').depth") == depth

        await page.goto(f'{base_url}/index.html?sandbox=true')
        await page.wait_for_function(
            "window.__game?.scene.getScene('map')?._sandboxLabelData?.length",
            timeout=90000,
        )
        assert not errors, errors
        print('Movement, reload, save isolation and default sandbox passed.', flush=True)
        await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://localhost:8765', help='Game server base URL')
    args = parser.parse_args()
    asyncio.run(main(args.url.rstrip('/')))
