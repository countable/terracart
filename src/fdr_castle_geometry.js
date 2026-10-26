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
    const towerBaseOutset=style.id==='bastion'?2:0;
    const layout=FDRCastleLayout.build(points,{...options,...geometry,sectionLength:64,towerBaseOutset});if(!layout)return null;
    const atlas=scene.textures.get(ATLAS_KEY);atlas.setFilter?.(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);group.atlas=atlas;
    const start=group.blocks.length,rect=FDRCastleLayout.rect;
    const colors={face:style.wall,top:style.top,dark:style.base};
    const sideColor=normal=>Math.abs(normal.x)>.5?style.side:style.wall;
    function prism(ring,bottom,top,support=null,{capped=true,omitEdges=[],topPoints=ring,material='stone',deck=false,capColor=style.top,baseOutset=0,exposedEdges=new Set(),stoneSlot=style.masonrySlot,growthSeed=null}={}){
      if(!WallPerspective.inView(scene,ring,bottom,top))return null;
      const faces=[],winding=Math.sign(FDRCastleLayout.area(ring));
      if(top>bottom)for(let i=0;i<ring.length;i++){
        if(omitEdges.includes(i)&&!exposedEdges.has(i))continue;
        const a=ring[i],b=ring[(i+1)%ring.length],aa=topPoints[i],bb=topPoints[(i+1)%ring.length];
        const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),normal={x:dy/length*winding,y:-dx/length*winding};
        const faceBottom=exposedEdges.has(i)?geometry.wallHeight-8:bottom;
        const levels=faceBottom<BASE_HEIGHT&&top>BASE_HEIGHT?[faceBottom,BASE_HEIGHT,top]:[faceBottom,top];
        const cx=ring.reduce((sum,p)=>sum+p.x/ring.length,0),cy=ring.reduce((sum,p)=>sum+p.y/ring.length,0);
        const at=(p,q,z)=>{
          const t=(z-bottom)/(top-bottom),outset=bottom===0?baseOutset*Math.max(0,1-z/BASE_HEIGHT):0;
          return {x:p.x+(q.x-p.x)*t+Math.sign(p.x-cx)*outset,y:p.y+(q.y-p.y)*t+Math.sign(p.y-cy)*outset,z};
        };
        for(let j=0;j<levels.length-1;j++){
          const lo=levels[j],hi=levels[j+1];
          let color=hi<=BASE_HEIGHT?style.base:sideColor(normal);
          if(!style.active&&lo>=BASE_HEIGHT&&material==='stone'){
            const boost=c=>Math.min(255,Math.round(c*1.5));
            color=(boost(color>>16)<<16)|(boost((color>>8)&255)<<8)|boost(color&255);
          }
          const quad=[at(a,aa,lo),at(b,bb,lo),at(b,bb,hi),at(a,aa,hi)];
          if(lo>=BASE_HEIGHT&&material==='stone')for(const p of quad){
            const along=((p.x-a.x)*dx+(p.y-a.y)*dy)/length;
            const slot=stoneSlot;
            // Ground-anchored courses keep their physical size on every
            // shaft and wall. Repeated tile copies preserve source-edge phase
            // through clipped wall fragments without splitting triangles.
            const origin=layout.points[0];
            const growthShift=growthSeed===null?0:((growthSeed+i)%4)*32;
            const phase=((((a.x-origin.x)*dx+(a.y-origin.y)*dy)/length+growthShift)%128+128)%128;
            const span=Math.max(224,phase+length);
            p.u=(slot%4*128+8+Math.min(1,Math.max(0,(phase+along)/span))*112)/512;
            p.v=(Math.floor(slot/4)*128+8+Math.min(1,Math.max(0,1-(p.z-BASE_HEIGHT)/64))*112)/512;
          }
          polygon(faces,quad,color,normal,material);
        }
      }
      if(capped){
        const minX=Math.min(...topPoints.map(p=>p.x)),minY=Math.min(...topPoints.map(p=>p.y));
        const width=Math.max(...topPoints.map(p=>p.x))-minX,depth=Math.max(...topPoints.map(p=>p.y))-minY;
        const coping=bottom>0&&material==='stone';
        const crownSeed=Math.abs(Math.round((minX-layout.points[0].x)*17+(minY-layout.points[0].y)*31))%7;
        const copingLeft=!style.active&&crownSeed<(style.id==='citadel'?1:2)?418:394;
        const a=topPoints[0],b=topPoints[1],length=Math.hypot(b.x-a.x,b.y-a.y);
        const ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
        const local=p=>({u:(p.x-a.x)*ux+(p.y-a.y)*uy,v:-(p.x-a.x)*uy+(p.y-a.y)*ux});
        const coords=coping?topPoints.map(local):[];
        const u0=Math.min(...coords.map(p=>p.u)),u1=Math.max(...coords.map(p=>p.u));
        const v0=Math.min(...coords.map(p=>p.v)),v1=Math.max(...coords.map(p=>p.v));
        const uv=p=>{const q=local(p);return {u:(copingLeft+(q.u-u0)/(u1-u0)*16)/512,v:(488+(q.v-v0)/(v1-v0)*12)/512};};
        for(const tri of PolygonGeometry.triangulate(topPoints))
          triangle(faces,tri.map(p=>({...p,z:top,...(coping?uv(p):deck?{u:(8+(p.x-minX)/width*112)/512,v:(8+(p.y-minY)/depth*112)/512}:{})})),capColor,null,material);
      }
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
    // Track lowered pieces before drawing so adjoining tall pieces expose a
    // small end face above the broken crest rather than a see-through hole.
    const lowered=style.active?[]:layout.walls.filter((wall,i)=>(i+wall.edge*3)%5===1);
    const onBoundary=(p,ring)=>ring.some((a,i)=>{
      const b=ring[(i+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y;
      return Math.abs(dx*(p.y-a.y)-dy*(p.x-a.x))<1e-6
        &&p.x>=Math.min(a.x,b.x)-1e-6&&p.x<=Math.max(a.x,b.x)+1e-6
        &&p.y>=Math.min(a.y,b.y)-1e-6&&p.y<=Math.max(a.y,b.y)+1e-6;
    });
    layout.walls.forEach(wall=>{
      const loss=lowered.includes(wall)?8:0,exposedEdges=new Set();
      if(!loss)for(const edge of wall.omitEdges){
        const a=wall.points[edge],b=wall.points[(edge+1)%wall.points.length],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        if(lowered.some(other=>onBoundary(mid,other.points)))exposedEdges.add(edge);
      }
      prism(wall.points,0,geometry.wallHeight-loss,supports[wall.edge],{omitEdges:wall.omitEdges,exposedEdges});
    });
    for(let i=0;i<layout.merlons.length;i++){
      const m=layout.merlons[i];
      if(!style.active&&(i%3===1||lowered.some(w=>w.edge===m.edge&&FDRCastleLayout.overlap(m.points,w.points))))continue;
      const top=style.active?m.top:m.base+[5,7,8][(Math.floor(i/3)+m.edge)%3];
      prism(m.points,m.base,top,supports[m.edge]);
    }
    function decal(block,a,b,z0,z1,color,material,slot=null,vRange=[0,1],atlasRect=null){
      const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),normal={x:dy/l,y:-dx/l};
      const offset=p=>({x:p.x+normal.x*.08,y:p.y+normal.y*.08});
      a=offset(a);b=offset(b);
      const quad=[{...a,z:z0},{...b,z:z0},{...b,z:z1},{...a,z:z1}];
      if(slot!==null)for(let i=0;i<4;i++){
        quad[i].u=(slot%4*128+8+([0,1,1,0][i])*112)/512;
        quad[i].v=(Math.floor(slot/4)*128+8+(vRange[0]+[1,1,0,0][i]*(vRange[1]-vRange[0]))*112)/512;
      }
      if(atlasRect)for(let i=0;i<4;i++){
        quad[i].u=(atlasRect[0]+[0,1,1,0][i]*atlasRect[2])/512;
        quad[i].v=(atlasRect[1]+[1,1,0,0][i]*atlasRect[3])/512;
      }
      polygon(block.materialFaces,quad,color,normal,material);
    }
    function feature(block,body,side,width,z0,z1,color,material,shift=0,slot=null,vRange=[0,1],atlasRect=null){
      const a=body[side],b=body[(side+1)%4],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),cx=(a.x+b.x)/2+dx/l*shift,cy=(a.y+b.y)/2+dy/l*shift;
      decal(block,{x:cx-dx/l*width/2,y:cy-dy/l*width/2},{x:cx+dx/l*width/2,y:cy+dy/l*width/2},z0,z1,color,material,slot,vRange,atlasRect);
    }
    function mass(part,isKeep,index){
      const {x,y,width:w,depth:h}=part;
      if(!style.active&&index%3===1)part.height-=4;
      const height=part.height,support={x,y,order:group.blocks.length};
      const body=rect(x,y,w,h);
      // Keep the roof pitch proportional to its span, using the same four
      // planes as the tower roofs. A fixed rise made the wide keep look flat.
      const roofRise=geometry.roofHeight?geometry.roofHeight*Math.min(w,h)/geometry.towerWidth:0;
      part.crownHeight=height+(roofRise||8);
      // The shaft fills the same square used to clip adjoining curtains.
      // Insetting it above a wider plinth leaves vertical slots at those joins.
      const shaft=prism(body,0,height,support,{deck:!geometry.roofHeight,capColor:geometry.roofHeight?(style.active?style.roofSide:style.door):style.deck,baseOutset:isKeep?0:towerBaseOutset,stoneSlot:style.towerMasonrySlot,growthSeed:style.active?null:index});if(!shaft)return;
      if(geometry.roofHeight){
        const peak={x,y,z:height+roofRise};
        // Four roof triangles restored, two large surviving planes in a wreck.
        // The flat cap below closes the missing portion; there are no rafters.
        for(let i=0;i<4;i++){
          if(!style.active&&(i+index)%4<2)continue;
          const a=body[i],b=body[(i+1)%4],color=[style.roofBack,style.roof,style.roofSide,style.roofLight][i];
          triangle(shaft.materialFaces,[{...a,z:height,u:8/512,v:376/512},
            {...b,z:height,u:120/512,v:376/512},{...peak,u:64/512,v:264/512}],color,null,'roof');
        }
      }else{
        for(const side of [-1,1])for(let j=0;j<3;j++){
          if(!style.active&&(j+index)%3===1)continue;
          const toothHeight=style.active?8:[5,7,8][(index*2+j+(side>0?2:0))%3];
          prism(rect(x+(j-1)*(w/2-4),y+side*(h/2-3),8,6),height,height+toothHeight,support);
        }
        // One centre tooth on the remaining sides completes a square crown;
        // corner teeth already belong to the front/back rows.
        for(const side of [-1,1]){
          if(!style.active&&(index+(side>0?1:0))%3===1)continue;
          const toothHeight=style.active?8:[5,7,8][(index+(side>0?1:0))%3];
          prism(rect(x+side*(w/2-3),y,6,8),height,height+toothHeight,support);
        }
      }
      if(isKeep){
        // Backed entrance art and flanking heraldry share the existing facade
        // quad; painted open leaves do not change its wall or collision.
        const width=Math.min(22,w-12),doorHeight=Math.min(25,height-8);
        if(style.id==='archive')feature(shaft,body,2,width,0,doorHeight,style.top,'door',0,5);
        else feature(shaft,body,2,w-8,0,height-4,0xffffff,'door',0,null,[0,1],
          [268+(style.active?56:0),12+(style.id==='bastion'?56:0),48,48]);
        const openLeaves=style.id==='citadel'&&style.active;
        feature(shaft,body,2,1,openLeaves?doorHeight*.1:0,openLeaves?doorHeight*.65:doorHeight-3,
          (style.door&0xfefefe)>>1,'door-seam',openLeaves?-4:0);
        for(const shift of openLeaves?[-6,6]:[-3,3])feature(shaft,body,2,2,doorHeight*.43,doorHeight*.43+2,style.top,'door-handle',shift);
      }else for(let side=0;side<4;side++){
        const archive=style.id==='archive';
        const bastion=style.id==='bastion';
        feature(shaft,body,side,4,archive?4:bastion?height-9:height*.43,archive?height-4:bastion?height-3:height*.43+10,
          style.door,'window',bastion||archive?0:4,7,archive?[0,1]:[0,.4]);
        if(style.id!=='archive'){
          const shift=bastion?0:-7,top=height-(bastion?10:4),markCenter=top-7;
          // Cloth and compact heraldry reuse the existing two decal quads.
          // A shared alpha tile cuts the forked hem without extra geometry.
          feature(shaft,body,side,10,6,top,style.accent,'banner',shift,15,[0,.8]);
          feature(shaft,body,side,6,markCenter-3,markCenter+3,style.heraldry,'banner-mark',shift,style.id==='citadel'?1:6);
        }
      }
    }
    layout.towers.forEach((t,i)=>mass(t,false,i));if(layout.keep)mass(layout.keep,true,0);
    const footprints=[layout.points,...layout.towers.map(t=>style.id==='bastion'?rect(t.x,t.y,t.width+4,t.depth+4):t.points)].flat(),bounds={left:Math.min(...footprints.map(p=>p.x)),right:Math.max(...footprints.map(p=>p.x)),top:Math.min(...footprints.map(p=>p.y)),bottom:Math.max(...footprints.map(p=>p.y))};
    const height=Math.max(geometry.wallHeight+8,...layout.towers.map(t=>t.crownHeight||t.height+geometry.roofHeight),layout.keep?(layout.keep.crownHeight||layout.keep.height+geometry.roofHeight):0);
    return {layout,footprint:layout.points,bounds,height,blocksAdded:group.blocks.length-start,source,family:style.id,active:style.active,style};
  }
  global.FDRCastleGeometry={ATLAS_KEY,draw};
})(globalThis);
