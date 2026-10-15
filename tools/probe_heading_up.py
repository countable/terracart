#!/usr/bin/env python3
"""Sweep real compass events and fake GPS fixes through the sandbox renderer.

Requires a local server and Playwright. Writes screenshots and a JSON report;
opens fresh isolated browser contexts, never uses the player's browser save.
"""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent


async def run(args):
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'cases': [], 'errors': []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=args.chromium)
        for width, height, zone in [(390, 844, 'restoration'), (1000, 850, 'encounters')]:
            context = await browser.new_context(viewport={'width': width, 'height': height}, service_workers='block')
            page = await context.new_page()
            page.on('pageerror', lambda e: report['errors'].append(str(e)))
            await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1')")
            try:
                await page.goto(args.url + '?sandbox=true&sandboxZone=' + zone, wait_until='domcontentloaded')
                await page.wait_for_function("window.__scene?._bootOverlayGone", timeout=90000)
                await page.wait_for_timeout(1000)
                await page.add_script_tag(path=str(ROOT / 'tools/heading_harness.js'))
                await page.evaluate("""() => {
                  const h=installHeadingHarness();h.freeze();
                  document.querySelectorAll('[id$="-modal"],#story,#howto').forEach(el=>el.remove());
                  __scene._storyDialogOpen=false;__scene._syncModalGate();
                  h.work();h.text();
                }""")
                assert await page.evaluate('HeadingUp.active(__scene)'), 'heading-up must default on'
                assert not await page.evaluate('Fog.enabled'), 'fog must default off'
                for deg in [0, 45, 90, 135, 180, 225, 270, 315, 360]:
                    await page.evaluate('(deg)=>headingHarness.heading(deg)', deg)
                    state = await page.evaluate('headingHarness.measure()')
                    result = {'zone': zone, 'width': width, 'targetHeading': deg, **state}
                    errors = []
                    for key in ['projectionError', 'tapError', 'playerFootError', 'uprightError', 'restoreError']:
                        if state[key] > .01:
                            errors.append(f'{key}={state[key]}')
                    if state['workError'] is None or state['workError'] > 2:
                        errors.append(f"workError={state['workError']}")
                    for key in ['textError', 'lootError', 'domError']:
                        if state[key] is None or state[key] > 1:
                            errors.append(f'{key}={state[key]}')
                    if not state['disableCull']:
                        errors.append('unsafe rotated-camera culling enabled')
                    delta = abs((state['compass'] - deg + 180) % 360 - 180) if 'compass' in state else abs((state['heading'] - deg + 180) % 360 - 180)
                    if delta > 3:
                        errors.append(f'compass not following injected input: {delta}')
                    result['passed'] = not errors
                    result['errors'] = errors
                    report['cases'].append(result)
                    if deg in [0, 45, 90, 180, 270]:
                        await page.screenshot(path=str(args.output / f'{zone}-{width}-{deg}.png'))
                await page.evaluate('headingHarness.zoom(1.5);headingHarness.peek(7,-7)')
                await page.evaluate('headingHarness.heading(90)')
                zoom = await page.evaluate('headingHarness.measure()')
                ok = max(zoom[k] for k in ['projectionError','tapError','playerFootError','restoreError']) < .01 and all(zoom[k] is not None and zoom[k] < 2 for k in ['workError','textError','lootError','domError'])
                report['cases'].append({'zone': zone, 'case': 'zoom-peek', 'passed': ok, **zoom})
                await page.screenshot(path=str(args.output / f'{zone}-{width}-zoom-peek.png'))
                await page.evaluate('headingHarness.freeze(false)')
                await page.set_viewport_size({'width': 1200 if width == 390 else 390, 'height': 1000 if width == 390 else 844})
                await page.wait_for_timeout(250)
                await page.evaluate('headingHarness.freeze();headingHarness.redraw()')
                resized = await page.evaluate('headingHarness.measure()')
                ui_scale = await page.evaluate('Math.abs(__scene.uiCam.zoom-RENDER_SCALE)')
                ok = ui_scale < .001 and max(resized[k] for k in ['projectionError','tapError','playerFootError','restoreError']) < .01
                report['cases'].append({'zone':zone,'case':'resize','passed':ok,'uiScaleError':ui_scale,**resized})
                await page.evaluate('headingHarness.freeze(false)')
                await page.set_viewport_size({'width':width,'height':height})
                await page.wait_for_timeout(250)
                await page.evaluate('headingHarness.freeze()')
                await page.evaluate('headingHarness.clearWork();headingHarness.clearText();headingHarness.zoom(1);headingHarness.peek(0,0);headingHarness.gps(7,0,true)')
                gps = await page.evaluate("() => ({x:__scene.gpsM.x-__scene.playerM.x,y:__scene.gpsM.y-__scene.playerM.y})")
                report['cases'].append({'zone':zone,'case':'fake-gps','passed':abs(gps['x'])+abs(gps['y'])<.01})
                await page.evaluate("document.querySelector('#toggle-fog-of-war').click();headingHarness.redraw()")
                assert await page.evaluate('Fog.enabled && __scene.fogImage.visible'), 'live fog toggle did not show fog'
                await page.screenshot(path=str(args.output / f'{zone}-{width}-fog.png'))
                await page.reload(wait_until='domcontentloaded')
                await page.wait_for_function('window.__scene?._bootOverlayGone', timeout=90000)
                assert await page.evaluate('Fog.enabled'), 'fog setting did not survive reload'
                report['cases'].append({'zone':zone,'case':'fog-toggle-persistence','passed':True})
                await page.goto(args.url + '?sandbox=true&headingUp=false',wait_until='domcontentloaded')
                await page.wait_for_function('window.__scene?._bootOverlayGone',timeout=90000)
                assert await page.evaluate('!HeadingUp.active(__scene) && !__scene.uiCam'), 'north-up opt-out failed'
                report['cases'].append({'zone':zone,'case':'north-up-optout','passed':True})
            except Exception as e:
                report['cases'].append({'zone':zone,'width':width,'passed':False,'error':str(e)})
                await page.screenshot(path=str(args.output / f'{zone}-failure.png'))
            print(json.dumps(report['cases'][-1]), flush=True)
            await context.close()
        await browser.close()
    report['passed'] = bool(report['cases']) and all(c['passed'] for c in report['cases']) and not report['errors']
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passed': report['passed'], 'cases': len(report['cases']), 'errors': report['errors']}), flush=True)
    if not report['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000/index.html')
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    parser.add_argument('--output', type=Path, default=Path.home() / '.artifacts' / 'heading-up')
    asyncio.run(run(parser.parse_args()))
