#!/usr/bin/env python3
"""Probe recent restoration UI, potion impacts and summon lifecycles in an isolated sandbox."""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

async def main(args):
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'checks': [], 'errors': [], 'failedRequests': []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=args.chromium)
        page = await browser.new_page(viewport={'width':1100,'height':900})
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.on('response', lambda r: report['failedRequests'].append([r.status,r.url]) if r.status >= 400 else None)
        await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
        await page.goto(args.url, wait_until='domcontentloaded')
        await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxLabelData?.length", timeout=60000)
        await page.wait_for_timeout(2500)
        await page.evaluate("""() => {
          window.week = { s:__game.scene.getScene('map') };
          week.objects=()=>[...WorldGen.tileCache.values()].flatMap(e=>e.objects||[]);
          week.units=()=>[...WorldGen.tileCache.values()].flatMap(e=>e.creatures||[]);
          week.select=id=>{week.s.save.selSlot=week.s.save.inv.findIndex(i=>i.id===id); if(week.s.save.selSlot<0) throw Error('Missing inventory '+id);};
          week.close=()=>document.querySelectorAll('[id$="-modal"]').forEach(el=>el.remove());
          week.s.scene.pause();
        }""")
        async def jscheck(name, body):
            try:
                data=await page.evaluate('() => {'+body+'}')
                report['checks'].append({'name':name,**data})
            except Exception as e:
                report['checks'].append({'name':name,'ok':False,'exception':str(e)})
        await jscheck('Actual potion projectiles: poison, antidote, protection, immortal, time', """
          const s=week.s, c=week.units().find(c=>c.id.includes('_PRACTICE_plant_3'));
          if(!c) throw Error('Potion recipient missing');
          const results=[]; c._hp=Combat.maxHp(c);
          for(const id of ['poison_flask','antidote','protection_potion','immortal_potion','time_potion']) {
            week.select(id);s._throwReadyAt=0;s._shots=[];
            const before=Inventory.count(s.save,id), fired=s._throwItem(id), shot=s._shots.at(-1);
            if(!shot) throw Error('No projectile '+id);
            shot.x=c.x;shot.y=c.y;s._combatTick(.016);
            let effect;
            if(id==='poison_flask') effect=!!c._poisonState;
            if(id==='antidote') effect=!c._poisonState;
            if(id==='protection_potion'||id==='immortal_potion') {
              const beforeHP=Combat.hp(c);s._damageEnemy(c,2,'obstacle');
              const loss=beforeHP-Combat.hp(c);effect=id==='immortal_potion'?loss===0:loss>0&&loss<2;
            }
            if(id==='time_potion') effect=!PotionEffects.active(c,'immortal_potion')&&!PotionEffects.active(c,'protection_potion');
            results.push({id,fired,spent:before-Inventory.count(s.save,id),hit:!s._shots.includes(shot),effect});
          }
          s._shots=[];return {ok:results.every(r=>r.fired&&r.spent===1&&r.hit&&r.effect),results};
        """)
        await jscheck('Psychosis use consumes powder and changes visible enemy behavior state', """
          const s=week.s;week.select('psychosis_powder');const targets=s._onscreenEnemies();
          const n=Inventory.count(s.save,'psychosis_powder'),ok=s.usePsychosisPowder();
          return {ok:ok&&targets.length>0&&targets.every(c=>Combat.isPsychotic(c))&&Inventory.count(s.save,'psychosis_powder')===n-1,targets:targets.map(c=>c.kind)};
        """)
        await jscheck('Summoning scrolls create, preserve injured refresh, and expire allies', """
          const s=week.s,results=[];
          for(const id of ['bones_scroll','wraith_scroll']) {
            week.close();week.select(id);const spec=CONSUMABLE_SPEC[id],row=Companions.KINDS[spec.summonKind],n=Inventory.count(s.save,id);
            const used=s.readSummoningScroll(),c=s[row.instance];if(!c) throw Error('No companion '+id);
            c._hp=Math.max(1,Combat.hp(c)-1);const hp=c._hp;
            week.close();week.select(id);const refreshed=s.readSummoningScroll();
            const kept=s[row.instance]===c&&Combat.hp(c)===hp;
            s.save[row.field]=Date.now()-1;Companions.tick(s,spec.summonKind);
            results.push({id,used,refreshed,kept,spent:n-Inventory.count(s.save,id),expired:!s[row.instance]});
          }
          week.close();return {ok:results.every(r=>r.used&&r.refreshed&&r.kept&&r.spent===2&&r.expired),results};
        """)
        try:
            fixture=await page.evaluate("""() => {
              const s=week.s,h=week.objects().find(o=>o._sandboxWreck);
              if(!h) throw Error('Missing unrestored wreck fixture');week.house=h;
              const options=Houses.offerCards(s.save,h);week.options=options;
              const row=options.find(o=>Houses.hammerTakes(o)&&o.role==='blacksmith')||options.find(o=>Houses.hammerTakes(o));
              if(!row)throw Error('No hammer-compatible restore card');week.row=row;week.cost=Houses.buildCost(s.save,h,row,Houses.restoredCount(s.save));
              week.stock=Inventory.count(s.save,week.cost.id);week.hammers=Inventory.count(s.save,Houses.HAMMER_ID);
              s.shopInteract(s.viewCenterX,s.viewCenterY,h);return {id:h.id,key:row.key,index:options.indexOf(row)};
            }""")
            modal=page.locator('#offer-modal')
            await modal.get_by_role('button',name='Later',exact=True).click()
            await jscheck('Restoration cancel keeps resources and wreck', """
              return {ok:week.s._isHouseWreck(week.house)&&Inventory.count(week.s.save,week.cost.id)===week.stock};
            """)
            await page.evaluate('() => {week.materialSlot=week.s.save.inv.find(i=>i.id===week.cost.id);week.materialSlot.count=0;week.s.shopInteract(week.s.viewCenterX,week.s.viewCenterY,week.house);}')
            await modal.locator('button').nth(fixture['index']).click()
            disabled=await modal.get_by_role('button',name='Restore',exact=True).is_disabled()
            report['checks'].append({'name':'Unfunded restore cannot be accepted','ok':disabled})
            await modal.get_by_role('button',name='Later',exact=True).click()
            await page.evaluate('() => {week.materialSlot.count=week.stock;week.s.shopInteract(week.s.viewCenterX,week.s.viewCenterY,week.house);}')
            await modal.locator('button').nth(fixture['index']).click()
            await page.screenshot(path=str(args.output/'restoration-choice.png'))
            await modal.get_by_role('button',name='With Hammer').click()
            await jscheck('Hammer restoration stamps role/rank, charges one price and one hammer', """
              const s=week.s,h=week.house;
              return {ok:!s._isHouseWreck(h)&&Houses.isShinyHouse(s.save,h)&&s.houseShopRole(h)===week.row.role&&Inventory.count(s.save,week.cost.id)===week.stock-week.cost.qty&&Inventory.count(s.save,Houses.HAMMER_ID)===week.hammers-1,role:s.houseShopRole(h),tier:Shops.shopTier(s.save,h,week.row.role),cost:week.cost};
            """)
            await page.evaluate('() => week.close()')
            await page.evaluate('() => {week.select(Houses.PERMIT_ID);week.permitBefore=Inventory.count(week.s.save,Houses.PERMIT_ID);week.to=Houses.renovateTo(week.s.save,week.house);week.s.shopInteract(week.s.viewCenterX,week.s.viewCenterY,week.house);}')
            to=await page.evaluate('() => week.to')
            if not to.get('tier'):
                raise AssertionError('Fixture does not expose unlocked renovation: '+json.dumps(to))
            await modal.get_by_role('button',name='Later',exact=True).click()
            await jscheck('Renovation cancel preserves rank and permit', """
              const s=week.s;return {ok:Shops.shopTier(s.save,week.house,week.row.role)===week.to.tier-1&&Inventory.count(s.save,Houses.PERMIT_ID)===week.permitBefore};
            """)
            await page.evaluate('() => week.s.shopInteract(week.s.viewCenterX,week.s.viewCenterY,week.house)')
            await modal.get_by_role('button',name='Renovate',exact=True).click()
            await jscheck('Renovation permit UI raises exactly one rank and spends one permit', """
              const s=week.s;return {ok:Shops.shopTier(s.save,week.house,week.row.role)===week.to.tier&&Inventory.count(s.save,Houses.PERMIT_ID)===week.permitBefore-1,tier:Shops.shopTier(s.save,week.house,week.row.role)};
            """)
            await page.screenshot(path=str(args.output/'restored-shop.png'))
        except Exception as e:
            report['checks'].append({'name':'Restoration UI workflow','ok':False,'exception':str(e)})
        await page.evaluate('() => {week.close();week.s.scene.resume();}')
        await page.wait_for_timeout(1200)
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        await browser.close()
    print(json.dumps(report,indent=2))
    if report['errors'] or report['failedRequests'] or any(not r['ok'] for r in report['checks']):
        raise SystemExit(1)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8017/index.html?sandbox=true&sandboxScene=PRACTICE')
    parser.add_argument('--chromium',default='/usr/bin/chromium')
    parser.add_argument('--output',type=Path,default=Path.home()/'.artifacts/sandbox-week-2026-10-03/weekly')
    asyncio.run(main(parser.parse_args()))
