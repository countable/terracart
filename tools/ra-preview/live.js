(async()=>{
 const style=document.createElement('link');style.rel='stylesheet';style.href='/tools/ra-preview/layout.css';document.head.append(style);
 const theme=new URLSearchParams(location.search).get('raPreview')==='jungle'?'jungle':'village';
 const hud=document.createElement('div');hud.id='ra-preview-controls';hud.style='position:fixed;top:0;left:0;right:0;z-index:999999;background:#17231eee;color:#fff;padding:8px;font:14px sans-serif;text-align:center';
 hud.innerHTML=`<a style="color:#cff" href="/?sandbox=true&headingUp=false&raPreview=village">Village</a> · <a style="color:#cff" href="/?sandbox=true&headingUp=false&raPreview=jungle">Jungle</a> · <span id="ra-status">Loading playable preview…</span>`;document.body.append(hud);
 const script=src=>new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=reject;document.head.append(el);});
 while(!window.__scene?._bootOverlayGone)await new Promise(r=>setTimeout(r,100));
 await script("/tools/ra-preview/layout.js");
 const s=__scene;s.scene.pause();
 if(s.terrainCache){s.terrainCache.enabled=false;s.terrainCache.image.setVisible(false);}
 await script(`/tools/ra-preview/${theme}-fixture.js`);
 const layout=await(await fetch(`/tools/${theme}-study/reference-layout.json`)).json();
 window.__raOriginalSpecs={...Render.objectAppearance(s,{}).RENDER_SPEC};
 createRAFixture(layout);
 window.__sandboxSkipStory=true;window.__sandboxSkipTutorial=true;
 s.disableGpsForSession();s.gpsM={...s.playerM};s.syncMoveTarget();
 Quests.starterSkipAll(s.save);s.updateObjectiveDOM();
 s.save.energy=100;
 if(theme==='jungle'){
 const im=new Image();im.src='/'+layout.ground_marks[0].source;await im.decode();
 const marks=layout.ground_marks,c=document.createElement('canvas');c.width=marks.length*16;c.height=16;
 const ctx=c.getContext('2d');marks.forEach((m,i)=>ctx.drawImage(im,...m.crop,i*16,0,16,16));
 const tex=s.textures.addCanvas('jungle_leaves',c);marks.forEach((m,i)=>tex.add(i,0,i*16,0,16,16));
 Render.objectAppearance(s,{}).RENDER_SPEC.jungle_leaf={key:'jungle_leaves',frame:o=>o.jungleLeaf,scale:2,origin:[.5,.5],seat:false,groundAtOrigin:true,layer:WorldLayers.GROUND_DECAL,shadow:false};
 }
 await script('/tools/jungle-autotile.js');await script('/tools/jungle-study/lighting.js');installStudyLighting();
 await script(`/tools/${theme}-study/apply.js`);await window[theme==='village'?'applyVillage':'applyJungle']();
 const drawCells=Render.drawCells;
 Render.drawCells=function(sc){const result=drawCells.apply(this,arguments);if(sc===s&&!s.depth)window[theme==='village'?'__villageGround':'__jungleGround']();return result;};
 const hidden=['fogContainer','atmosGroundGfx','atmosRimGfx','reachGfx','labelContainer','letterContainer','_sandboxLabels','tierGfx','buildingGeomContainer','buildingWallContainer'];
 s.events.on('postupdate',()=>{if(!s.depth)hidden.forEach(k=>s[k]?.setVisible?.(false));s.player?.setVisible(true);s.playerShadow?.setVisible(true);});
 s.player?.setVisible(true);s.playerShadow?.setVisible(true);
 s.scene.resume();s.anims.resumeAll();s.tweens.resumeAll();
 window.__raPreview={ready:true,theme,scene:s};
 document.querySelector('#ra-status').textContent='WASD / arrows to walk · Tap objects · Disposable preview save';
})().catch(e=>{console.error(e);document.querySelector('#ra-status').textContent='Preview failed: '+e.message;});
