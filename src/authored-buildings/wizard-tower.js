/* The wizard sprite is a round shaft and cone, not a tall gabled house.
   Its twelve-sided shell is calibrated to the same 30 degree camera. */
(function(root){
 const C=Math.cos(Math.PI/6),N=12;
 const roofRows=[];
 const spec={label:'Wizard tower · purple restored artwork',image:'wizard.png',crop:[240,0,80,142],left:16,right:64,base:138,eave:64,peak:16,depth:24,center:40,back:40,backPeak:0,wall:[18,70,12,36],posts:[16,18,62,64],bands:[64,138],door:[34,116,13,20],wizard:true};
 function prepare(ctx,image){
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=142;const c=canvas.getContext('2d');c.drawImage(image,0,0);
  // Carry boundary texels outward. The roof/shaft boundary stays stone or tile,
  // including oblique edge samples, instead of falling through to a swatch.
  for(const ox of [0,80,160,240]){const d=c.getImageData(ox,0,80,142),p=d.data,seen=new Uint8Array(80*142),q=new Int32Array(80*142);let head=0,tail=0;
   for(let i=0;i<seen.length;i++)if(p[i*4+3]){seen[i]=1;q[tail++]=i;}
   while(head<tail){const i=q[head++],x=i%80;for(const j of [x?i-1:-1,x<79?i+1:-1,i-80,i+80]){if(j<0||j>=seen.length||seen[j])continue;seen[j]=1;q[tail++]=j;for(let k=0;k<3;k++)p[j*4+k]=p[i*4+k];p[j*4+3]=255;}}
   c.putImageData(d,ox,0);
  }
  ctx.drawImage(canvas,0,16);
  // The sprite outline belongs to the rendered silhouette, not to a meridian
  // on the cone. Keep projected edge UVs inside the purple roof material.
  const roofPixels=c.getImageData(240,0,80,70).data;
  for(let y=14;y<65;y++){const xs=[];for(let x=8;x<72;x++){const i=(y*80+x)*4,r=roofPixels[i],g=roofPixels[i+1],b=roofPixels[i+2];if(r>g*1.4&&b>g*1.4&&r>65)xs.push(240+x);}if(xs.length>2)roofRows[y]=[xs[0]+1.5,xs.at(-1)-.5];}

  const color=(x,y)=>{const p=c.getImageData(x,y,1,1).data;return `rgb(${p[0]},${p[1]},${p[2]})`;},base=color(279,34),dark=color(280,30),light=color(271,28);
  ctx.fillStyle=base;ctx.fillRect(256,616,256,256);
  for(let y=616;y<872;y+=8)for(let x=246;x<512;x+=12){const u=x+(Math.floor((y-616)/8)%2)*6;ctx.fillStyle=dark;ctx.fillRect(Math.max(256,u),y,Math.max(0,Math.min(512,u+12)-Math.max(256,u)),1);if(u>=256)ctx.fillRect(u,y,1,8);ctx.fillStyle=light;if(u+2>=256&&u+10<512)ctx.fillRect(u+2,y+1,5+((x+y)%3),1);}

 }
 function build(template,a,ring=null){
  const width=ring?Math.max(...ring.map(p=>p.x))-Math.min(...ring.map(p=>p.x)):48,depth=ring?Math.max(...ring.map(p=>p.y))-Math.min(...ring.map(p=>p.y)):48;
  if(ring)return buildPolygon(template,a,ring);
  const faces=[],rx=width/2,ry=depth/2,cx=rx,cy=ry,H=74/C;
  function polygon(points,uv,kind='wall'){for(let i=1;i<points.length-1;i++){const indices=[0,i,i+1],ps=indices.map(j=>({...points[j],tu:uv[j][0]/512,tv:(uv[j][1]+16)/1024}));faces.push({...template,points:ps,projected:ps.map(()=>({})),kind,feature:'body',sourceArt:true,layer:0,fallbackUV:[280.5/512,100.5/1024],wallDirection:kind==='wall'?{x:ps[1].x-ps[0].x,y:ps[1].y-ps[0].y}:undefined});}}
  const point=(i,r,z)=>({x:cx+Math.cos(i*2*Math.PI/N)*rx*r,y:cy+Math.sin(i*2*Math.PI/N)*ry*r,z});
  const uv=(p,rear=false)=>[280+(p.x-cx)*24/rx,126+Math.abs(p.y-cy)*24/ry*.5-C*p.z];
  // Unwrap every facet against the same front-facing source wedge. Global
  // projected UVs bake the front camera into the side and form chevrons.
  const facetUV=(p,i)=>{const theta=(i+.5)*2*Math.PI/N-Math.PI/2,dx=p.x-cx,dy=p.y-cy;return uv({x:cx+dx*Math.cos(theta)+dy*Math.sin(theta),y:cy-dx*Math.sin(theta)+dy*Math.cos(theta),z:p.z});};
  const roofUV=(p,i=0)=>{const angle=(Math.atan2(p.y-cy,p.x-cx)+Math.PI*2)%(Math.PI*2),vertex=Math.round(angle*N/(Math.PI*2))%N;
   // Keep the central source-facing facets exact; adjacent sectors share their
   // boundary coordinates before returning to the quiet circumferential wedge.
   const t=(i===2||i===3||i===1&&vertex===2||i===4&&vertex===4)?uv(p):facetUV(p,i),row=roofRows[Math.max(14,Math.min(64,Math.round(t[1])))];if(row)t[0]=Math.max(row[0],Math.min(row[1],t[0]));return t;};
  for(let i=0;i<N;i++){const j=i+1,rear=Math.sin((i+.5)*2*Math.PI/N)<0,points=[point(i,1,0),point(j,1,0),point(j,1,H),point(i,1,H)];polygon(points,points.map(p=>facetUV(p,i)));}
  // Closed foundation and roof underside; an overhanging rim overlaps the wall.
  const base=Array.from({length:N},(_,i)=>point(N-i,1,0));polygon(base,base.map(()=>[265.5,120.5]),'floor');
  const rimZ=77/C,rimR=1.25;
  for(let i=0;i<N;i++){const j=i+1,rear=Math.sin((i+.5)*2*Math.PI/N)<0,ps=[point(i,1,H-.4),point(j,1,H-.4),point(j,rimR,rimZ),point(i,rimR,rimZ)];polygon(ps,ps.map(p=>roofUV(p,i)),'roof');}
  // Ring widths follow the sprite's flared silhouette. Each band is a frustum;
  // no single stretched triangle runs from the eave all the way to the finial.
  const rings=[[1.25,77/C],[.96,84/C],[.67,91/C],[.46,99/C],[.28,108/C],[.22,111/C],[.20,112/C]];
  for(let r=1;r<rings.length;r++)for(let i=0;i<N;i++){const j=i+1,rear=Math.sin((i+.5)*2*Math.PI/N)<0,[lo,z0]=rings[r-1],[hi,z1]=rings[r],ps=[point(i,lo,z0),point(j,lo,z0),point(j,hi,z1),point(i,hi,z1)];polygon(ps,ps.map(p=>roofUV(p,i)),'roof');}
  const roofCap=Array.from({length:N},(_,i)=>point(i,.20,112/C));polygon(roofCap,roofCap.map(p=>[280,14]),'roof');
  // Six-sided floating crystal with solid cyan facets, matching the source gem.
  const crystal=[];for(let i=0;i<6;i++)crystal.push({x:cx+Math.cos(i*Math.PI/3)*4,y:cy+Math.sin(i*Math.PI/3)*4,z:120/C});
  for(let i=0;i<6;i++){const j=(i+1)%6,ps=[crystal[i],crystal[j],{x:cx,y:cy,z:126/C}];polygon(ps,[[277,7],[283,7],[280,2]],'roof');polygon([crystal[j],crystal[i],{x:cx,y:cy,z:115/C}],[[283,7],[277,7],[280,12]],'roof');}
  return faces;
 }
 // Orthogonal footprints retain their actual perimeter. Disjoint roof cells
 // cover concave wings without triangles bridging courtyards or membrane holes.
 function buildPolygon(template,a,ring){
  const faces=[],H=74/C,Z=117/C;
  function poly(ps,uv,kind='wall'){for(let i=1;i<ps.length-1;i++){const p=[0,i,i+1].map(j=>({...ps[j],tu:uv[j][0]/512,tv:(uv[j][1]+16)/1024}));faces.push({...template,points:p,projected:p.map(()=>({})),kind,feature:'body',sourceArt:true,layer:0,fallbackUV:[280.5/512,100.5/1024],wallDirection:kind==='wall'?{x:p[1].x-p[0].x,y:p[1].y-p[0].y}:undefined});}}
  let r=ring.map(p=>({...p}));if(r.reduce((s,p,i)=>s+p.x*r[(i+1)%r.length].y-r[(i+1)%r.length].x*p.y,0)<0)r.reverse();
  const inside=(x,y)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
  for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],L=Math.hypot(b.x-a.x,b.y-a.y);for(let k=0;k<L;k+=36){const end=Math.min(L,k+36),at=(t,z)=>({x:a.x+(b.x-a.x)*t/L,y:a.y+(b.y-a.y)*t/L,z});poly([at(k,0),at(end,0),at(end,H),at(k,H)],[[262,135],[262+end-k,135],[262+end-k,65],[262,65]]);}}
  const xs=[...new Set(r.map(p=>p.x))].sort((a,b)=>a-b),ys=[...new Set(r.map(p=>p.y))].sort((a,b)=>a-b),cells=[];
  for(let j=1;j<ys.length;j++){let start=null;for(let i=1;i<=xs.length;i++){const occupied=i<xs.length&&inside((xs[i-1]+xs[i])/2,(ys[j-1]+ys[j])/2);if(occupied&&start===null)start=xs[i-1];if(!occupied&&start!==null){const b=xs[i-1],previous=cells.find(c=>c.x0===start&&c.x1===b&&c.y1===ys[j-1]);if(previous)previous.y1=ys[j];else cells.push({x0:start,x1:b,y0:ys[j-1],y1:ys[j]});start=null;}}}
  for(const cell of cells){const {x0,x1,y0,y1}=cell,cx=(x0+x1)/2,cy=(y0+y1)/2,base=[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}],levels=[[1,H],[.92,H+7/C],[.73,H+14/C],[.52,H+22/C],[.31,H+31/C],[.12,Z]];
   const point=(i,s,z)=>({x:cx+(base[i].x-cx)*s,y:cy+(base[i].y-cy)*s,z});
   poly(base.slice().reverse().map(p=>({...p,z:0})),Array(4).fill([265.5,120.5]),'floor');
   for(let k=1;k<levels.length;k++)for(let i=0;i<4;i++){const j=(i+1)%4,[r0,z0]=levels[k-1],[r1,z1]=levels[k],ps=[point(i,r0,z0),point(j,r0,z0),point(j,r1,z1),point(i,r1,z1)],v0=65-(z0-H)*C,v1=65-(z1-H)*C;const length=Math.min(240,Math.hypot(ps[1].x-ps[0].x,ps[1].y-ps[0].y)),slope=Math.min(240,Math.hypot(ps[3].x-ps[0].x,ps[3].y-ps[0].y,ps[3].z-ps[0].z));const course=levels.slice(1,k).reduce((sum,level,m)=>{const p=point(i,levels[m][0],levels[m][1]),q=point(i,level[0],level[1]);return sum+Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z);},0);poly(ps,[[256,600+course],[256+length,600+course],[256+length*(1+r1/r0)/2,600+course+slope],[256+length*(1-r1/r0)/2,600+course+slope]],'roof');}
   const cap=base.map((p,i)=>point(i,.12,Z));poly(cap,[[256,600],[264,600],[264,608],[256,608]],'roof');
  }
  return faces;
 }
 root.WizardTower={spec,prepare,build};
})(typeof window==='undefined'?globalThis:window);
