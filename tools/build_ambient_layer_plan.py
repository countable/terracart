#!/usr/bin/env python3
"""Build the review-only ambient habitat matrix from its JSON plan."""
import argparse
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def marked_text(idea, field):
    text = idea[field]
    fragments = idea['changes'][field]
    for fragment in fragments:
        if not fragment or text.count(fragment) != 1:
            raise ValueError(f'Change fragment must occur once: {fragment!r}')
    spans = sorted((text.index(fragment), text.index(fragment) + len(fragment)) for fragment in fragments)
    result, cursor = [], 0
    for start, end in spans:
        if start < cursor:
            raise ValueError('Overlapping change fragments')
        result.append(html.escape(text[cursor:start]))
        result.append('<span class="changed" title="Proposed change from current behavior">' + html.escape(text[start:end]) + '</span>')
        cursor = end
    return ''.join(result) + html.escape(text[cursor:])


def build(output):
    data = json.loads((ROOT / 'docs/art/ambient-layer-plan.json').read_text())
    esc = html.escape
    cards = ''.join(f'<article><b>{esc(layer["id"])} · {esc(layer["name"])}</b><p>{esc(layer["known"])}</p></article>' for layer in data['layers'])
    rows = []
    for layer in data['layers']:
        for area in data['areas']:
            idea = area['ideas'][layer['id']]
            rows.append(f'<tr data-layer="{layer["id"]}" data-area="{area["id"]}"><th>{layer["id"]}<small>{esc(layer["name"])}</small></th><th>{esc(area["name"])}</th><td>• {marked_text(idea, "spawn")}</td><td>• {marked_text(idea, "variants")}</td></tr>')
    catalog = ''.join(f'<tr><th>{esc(area["name"])}</th><td>{"<br>".join("• " + esc(v["name"]) + " <code>" + esc(v["id"]) + "</code>" for v in area["surfaceVariants"])}</td></tr>' for area in data['areas'] if area['surfaceVariants'])
    links = ' · '.join(f'<a href="http://localhost:8000/{path}">{esc(path)}</a>' for path in data['sources'])
    options = ''.join(f'<option value="{layer["id"]}">{layer["id"]} · {esc(layer["name"])}</option>' for layer in data['layers'])
    area_options = ''.join(f'<option value="{area["id"]}">{esc(area["name"])}</option>' for area in data['areas'])
    page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ambient habitats · layer plan</title><style>
*{box-sizing:border-box}body{margin:0;background:#15191e;color:#e8edf1;font:15px/1.5 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:30px}h1{font-size:30px;margin-bottom:5px}h2{margin-top:32px}a{color:#9ed3ff}p{max-width:1100px}.changed{color:#ffcf70;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:4px}.muted,small{color:#aebac6}small{display:block;font-weight:400}.pill{color:#ffdb8e;border:1px solid #806437;border-radius:20px;padding:3px 10px;font-size:13px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}article{background:#20262e;border:1px solid #37404a;padding:14px;border-radius:9px}article p{margin:6px 0 0;font-size:14px}.controls{display:flex;gap:18px;flex-wrap:wrap;margin:16px 0}select{background:#29323c;color:white;padding:8px;border:1px solid #687482;border-radius:5px;margin-left:6px}table{width:100%;border-collapse:collapse;background:#1d232b}th,td{text-align:left;vertical-align:top;padding:13px;border:1px solid #3b4550}thead th{position:sticky;top:0;background:#344253;z-index:1}tbody th{width:15%}tbody td{width:35%}tr:nth-child(even){background:#232b34}code{font-size:12px;color:#adc6dc}.scroll{overflow:auto}li{margin-bottom:5px}footer{padding:25px 0;font-size:13px}tr[hidden]{display:none}@media(max-width:700px){main{padding:15px}table{min-width:780px}h1{font-size:25px}}@media print{body,table,tr:nth-child(even),article{background:white;color:black}.controls{display:none}thead th{position:static;background:#ddd;color:black}a,small{color:#333}}
</style><main>'''
    page += f'<h1>Ambient habitats by layer</h1><span class="pill">{esc(data["status"])}</span><p>{esc(data["scope"])}</p>'
    page += '<p><a href="http://localhost:8000/tools/floor-viewer.html">Floor viewer</a> · <a href="http://localhost:8000/extra_assets/preview/level-table.html#asset-table">Floor asset table</a> · <a href="http://localhost:8000/docs/art/ambient-layer-plan.json">Editable plan JSON</a></p>'
    page += '<h2>Known behavior and agreed direction</h2><p class="muted">Source-backed floor rules and recent owner decisions. These are separate from the proposed habitat mappings below.</p><div class="cards">' + cards + '</div>'
    page += '<h2>Initial ideas · changes highlighted</h2><p><span class="changed">Gold, dotted-underlined words</span> = proposed changes; plain text = retained behavior. Underground habitat-specific spawn mixes and density rules are changes even when those creatures already exist on the floor. L7’s existing dragon-heavy mix stays plain; new placement and attendant roles are highlighted.</p><p>Reuse surface geography as a theme cue underground; do not automatically copy surface fauna. “Spawn” includes hostile creature candidates, not a promise of peaceful behavior. No new species or mechanics are implied. L0 suggestions mostly retain existing populations.</p>'
    page += f'<div class="controls"><label>Layer<select id="layer"><option value="all">All layers</option>{options}</select></label><label>Area<select id="area"><option value="all">All areas</option>{area_options}</select></label><span id="count" aria-live="polite"></span></div><div class="scroll"><table id="ideas"><thead><tr><th>Layer</th><th>Area / Nexus</th><th>Proposed ambient creatures</th><th>Proposed visual / layout variants</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>'
    page += '<h2>Existing surface Nexus catalog</h2><p>All five implemented Nexus kinds and all 25 current variants. This catalog is existing data; the underground equivalents above are initial ideas.</p><div class="scroll"><table><thead><tr><th>Nexus kind</th><th>Implemented surface variants</th></tr></thead><tbody>' + catalog + '</tbody></table></div>'
    page += '<h2>Constraints for the next implementation pass</h2><ul>' + ''.join('<li>' + esc(s) + '</li>' for s in data['constraints']) + '</ul>'
    page += '<footer>Sources: ' + links + '</footer></main><script>const layer=document.querySelector("#layer"),area=document.querySelector("#area"),rows=[...document.querySelectorAll("#ideas tbody tr")];function filter(){let n=0;for(const row of rows){row.hidden=!(layer.value==="all"||row.dataset.layer===layer.value)||!(area.value==="all"||row.dataset.area===area.value);if(!row.hidden)n++;}document.querySelector("#count").textContent=n+" of "+rows.length+" habitat ideas";}layer.addEventListener("change",filter);area.addEventListener("change",filter);filter();</script></html>'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'index.html').write_text(page)
    print(output / 'index.html')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path.home() / '.artifacts/ambient-layer-plan')
    build(parser.parse_args().output)
