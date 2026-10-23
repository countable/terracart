// Textured castle prisms on the shared retained WallPerspective renderer.
// The atlas is prebuilt and preloaded: cell rebuilds never read/create textures.
(function(global){
  const ATLAS_KEY='fdr_castle_atlas',LOWER_SHADE=0.78;
  // Clip the UV domain at repeats; all inserted vertices remain on the original plane.
  function clip(poly, axis, boundary, greater) {
    const out = [];
    for (let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length], ai=greater?a[axis]>=boundary:a[axis]<=boundary,bi=greater?b[axis]>=boundary:b[axis]<=boundary;
      if(ai)out.push(a);
      if(ai!==bi){const t=(boundary-a[axis])/(b[axis]-a[axis]),p={};for(const k of ['x','y','z','s','t'])p[k]=a[k]+(b[k]-a[k])*t;p[axis]=boundary;out.push(p);}
    }return out;
  }
  function surface(faces, poly, slot, normal, shadeAt=null) {
    // One discontinuity in world elevation per structure, independent of its
    // body/base/coping prisms and of camera heading. UV interpolation keeps
    // the brick repeat continuous through the shade boundary.
    const minZ=Math.min(...poly.map(p=>p.z)),maxZ=Math.max(...poly.map(p=>p.z));
    if(normal&&shadeAt!=null&&minZ<shadeAt&&maxZ>shadeAt){
      surface(faces,clip(poly,'z',shadeAt,false),slot,normal,shadeAt);
      surface(faces,clip(poly,'z',shadeAt,true),slot,normal);
      return;
    }
    const shade=normal&&shadeAt!=null&&maxZ<=shadeAt?LOWER_SHADE:1;
    const minS=Math.floor(Math.min(...poly.map(p=>p.s))),maxS=Math.ceil(Math.max(...poly.map(p=>p.s)));
    const minT=Math.floor(Math.min(...poly.map(p=>p.t))),maxT=Math.ceil(Math.max(...poly.map(p=>p.t)));
    for(let s=minS;s<maxS;s++)for(let t=minT;t<maxT;t++){
      let ring=clip(clip(poly,'s',s,true),'s',s+1,false);ring=clip(clip(ring,'t',t,true),'t',t+1,false);
      ring=ring.map(p=>({x:p.x,y:p.y,z:p.z,u:(slot%4*128+8+(p.s-s)*112)/512,v:(Math.floor(slot/4)*128+8+(p.t-t)*112)/512}));
      for(let j=1;j+1<ring.length;j++){
        const a=ring[0],b=ring[j],c=ring[j+1],ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
        // UV clipping can repeat a vertex at a tile boundary. Those triangles
        // have no area and add no pixels; discard them once at build time.
        if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)<1e-8)continue;
        faces.push({points:[a,b,c],normal,shade,color:0xffffff,flatColor:0xaaa694});
      }
    }
  }
  function prismFaces(points,bottom,top,capped,side=3,cap=2,omitEdges=[],uvOrigin=null,shadeAt=null){
    const faces=[];
    const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y},0),w=Math.sign(area);
    const origin={x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),z:0,...uvOrigin};
    for(let i=0;top!==bottom&&i<points.length;i++){
      if(omitEdges.includes(i))continue;
      const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);if(!l)continue;
      const repeat=Math.max(16,l/32);
      const uv=(p,z)=>({...p,z,
        // Read the native repeat in positive local coordinates. Opposite
        // wall winding must not mirror the masonry or move its starting row.
        s:(side===3||side===11)?(Math.abs(dx)>=Math.abs(dy)?p.x-origin.x:p.y-origin.y)/repeat:
          (side===9||side===8||side===2&&l<=16)?(Math.abs(dx)>=Math.abs(dy)?(p.x-Math.min(a.x,b.x))/Math.abs(dx):(p.y-Math.min(a.y,b.y))/Math.abs(dy)):((p.x-origin.x)*dx/l+(p.y-origin.y)*dy/l)/repeat,
        t:[2,8,9,10,11].includes(side)?(top-z)/(top-bottom):((origin.z||0)-z)/16});
      surface(faces,[uv(a,bottom),uv(b,bottom),uv(b,top),uv(a,top)],side,{x:dy/l*w,y:-dx/l*w},shadeAt);
    }
    const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),wX=Math.max(...points.map(p=>p.x))-minX,wY=Math.max(...points.map(p=>p.y))-minY,normalizedCap=cap===8&&!uvOrigin?.repeatCap,stone=normalizedCap||(cap===2&&wX<=16&&wY<=16);
    const capRepeat=Math.max(16,wX/32,wY/32);
    const capUV=p=>{const a=points[0],b=points[1],d=points[points.length-1],ux=b.x-a.x,uy=b.y-a.y,vx=d.x-a.x,vy=d.y-a.y;return {s:((p.x-a.x)*ux+(p.y-a.y)*uy)/(ux*ux+uy*uy),t:((p.x-a.x)*vx+(p.y-a.y)*vy)/(vx*vx+vy*vy)};};
    if(capped)for(const tri of PolygonGeometry.triangulate(points))surface(faces,tri.map(p=>({...p,z:top,s:normalizedCap?capUV(p).s:stone?(p.x-minX)/wX:cap===4?(p.x-minX)/16:(cap===7||cap===12)?(p.x-minX)/8:(p.x-origin.x)/capRepeat,t:normalizedCap?capUV(p).t:stone?(p.y-minY)/wY:(cap===7||cap===12)?(p.y-minY)/16:cap===4?(p.y-minY)/16:cap===10?(p.y-minY)/wY:(p.y-origin.y)/capRepeat})),cap,null);
    return faces;
  }

  function tintFor(options){
    if(options.tint!=null)return options.tint;
    const neutral=CastleStyles.get('citadel',true).stone.BODY,color=CastleStyles.get(options.family||'citadel',options.active!==false).stone.BODY;
    let tint=0;for(const shift of [16,8,0])tint|=Math.round(255*Math.min(1,((color>>shift)&255)/((neutral>>shift)&255)))<<shift;
    return tint;
  }
  function draw(scene,source,points,options={}){
    const group=scene._wallPerspective?.[source];
    if(!group||!scene.textures?.exists(ATLAS_KEY))return null;
    const layout=FDRCastleLayout.build(points,options);if(!layout)return null;
    const atlas=scene.textures.get(ATLAS_KEY);atlas.setFilter?.(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);group.atlas=atlas;
    const tint=tintFor(options),broken=CastleStyles.get(options.family||'citadel',true).rampart.broken,start=group.blocks.length;
    const rect=FDRCastleLayout.rect,colors={face:0xa99e8b,top:0xc6baa4,dark:0x615b50};
    function paint(faces){
      for(const face of faces){let color=0;for(const shift of [16,8,0])color|=Math.round(((tint>>shift)&255)*(face.shade??1))<<shift;face.color=color;}
      return faces;
    }
    function prism(ring,bottom,top,side=3,cap=2,support=null,capped=true,omitEdges=[],uvOrigin=null,shadeAt=null){
      if(!WallPerspective.inView(scene,ring,bottom,top))return null;
      const faces=paint(prismFaces(ring,bottom,top,capped,side,cap,omitEdges,uvOrigin,shadeAt));
      WallPerspective.prism(scene,source,ring,bottom,top,colors,support,capped,{materialFaces:faces});
      return group.blocks[group.blocks.length-1];
    }
    const curtainHeight=24,origin={x:layout.points[0].x,y:layout.points[0].y,z:curtainHeight};
    // Keep a curtain's clipped body pieces below all of its crowns. Sorting
    // each fragment/tooth by its own centre lets a later cap erase the tooth
    // beside it, especially when the wall points toward the camera.
    const supports=layout.points.map((a,i)=>{
      const b=layout.points[(i+1)%layout.points.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);
      return {x:(a.x+b.x)/2-dy/l*4,y:(a.y+b.y)/2+dx/l*4,order:group.blocks.length+i};
    });
    for(const wall of layout.walls){
      const ring=wall.points,support=supports[wall.edge];
      prism(ring,0,curtainHeight-2,3,10,support,false,wall.omitEdges,origin,curtainHeight/2);
      prism(ring,curtainHeight-2,curtainHeight,10,8,support,true,wall.omitEdges,{repeatCap:true});
    }
    for(let i=0;i<layout.merlons.length;i++){if(broken&&i%4===2)continue;const m=layout.merlons[i];prism(m.points,m.base,m.top,9,8,supports[m.edge]);}
    function mass(part,isKeep){
      const {x,y,width:w,depth:h,height}=part,support={x,y,order:group.blocks.length},body=rect(x,y,w,h);
      if(!WallPerspective.inView(scene,body,0,height+4))return;
      prism(body,0,8,11,10,support,false,[],null,height/2);
      const shaft=prism(body,8,height-2,3,10,support,false,[],null,height/2);
      const roof=prism(body,height-2,height,3,4,support);
      if(roof)for(const side of [-1,1]){
        const faces=[...prismFaces(rect(x+side*(w/2-4),y,8,h),height,height,true,10,side>0?12:7),...prismFaces(rect(x,y+side*(h/2-4),w-16,8),height,height,true,10,10)];
        roof.materialFaces.push(...paint(faces));
      }
      for(const row of [-h/2+4,h/2-6])for(let j=0;j<w/16;j++){
        if(broken&&j%4===2)continue;
        prism(rect(x-w/2+8+j*16,y+row,10,4),height,height+4,9,8,support);
      }
      if(isKeep&&shaft){
        const faces=[],width=Math.min(48,w-8),front=y+h/2+.04;
        surface(faces,[{x:x-width/2,y:front,z:0,s:0,t:1},{x:x+width/2,y:front,z:0,s:1,t:1},{x:x+width/2,y:front,z:32,s:1,t:0},{x:x-width/2,y:front,z:32,s:0,t:0}],5,{x:0,y:1},height/2);
        shaft.materialFaces.push(...paint(faces));
      }
    }
    for(const tower of layout.towers)mass(tower,false);if(layout.keep)mass(layout.keep,true);
    const footprints=[layout.points,...layout.towers.map(t=>t.points)].flat(),bounds={left:Math.min(...footprints.map(p=>p.x)),right:Math.max(...footprints.map(p=>p.x)),top:Math.min(...footprints.map(p=>p.y)),bottom:Math.max(...footprints.map(p=>p.y))};
    return {layout,footprint:layout.points,bounds,height:layout.keep?52:layout.towers.length?36:32,blocksAdded:group.blocks.length-start,source};
  }
  global.FDRCastleGeometry={ATLAS_KEY,draw};
})(globalThis);
