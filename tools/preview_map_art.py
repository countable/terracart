#!/usr/bin/env python3
"""Build the offline audit of active environmental map art (Pillow + Node)."""
import argparse
import base64
import io
import json
from pathlib import Path
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PALETTE = {p['id']: p for p in json.loads((ROOT / 'docs/art/art-direction.json').read_text())['palette']}


def colours(ids):
    return [p if isinstance(p, dict) else dict(id=p, hex=PALETTE[p]['hex']) for p in ids]


def source_name(ref):
    return ref.get('path', ref.get('file', ref.get('source', ref.get('renderer', ''))))


def raster(ref, reserve, label='Current source art'):
    name = source_name(ref)
    if not name or not name.lower().endswith(('.png', '.webp')):
        return None
    path = reserve / name.split('unused_art/', 1)[1] if 'unused_art/' in name else ROOT / name
    image = Image.open(path).convert('RGBA')
    rect = ref.get('rect') or ref.get('crop')
    if not rect and 'frame' in ref:
        fw, fh = ref['frameWidth'], ref['frameHeight']
        frame = ref['frame']
        rect = [frame % (image.width // fw) * fw, frame // (image.width // fw) * fh, fw, fh]
    if rect:
        x, y, w, h = rect
        assert x >= 0 and y >= 0 and x+w <= image.width and y+h <= image.height, (name, rect, image.size)
        image = image.crop((x, y, x+w, y+h))
    if ref.get('whiteKey'):
        image.putdata([(r,g,b,0 if min(r,g,b)>240 else a) for r,g,b,a in image.getdata()])
    assert image.getbbox(), (name, rect)
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return dict(src='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode(),
                label=label, width=image.width, height=image.height)


def procedural(kind, label, **kwargs):
    return dict(label=label, procedural=dict(kind=kind, **kwargs))


def images(refs, reserve, label='Current source art'):
    return [im for ref in refs if (im := raster(ref, reserve, ref.get('label', label)))]


def normalize(group, entry, reserve):
    rec = entry['recommendation']
    if isinstance(rec, str):
        rec = dict(action=entry['treatment'], rationale=rec, candidate=entry.get('candidate'))
    palette = colours(rec.get('palette', []))
    action = rec['action'].replace('recolor', 'recolour').replace('-proposed', '').replace('keep-applied', 'applied')
    if action == 'applied':
        defaults = json.loads((ROOT/'docs/art/art-direction.json').read_text())['spritePlan']['defaults']
        kind = {'longgrass':'grass','shrub':'bush','trees':'tree','mushroom':'mushroom','headstone':'grave','clay_pot':'clay-pot'}
        if entry['id'] in kind:
            palette = colours(next(c['colours'] for c in defaults if c['id']=='default-'+kind[entry['id']]))
    row = dict(id=entry['id'], name=entry['name'], category=entry['category'].title(),
               action=action, rationale=rec.get('rationale', rec.get('note', '')),
               assessment=entry.get('assessment', ''), palette=palette,
               variants=[], currentImages=[], candidateImages=[], sources=[])
    if group == 'interactables':
        bands = {'ubiquitous':1, 'common':2, 'locally-dense':3, 'localized':3, 'local':3, 'uncommon':3, 'rare':4, 'very rare':4}
        p = entry['prevalence']
        row['rank'] = bands.get(p['band'], 3)
        row['prevalence'] = p['reason'] + ' ('+p['band']+'; spawn-rule estimate.)'
        row['evidence'] = '; '.join(entry['spawnEvidence'])
        refs = entry['current']
        row['currentImages'] = images(refs, reserve)
        row['sources'] = [source_name(r) + (' · frame '+str(r['frame']) if 'frame' in r else '') for r in refs]
        if row['id'].startswith('trap-'):
            row['currentImages'] = [procedural('trap', 'Existing trap state', sprung=row['id']=='trap-open')]
        if row['id'] == 'gold-pot':
            row['currentImages'] = [procedural('potofgold', 'Existing treasure container')]
        if row['id'] == 'treasure-mark':
            row['currentImages'] = [procedural('treasure', 'Surface mark'), procedural('treasure', 'Cave mark', cave=True)]
        v = entry.get('zoneVariant')
        if v:
            vp = palette if row['id'] in ['shrub','mushroom','stakes'] else []
            vi = images([v['candidate']], reserve, 'Proposed zone-only silhouette')
            if vp:
                for im in vi:
                    im['recolour'] = [p['hex'] for p in vp]
            row['variants'] = [dict(name=v['name'], usage=v['usage'], rationale=v['note'], images=vi, palette=vp)]
    else:
        row['rank'] = entry['prevalenceRank']
        row['prevalence'] = entry['prevalenceReason'] + ' (Generator-coverage estimate.)'
        row['evidence'] = entry.get('spawnEvidence', json.dumps(entry.get('prevalenceEvidence', {})))
        if entry.get('sourceSample'):
            row['evidence'] += ' · Local INPUT feature counts, not final placements: '+json.dumps(entry['sourceSample'])
        if group == 'ground':
            row['category'] = 'Roads' if entry['category'] == 'roads' else 'Ground'
            row['sources'] = [json.dumps(s) for s in entry['sources']]
            ident = entry['id']
            if 'terrainId' in entry:
                spec = dict(kind='biome', terrainId=entry['terrainId'], color=entry['currentColor'])
                row['currentImages'] = [dict(procedural=spec, label='Shipping terrain painter')]
                if entry.get('proposedColor'):
                    row['candidateImages'] = [dict(procedural=dict(spec, color=entry['proposedColor']), label='Proposed base colour; existing texture marks')]
                    row['palette'] = [dict(id='proposed base', hex=entry['proposedColor'])]
            elif ident in ['road-weathered', 'path-weathered', 'road-restored', 'rail']:
                style = 'path' if ident.startswith('path') else 'rail' if ident == 'rail' else 'road'
                row['currentImages'] = [procedural('road', 'Shipping road painter', style=style, restored=ident=='road-restored')]
                if ident == 'road-restored':
                    row['currentImages'].append(procedural('road', 'Existing restored path', style='path', restored=True))
                row['palette'] = [dict(id='proposed road base', hex=entry['proposedColor'])]
                if action == 'recolour':
                    row['candidateImages'] = [procedural('road', 'Proposed base colour; shipping road geometry', style=style, color=entry['proposedColor'])]
            elif ident in ['tilled-bed', 'poi-pad']:
                row['currentImages'] = [procedural('tilled' if ident == 'tilled-bed' else 'pad', 'Shipping painter')]
            elif ident == 'pier-planks':
                row['currentImages'] = images([entry['candidate']], reserve, 'Existing bridge deck')
            for v in entry.get('usageVariants', []):
                row['variants'].append(dict(name=v['id'].replace('-', ' ').title(), usage=v['zone'].replace('_',' ').title(),
                                           rationale=v['recommendation']+' '+v['reason'], palette=colours(v['palette']), images=[]))
        else:
            current = entry['current']
            row['sources'] = [source_name(current)]
            row['currentImages'] = images([current], reserve)
            if row['id'] == 'produce-stand':
                row['currentImages'] = images([dict(current, rect=[i*80,0,80,80], label='Existing product family '+str(i+1)) for i in range(7)], reserve)
            if row['id'].startswith('building-geometry-'):
                row['currentImages'] = [procedural('building', 'Unrestored polygon walls and floor', tier=current['tier'], unclaimed=True),
                                        procedural('building', 'Restored polygon walls and floor', tier=current['tier']),
                                        procedural('biome', 'Existing floor texture', terrainId=current['tier'])]
            elif row['id'] == 'castle-turret':
                row['currentImages'] = [procedural('tower', 'Unclaimed stone', unclaimed=True), procedural('tower', 'Claimed stone')]
            elif row['id'] == 'street-lamp':
                row['currentImages'] = [procedural('lamp', 'Existing restored lamp')]
                row['currentImages'] += images([dict(file='assets/Objects/Road copiar.png',frame=i,frameWidth=16,frameHeight=16,label='Unrestored foundation '+str(i)) for i in [0,5,1,3]],reserve)
    candidate = rec.get('candidate')
    if candidate:
        role = candidate.get('role', '')
        im = raster(candidate, reserve, 'Library reference; retain procedural geometry' if 'comparison' in role else 'Recommended source / silhouette')
        if im:
            if 'comparison' not in role:
                row['candidateImages'].append(im)
            row['sources'].append('Candidate: '+source_name(candidate))
            if 'comparison' in role:
                row['sources'].append('Library inspected for this material; procedural geometry retained rather than replacing arbitrary map polygons with this tile sheet.')
    if not row['candidateImages'] and (row['action'].startswith('keep') or row['action']=='applied'):
        row['candidateImages'] = [dict(im, label='Keep existing art') for im in row['currentImages']]
    elif not row['candidateImages'] and row['currentImages'] and row['palette']:
        row['candidateImages'] = [dict(row['currentImages'][0], label='Retain silhouette; target palette below')]
    if row['action'] in ['recolour', 'swap', 'simplify', 'simplify/recolour'] and row['palette']:
        for im in row['candidateImages']:
            if im.get('src') and not im['label'].startswith('Library reference'):
                im['recolour'] = [p['hex'] for p in row['palette']]
                im['label'] = 'Palette study · '+im['label']
    assert row['currentImages'], 'Missing actual art preview: '+row['id']
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reserve-root', type=Path, default=ROOT/'unused_art')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    rows, exclusions = [], []
    for group in ['ground', 'structures', 'interactables']:
        data = json.loads((ROOT/'docs/art'/('map-audit-'+group+'.json')).read_text())
        for entry in data['rows']:
            if any(r['id']==entry['id'] for r in rows):
                continue  # One shared barricade asset; structural entry carries its POI consumers.
            rows.append(normalize(group, entry, args.reserve_root))
        exclusions += data.get('excluded', data.get('coverage', {}).get('excluded', []))
    # Broad repeat exposure first within each qualitative band, not alphabetical
    # ordering that would make rare large castles appear ahead of grass/roads.
    first = ['ground-0','longgrass','road-weathered','path-weathered','trees','shrub',
             'ground-1','ground-3','ground-6','ground-5','ground-16','ground-27',
             'building-geometry-small','building-wreck','street-lamp','utility-pillar']
    for row in rows:
        if row['id'] in ['building-geometry-medium','building-geometry-large','produce-stand','ground-28','ground-29']:
            row['rank'] = max(2,row['rank'])
        row['order'] = first.index(row['id']) if row['id'] in first else 100
    rows.sort(key=lambda r:(r['rank'],r['order'],r['name']))
    assert len({r['id'] for r in rows}) == len(rows)
    variant_count = sum(bool(r['variants']) for r in rows)
    assert variant_count <= len(rows)*.12, 'Too many proposed zone variants'
    payload = dict(rows=rows, excluded=exclusions, variantCount=variant_count,
                   prevalenceMethod='Generator coverage and spawn-rule estimates, not measured final placement counts. Local source-feature counts are labelled separately.',
                   version=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=ROOT,text=True).strip())
    painters = subprocess.check_output(['node','tools/export_map_art_painters.js'],cwd=ROOT,text=True)
    template = (ROOT/'tools/map_art_dashboard.html').read_text()
    page = template.replace('__DATA__', json.dumps(payload).replace('<','\\u003c')).replace('__PAINTERS__',painters)
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'index.html').write_text(page)
    # Text-only source recommendations are the portable, reviewable audit record.
    compact = dict(payload,rows=[{k:v for k,v in r.items() if k not in ['currentImages','candidateImages']} for r in rows])
    (args.output/'audit.json').write_text(json.dumps(compact,indent=2))
    print(f'{len(rows)} active map-art families; {variant_count} zone-variant proposals: {args.output}/index.html')


if __name__ == '__main__':
    main()
