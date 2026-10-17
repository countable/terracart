// Retained, textured architecture. Only camera projection changes on rotation.
// Roofs use authored planes clipped to the exact footprint, not a sampled grid.
(function (global) {
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  function triangulate(input) {
    const ring=input.map(p=>({...p}));
    if(ring.reduce((s,p,i)=>s+p.x*ring[(i+1)%ring.length].y-p.y*ring[(i+1)%ring.length].x,0)<0)ring.reverse();
    let changed=true;
    while(changed&&ring.length>3){changed=false;for(let i=0;i<ring.length;i++){
      if(Math.abs(cross(ring[(i+ring.length-1)%ring.length],ring[i],ring[(i+1)%ring.length]))<1e-8){ring.splice(i,1);changed=true;break;}
    }}
    const pending=ring.slice(),triangles=[];
    while(pending.length>3){let found=false;for(let i=0;i<pending.length;i++){
      const a=pending[(i+pending.length-1)%pending.length],b=pending[i],c=pending[(i+1)%pending.length];
      if(cross(a,b,c)<=1e-8)continue;
      if(pending.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)>=-1e-8&&cross(b,c,p)>=-1e-8&&cross(c,a,p)>=-1e-8))continue;
      triangles.push([a,b,c]);pending.splice(i,1);found=true;break;
    }if(!found)return {ring,triangles:[]};}
    if(pending.length===3)triangles.push(pending);
    return {ring,triangles};
  }
  const value=(plane,p)=>plane.x*p.x+plane.y*p.y+plane.c;
  function clip(poly,plane){const out=[];for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=value(plane,a),db=value(plane,b);
    if(da>=-1e-8)out.push(a);
    if((da< -1e-8&&db>1e-8)||(da>1e-8&&db< -1e-8)){
      const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    }
  }return out;}
  function buildGeometry(input,variant='ridge',height=29){
    const {ring,triangles}=triangulate(input);
    if(!triangles.length)return {ring,faces:[],roofTriangles:0,wallTriangles:0};
    // The longest facade defines a stable roof direction; camera heading never does.
    let edge=0,length=0;ring.forEach((p,i)=>{const q=ring[(i+1)%ring.length],d=Math.hypot(q.x-p.x,q.y-p.y);if(d>length){length=d;edge=i;}});
    const a=ring[edge],b=ring[(edge+1)%ring.length],ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
    const axes=[{x:ux,y:uy},{x:-uy,y:ux}],bounds=axes.map(v=>{
      const values=ring.map(p=>p.x*v.x+p.y*v.y);return [Math.min(...values),Math.max(...values)];
    });
    const planes=[],pitch=variant==='shallow'?.18:.42;
    const addAxis=i=>{const v=axes[i],[lo,hi]=bounds[i];planes.push({x:v.x*pitch,y:v.y*pitch,c:-lo*pitch},{x:-v.x*pitch,y:-v.y*pitch,c:hi*pitch});};
    if(variant!=='flat'){addAxis(1);if(variant==='inset')addAxis(0);}
    planes.push({x:0,y:0,c:variant==='flat'?0:variant==='inset'?8:variant==='shallow'?5:28});
    const roofZ=p=>height+Math.max(0,Math.min(...planes.map(v=>value(v,p))));
    const faces=[];
    const add=(points,kind,light=1)=>{if(Math.abs(cross(...points))<1e-8&&kind==='roof')return;faces.push({points,kind,light});};
    for(const tri of triangles)for(let i=0;i<planes.length;i++){
      let poly=tri;for(let j=0;j<planes.length&&poly.length;j++)if(i!==j){const p=planes[i],q=planes[j];poly=clip(poly,{x:q.x-p.x,y:q.y-p.y,c:q.c-p.c});}
      if(poly.length<3)continue;
      const light=Math.max(.65,Math.min(1.1,.92-planes[i].x*.25-planes[i].y*.35));
      for(let j=1;j<poly.length-1;j++)add([poly[0],poly[j],poly[j+1]].map(p=>({...p,z:roofZ(p),u:p.x,v:p.y})),'roof',light);
    }
    const roofTriangles=faces.length;
    // Split walls only where a roof plane changes, so every gable meets its roof.
    ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],cuts=[0,1],length=Math.hypot(b.x-a.x,b.y-a.y);
      for(let j=0;j<planes.length;j++)for(let k=j+1;k<planes.length;k++){
        const da=value(planes[j],a)-value(planes[k],a),db=value(planes[j],b)-value(planes[k],b),t=da/(da-db);
        if(t>1e-7&&t<1-1e-7)cuts.push(t);
      }
      cuts.sort((a,b)=>a-b);
      for(let j=1;j<cuts.length;j++){
        if(cuts[j]-cuts[j-1]<1e-7)continue;
        const point=t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
        const p=point(cuts[j-1]),q=point(cuts[j]),zp=roofZ(p),zq=roofZ(q);
        const lo={...p,z:0,u:cuts[j-1]*length,v:height+28},hi={...q,z:0,u:cuts[j]*length,v:height+28};
        const up={...p,z:zp,u:lo.u,v:height+28-zp},uq={...q,z:zq,u:hi.u,v:height+28-zq};
        add([lo,hi,uq],'wall');add([lo,uq,up],'wall');
      }
    });
    return {ring,faces,roofTriangles,wallTriangles:faces.length-roofTriangles,height,roofZ};
  }
  const meshCache=new Map();
  function geometry(input,variant='ridge',height=29){
    const key=variant+':'+height+':'+input.map(p=>p.x.toFixed(4)+','+p.y.toFixed(4)).join(';');
    if(meshCache.has(key))return meshCache.get(key);
    const mesh=buildGeometry(input,variant,height);
    if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);
    meshCache.set(key,mesh);return mesh;
  }
  // Use the imported style silhouettes, but omit their geometric surface marks.
  // Adjacent parapet segments share interior walls; cancel those before submission.
  function styleGeometry(points,styleId,recipe){
    // A tiny notch must not collapse every roof band into a broad trim cap.
    if((styleId==='pyramid'||styleId==='japanese')&&!BuildingStyles.inset(points,3))
      return geometry(points,styleId==='pyramid'?'inset':'ridge',recipe.stories*24+5);
    const base=BuildingStyles.STYLES[styleId]||BuildingStyles.STYLES.adobe;
    const scale=styleId==='ruin'?1.5:(recipe.stories*24+5)/(base.height*(styleId==='multistorey'?2:1));
    const cacheKey='style:'+styleId+':'+scale+':'+JSON.stringify(recipe)+':'+points.map(p=>p.x.toFixed(4)+','+p.y.toFixed(4)).join(';');
    if(meshCache.has(cacheKey))return meshCache.get(cacheKey);
    const model=BuildingStyles.build(points,styleId,{geometryOnly:true,scale,palette:{wall:recipe.body,roof:recipe.roof,trim:recipe.trim}});
    const faces=[],quads=new Map();
    const add=(p,kind,color,layer)=>{
      const [a,b,c]=p,ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz);
      if(len<1e-8)return;
      const light=kind==='wall'?1:Math.max(.63,Math.min(1,.90+(nx*.25+ny*.35)/len));
      faces.push({points:p,kind,light,color,layer});
    };
    for(const prism of model.prisms){
      const ring=prism.points,upper=prism.topPoints||ring;
      const trim=prism.colors.top===recipe.trim;
      for(let i=0;i<ring.length;i++){
        const j=(i+1)%ring.length,a=ring[i],b=ring[j],c=upper[j],d=upper[i],length=Math.hypot(b.x-a.x,b.y-a.y);
        const slope=!!prism.topPoints,kind=trim?'trim':slope?'roof':'wall';
        const p=[{...a,z:prism.bottom,u:0},{...b,z:prism.bottom,u:length},{...c,z:prism.top,u:length},{...d,z:prism.top,u:0}];
        p.forEach(v=>{v.v=105-v.z;if(slope){v.u=v.x;v.v=v.y;}});
        const key=p.map(v=>[v.x,v.y,v.z].map(n=>n.toFixed(5)).join(',')).sort().join(';');
        if(quads.has(key))quads.set(key,null);else quads.set(key,{p,kind,color:trim?recipe.trim:null,layer:prism.bottom});
      }
      if(prism.capped)for(let i=1;i<upper.length-1;i++){
        const kind=trim?'trim':'roof';
        add([upper[0],upper[i],upper[i+1]].map(p=>({...p,z:prism.top,u:p.x,v:p.y})),kind,trim?recipe.trim:null,prism.top);
      }
    }
    for(const quad of quads.values())if(quad){const {p,kind,color,layer}=quad;add([p[0],p[1],p[2]],kind,color,layer);add([p[0],p[2],p[3]],kind,color,layer);}
    const mesh={faces,ring:points,height:model.height,uvBaseline:true,roofTriangles:faces.filter(f=>f.kind!=='wall').length,wallTriangles:faces.filter(f=>f.kind==='wall').length};
    if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);meshCache.set(cacheKey,mesh);return mesh;
  }
  // Stories and footprint are UV choices, not new texture allocations. All
  // buildings with a material/palette share this three-storey facade sheet.
  function material(scene,recipe){
    const key='lowpoly:soft-v2:'+JSON.stringify([recipe.material,recipe.body,recipe.trim,recipe.roof,recipe.finish,recipe.roofMaterial]);
    if(scene.textures.exists(key))return scene.textures.get(key);
    const tex=scene.textures.createCanvas(key,512,256),ctx=tex.getContext();
    const css=c=>'#'+c.toString(16).padStart(6,'0');
    const blend=(a,b,t)=>{let c=0;for(const shift of [16,8,0])c|=Math.round(((a>>shift)&255)*(1-t)+((b>>shift)&255)*t)<<shift;return css(c);};
    const noise=(x,y)=>{let n=Math.imul(x+17,374761393)^Math.imul(y+31,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
    const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
    rect(0,0,512,128,css(recipe.body));rect(0,128,512,128,css(recipe.roof));
    // Broad, barely visible pigment clouds first, then sparse fine grain.
    // Avoid high-contrast horizontal roof lines: they shimmer when turning.
    for(let y=0;y<256;y+=16)for(let x=0;x<512;x+=19){
      const n=noise(x,y),g=ctx.createRadialGradient(x+8,y+8,1,x+8,y+8,22);
      g.addColorStop(0,n>.5?'rgba(255,241,211,.045)':'rgba(35,29,25,.045)');g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;ctx.fillRect(x-14,Math.max(y-14,y<128?0:128),44,Math.min(44,128-y%128+14));
    }
    for(let y=0;y<256;y++)for(let x=0;x<512;x++){
      const n=noise(x,y);if(n<.78)continue;
      ctx.globalAlpha=.025+(n-.78)*.14;rect(x,y,1,1,n>.9?'#fff1d3':'#302a25');
    }ctx.globalAlpha=1;
    const mortar=blend(recipe.body,0xe0d2b8,.22),dark=blend(recipe.body,0x403b34,.22);
    if(recipe.material==='timber'){
      for(let x=0;x<512;x+=10){ctx.globalAlpha=.5;rect(x,0,1,128,dark);ctx.globalAlpha=.3;rect(x+1,0,1,128,mortar);}
    } else if(recipe.material!=='plaster'){
      const bw=recipe.material==='brick'?13:recipe.material==='sandstone'?25:20,bh=recipe.material==='brick'?6:10;
      for(let y=0,row=0;y<128;y+=bh,row++)for(let x=-(row%2)*bw/2;x<512;x+=bw){
        const n=noise(x,y);ctx.globalAlpha=.22+n*.25;
        rect(x,y,bw-1,.6,mortar);rect(x,y, .6,bh-1,mortar);
        ctx.globalAlpha=.04+n*.035;rect(x+1,y+1,bw-2,bh-2,n>.5?'#fff1d3':'#342a25');
      }
    }else{
      // Small islands of exposed substrate, leaving most plaster quiet.
      for(let y=8;y<105;y+=19)for(let x=4;x<512;x+=23){if(noise(x,y)<.86)continue;
        ctx.globalAlpha=.22;rect(x,y,5,2,dark);rect(x+2,y+3,6,2,dark);
        ctx.globalAlpha=.25;rect(x,y,5,.7,mortar);
      }
    }ctx.globalAlpha=1;
    const bottom=105,frame=blend(recipe.body,recipe.trim,.42),sill=blend(recipe.body,0xf3dfb8,.30);
    for(let floor=0;floor<3;floor++){
      const y=bottom-24*(floor+1);
      // Thin plaster cornice with a soft shadow; joinery color stays on openings.
      ctx.globalAlpha=.18;rect(0,y+2,512,2,'#37332d');ctx.globalAlpha=1;
      rect(0,y,512,1,sill);
      for(let x=14;x<512;x+=39){
        ctx.globalAlpha=.14;rect(x+1,y+7,9,13,'#292b2b');ctx.globalAlpha=1;
        rect(x-1,y+6,8,11,frame);rect(x,y+7,6,8,'#343937');
        rect(x+1,y+8,1,6,blend(recipe.trim,recipe.body,.25));rect(x+3,y+8,1,6,css(recipe.trim));
        rect(x-2,y+17,10,1.2,sill);ctx.globalAlpha=.2;rect(x-1,y+18,9,1,'#282c2c');ctx.globalAlpha=1;
      }
    }
    for(let x=42;x<512;x+=156){
      rect(x-2,bottom-22,14,22,frame);rect(x,bottom-20,10,20,'#32352f');
      rect(x+1,bottom-19,8,18,blend(recipe.trim,recipe.body,.12));
      ctx.globalAlpha=.25;for(let j=2;j<9;j+=3)rect(x+j,bottom-18,.7,16,'#222725');ctx.globalAlpha=1;
      rect(x+7,bottom-10,1,1.5,'#baa477');rect(x-2,bottom-2,14,1,sill);
    }
    if(recipe.finish==='cottage'){
      const beam=blend(recipe.trim,0x211f1c,.32),edge=blend(recipe.trim,recipe.body,.20);
      // Timbers are baked into the common facade, including diagonal braces.
      for(let floor=0;floor<3;floor++){
        const y=bottom-24*(floor+1);
        rect(0,y,512,2.3,beam);rect(0,y,512,.7,edge);
        for(let x=0;x<512;x+=39){
          rect(x,y,2.3,24,beam);rect(x,y,.7,24,edge);
          ctx.strokeStyle=beam;ctx.lineWidth=1.4;
          ctx.beginPath();ctx.moveTo(x+3,y+3);ctx.lineTo(x+11,y+10);ctx.moveTo(x+36,y+3);ctx.lineTo(x+29,y+10);ctx.stroke();
        }
      }
      const thatch=recipe.roofMaterial==='thatch',course=thatch?7:6,bw=thatch?4:9;
      ctx.save();ctx.beginPath();ctx.rect(0,128,512,128);ctx.clip();
      for(let y=128,row=0;y<256;y+=course,row++)for(let x=-bw;x<512;x+=bw){
        const px=x+(row%2)*bw/2,n=noise(x,y);
        ctx.globalAlpha=.16+n*.08;rect(px,y+course-1,bw-1,.8,blend(recipe.roof,0x24282c,.6));
        ctx.globalAlpha=.07+n*.07;rect(px,y,thatch?.7:1,course-1,blend(recipe.roof,0x24282c,.6));
        ctx.globalAlpha=.09;rect(px+1,y+1,bw-3,.6,'#f5dfb5');
        if(thatch){ctx.globalAlpha=.12;rect(px+2,y+2,.6,3,'#f5dfb5');}
      }ctx.restore();ctx.globalAlpha=1;
    }
    const plinth=ctx.createLinearGradient(0,bottom-6,0,bottom);
    plinth.addColorStop(0,'rgba(40,35,30,0)');plinth.addColorStop(1,'rgba(40,35,30,.22)');ctx.fillStyle=plinth;ctx.fillRect(0,bottom-6,512,6);
    rect(508,124,4,4,'#ffffff'); // Shared solid texel for silhouette trim.
    tex.refresh();return tex;
  }
  function active(scene){return !!scene._headingUp&&scene.game?.renderer?.type===2;}
  function begin(scene){
    if(!scene._lowpoly){
      const obj=scene.add.graphics();scene.buildingWallContainer.add(obj);
      const state=scene._lowpoly={obj,buildings:[],faces:[],builds:0,angle:NaN};
      obj.renderWebGL=function(renderer,src,camera,parentMatrix){
        camera.addToRenderList(src);
        const matrix=Phaser.GameObjects.GetCalcMatrix(src,camera,parentMatrix).calc;
        const pipeline=renderer.pipelines.set(renderer.pipelines.get('MultiPipeline'),src);
        renderer.pipelines.preBatch(src);
        for(const f of state.faces){
          if(!f.visible)continue;
          if(pipeline.shouldFlush(3))pipeline.flush();
          const unit=pipeline.setTexture2D(f.texture.source[0].glTexture);
          const shade=Math.min(255,Math.round(255*f.light));
          const color=f.color??0xffffff;
          const litColor=(((color>>16)*shade/255)<<16)|((Math.round(((color>>8)&255)*shade/255))<<8)|Math.round((color&255)*shade/255);
          const tint=Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(litColor,camera.alpha*src.alpha);
          for(let i=0;i<3;i++){
            const p=f.projected[i];
            // Broad under-eave darkening is vertex lighting, with no extra faces
            // or per-building texture. It follows the sloped gable wall top.
            const contact=f.kind==='wall'&&f.points[i].z>0?(f.cottage?.76:.87):1;
            const lit=Math.round(shade*contact);
            const vertexTint=contact===1?tint:Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha((lit<<16)|(lit<<8)|lit,camera.alpha*src.alpha);
            pipeline.batchVert(matrix.getX(p.x,p.y),matrix.getY(p.x,p.y),p.u,p.v,unit,0,vertexTint);
          }
        }
        renderer.pipelines.postBatch(src);
      };
      scene.events?.once('shutdown',()=>{for(const key of state.textures||[])scene.textures.remove(key);scene._lowpoly=null;});
    }
    const state=scene._lowpoly;state.buildings=[];state.faces=[];state.keys=new Set();state.angle=NaN;state.builds++;
    state.obj.visible=true;return state;
  }
  function add(scene,pts,recipe,variant,key){
    const state=scene._lowpoly,left=Math.min(...pts.map(p=>p.x)),top=Math.min(...pts.map(p=>p.y));
    const local=pts.map(p=>({x:p.x-left,y:p.y-top}));
    const cached=recipe.style&&typeof BuildingStyles!=='undefined'&&!variant
      ?styleGeometry(local,recipe.style,recipe):geometry(local,variant||'ridge',recipe.stories*24+5);
    const mesh={...cached,faces:cached.faces.map(face=>({...face}))};
    const texture=material(scene,recipe);(state.textures||=new Set()).add(texture.key);
    mesh.x=left;mesh.y=top;state.buildings.push(mesh);if(key&&mesh.faces.length)state.keys.add(key);
    const support={x:left+local.reduce((s,p)=>s+p.x,0)/local.length,y:top+local.reduce((s,p)=>s+p.y,0)/local.length,order:state.buildings.length};
    for(const face of mesh.faces){face.support=support;face.cottage=recipe.finish==='cottage';face.texture=texture;face.vOffset=mesh.uvBaseline?0:77-mesh.height;face.x=left;face.y=top;face.projected=face.points.map(()=>({}));state.faces.push(face);}
    return mesh;
  }
  function update(scene){const state=scene._lowpoly;if(!state)return;state.obj.visible=active(scene)&&(scene.depth??0)===0;
    const angle=scene.mapRot||0;if(state.angle===angle)return;state.angle=angle;
    const c=Math.cos(angle),s=Math.sin(angle);
    for(const face of state.faces){let depth=0;
      face.points.forEach((p,i)=>{const v=face.projected[i];v.x=face.x+p.x-s*p.z;v.y=face.y+p.y-c*p.z;v.u=Math.max(0,Math.min(1,p.u/512));v.v=face.kind==='roof'?.5+Math.max(0,Math.min(.499,p.v/256)):Math.max(0,Math.min(.499,(p.v+face.vOffset)/256));depth+=s*(face.x+p.x)+c*(face.y+p.y);});
      if(face.kind==='trim')for(const p of face.projected){p.u=510/512;p.v=126/256;}
      face.support.depth=s*face.support.x+c*face.support.y;
      face.depth=depth/3;
      if(face.kind==='wall'){const a=face.points[0],b=face.points[1],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;face.light=.82+.16*(c*dx-s*dy)/-len;}
      const p=face.projected;face.visible=cross(p[0],p[1],p[2])>1e-8;
    }
    state.faces.sort((a,b)=>a.support.depth-b.support.depth||a.support.order-b.support.order||(a.layer??0)-(b.layer??0)||a.depth-b.depth);
  }
  function clear(scene){if(scene._lowpoly){scene._lowpoly.faces=[];scene._lowpoly.keys.clear();scene._lowpoly.obj.visible=false;}}
  const covers=(scene,o)=>active(scene)&&scene._lowpoly?.obj.visible&&!!scene._lowpoly?.keys.has(o.id);
  global.BuildingLowPoly={styleGeometry,geometry,triangulate,active,begin,add,update,clear,covers};
})(window);
