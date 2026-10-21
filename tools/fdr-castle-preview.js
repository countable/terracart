/* Isolated FDR material/geometry study; no runtime or save changes. */
(async () => {
  await loadGame(); window.Phaser=ReviewPhaser;
  const $=id=>document.getElementById(id), base='/fdr-castle-trial/materials/';
  let rotating=false,revision=0;
  $('rotate').onclick=()=>{rotating=!rotating;$('rotate').textContent=rotating?'Pause':'Rotate';};
  const fixtures={rectangle:[[-100,-80],[100,-80],[100,80],[-100,80]],concave:[[-100,-80],[100,-80],[100,-20],[20,-20],[20,80],[-100,80]],narrow:[[-100,-26],[100,-26],[100,26],[-100,26]]};
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
      ring=ring.map(p=>({x:p.x,y:p.y,z:p.z,u:(slot%4*128+2+(p.s-s)*124)/512,v:(Math.floor(slot/4)*128+2+(p.t-t)*124)/512}));
      for(let j=1;j+1<ring.length;j++)faces.push({points:[ring[0],ring[j],ring[j+1]],normal,color:0xffffff,flatColor:0xaaa694});
    }
  }
  function prismFaces(points,bottom,top,capped,side=3,cap=2){
    const faces=[];
    const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y},0),w=Math.sign(area);
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);if(!l)continue;
      const uv=(p,z)=>({...p,z,s:(p.x*dx/l+p.y*dy/l)/32,t:-z/32});
      surface(faces,[uv(a,bottom),uv(b,bottom),uv(b,top),uv(a,top)],side,{x:dy/l*w,y:-dx/l*w});
    }
    if(capped)for(const tri of PolygonGeometry.triangulate(points))surface(faces,tri.map(p=>({...p,z:top,s:p.x/32,t:p.y/32})),cap,null);
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
    const names={2:palette+'-cap',3:palette+'-wall',4:palette+'-floor',5:'door',6:'window'};
    for(const [slot,name] of Object.entries(names)){const x=slot%4*128,y=Math.floor(slot/4)*128;ctx.clearRect(x,y,128,128);ctx.drawImage(scene.textures.get('fdr-'+name).getSourceImage(),x+2,y+2,124,124);
      if(!active){ctx.globalCompositeOperation='source-atop';ctx.fillStyle='rgba(27,35,27,.25)';ctx.fillRect(x+2,y+2,124,124);ctx.globalCompositeOperation='source-over';}
      ctx.drawImage(tex.getSourceImage(),x+2,y+2,124,1,x+2,y,124,2);ctx.drawImage(tex.getSourceImage(),x+2,y+125,124,1,x+2,y+126,124,2);ctx.drawImage(tex.getSourceImage(),x+2,y,1,128,x,y,2,128);ctx.drawImage(tex.getSourceImage(),x+125,y,1,128,x+126,y,2,128);
    }tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return tex;
  }
  function rebuild(){
    for(const p of this.panels){p.root.destroy(true);p.label.destroy();}this.panels=[];revision++;
    const active=$('condition').value==='restored',family=$('family').value,palette=$('palette').value,points=fixtures[$('shape').value].map(([x,y])=>({x,y})),style=buildingBackgroundMaterial(CastleStyles.get(family,active));
    for(let candidate=0;candidate<2;candidate++){
      const cx=315+candidate*630,root=this.add.container(cx,330),label=this.add.text(cx,28,candidate?'FDR · generated towers + keep':'Current · ramparts + sprite towers',{fontSize:'20px',color:candidate?'#ddcc96':'#bdc9bb'}).setOrigin(.5,0);
      const scene={_headingUp:true,depth:0,mapRot:0,add:this.add,textures:this.textures,buildingWallContainer:root},group=WallPerspective.begin(scene,'study'),sprites=[],towers=[];let keep=null;
      if(candidate)group.atlas=atlas(this,palette,active);
      const colors={face:style.stone.FACE,top:style.stone.BODY,dark:style.stone.DARK};
      const prism=(ring,bottom,top,side=3,cap=2,support=null)=>WallPerspective.prism(scene,'study',ring,bottom,top,colors,support,true,candidate?{materialFaces:prismFaces(ring,bottom,top,true,side,cap)}:{});
      if(candidate){
        const key='fdr-floor-'+$('shape').value+'-'+palette+'-'+active;
        if(!this.textures.exists(key)){const texture=this.textures.createCanvas(key,220,180),ctx=texture.getContext();ctx.imageSmoothingEnabled=false;ctx.translate(110,90);ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.clip();const tile=document.createElement('canvas');tile.width=tile.height=32;const ink=tile.getContext('2d');ink.imageSmoothingEnabled=false;ink.drawImage(this.textures.get('fdr-'+palette+'-floor').getSourceImage(),0,0,32,32);ctx.fillStyle=ctx.createPattern(tile,'repeat');ctx.fillRect(-110,-90,220,180);if(!active){ctx.fillStyle='rgba(27,35,27,.25)';ctx.fillRect(-110,-90,220,180);}texture.refresh();texture.setFilter(Phaser.Textures.FilterMode.NEAREST);}
        root.addAt(this.add.image(0,0,key),0);
      }
      else {const floor=this.add.graphics();floor.fillStyle(style.floor);floor.fillPoints(points,true);root.addAt(floor,0);}
      const original=WallPerspective.prism;
      WallPerspective.prism=function(s,source,ring,bottom,top,c,support=null,capped=true,geometry={}){if(candidate)geometry={...geometry,materialFaces:prismFaces(ring,bottom,top,capped)};return original.call(this,s,source,ring,bottom,top,c,support,capped,geometry);};
      try{
        for(let i=0;i<points.length;i++){
          const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l,r=style.rampart;
          const count=l<r.toothWidth?0:Math.max(1,Math.round((l-r.toothWidth)/8)+1),pitch=count>1?(l-r.toothWidth)/(count-1):0,missing=[];
          for(let tooth=0;tooth<count;tooth++){const t=tooth*pitch/l,damage=CastleStyles.damageCell(family,Math.floor((a.x+dx*t+nx*.01+100)/CELL_PX),Math.floor((a.y+dy*t+ny*.01+80)/CELL_PX));if((r.broken&&tooth%4===2)||damage?.missing===tooth%4)missing.push(tooth);}
          WallPerspective.addSegment(scene,'study',{ax:a.x,ay:a.y,bx:b.x,by:b.y,nx,ny,height:r.wallHeight,thickness:r.topDepth,...colors,toothWidth:r.toothWidth,toothHeight:r.toothHeight,crownTop:style.stone.LITE,missing});
          const previous=points[(i+points.length-1)%points.length],px=a.x-previous.x,py=a.y-previous.y,plen=Math.hypot(px,py);
          if(plen&&px*dy-py*dx<0)WallPerspective.prism(scene,'study',[a,{x:a.x-py/plen*r.topDepth,y:a.y+px/plen*r.topDepth},{x:a.x+nx*r.topDepth,y:a.y+ny*r.topDepth}],0,r.wallHeight,colors);

        }
      }finally{WallPerspective.prism=original;}
      if(candidate)for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l,r=style.rampart;
        // A shallow projecting string course runs beneath the battlements.
        for(let j=0,n=Math.ceil(l/CELL_PX);j<n;j++){
          const lo=j/n,hi=(j+1)/n;
          const ring=[{x:a.x+dx*lo-nx*.5,y:a.y+dy*lo-ny*.5},{x:a.x+dx*hi-nx*.5,y:a.y+dy*hi-ny*.5},{x:a.x+dx*hi+nx*r.topDepth,y:a.y+dy*hi+ny*r.topDepth},{x:a.x+dx*lo+nx*r.topDepth,y:a.y+dy*lo+ny*r.topDepth}];
          prism(ring,r.wallHeight-2,r.wallHeight-.8,2,2,{x:(a.x+b.x+nx*r.topDepth)/2,y:(a.y+b.y+ny*r.topDepth)/2,order:group.blocks.length});
        }
      }
      // A single support anchor keeps each tower's stacked bands, roof and crown together.
      function mass(x,y,w,h,height,isKeep){
        const support={x,y,order:group.blocks.length},body=rectangle(x,y,w,h);
        // Disjoint vertical sections preserve painter order: a lower coping slab
        // must never paint across an already-drawn full-height shaft or roof.
        prism(rectangle(x,y,w+2,h+2),0,2,3,2,support);
        prism(body,2,height-4,3,2,support);
        prism(rectangle(x,y,w+1,h+1),height-4,height-2,2,2,support);
        prism(rectangle(x,y,w,h),height-2,height,3,4,support);
        const ring=rectangle(x,y,w+2,h+2),wall=2.8;
        for(let i=0;i<4;i++){
          const a=ring[i],b=ring[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l;
          const strip=(lo,hi)=>[{x:a.x+dx*lo,y:a.y+dy*lo},{x:a.x+dx*hi,y:a.y+dy*hi},{x:a.x+dx*hi+nx*wall,y:a.y+dy*hi+ny*wall},{x:a.x+dx*lo+nx*wall,y:a.y+dy*lo+ny*wall}];
          prism(strip(0,1),height,height+2,3,2,support);
          const n=Math.max(3,Math.round(l/8));for(let j=0;j<n;j++){if(family==='ruin'&&j%4===2)continue;const width=4.3,lo=j*(l-width)/(n-1)/l;prism(strip(lo,lo+width/l),height+2,height+5,3,2,support);}
        }
        // Decals are actual world-space planes attached to four sides, never billboards.
        const details=[];
        for(let i=0;i<4;i++){
          const a=body[i],b=body[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=dy/l,ny=-dx/l,mx=(a.x+b.x)/2+nx*.04,my=(a.y+b.y)/2+ny*.04;
          const door=isKeep&&i===2,width=door?7:3.5,z0=door?1:height*.48,z1=door?12:height*.48+7;
          const poly=[{x:mx-dx/l*width/2,y:my-dy/l*width/2,z:z0,s:0,t:1},{x:mx+dx/l*width/2,y:my+dy/l*width/2,z:z0,s:1,t:1},{x:mx+dx/l*width/2,y:my+dy/l*width/2,z:z1,s:1,t:0},{x:mx-dx/l*width/2,y:my-dy/l*width/2,z:z1,s:0,t:0}];surface(details,poly,door?5:6,{x:nx,y:ny});
        }
        // Attach details to body faces so nearer masonry still occludes them naturally.
        const block=group.blocks.find(b=>b.points===body);block.materialFaces.push(...details);
        return {x,y,width:w+2,depth:h+2,height:height+5};
      }
      if(candidate){
        for(let i=0;i<points.length;i++){
          const p=points[i],a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];if((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x)<=0)continue;
          const seats=[];for(const dx of [-11,11])for(const dy of [-11,11])if(fits(p.x+dx,p.y+dy,21,21,points))seats.push({x:p.x+dx,y:p.y+dy});
          if(seats.length){const q=seats[0];if(!towers.some(t=>Math.hypot(t.x-q.x,t.y-q.y)<30))towers.push(mass(q.x,q.y,18,18,25,false));}
        }
        if($('keep').checked){
          const candidates=[];for(let x=-80;x<=80;x+=4)for(let y=-60;y<=60;y+=4){if(!fits(x,y,64,56,points))continue;if(towers.some(t=>Math.abs(t.x-x)<43&&Math.abs(t.y-y)<39))continue;candidates.push({x,y,score:x*x+y*y});}
          candidates.sort((a,b)=>a.score-b.score);if(candidates.length){const q=candidates[0];keep=mass(q.x,q.y,40,32,28,true);}
        }
      }else for(const p of [points[0],points[1]]){const tower=this.add.image(p.x,p.y,'study-tower-'+(active?'restored':'weathered'),style.towerFrame).setOrigin(.5,1);root.add(tower);sprites.push(tower);}
      WallPerspective.finish(scene,'study');this.panels.push({root,label,scene,group,sprites,candidate:!!candidate,towers,keep});
    }
    window.fdrGeometryAudit={revision,shape:$('shape').value,palette,condition:$('condition').value,family,panels:this.panels.map(p=>({candidate:p.candidate,blocks:p.group.blocks.length,materialTriangles:p.group.blocks.reduce((n,b)=>n+(b.materialFaces?.length||0),0),billboards:p.sprites.length,towers:p.towers,keep:p.keep,allMassesInside:[...p.towers,...(p.keep?[p.keep]:[])].every(t=>fits(t.x,t.y,t.width,t.depth,points))}))};
    $('audit').textContent=JSON.stringify(window.fdrGeometryAudit,null,2);$('status').textContent='Ready · '+(this.game.renderer.type===2?'WebGL':'Canvas')+' · '+this.panels[1].towers.length+' geometry towers · '+(this.panels[1].keep?'central keep':'keep off / insufficient clearance');
  }
  window.fdrGeometryGame=new Phaser.Game({type:new URLSearchParams(location.search).has('canvas')?Phaser.CANVAS:Phaser.WEBGL,width:1260,height:640,parent:'game',backgroundColor:'#18231f',pixelArt:true,scene:{
    preload(){for(const name of ['cool-wall','warm-wall','cool-cap','warm-cap','cool-floor','warm-floor','door','window'])this.load.image('fdr-'+name,base+name+'.png');this.load.image('castle_tower_shapes','../assets/Objects/Castle/tower_shapes.png');},
    create(){this.panels=[];this.rebuild=rebuild.bind(this);window.fdrGeometryScene=this;makeTowerTexture(this,null,'study-tower-restored');makeTowerTexture(this,CASTLE_STONE_UNCLAIMED,'study-tower-weathered');for(const id of ['shape','palette','condition','family','keep'])$(id).onchange=()=>this.rebuild();this.rebuild();window.ready=true;},
    update(t,dt){if(rotating)$('angle').value=(+$('angle').value+dt*.025)%360;const angle=+$('angle').value*Math.PI/180;$('heading').textContent=$('angle').value+'°';for(const p of this.panels||[]){p.scene.mapRot=angle;p.root.setRotation(angle).setScale(+$('zoom').value);for(const sprite of p.sprites)sprite.setRotation(-angle);WallPerspective.update(p.scene);}}
  }});
})().catch(error=>{document.getElementById('status').textContent=error.stack;console.error(error);});
