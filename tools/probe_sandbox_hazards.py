#!/usr/bin/env python3
"""Probe authored sandbox hazards through live Chromium scene handlers.

Fresh saves isolate each case. Foreground clocks are advanced in 100 ms steps;
wall-clock pause checks use actual browser waits. Both viewport sizes retain
screenshots and a machine-readable report, including runtime/network failures.
"""
import argparse
import asyncio
import json
import os
import time
from pathlib import Path
from playwright.async_api import async_playwright

SETUP = r"""() => {
  const s = __game.scene.getScene('map'); s.scene.pause();
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const move = o => {
    s.playerM = {x:o.x-s.startWorldM.x,y:o.y-s.startWorldM.y-(s.feetOffsetM||0)};
    s.gpsM={...s.playerM};s.peekM={x:0,y:0};s.syncMoveTarget();
  };
  const clean = () => {
    s.save.armor={};s.save.conditions={};s.save.shrineBuffs={};
    s.save.inv=s.save.inv.filter(i=>!UNIQUE_JEWELRY[i.id]);
    for(const k of ['immortalPotionUntil','fireResistancePotionUntil','protectionPotionUntil','shieldPotionUntil','flightPotionUntil','shadowUntil'])s.save[k]=0;
    s._incomingDamageFraction=0;s._pressureDamageFraction=0;s._shots=[];Energy.set(s.save,100);
  };
  const draw = () => {s.drawCells();s.drawObjects();};
  const advance = (ms) => {for(let t=0;t<ms;t+=100)EnvironmentHazards.tick(s,Math.min(100,ms-t)/1000);};
  const fixtures = () => [...WorldGen.tileCache.values()].flatMap(e=>[...(e.objects||[]),...(e.creatures||[])]);
  window.hazardProbe={s,check,move,clean,draw,advance,fixtures};clean();
  Sandbox.seedHazardState(s,s._sandboxHazardOrigin);
}"""

