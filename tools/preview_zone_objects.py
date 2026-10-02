#!/usr/bin/env python3
"""Build the 24px zone object decision table with current source-art comparisons."""
import argparse, html, json, re, shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
args = parser.parse_args()
out = args.output
out.mkdir(parents=True, exist_ok=True)
(out / 'art').mkdir(exist_ok=True)
manifest = json.loads((ROOT / 'assets/Objects/ZoneVariants/manifest.json').read_text())
registry = (ROOT / 'src/assets.js').read_text()
# Frame references are explicitly selected examples, not claims that every zone
# uses every growth stage or shrine kind. The registry owns image dimensions.
def current(key, frame=0):
    match = re.search(r'^\s*' + re.escape(key) + r':\s*\{([^\n]+)', registry, re.M)
    assert match, key
    row = match.group(1)
    path = re.search(r'[\"\']?path[\"\']?\s*:\s*[\"\']([^\"\']+)', row)[1]
    im = Image.open(ROOT / path).convert('RGBA')
    width = re.search(r'[\"\']?frameWidth[\"\']?\s*:\s*(\d+)', row)
    height = re.search(r'[\"\']?frameHeight[\"\']?\s*:\s*(\d+)', row)
    fw, fh = (int(width[1]), int(height[1])) if width else im.size
    cols = im.width // fw
    x, y = frame % cols * fw, frame // cols * fh
    im = im.crop((x, y, x + fw, y + fh))
    assert im.getbbox(), (key, frame)
    if 'desaturated: true' in row:
        pixels = []
        for r, g, b, a in im.getdata():
            gray = .2126*r + .7152*g + .0722*b
            pixels.append(tuple(round(gray + (c-gray)*.2) for c in (r,g,b)) + (a,))
        im.putdata(pixels)
    name = f'art/current-{key}-{frame}.png'
    im.save(out / name)
    return {'image': name, 'source': path, 'frame': frame, 'width': fw, 'height': fh}

rows = [dict(f, status='Preview', category='Variant', zones=[], note='', before=None) for f in manifest['frames']]
def assign(first,last,category,zones,note,before=None,label=None):
    for i in range(first,last+1):
        rows[i].update(category=category,zones=zones.split('; '),note=note)
        if before:
            rows[i]['before'] = dict(current(*before), label=label or before[0].replace('_',' '))

assign(0,2,'Zone-replacement','Silent Circle; Stone Garden','Replace stone-marker objects with new grave-pillar types only in these zones. Preserve the global stone object and art; pillar interactions remain to be specified.',('mineralrock',171),'Current churchyard stone marker')
assign(3,5,'Variant','Ordered Graves; Overgrown Graves; Silent Circle','Alternate grave silhouettes for the existing headstone role.',('headstone',0),'Current headstone / short pillar')
assign(6,7,'New prop','Broken Masonry; Ruined Stronghold','New decorative column object; no new loot or interaction defined.')
assign(8,14,'Zone-replacement','Ruined Stronghold; Broken Masonry','Replace foundation stone objects with new wall-piece types only in these zones; preserve global stones. Recommended: connected wall set with two straight orientations, four corners, and a broken-end / rubble fallback. Select from adjacent foundation cells, like cave walls. These generated candidates need matching connection points before tiling.',('mineralrock',171),'Current foundation stone (one cell)')
assign(15,15,'New prop','Ruined Stronghold; Broken Masonry','New fallen-lintel decoration; no new interaction defined.')
assign(16,21,'Variant','Stone Garden; Ordered Graves; Overgrown Graves; Broken Masonry; Silent Circle','Three pots in ONE occupied cell and one container interaction. Matching smashed-cluster state still needed.',('clay_pot',0),'Current clay pot (runtime muted colors)')
assign(22,22,'Total-replacement','Abandoned Quarry; Global barrel locations','Intact barrel appearance; existing loot and restock behavior.',('barrel',0),'Current intact barrel')
assign(23,23,'Total-replacement','Abandoned Quarry; Global barrel locations','Broken/restocking appearance paired with the intact barrel, not a separate loot object.',('barrel_smashed',0),'Current smashed barrel')
assign(24,27,'Variant','Mystic Reef','Installed as noninteractive water scenery at scale 4/3: a 24px source frame occupies a 32px game cell.')
old = Image.open(ROOT / 'assets/Objects/Reef/reef_atlas.png').convert('RGBA')
for i in range(24,28):
    f=i-24; im=old.crop((round(f*old.width/4),0,round((f+1)*old.width/4),round(old.height/4)))
    im=im.crop(im.getbbox());im.thumbnail((56,56),Image.Resampling.NEAREST)
    path=f'art/previous-coral-{f}.png';im.save(out/path)
    rows[i].update(status='Live',before={'image':path,'label':'Previous coral art (superseded)','source':'assets/Objects/Reef/reef_atlas.png','frame':f,'width':im.width,'height':im.height})
