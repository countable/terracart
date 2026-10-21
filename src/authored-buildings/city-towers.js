/* Low-poly source-painted clock and chimney towers from City tile B-03. */
(function(root){
 const C=Math.cos(Math.PI/6);
 function prepare(ctx,image,spec,key){
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d');c.drawImage(image,0,0);
  // Extrude the nearest opaque texel before sampling an atlas edge.
  const data=c.getImageData(0,0,canvas.width,canvas.height),a=data.data;
  for(let y=0;y<canvas.height;y++){const xs=[];for(let x=0;x<canvas.width;x++)if(a[(y*canvas.width+x)*4+3]>128)xs.push(x);if(!xs.length)continue;for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(a[i+3]>128)continue;let n=xs.reduce((p,q)=>Math.abs(q-x)<Math.abs(p-x)?q:p);for(let k=0;k<4;k++)a[i+k]=a[(y*canvas.width+n)*4+k];}}
  c.putImageData(data,0,0);ctx.drawImage(canvas,0,16);
  ctx.drawImage(canvas,22,136,52,56,0,600,52,56);
  ctx.drawImage(canvas,22,136,52,56,128,600,52,56);
  // Keep the upper vent; remove only entrance dressing on the other elevations.
  for(let x=140;x<168;x+=5)ctx.drawImage(canvas,29,160,5,32,x,624,Math.min(5,168-x),32);
  for(let y=600;y<720;y+=16)for(let x=256;x<384;x+=8)ctx.drawImage(canvas,29,140,8,16,x,y,8,16);
  const swatch=(sx,sy,x,y,w,h)=>ctx.drawImage(canvas,sx,sy,1,1,x,y,w,h);
  swatch(28,130,400,600,16,16);swatch(28,132,416,600,16,16);swatch(28,123,432,600,16,16);
  // The deck sample excludes the baked stack silhouette.
  swatch(29,119,256,720,128,128);
  if(!key.includes('clock')){
   ctx.drawImage(canvas,22,104,52,24,256,864,52,48);
   // Only the baked collar/shaft footprint is repaired; source coping survives.
   swatch(29,119,264,864,36,40);
   for(let x=264;x<300;x+=4)ctx.drawImage(canvas,25,104,4,4,x,864,4,8);
  }

  if(key.includes('clock')){
   ctx.drawImage(canvas,28,98,40,28,0,700,40,28);
   // Side width is 26: crop the surrounding frame, never squeeze the clock.
   ctx.drawImage(canvas,35,98,26,28,64,700,26,28);
   swatch(48,87,400,720,32,32);swatch(32,85,432,720,32,32);swatch(48,71,464,720,32,32);
  }else{
   for(let y=0;y<67;y++)for(let x=0;x<128;x++)ctx.drawImage(canvas,44+x%8,Math.max(56,48+y),1,1,x,700+y,1,1);
   swatch(47,48,400,720,32,32);swatch(43,54,432,720,32,32);swatch(47,49,464,720,32,32);ctx.fillStyle='#292627';ctx.fillRect(464,720,32,32);
  }
 }
 function build(template,spec,key,polygon){
  const ring=(polygon||(key.includes('clock')?[[0,0],[52,0],[52,spec.depth*2],[0,spec.depth*2]]:[[2,0],[50,0],[50,40],[2,40]])).map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:{...p});
  validateFootprint(ring);if(ring.length>4&&ring[0].x===ring.at(-1).x&&ring[0].y===ring.at(-1).y)ring.pop();
  let area=ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a.x*b.y-b.x*a.y;},0)/2;if(area<0)ring.reverse();
  const faces=[],H=56/C,T=66/C,P=(x,y,z)=>({x,y,z});
  function poly(ps,uv,kind='wall'){for(let i=1;i<ps.length-1;i++){const points=[0,i,i+1].map(j=>({...ps[j],tu:uv[j][0]/512,tv:uv[j][1]/1024}));faces.push({...template,points,projected:points.map(()=>({})),kind,feature:'body',sourceArt:true,layer:0,fallbackUV:[407.5/512,607.5/1024]});}}
  const solid=(ps,u=407.5,v=607.5,kind='roof')=>poly(ps,ps.map(()=>[u,v]),kind);
  const xs=[...new Set(ring.map(p=>p.x))].sort((a,b)=>a-b),ys=[...new Set(ring.map(p=>p.y))].sort((a,b)=>a-b),cells=[];
  const inside=(x,y)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
  const nativeChimney=!polygon&&!key.includes('clock'),deckUV=p=>nativeChimney?[256+p.x,868+p.y]:[280.5,740.5];
  for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++)if(inside((xs[i-1]+xs[i])/2,(ys[j-1]+ys[j])/2)){const s={x0:xs[i-1],x1:xs[i],y0:ys[j-1],y1:ys[j]};cells.push(s);const ps=[P(s.x0,s.y0,T),P(s.x1,s.y0,T),P(s.x1,s.y1,T),P(s.x0,s.y1,T)];poly(ps,key.includes('clock')?[[256,720],[256+s.x1-s.x0,720],[256+s.x1-s.x0,720+s.y1-s.y0],[256,720+s.y1-s.y0]].map(([u,v])=>[Math.min(383,u),Math.min(847,v)]):ps.map(deckUV),'roof');solid(ps.slice().reverse().map(p=>({...p,z:0})),407.5,607.5,'floor');}
  const normals=ring.map((a,i)=>{const b=ring[(i+1)%ring.length],len=Math.hypot(b.x-a.x,b.y-a.y);return {x:(b.y-a.y)/len,y:-(b.x-a.x)/len};}),outer=ring.map((p,i)=>{const a=normals[(i+ring.length-1)%ring.length],b=normals[i],den=1+a.x*b.x+a.y*b.y;return {x:p.x+2*(a.x+b.x)/den,y:p.y+4*(a.y+b.y)/den};});
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b.x-a.x,b.y-a.y),at=(t,z)=>P(a.x+(b.x-a.x)*t/len,a.y+(b.y-a.y)*t/len,z),front=a.y===b.y&&a.x>b.x,bay=key.includes('clock')?52:48;
   for(let t=0;t<len;t+=bay){const end=Math.min(len,t+bay),w=end-t,u=(front?0:128)+(key.includes('clock')?52:50);poly([at(t,0),at(end,0),at(end,H),at(t,H)],[[u,656],[u-w,656],[u-w,600],[u,600]]);}
   if(key.includes('clock'))poly([at(0,H),at(len,H),at(len,T),at(0,T)],!polygon&&front?[[74,152],[22,152],[22,142],[74,142]]:[[27,152],[73,152],[73,142],[27,142]]);
   else{const oa=outer[i],ob=outer[(i+1)%ring.length],z=H+2/C,ps=[P(oa.x,oa.y,z),P(ob.x,ob.y,z),P(ob.x,ob.y,T),P(oa.x,oa.y,T)];poly(ps,nativeChimney&&front?ps.map(p=>[22+p.x,208-p.z*C-(40-p.y)*.5]):[[28.5,152],[28.5,152],[28.5,144],[28.5,144]]);solid([at(0,H),at(len,H),P(ob.x,ob.y,z),P(oa.x,oa.y,z)],407.5,607.5);const top=[P(oa.x,oa.y,T),P(ob.x,ob.y,T),at(len,T),at(0,T)];if(nativeChimney)poly(top,top.map(deckUV),'roof');else solid(top,26.5,142.5);}
  }
  // Place the major feature on the largest roof rectangle, keeping custom
  // concave footprints covered by the same closed deck and facade material.
  const s=cells.reduce((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)>(a.x1-a.x0)*(a.y1-a.y0)?b:a),cx=(s.x0+s.x1)/2,cy=(s.y0+s.y1)/2;
  if(key.includes('clock')&&!polygon){
   // Raised copper shoulders: original side-strip pixels, with the intact
   // deck sealing their undersides and the clock walls meeting their inner edges.
   const source=p=>[22+p.x,208-p.z*C-(36-p.y)*.5];
   for(const x of [0,46]){const top=[P(x,0,T+3/C),P(x+6,0,T+3/C),P(x+6,36,T+3/C),P(x,36,T+3/C)];poly(top,top.map(source),'roof');
    for(let i=0;i<4;i++){const j=(i+1)%4,ps=[{...top[i],z:T},{...top[j],z:T},top[j],top[i]];poly(ps,i%2?ps.map(p=>[x===0?24.5:71.5,142-(p.z-T)*C]):ps.map(p=>source(i===0?{...p,y:36-p.y}:p)));}
   }
  }
  if(key.includes('clock')){
   const native=!polygon,w=Math.min(native?40:42,s.x1-s.x0-4),d=Math.min(26,s.y1-s.y0-4),z0=T,z1=T+28/C,roofTop=z1+15/C,bodyY=native?cy+5:cy;
   if(w>8&&d>8){const ps=[P(cx-w/2,bodyY-d/2,z1),P(cx+w/2,bodyY-d/2,z1),P(cx+w/2,bodyY+d/2,z1),P(cx-w/2,bodyY+d/2,z1)];
    for(let i=0;i<4;i++){const a=ps[i],b=ps[(i+1)%4];poly([{...a,z:z0},{...b,z:z0},b,a],i%2?[[90,728],[64,728],[64,700],[90,700]]:[[40,728],[0,728],[0,700],[40,700]]);}
    // Source shoulders reach full width at y76; the lower copper lip is four pixels.
    const out=native?[P(3,0,z1+4/C),P(49,0,z1+4/C),P(49,36,z1+4/C),P(3,36,z1+4/C)]:ps.map(p=>({...p,x:cx+(p.x-cx)*(w+3)/w,y:cy+(p.y-cy)*(d+3)/d})),top=native?[P(16,6,roofTop),P(36,6,roofTop),P(36,30,roofTop),P(16,30,roofTop)]:ps.map(p=>({...p,x:cx+(p.x-cx)*.42,y:cy+(p.y-cy)*.9,z:roofTop})),sourceUV=p=>[22+p.x,208-p.z*C-(36-p.y)*.5];
    for(let i=0;i<4;i++){const j=(i+1)%4,roof=[out[i],out[j],top[j],top[i]],lip=[{...out[i],z:native?z1:z1-.8},{...out[j],z:native?z1:z1-.8},out[j],out[i]];const uv=i===2?[[26,110],[70,110],[57,96],[38,96]]:i===0?[[70,110],[26,110],[38,96],[57,96]]:[[432.5,720.5],[432.5,720.5],[400.5,720.5],[400.5,720.5]];poly(roof,native?roof.map(p=>sourceUV(i===0?{...p,y:36-p.y}:p)):uv,'roof');if(native)poly(lip,lip.map(p=>sourceUV(i===0?{...p,y:36-p.y}:p)));else solid(lip,407.5,607.5);solid([ps[i],ps[j],lip[1],lip[0]],407.5,607.5);}
    poly(top,native?top.map(sourceUV):[[38,84],[57,84],[57,96],[38,96]],'roof');
   }
  }else{
   const scale=nativeChimney?1:Math.min(1,(s.x1-s.x0-4)/32,(s.y1-s.y0-4)/40),N=8,z0=T,centerY=cy;
   const circle=(rx,ry,z)=>Array.from({length:N},(_,i)=>{const a=i*Math.PI*2/N+Math.PI/8,q=Math.cos(Math.PI/8);return P(cx+Math.cos(a)/q*rx*scale,centerY+Math.sin(a)/q*ry*scale,z);});
   const rings=[circle(16,16,z0),circle(16,16,z0+6/C),circle(14,14,z0+9/C),circle(8,8,z0+64/C),circle(9,9,z0+68/C)],project=p=>[48+(p.x-cx)/scale,16+116-(p.z-z0)*C+(p.y-centerY)/scale*.5];
   for(let k=0;k<rings.length-1;k++)for(let i=0;i<N;i++){const j=(i+1)%N,ps=[rings[k][i],rings[k][j],rings[k+1][j],rings[k+1][i]];if(i<4)poly(ps,ps.map(project));else if(k<2)solid(ps,48.5,134.5,'wall');else poly(ps,[[i*16,768-(rings[k][i].z-z0)*C],[(i+1)*16,768-(rings[k][i].z-z0)*C],[(i+1)*16,768-(rings[k+1][i].z-z0)*C],[i*16,768-(rings[k+1][i].z-z0)*C]]);}
   const top=rings.at(-1),inner=circle(6.5,6.5,z0+68/C);for(let i=0;i<N;i++){const j=(i+1)%N,ps=[top[i],top[j],inner[j],inner[i]];if(i<4)poly(ps,ps.map(project),'roof');else solid(ps,44.5,70.5);}
   const bottom=inner.map(p=>({...p,z:p.z-3}));for(let i=0;i<N;i++){const j=(i+1)%N;solid([inner[i],inner[j],bottom[j],bottom[i]],464.5,720.5);}solid(bottom,464.5,720.5);
  }
  faces.footprintInfo={polygon:ring,area:Math.abs(area),roofPitch:0,mode:key.includes('clock')?'City clock tower':'City chimney tower',physical:true,sections:cells.length};return faces;
 }
 root.CityTowers={prepare,build};
})(typeof window==='undefined'?globalThis:window);
