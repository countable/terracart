#!/usr/bin/env python3
"""Compare shipping fixtures with preview-only surface and lamp concepts."""
import argparse
import copy
import html
import json
import pathlib
import re
import subprocess
import preview_zone_variants as preview

ROOT = pathlib.Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--streets', type=pathlib.Path)
    parser.add_argument('--art', type=pathlib.Path)
    args = parser.parse_args()
    def export(file, tool):
        return json.loads(file.read_text() if file else subprocess.check_output(['node', str(ROOT/'tools'/tool)], text=True))
    streets = export(args.streets, 'preview_street_variants.js')
    registry = export(args.art, 'preview_variant_art.js')
    preview.art_registry = lambda: registry
    data = json.loads((ROOT/'tools/road-style-concepts.json').read_text())
    concepts = data if isinstance(data, list) else data['concepts']
    by_id = {row['id']: row for row in concepts}
    assert set(by_id) == {row['id'] for row in streets['rows']}, 'Every variant needs one concept'
    out = ROOT/'design/road-style-concepts'
    out.mkdir(parents=True, exist_ok=True)
    def scene(row, prefix):
        svg = preview.street_svg(row, streets['cellM'])
        box = [float(n) for n in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
        focus = next((o['x'] for o in row['objects'] if o.get('crop') == 'creeping_vine'), box[0]+box[2]/2)
        left = max(box[0], min(box[0]+box[2]-140, focus-70))
        svg = re.sub(r'viewBox="[^"]+"', f'viewBox="{left} {box[1]+box[3]/2-24.5} 140 49"', svg, count=1)
        svg = re.sub(r'id="([^"]+)"', lambda m: f'id="{prefix}-{m[1]}"', svg)
        svg = svg.replace('url(#', 'url(#'+prefix+'-').replace('href="#', 'href="#'+prefix+'-')
        return svg
    cards = []
    for row in streets['rows']:
        concept = by_id[row['id']]
        assert concept['lamp'] in registry['lampArtByStyle'], concept['lamp']
        after = copy.deepcopy(row)
        for lamp in after['lamps']:
            lamp['_streetArt'] = concept['lamp']
            lamp['glow'] = concept['lightColor']
        before_styles = sorted({lamp.get('_streetArt') or 'standard lamp' for lamp in row['lamps']})
        lamp_art = registry['lampArtByStyle'][concept['lamp']]
        lamp_image = preview.art_image(lamp_art, 'width="64" height="90" preserveAspectRatio="xMidYMid meet"')
        cards.append(f'''<article id="{row['id']}" data-variant="{row['id']}">
<header><div><h2>{html.escape(row['title'])}</h2><p>{html.escape(concept['title'])}</p></div><svg class="lamp-sample" viewBox="0 0 64 90" role="img" aria-label="Proposed {html.escape(concept['lamp'])}">{lamp_image}</svg></header>
<div class="comparison"><figure class="before"><figcaption>Before · current game</figcaption>{scene(row,'before-'+row['id'])}<p>{html.escape(', '.join(before_styles).replace('_',' '))}</p></figure><figure class="after" data-concept="{row['id']}"><figcaption>After · concept</figcaption>{scene(after,'after-'+row['id'])}<p>{html.escape(concept['surface'].replace('_',' '))} · {html.escape(concept['lamp'].replace('_',' '))}</p></figure></div><p class="note">{html.escape(concept['note'])}</p></article>''')
    options = ''.join(f'<option value="{row["id"]}">{html.escape(row["title"])}</option>' for row in streets['rows'])
    script = (ROOT/'tools/road-concept-painter.js').read_text()
    interaction = '''
const concepts=CONCEPT_DATA;
async function ready(){
 while(document.documentElement.dataset.artReady!=='true'){
  if(document.documentElement.dataset.artError)throw Error(document.documentElement.dataset.artError);
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 for(const figure of document.querySelectorAll('[data-concept]')){
  const concept=concepts.find(row=>row.id===figure.dataset.concept);
  for(const image of figure.querySelectorAll('[data-procedural^="pavement:"]')){
   const restored=image.dataset.procedural.split(':')[2]==='restored';
   const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
   RoadConceptPainter.paint(canvas.getContext('2d'),64,concept,restored);
   image.setAttribute('href',canvas.toDataURL());
   for(const node of [image,image.closest('pattern')]){node.setAttribute('width',14);node.setAttribute('height',14);}
  }
 }
 document.documentElement.dataset.conceptsReady='true';
}
ready().catch(e=>{document.getElementById('status').textContent=e.message;console.error(e)});
const select=document.getElementById('variant');
function filter(){for(const card of document.querySelectorAll('article[data-variant]'))card.hidden=!!select.value&&card.dataset.variant!==select.value;history.replaceState(null,'',select.value?'#'+select.value:location.pathname);}
select.addEventListener('change',filter);
if(concepts.some(c=>c.id===location.hash.slice(1))){select.value=location.hash.slice(1);filter();}
'''.replace('CONCEPT_DATA', json.dumps(concepts))
    page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Road surfaces and lights · before / after</title><style>
*{box-sizing:border-box}body{margin:0;background:#101b16;color:#e8eddf;font:16px/1.5 system-ui}main{max-width:1500px;margin:auto;padding:24px}a{color:#b6d4c0}h1{font-size:30px;margin:12px 0}h2{font-size:23px;margin:0}p{margin:8px 0}nav, .controls{display:flex;gap:18px;flex-wrap:wrap;align-items:center}.controls{position:sticky;top:0;background:#17271f;z-index:2;padding:12px 24px;border-bottom:1px solid #425345}select{max-width:300px;background:#233c2e;color:inherit;padding:7px;border:1px solid #526756;border-radius:5px}article{border:1px solid #3a5140;border-radius:12px;background:#1b2d22;padding:20px;margin:24px 0;scroll-margin-top:75px}header{display:flex;justify-content:space-between;align-items:center;gap:16px}header p{color:#b3c9b5}.lamp-sample{width:64px;height:90px;flex:none;image-rendering:pixelated}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;min-width:0}figcaption{font-weight:650;margin:6px 0}.after figcaption{color:#d9d4a4}figure>svg{width:100%;aspect-ratio:20/7;display:block;image-rendering:pixelated;background:#172820}figure>p{font-size:13px;color:#b6c5b9}.note{border-top:1px solid #3b5041;padding-top:12px;color:#d5dfd1}.geometry-cell,.road-geometry,.light-guide{display:none}body:has(#show-lights:checked) .light-guide{display:block}article[hidden]{display:none} @media(max-width:700px){main{padding:12px}.comparison{grid-template-columns:1fr}article{padding:12px}.controls{position:static;padding:12px}h1{font-size:25px}}
''' + preview.art_styles() + '''</style><body><main><nav><a href="/design/zone-variants/index.html#streets">← Variant dashboard</a></nav><h1>Road surfaces and lights</h1><p>32 before / after studies. Current game layouts, 20 × 7 cells. Concepts change surfaces and lamps; they are not applied to gameplay.</p><p>New paving patterns use native pixel geometry. Light posts reuse game sprites. Worn / restored applies to both sides.</p></main><div class="controls"><label>Variant <select id="variant"><option value="">All variants</option>''' + options + '''</select></label><label><input id="restored-pavement" type="checkbox" checked>Restored</label><label><input id="show-lights" type="checkbox">Light reach</label><input id="show-art" type="checkbox" checked hidden><input id="show-monsters" type="checkbox" checked hidden><span id="status" role="status"></span></div><main>''' + ''.join(cards) + '</main>' + preview.art_script() + preview.basic_tile_script() + '<script>' + script + '\n' + interaction + '</script></body></html>'
    (out/'index.html').write_text(page)
    (out/'concepts.json').write_text(json.dumps(concepts,indent=2)+'\n')
    preview.compact_preview_images(out)
    print(f'Rendered {len(cards)} before/after concepts to {out}')

if __name__ == '__main__':
    main()
