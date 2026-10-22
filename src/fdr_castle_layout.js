/* Bounded, deterministic castle layout. No renderer or texture allocation. */
(function(global){
  const EPS=1e-6;
  const LIMITS={vertices:64,sections:128,pieces:512,merlons:192,towers:12,cache:48};
  const cache=new Map();
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2;
  const rect=(x,y,w,h)=>[{x:x-w/2,y:y-h/2},{x:x+w/2,y:y-h/2},{x:x+w/2,y:y+h/2},{x:x-w/2,y:y+h/2}];
  function clean(p){const q=p.filter((a,i)=>Math.hypot(a.x-p[(i+p.length-1)%p.length].x,a.y-p[(i+p.length-1)%p.length].y)>EPS);return q.length>=3&&Math.abs(area(q))>EPS?q:[];}
  function half(poly,a,b,positive=true){const out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dp=cross(a,b,p)*(positive?1:-1),dq=cross(a,b,q)*(positive?1:-1),ip=dp>=-EPS,iq=dq>=-EPS;if(ip)out.push(p);if(ip!==iq){const t=dp/(dp-dq);out.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}}return clean(out);}
  function intersect(a,b){let p=a;for(let i=0;p.length&&i<b.length;i++)p=half(p,b[i],b[(i+1)%b.length]);return p;}
  function subtract(a,b){let inside=a;const outside=[];for(let i=0;inside.length&&i<b.length;i++){const p=b[i],q=b[(i+1)%b.length],part=half(inside,p,q,false);if(part.length)outside.push(part);inside=half(inside,p,q,true);}return outside;}
  function pointIn(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(Math.abs(cross(a,b,p))<EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS)return true;if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
  function contains(poly,ring){if(!poly.every(p=>pointIn(p,ring)))return false;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if(!pointIn({x:(a.x+b.x)/2,y:(a.y+b.y)/2},ring))return false;for(let j=0;j<ring.length;j++){const c=ring[j],d=ring[(j+1)%ring.length];if(cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS)return false;}}return true;}
  const overlap=(a,b)=>Math.abs(area(intersect(a,b)))>EPS;
  function edgeStrip(a,b,width=8){const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l;return [a,b,{x:b.x+nx*width,y:b.y+ny*width},{x:a.x+nx*width,y:a.y+ny*width}];}
  const bounds=p=>({left:Math.min(...p.map(v=>v.x)),right:Math.max(...p.map(v=>v.x)),top:Math.min(...p.map(v=>v.y)),bottom:Math.max(...p.map(v=>v.y))});
  const touches=(a,b)=>a.left<=b.right+EPS&&a.right>=b.left-EPS&&a.top<=b.bottom+EPS&&a.bottom>=b.top-EPS;
  // Bounding-box broad phase keeps clipping local even on long perimeters.
  function nearby(items,poly){const box=bounds(poly);return items.filter(item=>touches(box,item.bounds||(item.bounds=bounds(item.points))));}
  function compute(points,options){
    const perimeter=points.reduce((sum,p,i)=>sum+Math.hypot(points[(i+1)%points.length].x-p.x,points[(i+1)%points.length].y-p.y),0);
    const sectionLength=Math.max(16,perimeter/LIMITS.sections),pitch=Math.max(16,perimeter/LIMITS.merlons);
    const triangles=PolygonGeometry.triangulate(points).map(t=>area(t)<0?t.slice().reverse():t),edges=points.map((a,i)=>({a,b:points[(i+1)%points.length],strip:edgeStrip(a,points[(i+1)%points.length])}));
    if(!triangles.length)return null;
    const towers=[];
    for(let i=0;i<points.length&&towers.length<LIMITS.towers;i++){
      const p=points[i],previous=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];if(cross(previous,p,next)<=EPS)continue;
      // Seat the corner inside the tower, with a small inward bias. Continuous
      // bisector placement lets the tower project beyond both curtain lines.
      const before=Math.hypot(p.x-previous.x,p.y-previous.y),after=Math.hypot(next.x-p.x,next.y-p.y);
      if(Math.min(before,after)<24)continue;
      const nx=-(p.y-previous.y)/before-(next.y-p.y)/after,ny=(p.x-previous.x)/before+(next.x-p.x)/after,length=Math.hypot(nx,ny);
      const x=p.x+4*nx/length,y=p.y+4*ny/length,box=rect(x,y,32,32);
      if(overlap(box,edges[i].strip)&&overlap(box,edges[(i+edges.length-1)%edges.length].strip)&&!towers.some(t=>overlap(rect(x,y,40,40),t.points))){
        towers.push({x,y,width:32,depth:32,height:32,points:box,corner:i});
      }
    }
    const walls=[];
    for(let edge=0;edge<edges.length;edge++){
      const {a,b}=edges[edge],l=Math.hypot(b.x-a.x,b.y-a.y),n=Math.ceil(l/sectionLength);
      for(let k=0;k<n;k++){
        const lo=k/n,hi=(k+1)/n,aa={x:a.x+(b.x-a.x)*lo,y:a.y+(b.y-a.y)*lo},bb={x:a.x+(b.x-a.x)*hi,y:a.y+(b.y-a.y)*hi};
        let fragments=triangles.map(t=>intersect(edgeStrip(aa,bb),t)).filter(p=>p.length);
        for(const cutter of nearby([...towers,...walls],edgeStrip(aa,bb)).map(v=>v.points))fragments=fragments.flatMap(p=>subtract(p,cutter));
        for(const points of fragments)walls.push({edge,points});
        if(walls.length>LIMITS.pieces)return null;
      }
    }
    // Every clipped boundary shared by another wall or a tower is internal.
    // Merge collinear coverage intervals rather than relying on one midpoint.
    for(const wall of walls){wall.omitEdges=[];for(let i=0;i<wall.points.length;i++){
      const a=wall.points[i],b=wall.points[(i+1)%wall.points.length],dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy,intervals=[];
      for(const other of nearby([...walls,...towers],wall.points)){if(other===wall)continue;for(let j=0;j<other.points.length;j++){
        const c=other.points[j],d=other.points[(j+1)%other.points.length];if(Math.abs(cross(a,b,c))>EPS||Math.abs(cross(a,b,d))>EPS||dx*(d.x-c.x)+dy*(d.y-c.y)>=0)continue;
        const t0=((c.x-a.x)*dx+(c.y-a.y)*dy)/den,t1=((d.x-a.x)*dx+(d.y-a.y)*dy)/den,lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(1,Math.max(t0,t1));if(hi>lo)intervals.push([lo,hi]);
      }}
      intervals.sort((a,b)=>a[0]-b[0]);let end=0;for(const [lo,hi] of intervals){if(lo>end+EPS)break;end=Math.max(end,hi);}if(end>=1-EPS)wall.omitEdges.push(i);
    }}
    const merlons=[];
    for(let edge=0;edge<edges.length;edge++){
      const {a,b}=edges[edge],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),ux=dx/l,uy=dy/l,nx=-uy,ny=ux,count=Math.floor(l/pitch),first=(l-(count-1)*pitch)/2;
      for(let j=0;j<count;j++){
        const at=first+j*pitch,cx=a.x+ux*at+nx*4,cy=a.y+uy*at+ny*4;
        const box=[[-4,-4],[4,-4],[4,4],[-4,4]].map(([u,v])=>({x:cx+ux*u+nx*v,y:cy+uy*u+ny*v}));
        if(!contains(box,points)||towers.some(t=>overlap(box,t.points))||merlons.some(m=>overlap(box,m.points)))continue;
        const covered=nearby(walls,box).reduce((sum,w)=>sum+Math.abs(area(intersect(box,w.points))),0);if(Math.abs(covered-64)>1e-3)continue;
        merlons.push({edge,points:box,base:24,top:32,rimTop:24,rim:edges[edge].strip,coveredArea:covered});
      }
    }
    const box=bounds(points),cx=(box.left+box.right)/2,cy=(box.top+box.bottom)/2,choices=[];
    // A fixed 9x9 interior lattice plus triangle centroids finds courtyards
    // without scanning every pixel of a stadium-sized footprint.
    const candidates=[{x:cx,y:cy},...triangles.map(t=>({x:t.reduce((v,p)=>v+p.x,0)/3,y:t.reduce((v,p)=>v+p.y,0)/3}))];
    for(let ix=1;ix<10;ix++)for(let iy=1;iy<10;iy++)candidates.push({x:box.left+(box.right-box.left)*ix/10,y:box.top+(box.bottom-box.top)*iy/10});
    if(options.keep!==false)for(const {x,y} of candidates){
      const clearance=rect(x,y,88,72);if(!contains(clearance,points)||nearby([...towers,...walls],clearance).some(t=>overlap(clearance,t.points)))continue;
      choices.push({x,y,width:64,depth:48,height:48,points:rect(x,y,64,48),clearance,score:(x-cx)**2+(y-cy)**2});
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
    for(let i=0;i<points.length;i++)for(let j=i+2;j<points.length;j++){
      if(i===0&&j===points.length-1)continue;
      const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
      if(cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS)return null;
    }
    if(area(points)<0)points.reverse();const start=points.reduce((best,p,i)=>p.x<points[best].x||(p.x===points[best].x&&p.y<points[best].y)?i:best,0);points=points.slice(start).concat(points.slice(0,start));
    const origin=points[0],local=points.map(p=>({x:p.x-origin.x,y:p.y-origin.y})),key=JSON.stringify([local,options.keep!==false]);
    let layout=cache.get(key);
    if(layout===undefined){layout=compute(local,options);if(cache.size>=LIMITS.cache)cache.delete(cache.keys().next().value);cache.set(key,layout);}
    if(!layout)return null;
    const move=p=>({x:p.x+origin.x,y:p.y+origin.y}),ring=p=>p.map(move),part=p=>({...p,...(Number.isFinite(p.x)?{x:p.x+origin.x,y:p.y+origin.y}:{}),points:ring(p.points),...(p.bounds?{bounds:{left:p.bounds.left+origin.x,right:p.bounds.right+origin.x,top:p.bounds.top+origin.y,bottom:p.bounds.bottom+origin.y}}:{}),...(p.rim?{rim:ring(p.rim)}:{}),...(p.clearance?{clearance:ring(p.clearance)}:{})});
    return {...layout,points:ring(layout.points),towers:layout.towers.map(part),walls:layout.walls.map(part),merlons:layout.merlons.map(part),keep:layout.keep?part(layout.keep):null};
  }
  const api={build,area,rect,contains,overlap,intersect,LIMITS};global.FDRCastleLayout=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
