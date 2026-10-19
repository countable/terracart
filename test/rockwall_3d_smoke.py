"""Check the preview's real WebGL path, compass projection and retained resources."""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        # An inherited desktop DISPLAY makes this host's software Vulkan driver
        # try an inaccessible X server. Headless Ozone avoids that dependency.
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium',
            env={k:v for k,v in os.environ.items() if k != 'DISPLAY'},
            args=['--no-sandbox','--ozone-platform=headless','--use-gl=angle',
                  '--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        page = await browser.new_page(viewport={'width':1250,'height':1050})
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        await page.goto('http://localhost:8000/tools/rockwall-3d-preview.html')
        await page.wait_for_function('window.rockwall3D?.ready')
        assert await page.evaluate('rockwallReviewGame.renderer.type') == 2
        results=[]
        for fixture in ['cave','island','stairs','junction']:
            await page.locator('#fixture').select_option(fixture)
            await page.wait_for_timeout(120)
            await page.evaluate('''() => {
                window.savedBlocks = new Set(rockwallReviewScene.review.group.blocks);
                window.savedTextures = rockwallReviewScene.textures.getTextureKeys().length;
                window.uploads = 0;
                const gl=rockwallReviewGame.renderer.gl;
                window.originalTexImage=gl.texImage2D;
                gl.texImage2D=function(...args){uploads++;return originalTexImage.apply(this,args)};
            }''')
            for heading in range(0,360,45):
                await page.locator('#angle').fill(str(heading))
                await page.evaluate('rockwall3D.update()')
                result=await page.evaluate('''() => {
                    const scene=rockwallReviewScene,{group}=scene.review,a=scene.review.adapter.mapRot;
                    const s=Math.sin(a),c=Math.cos(a);
                    let drift=0,internalFaces=0,invalidUVs=0;
                    const occupied=new Set(group.blocks.map(b=>b.points[0].x+','+b.points[0].y));
                    for(const b of group.blocks){
                        if(!savedBlocks.has(b))throw Error('Geometry reallocated during rotation');
                        for(let i=0;i<b.points.length;i++){
                            const j=i*4,v=b.projected,dx=v[j+2]-v[j],dy=v[j+3]-v[j+1];
                            drift=Math.max(drift,Math.abs(c*dx-s*dy),Math.abs(s*dx+c*dy+rockwall3D.height));
                        }
                        for(const f of b.materialFaces){
                            if(f.normal){
                                const x=b.points[0].x+f.normal.x*32,y=b.points[0].y+f.normal.y*32;
                                if(occupied.has(x+','+y))internalFaces++;
                            }
                            for(const p of f.points)if(!Number.isFinite(p.u)||!Number.isFinite(p.v)||p.u<0||p.u>1||p.v<0||p.v>1)invalidUVs++;
                        }
                    }
                    return {drift,internalFaces,invalidUVs,blocks:group.blocks.length,
                        texturesStable:scene.textures.getTextureKeys().length===savedTextures};
                }''')
                assert result['drift'] < 1e-8, result
                assert not result['internalFaces'] and not result['invalidUVs'],result
                assert result['texturesStable'],result
                if heading in [0,45]:
                    await page.wait_for_timeout(80)
                    await page.screenshot(path=f'/tmp/rockwall3d-{fixture}-{heading}.png',full_page=True)
            uploads=await page.evaluate('''() => {
                rockwallReviewGame.renderer.gl.texImage2D=originalTexImage;return uploads;
            }''')
            assert uploads == 0, uploads
            results.append({'fixture':fixture,'headings':8,'blocks':result['blocks'],'rotationTextureUploads':uploads})
        await page.locator('#fixture').select_option('cave')
        themed=[]
        for floor in ['l1','l2','l3','l4','l5','l6','l7']:
            await page.locator('#floor').select_option(floor)
            await page.wait_for_timeout(100)
            for heading in [0,45,135,225,315]:
                await page.locator('#angle').fill(str(heading))
                await page.evaluate('rockwall3D.update()')
                result=await page.evaluate("""() => {
                    const s=rockwallReviewScene,r=s.review;
                    return {theme:r.theme.id,atlas:s.rockAtlas.key,
                        allWallsUseTheme:r.group.parts.every(p=>p._wallAtlas===s.rockAtlas),
                        groundUnderWalls:r.group.parts.every(p=>r.ground.depth<p.depth),
                        groundKey:r.ground.texture.key,blockCount:r.group.blocks.length};
                }""")
                assert result['theme']==floor and result['allWallsUseTheme'],result
                assert result['groundUnderWalls'],result
                assert result['blockCount']==57,result
                if heading in [0,45]:
                    await page.wait_for_timeout(50)
                    await page.screenshot(path=f'/tmp/rockwall3d-{floor}-{heading}.png',full_page=True)
            themed.append(floor)
        await page.locator('#floor').select_option('l1')
        await page.locator('#pipes').uncheck()
        assert await page.evaluate("rockwallReviewScene.review.ground.texture.key.endsWith('-false')")
        await page.locator('#pipes').check()
        assert await page.evaluate("rockwallReviewScene.review.ground.texture.key.endsWith('-true')")
        before=await page.evaluate('rockwallReviewScene.review.markerIndex')
        await page.locator('#marker').click()
        assert await page.evaluate('rockwallReviewScene.review.markerIndex') != before
        await page.locator('#grid').uncheck()
        await page.wait_for_timeout(60)
        assert await page.evaluate('rockwallReviewScene.review.grids.every(g=>!g.visible)')
        assert not errors,errors
        print(json.dumps({'renderer':'WebGL','fixtures':results,'themes':themed,'themeHeadings':5,'pageErrors':errors},indent=2))
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
