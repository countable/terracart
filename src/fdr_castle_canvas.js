// FDR Canvas coverage: close paired opaque edges, including adjacent flat roof planes.
// Exterior silhouettes and transparent material clips remain exact.
(function (global) {
  const { wallTintSource, wallUVAffine } = global.WallSurfaceRenderer;
  const whitePatch=points=>points?.every(p=>p.u>=496/512&&p.u<=504/512&&p.v>=496/512&&p.v<=504/512);
  const pointKey = p => [p.x,p.y,p.z].map(n=>Math.round(n*1e5)).join(',');
  function planeKey(points) {
    const [a,b,c]=points, u={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},v={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};
    let n=[u.y*v.z-u.z*v.y,u.z*v.x-u.x*v.z,u.x*v.y-u.y*v.x],length=Math.hypot(...n);
    if(length<1e-8)return null;n=n.map(x=>x/length);
    if(n.find(x=>Math.abs(x)>1e-8)<0)n=n.map(x=>-x);
    return [...n,n[0]*a.x+n[1]*a.y+n[2]*a.z].map(x=>Math.round(x*1e5)).join(',');
  }
  function internalEdges(triangles) {
    const shared=triangles.map(()=>[false,false,false]),edges=new Map(),solidEdges=new Map(),groups=new Map(),paths=[];
    triangles.forEach((t,index)=>{
      if(!t.uv||t.alpha!==1)return;
      const center=t.uv.reduce((p,q)=>({u:p.u+q.u/3,v:p.v+q.v/3}),{u:0,v:0});
      const slot=Math.floor(center.u*4)+4*Math.floor(center.v*4);
      const roof=slot===8;
      // Only fully opaque materials participate. Gates, windows, coping and
      // base tiles contain transparent source pixels and retain exact clips.
      if(![0,3,4,5,8,9,10,13,14].includes(slot)&&!whitePatch(t.uv))return;
      const plane=planeKey(t.uv);if(!plane)return;
      const groupKey=plane+'|'+slot+'|'+t.color;let path=groups.get(groupKey);
      if(!path){path=new Path2D();groups.set(groupKey,path);}paths[index]=roof?undefined:path;
      const [a,b,c]=t.points,reverse=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)<0;
      for(let i=0;i<3;i++){
        const j=(i+1)%3,ka=pointKey(t.uv[i]),kb=pointKey(t.uv[j]);
        const rawKey=[ka,kb].sort().join('|');
        // Different cel colours and roof slopes still meet at one opaque edge.
        // Flat fills can overlap that shared edge without touching silhouettes.
        // Opaque roof tiles also bridge their shared slope edges. Their clip
        // expands only at paired edges; exterior eaves remain exact.
        if(whitePatch(t.uv)||roof){
          // The flat cap beneath a roof shares its eaves, but is not an
          // adjacent roof slope: expanding it paints a pale fringe outside.
          const solidKey=(roof?'roof|':'flat|')+rawKey;
          const pair=solidEdges.get(solidKey);
          if(pair){shared[index][i]=true;shared[pair.index][pair.edge]=true;}
          else solidEdges.set(solidKey,{index,edge:i});
        }
        const key=groupKey+'|'+rawKey;
        const existing=edges.get(key);
        if(existing){shared[index][i]=true;shared[existing.index][existing.edge]=true;existing.paired=true;}
        else edges.set(key,{index,edge:i,groupKey,a:reverse?t.points[j]:t.points[i],b:reverse?t.points[i]:t.points[j],ka:reverse?kb:ka,kb:reverse?ka:kb});
      }
    });
    // Only exterior boundary loops enter the exact clip, avoiding thousands of
    // redundant triangle subpaths (which make Canvas clipping very expensive).
    const boundaries=new Map();
    for(const e of edges.values())if(!e.paired){if(!boundaries.has(e.groupKey))boundaries.set(e.groupKey,new Map());const links=boundaries.get(e.groupKey);if(!links.has(e.ka))links.set(e.ka,[]);links.get(e.ka).push(e);}
    for(const [key,links] of boundaries){
      const path=groups.get(key);
      while(links.size){
        const first=links.values().next().value[0];let edge=first;
        path.moveTo(first.a.x,first.a.y);
        while(edge){path.lineTo(edge.b.x,edge.b.y);const list=links.get(edge.ka);list.splice(list.indexOf(edge),1);if(!list.length)links.delete(edge.ka);if(edge.kb===first.ka)break;edge=links.get(edge.kb)?.[0];}
        path.closePath();
      }
    }
    return {shared,paths};
  }
  function expanded(points,shared,transform) {
    if(!shared.some(Boolean))return points;
    const inverse=transform.inverse(),p=points.map(q=>transform.transformPoint(q));
    const area=(p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x);
    if(Math.abs(area)<1e-8)return points;
    const sign=Math.sign(area),lines=p.map((a,i)=>{
      const b=p[(i+1)%3],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=sign*dy/l,ny=-sign*dx/l;
      return {nx,ny,d:nx*a.x+ny*a.y+(shared[i]?.75:0)};
    });
    return points.map((original,i)=>{
      const a=lines[(i+2)%3],b=lines[i],det=a.nx*b.ny-a.ny*b.nx;
      if(Math.abs(det)<1e-8)return original;
      const x=(a.d*b.ny-a.ny*b.d)/det,y=(a.nx*b.d-a.d*b.nx)/det;
      // Do not amplify almost edge-on triangles into visible spikes.
      if(Math.hypot(x-p[i].x,y-p[i].y)>2)return original;
      return inverse.transformPoint({x,y});
    });
  }
  function attach(target) {
    if(!target._wallTriangles||target._fdrCanvasCoverage)return;
    target._fdrCanvasCoverage=true;
    target.renderCanvas=function(renderer,src,camera,parentMatrix){
      camera.addToRenderList(src);
      const matrix=Phaser.GameObjects.GetCalcMatrix(src,camera,parentMatrix).calc,g=renderer.currentContext,image=src._wallAtlas.getSourceImage();
      const first=src._wallTriangles[0],length=src._wallTriangles.length;
      if(src._fdrCanvasEdgeCache?.first!==first||src._fdrCanvasEdgeCache?.length!==length)src._fdrCanvasEdgeCache={first,length,...internalEdges(src._wallTriangles)};
      const {shared,paths}=src._fdrCanvasEdgeCache;
      // GetCalcMatrix already includes the camera; replace the inherited Canvas transform.
      g.save();g.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);g.imageSmoothingEnabled=false;const transform=g.getTransform();
      src._fdrCanvasSharedEdges=shared.reduce((n,edges)=>n+edges.filter(Boolean).length,0);
      const affine=t=>!t.uv||whitePatch(t.uv)?null:wallUVAffine(t.points,t.uv,image.width,image.height);
      const affines=src._wallTriangles.map(affine);
      for(let index=0;index<src._wallTriangles.length;index++){
        const t=src._wallTriangles[index],map=affines[index];
        g.globalAlpha=t.alpha*src.alpha*camera.alpha;
        g.beginPath();
        const append=i=>{let clip=expanded(src._wallTriangles[i].points,shared[i],transform);const [a,b,c]=clip;if((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)<0)clip=clip.slice().reverse();g.moveTo(clip[0].x,clip[0].y);g.lineTo(clip[1].x,clip[1].y);g.lineTo(clip[2].x,clip[2].y);g.closePath();};
        append(index);
        if(!t.uv||whitePatch(t.uv)){g.fillStyle='#'+t.color.toString(16).padStart(6,'0');g.fill();continue;}
        if(!map)continue;
        const path=paths[index];
        // Consecutive opaque triangles with the identical texture transform
        // draw once through their union, so their shared diagonal has no AA seam.
        while(path&&index+1<src._wallTriangles.length){
          const next=src._wallTriangles[index+1],nextMap=affines[index+1];
          if(paths[index+1]!==path||next.color!==t.color||next.alpha!==t.alpha||!nextMap||map.some((v,j)=>Math.abs(v-nextMap[j])>1e-7))break;
          append(++index);
        }
        g.save();if(path)g.clip(path);g.clip();g.transform(...map);g.drawImage(wallTintSource(src._wallAtlas,t.color),0,0);g.restore();
      }g.restore();
    };
  }
  global.FDRCastleCanvas={attach};
})(window);
