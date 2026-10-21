// Run in the production game page after BuildingLowPoly.add. Inputs use the
// unchanged source ring in normal scene pixel units, never orthogonalized.
function auditKelownaCoverage(mesh,sourceRing){
 const roofs=mesh.faces.filter(f=>f.kind==='roof'),area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-a.y*b.x},0))/2;
 const inside=p=>{let hit=false;for(let i=0,j=sourceRing.length-1;i<sourceRing.length;j=i++){const a=sourceRing[i],b=sourceRing[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit};
 const xmin=Math.min(...sourceRing.map(p=>p.x)),xmax=Math.max(...sourceRing.map(p=>p.x)),ymin=Math.min(...sourceRing.map(p=>p.y)),ymax=Math.max(...sourceRing.map(p=>p.y));const samples=[];
 for(let yi=0;yi<33;yi++)for(let xi=0;xi<33;xi++){const p={x:xmin+(xi+.5)/33*(xmax-xmin),y:ymin+(yi+.5)/33*(ymax-ymin)};if(inside(p))samples.push(p)}
 for(let i=0;i<sourceRing.length;i++){const a=sourceRing[i],b=sourceRing[(i+1)%sourceRing.length],len=Math.hypot(b.x-a.x,b.y-a.y);if(!len)continue;for(const sign of [-1,1]){const p={x:(a.x+b.x)/2-sign*(b.y-a.y)/len*.05,y:(a.y+b.y)/2+sign*(b.x-a.x)/len*.05};if(inside(p))samples.push(p)}}
 const projected=roofs.map(f=>({points:f.points,area:area(f.points)}));const covers=(f,p)=>{const [a,b,c]=f.points,s=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x),t=(c.x-b.x)*(p.y-b.y)-(c.y-b.y)*(p.x-b.x),u=(a.x-c.x)*(p.y-c.y)-(a.y-c.y)*(p.x-c.x);return (s>=-1e-7&&t>=-1e-7&&u>=-1e-7)||(s<=1e-7&&t<=1e-7&&u<=1e-7)};
 const holes=samples.filter(p=>!projected.some(f=>f.area>1e-8&&covers(f,p))),z=mesh.faces.flatMap(f=>f.points.map(p=>p.z));
 return {sampleCount:samples.length,uncovered:holes.length,uncoveredPoints:holes.slice(0,20),sourceArea:area(sourceRing),projectedRoofArea:projected.reduce((s,f)=>s+f.area,0),minZ:Math.min(...z),maxZ:Math.max(...z),zeroAreaRoofTriangles:projected.filter(f=>f.area<1e-8).length};
}
