/* Opt-in renderer study: dual-grid 16-state full-tile authored transitions.
 * RA corners span whole source tiles; use buildDualAtlas for this tileset.
 * The secondary 47-state blob API supports packs authored for quarter tiles.
 * Source art remains native-resolution; atlases build once, never in drawCells.
 * A world-coordinate getter must cross WorldGen tile boundaries unchanged.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JungleAutotile = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const BITS = { n: 1, ne: 2, e: 4, se: 8, s: 16, sw: 32, w: 64, nw: 128 };
  const NEIGHBORS = [[0,-1,1],[1,-1,2],[1,0,4],[1,1,8],[0,1,16],[-1,1,32],[-1,0,64],[-1,-1,128]];
  const QUADS = [
    { quadrant:'nw', dx:0, dy:0, a:1, b:64, diagonal:128 },
    { quadrant:'ne', dx:1, dy:0, a:1, b:4, diagonal:2 },
    { quadrant:'sw', dx:0, dy:1, a:16, b:64, diagonal:32 },
    { quadrant:'se', dx:1, dy:1, a:16, b:4, diagonal:8 }
  ];
  function canonicalMask(mask) {
    let out = mask & 255;
    for (const q of QUADS) if (!(out & q.a) || !(out & q.b)) out &= ~q.diagonal;
    return out;
  }
  const MASKS = Object.freeze([...new Set(Array.from({length:256}, (_, i) => canonicalMask(i)))].sort((a,b)=>a-b));
  function maskAt(x, y, getter, match) {
    const center = getter(x,y);
    const accepts = match || (value => value === center);
    let mask = 0;
    for (const [dx,dy,bit] of NEIGHBORS) if (accepts(getter(x+dx,y+dy),x+dx,y+dy)) mask |= bit;
    return canonicalMask(mask);
  }
  function quadrants(mask) {
    mask = canonicalMask(mask);
    return QUADS.map(q => {
      const verticalNeighbor = !!(mask & q.a), horizontalNeighbor = !!(mask & q.b);
      const kind = !verticalNeighbor && !horizontalNeighbor ? 'outer'
        : !verticalNeighbor ? 'horizontal' : !horizontalNeighbor ? 'vertical'
        : !(mask & q.diagonal) ? 'inner' : 'center';
      // Source positions in quarter-tile units within a conventional 3×3 block.
      const sx = (horizontalNeighbor ? 2 : q.dx * 4) + q.dx;
      const sy = (verticalNeighbor ? 2 : q.dy * 4) + q.dy;
      return { quadrant:q.quadrant, kind, dx:q.dx, dy:q.dy, sx, sy };
    });
  }
  function sourceQuarters(mask, options = {}) {
    const size = options.tileSize || 16, half = size / 2;
    if (!Number.isInteger(half)) throw new Error('Autotile tileSize must be even');
    return quadrants(mask).map(q => {
      let sx = (options.x || 0) + q.sx * half;
      let sy = (options.y || 0) + q.sy * half;
      let fallback = false;
      if (q.kind === 'inner') {
        const authored = options.inner && options.inner[q.quadrant];
        if (authored) [sx,sy] = authored;
        else if (options.innerFallback === 'center') fallback = true;
        else throw new Error('Missing authored inner corner: ' + q.quadrant);
      }
      return {...q, sx, sy, width:half, height:half, dx:q.dx*half, dy:q.dy*half, fallback};
    });
  }
  function buildAtlas(source, options = {}) {
    const size = options.tileSize || 16, columns = options.columns || 8;
    const canvas = options.createCanvas ? options.createCanvas() : document.createElement('canvas');
    canvas.width = columns * size; canvas.height = Math.ceil(MASKS.length / columns) * size;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const frames = {}, fallbackMasks = [];
    MASKS.forEach((mask,index) => {
      const x = (index % columns)*size, y = Math.floor(index/columns)*size;
      const parts = sourceQuarters(mask, options);
      if (parts.some(q=>q.fallback)) fallbackMasks.push(mask);
      if (options.underfill) {
        const [ux,uy] = options.underfill;
        ctx.drawImage(source,ux,uy,size,size,x,y,size,size);
      }
      for (const q of parts) ctx.drawImage(source,q.sx,q.sy,q.width,q.height,x+q.dx,y+q.dy,q.width,q.height);
      frames[mask] = {x,y,width:size,height:size};
    });
    return {canvas,frames,masks:MASKS,fallbackMasks};
  }
  // RA's 3×3 patch corners span complete 16px tiles. Dual-grid cells
  // sample four occupancy vertices so those full authored curves stay intact.
  function dualMaskAt(x, y, getter, match = Boolean) {
    return (match(getter(x,y)) ? 1 : 0) | (match(getter(x+1,y)) ? 2 : 0)
      | (match(getter(x,y+1)) ? 4 : 0) | (match(getter(x+1,y+1)) ? 8 : 0);
  }
  function dualTiles(mask, options = {}) {
    mask &= 15;
    const size = options.tileSize || 16, x = options.x || 0, y = options.y || 0;
    const tile = (cx,cy,kind) => ({sx:x+cx*size,sy:y+cy*size,width:size,height:size,kind});
    const outers = {1:[2,2],2:[0,2],4:[2,0],8:[0,0]};
    if (!mask) return [];
    if (mask === 15) return [tile(1,1,'center')];
    if (outers[mask]) return [tile(...outers[mask],'outer')];
    const edges = {3:[1,2],5:[2,1],10:[0,1],12:[1,0]};
    if (edges[mask]) return [tile(...edges[mask],'edge')];
    if (mask === 6 || mask === 9) {
      // Keep diagonal islands disconnected. Both complete source tiles have
      // transparent exteriors and can be composited without manufacturing art.
      const bits = mask === 6 ? [2,4] : [1,8];
      return bits.map(bit=>tile(...outers[bit],'outer'));
    }
    const corner = {7:'se',11:'sw',13:'ne',14:'nw'}[mask];
    const authored = options.inner && options.inner[corner];
    if (!authored) throw new Error('Missing authored full inner corner: '+corner);
    return [{sx:authored[0],sy:authored[1],width:size,height:size,kind:'inner'}];
  }
  function buildDualAtlas(source, options = {}) {
    const size = options.tileSize || 16;
    const canvas = options.createCanvas ? options.createCanvas() : document.createElement('canvas');
    canvas.width = canvas.height = size*4;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const frames = {};
    for (let mask=0;mask<16;mask++) {
      const x=(mask%4)*size,y=Math.floor(mask/4)*size;
      if(options.underfill) ctx.drawImage(source,...options.underfill,size,size,x,y,size,size);
      for(const t of dualTiles(mask,options)) ctx.drawImage(source,t.sx,t.sy,size,size,x,y,size,size);
      frames[mask]={x,y,width:size,height:size};
    }
    return {canvas,frames,masks:Array.from({length:16},(_,i)=>i)};
  }
  return Object.freeze({BITS,MASKS,canonicalMask,maskAt,quadrants,sourceQuarters,buildAtlas,
    dualMaskAt,dualTiles,buildDualAtlas});
});
