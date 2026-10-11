#!/usr/bin/env node
'use strict';
// Conservative observation-driven player. Stops on unfamiliar choices for an agent to inspect.
const fs=require('node:fs');
const endpoint=`http://127.0.0.1:${process.env.QA_PORT||7732}/command`;
const limit=Number(process.env.QA_STEPS||100);
const stateFile=process.env.QA_STATE||'/tmp/gameplay-qa-player.json';
let memory=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)): {visited:{},attempts:{},notes:[]};
async function send(command){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});const j=await r.json();if(!r.ok)throw Error(j.error);return j;}
function progress(o){return JSON.stringify({menus:o.menus,money:o.hud?.money,objective:o.hud?.objective,inventory:o.inventory,
  cell:o.position&&[o.position.cellIX,o.position.cellIY],targets:o.targets?.map(t=>[t.id,t.stage,t.role,t.hp])});}
function choice(o){
  const available=o.controls.filter(c=>!c.disabled);
  const intro=available.find(c=>['story-next','safety-dismiss','howto-easy'].includes(c.domId));
  if(intro)return {action:'activate',control:intro.id,reason:'onboarding-'+intro.domId};
  if(!o.ready)return {action:'boot-wait'};
  if(!memory.started)return {action:'start'};
  if(o.menus.length){
    if(o.menus.some(m=>m.kind==='craft')&&memory.craftExperiment){
      const craft=available.filter(c=>c.label==='Craft').at(-1);
      if(craft&&/INGREDIENTS/.test(o.menus[0].text)&&!/Missing ingredients/.test(o.menus[0].text)){
        memory.craftExperiment=false;return {action:'activate',control:craft.id,reason:'craft-offered-throwing-spear'};
      }
      const leave=available.find(c=>c.label==='Leave');
      if(leave){memory.craftExperiment=false;memory.garden=true;return {action:'activate',control:leave.id,reason:'inspect-crafting-requirements'};}
    }
    if(o.menus.some(m=>m.kind==='delivery')){
      const deliver=available.find(c=>c.label==='Deliver');
      if(deliver){delete memory.deliveryWanted;return {action:'activate',control:deliver.id,reason:'fulfil-neighbour-delivery'};}
      const later=available.find(c=>c.label==='Later');if(later)return {action:'activate',control:later.id};
    }
    if(o.menus.some(m=>m.kind==='forge')){
      const forge=available.find(c=>c.label==='Forge');
      if(forge)return {action:'activate',control:forge.id,reason:'forge-offered-tool'};
      const later=available.find(c=>c.label==='Later');if(later)return {action:'activate',control:later.id};
    }
    const stock=o.menus.find(m=>m.kind==='shop'&&/has fresh stock/.test(m.text));
    if(stock){
      const price=Number(stock.text.match(/for (\d+)/)?.[1]);
      const buy=available.find(c=>c.label==='Buy');
      if(buy&&price<=o.hud.money-30&&(memory.purchases||0)<2){memory.purchases=(memory.purchases||0)+1;return {action:'activate',control:buy.id,reason:'buy-advertised-shop-stock'};}
      const later=available.find(c=>c.label==='Later');
      if(later)return {action:'activate',control:later.id,reason:'leave-shop-after-inspection'};
    }
    if(o.menus.some(m=>m.kind==='shop'&&/Not enough bag space/.test(m.text))){
      const later=available.find(c=>c.label==='Later');
      if(later)return {action:'activate',control:later.id,reason:'respect-shop-capacity-limit'};
    }
    if(o.menus.some(m=>m.kind==='shop'&&/Sold out/.test(m.text))){
      const leave=available.find(c=>c.label==='Leave');
      if(leave)return {action:'activate',control:leave.id,reason:'leave-completed-sale'};
    }
    if(o.menus.some(m=>m.kind==='shop'&&/Sell from your stash/.test(m.text))&&/Cash out at Home/.test(o.hud?.objective||'')){
      const sell=available.filter(c=>c.label==='Sell').at(-1);
      if(sell)return {action:'activate',control:sell.id,reason:'sell-first-harvest'};
    }
    if(o.menus.some(m=>m.kind==='supplies')){
      const take=available.find(c=>/^Take \d+$/.test(c.label));
      if(take)return {action:'activate',control:take.id,reason:'take-supplies-within-bag-capacity'};
    }
    if(o.menus.some(m=>m.kind==='build')){
      const rocks=o.inventory.find(i=>i?.name==='Rock')?.count||0;
      const cards=available.filter(c=>/\d+× Rock/.test(c.label)&&Number(c.label.match(/(\d+)× Rock/)[1])<=rocks);
      const newBuilding=cards.find(c=>/NEW/.test(c.label)&&!/^(House|Restore)/.test(c.label))||cards.find(c=>/^House/.test(c.label))||cards[0];
      if(newBuilding&&memory.buildChoiceFor!==memory.currentBuildTarget){
        memory.buildChoiceFor=memory.currentBuildTarget;
        return {action:'activate',control:newBuilding.id,reason:'choose-new-building-'+newBuilding.label};
      }
      const restore=available.find(c=>c.label==='Restore');
      if(restore)return {action:'activate',control:restore.id,reason:'restore-chosen-building'};
      const rockCost=o.menus.map(m=>m.text).join(' ').match(/(\d+)× Rock/);
      if(rockCost)memory.neededRocks=Number(rockCost[1]);
      const later=available.find(c=>c.label==='Later');
      if(later)return {action:'activate',control:later.id,reason:'gather-visible-restoration-cost'};
    }
    const dismiss=available.find(c=> /^(tap to continue|continue|next|close|got it|ok|okay|back|×|✕)$/i.test(c.label.trim()));
    if(dismiss)return {action:'activate',control:dismiss.id,reason:'read-'+o.menus[0].kind};
    if(!available.length)return {action:'wait',seconds:2};
    return null;
  }
  if(o.work)return {action:'wait',seconds:Math.min(30,Math.max(.1,(o.work.remainingMs||1000)/1000+.1))};
  const objective=o.hud?.objective||'';
  const dist=t=>Math.hypot(t.dx,t.dy);
  const approach=t=>dist(t)<=1.5?{action:'interact',target:t.id,reason:'explore-'+(t.name||t.kind)}:
    {action:'move',direction:Math.abs(t.dx)>Math.abs(t.dy)?(t.dx>0?'east':'west'):(t.dy>0?'south':'north')};
  if(memory.expedition==='approach'){
    if(o.depth>0){memory.expedition='inspect';return null;}
    const stair=o.targets.find(t=>t.kind==='staircase')||memory.caveLead;
    if(stair)return approach({...stair,dx:stair.cellIX-o.position.cellIX,dy:stair.cellIY-o.position.cellIY});
  }
  if(memory.expedition==='explore'&&o.depth>0){
    const exit=o.targets.find(t=>t.kind==='staircase')||memory.caveLead;
    if(o.hud.energy<45||(memory.caveInteractions||0)>=8){
      memory.expedition='return';
      if(exit)return approach({...exit,dx:exit.cellIX-o.position.cellIX,dy:exit.cellIY-o.position.cellIY});
    }
    const enemy=!memory.avoidCombat&&o.targets.find(t=>/slime|goblin|skeleton/.test(t.kind));
    if(enemy)return approach(enemy);
    const treasure=o.targets.find(t=>t.kind==='chest'&&!memory.visited[t.id]);if(treasure)return approach(treasure);
    const ore=o.targets.find(t=>t.kind==='mineralrock');if(ore)return approach(ore);
    return null;
  }
  if(memory.expedition==='return'){
    if(o.depth===0){memory.expedition='done';memory.garden=false;}
    else{
      const exit=o.targets.find(t=>t.kind==='staircase')||memory.caveExit;
      if(exit)return approach({...exit,dx:exit.cellIX-o.position.cellIX,dy:exit.cellIY-o.position.cellIY});
      return null;
    }
  }
  if(!objective&&memory.deliveryWanted){
    const produce=o.inventory.find(i=>i?.name===memory.deliveryWanted.item);
    if(produce){
      if(!produce.selected){
        const select=available.find(c=>String(c.slot)===String(produce.slot));
        if(select)return {action:'activate',control:select.id};
        const tab=available.find(c=>c.label==='Produce');if(tab)return {action:'activate',control:tab.id};
      }
      const t=memory.deliveryWanted.target;
      return approach({...t,dx:t.cellIX-o.position.cellIX,dy:t.cellIY-o.position.cellIY});
    }
  }
  if(!objective&&memory.craftExperiment&&memory.home){
    const empty=available.find(c=>c.slot==='-1');
    if(o.inventory.some(i=>i?.selected)&&empty)return {action:'activate',control:empty.id};
    const t=memory.home;
    return approach({...t,dx:t.cellIX-o.position.cellIX,dy:t.cellIY-o.position.cellIY});
  }
  const target=o.targets.find(t=>t.kind==='chest' && !memory.visited[t.id]);
  const cropWaitSeconds=()=>{
    const timers=(o.feedback||[]).map(t=>t.match(/(?:^|—\s*)(\d+)(m|s)$/)).filter(Boolean)
      .map(m=>Number(m[1])*(m[2]==='m'?60:1));
    return timers.length?Math.min(300,Math.max(10,Math.min(...timers)+2)):60;
  };
  if(/Gather your supplies/.test(objective) && target)return approach(target);
  if(/Break ground/.test(objective)){
    const empty=available.find(c=>c.slot==='-1');
    if(o.inventory.some(i=>i?.selected) && empty)return {action:'activate',control:empty.id};
    const grass=o.cells.filter(c=>c.terrain==='grass'&&!c.tilled&&!o.targets.some(t=>t.dx===c.dx&&t.dy===c.dy)).sort((a,b)=>dist(a)-dist(b))[0];
    if(grass)return approach({...grass,kind:'ground'});
  }
  if(/Sow a seed/.test(objective)){
    const seed=o.inventory.find(i=>i&&i.id.endsWith('_seed'));
    if(seed&&!seed.selected){
      const control=available.find(c=>String(c.slot)===String(seed.slot));
      if(control)return {action:'activate',control:control.id};
      const tab=available.find(c=>c.label==='Seeds');if(tab)return {action:'activate',control:tab.id};
    }
    const tilled=o.cells.filter(c=>c.tilled&&!o.targets.some(t=>t.id.startsWith('planted:')&&t.dx===c.dx&&t.dy===c.dy)).sort((a,b)=>dist(a)-dist(b))[0];
    if(tilled)return approach({...tilled,kind:'planting-bed'});
  }
  if(/Rebuild a neighbour/.test(objective)||(!objective&&memory.garden)){
    const rocks=o.inventory.find(i=>i?.name==='Rock')?.count||0;
    if(!objective&&memory.home){
      const h={...memory.home,dx:memory.home.cellIX-o.position.cellIX,dy:memory.home.cellIY-o.position.cellIY};
      if(dist(h)>2)return approach(h);
    }
    if(memory.neededRocks&&rocks<memory.neededRocks){
      const supplies=o.targets.find(t=>t.kind==='chest'&&!memory.visited[t.id]);
      if(supplies)return approach(supplies);
      const rock=o.targets.find(t=>t.kind==='mineralrock'||t.crop==='rubble');
      if(rock){
        const empty=available.find(c=>c.slot==='-1');
        if(o.inventory.some(i=>i?.selected)&&empty)return {action:'activate',control:empty.id};
        if(rock.id.startsWith('planted:')&&(memory.cropDue?.[rock.id]||0)>(memory.simulatedMs||0)){
          const other=o.targets.find(t=>t.id.startsWith('planted:')&&t.id!==rock.id
            &&(memory.cropDue?.[t.id]||0)<=(memory.simulatedMs||0));
          if(other)return approach(other);
          return {action:'wait',seconds:Math.min(300,Math.max(2,((memory.cropDue[rock.id]||0)-(memory.simulatedMs||0))/1000))};
        }
        return approach(rock);
      }
      const seed=o.inventory.find(i=>i?.name==='Rock Seed');
      if(seed){
        const bed=o.cells.filter(c=>c.tilled&&!o.targets.some(t=>t.dx===c.dx&&t.dy===c.dy)).sort((a,b)=>dist(a)-dist(b))[0];
        const ground=bed||o.cells.filter(c=>['grass','residential','park','farmland'].includes(c.terrain)&&!c.road&&!o.targets.some(t=>t.dx===c.dx&&t.dy===c.dy)).sort((a,b)=>dist(a)-dist(b))[0];
        if(ground){
          const empty=available.find(c=>c.slot==='-1');
          if(!bed&&o.inventory.some(i=>i?.selected)&&empty)return {action:'activate',control:empty.id};
          if(bed&&!seed.selected){
            const select=available.find(c=>String(c.slot)===String(seed.slot));
            if(select)return {action:'activate',control:select.id};
            const tab=available.find(c=>c.label==='Seeds');if(tab)return {action:'activate',control:tab.id};
          }
          return approach({...ground,kind:bed?'rock-seed-bed':'ground-for-rock-seed'});
        }
      }
      return null;
    }
    memory.garden=false;
    const wreck=o.targets.find(t=>t.role==='wreck');if(wreck)return approach(wreck);
  }
  if(/Bring in the crop/.test(objective)){
    const empty=available.find(c=>c.slot==='-1');
    if(o.inventory.some(i=>i?.selected)&&empty)return {action:'activate',control:empty.id};
    if(memory.cropWait){
      const explore=o.targets.find(t=>!memory.visited[t.id]&&(t.kind==='chest'||t.kind==='npc'));
      if(explore)return approach(explore);
      memory.cropWait=false;return {action:'wait',seconds:cropWaitSeconds()};
    }
    const crop=o.targets.filter(t=>t.id.startsWith('planted:')).sort((a,b)=>(b.stage||0)-(a.stage||0))[0];
    if(crop)return approach(crop);
  }
  if(/Cash out at Home/.test(objective)){
    const potato=o.inventory.find(i=>i?.name==='Potato');
    if(potato&&!potato.selected){
      const select=available.find(c=>String(c.slot)===String(potato.slot));
      if(select)return {action:'activate',control:select.id};
      const tab=available.find(c=>c.label==='Produce');if(tab)return {action:'activate',control:tab.id};
    }
    const home=o.targets.find(t=>t.name==='Home');if(home)return approach(home);
  }
  if(!objective){
    const empty=available.find(c=>c.slot==='-1');
    if(o.inventory.some(i=>i?.selected)&&empty)return {action:'activate',control:empty.id};
    const home=o.targets.find(t=>t.name==='Home');
    if(o.hud.energy<35){
      if(home&&dist(home)>1.5)return approach(home);
      if(home)return {action:'wait',seconds:60,reason:'rest-near-home'};
    }
    const discovery=o.targets.find(t=>!memory.visited[t.id]&&(t.kind==='npc'||t.kind==='chest'));
    if(discovery)return approach(discovery);
    const rocks=o.inventory.find(i=>i?.name==='Rock')?.count||0;
    const wreck=o.targets.find(t=>t.role==='wreck');
    if(wreck&&rocks>=(memory.neededRocks||2))return approach(wreck);
    const place=o.targets.find(t=>!memory.visitedRoles?.[`${t.id}:${t.role}`]&&t.kind==='house'&&t.role!=='wreck'&&t.name!=='Home');
    if(place)return approach(place);
    const crop=o.targets.find(t=>t.id.startsWith('planted:')&&t.stage>=4);
    if(crop)return approach(crop);
    const resource=o.targets.find(t=>t.kind==='mineralrock'&&rocks<(memory.neededRocks||2));
    if(resource)return approach(resource);
    if(rocks<(memory.neededRocks||2)&&o.inventory.some(i=>i?.name==='Rock Seed')){
      memory.garden=true;return {action:'wait',seconds:2,reason:'plan-next-restoration-materials'};
    }
    const remembered=Object.values(memory.landmarks||{}).filter(t=>t.role==='wreck')
      .filter(t=>!memory.home||Math.hypot(t.cellIX-memory.home.cellIX,t.cellIY-memory.home.cellIY)<=20)
      .map(t=>({...t,dx:t.cellIX-o.position.cellIX,dy:t.cellIY-o.position.cellIY})).sort((a,b)=>dist(a)-dist(b))[0];
    if(remembered&&rocks>=(memory.neededRocks||2))return approach(remembered);
    if(memory.home){
      const h={...memory.home,dx:memory.home.cellIX-o.position.cellIX,dy:memory.home.cellIY-o.position.cellIY};
      if(dist(h)>20)return approach(h);
    }
    // Explore by previously visited cells, favouring the nearest unseen map
    // edge. The policy learns only terrain/targets supplied by observe().
    memory.walked ||= {};
    const here=`${o.position.cellIX},${o.position.cellIY}`;
    memory.walked[here]=(memory.walked[here]||0)+1;
    const dirs=[['north',0,-1],['east',1,0],['south',0,1],['west',-1,0]];
    const unexplored=o.cells.filter(c=>c.terrain==='unexplored');
    const score=([,dx,dy])=>{
      const visits=memory.walked[`${o.position.cellIX+dx},${o.position.cellIY+dy}`]||0;
      const edge=unexplored.length?Math.min(...unexplored.map(c=>Math.abs(c.dx-dx)+Math.abs(c.dy-dy))):0;
      return visits*20+edge;
    };
    dirs.sort((a,b)=>score(a)-score(b));
    return {action:'move',direction:dirs[0][0]};
  }
  return null;
}
(async()=>{
 for(let n=0;n<limit;n++){
  const o=await send({action:'observe'});
  if(o.session){
    if(memory.sessionId&&memory.sessionId!==o.session.id)memory={visited:{},attempts:{},notes:[]};
    memory.sessionId=o.session.id;memory.started=o.session.clockStarted;memory.simulatedMs=o.session.simulatedMs;
  }
  const home=o.targets?.find(t=>t.name==='Home');if(home)memory.home=home;
  for(const target of o.targets||[])if(target.kind==='house'||target.kind==='staircase'){
    (memory.landmarks ||= {})[target.id]={...target};
  }
  const menuText=JSON.stringify(o.menus);
  if(o.menus.length&&menuText!==memory.lastCapturedMenu){
    await new Promise(resolve=>setTimeout(resolve,500));
    await send({action:'capture',reason:'settled-'+o.menus[0].kind});
    memory.lastCapturedMenu=menuText;
  }
  const c=choice(o);
  if(!c){console.log(JSON.stringify({paused:'Needs agent decision',observation:o}));break;}
  if(c.action==='boot-wait'){await new Promise(r=>setTimeout(r,500));continue;}
  if(memory.started && c.action==='activate' && o.menus.length){
    const words=o.menus.map(m=>m.text).join(' ').split(/\s+/).length;
    await send({action:'wait',seconds:Math.max(2,Math.min(30,words/4)),reason:'reading-time'});
  }
  const r=await send(c);
  memory.simulatedMs=r.simulatedMs??memory.simulatedMs??0;
  const control=o.controls.find(control=>control.id===c.control);
  const signature=JSON.stringify({action:c.action,target:c.target,control:control&&{label:control.label,domId:control.domId,slot:control.slot}});
  if(c.action!=='wait'&&progress(o)===progress(r.observation)){
    memory.noProgressCount=memory.lastNoProgress===signature?(memory.noProgressCount||0)+1:1;
    memory.lastNoProgress=signature;
  }else{memory.noProgressCount=0;memory.lastNoProgress=null;}
  if(c.action==='start')memory.started=true;
  if(c.action==='interact' && r.observation.menus.length)memory.visited[c.target]=true;
  if(c.action==='interact'){
    const target=o.targets.find(t=>t.id===c.target);
    if(target?.role)(memory.visitedRoles ||= {})[`${target.id}:${target.role}`]=true;
    if(o.depth>0&&target?.kind!=='staircase')memory.caveInteractions=(memory.caveInteractions||0)+1;
    const wants=r.observation.feedback?.map(t=>t.match(/^wants:\s*(.+)$/)).find(Boolean);
    if(wants&&target?.role==='plain')memory.deliveryWanted={item:wants[1],target};
    if(memory.deliveryWanted?.target.id===c.target&&o.inventory.some(i=>i?.name===memory.deliveryWanted.item)
      &&JSON.stringify(o.inventory)!==JSON.stringify(r.observation.inventory))delete memory.deliveryWanted;
  }
  if(c.action==='interact' && r.observation.menus.some(m=>m.kind==='build'))memory.currentBuildTarget=c.target;
  if(c.action==='interact' && c.target.startsWith('planted:')){
    memory.cropWait=true;
    const timers=r.observation.feedback.map(t=>t.match(/(?:^|—\s*)(\d+)(m|s)$/)).filter(Boolean)
      .map(m=>Number(m[1])*(m[2]==='m'?60:1));
    (memory.cropDue ||= {})[c.target]=memory.simulatedMs+(timers.length?Math.min(...timers)+2:60)*1000;
  }
  fs.writeFileSync(stateFile,JSON.stringify(memory,null,2));
  console.log(JSON.stringify({step:r.step,ms:r.simulatedMs,action:c,hud:r.observation.hud,menus:r.observation.menus}));
  if(memory.noProgressCount>=3){console.log(JSON.stringify({paused:'Repeated action made no visible progress',command:c}));break;}
  if(memory.simulatedMs>=7200000)break;
  if(memory.started&&['move','interact','activate'].includes(c.action)&&!r.observation.menus.length){
    const pause=await send({action:'wait',seconds:2});memory.simulatedMs=pause.simulatedMs;
    fs.writeFileSync(stateFile,JSON.stringify(memory,null,2));
  }
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
