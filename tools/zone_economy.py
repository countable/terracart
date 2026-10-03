#!/usr/bin/env python3
"""Regenerate the comparison with live plain-rock odds and Home sale prices.
Other material-yield assumptions retain the reviewed economy baseline.
Usage: python3 tools/zone_economy.py [artifact-directory]
"""
import json,pathlib,html,math,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[1]
p=root/'docs'
out=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path('/tmp/zone-economy')
out.mkdir(parents=True,exist_ok=True)
d=json.loads((p/'zone-variants.json').read_text())
# Evaluate the shipping helper and Home sale functions, so probability tuning
# does not leave the report using a second, stale copy of the formula.
live=json.loads(subprocess.check_output(['node','-e',r"""
const fs=require('fs'),vm=require('vm');
const items=fs.readFileSync('src/items.js','utf8');
const rocks=fs.readFileSync('src/interactables.js','utf8');
const fn=(source,name)=>source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'))[0];
const ctx={};vm.createContext(ctx);
vm.runInContext(items.match(/const PRICES = [^]*?^};/m)[0]+'\n'+
 items.match(/const TRAILER_SELL_MUL = [^;]+;/)[0]+'\n'+
 items.match(/const CRYSTAL_DEPOSIT = [^;]+;/)[0]+'\n'+
 ['sellMultiplier','trailerSellMultiplier','trailerSellPrice'].map(name=>fn(items,name)).join('\n')+'\n'+
 fn(rocks,'plainRockBarChance')+'\n'+
 rocks.match(/const PLAIN_ROCK_FLINT_P = [^;]+;/)[0]+'\n'+`
 const bars=['copper_bar','iron_bar','gold_bar','platinum_bar','crimson_bar','frost_bar'];
 const probabilities=bars.map((_,i)=>plainRockBarChance(i+2));
 const stone=[0,7].map(sword=>{
   const price=id=>trailerSellPrice(PRICES[id]??1,{sword:{tier:sword}});
   return price('rockfruit')+PLAIN_ROCK_FLINT_P*price('coal')+
     bars.reduce((sum,id,i)=>sum+price(id)*probabilities[i],0);
 });
 const crystal=[0,7].map(sword=>CRYSTAL_DEPOSIT.quantity*trailerSellPrice(PRICES[CRYSTAL_DEPOSIT.item],{sword:{tier:sword}}));
 globalThis.result={stone,probabilities,crystal,equipment:[0,7].map(sword=>trailerSellPrice(PRICES.iron_bar,{sword:{tier:sword}}))};`,ctx);
process.stdout.write(JSON.stringify(ctx.result));
"""],cwd=root,text=True))
values={'grass':(1,1),'shrub':(1,1),'mushroom':(3,6),'flowers':(2,4),'orange':(17,34),'rose':(14,27),'star':(49,98),'gemfruit':(10,19),'rubble':(2,2.9),'flint':(2,3),'stone':tuple(live['stone']),'copper_rock':(15,27.5),'iron_ore':(33,64.5),'gold_ore':(81,160.25),'platinum_ore':(201.5,400.5),'crimson_ore':(483,964.5),'fruit_tree':(4.5,9),'tree':(10.1931,21),'medium_tree':(5.1931,11),'grave':(0,0)}
# Each woody giant pays one wood plus one ordinary mushroom.
values['giant_mushroom']=tuple(a+b for a,b in zip(values['shrub'],values['mushroom']))
# Art-only beach aliases; enemy combat drops are outside this harvest report.
values['crystal']=tuple(live['crystal'])
values['equipment']=tuple(live['equipment'])
values.update(shell=(6,12), driftwood=values['shrub'],
              carnivorous_plant=(0,0))
