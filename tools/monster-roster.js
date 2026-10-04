/* global loadGame, Lairs, EnemyRoster, EnemySpawns, EnemyHabitats, ZoneVariantData, Combat,
          SpriteLayout, ASSETS, recolorEnemyPixels, MATERIAL_TIERS,
          ANIMAL_FOOD, ITEM_BY_ID, SPIRIT_RAVEN_MS, shortDuration */
'use strict';
(async () => {
  try {
    await loadGame();
    const $=id=>document.getElementById(id);
    const tiers=['Bare / none',...MATERIAL_TIERS.map(t=>t.name)];
    const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fmt=n=>Number.isInteger(n)?String(n):n.toFixed(1);
    let selected=null;
    // Aliases adapt the proposal's presentation to the runtime schema. Never copy stats.
    const enemies=EnemyRoster.ROWS.filter(e=>!e.retired).map(e=>({...e,
      name:e.id==='gull'?'Seagull':e.name,
      attack:e.attackType,attackSeconds:e.damageIntervalSeconds,
      surface:e.surface&&{...e.surface,minHomeM:e.surface.minDistance,maxHomeM:e.surface.maxDistance},
      cave:e.cave&&{...e.cave,every:e.cave.depthRule==='even'?2:null},
    }));
    // Roles beyond the monster roster. The game has no single pest predicate,
    // so each pest line names the rule it describes; every other role is read
    // from CREATURE_BEHAVIOUR, ANIMAL_FOOD and the roster's summon abilities.
    const B=SpriteLayout.CREATURE_BEHAVIOUR;
    const PESTS={
      slime:'Surface pest: drifts at you and leeches energy. Kept away from Home until the first harvest (pest amnesty).',
      crow:'Hard mode dispatches pest crows at planted fields. Scarecrows turn them back; a wild crow is game, not a pest.',
    };
    for(const [id,row] of Object.entries(B))if(row.raidsCrops&&!PESTS[id])PESTS[id]=`Raids planted crops${row.avoids?.includes('scarecrow')?'; scarecrows turn it back':''}.${row.fightsBack?' Fights back when hunted.':''}`;
    const summoners={};
    for(const e of enemies)if(e.ability?.type==='summon')(summoners[e.ability.kind]??=[]).push(e.name);
    const ROLES=[['all','All combatants'],['monster','Monsters'],['pest','Pests'],['summon','Summons'],['pet','Pets'],['mercenary','Mercenaries']];
    const isCatchable=id=>!!B[id]?.wanders&&id!=='npc'&&!B[id].game&&!B[id].summoned&&!Combat.isEnemyKind(id);
    function rolesFor(id,monster){
      const r=[];if(monster)r.push('monster');if(PESTS[id])r.push('pest');
      if(B[id]?.summoned||summoners[id])r.push('summon');
      if(ANIMAL_FOOD[id]||isCatchable(id))r.push('pet');
      return r;
    }
    for(const e of enemies)e.roles=rolesFor(e.id,true);
    const titleCase=id=>id.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
    const rosterIds=new Set(EnemyRoster.ROWS.map(r=>r.id));
    const extras=Object.keys(B).filter(id=>!rosterIds.has(id)&&SpriteLayout.creatureArt(id)).map(id=>({id,name:titleCase(id),extra:true,tier:0,armor:0,hp:id in Combat.FAUNA_HP?Combat.creatureMaxHp(id):null,roles:rolesFor(id,false),behaviour:B[id]})).filter(x=>x.roles.length);
    const DATA={ghostScaling:EnemyRoster.GHOST_SCALING,rules:[
      'Loaded from the current game roster, combat helpers, sprite layouts and habitat tables. Retired rows are excluded.',
      'General spawn ranges and named habitat memberships are separate routes. Membership does not guarantee a spawn: terrain, home distance, depth and encounter rules still apply.',
      'Combat comparisons assume uninterrupted attacks, no class or training bonuses, no movement or regeneration, and sequential kills within a concurrent group. Kill time charges one full attack interval per hit. Group cost is an estimate, not a battle simulation.',
      'Ghost touch, traps and coin theft are special encounters and excluded from group energy estimates. Staff assumes one target per bolt and one energy per cast.',
      `Ordinary surface tier bands: ${EnemyRoster.SURFACE_TIERS.map(b=>`${b.minDistance}–${b.maxDistance??'∞'} m: T${Object.keys(b.tierWeights).join('/T')}`).join('; ')}.`,
    ]};
    const zoneName=id=>ZoneVariantData.variants.find(z=>z.id===id)?.name||id.replaceAll('_',' ');
    function habitatMemberships(e) {
      const memberships=table=>Object.entries(table).filter(([,kinds])=>kinds.includes(e.id)).map(([id])=>zoneName(id));
      return [['Zone encounters',memberships(EnemyHabitats.SURFACE_FAMILIES)],['Building habitats',memberships(EnemyHabitats.BUILDING_FAMILIES)],['Cave habitats',memberships(EnemyHabitats.FAMILIES)],['Zone guards',ZoneVariantData.variants.filter(z=>z.guards?.kind===e.id||z.guards?.choices?.includes(e.id)).map(z=>z.name)],['Street affinity',StreetVariants.STREET_VARIANTS.filter(row=>row.attracts?.[e.id]).map(row=>row.title||row.id)],['Authored garrisons',Object.values(Lairs.GROUPS).filter(group=>group.members.some(member=>member.kind===e.id)).map(group=>`${group.label}: ${group.story}`)]];
    }
    function hasSurface(e) { const m=habitatMemberships(e);return !!e.surface||m.some(([label,names])=>label!=='Cave habitats'&&names.length); }
    function hasCave(e) {return !!e.cave||e.id==='red_dragon'||habitatMemberships(e)[2][1].length>0;}
    function atDepth(e,depth) {
      if(e.attack==='touch')return depth>=Math.max(EnemyRoster.GHOST_SCALING.minCryptDepth,e.id==='pink_ghost'?e.cave.minDepth:0);
      if(e.id==='red_dragon')return depth>=e.cave.minDepth;
      const themes=EnemyHabitats.THEME_BANDS.find(b=>depth<=b.max)?.themes||[];
      const kinds=[...new Set(themes.flatMap(theme=>EnemyHabitats.FAMILIES[theme]||[]))];
      return EnemySpawns.caveRows(depth,{kinds}).some(row=>row.id===e.id);
    }
    const artFrames={}, images=new Map();
    async function imageFor(path) {
      if(!images.has(path))images.set(path,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error(`Could not load ${path}`));image.src='../'+path;}));
      return images.get(path);
    }
    for(const row of [...enemies,...extras]) {
      const art=SpriteLayout.creatureArt(row.id),asset=ASSETS[art.sheet];
      const image=await imageFor(asset.path),fw=asset.frameWidth||art.fw,fh=asset.frameHeight||art.fh;
      const canvas=document.createElement('canvas');canvas.width=fw;canvas.height=fh;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      const frame=SpriteLayout.creatureAppearance({kind:row.id,id:row.id,_facing:'down'},0).frame;
      const cols=image.naturalWidth/fw;
      ctx.drawImage(image,(frame%cols)*fw,Math.floor(frame/cols)*fh,fw,fh,0,0,fw,fh);
      const pixels=ctx.getImageData(0,0,fw,fh),palette=EnemyRoster.get(art.sheet)?.palette;
      if(palette)recolorEnemyPixels(pixels.data,palette);
      const tint=SpriteLayout.creatureTint(row.id),rgb=[(tint>>16)&255,(tint>>8)&255,tint&255];
      for(let i=0;i<pixels.data.length;i+=4)for(let ch=0;ch<3;ch++)pixels.data[i+ch]=Math.round(pixels.data[i+ch]*rgb[ch]/255);
      ctx.putImageData(pixels,0,0);
      artFrames[row.id]={width:fw,height:fh,original:canvas.toDataURL()};
    }
