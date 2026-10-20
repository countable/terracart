/* Generalized exteriors: one continuous shell for a simple orthogonal polygon.
   Coordinates are physical, calibrated at a 30 degree source elevation. */
(function(root){
 const C=Math.cos(Math.PI/6), ATLAS_W=512, ATLAS_H=1024;
 const roofSamples={ra:[8,400,16,16],com:[168,32,16,16],fdr:[128,25,16,16],market:[20,19,32,12],trader:[16,56,16,7],pp_brick:[8,16,16,24],pp_plaster:[8,16,32,24],pp_cabin:[12,40,16,16]};
 function sourceFacadeSlices(spec,length){
  const W=spec.right-spec.left,edge=Math.min(spec.posts[1]-spec.left+4,W/4,length/4);
  if(Math.abs(length-W)<1)return {parts:[[0,length,W,0]],center:length/2};
  const native=W-2*edge,body=length-2*edge,count=Math.floor((body+1e-6)/native),gap=(body-count*native)/2;
  const parts=[[0,edge,W,W-edge]];
  if(gap>.001)parts.push([edge,edge+gap,256+gap,256]);
  for(let i=0;i<count;i++){const a=edge+gap+i*native;parts.push([a,a+native,W-edge,edge]);}
  if(gap>.001)parts.push([length-edge-gap,length-edge,256+gap,256]);
  parts.push([length-edge,length,edge,0]);
  return {parts,center:count?edge+gap+(Math.floor((count-1)/2)+.5)*native:length/2};
 }
 function facadeDoorRect(spec,key){
  const frames={market:[14,61,22,29],trader:[43,74,27,24],fdr:[153,77,30,35],com:[191,76,18,20],pp_brick:[32,52,32,28],pp_plaster:[32,52,32,28],pp_cabin:[34,88,28,24]};
  return frames[key]||spec.door;
 }
 function prepareFootprintMaterial(ctx,image,spec,key){
  const r=roofSamples[key]||[spec.left+8,spec.peak+8,16,16];
  // Fill underneath alpha before tiling; roof surfaces must stay opaque.
  const scratch=document.createElement('canvas');scratch.width=r[2];scratch.height=r[3];const c=scratch.getContext('2d');c.imageSmoothingEnabled=false;
  // Undo the source plane's pixel shear before repeating it on a new roof.
  // This removes the baked 2D diagonal that otherwise zigzags at tile seams.
  const shear=({ra:-.5,com:-.5,trader:-20/38,pp_cabin:-.5})[key]||0;
  c.setTransform(1,-shear,0,1,-r[0],-r[1]+shear*r[0]);c.drawImage(image,0,0);c.setTransform(1,0,0,1,0,0);const pixels=c.getImageData(0,0,r[2],r[3]).data;let color=[100,70,50];for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]===255){color=[pixels[i],pixels[i+1],pixels[i+2]];break;}
  ctx.save();ctx.beginPath();ctx.rect(256,616,256,256);ctx.clip();ctx.fillStyle='rgb('+color.join(',')+')';ctx.fillRect(256,616,256,256);for(let y=616;y<872;y+=r[3])for(let x=256;x<512;x+=r[2])ctx.drawImage(scratch,x,y);ctx.restore();
  if(key==='fdr'){
   // Timber studs support the gables, as on the brick cottage. Sample the
   // blacksmith's own post and infill so the added supports share its palette.
   ctx.drawImage(image,132,60,1,1,0,628,256,1);
   for(let x=0;x<256;x+=16)ctx.drawImage(image,115,60,1,1,x,628,2,1);
  }
  // Broad gable infill repeats native wood/brick courses instead of stretching
  // the complete triangular artwork across a much wider wall.
  if(!spec.sideRidge&&key!=='trader'){
   const rise=spec.eave-spec.peak,half=(spec.right-spec.left)/2;
   for(let row=0;row<=rise;row++){const width=Math.max(1,Math.min(8,Math.floor(row/rise*half-2)*2)),left=Math.round(spec.center-width/2);
    for(let x=0;x<256;x+=width)ctx.drawImage(image,left,spec.peak+row,width,1,x,976+row,Math.min(width,256-x),1);
   }
  }
  // A complete facade bay preserves the source's windows, beams, plaster and
  // foundation. Only the entrance is removed here and placed once as geometry.
  const W=spec.right-spec.left,H=spec.base-spec.eave;
  const facade=document.createElement('canvas');facade.width=W;facade.height=H;
  const f=facade.getContext('2d');f.imageSmoothingEnabled=false;
  f.drawImage(image,spec.wall[0],spec.eave,1,H,0,0,W,H);
  f.drawImage(image,spec.left,spec.eave,W,H,0,0,W,H);
  const samples={pp_brick:[12,16],pp_plaster:[12,16],pp_cabin:[12,16],market:[38,11],trader:[42,1],fdr:[120,24],com:[168,16]},[sx,sw]=samples[key]||[spec.wall[0],spec.wall[2]];
  if(spec.door){const [u,v,w,h]=facadeDoorRect(spec,key);for(let x=0;x<w;x+=sw){const width=Math.min(sw,w-x);f.drawImage(image,sx,v,width,h,u-spec.left+x,v-spec.eave,width,h);}}
  ctx.save();ctx.beginPath();ctx.rect(256,900,256,H);ctx.clip();for(let x=256;x<512;x+=sw)ctx.drawImage(image,sx,spec.eave,sw,H,x,900,sw,H);ctx.restore();
  ctx.save();ctx.beginPath();ctx.rect(0,900,256,H);ctx.clip();for(let x=0;x<256;x+=W)ctx.drawImage(facade,x,900);ctx.restore();
  if(key==='trader'){
   // Taller hidden walls continue the front's plaster, timber and windows.
   // Keep native pixel density; the door and its surround were erased above.
   ctx.save();ctx.beginPath();ctx.rect(0,616,256,128);ctx.clip();
   for(let y=744-H;y>616-H;y-=H)for(let x=0;x<256;x+=W)ctx.drawImage(facade,x,y);
   ctx.restore();
  }
 }
 function validateFootprint(polygon){
  if(!Array.isArray(polygon)||polygon.length<4)throw Error('A footprint needs at least four corners');
  const p=polygon.map(q=>Array.isArray(q)?{x:+q[0],y:+q[1]}:{x:+q.x,y:+q.y});
  if(p.length>1&&p[0].x===p.at(-1).x&&p[0].y===p.at(-1).y)p.pop();
  if(p.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y)))throw Error('Footprint coordinates must be finite numbers');
  const edges=p.map((a,i)=>({a,b:p[(i+1)%p.length]}));
  for(const {a,b} of edges)if((a.x===b.x)===(a.y===b.y))throw Error('Footprint edges must be horizontal or vertical and nonzero');
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
   if(j===i+1||(i===0&&j===edges.length-1))continue;
   const {a,b}=edges[i],{a:c,b:d}=edges[j];
   if(Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y)))throw Error('Footprint edges cannot cross or touch themselves');
  }
  return true;
 }
 function buildFootprintFaces(originalFaces,spec,key,polygon){
  validateFootprint(polygon);
  let ring=polygon.map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:{...p});
  if(ring[0].x===ring.at(-1).x&&ring[0].y===ring.at(-1).y)ring.pop();
  const signed=ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a.x*b.y-b.x*a.y},0)/2;
  if(Math.abs(signed)<1)throw Error('Footprint has no area');if(signed<0)ring.reverse();
  const template=originalFaces[0],faces=[],H=(spec.base-spec.eave)/C,W=spec.right-spec.left;
  function triangle(points,uv,kind='wall'){
   const ps=points.map((p,i)=>({...p,tu:uv[i][0]/512,tv:uv[i][1]/1024}));
   faces.push({...template,points:ps,projected:ps.map(()=>({})),kind,layer:0,sourceArt:true,feature:'body',wallDirection:kind==='wall'?{x:ps[1].x-ps[0].x,y:ps[1].y-ps[0].y}:undefined});
  }
  function quad(ps,uv,kind){triangle([ps[0],ps[1],ps[2]],[uv[0],uv[1],uv[2]],kind);triangle([ps[0],ps[2],ps[3]],[uv[0],uv[2],uv[3]],kind);}
  const roof=buildSourceRoofs(spec,key,ring,{triangle,quad});
  const edges=ring.map((a,i)=>({a,b:ring[(i+1)%ring.length]}));
  let entry=-1,best=-Infinity;
  edges.forEach(({a,b},i)=>{if(a.y===b.y&&a.x>b.x&&a.x-b.x>(spec.door?.[2]||16)+8&&a.y>best){entry=i;best=a.y;}});
  edges.forEach(({a,b},index)=>{
   const length=Math.hypot(b.x-a.x,b.y-a.y),dx=(b.x-a.x)/length,dy=(b.y-a.y)/length,phase=(W+length)/2;
   const at=(t,z,offset=0)=>({x:a.x+dx*t+dy*offset,y:a.y+dy*t-dx*offset,z});
   // Only the building corners receive corner posts. Complete interior bays
   // keep windows intact; short remainder strips use matching plain wall art.
   const post=Math.min(4,length/6),layout=sourceFacadeSlices(spec,length);
   for(const [a0,a1,u0,u1] of layout.parts){
    quad([at(a0,0),at(a1,0),at(a1,H),at(a0,H)],[[u0,900+H*C],[u1,900+H*C],[u1,900],[u0,900]],'wall');
   }
   if(a.y===b.y&&a.x>b.x&&spec.door&&length>spec.door[2]+post*2){
    const [u,v,w,h]=facadeDoorRect(spec,key),from=Math.max(post,Math.min(length-post-w,layout.center+W/2-(u-spec.left)-w));
    quad([at(from,(spec.base-v-h)/C,.1),at(from+w,(spec.base-v-h)/C,.1),at(from+w,(spec.base-v)/C,.1),at(from,(spec.base-v)/C,.1)],[[u+w,v+h+16],[u,v+h+16],[u,v+16],[u+w,v+16]],'wall');
   }
  });
  for(const s of roof.sections)quad([{x:s.x0,y:s.y1,z:0},{x:s.x1,y:s.y1,z:0},{x:s.x1,y:s.y0,z:0},{x:s.x0,y:s.y0,z:0}],Array(4).fill([264.5,900+H*C-1.5]),'floor');
  const copyFeature=(name,transform)=>{
   for(const f of originalFaces.filter(f=>f.feature===name)){
    const points=f.points.map(p=>({...p,...transform(p)}));faces.push({...f,points,projected:points.map(()=>({}))});
   }
  };
  const primary=roof.primary;let dormer=false;
  if(key==='market'&&primary.x1-primary.x0>=20&&primary.y1-primary.y0>=28){
   const tx=primary.x1-12,ty=primary.y1-8,dz=roof.height(tx,ty)-41/C;
   copyFeature('dormer',p=>({x:p.x+tx-78,y:p.y+ty-104,z:p.z+dz}));dormer=true;
  }
  if(spec.chimney){
   const s=primary,market=key==='market',sourceX=market?90:4,sourceY=market?76:24;
   const tx=market?s.x1:s.x0+4,ty=market?s.y0+(s.y1-s.y0)*76/(spec.depth*2):Math.max(...roof.sections.map(r=>r.y1))-20;
   copyFeature('chimney',p=>({x:p.x+tx-sourceX,y:p.y+ty-sourceY,z:p.z}));
  }
  if(spec.porch){
   for(const {a,b} of edges){if(a.y!==b.y||a.x-b.x<44)continue;const center=a.x-sourceFacadeSlices(spec,a.x-b.x).center;
    copyFeature('porch',p=>({x:p.x+center-W/2,y:p.y+a.y-spec.depth*2,z:p.z}));
   }
  }
  faces.footprintInfo={polygon:ring,area:Math.abs(signed),roofPitch:roof.pitch,mode:roof.mode,physical:true,dormer,sections:roof.sections.length};
  return faces;
 }
 root.sourceFacadeSlices=sourceFacadeSlices;
 root.validateFootprint=validateFootprint;
 root.prepareFootprintMaterial=prepareFootprintMaterial;root.buildFootprintFaces=buildFootprintFaces;
})(typeof window==='undefined'?globalThis:window);
