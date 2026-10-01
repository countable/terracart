/* Live design report: definitions, appearance and rewards are owned by the game. */
const cr = id => document.getElementById(id);
const crEsc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const crTick = () => new Promise(resolve => setTimeout(resolve, 0));
const crSpecial = look => look.macro ? `Service: ${look.macro.kind}` : look.stand ? 'Market stand' : look.barrel ? `${look.barrelName} loot` : look.coin ? 'Daily coins' : look.bike ? 'Daily speed boost' : 'Chest loot';
let crRows = [], crCityData = null;
function crSources() {
  const theme = cr('theme').value;
  cr('sources').innerHTML = crRows.filter(row => theme === 'all' || row.theme === theme).map(row => `<tr><td>${crEsc(row.cls)}</td><td>${crEsc(row.theme)}</td><td>${crEsc(row.look.texKey)}</td><td>${crEsc(crSpecial(row.look))}${row.tier ? ` · T${row.tier}` : ""}</td><td>${row.cls in POI_CATEGORY ? (chestMirrorsUnderground(row.cls) ? "Yes · ordinary cave chest" : "No") : "Scenic surface placement"}</td></tr>`).join('');
}
async function crArt() {
  const keys = new Set(['chest', 'box']);
  for (const row of crRows) keys.add(row.look.texKey);
  for (const row of BARREL_ART) { keys.add(row.texKey); keys.add(row.smashedKey); }
  keys.add('vista_scope');
  keys.add(chestLook({kind:'chest',poiClass:'bus',poiDensity:5,banditStop:true}).texKey);
  for (const key of keys) {
    const asset = ASSETS[key]; if (!asset?.path) continue;
    const img = new Image(); img.src = '../' + asset.path;
    await img.decode();
    const source = key === 'chest' ? makeChestTierSheet(img) : key === 'box' ? makeMutedTierOne(img) : img;
    const w = asset.frameWidth || img.width, h = asset.frameHeight || img.height;
    const frames = key === 'chest' ? Array.from({length:CHEST_TIER_MAX},(_,i)=>i) : [0];
    for (const frame of frames) {
      const label = key === 'chest' ? `Chest T${frame+1}` : key;
      const figure = document.createElement('figure');
      figure.innerHTML = `<div class="stage"></div><figcaption>${crEsc(label)}${key === 'chest' ? ' · ' + tierBadgeHTML(frame + 1) : ''}<br><small>${w} × ${h}</small></figcaption>`;
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const scale = Math.min(4, 150 / w, 140 / h);
      canvas.style.width = w * scale + 'px'; canvas.style.height = h * scale + 'px';
      canvas.setAttribute('role','img'); canvas.setAttribute('aria-label',label);
      canvas.getContext('2d').drawImage(source,frame*w,0,w,h,0,0,w,h);
      figure.firstChild.append(canvas); cr('art').append(figure);
    }
  }
}
const crRollCache = new Map();
function crRolls(theme, tier, depth = 0) {
  const key = theme + ':' + tier + ':' + depth; if (crRollCache.has(key)) return crRollCache.get(key);
  const rng = makeRng32(fnv1a(key)), items = new Map(); let coins = 0;
  for (let i=0;i<2000;i++) {
    const r = pickReward('chest:'+theme,{relics:{},armor:{}},rng,{tier,depth});
    if (!r) continue;
    coins += (r.consolation || 0) + (r.kind === 'gold' ? r.amount : 0);
    if (r.kind === 'gold') continue;
    const name = r.id ? ITEM_BY_ID[r.id]?.name || r.id : `${r.kind} ${r.slot} T${r.tier}`;
    const item = items.get(name) || {name,count:0,qty:0}; item.count++; item.qty += r.qty || 1; items.set(name,item);
  }
  const result = {coins:coins/2000,items:[...items.values()].sort((a,b)=>b.count-a.count)};
  crRollCache.set(key,result); return result;
}
async function crRewards() {
  cr('rewards').innerHTML = '';
  const selected = cr('theme').value;
  for (const theme of Object.keys(ChestThemes.themes).filter(t=>selected==='all'||t===selected)) {
    const section=document.createElement('details');section.open=selected!=='all';
    section.innerHTML=`<summary>${crEsc(theme)}</summary>`;
    let rows='';
    for(let tier=1;tier<=CHEST_TIER_MAX;tier++) {
      const r=crRolls(theme,tier,Number(cr('depth').value));
      rows+=`<tr><th>T${tier}</th><td>${r.coins.toFixed(2)}</td><td>${r.items.map(i=>`${crEsc(i.name)}: ${(i.count/20).toFixed(1)}% · ${(i.qty/2000).toFixed(2)} mean`).join('<br>')}</td></tr>`;
    }
    section.innerHTML+=`<div class="scroll"><table><thead><tr><th>Tier</th><th>Mean coins</th><th>Items: chance · mean quantity</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    cr('rewards').append(section);await crTick();
  }
}
function crCitiesRender() {
  cr('city-results').innerHTML=Object.values(crCityData).map(city=>{
    const groups=new Map();
    for(const o of city.chests){const key=o.theme+':'+o.tier;const g=groups.get(key)||{theme:o.theme,tier:o.tier,n:0,near:0,pois:{}};g.n++;g.near+=!!o.near;g.pois[o.poiClass||'generated']=(g.pois[o.poiClass||'generated']||0)+1;groups.set(key,g);}
    const rows=[...groups.values()].sort((a,b)=>a.tier-b.tier||a.theme.localeCompare(b.theme)).map(g=>`<tr><td>T${g.tier}</td><td>${crEsc(g.theme)}</td><td>${g.n}</td><td>${g.near}</td><td>${(crRolls(g.theme,g.tier).coins*g.n).toFixed(1)}</td><td>${Object.entries(g.pois).map(([k,n])=>`${crEsc(k)}: ${n}`).join(', ')}</td></tr>`).join('');
    return `<h3>${crEsc(city.name)}</h3><p>${city.tiles.filter(t=>t.source && !t.error).length}/9 tiles loaded.</p>${city.errors.length?`<p class="notice">Incomplete: ${city.errors.map(crEsc).join('; ')}</p>`:''}<p>Excluded from chest rolls: ${Object.entries(city.excluded).map(([k,n])=>`${crEsc(k)}: ${n}`).join(', ')||'none'}.</p><div class="scroll"><table><thead><tr><th>Tier</th><th>Theme</th><th>Chests</th><th>≤400 m</th><th>Expected coins</th><th>POI sources</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');
}
async function crBuildCities() {
  cr('cities').disabled=true;
  try {crCityData=await loadChestReportCities(p=>cr('status').textContent=p.message);crCitiesRender();cr('status').textContent='Ready · current game definitions and rebuilt city fixtures';}
  catch(e){cr('status').textContent='City report failed: '+e.message;}
  finally{cr('cities').disabled=false;}
}
(async()=>{
  try {
    await loadGame();
    for(const cls of Object.keys(POI_CATEGORY).sort()){const o={kind:'chest',id:'report:'+cls,poiClass:cls,poiDensity:5,depth:0};crRows.push({cls,theme:chestThemeFor(o),look:chestLook(o)});}
    for (const [vista,tier] of Object.entries(Scenic.VISTA_CHEST_TIER)) { const o={kind:'chest',id:'report:vista:'+vista,poiClass:Scenic.VISTA_POI_CLASS,vista,depth:0};crRows.push({cls:'Scenic '+vista,theme:chestThemeFor(o),look:chestLook(o),tier:chestTier(o)}); }
    for(const theme of Object.keys(ChestThemes.themes)){const option=document.createElement('option');option.value=theme;option.textContent=theme;cr('theme').append(option);}
    cr('tiers').textContent='Base tiers by POIs of the same class on one tile: '+CHEST_DENSITY_TIERS.map(r=>`${r.atLeast}+ → T${r.tier}`).join('; ')+`. Nexus bonus: +${ZONE_NEXUS_TIER_BONUS}. Cave bonus: +1 per ${CHEST_TIER_DEPTH_STEP} levels. Theme and tier are independent.`;
    const gift = LOOT_CONTEXTS[Scenic.VISTA_CONTEXT];
    const giftTotal = Object.values(gift.classBias).reduce((a,b)=>a+b,0);
    cr('scope').textContent = `Viewpoint scope: the telescope beside a vista, a resting spot with one gift per UTC day: ${Object.entries(gift.classBias).map(([k,w])=>`${k} ${(100*w/giftTotal).toFixed(0)}%`).join(', ')} (up to T${gift.maxTier}). Your first vista also offers a ${Scenic.FIRST_VISTA_SLOT} relic upgrade. The grail chest is a separate one-time reward.`;
    crSources();await crArt();await crRewards();
    cr('theme').onchange=async()=>{crSources();cr('theme').disabled=true;try{await crRewards();}finally{cr('theme').disabled=false;}};
    cr('depth').onchange=async()=>{cr('depth').disabled=true;try{await crRewards();}finally{cr('depth').disabled=false;}};
    cr('cities').onclick=crBuildCities;await crBuildCities();
  }catch(e){cr('status').textContent='Report failed: '+e.message;console.error(e);}
})();
