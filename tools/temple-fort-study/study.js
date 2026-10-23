/* Recipe-driven experiments, isolated from production building selection.
   Architectural shells borrow the shipping CityBuildings builder unchanged. */
(async()=>{
'use strict';
const $=id=>document.getElementById(id),P=(x,y,z)=>({x,y,z}),images={};
const designs=await (await fetch('study.json')).json();
const materialNames=['temple-pale','temple-dark','temple-wall','temple-dark-wall','temple-warm-floor','temple-worn-floor','temple-roof','temple-rose-roof','column-shaft','column-top','stone','stone-top','timber','paving','grass'];
async function load(key,path){images[key]=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Missing study image: '+path));im.src=path;});}
await Promise.all([...materialNames.map(k=>load(k,'materials/'+k+'.png')),load('city_storefront','city-storefront.png'),load('city_gearhouse','city-gearhouse.png')]);
// Material assembly follows the shipping preparation path; transparent sprite
// margins are extended before being wrapped onto a closed physical shell.
for(const key of ['city_storefront','city_gearhouse']){
 const im=images[key],source=document.createElement('canvas');source.width=im.width;source.height=im.height;const ctx=source.getContext('2d');ctx.drawImage(im,0,0);
 const p=ctx.getImageData(0,0,im.width,im.height),queue=[],seen=new Uint8Array(im.width*im.height);for(let i=0;i<seen.length;i++)if(p.data[i*4+3]>=250){seen[i]=1;queue.push(i);}for(let head=0;head<queue.length;head++){const i=queue[head],x=i%im.width;for(const j of [x?i-1:-1,x<im.width-1?i+1:-1,i-im.width,i+im.width])if(j>=0&&j<seen.length&&!seen[j]){seen[j]=1;queue.push(j);for(let c=0;c<3;c++)p.data[j*4+c]=p.data[i*4+c];p.data[j*4+3]=255;}}ctx.putImageData(p,0,0);
 const atlas=document.createElement('canvas');atlas.width=512;atlas.height=1024;CityBuildings.prepare(atlas.getContext('2d'),source,CityBuildings.specs[key],key);images[key]=atlas;
 // Copper roof variant preserves source luminance and neutral metal texels.
 const copper=document.createElement('canvas');copper.width=512;copper.height=1024;const cc=copper.getContext('2d');cc.drawImage(atlas,0,0);const pixels=cc.getImageData(0,0,512,1024);
 for(let i=0;i<pixels.data.length;i+=4){const rgb=[...pixels.data.slice(i,i+3)],hi=Math.max(...rgb),lo=Math.min(...rgb);if(hi-lo<9||hi<30)continue;const l=(hi+lo)/510,s=.59*.8+(hi-lo)/255/(1-Math.abs(2*l-1))*.2,ch=(1-Math.abs(2*l-1))*s,m=l-ch/2;[ch,ch*.4,0].forEach((v,c)=>pixels.data[i+c]=Math.round((v+m)*255));}cc.putImageData(pixels,0,0);images[key+'-copper']=copper;
}
function painted(name,draw){const c=document.createElement('canvas');c.width=c.height=32;draw(c.getContext('2d'));images[name]=c;}
painted('rune',c=>{c.strokeStyle='#a9f5e9';c.lineWidth=2;c.beginPath();c.moveTo(16,5);c.lineTo(24,13);c.lineTo(16,21);c.lineTo(8,13);c.closePath();c.moveTo(16,5);c.lineTo(16,27);c.stroke();});
painted('rune-dormant',c=>{c.drawImage(images.rune,0,0);c.globalCompositeOperation='source-in';c.fillStyle='#627e80';c.fillRect(0,0,32,32);});
painted('dice',c=>{c.fillStyle='#674731';c.fillRect(0,0,32,32);c.fillStyle='#d5b780';c.fillRect(3,3,26,26);c.fillStyle='#382c2b';for(const [x,y]of [[8,8],[20,8],[14,14],[8,20],[20,20]])c.fillRect(x,y,4,4);});
class Assembly{
 constructor(){this.batches=new Map();this.faceCount=0;}
 poly(points,key,uv){const a=points[0],b=points[1],c=points[2],ab=P(b.x-a.x,b.y-a.y,b.z-a.z),ac=P(c.x-a.x,c.y-a.y,c.z-a.z),n=P(ab.y*ac.z-ab.z*ac.y,ab.z*ac.x-ab.x*ac.z,ab.x*ac.y-ab.y*ac.x),len=Math.hypot(n.x,n.y,n.z)||1;const light=.82+.18*Math.max(0,(-n.x*.3+n.y*.4+n.z*.85)/len);
 const data=this.batches.get(key)||[];this.batches.set(key,data);for(let i=1;i+1<points.length;i++){for(const j of [0,i,i+1]){const p=points[j];data.push(p.x,p.y,p.z,uv[j][0],uv[j][1],light);}this.faceCount++;}}
 surface(points,key,density=.62){const a=points[0],b=points[1],d=points.at(-1),L=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z),D=Math.hypot(d.x-a.x,d.y-a.y,d.z-a.z);this.poly(points,key,[[0,0],[L/(images[key].width*density),0],[L/(images[key].width*density),D/(images[key].height*density)],[0,D/(images[key].height*density)]]);}
 box(x,y,w,d,z,h,side,top=side){const p=[P(x,y,z),P(x+w,y,z),P(x+w,y+d,z),P(x,y+d,z)];for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4];this.surface([a,b,{...b,z:z+h},{...a,z:z+h}],side);}this.surface(p.map(a=>({...a,z:z+h})),top);}
 roof(x,y,w,d,z,rise,key,trim,alongY=false){if(alongY){const m=x+w/2;this.surface([P(x,y,z),P(m,y,z+rise),P(m,y+d,z+rise),P(x,y+d,z)],key);this.surface([P(m,y,z+rise),P(x+w,y,z),P(x+w,y+d,z),P(m,y+d,z+rise)],key);for(const yy of [y,y+d])this.poly([P(x,yy,z),P(x+w,yy,z),P(m,yy,z+rise)],trim,[[0,0],[w/10,0],[w/20,rise/10]]);return;}const m=y+d/2;this.surface([P(x,y,z),P(x+w,y,z),P(x+w,m,z+rise),P(x,m,z+rise)],key);this.surface([P(x,m,z+rise),P(x+w,m,z+rise),P(x+w,y+d,z),P(x,y+d,z)],key);for(const xx of [x,x+w])this.poly([P(xx,y,z),P(xx,y+d,z),P(xx,m,z+rise)],trim,[[0,0],[w/10,0],[w/20,rise/10]]);}
 sign(x,y,z){this.poly([P(x-4,y,z),P(x+4,y,z),P(x+4,y,z+8),P(x-4,y,z+8)],'dice',[[0,1],[1,1],[1,0],[0,0]]);}
 city(key,scale,x,y,polygon){const spec=CityBuildings.specs[key],faces=CityBuildings.build({},spec,key,polygon);for(const f of faces){if(!$('roofs').checked&&f.kind==='roof')continue;this.poly(f.points.map(p=>P(p.x*scale+x,p.y*scale+y,p.z*scale+3)),f.kind==='roof'?key+'-copper':key,f.points.map(p=>[p.tu,p.tv]));}}
}
const nativeTemple=(m,dark)=>dark?{floor:'temple-dark',wall:'temple-dark-wall',cap:'temple-dark',shaft:'temple-dark-wall',roof:'temple-dark'}:m==='court'?{floor:'temple-pale',wall:'temple-wall',cap:'temple-pale',shaft:'temple-wall',roof:'temple-pale'}:{floor:'temple-warm-floor',wall:'stone',cap:'stone-top',shaft:'column-shaft',roof:'temple-roof'};
function steps(a,width,front,top,wall,cap){for(let i=0;i<3;i++)a.box(-width/2,front-i*5,width,5,0,(i+1)*top/3,wall,cap);}
function column(a,x,y,z,h,t){a.box(x-4,y-4,8,8,z,2,t.wall,t.cap);a.box(x-2.5,y-2.5,5,5,z+2,h-4,t.shaft,t.cap);a.box(x-4,y-4,8,8,z+h-2,2,t.wall,t.cap);}
function altar(a,z,t){a.box(-13,-11,26,22,z,3,t.wall,t.cap);a.box(-8,-7,16,14,z+3,7,t.wall,t.cap);const rune=$('condition').value==='1'?'rune':'rune-dormant';a.poly([P(-7,-7,z+10.1),P(7,-7,z+10.1),P(7,7,z+10.1),P(-7,7,z+10.1)],rune,[[0,0],[1,0],[1,1],[0,1]]);}
function foundation(a,t){a.box(-74,-58,148,116,0,6,t.wall,t.floor);a.box(-69,-53,138,106,6,2,t.wall,t.floor);steps(a,30,65,8,t.wall,t.cap);}
function palisade(a,kind='timber'){
 const side=(x,y,w,d)=>{a.box(x,y,w,d,3,18,kind,kind);};side(-72,-56,144,3);side(-72,-56,3,112);side(69,-56,3,112);side(-72,53,57,3);side(15,53,57,3);
 // Continuous textured panels keep the post grain in 2D; only corners and
 // portal supports spend geometry on an upright silhouette.
 for(const [x,y]of [[-72,-56],[69,-56],[-72,53],[69,53],[-18,53],[15,53]]){a.box(x-1,y-1,5,5,3,21,kind);a.box(x-1.5,y-1.5,6,6,24,1,'stone-top');}
 a.box(-16,53,32,4,23,5,kind);a.sign(0,57.2,22);
}
function model(recipe){const a=new Assembly(),dark=$('stone').value==='dark';a.box(-108,-90,216,180,-2,1,'grass');a.box(-16,52,32,36,-.9,.3,'paving');
 if(recipe.type==='temple'){
 const t=nativeTemple(recipe.id,dark);foundation(a,t);
 if(recipe.id==='court'){
  a.box(-69,-53,138,4,8,7,t.wall,t.cap);for(const x of [-69,65])a.box(x,-49,4,102,8,7,t.wall,t.cap);for(const x of [-69,19])a.box(x,49,50,4,8,7,t.wall,t.cap);
  for(const [x,y]of [[-62,-46],[62,-46],[-62,46],[62,46]])a.box(x-4,y-4,8,8,8,11,t.wall,t.cap);altar(a,8,t);
  // Low rune stones emphasize the sacred boundary without tower silhouettes.
  for(const x of [-40,40]){a.box(x-5,-32,10,8,8,15,t.wall,t.cap);a.poly([P(x-4,-23.9,11),P(x+4,-23.9,11),P(x+4,-23.9,21),P(x-4,-23.9,21)],$('condition').value==='1'?'rune':'rune-dormant',[[0,1],[1,1],[1,0],[0,0]]);}
 }else if(recipe.id==='cloister'){
  a.box(-65,-49,130,5,8,13,t.wall,t.cap);for(const x of [-62,62])a.box(x-3,-46,6,92,8,5,t.wall,t.cap);
  for(const x of [-57,57])for(const y of [-36,0,36])column(a,x,y,8,26,t);
  for(const x of [-57,57])a.box(x-5,-44,10,88,34,3,t.wall,t.cap);
  if($('roofs').checked){for(const x of [-70,49])a.roof(x,-49,21,98,37,6,t.roof,t.wall,true);a.roof(-70,-54,140,23,37,6,t.roof,t.wall);}
  altar(a,8,t);a.box(-22,-47,44,18,8,21,t.wall,t.cap);
 }else{
  a.box(-52,-41,104,82,8,4,t.wall,t.floor);a.box(-42,-36,84,65,12,4,t.wall,t.floor);steps(a,30,50,16,t.wall,t.cap);
  a.box(-35,-31,70,4,16,26,t.wall,t.cap);for(const x of [-35,31])a.box(x,-27,4,48,16,26,t.wall,t.cap);
  for(const x of [-31,27])for(const y of [-23,21])column(a,x,y,16,26,t);
  a.box(-39,-35,78,64,42,3,t.wall,t.cap);if($('roofs').checked){a.roof(-43,-39,86,72,45,12,t.roof,t.wall);a.box(-44,-4,88,3,57,1.5,t.wall,t.cap);}altar(a,16,t);
 }
 }else{
 a.box(-74,-58,148,116,0,3,'stone','paving');
 if(recipe.id==='continuous'){
  const ring=[[0,0],[360,0],[360,280],[220,280],[220,224],[290,224],[290,66],[70,66],[70,224],[140,224],[140,280],[0,280]];
  a.city('city_storefront',.4,-72,-56,ring);a.box(-16,51,32,5,27,7,'timber','stone-top');a.sign(0,56.2,25);
 }else if(recipe.id==='palisade'){
  palisade(a);a.city('city_gearhouse',.4,-16,-39);a.sign(0,12.5,10);
 }else{
  palisade(a,'stone');a.city('city_storefront',.38,-34,-44);a.sign(0,-9.8,11);
  for(const x of [-52,38]){a.box(x,-44,14,24,3,10,'timber','timber');a.box(x-1,-45,16,26,13,2,'timber');}
 }
 }
 // One 32-unit floor tile supplies a common, unambiguous scale reference.
 a.box(78,49,32,32,-.8,.2,'paving');return a;
}
const panels=[];let selected=null,spinning=false,last=0,dirty=true,largeRenderer=null;
for(const recipe of designs){const article=document.createElement('article');article.className='card';article.dataset.design=recipe.id;article.innerHTML=`<canvas width="480" height="340" aria-label="${recipe.name}, rotatable 3D design"></canvas><div class="body"><span class="tag">${recipe.code} / ${recipe.family}</span><h3>${recipe.name}</h3><p>${recipe.description}</p><button class="pick">Inspect ${recipe.code} ↗</button></div>`;$(recipe.type==='temple'?'temples':'forts').append(article);const renderer=new TileReviewRenderer(article.querySelector('canvas'),images);panels.push({recipe,renderer,article});article.querySelector('button').onclick=()=>open(recipe);drag(article.querySelector('canvas'));}
function rebuild(){for(const p of panels)p.renderer.setModel(model(p.recipe));if(selected)largeRenderer.setModel(model(selected));dirty=true;}
function open(recipe){selected=recipe;$('detail-title').textContent=recipe.code+' · '+recipe.name;$('detail-copy').textContent=recipe.description;$('detail').classList.add('open');$('close').focus();if(!largeRenderer){largeRenderer=new TileReviewRenderer($('large'),images);drag($('large'));}largeRenderer.setModel(model(recipe));dirty=true;}
function close(){$('detail').classList.remove('open');selected=null;}
function toggleSpin(){spinning=!spinning;for(const id of ['spin','detail-spin']){$(id).textContent=spinning?'Pause rotation':'Auto rotate';$(id).classList.toggle('active',spinning);}}
function drag(canvas){let start=null;canvas.onpointerdown=e=>{start={x:e.clientX,heading:+$('heading').value};canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(start){$('heading').value=(start.heading+(e.clientX-start.x)*.6+720)%360;dirty=true;}};canvas.onpointerup=canvas.onpointercancel=()=>start=null;}
$('close').onclick=close;document.onkeydown=e=>{if(e.key==='Escape')close();};$('spin').onclick=$('detail-spin').onclick=toggleSpin;$('north').onclick=$('detail-north').onclick=()=>{$('heading').value=0;dirty=true;};$('heading').oninput=$('scale').onchange=()=>dirty=true;for(const id of ['condition','stone','roofs'])$(id).onchange=rebuild;
for(const [key,label]of [['temple-pale','Sanctuary slab'],['temple-warm-floor','Temple paving'],['column-shaft','Column shaft'],['temple-roof','Stone roof'],['timber','Village timber'],['paving','Ruins paving']]){$('materials').insertAdjacentHTML('beforeend',`<div class="swatch"><img src="materials/${key}.png" alt="${label}">${label}</div>`);}
function frame(t){if(spinning){$('heading').value=(+$('heading').value+(t-last)*.012)%360;dirty=true;}if(dirty){const heading=+$('heading').value*Math.PI/180,zoom=+$('scale').value,condition=+$('condition').value;for(const p of panels)p.renderer.draw(heading,zoom,condition);if(selected)largeRenderer.draw(heading,zoom*1.8,condition);$('degrees').textContent=Math.round(+$('heading').value)+'°';dirty=false;}last=t;requestAnimationFrame(frame);}
rebuild();$('status').textContent='6 designs · 2D source tiles → retained 3D meshes';window.study={panels,images,rebuild,get largeRenderer(){return largeRenderer;}};window.ready=true;requestAnimationFrame(frame);
})().catch(error=>{document.getElementById('status').textContent=error.message;console.error(error);});
