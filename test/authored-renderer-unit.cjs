// Exercise the actual depth renderer's Phaser handoff without GPU readbacks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const calls = [];
let handle=0;
const gl = new Proxy({}, {get(target, key) {
  if (key === 'isContextLost') return () => false;
  if (key === 'getParameter' || key === 'isEnabled') return () => {throw Error('synchronous GPU readback: '+key)};
  if (String(key).toUpperCase() === key) return key;
  return (...args) => {
    calls.push([key,...args]);
    return /^(create|getAttribLocation|getUniformLocation)/.test(key) ? {id:++handle} : true;
  };
}});
const pipeline = {setTexture2D:()=>0,batchVert:(...v)=>calls.push(['vertex',...v]),flush:()=>calls.push(['flush'])};
const window = {};
vm.runInNewContext(fs.readFileSync('src/authored_building_renderer.js','utf8'), {window,Phaser:{Renderer:{WebGL:{Utils:{getTintAppendFloatAlpha:()=>0xffffff}}}},Float32Array});
for (const stencil of [false,true]) for (const rogue of [false,true]) {
  calls.length=0;
  const renderer={gl,width:100,height:100,currentFramebuffer:null,currentBlendMode:3,
    hasActiveStencilMask:()=>stencil,resetScissor:()=>calls.push(['resetScissor']),
    setBlendMode:(...v)=>calls.push(['blend',...v]),
    pipelines:{current:pipeline,clear:()=>calls.push(['clearPipeline']),rebind:()=>calls.push(['rebind']),get:()=>pipeline,set:()=>pipeline}};
  const scene={mapRot:0,_authoredDepthRenderer:{width:100,height:100,target:{webGLFramebuffer:'offscreen'},texture:{},program:{},buffer:{},position:0,uv:1,fallback:2,roguePalette:7}};
  const points=[{x:5,y:5,z:0,tu:0,tv:0},{x:30,y:5,z:0,tu:1,tv:0},{x:5,y:30,z:12,tu:0,tv:1}];
  const src={alpha:1,_roguePalette:rogue,_lowpolyFaces:[{visible:true,x:0,y:0,points,projected:points,texture:{source:[{glTexture:{webGLTexture:'art'}}]}}]};
  window.AuthoredBuildingRenderer.draw(scene,renderer,src,{alpha:1},{getX:(x)=>x,getY:(x,y)=>y});
  assert(calls.some(c=>c[0]==='uniform1f'&&c[1]===7&&c[2]===(rogue?1:0)),'palette is explicitly enabled or reset per building');
  assert.equal(calls.filter(c=>c[0]==='vertex').length,6,'same rendered target composite');
  assert(calls.some(c=>c[0]==='resetScissor'),'restores the camera scissor from Phaser');
  assert(calls.some(c=>c[0]===(stencil?'enable':'disable')&&c[1]==='STENCIL_TEST'),'restores active camera/object masking');
  assert(calls.some(c=>c[0]==='bindFramebuffer'&&c[2]===null),'returns to caller framebuffer');
  assert(calls.some(c=>c[0]==='blend'&&c[1]===3),'returns to caller blend mode');
}
console.log('Authored renderer: no GPU state queries; camera scissor, stencil, framebuffer, blend and composite restored.');
// Context recovery must replace every raw resource/location while retaining
// Phaser's automatically restored target wrappers and one scene listener.
{
  const listeners=new Map();let shutdown,targets=0;
  const renderer={gl,width:100,height:100,currentFramebuffer:null,currentBlendMode:0,
    on:(name,fn)=>{assert(!listeners.has(name));listeners.set(name,fn);},
    off:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name);},
    hasActiveStencilMask:()=>false,resetScissor(){},setBlendMode(){},
    createTextureFromSource:()=>({webGLTexture:'target'}),
    createFramebuffer:()=>{targets++;return {webGLFramebuffer:'target'};},
    deleteFramebuffer(){},deleteTexture(){},
    pipelines:{current:pipeline,clear(){},rebind(){},get:()=>pipeline,set:()=>pipeline}};
  const scene={mapRot:0,events:{once:(name,fn)=>{assert.equal(name,'shutdown');shutdown=fn;}}};
  const points=[{x:5,y:5,z:0,tu:0,tv:0},{x:30,y:5,z:0,tu:1,tv:0},{x:5,y:30,z:12,tu:0,tv:1}];
  const src={alpha:1,_lowpolyFaces:[{visible:true,x:0,y:0,points,projected:points,texture:{source:[{glTexture:{webGLTexture:'art'}}]}}]};
  const draw=()=>window.AuthoredBuildingRenderer.draw(scene,renderer,src,{alpha:1},{getX:x=>x,getY:(x,y)=>y});
  calls.length=0;draw();
  const state=scene._authoredDepthRenderer,target=state.target;
  for(let cycle=0;cycle<2;cycle++){
    const previous={...state};
    renderer.contextLost=true;calls.length=0;draw();
    assert.equal(calls.length,0,'lost context never submits geometry');
    renderer.contextLost=false;listeners.get('restorewebgl')();
    calls.length=0;draw();
    for(const key of ['program','buffer','position','uv','fallback','shade','size','sampler','roguePalette']){
      assert.notEqual(state[key],previous[key],key+' is recreated for the restored context');
    }
    assert(calls.some(c=>c[0]==='getExtension'&&c[1]==='OES_standard_derivatives'),'shader extension re-enabled');
    assert(calls.some(c=>c[0]==='useProgram'&&c[1]===state.program),'new shader used');
    assert(calls.some(c=>c[0]==='bindBuffer'&&c[2]===state.buffer),'new buffer used');
    assert.equal(state.target,target,'restored Phaser target retained');
    assert.equal(targets,1,'recovery allocates no extra full-screen targets');
    assert.equal(listeners.size,1,'one restore listener across repeated losses');
  }
  shutdown();assert.equal(listeners.size,0);assert.equal(scene._authoredDepthRenderer,undefined);
}
console.log('Authored renderer: repeated context recovery replaces raw handles and cleans up its listener.');
// Procedural castle/temple colours share the trial but never mutate their
// source material or reuse a differently themed cached palette.
const paletteSource=fs.readFileSync('src/util.js','utf8').split('// Match the authored RA building shader for procedural masonry as well.')[1];
const rogue={enabled:false};
const palette=new Function('RogueObjects',paletteSource+'\nreturn {buildingBackgroundColor,buildingBackgroundMaterial};')(rogue);
const material={floor:0xb97542,stone:{wall:0xd8b57b},wood:{beam:0x754958}};
const baseline=palette.buildingBackgroundMaterial(material);
rogue.enabled=true;
const adapted=palette.buildingBackgroundMaterial(material);
assert.notEqual(adapted,baseline);
assert.equal(palette.buildingBackgroundMaterial(material),adapted,'RA palette cache reused');
assert.equal(material.stone.wall,0xd8b57b,'source palette untouched');
const spread=c=>Math.max(c>>16,(c>>8)&255,c&255)-Math.min(c>>16,(c>>8)&255,c&255);
assert(spread(adapted.floor)<spread(material.floor),'copper saturation reduced');
assert(adapted.floor!==adapted.wood.beam,'role/material hue remains distinct');
rogue.enabled=false;
assert.equal(palette.buildingBackgroundMaterial(material),baseline,'baseline/Dreamland cache unaffected');