for(let t=0;t<tiers.length;t++){for(const id of (t===0?['armorTier']:['weaponTier','armorTier']))$(id).add(new Option(`T${t} · ${tiers[t]}`,t));if(t)$('tier').add(new Option(`T${t} · ${tiers[t]}`,t))}$('weaponTier').value='3';$('armorTier').value='3';
const biomes=[...new Set(enemies.flatMap(e=>e.surface?.biomes||[]))].sort();biomes.forEach(b=>$('biome').add(new Option(b,b)));
const base=enemies.filter(e=>!e.variantOf);
$('summary').innerHTML=[[base.length,'active base kinds'],[enemies.length-base.length,'active variants'],[enemies.filter(e=>hasSurface(e)).length,'surface or zone kinds'],[enemies.filter(e=>hasCave(e)).length,'cave or special kinds']].map(([n,label])=>`<div class="metric"><strong>${n}</strong>${label}</div>`).join('');
$('rules').innerHTML=DATA.rules.map(r=>`<p>${esc(r)}</p>`).join('');

function pool(){return $('pool').value!==''?Math.max(0,Number($('pool').value)):Number($('armorTier').value)*Number($('pieces').value)}
function stats(e){const elite=$('elite').value==='elite'&&e.eliteEligible;return {hp:Math.round(e.hp*(elite?Combat.ELITE_MUL:1)),dmg:e.dmg*(elite?Combat.ELITE_MUL:1),armor:e.armor,elite}}
function penalty(){return Combat.playerDamageMultiplier($('mode').value)}
function groupN(){return Math.max(1,Number($('groupSize').value)||($('mode').value==='hard'?3:5))}
function group(e,t,w,p=pool(),n=groupN()){if(e.attack==='none'||e.attack==='trap'||e.attack==='touch'||!!e.steals)return null;const f=fight(e,t,w),dps=attackDps(e,p)+auraDps(e,p)*Number($('auraExposure').value);return n*(n+1)/2*f.seconds*dps+(w==='staff'?n*f.hits*Combat.SHOT.staff.energyCost:0)}
function verdict(cost){if(cost==null)return 'Special';const ratio=cost/Math.max(1,Number($('energy').value)||100);return ratio<.75?'Player favoured':ratio<=1.15?'Roughly even':'Enemies favoured'}
function weapon(t,w){const interval=w==='sword'?Combat.MELEE_INTERVAL_MS/1000:Combat.fireIntervalMs(w)/1000;const relics={[w]:{tier:t}};const raw=w==='sword'?Combat.meleeSwingDamage(relics):Combat.shotDamage(relics,w);return {interval,raw}}
function fight(e,t,w){const s=stats(e),p=weapon(t,w),hit=Combat.mitigate(p.raw,s.armor),hits=Math.ceil(s.hp/hit);return {hit,hits,seconds:hits*p.interval}}
function incoming(e){if(e.steals)return {hit:null,label:'Coin theft'};if(e.attack==='trap')return {hit:null,label:'Trap hazard'};const s=stats(e),n=e.attackHits||1;const hit=n*Combat.mitigate(s.dmg,pool())*penalty();return {hit,label:`${fmt(hit)} / ${e.attack==='projectile'?'projectile':e.attack==='touch'?'touch':'hit'}`}}
function caveLabel(c){return !c?'—':`D${c.minDepth}${c.maxDepth==null?'+':c.maxDepth===c.minDepth?'':'–'+c.maxDepth}${c.every?' · every '+c.every+' levels':''}`}
function distanceLabel(s){return `${s.minHomeM}–${s.maxHomeM==null?'∞':s.maxHomeM} m`}
function zone(e) {
  const lines=[];
  if(e.surface) lines.push(`<div><span class="tag">General surface ${distanceLabel(e.surface)}</span><br>${esc(e.surface.biomes.join(', '))}<br><small>${esc(e.surface.time)} · weight ${e.surface.weight}</small></div>`);
  else lines.push('<small>No general surface spawn</small>');
  if(e.cave && e.attack!=='touch' && e.id!=='red_dragon') lines.push(`<div><span class="tag">General cave ${caveLabel(e.cave)}</span><small>weight ${e.cave.weight}</small></div>`);
  for(const [label,names] of habitatMemberships(e)) if(names.length) lines.push(`<div><span class="tag">${label}</span>${esc(names.join(', '))}</div>`);
  if(e.attack==='touch') lines.push(`<div>${e.surface?'Night haunt / ':''}crypt pockets D${Math.max(EnemyRoster.GHOST_SCALING.minCryptDepth,e.id==='pink_ghost'?e.cave.minDepth:0)}+ (odd and even depths)</div>`);
  if(e.id==='red_dragon') lines.push(`<div>Special dragon roost encounter D${e.cave.minDepth}+; excluded from the general cave bag.</div>`);
  return lines.join('');
}

