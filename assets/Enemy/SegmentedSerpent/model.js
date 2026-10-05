/* Standalone prototype; no game runtime dependencies. */
(function(root){
'use strict';
const STEP=1/120, SPACING=9, COUNT=21, SPEED=42;
// Tail sockets are the centres of the broad bases, measured in native atlas pixels.
// Column order is the tail-tip heading: E, SE, S, SW, W, NW, N, NE.
const TAIL_ANCHORS=[[10,12],[15,11],[16,11],[18,11],[21,12],[18,16],[16,17],[13,16]];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
class Trail {
 constructor(x,y,heading=0){this.points=[];this.distance=0;for(let i=220;i>=0;i--)this.points.push({x:x-Math.cos(heading)*i,y:y-Math.sin(heading)*i,s:-i});}
 append(x,y){const p=this.points[this.points.length-1],d=Math.hypot(x-p.x,y-p.y);if(d<1e-8)return;this.distance+=d;this.points.push({x,y,s:this.distance});while(this.points.length>2&&this.points[1].s<this.distance-260)this.points.shift();}
 sample(behind){const s=this.distance-behind,a=this.points;let lo=0,hi=a.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(a[m].s<s)lo=m;else hi=m;}const p=a[lo],q=a[hi],t=clamp((s-p.s)/(q.s-p.s||1),0,1);return {x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t};}
 chain(){return Array.from({length:COUNT},(_,i)=>{const p=this.sample(i*SPACING),a=this.sample(Math.max(0,i*SPACING-3)),b=this.sample(i*SPACING+3);return {...p,angle:Math.atan2(a.y-b.y,a.x-b.x),index:i};});}
}
const routes={
 winding:[[70,100],[220,65],[350,130],[260,190],[145,170],[80,240],[305,245],[365,85]],
 sharp:[[80,90],[330,90],[330,245],[90,245]],
 reverse:[[80,100],[325,100],[350,130],[325,160],[80,160],[55,130]],
 straight:[[65,165],[365,165]]
};
class Model {
 constructor(mode='winding'){this.reset(mode);}
 reset(mode){this.mode=mode;this.route=routes[mode]||routes.winding;this.x=this.route[0][0];this.y=this.route[0][1];this.heading=0;this.trail=new Trail(this.x,this.y);this.targetIndex=1;this.acc=0;this.ticks=0;this.paused=false;this.pointer=null;this.turnRate=2.5;}
 reverse(){this.pointer={x:this.x-Math.cos(this.heading)*120,y:this.y-Math.sin(this.heading)*120};}
 advance(dt){if(this.paused)return;this.acc+=dt;while(this.acc+1e-10>=STEP){this.acc-=STEP;this.step();}}
 step(){this.ticks++;let target=this.pointer||{x:this.route[this.targetIndex][0],y:this.route[this.targetIndex][1]};const dist=Math.hypot(target.x-this.x,target.y-this.y);if(dist<9){if(this.pointer){return;}if(this.mode==='straight'){this.paused=true;return;}this.targetIndex=(this.targetIndex+1)%this.route.length;target={x:this.route[this.targetIndex][0],y:this.route[this.targetIndex][1]};}
 const want=Math.atan2(target.y-this.y,target.x-this.x);this.heading+=clamp(angleDelta(want,this.heading),-this.turnRate*STEP,this.turnRate*STEP);this.x+=Math.cos(this.heading)*SPEED*STEP;this.y+=Math.sin(this.heading)*SPEED*STEP;this.trail.append(this.x,this.y);
 }
 chain(){const p=this.trail.chain();p[0].angle=this.heading;return p;}
}
const api={Model,Trail,STEP,SPACING,COUNT,SPEED,angleDelta,TAIL_ANCHORS};if(typeof module!=='undefined')module.exports=api;root.SerpentPrototype=api;
})(typeof window==='undefined'?globalThis:window);
