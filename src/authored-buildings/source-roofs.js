/* Roof families keep their authored ridge, pitch and complete roof planes.
   A disjoint rectangle cover prevents intersecting roof shells at concave joins. */
(function(root){
 const C=Math.cos(Math.PI/6),EPS=1e-5;
 function buildSourceRoofs(spec,key,polygon,{triangle,quad}){
  const ring=polygon.map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:p),axis=spec.sideRidge?'x':'y';
  const H=(spec.base-spec.eave)/C,sourceSpan=spec.sideRidge?spec.depth*2:spec.right-spec.left;
  const sourceRise=(spec.sideRidge?spec.depth/2:spec.eave-spec.peak)/C,pitch=sourceRise/(sourceSpan/2);
  const inside=(x,y)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
  const along=p=>axis==='y'?p.y:p.x,cross=p=>axis==='y'?p.x:p.y;
  const bounds=[...new Set(ring.map(along))].sort((a,b)=>a-b),crosses=[...new Set(ring.map(cross))].sort((a,b)=>a-b),sections=[];
  for(let i=1;i<bounds.length;i++){
   const a0=bounds[i-1],a1=bounds[i],mid=(a0+a1)/2;let start=null;
   for(let j=1;j<=crosses.length;j++){
    const yes=j<crosses.length&&(axis==='y'?inside((crosses[j-1]+crosses[j])/2,mid):inside(mid,(crosses[j-1]+crosses[j])/2));
    if(yes&&start===null)start=crosses[j-1];
    if(!yes&&start!==null){const end=crosses[j-1],prior=sections.find(s=>s.a1===a0&&s.b0===start&&s.b1===end);if(prior)prior.a1=a1;else sections.push({a0,a1,b0:start,b1:end});start=null;}
   }
  }
  if(key==='trader'&&sections.length){
   const main=sections.reduce((a,b)=>(b.a1-b.a0)*(b.b1-b.b0)>(a.a1-a.a0)*(a.b1-a.b0)?b:a,sections[0]);
   const split=main.a0+(main.a1-main.a0)*.55,rear={...main,a1:split,rearTier:true};main.a0=split;sections.push(rear);
  }
  for(const s of sections){s.axis=axis;s.eave=H;s.ridge=(s.b0+s.b1)/2;s.peak=H+sourceRise;Object.assign(s,axis==='y'?{x0:s.b0,x1:s.b1,y0:s.a0,y1:s.a1}:{x0:s.a0,x1:s.a1,y0:s.b0,y1:s.b1});}
  for(const s of sections){s.leftEave=H;s.rightEave=H;if(s.rearTier){s.ridge=s.b0+(s.b1-s.b0)*52/76;s.tierScale=1;s.rightEave=H+14/C*s.tierScale;s.peak=H+26/C*s.tierScale;}}
  for(const s of sections){s.pitchLeft=(s.peak-s.leftEave)/(s.ridge-s.b0);s.pitchRight=(s.peak-s.rightEave)/(s.b1-s.ridge);}
  const roofH=(s,b)=>b<=s.ridge?s.leftEave+(s.peak-s.leftEave)*Math.max(0,(b-s.b0)/(s.ridge-s.b0)):s.rightEave+(s.peak-s.rightEave)*Math.max(0,(s.b1-b)/(s.b1-s.ridge));
  const height=(x,y)=>{const a=axis==='y'?y:x,b=axis==='y'?x:y;let z=H;for(const s of sections)if(a>=s.a0-EPS&&a<=s.a1+EPS&&b>=s.b0-EPS&&b<=s.b1+EPS)z=Math.max(z,roofH(s,b));return z;};
  const P=(a,b,z)=>axis==='y'?{x:b,y:a,z}:{x:a,y:b,z};
  const roofPlanes=[];
  const emitRoof=(ps)=>{roofPlanes.push(ps);RoofMaterials.emit(ps,key,quad);};
  for(const s of sections){
   // Each source plane receives fixed edge trims and native-density interior.
   const count=1,step=s.a1-s.a0;
   for(let i=0;i<count;i++){
    const a0=s.a0+i*step,a1=a0+step;
    if(s.rearTier){
     emitRoof([P(a0,s.b0,s.leftEave),P(a0,s.ridge,s.peak),P(a1,s.ridge,s.peak),P(a1,s.b0,s.leftEave)],[[0,26],[52,0],[52,26],[0,52]],Math.hypot(52,26/C),52);
     emitRoof([P(a0,s.ridge,s.peak),P(a0,s.b1,s.rightEave),P(a1,s.b1,s.rightEave),P(a1,s.ridge,s.peak)],[[52,0],[76,12],[76,38],[52,26]],Math.hypot(24,12/C),52);
    }else if(axis==='y'){
     emitRoof([P(a0,s.b0,H),P(a0,s.ridge,s.peak),P(a1,s.ridge,s.peak),P(a1,s.b0,H)],[[spec.left,spec.back],[spec.center,spec.backPeak],[spec.center,spec.peak],[spec.left,spec.eave]]);
     emitRoof([P(a0,s.ridge,s.peak),P(a0,s.b1,H),P(a1,s.b1,H),P(a1,s.ridge,s.peak)],[[spec.center,spec.backPeak],[spec.right,spec.back],[spec.right,spec.eave],[spec.center,spec.peak]]);
    }else{
     emitRoof([P(a0,s.b0,H),P(a1,s.b0,H),P(a1,s.ridge,s.peak),P(a0,s.ridge,s.peak)],[[spec.left,spec.eave],[spec.right,spec.eave],[spec.right,spec.peak],[spec.left,spec.peak]]);
     emitRoof([P(a0,s.ridge,s.peak),P(a1,s.ridge,s.peak),P(a1,s.b1,H),P(a0,s.b1,H)],[[spec.left,spec.peak],[spec.right,spec.peak],[spec.right,spec.eave],[spec.left,spec.eave]]);
    }
   }
   if(s.rearTier){
    // The asymmetric source tier has a raised right eave; close that cheek
    // above the normal facade even when another footprint wing meets it.
    for(let start=s.a0;start<s.a1-EPS;start+=128){
     const end=Math.min(start+128,s.a1),ps=[P(start,s.b1,H),P(end,s.b1,H),P(end,s.b1,s.rightEave),P(start,s.b1,s.rightEave)];
     quad(ps,ps.map(p=>[p.y-start,744-p.z*C]),'wall');
    }
   }
   // At each rectangle end, expose only the portion above its neighbor. This
   // closes roof steps without coincident internal gables or wall faces.
   for(const end of [0,1]){
    const a=end?s.a1:s.a0,out=end?1:-1,neighbors=sections.filter(t=>t!==s&&(end?Math.abs(t.a0-a)<EPS:Math.abs(t.a1-a)<EPS)&&t.b1>s.b0&&t.b0<s.b1);
    if(key==='fdr'){
     // Only exposed gable runs need ties; adjoining sections share a wall.
     const cuts=[s.b0,s.b1,...neighbors.flatMap(t=>[Math.max(s.b0,t.b0),Math.min(s.b1,t.b1)])].sort((x,y)=>x-y);
     for(let i=1;i<cuts.length;i++){const lo=cuts[i-1],hi=cuts[i],mid=(lo+hi)/2;if(hi-lo>EPS&&!neighbors.some(t=>mid>t.b0-EPS&&mid<t.b1+EPS))RoofMaterials.gableTie(P(a,lo,H),P(a,hi,H),quad);}
    }
    const knots=[s.b0,s.ridge,s.b1,...neighbors.flatMap(t=>[t.b0,t.ridge,t.b1]).filter(b=>b>s.b0&&b<s.b1)];
    const tiledCap=axis==='y'&&key!=='trader'&&Math.abs(s.b1-s.b0-(spec.right-spec.left))>1;
    if(tiledCap||key==='trader'||key==='fdr')for(let b=s.b0+128;b<s.b1;b+=128)knots.push(b);
    knots.sort((a,b)=>a-b);
    const lower=b=>{let z=H;for(const t of neighbors)if(b>=t.b0-EPS&&b<=t.b1+EPS)z=Math.max(z,roofH(t,b));return z;};
    for(let j=1;j<knots.length;j++){
     let b0=knots[j-1],b1=knots[j];if(b1-b0<EPS)continue;
     let d0=roofH(s,b0)-lower(b0),d1=roofH(s,b1)-lower(b1);if(d0<=EPS&&d1<=EPS)continue;
     if(d0<0){b0+=(-d0)/(d1-d0)*(b1-b0);d0=0;}else if(d1<0){b1=b0+d0/(d0-d1)*(b1-b0);d1=0;}
     let ps=[P(a,b0,lower(b0)),P(a,b1,lower(b1)),P(a,b1,roofH(s,b1)),P(a,b0,roofH(s,b0))];
     let uv=ps.map(p=>{const b=axis==='y'?p.x:p.y;if(key==='trader')return [128+b-s.b0-Math.floor(((b0+b1)/2-s.b0)/128)*128,328-p.z*C];if(tiledCap)return [b-s.b0-Math.floor(((b0+b1)/2-s.b0)/128)*128,976+spec.eave-spec.peak-(p.z-H)*C];if(key==='fdr')return [b-s.b0-Math.floor(((b0+b1)/2-s.b0)/128)*128,628.5];if(axis==='y')return [spec.left+(b-s.b0)/(s.b1-s.b0)*(spec.right-spec.left),spec.eave-(p.z-H)/Math.max(EPS,s.peak-H)*(spec.eave-spec.peak)+16];return [(b-s.b0)/(s.b1-s.b0)*(spec.right-spec.left),628.5];});
     // Initial winding points -along for y ridges, +along for x ridges.
     if((axis==='y'&&end)||(axis==='x'&&!end)){ps.reverse();uv.reverse();}
     quad(ps,uv,'wall');
     if(key==='trader'&&end&&!s.rearTier){
      // Signs and attic windows keep their native pixel size. Clip the decal
      // to this exposed cap interval instead of stretching it with roof width.
      const f=s.rearTier?{u:46,v:31,w:14,h:10,anchor:52,base:76}:{u:30,v:60,w:16,h:11,anchor:38,base:98};
      const left=s.ridge+f.u-f.anchor,right=left+f.w,lo=Math.max(b0,left),hi=Math.min(b1,right);
      if(hi>lo+EPS){
       let panel=[{b:lo,z:(f.base-f.v-f.h)/C},{b:hi,z:(f.base-f.v-f.h)/C},{b:hi,z:(f.base-f.v)/C},{b:lo,z:(f.base-f.v)/C}];
       const clip=(poly,distance)=>{const out=[];for(let k=0;k<poly.length;k++){const a=poly[k],b=poly[(k+1)%poly.length],da=distance(a),db=distance(b);if(da>=-EPS)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push({b:a.b+(b.b-a.b)*t,z:a.z+(b.z-a.z)*t});}}return out;};
       panel=clip(panel,p=>p.z-lower(p.b));panel=clip(panel,p=>roofH(s,p.b)-p.z);
       let points=panel.map(p=>P(a+out*.035,p.b,p.z)),tex=panel.map(p=>[f.u+p.b-left,f.base-p.z*C+16]);
       if((axis==='y'&&end)||(axis==='x'&&!end)){points.reverse();tex.reverse();}
       for(let k=1;k+1<points.length;k++)triangle([points[0],points[k],points[k+1]],[tex[0],tex[k],tex[k+1]],'wall');
      }
     }
    }
   }
  }
  RoofMaterials.overhang(roofPlanes,ring,quad,false,true);
  const primary=sections.reduce((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)>(a.x1-a.x0)*(a.y1-a.y0)?b:a,sections[0]);
  return {height,sections,primary,pitch,mode:key==='trader'?'source twin-tier gable roof':spec.sideRidge?'source side-ridge roof':'source gable roof',eaveHeight:H};
 }
 root.buildSourceRoofs=buildSourceRoofs;
})(typeof window==='undefined'?globalThis:window);
