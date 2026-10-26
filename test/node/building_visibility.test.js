// The player ghost behind a building requires full projected body coverage by visible faces,
// not footprint entry or a bounding rectangle. Home and flat wrecks never count.
(() => {
  const ring = [{x:0,y:0},{x:80,y:0},{x:80,y:80},{x:0,y:80}];
  const triangle = [{x:0,y:0},{x:80,y:0},{x:0,y:80}];
  const scene = (x,y) => ({ save: {starterShopId:'home'}, mapRot:0,
    playerScreen:()=>({x,y}), player:{visible:true,x,y,displayWidth:16,displayHeight:24,originX:.5,originY:1} });
  test('building cover: footprint entry alone cannot hide an uncovered player', () => {
    assert.falsy(Render.buildingCoversPlayer(scene(40,40),'other',ring,[],{x:40,y:40}));
    assert.falsy(Render.buildingCoversPlayer(scene(100,100),'other',ring,[],{x:40,y:40}));
    assert.falsy(Render.buildingCoversPlayer(scene(40,40),'home',ring,[],{x:40,y:40}),'Home keeps its roof-cutaway behavior');
  });
  test('building cover: visible faces in front of the whole body hide the player', () => {
    const s=scene(30,35);
    assert.truthy(Render.buildingCoversPlayer(s,'other',[],[triangle],{x:40,y:80}));
    assert.falsy(Render.buildingCoversPlayer(s,'other',[],[triangle],{x:40,y:10}),'a building behind the player hides nothing');
    assert.falsy(Render.buildingCoversPlayer(scene(75,75),'other',[],[triangle],{x:40,y:90}),
      'empty corner of a triangle bounding box does not hide the player');
  });
  test('building cover: projected overlap and front ordering follow the compass', () => {
    const s=scene(15,25);s._headingUp=true;s.mapRot=Math.PI;
    assert.truthy(Render.buildingCoversPlayer(s,'other',[],[triangle],{x:40,y:10}),
      'a north building draws in front when looking south');
    assert.falsy(Render.buildingCoversPlayer(s,'other',[],[triangle],{x:40,y:80}),
      'a south building now draws behind the player');
  });
  test('building cover: retained pan offsets apply to footprint and face overlap', () => {
    assert.truthy(Render.buildingCoversPlayer(scene(130,135),'other',ring,[triangle],{x:40,y:80},{x:100,y:100}));
    assert.falsy(Render.buildingCoversPlayer(scene(40,40),'other',ring,[],{x:40,y:40},{x:100,y:100}));
  });
  test('building cover: hidden player and concave courtyard hide nothing', () => {
    const s=scene(40,40);s.player.visible=false;
    assert.falsy(Render.buildingCoversPlayer(s,'other',ring,[triangle],{x:40,y:80}));
    const elbow=[{x:0,y:0},{x:80,y:0},{x:80,y:20},{x:20,y:20},{x:20,y:80},{x:0,y:80}];
    assert.falsy(Render.buildingCoversPlayer(scene(40,40),'other',elbow,[],{x:40,y:80}));
  });
  test('building cover: partial overlap hides nothing at every compass heading', () => {
    for(let step=0;step<16;step++) {
      const a=step*Math.PI/8,s=scene(0,0);s._headingUp=true;s.mapRot=a;
      const toMap=p=>({x:Math.cos(a)*p.x+Math.sin(a)*p.y,y:-Math.sin(a)*p.x+Math.cos(a)*p.y});
      const faces=(right)=>[[{x:-10,y:-30},{x:right,y:-30},{x:right,y:5}],
        [{x:-10,y:-30},{x:right,y:5},{x:-10,y:5}]].map(t=>t.map(toMap));
      const anchor=toMap({x:0,y:10});
      assert.falsy(Render.buildingCoversPlayer(s,'other',ring,faces(4),anchor),'body edge remains visible');
      assert.truthy(Render.buildingCoversPlayer(s,'other',ring,faces(10),anchor),'entire body covered by two faces');
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
  test('building cover: castle grounds count their pieces, flat wrecks never hide the player', () => {
    const s={alpha:1,depth:2,visible:true,x:0,y:0,originX:.5,originY:1,scaleX:1,scaleY:1,frame:{width:20,height:20},
      _staticObject:{kind:'castle_wall',castle:'c'},setAlpha(a){this.alpha=a;}};
    const art={layer:WorldLayers.STANDING_PROP,spec:{},texKey:'none'};
    const body={x0:-2,x1:2,y0:-12,y1:-8};
    assert.truthy(Render.objectCoversPlayer(s,art,body,1,null,true));
    assert.falsy(Render.objectCoversPlayer(s,art,body,1,null,false));
    assert.falsy(Render.objectCoversPlayer(s,{...art,layer:WorldLayers.GROUND_DECAL},body,1,null,true),'flat wreck is a ground object');
    assert.eq(s.alpha,1,'the piece itself never fades');
  });
})();
