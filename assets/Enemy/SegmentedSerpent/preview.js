'use strict';
const {Model,SPACING,angleDelta}=SerpentPrototype;
const $=id=>document.getElementById(id), atlas=new Image();
let model=new Model(),last=0,pending=0;
const contexts=['native','rotated'].map(id=>$(id).getContext('2d'));
const octant=a=>((Math.round(a/(Math.PI/4))%8)+8)%8;
function draw(ctx,rotated){
 ctx.imageSmoothingEnabled=false;ctx.fillStyle='#233832';ctx.fillRect(0,0,432,320);
 ctx.strokeStyle='#30483e';ctx.lineWidth=1;for(let x=0;x<432;x+=24){ctx.beginPath();ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,320);ctx.stroke();}for(let y=0;y<320;y+=24){ctx.beginPath();ctx.moveTo(0,y+.5);ctx.lineTo(432,y+.5);ctx.stroke();}
 const chain=model.chain();const jobs=chain.map((p,i)=>({...p,type:'part',depth:p.y,index:i}));
 for(const p of [{x:165,y:143},{x:279,y:222}])jobs.push({...p,depth:p.y,type:'post',index:100});
 jobs.sort((a,b)=>a.depth-b.depth||b.index-a.index);
 for(const p of jobs){if(p.type==='post'){ctx.fillStyle='#59605d';ctx.fillRect(p.x-7,p.y-26,14,26);ctx.fillStyle='#9ca59b';ctx.fillRect(p.x-7,p.y-28,14,5);ctx.fillStyle='#3d4441';ctx.fillRect(p.x+5,p.y-23,3,23);continue;}
 let row=p.index===0?0:p.index===chain.length-1?3:1,angle=p.angle;
 if(row===3)angle+=Math.PI;
 if(row===1&&$('curves').checked){const prev=chain[Math.max(0,p.index-1)],next=chain[Math.min(chain.length-1,p.index+1)];if(Math.abs(angleDelta(prev.angle,next.angle))>.32)row=2;}
 const x=Math.round(p.x),y=Math.round(p.y);ctx.save();ctx.translate(x,y-(row===0?3:0));
 if(rotated&&row!==0){ctx.rotate(angle);ctx.scale(1.08,1);ctx.drawImage(atlas,0,row*32,32,32,-16,-16,32,32);}else ctx.drawImage(atlas,octant(angle)*32,row*32,32,32,-16,-16,32,32);
 ctx.restore();
 }
 if($('debug').checked){ctx.strokeStyle='#f1d292';ctx.beginPath();chain.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();for(const p of chain){ctx.fillStyle='#edbf67';ctx.fillRect(Math.round(p.x)-1,Math.round(p.y)-1,2,2);}}
}
function render(){contexts.forEach((ctx,i)=>draw(ctx,!!i));const chain=model.chain();let maxGap=0;for(let i=1;i<chain.length;i++)maxGap=Math.max(maxGap,Math.hypot(chain[i].x-chain[i-1].x,chain[i].y-chain[i-1].y));$('status').textContent=`${model.paused?'Idle':'Moving'} · ${chain.length-2} body pieces · ${((chain.length-1)*SPACING/24).toFixed(1)} cells long · largest joint spacing ${maxGap.toFixed(2)}px · simulation 120Hz`;$('pause').textContent=model.paused?'Resume':'Pause';}
function frame(t){if(!last)last=t;pending+=Math.min((t-last)/1000,.25);last=t;const interval=1/Number($('fps').value);if(pending>=interval){const dt=pending;pending=0;model.advance(dt);render();}requestAnimationFrame(frame);}
function restart(){model=new Model($('route').value);render();} $('route').onchange=restart;$('restart').onclick=restart;$('pause').onclick=()=>{model.paused=!model.paused;render();};$('reverse').onclick=()=>{model.paused=false;model.reverse();};$('debug').onchange=render;$('curves').onchange=render;
for(const id of ['native','rotated']){const el=$(id);const steer=e=>{const r=el.getBoundingClientRect();model.pointer={x:(e.clientX-r.left)*432/r.width,y:(e.clientY-r.top)*320/r.height};model.paused=false;};el.onpointerdown=e=>{el.setPointerCapture(e.pointerId);steer(e);};el.onpointermove=e=>{if(e.buttons)steer(e);};}
atlas.onload=()=>{window.prototypeReady=true;render();requestAnimationFrame(frame);};atlas.onerror=()=>{$('status').textContent='Could not load parts.png';};atlas.src='parts.png';
window.serpentDraft={get model(){return model;},render,contexts};
