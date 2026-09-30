// Shared by the audit cards and the sandbox. A gentle colour transfer, not a
// palette quantizer: keep source shades, dark outlines and highlight contrast.
globalThis.ArtPreviewColour = (() => {
  const luma = c => c[0]*.2126+c[1]*.7152+c[2]*.0722;
  const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const clamp = n => Math.max(0,Math.min(255,Math.round(n)));
  function recolour(canvas,hexes,options={}) {
    const strength=options.strength??.18;
    if(!hexes?.length||strength<=0)return canvas;
    const palette=hexes.map(p=>rgb(typeof p==='string'?p:p.hex));
    const ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const ramp=[...palette].sort((a,b)=>luma(a)-luma(b));
    if(options.mode==='scarecrow-contrast'){
      const source=new Uint8ClampedArray(pixels.data),w=canvas.width,h=canvas.height;
      const alpha=(x,y)=>x<0||y<0||x>=w||y>=h?0:source[(y*w+x)*4+3];
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=(y*w+x)*4;if(source[i+3]<200)continue;
        const colour=Array.from(source.slice(i,i+3)),light=luma(colour);
        const edge=alpha(x-1,y)<100||alpha(x+1,y)<100||alpha(x,y+1)<100;
        const target=edge?Math.min(light,48):Math.max(0,Math.min(240,(light-125)*1.28+130));
        colour.forEach((v,k)=>pixels.data[i+k]=clamp(v+target-light));
      }
      ctx.putImageData(pixels,0,0);return canvas;
    }
    if(options.mode==='approved-apple'){
      // Preserve the exact earlier apple treatment the user selected.
      let lo=255,hi=0;
      for(let i=0;i<pixels.data.length;i+=4){if(!pixels.data[i+3])continue;const v=luma(pixels.data.subarray(i,i+3));lo=Math.min(lo,v);hi=Math.max(hi,v);}
      for(let i=0;i<pixels.data.length;i+=4){if(!pixels.data[i+3])continue;const at=Math.round((luma(pixels.data.subarray(i,i+3))-lo)/Math.max(1,hi-lo)*(ramp.length-1));pixels.data.set(ramp[at],i);}
      ctx.putImageData(pixels,0,0);return canvas;
    }
    for(let i=0;i<pixels.data.length;i+=4){
      if(!pixels.data[i+3])continue;
      const source=Array.from(pixels.data.slice(i,i+3)),light=luma(source);
      // Silhouette ink and bright glints carry readability at map scale.
      if(light<55||light>235)continue;
      let target;
      if(options.preserveLuminance===false){
        // Continuous ramp interpolation for the explicitly weathered state.
        // Retains gradients instead of snapping every shade to a few colours.
        const at=light/255*(ramp.length-1),a=Math.floor(at),b=Math.ceil(at),t=at-a;
        target=ramp[a].map((v,k)=>v+(ramp[b][k]-v)*t);
      }else{
        let best=Infinity;
        for(const colour of palette){
          const cl=luma(colour);
          const distance=source.reduce((sum,v,k)=>sum+(v-light-(colour[k]-cl))**2,0);
          if(distance<best){best=distance;target=colour.map(v=>light+v-cl);}
        }
      }
      source.forEach((v,k)=>pixels.data[i+k]=clamp(v+(target[k]-v)*strength));
    }
    ctx.putImageData(pixels,0,0);return canvas;
  }
  return {recolour};
})();
