(() => {
  const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
  const gap=(loop,i,j)=>{const a=loop[i],b=loop[(i+1)%loop.length],c=loop[j],d=loop[(j+1)%loop.length];return Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b));};
  // Unaltered exterior ring from Kelowna z14-2753-5566, feature1762765930,
  // ring251. Its 2.3095m notch formerly became a 0.558-unit roof slit.
  const kelowna=[{"x":0.7698443094714472,"y":0},{"x":16.936574808371837,"y":0},{"x":16.936574808371837,"y":1.1547664642071709},{"x":17.321496963107563,"y":1.1547664642071709},{"x":17.321496963107563,"y":5.38891016630013},{"x":16.936574808371837,"y":5.38891016630013},{"x":16.936574808371837,"y":8.468287404185919},{"x":15.396886189428944,"y":8.468287404185919},{"x":15.396886189428944,"y":11.932586796807431},{"x":7.698443094714472,"y":11.932586796807431},{"x":7.698443094714472,"y":14.242119725221773},{"x":15.011964034693221,"y":14.242119725221773},{"x":15.011964034693221,"y":17.706419117843286},{"x":16.551652653636115,"y":17.706419117843286},{"x":16.551652653636115,"y":20.785796355729076},{"x":16.936574808371837,"y":20.785796355729076},{"x":16.936574808371837,"y":25.40486221255776},{"x":16.166730498900392,"y":25.40486221255776},{"x":16.166730498900392,"y":26.174706522029204},{"x":0,"y":26.174706522029204},{"x":0,"y":20.785796355729076},{"x":2.694455083150065,"y":20.785796355729076},{"x":2.694455083150065,"y":12.317508951543156},{"x":3.079377237885789,"y":12.317508951543156},{"x":3.079377237885789,"y":5.38891016630013},{"x":0.7698443094714472,"y":5.38891016630013}].map(p=>({x:p.x*32/7,y:p.y*32/7}));
  const chamfered=[[0,0],[80,0],[80,80],[45.5,80],[45.5,30],[40,20],[34.5,30],[34.5,80],[0,80]].map(([x,y])=>({x,y}));
  for(const [name,lot] of [['Kelowna narrow return',kelowna],['angled slot end',chamfered]])test('pitched overhang preserves clearance: '+name,()=>{
    for(const input of [lot,[...lot].reverse()]){
      const g=BuildingLowPoly.geometry(input,'ridge',24,5),r=g.ring,o=g.roofRing;
      assert.truthy(g.actualOverhang>0&&g.actualOverhang<5,'reduce only the roof lip, retaining an overhang');
      assert.eq(r.length,input.length,'do not simplify or reshape the lot');
      for(let i=0;i<r.length;i++)for(let j=i+2;j<r.length;j++)if(i||j!==r.length-1){
        const old=gap(r,i,j);if(old>1e-6)assert.truthy(gap(o,i,j)>=old*.5-1e-7,'retain at least half the clearance between nonadjacent edges');
      }
    }
  });
  test('pitched overhang keeps normal rectangular roof lip',()=>{
    const lot=[[0,0],[80,0],[80,60],[0,60]].map(([x,y])=>({x,y}));
    assert.eq(BuildingLowPoly.geometry(lot,'ridge',24,5).actualOverhang,5);
  });
})();
