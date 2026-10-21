(async()=>{
 const layout=await(await fetch('/tools/dreamland-square-study/reference-layout.json')).json();
 while(!window.__scene?._bootOverlayGone)await new Promise(r=>setTimeout(r,100));
 const s=__scene;s.scene.pause();s.dreamlandReferenceShell=true;s._dreamlandGroundFamilyAt=()=>0;
 s._tickHomeZoom=()=>{};s._setRestZoom(1,1);s._applyMapZoom();window.__onGameScaleChange?.();
 s.ensureStarterTrailerObject=()=>{};s.ensureStarterShopId=()=>{};s.save.starterShopId=null;
 const pc=s.playerToWorldCell(),e=WorldGen.tileCache.get(WorldGen.tileKey(pc.tx,pc.ty)),N=e.cellsPerEdge,cm=e.tileEdgeM/N,cx=Math.floor(N/2),cy=Math.floor(N/2);
 const anchor={x:pc.tx*e.tileEdgeM+(cx+.5)*cm,y:pc.ty*e.tileEdgeM+(cy+.5)*cm};
 const world=(x,y)=>({x:anchor.x+(x-320)*cm/32,y:anchor.y+(y-180)*cm/32});
 for(const en of WorldGen.tileCache.values()){
  en.grid.fill(0);en.objects=[];en.wildplants=[];en.creatures=[];en.layers=[];en.buildingShapes=[];en.owners.fill(0);
  for(const k of ['zone','zoneDress','scenic','scenicDress','streetIndex','streetDress','streetArea','treasure','streetGround','slowCells','streetMarks','_objectIndex','_preCullLights'])en[k]=null;
  for(const k of ['extraTreasures','parkingTreasures','coinDrops','traps','streetLairs'])en[k]=[];en.roadUnder={};en.pathUnder={};
 }
 for(const k of ['planted','fires','furniture','floorTiles','chopped','spent'])s.save[k]=[];s.save.firepit=null;s.save.restoredHouses={};s.save.unlockedForts={};
 s.playerM={x:anchor.x-s.startWorldM.x,y:anchor.y-s.startWorldM.y};s.peekM={x:0,y:0};s.syncMoveTarget?.();
 const load=async(key,url)=>{if(s.textures.exists(key))return;const im=new Image();im.src='/'+url;await im.decode();s.textures.addImage(key,im);};
 const sheets=[...new Set(layout.ground.map(r=>r.source))];for(let i=0;i<sheets.length;i++)await load('reference_ground_'+i,sheets[i]);
 for(const o of layout.objects.filter(o=>o.kind==='actor')){await load(o.key,'extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland/Characters/Character_'+o.key.slice(-3)+'.png');s.textures.get(o.key).add('south',0,...(o.rect||[48,0,24,24]));}
 for(const o of layout.objects.filter(o=>o.source)){await load(o.key,o.source);s.textures.get(o.key).add('crop',0,...o.rect);}
 const common=(p,id)=>({id,...p,...world(p.x,p.y),tx:pc.tx,ty:pc.ty,_ix:Math.floor(cx+(p.x-320)/32),_iy:Math.floor(cy+(p.y-180)/32)});
 e.objects=layout.houses.map(h=>common({kind:'house',tier:h.tier,referenceModel:h.referenceModel,referenceChimney:h.referenceChimney,x:h.x,y:h.y-h.d/2,area:h.w*h.d*(cm/32)**2},'reference-'+h.id));
 e.buildingShapes=layout.houses.map(h=>{const corners=[[h.x-h.w/2,h.y-h.d],[h.x+h.w/2,h.y-h.d],[h.x+h.w/2,h.y],[h.x-h.w/2,h.y]].map(([x,y])=>world(x,y));return {key:'reference-'+h.id,tier:h.tier,areaM2:h.w*h.d*(cm/32)**2,ring:Float32Array.from(corners.flatMap(p=>[p.x-pc.tx*e.tileEdgeM,p.y-pc.ty*e.tileEdgeM]))};});
 const spec=Render.objectAppearance(s,{}).RENDER_SPEC;
 spec.reference_prop={key:o=>o.kindOf==='lamp'&&!s._referenceRestored?'dreamland_lamp_unlit':o.kindOf==='fountain'?'dreamland_fountain_water':o.key,frame:o=>o.kindOf==='fountain'?(s._referenceFrozen?0:Math.floor(performance.now()/200)%4):o.kindOf==='actor'?'south':o.source?'crop':'__BASE',scale:o=>o.scale||2,origin:[.5,1],seat:false,groundAtOrigin:true,layer:WorldLayers.STANDING_PROP,after:(sprite,o)=>sprite.setFlipX(!!o.flipX)};
 e.objects.push(...layout.objects.map((o,i)=>common({...o,kind:'reference_prop',kindOf:o.kind},'reference-prop-'+i)));
 if(s.terrainCache){s.terrainCache.enabled=false;s.terrainCache.image.setVisible(false);}
 const ground=[];
 // The source view ends at640x360; continue its native olive base outside
 // those authored cells so rotating does not reveal an image-shaped seam.
 s.noiseContainer.add(s.add.tileSprite(s.viewCenterX,s.viewCenterY,2200,2200,'dreamland_ground_base'));
 for(const row of layout.ground){const key='reference_ground_'+sheets.indexOf(row.source),tex=s.textures.get(key),frame=row.rect.join('_');if(!tex.has(frame))tex.add(frame,0,...row.rect);const p=s.worldMetersToScreen(...Object.values(world(...row.at)));const bg=s.add.rectangle(p.x,p.y,32,32,Phaser.Display.Color.GetColor(...row.background)).setOrigin(0);const im=s.add.image(p.x,p.y,key,frame).setOrigin(0).setScale(2);s.noiseContainer.add([bg,im]);ground.push(bg,im);}
 function hide(){for(const k of ['lightMap','shadowContainer','fogContainer','atmosGroundGfx','atmosRimGfx','reachGfx','auraContainer','fxContainer','sparkContainer','labelContainer','letterContainer','_sandboxLabels','ghostGlowContainer','tierGfx','enemyHealthGfx','_workProgressGfx','playerHalo','gpsGhost','blightAura','facingGfx','facingChevronGfx','projGfx','swordSwingGfx','boltContainer','_huCover','_huNorth','_huNoCompass'])s[k]?.setVisible?.(false);for(const c of s.children.list){c.clearMask?.();if(c._huUI&&c.depth===89)c.setVisible(false);}s.player.setVisible(false);s.playerWorldContainer?.setVisible(false);s.creaturePool?.forEach(o=>o.setVisible(false));s.towerPool?.forEach(o=>o.setVisible(false));document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto,#bootload,#safety-card').forEach(el=>el.style.display='none');}
 window.__dreamlandDraw=(restored=true)=>{
  s._referenceRestored=restored;
  s.save.restoredHouses=restored?Object.fromEntries(e.objects.filter(o=>o.kind==='house'&&o.tier===9).map(o=>[o.id,'plain'])):{};s.save.unlockedForts=restored?Object.fromEntries(e.objects.filter(o=>o.tier===11).map(o=>[o.id,true])):{};
  s._lastBorderIX=NaN;s._lastBorderIY=NaN;s._roadGeomKey=null;s._buildingGeomKey=null;s.drawCells();s.drawRoadGeometry();s._overlayFrameSeq++;s.drawBuildingGeometry();s._streetLamps=[];s.drawObjects();hide();
  return {objects:e.objects.map(o=>({id:o.id,kind:o.kind,x:o.x,y:o.y})),art:DreamlandObjects.status(s),buildings:s._lowpoly?.buildings.map(m=>({key:m.key,authored:m.authoredKey,faces:m.faces.length})),groundTiles:layout.ground.length,sourceLayout:layout,gl:__game.renderer.gl.getError()};
 };
 window.__dreamlandReference={ready:true,layout,draw:__dreamlandDraw,rotate(deg){s.mapRot=deg*Math.PI/180;s._huManualAngle=s.mapRot;s._applyMapZoom();BuildingLowPoly.update(s);hide();},captureRect:{x:16,y:s.viewCenterY-180,width:640,height:360}};
 __dreamlandDraw(true);
 // The authored map pauses simulation; forward keys through the production
 // heading handler while Phaser's paused scene input is inactive.
 window.addEventListener('keydown',event=>HeadingUp.keyTurn(s,event));
 __game.events.on('step',(time,dt)=>{for(const sprite of s.objectPool||[])if(sprite.visible&&sprite.texture?.key==='dreamland_fountain_water')sprite.setFrame(s._referenceFrozen?0:Math.floor(performance.now()/200)%4);HeadingUp.tick(s,Math.min(.05,(dt||16)/1000));s._applyMapZoom();BuildingLowPoly.update(s);hide();});
 const hud=document.createElement('div');hud.id='reference-controls';hud.style='position:fixed;top:0;left:0;right:0;z-index:999999;background:#17231eee;color:white;padding:10px;text-align:center;font:14px system-ui';hud.innerHTML='Dreamland reference map · Q / E to rotate · <button id="ref-north">0°</button> <button id="ref45">45°</button> <button id="ref90">90°</button> <button id="ref-condition">Show wrecks</button>';document.body.append(hud);let restored=true;document.querySelector('#ref-condition').onclick=()=>{restored=!restored;__dreamlandDraw(restored)};for(const [id,deg]of [['ref-north',0],['ref45',45],['ref90',90]])document.getElementById(id).onclick=()=>__dreamlandReference.rotate(deg);
 const css=document.createElement('style');css.textContent=`html,body{margin:0;background:#182322!important;overflow:auto!important}body>:not(#frame):not(#reference-controls):not(script):not(style){display:none!important}#frame{position:absolute!important;left:50%!important;top:90px!important;width:640px!important;height:360px!important;transform:translateX(-50%) scale(var(--reference-scale,1))!important;transform-origin:top center!important;overflow:hidden!important;border:0!important;background:none!important}#game{position:relative!important;left:0!important;top:0!important;transform:none!important;width:640px!important;height:360px!important;overflow:hidden!important;clip-path:none!important;mask:none!important;box-shadow:none!important}#game canvas{position:absolute!important;left:-16px!important;top:-${s.viewCenterY-180}px!important;width:672px!important;height:844px!important;image-rendering:pixelated}#frame>:not(#game),#game>:not(canvas){display:none!important}#reference-controls{line-height:1.8;box-sizing:border-box}#reference-controls button{font:inherit;margin:0 3px}`;document.head.append(css);
 const resize=()=>document.documentElement.style.setProperty('--reference-scale',Math.min(1,(innerWidth-24)/640));resize();window.addEventListener('resize',resize);
})().catch(e=>{console.error(e);window.__dreamlandReferenceError=String(e);});
