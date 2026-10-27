/* Bounded, deterministic castle layout. No renderer or texture allocation. */
(function(global){
  const EPS=1e-6;
  const LIMITS={vertices:512,sections:128,pieces:512,merlons:4096,towers:12,cache:48};
  const cache=new Map();
  const {cross,polyArea:area,ensureCCW}=PolygonGeometry;
  const rect=(x,y,w,h)=>[{x:x-w/2,y:y-h/2},{x:x+w/2,y:y-h/2},{x:x+w/2,y:y+h/2},{x:x-w/2,y:y+h/2}];
  function clean(p){const q=p.filter((a,i)=>Math.hypot(a.x-p[(i+p.length-1)%p.length].x,a.y-p[(i+p.length-1)%p.length].y)>EPS);return q.length>=3&&Math.abs(area(q))>EPS?q:[];}
  // Epsilon may classify a point just outside as inside. Clamp intersections
  // to their source segment so those nearly parallel clips never extrapolate.
  function half(poly,a,b,positive=true){const out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dp=cross(a,b,p)*(positive?1:-1),dq=cross(a,b,q)*(positive?1:-1),ip=dp>=-EPS,iq=dq>=-EPS;if(ip)out.push(p);if(ip!==iq){const t=Math.max(0,Math.min(1,dp/(dp-dq)));out.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}}return clean(out);}
  function intersect(a,b){let p=a;for(let i=0;p.length&&i<b.length;i++)p=half(p,b[i],b[(i+1)%b.length]);return p;}
  function subtract(a,b){let inside=a;const outside=[];for(let i=0;inside.length&&i<b.length;i++){const p=b[i],q=b[(i+1)%b.length],part=half(inside,p,q,false);if(part.length)outside.push(part);inside=half(inside,p,q,true);}return outside;}
  const pointIn=(p,ring)=>PolygonGeometry.pointInPolygon(ring,p,EPS);
  function contains(poly,ring){if(!poly.every(p=>pointIn(p,ring)))return false;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if(!pointIn({x:(a.x+b.x)/2,y:(a.y+b.y)/2},ring))return false;for(let j=0;j<ring.length;j++){const c=ring[j],d=ring[(j+1)%ring.length];if(cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS)return false;}}return true;}
  const overlap=(a,b)=>Math.abs(area(intersect(a,b)))>EPS;
  function edgeStrip(a,b,width=8){const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l;return [a,b,{x:b.x+nx*width,y:b.y+ny*width},{x:a.x+nx*width,y:a.y+ny*width}];}
  const bounds=p=>({left:Math.min(...p.map(v=>v.x)),right:Math.max(...p.map(v=>v.x)),top:Math.min(...p.map(v=>v.y)),bottom:Math.max(...p.map(v=>v.y))});
  const touches=(a,b)=>a.left<=b.right+EPS&&a.right>=b.left-EPS&&a.top<=b.bottom+EPS&&a.bottom>=b.top-EPS;
  // Bounding-box broad phase keeps clipping local even on long perimeters.
  function nearby(items,poly){const box=bounds(poly);return items.filter(item=>touches(box,item.bounds||(item.bounds=bounds(item.points))));}
  // Subtracting neighboring curtains can partition a still-convex section.
  // Recover only exact convex unions; never bridge a notch or change coverage.
  function coalesce(parts,inside){
    const hull=vertices=>{
      vertices=vertices.slice().sort((a,b)=>a.x-b.x||a.y-b.y);
      const chain=list=>{const out=[];for(const p of list){while(out.length>1&&cross(out[out.length-2],out[out.length-1],p)<=1e-8)out.pop();out.push(p);}return out.slice(0,-1);};
      return [...chain(vertices),...chain(vertices.slice().reverse())];
    };
    parts=parts.slice();
    for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){
      if(!touches(bounds(parts[i]),bounds(parts[j])))continue;
      const merged=hull([...parts[i],...parts[j]]);
      if(merged.length<3||Math.abs(area(merged))<=EPS
          ||Math.abs(Math.abs(area(merged))-Math.abs(area(parts[i]))-Math.abs(area(parts[j])))>1e-5||!inside(merged))continue;
      parts[i]=merged;parts.splice(j,1);j=i;
    }
    return parts;
  }
  function compute(points,options){
    // Detailed mapped rings keep their original contour. Clip only the strips
    // that leave it, rather than splitting every curtain at every roof triangle.
    const clipFootprint=points.length>64?PolygonGeometry.createFootprintClipper(points):null;
    const inside=clipFootprint?clipFootprint.contains:poly=>contains(poly,points);
    const perimeter=points.reduce((sum,p,i)=>sum+Math.hypot(points[(i+1)%points.length].x-p.x,points[(i+1)%points.length].y-p.y),0);
    const merlonWidth=options.merlonWidth??9.6,merlonHeight=options.merlonHeight??5.6;
    const sectionLength=Math.max(options.sectionLength || 16,perimeter/LIMITS.sections),pitch=Math.max(merlonWidth,options.merlonPitch || 16);
    // Wider, shorter teeth retain the artwork's sixteen-pixel rhythm. A
    // geometry budget must never dilate that rhythm on longer curtains.
    // Beyond the bounded candidate count, use the contained tiled fallback.
    const candidateCount=points.reduce((sum,p,i)=>sum+Math.floor(Math.hypot(points[(i+1)%points.length].x-p.x,points[(i+1)%points.length].y-p.y)/pitch),0);
    if(candidateCount>LIMITS.merlons)return null;
    const towerWidth=options.towerWidth || 32,wallHeight=options.wallHeight || 24;
    const towerBaseOutset=Math.max(0,options.towerBaseOutset||0);
    const triangles=PolygonGeometry.triangulate(points).map(t=>area(t)<0?t.slice().reverse():t),edges=points.map((a,i)=>({a,b:points[(i+1)%points.length],strip:edgeStrip(a,points[(i+1)%points.length])}));
    if(!triangles.length)return null;
    const towers=[];
    for(let i=0;i<points.length&&towers.length<LIMITS.towers;i++){
      const p=points[i],previous=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];if(cross(previous,p,next)<=EPS)continue;
      const before=Math.hypot(p.x-previous.x,p.y-previous.y),after=Math.hypot(next.x-p.x,next.y-p.y);
      if(Math.min(before,after)<24)continue;
      const n1={x:-(p.y-previous.y)/before,y:(p.x-previous.x)/before};
      const n2={x:-(next.y-p.y)/after,y:(next.x-p.x)/after};
      // Align a square side to the longer adjoining curtain. At an obtuse
      // corner the other curtain meets its side instead of rotating the whole
      // tower to bisect the angle. Canonical quarter-turns keep equivalent
      // square orientations and translated/reversed inputs identical.
      // Treat floating-point length ties consistently after cache eviction.
      const tangent=after>=before-EPS?{x:next.x-p.x,y:next.y-p.y}:{x:p.x-previous.x,y:p.y-previous.y};
      let angle=Math.atan2(tangent.y,tangent.x);angle-=Math.floor(angle/(Math.PI/2)+.5+1e-10)*(Math.PI/2);
      const ux=Math.cos(angle),uy=Math.sin(angle);
      const square=(x,y,width)=>rect(0,0,width,width).map(q=>({x:x+q.x*ux-q.y*uy,y:y+q.x*uy+q.y*ux}));
      const halfWidth=towerWidth/2+towerBaseOutset,det=n1.x*n2.y-n1.y*n2.x;
      if(Math.abs(det)<EPS)continue;
      const support=n=>halfWidth*(Math.abs(n.x*ux+n.y*uy)+Math.abs(-n.x*uy+n.y*ux));
      const d1=support(n1),d2=support(n2);
      const seatX=p.x+(d1*n2.y-n1.y*d2)/det,seatY=p.y+(n1.x*d2-d1*n2.x)/det;
      const seatPoints=square(seatX,seatY,halfWidth*2);
      // Only a tower that fits the original corner may receive the deliberate
      // quarter-cell overhang; narrow wings still retain their curtain.
      if(!inside(seatPoints))continue;
      const bisector=Math.hypot(n1.x+n2.x,n1.y+n2.y);
      const outward={x:-(n1.x+n2.x)/bisector*8,y:-(n1.y+n2.y)/bisector*8};
      const x=seatX+outward.x,y=seatY+outward.y,box=square(x,y,towerWidth),basePoints=square(x,y,halfWidth*2);
      // Overhang belongs only to this corner's two curtains. Reject a shift
      // across an unrelated boundary (for example the far side of a notch).
      const crossesBase=(a,b)=>{
        const strictInside=q=>basePoints.every((v,j)=>cross(v,basePoints[(j+1)%4],q)>EPS);
        if(strictInside(a)||strictInside(b))return true;
        return basePoints.some((c,j)=>{const d=basePoints[(j+1)%4];return cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS;});
      };
      if(edges.some((edge,j)=>j!==i&&j!==(i+edges.length-1)%edges.length&&crossesBase(edge.a,edge.b)))continue;
      if(overlap(box,edges[i].strip)&&overlap(box,edges[(i+edges.length-1)%edges.length].strip)
          &&!towers.some(t=>overlap(square(x,y,halfWidth*2+8),t.basePoints))){
        towers.push({x,y,width:towerWidth,depth:towerWidth,height:options.towerHeight || 32,points:box,basePoints,seatPoints,angle,outward,corner:i});
      }
    }
    const walls=[];
    for(let edge=0;edge<edges.length;edge++){
      const {a,b}=edges[edge],l=Math.hypot(b.x-a.x,b.y-a.y),n=Math.ceil(l/sectionLength);
      for(let k=0;k<n;k++){
        const lo=k/n,hi=(k+1)/n,aa={x:a.x+(b.x-a.x)*lo,y:a.y+(b.y-a.y)*lo},bb={x:a.x+(b.x-a.x)*hi,y:a.y+(b.y-a.y)*hi};
        const strip=edgeStrip(aa,bb);
        let fragments=clipFootprint?clipFootprint(strip):triangles.map(t=>intersect(strip,t)).filter(p=>p.length);
        for(const cutter of nearby([...towers,...walls],strip).map(v=>v.points))fragments=fragments.flatMap(p=>subtract(p,cutter));
        if(clipFootprint){
          if(fragments.length>1)fragments=coalesce(fragments,inside);
          // Nearly coincident mapped edges can leave microscopic subtraction
          // slivers. They have no visible coverage and unstable endpoints.
          fragments=fragments.filter(p=>Math.abs(area(p))>=1e-4);
        }
        for(const points of fragments)walls.push({edge,points});
        if(walls.length>LIMITS.pieces)return null;
      }
    }
    // Every clipped boundary shared by another wall or a tower is internal.
    // Merge collinear coverage intervals rather than relying on one midpoint.
    const solids=[...walls,...towers];
    for(const wall of walls){const neighbours=nearby(solids,wall.points);wall.omitEdges=[];for(let i=0;i<wall.points.length;i++){
      const a=wall.points[i],b=wall.points[(i+1)%wall.points.length],dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy,intervals=[];
      for(const other of neighbours){if(other===wall)continue;for(let j=0;j<other.points.length;j++){
        const c=other.points[j],d=other.points[(j+1)%other.points.length];if(Math.abs(cross(a,b,c))>EPS||Math.abs(cross(a,b,d))>EPS||dx*(d.x-c.x)+dy*(d.y-c.y)>=0)continue;
        const t0=((c.x-a.x)*dx+(c.y-a.y)*dy)/den,t1=((d.x-a.x)*dx+(d.y-a.y)*dy)/den,lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(1,Math.max(t0,t1));if(hi>lo)intervals.push([lo,hi]);
      }}
      intervals.sort((a,b)=>a[0]-b[0]);let end=0;for(const [lo,hi] of intervals){if(lo>end+EPS)break;end=Math.max(end,hi);}if(end>=1-EPS)wall.omitEdges.push(i);
    }}
    const merlons=[],merlonBuckets=new Map(),bucketSize=Math.max(16,merlonWidth);
    const bucketKeys=box=>{
      const result=[];
      for(let x=Math.floor(box.left/bucketSize);x<=Math.floor(box.right/bucketSize);x++)
        for(let y=Math.floor(box.top/bucketSize);y<=Math.floor(box.bottom/bucketSize);y++)result.push(x+','+y);
      return result;
    };
    for(let edge=0;edge<edges.length;edge++){
      const {a,b}=edges[edge],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),ux=dx/l,uy=dy/l,nx=-uy,ny=ux,count=Math.floor(l/pitch),first=(l-(count-1)*pitch)/2;
      for(let j=0;j<count;j++){
        const at=first+j*pitch,cx=a.x+ux*at+nx*4,cy=a.y+uy*at+ny*4;
        const half=merlonWidth/2,box=[[-half,-4],[half,-4],[half,4],[-half,4]].map(([u,v])=>({x:cx+ux*u+nx*v,y:cy+uy*u+ny*v}));
        // Spatial buckets keep thousands of fixed-pitch candidates local;
        // teeth from distant source edges never enter exact overlap checks.
        const keys=bucketKeys(bounds(box)),neighbours=new Set(keys.flatMap(key=>merlonBuckets.get(key)||[]));
        if(!inside(box)||towers.some(t=>overlap(box,t.points))||[...neighbours].some(m=>overlap(box,m.points)))continue;
        const covered=nearby(walls,box).reduce((sum,w)=>sum+Math.abs(area(intersect(box,w.points))),0);if(Math.abs(covered-merlonWidth*8)>1e-3)continue;
        const merlon={edge,points:box,base:wallHeight,top:wallHeight+merlonHeight,rimTop:wallHeight,rim:edges[edge].strip,coveredArea:covered};
        merlons.push(merlon);
        for(const key of keys){if(!merlonBuckets.has(key))merlonBuckets.set(key,[]);merlonBuckets.get(key).push(merlon);}
      }
    }
    const box=bounds(points),cx=(box.left+box.right)/2,cy=(box.top+box.bottom)/2,choices=[];
    // A fixed 9x9 interior lattice plus triangle centroids finds courtyards
    // without scanning every pixel of a stadium-sized footprint.
    const candidates=[{x:cx,y:cy},...triangles.map(t=>({x:t.reduce((v,p)=>v+p.x,0)/3,y:t.reduce((v,p)=>v+p.y,0)/3}))];
    for(let ix=1;ix<10;ix++)for(let iy=1;iy<10;iy++)candidates.push({x:box.left+(box.right-box.left)*ix/10,y:box.top+(box.bottom-box.top)*iy/10});
    if(options.keep!==false)for(const {x,y} of candidates){
      const clearance=rect(x,y,88,72);if(!inside(clearance)||nearby(solids,clearance).some(t=>overlap(clearance,t.points)))continue;
      choices.push({x,y,width:64,depth:48,height:options.keepHeight || 48,points:rect(x,y,64,48),clearance,score:(x-cx)**2+(y-cy)**2});
    }
    choices.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);const keep=choices[0]||null;
    return {points,towers,walls,merlons,keep,perimeter,pitch};
  }
  function build(input,options={}){
    if(!Array.isArray(input)||input.length<3||input.length>LIMITS.vertices)return null;
    let points=input.map(p=>({x:p.x,y:p.y}));if(!points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))return null;
    points=clean(points);if(points.length<3)return null;
    PolygonGeometry.removeCollinear(points);
    if(points.length<3||Math.abs(area(points))<1)return null;
    ensureCCW(points);const start=points.reduce((best,p,i)=>p.x<points[best].x||(p.x===points[best].x&&p.y<points[best].y)?i:best,0);points=points.slice(start).concat(points.slice(0,start));
    const origin=points[0],local=points.map(p=>({x:p.x-origin.x,y:p.y-origin.y}));
    // Camera-origin subtraction adds floating noise to otherwise identical
    // contours. Normalize only the key, far below geometry tolerance; compute
    // and returned vertices retain their full precision.
    const keyPoints=local.map(p=>[+p.x.toFixed(9),+p.y.toFixed(9)]);
    const key=JSON.stringify([keyPoints,options.keep!==false,options.towerWidth,options.towerHeight,options.keepHeight,options.wallHeight,options.merlonPitch,options.merlonWidth,options.merlonHeight,options.sectionLength,options.towerBaseOutset]);
    let layout=cache.get(key);
    if(layout===undefined){
      // Canonical cached contours have already passed validation. On a miss,
      // reject crossings with a cheap bounds test before exact orientation.
      const edges=local.map((a,i)=>{const b=local[(i+1)%local.length];return {a,b,bounds:bounds([a,b])};});
      let simple=true;
      for(let i=0;i<edges.length&&simple;i++)for(let j=i+2;j<edges.length;j++){
        if((i===0&&j===edges.length-1)||!touches(edges[i].bounds,edges[j].bounds))continue;
        const {a,b}=edges[i],{a:c,b:d}=edges[j];
        if(cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS){simple=false;break;}
      }
      layout=simple?compute(local,options):null;
      if(cache.size>=LIMITS.cache)cache.delete(cache.keys().next().value);cache.set(key,layout);
    }
    if(!layout)return null;
    return translate(layout,origin.x,origin.y);
  }
  // Layout consumers may mutate tower heights and crown metadata. Translated
  // copies own their rings and parts, leaving the cached source untouched.
  function translate(layout,dx,dy){
    const move=p=>({x:p.x+dx,y:p.y+dy}),ring=p=>p.map(move),part=p=>({...p,...(Number.isFinite(p.x)?{x:p.x+dx,y:p.y+dy}:{}),points:ring(p.points),...(p.bounds?{bounds:{left:p.bounds.left+dx,right:p.bounds.right+dx,top:p.bounds.top+dy,bottom:p.bounds.bottom+dy}}:{}),...(p.basePoints?{basePoints:ring(p.basePoints),seatPoints:ring(p.seatPoints),outward:{...p.outward}}:{}),...(p.rim?{rim:ring(p.rim)}:{}),...(p.clearance?{clearance:ring(p.clearance)}:{})});
    return {...layout,points:ring(layout.points),towers:layout.towers.map(part),walls:layout.walls.map(part),merlons:layout.merlons.map(part),keep:layout.keep?part(layout.keep):null};
  }
  const api={build,translate,area,rect,contains,overlap,intersect,LIMITS};global.FDRCastleLayout=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
