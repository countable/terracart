#!/usr/bin/env python3
"""Exercise living-silver story sheets and modal callbacks in the real sandbox."""
import asyncio
import argparse
import json
from pathlib import Path
from playwright.async_api import async_playwright

async def probe(args):
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
        for width, height in [(390, 844), (320, 568), (1100, 900)]:
            page = await browser.new_page(viewport={'width': width, 'height': height}, reduced_motion='reduce')
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
            await page.goto(args.url, wait_until='domcontentloaded')
            await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxMode", timeout=90000)
            await page.wait_for_timeout(1500)
            await page.evaluate("""() => {
              const s=__game.scene.getScene('map'); s.scene.pause();
              document.querySelectorAll('.game-modal').forEach(e=>e.remove());
              document.querySelectorAll('#bootload,#howto,#story').forEach(e=>e.style.display='none');
              s._syncModalGate();
            }""")
            for kind in ['story', 'shop', 'spirit']:
                await page.evaluate("""kind=>__game.scene.getScene('map').showMessageModal({kind,
                  title:kind==='spirit'?'Dragon Spirit':'Compass '+kind,
                  body:'The silver mechanism stirs. '.repeat(65), art:'kind_memory'})""", kind)
                await page.wait_for_timeout(1600)
                body=page.locator('#message-modal .modal-body')
                await body.evaluate('(e)=>e.scrollTop=e.scrollHeight')
                geometry=await page.locator('#message-modal .modal-box').evaluate("""e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),b=e.querySelector('button').getBoundingClientRect();return {bottom:r.bottom,top:r.top,border:s.borderBottomWidth,buttonBottom:b.bottom,buttonTop:b.top,scroll:e.querySelector('.modal-body').scrollHeight>e.querySelector('.modal-body').clientHeight}}""")
                assert abs(geometry['bottom']-height)<3, geometry
                assert geometry['border']=='0px', geometry
                assert 0<=geometry['buttonTop']<geometry['buttonBottom']<=height, geometry
                await page.screenshot(path=str(args.output/f'{width}-{kind}.png'))
                await page.locator('#message-modal button').click()
                await page.wait_for_function("!document.getElementById('message-modal')")
                results.append(dict(viewport=[width,height],kind=kind,geometry=geometry))
            for accept in [False,True]:
                await page.evaluate("""()=>{window.panelSettled=[];__game.scene.getScene('map').showConfirmModal({kind:'spirit',body:'Joystick not activated. power low.',acceptLabel:'Enable spirit walking',onAccept:()=>panelSettled.push('accept'),onCancel:()=>panelSettled.push('cancel')})}""")
                await page.locator('#confirm-modal button').nth(1 if accept else 0).click()
                assert await page.evaluate('panelSettled')==(['accept'] if accept else ['cancel'])
            assert not errors, errors
            await page.close()
        # Exercise boot storyboard separately from the live scene.
        page=await browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce')
        await page.goto(args.url,wait_until='domcontentloaded')
        await page.wait_for_function("typeof startStory==='function'")
        await page.evaluate("startStory(()=>{})")
        for index, fullscreen in enumerate([True,True,False,False]):
            classes=await page.locator('#story').get_attribute('class') or ''
            assert ('story-fullscreen' in classes)==fullscreen, classes
            if index==2: assert (await page.locator('#story-text').text_content()).startswith('You check the compass.')
            await page.wait_for_function("Array.from(document.querySelectorAll('#story-art img')).every(i=>i.complete && i.naturalWidth>0)")
            await page.wait_for_timeout(150)
            await page.screenshot(path=str(args.output/f'opening-{index+1}.png'))
            await page.locator('#story-next').click()
        assert await page.locator('#story').count()==0
        await browser.close()
    (args.output/'panels.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8021/?sandbox=true')
    parser.add_argument('--chromium',default='/usr/bin/chromium')
    parser.add_argument('--output',type=Path,default=Path('/tmp/living-silver-qa'))
    asyncio.run(probe(parser.parse_args()))
