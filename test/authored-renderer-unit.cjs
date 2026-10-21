// Exercise the actual depth renderer's Phaser handoff without GPU readbacks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const calls = [];
const gl = new Proxy({}, {get(target, key) {
  if (key === 'getParameter' || key === 'isEnabled') return () => {throw Error('synchronous GPU readback: '+key)};
  if (String(key).toUpperCase() === key) return key;
  return (...args) => calls.push([key,...args]);
}});
const pipeline = {setTexture2D:()=>0,batchVert:(...v)=>calls.push(['vertex',...v]),flush:()=>calls.push(['flush'])};
const window = {};
vm.runInNewContext(fs.readFileSync('src/authored_building_renderer.js','utf8'), {window,Phaser:{Renderer:{WebGL:{Utils:{getTintAppendFloatAlpha:()=>0xffffff}}}},Float32Array});
for (const stencil of [false,true]) {
  calls.length=0;
  const renderer={gl,width:100,height:100,currentFramebuffer:null,currentBlendMode:3,
    hasActiveStencilMask:()=>stencil,resetScissor:()=>calls.push(['resetScissor']),
    setBlendMode:(...v)=>calls.push(['blend',...v]),
    pipelines:{current:pipeline,clear:()=>calls.push(['clearPipeline']),rebind:()=>calls.push(['rebind']),get:()=>pipeline,set:()=>pipeline}};
  const scene={mapRot:0,_authoredDepthRenderer:{width:100,height:100,target:{webGLFramebuffer:'offscreen'},texture:{},program:{},buffer:{},position:0,uv:1,fallback:2}};
  const points=[{x:5,y:5,z:0,tu:0,tv:0},{x:30,y:5,z:0,tu:1,tv:0},{x:5,y:30,z:12,tu:0,tv:1}];
  const src={alpha:1,_lowpolyFaces:[{visible:true,x:0,y:0,points,projected:points,texture:{source:[{glTexture:{webGLTexture:'art'}}]}}]};
  window.AuthoredBuildingRenderer.draw(scene,renderer,src,{alpha:1},{getX:(x)=>x,getY:(x,y)=>y});
  assert.equal(calls.filter(c=>c[0]==='vertex').length,6,'same rendered target composite');
  assert(calls.some(c=>c[0]==='resetScissor'),'restores the camera scissor from Phaser');
  assert(calls.some(c=>c[0]===(stencil?'enable':'disable')&&c[1]==='STENCIL_TEST'),'restores active camera/object masking');
  assert(calls.some(c=>c[0]==='bindFramebuffer'&&c[2]===null),'returns to caller framebuffer');
  assert(calls.some(c=>c[0]==='blend'&&c[1]===3),'returns to caller blend mode');
}
console.log('Authored renderer: no GPU state queries; camera scissor, stencil, framebuffer, blend and composite restored.');