function movementLabel(e){const m=e.movement;return Number.isFinite(m.speedMetersPerSecond)?`${fmt(m.speedMetersPerSecond)} m/s`:`${Number(m.speedCellsPerSecond.toFixed(3))} cells/s${m.pattern==='orbit_swoop'?' in flight':''}`}
function ghostRule(e){if(e.attack!=='touch')return null;const depth=Number($('depth').value)||0;return EnemyRoster.ghostProfile(depth)}
function sprite(e,big=false) {
  const frame=artFrames[e.id], scale=SpriteLayout.creatureScale(e.id,ghostRule(e)?.sizeMultiplier||1);
  const zoom=big?4:3;
  return `<span class="spritebox" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${big?120:82}px;height:${big?120:82}px"><img class="sprite" alt="${esc(e.name)} runtime art" src="${frame.original}" style="width:${frame.width*scale*zoom}px;height:${frame.height*scale*zoom}px;max-width:none;max-height:none;opacity:${SpriteLayout.creatureAlpha(e.id)}"></span>`;
}

function attackDps(e,p=pool()){if(e.attack==='trap'||e.attack==='touch'||!!e.steals)return 0;return (e.attackHits||1)*Combat.mitigate(stats(e).dmg,p)*penalty()/e.attackSeconds}
function auraDps(e,p=pool()){if(!e.aura)return 0;const seconds=e.aura.mitigationPacketSeconds,raw=e.aura.rawDps*(stats(e).elite?Combat.ELITE_MUL:1);return Combat.mitigate(raw*seconds,p)/seconds*penalty()}
function rawDps(e){return !e.steals&&e.attackSeconds&&e.attack!=='trap'?stats(e).dmg*(e.attackHits||1)/e.attackSeconds:null}
function rawDpsLabel(e){const raw=rawDps(e);return raw==null?'Special':`${fmt(raw)} raw DPS${e.aura?' + '+fmt(e.aura.rawDps*(stats(e).elite?Combat.ELITE_MUL:1))+' aura':''}`}
function dpsPair(e){if(e.attack==='trap'||e.attack==='touch'||!!e.steals)return '— / —';const raw=rawDps(e)+(e.aura?e.aura.rawDps*(stats(e).elite?Combat.ELITE_MUL:1):0);return `${fmt(raw)} / ${fmt(attackDps(e,e.tier*4)+auraDps(e,e.tier*4))}`}
function attackLabel(e){return e.attack==='none'?'Does not attack':e.steals?'Steals coins once per day':e.attack==='touch'?'One touch, then disappears':e.attack==='trap'?'Lays a snare every '+e.attackSeconds+' s':`${e.attackHits||1} ${e.projectile?esc(e.projectile)+' ':''}${e.attack==='projectile'?'projectile':'hit'} every ${e.attackSeconds} s`}
function movementDetails(e){const m=e.movement;return `<h3>Movement & vision</h3><p><b>${movementLabel(e)}</b> · vision <b>${e.visionCells} cells</b><br>${esc(m.pattern.replaceAll('_',' '))}</p><p class="muted">${esc(e.movementNotes||'')}</p>${m.pattern==='orbit_swoop'?`<p>Orbit ${m.orbitRadiusCells.join('–')} cells · flight ${m.flightSeconds.join('–')} s · recovery ${m.pauseSeconds.join('–')} s · leg cap ${m.maxLegCells} cells. One attack opportunity per ${e.attackSeconds} s cycle, only on a swoop.</p>`:''}<p>${attackLabel(e)} · ${fmt(e.windupSeconds||0)} s wind-up, included in cycle. <b>${rawDpsLabel(e)}</b>.</p><p>Through selected armour: ${fmt(attackDps(e))} attack DPS${e.aura?' + '+fmt(auraDps(e))+' aura DPS at full exposure':''}.</p>${e.aura?`<p class="banner">Blight aura: ${e.aura.radiusCells}-cell radius, ${e.aura.rawDps} raw DPS. ${esc(e.aura.source)} aura. ${esc(e.aura.rule)}</p>`:''}${e.attack==='touch'?`<h3>Ghost depth scaling</h3><table><thead><tr><th>Zone</th><th>Group / cap</th><th>Size</th></tr></thead><tbody>${DATA.ghostScaling.rows.map(r=>`<tr><td>${r.zone==='surface_night'?'Surface night':'D'+Math.max(r.minDepth,DATA.ghostScaling.minCryptDepth)+(r.maxDepth==null?'+':'–'+r.maxDepth)}</td><td>${r.groupMin}–${r.groupMax} / ${r.nearMax}</td><td>${r.sizeMultiplier}×</td></tr>`).join('')}</tbody></table><p class="muted">${DATA.ghostScaling.cadenceSeconds} ± ${DATA.ghostScaling.jitterSeconds} seconds between groups. ${esc(DATA.ghostScaling.stats)}</p>`:''}`}
let role='all';
function roleOk(e){return role==='all'||e.roles.includes(role)}
// Habitat, tier and spawn filters describe the monster roster only; while any is set the non-monster rows step aside.
function monsterFiltersActive(){return ['habitat','tier','variant','biome','time'].some(id=>$(id).value!=='all')||$('distance').value!==''||$('depth').value!==''}
function extraRole(x){return x.roles.map(r=>ROLES.find(([id])=>id===r)[1].replace(/s$/,'')).join(' · ')}
function extraAttack(x){const b=x.behaviour;if(b.summoned)return {dmg:Combat.petBite(x.id),label:`${fmt(Combat.petBite(x.id))} per bite every ${fmt((b.stepMs||Combat.MELEE_INTERVAL_MS)/1000)} s`,note:'Hunts every foe and pest crow'};if(b.prey)return {dmg:Combat.PET_BITE,label:`${Combat.PET_BITE} per bite once tame`,note:`Hunts ${[...b.prey].join(', ')}`};if(b.fightsBack)return {dmg:b.fightsBack.dmg,label:`${b.fightsBack.dmg} per butt every ${fmt(b.fightsBack.hitMs/1000)} s`,note:`Enraged ${fmt(b.fightsBack.rageMs/1000)} s when hunted`};return {dmg:null,label:'Does not attack',note:''}}
function extraFacts(x){const b=x.behaviour,f=[];
  if(PESTS[x.id])f.push(PESTS[x.id]);
  if(b.summoned){const id=x.id==='spirit_raven'?'raven_scroll':Object.keys(CONSUMABLE_SPEC).find(id=>CONSUMABLE_SPEC[id].summonKind===x.id);f.push(id?`Summoned by the ${esc(ITEM_BY_ID[id].name)} for ${shortDuration(CONSUMABLE_SPEC[id].durationMs)}. Follows its summoner; never a tap target.`:'A hired ally. Follows its employer; never a tap target.');}
  if(summoners[x.id])f.push(`Raised as a minion by ${summoners[x.id].join(', ')}.`);
  if(ANIMAL_FOOD[x.id])f.push(ANIMAL_FOOD[x.id].length?`Tamed with ${ANIMAL_FOOD[x.id].map(id=>ITEM_BY_ID[id]?.name||id).join(', ')}.`:'Tamed with any seed.');
  if(isCatchable(x.id))f.push(`Caught with the bug net${SpriteLayout.creatureCatchMul(x.id)>1?` (×${SpriteLayout.creatureCatchMul(x.id)} net time)`:''}.`);
  if(b.game)f.push('Game: hunted with the bug net, never auto-targeted.');
  if(b.produce)f.push(`Fed while tame, it gives ${ITEM_BY_ID[b.produce.item]?.name||b.produce.item}.`);
  if(b.follows&&!b.summoned)f.push('Follows the player for a while after petting.');
  if(b.drop)f.push(`Drops ${ITEM_BY_ID[b.drop]?.name||b.drop}.`);
  return f}