names={'rose':'Wild Rose','star':'Starflower','gemfruit':'Gemfruit','gold_ore':'Gold ore rock','platinum_ore':'Platinum ore rock','crimson_ore':'Crimson ore rock','crystal':'Sapphire crystal'}
fmt=lambda pair: f'{math.floor(pair[0]+.5)}–{math.floor(pair[1]+.5)}'
rows=[]
background_values={}
for v in d['variants']:
 if v.get('selectable') is False: continue
 if v.get('quarryLayout'):
  fixture=json.loads(subprocess.check_output(['node',str(root/'tools/preview_quarry.js'),v['id']],text=True))
  bg=tuple(sum(values.get(o['material'],(0,0))[i] for o in fixture['objects'] if o.get('zoneLayer')=='background')*100/len(fixture['coverage']) for i in (0,1))
  f=v['finds']; material=f['material']
  fv=fmt(tuple(values[material][i]*f['count'] for i in (0,1))) if material in values else ('Gear-dependent' if material=='tool_crate' else 'Treasure roll')
  rows.append((v['name'],fmt(bg),f'{f["count"]} × {names.get(material,material)}' if f['count'] else 'None',fv,'Background normalized from the runtime parking-lot sample; geometry-dependent, not a fixed density. Finite budget per complete site; clipped edge fragments receive no finite reward.'))
  continue
 b=v['background']; bg=tuple(sum(n*100*values[m][i] for m,n in b['materialDensity'].items()) for i in (0,1))
 background_values[v['id']]=bg
 f=v['finds'];fv=tuple(values[f['material']][i]*f['count'] for i in (0,1))
 note=[]
 if v.get('generated')=='parking_lanes':note.append('Generated from removed parking lanes; crystals are probabilistic background, not guaranteed finite finds; Iron pick T3; one Sapphire per cluster, no metal bars')
 if v['id']=='orchard':note.append('Apple harvest repeats every 24 h; medium maples are one-time timber')
 if b['materialDensity'].get('grave'):note.append('Headstone hoards excluded')
 if b.get('hazardDensity'):note.append(', '.join(f'{x*100:g}% {k}' for k,x in b['hazardDensity'].items()))
 if v['id']=='ancient_grove':note.append('Range also allows young/mature maple and axe tier')
 req=d['materials'][f['material']].get('requiredTier')
 if req and f['count']:note.append('Pick T'+str(req))
 rows.append((v['name'],fmt(bg),(f'{f["count"]} × {names.get(f["material"], f["material"])}' if f['count'] else 'None'),fmt(fv),'; '.join(note)))
