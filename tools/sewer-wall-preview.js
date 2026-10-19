/* Material-only study over the production rockwall geometry. No game/save mutations. */
(async () => {
  'use strict';
  await loadGame();
  const C = 32, TOP = Math.round(C / 2), LIFT = CAVE_WALL_TOP_LIFT, FH = C + LIFT;
  const sheet = new Image();
  sheet.src = '../extra_assets/16x16/Sewers%20Tileset/Tilesets/sewers_tiles.png';
  await sheet.decode();
  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  let original;
  // Capture the real texture generator rather than approximating its corners.
  makeCaveWallEdges({ textures: {
    exists: () => false,
    createCanvas: (_, w, h) => {
      original = canvas(w, h);
      return { getContext: () => original.getContext('2d'), add() {}, refresh() {} };
    },
  } }, C);
  const sewer = canvas(original.width, original.height), sg = sewer.getContext('2d');
  sg.imageSmoothingEnabled = false;
  sg.drawImage(original, 0, 0);
  for (let variant = 0; variant < 4; variant++) for (let mask = 0; mask < 64; mask++) {
    const x = mask * C, y = variant * FH;
    sg.save(); sg.beginPath(); sg.rect(x, y, C, FH); sg.clip();
    // Keep the original silhouette, chipped rim, inward shading and recessed sides.
    sg.globalCompositeOperation = 'source-atop';
    sg.fillStyle = 'rgba(0,0,0,.46)'; sg.fillRect(x, y, C, FH);
    if (mask & 4) {
      // Formerly 16 source px occupied 32 screen px. Now they occupy 16 screen
      // px: exactly half the texture scale, tiled instead of stretching the face.
      const insetLeft = mask & 8 ? 1 : 0, insetRight = mask & 2 ? 1 : 0;
      sg.save(); sg.beginPath();
      sg.rect(x + insetLeft, y + TOP + 1, C - insetLeft - insetRight, FH - TOP - 2);
      sg.clip();
      for (let yy = TOP + 1; yy < FH; yy += 16) for (let xx = 0; xx < C; xx += 16) {
        sg.drawImage(sheet, 6*16, 3*16, 16, 16, x+xx, y+yy, 16, 16);
      }
      sg.fillStyle = 'rgba(0,0,0,.13)'; sg.fillRect(x, y+TOP+1, C, FH-TOP-1);
      sg.fillStyle = 'rgba(0,0,0,.16)'; sg.fillRect(x, y+FH-4, C, 3);
      sg.restore();
    }
    // One brick course turns over the exposed lip. Draw only the original
    // rim's three-pixel footprint; connected interiors remain dark rock.
    // The north/south band is drawn last so corner junctions have one owner.
    const capHeight = mask & 4 ? TOP : FH;
    const wrap = (vertical, edge, inward, start, length) => {
      for (let k = 0; k < 3; k++) for (let t = start; t < start + length; t++) {
        const dx = vertical ? edge + inward*k : t;
        const dy = vertical ? t : edge + inward*k;
        // Same mortar spacing as the half-scale face, compressed across the lip.
        const sx = t % 16, sy = 3 + k;
        sg.drawImage(sheet, 6*16+sx, 3*16+sy, 1, 1, x+dx, y+dy, 1, 1);
        sg.fillStyle = `rgba(255,235,205,${k === 0 ? .12 : k === 1 ? .06 : 0})`;
        sg.fillRect(x+dx, y+dy, 1, 1);
      }
    };
    if (mask & 8) wrap(true, 0, 1, 0, capHeight);
    else if (mask & 16) wrap(true, 0, 1, TOP, FH-TOP);
    if (mask & 2) wrap(true, C-1, -1, 0, capHeight);
    else if (mask & 32) wrap(true, C-1, -1, TOP, FH-TOP);
    if (mask & 1) wrap(false, 0, 1, 0, C);
    if (mask & 4) wrap(false, TOP, -1, 0, C);
    sg.restore();
  }
  const main = ['##########','##########','###....###','##......##','#...##...#',
    '#...##....','#........#','##..#...##','###.....##','####..####'];
  const cases = [
    ['Island / four outer corners', ['......','......','..##..','..##..','......','......']],
    ['Recessed staircase', ['######','##...#','###..#','####.#','##...#','######']],
    ['Thin walls / junctions', ['......','..#...','.####.','..#...','..###.','......']],
  ];
  function render(target, map, material, decorate = false, phase = 0, channel = false) {
    const rows = map.length, cols = map[0].length;
    target.width = cols*C; target.height = rows*C+LIFT;
    const g = target.getContext('2d'); g.imageSmoothingEnabled = false;
    const solid = (x,y) => y < 0 || y >= rows || x < 0 || x >= cols || map[y][x] === '#';
    const tile = (tx,ty,x,y,w=C,h=C) => g.drawImage(sheet,tx*16,ty*16,16,16,x,y,w,h);
    g.fillStyle = '#171512'; g.fillRect(0,0,target.width,target.height);
    for (let y=0;y<rows;y++) for (let x=0;x<cols;x++) tile(5,6,x*C,y*C+LIFT);
    if (channel) {
      const fx=(phase%3)*5, fy=Math.floor(phase/3)*5;
      for (let x=0;x<cols;x++) {
        if (!solid(x,6)) tile(2+fx,18+fy,x*C,6*C+LIFT);
        if (!solid(x,5) && !solid(x,6)) g.drawImage(sheet,(2+fx)*16,(16+fy)*16,16,5,x*C,6*C+LIFT-10,C,10);
        if (!solid(x,7) && !solid(x,6)) g.drawImage(sheet,(2+fx)*16,(20+fy)*16+11,16,5,x*C,7*C+LIFT,C,10);
      }
    }
    if (decorate) {
      // Same-pack cracked slabs and a flush drain tile; all seats are open cells.
      for (const [x,y,tx,ty] of [[4,2,2,6],[5,2,3,6],[6,3,4,6],[2,5,4,8]]) tile(tx,ty,x*C,y*C+LIFT);
    }
    for (let y=0;y<rows;y++) for (let x=0;x<cols;x++) {
      if (!solid(x,y)) continue;
      let mask=(!solid(x,y-1)?1:0)|(!solid(x+1,y)?2:0)|(!solid(x,y+1)?4:0)|(!solid(x-1,y)?8:0);
      if (!(mask&4)) {
        if (solid(x-1,y)&&!solid(x-1,y+1)) mask|=16;
        if (solid(x+1,y)&&!solid(x+1,y+1)) mask|=32;
      }
      const variant=((x*31)^y)&3;
      g.drawImage(material,mask*C,variant*FH,C,FH,x*C,y*C,C,FH);
    }
    if (decorate) {
      for (const [x,y,tx,ty] of [[3,0,10,0],[4,0,10,2],[5,0,10,2],[6,0,12,0],
        [3,1,11,3],[6,1,11,3],[3,2,12,5],[6,2,13,5]]) tile(tx,ty,x*C,y*C);
      tile(13,5,4*C,5*C+8);
      for (const [x,y,tx,ty] of [[2,4,2,10],[7,4,3,10],[6,8,5,10]]) tile(tx,ty,x*C,y*C+LIFT);
    }
  }
  function draw(phase = 0) {
    render(document.getElementById('original'),main,original,false,phase,true);
    render(document.getElementById('materials'),main,sewer,false,phase,true);
    render(document.getElementById('example'),main,sewer,true,phase,true);
  }
  for (const [name,map] of cases) {
    const figure = document.createElement('figure'), caption = document.createElement('figcaption');
    caption.textContent=name; figure.append(caption);
    const a=canvas(1,1),b=canvas(1,1);render(a,map,original);render(b,map,sewer);
    const pair=canvas(a.width*2,a.height),g=pair.getContext('2d');g.drawImage(a,0,0);g.drawImage(b,a.width,0);
    figure.append(pair);document.getElementById('checks').append(figure);
  }
  draw();
  let timer = null, phase = 0;
  document.getElementById('animate').onclick = () => {
    if (timer) { clearInterval(timer);timer=null;document.getElementById('animate').textContent='Animate water'; }
    else { timer=setInterval(()=>draw(phase=(phase+1)%8),160);document.getElementById('animate').textContent='Pause water'; }
  };
  // Export hook for the saved review and table thumbnail; no independent renderer.
  window.sewerPreview = { draw, original, sewer, cell:C, frameHeight:FH, ready:true };
  document.getElementById('status').textContent='Ready · original geometry · face texture 50% · 3px brick lip · 3 corner fixtures';
})().catch(error => { document.getElementById('status').textContent=error.message;console.error(error); });