assign(28,31,'Variant','Mystic Reef','Additional coral appearances already packed into the asset, but not selected by generation.',('reef_coral',0),'Existing coral role — pink example')
assign(32,33,'New prop','Mystic Reef; Other shorelines (optional)','New seaweed scenery; harvesting is not defined.')
assign(34,34,'Variant','Mystic Reef; Shellwater Strand','Coastal appearance for the existing rock role; no separate shell yield defined.',('mineralrock',171),'Existing plain rock example')
assign(35,35,'Variant','Mystic Reef','Copper-deposit appearance; preserve the existing pick requirement and yield.',('mineralrock',0),'Current copper ore')
assign(36,36,'Variant','Mystic Reef','Iron-deposit appearance; preserve the existing pick requirement and yield.',('mineralrock',1),'Current iron ore')
assign(37,37,'Variant','Mystic Reef','Crystal-deposit appearance candidate. Adding crystal placement to the reef would be a separate change.',('crystal_cluster',0),'Current crystal deposit')
assign(38,38,'Variant','Mystic Reef','Candidate art for a shrine role; no one-to-one replacement assigned.',('grove_votive',0),'Existing generic shrine reference')
assign(39,39,'New prop','Mystic Reef; Pirate Cove','Broken amphora decoration; could alternatively use pot-container mechanics if chosen later.')
assign(40,43,'Variant','Mushroom Grove; Mushroom Lane','Appearance candidates for existing mushroom roles. Keep giant-mushroom wood + mushroom rewards when used for giants.',('giant_mushroom',0),'Current giant mushroom')
rows[40]['before']=dict(current('props',35),label='Current small red mushroom')
rows[40]['note']='Red mushroom appearance; small-mushroom role shown as comparison. Could also be used for a giant with appropriate sizing.'
assign(44,44,'Variant','Ancient Grove; Global woodland (optional)','Existing tree-role appearance; representative sapling stage shown.',('trees',1),'Current maple sapling')
assign(45,45,'Variant','Global berry plants; Orchard (optional); Meadow (optional)','Existing berry-plant art candidate. No new wild-berry placement rule installed.',('springcrops',18),'Existing berry crop — mature stage')
assign(46,46,'Variant','Formal Garden; Hedge Garden','Corner-shaped appearance for existing clipped shrubs.',('approved_clipped_hedge',0),'Current clipped hedge')
assign(47,47,'Variant','Global flowers; Formal Garden; Meadow (optional)','Existing flower role; Meadow flower placement would be a separate change.',('props',12),'Current wildflowers')
assign(48,48,'New prop','Ancient Grove; Mushroom Grove','New hollow-log scenery; no harvest defined.')
assign(49,49,'New prop','Ancient Grove','New root-arch scenery; no passage or interaction mechanic defined.')
assign(50,50,'Variant','Grove zones; Ancient Grove','Existing shrine-role art candidate; no seed mechanic and no one-to-one replacement assigned.',('grove_votive',0),'Existing generic grove shrine reference')
assign(51,51,'Zone-replacement','Ancient Grove; Stone Garden; Silent Circle','Replace stone-marker objects with a new mossy standing-stone type only in these zones. Preserve the global stone object and art; interactions remain to be specified.',('mineralrock',171),'Current churchyard stone marker')
assign(52,52,'Variant','Global woodland; Ancient Grove; Mushroom Grove','Fern appearance for the existing longgrass role.',('props',10),'Current longgrass / fern')
assign(53,53,'New concept','Ancient Grove; Mushroom Grove','New seedpod plant concept. No harvest, resource or reward defined.')
assign(54,54,'New prop','Formal Garden; Overgrown Graves','New decorative ruined birdbath; no mechanic defined.')
assign(55,55,'New prop','Mushroom Grove; Mushroom Lane','New mushroom-covered branch scenery; no harvest defined.')
assign(56,56,'Variant','Global copper deposits; Quarries','Existing copper ore appearance; preserve pick gating and yield.',('mineralrock',0),'Current copper ore')
assign(57,57,'Variant','Global iron deposits; Quarries','Existing iron ore appearance; preserve pick gating and yield.',('mineralrock',1),'Current iron ore')
assign(58,59,'Variant','Quarries; Mystic Reef (optional)','Existing crystal-deposit art candidates. Quartz is not an implemented new resource.',('crystal_cluster',0),'Current crystal deposit')
assign(60,60,'Variant','Stone Garden; Silent Circle','Existing shrine-role art candidate; no one-to-one replacement assigned.',('grove_votive',0),'Existing generic shrine reference')
assign(61,61,'New prop','Abandoned Quarry; Work Yard; Broken Depot','New decorative handcart. The generated sprite is wooden; no transport or storage mechanic defined.')
assign(62,62,'New prop','Broken Masonry; Ruined Stronghold','New stacked-column-drum decoration.')
assign(63,63,'Zone-replacement','Silent Circle; Stone Garden; Ruined Stronghold','Replace stone-marker objects with a new tall-pillar type only in these zones. Preserve global stones and utility poles; interactions remain to be specified.',('mineralrock',171),'Current churchyard stone marker')

