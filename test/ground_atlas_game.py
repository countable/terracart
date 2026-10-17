"""Opt-in ground atlas browser regression; serve the repo on localhost:8000."""
import asyncio,json,sys
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  for trial in [False,True]:
   context=await b.new_context(viewport={'width':1100,'height':900},service_workers='block')
   page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.add_init_script("sessionStorage.setItem('terracart.skipSafety','granted');sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');")
   await page.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8000').rstrip('/')+'/index.html?sandbox=true'+('&groundAtlas=true' if trial else ''),wait_until='domcontentloaded')
   await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxMode && __game.scene.getScene('map').textures.exists('biome0_0')",timeout=90000)
   await page.wait_for_timeout(2500)
   data=await page.evaluate('''() => {const s=__game.scene.getScene('map');const keys=['biome0_0','biome2_0','biome2_1','biome3_0','biome3_0p1','biome3_0p7','biome23_0','biome12_0','biome26_0'];if(GroundAtlas.enabled())keys.push('biome0_1','biome0_2','biome3_2p7');const samples={};for(const key of keys){const c=s.textures.get(key).getSourceImage();const a=document.createElement('canvas');a.width=c.width;a.height=c.height;const x=a.getContext('2d');x.drawImage(c,0,0);const p=x.getImageData(0,0,a.width,a.height).data;let hash=2166136261,alpha=0;for(const v of p) hash=Math.imul(hash^v,16777619)>>>0;for(let i=3;i<p.length;i+=4)alpha+=p[i];samples[key]={hash,alpha};}return {enabled:GroundAtlas.enabled(),loaded:s.textures.exists(GroundAtlas.KEY),samples,depth:s.depth,borderAbove:s.children.list.indexOf(s.borderContainer)>s.children.list.indexOf(s.noiseContainer)};}''')
   data['errors']=errors;print(json.dumps(data),flush=True)
   for _ in range(4):
    ok=page.get_by_role('button',name='OK',exact=True)
    if not await ok.count() or not await ok.first.is_visible():break
    await ok.first.click();await page.wait_for_timeout(300)
   await page.wait_for_timeout(1000)
   await page.screenshot(path='/tmp/ground-atlas-game-'+('trial' if trial else 'baseline')+'.png')
   Path('/tmp/ground-atlas-game-'+('trial' if trial else 'baseline')+'.json').write_text(json.dumps(data,indent=2))
   assert not errors,errors
   assert data['enabled']==trial and data['loaded']==trial
   assert data['borderAbove']
   assert data['samples']['biome3_0']['hash']!=data['samples']['biome3_0p1']['hash']
   await context.close()
  a=json.loads(Path('/tmp/ground-atlas-game-baseline.json').read_text());t=json.loads(Path('/tmp/ground-atlas-game-trial.json').read_text())
  for key in ['biome0_0','biome3_0','biome26_0']:assert a['samples'][key]['hash']!=t['samples'][key]['hash'],key+' unchanged'
  assert a['samples']['biome12_0']==t['samples']['biome12_0'],'castle mechanics changed'
  for key in ['biome2_0','biome2_1']:assert a['samples'][key]==t['samples'][key],'original sand changed'
  assert len({t['samples']['biome0_'+str(v)]['hash'] for v in range(3)})==3,'all three grass variants must be baked'
  await b.close()
asyncio.run(main())
