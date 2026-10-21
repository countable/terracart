/* Isolated material experiment. No runtime source or saved game is changed. */
(async () => {
  await loadGame(); window.Phaser = ReviewPhaser;
  const $ = id => document.getElementById(id), base = '/ra-architecture-geometry/materials/';
  const sources = ['timber','stone','stone-top','temple','temple-dark','temple-side','temple-dark-side','floor-stone'];
  let rotating = false, revision = 0;
  $('rotate').onclick = () => { rotating = !rotating; $('rotate').textContent = rotating ? 'Pause' : 'Rotate'; };
  const fixtures = {
    rectangle: [[-58,-42],[58,-42],[58,42],[-58,42]],
    concave: [[-64,-44],[48,-44],[64,-15],[15,-15],[15,42],[-64,42]],
  };
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
  function prismFaces(points,bottom,top,capped){
    const faces=[];
    const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y},0),w=Math.sign(area);
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);if(!l)continue;
      const uv=(p,z)=>({...p,z,s:(p.x*dx/l+p.y*dy/l)/32,t:-z/32});
      surface(faces,[uv(a,bottom),uv(b,bottom),uv(b,top),uv(a,top)],3,{x:dy/l*w,y:-dx/l*w});
    }
    if(capped)for(const tri of PolygonGeometry.triangulate(points))surface(faces,tri.map(p=>({...p,z:top,s:p.x/32,t:p.y/32})),2,null);
    return faces;
  }
  function atlas(scene,kind,dark,family,active){
    const key='ra-study-'+kind+(dark?'-dark':'')+'-'+family+'-'+active;if(scene.textures.exists(key))return scene.textures.get(key);
    const texture=scene.textures.createCanvas(key,512,512),ctx=texture.getContext();ctx.drawImage(WallMaterials.prepare(scene).getSourceImage(),0,0);ctx.imageSmoothingEnabled=false;
    const slots=kind==='fort'?{4:'timber',5:'timber'}:kind==='castle'?{2:family==='archive'?'timber':'stone-top',3:'stone'}:{2:dark?'temple-dark':'temple',3:dark?'temple-dark-side':'temple-side'};
    for(const [slot,name] of Object.entries(slots)){
      const x=slot%4*128,y=Math.floor(slot/4)*128,img=scene.textures.get('ra-'+name).getSourceImage();
      // Preserve source detail; bounded family ratios relative to neutral citadel.
      // Weathering uses CastleStyles' channel ratios once, after family coloring.
      const tile=document.createElement('canvas');tile.width=img.width;tile.height=img.height;
      const ink=tile.getContext('2d');ink.drawImage(img,0,0);
      if(kind==='castle'){
        const data=ink.getImageData(0,0,tile.width,tile.height),familyColor=CastleStyles.get(family,true).stone.BODY,neutral=CastleStyles.get('citadel',true).stone.BODY;
        for(let i=0;i<data.data.length;i+=4)for(let channel=0;channel<3;channel++){
          const shift=(2-channel)*8,ratio=name==='timber'?1:Math.max(.8,Math.min(1.22,((familyColor>>shift)&255)/((neutral>>shift)&255)));
          data.data[i+channel]=Math.round(Math.min(255,data.data[i+channel]*ratio)*(active?1:[.80,.82,.78][channel]));
        }ink.putImageData(data,0,0);
      }
      ctx.drawImage(tile,x+2,y+2,124,124);
      ctx.drawImage(texture.getSourceImage(),x+2,y+2,124,1,x+2,y,124,2);ctx.drawImage(texture.getSourceImage(),x+2,y+125,124,1,x+2,y+126,124,2);
      ctx.drawImage(texture.getSourceImage(),x+2,y,1,128,x,y,2,128);ctx.drawImage(texture.getSourceImage(),x+125,y,1,128,x+126,y,2,128);
    }texture.refresh();texture.setFilter(Phaser.Textures.FilterMode.NEAREST);return texture;
  }
  const snapshot=blocks=>JSON.stringify(blocks.slice().sort((a,b)=>a.order-b.order).map(b=>({points:b.points,topPoints:b.topPoints,bottom:b.bottom,top:b.top,capped:b.capped,support:{x:b.support.x,y:b.support.y,order:b.support.order},segment:b.segment})));
  function rebuild(){
      for(const panel of this.panels){panel.root.destroy(true);panel.label.destroy();}this.panels=[];revision++;
      const active=$('condition').value==='restored',dark=$('temple').value==='tar',points=fixtures[$('shape').value].map(([x,y])=>({x,y}));
      for(let row=0;row<2;row++)for(let col=0;col<3;col++){
        const kind=['fort','castle','temple'][col],candidate=row===1,cx=210+col*420,cy=285+row*440;
        const root=this.add.container(cx,cy),label=this.add.text(cx,12+row*440,(candidate?'RA candidate':'Current')+' · '+kind,{fontSize:'19px',color:candidate?'#dbc78d':'#c4d3be'}).setOrigin(.5,0);
        const scene={_headingUp:true,depth:0,mapRot:0,add:this.add,textures:this.textures,buildingWallContainer:root};
        const style=buildingBackgroundMaterial(CastleStyles.get($('family').value,active)),palette=TempleArt.palette(active,dark,true);
        const floorKey='study-floor-'+row+'-'+col;if(this.textures.exists(floorKey))this.textures.remove(floorKey);
        const tex=this.textures.createCanvas(floorKey,160,130),ctx=tex.getContext();ctx.translate(80,65);ctx.imageSmoothingEnabled=false;
        const path=()=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();};
        if(kind==='temple')TempleArt.draw(ctx,points,{activated:active,dark,faces:false,background:true});
        else {path();ctx.fillStyle='#'+(kind==='fort'?0x9a8a64:style.floor).toString(16).padStart(6,'0');ctx.fill();}
        tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);root.add(this.add.image(0,0,floorKey));
        const group=WallPerspective.begin(scene,'study'),counts={palisade:0,addSegment:0,prism:0,foundation:0};if(candidate)group.atlas=atlas(this,kind,dark,$('family').value,active);
        const original=WallPerspective.prism;
        WallPerspective.prism=function(s,source,ring,bottom,top,colors,support=null,capped=true,geometry={}){
          counts.prism++;if(candidate&&kind!=='fort')geometry={...geometry,materialFaces:prismFaces(ring,bottom,top,capped)};
          return original.call(this,s,source,ring,bottom,top,colors,support,capped,geometry);
        };
        try{
          if(kind==='temple'){counts.foundation++;WallPerspective.prism(scene,'study',points,-TempleArt.geometry.foundationDepth,0,{face:palette.face,top:palette.floor,dark:palette.outline},null,false);}
          for(let i=0;i<points.length;i++){
            const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l;
            if(kind==='fort'){
              const n=Math.max(1,Math.round(l/WallMaterials.WOOD.pitch));for(let j=0;j<n;j++){counts.palisade++;const lo=j/n,hi=Math.min(1,lo+WallMaterials.WOOD.width/l);WallPerspective.palisade(scene,'study',{ax:a.x+dx*lo,ay:a.y+dy*lo,bx:a.x+dx*hi,by:a.y+dy*hi,nx,ny,tint:active?0xffffff:0xc1b8a3});}
            }else{
              const r=style.rampart,height=kind==='temple'?TempleArt.geometry.wallHeight:r.wallHeight,thickness=kind==='temple'?TempleArt.geometry.wallThickness:r.topDepth;
              const spec={ax:a.x,ay:a.y,bx:b.x,by:b.y,nx,ny,height,thickness,face:kind==='temple'?palette.face:style.stone.FACE,top:kind==='temple'?palette.coping:(style.rampart.woodTop?style.wood.BODY:style.stone.BODY),dark:kind==='temple'?palette.outline:style.stone.DARK};
              if(kind==='castle'){
                const count=l<r.toothWidth?0:Math.max(1,Math.round((l-r.toothWidth)/8)+1),pitch=count>1?(l-r.toothWidth)/(count-1):0,missing=[];
                for(let tooth=0;tooth<count;tooth++){const t=tooth*pitch/l,damage=CastleStyles.damageCell($('family').value,Math.floor((a.x+dx*t+nx*.01+64)/CELL_PX),Math.floor((a.y+dy*t+ny*.01+44)/CELL_PX));if((r.broken&&tooth%4===2)||damage?.missing===tooth%4)missing.push(tooth);}
                Object.assign(spec,{toothWidth:r.toothWidth,toothHeight:r.toothHeight,crownTop:style.rampart.woodTop?style.wood.LITE:style.stone.LITE,missing});
              }
              counts.addSegment++;WallPerspective.addSegment(scene,'study',spec);
              const previous=points[(i+points.length-1)%points.length],px=a.x-previous.x,py=a.y-previous.y,plen=Math.hypot(px,py);
              if(plen&&(px*dy-py*dx)<0)WallPerspective.prism(scene,'study',[a,{x:a.x-py/plen*thickness,y:a.y+px/plen*thickness},{x:a.x+nx*thickness,y:a.y+ny*thickness}],0,height,{face:spec.face,top:spec.top,dark:spec.dark});
            }
          }
        }finally{WallPerspective.prism=original;}
        WallPerspective.finish(scene,'study');
        const sprites=[];
        if(kind==='fort'){const hall=this.add.image($('shape').value==='concave'?-20:0,-9,active?'study-hall':'study-hall-weathered').setDisplaySize(48,48);root.add(hall);sprites.push(hall);}
        if(kind==='castle')for(const p of [points[0],points[1]]){const tower=this.add.image(p.x,p.y,'study-tower-'+(active?'restored':'weathered'),style.towerFrame).setOrigin(.5,1);root.add(tower);sprites.push(tower);}
        this.panels.push({root,label,scene,group,sprites,kind,candidate,counts,snapshot:snapshot(group.blocks)});
      }
      window.raGeometryAudit={revision,shape:$('shape').value,condition:$('condition').value,geometryIdentical:[0,1,2].every(i=>this.panels[i].snapshot===this.panels[i+3].snapshot),panels:this.panels.map(p=>({kind:p.kind,candidate:p.candidate,blocks:p.group.blocks.length,materialTriangles:p.group.blocks.reduce((s,b)=>s+(b.materialFaces?.length||0),0),...p.counts}))};
      $('status').textContent='Ready · '+(this.game.renderer.type===2?'WebGL':'Canvas')+' · identical production geometry: '+(window.raGeometryAudit.geometryIdentical?'PASS':'FAIL');
      $('audit').textContent=JSON.stringify(window.raGeometryAudit,null,2);
      }
  window.raGeometryGame=new Phaser.Game({type:new URLSearchParams(location.search).has('canvas')?Phaser.CANVAS:Phaser.WEBGL,width:1260,height:940,parent:'game',backgroundColor:'#18231f',pixelArt:true,scene:{
    preload(){for(const name of sources)this.load.image('ra-'+name,base+name+'.png');this.load.image('study-hall','../assets/Objects/Approved/house_fort.png');this.load.image('study-hall-weathered','../assets/Objects/Approved/house_fort_unclaimed.png');this.load.image('castle_tower_shapes','../assets/Objects/Castle/tower_shapes.png');},
    create(){this.rebuild=rebuild.bind(this);window.raGeometryScene=this;this.panels=[];makeTowerTexture(this,null,'study-tower-restored');makeTowerTexture(this,CASTLE_STONE_UNCLAIMED,'study-tower-weathered');
      for(const id of ['shape','condition','family','temple'])$(id).onchange=()=>this.rebuild();this.rebuild();window.ready=true;},
    update(t,dt){if(rotating)$('angle').value=(+$('angle').value+dt*.025)%360;const angle=+$('angle').value*Math.PI/180;$('heading').textContent=$('angle').value+'°';for(const p of this.panels||[]){p.scene.mapRot=angle;p.root.setRotation(angle).setScale(+$('zoom').value);for(const sprite of p.sprites)sprite.setRotation(-angle);WallPerspective.update(p.scene);}}
  }});
})().catch(error=>{document.getElementById('status').textContent=error.stack;console.error(error);});
