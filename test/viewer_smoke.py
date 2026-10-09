"""Startup checks for the live design viewers; also runnable against a served checkout."""
import asyncio
import os
import sys

from playwright.async_api import async_playwright


# Main live viewers from build_dashboard_directory.py, plus the floor viewer
# linked by docs/design/. Generated art snapshots are not runtime applications.
VIEWERS = {
    "monster-roster.html": "document.documentElement.dataset.rosterReady === 'true' && document.querySelectorAll('#rows tr[data-id]').length > 0",
    "world-art.html": "document.documentElement.dataset.worldArtReady === 'true' && window.worldArt.rows.length > 0",
    "chest-report.html": "document.querySelectorAll('#sources tr').length > 0 && document.querySelectorAll('#rewards tr').length > 0",
    "map-distribution.html": "document.documentElement.dataset.mapDistributionReady === 'true'",
    "treasure-balancing.html": "document.documentElement.dataset.balanceReady === 'true' && document.querySelectorAll('#byItem tr').length > 0",
    "items.html": "document.querySelectorAll('#rows tr').length > 0 && /\\d+ of \\d+ items/.test(document.querySelector('#status').textContent)",
    "map-review.html": "window.__world && /^(ready|Built in)/.test(document.querySelector('#status').textContent)",
    "floor-viewer.html": "document.querySelector('#status').textContent.startsWith('Ready') && document.querySelector('canvas')?.width > 0",
}


async def check_floor_seed(page):
    async def population():
        await page.wait_for_function("!document.querySelector('#newSeed').disabled && document.querySelector('#status').textContent.startsWith('Ready')", timeout=60_000)
        return await page.evaluate("JSON.stringify(WorldGen.tileCacheFor(0).get(WorldGen.tileKey(0, 0)).creatures.map(c => [c.kind, c.x, c.y]))")

    original = await population()
    await page.locator('#newSeed').click()
    changed = await population()
    seed = await page.locator('#seed').input_value()
    assert seed != '0' and changed != original, 'New seed must change the population'
    await page.reload(wait_until='domcontentloaded')
    assert await population() == changed, 'A shared seed must reproduce its population'
    assert await page.locator('#seed').input_value() == seed
    await page.locator('#seed').fill('1')
    await page.locator('#seed').press('Tab')
    await population()
    assert await page.evaluate("WorldGen.tileCacheFor(0).get(WorldGen.tileKey(0, 0)).creatures.some(c => c.kind === 'goblin_runt' && c.lair)"), 'Seed 1 must include the building garrison pass'
    await page.locator('#resetSeed').click()
    assert await population() == original, 'Reset must restore the original population'


async def check_viewers(browser, base_url):
    failures = 0
    for path, ready in VIEWERS.items():
        context = await browser.new_context()
        page = await context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        def console_error(message):
            # Optional fixtures fall back to live tiles and the artifact mount
            # omits favicon.ico. Resource errors alone are not JS crashes;
            # required startup resources are covered by the readiness checks.
            if message.type == "error" and not message.text.startswith("Failed to load resource:"):
                errors.append(f"{message.text} ({message.location.get('url', '')})")
        page.on("console", console_error)
        try:
            response = await page.goto(f"{base_url.rstrip('/')}/tools/{path}", wait_until="domcontentloaded")
            if not response or not response.ok:
                raise AssertionError(f"HTTP {response.status if response else 'no response'}")
            # Console errors include exceptions caught by a viewer's own boot
            # handler. Poll both paths so a caught failure does not look ready.
            for _ in range(300):
                if errors:
                    raise AssertionError("; ".join(errors[:5]))
                if await page.evaluate(f"Boolean({ready})"):
                    break
                await page.wait_for_timeout(200)
            else:
                status = await page.locator('#status, #count, #wStatus').all_text_contents()
                raise AssertionError(f"Viewer did not become ready: {status}")
            if path == 'floor-viewer.html':
                await check_floor_seed(page)
            # Rendering schedules image loads and canvas work after boot.
            await page.wait_for_timeout(300)
            if errors:
                raise AssertionError("; ".join(errors[:5]))
            print(f"  PASS viewer: {path}", flush=True)
        except Exception as error:
            failures += 1
            print(f"  FAIL viewer: {path}: {error}", flush=True)
        finally:
            await context.close()
    return failures


async def main():
    async with async_playwright() as playwright:
        options = {"headless": True}
        if os.environ.get("PW_CHROMIUM"):
            options["executable_path"] = os.environ["PW_CHROMIUM"]
        browser = await playwright.chromium.launch(**options)
        try:
            return await check_viewers(browser, sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:7731")
        finally:
            await browser.close()


if __name__ == "__main__":
    sys.exit(1 if asyncio.run(main()) else 0)
