#!/usr/bin/env python3
"""Review full-width square artwork tucked beneath dialog chrome."""
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
            page=await browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce',service_workers='block')
            errors=[]
            page.on('pageerror',lambda error: errors.append(str(error)))
            await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
            await page.goto(args.url,wait_until='domcontentloaded')
            await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxMode",timeout=90000)
            await page.wait_for_timeout(1200)
            await page.evaluate("""() => {const s=__game.scene.getScene('map');s.scene.pause();
              document.querySelectorAll('.game-modal').forEach(e=>e.remove());
              document.querySelectorAll('#bootload,#howto,#story').forEach(e=>e.style.display='none');s._syncModalGate();}""")
            for case,kind,art in [('story','story','kind_memory'),('event','note','fire_first'),('shop','shop','kind_shop'),('reward','treasure','treasure_dig')]:
                for long_copy in [False,True]:
                    await page.evaluate("""({caseName,kind,art,longCopy})=>{
                      const scene=__game.scene.getScene('map');
                      const body='A traveller appears on the path. '.repeat(longCopy?100:2);
                      if(caseName==='reward') scene.showChestRewardModal({name:'Buried treasure',sub:body,art,iconHTML:'',header:'Treasure'});
                      else scene.showMessageModal({kind,title:'A remembered path',body,art});
                    }""",dict(caseName=case,kind=kind,art=art,longCopy=long_copy))
                    await page.wait_for_timeout(600)
                    data=await page.locator('.game-modal .modal-box').evaluate("""e=>{
                      const body=e.querySelector('.modal-body'),spacer=e.querySelector('.modal-art-spacer'),copy=e.querySelector('.modal-content'),art=e.querySelector('.modal-art');
                      const b=body.getBoundingClientRect(),s=spacer.getBoundingClientRect(),c=copy.getBoundingClientRect(),a=art.getBoundingClientRect(),style=getComputedStyle(art),box=e.getBoundingClientRect(),rail=getComputedStyle(e,'::before');
                      return {gap:c.top-s.bottom,bodyHeight:b.height,spacerHeight:s.height,imageWidth:a.width,imageHeight:a.height,
                        contentTop:c.top,bodyTop:b.top,boxWidth:box.width,imageLeft:a.left-box.left,imageTop:a.top-box.top,railHeight:parseFloat(rail.height)*(box.width/e.offsetWidth),railZ:rail.zIndex,category:e.querySelector('.modal-kind')?.textContent||'',size:style.backgroundSize,position:style.backgroundPosition,
                        inSpacer:art.parentNode===spacer,overflow:body.scrollHeight>body.clientHeight};
                    }""")
                    assert abs(data['gap'])<2,data
                    assert data['inSpacer'] and data['size']=='cover' and data['position']=='50% 0%',data
                    assert abs(data['imageWidth']-data['imageHeight'])<1,data
                    assert data['imageHeight']<data['spacerHeight'],data
                    assert abs(data['imageWidth']-data['boxWidth'])<1 and abs(data['imageLeft'])<1,data
                    assert abs(data['imageTop'])<1 and data['railZ']=='3',data
                    if case=='story': assert not data['category'],data
                    else: assert data['category'],data
                    label=f'{width}-{case}-{"long" if long_copy else "short"}'
                    await page.screenshot(path=str(args.output/f'{label}.png'))
                    body=page.locator('.game-modal .modal-body')
                    await body.evaluate('(e)=>e.scrollTop=e.scrollHeight')
                    button=page.locator('.game-modal .compass-action').last
                    bounds=await button.bounding_box()
                    assert 0<=bounds['y'] and bounds['y']+bounds['height']<=height+1,bounds
                    await button.click()
                    await page.wait_for_function("!document.querySelector('.game-modal')")
                    results.append(dict(viewport=[width,height],case=case,longCopy=long_copy,geometry=data))
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
