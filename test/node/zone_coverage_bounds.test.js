(() => {
  const N=64, EXT=4096, unit=EXT/N;
  const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  // Independent ray/segment oracle checks every tile cell, including cells
  // outside the optimized union bounds and the fringe around hole boundaries.
  function covered(rings,x,y,margin) {
    let inside=false, distance2=Infinity;
    for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[j],b=ring[i],dx=b.x-a.x,dy=b.y-a.y;
      if((a.y>y)!==(b.y>y)&&x<a.x+(y-a.y)*dx/dy)inside=!inside;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));
      distance2=Math.min(distance2,(x-a.x-t*dx)**2+(y-a.y-t*dy)**2);
    }
    return inside||distance2<=margin*margin;
  }
  test('zone coverage bounds: small buffered parks and beaches preserve holes, fringe and tile-edge cells',()=>{
    const upm=N*WorldGen.CELL_M/EXT, margin=Zones.FRINGE_FILL_M/upm;
    for(const [cx,cy] of [[2048,2048],[0,2048],[4096,2048],[2048,0],[2048,4096],[0,0],[4096,4096],[-unit/2,2048],[4096+unit/2,2048]]) {
      const rings=[rect(cx-4*unit,cy-4*unit,cx+4*unit,cy+4*unit),
        rect(cx-unit,cy-unit,cx+unit,cy+unit)];
      const beach=[rect(cx-3.5*unit,cy-2.5*unit,cx-1.5*unit,cy+2.5*unit)];
      const a={kind:'grove',gx:cx,gy:cy,lx:cx,ly:cy,R:60,upm,
        code:Zones.ZONE_KINDS.grove.code,key:Zones.anchorKey(cx,cy),owned:cx>=0&&cx<EXT&&cy>=0&&cy<EXT};
      const field={anchors:[],idx:null,s:null,reach:[],allAnchors:[a]};
      const result=WorldGen.runSteps(ZoneCoverage.buildSteps({field,N,tx:0,ty:0,
        parks:[{rings,tags:{class:'park'}}],grid:new Uint8Array(N*N).fill(WorldGen.T.GRASS),
        beachLayer:{features:[{type:3,tags:{class:'sand',subclass:'beach'},geom:beach}]}}));
      for(let y=0;y<N;y++)for(let x=0;x<N;x++) {
        const px=(x+.5)*unit,py=(y+.5)*unit;
        const expected=covered(rings,px,py,margin)?covered(beach,px,py,0)?'beach':'grove':undefined;
        const actual=result.anchors[result.coverage[y*N+x]-1]?.kind;
        assert.eq(actual,expected,`centre ${cx},${cy}, cell ${x},${y}`);
      }
    }
  });
})();