atlas=Image.open(ROOT/'assets/Objects/ZoneVariants/objects-24.png')
for r in rows:
    x,y=r['column']*24,r['row']*24
    path=f'art/{r["name"]}.png';atlas.crop((x,y,x+24,y+24)).save(out/path)
    r.update(image=path,sourcePixels=24,previewPixels=32,previewScale=32/24)
(out/'catalog.json').write_text(json.dumps(rows,indent=2)+'\n')
shutil.copy2(ROOT/'assets/Objects/ZoneVariants/objects-24.png',out/'objects-24.png')
esc=html.escape
body=[]
for r in rows:
    before=r['before']
    oldhtml=(f'<div class="oldart"><img src="{before["image"]}" alt="{esc(before["label"])}"></div><strong>{esc(before["label"])}</strong><details><summary>Source</summary><code>{esc(before["source"])}</code><br>Frame {before["frame"]}</details>') if before else '<span class="muted">— New object; no direct replacement</span>'
    zones=''.join(f'<span class="zone">{esc(z)}</span>' for z in r['zones'])
    name=r['name'].replace('_',' ')
    body.append(f'''<tr data-status="{r['status']}" data-type="{r['category']}"><td><small>R{r['row']+1} C{r['column']+1} · #{r['frame']}</small><strong>{esc(name)}</strong></td><td><div class="newart"><div class="cell"><img src="{r['image']}" width="32" height="32" alt="{esc(name)}"></div><img class="zoom" src="{r['image']}" width="96" height="96" alt="{esc(name)} enlarged"></div><small>32px cell · 3× detail</small></td><td>{oldhtml}</td><td><span class="badge {r['status'].lower()}">{r['status']}</span><br>{r['category']}</td><td>{zones}</td><td>{esc(r['note'])}</td></tr>''')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zone object review — 24px art</title><style>
