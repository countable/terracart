// Deterministic Canvas2D baker. Shares the review's exact colour transform.
// All coordinates and replacement crops come from the declarative audit.
globalThis.bakeApprovedMapArt = async function(jobs) {
  const output=[];
  const blank=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  const load=async src=>{const im=new Image();im.src=src;await im.decode();return im;};
  function shade(c,style){
    if(!style)return;
    const ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height);
    const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
    const wash=rgb(style.wash),murk=rgb(style.murk);
    for(let i=0;i<d.data.length;i+=4)for(let k=0;k<3;k++)d.data[i+k]=Math.floor((d.data[i+k]+(wash[k]-d.data[i+k])*style.washA)*(1-style.murkA)+murk[k]*style.murkA+.5);
    ctx.putImageData(d,0,0);
  }
  function moss(c){
    const ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height),before=new Uint8ClampedArray(d.data);
    const alpha=(x,y)=>x<0||y<0||x>=c.width||y>=c.height?0:before[(y*c.width+x)*4+3];
    const edges=[];
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const i=(y*c.width+x)*4,L=before[i]*.2126+before[i+1]*.7152+before[i+2]*.0722;
      // The outermost pixel is dark contour ink; moss belongs immediately
      // inside that edge, never in place of the silhouette's outline.
      if(alpha(x,y)<200||L<55||L>220||alpha(x,y-2)>0&&alpha(x-2,y)>0&&alpha(x+2,y)>0)continue;
      edges.push({x,y,i,order:((x*17+y*31)%97)});
    }
    edges.sort((a,b)=>a.order-b.order);
    // Four or fewer exposed pixels per quantity silhouette: material detail,
    // not a new outline or a replacement for the pair/single reward shape.
    for(const {i} of edges.slice(0,4))for(let k=0;k<3;k++)d.data[i+k]=Math.round(before[i+k]*.45+[89,99,56][k]*.55);
    ctx.putImageData(d,0,0);
  }
  for(const job of jobs){
    const source=job.baseKey?output.find(o=>o.key===job.baseKey)?.uri
      :job.procedural?MapArtProcedural.render(job.procedural).toDataURL():job.source;
    if(!source)throw new Error('Missing bake source '+job.key);
    const im=await load(source),sheet=blank(im.width,im.height),cx=sheet.getContext('2d');cx.imageSmoothingEnabled=false;cx.drawImage(im,0,0);
    if(job.whiteKey){const d=cx.getImageData(0,0,sheet.width,sheet.height);for(let i=0;i<d.data.length;i+=4)if(Math.min(d.data[i],d.data[i+1],d.data[i+2])>240)d.data[i+3]=0;cx.putImageData(d,0,0);}
    const before=sheet.toDataURL();
    for(const op of job.operations){
      const [x,y,w,h]=op.rect,frame=blank(w,h),ctx=frame.getContext('2d');ctx.imageSmoothingEnabled=false;
      if(op.candidate){
        const candidate=await load(op.candidate),scale=Math.min(w/candidate.width,h/candidate.height),cw=Math.round(candidate.width*scale),ch=Math.round(candidate.height*scale);
        ctx.drawImage(candidate,Math.floor((w-cw)/2),h-ch,cw,ch);
      }else ctx.drawImage(sheet,x,y,w,h,0,0,w,h);
      shade(frame,op.stateShade);
      ArtPreviewColour.recolour(frame,op.palette,{strength:op.strength,preserveLuminance:op.preserveLuminance,mode:op.mode,colourMap:op.colourMap,paletteStrength:op.paletteStrength});
      if(op.moss)moss(frame);
      cx.clearRect(x,y,w,h);cx.drawImage(frame,x,y);
    }
    output.push({key:job.key,uri:sheet.toDataURL(),before,width:sheet.width,height:sheet.height});
  }
  return output;
};
