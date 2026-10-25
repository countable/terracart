#!/usr/bin/env python3
"""Validate and present captures from the unchanged shipping road renderer."""
import html
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/.artifacts/ancient-road-surfaces')
meta = json.loads((root/'selected-metadata-11.json').read_text())
rows = {row['case']: row for row in meta['results']}
checks = []
def check(name, passed, **details):
    checks.append(dict(name=name, passed=bool(passed), **details))
def picture(case, layer='base'):
    return Image.open(root/f'selected-{case}-{layer}-11.png').convert('RGBA')
def unequal(a,b):
    return sum(p != (0,0,0,0) for p in ImageChops.difference(a,b).getdata())
def pixel_check(name,a,b,box):
    count=unequal(a.crop(box),b.crop(box))
    check(name,count == 0,differentPixels=count,pixels=(box[2]-box[0])*(box[3]-box[1]),region=box)

check('Actual Phaser WebGL renderer, no page or GL errors',meta['boot']['renderer']==2 and not meta['errors'] and meta['webglError']==0)
for name,row in rows.items():
    for layer,audit in row.get('passAudit',{}).items():
        check(f'{name}: {layer} ink stays inside the road geometry',audit['leakedPixels']==0,**audit)
    for generated in row.get('generatedRoadVariants',[]):
        if generated['size']=='major':
            check(f"{name}: generated MD/LG record has no variant",generated.get('variant') is None)
    for road in row['roads']:
        if road['class'] in ('secondary','primary'):
            check(f"{name}: {road['class']} has a fixed surface and no variants",all(p.get('variant') is None for p in road['styles']))
if 'cancellation' in meta['materialAudit']:
    cancellation=meta['materialAudit']['cancellation']
    check('Abandoned yielded decoration releases its Canvas clip before replacement',
        cancellation['differentBytes']==0 and cancellation['replacementAlpha']>0,**cancellation)
if 'endpointOwnership' in meta['materialAudit']:
    endpoint=meta['materialAudit']['endpointOwnership']
    check('Source-end round cap does not erase adjoining branch pavers',endpoint['branchPaverAlpha']==255,**endpoint)
for row in meta['materialAudit']['fixedVariants']:
    check(f"{row['class']}: stale incoming variant cannot select a themed road",row['value'] is None)
for row in meta['materialAudit']['shade']:
    check(f"{row['variant']}: 20% background with no doubled restored tint",abs(row['effectiveAlpha']-.2)<.005 and row['restoredClear']>0,effectiveAlpha=row['effectiveAlpha'])

for family in ('md','lg'):
    reference=picture(f'{family}-reference')
    center=reference.width//2+16
    # Remain inside road geometry, including central intersections and material gaps.
    box=(center-70,center-8,center+70,center+8)
    pixel_check(f'{family}: wider road covers Small-road/path crossings',picture(f'{family}-weathered'),reference,box)
    # Compare matching restored metre intervals against the full-restoration reference.
    box=(center+35,center-8,center+125,center+8)
    pixel_check(f'{family}: partial restored paving/decor matches full restoration',picture(f'{family}-partial','restored'),picture(f'{family}-restored','restored'),box)
    alpha=picture(f'{family}-partial').crop(box).getchannel('A')
    nonzero=sum(p>0 for p in alpha.getdata())
    check(f'{family}: old base material/decor removed beneath restored interval',nonzero==0,nontransparentPixels=nonzero,pixels=90*16)
    original=picture(f'{family}-partial')
    returned=Image.open(root/f'selected-{family}-partial-returned-base-11.png').convert('RGBA')
    pixel_check(f'{family}: camera return reproduces identical road pixels',original,returned,(96,96,384,384))
    camera=json.loads((root/f'selected-{family}-partial-camera.json').read_text())
    old,new=camera['original'],camera['shifted']
    dx=old['ops'][0]['pts'][0]-new['ops'][0]['pts'][0]
    dy=old['ops'][0]['pts'][1]-new['ops'][0]['pts'][1]
    def points(ops,offset_x=0,offset_y=0):
        accepted=set()
        for op in ops:
            for point in op['pts']:
                x,y=point['x']+offset_x,point['y']+offset_y
                if 130<x<350 and 130<y<350:
                    accepted.add((round(x,5),round(y,5),op.get('w'),op['c'],op.get('mode'),op.get('fill')))
        return accepted
    for kind in ['decor','restoredDecor']:
        a,b=points(old[kind]),points(new[kind],dx,dy)
        check(f'{family}: camera pan preserves actual {kind} geometry phase',bool(a) and a==b,matchedPoints=len(a&b),referencePoints=len(a),projectedShiftX=dx,projectedShiftY=dy)
    shifted=Image.open(root/f'selected-{family}-partial-shifted-base-11.png').convert('RGBA')
    box=(128,128,352,352)
    count=unequal(original.crop(box),shifted.crop((box[0]-32,box[1],box[2]-32,box[3])))
    # The row/frame projection moves 32.0407px, while texture phase rounds to
    # integer pixels. Keep the integer-crop mismatch visible as a diagnostic;
    # exact equality here would incorrectly treat existing antialiasing as drift.
    checks.append(dict(name=f'{family}: integer-crop pan diagnostic',passed=True,diagnostic=True,differentPixels=count,pixels=224*224,projectedShiftX=dx,note='Fractional projection differs from a 32px image crop; geometric phase and camera return are tested separately.'))

