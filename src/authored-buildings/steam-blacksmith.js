/* Original steampunk sheet 4: a copper workshop with a blue barrel roof. */
(function(root){
 const C=Math.cos(Math.PI/6),spec={label:'Original 4.png · blacksmith',image:'steam-blacksmith.png',crop:[0,0,192,192],left:46,right:148,base:188,eave:112,peak:78,back:58,backPeak:24,center:97,depth:54,wall:[55,145,14,38],posts:[46,52,141,148],bands:[112,140,188],door:[76,151,38,37],steamBlacksmith:true};
 const cylinderRects=[[20,48,27,123],[30,26,10,30],[30,26,10,9],[154,16,21,86],[153,66,23,7],[153,16,23,9]];
 function prepare(ctx,image){
  ctx.drawImage(image,0,16);ctx.drawImage(image,46,112,102,76,0,400,102,76);
  // The gears are unique to the source entry; inferred walls carry timber.
  for(let x=0;x<102;x+=14)ctx.drawImage(image,55,145,14,28,x,400,Math.min(14,102-x),28);
  // Remove the complete doorway arch/frame from inferred faces while retaining
  // the original masonry courses and the continuous lintel above it.
  for(let x=28;x<74;x+=12)ctx.drawImage(image,57,145,12,43,x,433,Math.min(12,74-x),43);
  for(let y=500;y<756;y+=38)for(let x=0;x<256;x+=14)ctx.drawImage(image,55,145,14,38,x,y,14,38);
  // Unroll the painted barrel into native-width strips. Broad custom spans
  // repeat these strips instead of enlarging the three skylights.
  for(let x=0;x<102;x++){const t=(x+.5)/102,top=58-34*Math.sin(Math.PI*t);ctx.drawImage(image,46+x,top,1,54,x,800,1,54);}
  // One continuous strip per copper cylinder. Fittings occur once on the
  // source-facing sector; the other sectors use quiet shaft material.
  cylinderRects.forEach(([sx,sy,sw,sh],i)=>{const ax=256+(i%2)*128,ay=16+Math.floor(i/2)*150;
   // Collar walls use the fascia below the mouth; the lip is mapped separately.
   const [px,py,pw,ph]=i===2?[31,32,12,4]:i===5?[155,27,18,8]:[sx,sy,sw,sh];
   for(let x=0;x<128;x++)ctx.drawImage(image,px+Math.floor(pw*.48),py,2,ph,ax+x,ay,1,sh);
   ctx.drawImage(image,i===1?33:px+1,py,i===1?5:pw-2,ph,ax+16,ay,32,sh);
  });
  // Retain the original boiler face. Its outer three pixels contain the
  // separate service pipe and sprite gap; extend adjacent copper only there.
  ctx.drawImage(image,19,48,29,132,256,800,29,132);
  ctx.drawImage(image,23,48,1,124,256,800,4,124);
  ctx.drawImage(image,42,48,1,124,281,800,4,124);
  // Extend the restored gray foot only through valid gray source support.
  // The original export has stray white/transparent fringe below its rim.
  for(let sy=171;sy<180;sy++){const row=Math.min(sy,176),left=Math.min(34,24+(row-171)*2);ctx.drawImage(image,left,row,1,1,256,800+sy-48,left-19,1);if(sy>176)ctx.drawImage(image,left,row,47-left,1,256+left-19,800+sy-48,47-left,1);}
  ctx.drawImage(image,35,171,6,6,256,940,128,6);
  // Rear barrel-end is copper paneling; the source gear assembly belongs
  // only to the entrance elevation, not to the opposite workshop wall.
  for(let y=0;y<34;y+=16)for(let x=0;x<102;x+=12)ctx.drawImage(image,24,133,12,16,128+x,800+y,Math.min(12,102-x),Math.min(16,34-y));
  // Copper texels and tile texels remain source samples, never fallback colors.
  for(let y=500;y<756;y+=16)for(let x=256;x<512;x+=12)ctx.drawImage(image,24,133,12,16,x,y,12,16);
 }
 function build(template,a,key,polygon){
  const faces=[],W=102,D=108,H=76/C,R=34/C;
  const ring=(polygon||[[0,0],[W,0],[W,D],[0,D]]).map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:{...p});
  if(ring.length>1&&ring[0].x===ring.at(-1).x&&ring[0].y===ring.at(-1).y)ring.pop();
  if(ring.reduce((s,p,i)=>s+p.x*ring[(i+1)%ring.length].y-ring[(i+1)%ring.length].x*p.y,0)<0)ring.reverse();
  const poly=(ps,uv,kind='wall')=>{for(let i=1;i<ps.length-1;i++){const ids=[0,i,i+1],points=ids.map(j=>({...ps[j],tu:uv[j][0]/512,tv:uv[j][1]/1024}));faces.push({...template,points,projected:points.map(()=>({})),kind,feature:'body',sourceArt:true,layer:0,fallbackUV:[60.5/512,165.5/1024],wallDirection:kind==='wall'?{x:points[1].x-points[0].x,y:points[1].y-points[0].y}:undefined});}};
  const P=(x,y,z)=>({x,y,z}),uv=(x,v)=>[x,v+16],constant=(ps,u=30.5,v=145.5,kind='wall')=>poly(ps,ps.map(()=>uv(u,v)),kind);
  const inside=(x,y)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const p=ring[i],q=ring[j];if((p.y>y)!==(q.y>y)&&x<(q.x-p.x)*(y-p.y)/(q.y-p.y)+p.x)yes=!yes;}return yes;};
  const xs=[...new Set(ring.map(p=>p.x))].sort((a,b)=>a-b),ys=[...new Set(ring.map(p=>p.y))].sort((a,b)=>a-b),cells=[];
  for(let j=1;j<ys.length;j++){let start=null;for(let i=1;i<=xs.length;i++){const occupied=i<xs.length&&inside((xs[i-1]+xs[i])/2,(ys[j-1]+ys[j])/2);if(occupied&&start===null)start=xs[i-1];if(!occupied&&start!==null){const end=xs[i-1],prev=cells.find(c=>c.x0===start&&c.x1===end&&c.y1===ys[j-1]);if(prev)prev.y1=ys[j];else cells.push({x0:start,x1:end,y0:ys[j-1],y1:ys[j]});start=null;}}}
  ring.forEach((p,i)=>{const q=ring[(i+1)%ring.length],L=Math.hypot(q.x-p.x,q.y-p.y),front=q.x<p.x&&q.y===p.y,at=(t,z)=>P(p.x+(q.x-p.x)*t/L,p.y+(q.y-p.y)*t/L,z);
   for(let t=0;t<L;t+=W){const end=Math.min(L,t+W),w=end-t;poly([at(t,0),at(end,0),at(end,H),at(t,H)],front&&Math.abs(L-W)<.01?[uv(148,188),uv(148-w,188),uv(148-w,112),uv(148,112)]:[[W,476],[W-w,476],[W-w,400],[W,400]]);}
   if(front&&L>=50){const t=L/2-19,out=.025,dx=(q.y-p.y)/L,dy=-(q.x-p.x)/L,ps=[at(t,0),at(t+38,0),at(t+38,37/C),at(t,37/C)].map(p=>({...p,x:p.x+dx*out,y:p.y+dy*out}));poly(ps,[uv(114,188),uv(76,188),uv(76,151),uv(114,151)]);}
  });
  const roofZ=t=>H+R*Math.sin(Math.PI*t);
  for(const s of cells){const {x0,x1,y0,y1}=s,N=10,roofAt=(t,y,extra=0)=>P(x0+(x1-x0)*t,y,roofZ(t)+extra);
   constant([P(x0,y0,0),P(x0,y1,0),P(x1,y1,0),P(x1,y0,0)],60.5,180.5,'floor');
   // Ten strips approximate the source barrel. Each strip follows the painted
   // curvature; its longitudinal UV direction is the true roof depth.
   for(let i=0;i<N;i++){const t=i/N,u=(i+1)/N,v0=112-34*Math.sin(Math.PI*t),v1=112-34*Math.sin(Math.PI*u),a=46+102*t,b=46+102*u;
    for(let y=y0;y<y1;y+=108){const end=Math.min(y1,y+108),f=(end-y)/108;
     if(!polygon||Math.abs(x1-x0-W)<1)poly([roofAt(t,y),roofAt(u,y),roofAt(u,end),roofAt(t,end)],[uv(a,v0-54),uv(b,v1-54),uv(b,v1-54+54*f),uv(a,v0-54+54*f)],'roof');
     else{const width=x1-x0,start=t*width,finish=u*width;let x=start;while(x<finish-1e-6){const base=Math.floor((x+1e-6)/W)*W,next=Math.min(finish,base+W),a=x/width,b=next/width;poly([roofAt(a,y),roofAt(b,y),roofAt(b,end),roofAt(a,end)],[[x-base,800],[next-base,800],[next-base,800+54*f],[x-base,800+54*f]],'roof');x=next;}}
    }
    for(const [y,sign] of [[y0,-1],[y1,1]]){const a0=roofAt(t,y),b0=roofAt(u,y),a1=roofAt(t,y+sign*1.8,-.65),b1=roofAt(u,y+sign*1.8,-.65);poly(sign>0?[a0,b0,b1,a1]:[b0,a0,a1,b1],sign>0?[uv(a,v0-2),uv(b,v1-2),uv(b,v1),uv(a,v0)]:[uv(b,v1),uv(a,v0),uv(a,v0-2),uv(b,v1-2)],'roof');{const underside=[{...a0,z:a0.z-.65},{...b0,z:b0.z-.65},b1,a1];constant(sign>0?underside.reverse():underside,82.5,85.5,'roof');}}
   }
   // The convex arch end is one affine-textured polygon. Its fan closes
   // the same shell without redundant vertical strips at the curve endpoints.
   for(const [y,front] of [[y0,false],[y1,true]]){const ps=Array.from({length:N+1},(_,i)=>roofAt(i/N,y)),tex=ps.map((p,i)=>front?uv(46+102*i/N,112-(p.z-H)*C):[128+102*i/N,834-(p.z-H)*C]);poly(front?ps:ps.slice().reverse(),front?tex:tex.slice().reverse());}
   for(const [x,sign] of [[x0,-1],[x1,1]]){const ps=[P(x,y0-1.8,H),P(x,y1+1.8,H),P(x+sign*1.8,y1+1.8,H),P(x+sign*1.8,y0-1.8,H)];const top=sign>0?ps.slice().reverse():ps,bottom=top.map(p=>({...p,z:H-.7}));constant(top,49.5,108.5,'roof');constant(bottom.slice().reverse(),47.5,111.5,'roof');
    // A closed eave prism: both end caps and the wall-side face are needed
    // beyond the barrel ends, even though most of the inner face is embedded.
    for(let i=0;i<4;i++){const j=(i+1)%4;constant([top[i],bottom[i],bottom[j],top[j]],48.5,110.5,'roof');}}
  }
  const primary=cells.reduce((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)>(a.x1-a.x0)*(a.y1-a.y0)?b:a);
  // Closed copper cylinders have actual thickness and texture around their full
  // circumference. Only their source-facing half uses the original silhouette.
  function cylinder(cx,cy,rx,ry,z0,z1,sourceRect,n=12){const [sx,sy,sw,sh]=sourceRect,point=(i,z)=>P(cx+Math.cos(i*Math.PI*2/n)*rx,cy+Math.sin(i*Math.PI*2/n)*ry,z),index=cylinderRects.findIndex(r=>r.every((v,j)=>v===sourceRect[j])),ax=256+(index%2)*128,ay=16+Math.floor(index/2)*150;for(let i=0;i<n;i++){const ps=[point(i,z0),point(i+1,z0),point(i+1,z1),point(i,z1)],u0=ax+127*i/n+.5,u1=ax+127*(i+1)/n+.5;if(index===0&&i<n/2)poly(ps,ps.map(p=>[256+46+p.x-19,800+134+p.y*.5-p.z*C-48]));else poly(ps,[[u0,ay+sh-.5],[u1,ay+sh-.5],[u1,ay+.5],[u0,ay+.5]]);}const flue=index===2||index===5,coveredShaft=index===1||index===3;
   if(flue){const inset=.64,depth=Math.min(4/C,(z1-z0)*.72),inner=(i,z)=>P(cx+Math.cos(i*Math.PI*2/n)*rx*inset,cy+Math.sin(i*Math.PI*2/n)*ry*inset,z);
    // Sample the actual gold ellipse, not the dark mouth inside it. The
    // narrow source lip carries its angular highlights across the physical rim.
    const rimUV=index===2?[[41.5,27.5],[41.5,29.5],[38.5,31.5],[36.5,31.5],[33.5,30.5],[32.5,29.5],[31.5,27.5],[32.5,26.5],[34.5,25.5],[36.5,25.5],[38.5,25.5],[40.5,26.5]]:[[171.5,21.5],[171.5,23.5],[167.5,26.5],[163.5,26.5],[158.5,25.5],[156.5,23.5],[155.5,21.5],[156.5,20.5],[159.5,17.5],[163.5,17.5],[167.5,17.5],[170.5,19.5]];
    for(let i=0;i<n;i++){const a=uv(...rimUV[i]),b=uv(...rimUV[(i+1)%n]);poly([point(i,z1),point(i+1,z1),inner(i+1,z1),inner(i,z1)],[a,b,b,a],'roof');constant([inner(i,z1),inner(i+1,z1),inner(i+1,z1-depth),inner(i,z1-depth)],35.5,27.5,'wall');}
    constant(Array.from({length:n},(_,i)=>inner(i,z1-depth)),35.5,27.5,'roof');
   }else if(!coveredShaft)constant(Array.from({length:n},(_,i)=>point(i,z1)),sx+sw/2,sy+2,'roof');
   // The source's gray foot extends below the brown body. Reuse its bottom
   // fan at the new lower ring, so the added band stays closed without an
   // unnecessary internal cap or changes to the established boiler body.
   const footZ=index===0?z0-6/C:z0;
   if(index===0)for(let i=0;i<n;i++){const ps=[point(i,footZ),point(i+1,footZ),point(i+1,z0),point(i,z0)];if(i<n/2)poly(ps,ps.map(p=>[256+46+p.x-19,800+134+p.y*.5-p.z*C-48]));else{const u0=256+127*i/n+.5,u1=256+127*(i+1)/n+.5;poly(ps,[[u0,945.5],[u1,945.5],[u1,940.5],[u0,940.5]]);}}
   constant(Array.from({length:n},(_,i)=>point(n-i,footZ)),index===0?35.5:sx+sw/2,index===0?174.5:sy+sh-2,'floor');}
  const x0=primary.x0,y0=primary.y0,y1=primary.y1,cx=(primary.x0+primary.x1)/2;
  if(!polygon){
   cylinder(-13,78,14,17,10.5/C,116/C,[20,48,27,123]);
   cylinder(-9.5,70,5,5,116/C,141.5/C,[30,26,10,30]);
   cylinder(-9.5,70,6.2,8,137.5/C,141.5/C,[30,26,10,9]);
   // Source left-hand service piping: closed copper elbows and a gray
   // coupling. Native-only additions restore its missing outer silhouette.
   function pipeBox(sx,sy,sw,sh,depth){const front=90,back=front-depth,x=sx-46,z0=(134+front*.5-sy-sh)/C,z1=(134+front*.5-sy)/C,q=[P(x,back,z0),P(x+sw,back,z0),P(x+sw,front,z0),P(x,front,z0)],top=q.map(p=>({...p,z:z1}));
    for(let i=0;i<4;i++){const j=(i+1)%4,ps=[q[i],q[j],top[j],top[i]];if(i===2)poly(ps,ps.map(p=>uv(46+p.x,134+front*.5-p.z*C)));else poly(ps,[uv(sx+1,sy+sh-1),uv(sx+sw-1,sy+sh-1),uv(sx+sw-1,sy+1),uv(sx+1,sy+1)]);}
    constant(top,sx+sw/2,sy+1,'roof');constant(q.slice().reverse(),sx+sw/2,sy+sh-1,'floor');
   }
   pipeBox(9,90,8,36,5);pipeBox(12,86,17,6,5);pipeBox(6,123,18,22,8);pipeBox(6,145,5,21,5);pipeBox(9,143,15,5,5);
   // The source right flue has a separate bent service pipe. Three closed
   // copper segments restore its native silhouette without changing custom L/U
   // budgets. Coordinates on the visible face remain source-pixel aligned.
   function rightPipe(corners){const front=34,back=30,at=(p,y)=>P(p[0]-46,y,(134+front*.5-p[1])/C),a=corners.map(p=>at(p,front)),b=corners.map(p=>at(p,back));
    poly(a,corners.map(p=>uv(...p)));poly(b.slice().reverse(),corners.map(p=>uv(...p)).reverse());
    for(let i=0;i<4;i++){const j=(i+1)%4;constant([a[i],b[i],b[j],a[j]],182.5,76.5,'wall');}
   }
   rightPipe([[174,68],[184,68],[184,74],[174,74]]);
   rightPipe([[181,72],[186,72],[186,99],[181,99]]);
   rightPipe([[181,96],[187,98],[191,124],[186,124]]);
   // The attached right workshop has a real sloping roof and sealed front/back.
   const left=102,right=143,back=30,front=96,zl=63/C,zr=43/C;
   poly([P(left,front,zl),P(right,front,zr),P(right,front,0),P(left,front,0)],[uv(148,111),uv(189,131),uv(189,174),uv(148,174)]);
   poly([P(right,back,zr),P(left,back,zl),P(left,back,0),P(right,back,0)],[uv(189,131),uv(148,111),uv(148,174),uv(189,174)]);
   poly([P(right,front,zr),P(right,back,zr),P(right,back,0),P(right,front,0)],[[0,433],[66,433],[66,476],[0,476]]);
   poly([P(left,back,zl),P(right,back,zr),P(right,front,zr),P(left,front,zl)],[uv(148,78),uv(189,98),uv(189,131),uv(148,111)],'roof');
   constant([P(left,back,0),P(left,front,0),P(right,front,0),P(right,back,0)],168,170,'floor');
  }
  const chimneyX=polygon?primary.x1-10:118,chimneyY=polygon?y0+20:26;
  cylinder(chimneyX,chimneyY,10,10,40/C,(polygon?135:125.5)/C,[154,16,21,86]);
  cylinder(chimneyX,chimneyY,11,11,(polygon?95:76)/C,(polygon?100:81)/C,[153,66,23,7]);
  cylinder(chimneyX,chimneyY,11,11,(polygon?130:120.5)/C,(polygon?135:125.5)/C,[153,16,23,9]);
  faces.footprintInfo={polygon:ring,physical:true,sections:cells.length,mode:'Original copper workshop barrel roof'};return faces;
 }
 root.SteamBlacksmith={spec,prepare,build};
})(typeof window==='undefined'?globalThis:window);
