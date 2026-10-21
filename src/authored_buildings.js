/* Reviewed source meshes, extracted from the approved building preview. */
(function(root){
/* Source-space meshes. At heading zero each front vertex projects to its exact
   source pixel. Hidden walls are inferred; roof palettes are applied separately. */

const STEAM_BUILDERS={steam_home:SteamHome,steam_blacksmith:SteamBlacksmith,steam_wizard:SteamWizard};
const specialBuilder=key=>STEAM_BUILDERS[key]||(SPECS[key]?.city?CityBuildings:null);
const SPECS={
 ...CityBuildings.specs,
 ...Object.fromEntries(Object.entries(STEAM_BUILDERS).map(([key,helper])=>[key,helper.spec])),
 ...FlatBuildings.specs,
 wizard:WizardTower.spec,
 pp_brick:{label:'Pixel Plains · brick cottage',ppType:'brick',image:'pp-brick-red.png',crop:[0,0,96,80],left:0,right:96,base:80,eave:48,peak:0,depth:48,sideRidge:true,wall:[8,50,16,28],posts:[3,8,88,93],bands:[48,53,72,80],door:[35,55,26,25]},
 pp_plaster:{label:'Pixel Plains · plaster cottage',ppType:'plaster',image:'pp-plaster-red.png',crop:[0,0,96,80],left:0,right:96,base:80,eave:48,peak:0,depth:48,sideRidge:true,wall:[12,50,16,28],posts:[3,8,88,93],bands:[48,53,72,80],door:[35,55,26,25]},
 pp_cabin:{label:'Pixel Plains · timber cabin',ppType:'cabin',image:'pp-cabin-red.png',crop:[0,0,96,112],left:0,right:96,base:112,eave:80,peak:56,back:26,backPeak:2,center:48,depth:54,wall:[12,85,24,24],posts:[4,10,86,92],bands:[80,84,106,112],door:[36,90,24,22]},
 market:{label:'Market · approved artwork',image:'house_market.png',crop:[0,0,106,94],left:0,right:90,base:94,eave:57,peak:1,depth:56,sideRidge:true,wall:[40,59,12,33],posts:[2,8,84,90],bands:[57,61,83,94],door:[17,63,16,23],chimney:true},
 trader:{label:'Trader · approved artwork',image:'house_trader.png',crop:[0,0,76,98],left:0,right:76,base:98,eave:74,peak:54,back:52,backPeak:32,center:38,depth:22,wall:[13,87,20,9],posts:[3,9,67,73],bands:[74,82,88,98],door:[48,80,19,18],rearHouse:true,chimney:true},
 com:{label:'House · com_houses_05',image:'com_houses_05.png',crop:[160,4,64,92],left:160,right:224,base:96,eave:76,peak:60,back:20,backPeak:4,center:192,depth:56,wall:[168,76,16,20],posts:[161,165,218,222],bands:[76,80,96],door:[192,76,16,20]},
 fdr:{label:'Blacksmith · FDR_Blacksmith',image:'FDR_Blacksmith.png',crop:[112,0,112,128],left:112,right:224,base:112,eave:48,peak:0,depth:48,sideRidge:true,wall:[120,48,24,64],posts:[113,118,217,222],bands:[48,76,80,104,108,112],door:[155,80,26,26],porch:true}
};
const P=(x,y,z)=>({x,y,z});
const imageKey=key=>'authored_source_'+key;
const specFor=key=>SPECS[key];
// Extend opaque artwork to the physical shell boundary. Sprite transparency is
// a cutout convention, not a different material at wall and roof corners.
function extendSourceEdges(image,spec,key){
 const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
 const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0);
 const [x,y,w,h]=spec.crop,data=ctx.getImageData(x,y,w,h),p=data.data,queue=new Int32Array(w*h),seen=new Uint8Array(w*h);let head=0,tail=0;
 // Ignore nearly transparent export fringe colors when extending City art edges.
 for(let i=0;i<w*h;i++)if(p[i*4+3]>=(spec.city?250:1)){seen[i]=1;queue[tail++]=i;}
 while(head<tail){const i=queue[head++],ix=i%w;for(const j of [ix?i-1:-1,ix<w-1?i+1:-1,i-w,i+w]){if(j<0||j>=w*h||seen[j])continue;seen[j]=1;queue[tail++]=j;for(let k=0;k<3;k++)p[j*4+k]=p[i*4+k];p[j*4+3]=255;}}
 ctx.putImageData(data,x,y);
 if(key==='pp_plaster'){
  // The sprite leaves a plaster margin outside the post. A physical corner
  // joins two timber faces, so carry each post all the way to that join.
  const H=spec.base-spec.eave;
  ctx.drawImage(canvas,spec.posts[0]+1,spec.eave,1,H,spec.left,spec.eave,spec.posts[0]-spec.left+1,H);
  ctx.drawImage(canvas,spec.posts[3]-2,spec.eave,1,H,spec.posts[3]-1,spec.eave,spec.right-spec.posts[3]+1,H);
 }

 return canvas;
}
function material(s,key){const name='authored:'+imageKey(key);if(s.textures.exists(name))return s.textures.get(name);const t=s.textures.createCanvas(name,512,1024),c=t.getContext();c.imageSmoothingEnabled=false;c.clearRect(0,0,512,1024);const im=extendSourceEdges(s.textures.get(imageKey(key)).getSourceImage(),SPECS[key],key);if(specialBuilder(key)){specialBuilder(key).prepare(c,im,SPECS[key],key);t.refresh();t.setFilter(Phaser.Textures.FilterMode.NEAREST);return t;}if(key==='wizard'){WizardTower.prepare(c,im);t.refresh();t.setFilter(Phaser.Textures.FilterMode.NEAREST);return t;}c.drawImage(im,0,16);if(SPECS[key].flatRoof){FlatBuildings.prepare(c,im,SPECS[key],key);t.refresh();t.setFilter(Phaser.Textures.FilterMode.NEAREST);return t;}const r=SPECS[key].wall;for(let yy=616;yy<744;yy+=r[3])for(let x=0;x<256;x+=r[2])c.drawImage(im,...r,x,yy,r[2],r[3]);
 // Roof-only copies omit baked protrusions; the actual closed 3D feature
 // supplies those pixels. Back slopes must not acquire a second window.
 if(key==='market'||key==='trader'){
  c.drawImage(im,0,800);
  if(key==='market')c.drawImage(im,35,28,21,22,67,828,21,22);
  else {for(let y=0;y<30;y+=8)c.drawImage(im,20,44,14,Math.min(8,30-y),4,828+y,14,Math.min(8,30-y));c.drawImage(im,46,47,14,10,46,831,14,10);
   // The rear gable occludes this triangular part of the front roof in the
   // artwork. Reconstruct only that hidden band from the same roof column.
   for(let x=38;x<60;x++){const lo=32+(x-38)*20/38,hi=52-14*x/76,edge=54+(x-38)*20/38;for(let y=Math.floor(lo);y<hi;y++)c.drawImage(im,x,Math.floor(edge)-4-(y%4),1,1,x,800+y,1,1);}
}
 }
 if(key==='trader'){
  c.drawImage(im,12,90,1,1,0,616,256,128);
  for(let yy=616;yy<744;yy+=16)c.drawImage(im,12,95,20,2,0,yy,256,2);
  for(let yy=624;yy<736;yy+=48)for(let xx=18;xx<256;xx+=64)c.drawImage(im,17,88,12,7,xx,yy,12,7);
 }
 if(key==='market'){
  c.drawImage(im,48,64,1,1,0,616,256,128);
  for(let xx=0;xx<256;xx+=32)c.drawImage(im,40,84,32,10,xx,616+27,32,10);
 }
 if(key==='market'){
  // Inferred shaft faces use stone only, never the source roof or cap.
  for(let y=748;y<820;y+=12)for(let x=128;x<160;x+=7)c.drawImage(im,94,14,7,12,x,y,7,12);
 }
 if(key==='trader'){
  // A quiet brick shaft keeps the roof behind the source chimney off its hidden faces.
  for(let y=748;y<796;y+=8)for(let x=0;x<64;x+=12)c.drawImage(im,5,38,12,8,x,y,12,8);
  c.drawImage(im,7,36,1,1,0,748,64,3);
 }
 prepareFootprintMaterial(c,im,SPECS[key],key);
 if(key==='trader'){
  // Quiet side closures carry source plaster courses without clipped windows.
  for(let y=400;y<528;y+=6)c.drawImage(im,42,87,1,Math.min(6,528-y),128,y,128,Math.min(6,528-y));
  // Roof-cap plaster is separate from the complete inferred wall bays.
  for(let y=200;y<328;y+=9)for(let x=128;x<256;x+=20)c.drawImage(im,13,87,20,9,x,y,Math.min(20,256-x),Math.min(9,328-y));
 }

 RoofMaterials.prepare(c,im,SPECS[key],key);
 t.refresh();t.setFilter(Phaser.Textures.FilterMode.NEAREST);return t;}
function buildNative(s,key){const a=specFor(key),tex=material(s,key),W=a.right-a.left,D=a.depth,H=a.base-a.eave,x=450-W/2,y=240-D/2;
 const rear=['com','pp_cabin'].includes(key)?4:key==='pp_brick'?1:0;
 const m={faces:[],height:a.base-a.peak,authoredKey:key,texture:tex};
 let currentFeature='body';
 function poly(points,uv,kind='wall',layer=0){for(let i=1;i<points.length-1;i++){const idx=[0,i,i+1],ps=idx.map(j=>({...points[j],tu:uv[j][0]/512,tv:(uv[j][1]+16)/1024}));const f={points:ps,projected:ps.map(()=>({})),x,y,texture:tex,kind,layer:0,color:0xffffff,light:1,sourceArt:true,feature:currentFeature,fallbackUV:currentFeature==='porch'?[168.5/512,131.5/1024]:currentFeature==='dormer'?[73.5/512,52.5/1024]:currentFeature==='chimney'?[((key==='market'?98.5:8.5))/512,52.5/1024]:null,support:m.support,preserveWalls:true,eaveHeight:H};if(kind==='wall')f.wallDirection={x:points[1].x-points[0].x,y:points[1].y-points[0].y};m.faces.push(f);}}
 function rect(points,r,kind='wall',layer=0){if(key==='trader'&&r[1]===600){const origin=points[0];poly(points,points.map(p=>[128.5+Math.hypot(p.x-origin.x,(p.y-origin.y)*2),448-p.z]),kind,layer);return}const [u,v,w,h]=r;poly(points,[[u,v+h],[u+w,v+h],[u+w,v],[u,v]],kind,layer)}
 // Source-space front surfaces preserve scale and alignment even when recessed.
 const front=(u,v,offset=0)=>P(u-a.left,D+offset,a.base-v+offset);
 function frontRect(u0,v0,u1,v1,offset=0,layer=0){panels.push({u0,v0,u1,v1,offset});poly([front(u1,v1,offset),front(u0,v1,offset),front(u0,v0,offset),front(u1,v0,offset)],[[u1,v1],[u0,v1],[u0,v0],[u1,v0]],'wall',layer)}
 const panels=[];
 const xs=[a.left,a.right,...a.posts,...(a.door?[a.door[0],a.door[0]+a.door[2]]:[])].sort((l,r)=>l-r),ys=[...new Set([...a.bands,...(a.door?[a.door[1],a.door[1]+a.door[3]]:[])])].filter(v=>v>=a.eave&&v<=a.base).sort((l,r)=>l-r);
 for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){const u0=xs[i-1],u1=xs[i],v0=ys[j-1],v1=ys[j],door=a.door&&u0>=a.door[0]&&u1<=a.door[0]+a.door[2]&&v0>=a.door[1]&&v1<=a.door[1]+a.door[3],post=(u0>=a.posts[0]&&u1<=a.posts[1])||(u0>=a.posts[2]&&u1<=a.posts[3]);frontRect(u0,v0,u1,v1,door?-.5:post&&key!=='pp_plaster'?.6:v0>=a.base-4&&key!=='pp_plaster'?.3:0,door?.1:post?.4:0);}
 // Each inset panel is a shallow solid, not a disconnected floating face.
 for(const q of panels){if(!q.offset)continue;const ring=[[q.u0,q.v0],[q.u1,q.v0],[q.u1,q.v1],[q.u0,q.v1]];for(let i=0;i<4;i++){const u=ring[i],v=ring[(i+1)%4];const pts=[front(...u),front(...v),front(...v,q.offset),front(...u,q.offset)],uv=[u,v,v,u];poly(pts,uv,'wall');poly([...pts].reverse(),[...uv].reverse(),'wall');}}
 // Opposite facades use the complete source front, with only the door removed.
 // Wider sides repeat full bays, never tiny post-bearing texture swatches.
 function authoredWall(A,B){
  const length=Math.hypot(B.x-A.x,(B.y-A.y)*2),layout=sourceFacadeSlices(a,length);
  const at=(t,z)=>P(A.x+(B.x-A.x)*t/length,A.y+(B.y-A.y)*t/length,z);
  for(const [l,r,u0,u1] of layout.parts){
   poly([at(l,0),at(r,0),at(r,H),at(l,H)],[[u0,884+H],[u1,884+H],[u1,884],[u0,884]]);
  }
 }
 // A continuous inner front and base keep small applied recesses from
 // opening the outer envelope. Alpha in artwork is filled by the material.
 authoredWall(P(W,D-.7,0),P(0,D-.7,0));
 poly([P(0,D,0),P(W,D,0),P(W,rear,0),P(0,rear,0)],Array(4).fill([264.5,884+H-1.5]),'floor');
 authoredWall(P(0,rear,0),P(W,rear,0));
 authoredWall(P(W,rear,0),P(W,D,0));
 authoredWall(P(0,D,0),P(0,rear,0));
 const roofPlanes=[];
 function roofFace(points,uv){roofPlanes.push(points);let source=uv.map(([u,v])=>[u,v+(['market','trader'].includes(key)?800:16)]);
  if(['com','pp_cabin'].includes(key)){
   // Rectify only the authored plane's pixel staircase. Every texel remains
   // a source pixel; roof geometry supplies the source-camera diagonal.
   const cache=tex.nativeRoofPatches||(tex.nativeRoofPatches=new Map()),id=JSON.stringify(source);let patch=cache.get(id);
   if(!patch){const n=cache.size,x=256+n%3*64,y=160+Math.floor(n/3)*80,w=source[1][0]-source[0][0],h=source[3][1]-source[0][1],slope=key==='trader'?Math.sign(source[1][1]-source[0][1])*.5:(source[1][1]-source[0][1])/w,c=tex.getContext(),copy=document.createElement('canvas');copy.width=Math.ceil(w);copy.height=Math.ceil(h);const g=copy.getContext('2d');g.imageSmoothingEnabled=false;
    for(let row=0;row<h;row++)for(let col=0;col<w;col++)g.drawImage(c.canvas,Math.floor(source[0][0]+col+.5),Math.floor(source[0][1]+row+.5+slope*(col+.5)),1,1,col,row,1,1);
    c.drawImage(copy,x+1,y+1);c.drawImage(copy,0,0,1,h,x,y+1,1,h);c.drawImage(copy,w-1,0,1,h,x+w+1,y+1,1,h);c.drawImage(copy,0,0,w,1,x+1,y,w,1);c.drawImage(copy,0,h-1,w,1,x+1,y+h+1,w,1);patch=[[x+1,y+1],[x+w+1,y+1],[x+w+1,y+h+1],[x+1,y+h+1]];cache.set(id,patch);tex.refresh();}
   // The source roof begins four pixels below the nominal rear bound.
   // Fit painted art to the full surface instead of extending that empty band.
   source=patch.map(([u,v],i)=>[u,v+(i<2?4:0)]);
  }

  points.sourceUV=key==='trader'?null:source;
  points.sourceOrigin=[a.left,a.base-D+16];
  if(key==='fdr')points.edgeLip=.125;
  const nativePP=['pp_brick','pp_plaster'].includes(key);
  if(nativePP){
   // The projecting beam owns its full-width source band; the sheet beneath
   // follows only genuine tile support. Each run is a thin closed slab.
   const runs=key==='pp_brick'?[[1,47,2,94],[47,48,4,92]]:[[0,16,2,94],[16,25,2,95],[25,26,1,95],[26,36,1,94],[36,48,2,95]],at=(u,v)=>({x:points[0].x+(points[1].x-points[0].x)*u+(points[3].x-points[0].x)*v,y:points[0].y+(points[1].y-points[0].y)*u+(points[3].y-points[0].y)*v,z:points[0].z+(points[1].z-points[0].z)*u+(points[3].z-points[0].z)*v});
   for(const [y0,y1,x0,x1] of runs){const va=(y0-uv[0][1])/(uv[3][1]-uv[0][1]),vb=(y1-uv[0][1])/(uv[3][1]-uv[0][1]),v0=Math.min(va,vb),v1=Math.max(va,vb),top=[at(x0/W,v0),at(x1/W,v0),at(x1/W,v1),at(x0/W,v1)],bottom=top.map(p=>({...p,z:p.z-.35}));
    poly(top,[[x0,uv[0][1]+v0*(uv[3][1]-uv[0][1])],[x1,uv[0][1]+v0*(uv[3][1]-uv[0][1])],[x1,uv[0][1]+v1*(uv[3][1]-uv[0][1])],[x0,uv[0][1]+v1*(uv[3][1]-uv[0][1])]],'roof');
    const shadow=ps=>poly(ps,ps.map(()=>[501.5,600.5]),'roof');shadow([...bottom].reverse());for(let i=0;i<4;i++){const j=(i+1)%4;shadow([top[i],bottom[i],bottom[j],top[j]]);}
   }
  }
  RoofMaterials.emit(points,key,(ps,tex)=>poly(ps,tex.map(([u,v])=>[u,v-16]),'roof',2),true,key==='trader'?null:source,!nativePP);
 }
 if(a.flatRoof||specialBuilder(key)){}else if(!a.sideRidge){const r=a.center-a.left,Z=a.base-a.peak;
  // Roof planes are the original authored quadrilaterals, including their
  // bevels, edge highlights and ridge strip. No repeated texture cells.
  roofFace([P(0,rear,H),P(r,rear,Z),P(r,D,Z),P(0,D,H)],[[a.left,a.back],[a.center,a.backPeak],[a.center,a.peak],[a.left,a.eave]]);
  roofFace([P(r,rear,Z),P(W,rear,H),P(W,D,H),P(r,D,Z)],[[a.center,a.backPeak],[a.right,a.back],[a.right,a.eave],[a.center,a.peak]]);
  poly([front(a.right,a.eave),front(a.left,a.eave),front(a.center,a.peak)],[[a.right,a.eave],[a.left,a.eave],[a.center,a.peak]],'wall',.2);
  poly([P(0,rear,H),P(W,rear,H),P(r,rear,Z)],[[a.left,a.eave],[a.right,a.eave],[a.center,a.peak]],'wall');
  // Side walls already close the eaves; duplicate coplanar trim flickers on rotation.
 }else{
  // The blacksmith reference exposes one broad roof slope. Its hidden slope
  // projects edge-on in the artwork view, revealing itself only on rotation.
  const mid=(D+rear)/2,Z=H+(D-rear)/2;
  roofFace([P(0,mid,Z),P(W,mid,Z),P(W,D,H),P(0,D,H)],[[a.left,a.peak+rear],[a.right,a.peak+rear],[a.right,a.eave],[a.left,a.eave]]);
  roofFace([P(0,rear,H),P(W,rear,H),P(W,mid,Z),P(0,mid,Z)],[[a.left,a.eave],[a.right,a.eave],[a.right,a.peak+rear],[a.left,a.peak+rear]]);
  poly([P(0,D,H),P(0,rear,H),P(0,mid,Z)],[[0,612.5],[key==='fdr'?D*2:W,612.5],[key==='fdr'?D:W/2,612.5]],'wall');
  poly([P(W,rear,H),P(W,D,H),P(W,mid,Z)],[[0,612.5],[key==='fdr'?D*2:W,612.5],[key==='fdr'?D:W/2,612.5]],'wall');
  if(key==='fdr')for(const side of [0,W])RoofMaterials.gableTie(P(side,0,H),P(side,D,H),(ps,uv,kind)=>poly(ps,uv.map(([u,v])=>[u,v-16]),kind),true);
  // Porch pieces are projected from the actual reference: the landing, front
  // step and two raised rails all occupy their original source coordinates.
  if(a.porch){currentFeature='porch';
  const ground=(u,v,z)=>P(u-a.left,v+z+D-a.base,z);
  const deck=(u0,v0,u1,v1,z,layer)=>poly([ground(u0,v0,z),ground(u1,v0,z),ground(u1,v1,z),ground(u0,v1,z)],[[u0,v0],[u1,v0],[u1,v1],[u0,v1]],'roof',layer);
  function porchBox(u0,v0,u1,v1,z){
   const t0=ground(u0,v0,z),t1=ground(u1,v1,z),corners=[P(t0.x,t0.y,0),P(t1.x,t0.y,0),P(t1.x,t1.y,0),P(t0.x,t1.y,0)];
   deck(u0,v0,u1,v1,z,2.4);poly([...corners].reverse(),Array(4).fill([168.5,115.5]),'floor');
   for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4],pts=[a,b,{...b,z},{...a,z}];poly(pts,pts.map(p=>[p.x+SPECS[key].left,p.y-p.z+SPECS[key].base-D]),'wall');}
  }
  porchBox(152,104,184,120,3);porchBox(152,120,184,128,.3);
  for(const [l,r] of [[148,154],[182,188]])porchBox(l,96,r,119,9);
  }
 }
 currentFeature='body';
 currentFeature='body';
 if(a.rearHouse){currentFeature='rearHouse';
  const right=76,ridge=52,back=-26,notch=-16,fore=0,leftEave=24,eave=38,peak=50,shoulder=32,shoulderZ=40;
  const mapped=(points,kind='wall')=>{const uv=points.map(p=>[p.x,p.y-p.z+a.base-D]);if(kind==='roof')roofFace(points,uv);else poly(points,uv,kind)};
  mapped([P(shoulder,back,shoulderZ),P(ridge,back,peak),P(ridge,notch,peak),P(shoulder,notch,shoulderZ)],'roof');
  mapped([P(0,notch,leftEave),P(ridge,notch,peak),P(ridge,fore,peak),P(0,fore,leftEave)],'roof');
  mapped([P(ridge,back,peak),P(right,back,eave),P(right,fore,eave),P(ridge,fore,peak)],'roof');
  mapped([P(right,fore,eave),P(0,fore,leftEave),P(ridge,fore,peak)]);
  mapped([P(right,fore,0),P(0,fore,0),P(0,fore,leftEave),P(right,fore,eave)]);
  const ring=[P(shoulder,back,shoulderZ),P(right,back,eave),P(right,fore,eave),P(0,fore,leftEave),P(0,notch,leftEave),P(shoulder,notch,shoulderZ)];
  for(let i=0;i<ring.length;i++){if(i===2)continue;const a=ring[i],b=ring[(i+1)%ring.length];rect([{...a,z:0},{...b,z:0},b,a],[0,600,48,38]);}
  const cap=[P(shoulder,back,shoulderZ),P(right,back,eave),P(ridge,back,peak)];poly(cap,cap.map(p=>[p.x,728-p.z]),'wall');
  for(const [l,r,y0,y1] of [[shoulder,right,back,notch],[0,right,notch,fore]])poly([P(l,y1,0),P(r,y1,0),P(r,y0,0),P(l,y0,0)],Array(4).fill([264.5,884+H-1.5]),'floor');
 }
 if(key==='market'){currentFeature='dormer';
  // The roof copy omits this window: put its source silhouette on a closed
  // projecting gable, so it stays anchored to the slope when the map turns.
  const outline=[[68,49],[88,49],[88,40],[78,28],[68,40]],frontY=52,backY=44;
  const frontPoints=outline.map(([u,v])=>P(u,frontY,frontY+a.base-D-v));
  poly([...frontPoints].reverse(),[...outline].reverse(),'wall');
  const backPoints=frontPoints.map(p=>P(p.x,backY,p.z-(frontY-backY)));
  poly(backPoints,Array(5).fill([73.5,38.5]),'wall');
  for(let i=0;i<outline.length;i++){const j=(i+1)%outline.length;
   poly([frontPoints[j],backPoints[j],backPoints[i],frontPoints[i]],
    [outline[j],outline[j],outline[i],outline[i]],i===2||i===3?'roof':'wall');
  }
 }
 if(a.chimney){currentFeature='chimney';
  const c=key==='market'?{l:89,r:104,front:38,back:28,z:66,uv:[128,732,15,66]}:{l:3,r:18,front:12,back:5,z:53,uv:[0,732,15,29]};
  const lower=key==='market'?0:24;
  poly([P(c.l,c.front,lower),P(c.r,c.front,lower),P(c.r,c.back,lower),P(c.l,c.back,lower)],Array(4).fill([key==='market'?98.5:8.5,36.5]),'floor');
  const frontPoints=[P(c.r,c.front,lower),P(c.l,c.front,lower),P(c.l,c.front,c.z),P(c.r,c.front,c.z)];
  poly(frontPoints,frontPoints.map(p=>[p.x,p.y-p.z+a.base-D]),'wall');
  rect([P(c.l,c.back,lower),P(c.r,c.back,lower),P(c.r,c.back,c.z),P(c.l,c.back,c.z)],c.uv);
  const sideWidth=(c.front-c.back)*2,sideUV=[c.uv[0]+(c.uv[2]-sideWidth)/2,c.uv[1],sideWidth,c.uv[3]];
  rect([P(c.r,c.back,lower),P(c.r,c.front,lower),P(c.r,c.front,c.z),P(c.r,c.back,c.z)],sideUV);
  rect([P(c.l,c.front,lower),P(c.l,c.back,lower),P(c.l,c.back,c.z),P(c.l,c.front,c.z)],sideUV);
  // A recessed, closed well gives the opening depth while keeping the shaft sealed.
  const cap=[P(c.l,c.back,c.z),P(c.r,c.back,c.z),P(c.r,c.front,c.z),P(c.l,c.front,c.z)],inner=[P(c.l+3,c.back+(key==='market'?3:2),c.z),P(c.r-3,c.back+(key==='market'?3:2),c.z),P(c.r-3,c.front-(key==='market'?2:1),c.z),P(c.l+3,c.front-(key==='market'?2:1),c.z)],bottom=inner.map(p=>({...p,z:p.z-1.4})),dark=[key==='market'?98.5:11.5,key==='market'?3.5:31.5];
  for(let i=0;i<4;i++){const j=(i+1)%4,rim=[cap[i],cap[j],inner[j],inner[i]];poly(rim,rim.map(p=>[p.x,p.y-p.z+a.base-D]),'roof');poly([inner[i],inner[j],bottom[j],bottom[i]],Array(4).fill(dark),'wall');}
  poly(bottom,Array(4).fill(dark),'roof');
 }
 currentFeature='body';
 if(!['pp_brick','pp_plaster'].includes(key))RoofMaterials.overhang(roofPlanes,a.rearHouse?[P(32,-26,0),P(W,-26,0),P(W,D,0),P(0,D,0),P(0,-16,0),P(32,-16,0)]:[P(0,rear,0),P(W,rear,0),P(W,D,0),P(0,D,0)],(ps,tex)=>poly(ps,tex.map(([u,v])=>[u,v-16]),'roof'),true,true);
 // Crop source-empty facade margins without stretching any authored front pixels.
 // The roof retains its source width and naturally overhangs the tighter walls.
 if(['pp_brick','pp_plaster','pp_cabin','com','fdr','market','trader'].includes(key)){
  const inset=key==='com'||key==='fdr'?1:4,lo=inset,hi=W-(key==='market'?0:inset),clipped=[];
  const cut=(ps,bound,sign)=>{const out=[];for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length],da=(a.x-bound)*sign,db=(b.x-bound)*sign;if(da>=-1e-7)out.push(a);if((da<0)!==(db<0)){const t=da/(da-db),q={};for(const k of ['x','y','z','tu','tv'])q[k]=a[k]+(b[k]-a[k])*t;out.push(q);}}return out;};
  for(const f of m.faces){
   if(!['body','rearHouse'].includes(f.feature)||f.kind==='roof'){clipped.push(f);continue;}
   const ps=cut(cut(f.points,lo,1),hi,-1);
   for(let i=1;i<ps.length-1;i++){const p=[ps[0],ps[i],ps[i+1]],a=p[0],b=p[1],c=p[2],u=[b.x-a.x,b.y-a.y,b.z-a.z],v=[c.x-a.x,c.y-a.y,c.z-a.z];if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-7)continue;clipped.push({...f,points:p.map(q=>({...q})),projected:p.map(()=>({}))});}
  }
  m.faces=clipped;currentFeature='body';
  // Cropped projecting posts/plinths retain their own small side closures.
  for(const side of [lo,...(hi<W?[hi]:[])])for(const panel of panels){
   const u=side+a.left;if(!panel.offset||u<=panel.u0+1e-7||u>=panel.u1-1e-7)continue;
   let ps=[front(u,panel.v1),front(u,panel.v1,panel.offset),front(u,panel.v0,panel.offset),front(u,panel.v0)],uv=[[u,panel.v1],[u,panel.v1],[u,panel.v0],[u,panel.v0]];
   if((side===lo)===(panel.offset>0)){ps.reverse();uv.reverse();}poly(ps,uv,'wall');
  }
  // Seal the newly exposed underside of the original roof membrane.
  if(!['pp_brick','pp_plaster'].includes(key))for(const plane of roofPlanes)for(const [bound,sign] of [[lo,-1],...(hi<W?[[hi,1]]:[])]){
   const top=cut(plane,bound,sign);if(top.length<3)continue;
   const bottom=top.map(p=>({...p,z:p.z-.35})),shadow=ps=>poly(ps,ps.map(()=>[501.5,600.5]),'roof');
   shadow([...bottom].reverse());for(let i=0;i<top.length;i++){const j=(i+1)%top.length;shadow([top[i],bottom[i],bottom[j],top[j]]);}
  }
  for(const side of [lo,...(hi<W?[hi]:[])]){
   const sections=[];
   for(const plane of roofPlanes){const hits=[];for(let i=0;i<4;i++){const a=plane[i],b=plane[(i+1)%4];if(Math.abs(a.x-side)<1e-7)hits.push(a);if((a.x<side)!==(b.x<side)){const t=(side-a.x)/(b.x-a.x);hits.push(P(side,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t));}}hits.sort((a,b)=>a.y-b.y);if(hits.length>1&&hits.at(-1).y-hits[0].y>1e-7)sections.push([hits[0],hits.at(-1)]);}
   const cuts=[...new Set(sections.flatMap(s=>s.map(p=>p.y)))].sort((a,b)=>a-b);
   for(let j=1;j<cuts.length;j++){const y0=cuts[j-1],y1=cuts[j],mid=(y0+y1)/2,at=(s,y)=>s[0].z+(s[1].z-s[0].z)*(y-s[0].y)/(s[1].y-s[0].y),s=sections.filter(s=>mid>=s[0].y&&mid<=s[1].y).sort((a,b)=>at(b,mid)-at(a,mid))[0];if(!s)continue;
    const order=side===lo?[y1,y0]:[y0,y1],z0=at(s,order[0]),z1=at(s,order[1]),length=(y1-y0)*2,layout=sourceFacadeSlices(a,length),mapU=u=>u>=0&&u<=W?lo+u/W*(hi-lo):u;
    for(const [l,r,u0,u1] of layout.parts){const ya=order[0]+(order[1]-order[0])*l/length,yb=order[0]+(order[1]-order[0])*r/length;const ps=[P(side,ya,0),P(side,yb,0),P(side,yb,H),P(side,ya,H)];poly(ps,key==='trader'?ps.map(p=>[128.5+(p.y+26)*2,448-p.z]):[[mapU(u0),884+H],[mapU(u1),884+H],[mapU(u1),884],[mapU(u0),884]],'wall');}
    const top=[P(side,order[0],H),P(side,order[1],H),P(side,order[1],z1),P(side,order[0],z0)];
    if(Math.max(z0,z1)>H+1e-7)poly(top,top.map(p=>a.sideRidge?[(p.y-y0)*2,612.5]:key==='trader'?[128.5+(p.y+26)*2,448-p.z]:[a.wall[0]+.5,a.eave+.5]),'wall');
   }
  }
 }
 // The FDR crossbeam genuinely projects one source pixel past each wall.
 // Preserve those twelve opaque pixels with shallow, closed timber end pieces.
 if(key==='fdr'){
  for(const [l,r] of [[0,1],[W-1,W]]){
   const frontEnd=[P(r,D,a.base-80),P(l,D,a.base-80),P(l,D,a.base-74),P(r,D,a.base-74)],backEnd=frontEnd.map(p=>({...p,y:p.y-.5,z:p.z-.5})),face=ps=>poly(ps,ps.map(p=>[a.left+p.x,a.base-D+p.y-p.z]),'wall');
   face(frontEnd);face([...backEnd].reverse());for(let i=0;i<4;i++){const j=(i+1)%4;face([frontEnd[i],backEnd[i],backEnd[j],frontEnd[j]]);}
  }
 }
 // Decode source-space coordinates once using the source camera calibration.
 // Viewing elevation can then change without reshaping the physical model.
 for(const face of m.faces)for(const p of face.points){p.y/=0.5;p.z/=Math.cos(Math.PI/6);}
 if(specialBuilder(key)){m.faces=specialBuilder(key).build(m.faces[0],a,key,null);}
 if(a.flatRoof){m.faces=FlatBuildings.build(m.faces[0],a,key,null);}
 if(key==='wizard'){m.faces=WizardTower.build(m.faces[0],a);}
 const unitScale=16/(a.door?.[3]||16);
 for(const face of m.faces)for(const p of face.points){p.x*=unitScale;p.y*=unitScale;p.z*=unitScale;}
 m.height=Math.max(...m.faces.flatMap(f=>f.points.map(p=>p.z)));
 m.ring=[P(0,0,0),P(W*unitScale,0,0),P(W*unitScale,D*2*unitScale,0),P(0,D*2*unitScale,0)];
 m.noInk=true;
 return m;
}

 // The timber cabin is Home's alone; flat shops retain their native colorways.
 const RESIDENCES=['com','pp_brick','pp_plaster','flat_adobe','flat_rooftop','steam_home',...Object.keys(FlatBuildings.specs).filter(key=>FlatBuildings.specs[key].ppFlat)];
 const residencePalette=key=>SPECS[key].ppFlat?'native':'yellow';
 const SHOP_ROOFS={seed:'lime',supply:'blue',potion:'teal',relic:'red',pet:'rose',book:'plum',shop:'blue'};
 // A house keeps the facade it had when the cabin was still a residence: the
 // pick runs over the former list, and only former cabins pick again.
 const FORMER_RESIDENCES=['com','pp_brick','pp_plaster','pp_cabin','flat_adobe','flat_rooftop','steam_home'];
 function residenceFor(id){let n=2166136261;for(const c of String(id??'')){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}n>>>=0;
  const key=FORMER_RESIDENCES[n%FORMER_RESIDENCES.length];
  return RESIDENCES.includes(key)?key:RESIDENCES[Math.floor(n/FORMER_RESIDENCES.length)%RESIDENCES.length];}
 function recipeFor(role,id,tier=1,wizardSecond=false){
  if(role==='home')return {key:'pp_cabin',palette:'orange'};
  if(role==='plain'){const key=residenceFor(id);return {key,palette:residencePalette(key)};}
  // First-tier businesses share the white cottage; color and emblem identify the trade.
  const shopPalette=role==='blacksmith'?'slate':role==='trader'?'green':SHOP_ROOFS[role];
  if(tier===1&&shopPalette)return {key:'pp_plaster',palette:shopPalette,emblem:role};
  if(role==='blacksmith')return {key:tier>=4?'steam_blacksmith':'fdr',palette:'slate'};
  if(role==='trader')return {key:'trader',palette:'green'};
  if(role==='wizard')return {key:wizardSecond?'steam_wizard':'wizard',palette:'purple'};
  if(role==='fort')return {key:'city_gearhouse',palette:'copper'};
  if(SHOP_ROOFS[role])return {key:['supply','relic','book'].includes(role)?'city_storefront':'market',palette:SHOP_ROOFS[role]};
  return null;
 }
 const caches=new WeakMap();
 function prepare(scene){
  if(caches.has(scene.textures))return;
  const models=new Map(),variants=new Map(),emblems=new Map();
  for(const key of RESIDENCES){const palette=residencePalette(key);variants.set(key+':'+palette,{key,palette});}
  for(const role of ['home','blacksmith','trader','wizard','fort',...Object.keys(SHOP_ROOFS)])for(const tier of [1,2,4])for(const second of [false,true]){
   const r=recipeFor(role,'',tier,second);variants.set(r.key+':'+r.palette,r);
   if(r.emblem)emblems.set(r.emblem,r);
  }
  for(const [id,{key,palette}] of variants){
   if(!scene.textures.exists(imageKey(key)))continue;
   const model=buildNative(scene,key);
   AuthoredRoofPalette.prepare(scene,model.texture,model,palette);
   models.set(id,model);
  }
  // Trades may share a roof color without sharing a symbol (generic/supply).
  for(const {key,palette,emblem} of emblems.values()){
   const model=models.get(key+':'+palette);
   const roofTexture=model?.faces.find(face=>AuthoredRoofPalette.roofFace(face,key))?.texture;
   if(roofTexture)AuthoredRoofPalette.prepareEmblem(scene,emblem,palette,roofTexture);
  }
  caches.set(scene.textures,models);
 }
 function build(scene,key,palette){
  const native=caches.get(scene.textures)?.get(key+':'+palette);
  if(!native)return null;
  return {...native,ring:native.ring.map(p=>({...p})),faces:native.faces.map(f=>({...f,points:f.points.map(p=>({...p})),projected:f.points.map(()=>({}))}))};
 }
 // THE LOT IS THE BUILDING. Walls stand on the lot's own outline and the
 // roof covers it (BuildingLowPoly.authoredOutline); a reviewed model lends
 // only its skin, read from the regions its material already bakes: the
 // doorless facade row, the tiled roof, the door and a plain wall texel.
 // Texels are sized so every door stands DOOR_HEIGHT tall, as on the
 // procedural houses. Wizard towers and the fort hall keep their whole
 // shells (OUTLINE_EXEMPT): their silhouettes are the landmark.
 const DOOR_HEIGHT=13,OUTLINE_EXEMPT=new Set(['wizard','steam_wizard','city_gearhouse']);
 const SKIN_OVERRIDES={
  // The workshop's own inferred-wall and copper-tile regions.
  steam_blacksmith:{facade:{v:400,rows:76,period:102},roof:{u:256,v:500,w:252,h:256}},
  steam_home:{roof:{u:256,v:616,w:240,h:238}},
  // Clear of the original deck art drawn at the region's top-left.
  city_storefront:{roof:{u:256,v:704,w:220,h:132}}
 };
 function skin(scene,key,palette){
  const native=caches.get(scene.textures)?.get(key+':'+palette),a=SPECS[key];
  if(!native||!a||OUTLINE_EXEMPT.has(key))return null;
  const o=SKIN_OVERRIDES[key]||{},period=roofTilePeriod(key)||[240,240];
  const [du,dv,dw,dh]=specialBuilder(key)||a.flatRoof?a.door:facadeDoorRect(a,key);
  return {key,spec:a,texture:native.texture,template:native.faces[0],texel:DOOR_HEIGHT/dh,
   flat:!!a.flatRoof||(!!a.city&&!a.gabled),
   // The native blacksmith ridge rises half its depth (24 source texels).
   roofRise:key==='fdr'?a.depth/2*DOOR_HEIGHT/dh:undefined,
   gable:key==='fdr'?{u:0,v:640,w:32,h:16}:undefined,
   facade:o.facade||{v:900,rows:a.base-a.eave},
   roof:o.roof||{u:256,v:616,w:a.flatRoof?224:period[0],h:a.flatRoof?240:period[1]},
   door:{u:du,v:dv+16,w:dw,h:dh,bottom:a.base-dv-dh},
   wall:[a.wall[0]+a.wall[2]/2,a.wall[1]+16+a.wall[3]/2],
   recolor:faces=>AuthoredRoofPalette.prepare(scene,native.texture,{authoredKey:key,faces},palette)};
 }
 root.AuthoredBuildings={SPECS,RESIDENCES,SHOP_ROOFS,recipeFor,prepare,build,skin};
})(typeof window!=='undefined'?window:globalThis);
