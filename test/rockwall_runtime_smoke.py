"""Exercise shared floor-viewer snapshots in the actual WebGL game on localhost:8000.

Uses an isolated browser context; never reads or writes an existing player save.
"""
import asyncio,os,json
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',env={k:v for k,v in os.environ.items() if k!='DISPLAY'},args=['--no-sandbox','--ozone-platform=headless','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  ctx=await b.new_context(viewport={'width':1100,'height':900},service_workers='block');page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1')")
  await page.goto('http://localhost:8000/tools/floor-viewer.html')
  await page.wait_for_function('!document.querySelector("#playSandbox").disabled',timeout=120000)
  await page.locator('#floorSeg button').nth(7).click()
  await page.wait_for_function('!document.querySelector("#playSandbox").disabled',timeout=120000)
  await page.locator('#playSandbox').click()
  await page.wait_for_function('window.__scene?._bootOverlayGone',timeout=120000)
  await page.evaluate('''()=>{const s=__scene;s.scene.pause(); document.querySelectorAll('[id$="-modal"]').forEach(e=>e.style.display='none');s._storyDialogOpen=false;s._syncModalGate();s.drawCells();s.drawObjects();}''')
  results=[]
  for depth in range(1,8):
   result=await page.evaluate('''depth=>{
    const s=__scene;s.depth=s.save.depth=depth;WorldGen.setDepth(depth);
    const e=WorldGen.tileCache.get('0_0')||[...WorldGen.tileCache.values()].find(e=>e.grid),n=e.cellsPerEdge;
    let chosen=0;for(let y=3;y<n-3;y++)for(let x=3;x<n-3;x++)if(WorldGen.isWalkable(e.grid[y*n+x])&&e.grid[y*n+x]!==WorldGen.T.CAVE_LAVA&&e.grid[y*n+x+1]===WorldGen.T.CAVE_WALL){chosen=y*n+x;break;}
    if(chosen){s.playerM={x:(chosen%n+.5)*s.cellM-s.startWorldM.x,y:(Math.floor(chosen/n)+.5)*s.cellM-s.startWorldM.y};s.gpsM={...s.playerM};s.syncMoveTarget();}
    s.drawCells();s.drawObjects();const g=s._wallPerspective?.cave;
    window.retainedCaveBlocks=g?.blocks.slice();
    return {depth,blocks:g?.blocks.length||0,atlas:g?.atlas?.key,globalWalls:[...e.grid].filter(t=>t===WorldGen.T.CAVE_WALL).length};
   }''',depth)
   if depth==5:assert result['globalWalls']==0 and result['blocks']==0,result
   else:
    assert result['blocks']>0 and result['atlas']==f'floor-wall-l{depth}',result
    for a in [0,.785398,1.570796,3.141593]:
     out=await page.evaluate('''a=>{const s=__scene;s.mapRot=a;s.drawCells();s.drawObjects();WallPerspective.update(s);const g=s._wallPerspective.cave;return {blocks:g.blocks.length,visible:g.parts.filter(p=>p.visible).length,retained:g.blocks.every(b=>retainedCaveBlocks.includes(b)),atlas:g.parts.filter(p=>p.visible).every(p=>p._wallAtlas===g.atlas)};}''',a)
     assert out['blocks']==out['visible'] and out['atlas'] and out['retained'],out
   await page.screenshot(path=f'/tmp/runtime-walls-l{depth}.png')
   results.append(result)
  print(json.dumps(results));print('errors',errors);assert not errors,errors
  await b.close()
asyncio.run(main())
