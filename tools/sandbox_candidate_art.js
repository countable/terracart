// Preview-only asset substitution for the sandbox comparison. No saves or
// shipping assets are changed. Uses the audit dashboard's brightness study.
globalThis.applySandboxCandidates = async function (scene, plan) {
  const canvases = new Map(), changed = [];
  const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const luma = c => c[0]*.2126+c[1]*.7152+c[2]*.0722;
  function recolour(canvas, hexes) {
    if (!hexes.length) return canvas;
    const colours=hexes.map(rgb).sort((a,b)=>luma(a)-luma(b));
    const ctx=canvas.getContext('2d'), pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    let lo=255,hi=0;
    for(let i=0;i<pixels.data.length;i+=4){if(!pixels.data[i+3])continue;const b=luma(pixels.data.subarray(i,i+3));lo=Math.min(lo,b);hi=Math.max(hi,b);}
    for(let i=0;i<pixels.data.length;i+=4){if(!pixels.data[i+3])continue;const b=luma(pixels.data.subarray(i,i+3));const colour=colours[Math.max(0,Math.min(colours.length-1,Math.round((b-lo)/Math.max(1,hi-lo)*(colours.length-1))))];pixels.data.set(colour,i);}
    ctx.putImageData(pixels,0,0);return canvas;
  }
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
        recolour(frame,row.palette);
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
  const stone={LITE:'#b0aa8a',BODY:'#777462',FACE:'#777462',SIDE:'#403e34',SHADOW:'#403e34',DARK:'#171717'};
  for(const [key,hex] of Object.entries(stone)){
    CASTLE_STONE[key].n=parseInt(hex.slice(1),16);CASTLE_STONE[key].s=hex;
    const n=unclaimedShade(CASTLE_STONE[key].n);
    CASTLE_STONE_UNCLAIMED[key].n=n;CASTLE_STONE_UNCLAIMED[key].s='#'+n.toString(16).padStart(6,'0');
  }
  // Context proposal: clipped hedges only on residential/commercial ground.
  // The frozen sandbox has no actual Formal Garden variant assignment.
  if(plan.hedge){
    const im=new Image();im.src=plan.hedge.src;await im.decode();
    const c=blank(48,32),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
    ctx.drawImage(im,8,0,32,32);recolour(c,plan.hedge.palette);
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