function extraRow(x){const a=extraAttack(x);return `<tr data-id="${x.id}" class="${selected===x.id?'selected':''}"><td data-sort-value="${esc(x.name)}"><div class="name">${sprite(x)}<div><button class="pickaxe">${esc(x.name)}</button><br>${x.roles.map(r=>`<span class="tag">${esc(extraRole({roles:[r]}))}</span>`).join('')}</div></div></td><td class="nowrap" data-sort-value="${x.hp??''}">${x.hp==null?'Not fought':`<b>${x.hp}</b> HP`}<br>0 armour</td><td>${x.behaviour.maxMps?fmt(x.behaviour.maxMps)+' m/s max':'—'}<br><small>${x.behaviour.flee?'flees the player':x.behaviour.follows?'follows':'wanders'}</small></td><td data-sort-value="${a.dmg??''}">${esc(a.label)}<br><small>${esc(a.note)}</small></td><td>—</td><td class="zone">${extraFacts(x).map(f=>`<div>${f}</div>`).join('')}</td><td>—</td><td>${x.behaviour.summoned||x.behaviour.prey?'Fights for you':x.roles.includes('pest')?'Pest: hunt or ward off':'Harmless'}</td></tr>`}
function extraDetail(x){const a=extraAttack(x);$('detail').innerHTML=`<div class="name">${sprite(x,true)}<div><div class="eyebrow">${esc(extraRole(x))}</div><h2>${esc(x.name)}</h2>${x.roles.map(r=>`<span class="tag">${esc(extraRole({roles:[r]}))}</span>`).join('')}</div></div><div class="statgrid"><div><small>HP</small><b>${x.hp??'—'}</b></div><div><small>Blow</small><b>${a.dmg??'—'}</b></div><div><small>Armour</small><b>0</b></div></div><h3>Behaviour</h3><p>${esc(a.label)}${a.note?' · '+esc(a.note):''}</p>${extraFacts(x).map(f=>`<p>${f}</p>`).join('')}<details><summary>Behaviour row</summary><pre>${esc(JSON.stringify(x.behaviour,(k,v)=>v instanceof Set?[...v]:v,2))}</pre></details>`}
function renderRoles(){const all=[...enemies,...extras];$('roles').innerHTML=ROLES.map(([id,label])=>`<button type="button" data-role="${id}" aria-pressed="${role===id}">${label}<span>${id==='all'?all.length:all.filter(e=>e.roles.includes(id)).length}</span></button>`).join('');$('roles').querySelectorAll('button').forEach(b=>b.onclick=()=>{role=b.dataset.role;renderRoles();render()});$('roleNote').textContent=role==='mercenary'?'No mercenaries exist in the game yet; this filter will fill once a hired-ally kind is added.':role!=='all'&&role!=='monster'&&monsterFiltersActive()?'Habitat, tier and spawn filters apply to monsters only; reset them to see non-monster rows.':''}
function render(){renderRoles();let list=enemies.filter(e=>roleOk(e)&&(()=>{const q=$('search').value.toLowerCase(),s=e.surface,c=e.cave;return (!q||(JSON.stringify(e)+' '+JSON.stringify(habitatMemberships(e))).toLowerCase().includes(q))&&($('tier').value==='all'||e.tier===Number($('tier').value))&&($('variant').value==='all'||($('variant').value==='base'?!e.variantOf:!!e.variantOf))&&($('habitat').value==='all'||($('habitat').value==='surface'?hasSurface(e):$('habitat').value==='dungeon'?hasCave(e):!hasSurface(e)&&hasCave(e)))&&($('biome').value==='all'||s?.biomes.includes($('biome').value))&&($('time').value==='all'||(s&&(s.time==='any'||s.time===$('time').value)))&&($('distance').value===''||(hasSurface(e)&&EnemySpawns.homeAllows(e.id,Number($('distance').value))&&(!s||s.maxHomeM==null||Number($('distance').value)<s.maxHomeM)))&&($('depth').value===''||atDepth(e,Number($('depth').value)))})());if(!monsterFiltersActive()){const q=$('search').value.toLowerCase();list=list.concat(extras.filter(x=>roleOk(x)&&(!q||(x.name+' '+x.roles.join(' ')+' '+extraFacts(x).join(' ')).toLowerCase().includes(q))))}list.sort((a,b)=>$('sort').value==='name'?a.name.localeCompare(b.name):(a[$('sort').value]-b[$('sort').value]||a.name.localeCompare(b.name)));if(!list.some(e=>e.id===selected))selected=list[0]?.id;$('count').textContent=`${list.length} characters shown · player armour pool ${pool()} · ${$('mode').value==='hard'?'Hard':'Easy'} mode · ${$('elite').value==='elite'?'Elite preview (where eligible)':'ordinary stats'}`;$('rows').innerHTML=list.map(e=>{if(e.extra)return extraRow(e);const s=stats(e),f=fight(e,Number($('weaponTier').value),$('weapon').value),inc=incoming(e),cost=group(e,Number($('weaponTier').value),$('weapon').value);return `<tr data-id="${e.id}" class="${selected===e.id?'selected':''}"><td data-sort-value="${esc(e.name)}"><div class="name">${sprite(e)}<div><button class="pickaxe" data-pick="${e.id}">${esc(e.name)}</button><br><span class="tag">T${e.tier} ${tiers[e.tier]}</span>${e.variantOf?'<small>'+esc(e.variantType)+'</small>':''}${s.elite?'<span class="tag">Elite</span>':''}</div></div></td><td class="nowrap" data-sort-value="${s.hp}"><b>${s.hp}</b> HP<br>${s.armor} armour</td><td data-sort-value="${e.visionCells}">${movementLabel(e)}<br><b>${e.visionCells} cells vision</b><br><small>${esc(e.movement.pattern.replaceAll('_',' '))}</small></td><td data-sort-value="${e.steals||e.attack==='trap'?'':s.dmg}">${e.steals?'Coin theft':e.attack==='trap'?'Snares':fmt(s.dmg)+' dmg'}<br>${e.range} cells<br><small>${esc(e.attack)}${e.attack==='touch'?'':` · ${e.attackSeconds}s`}</small></td><td data-sort-value="${e.attack==='trap'||e.attack==='touch'||e.steals?'':rawDps(e)+(e.aura?e.aura.rawDps*(s.elite?Combat.ELITE_MUL:1):0)}" class="nowrap" title="Raw total DPS / damage through a full same-tier armour set. Includes full aura exposure; Hard affects only the armour-adjusted result.">${dpsPair(e)}<br><small>raw / armour</small></td><td class="zone">${zone(e)}</td><td class="nowrap" data-sort-value="${f.seconds}">${fmt(f.seconds)} s<br><small>${f.hits} hits × ${fmt(f.hit)}</small></td><td data-sort-value="${cost??''}">${cost==null?'Special':fmt(cost)+' energy'}<br><small>${verdict(cost)} · ${groupN()} foes</small></td></tr>`}).join('')||`<tr><td colspan="8" class="empty">${role==='mercenary'?'No mercenaries in the game yet.':'Nothing matches these zones and filters.'}</td></tr>`;SortableTables.refresh($('rows').closest('table'));$('rows').querySelectorAll('tr[data-id]').forEach(tr=>tr.onclick=()=>{selected=tr.dataset.id;render()});const pick=list.find(e=>e.id===selected);pick?.extra?extraDetail(pick):detail(pick);$('detail').querySelectorAll('table').forEach(SortableTables.refresh)}
function abilityDetail(e){const a=e.ability;if(a?.type!=='split')return '';return `<h3>Splitting</h3><p>Divides after a direct hit when both halves can carry at least ${a.minHp} HP and there is room beside it. Remaining health is shared between the halves; cooldown ${a.cooldownSeconds} seconds. Burning does not trigger a split.</p>`;}
function detail(e){if(!e){$('detail').innerHTML='<h2>No selection</h2><p>Broaden a filter to inspect an enemy.</p>';return}const s=stats(e),f=fight(e,Number($('weaponTier').value),$('weapon').value);$('detail').innerHTML=`<div class="name">${sprite(e,true)}<div><div class="eyebrow">${e.variantOf?'Declared variant':'Base kind'}</div><h2>${esc(e.name)}</h2><span class="tag">T${e.tier} · ${tiers[e.tier]}</span></div></div><p>${esc(e.notes||e.movement.hitPolicy||e.movement.speedMeaning||'')}</p><div class="statgrid"><div><small>HP</small><b>${s.hp}</b></div><div><small>Armour pool</small><b>${s.armor}</b></div><div><small>Reach</small><b>${e.range}</b></div></div>${movementDetails(e)}${abilityDetail(e)}${e.bountyCoins!=null?`<p><b>${e.bountyCoins} coins</b> on defeat.</p>`:''}<h3>Declared zones</h3>${zone(e)}<h3>Group challenge</h3><button onclick="matchTier(${e.tier})">Equip matching T${e.tier} weapon + full armour</button><p><strong>${group(e,Number($('weaponTier').value),$('weapon').value)==null?'Special encounter':fmt(group(e,Number($('weaponTier').value),$('weapon').value))+' energy'}</strong> expected cost against ${groupN()} concurrent enemies. ${verdict(group(e,Number($('weaponTier').value),$('weapon').value))}.</p><p class="muted">Same-tier full-set cost: ${['sword','bow','staff'].map(w=>w+' '+(group(e,e.tier,w,e.tier*4)==null?'special':fmt(group(e,e.tier,w,e.tier*4)))).join(' · ')}. Staff estimate includes 1 energy per cast and assumes a single target per bolt; piercing groups can materially reduce the cost.</p><h3>Kill time by player weapon</h3><p class="muted">Includes enemy armour and Elite modifier. Difficulty changes incoming player damage only.</p><table><thead><tr><th>Tier</th><th>Sword</th><th>Bow</th><th>Staff</th></tr></thead><tbody>${tiers.slice(1).map((name,i)=>`<tr><td>T${i+1} ${name}</td>${['sword','bow','staff'].map(w=>`<td>${fmt(fight(e,i+1,w).seconds)} s</td>`).join('')}</tr>`).join('')}</tbody></table><h3>Incoming attack damage by full armour set</h3><table><thead><tr><th>Armour</th><th>${e.attack==='projectile'?'Per projectile':'Per hit / touch'}</th></tr></thead><tbody>${tiers.map((name,t)=>`<tr><td>T${t} ${name}</td><td>${e.steals?'Coin theft':e.attack==='trap'?'Separate hazard':fmt((e.attackHits||1)*Combat.mitigate(s.dmg,4*t)*penalty())}</td></tr>`).join('')}</tbody></table><p class="muted">Selected attack: ${fmt(weapon(Number($('weaponTier').value),$('weapon').value).raw)} raw → ${fmt(f.hit)} after enemy armour.</p>${s.elite&&$('mode').value==='hard'?`<p class="warn">Elite is identical in both modes. Hard players receive ×${penalty()} damage after armour; this can make Elite hits severe.</p>`:''}<details><summary>Declared row</summary><pre>${esc(JSON.stringify(e,null,2))}</pre></details>`}
function matchTier(t){$('weaponTier').value=t;$('armorTier').value=t;$('pieces').value='4';$('pool').value='';render()}
const linkParams=new URLSearchParams(location.search);
const linkedEnemy=enemies.find(e=>e.id===linkParams.get('enemy'));
$('search').value=linkedEnemy?.id||linkParams.get('search')||'';
if(linkedEnemy)selected=linkedEnemy.id;
$('sort').addEventListener('input',()=>SortableTables.clear($('rows').closest('table')));
for(const input of document.querySelectorAll('.controls input,.controls select'))input.addEventListener('input',render);$('reset').onclick=()=>{SortableTables.clear($('rows').closest('table'));for(const id of ['search','distance','depth'])$(id).value='';for(const id of ['habitat','tier','variant','biome','time'])$(id).value='all';$('sort').value='tier';render()};render();window.review={enemies,extras,fight,incoming,stats,weapon,group,atDepth,hasSurface,hasCave,artFrames};window.matchTier=matchTier;

    document.documentElement.dataset.previewReady='true';
    document.documentElement.dataset.rosterReady='true';
  } catch(error) {
    document.documentElement.dataset.rosterError=error.message;
    const status=document.getElementById('count');
    if(status){status.className='error';status.textContent=`Could not load monster viewer: ${error.message}`;}
    console.error(error);
  }
})();