# At a same-tier T, the terminating branch must not stamp its setts or channel
# dead ends across the through road. Stay below the branch mouth/edge join.
for family in ('md','lg'):
    case=f'{family}-junction'
    if case not in rows: continue
    through=picture(f'{family}-restored','restored')
    center=through.width//2+16
    # MD's 5px feather still has alpha tails 7px from its centre; stay
    # inside the fully opaque core so this checks decoration, not union alpha.
    box=(center-26,center-6,center+26,center+6)
    pixel_check(f'{family}: T junction preserves through-road interior without branch overprint',picture(case,'restored'),through,box)

if 'lg-junction' in rows:
    # The horizontal channel must open at the branch mouth rather than draw
    # a turquoise bar across it. The narrow middle excludes the branch rails.
    through=picture('lg-restored','restored');center=through.width//2+16
    box=(center-8,center-26,center+8,center-16)
    def turquoise(image):
        return sum(a>100 and g-r>30 and b-r>20 for r,g,b,a in image.crop(box).getdata())
    reference_ink=turquoise(through);junction_ink=turquoise(picture('lg-junction','restored'))
    check('LG: channel opens across the T-junction mouth',reference_ink>0 and junction_ink==0,referenceChannelPixels=reference_ink,junctionChannelPixels=junction_ink,region=box)

# Identical source geometry must retain identical road ink over every substrate.
# This tests both the restored shoulder alpha and missing weathered pavers.
for terrain in ('sand','rock','farmland'):
    case='md-ground-'+terrain
    if case not in rows: continue
    for layer in ('base','restored'):
        reference=picture('md-ground-park',layer)
        pixel_check(f'MD {layer}: terrain-neutral ink over {terrain}',picture(case,layer),reference,(0,0,*reference.size))

# Damage must be visible as absent road pixels, not another drawn resource.
wear=picture('md-weathered');repair=picture('md-restored','restored');center=wear.width//2+16
edge_box=(center-145,center-19,center+145,center+19)
missing=sum(p==0 for p in wear.crop(edge_box).getchannel('A').getdata())
repaired_missing=sum(p==0 for p in repair.crop(edge_box).getchannel('A').getdata())
check('MD damage leaves genuine missing chunks; repair closes them',missing>repaired_missing,weatheredMissingPixels=missing,restoredMissingPixels=repaired_missing,region=edge_box)

if (root/'map-review-checks.json').exists():
    review=json.loads((root/'map-review-checks.json').read_text())
    check('Actual map review renders weathered and restored states without errors',
        not review['errors'] and {row['restored'] for row in review['states']}=={False,True}
        and all(row['status']=='ready' and not row['worldErrors'] and row['source']=='function' for row in review['states']))

(root/'checks.json').write_text(json.dumps(checks,indent=2)+'\n')
for row in checks:
    print(('INFO ' if row.get('diagnostic') else 'PASS ' if row['passed'] else 'FAIL ')+row['name'])

parts=['''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Selected road surfaces</title><style>*{box-sizing:border-box}body{margin:0;background:#182019;color:#e7ecdf;font:16px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:32px 24px}h1,h2{line-height:1.2;color:white}h1{font-size:36px}h2{margin-top:38px}a{color:#c6dfa7}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;padding:15px;background:#263326;border-radius:10px}figcaption{font-weight:650;margin-bottom:12px}img{display:block;width:100%;max-width:352px;margin:auto;image-rendering:pixelated}.note{background:#2b3f29;padding:16px 20px;border-left:4px solid #b5d18b}.muted,small{color:#b0bba8}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;border-bottom:1px solid #46533f;text-align:left}button{padding:7px 12px;background:#2d432c;color:#e5edda;border:1px solid #7d9b6c;border-radius:5px;cursor:pointer}body.large img{max-width:none}li{margin:8px 0}.pass{color:#c1dfa3}.fail{color:#ffaf94}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><main><small>Dragon Hood · selected shipping road surfaces · actual Phaser WebGL</small><h1>Old trade roads and dimensional rifts</h1><p class="note">Medium roads use small ancient pavers within worn stone bands. Broken and buried stones become repaired paving, with soft terrain-neutral shoulders and no baked-in grass. Large roads use small broken plates around a turquoise scar before restoration, then a quiet ancient conduit with paired channels and fine glyphs. Neither road size receives variants.</p><p>The paired images use identical geometry and daylight, captured at the normal 352 × 352 map scale. Road modules and artwork load directly from the game; no preview material hooks or replacement road source are used. The harness forces only the WebGL renderer configuration and installs a disposable controlled map.</p><p>Horizontal: MD Old Trade Road (9 m) or LG Dimensional Rift (15 m). Vertical: Small-road Lantern Row (5.5 m). Diagonal: Confusion Path (2 m). Small-road/path variants retain their 20% background tint.</p><button id="size">Enlarge images</button>''']
if (root/'concept-no-grass.png').exists():
    parts.append('<p><a href="concept-no-grass.png">Approved concept with terrain-neutral shoulders</a> — visual target only; every capture below is actual game renderer output.</p>')
