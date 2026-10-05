const fs=require('fs'),zlib=require('zlib');
const {decodePng}=require('../../../tools/sprite_audit.js');
const dir=__dirname;
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),o=Buffer.alloc(data.length+12);o.writeUInt32BE(data.length);t.copy(o,4);data.copy(o,8);o.writeUInt32BE(crc(Buffer.concat([t,data])),data.length+8);return o;}
for(const [name,cols,rows,size] of [['sinkhole',4,3,48],['tornado',4,2,48]]){
const src=decodePng(fs.readFileSync(`${dir}/${name === "sinkhole" ? "sinkhole-transparent" : name}-source.png`)),w=cols*size,h=rows*size,raw=Buffer.alloc(h*(w*4+1));
// Source rows vary in height; retain complete objects and align each ground anchor.
const rowBounds=name==='sinkhole'?[[103,370],[399,700],[759,1027]]:[[137,484],[505,844]];
const rowAnchor=name==='sinkhole'?[236,566,892]:[483,843];
const scale=name==='sinkhole'?42/340:42/370;
const targetY=name==='sinkhole'?24:44;
for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
if(name==='sinkhole' && row===2 && col===3)continue;
// Keep a two-pixel export gutter; only alpha-1 source specks fall here.
if(x<2||x>=46||y<2||y>=46)continue;
const sx=Math.floor((col+.5)*src.w/cols+(x+0.5-24)/scale),sy=Math.floor(rowAnchor[row]+(y+0.5-targetY)/scale);
if(sx<col*src.w/cols||sx>=(col+1)*src.w/cols||sy<rowBounds[row][0]||sy>=rowBounds[row][1])continue;
const dx=col*size+x,dy=row*size+y;
src.data.copy(raw,dy*(w*4+1)+1+dx*4,(sy*src.w+sx)*4,(sy*src.w+sx)*4+4);
}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
const target=`${dir}/${name}.png`;fs.writeFileSync(target,Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
const out=decodePng(fs.readFileSync(target));let minOpaque=Infinity;for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){let count=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++)count+=out.data[((r*size+y)*w+c*size+x)*4+3]>0;minOpaque=Math.min(minOpaque,count);}if(!minOpaque && name !== 'sinkhole')throw Error(name+' empty frame');console.log({name,source:[src.w,src.h],export:[w,h],frames:cols*rows,minOpaque});
}
