'use strict';
const palette=['#332f23','#66663d','#7f7f46','#99994c','#b2b247','#cccc47'];
const variants=[
 {id:'native',name:'Native tuft layers',planes:8,kind:'native',desc:'The actual 16px RA grass sprite, repeated as small crossed tufts. Closest source match; airy gaps remain.'},
 {id:'fans',name:'Broad olive fans',planes:10,kind:'fans',desc:'Wider stepped leaves and dark clustered roots. Distinct fan silhouettes with darker gaps between clumps.'},
 {id:'bent',name:'Bent blade clusters',planes:10,kind:'bent',desc:'Long, hooked tips and grouped highlights. More obviously grass, with a soft, uneven upper edge.'},
 {id:'dense',name:'Dense mixed clumps',planes:14,kind:'dense',desc:'Broad fans with native tufts tucked between them. Better coverage from multiple headings; higher alpha overdraw.'}
];
const state={variant:0,angle:0,light:1,cleared:false,inside:false};
const images={},renderers=[];let detail;
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function solid(c){if(!images[c]){const im=canvas(2,2),g=im.getContext('2d');g.fillStyle=c;g.fillRect(0,0,2,2);images[c]=im;}return c;}
function makeTexture(kind,seed){
 const im=canvas(16,16),g=im.getContext('2d');let s=seed;
 const rand=()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296);
 const dot=(x,y,w,h,col)=>{g.fillStyle=palette[col];g.fillRect(x,y,w,h);};
 // A handful of broad leaves share each root, with stepped pixel edges.
 const root=7+seed%3;
 for(let i=0;i<4;i++){
  const tip=1+Math.floor(rand()*6),end=[1,5,11,15][i]+Math.floor(rand()*2)-1;
  for(let y=15;y>=tip;y--){const t=(15-y)/(15-tip),bend=kind==='bent'?t*t:t*.75+t*t*.25;
   const x=Math.round(root+(end-root)*bend),w=y<=tip+1?1:(kind==='fans'&&t>.3&&t<.8?3:2);
   dot(x-1,y,w+1,1,0);dot(x,y,w,1,1+(i%2));
   if(y<13&&y>tip)dot(x+(end<root?0:w-1),y,1,1,3);
   if(y<tip+4&&i%2===0)dot(x,y,1,1,4);
  }
 }
 dot(root-1,13,3,3,1);dot(root,12,1,3,2);
 // Deliberate empty bites between crowns keep the top from reading as a lid.
 return im;
}
function model(){return {batches:new Map()};}
function triangle(m,key,verts,light=1){if(!m.batches.has(key))m.batches.set(key,[]);for(const v of verts)m.batches.get(key).push(...v,light);}
function quad(m,key,points,light=1){const uv=[[.001,.999],[.999,.999],[.999,.001],[.001,.001]];for(const ids of [[0,1,2],[0,2,3]])triangle(m,key,ids.map(i=>[...points[i],...uv[i]]),light);}
function box(m,x,y,z,w,d,h,color){const a=x-w/2,b=x+w/2,c=y-d/2,e=y+d/2,t=z+h,k=solid(color);quad(m,k,[[a,c,t],[b,c,t],[b,e,t],[a,e,t]]);quad(m,k,[[a,e,z],[b,e,z],[b,e,t],[a,e,t]],.8);quad(m,k,[[a,c,z],[a,e,z],[a,e,t],[a,c,t]],.7);quad(m,k,[[b,e,z],[b,c,z],[b,c,t],[b,e,t]],.9);quad(m,k,[[b,c,z],[a,c,z],[a,c,t],[b,c,t]],.75);}
function blade(m,key,x,y,width,height,angle,lean=0){const dx=Math.cos(angle)*width/2,dy=Math.sin(angle)*width/2;quad(m,key,[[x-dx,y-dy,0],[x+dx,y+dy,0],[x+dx+lean,y+dy,height],[x-dx+lean,y-dy,height]],1);}
function grass(m,v,x,y,seed=0){
 for(let j=0;j<v.planes/2;j++){
  if(v.kind==='native'){
   const px=x+(j%2?8:-8),py=y+(j<2?-8:8);blade(m,'native',px,py,23,21+(j%2)*3,0);blade(m,'native',px,py,23,21+(j%2)*3,Math.PI/2);
  }else{
   const positions=[[-9,-9],[9,-8],[-8,9],[9,9],[0,0],[-1,-12],[1,12]],p=positions[j];
   const shift=(seed+j)%3-1,tex=v.kind==='dense'&&j%3===0?'native':`${v.kind==='bent'?'bent':'fans'}${(seed+j)%3}`;
   const h=20+(j+seed)%5,lean=v.kind==='bent'?((j%2?1:-1)*2):0;
   blade(m,tex,x+p[0]+shift,y+p[1],24,h,0,lean);blade(m,tex,x+p[0],y+p[1]-shift,24,h,Math.PI/2,lean);
  }
 }
}
function hedge(m,x,y,length=96,vertical=false){
 const w=vertical?16:length,d=vertical?length:16;
 const faces=WallMaterials.geometry('hedge',[{x:x-w/2,y:y-d/2},{x:x+w/2,y:y-d/2},{x:x+w/2,y:y+d/2},{x:x-w/2,y:y+d/2}],11);
 for(const f of faces){const light=f.normal?.y>0?.88:f.normal?.x<0?.78:1;triangle(m,'wall',f.points.map(p=>[p.x,p.y,p.z,p.u,p.v]),light);}
}
function person(m,x,y){box(m,x-3,y,0,4,5,12,'#514832');box(m,x+3,y,0,4,5,12,'#514832');box(m,x,y,12,12,7,14,'#b29b5c');box(m,x,y,26,11,9,10,'#6c7546');box(m,x,y+4.8,28,6,1,5,'#282c21');}
function patch(v,native=false){const m=model();if(native){box(m,0,0,-1,88,42,1,'#363d2b');grass(m,v,-20,0);hedge(m,25,0,32);}else{box(m,0,20,-1,180,116,1,'#363d2b');hedge(m,69,23,96,true);for(let y=0;y<2;y++)for(let x=-1;x<=1;x++)grass(m,v,x*32-16,8+y*32,x+3+y*3);}return m;}
function rebuildDetail(){const m=model(),v=variants[state.variant];box(m,0,0,-1,288,206,1,'#363d2b');hedge(m,113,0,160,true);for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)if(!state.cleared||x||y)grass(m,v,x*32,y*32,x+2+(y+2)*5);box(m,0,0,0,12,9,8,'#8e6e3c');box(m,0,4.6,3,2,1,3,'#d0bd6a');person(m,state.inside?0:-105,state.inside?32:36);detail.setModel(m);document.getElementById('selected-name').textContent=v.name;document.getElementById('count').textContent=`· ${v.planes*2} triangles / cell · ${(25-Number(state.cleared))*v.planes*2} grass triangles in this patch`;document.querySelectorAll('.card').forEach((c,i)=>c.classList.toggle('selected',i===state.variant));draw();}
function fit(r){const rect=r.canvas.getBoundingClientRect();r.canvas.width=Math.round(rect.width);r.canvas.height=Math.round(rect.height);}
function draw(){for(const r of renderers){fit(r);r.draw(state.angle,r.native?1:Math.min(r.canvas.width/210,r.canvas.height/120),state.light);}if(detail){fit(detail);detail.draw(state.angle,Math.min(detail.canvas.width/310,detail.canvas.height/215),state.light);}}
async function boot(){
 const src=new Image();src.src='assets/ra-grass.png';await src.decode();images.native=src;
 for(const kind of ['fans','bent'])for(let i=0;i<3;i++)images[kind+i]=makeTexture(kind,120+i*311);
 // Use the shipping painter and mesh, including bevels and atlas UVs.
 let wallCanvas;const scene={textures:{exists:()=>false,createCanvas:(_key,w,h)=>{wallCanvas=canvas(w,h);return {getContext:()=>wallCanvas.getContext('2d'),getSourceImage:()=>wallCanvas,refresh(){},setFilter(){}};}}};WallMaterials.prepare(scene);images.wall=wallCanvas;
 const cards=document.getElementById('cards'),strip=document.getElementById('native-strip');
 variants.forEach((v,i)=>{
  const card=document.createElement('article');card.className='card';card.innerHTML=`<canvas aria-label="${v.name} beside current hedge wall"></canvas><div class="copy"><button data-select="${i}">Inspect field</button><div class="tag">0${i+1} · ${v.planes*2} TRIANGLES / CELL</div><h2>${v.name}</h2><p>${v.desc}</p><div class="swatches">${palette.map(c=>`<span style="background:${c}"></span>`).join('')}</div><p>Left: 3 × 2 grass cells · right: current hedge wall</p></div>`;cards.append(card);
  const r=new TileReviewRenderer(card.querySelector('canvas'),images);r.setModel(patch(v));renderers.push(r);
  const fig=document.createElement('figure');fig.innerHTML=`<canvas aria-label="${v.name} at game scale"></canvas><figcaption>${v.name}</figcaption>`;strip.append(fig);const small=new TileReviewRenderer(fig.querySelector('canvas'),images);small.native=true;small.setModel(patch(v,true));renderers.push(small);
 });
 detail=new TileReviewRenderer(document.getElementById('detail'),images);rebuildDetail();
 document.querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>{state.variant=Number(b.dataset.select);rebuildDetail();});
 document.getElementById('angle').oninput=e=>{state.angle=Number(e.target.value)*Math.PI/180;draw();};document.getElementById('quarter').onclick=()=>{state.angle=(state.angle+Math.PI/4)%(Math.PI*2);document.getElementById('angle').value=Math.round(state.angle*180/Math.PI);draw();};
 document.getElementById('light').onchange=e=>{state.light=Number(e.target.value);draw();};document.getElementById('clear').onclick=()=>{state.cleared=!state.cleared;document.getElementById('clear').textContent=state.cleared?'Regrow centre square':'Clear centre square';rebuildDetail();};document.getElementById('walk').onclick=()=>{state.inside=!state.inside;rebuildDetail();};document.getElementById('reset').onclick=()=>{state.inside=false;state.cleared=false;document.getElementById('clear').textContent='Clear centre square';rebuildDetail();};window.addEventListener('resize',draw);
 window.raGrass={state,variants,renderers,detail,grass,model,rebuildDetail,draw};
}
boot().catch(e=>{document.getElementById('selected-name').textContent='Could not load review: '+e.message;throw e;});
