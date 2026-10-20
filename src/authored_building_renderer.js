// The reviewed shells need a depth buffer: a roof, porch and recessed facade
// cannot be sorted reliably by their triangles' average distances. Render each
// building into one reused scene target, then composite it in the world's normal
// object order. No canvas reads or per-building textures are needed.
(function(global){
  function create(scene,renderer){
    const gl=renderer.gl;
    gl.getExtension('OES_standard_derivatives');
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const vertex=shader(gl.VERTEX_SHADER,`
      attribute vec3 aPosition;attribute vec2 aUV;attribute vec2 aFallback;
      uniform vec2 uSize;varying vec2 vUV;varying vec2 vFallback;
      void main(){gl_Position=vec4(aPosition.x/uSize.x*2.0-1.0,1.0-aPosition.y/uSize.y*2.0,aPosition.z,1.0);vUV=aUV;vFallback=aFallback;}`);
    const fragment=shader(gl.FRAGMENT_SHADER,`#extension GL_OES_standard_derivatives : enable
      precision highp float;uniform sampler2D uTexture;varying vec2 vUV;varying vec2 vFallback;
      void main(){vec2 size=vec2(512.0,1024.0),p=vUV*size-0.5,cell=floor(p),width=max(fwidth(p),vec2(0.0001));
        vec2 w=clamp((fract(p)-0.5)/width+0.5,0.0,1.0),uv=(cell+0.5)/size;
        vec4 color=mix(mix(texture2D(uTexture,uv),texture2D(uTexture,uv+vec2(1.0/512.0,0.0)),w.x),
          mix(texture2D(uTexture,uv+vec2(0.0,1.0/1024.0)),texture2D(uTexture,uv+vec2(1.0/512.0,1.0/1024.0)),w.x),w.y);
        vec3 base=texture2D(uTexture,vFallback).rgb;
        gl_FragColor=vec4(color.rgb+base*(1.0-color.a),1.0);}`);
    const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    const state={program,buffer:gl.createBuffer(),position:gl.getAttribLocation(program,'aPosition'),
      uv:gl.getAttribLocation(program,'aUV'),fallback:gl.getAttribLocation(program,'aFallback'),
      size:gl.getUniformLocation(program,'uSize'),sampler:gl.getUniformLocation(program,'uTexture'),width:0,height:0};
    scene.events?.once('shutdown',()=>{if(state.target)renderer.deleteFramebuffer(state.target);if(state.texture)renderer.deleteTexture(state.texture);
      gl.deleteBuffer(state.buffer);gl.deleteProgram(state.program);delete scene._authoredDepthRenderer;});
    return state;
  }
  function draw(scene,renderer,src,camera,matrix){
    const faces=src._lowpolyFaces.filter(f=>f.visible);if(!faces.length)return;
    const gl=renderer.gl,state=scene._authoredDepthRenderer||(scene._authoredDepthRenderer=create(scene,renderer));
    const width=renderer.width,height=renderer.height;
    const previous=renderer.pipelines.current,framebuffer=renderer.currentFramebuffer;
    const viewport=gl.getParameter(gl.VIEWPORT),scissor=gl.getParameter(gl.SCISSOR_BOX),scissored=gl.isEnabled(gl.SCISSOR_TEST),stenciled=gl.isEnabled(gl.STENCIL_TEST);
    const clearColor=gl.getParameter(gl.COLOR_CLEAR_VALUE),clearDepth=gl.getParameter(gl.DEPTH_CLEAR_VALUE);
    const depthMask=gl.getParameter(gl.DEPTH_WRITEMASK),depthFunc=gl.getParameter(gl.DEPTH_FUNC),depthTest=gl.isEnabled(gl.DEPTH_TEST);
    const activeTexture=gl.getParameter(gl.ACTIVE_TEXTURE),blendMode=renderer.currentBlendMode;
    const angle=scene.mapRot||0,s=Math.sin(angle),c=Math.cos(angle),vertices=[];
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,near=-Infinity,far=Infinity;
    const groups=new Map();for(const face of faces){const key=face.texture.source[0].glTexture;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(face);}
    const ranges=[];for(const [texture,group] of groups){const start=vertices.length;
    for(const f of group){const fallback=f.fallbackUV||(f.kind==='roof'?[264.5/512,624.5/1024]:[264.5/512,908.5/1024]);
      f.points.forEach((p,i)=>{const projected=f.projected[i],x=matrix.getX(projected.x,projected.y),y=matrix.getY(projected.x,projected.y);
        const depth=s*(f.x+p.x)+c*(f.y+p.y)+p.z/3;
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);far=Math.min(far,depth);near=Math.max(near,depth);
        vertices.push([x,y,depth,p.tu,p.tv,...fallback]);});
    }
    ranges.push({texture,start,count:vertices.length-start});}
    left=Math.max(0,Math.floor(left)-1);right=Math.min(width,Math.ceil(right)+1);
    top=Math.max(0,Math.floor(top)-1);bottom=Math.min(height,Math.ceil(bottom)+1);
    if(left>=right||top>=bottom)return;
    renderer.pipelines.clear();
    if(state.width!==width||state.height!==height){
      if(state.target)renderer.deleteFramebuffer(state.target);if(state.texture)renderer.deleteTexture(state.texture);
      state.texture=renderer.createTextureFromSource(null,width,height,0);
      state.target=renderer.createFramebuffer(width,height,state.texture,true);state.width=width;state.height=height;
      // createFramebuffer invalidates Phaser's cached binding; restore the
      // caller's metadata as well as the real framebuffer before compositing.
      renderer.currentFramebuffer=framebuffer;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,state.target.webGLFramebuffer);gl.viewport(0,0,width,height);
    gl.enable(gl.SCISSOR_TEST);gl.scissor(left,height-bottom,right-left,bottom-top);
    gl.disable(gl.STENCIL_TEST);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(state.program);gl.bindBuffer(gl.ARRAY_BUFFER,state.buffer);
    const range=Math.max(1,near-far),data=new Float32Array(vertices.flatMap(p=>[p[0],p[1],.9-(p[2]-far)/range*1.8,...p.slice(3)]));
    gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    for(const [location,size,offset] of [[state.position,3,0],[state.uv,2,12],[state.fallback,2,20]]){
      gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,28,offset);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(state.sampler,0);gl.uniform2f(state.size,width,height);
    for(const range of ranges){gl.bindTexture(gl.TEXTURE_2D,range.texture.webGLTexture);gl.drawArrays(gl.TRIANGLES,range.start,range.count);}
    for(const location of [state.position,state.uv,state.fallback])gl.disableVertexAttribArray(location);
    gl.disable(gl.DEPTH_TEST);gl.depthMask(depthMask);gl.depthFunc(depthFunc);
    gl.clearColor(...clearColor);gl.clearDepth(clearDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer?.webGLFramebuffer||null);
    renderer.pipelines.rebind(previous);gl.viewport(...viewport);gl.scissor(...scissor);if(!scissored)gl.disable(gl.SCISSOR_TEST);
    if(stenciled)gl.enable(gl.STENCIL_TEST);else gl.disable(gl.STENCIL_TEST);
    renderer.setBlendMode(blendMode,true);
    const pipeline=renderer.pipelines.set(renderer.pipelines.get('MultiPipeline'),src),unit=pipeline.setTexture2D(state.texture);
    const tint=Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(0xffffff,camera.alpha*src.alpha);
    const quad=[[left,top],[left,bottom],[right,bottom],[left,top],[right,bottom],[right,top]];
    for(const [x,y] of quad)pipeline.batchVert(x,y,x/width,1-y/height,unit,0,tint);
    // The next building reuses this target, so its composite must be submitted.
    pipeline.flush();
    gl.activeTexture(activeTexture);if(depthTest)gl.enable(gl.DEPTH_TEST);
  }
  global.AuthoredBuildingRenderer={draw};
})(window);
