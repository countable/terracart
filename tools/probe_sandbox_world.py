#!/usr/bin/env python3
"""Exercise recent sandbox world mechanics in a fresh Chromium save per case.

Runs real scene handlers and work completion; time is advanced only for isolated
combat/work checks. Reports every failure and keeps screenshots for review.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

SETUP = r"""() => {
  const s = __game.scene.getScene('map'); s.scene.pause();
  const entries = [...WorldGen.tileCache.values()];
  const objects = entries.flatMap(e => e.objects || []);
  const plants = entries.flatMap(e => e.wildplants || []);
  const creatures = entries.flatMap(e => e.creatures || []);
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const move = o => {
    s.playerM = {x:o.x-s.startWorldM.x, y:o.y-s.startWorldM.y};
    s.gpsM = {...s.playerM}; s.peekM = {x:0,y:0}; s.syncMoveTarget();
  };
  const resetHealth = () => {
    s.save.armor = {}; s.save.conditions = {};
    s.save.inv = s.save.inv.filter(i => !UNIQUE_JEWELRY[i.id] && !CARRIED_ITEM_SPEC[i.id]?.projectileReduction);
    s._incomingDamageFraction = 0; s._igniteNextT = 0;
    for (const k of ['immortalPotionUntil','fireResistancePotionUntil','protectionPotionUntil','shieldPotionUntil','shadowUntil']) s.save[k] = 0;
    s.save.shrineBuffs = {}; Energy.set(s.save,100); s._lavaAccum=0;
    s._walkHazardAccum=0; s._walkHazardHere=null; s._shots=[];
  };
  const context = o => ({scene:s,save:s.save,wm:{x:o.x,y:o.y},sx:s.viewCenterX,sy:s.viewCenterY,dirty:false});
  const interact = o => runInteractable(context(o), o);
  const finishWork = () => {
    check(s._workProgress && !s._workProgress.combat,'a real work wheel started');
    s._workProgress.startT=performance.now()-s._workProgress.durationMs-1;
    s._drawWorkProgress(); check(!s._workProgress,'work wheel completed');
  };
  window.worldProbe = {s,entries,objects,plants,creatures,check,move,resetHealth,context,interact,finishWork};
}"""

CASES = {
    'crater': ('crater', r"""() => {
      const {s,entries,objects,check,move,resetHealth}=worldProbe;
      const altar=objects.find(o=>o.zoneVariant==='quarry-crater'&&o.kind==='grove_shrine');
      check(altar,'authored crater altar exists');
      const e=entries.find(e=>e.objects?.includes(altar)), N=e.cellsPerEdge;
      const vents=objects.filter(o=>o.zoneVariant==='quarry-crater'&&o.kind==='lava_vent');
      check(vents.length===20,`rounded crater has 20 lava cells, got ${vents.length}`);
      check(e.grid[altar._iy*N+altar._ix]!==WorldGen.T.CAVE_LAVA,'altar stays dry');
      for(const dx of [-2,2])for(const dy of [-2,2])check(e.grid[(altar._iy+dy)*N+altar._ix+dx]!==WorldGen.T.CAVE_LAVA,'corners are dry');
      resetHealth(); move(vents[0]); s._tickLava(1);
      const lost=100-s.save.energy; check(lost===Combat.LAVA_DMG_PER_S,`lava deals environmental damage (${lost})`);
      check(Conditions.active(s.save,'burning'),'lava ignites player');
      resetHealth(); s.save.fireResistancePotionUntil=Date.now()+60000; s._tickLava(1);
      check(s.save.energy===100,'fire resistance prevents lava damage');
      move(altar); resetHealth();s._tickLava(1);check(s.save.energy===100,'island is safe');
      s.drawCells();s.drawObjects();return {lavaCells:vents.length,damagePerSecond:lost};
    }"""),
    'meadow': ('meadow', r"""() => {
      const {s,plants,check}=worldProbe;
      const bushes=plants.filter(o=>o.zoneVariant==='meadow'&&o.crop==='shrub');
      check(bushes.length>0,'Meadow contains bushes');
      for(const o of bushes){check(wildplantSprite(o).sheet==='bushes','Meadow uses ordinary bushes');check(walkHazardDamageRate(o)===0,'Meadow bushes do not hurt');}
      const density=ZoneVariants.byId('meadow').background.materialDensity.shrub;
      check(density>0&&density<1,'Meadow has a sparse shrub background');
      s.drawCells();s.drawObjects();return {regularBushes:bushes.length};
    }"""),
    'mimic': ('encounters', r"""() => {
      const {s,objects,entries,check,move,interact}=worldProbe;
      const chest=objects.find(o=>o._sandboxProbe==='mimic'&&chestHidesMimic(o));check(chest,'a guaranteed mimic chest is authored');
      move(chest); const gold=s.save.money, inventory=JSON.stringify(s.save.inv);
      interact(chest);const id='mimic:'+chest.id;
      check(s.save.opened.includes(chest.id),'disguise enters permanent opened ledger');
      check(entries.flatMap(e=>e.creatures||[]).filter(c=>c.id===id).length===1,'one mimic appears');
      check(s.save.money===gold&&JSON.stringify(s.save.inv)===inventory,'mimic grants no chest loot');
      interact(chest);check(entries.flatMap(e=>e.creatures||[]).filter(c=>c.id===id).length===1,'repeat tap never duplicates mimic');
      s.drawCells();s.drawObjects();return {chest:chest.id,mimic:id};
    }"""),
    'ambushes': ('encounters', r"""() => {
      const {s,creatures,check,move,resetHealth}=worldProbe;
      const treant=creatures.find(c=>c.kind==='treant');check(treant,'treant fixture exists');
      treant._disguiseRevealed=false;check(!Combat.isEnemy(treant),'disguised treant is untargetable');
      enemyDisguiseTick(s,treant,treant.x+s.cellM*2,treant.y);check(Combat.isDisguised(treant),'distant treant stays disguised');
      enemyDisguiseTick(s,treant,treant.x+s.cellM*.5,treant.y);check(Combat.isEnemy(treant),'nearby treant reveals');
      const wurm=creatures.find(c=>c.kind==='wurm');check(wurm,'wurm fixture exists');
      const row=EnemyRoster.get('wurm'),now=performance.now();delete wurm._burrowNextT;delete wurm._emergeUntil;
      enemyBurrowTick(s,wurm,row,now);check(Combat.isConcealed(wurm),'burrowing wurm is untargetable');
      enemyBurrowTick(s,wurm,row,wurm._burrowNextT+1);check(!Combat.isConcealed(wurm),'wurm emerges on its authored ground');
      check(wurm._emergeUntil>0,'wurm emergence animation starts');
      const zombie=creatures.find(c=>c.kind==='zombie'&&c.emergeFromGround);check(zombie,'emerging zombie fixture exists');
      resetHealth();move({x:zombie.x+s.cellM,y:zombie.y});delete zombie._hasEmerged;delete zombie._emergeUntil;
      enemyBurrowTick(s,zombie,EnemyRoster.get(zombie.kind),performance.now());check(zombie._hasEmerged,'zombie emerges when approached');
      return {treant:treant.id,wurm:wurm.id,zombie:zombie.id};
    }"""),
    'monster-effects': ('encounters', r"""() => {
      const {s,creatures,check,move,resetHealth}=worldProbe;
      const mushroom=creatures.find(c=>c.kind==='mushroom_monster');check(mushroom,'mushroom monster fixture exists');
      resetHealth();move({x:mushroom.x+s.cellM*2,y:mushroom.y});
      const row=EnemyRoster.get(mushroom.kind),now=performance.now();
      delete mushroom._attackNextT;delete mushroom._attackWindupUntil;delete mushroom._conditionalAttackMode;
      const px=s.startWorldM.x+s.playerM.x,py=s.startWorldM.y+s.playerM.y;
      rosterEnemyAttack(s,mushroom,row,now,px,py,false,.1);
      rosterEnemyAttack(s,mushroom,row,now+row.windupSeconds*1000+1,px,py,false,.1);
      const puff=s._shots.find(p=>p.projectile==='confusion_puff');check(puff,'mushroom fires confusion projectile');
      puff.x=px;puff.y=py;s._combatTick(0);
      check(Conditions.active(s.save,'confused'),'real projectile impact confuses player');
      const elemental=creatures.find(c=>c.kind==='fire_elemental');check(elemental,'fire elemental fixture exists');
      resetHealth();move({x:elemental.x+1,y:elemental.y});
      check(!Combat.canBurn(elemental),'elemental cannot be burned');
      const erow=EnemyRoster.get(elemental.kind);delete elemental._attackNextT;delete elemental._attackWindupUntil;
      rosterEnemyAttack(s,elemental,erow,now,elemental.x+1,elemental.y,false,.1);
      rosterEnemyAttack(s,elemental,erow,now+erow.windupSeconds*1000+1,elemental.x+1,elemental.y,false,.1);
      check(s.save.energy<100,'elemental melee harms player');check(Conditions.active(s.save,'burning'),'elemental melee ignites player');
      return {confusion:true,burning:true};
    }"""),
    'road-hazards': ('barricade-road', r"""() => {
      const {s,entries,objects,plants,check,move,resetHealth,context,finishWork}=worldProbe;
      const barrier=plants.find(o=>o._street==='barricade'&&o.crop==='barricade');check(barrier,'road barricade fixture exists');
      const e=entries.find(e=>e.wildplants?.includes(barrier)),N=e.cellsPerEdge;
      const onRoad=plants.filter(o=>o._street==='barricade').filter(o=>{
        const x=Math.floor((o.x-Math.floor(o.x/e.tileEdgeM)*e.tileEdgeM)/(e.tileEdgeM/N));
        const y=Math.floor((o.y-Math.floor(o.y/e.tileEdgeM)*e.tileEdgeM)/(e.tileEdgeM/N));
        return WorldGen.isRoadTerrain(e.grid[y*N+x]);});check(onRoad.length>0,'barricades cover road tiles');
      resetHealth();move(barrier);s._tickWalkHazards(1,barrier.x,barrier.y,barrier.x,barrier.y);check(s.save.energy<100,'standing on barricade damages player');
      s.save.selSlot=-1;s.save.relics.axe={tier:7}; const handler=TAP_HANDLERS.find(h=>h.name==='wildplant');check(handler,'wildplant tap handler exists');
      handler.try(context(barrier));finishWork();check(setOf(s.save.picked).has(barrier.id),'chopping clears barrier');
      const pc=s.playerToWorldCell();check(s._walkHazardCell(pc.tx,pc.ty,Math.floor(pc.cx),Math.floor(pc.cy))===0,'cleared barrier stops hurting');
      const bramble=plants.find(o=>o._streetArt==='bramble');check(bramble,'thorny road fixture exists');
      check(walkHazardDamageRate(bramble)>0,'bramble contact hurts');
      return {roadBarriers:onRoad.length,removed:barrier.id,thorny:bramble.id};
    }"""),
    'burned-road': ('burned-road', r"""() => {
      const {s,entries,check,move,resetHealth}=worldProbe;
      const e=entries.find(e=>e.streetIndex?.lines.some(r=>r.variant==='burned'));
      check(e,'authored Burned Row exists');
      const N=e.cellsPerEdge,m=e.tileEdgeM/N,anchor=e.objects[0];
      const ox=Math.floor(anchor.x/e.tileEdgeM)*e.tileEdgeM,oy=Math.floor(anchor.y/e.tileEdgeM)*e.tileEdgeM;
      let hot;
      for(let y=0;y<N&&!hot;y++)for(let x=0;x<N;x++)if(StreetVariants.hotRoadAt(e,x+.5,y+.5)){hot={x:ox+(x+.5)*m,y:oy+(y+.5)*m};break;}
      check(hot,'ember road has hot paving');resetHealth();move(hot);s._tickLava(1);
      check(100-s.save.energy===Combat.LAVA_DMG_PER_S,'embers deal lava damage');
      check(Conditions.active(s.save,'burning'),'embers ignite player');
      resetHealth();s.save.fireResistancePotionUntil=Date.now()+60000;s._tickLava(1);
      check(s.save.energy===100,'fire resistance protects on embers');
      return {damagePerSecond:Combat.LAVA_DMG_PER_S};
    }"""),
    'covered-find': ('strip-mine', r"""() => {
      const {s,entries,objects,check,move,context,interact,finishWork}=worldProbe;
      const mark=entries.flatMap(e=>e.extraTreasures||[]).find(o=>o.coverRockId);
      check(mark,'strip mine has a covered treasure');
      const rock=objects.find(o=>o.id===mark.coverRockId);check(rock,'covering rock exists');
      move(rock);s.save.selSlot=-1;
      check(!treasureExposed(mark,s),'rock hides the treasure');
      const handler=TAP_HANDLERS.find(h=>h.name==='treasure');
      check(handler.try(context(mark))===false,'covered mark cannot steal mining tap');
      interact(rock);finishWork();check(treasureExposed(mark,s),'real mining exposes mark');
      check(handler.try(context(mark))===true,'exposed mark accepts digging');
      if(s._workProgress)finishWork();
      check(setOf(s.save.foundTreasures).has(mark.id),'dig persists collected mark');
      check(handler.try(context(mark))===false,'same mark cannot pay twice');
      return {rock:rock.id,treasure:mark.id};
    }"""),
    'hardworking': ('rock', r"""() => {
      const {s,objects,check,move,interact,finishWork}=worldProbe;
      const rock=objects.find(o=>o.kind==='mineralrock'&&!o.deposit&&!s.brokenRockSet.has(o.id));
      check(rock,'work target exists');move(rock);delete s.save.boonUntil?.work;s.save.selSlot=-1;
      interact(rock);check(s._workProgress,'ordinary mining starts');const normal=s._workProgress.durationMs;
      s.cancelWorkProgress();s.save.selSlot=s.save.inv.findIndex(i=>i.id==='hardworking_potion');
      const count=Inventory.count(s.save,'hardworking_potion');check(s._useTimedBuff('hardworking_potion'),'drink works');
      check(Inventory.count(s.save,'hardworking_potion')===count-1,'one potion consumed');
      s.save.selSlot=-1;interact(rock);check(s._workProgress,'boosted mining starts');
      const boosted=s._workProgress.durationMs;check(boosted===Math.round(normal/Shrines.WORK_SPEED_MUL),'actual mining wheel runs faster');
      finishWork();check(s.brokenRockSet.has(rock.id),'boosted wheel mines rock');
      return {normalMs:normal,boostedMs:boosted};
    }"""),
    'containers': ('encounters', r"""() => {
      const {s,objects,check,interact}=worldProbe;
      const barrels=objects.filter(isBarrel);check(barrels.length>=2,'barrel and clay-pot fixtures exist');
      const results=[];
      for(const o of barrels.slice(0,2)){
        interact(o);check(setOf(s.save.opened).has(o.id),'container permanently opened');
        const before=JSON.stringify({inv:s.save.inv,money:s.save.money});interact(o);
        check(before===JSON.stringify({inv:s.save.inv,money:s.save.money}),'repeat smash gives no reward');
        check(isSpent(o,spentSets(s,s.save)),'spent container stays spent');results.push(o.id);
      }
      const crate=objects.find(o=>o._sandboxProbe==='daily-crate');check(crate&&restocks(crate),'refill crate uses live restock predicate');
      (s.save.chestHold ||= {})[crate.id]={id:'wood',n:2};
      interact(crate);check(Macros.usedToday(s.save,crate.id),'crate uses daily ledger');
      check(!setOf(s.save.opened).has(crate.id),'crate is not permanently opened');
      return {permanent:results,daily:crate.id};
    }"""),
}

async def probe(args):
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'cases': [], 'errors': [], 'failedRequests': []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=args.chromium)
        for name, (destination, action) in CASES.items():
            if args.case and name not in args.case:
                continue
            context = await browser.new_context(viewport={'width': 1000, 'height': 850}, service_workers='block')
            page = await context.new_page()
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.on('response', lambda response: report['failedRequests'].append([response.status, response.url]) if response.status >= 400 else None)
            await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
            result = {'name': name, 'destination': destination}
            try:
                await page.goto(args.url.split('?')[0] + '?sandbox=true&sandboxZone=' + destination, wait_until='domcontentloaded')
                await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxLabelData?.length", timeout=60000)
                await page.wait_for_timeout(1200)
                await page.evaluate(SETUP)
                result['details'] = await page.evaluate(action)
                result['passed'] = True
            except Exception as error:
                result['passed'] = False
                result['error'] = str(error)
            # Keep world evidence visible after reward/story overlays.
            await page.evaluate("() => { document.querySelectorAll('[id$=\"-modal\"]').forEach(el=>el.remove()); const s=__game.scene.getScene('map'); s._syncModalGate(); s.scene.resume(); }")
            await page.wait_for_timeout(150)
            await page.add_style_tag(content='[id$="-modal"] { display: none !important; }')
            await page.screenshot(path=str(args.output / (name + '.png')))
            report['cases'].append(result)
            print(json.dumps(result), flush=True)
            await context.close()
        await browser.close()
    report['passed'] = all(r['passed'] for r in report['cases']) and not report['errors'] and not report['failedRequests']
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    if not report['passed']:
        raise SystemExit(1)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000/index.html')
    parser.add_argument('--chromium', default=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
    parser.add_argument('--output', type=Path, default=Path.home()/'.artifacts'/'sandbox-world')
    parser.add_argument('--case', action='append')
    asyncio.run(probe(parser.parse_args()))
