/* Original 4.png copper observatory. Closed octagonal collars and dome rings. */
(function(root){
 const C=Math.cos(Math.PI/6),spec={label:'Original 4.png · wizard tower',image:'steam-wizard.png',crop:[0,0,72,192],left:8,right:64,base:190,eave:65,peak:24,center:36,back:42,backPeak:1,depth:23,wall:[28,153,16,28],posts:[8,13,59,64],bands:[65,99,146,190],door:[30,169,12,20],steamWizard:true};
 function prepare(ctx,image){
  const c=document.createElement('canvas');c.width=72;c.height=192;const g=c.getContext('2d');g.drawImage(image,0,0);const d=g.getImageData(0,0,72,192),p=d.data,seen=new Uint8Array(72*192),q=[];
  for(let i=0;i<seen.length;i++)if(p[i*4+3]>127){seen[i]=1;q.push(i);}for(let n=0;n<q.length;n++){const i=q[n],x=i%72;for(const j of [x?i-1:-1,x<71?i+1:-1,i-72,i+72])if(j>=0&&j<seen.length&&!seen[j]){seen[j]=1;q.push(j);for(let k=0;k<4;k++)p[j*4+k]=p[i*4+k];}}
  g.putImageData(d,0,0);ctx.drawImage(c,0,16);
  // A dedicated full-height facade repeats the reference windows and masonry.
  for(let x=0;x<256;x+=24)ctx.drawImage(c,24,65,24,125,x,900,24,125);
  // Inferred roof planes use the current source palette, including restyles.
  // Keep compact staggered shingles instead of the former copper panel grid.
  const color=(x,y)=>{const i=(y*72+x)*4;return `rgb(${p[i]},${p[i+1]},${p[i+2]})`;};
  const tile=color(35,40),shade=color(36,46),edge=color(34,36),light=color(28,30);
  ctx.fillStyle=tile;ctx.fillRect(256,616,256,256);
  ctx.save();ctx.beginPath();ctx.rect(256,616,256,256);ctx.clip();
  for(let y=0;y<256;y+=7)for(let x=-8;x<256;x+=8){const xx=256+x+(y/7%2)*4;
   ctx.fillStyle=(x/8+y/7)%3?tile:shade;ctx.fillRect(xx,616+y,8,7);
   ctx.fillStyle=edge;ctx.fillRect(xx,622+y,8,1);ctx.fillRect(xx,616+y,1,7);
   ctx.fillStyle=light;ctx.fillRect(xx+1,616+y,6,1);
  }ctx.restore();
 }
 function build(template,a,key,ring=null){
  const faces=[];
  function poly(ps,uv,kind='wall') {for(let i=1;i<ps.length-1;i++){const p=[0,i,i+1].map(j=>({...ps[j],tu:uv[j][0]/512,tv:(uv[j][1]+16)/1024}));faces.push({...template,points:p,projected:p.map(()=>({})),kind,feature:'body',sourceArt:true,layer:0,fallbackUV:[36.5/512,139.5/1024],wallDirection:kind==='wall'?{x:p[1].x-p[0].x,y:p[1].y-p[0].y}:undefined});}}
  if(ring)return custom(ring);
  const cx=28,cy=23,N=8;
  const pt=(i,r,z)=>({x:cx+Math.cos(Math.PI/8+i*2*Math.PI/N)*r,y:cy+Math.sin(Math.PI/8+i*2*Math.PI/N)*r*23/28,z:z/C});
  // Reflect the back projection onto the front: the opposite elevation has the
  // same window bays, stone courses and brass trim, with no empty sprite pixels.
  const uv=p=>[36+p.x-cx,178+Math.abs(p.y-cy)*.5-p.z*C];
  const bands=[[26,0],[26,4],[27,4],[27,7],[26,7],[26,42],[28,42],[28,46],[27,49],[26,49],[26,85],[29,85],[29,89],[27,93],[25,93],[25,128],[29,128],[29,132],[29,134],[27,139],[21,146],[13,151],[6,154],[5,156]];
  for(let k=1;k<bands.length;k++)for(let i=0;i<N;i++){const [r0,z0]=bands[k-1],[r1,z1]=bands[k],ps=[pt(i,r0,z0),pt(i+1,r0,z0),pt(i+1,r1,z1),pt(i,r1,z1)];const theta=Math.PI/8+(i+.5)*2*Math.PI/N-Math.PI/2;
   const texture=ps.map(p=>{if(z1<=128&&i%2===0)return uv(p);const dx=p.x-cx,dy=(p.y-cy)*28/23;return uv({x:cx+dx*Math.cos(theta)+dy*Math.sin(theta),y:cy+(-dx*Math.sin(theta)+dy*Math.cos(theta))*23/28,z:p.z});});poly(ps,texture,z1>=128?'roof':'wall');}
  for(const [r,z,reverse] of [[26,0,true],[5,156,false]]){let ps=Array.from({length:N},(_,i)=>pt(i,r,z));if(reverse)ps.reverse();poly(ps,ps.map(uv),z?'roof':'floor');}
  // Brass finial has its own closed base, shaft, crossbar and crown.
  function box(x0,x1,y0,y1,z0,z1,u0,v0,u1,v1){const emit=(ps,uv,kind)=>{const a=ps[0],b=ps[1],c=ps[2],v={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},w={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z},n={x:v.y*w.z-v.z*w.y,y:v.z*w.x-v.x*w.z,z:v.x*w.y-v.y*w.x},m={x:cx+(x0+x1)/2,y:cy+(y0+y1)/2,z:(z0+z1)/2/C};if(n.x*(a.x-m.x)+n.y*(a.y-m.y)+n.z*(a.z-m.z)<0){ps.reverse();uv.reverse();}poly(ps,uv,kind);};const p=(x,y,z)=>({x:cx+x,y:cy+y,z:z/C});const front=[[u0,v1],[u1,v1],[u1,v0],[u0,v0]];emit([p(x0,y1,z0),p(x1,y1,z0),p(x1,y1,z1),p(x0,y1,z1)],front,'roof');emit([p(x1,y0,z0),p(x0,y0,z0),p(x0,y0,z1),p(x1,y0,z1)],front,'roof');for(const x of [x0,x1])emit([p(x,y0,z0),p(x,y1,z0),p(x,y1,z1),p(x,y0,z1)],front,'roof');for(const z of [z0,z1])emit([p(x0,y0,z),p(x1,y0,z),p(x1,y1,z),p(x0,y1,z)],[[u0,v0],[u1,v0],[u1,v1],[u0,v1]],'roof');}
  box(-4,4,-3,3,154,158,32,22,40,27);box(-1.5,1.5,-1.5,1.5,158,174,34,6,38,22);box(-8,8,-1,1,166,168,28,14,45,18);box(-2.5,2.5,-2.5,2.5,174,178,33,2,39,7);
  return faces;
  function custom(r){if(r.reduce((s,p,i)=>s+p.x*r[(i+1)%r.length].y-r[(i+1)%r.length].x*p.y,0)<0)r=r.slice().reverse();let largest=null;
   const xs=[...new Set(r.map(p=>p.x))].sort((a,b)=>a-b),ys=[...new Set(r.map(p=>p.y))].sort((a,b)=>a-b);const inside=(x,y)=>{let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){let a=r[i],b=r[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
   for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],L=Math.hypot(b.x-a.x,b.y-a.y);for(let s=0;s<L;s+=24){const e=Math.min(L,s+24),p=(t,z)=>({x:a.x+(b.x-a.x)*t/L,y:a.y+(b.y-a.y)*t/L,z:z/C});poly([p(s,0),p(e,0),p(e,125),p(s,125)],[[24,190],[24+e-s,190],[24+e-s,65],[24,65]]);}}
   for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){const x0=xs[i-1],x1=xs[i],y0=ys[j-1],y1=ys[j];if(!inside((x0+x1)/2,(y0+y1)/2))continue;const base=[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}],cx=(x0+x1)/2,cy=(y0+y1)/2,point=(i,s,z)=>({x:cx+(base[i].x-cx)*s,y:cy+(base[i].y-cy)*s,z:z/C});poly(base.slice().reverse().map(p=>({...p,z:0})),Array(4).fill([36.5,184.5]),'floor');if(!largest||(x1-x0)*(y1-y0)>largest.area)largest={cx,cy,area:(x1-x0)*(y1-y0)};const levels=[[1,125],[1.04,126],[.96,132],[.80,142],[.53,151],[.20,156]];for(let k=1;k<levels.length;k++)for(let n=0;n<4;n++){const [r0,z0]=levels[k-1],[r1,z1]=levels[k],ps=[point(n,r0,z0),point((n+1)%4,r0,z0),point((n+1)%4,r1,z1),point(n,r1,z1)];const length=Math.hypot(ps[1].x-ps[0].x,ps[1].y-ps[0].y),slope=Math.hypot(ps[3].x-ps[0].x,ps[3].y-ps[0].y,ps[3].z-ps[0].z);const baseLength=Math.hypot(base[(n+1)%4].x-base[n].x,base[(n+1)%4].y-base[n].y),step=128*length/baseLength;for(let t=0;t<length;t+=step){const t1=Math.min(length,t+step),mix=(a,b,f)=>({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f});poly([mix(ps[0],ps[1],t/length),mix(ps[0],ps[1],t1/length),mix(ps[3],ps[2],t1/length),mix(ps[3],ps[2],t/length)],[[256,600+(z0-125)/C],[256+(t1-t)*baseLength/length,600+(z0-125)/C],[256+(t1-t)*baseLength/length,600+(z1-125)/C],[256,600+(z1-125)/C]],'roof');}}const ps=base.map((p,n)=>point(n,.2,156));poly(ps,[[32,22],[40,22],[40,26],[32,26]],'roof');}
   if(largest){const {cx,cy}=largest,N=8,pt=(i,r,z)=>({x:cx+Math.cos(i*Math.PI/4)*r,y:cy+Math.sin(i*Math.PI/4)*r,z:z/C}),levels=[[4,156],[4,159],[1.5,159],[1.5,174],[3,174],[2,178]];for(let k=1;k<levels.length;k++)for(let n=0;n<N;n++){const [r0,z0]=levels[k-1],[r1,z1]=levels[k],ps=[pt(n,r0,z0),pt(n+1,r0,z0),pt(n+1,r1,z1),pt(n,r1,z1)];poly(ps,[[34,178-z0],[38,178-z0],[38,178-z1],[34,178-z1]],'roof');}const cap=Array.from({length:N},(_,i)=>pt(i,2,178));poly(cap,Array(N).fill([35.5,3.5]),'roof');}
   return faces;
  }
 }
 root.SteamWizard={spec,prepare,build};
})(typeof window==='undefined'?globalThis:window);
