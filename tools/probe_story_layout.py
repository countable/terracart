#!/usr/bin/env python3
"""Review legacy and square story layout, including load and overflow behavior."""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

async def probe(args):
    args.output.mkdir(parents=True, exist_ok=True)
    results=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=args.chromium,headless=True)
        for width,height in [(320,568),(390,844),(1100,900)]:
            for square in [False,True]:
                page=await browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce',service_workers='block')
                errors=[]
                page.on('pageerror',lambda error: errors.append(str(error)))
                if square:
                    # A real square fixture; the complete game icon must remain
                    # visible, never stretched or cropped to legacy portrait art.
                    async def route_image(route):
                        await route.fulfill(path=str(Path('icon-512.png').resolve()),content_type='image/png')
                    await page.route('**/assets/art/kind_memory.webp*',route_image)
                await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
                await page.goto(args.url,wait_until='domcontentloaded')
                await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxMode",timeout=90000)
                await page.wait_for_timeout(1200)
                await page.evaluate("""() => {const s=__game.scene.getScene('map');s.scene.pause();
                  document.querySelectorAll('.game-modal').forEach(e=>e.remove());
                  document.querySelectorAll('#bootload,#howto,#story').forEach(e=>e.style.display='none');s._syncModalGate();}""")
                for long_copy in [False,True]:
                    await page.evaluate("""longCopy=>__game.scene.getScene('map').showMessageModal({kind:'story',
                      title:'A remembered path',body:'A traveller appears on the path. '.repeat(longCopy?100:2),art:'kind_memory'})""",long_copy)
                    await page.wait_for_timeout(600)
                    if square: await page.wait_for_selector('.modal-square-art')
                    data=await page.locator('#message-modal .modal-box').evaluate("""e=>{
                      const body=e.querySelector('.modal-body'),spacer=e.querySelector('.modal-art-spacer'),copy=e.querySelector('.modal-content'),art=e.querySelector('.modal-art');
                      const b=body.getBoundingClientRect(),s=spacer.getBoundingClientRect(),c=copy.getBoundingClientRect();
                      return {gap:c.top-s.bottom,bodyHeight:b.height,artHeight:s.height,contentTop:c.top,bodyTop:b.top,
                        square:e.classList.contains('modal-square-art'),size:getComputedStyle(art).backgroundSize,
                        inSpacer:art.parentNode===spacer,overflow:body.scrollHeight>body.clientHeight};
                    }""")
                    assert abs(data['gap'])<2,data
                    assert data['square']==square,data
                    if square:
                        assert data['inSpacer'] and 'contain' in data['size'],data
                        assert abs(data['artHeight']/data['bodyHeight']-.5)<.02,data
                    label=f'{width}-{"square" if square else "legacy"}-{"long" if long_copy else "short"}'
                    await page.screenshot(path=str(args.output/f'{label}.png'))
                    body=page.locator('#message-modal .modal-body')
                    await body.evaluate('(e)=>e.scrollTop=e.scrollHeight')
                    button=page.locator('#message-modal .compass-action')
                    bounds=await button.bounding_box()
                    assert 0<=bounds['y'] and bounds['y']+bounds['height']<=height+1,bounds
                    await button.click()
                    await page.wait_for_function("!document.getElementById('message-modal')")
                    results.append(dict(viewport=[width,height],square=square,longCopy=long_copy,geometry=data))
                assert not errors,errors
                await page.close()
        await browser.close()
    (args.output/'layout.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8021/?sandbox=true')
    parser.add_argument('--chromium',default='/usr/bin/chromium')
    parser.add_argument('--output',type=Path,default=Path('/tmp/story-layout-qa'))
    asyncio.run(probe(parser.parse_args()))
