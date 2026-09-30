// Preview-only asset substitution for the sandbox comparison. No saves or
// shipping assets are changed. Uses the audit dashboard's brightness study.
globalThis.applySandboxCandidates = async function (scene, plan) {
  const canvases = new Map(), changed = [];
  const recolour=(canvas,hexes,options={})=>ArtPreviewColour.recolour(canvas,hexes,options);
  function blank(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
  function sourceCanvas(key){
    if(canvases.has(key))return canvases.get(key);
    if(!scene.textures.exists(key))return null;
    const im=scene.textures.get(key).getSourceImage(), c=blank(im.width,im.height);
    c.getContext('2d').drawImage(im,0,0);canvases.set(key,c);return c;
  }
  for(const row of plan.sprites){
    let candidate=null;
    if(row.candidate){candidate=new Image();candidate.src=row.candidate;await candidate.decode();}
    for(const ref of row.refs){
      const keys=ref.key?[ref.key]:Object.entries(ASSETS).filter(([k,v])=>v.path?.split('?')[0]===ref.path).map(([k])=>k);
      for(const key of keys){
        const sheet=sourceCanvas(key);if(!sheet)continue;
        const rect=ref.rect||[0,0,sheet.width,sheet.height], [x,y,w,h]=rect;
        const frame=blank(w,h),ctx=frame.getContext('2d');ctx.imageSmoothingEnabled=false;
        if(candidate){
          // Keep each placement's frame and footprint; replacement source
          // pixels are nearest-neighbour scaled, never generatively redrawn.
          const scale=Math.min(w/candidate.width,h/candidate.height),cw=Math.round(candidate.width*scale),ch=Math.round(candidate.height*scale);
          ctx.drawImage(candidate,Math.floor((w-cw)/2),h-ch,cw,ch);
        }else ctx.drawImage(sheet,x,y,w,h,0,0,w,h);
        recolour(frame,row.palette,{strength:row.strength??.18,preserveLuminance:row.preserveLuminance!==false,mode:row.mode,colourMap:row.colourMap,paletteStrength:row.paletteStrength});
        const out=sheet.getContext('2d');out.clearRect(x,y,w,h);out.drawImage(frame,x,y);
        changed.push({id:row.id,key,rect});
      }
    }
  }
  for(const [key,canvas] of canvases){
    const texture=scene.textures.get(key),source=texture.source[0];
    source.image=canvas;source.isCanvas=true;source.update();
  }
  for(const [id,colour] of Object.entries(plan.ground))COLORS[id]=parseInt(colour.slice(1),16);
  // Terrain textures are transparent marks composited over the separate base.
  // Lower their alpha to reduce mark/base contrast without changing geometry.
  for(const [id,opacity] of Object.entries(plan.groundPatterns||{})){
    const spec=BIOME_TEX[id];
    for(let v=0;v<spec.variants;v++)for(let p=0;p<(spec.animPhases||1);p++){
      const key=`biome${id}_${v}`+(p?`p${p}`:'');
      if(!scene.textures.exists(key))continue;
      const texture=scene.textures.get(key),im=texture.getSourceImage(),c=blank(im.width,im.height),ctx=c.getContext('2d');
      ctx.globalAlpha=opacity;ctx.drawImage(im,0,0);
      texture.source[0].image=c;texture.source[0].isCanvas=true;texture.source[0].update();
    }
  }
  // The same declarative building palette as the generated audit previews.
  if(plan.buildings){
    const settings=plan.buildings;
    for(const [tier,hex] of Object.entries(settings.claimed.faces))Render.BUILDING_FACE_COLOR[tier]=parseInt(hex.slice(1),16);
    for(const [state,table] of [['claimed',CASTLE_STONE],['unclaimed',CASTLE_STONE_UNCLAIMED]]){
      for(const [key,hex] of Object.entries(settings[state].stone)){
        table[key].n=parseInt(hex.slice(1),16);table[key].s=hex;
      }
    }
    for(let v=0;v<TILLED_VARIANTS;v++){
      const texture=scene.textures.get('tilled_'+v);
      const c=MapArtProcedural.render({kind:'tilled',variant:v,proposed:true});
      texture.source[0].image=c;texture.source[0].isCanvas=true;texture.source[0].update();
    }
  }
  // Context proposal: clipped hedges only on residential/commercial ground.
  // The frozen sandbox has no actual Formal Garden variant assignment.
  if(plan.hedge){
    const im=new Image();im.src=plan.hedge.src;await im.decode();
    const c=blank(48,32),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
    ctx.drawImage(im,8,0,32,32);recolour(c,plan.hedge.palette,{strength:plan.hedge.strength,mode:plan.hedge.mode});
    scene.textures.addCanvas('audit_context_hedge',c);
    const original=Render.renderPool;
    Render.renderPool=function(s,pool,container,list,configure){
      return original(s,pool,container,list,(sprite,item)=>{
        configure(sprite,item);
        if(pool===s.plantedPool&&item.p?.crop==='shrub'&&[5,16].includes(item.p._biome))sprite.setTexture('audit_context_hedge');
      });
    };
  }
  return {changed,ground:plan.ground,notes:plan.notes};
};
