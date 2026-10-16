#!/usr/bin/env python3
"""Profile live compass shine versus disabled shine with Chromium CDP.

Tracks main-thread Paint/Layout/style work and requestAnimationFrame intervals.
Run with --sensor for aggressive 60Hz phone-tilt input. Desktop headless results
are not physical-phone GPU or battery measurements. No game save is reused.
"""
import argparse
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
async def main(args):
 args.output.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':390,'height':844},device_scale_factor=2,service_workers='block')
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1')")
  await page.goto(args.url + '?sandbox=true&sandboxZone=restoration');await page.wait_for_function('window.__scene?._bootOverlayGone',timeout=90000)
  await page.evaluate('()=>{__scene.save.compassModules={active:{inventory:true,joystick:true,memories:true,books:true,distance:true},pending:[],walkedM:200};}')
  await page.wait_for_timeout(1300)
  for _ in range(2):
   buttons=page.locator('.compass-action').filter(has_text='OK')
   if await buttons.count():await buttons.first.click();await page.wait_for_timeout(300)
  if args.sensor:await page.evaluate("()=>{window.auditTilt=setInterval(()=>{const t=performance.now()/1000;window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:45+20*Math.sin(t),gamma:20*Math.cos(t*.7)}));},16);}")
  client=await page.context.new_cdp_session(page);await client.send('Performance.enable')
  report={}
  for name in ['on','off']:
   if name=='off':await page.evaluate('()=>{__scene._compassShine.destroy();}')
   await page.wait_for_timeout(800)
   events=[]
   def collect(e):events.extend(e['value'])
   client.on('Tracing.dataCollected',collect)
   await client.send('Tracing.start',{'categories':'devtools.timeline','transferMode':'ReportEvents'})
   before=await client.send('Performance.getMetrics')
   frames=await page.evaluate('''async()=>{const a=[];let last=performance.now();await new Promise(resolve=>{const end=last+5000;function tick(t){a.push(t-last);last=t;if(t<end)requestAnimationFrame(tick);else resolve()}requestAnimationFrame(tick)});a.sort((a,b)=>a-b);return {count:a.length,median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],slow:a.filter(v=>v>25).length}}''')
   after=await client.send('Performance.getMetrics');done=asyncio.get_running_loop().create_future();client.once('Tracing.tracingComplete',lambda _:done.set_result(True));await client.send('Tracing.end');await done
   b={v['name']:v['value'] for v in before['metrics']};a={v['name']:v['value'] for v in after['metrics']}
   totals={}
   for e in events:
    if e.get('ph')=='X' and e.get('name') in ['Paint','PrePaint','UpdateLayoutTree','Layout','RasterTask']:
     k=e['name'];v=totals.setdefault(k,{'count':0,'ms':0});v['count']+=1;v['ms']+=e.get('dur',0)/1000
   report[name]={'frames':frames,'trace':totals,'metrics':{k:a[k]-b[k] for k in ['TaskDuration','ScriptDuration','RecalcStyleDuration','RecalcStyleCount','LayoutDuration','LayoutCount']}}
   client.remove_listener('Tracing.dataCollected',collect)
   if name=='on':await page.screenshot(path=str(args.output / 'shine.png'))
  report['errors']=errors;(args.output / 'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));await browser.close()
if __name__ == '__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--url',default='http://127.0.0.1:8000/index.html')
 parser.add_argument('--sensor',action='store_true',help='Drive continuous simulated tilt instead of desktop drift')
 parser.add_argument('--output',type=Path,default=Path('/tmp/compass-shine-profile'))
 asyncio.run(main(parser.parse_args()))