*{box-sizing:border-box}body{margin:0;background:#17201d;color:#eef0e5;font:14px/1.5 system-ui}header{padding:28px 32px 16px;max-width:1160px}h1{margin:0 0 12px;font-size:28px}p{margin:8px 0}a{color:#a9dfd5}nav{position:sticky;top:0;z-index:3;background:#202d26;padding:12px 32px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #52644f}input,select{font:inherit;background:#101a16;color:inherit;padding:8px;border:1px solid #6a7a62;border-radius:4px}input{width:270px}label{display:flex;gap:8px;align-items:center}.tablewrap{overflow:auto;padding:0 24px 32px}table{border-collapse:collapse;width:100%;min-width:1100px}th{text-align:left;background:#26362c;padding:12px}td{padding:16px 12px;border-bottom:1px solid #415042;vertical-align:top}tr:nth-child(even){background:#1d2922}td:first-child{width:185px}td:nth-child(2){width:200px}td:nth-child(3){width:210px}td:nth-child(4){width:115px}td:nth-child(5){width:240px}small,.muted{color:#b4c0af;font-size:12px}td strong{display:block;font-weight:550}img{image-rendering:pixelated;object-fit:contain}.newart{display:flex;align-items:center;gap:20px;height:100px}.cell{width:32px;height:32px;outline:1px solid #9db098;background:#455039;flex:none}.zoom{background:#35412f;outline:1px solid #5a6b50}.oldart{height:70px;display:flex;align-items:center}.oldart img{width:64px;height:64px;object-fit:contain}details{font-size:11px;margin-top:6px}code{overflow-wrap:anywhere}.badge{display:inline-block;border:1px solid #9b9c70;border-radius:12px;padding:1px 8px;margin-bottom:8px}.live{background:#285941;border-color:#81c39a}.zone{display:block;margin-bottom:5px}#count{margin-left:auto}tr[hidden]{display:none}
</style><header><h1>Zone object review</h1><p><b>Selected: 24×24 source sprites, framed at 32×32 game pixels (scale 4/3).</b> Each proposed sprite is shown in one 32px cell, plus a 3× enlargement. Transparent padding leaves a little breathing room. Nearest-neighbour display keeps hard edges; 4/3 scaling produces uneven pixel widths.</p><p><b>4 live / 60 previews.</b> Preview status and object type are separate. Zones below are proposed destinations for previews. Live corals use this 32px framing. This page does not install the other objects.</p><p><b>Type key:</b> Total-replacement = replace an old sprite everywhere it is used, retaining the existing object type. Variant = another appearance of the same object type. <b>Zone-replacement = replace an existing object with a new type in specified zones, preserving the original global object and art.</b> New prop / concept = an addition with no replacement assigned. For zone-replacements, the comparison shows the object being displaced locally.</p><p>Current-art comparisons use exact asset frames, enlarged to fit a 64px reference box for recognition; that column is <b>not a measurement of current game scale</b>. Generic shrine references and example growth stages are explicitly labeled. Walls currently use rock cells.</p><p><a href="../stronghold-walls/">New square-grid stronghold wall set</a> · <a href="objects-24.png">24px spritesheet</a> · <a href="catalog.json">Structured catalog JSON</a> · <a href="../zone-object-pixels/">Earlier size comparison</a> · <a href="../road-review/tools/map-review.html">Map review</a></p></header><nav><label>Search <input id="search" type="search" placeholder="Name, zone, or notes…"></label><label>Status <select id="status"><option value="">All</option><option>Live</option><option>Preview</option></select></label><label>Type <select id="type"><option value="">All</option><option>Total-replacement</option><option>Variant</option><option>Zone-replacement</option><option>New prop</option><option>New concept</option></select></label><span id="count" aria-live="polite">64 objects</span></nav><div class="tablewrap"><table><thead><tr><th scope="col">Object / sheet position</th><th scope="col">Selected 24px art → 32px</th><th scope="col">Current / previous art</th><th scope="col">Status / type</th><th scope="col">Zones / scope</th><th scope="col">Implementation notes</th></tr></thead><tbody>'''+''.join(body)+'''</tbody></table></div><script>
const rows=[...document.querySelectorAll('tbody tr')],search=document.querySelector('#search'),statusSelect=document.querySelector('#status'),typeSelect=document.querySelector('#type');function filter(){let count=0;for(const row of rows){row.hidden=!!((statusSelect.value&&row.dataset.status!==statusSelect.value)||(typeSelect.value&&row.dataset.type!==typeSelect.value)||!row.textContent.toLowerCase().includes(search.value.toLowerCase()));if(!row.hidden)count++;}document.querySelector('#count').textContent=count+' / 64 objects';}for(const el of [search,statusSelect,typeSelect])el.addEventListener('input',filter);
</script></html>'''
(out/'index.html').write_text(page)
print(f'Published {len(rows)} rows, {sum(bool(r["before"]) for r in rows)} source-art comparisons to {out}')
