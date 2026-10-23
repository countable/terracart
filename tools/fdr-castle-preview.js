/* Isolated FDR material/geometry study; no runtime or save changes. */
(async () => {
  await loadGame(); window.Phaser=ReviewPhaser;
  const $=id=>document.getElementById(id), base='/fdr-castle-trial/materials/';
  let rotating=false,revision=0;
  $('rotate').onclick=()=>{rotating=!rotating;$('rotate').textContent=rotating?'Pause':'Rotate';};
  const fixtures=FDRCastleLayout.fixtures;
  // Clip the UV domain at repeats; all inserted vertices remain on the original plane.
  function clip(poly, axis, boundary, greater) {
    const out = [];
    for (let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length], ai=greater?a[axis]>=boundary:a[axis]<=boundary,bi=greater?b[axis]>=boundary:b[axis]<=boundary;
      if(ai)out.push(a);
      if(ai!==bi){const t=(boundary-a[axis])/(b[axis]-a[axis]),p={};for(const k of ['x','y','z','s','t'])p[k]=a[k]+(b[k]-a[k])*t;out.push(p);}
    }return out;
  }
  function surface(faces, poly, slot, normal) {
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
        faces.push({points:[a,b,c],normal,color:0xffffff,flatColor:0xaaa694});
      }
    }
  }
  function prismFaces(points,bottom,top,capped,side=3,cap=2,omitEdges=[],uvOrigin=null){
    const faces=[];
    const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y},0),w=Math.sign(area);
    const origin=uvOrigin||{x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),z:0};
    for(let i=0;top!==bottom&&i<points.length;i++){
      if(omitEdges.includes(i))continue;
      const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);if(!l)continue;
      const uv=(p,z)=>({...p,z,
        // Read the native repeat in positive local coordinates. Opposite
        // wall winding must not mirror the masonry or move its starting row.
        s:(side===3||side===11)?(Math.abs(dx)>=Math.abs(dy)?p.x-origin.x:p.y-origin.y)/16:
          (side===9||side===8||side===2&&l<=16)?(Math.abs(dx)>=Math.abs(dy)?(p.x-Math.min(a.x,b.x))/Math.abs(dx):(p.y-Math.min(a.y,b.y))/Math.abs(dy)):(p.x*dx/l+p.y*dy/l)/16,
        t:[2,8,9,10,11].includes(side)?(top-z)/(top-bottom):((origin.z||0)-z)/16});
      surface(faces,[uv(a,bottom),uv(b,bottom),uv(b,top),uv(a,top)],side,{x:dy/l*w,y:-dx/l*w});
    }
    const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),wX=Math.max(...points.map(p=>p.x))-minX,wY=Math.max(...points.map(p=>p.y))-minY,normalizedCap=cap===8&&!uvOrigin?.repeatCap,stone=normalizedCap||(cap===2&&wX<=16&&wY<=16);
    const capUV=p=>{const a=points[0],b=points[1],d=points[points.length-1],ux=b.x-a.x,uy=b.y-a.y,vx=d.x-a.x,vy=d.y-a.y;return {s:((p.x-a.x)*ux+(p.y-a.y)*uy)/(ux*ux+uy*uy),t:((p.x-a.x)*vx+(p.y-a.y)*vy)/(vx*vx+vy*vy)};};
    if(capped)for(const tri of PolygonGeometry.triangulate(points))surface(faces,tri.map(p=>({...p,z:top,s:normalizedCap?capUV(p).s:stone?(p.x-minX)/wX:cap===4?(p.x-minX)/16:(cap===7||cap===12)?(p.x-minX)/8:p.x/16,t:normalizedCap?capUV(p).t:stone?(p.y-minY)/wY:(cap===7||cap===12)?(p.y-minY)/16:cap===4?(p.y-minY)/16:cap===10?(p.y-minY)/wY:p.y/16})),cap,null);
    return faces;
  }
  const rectangle=(x,y,w,h)=>[{x:x-w/2,y:y-h/2},{x:x+w/2,y:y-h/2},{x:x+w/2,y:y+h/2},{x:x-w/2,y:y+h/2}];
  function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
  function fits(x,y,w,h,ring){
    const box=rectangle(x,y,w,h);
    if(!box.every(p=>inside(p,ring)))return false;
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const touches=(a,b,c,d)=>{
      if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||Math.max(a.y,b.y)<Math.min(c.y,d.y)||Math.max(c.y,d.y)<Math.min(a.y,b.y))return false;
      return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
    };
    // Corners alone can bridge a concave notch. Reject any boundary crossing
    // (including contact), preserving the clearance encoded in w/h.
    for(let i=0;i<ring.length;i++)for(let j=0;j<4;j++)if(touches(ring[i],ring[(i+1)%ring.length],box[j],box[(j+1)%4]))return false;
    return true;
  }
  function atlas(scene,palette,active){
    const key='fdr-atlas-'+palette+'-'+active;if(scene.textures.exists(key))return scene.textures.get(key);
    const tex=scene.textures.createCanvas(key,512,512),ctx=tex.getContext();ctx.drawImage(WallMaterials.prepare(scene).getSourceImage(),0,0);ctx.imageSmoothingEnabled=false;
    // Eight-pixel gutters support Canvas seam coverage without sampling another slot.
    // The 112px content region is an integer 7x scale of a native 16px tile.
    const names={2:palette+'-cap',3:palette+'-wall',4:palette+'-floor',5:palette+'-door',6:'window',7:palette+'-side-coping',8:palette+'-merlon-top',9:palette+'-merlon-face',10:palette+'-rim',11:palette+'-base',12:palette+'-right-coping'};
    for(const [slot,name] of Object.entries(names)){const x=slot%4*128,y=Math.floor(slot/4)*128;ctx.clearRect(x,y,128,128);ctx.drawImage(scene.textures.get('fdr-'+name).getSourceImage(),x+8,y+8,112,112);
      if(!active){ctx.globalCompositeOperation='source-atop';ctx.fillStyle='rgba(27,35,27,.25)';ctx.fillRect(x+8,y+8,112,112);ctx.globalCompositeOperation='source-over';}
      // Repeated surfaces need opposite-edge texels in their gutters; clamping
      // would smear the edge colour into the neighbouring repeat during coverage.
      const wrapX=[3,4,10].includes(+slot),wrapY=[3,4].includes(+slot);
      ctx.drawImage(tex.getSourceImage(),x+8,y+(wrapY?112:8),112,wrapY?8:1,x+8,y,112,8);
      ctx.drawImage(tex.getSourceImage(),x+8,y+(wrapY?8:119),112,wrapY?8:1,x+8,y+120,112,8);
      ctx.drawImage(tex.getSourceImage(),x+(wrapX?112:8),y,wrapX?8:1,128,x,y,8,128);
      ctx.drawImage(tex.getSourceImage(),x+(wrapX?8:119),y,wrapX?8:1,128,x+120,y,8,128);
    }tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return tex;
  }
  function rebuild(){
    for(const p of this.panels){p.root.destroy(true);p.label.destroy();}this.panels=[];revision++;
    const active=true,family='citadel',palette=$('palette').value,shape=$('shape')?.value||'rectangle',points=fixtures[shape].map(([x,y])=>({x,y})),layout=shape==='rectangle'?null:FDRCastleLayout.build(shape,ring=>PolygonGeometry.triangulate(ring)),style=buildingBackgroundMaterial(CastleStyles.get(family,active));
    for(let candidate=0;candidate<2;candidate++){
      const cx=315+candidate*630,root=this.add.container(cx,330),label=this.add.text(cx,28,candidate?(layout?'3D · '+shape+' footprint':'3D · matching FDR proportions'):(layout?'Plan · actual footprint and placements':'2D · assembled native FDR tiles'),{fontSize:'20px',color:candidate?'#ddcc96':'#bdc9bb'}).setOrigin(.5,0);
      const scene={_headingUp:true,depth:0,mapRot:0,add:this.add,textures:this.textures,buildingWallContainer:root},group=WallPerspective.begin(scene,'study'),sprites=[],towers=[];let keep=null;
      if(!candidate){
        if(layout){
          const plan=this.add.graphics();root.add(plan);plan.fillStyle(0x414c41);plan.fillPoints(points,true);plan.lineStyle(1,0xb7c5a3);plan.strokePoints(points,true);
          plan.fillStyle(0xa5a38b);for(const wall of layout.walls)plan.fillPoints(wall.points,true);
          plan.fillStyle(0xdbc79b);for(const tower of layout.towers)plan.fillPoints(tower.points,true);
          if(layout.keep){plan.fillStyle(0xa9be9b);plan.fillPoints(layout.keep.points,true);plan.lineStyle(1,0x6f9065);plan.strokePoints(layout.keep.clearance,true);}
        }else{const reference=this.add.image(0,-20,'assembled-'+palette);root.add(reference);}
        this.panels.push({root,label,scene,group,sprites:[],candidate:false,towers:[],keep:null});continue;
      }
      if(candidate)group.atlas=atlas(this,palette,active);
      const colors={face:style.stone.FACE,top:style.stone.BODY,dark:style.stone.DARK};
      const prism=(ring,bottom,top,side=3,cap=2,support=null,capped=true,omitEdges=[],uvOrigin=null)=>WallPerspective.prism(scene,'study',ring,bottom,top,colors,support,capped,candidate?{materialFaces:prismFaces(ring,bottom,top,capped,side,cap,omitEdges,uvOrigin)}:{});
      if(candidate){
        const key='fdr-floor-'+shape+'-'+palette+'-'+active;
        if(!this.textures.exists(key)){const fw=layout?320:220,fh=layout?240:180,texture=this.textures.createCanvas(key,fw,fh),ctx=texture.getContext();ctx.imageSmoothingEnabled=false;ctx.translate(fw/2,fh/2);ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.clip();const tile=document.createElement('canvas');tile.width=tile.height=16;const ink=tile.getContext('2d');ink.imageSmoothingEnabled=false;ink.drawImage(this.textures.get('fdr-'+palette+'-floor').getSourceImage(),0,0,16,16);const pattern=ctx.createPattern(tile,'repeat');pattern.setTransform(new DOMMatrix().translate(-100,-80));ctx.fillStyle=pattern;ctx.fillRect(-fw/2,-fh/2,fw,fh);if(!active){ctx.fillStyle='rgba(27,35,27,.25)';ctx.fillRect(-fw/2,-fh/2,fw,fh);}texture.refresh();texture.setFilter(Phaser.Textures.FilterMode.NEAREST);}
        root.addAt(this.add.image(0,0,key),0);
      }
      else {const floor=this.add.graphics();floor.fillStyle(style.floor);floor.fillPoints(points,true);root.addAt(floor,0);}
      // Curtains stop at tower boundaries: no full wall passes through a tower.
      const curtains=[{a:{x:-56,y:-80},b:{x:56,y:-80}}, {a:{x:100,y:-36},b:{x:100,y:36}}, {a:{x:56,y:80},b:{x:-56,y:80}}, {a:{x:-100,y:36},b:{x:-100,y:-36}}];
      const wallFootprints=[],merlons=[];
      if(layout){
        for(const wall of layout.walls){
          const ring=wall.points,support={x:ring.reduce((n,p)=>n+p.x,0)/ring.length,y:ring.reduce((n,p)=>n+p.y,0)/ring.length,order:group.blocks.length};
          // Clipped fragments retain every exposed side, including bevel joins.
          prism(ring,0,22,3,10,support,false,wall.omitEdges,{x:-100,y:-80,z:24});prism(ring,22,24,10,8,support,true,wall.omitEdges,{repeatCap:true});
          wallFootprints.push(ring);
        }
        for(const merlon of layout.merlons){prism(merlon.points,24,32,9,8);merlons.push({...merlon,kind:'curtain',run:merlon.edge,gap:8});}
      }else for(let i=0;i<curtains.length;i++){
        const {a,b}=curtains[i],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l;
        const strip=(lo,hi,thickness=8)=>[{x:a.x+dx*lo,y:a.y+dy*lo},{x:a.x+dx*hi,y:a.y+dy*hi},{x:a.x+dx*hi+nx*thickness,y:a.y+dy*hi+ny*thickness},{x:a.x+dx*lo+nx*thickness,y:a.y+dy*lo+ny*thickness}];
        wallFootprints.push(strip(0,1));
        const n=Math.ceil(l/16),parts=[];
        for(let j=0;j<n;j++){
          const body=strip(j/n,(j+1)/n),support={x:(body[0].x+body[2].x)/2,y:(body[0].y+body[2].y)/2,order:group.blocks.length};
          // The body cap is covered by coping. End faces meet another
          // curtain section or a tower, so they are internal, never visible.
          prism(body,0,22,3,10,support,false,[1,3],{x:-100,y:-80,z:24});prism(body,22,24,10,i%2?7:10,support,true,[1,3]);parts.push({support,body});
        }
        if(i===2){
          const faces=[];surface(faces,[{x:24,y:80.05,z:0,s:1,t:1},{x:-24,y:80.05,z:0,s:0,t:1},{x:-24,y:80.05,z:24,s:0,t:0},{x:24,y:80.05,z:24,s:1,t:0}],5,{x:0,y:1});
          // Door is a separate retained surface, supported at the actual gate.
          const gate=rectangle(0,79.99,48,.02);WallPerspective.prism(scene,'study',gate,0,24,colors,{x:0,y:80.05,order:group.blocks.length},false,{materialFaces:faces});
        }
        // Earned geometry: 8px solid merlons alternate with 8px open
        // crenels, standing 8px above the coping on every curtain direction.
        const count=Math.floor(l/16),first=(l-(count-1)*16)/2;
        for(let j=0;j<count;j++){
          const distance=first+j*16,x=a.x+dx*distance/l+nx*4,y=a.y+dy*distance/l+ny*4;
          const footprint=rectangle(x,y,8,8);
          prism(footprint,24,32,9,8,parts[Math.min(parts.length-1,Math.floor(distance/l*n))].support);
          merlons.push({kind:'curtain',run:i,points:footprint,rim:strip(0,1),base:24,top:32,rimTop:24,gap:8});
        }

      }
      // A single support anchor keeps each tower's stacked bands, roof and crown together.
      function mass(x,y,w,h,height,isKeep){
        const support={x,y,order:group.blocks.length},body=rectangle(x,y,w,h);
        prism(rectangle(x,y,w,h),0,8,11,10,support,false);
        prism(body,8,height-2,3,10,support,false);
        prism(rectangle(x,y,w,h),height-2,height,3,4,support);
        // Roof coping occupies its native 8px strip at roof level. A merlon
        // consists of one 4px top and one 4px face, not two copies of a sprite.
        const roofBlock=group.blocks[group.blocks.length-1];
        for(const side of [-1,1]){
          // Emit coping after the floor on the same roof block. Separate
          // coplanar slabs can sort behind the full cap and lose their trim.
          roofBlock.materialFaces.push(...prismFaces(rectangle(x+side*(w/2-4),y,8,h),height,height,true,10,side>0?12:7));
          roofBlock.materialFaces.push(...prismFaces(rectangle(x,y+side*(h/2-4),w-16,8),height,height,true,10,10));
        }
        for(const row of [-h/2+4,h/2-6])for(let j=0;j<w/16;j++){
          const tx=x-w/2+8+j*16,ty=y+row;
          const footprint=rectangle(tx,ty,10,4);
          prism(footprint,height,height+4,9,8,support);
          merlons.push({kind:isKeep?'keep':'tower',points:footprint,rim:rectangle(x,y+(row<0?-h/2+4:h/2-4),w,8),base:height,rimTop:height});
        }
        // Decals are actual world-space planes attached to four sides, never billboards.
        const details=[];
        for(let i=0;i<4;i++){
          if(!isKeep||i!==2)continue;
          const a=body[i],b=body[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=dy/l,ny=-dx/l,mx=(a.x+b.x)/2+nx*.04,my=(a.y+b.y)/2+ny*.04;
          const door=isKeep&&i===2,width=door?48:12,z0=door?0:height*.38,z1=door?32:height*.38+16;
          const poly=[{x:mx-dx/l*width/2,y:my-dy/l*width/2,z:z0,s:0,t:1},{x:mx+dx/l*width/2,y:my+dy/l*width/2,z:z0,s:1,t:1},{x:mx+dx/l*width/2,y:my+dy/l*width/2,z:z1,s:1,t:0},{x:mx-dx/l*width/2,y:my-dy/l*width/2,z:z1,s:0,t:0}];surface(details,poly,door?5:6,{x:nx,y:ny});
        }
        // Attach details to body faces so nearer masonry still occludes them naturally.
        const block=group.blocks.find(b=>b.points===body);block.materialFaces.push(...details);
        return {x,y,width:w,depth:h,height:height+4};
      }
      if(layout){
        for(const t of layout.towers)towers.push(mass(t.x,t.y,t.width,t.depth,t.height,false));
        if(layout.keep){const k=layout.keep;keep=mass(k.x,k.y,k.width,k.depth,k.height,true);}
      }else{for(const x of [-80,80])for(const y of [-60,60])towers.push(mass(x,y,48,48,32,false));keep=mass(0,0,80,64,48,true);}
      WallPerspective.finish(scene,'study');FDRCanvasReviewAdapter.attach(group.gfx);this.panels.push({root,label,scene,group,sprites,candidate:!!candidate,towers,keep,wallFootprints,merlons,layout});
    }
    window.fdrGeometryAudit={revision,projectionNote:'Native crown top and face are mapped separately. This is a geometric reconstruction, not pixel-identical at rotated headings.',shape,layout,palette,condition:'restored',family,panels:this.panels.map(p=>({candidate:p.candidate,layout:p.layout||null,blocks:p.group.blocks.length,materialTriangles:p.group.blocks.reduce((n,b)=>n+(b.materialFaces?.length||0),0),billboards:p.sprites.length,curtainFootprints:p.wallFootprints||[],merlons:p.merlons||[],towers:p.towers,keep:p.keep,towerPlacementValid:!layout||layout.validity.towersStraddleWalls,allMassesInside:[...p.towers,...(p.keep?[p.keep]:[])].every(t=>layout?FDRCastleLayout.contains(rectangle(t.x,t.y,t.width,t.depth),points):fits(t.x,t.y,t.width,t.depth,rectangle(0,0,214,174))),keepInsideCourtyard:!p.keep||fits(p.keep.x,p.keep.y,p.keep.width,p.keep.depth,points)}))};
    $('audit').textContent=JSON.stringify(window.fdrGeometryAudit,null,2);$('status').textContent='Ready · '+(this.game.renderer.type===2?'WebGL':'Canvas')+' · '+this.panels[1].towers.length+' geometry towers · '+(this.panels[1].keep?'central keep':'keep off / insufficient clearance');
  }
  window.fdrGeometryGame=new Phaser.Game({type:new URLSearchParams(location.search).has('canvas')?Phaser.CANVAS:Phaser.WEBGL,width:1260,height:640,parent:'game',backgroundColor:'#18231f',pixelArt:true,scene:{
    preload(){for(const name of ['cool-wall','warm-wall','cool-cap','warm-cap','cool-floor','warm-floor','warm-door','cool-door','window','warm-side-coping','cool-side-coping','warm-rim','cool-rim','warm-base','cool-base','warm-right-coping','cool-right-coping','warm-merlon-top','cool-merlon-top','warm-merlon-face','cool-merlon-face'])this.load.image('fdr-'+name,base+name+'.png');for(const palette of ['warm','cool'])this.load.image('assembled-'+palette,'/fdr-castle-trial/assembled-'+palette+'.png');},
    create(){this.panels=[];this.rebuild=rebuild.bind(this);window.fdrGeometryScene=this;for(const id of ['palette','shape'])if($(id))$(id).onchange=()=>this.rebuild();this.rebuild();window.ready=true;},
    update(t,dt){if(rotating)$('angle').value=(+$('angle').value+dt*.025)%360;const angle=+$('angle').value*Math.PI/180;$('heading').textContent=$('angle').value+'°';for(const p of this.panels||[]){p.scene.mapRot=p.candidate?angle:0;p.root.setRotation(p.candidate?angle:0).setScale(+$('zoom').value);for(const sprite of p.sprites)sprite.setRotation(-angle);WallPerspective.update(p.scene);}}
  }});
})().catch(error=>{document.getElementById('status').textContent=error.stack;console.error(error);});