intro='''These are expected Home sale coins using the current Easy-mode sale formula, from no sword to a Frost sword. Background value is per 100 nominal pattern cells before clipping, not per zone or per 100 placed objects. Fixed grids and rings use their own declared footprint. Mining assumes sufficient tools. Values include normal material bonus drops; exclude shiny bonuses, POI decorations, connection materials, headstone hoards, fauna, guard loot and recurring shrine gifts. Ancient Grove uses the largest mature maples (four times base wood); its range retains the reviewed acorn-drop baseline. Background harvesting is generally one-time, except orchard fruit. This report evaluates the variant rows of `docs/zone-variants.json` used by world generation. Ordinary-rock bonus odds are read from the runtime helper; other material-yield assumptions retain the reviewed baseline.'''
work_b=next(v['background'] for v in d['variants'] if v['id']=='work_yard')
work_area=math.prod(n*work_b['spacingCells']+1 for n in work_b['plots'])
heads=['Variant','Background / 100 cells','Finite special finds','Find value / zone','Notes']
preamble='Generated by `python3 tools/zone_economy.py`, which rewrites this whole file; edit the tool, not this page. The figures are a snapshot and can lag the variant rows in `docs/zone-variants.json`; regenerate before relying on them.'
md=['# Zone economy comparison','',preamble,'',intro,'','| '+' | '.join(heads)+' |','|'+'---|'*5]+['| '+' | '.join(r)+' |' for r in rows]
insights=[
f'Plain rocks now have a steeper bonus-bar curve: copper stays at 12.5%, while Frost is {live["probabilities"][-1]*100:.3f}% (1/294), three times rarer than before. One ordinary churchyard rock averages {fmt(values["stone"])} sale coins. About {math.prod(1-p for p in live["probabilities"])*100:.1f}% give no bonus bar. Fifteen rocks have a {100*(1-(1-live["probabilities"][-1])**15):.1f}% chance of at least one Frost bar. Ordinary rocks remain ungated; their averages still include rare jackpots.',
f'Work Yard background value per unit area is: {fmt(background_values["work_yard"])} coins per 100 cells, versus Stone Garden at {fmt(background_values["stone_garden"])} and Silent Circle at {fmt(background_values["silent_circle"])}. The fixed Work Yard footprint holds about {fmt(tuple(n*work_area/100 for n in background_values["work_yard"]))} background coins over {work_area} cells; Stone Garden holds {fmt(tuple(n*4.41 for n in background_values["stone_garden"]))} over 441 cells, before clipping and POI replacement.',
'Among the original non-quarry rows, Work Yard has the largest finite reward: one Crimson rock averages 483–965 coins, versus 202–401 for the Platinum rock and 162–321 for Black Ring’s pair of Gold rocks. Gold requires an Iron pick (T3), Platinum a Gold pick (T4), Crimson a Platinum pick (T5). The existing one-tier-short slow-grind option still applies.',
'Formal Garden pays well because ordinary Marigolds sell for 17–34 coins each, more than the designated Wild Rose finds at 14–27. The “special find” label does not always mean a more valuable item.',
'Seep and Broken Depot have weak backgrounds. Tar and traps contribute no sale income; their income is mainly the finite find or rubble bonuses. Danger is not currently rewarded with comparable extra value.',
'Fauna affinities relocate existing creatures; they do not add a guaranteed animal reward or increase total tile fauna. Guards add risk but are excluded from these material valuations.'
]
md+=['','## Main findings','']+['- '+x for x in insights]
md+=['','## Ore contents','','Gold: one Gold bar, 1–2 flint, 25% chance of a Sapphire. Platinum: one Platinum bar, 1–2 flint, 35% chance of a Ruby. Crimson: one Crimson bar, 1–2 flint, 40% chance of an Emerald. These are existing game drop rules; the variants declare where the rocks are placed.','','## Source basis','','`src/items.js`: PRICES and sale multipliers; `src/app.js`: Home sale fallback price; `src/interactables.js`: tree, fruit, mineral-rock and headstone yields; `src/interact.js`: wildplant harvesting; `src/util.js`: tree maturity and acorn rules; `tools/zone_economy.py`: report generation and remaining baseline assumptions; `docs/zone-variants.json`: densities and finite find counts.','']
(p/'zone-economy.md').write_text('\n'.join(md))
page='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Zone economy comparison</title><style>body{font:16px system-ui;background:#101a15;color:#e5ecdf;max-width:1250px;margin:32px auto;padding:0 20px;line-height:1.6}a{color:#95d7d1}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;text-align:left;border-bottom:1px solid #3b5544}th{background:#23392b}tr:nth-child(even){background:#18291f}.table{overflow:auto}li{margin:16px 0}h1{line-height:1.2}</style><h1>Zone economy comparison</h1><p><a href="index.html">Back to variant previews</a> · <a href="zone-economy.md">Markdown report</a></p>'''
page+='<p>'+intro+'</p><div class="table"><table><thead><tr>'+''.join('<th>'+x+'</th>' for x in heads)+'</tr></thead><tbody>'
page+=''.join('<tr>'+''.join('<td>'+html.escape(x)+'</td>' for x in r)+'</tr>' for r in rows)+'</tbody></table></div><h2>Main findings</h2><ul>'+''.join('<li>'+x+'</li>' for x in insights)+'</ul>'
(out/'economy.html').write_text(page)
(out/'zone-economy.md').write_text('\n'.join(md))
print('\n'.join(' | '.join(r[:4]) for r in rows))
