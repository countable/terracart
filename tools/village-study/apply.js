// Isolated source-sprite appearance overrides, rendered by the game's object pools.
window.applyVillage = async () => {
  const s=__scene;
  const load=async src=>{const im=new Image();im.src=src;await im.decode();return im;};
  const manifest=await (await fetch('/__village/assets.json')).json();
  const entries=Array.isArray(manifest)?manifest:manifest.assets;
  for(const asset of entries) {
    const image=await load('/__village/crops/'+asset.id+'.png');
    s.textures.addImage('village_'+asset.id,image);
  }
  for(const o of __fixture.objects) if(!s.textures.exists('village_'+o.studyAsset)) throw new Error('Missing village source asset: '+o.studyAsset);
  const spec=Render.objectAppearance(s,{}).RENDER_SPEC;
  for(const kind of new Set(__fixture.objects.map(o=>o.kind))) spec[kind]={
    key:o=>'village_'+o.studyAsset,frame:0,scale:o=>o.studyScale||2,origin:[0,0],seat:false,
    groundAtOrigin:true,dxPx:o=>o.studyOffset[0],dyPx:o=>o.studyOffset[1],
    layer:kind==='staircase'||kind==='village_decal'?WorldLayers.GROUND_DECAL:WorldLayers.STANDING_PROP,
    shadow:false,
  };
  const tint=Render.spriteTint;
  Render.spriteTint=(o,sc,key)=>o.studyAsset?0xffffff:tint(o,sc,key);
  const low=Render.drawLowPolyProps;
  Render.drawLowPolyProps=(sc,items)=>low(sc,items.filter(it=>!it.o.studyAsset));
  s._objectAppearanceOwner={};
  const sheet=await load('/'+__fixture.layout.ground.source);
  const atlas=JungleAutotile.buildDualAtlas(sheet,__fixture.layout.ground.autotile);
  const grass=await load('/__village/crops/grass.png');
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=16;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  for(let m=0;m<16;m++) {
    ctx.drawImage(grass,m*16,0);
    const f=atlas.frames[m];ctx.drawImage(atlas.canvas,f.x,f.y,16,16,m*16,0,16,16);
  }
  const tex=s.textures.addCanvas('village_ground',canvas);
  for(let m=0;m<16;m++)tex.add(m,0,m*16,0,16,16);
  const cells=new Map(__fixture.grid.map(c=>[c.x+','+c.y,c.groundType]));
  const get=(x,y)=>cells.get(x+','+y)??1;
  window.__villageGround=()=>{
    s.cellGfx.clear();
    for(const ns of s.noisePool)if(ns.visible){
      const x=Math.round((ns.x-s.viewCenterX)/32),y=Math.round((ns.y-s.viewCenterY+26)/32);
      const mask=JungleAutotile.dualMaskAt(x,y,get,v=>v===4);
      ns.setTexture('village_ground',mask).setDisplaySize(32,32).setAlpha(1).clearTint().setPosition(ns.x+32,ns.y+32);
    }
  };
  window.__villageAtlasAudit={algorithm:'native dual-grid marching squares',masks:16,sourceTilePixels:16,displayTilePixels:32};
  __draw();
};
