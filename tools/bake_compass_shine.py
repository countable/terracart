#!/usr/bin/env python3
"""Offline prototype bake. Requires Pillow, numpy, Playwright and local app server.

Captures actual composed chassis CSS at each demo profile, so endcap masks and
shoulder feathers agree with the highlight. No runtime image processing occurs.
Usage: python3 tools/bake_compass_shine.py --url http://127.0.0.1:8022/
"""
import argparse, asyncio, io
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
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
    # Midtones approach white; brighter crests emit a small, prefiltered halo.
    direct = midtone_lift * .93
    emit = smoothstep(.56, .88, luma)
    glow = Image.fromarray(np.uint8(emit * 255)).filter(ImageFilter.GaussianBlur(2.2))
    bloom = np.asarray(glow).astype(float) / 255
    alpha = np.clip(direct + bloom * .60, 0, .98) * groove_guard
    out = np.zeros((*luma.shape, 4), dtype=np.uint8)
    out[:, :, :3] = [245, 250, 255]
    out[:, :, 3] = np.uint8(alpha * 255)
    Image.fromarray(out).save(target, lossless=True)
    assert np.all(out[:, :, 3][luma <= .23] == 0), 'Dark groove gained highlight'
    print(f'{target.name}: {target.stat().st_size // 1024} KiB; dark groove alpha = 0')

async def main(url):
    output = ROOT / 'compass-shine-baked'
    output.mkdir(exist_ok=True)
    beam = Image.new('L', (512, 1024))
    ImageDraw.Draw(beam).polygon([(38, -80), (474, -80), (280, 950), (232, 950)], fill=255)
    beam = beam.filter(ImageFilter.GaussianBlur(24))
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
