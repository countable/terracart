#!/usr/bin/env python3
"""Sample story colours and publish the authored sprite palette; never edits game art."""
import argparse
import base64
import io
import json
import pathlib
from html import escape
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]

def uri(im):
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

def sample(data):
    size = data['sampling']['sampleSize']
    strip = Image.new('RGB', (size * len(data['sources']), size))
    refs = []
    for i, source in enumerate(data['sources']):
        with Image.open(ROOT / source) as original:
            im = original.convert('RGB')
        top = im.height > im.width
        selected = im.crop((0, 0, im.width, round(im.height * data['sampling']['portraitTopFraction']))) if top else im
        strip.paste(selected.resize((size, size), Image.Resampling.BICUBIC), (i * size, 0))
        thumb = im.copy()
        thumb.thumbnail((256, 180))
        refs.append((source, top, uri(thumb)))
    quantized = strip.quantize(colors=data['sampling']['quantizedColors'], method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette()
    measured = []
    for count, index in sorted(quantized.getcolors(), reverse=True):
        rgb = palette[index*3:index*3+3]
        measured.append(dict(hex='#'+''.join(f'{c:02x}' for c in rgb), share=count/(strip.width*strip.height)))
    return measured, refs

def render(output):
    data = json.loads((ROOT / 'docs/art/art-direction.json').read_text())
    output.mkdir(parents=True, exist_ok=True)
    measured, refs = sample(data)
    palette = data['palette']
    assert len({p['id'] for p in palette}) == len(palette)
    sampled_colours = {p['hex'] for p in measured}
    assert all(p['hex'] in sampled_colours for p in palette if p['origin'] == 'story'), 'Story anchors drifted; review updated paintings'
    with Image.open(ROOT/'assets/Character/FarmerCyan.png') as sheet:
        character_colours = {'#'+''.join(f'{c:02x}' for c in rgba[:3]) for rgba in sheet.convert('RGBA').getdata() if rgba[3] == 255}
    assert all(p['hex'] in character_colours for p in palette if p['origin'] == 'character')
    groups = [('World foundation', [p for p in palette if p['group'] not in ('hero', 'flower', 'restored')]),
              ('Flower accents', [p for p in palette if p['group'] == 'flower']),
              ('Player, restored and sacred accents', [p for p in palette if p['group'] in ('hero', 'restored')])]
    swatches = ''
    for title, entries in groups:
        swatches += '<h2>'+title+'</h2><div class="swatches">'+''.join(
            f'<article><div class="chip" style="background:{p["hex"]}"></div><b>{escape(p["name"])}</b><code>{p["hex"].upper()}</code><small>{p["origin"]}</small><p>{escape(p["use"])}</p></article>' for p in entries)+'</div>'
    states = ''.join(f'<article><h3>{s["name"]}</h3><p>{escape(s["rule"])}</p><p>{escape(s["exceptions"])}</p></article>' for s in data['worldStates'])
    characters = ''
    for name in ['FarmerCyan', 'SwordsmanCyan', 'MageCyan', 'BowmanCyan']:
        with Image.open(ROOT / 'assets/Character' / (name+'.png')) as source:
            frame = source.convert('RGBA').crop((0, 0, 16, 16))
        characters += f'<figure><img class="character" src="{uri(frame)}" alt="{name} current idle frame"><figcaption>{name}</figcaption></figure>'
    source_cards = ''.join(f'<figure><img src="{image}" alt="{escape(path)}"><figcaption>{pathlib.Path(path).stem}<br>{"Top 40% sampled" if top else "Whole painting sampled"}</figcaption></figure>' for path, top, image in refs)
    measured_html = ''.join(f'<div title="{p["share"]:.1%} of samples" style="background:{p["hex"]}"><code>{p["hex"]}</code></div>' for p in measured)
    recommendations = ''.join(f'<tr><td><a href="nature-art.html#{escape(k)}">{escape(k)}</a></td><td>{escape(r["decision"])}</td><td>{escape(r["style"])}</td><td>{escape(r["palette"])}</td><td>{escape(r["context"])}</td><td>{escape(r["note"])}</td></tr>' for k,r in data['recommendations'].items())
    ruins = ''.join(f'<li><b>{escape(r["role"])}</b> — <a href="nature-art.html#{r["candidate"]}">{r["candidate"]}</a>: {escape(r["use"])}</li>' for r in data['ruinsPlan'])
    rules = ''.join(f'<li>{escape(r)}</li>' for r in data['rules'])
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{data['title']}</title><style>
*{{box-sizing:border-box}}body{{background:#171b16;color:#e6d7a3;font:16px/1.55 system-ui;margin:0}}main{{max-width:1360px;margin:auto;padding:28px}}h1{{font-size:36px}}h2{{margin-top:38px}}a{{color:#83afcc}}p,li{{max-width:1000px}}nav{{display:flex;gap:20px;flex-wrap:wrap}}.swatches{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}}article{{background:#252b22;border:1px solid #454b38;border-radius:8px;padding:14px}}.chip{{height:76px;border:1px solid #a5a569;margin:-2px -2px 12px}}article code,article small,article b{{display:block}}small,figcaption{{color:#b0aa8a;font-size:12px}}article p{{font-size:13px}}.states{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}}.characters,.sources{{display:flex;gap:20px;flex-wrap:wrap}}figure{{margin:0}}.character{{width:96px;height:96px;image-rendering:pixelated;background:#777462}}.sources figure{{width:200px}}.sources img{{width:200px;height:150px;object-fit:contain;object-position:left}}.measured{{display:flex;flex-wrap:wrap}}.measured div{{width:100px;height:64px;display:flex;align-items:end}}.measured code{{background:#171717;color:#e6d7a3;font-size:11px;padding:2px}}.table{{overflow:auto}}table{{border-collapse:collapse;min-width:1050px;width:100%;font-size:13px}}td,th{{text-align:left;vertical-align:top;border-bottom:1px solid #454b38;padding:10px}}th{{color:#fac756}}td:first-child{{overflow-wrap:anywhere;min-width:150px}}@media(max-width:600px){{main{{padding:16px}}h1{{font-size:27px}}}}
</style></head><body><main><nav><a href="nature-art.html">Nature and ruins candidates</a><a href="story-palette.gpl">Download GIMP/Aseprite palette</a><a href="art-direction.json">JSON rules and colours</a><a href="story-palette.png">Palette image</a></nav><h1>{data['title']}</h1>
<p><b>The world is muted and weathered; care and significance bring colour.</b> Natural and pre-restoration assets belong to the story palette. The player, restored assets and special or sacred spaces can deliberately contrast with it. Every state keeps the same crisp chibi retro pixel style.</p><div class="states">{states}</div>
<h2>Style anchor: the current characters</h2><div class="characters">{characters}</div><p>Compact proportions, clear dark contours and a few readable pixel clusters. Adopt this sprite language rather than the paintings’ texture density. Keep the authored player cyan: its contrast is useful.</p>
<h2>How this palette was made</h2><p>{escape(data['sampling']['method'])} The 12 paintings are a representative set of opening, grove, road, ruin and home scenes; this is not an exhaustive frequency count of every painting.</p><p><b>Story</b> colours are curated quantized warm anchors. <b>Character</b> colours come directly from opaque character pixels. <b>Adapted</b> colours are authored additions: neutral stone, muted foliage and intentional restoration/flower accents. The paintings are so golden-hour-heavy that their dominant colours alone would make every plant brown. The working palette preserves their warmth without imposing sunset lighting on every sprite.</p>
{swatches}<h2>Measured story reference</h2><p>These 20 representatives are a reference, not the whole working palette. Hover for sample share.</p><div class="measured">{measured_html}</div><h2>Review rules</h2><ol>{rules}</ol><h2>Suggested ruins set</h2><ul>{ruins}</ul><h2>Revised candidate decisions</h2><p>Recommendations assess the current source art. The nature gallery now renders the proposed palette swaps beside original sprites. Colour previews are separate from runtime texture changes; contour cleanup remains pending. Palette fit and style fit are separate judgements.</p><div class="table"><table><thead><tr><th>Candidate</th><th>Decision</th><th>Style</th><th>Palette</th><th>Use</th><th>Reason</th></tr></thead><tbody>{recommendations}</tbody></table></div><h2>Story sources</h2><div class="sources">{source_cards}</div></main></body></html>'''
    (output/'art-direction.html').write_text(page)
    (output/'art-direction.json').write_text(json.dumps(data,indent=2)+'\n')
    (output/'story-samples.json').write_text(json.dumps(measured,indent=2)+'\n')
    gpl=['GIMP Palette','Name: Mending Lane - Rustic World and Restored Accents','Columns: 5','# Authored review target; see art-direction.json for source and role.']
    for p in palette:
        rgb=[int(p['hex'][i:i+2],16) for i in (1,3,5)]
        gpl.append(f'{rgb[0]:3} {rgb[1]:3} {rgb[2]:3}\t{p["name"]}')
    (output/'story-palette.gpl').write_text('\n'.join(gpl)+'\n')
    canvas=Image.new('RGB',(1000,120+((len(palette)+4)//5)*125),'#171b16')
    draw=ImageDraw.Draw(canvas)
    draw.text((20,18),'MENDING LANE / rustic world, colour restored',fill='#e6d7a3')
    draw.text((20,42),'20 world colours / 3 flower accents / 5 player, restored and sacred accents',fill='#b0aa8a')
    draw.text((20,65),'Story = quantized anchors; Character = exact pixels; Adapted = authored extension',fill='#b0aa8a')
    for i,p in enumerate(palette):
        x=20+(i%5)*195;y=100+(i//5)*125
        draw.rectangle((x,y,x+175,y+65),fill=p['hex'],outline='#777462')
        draw.text((x,y+70),p['name'],fill='#e6d7a3');draw.text((x,y+88),p['hex']+' / '+p['origin'],fill='#b0aa8a')
    canvas.save(output/'story-palette.png')
    print(f'Published {len(palette)} working colours, {len(refs)} sources and {len(data["recommendations"])} assessments: {output}')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path('/tmp/art-direction'))
    render(parser.parse_args().output)
