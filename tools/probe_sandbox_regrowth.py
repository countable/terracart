#!/usr/bin/env python3
"""Exercise harvesting, grass recovery, nettle crafting and PetNip in Chromium.

Fresh isolated saves; authored plants are harvested via the normal tap dispatcher.
Setup teleports the player, tops up recipe ingredients and bonds a fixture pet.
The only clock shortcut sets an already-earned grass deadline to one second away;
the running scene's ordinary ten-second save heartbeat performs recovery.
Sandbox reload deliberately resets fixtures: persistence is checked through actual
localStorage flush + loadSave, not through a sandbox reload that erases progress.
"""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

SETUP = r"""() => {
 const s=__game.scene.getScene('map');s.scene.pause();
 document.querySelectorAll('[id$="-modal"]').forEach(e=>e.remove());s._syncModalGate();Conditions.setDialogShield(s.save,false);
 const plants=[...WorldGen.tileCache.values()].flatMap(e=>e.wildplants||[]);
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};
 const find=tag=>{const o=plants.find(o=>o._sandboxProbe===tag);check(o,'fixture '+tag);return o};
 const move=o=>{s.playerM={x:o.x-s.startWorldM.x,y:o.y-s.startWorldM.y-(s.feetOffsetM||0)};s.gpsM={...s.playerM};s.peekM={x:0,y:0};s.syncMoveTarget();};
 const pick=o=>{move(o);s.save.selSlot=-1;const p=s.worldMetersToScreen(o.x,o.y);return interactTap(s,p.x,p.y)};
 const count=id=>Inventory.count(s.save,id);
 window.rp={s,plants,check,find,move,pick,count};
}"""
HARVEST = r"""() => {
 const {s,check,find,pick,count}=rp; const result=[];
 // Clear protective buffs and start at known energy for an exact sting measurement.
 s.save.armor={};s.save.shrineBuffs={};s.save.conditions={};
 s.save.inv=s.save.inv.filter(i=>!UNIQUE_JEWELRY[i.id]);
 for(const key of ['immortalPotionUntil','protectionPotionUntil','shieldPotionUntil'])s.save[key]=0;
 s._incomingDamageFraction=0;Energy.set(s.save,100);
 for(const tag of ['grass-wild','nettle','petnip','grass-owned']){
   const o=find(tag),before=count(o.crop),energyBefore=s.save.energy;pick(o);
   const harvestDamage=energyBefore-s.save.energy;check(harvestDamage===(tag==='nettle'?7:0),'exact harvest damage '+tag+': '+harvestDamage);
   check(s.save.picked.includes(o.id),'tap harvest writes picked '+tag);
   const gain=count(o.crop)-before;check(gain===1,'exact yield '+tag+': '+gain);
   const deadline=s.save.grassRegrowth?.[o.id]||null;
   check(tag==='grass-wild'?deadline>Date.now():deadline===null,'regrowth eligibility '+tag);
   // A full tap on empty harvested ground may legitimately start tilling.
   // Isolate the repeated harvest attempt to distinguish sting from till cost.
   const energyAfter=s.save.energy;
   TAP_HANDLERS.find(h=>h.name==='wildplant').try({scene:s,save:s.save,wm:{x:o.x,y:o.y},sx:0,sy:0});
   check(s.save.energy===energyAfter,'spent plant causes no duplicate sting '+tag);
   pick(o);check(count(o.crop)===before+1,'spent tap cannot duplicate '+tag);if(s._workProgress)s.cancelWorkProgress();
   result.push({tag,id:o.id,crop:o.crop,yield:gain,deadline,duplicateYield:0,harvestDamage,duplicateHarvestDamage:0});
 }
 persistSave(s.save);SaveSession.flush();const loaded=loadSave();
 for(const row of result){check(loaded.picked.includes(row.id),'picked persisted '+row.tag);check((loaded.grassRegrowth?.[row.id]||null)===row.deadline,'deadline persisted '+row.tag)}
 rp.harvest=result;return {plants:result,persistence:'persistSave + SaveSession.flush + loadSave'};
}"""
CRAFT = r"""() => {
 const {s,count}=rp;for(const [id,qty] of [['nettle',3],['longgrass',5]]){const delta=Math.max(0,qty-count(id));if(delta)s.addToInv(id,delta,false,{notWild:true})}
 (s.save.foundWild||={}).growth_powder=true;
 rp.craftBefore={nettle:count('nettle'),longgrass:count('longgrass'),growth_powder:count('growth_powder')};
 s.presentHomeCraft(0,0,'growth_powder');return rp.craftBefore;
}"""
FEED = r"""() => {
 const {s,check,count}=rp;document.querySelectorAll('[id$="-modal"]').forEach(e=>e.remove());s._syncModalGate();
 let pet=Pets.list(s.save)[0];if(!pet){const animal=[...WorldGen.tileCache.values()].flatMap(e=>e.creatures||[]).find(c=>c.kind==='cat'&&!c.pet);check(animal,'cat fixture');pet=Pets.bond(s.save,animal)}
 check(pet,'owned pet');rp.petId=pet.id;rp.petBefore={hp:pet.hp,maxHp:Combat.maxHp(pet),petnip:count('petnip')};
 s.presentPetFoodMenu(pet.id);return rp.petBefore;
}"""

