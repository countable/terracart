/* Source-derived adobe roofs: horizontal decks, closed cornices and parapets.
   Dimensions are physical, before the common 16-pixel-door scale. */
(function(root){
 const C=Math.cos(Math.PI/6),EPS=1e-5;
 const specs={
  flat_adobe:{label:'Desert adobe · flat roof',image:'flat-adobe.png',crop:[0,0,48,64],left:0,right:48,base:64,eave:48,peak:0,back:0,backPeak:0,center:24,depth:47,wall:[32,49,8,14],posts:[0,2,46,48],bands:[48,50,64],door:[16,48,16,16],flatRoof:true},
  flat_rooftop:{label:'Desert adobe · rooftop room',image:'flat-rooftop.png',crop:[0,0,48,72],left:0,right:48,base:72,eave:56,peak:0,back:8,backPeak:0,center:24,depth:47,wall:[32,57,8,14],posts:[0,2,46,48],bands:[56,58,72],door:[16,56,16,16],flatRoof:true,roofRoom:true}
 };
 for(const color of ['red','brown','orange','blue','green','pink'])specs['pp_flat_'+color]={label:'Pixel Plains · flat shop · '+color,image:'pp-flat-'+color+'.png',crop:[0,0,96,80],left:0,right:96,base:80,eave:48,peak:0,back:0,backPeak:0,center:48,depth:32,wall:[8,48,16,32],posts:[0,3,93,96],bands:[48,51,72,80],door:[34,52,28,28],flatRoof:true,ppFlat:true,slabHeight:16};
 function prepare(ctx,image,spec,key){
  // Facades keep both windows. Erase only the entrance with the quiet strip
  // between its frame and the right window, preserving the horizontal cornice.
  prepareFootprintMaterial(ctx,image,{...spec,wall:spec.ppFlat?spec.wall:[32,spec.eave,2,16],sideRidge:true},key);
  if(spec.ppFlat){
   // The source outline belongs to the roof silhouette, not every wall corner.
   // Extend native masonry into the four border columns in the prepared atlas.
   ctx.save();ctx.beginPath();ctx.rect(0,900,256,32);ctx.clip();
   for(let x=0;x<256;x+=96){ctx.drawImage(image,4,48,1,32,x,900,4,32);ctx.drawImage(image,91,48,1,32,x+92,900,4,32);}
   ctx.restore();
   // Native tiled deck and colored coping; retain the source texel density.
   for(let y=616;y<872;y+=16)for(let x=256;x<512;x+=16)ctx.drawImage(image,16,16,16,16,x,y,16,16);
   for(let i=0;i<5;i++){ctx.drawImage(image,1+Math.min(i,2),12,1,1,500+i,616,1,256);ctx.drawImage(image,20,Math.min(i,2),1,1,480+i,616,1,256);}
   ctx.drawImage(image,2,2,1,1,506,616,2,256);ctx.drawImage(image,4,12,1,1,508,616,4,256);
   return;
  }
  const source=document.createElement('canvas');source.width=image.width;source.height=image.height;
  const c=source.getContext('2d');c.drawImage(image,0,0);
  const pixel=(x,y)=>{const p=c.getImageData(x,y,1,1).data;return `rgb(${p[0]},${p[1]},${p[2]})`;};
  ctx.fillStyle=pixel(20,20);ctx.fillRect(256,616,256,256);
  // The deck itself is plain in the artwork. These are texture samples for
  // the real masonry coping, not palette replacements for missing pixels.
  const ox=spec.roofRoom?8:0;
  // Five source pixels across both rims: dark border, three copper/tan bands,
  // and the dark inner boundary. Keep the original source gradient.
  for(let i=0;i<5;i++){ctx.drawImage(image,ox+i,10,1,1,500+i,616,1,256);ctx.drawImage(image,20,i,1,1,480+i,616,1,256);}
  ctx.drawImage(image,ox+1,3,1,1,506,616,2,256);
  ctx.drawImage(image,ox+4,10,1,1,508,616,4,256);
 }
 function sections(ring){
  const ys=[...new Set(ring.map(p=>p.y))].sort((a,b)=>a-b),xs=[...new Set(ring.map(p=>p.x))].sort((a,b)=>a-b),out=[];
  const inside=(x,y)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
  for(let i=1;i<ys.length;i++){let start=null;for(let j=1;j<=xs.length;j++){
   const yes=j<xs.length&&inside((xs[j-1]+xs[j])/2,(ys[i-1]+ys[i])/2);
   if(yes&&start===null)start=xs[j-1];if(!yes&&start!==null){const prior=out.find(s=>s.x0===start&&s.x1===xs[j-1]&&s.y1===ys[i-1]);if(prior)prior.y1=ys[i];else out.push({x0:start,x1:xs[j-1],y0:ys[i-1],y1:ys[i]});start=null;}
  }}return out;
 }
 function build(template,spec,key,polygon){
  const W=spec.right-spec.left,facadeHeight=spec.base-spec.eave,H=facadeHeight/C,deckHeight=H+(spec.slabHeight||0)/C;
  let ring=(polygon||[[0,0],[W,0],[W,spec.depth*2],[0,spec.depth*2]]).map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:{...p});
  validateFootprint(ring);if(ring[0].x===ring.at(-1).x&&ring[0].y===ring.at(-1).y)ring.pop();
  const area=ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a.x*b.y-b.x*a.y},0)/2;if(area<0)ring.reverse();
  const faces=[];
  // Native roof surfaces use the calibrated source projection, retaining all
  // four authored rim edges; inferred footprints keep the sampled materials.
  const quad=(ps,uv,kind='wall',projectSource=true)=>{if(projectSource&&!polygon&&kind==='roof')uv=ps.map(p=>[Math.max(.001,Math.min(W-.001,p.x)),16+Math.max(.001,Math.min(spec.base-.001,spec.base-spec.depth+p.y*.5-p.z*C))]);for(const ids of [[0,1,2],[0,2,3]]){const points=ids.map(i=>({...ps[i],tu:uv[i][0]/512,tv:uv[i][1]/1024}));faces.push({...template,points,projected:points.map(()=>({})),kind,feature:'body',sourceArt:true,layer:0,fallbackUV:[280.5/512,640.5/1024],wallDirection:kind==='wall'?{x:points[1].x-points[0].x,y:points[1].y-points[0].y}:undefined});}};
  const constant=(ps,x=280.5,y=640.5,kind='roof')=>quad(ps,ps.map(()=>[x,y]),kind),P=(p,z)=>({...p,z});
  // Keep the native roof silhouette and tuck the masonry underneath its lip.
  // Shared mitred corners seal convex and concave walls under rotation.
  const wallRing=spec.ppFlat?ring.map((p,i)=>{const prev=ring[(i+ring.length-1)%ring.length],next=ring[(i+1)%ring.length],a=Math.hypot(p.x-prev.x,p.y-prev.y),b=Math.hypot(next.x-p.x,next.y-p.y),nx=(p.y-prev.y)/a,ny=-(p.x-prev.x)/a,mx=(next.y-p.y)/b,my=-(next.x-p.x)/b,den=1+nx*mx+ny*my;return {x:p.x-3*(nx+mx)/den,y:p.y-4.8*(ny+my)/den};}):ring;
  const spans=sections(ring);
  for(const s of spans){const ps=[{x:s.x0,y:s.y0},{x:s.x1,y:s.y0},{x:s.x1,y:s.y1},{x:s.x0,y:s.y1}];if(spec.ppFlat&&polygon){
    // Repeat deck texels in surface space; keep the coping above the deck so
    // their shared footprint cannot flicker in the depth buffer.
    for(let y=s.y0;y<s.y1;y+=128)for(let x=s.x0;x<s.x1;x+=128){const x1=Math.min(x+128,s.x1),y1=Math.min(y+128,s.y1),tile=[{x,y},{x:x1,y},{x:x1,y:y1},{x,y:y1}];quad(tile.map(p=>P(p,deckHeight-.2)),tile.map(p=>[256+((x%16+16)%16)+p.x-x,616+((y*.5%16+16)%16)+(p.y-y)*.5]),'roof',false);}
   }else constant(ps.map(p=>P(p,deckHeight)));constant(ps.slice().reverse().map(p=>P(p,spec.ppFlat?H:0)),280.5,640.5,'floor');}
  if(spec.ppFlat)for(const s of sections(wallRing))constant([{x:s.x0,y:s.y1,z:0},{x:s.x1,y:s.y1,z:0},{x:s.x1,y:s.y0,z:0},{x:s.x0,y:s.y0,z:0}],280.5,640.5,'floor');
  // Two source pixels of corner masonry leave each adjacent window complete.
  const facadeLayout=len=>{if(Math.abs(len-(spec.ppFlat?W-6:W))<1)return {parts:[[0,len,W,0]],center:len/2};const edge=Math.min(2,len/4),bay=W-2*edge,count=Math.floor((len-2*edge)/bay),gap=(len-2*edge-count*bay)/2,parts=[[0,edge,W,W-edge]];if(gap>0)parts.push([edge,edge+gap,256+gap,256]);for(let i=0;i<count;i++)parts.push([edge+gap+i*bay,edge+gap+(i+1)*bay,W-edge,edge]);if(gap>0)parts.push([len-edge-gap,len-edge,256+gap,256]);parts.push([len-edge,len,edge,0]);return {parts,center:len/2};};
  wallRing.forEach((a,i)=>{const b=wallRing[(i+1)%wallRing.length],len=Math.hypot(b.x-a.x,b.y-a.y),dx=(b.x-a.x)/len,dy=(b.y-a.y)/len,layout=facadeLayout(len),at=(t,z,out=0)=>({x:a.x+dx*t+dy*out,y:a.y+dy*t-dx*out,z});
   for(const [l,r,u0,u1] of layout.parts)quad([at(l,0),at(r,0),at(r,H),at(l,H)],[[u0,900+facadeHeight],[u1,900+facadeHeight],[u1,900],[u0,900]]);

   if(a.y===b.y&&a.x>b.x&&len>20){const [u,v,w,h]=spec.door,l=Math.max(2,Math.min(len-w-2,layout.center-w/2));quad([at(l,0,.04),at(l+w,0,.04),at(l+w,h/C,.04),at(l,h/C,.04)],[[u+w,v+h+16],[u,v+h+16],[u,v+16],[u+w,v+16]]);}
  });
  if(spec.slabHeight)ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length];quad([P(a,H),P(b,H),P(b,deckHeight),P(a,deckHeight)],[[8,16+spec.eave],[24,16+spec.eave],[24,16+spec.eave-spec.slabHeight],[8,16+spec.eave-spec.slabHeight]],'roof',false);});
  // Mitred boundary rings share their corner vertices, so head-on corners do
  // not expose a slit. The slab and parapet overlap the sealed wall roof joint.
  function parapet(outline,z,amount=0,width=5,rise=1/C){
   const ns=outline.map((a,i)=>{const b=outline[(i+1)%outline.length],d=Math.hypot(b.x-a.x,b.y-a.y);return {x:(b.y-a.y)/d,y:-(b.x-a.x)/d};});
   const offset=distance=>outline.map((p,i)=>{const a=ns[(i+ns.length-1)%ns.length],b=ns[i],den=1+a.x*b.x+a.y*b.y;return {x:p.x+distance*(a.x+b.x)/den,y:p.y+1.6*distance*(a.y+b.y)/den};});
   const outer=offset(amount),inner=offset(-width),top=z+rise,bottom=z-.7;
   for(let i=0;i<outline.length;i++){const j=(i+1)%outline.length,a=outer[i],b=outer[j],c=inner[j],d=inner[i];
    const u=a.y===b.y?480.5:500.5;quad([P(a,top),P(b,top),P(c,top),P(d,top)],[[u,616.5],[u,616.5],[u+4,616.5],[u+4,616.5]],'roof');
    constant([P(a,bottom),P(b,bottom),P(b,top),P(a,top)],506.5,616.5);
    constant([P(c,z),P(d,z),P(d,top),P(c,top)],508.5,616.5);
    constant([P(d,bottom),P(c,bottom),P(b,bottom),P(a,bottom)],506.5,616.5);
   }
  }
  if(spec.ppFlat)parapet(ring,deckHeight,0,3,0);else parapet(ring,H);
  if(spec.roofRoom){
   const s=spans.reduce((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)>(a.x1-a.x0)*(a.y1-a.y0)?b:a),rw=Math.min(32,s.x1-s.x0-10),rd=Math.min(78,s.y1-s.y0-12);
   if(rw>=12&&rd>=16){const x=(s.x0+s.x1-rw)/2,y=s.y0,z=H+8/C,room=[{x,y},{x:x+rw,y},{x:x+rw,y:y+rd},{x,y:y+rd}];
    constant(room.map(p=>P(p,z)));room.forEach((a,i)=>{const b=room[(i+1)%4],len=Math.hypot(b.x-a.x,b.y-a.y);for(let t=0;t<len;t+=32){const end=Math.min(len,t+32),at=n=>({x:a.x+(b.x-a.x)*n/len,y:a.y+(b.y-a.y)*n/len});quad([P(at(t),H),P(at(end),H),P(at(end),z),P(at(t),z)],[[40,64],[40-(end-t),64],[40-(end-t),56],[40,56]]);}});parapet(room,z,0,Math.min(5,rw/3,rd/4.8),1/C);
   }
  }
  faces.footprintInfo={polygon:ring,area:Math.abs(area),roofPitch:0,mode:spec.ppFlat?'Pixel Plains flat shop':spec.roofRoom?'flat adobe roof with rooftop room':'flat adobe roof with parapet',physical:true,sections:spans.length};return faces;
 }
 root.FlatBuildings={specs,prepare,build};
})(typeof window==='undefined'?globalThis:window);
