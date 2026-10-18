// Opt-in lightmap composition in the existing Phaser WebGL context. Cached
// canvases remain the source of truth; only changed sources are uploaded.
(function (global) {
  let serial = 0;
  const VERTEX = `attribute vec2 aPosition;
    attribute vec2 aUV;
    uniform vec2 uSize;
    varying vec2 vUV;
    void main() {
      gl_Position = vec4(aPosition / uSize * 2.0 - 1.0, 0.0, 1.0);
      vUV = aUV;
    }`;
  const FRAGMENT = `precision mediump float;
    uniform sampler2D uSource;
    uniform float uAlpha;
    varying vec2 vUV;
    void main() { gl_FragColor = texture2D(uSource, vUV) * uAlpha; }`;

  function requested(scene) {
    if (typeof scene._gpuLightingRequested === 'boolean') return scene._gpuLightingRequested;
    return new URLSearchParams(global.location?.search || '').get('gpuLighting') === 'true';
  }
  function fallback(scene) {
    const map = scene.lightMap, texture = scene.lightTex;
    if (map && texture && map.texture !== texture) map.setTexture(texture.key);
  }
  function state(scene) {
    let st = scene._lightingGPU;
    if (st) return st;
    const renderer = scene.sys?.game?.renderer || scene.game?.renderer;
    st = scene._lightingGPU = { renderer, sources: new Map(), frames: 0,
      uploads: 0, uploadBytes: 0, draws: 0, disabled: false, reason: null,
      key: `lighting-gpu-${++serial}`, vertices: new Float32Array(24) };
    const events = global.Phaser?.Renderer?.Events;
    st.lost = () => {
      st.contextLost = true;
      fallback(scene);
      if (scene.lightTex) scene.lightTex.__lightKey = null;
    };
    st.restored = () => {
      st.contextLost = false;
      st.locations = null;
      for (const source of st.sources.values()) source.revision = null;
      if (scene.lightTex) scene.lightTex.__lightKey = null;
    };
    st.loseEvent = events?.LOSE_WEBGL || 'losewebgl';
    st.restoreEvent = events?.RESTORE_WEBGL || 'restorewebgl';
    renderer?.on?.(st.loseEvent, st.lost);
    renderer?.on?.(st.restoreEvent, st.restored);
    scene.events?.once('shutdown', () => {
      renderer?.off?.(st.loseEvent, st.lost);
      renderer?.off?.(st.restoreEvent, st.restored);
      dispose(scene, st);
      scene._lightingGPU = null;
      scene._lightGPUPlan = null;
      scene._lightGPUBase = null;
      scene._lightGPUGradient = null;
    });
    return st;
  }
  function deleteTargets(scene, st) {
    const r = st.renderer;
    if (st.output) {
      r.deleteFramebuffer(st.output.framebuffer);
      if (scene.textures.exists(st.key)) scene.textures.remove(st.key);
      else r.deleteTexture(st.output.texture);
      st.output = null;
    }
    if (st.reach) {
      r.deleteFramebuffer(st.reach.framebuffer);
      r.deleteTexture(st.reach.texture);
      st.reach = null;
    }
  }
  function dispose(scene, st) {
    fallback(scene);
    deleteTargets(scene, st);
    for (const source of st.sources.values()) st.renderer.deleteTexture(source.texture);
    st.sources.clear();
    if (st.program) st.renderer.deleteProgram(st.program);
    if (st.buffer) st.renderer.deleteBuffer(st.buffer);
    st.program = st.buffer = null;
  }
  function target(st, width, height, linear = false) {
    const r = st.renderer, gl = r.gl;
    const texture = r.createTexture2D(0, linear ? gl.LINEAR : gl.NEAREST, linear ? gl.LINEAR : gl.NEAREST,
      gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.RGBA, null, width, height, true, false, false);
    try {
      const framebuffer = r.createFramebuffer(width, height, texture, false);
      return { texture, framebuffer, width, height };
    } catch (error) {
      r.deleteTexture(texture);
      throw error;
    }
  }
  function prepare(scene, st, width, height) {
    const r = st.renderer, gl = r.gl;
    if (!st.program) st.program = r.createProgram(VERTEX, FRAGMENT);
    if (!st.buffer) st.buffer = r.createVertexBuffer(st.vertices, gl.DYNAMIC_DRAW);
    if (!st.locations) {
      const program = st.program.webGLProgram;
      st.locations = {
        position: gl.getAttribLocation(program, 'aPosition'),
        uv: gl.getAttribLocation(program, 'aUV'),
        size: gl.getUniformLocation(program, 'uSize'),
        alpha: gl.getUniformLocation(program, 'uAlpha'),
        source: gl.getUniformLocation(program, 'uSource'),
      };
    }
    if (!st.output || st.output.width !== width || st.output.height !== height) {
      fallback(scene);
      deleteTargets(scene, st);
      st.output = target(st, width, height, true);
      st.reach = target(st, width, height);
      scene.textures.addGLTexture(st.key, st.output.texture);
    }
    gl.useProgram(st.program.webGLProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.buffer.webGLBuffer);
    gl.enableVertexAttribArray(st.locations.position);
    gl.enableVertexAttribArray(st.locations.uv);
    gl.vertexAttribPointer(st.locations.position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(st.locations.uv, 2, gl.FLOAT, false, 16, 8);
    gl.uniform2f(st.locations.size, width, height);
    gl.uniform1i(st.locations.source, 0);
  }
  function upload(st, item, linear) {
    const r = st.renderer, gl = r.gl, canvas = item.canvas;
    let source = st.sources.get(canvas);
    if (!source) {
      source = { texture: null, revision: undefined };
      st.sources.set(canvas, source);
    }
    if (!source.texture || source.revision !== item.revision
      || source.width !== canvas.width || source.height !== canvas.height) {
      if (!source.texture) source.texture = r.createTexture2D(0, gl.LINEAR, gl.LINEAR,
        gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.RGBA, canvas, canvas.width, canvas.height, true, false, false);
      else source.texture.update(canvas, canvas.width, canvas.height, false,
        gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.LINEAR, gl.LINEAR, gl.RGBA);
      // The vendor may generate mipmaps on changed power-of-two canvases even
      // with LINEAR sampling. Unchanged sources never enter this upload path.
      source.revision = item.revision;
      source.width = canvas.width; source.height = canvas.height;
      st.uploads++; st.uploadBytes += canvas.width * canvas.height * 4;
    }
    source.used = st.frames;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture.webGLTexture);
    const filter = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return source;
  }
  function bind(st, target, clear) {
    const gl = st.renderer.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer.webGLFramebuffer);
    gl.viewport(0, 0, target.width, target.height);
    if (clear) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  }
  function quad(st, texture, tw, th, x, y, width, height, sx, sy, sw, sh, alpha) {
    const gl = st.renderer.gl, v = st.vertices;
    const x1 = x + width, y1 = y + height;
    const u0 = sx / tw, v0 = sy / th, u1 = (sx + sw) / tw, v1 = (sy + sh) / th;
    v[0]=x; v[1]=y; v[2]=u0; v[3]=v0;
    v[4]=x1; v[5]=y; v[6]=u1; v[7]=v0;
    v[8]=x; v[9]=y1; v[10]=u0; v[11]=v1;
    v[12]=x; v[13]=y1; v[14]=u0; v[15]=v1;
    v[16]=x1; v[17]=y; v[18]=u1; v[19]=v0;
    v[20]=x1; v[21]=y1; v[22]=u1; v[23]=v1;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture.webGLTexture);
    gl.uniform1f(st.locations.alpha, alpha);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    st.draws++;
  }
  function canvasQuad(st, item, x, y, width, height, sx = 0, sy = 0,
    sw = item.canvas.width, sh = item.canvas.height, alpha = 1, linear = false) {
    const source = upload(st, item, linear);
    quad(st, source.texture, source.width, source.height,
      x, y, width, height, sx, sy, sw, sh, alpha);
  }
  function active(scene) {
    const r = scene.sys?.game?.renderer || scene.game?.renderer;
    if (!requested(scene) || !r?.gl || r.type !== global.Phaser?.WEBGL) {
      fallback(scene);
      return false;
    }
    const st = state(scene);
    if (st.disabled || st.contextLost || r.contextLost || r.gl.isContextLost()) {
      fallback(scene);
      return false;
    }
    return true;
  }
  function draw(scene, plan) {
    if (!active(scene)) return false;
    const st = state(scene), r = st.renderer, gl = r.gl;
    const W = plan.width, H = plan.height;
    // Called during scene update. An offscreen caller must fall back without
    // touching its framebuffer, viewport or pending Phaser pipeline state.
    if (r.currentFramebuffer) {
      st.disabled = true;
      st.reason = 'Lighting GPU pass requires the main render target';
      fallback(scene);
      if (scene.lightTex) scene.lightTex.__lightKey = null;
      return false;
    }
    let saved = null;
    const start = global.__boot ? performance.now() : 0;
    try {
      saved = { framebuffer: r.currentFramebuffer };
      // This pass runs during scene update, outside camera rendering. Phaser
      // owns the viewport, scissor and stencil state; no GPU state queries.
      r.pipelines.clear();
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
      prepare(scene, st, W, H);
      st.frames++;
      bind(st, st.output, true);
      gl.blendFunc(gl.ONE, gl.ZERO);
      canvasQuad(st, plan.base, 0, 0, W, H);
      if (plan.reach.masks.length) {
        bind(st, st.reach, true);
        // Phaser ADD uses DST_ALPHA, which is incorrect for transparent masks.
        gl.blendFunc(gl.ONE, gl.ONE);
        for (const mask of plan.reach.masks)
          canvasQuad(st, mask, 0, 0, W, H, mask.sx, mask.sy, W, H, mask.weight);
        gl.blendFunc(gl.DST_ALPHA, gl.ZERO);
        canvasQuad(st, plan.reach.gradient, 0, 0, W, H);
        bind(st, st.output, false);
        gl.blendFunc(gl.ONE, gl.ONE);
        quad(st, st.reach.texture, W, H, 0, 0, W, H, 0, 0, W, H, plan.reach.gain);
      }
      gl.blendFunc(gl.ONE, gl.ONE);
      for (const item of plan.world)
        canvasQuad(st, item, 0, 0, W, H, item.sx, item.sy, W, H);
      for (const stamp of plan.stamps)
        canvasQuad(st, stamp, stamp.x, stamp.y, stamp.width, stamp.height,
          0, 0, stamp.canvas.width, stamp.canvas.height, stamp.alpha, true);
      if (plan.cover) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        canvasQuad(st, plan.cover, plan.cover.x, plan.cover.y,
          plan.cover.canvas.width, plan.cover.canvas.height);
      }
      // All active source canvases are pinned until composition finishes. Drop
      // inactive sources now so GPU uploads cannot keep evicted canvases alive.
      for (const [canvas, source] of st.sources) if (source.used !== st.frames) {
        r.deleteTexture(source.texture); st.sources.delete(canvas);
      }
      scene.lightMap.setTexture(st.key);
      st.reason = null;
      return true;
    } catch (error) {
      st.disabled = true;
      st.reason = error?.message || String(error);
      fallback(scene);
      if (scene.lightTex) scene.lightTex.__lightKey = null;
      return false;
    } finally {
      if (saved && !gl.isContextLost()) {
        // Raw GL must leave Phaser's cached program/blend/buffer state invalid.
        // Restore the framebuffer before rebind, which may touch stencil state.
        gl.bindFramebuffer(gl.FRAMEBUFFER, saved.framebuffer?.webGLFramebuffer || null);
        r.currentFramebuffer = saved.framebuffer;
        r.pipelines.rebind();
        r.resetViewport();
        r.resetScissor();
        r.restoreStencilMask();
        const color = r.config?.backgroundColor;
        if (color) gl.clearColor(color.redGL, color.greenGL, color.blueGL, color.alphaGL);
      }
      if (global.__boot) global.__boot.tick('lighting GPU compose', performance.now() - start);
    }
  }
  function status(scene) {
    const st = scene._lightingGPU;
    const wants = requested(scene), r = scene.sys?.game?.renderer || scene.game?.renderer;
    const supported = !!r?.gl && r.type === global.Phaser?.WEBGL;
    const lost = !!(st?.contextLost || r?.contextLost);
    const enabled = wants && supported && !!st && !st.disabled && !lost
      && st.frames > 0 && scene.lightMap?.texture?.key === st.key;
    const reason = !wants ? 'Not requested' : !supported ? 'WebGL renderer unavailable'
      : lost ? 'WebGL context lost' : st?.reason || null;
    return { requested: wants, active: enabled, reason, frames: st?.frames || 0,
      uploads: st?.uploads || 0, uploadBytes: st?.uploadBytes || 0,
      draws: st?.draws || 0, textures: st?.sources.size || 0 };
  }
  global.LightingGPU = { active, draw, status };
})(window);
