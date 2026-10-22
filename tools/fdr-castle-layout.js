/* Pure layout for irregular FDR study fixtures. All clipping is in map space. */
(function(global){
  const EPS=1e-6,fixtures={
    rectangle:[[-100,-80],[100,-80],[100,80],[-100,80]],
    concave:[[-100,-80],[100,-80],[100,-20],[20,-20],[20,80],[-100,80]],
    narrow:[[-100,-23],[100,-23],[100,23],[-100,23]],
    skewed:[[-100,-64],[70,-80],[104,62],[-66,80]],
    acute:[[-104,-56],[48,-80],[108,0],[18,28],[-38,80],[-100,44]],
  };
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
  function build(shape,triangulate){
    let points=fixtures[shape].map(([x,y])=>({x,y}));if(area(points)<0)points.reverse();const start=points.reduce((best,p,i)=>p.x<points[best].x||(p.x===points[best].x&&p.y<points[best].y)?i:best,0);points=points.slice(start).concat(points.slice(0,start));
    const triangles=triangulate(points).map(t=>area(t)<0?t.slice().reverse():t),edges=points.map((a,i)=>({a,b:points[(i+1)%points.length],strip:edgeStrip(a,points[(i+1)%points.length])}));
    const towers=[],omittedTowers=[];
    for(let i=0;i<points.length;i++){
      const p=points[i],previous=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];if(cross(previous,p,next)<=EPS)continue;
      // Seat the corner inside the tower, with a small inward bias. Continuous
      // bisector placement lets the tower project beyond both curtain lines.
      const before=Math.hypot(p.x-previous.x,p.y-previous.y),after=Math.hypot(next.x-p.x,next.y-p.y);
      const nx=-(p.y-previous.y)/before-(next.y-p.y)/after,ny=(p.x-previous.x)/before+(next.x-p.x)/after,length=Math.hypot(nx,ny);
      const x=p.x+4*nx/length,y=p.y+4*ny/length,box=rect(x,y,32,32);
      if(overlap(box,edges[i].strip)&&overlap(box,edges[(i+edges.length-1)%edges.length].strip)&&!towers.some(t=>overlap(rect(x,y,40,40),t.points))){
        towers.push({x,y,width:32,depth:32,height:32,points:box,corner:i});
      }else omittedTowers.push(i);
    }
    const walls=[];
    for(let edge=0;edge<edges.length;edge++){
      const {a,b}=edges[edge],l=Math.hypot(b.x-a.x,b.y-a.y),n=Math.ceil(l/16);
      for(let k=0;k<n;k++){
        const lo=k/n,hi=(k+1)/n,aa={x:a.x+(b.x-a.x)*lo,y:a.y+(b.y-a.y)*lo},bb={x:a.x+(b.x-a.x)*hi,y:a.y+(b.y-a.y)*hi};
        let fragments=triangles.map(t=>intersect(edgeStrip(aa,bb),t)).filter(p=>p.length);
        for(const cutter of [...towers.map(t=>t.points),...walls.map(w=>w.points)])fragments=fragments.flatMap(p=>subtract(p,cutter));
        for(const points of fragments)walls.push({edge,points});
      }
    }
    // Every clipped boundary shared by another wall or a tower is internal.
    // Merge collinear coverage intervals rather than relying on one midpoint.
    for(const wall of walls){wall.omitEdges=[];for(let i=0;i<wall.points.length;i++){
      const a=wall.points[i],b=wall.points[(i+1)%wall.points.length],dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy,intervals=[];
      for(const other of [...walls,...towers]){if(other===wall)continue;for(let j=0;j<other.points.length;j++){
        const c=other.points[j],d=other.points[(j+1)%other.points.length];if(Math.abs(cross(a,b,c))>EPS||Math.abs(cross(a,b,d))>EPS||dx*(d.x-c.x)+dy*(d.y-c.y)>=0)continue;
        const t0=((c.x-a.x)*dx+(c.y-a.y)*dy)/den,t1=((d.x-a.x)*dx+(d.y-a.y)*dy)/den,lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(1,Math.max(t0,t1));if(hi>lo)intervals.push([lo,hi]);
      }}
      intervals.sort((a,b)=>a[0]-b[0]);let end=0;for(const [lo,hi] of intervals){if(lo>end+EPS)break;end=Math.max(end,hi);}if(end>=1-EPS)wall.omitEdges.push(i);
    }}
    const merlons=[];
    for(let edge=0;edge<edges.length;edge++){
      const {a,b}=edges[edge],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),ux=dx/l,uy=dy/l,nx=-uy,ny=ux,count=Math.floor(l/16),first=(l-(count-1)*16)/2;
      for(let j=0;j<count;j++){
        const at=first+j*16,cx=a.x+ux*at+nx*4,cy=a.y+uy*at+ny*4;
        const box=[[-4,-4],[4,-4],[4,4],[-4,4]].map(([u,v])=>({x:cx+ux*u+nx*v,y:cy+uy*u+ny*v}));
        if(!contains(box,points)||towers.some(t=>overlap(box,t.points))||merlons.some(m=>overlap(box,m.points)))continue;
        const covered=walls.reduce((sum,w)=>sum+Math.abs(area(intersect(box,w.points))),0);if(Math.abs(covered-64)>1e-3)continue;
        merlons.push({edge,points:box,base:24,top:32,rimTop:24,rim:edges[edge].strip,coveredArea:covered});
      }
    }
    const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y)),choices=[];
    for(let x=Math.ceil(minX/4)*4;x<maxX;x+=4)for(let y=Math.ceil(minY/4)*4;y<maxY;y+=4){
      const clearance=rect(x,y,88,72);if(!contains(clearance,points)||towers.some(t=>overlap(clearance,t.points))||walls.some(w=>overlap(clearance,w.points)))continue;
      choices.push({x,y,width:64,depth:48,height:48,points:rect(x,y,64,48),clearance,score:x*x+y*y});
    }
    choices.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);const keep=choices[0]||null;
    const uncoveredPerimeter=[];
    for(let edge=0;edge<edges.length;edge++){const {a,b}=edges[edge],n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/2);for(let j=0;j<n;j++){const t=(j+.5)/n,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};if(![...walls,...towers].some(v=>pointIn(p,v.points)))uncoveredPerimeter.push({edge,t,p});}}
    return {shape,points,edges,towers,omittedTowers,walls,merlons,keep,uncoveredPerimeter,validity:{perimeterCovered:uncoveredPerimeter.length===0,towersStraddleWalls:towers.every(t=>!contains(t.points,points)&&[t.corner,(t.corner+edges.length-1)%edges.length].every(i=>overlap(t.points,edges[i].strip))),wallsContained:walls.every(w=>contains(w.points,points)),merlonsSupported:merlons.every(m=>Math.abs(m.coveredArea-64)<1e-3),keepClear:!keep||(contains(keep.clearance,points)&&![...towers,...walls].some(p=>overlap(keep.clearance,p.points))),wallTowerDisjoint:walls.every(w=>towers.every(t=>!overlap(w.points,t.points))),wallsDisjoint:walls.every((w,i)=>walls.slice(i+1).every(v=>!overlap(w.points,v.points)))}};
  }
  const api={fixtures,build,area,rect,contains,overlap,intersect};global.FDRCastleLayout=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
