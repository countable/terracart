/* Small orthographic review renderer. Retains vertex buffers and textures when
   rotating; square ground axes and screen-vertical elevation match the game. */
(function(root){
'use strict';
const vertex=`attribute vec3 aPosition;attribute vec2 aUV;attribute float aLight;
uniform vec2 uViewport;uniform float uHeading;uniform float uZoom;
varying vec2 vUV;varying float vLight;
void main(){float c=cos(uHeading),s=sin(uHeading);float x=c*aPosition.x-s*aPosition.y;float y=s*aPosition.x+c*aPosition.y;
 vec2 screen=vec2(x,y*.5-aPosition.z*.8660254)*uZoom;
 gl_Position=vec4(screen.x*2./uViewport.x,-(screen.y-20.)*2./uViewport.y,-(y*.8660254+aPosition.z*.5)/700.,1.);
 vUV=aUV;vLight=aLight;}`;
const fragment=`precision mediump float;uniform sampler2D uTexture;uniform float uCondition;varying vec2 vUV;varying float vLight;
void main(){vec4 p=texture2D(uTexture,fract(vUV));if(p.a<.5)discard;vec3 weather=vec3(.72,.77,.76);gl_FragColor=vec4(p.rgb*vLight*mix(weather,vec3(1.),uCondition),p.a);}`;
class TileReviewRenderer{
 constructor(canvas,images){
  this.canvas=canvas;this.images=images;const gl=this.gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL is unavailable');
  const shader=(kind,source)=>{const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const program=this.program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  this.locations=Object.fromEntries(['uViewport','uHeading','uZoom','uCondition','uTexture'].map(k=>[k,gl.getUniformLocation(program,k)]));
  this.attributes=['aPosition','aUV','aLight'].map(k=>gl.getAttribLocation(program,k));this.textures=new Map();this.uploads=0;
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);this.batches=[];
 }
 texture(key){const gl=this.gl;if(this.textures.has(key))return this.textures.get(key);const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.images[key]);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);this.textures.set(key,texture);this.uploads++;return texture;}
 setModel(model){const gl=this.gl;for(const b of this.batches)gl.deleteBuffer(b.buffer);this.batches=[];for(const [key,data] of model.batches){const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);this.batches.push({key,buffer,count:data.length/6});this.texture(key);}this.model=model;}
 draw(heading,zoom,condition){const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(.11,.16,.135,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);const u=this.locations;gl.uniform2f(u.uViewport,this.canvas.width,this.canvas.height);gl.uniform1f(u.uHeading,heading);gl.uniform1f(u.uZoom,zoom);gl.uniform1f(u.uCondition,condition);gl.uniform1i(u.uTexture,0);
 for(const b of this.batches){gl.bindBuffer(gl.ARRAY_BUFFER,b.buffer);[3,2,1].forEach((size,i)=>{gl.enableVertexAttribArray(this.attributes[i]);gl.vertexAttribPointer(this.attributes[i],size,gl.FLOAT,false,24,[0,12,20][i]);});gl.bindTexture(gl.TEXTURE_2D,this.textures.get(b.key));gl.drawArrays(gl.TRIANGLES,0,b.count);}}
}
root.TileReviewRenderer=TileReviewRenderer;
})(window);
