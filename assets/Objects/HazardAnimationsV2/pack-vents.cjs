// Pack generated inactive aperture into the approved, unchanged vent ring.
const fs=require('fs'),zlib=require('zlib'),{decodePng}=require('../../../tools/sprite_audit.js');
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(t,d){const b=Buffer.alloc(d.length+12);b.writeUInt32BE(d.length);b.write(t,4);d.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;}
function write(name,w,h,data){const raw=Buffer.alloc(h*(w*4+1));for(let y=0;y<h;y++)data.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);const ih=Buffer.alloc(13);ih.writeUInt32BE(w);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;fs.writeFileSync(__dirname+'/'+name,Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
const active=decodePng(fs.readFileSync(__dirname+'/vent-cycle.png'));
const draft=decodePng(fs.readFileSync(__dirname+'/vent-inactive-source.png'));
const inactive=Buffer.alloc(24*72*4),cycle=Buffer.alloc(120*72*4);
for(let row=0;row<3;row++)for(let y=14;y<24;y++)for(let x=0;x<24;x++){
 const from=((row*24+y)*active.w+x)*4,to=((row*24+y)*24+x)*4;
 active.data.copy(inactive,to,from,from+4);
 const [r,g,b,a]=active.data.subarray(from,from+4);
 const plume=x>=8&&x<=15&&(y<=18||(y<=20&&x>=10&&x<=13))&&a&&(row===0?g>r*1.2&&g>b*1.1:row===1?r>g*1.4:r>b*1.4&&g>b*1.4);
 if(plume){const sx=Math.round(588+(x-11.5)*14),sy=[289,675,1062][row]+Math.round((y-14)*15+40),si=(sy*draft.w+sx)*4;
 // Keep the aperture dark, using generated stone-hole pixels rather than plume.
 const v=Math.min(24,Math.round((draft.data[si]+draft.data[si+1]+draft.data[si+2])/12));
 inactive.set([v,v,v,255],to);}
}
for(let row=0;row<3;row++)for(let y=0;y<24;y++)for(let x=0;x<24;x++){
 let p=((row*24+y)*24+x)*4;inactive.copy(cycle,((row*24+y)*120+x)*4,p,p+4);
 for(let col=0;col<4;col++){p=((row*24+y)*96+col*24+x)*4;active.data.copy(cycle,((row*24+y)*120+(col+1)*24+x)*4,p,p+4);}
}
write('vent-inactive.png',24,72,inactive);write('vent-cycle-complete.png',120,72,cycle);
write('poison-vent-inactive.png',24,24,inactive.subarray(0,24*24*4));
