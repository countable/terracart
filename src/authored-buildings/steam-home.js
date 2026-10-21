/* Original steampunk/4.png home. Artwork facades with physical copper roofs. */
(function(root){
 const C=Math.cos(Math.PI/6);
 const spec={label:'Original 4.png · home',image:'steam-home.png',crop:[0,0,144,192],left:24,right:119,base:189,eave:96,peak:52,back:44,backPeak:0,center:71.5,depth:52,wall:[31,98,16,90],posts:[24,30,113,119],bands:[96,101,139,145,189],door:[60,158,23,31],steamHome:true};
 function prepare(ctx,image){
  ctx.drawImage(image,0,16);
  const scratch=document.createElement('canvas');scratch.width=image.width;scratch.height=image.height;const c=scratch.getContext('2d');c.drawImage(image,0,0);
  const sample=(x,y)=>{const p=c.getImageData(x,y,1,1).data;return `rgb(${p[0]},${p[1]},${p[2]})`;};
  const cream=sample(35,108),timber=sample(72,106),dark=sample(29,101);
  ctx.fillStyle=cream;ctx.fillRect(0,600,256,424);
  // The complete facade repeats without a door, canopy or its flanking posts.
  const f=document.createElement('canvas');f.width=95;f.height=93;const g=f.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(image,24,96,95,93,0,0,95,93);
  g.fillStyle=cream;g.fillRect(23,23,49,70);
  // Quiet source plaster keeps the inferred bays mottled at native texel scale.
  for(let y=25;y<91;y+=9)for(let x=25;x<70;x+=8){g.globalAlpha=.12;g.fillStyle=((x+y)%3)?sample(35,108):sample(36,132);g.fillRect(x+(y%3),y,2,2);}g.globalAlpha=1;
  for(let x=23;x<72;x+=10)g.drawImage(image,39,168,Math.min(10,72-x),20,x,72,Math.min(10,72-x),20);
  g.drawImage(image,39,102,19,25,15,6,19,25);g.drawImage(image,86,102,19,25,62,6,19,25);
  // The inferred post and floor beam retain the source's dark edges and grain.
  for(let y=0;y<93;y+=22)g.drawImage(image,69,102,5,22,45,y,5,Math.min(22,93-y));
  for(let x=0;x<95;x+=18)g.drawImage(image,32,136,18,5,x,43,Math.min(18,95-x),5);
  for(let x=0;x<256;x+=95)ctx.drawImage(f,x,900);
  ctx.drawImage(image,31,98,16,90,0,616,256,128);
  // Rectangular chimney courses keep their native height on all four faces.
  for(let y=400;y<528;y+=34)for(let x=160;x<208;x+=11)ctx.drawImage(image,30,28,11,34,x,y,Math.min(11,208-x),Math.min(34,528-y));
  // Native roof pixels retain the source's painted copper. Only the two
  // occluding structures are repaired with copper from their own roof plane.
  const roof=document.createElement('canvas');roof.width=144;roof.height=192;const rg=roof.getContext('2d');rg.imageSmoothingEnabled=false;rg.drawImage(image,0,0);
  const original=c.getImageData(0,0,144,192),repaired=rg.getImageData(0,0,144,192);
  for(let y=0;y<96;y++)for(let x=24;x<120;x++){
   const top=44*Math.abs(x-71.5)/47.5;if(y<top||y>top+52)continue;
   const chimney=x>=28&&x<=43&&y<=63,dormer=(x>=85&&x<=114&&y>=28&&y<=51)||(x>=96&&x<=111&&y>51&&y<=64);
   if(!chimney&&!dormer)continue;
   let sx=x,sy=chimney?Math.floor(top+36+(y-top)*.35):Math.round(y-top+44*Math.abs(116-71.5)/47.5);if(dormer)sx=116;
   sy=Math.max(0,Math.min(191,sy));const from=(sy*144+sx)*4,to=(y*144+x)*4;for(let k=0;k<4;k++)repaired.data[to+k]=original.data[from+k];
  }
  // Roof-edge raster steps may lie outside the painted silhouette. Extend
  // nearby copper into that one-pixel fringe rather than sampling white/alpha.
  const clean=new Uint8ClampedArray(repaired.data);
  for(let x=24;x<120;x++){const top=44*Math.abs(x-71.5)/47.5;for(let y=Math.max(0,Math.floor(top)-2);y<=Math.min(191,Math.ceil(top+52)+2);y++){
   const to=(y*144+x)*4,r=clean[to],g=clean[to+1],b=clean[to+2],outside=y<top||y>top+52;
   if(!outside&&clean[to+3]>=250&&!(r>120&&g>r*.9&&b>r*.9))continue;
   let sy=Math.max(Math.ceil(top)+3,Math.min(Math.floor(top+52)-3,y)),from=(sy*144+x)*4;
   for(let k=0;k<4;k++)repaired.data[to+k]=clean[from+k];
  }}
  rg.putImageData(repaired,0,0);ctx.drawImage(roof,256,200);
  // Copper shingles are drawn orthogonally in roof space. Their palette is
  // sampled from the artwork; perspective is supplied only by the roof mesh.
  const colors=[sample(54,39),sample(49,42),sample(57,33),sample(50,37)];
  ctx.fillStyle=colors[0];ctx.fillRect(256,616,256,256);
  // Native shingles are small, irregular copper scales, not broad brickwork.
  // Keep their dimensions in roof space, so rotating does not enlarge the art.
  ctx.save();ctx.beginPath();ctx.rect(256,616,240,240);ctx.clip();
  for(let y=0;y<240;y+=7)for(let x=-8;x<240;x+=8){const row=y/7,offset=(row%2)*4,xx=256+x+offset,n=((x/8+32)*13+row*7)%5;
   ctx.fillStyle=colors[n===0?1:0];ctx.fillRect(xx,616+y,8,7);
   ctx.fillStyle=colors[3];ctx.fillRect(xx,622+y,8,1);ctx.fillRect(xx,618+y,1,4);
   ctx.fillStyle=colors[2];ctx.fillRect(xx+1,617+y,5,1);if(n===2)ctx.fillRect(xx+2,619+y,1,2);
   ctx.globalAlpha=.22;ctx.fillStyle=colors[(row+Math.abs(x))%colors.length];ctx.fillRect(xx+2+(row%3),618+y,2,3);ctx.globalAlpha=1;
  }ctx.restore();
  // The ridge's broad golden face has distinct shaded borders and weathering.
  // Sample the actual spine instead of painting the whole cap a flat orange.
  for(let y=200;y<600;y+=32)ctx.drawImage(image,69,12,5,32,224,y,5,Math.min(32,600-y));
  // Native-scale plaster and timber for wide gables, without a stretched attic.
  ctx.fillStyle=cream;ctx.fillRect(0,760,240,120);
  for(let y=760;y<880;y+=9)for(let x=0;x<240;x+=8){ctx.globalAlpha=.12;ctx.fillStyle=((x+y)%3)?sample(35,108):sample(36,132);ctx.fillRect(x+(y%3),y,2,2);}ctx.globalAlpha=1;
  for(let y=760;y<880;y+=22)ctx.drawImage(image,69,102,5,22,117,y,5,Math.min(22,880-y));
  for(let x=0;x<240;x+=18)ctx.drawImage(image,32,136,18,5,x,872,Math.min(18,240-x),5);
  ctx.fillStyle=dark;ctx.fillRect(500,616,4,256);ctx.fillStyle=sample(71,25);ctx.fillRect(504,616,4,256);ctx.fillStyle=colors[2];ctx.fillRect(508,616,4,256);
 }
 function sections(ring){const ys=[...new Set(ring.map(p=>p.y))].sort((a,b)=>a-b),xs=[...new Set(ring.map(p=>p.x))].sort((a,b)=>a-b),out=[];const inside=(x,y)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};for(let i=1;i<ys.length;i++){let start=null;for(let j=1;j<=xs.length;j++){const yes=j<xs.length&&inside((xs[j-1]+xs[j])/2,(ys[i-1]+ys[i])/2);if(yes&&start===null)start=xs[j-1];if(!yes&&start!==null){const prev=out.find(s=>s.x0===start&&s.x1===xs[j-1]&&s.y1===ys[i-1]);if(prev)prev.y1=ys[i];else out.push({x0:start,x1:xs[j-1],y0:ys[i-1],y1:ys[i]});start=null;}}}return out;}
 function build(template,spec,key,polygon){
  let ring=(polygon||[[0,0],[95,0],[95,104],[0,104]]).map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:{...p});validateFootprint(ring);if(ring[0].x===ring.at(-1).x&&ring[0].y===ring.at(-1).y)ring.pop();const area=ring.reduce((a,p,i)=>{const q=ring[(i+1)%ring.length];return a+p.x*q.y-q.x*p.y},0)/2;if(area<0)ring.reverse();
  const faces=[],H=93/C,R=44/C,spans=sections(ring),P=(x,y,z)=>({x,y,z});
  const tri=(ps,uv,kind='wall')=>{const points=ps.map((p,i)=>({...p,tu:uv[i][0]/512,tv:uv[i][1]/1024}));faces.push({...template,points,projected:points.map(()=>({})),kind,feature:'body',sourceArt:true,layer:0,fallbackUV:[35.5/512,124.5/1024],wallDirection:kind==='wall'?{x:points[1].x-points[0].x,y:points[1].y-points[0].y}:undefined});};
  const quad=(ps,uv,kind='wall')=>{for(const ids of [[0,1,2],[0,2,3]])tri(ids.map(i=>ps[i]),ids.map(i=>uv[i]),kind);};
  const solid=(ps,u=35.5,v=124.5,kind='wall')=>quad(ps,ps.map(()=>[u,v]),kind);
  const art=(ps,r,kind='wall')=>quad(ps,[[r[0],r[1]+r[3]+16],[r[0]+r[2],r[1]+r[3]+16],[r[0]+r[2],r[1]+16],[r[0],r[1]+16]],kind);
  const reverseArt=(ps,r,kind='wall')=>{const uv=[[r[0],r[1]+r[3]+16],[r[0]+r[2],r[1]+r[3]+16],[r[0]+r[2],r[1]+16],[r[0],r[1]+16]];quad(ps.slice().reverse(),uv.reverse(),kind);};
  const planes=[];
  for(const s of spans){const m=(s.x0+s.x1)/2;
   for(const ps of [[P(s.x0,s.y0,H),P(m,s.y0,H+R),P(m,s.y1,H+R),P(s.x0,s.y1,H)],[P(m,s.y0,H+R),P(s.x1,s.y0,H),P(s.x1,s.y1,H),P(m,s.y1,H+R)]]){planes.push(ps);if(!polygon)quad(ps,ps.map(p=>[280+p.x,337+p.y*.5-p.z*C]),'roof');else RoofMaterials.emit(ps,key,quad);}
   if(s.x1-s.x0<=110){
    tri([P(s.x1,s.y1,H),P(s.x0,s.y1,H),P(m,s.y1,H+R)],[[119,112],[24,112],[71.5,68]]);
    tri([P(s.x0,s.y0,H),P(s.x1,s.y0,H),P(m,s.y0,H+R)],[[24,112],[119,112],[71.5,68]]);
   }else{
    // Wide gables retain a native-sized attic window instead of stretching it.
    const z0=H+8/C,z1=z0+25/C;
    for(const [y,front] of [[s.y1,true],[s.y0,false]]){
     const ps=[P(s.x0,y,H),P(s.x1,y,H),P(m,y,H+R)];if(front)ps.reverse();tri(ps,ps.map(p=>[120+(p.x-m)*Math.min(1,238/(s.x1-s.x0)),876-(p.z-H)*C]));
     const shared=spans.some(other=>other!==s&&(front?other.y0===y:other.y1===y)&&other.x0<s.x1&&other.x1>s.x0);
     const yy=y+(front?.03:-.03),window=[P(m-12,yy,z0),P(m+12,yy,z0),P(m+12,yy,z1),P(m-12,yy,z1)];
     if(!shared)(front?reverseArt:art)(window,[60,63,24,25]);
     const beam=[P(s.x0,yy,H-4/C),P(s.x1,yy,H-4/C),P(s.x1,yy,H),P(s.x0,yy,H)];(front?reverseArt:art)(beam,[30,92,82,4]);
    }
   }
   solid([P(s.x0,s.y1,0),P(s.x1,s.y1,0),P(s.x1,s.y0,0),P(s.x0,s.y0,0)],35.5,190.5,'floor');
  }
  RoofMaterials.overhang(planes,ring,quad);
  // One shallow sealed ridge cap captures the reference's broad copper spine.
  // It intersects the shell instead of opening a seam along the apex.
  for(const s of spans){const m=(s.x0+s.x1)/2,w=Math.min(5,(s.x1-s.x0)*.08),z=H+R;
   const q=[P(m-w/2,s.y0-1.8,z-.9),P(m+w/2,s.y0-1.8,z-.9),P(m+w/2,s.y1+1.8,z-.9),P(m-w/2,s.y1+1.8,z-.9)],top=q.map(p=>({...p,z:z+1.2}));
   quad(top,top.map(p=>[224.5+(p.x-m+w/2)/w*4,200.5+Math.min(398,(p.y-s.y0+1.8)/2)]),'roof');solid(q.slice().reverse(),68.5,36.5,'roof');
   for(let i=0;i<4;i++){const j=(i+1)%4;solid([q[i],q[j],top[j],top[i]],i===1?75.5:i===3?68.5:71.5,i%2?36.5:65.5,'roof');}
  }
  const fronts=[];
  ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],len=Math.hypot(b.x-a.x,b.y-a.y),dx=(b.x-a.x)/len,dy=(b.y-a.y)/len,layout=sourceFacadeSlices(spec,len),at=(t,z,out=0)=>P(a.x+dx*t+dy*out,a.y+dy*t-dx*out,z);
   for(const [l,r,u,v] of layout.parts){const ps=[at(l,0),at(r,0),at(r,H),at(l,H)];quad(ps,!polygon&&a.y===b.y&&a.x>b.x?ps.map(p=>[24+p.x,205-p.z*C]):[[u,993],[v,993],[v,900],[u,900]]);}
   if(a.y===b.y&&a.x>b.x&&len>36)fronts.push({x:a.x-layout.center,y:a.y,len});
  });
  // Entry is a shallow solid porch, with a true roof and finished side walls.
  for(const f of fronts){const w=Math.min(38,f.len-8),x=f.x-w/2,y=f.y+9,z=35.5/C,er=21/C,backZ=(polygon?47:39)/C;
   reverseArt([P(x,y,0),P(x+w,y,0),P(x+w,y,z),P(x,y,z)],[52,158,39,31]);
   for(const [a,b] of [[P(x,f.y,0),P(x,y,0)],[P(x+w,y,0),P(x+w,f.y,0)]])reverseArt([a,b,{...b,z:b.y===f.y?backZ:z},{...a,z:a.y===f.y?backZ:z}],[30,158,12,31]);
   tri([P(x+w,y,z),P(x,y,z),P(f.x,y,z+er)],[[91,174],[52,174],[71.5,151]]);
   const ps1=[P(x,f.y,backZ),P(f.x,f.y,backZ+er),P(f.x,y,z+er),P(x,y,z)],ps2=[P(f.x,f.y,backZ+er),P(x+w,f.y,backZ),P(x+w,y,z),P(f.x,y,z+er)];for(const ps of [ps1,ps2]){if(!polygon)quad(ps,ps.map(p=>[24+p.x,153+p.y*.5-p.z*C]),'roof');else RoofMaterials.emit(ps,key,quad);}RoofMaterials.overhang([ps1,ps2],[{x,y:f.y},{x:x+w,y:f.y},{x:x+w,y},{x,y}],quad);solid([P(x,y,0),P(x+w,y,0),P(x+w,f.y,0),P(x,f.y,0)],35.5,190.5,'floor');
  }
  // The gray chimney is a closed masonry prism that penetrates the roof.
  const main=spans.reduce((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)>(a.x1-a.x0)*(a.y1-a.y0)?b:a),cx=main.x0+(polygon?Math.min(17,(main.x1-main.x0)*.18):6),cy=main.y0+(main.y1-main.y0)*.24,cw=polygon?12:11,cd=9,margin=polygon?1:2,top=polygon?H+R+10:(137+(cy-margin)*.5-17)/C;
  const box=(x,y,w,d,z0,z1,r)=>{const ps=[P(x,y,z0),P(x+w,y,z0),P(x+w,y+d,z0),P(x,y+d,z0)];for(let i=0;i<4;i++){const a=ps[i],b=ps[(i+1)%4];if(r[0]===30){const width=Math.hypot(b.x-a.x,b.y-a.y);quad([a,b,{...b,z:z1},{...a,z:z1}],[[160.5,400.5+(z1-z0)*C],[160.5+width,400.5+(z1-z0)*C],[160.5+width,400.5],[160.5,400.5]]);}else art([a,b,{...b,z:z1},{...a,z:z1}],r[0]===28?[29,24,12,3]:r);}if(r[0]===28){
    // The source cap has an open dark mouth. Four rim strips, inward walls
    // and a sealed floor supply its depth without opening the house shell.
    const outer=ps.map(p=>({...p,z:z1})),inner=[P(x+1.5,y+1.5,z1),P(x+w-1.5,y+1.5,z1),P(x+w-1.5,y+d-1.5,z1),P(x+1.5,y+d-1.5,z1)],bottom=inner.map(p=>({...p,z:z1-2}));
    for(let i=0;i<4;i++){const j=(i+1)%4;{const rim=[outer[i],outer[j],inner[j],inner[i]];quad(rim,rim.map(p=>[29+(p.x-x)*11/w,33.5+(p.y-y)*6/d]),'roof');}solid([inner[i],inner[j],bottom[j],bottom[i]],35.5,38.5,'wall');}
    solid(bottom,35.5,38.5,'roof');
   }
   // The shaft top is entirely covered by the cap and must not plug its well.
   solid(ps.slice().reverse());};
  box(cx,cy,cw,cd,H-5,top,[30,28,11,34]);box(cx-margin,cy-margin,cw+margin*2,cd+margin*2,top-3,top,[28,17,15,10]);
  // Source lean-to ends twelve pixels behind the main front at ground level.
  // Project its trapezoid directly instead of stretching a rectangular crop.
  if(!polygon){const x=95,y=20,w=24,d=60,h=27/C,high=44/C;
   const front=[P(x+w,y+d,0),P(x,y+d,0),P(x,y+d,high),P(x+w,y+d,h)];
   quad(front,front.map(p=>[p.x+24,137+p.y*.5-p.z*C+16]));
   for(let t=0;t<d;t+=20)art([P(x+w,y+t,0),P(x+w,y+t+20,0),P(x+w,y+t+20,h),P(x+w,y+t,h)],[120,151,17,26]);
   solid([P(x,y,0),P(x+w,y,0),P(x+w,y,h),P(x,y,high)]);
   solid([P(x,y+d,0),P(x,y,0),P(x,y,high),P(x,y+d,high)]);
   const rp=[P(x,y,high),P(x+w,y,h),P(x+w,y+d,h),P(x,y+d,high)];quad(rp,rp.map(p=>[24+p.x,153+p.y*.5-p.z*C]),'roof');RoofMaterials.overhang([rp],[{x,y},{x:x+w,y},{x:x+w,y:y+d},{x,y:y+d}],quad);
   solid([P(x,y+d,0),P(x+w,y+d,0),P(x+w,y,0),P(x,y,0)],35.5,190.5,'floor');
  }
  faces.footprintInfo={polygon:ring,area:Math.abs(area),roofPitch:R/47.5,mode:'original 4.png copper-roof home',physical:true,sections:spans.length};return faces;
 }
 root.SteamHome={spec,prepare,build};
})(typeof window==='undefined'?globalThis:window);
