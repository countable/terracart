#!/usr/bin/env python3
"""Bake the shared Canvas2D broken lamp into existing dark-lamp frame slots."""
import asyncio
import base64
import io
import os
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
        page = await browser.new_page()
        page.on("pageerror", lambda error: print(error))
        await page.add_script_tag(content=(ROOT/'src/util.js').read_text())
        await page.add_script_tag(content=(ROOT/'src/sprite_layout.js').read_text())
        await page.add_script_tag(content='const WorldGen = { PATH_CLASSES: new Set(), T: { WATER: 3 } };')
        await page.add_script_tag(content=(ROOT/'src/road_overlay.js').read_text())
        uri = await page.evaluate('''() => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 256;
          RoadOverlay.paintBrokenLamp(canvas.getContext('2d'), 256);
          return canvas.toDataURL();
        }''')
        await browser.close()
    source = Image.open(io.BytesIO(base64.b64decode(uri.split(',')[1]))).convert('RGBA')
    # Native-size packing only; the shared painter owns geometry and color.
    source.putalpha(source.getchannel('A').point(lambda a:255 if a>=128 else 0))
    source = source.crop(source.getbbox())
    source.thumbnail((14,14), Image.Resampling.NEAREST)
    frame = Image.new('RGBA',(16,16))
    frame.alpha_composite(source,((16-source.width)//2,15-source.height))
    file = ROOT/'assets/Objects/Road copiar.png'
    sheet = Image.open(file).convert('RGBA')
    cols = sheet.width//16
    for index in (0,1,3,5):
        sheet.paste(frame,(index%cols*16,index//cols*16))
    sheet.save(file)
    print('Baked broken lamp: cobble frames 0, 1, 3, 5')

if __name__ == '__main__':
    asyncio.run(main())
