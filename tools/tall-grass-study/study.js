/* Isolated material review. Procedural textures; no saved-game writes. */
'use strict';
const H=18, CELL=32, SIZE=7;
function texture(kind){
 const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');
 let seed=1847;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
 const leaf=kind.startsWith('hedge'),top=kind.endsWith('top'),blades=kind==='blades';
 if(!blades){x.fillStyle=leaf?'#365b34':top?'#678441':'#35552b';x.fillRect(0,0,32,32);}
 const colors=leaf?['#426b38','#547a40','#79954b','#2b4c30']:['#789848','#9bac52','#536f35','#b2bc64','#426133'];
 for(let i=0;i<(leaf?95:85);i++){
  const px=Math.floor(rand()*32),py=Math.floor(rand()*32);x.fillStyle=colors[Math.floor(rand()*colors.length)];
  if(leaf){x.fillRect(px,py,3,2);x.fillRect(px+1,py-1,2,1);}
  else if(top){x.fillRect(px,py,1,3);x.fillRect(px+1,py-1,1,2);}
  else {const base=blades?32:py,len=4+Math.floor(rand()*14);x.fillRect(px,base-len,1,len);x.fillRect(px+(i%2?1:-1),base-len-2,1,3);}
 }
 return c;
}
const images=Object.fromEntries(['grass-side','grass-top','hedge-side','hedge-top','blades'].map(k=>[k,texture(k)]));
function color(hex){if(!images[hex]){const c=document.createElement('canvas');c.width=c.height=2;const x=c.getContext('2d');x.fillStyle=hex;x.fillRect(0,0,2,2);images[hex]=c;}return hex;}
function model(){return {batches:new Map()};}
function quad(m,key,p,light=1,uv=[[0,1],[1,1],[1,0],[0,0]]){if(!m.batches.has(key))m.batches.set(key,[]);const a=m.batches.get(key);for(const i of [0,1,2,0,2,3])a.push(...p[i],...uv[i],light);}
function box(m,x,y,z,w,d,h,side,top=side){
 const a=x-w/2,b=x+w/2,c=y-d/2,e=y+d/2,t=z+h;
 quad(m,top,[[a,c,t],[b,c,t],[b,e,t],[a,e,t]],1);
 quad(m,side,[[a,e,z],[b,e,z],[b,e,t],[a,e,t]],.82);
 quad(m,side,[[b,c,z],[a,c,z],[a,c,t],[b,c,t]],.7);
 quad(m,side,[[a,c,z],[a,e,z],[a,e,t],[a,c,t]],.72);
 quad(m,side,[[b,e,z],[b,c,z],[b,c,t],[b,e,t]],.9);
}
function grass(m,x,y,shape,cover='grass',seed=0){
 if(shape!=='layered'||cover==='hedge')box(m,x,y,0,CELL,CELL,H,cover+'-side',cover+'-top');
 if(shape==='solid')return;
 if(cover==='hedge'){
  for(let j=0;j<4;j++)for(let i=0;i<4;i++)box(m,x-12+i*8,y-12+j*8,H,8,8,1+(i+j+seed)%3,'hedge-side','hedge-top');
  return;
 }
 const z=shape==='layered'?0:H-4,height=shape==='layered'?H+5:10;
 for(let i=0;i<5;i++){
  const o=-14+i*7,delta=((seed+i*3)%5)*.5;
  quad(m,'blades',[[x-16,y+o,z],[x+16,y+o,z],[x+16+delta,y+o,z+height],[x-16+delta,y+o,z+height]],.95);
  quad(m,'blades',[[x+o,y-16,z],[x+o,y+16,z],[x+o,y+16+delta,z+height],[x+o,y-16+delta,z+height]],.85);
 }
}
function person(m,x,y){
 box(m,x-3,y,0,4,5,12,color('#503e2c'));box(m,x+3,y,0,4,5,12,color('#503e2c'));
 box(m,x,y,12,13,8,14,color('#b59a5b'));box(m,x-8,y,14,3,5,10,color('#9b804b'));box(m,x+8,y,14,3,5,10,color('#9b804b'));
 box(m,x,y,26,12,11,11,color('#677553'));box(m,x,y+5.6,27,7,1,6,color('#242e27'));
}
const cards=['solid','fringe','layered'].map(shape=>{
 const canvas=document.getElementById(shape);canvas.width=600;canvas.height=360;
 const r=new TileReviewRenderer(canvas,images),m=model();box(m,0,0,-2,48,48,2,color('#303e29'));grass(m,0,0,shape);r.setModel(m);return r;
});
const canvas=document.getElementById('field'),renderer=new TileReviewRenderer(canvas,images);
const state={cleared:new Set(),player:{x:-64,y:64},inventory:0,eggs:0,hedges:0,heading:0,shape:'fringe',cover:'grass',place:'Grassland'};
let zoom=1;
function key(x,y){return x+','+y;}
function covered(x,y){return Math.abs(x)<=3&&Math.abs(y)<=3&&!state.cleared.has(key(x,y));}
function hasEgg(x,y){let h=Math.imul(x+15,374761393)^Math.imul(y+91,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296<.01;}
let popTimer;
function discovery(previous){
 const x=Math.round(state.player.x/CELL),y=Math.round(state.player.y/CELL);
 if(previous!==key(x,y)&&state.cover==='grass'&&covered(x,y)&&((x===0&&y===0)||hasEgg(x,y))){
  const pop=document.getElementById('pop');pop.textContent='oh!';pop.hidden=false;
  const p=project(state.player.x,state.player.y,44);pop.style.left=(p.x/canvas.width*100)+'%';pop.style.top=(p.y/canvas.height*canvas.clientHeight)+'px';
  clearTimeout(popTimer);popTimer=setTimeout(()=>pop.hidden=true,1600);
 }
}
function rebuild(){
 const m=model();
 for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++){
  const shade=state.place==='Schoolyard'?'#737565':state.place==='Pitch'?(y%2?'#4f703d':'#587c43'):'#435632';
  box(m,x*CELL,y*CELL,-2,CELL,CELL,2,color(shade));
 }
 // Low chest survives in the same cell, below the opaque canopy.
 box(m,0,0,0,15,11,9,color('#795239'),color('#b88b48'));box(m,0,6,3,3,1,4,color('#d8c270'));
 box(m,64,-32,0,4,4,52,color('#8b714a'));box(m,64,-32,39,18,5,10,color('#c2b37a'));
 for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++)if(covered(x,y))grass(m,x*CELL,y*CELL,state.shape,state.cover,(x+3)*7+y+3);
 person(m,state.player.x,state.player.y);renderer.setModel(m);draw();
 const inside=covered(Math.round(state.player.x/CELL),Math.round(state.player.y/CELL));
 document.getElementById('study-status').textContent=inside?'In cover · lower half hidden · walking':'In the open · full body visible';
 document.getElementById('inventory').textContent=`Tall grass × ${state.inventory} · Eggs × ${state.eggs}`;
}
function draw(){renderer.draw(state.heading,zoom,1);cards.forEach(r=>r.draw(state.heading,4,1));}
function resize(){const rect=canvas.getBoundingClientRect();canvas.width=Math.round(rect.width*devicePixelRatio);canvas.height=Math.round(rect.height*devicePixelRatio);zoom=Math.min(canvas.width/380,canvas.height/220);draw();}
function project(x,y,z=0){const c=Math.cos(state.heading),s=Math.sin(state.heading);return {x:canvas.width/2+(c*x-s*y)*zoom,y:canvas.height/2+((s*x+c*y)*.5-z*.8660254-20)*zoom};}
function pick(cx,cy){
 const c=Math.cos(state.heading),s=Math.sin(state.heading);
 for(const z of [H,0]){const u=(cx-canvas.width/2)/zoom,v=((cy-canvas.height/2)/zoom+20+z*.8660254)*2;const ix=Math.round((c*u+s*v)/CELL),iy=Math.round((-s*u+c*v)/CELL);
  if(covered(ix,iy)){state.cleared.add(key(ix,iy));if(state.cover==='grass'){state.inventory++;if(hasEgg(ix,iy))state.eggs++;}else state.hedges++;rebuild();return key(ix,iy);}
   if(Math.abs(ix)<=3&&Math.abs(iy)<=3)return null;
 }return null;
}
canvas.addEventListener('pointerdown',e=>{const r=canvas.getBoundingClientRect();pick((e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height);canvas.focus({preventScroll:true});});
function move(dx,dy,step=8){const previous=key(Math.round(state.player.x/CELL),Math.round(state.player.y/CELL));state.player.x=Math.max(-128,Math.min(128,state.player.x+dx*step));state.player.y=Math.max(-128,Math.min(128,state.player.y+dy*step));rebuild();discovery(previous);}
document.addEventListener('keydown',e=>{if(/INPUT|SELECT/.test(e.target.tagName))return;const dir={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0]}[e.key];if(dir){e.preventDefault();move(...dir);}});
document.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>move(...b.dataset.move.split(',').map(Number),16));
for(const id of ['cover','shape','place'])document.getElementById(id).onchange=e=>{state[id]=e.target.value;rebuild();};
document.getElementById('heading').oninput=e=>{state.heading=Number(e.target.value)*Math.PI/180;draw();};
document.getElementById('reset').onclick=()=>{state.cleared.clear();state.inventory=0;state.eggs=0;state.hedges=0;document.getElementById('pop').hidden=true;rebuild();};
window.addEventListener('resize',resize);resize();rebuild();
window.grassStudy={state,rebuild,project,pick,move,covered,hasEgg,renderer};