async def main(args):
 args.output.mkdir(parents=True,exist_ok=True)
 report={'cases':[], 'errors':[], 'failedRequests':[], 'setup':'Isolated save; teleports; damage mitigation removed and energy set100 before harvesting; recipe ingredient top-ups; recipe discovery unlock; fixture pet bond; earned grass deadline shortened to 1 s. No yield, picked ledger, regrowth result or pet bonus is directly assigned.'}
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True)
  for name,viewport in [('desktop',{'width':1100,'height':900}),('mobile',{'width':390,'height':844})]:
   context=await browser.new_context(viewport=viewport,service_workers='block',is_mobile=name=='mobile',has_touch=name=='mobile')
   page=await context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
   page.on('response',lambda r:report['failedRequests'].append([r.status,r.url]) if r.status>=400 else None)
   await page.add_init_script("localStorage.clear();sessionStorage.clear();sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
   row={'viewport':name}
   try:
    await page.goto(args.url+'?sandbox=true&sandboxZone=herbs',wait_until='domcontentloaded')
    await page.wait_for_function("window.__game?.scene.getScene('map')?._bootOverlayGone && !document.getElementById('bootload')",timeout=60000)
    await page.evaluate(SETUP)
    row['harvest']=await page.evaluate(HARVEST)
    row['craftBefore']=await page.evaluate(CRAFT)
    await page.wait_for_timeout(500)
    await page.evaluate("()=>document.querySelectorAll('#message-modal').forEach(e=>e.remove())")
    await page.get_by_role('button',name='Craft',exact=True).last.click()
    row['craft']=await page.evaluate("""()=>{const {count,check}=rp;const after=Object.fromEntries(Object.keys(rp.craftBefore).map(id=>[id,count(id)]));check(after.nettle===rp.craftBefore.nettle-3&&after.longgrass===rp.craftBefore.longgrass-5&&after.growth_powder===rp.craftBefore.growth_powder+1,'craft ingredient/output deltas');return after}""")
    await page.screenshot(path=str(args.output/(name+'-crafted.png')))
    row['petBefore']=await page.evaluate(FEED)
    await page.get_by_role('button',name='PetNip',exact=True).click()
    await page.get_by_role('button',name='Feed',exact=True).click()
    row['pet']=await page.evaluate("""()=>{const {s,count,check}=rp;const pet=Pets.get(s.save,rp.petId);const after={hp:pet.hp,maxHp:Combat.maxHp(pet),petnip:count('petnip')};check(after.maxHp===rp.petBefore.maxHp+1&&after.petnip===rp.petBefore.petnip-1,'herb gives exactly +1 max HP and consumes one');persistSave(s.save);SaveSession.flush();const loaded=loadSave();check(Combat.maxHp(Pets.get(loaded,rp.petId))===after.maxHp,'pet bonus persisted');return after}""")
    await page.screenshot(path=str(args.output/(name+'-fed.png')))
    row['deadlineSetup']=await page.evaluate("""()=>{const {s,find}=rp;document.querySelectorAll('[id$="-modal"]').forEach(e=>e.remove());s._syncModalGate();Conditions.setDialogShield(s.save,false);const o=find('grass-wild');s.save.grassRegrowth[o.id]=Date.now()+1000;persistSave(s.save);SaveSession.flush();s.scene.resume();return {id:o.id,deadline:s.save.grassRegrowth[o.id],heartbeatMs:SaveSession.heartbeatMs}}""")
    await page.wait_for_function("!rp.s.save.picked.includes(rp.find('grass-wild').id)",timeout=16000)
    row['regrowth']=await page.evaluate("""()=>{const {s,check,find,pick,count}=rp;s.scene.pause();const o=find('grass-wild');check(!s.save.grassRegrowth[o.id],'heartbeat consumes expired deadline');for(const tag of ['nettle','petnip','grass-owned'])check(s.save.picked.includes(find(tag).id),'ineligible harvest remains spent '+tag);const before=count(o.crop);pick(o);check(count(o.crop)===before+1&&s.save.picked.includes(o.id),'regrown grass can be harvested again');check(s.save.grassRegrowth[o.id]>Date.now(),'second harvest rolls fresh deadline');return {secondYield:count(o.crop)-before,newDeadline:s.save.grassRegrowth[o.id],controlsStillSpent:true,consumer:'running scene heartbeat'}}""")
    row['passed']=True
   except Exception as e:
    row['passed']=False;row['error']=str(e)
   await page.screenshot(path=str(args.output/(name+'-final.png')))
   report['cases'].append(row);print(json.dumps(row),flush=True);await context.close()
  await browser.close()
 report['passed']=all(r['passed'] for r in report['cases']) and not report['errors'] and not report['failedRequests']
 (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 if not report['passed']:raise SystemExit(1)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--url',default='http://127.0.0.1:8027/index.html');parser.add_argument('--output',type=Path,default=Path.home()/'.artifacts/mechanics-probes/regrowth')
 asyncio.run(main(parser.parse_args()))