CASES = {
 'web-contact': ('hazards', r"""() => {
   const {s,check,move,draw,fixtures}=hazardProbe;
   const spider=fixtures().find(o=>o._sandboxProbe==='web-spider');check(spider,'authored web spider exists');
   const web=SpiderWebs.lists(s).webs.find(w=>w._sandboxProbe==='ground-web');check(web,'authored web exists');
   move(web);check(SpiderWebs.contact(s,'player'),'first contact pins player');
   const duration=s.save.conditions.paralysis.remainingMs;
   Conditions.tick(s.save,1000);const remaining=s.save.conditions.paralysis.remainingMs;
   check(!SpiderWebs.contact(s,'player'),'standing in web does not retrigger');
   check(s.save.conditions.paralysis.remainingMs===remaining,'web does not refresh paralysis every frame');
   move({x:web.x+s.cellM*2,y:web.y});SpiderWebs.contact(s,'player');
   move(web);check(SpiderWebs.contact(s,'player'),'leaving and returning rearms contact');
   check(s.save.conditions.paralysis.remainingMs===duration,'new entry restores pin duration');
   s.save.conditions={};s.save.flightPotionUntil=Date.now()+60000;
   check(!SpiderWebs.contact(s,'player')&&!Conditions.active(s.save,'paralysis'),'flight clears web contact');
   s.save.flightPotionUntil=0;check(SpiderWebs.contact(s,'player'),'landing on web pins again');
   move({x:web.x-s.cellM,y:web.y+s.cellM});draw();
   check(s._spiderWebGfx?.visible,'web renderer visible');
   return {paralysisMs:duration,standingRemainingMs:remaining,reentry:true,flight:true};
 }"""),
 'vent-cadence': ('hazards-cave', r"""() => {
   const {s,check,move,clean,draw,advance}=hazardProbe;
   const vents=EnvironmentHazards.lists(s).vents.filter(h=>h._sandboxProbe);
   check(vents.length===3,'three authored gas/fire vents');const results=[];
   for(const h of vents){
     clean();move(h);h.elapsedMs=0;h.nextContactMs=0;EnvironmentHazards.update(h);
     advance(4900);check(h.phase==='inactive'&&s.save.energy===100,'inactive vent safe');
     advance(100);check(h.phase==='warning'&&s.save.energy===100,'warning starts at five seconds');
     advance(2900);check(h.phase==='warning'&&s.save.energy===100,'three second warning stays safe');
     advance(100);const energy=s.save.energy;
     check(h.phase==='active'&&energy<100,'active vent first contact at eight seconds');
     check(Conditions.active(s.save,EnvironmentHazards.VENTS[h.kind].condition),'vent applies its condition');
     advance(900);check(s.save.energy===energy,'no duplicate damage inside contact second');
     advance(100);check(s.save.energy<energy,'second contact after one second');
     clean();s.save.flightPotionUntil=Date.now()+60000;h.elapsedMs=8000;h.nextContactMs=0;
     advance(100);check((s.save.energy===100)===(h.kind==='fire'),'flight avoids fire but gases still reach player');
     results.push({kind:h.kind,firstDamage:100-energy,flightProtected:h.kind==='fire'});
   }
   clean();for(const h of vents){h.elapsedMs=8000;EnvironmentHazards.update(h);}move(vents[1]);draw();
   const sprites=s._environmentHazardPool.filter(o=>o.visible&&o.texture.key==='vent_cycle');
   check(sprites.length>=3,'all three vents rendered');
   check(sprites.every(o=>o.displayWidth>0&&o.displayHeight>0&&Number.isFinite(o.x)&&Number.isFinite(o.y)),'finite vent bounds');
   return {warningMs:3000,contactMs:1000,vents:results,visibleVents:sprites.length};
 }"""),
 'pressure-contact': ('hazards-cave', r"""() => {
   const {s,check,move,clean,draw}=hazardProbe;
   const state=PressureTraps.lists(s),traps=state.traps.filter(h=>h._sandboxProbe);
   check(traps.length===2,'ball and wall authored');const results=[];
   for(const trap of traps){
     clean();const plate=state.plates.find(p=>p.trapId===trap.id);check(plate,'matching pressure plate');
     move(plate);s.save.flightPotionUntil=Date.now()+60000;PressureTraps.tick(s,.1);
     check(!plate.pressed&&trap.state==='parked','flight does not press plate');
     s.save.flightPotionUntil=0;PressureTraps.tick(s,.1);check(plate.pressed&&trap.state==='moving','ground contact launches trap');
     const x=trap.x,y=trap.y,travel=trap.travelled;PressureTraps.tick(s,20);
     check(Math.hypot(trap.x-x,trap.y-y)<=s.cellM*PressureTraps.CONFIG.speedCellsPerSecond*.10001,'long frame cannot teleport trap');
     move(trap);const px=s.playerM.x,py=s.playerM.y;
     for(let i=0;i<10;i++){move(trap);PressureTraps.contact(s,trap,.1);}
     check(s.save.energy===95,'one second contact deals five damage');
     check(Math.hypot(s.playerM.x-px,s.playerM.y-py)>0,'moving trap pushes player');
     move(trap);s.save.flightPotionUntil=Date.now()+60000;const before={...s.playerM};
     PressureTraps.contact(s,trap,.1);check(s.save.energy===95&&s.playerM.x===before.x&&s.playerM.y===before.y,'flight prevents damage and push');
     move({x:trap.x,y:trap.y+s.cellM*3});
     for(let i=0;i<260&&trap.state==='moving';i++)PressureTraps.tick(s,.1);
     check(trap.state==='spent','trap stops after its travel limit');
     s.save.flightPotionUntil=0;move(trap);const stopped={...s.playerM};
     PressureTraps.contact(s,trap,1);check(s.save.energy===90,'stopped trap remains dangerous');
     check(s.playerM.x===stopped.x&&s.playerM.y===stopped.y,'stopped trap does not push');
     results.push({kind:trap.kind,contactDamage:5,push:true,flight:true});
   }
   move(traps[0]);draw();check(s._pressureTrapPool.some(o=>o.visible&&o.texture.key==='rolling_ball'),'ball rendered');
   return {traps:results};
 }"""),
 'pit-phases': ('hazards', r"""() => {
   const {s,check,move,advance,draw}=hazardProbe;
   const h=EnvironmentHazards.lists(s).sinkholes.find(h=>h._sandboxProbe==='sinkhole');
   check(h,'authored sinkhole exists');move(h);s.save.flightPotionUntil=Date.now()+60000;
   advance(4900);check(h.phase==='warning','five second warning');
   advance(100);check(h.phase==='opening','opening starts after warning');
   advance(240);check(h.phase==='open','open after 240 ms opening');
   check(s.depth===0&&!s._hazardFallPending,'flight crosses open hole safely');
   advance(h.openMs-1);check(h.phase==='open','open hold lasts advertised duration');
   advance(1);check(h.phase==='closing','closing starts on boundary');
   advance(600);check(h.phase==='closed','closing ends after 600 ms');
   Sandbox.seedHazardState(s,s._sandboxHazardOrigin);
   const visible=EnvironmentHazards.lists(s).sinkholes.find(h=>h._sandboxProbe==='sinkhole');
   visible.elapsedMs=5240;EnvironmentHazards.update(visible);draw();
   check(s._environmentHazardPool.some(o=>o.visible&&o.texture.key==='sinkhole'&&o.displayWidth===2*CELL_PX),'two cell hole rendered');
   return {warningMs:5000,openingMs:240,openMs:h.openMs,closingMs:600,flight:true};
 }"""),
 'pit-fall': ('hazards', r"""async() => {
   const {s,check,move}=hazardProbe;
   const h=EnvironmentHazards.lists(s).sinkholes.find(h=>h._sandboxProbe==='sinkhole');
   h.elapsedMs=5240;EnvironmentHazards.update(h);move(h);
   const energy=s.save.energy;EnvironmentHazards.tick(s,.1);
   check(s._hazardFallPending,'contact schedules real async fall');
   for(let i=0;i<100&&s._hazardFallPending;i++)await new Promise(r=>setTimeout(r,10));
   check(s.depth===1&&s.save.depth===1,'fall switches world and saved depth exactly once');
   check(!s._hazardFallPending,'pending flag clears after landing');
   const p=s.cellAt(s.startWorldM.x+s.playerM.x,s.startWorldM.y+s.playerM.y+(s.feetOffsetM||0));
   check(p.loaded&&p.type===WorldGen.T.CAVE_FLOOR,'landing has real loaded cave floor');
   check(s.save.energy===energy,'sinkhole does not invent ground-hole damage');
   return {depth:s.depth,energy:s.save.energy,landing:{cellIX:p.cellIX,cellIY:p.cellIY}};
 }"""),
 'cavein-warning': ('cavein', r"""() => {
   const {s,check,move,advance,draw}=hazardProbe;
   const holes=EnvironmentHazards.lists(s).caveins.filter(h=>h._sandboxProbe);
   check(holes.length===2,'adjacent cave-in fixtures');move(holes[0]);s.save.flightPotionUntil=Date.now()+60000;
   advance(4900);check(holes.every(h=>h.phase==='warning'),'full five second cave-in warning');
   advance(100);check(holes.every(h=>h.phase==='open'),'neighbors open together');
   check(holes.every(h=>s.save.caveIns[h.id].elapsedMs===5000),'open pits persisted');
   draw();const sprites=s._environmentHazardPool.filter(o=>o.visible&&o.texture.key==='cave_chasm');
   check(sprites.length>=2,'connected cave-in chasm rendered');
   const frames=sprites.map(o=>o.frame.name);check(new Set(frames).size>1,'adjacent pit edges join rather than isolated frames');
   return {warningMs:5000,connectedFrames:frames,flight:true};
 }"""),
 'foreground-clock': ('hazards-cave', r"""async() => {
   const {s,check,move}=hazardProbe;
   const h=EnvironmentHazards.lists(s).vents.find(h=>h._sandboxProbe==='vent-poison');
   move({x:h.x,y:h.y-s.cellM});h.elapsedMs=4900;EnvironmentHazards.update(h);
   await new Promise(r=>setTimeout(r,400));check(h.elapsedMs===4900,'paused scene freezes warning clock');
   s.scene.resume();await new Promise(r=>setTimeout(r,400));s.scene.pause();
   const elapsed=h.elapsedMs-4900;check(elapsed>0&&elapsed<800,'resume advances foreground time without catchup');
   check(h.phase==='warning','warning appears after resumed foreground crosses boundary');
   return {pausedMs:400,resumedMs:400,foregroundAdvancedMs:elapsed};
 }"""),
 'reset-label': ('hazards-cave', r"""async() => {
   const {s,check}=hazardProbe;
   const old=EnvironmentHazards.lists(s).vents.find(h=>h._sandboxProbe==='vent-poison');
   old.elapsedMs=9000;EnvironmentHazards.update(old);
   s.scene.resume();await new Promise(r=>setTimeout(r,100));
   const label=s._sandboxLabelData.find(d=>d.depth===1&&d.t.text==='RESET HAZARDS'&&d.t.visible);
   check(label,'reset label visible at arrival');
   window.resetBefore={old,player:{...s.playerM},target:{...s._targetM}};
   const bounds=label.t.getBounds(),rect=s.game.canvas.getBoundingClientRect(),camera=s.cameras.main;
   const point=camera.matrix.transformPoint(bounds.centerX-camera.scrollX,bounds.centerY-camera.scrollY);
   return {x:rect.left+point.x*rect.width/s.game.scale.gameSize.width,
     y:rect.top+point.y*rect.height/s.game.scale.gameSize.height};
 }"""),
 'silk-long-frame': ('hazards', r"""() => {
   const {s,check,move,fixtures}=hazardProbe;
   const spider=fixtures().find(o=>o._sandboxProbe==='web-spider');check(spider,'authored spider');
   const target={x:spider.x+s.cellM*3,y:spider.y};move({x:target.x,y:target.y+s.cellM*2});
   check(SpiderWebs.launch(s,spider,target.x,target.y),'real silk launches');
   const shot=SpiderWebs.lists(s).shots.at(-1);SpiderWebs.tick(s,30);
   check(shot.progress>0&&shot.progress<1,'long frame preserves visible projectile travel');
   const progress=shot.progress;for(let i=0;i<20&&shot.progress<1;i++)SpiderWebs.tick(s,.1);
   check(shot.progress===1,'subsequent foreground ticks land silk');
   check(SpiderWebs.lists(s).webs.some(w=>w.cellIX===shot.cellIX&&w.cellIY===shot.cellIY),'landed web persists');
   return {longFrameSeconds:30,firstProgress:progress,landed:true};
 }"""),
 'flight-potion': ('hazards', r"""() => {
   const {s,check,draw}=hazardProbe;
   const before=Inventory.count(s.save,'flight_potion');check(before>0,'flight potion stocked');
   s.save.selSlot=s.save.inv.findIndex(i=>i.id==='flight_potion');
   const base=s.playerBodyDy(),position={...s.playerM},now=Date.now();
   check(s._useConsumable('flight_potion'),'real consumable path accepts flight');
   check(Inventory.count(s.save,'flight_potion')===before-1,'exactly one potion spent');
   check(s.save.flightPotionUntil>=now+60000,'one minute flight starts');
   check(s.playerBodyDy()===s.playerFeetNudgeY-CONSUMABLE_SPEC.flight_potion.liftPx,'body lifts above its feet');
   check(s.playerM.x===position.x&&s.playerM.y===position.y,'flight leaves ground coordinates unchanged');
   check(!Conditions.fireImmune(s.save)&&!Conditions.damageImmune(s.save),'flight is not universal immunity');
   const airborne=s.playerBodyDy();s.save.flightPotionUntil=Date.now()-1;
   check(!Conditions.flying(s.save)&&s.playerBodyDy()===base,'expiry lowers body');
   s.save.flightPotionUntil=Date.now()+60000;draw();
   return {durationMs:60000,liftPx:base-airborne,spent:1};
 }"""),
}

