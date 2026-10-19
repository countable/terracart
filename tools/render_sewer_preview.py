"""Export the sewer study from its browser renderer (requires local game server)."""
import argparse
import asyncio
import base64
import io
from PIL import Image
from pathlib import Path
from playwright.async_api import async_playwright

async def main(url):
    out = Path(__file__).resolve().parents[1] / 'extra_assets/preview/generated'
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width':1550, 'height':1200}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(url)
        await page.wait_for_function('window.sewerPreview?.ready', timeout=60000)
        assert not errors, errors
        for element, name in [('example','cavewall-l1.png'),('materials','cavewall-l1-materials.png'),('original','cavewall-rock-reference.png')]:
            data = await page.locator('#'+element).evaluate('(c)=>c.toDataURL().split(",")[1]')
            (out/name).write_bytes(base64.b64decode(data))
        for i, element in enumerate(await page.locator('#checks canvas').all()):
            data = await element.evaluate('(c)=>c.toDataURL().split(",")[1]')
            (out/f'sewer-corner-{i}.png').write_bytes(base64.b64decode(data))
        frames = []
        for phase in range(8):
            await page.evaluate('(phase)=>sewerPreview.draw(phase)', phase)
            data = await page.locator('#example').evaluate('(c)=>c.toDataURL().split(",")[1]')
            frames.append(Image.open(io.BytesIO(base64.b64decode(data))).convert('RGBA'))
        frames[0].save(out/'cavewall-l1-water.gif', save_all=True,
                       append_images=frames[1:], duration=160, loop=0, disposal=2)
        await page.evaluate('sewerPreview.draw(0)')
        # Original and sewer must have identical coverage for every exposure mask.
        result = await page.evaluate('''() => {
            const {original,sewer,cell,frameHeight} = sewerPreview;
            const a=original.getContext('2d').getImageData(0,0,original.width,original.height).data;
            const b=sewer.getContext('2d').getImageData(0,0,sewer.width,sewer.height).data;
            let mismatches=0;for(let i=3;i<a.length;i+=4)if(a[i]!==b[i])mismatches++;
            return {coverageMismatches:mismatches,cell,frameHeight,frames:64*4};
        }''')
        assert result['coverageMismatches'] == 0, result
        assert result['frameHeight'] == 35, result
        await page.screenshot(path='/tmp/sewer-corner-review.png', full_page=True)
        print(result)
        await browser.close()

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://localhost:8000/tools/sewer-wall-preview.html')
    asyncio.run(main(parser.parse_args().url))
