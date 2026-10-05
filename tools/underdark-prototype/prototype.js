/* Standalone art study. The runtime cave painters provide the comparison and
 * grit. Material masks stay separate from solidity, so a future runtime pass
 * can resolve these from immutable surface provenance without changing gates.
 * All detail is seeded in scene coordinates, never chunk-local coordinates.
 */
(() => {
  'use strict';
  const S = 32, W = 32, H = 20, PW = W * S, PH = H * S;
  const canvas = document.getElementById('scene'), ctx = canvas.getContext('2d');
  const control = Object.fromEntries(['material','lighting','grid','zoom','status'].map(k => [k, document.getElementById(k)]));
  const grid = new Uint8Array(W * H);
  const spider = document.getElementById('spider-art');
  const nests = [{x:5.5,y:4.8,type:2},{x:25,y:5.8,type:3}];
  const hash = (x,y,s=0) => { let n = Math.imul(x+811,374761393)^Math.imul(y+173,668265263)^s; n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967296; };
  const random = seed => () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  const layer = () => { const c=document.createElement('canvas'); c.width=PW;c.height=PH;return c; };
  const at = (x,y) => x<0 || y<0 || x>=W || y>=H ? 0 : grid[y*W+x];
  function reset() {
    grid.fill(0);
    const rect=(x,y,w,h,k)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)grid[j*W+i]=k;};
    rect(0,9,32,2,1); rect(14,0,3,20,1); rect(13,8,5,4,1);
    rect(3,2,6,3,2); rect(4,1,4,1,2); rect(4,5,4,1,2);
    rect(22,2,7,4,3);rect(23,1,4,1,3);rect(23,6,5,1,3);rect(21,3,1,2,3);
    rect(3,14,8,1,1);rect(3,17,8,1,1);rect(3,15,1,2,1);
    rect(22,14,5,3,1);rect(24,13,2,1,1);rect(23,17,3,1,1);
    draw();
  }
  // Four quadrant corner decisions. Exposed outer corners round inward;
  // concave corners cut a small inlet. Shared edges never get tile outlines.
  function inside(px,py,kind) {
    const x=Math.floor(px/S),y=Math.floor(py/S);
    if(at(x,y)!==kind)return false;
    const u=px%S,v=py%S,dx=u<16?-1:1,dy=v<16?-1:1;
    const a=at(x+dx,y)===kind,b=at(x,y+dy)===kind,d=at(x+dx,y+dy)===kind;
    const ex=dx<0?u:31-u,ey=dy<0?v:31-v;
    // Shallow scallops soften long road-derived sides without crossing the
    // footprint. World-coordinate phases continue over every chunk seam.
    if(!a && ex < Math.round(1.5+1.5*Math.sin(py*.34)))return false;
    if(!b && ey < Math.round(1.5+1.5*Math.sin(px*.31)))return false;
    if(!a&&!b&&ex<9&&ey<9)return (ex-9)**2+(ey-9)**2<=81;
    if(a&&b&&!d&&ex<4&&ey<4)return ex*ex+ey*ey>=16;
    return true;
  }
  function mask(kind) {
    const c=layer(),g=c.getContext('2d');g.fillStyle='#fff';
    for(let y=0;y<PH;y++)for(let x=0;x<PW;x++)if(inside(x,y,kind))g.fillRect(x,y,1,1);
    return c;
  }
  function oval(g,x,y,rx,ry,colour) {
    g.fillStyle=colour;
    for(let row=-Math.ceil(ry);row<=ry;row++){
      const span=Math.floor(rx*Math.sqrt(Math.max(0,1-row*row/(ry*ry))));
      if(span)g.fillRect(Math.round(x)-span,Math.round(y)+row,span*2+1,1);
    }
  }
  function line(g,points,colour,width=1) {
    g.strokeStyle=colour;g.lineWidth=width;g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();
  }
  const floor=layer(),fg=floor.getContext('2d'),rock=layer(),rg=rock.getContext('2d');
  // Same native scale and painters as src/textures.js; cached once like the
  // runtime biome texture pool. The preview changes only the proposed base.
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const tile=document.createElement('canvas');tile.width=tile.height=S;
    drawCaveFloorTex(tile.getContext('2d'),S,random(1+Math.floor(hash(x,y)*100000)));
    fg.drawImage(tile,x*S,y*S);
    drawCaveWallTex(tile.getContext('2d'),S,random(1+Math.floor(hash(x,y,9)*100000)));
    rg.drawImage(tile,x*S,y*S);
  }
  function cap(g,x,y,r,tone,lit=false) {
    const ry=Math.max(3,Math.floor(r*.46));
    oval(g,x,y+4,r+1,ry+1,'#211729');
    oval(g,x,y+2,r,ry,tone===2?'#4b394e':'#493052');
    for(let i=-r+3;i<r-2;i+=3)line(g,[[x+i,y+1],[x+Math.round(i*.7),y+ry+3]],lit?'#82bbb7':'#80617f');
    oval(g,x,y-1,r,ry,tone===3?'#64465e':tone===2?'#65516c':'#755184');
    oval(g,x-1,y-3,r-2,Math.max(1,ry-2),tone===3?'#866077':tone===2?'#80708b':'#98719f');
    line(g,[[x-r+3,y-2],[x-r+5,y-4],[x+r-5,y-4]],tone===3?'#a17b90':'#ae8ab4');
  }
  function paintMass(kind) {
    const m=mask(kind),c=layer(),g=c.getContext('2d');
    g.fillStyle=kind===2?'#42364d':kind===3?'#4a3045':'#51345e';g.fillRect(0,0,PW,PH);
    // Large overlapping tissue lobes use a global coarse lattice, independent
    // of cell borders. Sparse bright shelves concentrate on exposed edges.
    for(let y=-12;y<PH+20;y+=14)for(let x=-12;x<PW+20;x+=20){
      const h=hash(x,y,kind),cx=x+Math.round(h*12),cy=y+Math.round(hash(x,y,7)*9);
      oval(g,cx,cy,10+Math.floor(h*10),5+Math.floor(h*5),kind===3?'#382737':'#382842');
      oval(g,cx,cy-2,9+Math.floor(h*10),4+Math.floor(h*5),kind===3?'#67475a':kind===2?'#57445f':'#694779');
      if(h>.62)line(g,[[cx-5,cy-4],[cx,cy-6],[cx+5,cy-4]],'#896189');
    }
    for(let y=5;y<PH;y+=17)for(let x=5;x<PW;x+=23){
      const h=hash(x,y,27),px=x+Math.floor(h*10),py=y+Math.floor(hash(x,y,6)*11);
      if(!inside(px,py,kind))continue;
      const edge=!inside(px,py+12,kind)||!inside(px-12,py,kind)||!inside(px+12,py,kind);
      if((edge&&h>.12)||h>.94)cap(g,px,py,6+Math.floor(h*7),kind,edge&&h>.83);
    }
    g.globalCompositeOperation='destination-in';g.drawImage(m,0,0);
    // A short south face stays within the solid cell. It does not occlude an
    // adjacent walkable cell or imply that the corridor is narrower.
    g.globalCompositeOperation='source-atop';
    for(let y=0;y<PH;y++)for(let x=0;x<PW;x++){
      if(!inside(x,y,kind))continue;
      if(!inside(x,y+1,kind)){g.fillStyle='#211827';g.fillRect(x,y,1,1);}
      else if(!inside(x,y+4,kind)){g.fillStyle='#38243f';g.fillRect(x,y,1,1);}
      else if(!inside(x,y-1,kind)){g.fillStyle='#aa84b1';g.fillRect(x,y,1,1);}
    }
    ctx.drawImage(c,0,0);
  }
  function nest(n) {
    const x=n.x*S,y=n.y*S,cy=Math.floor(n.y),cx=Math.floor(n.x);
    if(at(cx,cy)!==n.type)return;
    // Baked nest dressing is clipped to its surviving solid footprint.
    const c=layer(),g=c.getContext('2d');
    if(n.type===2){
      for(let i=0;i<7;i++){
        const ax=x-63+i*20,ay=y-65+Math.abs(i-3)*6;
        line(g,[[ax,ay],[x-18+i*6,y-15],[x+(-3+i)*16,y+7]],'#a49aaa');
      }
      for(let j=0;j<4;j++)line(g,[[x-66+j*8,y-40+j*9],[x-25,y-25+j*8],[x+18,y-28+j*8],[x+65-j*7,y-44+j*10]],'#797582');
      for(const [dx,dy]of [[-42,-11],[-34,-5],[35,-8],[43,-16]]){
        oval(g,x+dx,y+dy,5,7,'#575062');oval(g,x+dx-1,y+dy-2,4,5,'#b5afba');
        line(g,[[x+dx-3,y+dy-4],[x+dx+2,y+dy+3]],'#d4ced1');
      }
    } else {
      for(const [dx,dy,r]of [[-48,-39,13],[-13,-61,16],[26,-44,20],[51,-13,11],[-37,1,9]]){
        oval(g,x+dx,y+dy+3,r,r*.72,'#312335');oval(g,x+dx,y+dy,r,r*.72,'#8c627e');
        oval(g,x+dx-3,y+dy-4,r*.55,r*.4,'#b18b9c');
        line(g,[[x+dx-2,y+dy-5],[x+dx+2,y+dy],[x+dx,y+dy+6]],'#60455f');
      }
    }
    oval(g,x,y,23,16,n.type===2?'#8f8095':'#916383');
    oval(g,x,y+3,18,12,'#211a2b');oval(g,x,y+6,13,8,'#100f1b');
    for(let i=-16;i<=16;i+=8)line(g,[[x+i,y-8],[x+i*.7,y-1]],n.type===2?'#c2b8c7':'#b184a5');
    g.globalCompositeOperation='destination-in';g.drawImage(mask(n.type),0,0);ctx.drawImage(c,0,0);
  }
  const lights=[[11.2,8.3],[18.1,11.5],[6.8,16.3],[27.8,12.5],[20.8,3.5]];
  function draw() {
    const fungal=control.material.value==='fungus';
    ctx.fillStyle=fungal?'#292534':'#2a2622';ctx.fillRect(0,0,PW,PH);ctx.globalAlpha=fungal?.55:1;ctx.drawImage(floor,0,0);ctx.globalAlpha=1;
    if(fungal){
      // Sparse flat mycelium: one continuous local motif, never a raised prop.
      for(let k=0;k<75;k++){
        const x=Math.floor(hash(k,2)*PW),y=Math.floor(hash(k,4)*PH);
        if(at(Math.floor(x/S),Math.floor(y/S)))continue;
        line(ctx,[[x-9,y+4],[x,y],[x+10,y-2],[x+17,y-8]],'#40354e');
        line(ctx,[[x,y],[x+2,y-6],[x-2,y-10]],'#40354e');
      }
      for(let x=4*S;x<11*S;x+=13)line(ctx,[[x,16*S+7],[x+6,16*S+4],[x+13,16*S+6]],'#61506e');
      [1,2,3].forEach(paintMass);nests.forEach(nest);
      for(const [x,y]of lights){
        cap(ctx,x*S,y*S,7,1,true);cap(ctx,x*S+9,y*S+5,4,1,true);
      }
      if(spider.complete && spider.naturalWidth){
        ctx.imageSmoothingEnabled=false;
        // Shipping 16px frame: ordinary 24px, giant 38.4px. Floor seats are
        // illustrative and do not create live encounters or spawn exceptions.
        ctx.drawImage(spider,0,0,16,16,5.5*S-19,6.4*S-19,38.4,38.4);
        ctx.drawImage(spider,0,0,16,16,7.6*S-12,6.9*S-12,24,24);
      }
    }else{
      for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(at(x,y)){
        ctx.fillStyle='#332e26';ctx.fillRect(x*S,y*S,S,S);ctx.drawImage(rock,x*S,y*S,S,S,x*S,y*S,S,S);
      }
    }
    if(control.lighting.checked){
      const darkness=layer(),g=darkness.getContext('2d');g.fillStyle='rgba(8,6,20,.44)';g.fillRect(0,0,PW,PH);
      g.globalCompositeOperation='destination-out';
      const glow=(x,y,r,strength)=>{const grad=g.createRadialGradient(x,y,3,x,y,r);grad.addColorStop(0,`rgba(0,0,0,${strength})`);grad.addColorStop(1,'transparent');g.fillStyle=grad;g.fillRect(x-r,y-r,r*2,r*2);};
      glow(12*S,13*S,180,.98);lights.forEach(([x,y])=>glow(x*S,y*S,65,.75));
      ctx.drawImage(darkness,0,0);
      if(fungal)for(const [x,y]of lights){const grad=ctx.createRadialGradient(x*S,y*S,0,x*S,y*S,42);grad.addColorStop(0,'rgba(110,194,186,.13)');grad.addColorStop(1,'transparent');ctx.fillStyle=grad;ctx.fillRect(x*S-42,y*S-42,84,84);}
    }
    if(control.grid.checked){
      for(let x=0;x<=PW;x+=S)line(ctx,[[x+.5,0],[x+.5,PH]],'#b7a2c333');
      for(let y=0;y<=PH;y+=S)line(ctx,[[0,y+.5],[PW,y+.5]],'#b7a2c333');
      ctx.setLineDash([5,5]);line(ctx,[[16*S+.5,0],[16*S+.5,PH]],'#e5bd7a',1);ctx.setLineDash([]);
      ctx.fillStyle='#e5bd7a';ctx.font='11px system-ui';ctx.fillText('Chunk A | Chunk B',16*S+8,18);
    }
    window.underdarkPrototype={grid,draw,reset,inside,hash,cellSize:S};
  }
  canvas.addEventListener('click',event=>{
    const r=canvas.getBoundingClientRect(),x=Math.floor((event.clientX-r.left)*PW/r.width/S),y=Math.floor((event.clientY-r.top)*PH/r.height/S);
    if(x<0||x>=W||y<0||y>=H)return;
    if(at(x,y)){grid[y*W+x]=0;draw();control.status.textContent=`Dug cell ${x}, ${y}. The footprint and adjacent corners have been rebuilt.`;}
    else control.status.textContent=`Cell ${x}, ${y} is open floor. Choose a raised fungal bank or nest shell.`;
  });
  for(const name of ['material','lighting','grid'])control[name].addEventListener('change',draw);
  control.zoom.addEventListener('change',()=>{canvas.style.width=control.zoom.value==='fit'?'100%':`${PW*Number(control.zoom.value)}px`;});
  document.getElementById('reset').addEventListener('click',()=>{reset();control.status.textContent='Original layout restored. Click a solid cell to dig.';});
  document.getElementById('export').addEventListener('click',()=>{const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='underdark-fungal-study.png';a.click();});
  spider.addEventListener('load',draw);
  reset();
})();