async def probe(args):
    args.output.mkdir(parents=True, exist_ok=True)
    report={'cases':[], 'errors':[], 'failedRequests':[]}
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True, executable_path=args.chromium)
        for size,viewport in [('desktop',{'width':1100,'height':900}),('mobile',{'width':390,'height':844})]:
            context=await browser.new_context(viewport=viewport,service_workers='block',is_mobile=size=='mobile',has_touch=size=='mobile')
            for name,(destination,action) in CASES.items():
                if args.case and name not in args.case:
                    continue
                page=await context.new_page()
                page.on('pageerror',lambda error:report['errors'].append(str(error)))
                page.on('response',lambda response:report['failedRequests'].append([response.status,response.url]) if response.status>=400 else None)
                await page.add_init_script("localStorage.clear();sessionStorage.clear();sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
                result={'name':name,'viewport':size}
                started=time.monotonic()
                try:
                    await page.goto(args.url.split('?')[0]+'?sandbox=true&sandboxZone='+destination,wait_until='domcontentloaded')
                    await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxLabelData?.length",timeout=60000)
                    await page.wait_for_function("__game.scene.getScene('map')._bootOverlayGone && !document.getElementById('bootload')",timeout=60000)
                    result['bootSeconds']=round(time.monotonic()-started,3)
                    await page.evaluate(SETUP)
                    result['details']=await page.evaluate(action)
                    if name=='reset-label':
                        point=result['details']
                        if size=='mobile':
                            await page.touchscreen.tap(point['x'],point['y'])
                        else:
                            await page.mouse.click(point['x'],point['y'])
                        await page.wait_for_timeout(100)
                        result['details']=await page.evaluate(r"""() => {
                          const {s,check}=hazardProbe;s.scene.pause();
                          const fresh=EnvironmentHazards.lists(s).vents.find(h=>h._sandboxProbe==='vent-poison');
                          check(fresh!==resetBefore.old&&fresh.elapsedMs<1000,'real label tap resets live hazards');
                          check(Math.hypot(s.playerM.x-resetBefore.player.x,s.playerM.y-resetBefore.player.y)<.001,'reset tap does not move player');
                          check(Math.hypot(s._targetM.x-resetBefore.target.x,s._targetM.y-resetBefore.target.y)<.001,'reset tap does not retarget walking');
                          return {reset:true,elapsedMs:fresh.elapsedMs,playerUnmoved:true};
                        }""")
                    result['passed']=True
                except Exception as error:
                    result['passed']=False;result['error']=str(error)
                try:
                    await page.evaluate("()=>{document.querySelectorAll('[id$=\"-modal\"]').forEach(e=>e.remove());const s=__game.scene.getScene('map');s._syncModalGate();s.drawCells();s.drawObjects();}")
                    await page.evaluate("()=>{const s=__game.scene.getScene('map');if(s.depth)s._useTimedBuff('torch',{spend:false});s.scene.resume();}")
                    await page.wait_for_timeout(150)
                    await page.evaluate("()=>{__game.scene.getScene('map').scene.pause();}")
                    await page.screenshot(path=str(args.output/(name+'-'+size+'.png')))
                except Exception as error:
                    result['captureError']=str(error);result['passed']=False
                result['totalSeconds']=round(time.monotonic()-started,3)
                report['cases'].append(result);print(json.dumps(result),flush=True)
                await page.close()
            await context.close()
        await browser.close()
    report['passed']=bool(report['cases']) and all(r['passed'] for r in report['cases']) and not report['errors'] and not report['failedRequests']
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    if not report['passed']:raise SystemExit(1)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8000/index.html')
    parser.add_argument('--chromium',default=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'))
    parser.add_argument('--output',type=Path,default=Path.home()/'.artifacts'/'sandbox-hazards')
    parser.add_argument('--case',action='append')
    asyncio.run(probe(parser.parse_args()))
