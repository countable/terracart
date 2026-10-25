// Retained square castle meshes. Cel colours and sparse pixel marks share one
// preloaded atlas; rebuilding never reads pixels or tessellates individual bricks.
(function(global){
  const ATLAS_KEY='fdr_castle_atlas',BASE_HEIGHT=4;
  const WHITE_UV=[[498/512,498/512],[502/512,498/512],[502/512,502/512]];
  function triangle(faces,points,color,normal,material){
    faces.push({points:points.map((p,i)=>({...p,u:p.u??WHITE_UV[i][0],v:p.v??WHITE_UV[i][1]})),normal,color,flatColor:color,material});
  }
  function polygon(faces,points,color,normal,material){
    for(let i=1;i+1<points.length;i++)triangle(faces,[points[0],points[i],points[i+1]],color,normal,material);
  }
  function draw(scene,source,points,options={}){
    const group=scene._wallPerspective?.[source];
    if(!group||!scene.textures?.exists(ATLAS_KEY))return null;
    const style=CastleStyles.renderStyle(options.family||'citadel',options.active!==false),geometry=style.geometry;
    const layout=FDRCastleLayout.build(points,{...options,...geometry,sectionLength:64});if(!layout)return null;
    const atlas=scene.textures.get(ATLAS_KEY);atlas.setFilter?.(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);group.atlas=atlas;
    const start=group.blocks.length,rect=FDRCastleLayout.rect;
    const colors={face:style.wall,top:style.top,dark:style.base};
    const damagedEdge=i=>!style.active&&i%4===1;
    const sideColor=normal=>Math.abs(normal.x)>.5?style.side:style.wall;
    function prism(ring,bottom,top,support=null,{capped=true,omitEdges=[],topPoints=ring,material='stone'}={}){
      if(!WallPerspective.inView(scene,ring,bottom,top))return null;
      const faces=[],winding=Math.sign(FDRCastleLayout.area(ring));
      if(top>bottom)for(let i=0;i<ring.length;i++){
        if(omitEdges.includes(i))continue;
        const a=ring[i],b=ring[(i+1)%ring.length],aa=topPoints[i],bb=topPoints[(i+1)%ring.length];
        const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),normal={x:dy/length*winding,y:-dx/length*winding};
        const levels=bottom<BASE_HEIGHT&&top>BASE_HEIGHT?[bottom,BASE_HEIGHT,top]:[bottom,top];
        const at=(p,q,z)=>({x:p.x+(q.x-p.x)*(z-bottom)/(top-bottom),y:p.y+(q.y-p.y)*(z-bottom)/(top-bottom),z});
        for(let j=0;j<levels.length-1;j++){
          const lo=levels[j],hi=levels[j+1],color=hi<=BASE_HEIGHT?style.base:sideColor(normal);
          const quad=[at(a,aa,lo),at(b,bb,lo),at(b,bb,hi),at(a,aa,hi)];
          if(lo>=BASE_HEIGHT&&material==='stone')for(const p of quad){
            const along=((p.x-a.x)*dx+(p.y-a.y)*dy)/length;
            p.u=(136+Math.min(1,Math.max(0,along/64))*112)/512;
            p.v=(392+Math.min(1,Math.max(0,(top-p.z)/64))*112)/512;
          }
          polygon(faces,quad,color,normal,material);
        }
      }
      if(capped)for(const tri of PolygonGeometry.triangulate(topPoints))
        triangle(faces,tri.map(p=>({...p,z:top})),style.top,null,material);
      const index=group.blocks.length;
      WallPerspective.prism(scene,source,ring,bottom,top,colors,support,capped,{topPoints,materialFaces:faces});
      return group.blocks[index]||null;
    }
    // All curtain fragments and teeth on one edge share the edge's sort anchor.
    // A later body cannot paint over its own crown when the camera turns.
    const supports=layout.points.map((a,i)=>{
      const b=layout.points[(i+1)%layout.points.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);
      return {x:(a.x+b.x)/2-dy/l*4,y:(a.y+b.y)/2+dx/l*4,order:start+i};
    });
    for(const wall of layout.walls){
      const top=geometry.wallHeight-(damagedEdge(wall.edge)?4:0);
      prism(wall.points,0,top,supports[wall.edge],{omitEdges:wall.omitEdges});
    }
    for(let i=0;i<layout.merlons.length;i++){
      const m=layout.merlons[i];
      if(damagedEdge(m.edge)||!style.active&&i%3===1)continue;
      prism(m.points,m.base,m.top,supports[m.edge]);
    }
    function decal(block,a,b,z0,z1,color,material){
      const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),normal={x:dy/l,y:-dx/l};
      const offset=p=>({x:p.x+normal.x*.08,y:p.y+normal.y*.08});
      a=offset(a);b=offset(b);
      polygon(block.materialFaces,[{...a,z:z0},{...b,z:z0},{...b,z:z1},{...a,z:z1}],color,normal,material);
    }
    function feature(block,body,side,width,z0,z1,color,material,shift=0){
      const a=body[side],b=body[(side+1)%4],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),cx=(a.x+b.x)/2+dx/l*shift,cy=(a.y+b.y)/2+dy/l*shift;
      decal(block,{x:cx-dx/l*width/2,y:cy-dy/l*width/2},{x:cx+dx/l*width/2,y:cy+dy/l*width/2},z0,z1,color,material);
    }
    function mass(part,isKeep,index){
      const {x,y,width:w,depth:h}=part;
      if(!style.active&&index%3===1)part.height-=4;
      const height=part.height,support={x,y,order:group.blocks.length};
      const body=rect(x,y,w,h);
      part.crownHeight=height+(geometry.roofHeight||4);
      // The shaft fills the same square used to clip adjoining curtains.
      // Insetting it above a wider plinth leaves vertical slots at those joins.
      const shaft=prism(body,0,height,support);if(!shaft)return;
      if(geometry.roofHeight){
        const peak={x,y,z:height+geometry.roofHeight};
        // Four roof triangles restored, two large surviving planes in a wreck.
        // The flat cap below closes the missing portion; there are no rafters.
        for(let i=0;i<4;i++){
          if(!style.active&&(i+index)%4<2)continue;
          const a=body[i],b=body[(i+1)%4],color=i===0||i===3?style.roof:style.roofSide;
          triangle(shaft.materialFaces,[{...a,z:height},{...b,z:height},peak],color,null,'roof');
        }
      }else{
        const step=w/3;
        for(const side of [-1,1])for(let j=0;j<3;j++){
          if(!style.active&&(j+index)%3===1)continue;
          prism(rect(x-w/2+step*(j+.5),y+side*(h/2-3),8,6),height,height+4,support);
        }
      }
      if(isKeep){
        // Closed iron doors are flat wall decals. No banner can cover this face.
        const width=Math.min(22,w-12),doorHeight=Math.min(25,height-8);
        feature(shaft,body,2,width,0,doorHeight,style.door,'door');
        feature(shaft,body,2,1,0,doorHeight,style.base,'door-seam');
        for(const shift of [-3,3])feature(shaft,body,2,2,doorHeight*.43,doorHeight*.43+2,style.top,'door-handle',shift);
      }else for(let side=0;side<4;side++){
        feature(shaft,body,side,3,height*.43,height*.43+8,style.door,'window');
        if(style.id==='citadel'){
          feature(shaft,body,side,8,8,height-6,style.accent,'banner',-7);
          feature(shaft,body,side,2,16,height-10,style.top,'banner-mark',-7);
        }
      }
    }
    layout.towers.forEach((t,i)=>mass(t,false,i));if(layout.keep)mass(layout.keep,true,0);
    const footprints=[layout.points,...layout.towers.map(t=>t.points)].flat(),bounds={left:Math.min(...footprints.map(p=>p.x)),right:Math.max(...footprints.map(p=>p.x)),top:Math.min(...footprints.map(p=>p.y)),bottom:Math.max(...footprints.map(p=>p.y))};
    const height=Math.max(geometry.wallHeight+8,...layout.towers.map(t=>t.crownHeight||t.height+geometry.roofHeight),layout.keep?(layout.keep.crownHeight||layout.keep.height+geometry.roofHeight):0);
    return {layout,footprint:layout.points,bounds,height,blocksAdded:group.blocks.length-start,source,family:style.id,active:style.active,style};
  }
  global.FDRCastleGeometry={ATLAS_KEY,draw};
})(globalThis);
