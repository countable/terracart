/* Roof art is painted in surface space: courses have no baked perspective.
   Only palette colors come from the sprite; geometry supplies foreshortening. */
(function(root){
 const C=Math.cos(Math.PI/6),SIZE=240,X=256,Y=616;
 const beamStrips={com:[189,9,6,45],pp_cabin:[42,8,12,40],trader:[49,4,7,20],fdr:[120,15,88,7],pp_brick:[8,6,80,9],pp_plaster:[8,5,80,11]};
 const samples={ra:[8,400,16,16],com:[168,32,16,16],fdr:[128,25,16,16],market:[20,19,32,12],trader:[20,36,12,10],pp_brick:[8,16,16,24],pp_plaster:[8,16,32,24],pp_cabin:[12,40,16,16]};
 function prepare(ctx,image,spec,key){
  const [x,y,w,h]=samples[key],c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.drawImage(image,x,y,w,h,0,0,w,h);
  const data=g.getImageData(0,0,w,h).data,counts=new Map();for(let i=0;i<data.length;i+=4)if(data[i+3]>250){const rgb=[...data.slice(i,i+3)],id=rgb.join(',');counts.set(id,(counts.get(id)||0)+1);}
  const palette=[...counts].sort((a,b)=>b[1]-a[1]).map(([rgb])=>rgb.split(',').map(Number)),lum=a=>a[0]*.2126+a[1]*.7152+a[2]*.0722;
  const color=a=>'rgb('+a.join(',')+')',base=palette[0],ordered=palette.slice().sort((a,b)=>lum(a)-lum(b)),dark=ordered[0],light=ordered.at(-1),mid=palette[1]||base;
  const fill=(a,x,y,w,h)=>{ctx.fillStyle=color(a);ctx.fillRect(X+x,Y+y,w,h);};
  ctx.save();ctx.beginPath();ctx.rect(X,Y,256,256);ctx.clip();fill(base,0,0,256,256);
  const tile=(sx,sy,sw,sh,dw,dh)=>{ctx.imageSmoothingEnabled=false;for(let yy=0;yy<SIZE;yy+=dh)for(let xx=0;xx<SIZE;xx+=dw)ctx.drawImage(image,sx,sy,sw,sh,X+xx,Y+yy,dw,dh);};
  if(key==='ra'){
   // Golden thatch: broken short strokes follow the fall of the roof. There
   // is no diagonal stair-step shading baked into this surface-space atlas.
   for(let yy=0;yy<SIZE;yy+=12)for(let xx=0;xx<SIZE;xx+=12){const n=((xx/12)*17+(yy/12)*31)%7;fill(mid,xx+(n%3),yy+1,1,5+n%3);fill(mid,xx+5,yy+5,1,4);}
  }else if(key==='pp_cabin'){
   // The reference has three broad overlapping sheets, not narrow planks.
   for(let xx=0;xx<SIZE;xx+=32){fill(dark,xx,0,1,SIZE);fill(light,xx+1,0,2,SIZE);fill(base.map((n,i)=>Math.round(n*.88+dark[i]*.12)),xx+29,0,3,SIZE);}
  }else if(key==='trader'){
   // Red belongs to the timber edging. The roof itself is blue-gray slate.
   const slate=palette.filter(a=>a[2]>=a[0]&&a[1]>=a[0]).sort((a,b)=>lum(b)-lum(a));
   const blue=slate.find(a=>lum(a)>90&&a[2]>a[0]+15)||mid,shade=slate.find(a=>lum(a)>45&&lum(a)<lum(blue)-12)||dark;
   fill(blue,0,0,SIZE,SIZE);
   for(let xx=0;xx<SIZE;xx+=8){fill(shade,xx,0,3,SIZE);fill(dark,xx,0,1,SIZE);for(let yy=0;yy<SIZE;yy+=14)fill(shade,xx+3,yy+((xx/8)%2)*7,5,1);}
  }else if(key==='fdr'){
   // This sprite's broad slope is already rectangular: retain its real clay
   // tile marks, rectifying only the 30-degree surface foreshortening.
   tile(120,28,16,12,16,14);
  }else if(key==='market'){
   tile(20,19,32,12,32,14);
   // Keep the source's dark ridge courses at the ridge, not in every repeat.
   for(let x=0;x<SIZE;x+=32)ctx.drawImage(image,20,3,32,8,X+x,Y,32,9);
  }else if(key==='pp_brick'){
   tile(8,16,32,28,32,32);
  }else if(key==='pp_plaster'){
   tile(8,16,32,20,32,23);
  }else{
   // Blue slate has long, slim plates along the ridge direction. Sampled
   // colors preserve the art without carrying its oblique pixel staircases.
   for(let yy=0;yy<SIZE;yy+=6)for(let xx=-10;xx<SIZE;xx+=10){const x=xx+(Math.floor(yy/6)%2)*5;fill(base,x,yy,10,6);fill(palette[2]||mid,x+1,yy+1,8,4);fill(palette[3]||light,x+1,yy+1,8,1);fill(dark,x,yy,1,6);}
  }
  // Small palette swatches serve the real eave/ridge edges, never interior repeats.
  let edgeColor=dark,ridgeColor=mid;
  const sample=(x,y)=>{g.clearRect(0,0,w,h);g.drawImage(image,x,y,1,1,0,0,1,1);return [...g.getImageData(0,0,1,1).data].slice(0,3);};
  if(key==='ra')edgeColor=ridgeColor=sample(40,380);
  if(key==='pp_brick'||key==='pp_plaster'){edgeColor=sample(2,44);ridgeColor=sample(20,8);}
  if(key==='fdr')ridgeColor=sample(130,17);
  if(key==='com')ridgeColor=sample(192,10);
  if(key==='pp_cabin')ridgeColor=sample(48,28);
  if(key==='trader')edgeColor=ridgeColor=sample(38,49);
  fill(edgeColor,244,0,4,256);fill(ridgeColor,248,0,4,256);fill(light,252,0,4,256);if(key==='pp_cabin'){for(let y=0;y<256;y+=12){fill(dark,248,y,4,1);fill(light,248,y+1,4,1);}fill(dark,248,0,1,256);fill(dark,251,0,1,256);}ctx.restore();
  const strip=beamStrips[key];if(strip){const [sx,sy,sw,sh]=strip,cross=['fdr','pp_brick','pp_plaster'].includes(key);for(let y=0;y<600;y++)for(let x=0;x<(cross?sh:sw);x++){const u=cross?sx+y%sw:sx+x,v=cross?sy+x:sy+Math.floor(y/2)%sh;ctx.drawImage(image,u,v,1,1,480+x,16+y,1,1);}}
 }
 function emit(points,key,quad,sourceSpace=false,sourceUV=null,membrane=true){
  // Start both market slopes at their ridge; rotating indices preserves winding.
  const p=key==='market'&&Math.abs(points[0].z-points[1].z)<1e-5&&points[0].z<points[3].z?[points[2],points[3],points[0],points[1]]:points,physical=a=>sourceSpace?{x:a.x,y:a.y*2,z:a.z/C}:a;
  const distance=(a,b)=>{a=physical(a);b=physical(b);return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);};
  const L=distance(p[0],p[1]),D=distance(p[0],p[3]);if(L<1e-6||D<1e-6)return;
  const alongU=Math.abs(p[0].z-p[1].z)<1e-5;
  const point=(u,v)=>({x:p[0].x+(p[1].x-p[0].x)*u+(p[3].x-p[0].x)*v,y:p[0].y+(p[1].y-p[0].y)*u+(p[3].y-p[0].y)*v,z:p[0].z+(p[1].z-p[0].z)*u+(p[3].z-p[0].z)*v});
  const cuts=length=>{const trim=Math.min(1.4,length/5),r=[0,trim];for(let n=trim+SIZE;n<length-trim;n+=SIZE)r.push(n);r.push(length-trim,length);return [...new Set(r)];};
  const us=cuts(L),vs=cuts(D);
  if(membrane)for(let i=1;i<us.length;i++)for(let j=1;j<vs.length;j++){
   const u0=us[i-1],u1=us[i],v0=vs[j-1],v1=vs[j],edge=i===1||i===us.length-1||j===1||j===vs.length-1;
   const ps=[point(u0/L,v0/D),point(u1/L,v0/D),point(u1/L,v1/D),point(u0/L,v1/D)];
   let uv;if(edge){const slopeEdge=alongU?(j===1||j===vs.length-1):(i===1||i===us.length-1);const ridge=slopeEdge&&(alongU?(j===1?p[0].z>p[3].z:p[3].z>p[0].z):(i===1?p[0].z>p[1].z:p[1].z>p[0].z));if(key==='pp_cabin'&&!ridge)uv=ps.map(()=>[X+253.5,Y+.5]);
    else{
     // Outer strips continue the nearest roof texels. A dark swatch here
     // creates a second inset outline where the textured overhang begins.
     const sample=(value,length,trim,mid)=>{const n=Math.max(0,Math.min(length-2*trim,value-trim)),tile=Math.floor(Math.max(0,Math.min(length-2*trim,mid-trim))/SIZE)*SIZE;return Math.max(.5,Math.min(SIZE-.5,n-tile));};
     uv=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>{const a=sample(u,L,us[1],(u0+u1)/2),b=sample(v,D,vs[1],(v0+v1)/2);return alongU?[X+a,Y+b]:[X+b,Y+a];});
    }}
   else{const coords=[[0,0],[u1-u0,0],[u1-u0,v1-v0],[0,v1-v0]];uv=coords.map(([u,v])=>alongU?[X+u,Y+v]:[X+v,Y+u]);}
   if(sourceUV){
    // Retain authored pixels on native roof membranes; the source camera's
    // affine projection remains valid across each existing subdivision.
    const tex=p===points?sourceUV:[sourceUV[2],sourceUV[3],sourceUV[0],sourceUV[1]];
    uv=[[u0/L,v0/D],[u1/L,v0/D],[u1/L,v1/D],[u0/L,v1/D]].map(([u,v])=>[0,1].map(k=>tex[0][k]*(1-u)*(1-v)+tex[1][k]*u*(1-v)+tex[2][k]*u*v+tex[3][k]*(1-u)*v));
   }
   quad(ps,uv,'roof');
  }
  // A single closed shallow beam replaces prominent painted timber. Keep
  // the roof membrane underneath; the box must never make a hole in it.
  const box=(a,b,width,height,conform=false)=>{
   a=physical(a);b=physical(b);const len=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/len*width/2,ny=(b.x-a.x)/len*width/2;
   const q=[{x:a.x+nx,y:a.y+ny,z:a.z-.3},{x:a.x-nx,y:a.y-ny,z:a.z-.3},{x:b.x-nx,y:b.y-ny,z:b.z-.3},{x:b.x+nx,y:b.y+ny,z:b.z-.3} ];if(conform){const u=physical(p[0]),v=physical(p[3]),dx=v.x-u.x,dy=v.y-u.y,scale=(v.z-u.z)/(dx*dx+dy*dy);for(const pt of q)pt.z+=(dx*(pt.x-a.x)+dy*(pt.y-a.y))*scale;}const top=q.map(p=>({...p,z:p.z+height}));if(!conform){const e=physical(p[0]),r=physical(p[1]),slope=Math.abs(r.z-e.z)/Math.hypot(r.x-e.x,r.y-e.y);for(const pt of q)pt.z-=slope*width/2;}
   const restore=p=>sourceSpace?{x:p.x,y:p.y/2,z:p.z*C}:p;
   // Raised native cross-beams retain the source-camera texels at their
   // actual projected positions, rather than shifting a repeated strip upward.
   const sourceBeamUV=ps=>{
    if(sourceSpace&&points.sourceOrigin&&['com','pp_cabin'].includes(key)){
     // Ridge texels come from their actual source-camera position: no
     // guessed strip origin, repeat phase, or length rescaling.
     const [ox,oy]=points.sourceOrigin;return ps.map(q=>{const p=restore(q);return [ox+p.x,oy+p.y-p.z];});
    }
    if(!sourceSpace||!sourceUV||!['fdr','pp_brick','pp_plaster'].includes(key))return null;
    const a=p[0],b=p[1],d=p[3],ux=b.x-a.x,uy=(b.y-b.z)-(a.y-a.z),vx=d.x-a.x,vy=(d.y-d.z)-(a.y-a.z),det=ux*vy-uy*vx;
    if(Math.abs(det)<1e-8)return null;
    const t=p===points?sourceUV:[sourceUV[2],sourceUV[3],sourceUV[0],sourceUV[1]];
    return ps.map(q=>{const q0=restore(q),dx=q0.x-a.x,dy=(q0.y-q0.z)-(a.y-a.z),u=(dx*vy-dy*vx)/det,v=(ux*dy-uy*dx)/det;return [0,1].map(k=>t[0][k]+u*(t[1][k]-t[0][k])+v*(t[3][k]-t[0][k]));});
   };
   const face=(ps,bright)=>quad(ps.map(restore),ps.map(()=>[X+(bright?249.5:245.5),Y+.5]),'roof');
   const strip=beamStrips[key],cross=['fdr','pp_brick','pp_plaster'].includes(key),sw=strip?(cross?strip[3]:strip[2]):0,v1=16+Math.min(599.5,len);
   if(sourceBeamUV(top))quad(top.map(restore),sourceBeamUV(top),'roof');else if(strip){const u0=cross?480+sw:480,u1=cross?480:480+sw;quad(top.map(restore),[[u0,16.5],[u1,16.5],[u1,v1],[u0,v1]],'roof');}else face(top,true);
   face([...q].reverse(),false);
   for(let i=0;i<4;i++){const j=(i+1)%4,ps=[q[i],q[j],top[j],top[i]];if(sourceBeamUV(ps))quad(ps.map(restore),sourceBeamUV(ps),'roof');else if(strip){const u=480+(i===1?sw-1:0)+.5;quad(ps.map(restore),[[u,16.5],[u,v1],[u,v1],[u,16.5]],'roof');}else face(ps,i%2===0);}

  };
  if(['fdr','pp_brick','pp_plaster'].includes(key)&&alongU){
   const nativePP=sourceSpace&&['pp_brick','pp_plaster'].includes(key),first=key==='pp_brick'?1:0,t=key==='fdr'?18.5/48:nativePP?(10.5-first)/(48-first):8.5/48,fromRidge=p[0].z>p[3].z?t:1-t;
   box(point(0,fromRidge),point(1,fromRidge),key==='fdr'?6:nativePP?(key==='pp_brick'?9:11):5,.8,true);
  }
  // Emit the ridge only on the rising half: the opposite roof plane shares
  // it. At 12 triangles this gives the reference's timber a real silhouette.
  if(['ra','com','trader','pp_cabin'].includes(key)&&!alongU&&p[1].z>p[0].z){box(p[1],p[2],key==='pp_cabin'?12:key==='com'?6:7,.8);}
 }
 // The original shell stays at the wall line. Only boundary strips project
 // outward, with a shallow fascia and underside closing every exposed edge.
 function overhang(planes,outline,quad,sourceSpace=false,minimalEdge=false,endExtension=0){
  const physical=p=>({x:p.x,y:p.y*(sourceSpace?2:1),z:(p.z||0)/(sourceSpace?C:1)}),restore=p=>({x:p.x,y:p.y/(sourceSpace?2:1),z:p.z*(sourceSpace?C:1)});
  const ring=outline.map(physical),surfaces=planes.map(ps=>ps.map(physical)),EPS=1e-5,amount=minimalEdge?(planes[0]?.edgeLip??.5):2,thickness=minimalEdge?.35:.65;
  const area=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p.x*q.y-q.x*p.y},0),sign=area>0?1:-1;
  const normals=ring.map((p,i)=>{const q=ring[(i+1)%ring.length],length=Math.hypot(q.x-p.x,q.y-p.y);return {x:sign*(q.y-p.y)/length,y:-sign*(q.x-p.x)/length};});
  const outer=ring.map((p,i)=>{const a=normals[(i+ring.length-1)%ring.length],b=normals[i],den=1+a.x*b.x+a.y*b.y;return {x:p.x+(endExtension||amount)*(a.x+b.x)/den,y:p.y+amount*(a.y+b.y)/den};});
  const models=surfaces.map((ps,index)=>{const a=ps[0],b=ps[1],d=ps[3],ux=b.x-a.x,uy=b.y-a.y,vx=d.x-a.x,vy=d.y-a.y,det=ux*vy-uy*vx;return {ps,sourceUV:planes[index].sourceUV,z:(x,y)=>a.z+((x-a.x)*vy-(y-a.y)*vx)/det*(b.z-a.z)+(ux*(y-a.y)-uy*(x-a.x))/det*(d.z-a.z),contains:(x,y)=>{const u=((x-a.x)*vy-(y-a.y)*vx)/det,v=(ux*(y-a.y)-uy*(x-a.x))/det;return u>=-EPS&&u<=1+EPS&&v>=-EPS&&v<=1+EPS;}};});
  // Carry the adjacent roof's surface pattern onto the lip and fascia.
  // Clamp across the edge, while retaining the native texel spacing along it.
  const roofUV=(p,model)=>{const a=model.ps[0],b=model.ps[1],d=model.ps[3],u={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},v={x:d.x-a.x,y:d.y-a.y,z:d.z-a.z},L=Math.hypot(u.x,u.y,u.z),D=Math.hypot(v.x,v.y,v.z),z=model.z(p.x,p.y),project=e=>((p.x-a.x)*e.x+(p.y-a.y)*e.y+(z-a.z)*e.z);
   const x=Math.max(0,Math.min(L-2.8,project(u)/L-1.4)),y=Math.max(0,Math.min(D-2.8,project(v)/D-1.4));return Math.abs(u.z)<EPS?[x,y]:[y,x];};
  const draw=(ps,model,shadow=false)=>{
   if(minimalEdge&&shadow){quad(ps.map(restore),ps.map(()=>[X+245.5,Y+.5]),'roof');return;}
   if(minimalEdge&&model.sourceUV){
    // Continue the authored edge texel across a subpixel closed lip. Never
    // introduce a second procedural tile pattern beside a source roof.
    const a=model.ps[0],b=model.ps[1],d=model.ps[3],ux=b.x-a.x,uy=b.y-a.y,vx=d.x-a.x,vy=d.y-a.y,det=ux*vy-uy*vx,t=model.sourceUV;
    const uv=ps.map(p=>{const u=Math.max(-endExtension/Math.hypot(ux,uy)+.0001,Math.min(1+endExtension/Math.hypot(ux,uy)-.0001,((p.x-a.x)*vy-(p.y-a.y)*vx)/det)),v=Math.max(.0001,Math.min(.9999,(ux*(p.y-a.y)-uy*(p.x-a.x))/det));return [0,1].map(k=>t[0][k]*(1-u)*(1-v)+t[1][k]*u*(1-v)+t[2][k]*u*v+t[3][k]*(1-u)*v);});quad(ps.map(restore),uv,'roof');return;
   }
   const uv=ps.map(p=>roofUV(p,model)),mid=uv.reduce((a,p)=>[a[0]+p[0]/uv.length,a[1]+p[1]/uv.length],[0,0]),tile=mid.map(n=>Math.floor(n/SIZE)*SIZE);quad(ps.map(restore),uv.map(p=>[X+Math.max(.5,Math.min(SIZE-.5,p[0]-tile[0])),Y+Math.max(.5,Math.min(SIZE-.5,p[1]-tile[1]))]),'roof');},caps=new Map();
  const close=(ps,model)=>{const id=ps.map(p=>[p.x,p.y,p.z].map(n=>n.toFixed(5)).join(',')).sort().join(';');if(caps.has(id))caps.delete(id);else caps.set(id,{ps,model});};
  for(let i=0;i<ring.length;i++){
   const a=ring[i],b=ring[(i+1)%ring.length],oa=outer[i],ob=outer[(i+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy,n=normals[i],cuts=[0,1];
   for(const ps of surfaces)for(const p of ps){const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/length2;if(t>EPS&&t<1-EPS&&Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)<EPS)cuts.push(t);}
   // Split only at texture wrap boundaries to keep large custom roofs at
   // native density without adding unnecessary per-pixel geometry.
   const initial=cuts.slice().sort((a,b)=>a-b);
   for(let j=1;j<initial.length;j++){const lo=initial[j-1],hi=initial[j],t=(lo+hi)/2,x=a.x+dx*t-n.x*.001,y=a.y+dy*t-n.y*.001,m=models.filter(m=>m.contains(x,y)).sort((m,k)=>k.z(x,y)-m.z(x,y))[0];if(!m)continue;
    const u=roofUV({x:a.x+dx*lo,y:a.y+dy*lo},m),v=roofUV({x:a.x+dx*hi,y:a.y+dy*hi},m);for(let k=0;k<2;k++){const low=Math.min(u[k],v[k]),high=Math.max(u[k],v[k]);for(let at=(Math.floor(low/SIZE)+1)*SIZE;at<high-EPS;at+=SIZE)cuts.push(lo+(hi-lo)*(at-u[k])/(v[k]-u[k]));}}
   cuts.sort((a,b)=>a-b);
   for(let j=1;j<cuts.length;j++){
    const lo=cuts[j-1],hi=cuts[j];if(hi-lo<EPS)continue;
    const t=(lo+hi)/2,x=a.x+dx*t-n.x*.001,y=a.y+dy*t-n.y*.001,model=models.filter(m=>m.contains(x,y)).sort((m,k)=>k.z(x,y)-m.z(x,y))[0];if(!model)continue;
    const point=(t,out)=>{let x=a.x+dx*t,y=a.y+dy*t;if(out){if(t<EPS){x=oa.x;y=oa.y;}else if(t>1-EPS){x=ob.x;y=ob.y;}else{x+=n.x*(endExtension||amount);y+=n.y*amount;}}return {x,y,z:model.z(x,y)};};
    let top=[point(lo,false),point(lo,true),point(hi,true),point(hi,false)];if(sign<0)top.reverse();
    const bottom=top.map(p=>({...p,z:p.z-thickness}));draw(top,model);draw([...bottom].reverse(),model,true);
    // Inner closure lies inside the wall/roof envelope; end caps also close
    // unequal roof tiers without a floating black opening at their junction.
    for(let k=0;k<4;k++){const l=(k+1)%4;close([top[k],bottom[k],bottom[l],top[l]],model);}
   }
  }
  for(const {ps,model} of caps.values())draw(ps,model,true);
 }
 // Closed timber tie beneath the FDR gable supports. Embed the back half
 // in the intact wall so the beam cannot expose a seam on rotation.
 function gableTie(a,b,quad,sourceSpace=false){
  const physical=p=>({x:p.x,y:p.y*(sourceSpace?2:1),z:p.z/(sourceSpace?C:1)}),restore=p=>sourceSpace?{x:p.x,y:p.y/2,z:p.z*C}:p;
  a=physical(a);b=physical(b);const length=Math.hypot(b.x-a.x,b.y-a.y);if(length<1e-5)return;
  const nx=-(b.y-a.y)/length*1.1,ny=(b.x-a.x)/length*1.1;
  const bottom=[{x:a.x+nx,y:a.y+ny,z:a.z-3.6},{x:a.x-nx,y:a.y-ny,z:a.z-3.6},{x:b.x-nx,y:b.y-ny,z:b.z-3.6},{x:b.x+nx,y:b.y+ny,z:b.z-3.6}],top=bottom.map(p=>({...p,z:p.z+4}));
  const face=(ps,light)=>quad(ps.map(restore),ps.map(()=>[light?115.5:114.5,76.5]),'wall');
  face(top,true);face([...bottom].reverse(),false);for(let i=0;i<4;i++){const j=(i+1)%4;face([bottom[i],bottom[j],top[j],top[i]],true);}
 }
 root.RoofMaterials={prepare,emit,overhang,gableTie};
})(typeof window==='undefined'?globalThis:window);
