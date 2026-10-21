// Building visibility requires full projected body coverage by visible faces,
// not footprint entry or a bounding rectangle. Home and flat wrecks stay opaque.
(() => {
  const ring = [{x:0,y:0},{x:80,y:0},{x:80,y:80},{x:0,y:80}];
  const triangle = [{x:0,y:0},{x:80,y:0},{x:0,y:80}];
  const scene = (x,y) => ({ save: {starterShopId:'home'}, mapRot:0,
    playerScreen:()=>({x,y}), player:{visible:true,x,y,displayWidth:16,displayHeight:24,originX:.5,originY:1} });
  test('building fade: footprint entry alone cannot fade an uncovered player', () => {
    assert.eq(Render.buildingFadeAlpha(scene(40,40),'other',ring,[],{x:40,y:40}),1);
    assert.eq(Render.buildingFadeAlpha(scene(100,100),'other',ring,[],{x:40,y:40}),1);
    assert.eq(Render.buildingFadeAlpha(scene(40,40),'home',ring,[],{x:40,y:40}),1,'Home keeps its roof-cutaway behavior');
  });
  test('building fade: visible face overlap behind a building halves opacity', () => {
    const s=scene(30,35);
    assert.eq(Render.buildingFadeAlpha(s,'other',[],[triangle],{x:40,y:80}),.5);
    assert.eq(Render.buildingFadeAlpha(s,'other',[],[triangle],{x:40,y:10}),1,'a building behind the player stays opaque');
    assert.eq(Render.buildingFadeAlpha(scene(75,75),'other',[],[triangle],{x:40,y:90}),1,
      'empty corner of a triangle bounding box does not hide the player');
  });
  test('building fade: projected overlap and front ordering follow the compass', () => {
    const s=scene(15,25);s._headingUp=true;s.mapRot=Math.PI;
    assert.eq(Render.buildingFadeAlpha(s,'other',[],[triangle],{x:40,y:10}),.5,
      'a north building draws in front when looking south');
    assert.eq(Render.buildingFadeAlpha(s,'other',[],[triangle],{x:40,y:80}),1,
      'a south building now draws behind the player');
  });
  test('building fade: retained pan offsets apply to footprint and face overlap', () => {
    assert.eq(Render.buildingFadeAlpha(scene(130,135),'other',ring,[triangle],{x:40,y:80},{x:100,y:100}),.5);
    assert.eq(Render.buildingFadeAlpha(scene(40,40),'other',ring,[],{x:40,y:40},{x:100,y:100}),1);
  });
  test('building fade: hidden player and concave courtyard remain opaque', () => {
    const s=scene(40,40);s.player.visible=false;
    assert.eq(Render.buildingFadeAlpha(s,'other',ring,[triangle],{x:40,y:80}),1);
    const elbow=[{x:0,y:0},{x:80,y:0},{x:80,y:20},{x:20,y:20},{x:20,y:80},{x:0,y:80}];
    assert.eq(Render.buildingFadeAlpha(scene(40,40),'other',elbow,[],{x:40,y:80}),1);
  });
  test('building fade: partial overlap stays opaque at every compass heading', () => {
    for(let step=0;step<16;step++) {
      const a=step*Math.PI/8,s=scene(0,0);s._headingUp=true;s.mapRot=a;
      const toMap=p=>({x:Math.cos(a)*p.x+Math.sin(a)*p.y,y:-Math.sin(a)*p.x+Math.cos(a)*p.y});
      const faces=(right)=>[[{x:-10,y:-30},{x:right,y:-30},{x:right,y:5}],
        [{x:-10,y:-30},{x:right,y:5},{x:-10,y:5}]].map(t=>t.map(toMap));
      const anchor=toMap({x:0,y:10});
      assert.eq(Render.buildingFadeAlpha(s,'other',ring,faces(4),anchor),1,'body edge remains visible');
      assert.eq(Render.buildingFadeAlpha(s,'other',ring,faces(10),anchor),.5,'entire body covered by two faces');
    }
  });
  test('building coverage: union spans triangle seams but preserves courtyard holes', () => {
    const box={x0:0,y0:0,x1:10,y1:10};
    const rect=(x0,y0,x1,y1)=>[[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1}],
      [{x:x0,y:y0},{x:x1,y:y1},{x:x0,y:y1}]];
    assert.truthy(Render.buildingTrianglesCover(rect(0,0,10,10),box));
    const hole=[...rect(0,0,10,4),...rect(0,6,10,10),...rect(0,0,4,10),...rect(6,0,10,10)];
    assert.falsy(Render.buildingTrianglesCover(hole,box),'four covered corners and overlapping faces cannot hide a hole');
    assert.truthy(Render.buildingTrianglesCover([...hole,...rect(4,4,6,6)],box));
  });
  test('building fade: sprite footprint opacity resets and flat wrecks never fade', () => {
    const s={alpha:1,depth:0,visible:true,setAlpha(a){this.alpha=a;}};
    const art={layer:WorldLayers.STANDING_PROP,spec:{}};
    Render.fadeObjectOverPlayer(s,art,null,1,1,null,true);assert.eq(s.alpha,.5);
    Render.fadeObjectOverPlayer(s,art,null,1,1,null,false);assert.eq(s.alpha,1);
    Render.fadeObjectOverPlayer(s,{...art,layer:WorldLayers.GROUND_DECAL},null,1,1,null,true);
    assert.eq(s.alpha,1,'flat wreck is a ground object');
  });
})();
