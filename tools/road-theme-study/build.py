#!/usr/bin/env python3
"""Build a self-contained road palette proposal from current game art."""
from pathlib import Path
import base64,json,re,sys
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/road-theme-proposal')
OUT.mkdir(parents=True,exist_ok=True)
def data(path):
 p=ROOT/path
 return 'data:image/'+('webp' if p.suffix=='.webp' else 'png')+';base64,'+base64.b64encode(p.read_bytes()).decode()
# Palette choices interpret material under neutral light; most paintings share
# sunset lighting, and several gameplay variants deliberately reuse a painting.
# id: stone colour, name, existing props, rationale.
rows=[
('plain', '#899397', 'River-grey', 'Ordinary lamps and scattered roadside plants.', 'Neutral anchor; no added verge.'),
('suppressed', '#647f79', 'Cold patinated slate', 'Teal lamps and the restored rift border.', 'Teal stone and the existing rift already distinguish this route.'),
('hedgerow', '#a29b82', 'Garden limestone', 'Hedge walls with gate gaps.', 'The hedge silhouette supplies a stronger boundary than a painted verge.'),
('overgrown', '#7c8265', 'Lichen olive', 'Saplings, pines and woodland encounters.', 'Lichen-olive stone echoes the woodland art; saplings and pines convey the encroaching forest.'),
('orchard', '#b29a76', 'Solid honey sandstone', 'Fruit trees and pink lamp light.', 'The orchard painting suggests warm stone and fruit, not pink paving. Tree props carry the identity.'),
('pilgrim', '#b1ad96', 'Worn chalk limestone', 'Rounded stones that light underfoot.', 'Pale paving supports the sacred stones without adding a competing border.'),
('lantern', '#ad8862', 'Lamplit ochre', 'Closely spaced lamp posts.', 'Dense lamps are the defining rhythm; the ground can stay open.'),
('burned', '#493a35', 'Charcoal, unchanged', 'Embers, tar gutters and iron stakes.', 'Keep the solid current surface and ember warning. No sparse treatment or extra verge.'),
('barricade', '#94856c', 'Dusty fort stone', 'Wooden barriers and iron spikes across the route.', 'Barriers already define both edges and distinguish it from Trade Row.'),
('toadstool', '#a27d70', 'Muted cap-red stone', 'Red, cream-spotted toadstools.', 'Red-brown stone echoes the caps; mushrooms carry the theme without a new damp strip.'),
('promenade', '#bdb39b', 'Shell limestone', 'Coastal setting and warm lamps.', 'Pale coastal stone fits the waterfront painting. Preserve the mapped shore instead of adding a sand verge everywhere.'),
('greenway', '#8b947a', 'Sage limestone', 'Trees and low woodland vegetation.', 'Quiet, open green paving; existing vegetation is sufficient.'),
('parkpath', '#a49b83', 'Park gravel-grey', 'Park trees and planted scenery.', 'A warmer, more tended stone than greenway. Keep the surrounding park visible.'),
('golden', '#b99d59', 'Old brass sandstone', 'Gilded shrine and green coins along both sides.', 'Use muted ochre rather than bright yellow; the shrine and green coins provide the strong contrast.'),
('snare', '#8c8274', 'Iron-dusted flint', 'Iron traps around a chest.', 'Avoid extra edge noise that would hide trap silhouettes.'),
('thorny', '#a08d65', 'Dry khaki stone', 'Dense tangled brambles.', 'Dry khaki stone separates this parched lane from green overgrowth; brambles define its edges.'),
('goblin_gang', '#8c7762', 'Smoky umber', 'Goblin groups beside clustered barrel stacks.', 'Clusters and actors distinguish it from orderly Trade Row; no additional ground strip.'),
('golden_path', '#b99d59', 'Old brass sandstone', 'Gilded shrines and a centreline of green coins.', 'Share Golden Road stone; the coin placement carries the path distinction.'),
('slime_trail', '#7e9270', 'Wet celadon', 'Slime colonies along the trail.', 'Celadon stone supports the wet woodland mood; slime colonies carry the stronger colour cues.'),
('spider_path', '#8c8793', 'Silvery lilac slate', 'Persistent webs and spiders.', 'Keep the ground simple so pale silk stays legible; webs already identify the route.'),
('poison_path', '#9ba268', 'Sulphur olive', 'Poison geysers and a boon shrine.', 'Sulphur-olive stones distinguish poison geysers from the cooler Slime Trail.'),
('fire_path', '#9b705c', 'Fired russet', 'Fire geysers and a boon shrine.', 'Fired russet stones echo the burned painting; fire geysers distinguish this sparse path from solid Burned Row.'),
('paralysis_path', '#b3a16a', 'Dull ochre mineral', 'Paralysis geysers and yellow lamps.', 'Dull ochre stones and yellow lamps reinforce the paralysis geysers without extra markings.'),
('confusion_path', '#99829b', 'Dusty amethyst', 'Confusion geysers and violet lamps.', 'Dusty amethyst stone supports the strange woodland mood alongside violet lamps and geysers.'),
('berry', '#968788', 'Muted berry-grey', 'Mixed berry, poison and thorn bushes.', 'A restrained plum undertone leaves the brightly coloured berries readable.'),
('berry_trail', '#968788', 'Muted berry-grey', 'Mixed berry bushes and hidden goblin runts.', 'Share Berry Lane stone; bushes and narrower geometry supply the identity.'),
('pottery', '#b08a73', 'Clay limestone', 'Clay pots along both sides.', 'Clay-coloured stone links to the pots. Their silhouettes already distinguish this from Golden Road despite shared art.'),
('trade', '#a39178', 'Cart-worn tan', 'Rows of goods barrels and goblins.', 'Cart-worn tan echoes the painting; orderly barrel rows distinguish trade from goblin barrel clusters.'),
('rocky_path', '#9b9b91', 'Flint grey', 'Loose stones and low rocks.', 'The rock props carry the plain rugged identity; avoid a second gravel band.'),
('grassy_lane', '#92a087', 'Soft grey-green', 'Herbs, grass and small bushes.', 'Let the real grass dominate between the stones.'),
('old_growth_path', '#777c68', 'Shaded moss-grey', 'Mature trees, shrubs and mushrooms.', 'Tall trees distinguish age; darker stone is sufficient without another forest-floor strip.'),
('haunted_forest_path', '#807d91', 'Cold violet-grey', 'Dark trees, headstones and mushrooms.', 'Cold stone plus grave silhouettes conveys the haunting; keep clear space around headstones.'),
('way_of_variety', '#a89d86', 'Warm mixed fieldstone', 'Herbs, berries, mushrooms, rocks, trees and pots.', 'A neutral warm route holds the deliberately mixed props together; no extra edge motif.'),
]
choices={r[0]:dict(zip(['color','palette','props','reason'],r[1:])) for r in rows}
art={p.stem:data(p.relative_to(ROOT)) for p in (ROOT/'assets/art').glob('street*.webp')}
textures=(ROOT/'src/textures.js').read_text()
frames=json.loads(re.search(r'const SELECTED_MATERIAL_FRAMES = (.*?);',textures).group(1))
js=(ROOT/'src/road_overlay.js').read_text()
# This page compares authored swatches; game-only code remains inert.
bootstrap='const SpriteLayout={CELL_PX:32},WorldGen={PATH_CLASSES:new Set(),T:{WATER:3}};const cssOf=c=>"#"+c.toString(16).padStart(6,"0");\n'
bootstrap+='const FRAMES='+json.dumps(frames)+';const CHOICES='+json.dumps(choices)+';const ART='+json.dumps(art)+';\n'
bootstrap+='const atlas=new Image();atlas.src='+json.dumps(data(Path('assets/selected-terrain/selected-terrain.png')))+';\n'
bootstrap+='function drawSelectedMaterial(cx,size,id){const f=FRAMES[id];if(f===undefined)return false;cx.imageSmoothingEnabled=false;cx.drawImage(atlas,f*16,0,16,16,0,0,size,size);return true;}\n'
bootstrap+='const grass=new Image();grass.src='+json.dumps(data(Path('assets/ArtTrials/RogueTerrain/tiles.png')))+';\n'
head='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Road themes — two-tone stone palettes</title><style>
*{box-sizing:border-box}body{margin:0;background:#18211d;color:#e7e9df;font:16px/1.5 system-ui;padding:30px}main{max-width:1440px;margin:auto}h1{font-size:34px;line-height:1.15;max-width:900px;margin:0 0 18px}p{max-width:1050px;color:#c6cdbf}a{color:#c7d9a7}.intro{padding-bottom:12px}.controls{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:15px;background:#27362f;border:1px solid #516454;margin:20px 0}input,select{background:#18211d;border:1px solid #687a68;color:#eee;padding:8px}input[type=checkbox]{accent-color:#c5a66f}#cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(390px,1fr));gap:22px}article{background:#233129;padding:18px;border:1px solid #435344;border-radius:8px}h2{font-size:21px;margin:0}.tag{display:inline-block;font-size:12px;padding:3px 8px;margin:8px 0;background:#364b3e;border-radius:20px}.tag.yes{background:#5f5031;color:#ffe0a0}.ref{display:flex;gap:14px;margin:12px 0;align-items:center}.ref img{width:132px;height:99px;object-fit:cover;border-radius:4px}.ref span{font-size:12px;color:#b8c4b6;overflow-wrap:anywhere}.swatches{display:flex;gap:7px;align-items:center;font-size:14px}.chip{width:18px;height:18px;border-radius:50%;border:1px solid #ffffff44;display:inline-block}.caption{font-size:13px;color:#c6cdbf;display:block;margin:12px 0 5px}canvas{width:100%;display:block;image-rendering:pixelated}article p{font-size:14px;margin:10px 0}details{margin:12px 0;color:#becab9;font-size:13px}#error{color:#faa}footer{margin-top:30px;color:#bbc5b7;font-size:14px}@media(max-width:460px){body{padding:14px}#cards{grid-template-columns:1fr}.ref img{width:110px;height:83px}}
</style><main><div class="intro"><h1>Road themes: muted weathering, richer repairs</h1><p><strong>Applied to the game.</strong> Sparse stones are the approved base. Theme colours retain the light and dark stone variety, using the applied Promenade’s contrast level as the reference. Orchard Lane and its shared warm family now have solid sandstone faces. Burned Row retains its solid ember surface.</p><p>No verge treatments. Unrestored stones have 65% less colour saturation, while retaining the Promenade’s light–dark contrast. Restored stones regain their theme colour. Existing roadside props supply the surrounding atmosphere.</p><p>The reference paintings share amber sunset lighting. These colours interpret their materials under neutral light. Where themes reuse a painting, the existing props and gameplay description guide the distinction. Swatches isolate paving and ground; prop placement is not simulated.</p><a href="../road-sparse-cobbles/index.html">Approved sparse-cobble study</a></div><div class="controls"><input id="search" placeholder="Find theme or prop" aria-label="Find theme"><label>Ground <select id="ground"><option value="grass">Grass</option><option value="soil">Soil</option><option value="sand">Sand</option></select></label><label><input id="restored" type="checkbox"> Restored</label><span id="count"></span></div><div id="error"></div><div id="cards"></div><footer>Ground texture remains visible between the stones and along both sides. Restoration adds stones and brings back their theme colour while preserving two-tone contrast. Burned Row keeps its solid ember surface.</footer></main><script>'''
render=(Path(__file__).parent/'preview.js').read_text()
html=head+bootstrap+(ROOT/'src/street_variants.js').read_text()+'\n'+js+'\n'+render+'</script></html>'
(OUT/'index.html').write_text(html)
(OUT/'choices.json').write_text(json.dumps(choices,indent=2)+'\n')
print(OUT/'index.html')
