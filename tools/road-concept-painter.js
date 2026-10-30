// Preview-only pavement studies. Transparent joints retain the ground beneath.
(function (root) {
  'use strict';
  function paint(ctx, size, concept, restored) {
    const n = Math.max(16, Math.round(size));
    const colors = concept.colors || ['#8a8274', '#b5ad99', '#686355'];
    const family = concept.surface || concept.family || concept.pattern || 'fieldstone';
    let seed = 1967;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const unit = n / 32;
    const rect = (x, y, w, h) => ctx.fillRect(Math.round(x * unit), Math.round(y * unit), Math.max(1, Math.round(w * unit)), Math.max(1, Math.round(h * unit)));
    const stone = (x, y, w, h, index) => {
      ctx.globalAlpha = restored ? .96 : .76;
      ctx.fillStyle = colors[index % colors.length];
      rect(x, y, w, h);
      if (restored && w > 3 && h > 3) {
        ctx.globalAlpha = .23;
        ctx.fillStyle = colors[(index + 1) % colors.length];
        rect(x + 1, y, w - 2, 1);
      }
    };
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, n, n);
    ctx.globalAlpha = .2;
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, n, n);
    if (family === 'formal_setts') {
      for (let y = -8, row = 0; y < 32; y += 8, row++)
        for (let x = -8 + (row % 2) * 4; x < 32; x += 8)
          stone(x, y, 7, 7, (row + Math.floor((x + 8) / 8)) % colors.length);
    } else if (family === 'herringbone') {
      // Each diagonal band alternates perpendicular rectangular bricks.
      for (let y = -16; y < 40; y += 4) for (let x = -16; x < 40; x += 4) {
        const band = ((x + y) / 4 % 4 + 4) % 4;
        if (band === 0) stone(x, y, 7, 3, Math.abs(x / 4) % colors.length);
        if (band === 2) stone(x, y, 3, 7, Math.abs(y / 4) % colors.length);
      }
    } else if (family === 'flagstone') {
      [[0,0,15,11],[16,0,15,7],[16,8,7,11],[24,8,7,11],[0,12,7,11],[8,12,7,7],[8,20,15,11],[24,20,7,11],[0,24,7,7]].forEach((r,i)=>stone(...r,i));
    } else if (family === 'fieldstone') {
      for (let y = -4; y < 32; y += 8) for (let x = -5; x < 32; x += 9) {
        const dx = Math.floor(random() * 3), dy = Math.floor(random() * 2);
        const w = 5 + Math.floor(random() * 3), h = 5 + Math.floor(random() * 2);
        const color = Math.floor(random() * colors.length);
        stone(x + dx + 1, y + dy, w - 2, h, color);
        stone(x + dx, y + dy + 1, w, h - 2, color);
      }
    } else if (family === 'boardwalk') {
      for (let y = 0; y < 32; y += 8) {
        stone(0, y, 32, 7, y / 8);
        ctx.fillStyle = colors[(y / 8 + 1) % colors.length];
        ctx.globalAlpha = .4;
        rect(4, y + 2, 10, 1); rect(18, y + 4, 9, 1);
        ctx.globalAlpha = .8;
        rect(1, y + 3, 1, 1); rect(30, y + 3, 1, 1);
      }
    } else if (family === 'stepping_stones') {
      [[2,2,10,11],[19,5,10,9],[5,21,9,9],[21,22,9,8]].forEach(([x,y,w,h],i)=> {
        stone(x+2,y,w-4,h,i); stone(x,y+2,w,h-4,i);
      });
    } else if (family === 'inlaid_tiles') {
      for (let y = 0; y < 32; y += 8) for (let x = 0; x < 32; x += 8) {
        stone(x,y,7,7,(x+y)/8);
        ctx.fillStyle = colors[((x+y)/8+1)%colors.length];
        ctx.globalAlpha = restored ? .95 : .65;
        rect(x+3,y+1,1,5); rect(x+1,y+3,5,1);
      }
    } else {
      for (let i = 0; i < 130; i++) {
        const x = Math.floor(random()*32), y = Math.floor(random()*32);
        stone(x,y,1+Math.floor(random()*2),1+Math.floor(random()*2),i);
      }
    }
    if (!restored) {
      // Sparse missing chips expose the same translucent ground wash.
      for (let i = 0; i < 18; i++) {
        const x=Math.floor(random()*32), y=Math.floor(random()*32);
        ctx.clearRect(Math.round(x*unit),Math.round(y*unit),Math.max(1,Math.round(unit)),Math.max(1,Math.round(unit)));
        ctx.globalAlpha=.2; ctx.fillStyle=colors[0]; rect(x,y,1,1);
      }
    }
    ctx.restore();
  }
  root.RoadConceptPainter = { paint };
})(typeof window !== 'undefined' ? window : globalThis);
