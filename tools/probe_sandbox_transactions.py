#!/usr/bin/env python3
"""Probe real recipe/sale buttons and their economy ledgers in a fresh sandbox save.

Fixture setup changes inventory and discovery state; transaction implementations
are never replaced. Recipes make one unit per click, including the repeat offer.
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
        page = await browser.new_page(viewport={'width': 390, 'height': 844})
        errors, cases = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
        await page.goto(args.url, wait_until='domcontentloaded')
        await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxLabelData?.length", timeout=90000)
        await page.wait_for_timeout(1500)
        async def js(code):
            return await page.evaluate('() => {' + code + '}')
        await js("""
          window.s=__game.scene.getScene('map');s.scene.pause();
          document.querySelectorAll('[id$="-modal"]').forEach(e=>e.remove());s._syncModalGate();
          window.magic=[...WorldGen.tileCache.values()].flatMap(e=>e.objects||[])
            .find(o=>s.houseShopRole(o)==='shop'&&s.shopLine(o)?.theme==='potion');
          if(!magic)throw Error('Missing authored Magic Shop');
          window.stock=(id,n)=>{s.save.inv=s.save.inv.filter(i=>i.id!==id);if(n)s.save.inv.push({id,count:n});};
          window.snapshot=()=>({money:s.save.money,inv:Object.fromEntries(s.save.inv.map(i=>[i.id,i.count]))});
          window.openRecipe=(kind,id)=>kind==='craft'?s.presentHomeCraft(0,0,id):
            s.presentBrewOffer(0,0,magic,()=>ShopsMath.recordDeal(s.save,magic),id);
        """)
        async def case(name, action):
            try:
                await js("document.querySelectorAll('[id$=\"-modal\"]').forEach(e=>e.remove());s._syncModalGate();")
                cases.append({'name':name,'ok':True,'details':await action()})
                (args.output/(name+'-failure.png')).unlink(missing_ok=True)
            except Exception as exc:
                cases.append({'name':name,'ok':False,'error':str(exc)})
                await page.screenshot(path=str(args.output/(name+'-failure.png')))
        async def click(label):
            await page.locator('#offer-modal').get_by_role('button',name=label,exact=True).last.click()
        async def recipe(kind, rec):
            data=json.dumps({'kind':kind,'rec':rec})
            await js("""
              const {kind,rec}="""+data+""";
              s.save.inv=[];s.save.money=100;s.save.selSlot=-1;
              s.save.foundWild={[rec.id]:true};s.save.usedScrolls=[rec.id];
              for(const r of rec.cost)stock(r.id,r.qty*2);
              window.before=snapshot();openRecipe(kind,rec.id);
            """)
            label='Craft' if kind=='craft' else 'Brew'
            # Retain the detached original button to verify a stale event cannot pay twice.
            await page.locator('#offer-modal').get_by_role('button',name=label,exact=True).last.evaluate('(b)=>window.oldAccept=b')
            await click(label)
            after=await js('return snapshot();')
            assert after['inv'].get(rec['id'])==1,after
            for ingredient in rec['cost']:
                assert after['inv'].get(ingredient['id'],0)==ingredient['qty'],after
            assert after['money']==100-rec.get('coins',0),after
            assert await page.locator('#offer-modal [role="status"]').count(),'Missing repeat receipt'
            await js('oldAccept.click();')
            assert await js('return snapshot();')==after,'Detached button paid twice'
            await page.wait_for_timeout(150)
            assert await js('return snapshot();')==after,'Receipt paid without action'
            await click(label)
            final=await js('return snapshot();')
            assert final['inv'].get(rec['id'])==2,final
            assert final['money']==100-2*rec.get('coins',0),final
            for ingredient in rec['cost']:
                assert final['inv'].get(ingredient['id'],0)==0,final
            assert await page.locator('#offer-modal').get_by_role('button',name=label,exact=True).last.is_disabled(),'Depleted repeat enabled'
            if rec['id'] in ('throwing_spear','healing_potion'):
                await page.screenshot(path=str(args.output/(kind+'-depleted.png')))
            return {'output':rec['id'],'clicks':2,'consumed':rec['cost'],'feePerClick':rec.get('coins',0),'final':final,'staleClickIgnored':True}
        async def entry_routes():
            home=await js("""
              s.save.inv=[{id:'wood',count:1},{id:'rubble',count:1}];s.save.selSlot=-1;
              const home=s.save.starterTrailer||[...WorldGen.tileCache.values()].flatMap(e=>e.objects||[]).find(o=>s.isStarterShop(o));
              if(!home)throw Error('Missing authored home');
              window.routeHome=home;s.shopInteract(0,0,home);return {id:home.id};
            """)
            assert await page.locator('#offer-modal').get_by_role('button',name='Craft',exact=True).last.is_enabled()
            await click('Craft')
            assert await js("return Inventory.count(s.save,'throwing_spear')===1&&Inventory.count(s.save,'wood')===0;")
            await click('Leave')
            await js("s.save.inv=[{id:'cress',count:3}];s.save.selSlot=-1;s.save.money=2;s.save.foundWild={antidote:true};s.save.shopDeals={};s.shopInteract(0,0,magic);")
            await page.locator('#offer-modal').get_by_role('button',name='Brew',exact=True).first.click()
            await click('Brew')
            assert await js("return Inventory.count(s.save,'antidote')===1&&Inventory.count(s.save,'cress')===0&&s.save.money===0;")
            return {'home':home,'magic':await js('return magic.id;'),'homeEntryCrafted':True,'shopEntryBrewed':True}
        await case('authored-entry-routes',entry_routes)
        recipes=await js('return {craft:HOME_RECIPES,brew:BREW_RECIPES};')
        for kind, rows in recipes.items():
            for rec in rows:
                await case(kind+'-'+rec['id'],lambda k=kind,r=rec:recipe(k,r))
        async def discovery():
            result=await js("""
              s.save.inv=[];s.save.foundWild={};s.save.usedScrolls=[];
              s.addToInv('antidote',1,false,{notWild:true});
              const purchasedLocked=homeRecipeLocked(s.save,'antidote');
              s.presentBrewOffer(0,0,magic,()=>{});return {purchasedLocked};
            """)
            assert result['purchasedLocked']
            assert await page.locator('#offer-modal').get_by_role('button',name='Brew',exact=True).last.is_disabled()
            result.update(await js("""
              s.addToInv('antidote',1,false);s.addToInv('rope',1,false);
              s.addToInv('fireball_scroll',1,false);
              const scrollFoundLocked=homeRecipeLocked(s.save,'fireball_scroll');
              stock('blank_scroll',1);s._throwReadyAt=0;s.save.selSlot=s.save.inv.findIndex(i=>i.id==='fireball_scroll');
              const used=s.useFireballScroll();s._shots=[];
              return {potionUnlocked:!homeRecipeLocked(s.save,'antidote'),ropeUnlocked:!homeRecipeLocked(s.save,'rope'),
                scrollFoundLocked,used,scrollUsedUnlocked:!homeRecipeLocked(s.save,'fireball_scroll')};
            """))
            assert all(result.values()),result
            await js("s.presentHomeCraft(0,0,'fireball_scroll');")
            await click('Craft')
            assert await js("return Inventory.count(s.save,'blank_scroll')===0&&Inventory.count(s.save,'fireball_scroll')===1;")
            return result
        await case('discovery-and-scroll-use',discovery)
        async def fees():
            await js("s.save.inv=[{id:'cress',count:3}];s.save.foundWild={antidote:true};s.save.money=1;openRecipe('brew','antidote');")
            assert await page.locator('#offer-modal').get_by_role('button',name='Brew',exact=True).last.is_disabled()
            # Revalidation after the offer opened: funds disappearing must not consume herbs.
            await js("s.save.money=2;openRecipe('brew','antidote');s.save.money=1;window.before=snapshot();")
            await click('Brew')
            assert await js('return JSON.stringify(before)===JSON.stringify(snapshot());'),'Unaffordable stale offer consumed ingredients'
            return {'zeroSpendOnInsufficientFee':True}
        await case('fee-refusal',fees)
        async def sell():
            await js("s.save.inv=[{id:'berry',count:2}];s.save.selSlot=0;s.save.money=0;(s.save.storySeen||={})['sale:first']=true;window.price=trailerSellPrice(itemValue('berry'));s.presentHomeSell(0,0);")
            await click('Sell')
            first=await js('return {state:snapshot(),price};')
            assert first['state']['money']==first['price'] and first['state']['inv']['berry']==1,first
            await click('Sell')
            assert await js("return s.save.money===price*2&&Inventory.count(s.save,'berry')===0;")
            assert await page.locator('#offer-modal').get_by_role('button',name='Sell',exact=True).last.is_disabled()
            return first
        await case('home-sell',sell)
        async def coin_ring():
            result=await js("""
              const entry=[...WorldGen.tileCache.values()].find(e=>e.coinDrops?.some(c=>c.id.startsWith('sandbox_coin_')));
              const coin=entry?.coinDrops.find(c=>c.id.startsWith('sandbox_coin_'));
              if(!coin)throw Error('Missing authored coin pile');
              // Keep one authored coin; isolate other collectors and coins.
              for(const e of WorldGen.tileCache.values())e.coinDrops=e===entry?[coin]:[];
              s._mercenary=null;s.save.inv=[];s.save.money=0;s.save.energy=100;
              s.playerM.x=coin.x-s.startWorldM.x-2*s.cellM;s.playerM.y=coin.y-s.startWorldM.y;
              s._syncModalGate();Conditions.setDialogShield(s.save,false);
              const original={x:coin.x,y:coin.y},now=Date.now();
              tickGroundCoins(s,now);tickGroundCoins(s,now+100);
              const withoutRing=coin.x===original.x&&s.save.money===0;
              stock('coin_ring',1);tickGroundCoins(s,now+200);
              const pulled=coin.x<original.x&&s.save.money===0;
              for(let i=3;i<=30;i++)tickGroundCoins(s,now+i*100);
              const collected=!entry.coinDrops.includes(coin)&&s.save.money===coinAmount(coin);
              const money=s.save.money;tickGroundCoins(s,now+3100);
              return {withoutRing,pulled,collected,amount:coinAmount(coin),paidOnce:s.save.money===money};
            """)
            assert result['withoutRing'] and result['pulled'] and result['collected'] and result['paidOnce'],result
            return result
        await case('coin-ring-live-tick',coin_ring)
        report={'cases':cases,'errors':errors,'method':'Fresh browser save; real DOM action buttons; seeded inventory; unchanged transaction handlers'}
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        await browser.close()
        print(json.dumps(report,indent=2))
        assert all(c['ok'] for c in cases) and not errors,'Gameplay probe failed; see report.json'

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8027/index.html?sandbox=true&sandboxZone=brewing')
    parser.add_argument('--chromium',default='/usr/bin/chromium')
    parser.add_argument('--output',type=Path,default=Path.home()/'.artifacts/mechanics-probes/transactions')
    asyncio.run(probe(parser.parse_args()))
