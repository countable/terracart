#!/usr/bin/env python3
"""Measure ring pickup through live Phaser updates in a disposable sandbox save."""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

async def main(args):
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'scope': 'Authored plaza coin, live game updates; inventory and player position seeded only for setup.', 'cases': [], 'errors': []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 390, 'height': 844}, service_workers='block')
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        await page.add_init_script("window.__TEST_MODE=true;sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');")
        try:
            await page.goto(args.url.rstrip('/') + '/?sandbox=true&sandboxZone=plaza')
            await page.wait_for_function('window.__scene?._sandboxLabelData?.length', timeout=90000)
            setup = await page.evaluate('''() => {
              const s=window.__scene; s.scene.pause();
              document.querySelectorAll('.game-modal').forEach(el=>el.remove());s._syncModalGate();
              const entries=[...WorldGen.tileCache.values()];
              const entry=entries.find(e=>e.coinDrops?.some(c=>c.id?.startsWith('sandbox_coin_')));
              if(!entry)throw Error('No authored plaza coin remains');
              const coin=entry.coinDrops.find(c=>c.id.startsWith('sandbox_coin_'));
              for(const e of entries)e.coinDrops=(e===entry?[coin]:[]);
              s.save.inv=s.save.inv.filter(i=>!UNIQUE_JEWELRY[i.id]?.coinMagnetCells);
              s.save.storySeen ||= {};s.save.storySeen['coin:first']=true;
              s.save.energy=100;s.save.conditions={};s._mercenary=null;
              s.playerM={x:coin.x-s.startWorldM.x-2*s.cellM,y:coin.y-s.startWorldM.y};
              s.gpsM={...s.playerM};s.peekM={x:0,y:0};s.syncMoveTarget();
              window.coinProbe={s,entry,coin,start:{x:coin.x,y:coin.y},money:s.save.money,samples:[]};
              s.buildInventoryDOM();s.mapDirty=true;s.scene.resume();
              return {id:coin.id,amount:coin.amount,cellM:s.cellM,money:s.save.money};
            }''')
            await page.wait_for_timeout(300)
            untouched = await page.evaluate('''() => {const p=coinProbe;return {x:p.coin.x,y:p.coin.y,money:p.s.save.money,start:p.start};}''')
            assert untouched['x'] == untouched['start']['x'] and untouched['y'] == untouched['start']['y'], untouched
            assert untouched['money'] == setup['money'], untouched
            report['cases'].append({'name': 'no-ring-no-pull', 'passed': True, 'details': untouched})
            await page.evaluate('''() => {
              const p=coinProbe;p.s.save.inv.push({id:'coin_ring',count:1});p.s.buildInventoryDOM();
              p.startAt=performance.now();
              const sample=()=>{
                p.samples.push({ms:performance.now()-p.startAt,x:p.coin.x,y:p.coin.y,money:p.s.save.money});
                if(p.entry.coinDrops.includes(p.coin)&&performance.now()-p.startAt<5000)requestAnimationFrame(sample);
              }; requestAnimationFrame(sample);
            }''')
            await page.wait_for_function('!coinProbe.entry.coinDrops.includes(coinProbe.coin)', timeout=10000)
            await page.wait_for_timeout(400)
            result = await page.evaluate('''() => {const p=coinProbe;return {money:p.s.save.money,samples:p.samples,amount:p.coin.amount,remaining:p.entry.coinDrops.length};}''')
            assert result['money'] == setup['money'] + setup['amount'], result
            samples=result['samples']
            moving=sum(a['x'] != b['x'] or a['y'] != b['y'] for a,b in zip(samples,samples[1:]))
            assert moving >= 5, f'Expected visibly gradual movement, got {moving} moving frames'
            early=[s for s in samples if s['ms']<200]
            assert early and all(s['money']==setup['money'] for s in early), 'Paid before arrival'
            report['cases'].append({'name': 'live-ring-pull-and-single-payment', 'passed': True, 'details': {**result,'movingFrames':moving}})
            await page.screenshot(path=str(args.output/'ring-pickup.png'))
        except Exception as e:
            report['cases'].append({'name':'probe', 'passed':False,'error':str(e)})
            await page.screenshot(path=str(args.output/'failure.png'))
        finally:
            await browser.close()
    report['passed']=bool(report['cases']) and all(c['passed'] for c in report['cases']) and not report['errors']
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':report['passed'],'cases':[{k:v for k,v in c.items() if k!='details'} for c in report['cases']],'errors':report['errors']}))
    if not report['passed']:raise SystemExit(1)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url',default='http://127.0.0.1:8027')
    p.add_argument('--chromium',default='/usr/bin/chromium')
    p.add_argument('--output',type=Path,default=Path.home()/'.artifacts/mechanics-probes/coins')
    asyncio.run(main(p.parse_args()))
