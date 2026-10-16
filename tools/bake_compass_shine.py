#!/usr/bin/env python3
"""Offline prototype bake. Requires Pillow, numpy, Playwright and local app server.

Captures actual composed chassis CSS at each demo profile, so endcap masks and
shoulder feathers agree with the highlight. No runtime image processing occurs.
Usage: python3 tools/bake_compass_shine.py --url http://127.0.0.1:8022/
"""
import argparse, asyncio, io
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent
SIZES = [(320, 568), (390, 844), (430, 932)]
def smoothstep(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)

def bake(raw, target):
    source = Image.open(io.BytesIO(raw)).convert('RGB')
    rgb = np.asarray(source).astype(float) / 255
    luma = rgb @ np.array([.2126, .7152, .0722])
    groove_guard = smoothstep(.23, .32, luma)
    midtone_lift = smoothstep(.28, .53, luma)
    # A small set of stable glints sits on bright metal crests. All streaks,
    # halos and blur are baked; the moving beam simply reveals them.
    yy, xx = np.indices(luma.shape)
    spark = np.zeros_like(luma)
    chosen = []
    for flat in np.argsort(luma, axis=None)[::-1]:
        y, x = np.unravel_index(flat, luma.shape)
        if luma[y, x] < .80 or len(chosen) >= 12:
            break
        if x < 8 or y < 8 or x >= source.width - 8 or y >= source.height - 8:
            continue
        if any((x - px)**2 + (y - py)**2 < 48**2 for px, py in chosen):
            continue
        chosen.append((x, y))
        dx, dy = xx - x, yy - y
        spark += (np.exp(-dx**2 / 22 - dy**2 / .7)
                  + np.exp(-dx**2 / .7 - dy**2 / 32)) * .65
    emit = smoothstep(.56, .88, luma)
    glow = Image.fromarray(np.uint8(emit * 255)).filter(ImageFilter.GaussianBlur(3.4))
    bloom = np.asarray(glow).astype(float) / 255
    halo = Image.fromarray(np.uint8(np.clip(spark, 0, 1) * 255)).filter(ImageFilter.GaussianBlur(4))
    halo = np.asarray(halo).astype(float) / 255
    sharp = (midtone_lift * .78 + spark * .8) * groove_guard
    # Diffuse light may spill into recesses; sharp glints remain on the metal.
    diffuse = bloom * (.12 + .18 * groove_guard) + halo * .65
    alpha = np.clip(sharp + diffuse, 0, .99)
    out = np.zeros((*luma.shape, 4), dtype=np.uint8)
    out[:, :, :3] = [245, 250, 255]
    out[:, :, 3] = np.uint8(alpha * 255)
    Image.fromarray(out).save(target, lossless=True)
    assert np.max(alpha[luma <= .23], initial=0) <= .20, 'Groove glow overwhelms recesses'
    print(f'{target.name}: {target.stat().st_size // 1024} KiB; {len(chosen)} baked glints, restrained groove glow')

async def main(url):
    output = ROOT / 'compass-shine-baked'
    output.mkdir(exist_ok=True)
    yy, xx = np.indices((1024, 512))
    half_width = 232 - 205 * np.clip(yy / 950, 0, 1)
    distance = np.abs(xx - 255.5) / half_width
    # Only the very center reaches full strength; fade across the entire width.
    profile = 1 - smoothstep(.04, 1, distance)
    profile *= 1 - smoothstep(880, 1023, yy)
    beam = Image.fromarray(np.uint8(profile * 255))
    beam_rgba = Image.new('RGBA', beam.size, (255, 255, 255, 0))
    beam_rgba.putalpha(beam)
    beam_rgba.save(output / 'overhead-beam.png')
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for width, height in SIZES:
            page = await browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=1)
            await page.add_init_script("localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');sessionStorage.setItem('terracart.safetySeen','1')")
            await page.goto(url + 'index.html?sandbox=true&sandboxZone=restoration')
            await page.wait_for_function('window.__scene?._bootOverlayGone', timeout=90000)
            await page.add_script_tag(url=url + 'tools/compass_hud_harness.js')
            await page.evaluate("installCompassHudHarness().preview('active')")
            await page.add_style_tag(content='body *{visibility:hidden!important}#compass-body,#compass-body *{visibility:visible!important}#compass-body .compass-bearing,#compass-body .compass-bearing *,#compass-body .compass-ticks,#compass-body .compass-aperture{visibility:hidden!important}html,body{background:#000!important}')
            await page.wait_for_timeout(300)
            raw = await page.locator('#compass-body').screenshot()
            bake(raw, output / f'highlight-{width}x{height}.webp')
            await page.close()
        await browser.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8022/')
    asyncio.run(main(parser.parse_args().url.rstrip('/') + '/'))
