// Pure rules for the separate, 100 metre Transcendent Arena.
const Arena = (() => {
  const DEPTH = 100, HALF_SIZE_M = 50, ROAD_CLEARANCE_M = 50, REACH_M = 5;
  const CORNERS = [{x:-32,y:-32},{x:32,y:-32},{x:32,y:32},{x:-32,y:32}];
  const CHALLENGES = [
    {id:'sparks',name:'Gather the stars',text:'Touch all eight golden sparks.',mode:'collect',points:[...CORNERS,{x:0,y:-35},{x:35,y:0},{x:0,y:35},{x:-35,y:0}]},
    {id:'runes',name:'The rune sequence',text:'Visit the four runes in their numbered order.',mode:'ordered',points:CORNERS},
    {id:'race',name:'Swift circuit',text:'Touch the four numbered gates in order within 60 seconds.',mode:'ordered',limit:60,points:CORNERS},
    {id:'beams',name:'Dance of light',text:'Survive 30 seconds. Keep clear of the moving violet beam; three hits end the trial.',mode:'survive',duration:30},
    {id:'vigil',name:'Keep the flame',text:'Hold the central golden circle for 15 seconds total. Dodge the expanding violet rings; three hits end the trial.',mode:'hold',duration:15},
  ];
  function inside(center,x,y) { return !!center && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x-center.x)<=HALF_SIZE_M && Math.abs(y-center.y)<=HALF_SIZE_M; }
  function segmentDistance(p,a,b) {
    const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
    const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  }
  function roadClearance(p, roads) {
    let d=Infinity;
    for (const road of roads) for(let i=1;i<road.points.length;i++)
      d=Math.min(d,segmentDistance(p,road.points[i-1],road.points[i])-(road.width||0)/2);
    return d;
  }
  function start(id) {
    if(!CHALLENGES.some(c=>c.id===id)) return null;
    return {id,elapsed:0,held:0,hits:0,cooldown:0,collected:[],status:'playing'};
  }
  function hazard(run) {
    if(run.id==='beams') return {kind:'beam',x:Math.sin(run.elapsed*.7)*55,width:3};
    if(run.id==='vigil') return {kind:'ring',radius:(run.elapsed*9)%60,width:2.5};
    return null;
  }
  // dt is active simulation time only. Pausing, background tabs and reloads
  // never advance a survival clock or complete a challenge.
  function tick(run,position,dt) {
    if(!run || run.status!=='playing') return run;
    const c=CHALLENGES.find(c=>c.id===run.id);
    dt=Math.max(0,Math.min(.1,Number(dt)||0));
    run.elapsed+=dt; run.cooldown=Math.max(0,run.cooldown-dt);
    if(c.points) {
      c.points.forEach((p,i)=>{
        if(!run.collected.includes(i) && (c.mode!=='ordered'||i===run.collected.length) && Math.hypot(position.x-p.x,position.y-p.y)<=REACH_M) run.collected.push(i);
      });
    }
    const h=hazard(run);
    const struck=h && (h.kind==='beam'?Math.abs(position.x-h.x)<=h.width:Math.abs(Math.hypot(position.x,position.y)-h.radius)<=h.width);
    if(struck && !run.cooldown) { run.hits++;run.cooldown=1.5; }
    if(c.mode==='hold' && !struck && Math.hypot(position.x,position.y)<=12) run.held+=dt;
    if(run.hits>=3 || c.limit && run.elapsed>c.limit) run.status='failed';
    else if(c.points && run.collected.length===c.points.length || c.mode==='survive'&&run.elapsed>=c.duration || c.mode==='hold'&&run.held>=c.duration) run.status='won';
    return run;
  }
  return {DEPTH,HALF_SIZE_M,ROAD_CLEARANCE_M,REACH_M,CHALLENGES,inside,segmentDistance,roadClearance,start,hazard,tick};
})();