for family,title in [('md','Medium · ancient pavers'),('lg','Large · dimensional rift')]:
    parts.append(f'<h2>{title}</h2><div class="pair">')
    for state,label in [('weathered','Unrestored'),('restored','Restored')]:
        file=rows[f'{family}-{state}']['file']
        parts.append(f'<figure><figcaption>{label}</figcaption><a href="{file}"><img src="{file}" alt="{title}, {label}"></a></figure>')
    parts.append('</div>')
parts.append('<h2>Partial restoration</h2><p>In these views the right half is restored. Repairs follow the saved metre interval; unrepaired cracks/scars are removed beneath the repaired surface.</p><div class="pair">')
for case,title in [('md-partial','Medium: broken pavers → repaired ancient road'),('lg-partial','Large: turquoise scar → ancient conduit')]:
    file=rows[case]['file'];parts.append(f'<figure><figcaption>{html.escape(title)}</figcaption><a href="{file}"><img src="{file}" alt="{html.escape(title)}"></a></figure>')
parts.append('</div><h2>Bends and mixed junctions</h2><div class="pair">')
for case,title in [('md-bend','Pavers follow a bend and partial repair'),('md-acute','Pavers through an acute turn'),('md-junction','Medium T junction'),('lg-junction','Large T junction'),('lg-bend','Rift through a bend and partial repair'),('mixed-crossing','Large road covers Medium road; paths/Small roads remain separate')]:
    if case not in rows: continue
    file=rows[case]['file'];parts.append(f'<figure><figcaption>{title}</figcaption><a href="{file}"><img src="{file}" alt="{title}"></a></figure>')
parts.append('</div><h2>Shoulders over different terrain</h2><p>These controlled maps omit the separate rift-buffer terrain data so the same road can be inspected directly over grass, sand, stone, and earth. The road modules are unchanged; the pixel checks confirm identical road ink across all four backgrounds.</p><div class="pair">')
for terrain,title in [('park','Grass'),('sand','Sand'),('rock','Stone'),('farmland','Earth')]:
    case='md-ground-'+terrain
    if case not in rows: continue
    file=rows[case]['file'];parts.append(f'<figure><figcaption>{title}</figcaption><a href="{file}"><img src="{file}" alt="Ancient road over {title.lower()}"></a></figure>')
parts.append('</div>')
if (root/'map-review-checks.json').exists():
    review=json.loads((root/'map-review-checks.json').read_text())
    parts.append('<h2>Actual map review</h2><p>The restored-road toggle uses the shared road backend. These captures use the map review’s real geographic fixture, not the controlled map above.</p><div class="pair">')
    for state in review['states']:
        file=state['file'];label='Restored' if state['restored'] else 'Weathered'
        parts.append(f'<figure><figcaption>{label}</figcaption><a href="{file}"><img src="{file}" alt="Actual map review, {label.lower()}"></a></figure>')
    parts.append('</div><p><a href="map-review-checks.json">Map review checks</a></p>')
parts.append('<h2>Renderer checks</h2><table><tr><th>Check</th><th>Result</th></tr>')
for row in checks:
    status='DIAGNOSTIC' if row.get('diagnostic') else 'PASS' if row['passed'] else 'FAIL'
    parts.append(f'<tr><td>{html.escape(row["name"])}</td><td class="{"pass" if row["passed"] else "fail"}">{status}</td></tr>')
parts.append('</table><p class="muted">Pixel reads occur only in this test harness. They compare road texture canvases so the separate terrain-grid rift buffer does not affect overlap results. Camera pans compare actual recorded geometry after its measured fractional translation; an integer image crop has small antialiasing differences because this tile row projects a cell move to about 32.04 pixels. Returning the camera reproduces identical pixels. The game keeps its normal cached, time-sliced rendering. Fixture art and placement are deterministic; daylight and actors are frozen for comparisons.</p><p><a href="selected-metadata-11.json">Capture metadata</a> · <a href="checks.json">Detailed pixel checks</a></p></main><script>document.querySelector("#size").onclick=()=>{document.body.classList.toggle("large");document.querySelector("#size").textContent=document.body.classList.contains("large")?"Native scale":"Enlarge images"}</script></html>')
(root/'index.html').write_text(''.join(parts))
print(root/'index.html')
if not all(row['passed'] for row in checks):raise SystemExit(1)
