const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {decodePng}=require('../../../tools/sprite_audit.js');
const dir=__dirname;
const names=['parts'];
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),o=Buffer.alloc(data.length+12);o.writeUInt32BE(data.length);t.copy(o,4);data.copy(o,8);o.writeUInt32BE(crc(Buffer.concat([t,data])),data.length+8);return o;}
const checks=[];
for(const name of names){
const sourcePath=path.join(dir,name+'-source.png');if(!fs.existsSync(sourcePath))continue;
const src=decodePng(fs.readFileSync(sourcePath)),w=256,h=128,raw=Buffer.alloc(h*(w*4+1));
for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(x%32===0||x%32===31||y%32===0||y%32===31)continue;const sx=Math.floor((Math.floor(x/32)+(x%32-.5)/30)*src.w/8),sy=Math.floor((Math.floor(y/32)+(y%32-.5)/30)*src.h/4);src.data.copy(raw,y*(w*4+1)+1+x*4,(sy*src.w+sx)*4,(sy*src.w+sx)*4+4);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
const target=path.join(dir,name+'.png');fs.writeFileSync(target,Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
const out=decodePng(fs.readFileSync(target));const frames=[];
for(let r=0;r<4;r++)for(let c=0;c<8;c++){let count=0,x0=32,x1=-1,y0=32,y1=-1;for(let y=0;y<32;y++)for(let x=0;x<32;x++){if(out.data[((r*32+y)*w+c*32+x)*4+3]>128){count++;x0=Math.min(x,x0);x1=Math.max(x,x1);y0=Math.min(y,y0);y1=Math.max(y,y1);}}if(!count)throw Error(name+' empty frame '+(r*8+c));frames.push({index:r*8+c,opaque:count,bounds:[x0,y0,x1,y1]});}
checks.push({name,source:[src.w,src.h],native:[w,h],frame:[32,32],frames});console.log(name,src.w+'x'+src.h,'=>',w+'x'+h,'32 nonempty frames');
}
fs.writeFileSync(dir+'/export-checks.json',JSON.stringify(checks,null,2)+'\n');
