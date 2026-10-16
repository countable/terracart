"""Check the production compass rim across screen sizes and bearings."""

import argparse
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright


async def main(args):
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=args.chromium, args=['--no-sandbox']
        )
        results = []
        for width, height in [(320, 568), (390, 844), (430, 932), (1100, 900)]:
            page = await browser.new_page(
                viewport={'width': width, 'height': height}, device_scale_factor=2
            )
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.add_init_script("""
                localStorage.setItem('terracart.introSeen', '1');
                localStorage.setItem('terracart.howtoSeen', '1');
                sessionStorage.setItem('terracart.safetySeen', '1');
            """)
            await page.goto(
                args.url.rstrip('/') + '/index.html?sandbox=true&sandboxZone=restoration'
            )
            await page.wait_for_function('window.__scene?._bootOverlayGone', timeout=90000)
            await page.add_script_tag(
                url=args.url.rstrip('/') + '/tools/compass_hud_harness.js'
            )
            await page.evaluate("""
                window.rimHarness = installCompassHudHarness();
                rimHarness.preview('active');
            """)
            await page.wait_for_function("document.querySelector('.compass-rim-art')?.complete")
            for angle in [0, 45, 90, 180]:
                result = await page.evaluate(r"""async angle => {
                    const scene = window.__scene;
                    scene.mapRot = angle * Math.PI / 180;
                    CompassHUD.update(scene);
                    const rim = document.querySelector('.compass-rim-art');
                    const map = document.querySelector('.compass-aperture').getBoundingClientRect();
                    const letters = [...document.querySelectorAll('.compass-bearing b')].map(el => ({
                        text: el.textContent,
                        rect: el.getBoundingClientRect().toJSON(),
                        font: getComputedStyle(el).fontSize,
                        transform: getComputedStyle(el).transform,
                        netRotation: (() => {
                            const bearing = document.querySelector('.compass-bearing');
                            const matrix = new DOMMatrix(getComputedStyle(bearing).transform)
                                .multiply(new DOMMatrix(getComputedStyle(el).transform));
                            return Math.atan2(matrix.b, matrix.a);
                        })()
                    }));
                    const xml = new DOMParser().parseFromString(
                        await (await fetch(rim.src)).text(), 'image/svg+xml'
                    );
                    const ornaments = [...document.querySelectorAll(
                        '.compass-north, .compass-east, .compass-south, .compass-west, .compass-bead'
                    )];
                    const rasterUrls = ornaments.flatMap(el => {
                        const backgrounds = [null, '::before', '::after'].map(pseudo =>
                            getComputedStyle(el, pseudo).backgroundImage
                        );
                        return backgrounds.flatMap(background =>
                            [...background.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => match[1])
                        );
                    });
                    const rasterArt = await Promise.all([...new Set(rasterUrls)].map(async url => {
                        const image = new Image();
                        image.src = url;
                        await image.decode();
                        const canvas = document.createElement('canvas');
                        canvas.width = image.naturalWidth;
                        canvas.height = image.naturalHeight;
                        const context = canvas.getContext('2d');
                        context.drawImage(image, 0, 0);
                        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                        let transparent = false, opaque = false;
                        for (let index = 3; index < pixels.length; index += 4) {
                            transparent ||= pixels[index] === 0;
                            opaque ||= pixels[index] > 0;
                            if (transparent && opaque) break;
                        }
                        return {url, width: image.naturalWidth, height: image.naturalHeight,
                            transparent, opaque};
                    }));
                    const pad = document.querySelector('#move-pad').getBoundingClientRect();
                    return {
                        angle,
                        letters,
                        map: map.toJSON(),
                        beads: document.querySelectorAll('.compass-bead').length,
                        rasterArt,
                        engravings: xml.querySelectorAll('.rim-engraving').length,
                        mapTarget: document.elementFromPoint(
                            map.x + map.width / 2, map.y + map.height / 2
                        )?.tagName,
                        joystickTarget: document.elementFromPoint(
                            pad.x + pad.width / 2, pad.y + pad.height / 2
                        )?.closest('#move-pad')?.id,
                        rimPointerEvents: getComputedStyle(rim).pointerEvents
                    };
                }""", angle)
                assert ''.join(letter['text'] for letter in result['letters']) == 'NESW', result
                assert all(abs(letter['netRotation']) < 1e-5 for letter in result['letters']), result
                assert result['beads'] == 4 and result['engravings'] == 8, result
                assert result['rasterArt'], result
                for art in result['rasterArt']:
                    assert art['url'].split('?')[0].endswith('.png'), art
                    assert art['width'] > 0 and art['height'] > 0, art
                    assert art['transparent'] and art['opaque'], art
                assert result['rimPointerEvents'] == 'none', result
                assert result['mapTarget'] == 'CANVAS', result
                assert result['joystickTarget'] == 'move-pad', result
                await page.screenshot(path=str(out / f'{width}-{angle}.png'))
                results.append(dict(viewport=[width, height], **result))
            if width == 390:
                await page.set_viewport_size({'width': 430, 'height': 932})
                await page.wait_for_function("""
                    Math.abs(document.querySelector('.compass-aperture')
                        .getBoundingClientRect().width - 430) < 1
                """)
                anchor = await page.evaluate("""() => {
                    const map = document.querySelector('.compass-aperture').getBoundingClientRect();
                    const rim = document.querySelector('.compass-bearing').getBoundingClientRect();
                    return {map: map.toJSON(), rim: rim.toJSON()};
                }""")
                for key in ['x', 'y', 'width', 'height']:
                    assert abs(anchor['map'][key] - anchor['rim'][key]) < 1, anchor
            assert not errors, errors
            await page.close()
        (out / 'checks.json').write_text(json.dumps(results, indent=2))
        print(json.dumps({'screenshots': str(out), 'checks': len(results), 'errors': []}))
        await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--url', default='http://127.0.0.1:8000', help='Base URL of the served repository'
    )
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    parser.add_argument('--output', type=Path, default=Path('/tmp/compass-rim-qa'))
    asyncio.run(main(parser.parse_args()))
