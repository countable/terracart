// Scene integration for a realm with its own WorldGen tile cache. Only wins
// survive a reload; incomplete trials restart from the arena's safe portal.
class SceneArena {
  // Boot recovers the saved return anchor, never an unfinished trial clock.
  _recoverArenaRun() {
    if (this.save.depth !== Arena.DEPTH) return;
    const portal = this.save.arenaRun?.return || this.save.arena?.portal;
    this.save.depth = 0;
    delete this.save.arenaRun;
    if (portal) {
      this.playerM.x = portal.x - this.startWorldM.x;
      this.playerM.y = portal.y - this.startWorldM.y;
    }
    persistSave(this.save);
  }

  async usePortalStone() {
    if(Inventory.count(this.save,'portal_stone')<1 || Combat.playerDowned(this.save.energy) || this.isTooFast()) return false;
    if(this.depth!==0) { this.flashAtPlayer('Create the portal on the surface.'); return false; }
    try { await this.ensureTilesAround(); }
    catch (_) { this.flashAtPlayer('The map is still loading. Try the stone again.');return false; }
    if(this.depth!==0 || Inventory.count(this.save,'portal_stone')<1 || Combat.playerDowned(this.save.energy) || this.isTooFast()) return false;
    const p=playerWorldM(this); p.y+=this.feetOffsetM;
    const cell=this.cellAt(p.x,p.y);
    if(!cell.loaded || !WorldGen.isWalkable(cell.type) || cell.underRoad) {
      this.flashAtPlayer('Find open ground at least 50m from every road.'); return false;
    }
    const tile=worldMetersToTile(this,p.x,p.y),roads=[];
    // Require the full surrounding ring: missing map data cannot prove safety.
    for(let ty=tile.ty-1;ty<=tile.ty+1;ty++) for(let tx=tile.tx-1;tx<=tile.tx+1;tx++) {
      const e=WorldGen.tileCache.get(WorldGen.tileKey(tx,ty));
      if(!e?.grid || !e.layers) { this.flashAtPlayer('Wait for the surrounding map to load.'); return false; }
      for(const l of e.layers) if(l.name==='transportation') for(const f of l.features||[]) {
        if(f.type!==2 || ['rail','transit'].includes(f.tags?.class)) continue;
        const scale=WorldGen.TILE_PX/(l.extent||4096);
        for(const line of f.geom||[]) roads.push({width:WorldGen.roadOverlayWidthM(f.tags||{}),points:line.map(q=>({
          x:this.startWorldM.x+(tx*WorldGen.TILE_PX+q.x*scale-this.originPx.x)*this.mPerPx,
          y:this.startWorldM.y+(ty*WorldGen.TILE_PX+q.y*scale-this.originPx.y)*this.mPerPx,
        }))});
      }
    }
    if(Arena.roadClearance(p,roads)<Arena.ROAD_CLEARANCE_M) { this.flashAtPlayer('The portal needs 50m of clear ground from every road.'); return false; }
    this.save.arena ||= {};
    this.save.arena.portal={x:p.x,y:p.y};
    persistSave(this.save);
    this.showConfirmModal({kind:'story',art:'progression_portal',title:'A door beyond the world',body:'The stone anchors one portal here. Reuse it on safe surface ground to move the portal. Enter the Transcendent Arena?',acceptLabel:'Enter',onAccept:()=>this.enterArena()});
    return true;
  }
  _tapArenaPortal(sx,sy) {
    const p=this.save.arena?.portal;
    if(!p || (this.depth!==0 && this.depth!==Arena.DEPTH)) return false;
    const tap=this.screenToWorldMeters(sx,sy);
    if(!sameAbsCell(this,tap.x,tap.y,p.x,p.y)) return false;
    if(Combat.playerDowned(this.save.energy) || this.isTooFast()) return true;
    const feet=playerWorldM(this);feet.y+=this.feetOffsetM;
    if(Math.hypot(feet.x-p.x,feet.y-p.y)>12) {this.flashAtPlayer('Move closer to the portal.');return true;}
    if(this.depth===Arena.DEPTH)this.openArenaMenu();else this.enterArena();
    return true;
  }
  _drawArenaPortal() {
    const p=this.save.arena?.portal,visible=!!p&&(this.depth===0||this.depth===Arena.DEPTH);
    if(!visible) {this._arenaPortalSprite?.setVisible(false);return;}
    if(!this._arenaPortalSprite && this.textures.exists('progression_tiles'))
      this._arenaPortalSprite=this.add.image(0,0,'progression_tiles',3).setDepth(9).setMask(this.cellGfx.mask);
    if(!this._arenaPortalSprite)return;
    const at=this.worldMetersToScreen(p.x,p.y);
    this._arenaPortalSprite.setVisible(true).setPosition(at.x,at.y).setDisplaySize(24,24);
    this._arenaPortalSprite.setFrame(this.depth===Arena.DEPTH?4:3);
  }
  _arenaSwitchDepth(depth,point) {
    if(this._workProgress) this.cancelWorkProgress();
    this._autoMineKey=null; this._shots=[];this._nextShotT={};this._turretNextT={};this._turretScan=null;
    this.depth=this.save.depth=depth;
    WorldGen.setDepth(depth);
    this.playerM.x=point.x-this.startWorldM.x;
    this.playerM.y=point.y-this.startWorldM.y-this.feetOffsetM;
    this.syncMoveTarget();
    this.cameras.main.setBackgroundColor(depth===Arena.DEPTH?'#16132f':'#000');
    this.ensureTilesAround().catch(()=>{});
    persistSave(this.save);
  }
  enterArena() {
    const p=this.save.arena?.portal;
    if(this.depth!==0 || !p || Combat.playerDowned(this.save.energy) || this.isTooFast()) return false;
    const here=playerWorldM(this);
    if(Math.hypot(here.x-p.x,here.y+this.feetOffsetM-p.y)>12) {this.flashAtPlayer('Move closer to the portal.');return false;}
    this.save.arenaRun={return:{...p}};
    this._arenaTrial=null;
    this._arenaSwitchDepth(Arena.DEPTH,p);
    this.openArenaMenu();
    return true;
  }
  exitArena() {
    if(this.depth!==Arena.DEPTH) return false;
    const p=this.save.arenaRun?.return || this.save.arena?.portal || {...playerWorldM(this),y:playerWorldM(this).y+this.feetOffsetM};
    this._arenaTrial=null;
    delete this.save.arenaRun;
    this._arenaSwitchDepth(0,p);
    return true;
  }
  openArenaMenu() {
    if(this.depth!==Arena.DEPTH || this._dialogOpen()) return;
    const {wrap,box,mount,mkBtn}=this.makeModalShell('arena-modal',{kind:'story',art:'progression_arena'});
    const title=document.createElement('h3');title.textContent='Transcendent Arena';box.appendChild(title);
    const info=document.createElement('p');info.textContent='Solve five different trials to earn the key to Level 5. Violet hazards cost a strike; three strikes end a trial.';box.appendChild(info);
    const wins=DungeonProgression.state(this.save).challenges || [];
    for(const c of Arena.CHALLENGES) {
      const b=mkBtn(`${wins.includes(c.id)?'✓ ':''}${c.name}`,true,false);
      const detail=document.createElement('p');detail.textContent=c.text;detail.style.cssText='font-size:12px;margin:3px 0 10px';
      b.title=c.text;b.addEventListener('click',e=>{e.stopPropagation();wrap.remove();this.startArenaChallenge(c.id);});box.appendChild(b);box.appendChild(detail);
    }
    const back=mkBtn('Return to the surface',false,false);back.addEventListener('click',e=>{e.stopPropagation();wrap.remove();this.exitArena();});box.appendChild(back);
    const close=mkBtn('Explore / resume',false,false);close.addEventListener('click',()=>wrap.remove());box.appendChild(close);mount();
  }
  startArenaChallenge(id) {
    if(this.depth!==Arena.DEPTH || Combat.playerDowned(this.save.energy)) return false;
    const trial=Arena.start(id);if(!trial)return false;
    this._arenaTrial=trial;
    const p=this.save.arena.portal;
    this.playerM.x=p.x-this.startWorldM.x;this.playerM.y=p.y-this.startWorldM.y-this.feetOffsetM;this.syncMoveTarget();
    this.flashAtPlayer(Arena.CHALLENGES.find(c=>c.id===id).text);
    return true;
  }
  _arenaCanWalk(x,y) { return this.depth!==Arena.DEPTH || Arena.inside(this.save.arena?.portal,x,y); }
  _tickArena(dt) {
    if(this.depth!==Arena.DEPTH) {this._arenaTrial=null;return;}
    const p=this.save.arena?.portal;
    if(!p) {this.exitArena();return;}
    const feet=playerWorldM(this);feet.y+=this.feetOffsetM;
    if(!Arena.inside(p,feet.x,feet.y)) {
      feet.x=Number.isFinite(feet.x)?Math.max(p.x-Arena.HALF_SIZE_M,Math.min(p.x+Arena.HALF_SIZE_M,feet.x)):p.x;
      feet.y=Number.isFinite(feet.y)?Math.max(p.y-Arena.HALF_SIZE_M,Math.min(p.y+Arena.HALF_SIZE_M,feet.y)):p.y;
      this.playerM.x=feet.x-this.startWorldM.x;
      this.playerM.y=feet.y-this.startWorldM.y-this.feetOffsetM;this.syncMoveTarget();
    }
    const run=this._arenaTrial;
    if(!run || this._dialogOpen() || document.hidden || Combat.playerDowned(this.save.energy)) return;
    Arena.tick(run,{x:feet.x-p.x,y:feet.y-p.y},dt);
    if(run.status==='playing')return;
    this._arenaTrial=null;
    if(run.status==='won') {
      const hadKey=DungeonProgression.state(this.save).level4Key;
      DungeonProgression.completeChallenge(this.save,run.id);persistSave(this.save);
      const key=!hadKey&&DungeonProgression.state(this.save).level4Key;
      if(key) { this.addToInv('depth_key',1); persistSave(this.save); }
      this.showMessageModal({kind:'story',art:'progression_arena',title:key?'The fifth seal opens':'Trial complete',body:key?'Five trials answered. The Level 5 key is yours forever. The dungeon opens below the Underdark.':'Your victory is remembered. Choose another trial at the portal.',onDismiss:()=>this.openArenaMenu()});
    } else this.showMessageModal({kind:'story',art:'progression_arena',title:'Try again',body:'The trial has ended. Your earlier victories are safe.',onDismiss:()=>this.openArenaMenu()});
  }
  _drawArena() {
    this._drawArenaPortal();
    const g=this._arenaGraphics ||= this.add.graphics().setDepth(8).setMask(this.cellGfx.mask);
    g.clear();
    this._arenaLabels ||= [];
    for(const label of this._arenaLabels)label.setVisible(false);
    let labelIndex=0;
    const label=(x,y,text,hud=false)=>{
      let t=this._arenaLabels[labelIndex];
      if(!t) { t=this.add.text(0,0,'',{fontSize:'12px'}).setMask(this.cellGfx.mask);this._arenaLabels[labelIndex]=t; }
      labelIndex++;
      t.setVisible(true).setPosition(x,y).setText(text).setOrigin(hud?0:.5).setDepth(hud?89:9)
        .setStyle({color:hud?'#ffe3a1':'#19112e',backgroundColor:hud?'#17102ddd':null,wordWrap:{width:this.viewSize-16}});
    };
    this._arenaRails ||= [];
    for(const rail of this._arenaRails)rail.setVisible(false);
    const p=this.save.arena?.portal;
    if(this.depth!==Arena.DEPTH || !p)return;
    const at=(x,y)=>this.worldMetersToScreen(p.x+x,p.y+y);
    const half=Arena.HALF_SIZE_M;
    const a=at(-half,-half),b=at(half,half);
    // The rail follows the physical boundary, including its four exact corners.
    // Pool only the visible pieces so a distant edge costs no sprites.
    let railIndex=0;
    const rail=(x,y,vertical,corner)=>{
      const q=at(x,y);
      if(q.x<this.viewLeft-24 || q.x>this.viewLeft+this.viewSize+24 || q.y<this.viewTop-24 || q.y>this.viewTop+this.viewSize+24)return;
      let im=this._arenaRails[railIndex];
      if(!im) { im=this.add.image(0,0,'progression_tiles',6).setDepth(8).setMask(this.cellGfx.mask);this._arenaRails[railIndex]=im; }
      railIndex++;
      im.setVisible(true).setPosition(q.x,q.y).setFrame(corner?7:6).setDisplaySize(24,24).setRotation(vertical?Math.PI/2:0);
    };
    if(this.textures.exists('progression_tiles')) {
      const count=Math.ceil(2*half/4);
      for(let i=1;i<count;i++) {
        const d=-half+i*2*half/count;
        rail(d,-half,false,false);rail(d,half,false,false);
        rail(-half,d,true,false);rail(half,d,true,false);
      }
      for(const x of [-half,half])for(const y of [-half,half])rail(x,y,false,true);
    }
    g.lineStyle(3,0xa69aff,.9);g.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
    const center=at(0,0),r=Math.abs(at(5,0).x-center.x);
    g.lineStyle(2,0x8cffff,.9);g.strokeCircle(center.x,center.y,r);
    const run=this._arenaTrial;if(!run)return;
    const c=Arena.CHALLENGES.find(c=>c.id===run.id);
    const progress=c.points?`${run.collected.length}/${c.points.length}`:c.mode==='hold'?`${Math.floor(run.held)}/${c.duration}s held`:`${Math.floor(run.elapsed)}/${c.duration}s`;
    const time=c.limit?` · ${Math.max(0,Math.ceil(c.limit-run.elapsed))}s left`:'';
    label(this.viewLeft+8,this.viewTop+8,`${c.name}: ${progress}${time} · ${run.hits}/3 strikes`,true);
    for(let i=0;i<(c.points?.length||0);i++) if(!run.collected.includes(i)) {
      const q=c.points[i],s=at(q.x,q.y),next=c.mode!=='ordered'||i===run.collected.length;
      g.fillStyle(next?0xffd36c:0x777799,next?1:.6);g.fillCircle(s.x,s.y,r*.65);
      if(c.mode==='ordered') label(s.x,s.y,String(i+1));
    }
    const h=Arena.hazard(run);g.lineStyle(4,0xe275ff,.8);
    if(h?.kind==='beam') {const t=at(h.x,-48),u=at(h.x,48);g.lineBetween(t.x,t.y,u.x,u.y);}
    if(h?.kind==='ring')g.strokeCircle(center.x,center.y,Math.abs(at(h.radius,0).x-center.x));
    if(c.mode==='hold') {g.lineStyle(2,0xffd36c,.65);g.strokeCircle(center.x,center.y,Math.abs(at(12,0).x-center.x));}
  }
}
