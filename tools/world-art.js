/* global loadGame, ASSETS, SpriteLayout, Render, ZoneVariantData, Zones, WorldGen,
          CROP_ROW, CROP_SPRITE, CROP_NAMES, wildplantSprite, wildplantFrame,
          MAX_GROWTH_STAGE, SPRING_CROPS_COLS, CROPS_SHEET_COLS, BIOME_TEX, COLORS,
          drawBiomeTexture, drawTilledTex, seededRand, RoadOverlay, BuildingOverlay,
          makeTowerTexture, makePotOfGoldTexture, makeTrapTextures */
'use strict';
(async () => {
  const $ = id => document.getElementById(id);
  const title = text => String(text).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canvas = (w, h = w) => Object.assign(document.createElement('canvas'), {width:w, height:h});
  try {
    await loadGame();
    const manifests={};
    for(const [key,file] of Object.entries({zone_objects:'ZoneVariants',stronghold_wall:'Stronghold',zone_hedge:'Hedges'})) {
      const response=await fetch(`../assets/Objects/${file}/manifest.json`,{cache:'no-store'});
      if(!response.ok)throw new Error('Could not load '+key+' frame names');
      manifests[key]=await response.json();
    }
    const caveResponse=await fetch('../assets/Objects/Cave/manifest.json',{cache:'no-store'});
    if(!caveResponse.ok)throw new Error('Could not load approved cave art names');
    const approvedSheets=(await caveResponse.json()).sheets;
    const rockResponse = await fetch('../assets/Objects/ZoneVariants/approved-additions.json', {cache:'no-store'});
    if (!rockResponse.ok) throw new Error('Could not load zone rock frame names');
    const rockAdditions = await rockResponse.json();
    manifests.zone_objects.frames.push(...rockAdditions.frames.map(f => ({...f, name: 'rock_' + f.zone})));
    // A small Phaser texture adapter runs the assets' real post-load callbacks,
    // including transparent crop backgrounds and manually registered house frames.
    const textures = new Map();
    function add(key, source, spec) {
      const frames = new Map();
      const texture = {getSourceImage:()=>source, getContext:()=>source.getContext('2d'), refresh(){},
        add(name, index, x, y, width, height){frames.set(String(name),{x,y,width,height});},
        remove(name){return frames.delete(String(name));},
        get(name){return frames.get(String(name ?? '__BASE')) || frames.get('0') || frames.get('__BASE');}};
      texture.add('__BASE',0,0,0,source.width,source.height);
      if(spec){let i=0;for(let y=0;y+spec.frameHeight<=source.height;y+=spec.frameHeight)for(let x=0;x+spec.frameWidth<=source.width;x+=spec.frameWidth)texture.add(i++,0,x,y,spec.frameWidth,spec.frameHeight);}
      textures.set(key,texture);return texture;
    }
    const store = {exists:key=>textures.has(key),get:key=>textures.get(key),remove:key=>textures.delete(key),
      addImage:(key,source)=>add(key,source),addSpriteSheet:add,addCanvas:(key,source)=>add(key,source),
      createCanvas:(key,w,h)=>add(key,canvas(w,h))};
    const scene = {save:{},textures:store,cellM:WorldGen.CELL_M};
    const roles = new WeakMap();
    const render = Render.objectAppearance(scene,roles);
    const wanted = new Map(), failures=[];
    function want(key, frame=0){if(!key)return;if(!wanted.has(key))wanted.set(key,new Set());wanted.get(key).add(frame ?? 0);}
    // Approved world art is catalogued before its placement mechanics are wired.
    for(const [key,sheet] of Object.entries(approvedSheets))for(const entry of sheet.entries)for(const frame of entry.frames)want(key,frame);
    // Resolve the live object registry rather than browsing every loaded sheet.
    // Variants have stable example identities, so frame selection is repeatable.
    const probeStore = {...store,exists:()=>true,get:key=>store.get(key)||{get:()=>({width:80,height:80})}};
    const probe = Render.objectAppearance({...scene,textures:probeStore},roles);
    for(const kind of Object.keys(render.RENDER_SPEC)) {
      if(kind==='zone_prop')continue; // Only authored, selected prop frames belong in this catalog.
      const o={kind,id:'world-art:'+kind,x:0,y:0,tier:1,yieldTier:1,requiredTier:1,variant:3,stage:4,size:'large',species:'maple'};
      if(kind==='house')roles.set(o,'plain');
      try {const p=probe.resolveAppearance(o);if(p?.texKey)want(p.texKey,p.frameVal);}catch(error){console.warn('World art sample:',kind,error.message);}
    }
    // Trimmed bounds enumerate current placed sprite frames, not raw atlas cells.
    for(const key of Object.keys(SpriteLayout.ART_BOUNDS)) {
      const split=key.lastIndexOf(':'),sheet=key.slice(0,split),frame=key.slice(split+1);
      if(ASSETS[sheet] && !SpriteLayout.creatureArt(sheet))want(sheet,Number.isNaN(Number(frame))?frame:Number(frame));
    }
    for(const [key,asset] of Object.entries(ASSETS))if(/^(house_|macro_)/.test(key))want(key,asset.kind==='image'?'__BASE':0);
    for (const pile of Render.COIN_PILES) want(pile.texture);
    const crops = [...new Set([...Object.keys(CROP_ROW),...Object.keys(CROP_SPRITE)])];
    function plantArt(plant){const s=wildplantSprite(plant);return {key:s?.sheet||'crops',frame:s?.custom?wildplantFrame(plant):s?.sheet==='springcrops'?s.row*SPRING_CROPS_COLS+MAX_GROWTH_STAGE:(CROP_ROW[plant.crop]??1)*CROPS_SHEET_COLS+MAX_GROWTH_STAGE};}
    const plantRows=[];
    for(const crop of crops){const plant={crop,stage:MAX_GROWTH_STAGE,id:'world-art:'+crop},p=plantArt(plant);want(p.key,p.frame);plantRows.push({id:'plant:'+crop,name:CROP_NAMES[crop]||title(crop),key:p.key,frames:[p.frame],category:'Plants & crops',zoneVariants:new Set(),source:'src/items.js'});}
    const usage = new Map();
    function use(key,zoneVariant,frame){for(const identity of [key,`${key}:${frame}`]){if(!usage.has(identity))usage.set(identity,new Set());usage.get(identity).add(zoneVariant);}}
    // Include finite decorations and reef finds as well as the repeating layout.
    function mentions(value,id){if(value===id)return true;if(!value||typeof value!=='object')return false;return Object.entries(value).some(([k,v])=>k===id||mentions(v,id));}
    for(const zoneVariant of ZoneVariantData.variants)for(const [id,material] of Object.entries(ZoneVariantData.materials)) {
      if(!mentions([zoneVariant.background,zoneVariant.poi,zoneVariant.connection,zoneVariant.finds,zoneVariant.decorations,zoneVariant.reef?.landOre,zoneVariant.materialFrames],id))continue;
      for(const overrideFrame of zoneVariant.materialFrames?.[id]||[material._zoneObjectFrame]) {
      const o={...material,id:'world-art:'+id,x:0,y:0,variant:3,stage:4,look:zoneVariant.materialLooks?.[id],_plantArt:zoneVariant.materialLooks?.[id]};
      if(Number.isInteger(overrideFrame))o._zoneObjectFrame=overrideFrame;
      if(o.crop==='shrub'&&['formal_garden','hedge_garden'].includes(zoneVariant.id))o._plantArt='zone_hedge_single';
      if(typeof o.rockVariant==='string')o.rockVariant=SpriteLayout[o.rockVariant];
      if(o.kind==='wildplant') {
        const p=plantArt(o);want(p.key,p.frame);use(p.key,zoneVariant.id,p.frame);
        if(p.key==='zone_objects')continue; // Keep the atlas frame's existing reference identity.
        const row=plantRows.find(r=>r.id==='plant:'+o.crop&&r.key===p.key);
        if(row)row.zoneVariants.add(zoneVariant.id);
        else {const key='look:'+p.key;let look=plantRows.find(r=>r.id===key);if(!look){look={id:key,name:title(zoneVariant.materialLooks?.[id]||id),key:p.key,frames:[p.frame],category:'Plants & crops',zoneVariants:new Set(),source:'src/items.js'};plantRows.push(look);}look.zoneVariants.add(zoneVariant.id);}
      } else {try{const p=probe.resolveAppearance(o);if(p?.texKey){want(p.texKey,p.frameVal);use(p.texKey,zoneVariant.id,p.frameVal);}}catch(error){console.warn('World art material:',id,error.message);}}
      }
    }
    wanted.delete('reef_coral'); // Bounds also retain retired coral frames; use the current generation choices.
    for(const zoneVariant of ZoneVariantData.variants) {
      if(Number.isInteger(zoneVariant.shrineFrame)){want('zone_objects',zoneVariant.shrineFrame);use('zone_objects',zoneVariant.id,zoneVariant.shrineFrame);}
      for(const frame of zoneVariant.reef?.coralFrames||[]){want('reef_coral',frame);use('reef_coral',zoneVariant.id,frame);}
      const connected=zoneVariant.quarryLayout==='stronghold'?'stronghold_wall':['formal_garden','hedge_garden'].includes(zoneVariant.id)?'zone_hedge':null;
      if(connected)for(const frame of manifests[connected].frames){want(connected,frame.frame);use(connected,zoneVariant.id,frame.frame);}
    }
    want('castle_tower_shapes');
    const gemDeposits = Object.values(GEM_DEPOSITS);
    for (const deposit of gemDeposits) {
      want(deposit.art.sheet, deposit.art.frame);
      const icon = MINERAL_ICON_SHEET[deposit.item];
      want(icon.sheet, icon.frame);
    }
    // Decode selected world textures and matching inventory icons for deposits.
    await Promise.all([...wanted.keys()].map(async key=>{
      const iconSheet=ICON_SHEETS[key];
      const asset=ASSETS[key] || (iconSheet && {path:iconSheet.url,kind:'spritesheet',
        frameWidth:iconSheet.srcW/iconSheet.cols,frameHeight:iconSheet.srcW/iconSheet.cols});if(!asset)return;
      try{const img=new Image();img.src='../'+asset.path;await img.decode();add(key,img,asset.kind==='spritesheet'?asset:null);asset.onLoad?.(scene);}catch(error){failures.push(key);console.warn('World art asset:',key,error);}
    }));
    makeTowerTexture(scene);makePotOfGoldTexture(scene);makeTrapTextures(scene);
    function image(key,frame){const t=textures.get(key),f=t?.get(frame);if(!f)return null;const c=canvas(f.width,f.height);c.getContext('2d').drawImage(t.getSourceImage(),f.x,f.y,f.width,f.height,0,0,f.width,f.height);return c.toDataURL();}
    // Like export_map_art_painters.js, expose the live private polygon painter
    // in a viewer-only namespace without changing the game's public API.
    const buildingResponse=await fetch('../src/building_overlay.js',{cache:'no-store'});
    if(!buildingResponse.ok)throw new Error('Could not load the building painter');
    const buildingSource=await buildingResponse.text();
    const buildingHook='global.BuildingOverlay = {';
    if(!buildingSource.includes(buildingHook))throw new Error('Building painter export changed');
    const buildingScript=document.createElement('script');
    buildingScript.textContent=buildingSource.replace(buildingHook,'global.WorldArtBuildings = { rebuild,');
    document.head.append(buildingScript);
    const rows=[];
    for(const row of plantRows)rows.push({...row,images:row.frames.map(frame=>image(row.key,frame)).filter(Boolean)});
    const plantFrames=new Set(plantRows.flatMap(r=>r.frames.map(f=>`${r.key}:${f}`)));
    function category(key){return /house|tower|macro_|market_stand|shrine|well/.test(key)?'Buildings & landmarks':/tree|bush|mushroom/.test(key)?'Trees & foliage':/rock|ore/.test(key)?'Stone & minerals':/trap|tar/.test(key)?'Hazards':'Objects & props';}
    for(const [key,wantedFrames] of wanted) {
      if(key==='gems')continue; // Inventory icons accompany their world deposits below.
      if(approvedSheets[key]) {
        for(const entry of approvedSheets[key].entries)rows.push({
          ...entry,id:`${key}:${entry.id}`,key,approved:true,
          images:entry.frames.map(frame=>image(key,frame)).filter(Boolean),
          zoneVariants:new Set(entry.zones||[]),source:ASSETS[key]?.path
        });
        continue;
      }
      const frames=[...wantedFrames].filter(frame=>!plantFrames.has(`${key}:${frame}`));
      if(!frames.length)continue;
      const groups=manifests[key]||key==='reef_coral'?frames.map(frame=>[frame]):[frames];
      for(const group of groups) {
        const individual=groups.length>1||!!manifests[key], frame=group[0];
        const frameName=manifests[key]?.frames.find(f=>f.frame===frame)?.name;
        rows.push({id:individual?`${key}:${frame}`:key,name:(key==='stronghold_wall'?'Stronghold wall · ':key==='zone_hedge'?'Hedge · ':'')+title(frameName||(key==='cobble'?'broken_lamp_post':key.replace(/^approved_/,'')))+(individual&&!frameName?' '+frame:''),key,frames:group,
          images:group.map(frame=>image(key,frame)).filter(Boolean),category:category(key),zoneVariants:usage.get(individual?`${key}:${frame}`:key)||new Set(),source:ASSETS[key]?.path||'src/textures.js'});
      }
    }
    const gemUses = {
      quartz: 'Mining and value exchange only; no crafting recipe or direct action.',
      topaz: 'Mining and value exchange only; no crafting recipe or direct action.',
      amethyst: 'Mining and value exchange only; no crafting recipe or direct action.',
      sapphire: 'Opens a portal one level down with a one-minute return window; can also tame a slime. Can be exchanged by value.',
      ruby: 'Mining and value exchange only; no crafting recipe or direct action.',
      emerald: 'Used to forge T2–T6 staffs: 1, 2, 4, 8 or 16 emeralds plus one tier-matched bar. Can be exchanged by value.',
      diamond: 'Used to forge a T7 staff: 32 diamonds plus one frost bar. Can be exchanged by value.',
    };
    for (const deposit of gemDeposits) {
      const row = rows.find(r => r.key === deposit.art.sheet && r.frames.includes(deposit.art.frame));
      if (!row) throw new Error('Missing gem deposit catalog row: ' + deposit.item);
      const icon = MINERAL_ICON_SHEET[deposit.item];
      Object.assign(row, {name: itemName(deposit.item) + ' deposit', category: 'Stone & minerals',
        gem: deposit.item, deposit, inventoryImage: image(icon.sheet, icon.frame),
        inventorySource: `${icon.sheet}:${icon.frame}`, currentUse: gemUses[deposit.item], value: itemValue(deposit.item)});
      if (deposit.yieldTier <= 4) {
        row.approved = false;
        row.zoneVariants = new Set(ZoneVariantData.variants.filter(z => z.zone === 'quarry').map(z => z.id));
      }
    }
    function painted(id,name,category,painter,zoneVariants=[]){const c=canvas(96);painter(c);rows.push({id,name,category,zoneVariants:new Set(zoneVariants),images:[c.toDataURL()],source:'Current game painter',frames:[]});}
    const terrainNames=Object.fromEntries(Object.entries(WorldGen.T).map(([k,v])=>[v,title(k)]));
    for(const id of Object.keys(BIOME_TEX)) {
      const zoneVariants=ZoneVariantData.variants.filter(z=>WorldGen.T[Zones.ZONE_KINDS[z.zone]?.terrain]===Number(id)).map(z=>z.id);
      painted('ground:'+id,terrainNames[id]||'Terrain '+id,'Ground',c=>{c.width=c.height=32;const cx=c.getContext('2d');cx.fillStyle='#'+(COLORS[id]??0x596338).toString(16).padStart(6,'0');cx.fillRect(0,0,32,32);const layer=canvas(32);drawBiomeTexture(layer.getContext('2d'),32,id,0,0);cx.drawImage(layer,0,0);},zoneVariants);
    }
    painted('tilled','Tilled soil','Ground',c=>{c.width=c.height=32;drawTilledTex(c.getContext('2d'),32,seededRand(7919));});
    for(const path of [false,true])for(const restored of [false,true])painted(`road:${path}:${restored}`,`${path?'Path':'Road'} · ${restored?'restored':'weathered'}`,'Roads & lighting',c=>RoadOverlay.paintPavementTile(c.getContext('2d'),96,path,restored,0));
    painted('lamp','Street lamp','Roads & lighting',c=>{c.width=c.height=RoadOverlay.LAMP_TEX_PX;RoadOverlay.paintLamp(c.getContext('2d'),c.width);});
    for(const tier of [9,10,11])for(const unclaimed of [false,true]) {
      painted(`building:${tier}:${unclaimed}`,`${terrainNames[tier]||'Building'} · ${unclaimed?'unclaimed':'claimed'}`,'Buildings & landmarks',c=>{
        const key=`biome${tier}_0`;const tile=store.createCanvas(key,32,32);BIOME_TEX[tier].draw(tile.getContext(),32,seededRand((tier+1)*1000+1));
        const sample={...scene,viewSize:128,viewLeft:0,viewTop:0,viewCenterX:0,viewCenterY:0,startWorldM:{x:0,y:0},playerM:{x:0,y:0},cellM:32,buildingGeomContainer:{add(){}},add:{image(){return {setOrigin(){return this;}};}},isClaimedKey:()=>!unclaimed};
        const ring=new Float32Array([8,8,104,8,104,72,72,72,72,104,8,104]);
        window.WorldArtBuildings.rebuild(sample,[{tx:0,ty:0,entry:{tileEdgeM:256,buildingShapes:[{ring,tier,key:'world-art'}]}}],0,0);
        c.width=c.height=128;c.getContext('2d').drawImage(store.get('buildinggeom_overlay').getSourceImage(),64,64,128,128,0,0,128,128);
      });
    }
    const names=new Map(ZoneVariantData.variants.map(z=>[z.id,z.name]));
    for(const row of rows)for(const zone of row.zoneVariants)if(!names.has(zone))names.set(zone,title(zone));
    for(const [id,name] of [...names].sort((a,b)=>a[1].localeCompare(b[1])))$('zone').add(new Option(name,id));
    for(const cat of [...new Set(rows.map(r=>r.category))].sort())$('category').add(new Option(cat,cat));
    // Numbers belong to catalog identities, not positions in the displayed list.
    // Keep removed entries in the checked-in registry so numbers are never reused.
    const idResponse=await fetch('world-art-ids.json',{cache:'no-store'});
    if(!idResponse.ok)throw new Error('Could not load world art reference numbers');
    const idRegistry=await idResponse.json();
    const usedNumbers=new Set();
    for(const row of rows) {
      row.reference=idRegistry.entries[row.id] ?? null;
      if(row.reference!=null && (!Number.isSafeInteger(row.reference)||row.reference<1||usedNumbers.has(row.reference)))throw new Error('Invalid world art reference number');
      if(row.reference!=null)usedNumbers.add(row.reference);
      row.referenceLabel=row.reference==null?'Unassigned':`WA-${String(row.reference).padStart(3,'0')}`;
    }
    const unnumbered=rows.filter(row=>row.reference==null);
    let selected=null,descending=false;
    const zoneVariantsText=row=>(row.approved?'Approved for placement: ':'')+([...row.zoneVariants].map(id=>names.get(id)||title(id)).sort().join(', ')||'Shared / other world use');
    const sandboxZoneKind = id => ZoneVariantData.variants.find(z=>z.id===id)?.zone || id;
    const art=(row,limit)=>row.images.slice(0,limit).map((src,i)=>`<img class="sprite" src="${src}" alt="${esc(row.name+(row.stateLabels?.[i]?' · '+row.stateLabels[i]:''))}" title="${esc(row.stateLabels?.[i]||row.name)}" loading="lazy">`).join('')||'<small>Preview unavailable</small>';
    function renderTable(){
      const words=$('search').value.trim().toLowerCase().split(/\s+/).filter(Boolean),zoneVariant=$('zone').value,cat=$('category').value,sort=$('sort').value;
      const visible=rows.filter(r=>(!cat||r.category===cat)&&(!zoneVariant||(zoneVariant==='shared'?!r.zoneVariants.size:r.zoneVariants.has(zoneVariant)))&&words.every(w=>[r.referenceLabel,r.reference==null?'':`#${r.reference} ${r.reference}`,r.name,r.key,r.frames.join(' '),r.category,r.gem,r.currentUse,zoneVariantsText(r)].join(' ').toLowerCase().includes(w)));
      const value=r=>sort==='zone'?zoneVariantsText(r):r[sort];visible.sort((a,b)=>((sort==='reference'?(a.reference??Infinity)-(b.reference??Infinity):String(value(a)).localeCompare(String(value(b))))||a.name.localeCompare(b.name))*(descending?-1:1));
      if(!visible.some(r=>r.id===selected))selected=visible[0]?.id;
      $('sandbox-zone').innerHTML=zoneVariant && zoneVariant !== 'shared' ? SandboxLinks.link(sandboxZoneKind(zoneVariant)) : '';
      $('count').textContent=`${visible.length} of ${rows.length} artwork entries`;
      $('rows').innerHTML=visible.map(r=>`<tr data-id="${esc(r.id)}" class="${r.id===selected?'selected':''}"><td><strong>${esc(r.referenceLabel)}</strong></td><td><div class="preview">${art(r,3)}</div>${r.images.length>3?`<small>+${r.images.length-3} more frames</small>`:''}</td><td><button class="pickaxe" data-pick="${esc(r.id)}">${esc(r.name)}</button>${r.key?`<br><small>Texture: ${esc(r.key)}<br>Frames: ${esc(r.frames.join(', '))}</small>`:'<br><small>Painted: '+esc(r.id)+'</small>'}</td><td>${esc(r.category)}${r.gem?`<br><small>T${r.deposit.yieldTier} · ${r.value} coin value</small><div class="gem-icon"><img class="sprite" src="${r.inventoryImage}" alt="${esc(itemName(r.gem))} inventory icon"><small>${esc(itemName(r.gem))}</small></div>`:''}</td><td>${esc(zoneVariantsText(r))}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No art matches these filters.</td></tr>';
      $('rows').querySelectorAll('[data-id]').forEach(tr=>tr.addEventListener('click',()=>{selected=tr.dataset.id;renderTable();}));
      document.querySelectorAll('[data-sort]').forEach(button=>{
        const active=button.dataset.sort===sort;
        button.parentElement.setAttribute('aria-sort',active?(descending?'descending':'ascending'):'none');
        button.textContent=`${title(button.dataset.sort)} ${active?(descending?'▼':'▲'):'↕'}`;
      });
      const row=rows.find(r=>r.id===selected);
      $('detail').innerHTML=row?`<h2>${esc(row.referenceLabel)} · ${esc(row.name)}</h2><p><span class="tag">${esc(row.category)}</span></p><div class="preview">${art(row,Infinity)}</div>${row.stateLabels?'<p><small>Frames, left to right: '+esc(row.stateLabels.join(', '))+'</small></p>':''}<h3>Zone use</h3><p>${esc(zoneVariantsText(row))}</p><small>${row.gem?(row.deposit.yieldTier<=4?'Assigned to quarry regions on the surface and at depth 1; mining yields the pictured gem.':'Mining yields the pictured gem when placed. Underground zone placement is being designed.'):row.approved?'Approved art; placement and interactions are not yet enabled.':row.zoneVariants.size?'Declared material use in the current zone layouts. Other world placement rules may also use this art.':'Used by the shared world renderer; no specific material membership in the named zone layouts.'}</small><h3>Current source</h3><code>${esc(row.source)}</code>${row.key?`<p><small>Texture: ${esc(row.key)}<br>Frames: ${esc(row.frames.join(', '))}</small></p>`:''}`:'<h2>No selection</h2><p>Broaden your filters to inspect artwork.</p>';
      if(row?.gem)$('detail').insertAdjacentHTML('beforeend', `<h3>Mining reward</h3><div class="gem-icon"><img class="sprite" src="${row.inventoryImage}" alt="${esc(itemName(row.gem))} inventory icon"><p>${row.deposit.quantity} × ${esc(itemName(row.gem))}<br><small>Inventory icon: ${esc(row.inventorySource)}</small></p></div><p>T${row.deposit.yieldTier} gem · requires a T${row.deposit.requiredTier}+ pickaxe · ${row.value} coin base value.</p><h3>Current uses</h3><p>${esc(row.currentUse)}</p>`);
      if(row&&!row.approved){const keys=[...new Set([...row.zoneVariants].map(sandboxZoneKind))];$('detail').insertAdjacentHTML('beforeend', `<p>${keys.map(key=>SandboxLinks.link(key)).filter(Boolean).join('<br>')}</p>`);}
    }
    for(const id of ['search','zone','category'])$(id).addEventListener('input',renderTable);
    $('sort').addEventListener('change',()=>{descending=false;renderTable();});
    document.querySelectorAll('[data-sort]').forEach(b=>b.addEventListener('click',()=>{descending=$('sort').value===b.dataset.sort?!descending:false;$('sort').value=b.dataset.sort;renderTable();}));
    $('reset').addEventListener('click',()=>{for(const id of ['search','zone','category'])$(id).value='';$('sort').value='name';descending=false;renderTable();});
    renderTable();$('status').textContent=`${rows.length} entries loaded from game definitions and approved art manifests.${failures.length?' Missing textures: '+failures.join(', '):''}${unnumbered.length?' '+unnumbered.length+' new entries await a reference number.':''}`;
    window.worldArt={rows,failures};document.documentElement.dataset.worldArtReady='true';
  } catch(error) {$('status').textContent='Could not load world art: '+error.message;$('status').className='error';document.documentElement.dataset.worldArtError=error.message;console.error(error);}
})();
