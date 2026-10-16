#!/usr/bin/env python3
"""Probe draft Waystones on an explicitly supplied server, through live scene updates.

The root checkout feature is uncommitted. Reports fingerprint served sources;
this probe does not add that feature to the branch. Fixture teleports, blockers
and wall-clock advancement are setup; no Waystones result functions are called.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from playwright.async_api import async_playwright

SETUP=r'''() => {
 const s=__game.scene.getScene('map');s.scene.pause();
 if(!window.Waystones)throw Error('Draft Waystones feature unavailable on supplied server');
 const stones=[...WorldGen.tileCache.values()].flatMap(e=>e.objects||[]).filter(o=>o.kind==='waystone'&&o.waystoneSet);
 const groups=Object.groupBy(stones,o=>o.waystoneSet),members=Object.values(groups).find(a=>a.length>=3&&a.length<=6);
 if(!members)throw Error('No generated Pilgrim set with 3–6 stones');
 const check=(x,m)=>{if(!x)throw Error(m)};
 const dismiss=()=>{document.querySelectorAll('[id$="-modal"]').forEach(e=>e.remove());s._syncModalGate();Conditions.setDialogShield(s.save,false)};
 const move=o=>{dismiss();s.playerM={x:o.x-s.startWorldM.x,y:o.y-s.startWorldM.y-(s.feetOffsetM||0)};s.gpsM={...s.playerM};s.peekM={x:0,y:0};s.syncMoveTarget();s._waystoneTickAt=0;s.scene.resume()};
 const reward=()=>s.save.waystoneSets?.[members[0].waystoneSet];
 const chests=()=>[...WorldGen.tileCache.values()].flatMap(e=>e.objects||[]).filter(o=>o.id===reward()?.id);
 window.w={s,members,check,dismiss,move,reward,chests};dismiss();
 return {set:members[0].waystoneSet,count:members.length,ids:members.map(o=>o.id)};
}'''

async def probe(args):
    args.output.mkdir(parents=True,exist_ok=True)
    report={'feature':'uncommitted draft Waystones; separate from shipped main','url':args.url,'sources':{},'cases':[],'errors':[]}
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium')
        context=await browser.new_context(viewport={'width':1100,'height':900},service_workers='block')
        page=await context.new_page()
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        await page.add_init_script("if(!sessionStorage.getItem('waystone-probe')){localStorage.clear();sessionStorage.clear();sessionStorage.setItem('waystone-probe','1')}sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
        async def js(code):return await page.evaluate('()=>{'+code+'}')
        async def boot():
            await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxLabelData?.length",timeout=90000)
            await page.wait_for_function("__game.scene.getScene('map')._bootOverlayGone && !document.getElementById('bootload')",timeout=90000)
            return await page.evaluate(SETUP)
        async def enter(index):
            await js(f'w.move(w.members[{index}]);')
            await page.wait_for_timeout(450)
            await js('w.s.scene.pause();w.dismiss();')
        async def run(name,fn):
            result={'name':name}
            try:result['details']=await fn();result['passed']=True
            except Exception as e:result.update(passed=False,error=str(e))
            await js('w.s.drawCells();w.s.drawObjects();')
            await page.wait_for_timeout(100)
            await page.screenshot(path=str(args.output/(name+'.png')))
            report['cases'].append(result);print(json.dumps(result),flush=True)
        try:
            await page.goto(args.url,wait_until='domcontentloaded')
            for source in ['src/waystones.js','src/app.js','src/street_variants.js','src/save_state.js']:
                response=await context.request.get(args.url.split('/index.html')[0]+'/'+source)
                data=await response.body();report['sources'][source]={'status':response.status,'sha256':hashlib.sha256(data).hexdigest()}
            report['generated']=await boot()
            async def contact():
                await js('w.s.save.flightPotionUntil=Date.now()+60000;')
                await enter(0)
                await js("w.check(!Waystones.isLit(w.members[0],w.s.save),'flying contact must not light');w.s.save.flightPotionUntil=0")
                await enter(0)
                return await js("const until=w.s.save.waystoneUntil[w.members[0].id];w.check(Waystones.isLit(w.members[0],w.s.save),'grounded live update lights');w.check(until-Date.now()>298000&&until-Date.now()<=300000,'five-minute expiry');return {flightRefused:true,remainingMs:until-Date.now()}")
            async def expiry():
                # Change a persisted timestamp, not the activation or completion result.
                await js("w.s.save.waystoneUntil[w.members[0].id]=Date.now()-1;w.check(!Waystones.isLit(w.members[0],w.s.save),'expired light goes out')")
                await enter(0)
                return await js("w.check(Waystones.isLit(w.members[0],w.s.save),'revisiting expired stone relights');return {relit:true,remainingMs:w.s.save.waystoneUntil[w.members[0].id]-Date.now()}")
            async def complete():
                for i in range(1,report['generated']['count']):await enter(i)
                return await js("w.check(!!w.reward(),'set completes through live update');w.check(w.chests().length===1,'exactly one reward');w.check(chestTier(w.chests()[0])===3,'T3 reward');w.check(w.members.every(o=>Waystones.isLit(o,w.s.save,Date.now()+1e9)),'all permanently lit');persistSave(w.s.save);flushSave();return {reward:w.reward(),count:w.chests().length,permanent:true}")
            async def reload():
                await page.reload(wait_until='domcontentloaded');await boot();await enter(0)
                return await js("w.check(!!w.reward(),'completion survives page reload');w.check(w.chests().length===1,'reload restores exactly one reward');return {rewardCount:w.chests().length,permanent:w.members.every(o=>Waystones.isLit(o,w.s.save,Date.now()+1e9))}")
            async def pending():
                await js("""
                 const reward=w.reward();for(const e of WorldGen.tileCache.values())e.objects=(e.objects||[]).filter(o=>o.id!==reward.id);
                 w.s.save.waystoneSets={};w.s.save.waystoneUntil={};w.oldRocks=[...(w.s.save.placedRocks||[])];
                 const last=w.members.at(-1),cell=worldMetersToAbsCell(w.s,last.x,last.y);
                 for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const c=absCellOffset(w.s,cell.cellIX,cell.cellIY,dx,dy);w.s.save.placedRocks.push(`${c.cellIX}_${c.cellIY}`)}
                """)
                for i in range(report['generated']['count']):await enter(i)
                await js("w.check(!!w.reward(),'blocked seat retains completion');w.check(!Number.isFinite(w.reward().x)&&w.chests().length===0,'blocked ground retains pending chest');persistSave(w.s.save);flushSave();")
                await page.reload(wait_until='domcontentloaded');await boot()
                await js("w.check(!!w.reward(),'pending survives page reload');w.s.save.placedRocks=[];")
                await enter(report['generated']['count']-1)
                return await js("w.check(w.chests().length===1,'freeing legal ground restores exactly one pending reward');return {pendingSurvivedReload:true,restoredCount:w.chests().length,tier:chestTier(w.chests()[0])}")
            await run('grounded-contact',contact)
            await run('expiry-revisit',expiry)
            await run('completion',complete)
            await run('reload-reward',reload)
            await run('blocked-pending-reload',pending)
        except Exception as e:report['cases'].append({'name':'availability/setup','passed':False,'error':str(e)})
        await browser.close()
    report['passed']=bool(report['cases']) and all(c['passed'] for c in report['cases']) and not report['errors']
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    if not report['passed']:raise SystemExit(1)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url',required=True,help='Explicit draft-feature server, e.g. http://127.0.0.1:8012/index.html?sandbox=true&sandboxZone=pilgrim')
    p.add_argument('--output',type=Path,default=Path.home()/'.artifacts'/'mechanics-probes'/'waystones')
    asyncio.run(probe(p.parse_args()))
