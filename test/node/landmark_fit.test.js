(() => {
  const C=Math.cos(Math.PI/6),box={faces:[]};
  const corners=[[0,0,0],[50,0,0],[50,20,0],[0,20,0],[0,0,20],[50,0,20],[50,20,20],[0,20,20]].map(([x,y,z])=>({x,y,z,tu:0,tv:0}));
  for(const ids of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])for(const t of [[0,1,2],[0,2,3]])box.faces.push({points:t.map(i=>corners[ids[i]])});
  const rotate=(p,a)=>({x:p.x*Math.cos(a)-p.y*Math.sin(a),y:p.x*Math.sin(a)+p.y*Math.cos(a)});
  const base=[[0,0],[100,0],[100,12],[16,12],[16,45],[0,45]].map(([x,y])=>({x,y}));
  test('landmark fit: rotated narrow concave lots keep a readable uniformly scaled shell inside the lot',()=>{
    const angle=.61,ring=base.map(p=>rotate(p,angle)),m=BuildingLowPoly.authoredGeometry(box,ring),scale=m.height/(20*C);
    assert.truthy(scale>.8,'edge-aligned interior candidates use the long narrow wing');
    const inside=p=>{const q=rotate(p,-angle);return q.x>=-1e-5&&q.y>=-1e-5&&q.x<=100+1e-5&&q.y<=45+1e-5&&(q.y<=12+1e-5||q.x<=16+1e-5);};
    for(let i=0;i<m.faces.length;i++){
      const dst=m.faces[i].points,src=box.faces[i].points;
      for(let j=0;j<3;j++){const k=(j+1)%3,source=Math.hypot(src[j].x-src[k].x,(src[j].y-src[k].y)*.5,(src[j].z-src[k].z)*C),actual=Math.hypot(dst[j].x-dst[k].x,dst[j].y-dst[k].y,dst[j].z-dst[k].z);assert.truthy(Math.abs(actual-source*scale)<1e-6,'same scale in every dimension');}
      for(let a=0;a<=10;a++)for(let b=0;b<=10-a;b++){const c=10-a-b;assert.truthy(inside({x:(a*dst[0].x+b*dst[1].x+c*dst[2].x)/10,y:(a*dst[0].y+b*dst[1].y+c*dst[2].y)/10}),'whole faces remain inside concave outline');}
    }
  });
  test('landmark fit: explicit entrance orientation is not changed by lot-edge search',()=>{
    const ring=base.map(p=>rotate(p,.61)),door={normal:{x:0,y:1},center:{x:0,y:0}},m=BuildingLowPoly.authoredGeometry(box,ring,1,door);
    const a=m.faces[0].points[1],b=m.faces[0].points[2];
    assert.truthy(Math.abs(a.y-b.y)<1e-7,'source horizontal edge stays horizontal for this entrance normal');
  });
})();
