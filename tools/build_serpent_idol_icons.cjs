#!/usr/bin/env node
// Paint the per-tier Serpent Idol icons. Requires Python 3 + Pillow.
//   node tools/build_serpent_idol_icons.cjs            writes the icons
//   node tools/build_serpent_idol_icons.cjs --check    verifies the committed ones
//   node tools/build_serpent_idol_icons.cjs --preview DIR   also writes recoloured
//                                               serpent atlases to DIR for review
// The master is assets/Icons/Items/SerpentIdol.png (the stone idol); each
// rung of src/enemy_roster.js SERPENT_TIERS gets assets/Icons/Items/
// SerpentIdol<Name>.png in that rung's `palette`, through the same luma ramp
// the game applies to the serpent's atlas at load (src/assets.js
// recolorEnemyPixels: black → shadow → mid → highlight), so the idol in the
// bag and the serpent it raises wear one colour. The icon skips the palette's
// `gamma`: that lifts the atlas's resampled midtones, while the idol's four
// stone shades already span the ramp (the --preview atlases apply it, as the
// game does). Register a
// new icon in src/app.js ICON_SHEETS and rebuild the DOM atlas
// (tools/build-dom-icon-atlas.cjs) after running this.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const { SERPENT_TIERS } = require(path.join(root, 'src/enemy_roster.js'));
const args = process.argv.slice(2);
const check = args.includes('--check');
const previewAt = args.indexOf('--preview');
const preview = previewAt >= 0 ? path.resolve(args[previewAt + 1] || '') : '';
const jobs = SERPENT_TIERS.map(t => ({
  out: `assets/Icons/Items/SerpentIdol${t.name}.png`, name: t.name, palette: t.palette }));
const result = execFileSync('python3', ['-I', '-c', `
import sys, json, os
from PIL import Image
root, check, preview = sys.argv[1], sys.argv[2] == 'true', sys.argv[3]
jobs = json.load(sys.stdin)
def rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def recolour(image, palette, gamma=1):
    stops = [(0, 0, 0), rgb(palette['shadow']), rgb(palette['mid']), rgb(palette['highlight'])]
    out = image.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not a: continue
            luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
            t = (luma ** gamma) * 3
            seg = min(2, int(t))
            f = t - seg
            a0, b0 = stops[seg], stops[seg + 1]
            px[x, y] = tuple(round(a0[i] + (b0[i] - a0[i]) * f) for i in range(3)) + (a,)
    return out
master = Image.open(os.path.join(root, 'assets/Icons/Items/SerpentIdol.png')).convert('RGBA')
atlas = Image.open(os.path.join(root, 'assets/Enemy/SegmentedSerpent/parts.png')).convert('RGBA')
stale = []
for job in jobs:
    icon = recolour(master, job['palette'])
    target = os.path.join(root, job['out'])
    if check:
        if not os.path.exists(target) or Image.open(target).convert('RGBA').tobytes() != icon.tobytes(): stale.append(job['out'])
    else:
        icon.save(target, optimize=True)
    if preview:
        os.makedirs(preview, exist_ok=True)
        sheet = recolour(atlas, job['palette'], job['palette'].get('gamma', 1))
        sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(os.path.join(preview, job['name'] + '-serpent.png'))
        icon.resize((128, 128), Image.NEAREST).save(os.path.join(preview, job['name'] + '-idol.png'))
print(json.dumps({'stale': stale, 'written': [] if check else [j['out'] for j in jobs]}))
`, root, String(check), preview], { input: JSON.stringify(jobs) }).toString();
const { stale, written } = JSON.parse(result);
if (stale.length) { console.error('Stale serpent idol icons (run node tools/build_serpent_idol_icons.cjs):\n  ' + stale.join('\n  ')); process.exit(1); }
console.log(check ? `Serpent idol icons up to date (${jobs.length}).` : `Wrote ${written.length} serpent idol icons.`);
