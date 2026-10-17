#!/usr/bin/env node
// Losslessly pack the existing DOM icon sheets. Requires Python 3 + Pillow.
// Run after changing icon art/catalogs: node tools/build-dom-icon-atlas.cjs
// --check verifies the committed PNG and generated map without writing files.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'src/app.js');
const app = fs.readFileSync(appPath, 'utf8');
const context = vm.createContext({ console });
for (const file of ['util', 'sprite_layout', 'items']) {
  vm.runInContext(fs.readFileSync(path.join(root, `src/${file}.js`), 'utf8'), context);
}
const start = app.indexOf('const ICON_SHEETS = {');
const literal = app.slice(start, app.indexOf('\n};', start) + 3);
vm.runInContext(literal, context);
const urls = vm.runInContext(`(() => {
  const urls = new Set(Object.values(ICON_SHEETS).map(s => s.url.split('?')[0]));
  for (const kind of ['relic', 'armor']) {
    for (const slot of Object.keys(kind === 'relic' ? RELIC_DEFS : ARMOR_DEFS)) {
      for (const tier of Object.keys(TIER_BY_NUM)) {
        const url = gearAssetPath(kind, slot, Number(tier));
        if (url) urls.add(url.split('?')[0]);
      }
    }
  }
  return [...urls].sort();
})()`, context);
const check = process.argv.includes('--check');
const result = JSON.parse(execFileSync('python3', ['-c', `
import sys,json,io,hashlib,os
from PIL import Image
root,check=sys.argv[1],sys.argv[2]=='true'
urls=json.load(sys.stdin)
width=1024
x=y=row_h=0
rects={}
images={}
for url in urls:
    image=Image.open(os.path.join(root,url)).convert('RGBA')
    w,h=image.size
    if w>width: raise ValueError('Icon sheet exceeds atlas width: '+url)
    if x+w>width: x=0; y+=row_h; row_h=0
    rects[url]=[x,y,w,h]
    images[url]=image
    x+=w; row_h=max(row_h,h)
height=y+row_h
atlas=Image.new('RGBA',(width,height))
for url,image in images.items(): atlas.paste(image,tuple(rects[url][:2]))
buffer=io.BytesIO()
atlas.save(buffer,format='PNG',optimize=True)
data=buffer.getvalue()
output=os.path.join(root,'assets/Icons/dom-atlas.png')
if check:
    actual=Image.open(output).convert('RGBA')
    if actual.size!=atlas.size or actual.tobytes()!=atlas.tobytes():
        raise ValueError('DOM icon atlas is stale; run node tools/build-dom-icon-atlas.cjs')
    data=open(output,'rb').read()
else:
    open(output,'wb').write(data)
print(json.dumps(dict(width=width,height=height,rects=rects,hash=hashlib.sha256(data).hexdigest()[:8],bytes=len(data))))
`, root, String(check)], { input: JSON.stringify(urls), encoding: 'utf8' }));
const block = '// BEGIN GENERATED DOM ICON ATLAS\n'
  + '// Regenerate with node tools/build-dom-icon-atlas.cjs; original sheets remain the art source.\n'
  + `const DOM_ICON_ATLAS = ${JSON.stringify({ url: `assets/Icons/dom-atlas.png?v=${result.hash}`, width: result.width, height: result.height, rects: result.rects }, null, 2).replace(/\[\s+(\d+),\s+(\d+),\s+(\d+),\s+(\d+)\s+\]/g, '[$1, $2, $3, $4]')};\n`
  + '// END GENERATED DOM ICON ATLAS';
const pattern = /\/\/ BEGIN GENERATED DOM ICON ATLAS[\s\S]*?\/\/ END GENERATED DOM ICON ATLAS/;
if (check) {
  if (app.match(pattern)?.[0] !== block) throw new Error('DOM icon atlas map is stale; rerun generator');
} else {
  const updated = pattern.test(app) ? app.replace(pattern, block)
    : app.replace('\nclass MapScene extends Phaser.Scene {', `\n${block}\n\nclass MapScene extends Phaser.Scene {`);
  fs.writeFileSync(appPath, updated);
}
console.log(`${check ? 'Verified' : 'Packed'} ${urls.length} sheets → ${result.width}×${result.height}, ${result.bytes} bytes`);
