/* Five original Steampunk City tile-B-03 buildings. Fine detail stays in art;
   only shells, roofs, stacks and large attached equipment use geometry. */
(function(root){
 const C=Math.cos(Math.PI/6);
 const specs={
  city_factory:{label:'Steampunk City · three-stack factory',image:'city-factory.png',crop:[0,0,192,192],left:16,right:160,base:192,eave:120,peak:28,back:78,backPeak:0,center:88,depth:42,wall:[90,135,10,12],posts:[16,20,156,160],bands:[120,125,188,192],door:[109,155,31,37],entry:[103,145,42,47],city:true},
  city_storefront:{label:'Steampunk City · copper storefront',image:'city-storefront.png',crop:[0,0,192,192],left:6,right:186,base:192,eave:104,peak:55,back:60,backPeak:0,center:96,depth:44,wall:[20,138,40,48],posts:[6,12,180,186],bands:[104,123,139,184,192],door:[80,153,32,37],entry:[72,141,43,51],city:true},
  city_gearhouse:{label:'Steampunk City · gear-front house',image:'city-gearhouse.png',crop:[0,0,96,192],left:8,right:88,base:192,eave:112,peak:72,back:48,backPeak:8,center:48,depth:64,wall:[11,144,12,44],posts:[8,13,83,88],bands:[112,117,145,150,190,192],door:[38,164,21,28],entry:[33,150,31,42],city:true,gabled:true},
  city_chimney:{label:'Steampunk City · chimney tower',image:'city-chimney.png',crop:[0,0,96,192],left:22,right:74,base:192,eave:136,peak:40,back:108,backPeak:0,center:48,depth:18,wall:[28,138,6,20],posts:[22,28,68,74],bands:[136,140,192],door:[36,163,24,29],city:true,cityTower:true},
  city_clock:{label:'Steampunk City · short clock tower',image:'city-clock.png',crop:[0,0,96,192],left:22,right:74,base:192,eave:136,peak:64,back:108,backPeak:0,center:48,depth:18,wall:[28,138,6,20],posts:[22,28,68,74],bands:[136,140,192],door:[36,163,24,29],city:true,cityTower:true}
 };
 function prepare(ctx,image,spec,key){
  if(spec.cityTower)return CityTowers.prepare(ctx,image,spec,key);
  ctx.drawImage(image,0,16);
  const source=document.createElement('canvas');source.width=image.width;source.height=image.height;const g=source.getContext('2d');g.drawImage(image,0,0);
  const color=(x,y)=>{const p=g.getImageData(x,y,1,1).data;return `rgb(${p[0]},${p[1]},${p[2]})`;};
  const W=spec.right-spec.left,H=spec.base-spec.eave;
  const facade=document.createElement('canvas');facade.width=W;facade.height=H;const f=facade.getContext('2d');f.imageSmoothingEnabled=false;f.drawImage(image,spec.left,spec.eave,W,H,0,0,W,H);
  if(key==='city_factory'){
   // Retain brick and original fittings, replacing the full entrance framing.
   for(let y=145;y<192;y+=12)for(let x=101;x<146;x+=10)f.drawImage(image,90,135,Math.min(10,146-x),Math.min(12,192-y),x-spec.left,y-spec.eave,Math.min(10,146-x),Math.min(12,192-y));
  }else if(key==='city_storefront'){
   // A third shop window replaces the door and its pilasters on inferred faces.
   f.drawImage(image,16,138,47,54,67,34,47,54);
  }else{
   for(let x=32;x<65;x+=12)f.drawImage(image,12,150,Math.min(12,65-x),42,x-spec.left,150-spec.eave,Math.min(12,65-x),42);
   f.drawImage(image,16,162,14,22,32,50,14,22);
  }
  // Complete doorless material bays; distinctive front ornament never repeats.
  if(key==='city_factory'){
   for(let y=5;y<H-4;y+=12)for(let x=4;x<W-4;x+=10){const w=Math.min(10,W-4-x),h=Math.min(12,H-4-y);f.drawImage(image,90,135,w,h,x,y,w,h);}
   for(const x of [22,102])f.drawImage(image,121,128,16,16,x,8,16,16);
  }
  if(key==='city_gearhouse'){
   ctx.drawImage(image,0,0,96,192,0,400,96,192);
   // Local repair of the painted chimney; all other native roof pixels survive.
   for(let y=31;y<56;y+=10)for(let x=14;x<28;x+=5)ctx.drawImage(image,30,60,Math.min(5,28-x),Math.min(10,56-y),x,400+y,Math.min(5,28-x),Math.min(10,56-y));
   ctx.drawImage(image,8,72,80,40,0,220,80,40);
   ctx.fillStyle=color(34,101);ctx.fillRect(27,229,26,28);
   ctx.fillStyle=color(31,104);ctx.fillRect(27,244,26,1);
   ctx.fillStyle=color(40,106);ctx.fillRect(39,229,2,28);
  }
  if(key==='city_storefront'){
   // Clean copper band above the windows, including the sign, gear and fittings.
   for(let x=6;x<W-6;x+=12){const w=Math.min(12,W-6-x);f.drawImage(image,166,104,w,47,x,0,w,47);}
   for(let i=0;i<3;i++)f.drawImage(image,123,151,55,41,6+i*56,47,55,41);
  }
  for(let x=0;x<256;x+=W)ctx.drawImage(facade,x,900);
  const quiet=key==='city_factory'?[89,120,12,72]:key==='city_storefront'?[61,104,6,88]:[14,112,3,80];
  if(key==='city_storefront'){
   for(let y=0;y<H;y++){ctx.drawImage(image,y<47?174:181,spec.eave+y,1,1,256,900+y,256,1);ctx.drawImage(image,y<47?174:181,spec.eave+y,1,1,0,500+y,88,1);}
   ctx.drawImage(image,123,151,55,41,16,547,55,41);
   ctx.drawImage(image,6,104,6,88,0,500,6,88);ctx.drawImage(image,180,104,6,88,82,500,6,88);
  }else for(let x=256;x<512;x+=quiet[2])ctx.drawImage(image,...quiet,x,900,quiet[2],H);
  // Roof courses are orthogonal in surface space. They use source copper and
  // masonry texels, without retaining the raster's painted perspective steps.
  const base=color(...(spec.gabled?[24,70]:key==='city_factory'?[64,110]:[117,82]));
  const dark=color(...(spec.gabled?[23,74]:key==='city_factory'?[64,112]:[118,81]));
  const light=color(...(spec.gabled?[27,70]:key==='city_factory'?[65,113]:[120,75]));
  ctx.fillStyle=base;ctx.fillRect(256,616,256,256);
  ctx.save();ctx.beginPath();ctx.rect(256,616,240,240);ctx.clip();
  if(spec.gabled){for(let y=0;y<240;y+=20)for(let x=-40;x<240;x+=40){const xx=256+x+(y/20%2)*20;ctx.fillStyle=dark;ctx.fillRect(xx,616+y,1,20);ctx.fillRect(xx,616+y,40,1);ctx.fillStyle=light;ctx.fillRect(xx+1,617+y,38,1);}}
  else{for(let y=0;y<240;y+=28)for(let x=0;x<240;x+=38){ctx.fillStyle=dark;const xx=256+x+(y/28%2)*15;ctx.fillRect(xx,616+y,14,1);ctx.fillRect(xx+14,616+y,1,8);}}
  // Restrained irregular source-colored wear, in surface coordinates.
  for(let i=0;i<180;i++){const x=256+(i*67%237),y=616+(i*43%237);ctx.globalAlpha=.22;ctx.fillStyle=i%3?light:dark;ctx.fillRect(x,y,1+i%4,1);}
  ctx.globalAlpha=1;
  ctx.restore();ctx.fillStyle=color(...(spec.gabled?[8,110]:[spec.left+2,spec.eave]));ctx.fillRect(500,616,4,256);ctx.fillStyle=color(...(spec.gabled?[47,37]:[spec.left+4,spec.eave]));ctx.fillRect(504,616,4,256);ctx.fillStyle=light;ctx.fillRect(508,616,4,256);
  if(spec.gabled){
   const pixels=ctx.getImageData(256,616,256,256),palette=[[24,70],[23,74],[27,70]].map(p=>[...g.getImageData(...p,1,1).data]),other=[[64,70],[65,70],[67,73]].map(p=>[...g.getImageData(...p,1,1).data]);
   for(let i=0;i<pixels.data.length;i+=4){const j=palette.findIndex(p=>p[0]===pixels.data[i]&&p[1]===pixels.data[i+1]&&p[2]===pixels.data[i+2]);if(j>=0)for(let k=0;k<3;k++)pixels.data[i+k]=other[j][k];}
   ctx.putImageData(pixels,256,320);
  }
  if(!spec.gabled)for(let i=0;i<8;i++)ctx.drawImage(image,spec.left+Math.floor(i*(key==='city_factory'?4:7)/8),key==='city_factory'?110:80,1,1,220+i,300,1,4);
  if(!spec.gabled){
   const deck=key==='city_factory'?[16,78,144,42]:[6,60,180,44],patch=key==='city_factory'?[64,84,4,28]:[90,75,44,22];
   const tile=(x,y,w,h)=>{ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();for(let yy=y;yy<y+h;yy+=patch[3]*2)for(let xx=x;xx<x+w;xx+=patch[2])ctx.drawImage(image,...patch,xx,yy,patch[2],patch[3]*2);ctx.restore();};
   tile(256,616,240,240);
   // Retain original visible roof pixels in the artwork camera; remove only
   // baked equipment already represented by closed geometry above this deck.
   ctx.drawImage(image,...deck,256,616,deck[2],deck[3]*2);
   const masks=key==='city_factory'?[[24,78,40,34],[68,78,40,34],[116,78,40,34]]:[[25,60,19,24],[21,66,8,38],[21,76,62,28],[146,60,24,10],[146,70,26,20]];
   for(const [x,y,w,h] of masks)tile(256+x-deck[0],616+(y-deck[1])*2,w,h*2);
  }
  ctx.fillStyle='#292627';ctx.fillRect(200,300,4,4);
  if(key==='city_factory'||key==='city_storefront'){
   const patches=key==='city_factory'?[[32,31,20,29],[27,60,30,33],[26,91,32,18]]:[[148,58,10,24]];
   patches.forEach(([u,v,w,h],j)=>{for(let y=0;y<h;y++)for(let x=0;x<128;x++){
    // Remove baked cylindrical edge shading; horizontal bands continue around.
    const sx=u+Math.floor(w*(.35+.3*((x%32)/31)));
    ctx.drawImage(image,sx,v+y,1,1,x,300+j*64+y,1,1);
   }});
   ctx.fillStyle='#292627';ctx.fillRect(200,300,4,4);
  }
 }
 function sections(ring){const xs=[...new Set(ring.map(p=>p.x))].sort((a,b)=>a-b),ys=[...new Set(ring.map(p=>p.y))].sort((a,b)=>a-b),out=[];const inside=(x,y)=>{let v=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)v=!v;}return v;};for(let j=1;j<ys.length;j++){let start=null;for(let i=1;i<=xs.length;i++){const yes=i<xs.length&&inside((xs[i-1]+xs[i])/2,(ys[j-1]+ys[j])/2);if(yes&&start===null)start=xs[i-1];if(!yes&&start!==null){const prev=out.find(s=>s.x0===start&&s.x1===xs[i-1]&&s.y1===ys[j-1]);if(prev)prev.y1=ys[j];else out.push({x0:start,x1:xs[i-1],y0:ys[j-1],y1:ys[j]});start=null;}}}return out;}
 function build(template,spec,key,polygon){
  if(spec.cityTower)return CityTowers.build(template,spec,key,polygon);
  const W=spec.right-spec.left,H=(spec.base-spec.eave)/C,D=spec.depth*2;
  const ring=(polygon||[[0,0],[W,0],[W,D],[0,D]]).map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:{...p});validateFootprint(ring);if(ring[0].x===ring.at(-1).x&&ring[0].y===ring.at(-1).y)ring.pop();const signed=ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.x*q.y-q.x*p.y;},0)/2;if(signed<0)ring.reverse();
  const spans=sections(ring),faces=[],P=(x,y,z)=>({x,y,z}),UV=(x,y)=>[x,y+16];
  let trimStore=key==='city_storefront'&&!polygon;
  const cornerCuts=[p=>p.x+p.y*.5+(H-p.z)*C-6,p=>W-p.x+p.y*.5+(H-p.z)*C-6,p=>W-p.x+(D-p.y)*.5+(H-p.z)*C-2,p=>p.x+(D-p.y)*.5+(H-p.z)*C-2];
  const poly=(ps,uv,kind='wall')=>{if(trimStore){let vs=ps.map((p,i)=>({...p,u:uv[i][0],v:uv[i][1]}));for(const distance of cornerCuts){const next=[];for(let i=0;i<vs.length;i++){const a=vs[i],b=vs[(i+1)%vs.length],da=distance(a),db=distance(b);if(da>=-1e-8)next.push(a);if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db);next.push(Object.fromEntries(['x','y','z','u','v'].map(k=>[k,a[k]+t*(b[k]-a[k])])));}}vs=next;}ps=vs.map(({x,y,z})=>({x,y,z}));uv=vs.map(p=>[p.u,p.v]);}for(let i=1;i<ps.length-1;i++){const ix=[0,i,i+1],points=ix.map(j=>({...ps[j],tu:uv[j][0]/512,tv:uv[j][1]/1024}));faces.push({...template,points,projected:points.map(()=>({})),kind,feature:'body',sourceArt:true,layer:0,fallbackUV:[(spec.wall[0]+.5)/512,(spec.wall[1]+16.5)/1024],wallDirection:kind==='wall'?{x:points[1].x-points[0].x,y:points[1].y-points[0].y}:undefined});}};
  const constant=(ps,u=spec.wall[0]+.5,v=spec.wall[1]+.5,kind='wall')=>poly(ps,ps.map(()=>UV(u,v)),kind);
  const art=(ps,r,kind='wall')=>poly(ps,[UV(r[0]+r[2],r[1]+r[3]),UV(r[0],r[1]+r[3]),UV(r[0],r[1]),UV(r[0]+r[2],r[1])],kind);
  ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],L=Math.hypot(b.x-a.x,b.y-a.y),front=a.y===b.y&&a.x>b.x,at=(n,z,out=0)=>P(a.x+(b.x-a.x)*n/L+(b.y-a.y)*out/L,a.y+(b.y-a.y)*n/L-(b.x-a.x)*out/L,z),layout=sourceFacadeSlices(spec,L);
   if(front&&!polygon)art([at(0,0),at(L,0),at(L,H),at(0,H)],[spec.left,spec.eave,W,spec.base-spec.eave]);
   else{const side=key==='city_storefront'&&!front&&L<W,parts=side?sourceFacadeSlices({...spec,left:0,right:88,posts:[0,6,82,88]},L).parts:layout.parts;for(const [l,r,u,v] of parts){const row=side&&u<256?500:900;poly([at(l,0),at(r,0),at(r,H),at(l,H)],[[u,row+H*C],[v,row+H*C],[v,row],[u,row]]);}
    if(front&&L>spec.entry[2]+4){const [u,v,w,h]=spec.entry,t=Math.max(2,Math.min(L-w-2,layout.center-w/2)),z=(spec.base-v-h)/C;art([at(t,z,.03),at(t+w,z,.03),at(t+w,z+h/C,.03),at(t,z+h/C,.03)],[u,v,w,h]);}
   }
  });
  const planes=[],R=40/C;
  for(const s of spans){const {x0,x1,y0,y1}=s,m=(x0+x1)/2;
   constant([P(x0,y1,0),P(x1,y1,0),P(x1,y0,0),P(x0,y0,0)],spec.left+4.5,spec.base-2.5,'floor');
   if(spec.gabled){const left=[P(x0,y0,H),P(m,y0,H+R),P(m,y1,H+R),P(x0,y1,H)],right=[P(m,y0,H+R),P(x1,y0,H),P(x1,y1,H),P(m,y1,H+R)];planes.push(left,right);if(!polygon){poly(left,[[8,448],[48,408],[48,472],[8,512]],'roof');poly(right,[[48,408],[88,448],[88,512],[48,472]],'roof');}else{RoofMaterials.emit(left,key,poly);RoofMaterials.emit(right,key,(ps,uv,kind)=>poly(ps,uv.map(([u,v])=>[u,v-296]),kind));}
    poly([P(x1,y1,H),P(x0,y1,H),P(m,y1,H+R)],[UV(88,112),UV(8,112),UV(48,72)]);poly([P(x0,y0,H),P(x1,y0,H),P(m,y0,H+R)],[[0,260],[80,260],[40,220]]);
    const half=Math.min(3,(x1-x0)/8),rz=H+R+.35,rz0=H+R-2*R*half/(x1-x0)-.5,ridge=[P(m-half,y0-2,rz),P(m+half,y0-2,rz),P(m+half,y1+2,rz),P(m-half,y1+2,rz)];
    poly(ridge,[UV(45,8),UV(51,8),UV(51,72),UV(45,72)],'roof');
    for(let i=0;i<4;i++){const a=ridge[i],b=ridge[(i+1)%4];constant([{...a,z:rz0},{...b,z:rz0},b,a],47.5,43.5,'roof');}
    constant(ridge.slice().reverse().map(p=>({...p,z:rz0})),47.5,43.5,'roof');
   }else{const p=[P(x0,y0,H),P(x1,y0,H),P(x1,y1,H),P(x0,y1,H)];planes.push(p);}
  }
  if(spec.gabled)RoofMaterials.overhang(planes,ring,poly);
  else{
   const cu=key==='city_factory'?25.5:16.5,cv=key==='city_factory'?119.5:61.5;
   if(!trimStore)RoofMaterials.overhang(planes,ring,(ps,uv,kind)=>constant(ps,cu,cv,kind));
   // Partition the flat deck at the actual perimeter bands. Coping and
   // deck share one plane instead of overlapping in the 16-bit depth buffer.
   const minX=Math.min(...ring.map(p=>p.x)),maxX=Math.max(...ring.map(p=>p.x)),minY=Math.min(...ring.map(p=>p.y)),maxY=Math.max(...ring.map(p=>p.y));
   const rim=key==='city_factory'?4:7;const cuts=(axis,min,max)=>[...new Set(ring.flatMap(p=>[p[axis]-(axis==='y'?8:rim),p[axis],p[axis]+(axis==='y'?8:rim)]).filter(n=>n>=min&&n<=max))].sort((a,b)=>a-b),xs=cuts('x',minX,maxX),ys=cuts('y',minY,maxY);
   const inside=(x,y)=>spans.some(s=>x>s.x0-1e-6&&x<s.x1+1e-6&&y>s.y0-1e-6&&y<s.y1+1e-6);
   for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){
    const x0=xs[i-1],x1=xs[i],y0=ys[j-1],y1=ys[j],mx=(x0+x1)/2,my=(y0+y1)/2;if(!inside(mx,my))continue;
    const near=ring.some((a,k)=>{const b=ring[(k+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((mx-a.x)*dx+(my-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(mx-a.x-t*dx,(my-a.y-t*dy)*rim/8)<rim+.001;});
    for(let x=x0;x<x1;x+=240)for(let y=y0;y<y1;y+=240){const r=Math.min(x1,x+240),b=Math.min(y1,y+240),ps=[P(x,y,H),P(r,y,H),P(r,b,H),P(x,b,H)];if(trimStore)poly(ps,ps.map(p=>[256+p.x,616+p.y]),'roof');else if(near){const edge=ring.map((a,k)=>{const b=ring[(k+1)%ring.length],vertical=a.x===b.x;const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((mx-a.x)*dx+(my-a.y)*dy)/(dx*dx+dy*dy)));return {a,vertical,d:Math.hypot((mx-a.x-t*dx)/rim,(my-a.y-t*dy)/8)};}).sort((a,b)=>a.d-b.d)[0];poly(ps,ps.map(p=>[220.5+7*Math.min(1,edge.vertical?Math.abs(p.x-edge.a.x)/rim:Math.abs(p.y-edge.a.y)/8),301.5]),'roof');}else poly(ps,!polygon?[[256+x,616+y],[256+r,616+y],[256+r,616+b],[256+x,616+b]]:[[256,616],[256+r-x,616],[256+r-x,616+b-y],[256,616+b-y]],'roof');}
   }
  }
  if(trimStore){
   // Closed corner bevels remove unsupported rectangular padding while the
   // authored facade below each corner remains at its original projection.
   for(const [x,y,sx,sy,k,reverse] of [[0,0,1,1,6,false],[W,0,-1,1,6,true],[W,D,-1,-1,2,false],[0,D,1,-1,2,true]]){
    const ps=[P(x,y,H-k/C),P(x+sx*k,y,H),P(x,y+sy*k*2,H)];if(reverse)ps.reverse();poly(ps,ps.map(p=>UV(spec.left+p.x,spec.base-p.z*C-(D-p.y)*.5)),'roof');
   }
   trimStore=false;
  }
  const main=spans.reduce((a,b)=>(a.x1-a.x0)*(a.y1-a.y0)>(b.x1-b.x0)*(b.y1-b.y0)?a:b),mw=main.x1-main.x0,md=main.y1-main.y0;
  function box(x,y,w,d,z0,z1,r,top=r,recess=false,side=null){const ps=[P(x,y,z0),P(x+w,y,z0),P(x+w,y+d,z0),P(x,y+d,z0)];for(let i=0;i<4;i++){const a=ps[i],b=ps[(i+1)%4];art([a,b,{...b,z:z1},{...a,z:z1}],side&&i!==2?side:r);}if(recess){const outer=ps.map(p=>({...p,z:z1})),inner=[P(x+1.5,y+1.5,z1),P(x+w-1.5,y+1.5,z1),P(x+w-1.5,y+d-1.5,z1),P(x+1.5,y+d-1.5,z1)],bottom=inner.map(p=>({...p,z:z1-2}));for(let i=0;i<4;i++){const j=(i+1)%4;constant([outer[i],outer[j],inner[j],inner[i]],16.5,32.5,'roof');constant([inner[i],inner[j],bottom[j],bottom[i]],201.5,285.5);}constant(bottom,201.5,285.5,'roof');}else art(ps.map(p=>({...p,z:z1})),top,'roof');constant(ps.slice().reverse(),r[0]+.5,r[1]+.5,'floor');}
  // Eight-sided stacks preserve the major silhouettes at modest triangle cost.
  function stack(cx,cy,rx,ry,z0,z1,r,topRadius=1,n=8,open=false){
   const [u,v,w,h]=r,band=key==='city_factory'?(v===31?0:v===60?1:2):0;
   const point=(i,z,scale)=>P(cx+Math.cos(i*2*Math.PI/n)*rx*scale,cy+Math.sin(i*2*Math.PI/n)*ry*scale,z),project=p=>UV(u+w/2+p.x-cx,97-(p.z-H)*C+(p.y-cy)*.5);
   for(let i=0;i<n;i++){const ps=[point(i,z0,1),point(i+1,z0,1),point(i+1,z1,topRadius),point(i,z1,topRadius)];poly(ps,key==='city_factory'&&i<n/2?ps.map(project):[[i*128/n,300+band*64+h-.5],[(i+1)*128/n,300+band*64+h-.5],[(i+1)*128/n,300+band*64+.5],[i*128/n,300+band*64+.5]]);}
   if(open){const inner=.72*topRadius,depth=Math.min(3,(z1-z0)/4);for(let i=0;i<n;i++){
    const j=i+1;const rim=[point(i,z1,topRadius),point(j,z1,topRadius),point(j,z1,inner),point(i,z1,inner)];if(key==='city_factory')poly(rim,rim.map(project),'roof');else constant(rim,u+w*.5,v+3.5,'roof');
    poly([point(i,z1,inner),point(j,z1,inner),point(j,z1-depth,inner),point(i,z1-depth,inner)],Array(4).fill([201.5,301.5]));
   }poly(Array.from({length:n},(_,i)=>point(i,z1-depth,inner)),Array(n).fill([201.5,301.5]),'roof');}
   else constant(Array.from({length:n},(_,i)=>point(i,z1,topRadius)),u+w/2,v+2.5,'roof');
   constant(Array.from({length:n},(_,i)=>point(n-i,z0,1)),u+w/2,v+h-2.5,'floor');
  }
  if(key==='city_factory'){
   const count=Math.max(1,Math.min(3,Math.floor(mw/38))),radius=Math.min(16,mw/(count*2.6),md/3),cy=main.y1-Math.min(46,md*.6);
   for(let i=0;i<count;i++){const cx=!polygon?[25,71,117][i]:main.x0+mw*(i+.5)/count,sx=[25,71,117][i];stack(cx,cy,radius,radius*1.5,H-.5,H+18/C,[sx,91,32,18]);stack(cx,cy,radius*.95,radius*1.425,H+18/C,H+44.5/C,[sx+1,60,30,33],.65);stack(cx,cy,radius*.62,radius*.93,H+44.5/C,H+61.5/C,[sx+6,31,20,29],1,8,true);}
  }else if(key==='city_storefront'){
   const y=main.y0+md*.5,x=main.x1-Math.min(33,mw*.2),z=H+26/C;
   box(x-6,y-6,24,12,H-.5,H+3/C,[147,80,27,9],[147,80,27,9]);
   for(let i=0;i<2;i++)stack(x+i*12,y,4,4,H+2/C,z,[148+i*13,58,10,24],1,8,true);
   box(main.x0+mw*.12,main.y0+md*.18,15,13,H-.5,H+9/C,[27,58,16,22],[27,56,16,8]);
   // The large roof elbow is a simple closed copper conduit; face pipe detail
   // remains painted so it does not inflate the mesh with tiny fittings.
   const px=main.x0+mw*.1,py=main.y0+md*.54,len=Math.min(52,mw*.29),start=main.y0+md*.2;
   box(px,start,7,py-start+7,H,H+6/C,[22,71,7,19]);
   box(px,py,len,7,H,H+6/C,[40,80,35,7]);
   box(px+len-4,py,8,main.y1-py+.2,H,H+6/C,[70,84,10,19]);
  }else{
   // The source cap is a front-facing framed vent with a shallow solid lid.
   // Anchor it left of the roof ridge, where it forms the painted silhouette.
   const x=main.x0+Math.min(4,mw*.08),y=main.y0+Math.min(28,md*.22),w=Math.min(16,mw*.3),d=Math.min(4,md*.1);
   box(x+2,y,w-4,d,H+8/C,H+24/C,[14,40,12,16],[14,40,12,2],false,[14,40,2,16]);
   box(x,y,w,d,H+24/C,H+36/C,[12,28,16,12],[12,26,16,2],false,[12,28,2,12]);
  }
  faces.footprintInfo={polygon:ring,area:Math.abs(signed),physical:true,sections:spans.length,mode:spec.label};return faces;
 }
 root.CityBuildings={specs,prepare,build};
})(typeof window==='undefined'?globalThis:window);
