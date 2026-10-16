#!/usr/bin/env python3
"""Live poisonberry gameplay probe: authored plants, screen-space taps and Eat UI.

Only fixture setup, selection and elapsed clocks are manipulated. Harvesting and
feeding run the full tap dispatcher; condition damage runs scene tick methods.
Each viewport starts an isolated browser save. No condition is applied by tests.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

SETUP = r"""() => {
 const s=__game.scene.getScene('map');s.scene.pause();
 document.querySelectorAll('[id$="-modal"]').forEach(e=>e.remove());s._syncModalGate();Conditions.setDialogShield(s.save,false);
 const all=[...WorldGen.tileCache.values()];
 const find=tag=>all.flatMap(e=>[...(e.wildplants||[]),...(e.creatures||[])]).find(o=>o._sandboxProbe===tag);
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};
 const bush=find('poisonberry-bush'),enemy=find('poisonberry-enemy'),neutral=find('poisonberry-neutral');
 check(bush&&enemy&&neutral,'all three authored poisonberry fixtures exist');
 const move=o=>{s.playerM={x:o.x-s.startWorldM.x-s.cellM,y:o.y-s.startWorldM.y-(s.feetOffsetM||0)};s.gpsM={...s.playerM};s.peekM={x:0,y:0};s.syncMoveTarget();s.drawCells();s.drawObjects()};
 const tap=o=>{move(o);let y=o.y;if(Combat.isEnemy(o)||Combat.isTame(o)||o===neutral){const span=SpriteLayout.creatureTapSpanPx(o.kind,SpriteLayout.creatureInstScale(o));y+=(span.top+span.bottom)/2*s.cellM/s.cellPx}const p=s.worldMetersToScreen(o.x,y);interactTap(s,p.x,p.y)};
 const count=()=>Inventory.count(s.save,'poisonberry');
 const select=()=>{s.save.invCat='produce';s.save.selSlot=s.save.inv.findIndex(i=>i.id==='poisonberry');s.save.invPage=Math.floor(s.invDisplayEntriesForCat('produce').findIndex(e=>e.idx===s.save.selSlot)/5);s.buildInventoryDOM();s.syncEatButton()};
 s.save.armor={};s.save.conditions={};s.save.shrineBuffs={};s.save.inv=s.save.inv.filter(i=>!UNIQUE_JEWELRY[i.id]);
 for(const k of ['immortalPotionUntil','protectionPotionUntil','shieldPotionUntil','shadowUntil'])s.save[k]=0;
 Energy.set(s.save,100);s.save.selSlot=-1;
 window.p={s,bush,enemy,neutral,check,move,tap,count,select};
}"""

async def probe(args):
    args.output.mkdir(parents=True,exist_ok=True)
    report={'cases':[],'errors':[],'failedRequests':[]}
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True,executable_path=args.chromium)
        for size,viewport in [('desktop',{'width':1100,'height':900}),('mobile',{'width':390,'height':844})]:
            context=await browser.new_context(viewport=viewport,service_workers='block')
            page=await context.new_page()
            page.on('pageerror',lambda e:report['errors'].append(str(e)))
            page.on('response',lambda r:report['failedRequests'].append([r.status,r.url]) if r.status>=400 else None)
            await page.add_init_script("localStorage.clear();sessionStorage.clear();sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
            async def js(body):return await page.evaluate('()=>{'+body+'}')
            async def case(name,fn):
                result={'name':name,'viewport':size}
                try:
                    await js("document.querySelectorAll('[id$=\"-modal\"]').forEach(e=>e.remove());p.s._syncModalGate();Conditions.setDialogShield(p.s.save,false);p.s._workProgress=null;")
                    result['details']=await fn();result['passed']=True
                except Exception as e:
                    result['passed']=False;result['error']=str(e)
                    result['diagnostic']=await js("const b=document.getElementById('eat-btn');return {body:document.body.className,button:b?{css:b.style.cssText,computed:getComputedStyle(b).cssText,display:getComputedStyle(b).display,visibility:getComputedStyle(b).visibility}:null,cellPx:p.s.cellPx,selected:getSelectedSlot(p.s.save),enemy:{x:p.enemy.x,y:p.enemy.y},modals:[...document.querySelectorAll('[id$=\"-modal\"]')].map(e=>e.id)}")
                await js("p.s.drawCells();p.s.drawObjects();")
                await page.wait_for_timeout(100)
                await page.screenshot(path=str(args.output/(name+'-'+size+'.png')))
                report['cases'].append(result);print(json.dumps(result),flush=True)
            try:
                await page.goto(args.url,wait_until='domcontentloaded')
                await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxLabelData?.length",timeout=90000)
                await page.wait_for_function("__game.scene.getScene('map')._bootOverlayGone && !document.getElementById('bootload')",timeout=90000)
                await page.evaluate(SETUP)
                async def harvest():return await js("""
                 const {s,bush,check,tap,count}=p;const before=count();tap(bush);
                 check(s.save.picked.includes(bush.id),'screen tap harvests authored bush');
                 check(count()===before+1,'harvest awards one berry');tap(bush);
                 check(count()===before+1,'repeat tap cannot duplicate harvest');
                 return {before,after:count(),picked:true,repeatAward:false};
                """)
                async def eat():
                    await js("p.select();p.beforeEat={count:p.count(),energy:p.s.save.energy};")
                    await page.locator('#eat-btn').click(timeout=5000)
                    result=await js("""
                     const {s,check,count}=p;check(count()===p.beforeEat.count-1,'Eat button consumes exactly one');
                     check(Conditions.active(s.save,'poison'),'Eat button applies poison');
                     const duration=s.save.conditions.poison.remainingMs,energy=s.save.energy;
                     s._tickConditions();s._conditionLastT=performance.now()-2100;s._tickConditions();
                     check(s.save.energy===energy-1,'foreground poison tick costs one energy');
                     check(s.eatSelected()===false&&count()===p.beforeEat.count-1,'bite cooldown refuses second meal without spend');
                     return {consumed:1,durationMs:duration,energyBeforeTick:energy,energyAfterTick:s.save.energy,cooldownRefused:true};
                    """)
                    return result
                async def feed():return await js("""
                 const {s,enemy,check,tap,count,select}=p;select();const before=count();tap(enemy);
                 check(count()===before-1,'tap feeds exactly one berry');check(Combat.poisoned(enemy),'enemy is poisoned');
                 const hp=Combat.hp(enemy),at=enemy._poisonAtT; s._tickUnitPoison(enemy,at+2100);
                 check(Combat.hp(enemy)===hp-1,'poison takes one HP through scene damage path');
                 const after=Combat.hp(enemy);s._tickUnitPoison(enemy,at+2100);check(Combat.hp(enemy)===after,'same frame cannot double damage');
                 const beforeRefresh=count();tap(enemy);check(count()===beforeRefresh-1,'already poisoned enemy consumes second offer');
                 check(enemy._poisonState.remainingMs===Conditions.DEFINITIONS.poison.durationMs,'second offer refreshes duration');
                 return {consumed:2,hpBefore:hp,hpAfter:after,owner:enemy._poisonBy,refreshMs:enemy._poisonState.remainingMs};
                """)
                async def neutral():return await js("""
                 const {neutral,check,tap,count,select}=p;select();const before=count();tap(neutral);
                 check(count()===before,'neutral animal does not spend poisonberry');check(!Combat.poisoned(neutral),'neutral animal not poisoned');
                 return {berryCount:count(),poisoned:false};
                """)
                await case('harvest',harvest)
                await case('eat',eat)
                await case('feed-enemy',feed)
                await case('neutral-refusal',neutral)
                async def pet():return await js("""
                 const {s,neutral,check,tap,count,select}=p;
                 const entry=[...WorldGen.tileCache.values()].find(e=>e.creatures?.includes(neutral));
                 check(entry,'authored deer remains available for bonded-pet fixture');
                 const row=Pets.bond(s.save,neutral,{carried:false});check(row,'authored deer bonds through pet lifecycle');
                 const live={...neutral,...row,_hp:row.hp};entry.creatures.push(live);p.pet=live;
                 check(Combat.isTame(live)&&!Combat.isEnemy(live),'fixture is an actual bonded ally');
                 select();const before=count(),hp=Combat.hp(live),playerEnergy=s.save.energy;tap(live);
                 check(count()===before-1,'pet tap consumes one poisonberry');check(Combat.poisoned(live),'bonded pet takes poison');
                 check(!document.getElementById('pet-modal')&&!document.getElementById('offer-modal'),'poison offer precedes pet menus');
                 const at=live._poisonAtT;s._tickUnitPoison(live,at+2100);
                 check(Combat.hp(live)===hp-1,'poison tick damages ally HP');check(s.save.energy===playerEnergy,'pet poison does not damage player');
                 Pets.tick(s.save,live);check(Pets.get(s.save,live).hp===hp-1,'pet damage synchronizes to durable pet record');
                 const second=count();tap(live);check(count()===second-1,'repeat offer consumes one even while already poisoned');
                 check(live._poisonState.remainingMs===60000,'repeat offer refreshes full poison duration');
                 const emptyBefore=count(),duration=live._poisonState.remainingMs;s.save.selSlot=-1;tap(live);
                 check(count()===emptyBefore&&live._poisonState.remainingMs===duration,'empty-hand pet tap spends no berry and does not refresh poison');
                 return {bondedPetId:live.id,consumed:2,hpBefore:hp,hpAfter:Combat.hp(live),savedHp:Pets.get(s.save,live).hp,refreshMs:duration,emptyHandRefused:true};
                """)
                await case('feed-bonded-pet',pet)
            except Exception as e:report['cases'].append({'name':'setup','viewport':size,'passed':False,'error':str(e)})
            await context.close()
        await browser.close()
    report['passed']=bool(report['cases']) and all(c['passed'] for c in report['cases']) and not report['errors'] and not report['failedRequests']
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    if not report['passed']:raise SystemExit(1)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8027/index.html?sandbox=true&sandboxZone=poisonberries')
    parser.add_argument('--chromium',default=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'))
    parser.add_argument('--output',type=Path,default=Path.home()/'.artifacts'/'mechanics-probes'/'poisonberry')
    asyncio.run(probe(parser.parse_args()))
