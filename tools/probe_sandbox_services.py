#!/usr/bin/env python3
"""Exercise service transactions in an isolated live sandbox browser profile.

Uses actual scene methods and modal buttons, never replaces service handlers.
Each case resets only its own save ledgers. Reports include failed assertions
and browser errors so subsequent independent cases still run.
"""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

async def probe(args):
    args.output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=args.chromium)
        page = await browser.new_page(viewport={'width': 1100, 'height': 900})
        errors, cases = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
        await page.goto(args.url, wait_until='domcontentloaded')
        await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxLabelData?.length", timeout=90000)
        await page.wait_for_timeout(1500)
        await page.evaluate("""() => {
          window.s=__game.scene.getScene('map'); s.scene.pause(); s.save.money=100000;
          window.fixture = kind => {
            const found=[...WorldGen.tileCache.values()].flatMap(e=>e.objects||[])
              .find(o=>macroFor(o)?.kind===kind);
            if (!found) throw Error('Missing authored service fixture: '+kind);
            return found;
          };
          window.dress = kind => ({kind:Macros.KIND_DIALOG[kind].modal,art:Macros.KIND_DIALOG[kind].art});
        }""")

        async def js(code):
            return await page.evaluate('() => {'+code+'}')

        async def dismiss():
            for _ in range(15):
                modal = page.locator('#message-modal')
                if not await modal.count():
                    break
                await page.wait_for_timeout(1100)
                await modal.locator('button').last.click()
            await js("document.getElementById('offer-modal')?.remove();s._syncModalGate();")

        async def click(label):
            button = page.locator('#offer-modal').get_by_role('button', name=label, exact=True)
            await button.last.click(timeout=5000)

        async def run(name, action):
            try:
                await dismiss()
                details=await action()
                cases.append({'name': name, 'ok': True, 'details': details})
            except Exception as exc:
                cases.append({'name': name, 'ok': False, 'error': str(exc)})
                await page.screenshot(path=str(args.output/(name+'-failure.png')))

        async def books():
            await js("""
              s.save.booksRead=0;s.save.booksBought=0;s.save.scholarTomes=0;
              window.bookshop=[...WorldGen.tileCache.values()].flatMap(e=>e.objects||[])
                .find(o=>o.id===s.save.bookshopId);
              if(!bookshop)throw Error('Missing authored Book Shop');
              s.save.bookshopId=bookshop.id;s.save.restoredHouses[bookshop.id]='market';
              window.prices=[];
            """)
            for _ in range(3):
                await js("prices.push(ShopsMath.listPrice(s.save,'book',itemValue('book')));s.presentThemedShop(0,0,bookshop,()=>ShopsMath.recordDeal(s.save,bookshop));")
                await click('Buy')
                await dismiss()
            before=await js("return {read:s.save.booksRead,bought:s.save.booksBought,prices,next:Macros.scholarNext(s.save)};")
            assert before['read']==3, before
            assert before['next']['ready'], before
            assert before['prices'][2]>before['prices'][0], before
            await js("window.tome=Macros.scholarNext(s.save).id;window.tomeBefore=Inventory.count(s.save,tome);s._presentScholar(0,0,fixture('scholar'),dress('scholar'));")
            await click('Collect')
            result=await js("return {read:s.save.booksRead,taken:s.save.scholarTomes,delta:Inventory.count(s.save,tome)-tomeBefore};")
            assert result['read']==3 and result['taken']==1 and result['delta']==1,result
            return {'purchases':before,'claim':result}

        async def inn():
            await js("window.inn=fixture('inn');s.save.coinBurstClaimed={};s.save.energy=50;window.innMoney=s.save.money;s._presentInn(0,0,inn,dress('inn'));")
            await click('Rest')
            result=await js("return {energy:s.save.energy,max:s.getMaxEnergy(),spent:innMoney-s.save.money,used:Macros.serviceUsedToday(s.save,inn.id)};")
            assert result['energy']==result['max'] and result['spent']>0 and result['used'],result
            await dismiss()
            await js("s.save.energy=50;s._presentInn(0,0,inn,dress('inn'));")
            assert not await page.locator('#offer-modal').count(),'Daily inn opened again'
            return result

        async def training():
            await js("window.hall=fixture('training');window.discipline=Macros.trainingKindFor(hall);s.save.training={};window.memories=s.save.discovered;s.save.discovered={};s._presentTraining(0,0,hall,dress('training'));")
            disabled=await page.locator('#offer-modal').get_by_role('button',name='Train',exact=True).is_disabled()
            assert disabled,'Training accepted zero memories'
            await dismiss()
            await js("s.save.discovered=memories;s._presentTraining(0,0,hall,dress('training'));")
            await click('Train')
            result=await js("return {kind:discipline,level:Combat.trainingLevel(s.save,discipline)};")
            assert result['level']==1,result
            return result

        async def curio():
            await js("s.save.donated=[];window.curioId=Macros.curioCollection().find(id=>Inventory.count(s.save,id)>0);if(!curioId)throw Error('No curio stocked');s.save.selSlot=s.save.inv.findIndex(i=>i.id===curioId);window.curioBefore=Inventory.count(s.save,curioId);s._presentCurio(0,0,fixture('curio'),dress('curio'));")
            await click('Donate')
            result=await js("return {id:curioId,given:Macros.curioDonated(s.save,curioId),spent:curioBefore-Inventory.count(s.save,curioId)};")
            assert result['given'] and result['spent']==1,result
            return result

        async def guild():
            await js("delete s.save.guildBounty;s.save.coinBurstClaimed={};window.guild=fixture('guildhall');s._presentGuildhall(0,0,guild,dress('guildhall'));")
            await click('Take it')
            result=await js("return {used:Macros.serviceUsedToday(s.save,guild.id),bounty:s.save.guildBounty};")
            assert result['used'] and result['bounty'],result
            return result

        async def chapel():
            await js("window.chapel=fixture('chapel');s.save.coinBurstClaimed={};(s.save.storySeen||={})['macro:chapel:'+chapel.id]=true;(s.save.chestHold||={})[chapel.id]={id:'wood',n:1};window.woodBefore=Inventory.count(s.save,'wood');INTERACTABLES.chest.custom({scene:s,save:s.save,sx:0,sy:0,dirty:false},chapel);")
            await page.wait_for_timeout(1100)
            reward=page.locator('#chest-reward-modal')
            buttons=reward.locator('button')
            if await buttons.count():
                await buttons.first.click()
            else:
                await reward.click(position={'x':10,'y':10})
            result=await js("return {used:Macros.serviceUsedToday(s.save,chapel.id),permanent:s.save.opened.includes(chapel.id),gain:Inventory.count(s.save,'wood')-woodBefore};")
            assert result['used'] and not result['permanent'] and result['gain']==1,result
            await dismiss()
            await js("INTERACTABLES.chest.custom({scene:s,save:s.save,sx:0,sy:0,dirty:false},chapel);")
            assert not await page.locator('#chest-reward-modal').count(),'Chapel paid twice in a day'
            return result

        async def crafting():
            await js("s.save.selSlot=s.save.inv.findIndex(i=>i.id==='fireball_scroll');s._throwReadyAt=0;if(!s.useFireballScroll())throw Error('Scroll refused');s._shots=[];")
            await dismiss()
            await js("if(homeRecipeLocked(s.save,'fireball_scroll'))throw Error('Used scroll still locked');window.scrollBefore=Inventory.count(s.save,'fireball_scroll');window.blankBefore=Inventory.count(s.save,'blank_scroll');s.presentHomeCraft(0,0,'fireball_scroll');")
            await click('Craft')
            result=await js("return {made:Inventory.count(s.save,'fireball_scroll')-scrollBefore,spent:blankBefore-Inventory.count(s.save,'blank_scroll')};")
            assert result=={'made':1,'spent':1},result
            return result

        async def pets():
            result=await js("""
              const entry=[...WorldGen.tileCache.values()].find(e=>(e.creatures||[]).some(c=>c.id.startsWith('released_')&&c.kind==='cat'));
              const pet=entry?.creatures.find(c=>c.id.startsWith('released_')&&c.kind==='cat');
              if(!pet)throw Error('No sandbox released cat');
              const id=petPickupItemId(pet),before=Inventory.count(s.save,id),money=s.save.money;
              const handled=pickUpPet(s,s.save,pet,0,0);
              return {handled,delta:Inventory.count(s.save,id)-before,caught:s.save.caught.includes(pet.id),
                absent:![...WorldGen.tileCache.values()].some(e=>e.creatures?.some(c=>c.id===pet.id)),moneyChanged:s.save.money!==money};
            """)
            assert result['handled'] and result['delta']==1 and result['caught'] and result['absent'] and not result['moneyChanged'],result
            return result

        async def bottle():
            await js("window.bottle=[...WorldGen.tileCache.values()].flatMap(e=>e.objects||[]).find(o=>o._sandboxProbe==='shore-bottle');if(!bottle)throw Error('Missing bottle');s.save.tipsRead=0;INTERACTABLES.bottle.custom({scene:s,save:s.save,sx:0,sy:0},bottle);")
            assert await page.locator('#message-modal').count(),'Bottle did not display its page'
            result=await js("return {opened:s.save.opened.includes(bottle.id),pages:s.save.tipsRead,hidden:isSpent(bottle,spentSets(s,s.save))};")
            assert result['opened'] and result['pages']==1 and result['hidden'],result
            await dismiss()
            await js("INTERACTABLES.bottle.custom({scene:s,save:s.save,sx:0,sy:0},bottle);")
            assert not await page.locator('#message-modal').count(),'Bottle reread'
            assert await js('return s.save.tipsRead;')==1
            return result

        async def nest():
            result=await js("""
              const bush=[...WorldGen.tileCache.values()].flatMap(e=>e.wildplants||[]).find(o=>o._sandboxProbe==='nest');
              if(!bush)throw Error('Missing nest bush');
              const contents=nestBushContents(bush.id),baby=contents.item;
              const before=baby?Inventory.count(s.save,baby):0;
              s.playerM.x=bush.x-s.startWorldM.x;s.playerM.y=bush.y-s.startWorldM.y;
              s.save.selSlot=-1;s.save.energy=s.getMaxEnergy();
              (s.save.storySeen||={})['tool:chop']=true;
              const accepted=TAP_HANDLERS.find(h=>h.name==='wildplant').try({scene:s,save:s.save,wm:{x:bush.x,y:bush.y},sx:0,sy:0});
              if(!s._workProgress)throw Error('Nest did not start chopping: '+accepted);
              const complete=s._workProgress.onComplete;s.cancelWorkProgress();complete();
              return {contents,picked:s.save.picked.includes(bush.id),babyDelta:baby?Inventory.count(s.save,baby)-before:null,
                occupant:[...WorldGen.tileCache.values()].flatMap(e=>e.creatures||[]).find(c=>c.id==='nest_'+bush.id)?.kind};
            """)
            assert result['picked'],result
            if result['contents']['type']=='baby':
                assert result['babyDelta']==1,result
            else:
                assert result.get('occupant'),result
            return result

        async def pet_growth():
            result=await js("""
              const all=[...WorldGen.tileCache.values()].flatMap(e=>e.creatures||[]);
              const baby=all.find(c=>c.id==='released_chicken_sandbox_growth_0');
              const adult=all.find(c=>c.id==='released_chicken_sandbox_growth_1');
              if(!baby||!adult)throw Error('Missing chicken growth fixtures');
              const born=baby.born,feeds=baby.favouriteFeeds;
              const young=SpriteLayout.isBabyPet(baby),grown=SpriteLayout.isBabyPet(adult);
              const ids=[petPickupItemId(baby),petPickupItemId(adult)],money=s.save.money;
              const counts=ids.map(id=>Inventory.count(s.save,id));
              pickUpPet(s,s.save,baby,0,0);pickUpPet(s,s.save,adult,0,0);
              const deltas=ids.map((id,i)=>Inventory.count(s.save,id)-counts[i]);
              const row=s.save.released.find(r=>r.id===baby.id);
              const retained=!!row&&row.born===born&&row.favouriteFeeds===feeds;
              s.save.selSlot=s.save.inv.findIndex(i=>i.id===ids[0]);
              const released=TAP_HANDLERS.find(h=>h.name==='release').try({scene:s,save:s.save,sx:0,sy:0,
                cwmx:baby.x,cwmy:baby.y,cell:s.cellAt(baby.x,baby.y)});
              const restored=[...WorldGen.tileCache.values()].flatMap(e=>e.creatures||[]).find(c=>c.id===baby.id);
              return {young,grown,ids,deltas,retained,released,restored:!!restored,
                sameGrowth:restored?.born===born&&restored?.favouriteFeeds===feeds,moneyChanged:s.save.money!==money};
            """)
            assert result['young'] and not result['grown'] and result['ids']==['baby_chicken','shiny_chicken'],result
            assert result['deltas']==[1,1] and result['retained'] and result['released'] and result['restored'] and result['sameGrowth'] and not result['moneyChanged'],result
            return result

        for name, action in [('books',books),('inn',inn),('training',training),('curio',curio),('guild',guild),('chapel',chapel),('crafting',crafting),('pets',pets),('bottle',bottle),('nest',nest),('pet-growth',pet_growth)]:
            await run(name,action)
        await page.screenshot(path=str(args.output/'services.png'))
        report={'cases':cases,'errors':errors}
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        await browser.close()
        print(json.dumps(report,indent=2))
        assert all(case['ok'] for case in cases) and not errors, 'Service probe failed; see report.json'

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8000/index.html?sandbox=true&sandboxZone=practice')
    parser.add_argument('--chromium',default='/usr/bin/chromium')
    parser.add_argument('--output',type=Path,default=Path.home()/'.artifacts/sandbox-week-2026-10-03/services')
    asyncio.run(probe(parser.parse_args()))
