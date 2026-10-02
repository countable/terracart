// Static game art on Leaflet: shipping textures and object appearance, with no
// player/save, fog, lighting or animation loop. Only the viewport is painted.
const MapReviewArt = (() => {
  function textureStore() {
    const entries = new Map();
    const store = {
      exists: key => entries.has(key), get: key => entries.get(key),
      remove: key => entries.delete(key),
      addSpriteSheet(key, source, spec) { return add(key, source, spec); },
      addCanvas(key, source) { return add(key, source); },
      createCanvas(key, w, h) {
        const c = document.createElement('canvas'); c.width=w; c.height=h;
        return add(key,c);
      },
    };
    function add(key, source, spec) {
      const frames = new Map();
      const t = {
        getSourceImage: () => source, getContext: () => source.getContext('2d'), refresh() {},
        add(name, index, x, y, width, height) { frames.set(name,{x,y,width,height}); },
        get(name) { return frames.get(name ?? '__BASE') || frames.get(0) || frames.get('__BASE'); },
      };
      t.add('__BASE',0,0,0,source.width,source.height);
      if (spec) {
        let n=0;
        for(let y=0;y+spec.frameHeight<=source.height;y+=spec.frameHeight)
          for(let x=0;x+spec.frameWidth<=source.width;x+=spec.frameWidth)
            t.add(n++,0,x,y,spec.frameWidth,spec.frameHeight);
      }
      entries.set(key,t); return t;
    }
    store.addImage = (key, source) => add(key,source);
    return store;
  }
  let assetsPromise;
  function assets() {
    if (assetsPromise) return assetsPromise;
    assetsPromise = (async () => {
      const textures=textureStore(), scene={textures};
      const failures=[];
      await Promise.all(Object.entries(ASSETS).map(async ([key,spec]) => {
        if (!['image','spritesheet'].includes(spec.kind)) return;
        try {
          const img=new Image(); img.src='../'+spec.path; await img.decode();
          if(spec.kind==='spritesheet') textures.addSpriteSheet(key,img,spec);
          else textures.addImage(key,img);
          if(spec.onLoad) spec.onLoad(scene);
        } catch(error) { failures.push(key); console.warn('Map art asset:',key,error); }
      }));
      makePotOfGoldTexture(scene); makeTrapTextures(scene);
      // Only phase zero is needed. Use the very same painter and seed as the game.
      for(const [type,spec] of Object.entries(BIOME_TEX)) for(let v=0;v<spec.variants;v++) {
        const t=textures.createCanvas(`biome${type}_${v}`,32,32);
        drawBiomeTexture(t.getContext(),32,type,v,0);
      }
      return {textures,failures};
    })();
    return assetsPromise;
  }
  function cropAppearance(o) {
    const spec=wildplantSprite(o), stage=Math.min(MAX_GROWTH_STAGE,o.stage ?? MAX_GROWTH_STAGE);
    const custom=spec?.custom, spring=spec?.sheet==='springcrops';
    return { visible:true, texKey:custom?spec.sheet:spring?'springcrops':'crops',
      frameVal:custom?wildplantFrame(o):spring?spec.row*SPRING_CROPS_COLS+stage:(CROP_ROW[o.crop]??1)*CROPS_SHEET_COLS+stage,
      scl:spec?.scale??2,scaleYMul:1,origin:[.5,stage===0&&!custom&&!spring?.85:.5],dxPx:0,dyPx:0 };
  }
  function creatureAppearance(o) {
    const art=SpriteLayout.creatureArt(o.kind); if(!art)return null;
    const npc=o.kind==='npc'?SpriteLayout.npcAppearance(o,0,false):null;
    return {visible:true,texKey:npc?.sheet||art.sheet,frameVal:npc?.frame??0,
      scl:SpriteLayout.creatureScale(o.kind,SpriteLayout.creatureInstScale(o)),scaleYMul:1,
      origin:[.5,art.foot],dxPx:0,dyPx:-(art.float||0)};
  }
  const Layer = L.Layer.extend({
    initialize(options) { L.setOptions(this,options); this._world=null; this._sprites=[]; },
    onAdd(map) {
      this._map=map;
      const pane=map.getPane('gameArt')||map.createPane('gameArt'); pane.style.zIndex=250; pane.style.pointerEvents='none';
      this._canvas=L.DomUtil.create('canvas','leaflet-layer',pane);
      this._canvas.style.pointerEvents='none'; this._canvas.style.imageRendering='pixelated';
      map.on('moveend zoomend resize',this.redraw,this);
      this.redraw();
      this._load();
    },
    _load() {
      if(typeof ASSETS==='undefined'||this._assets||this._loading)return;
      this._loading=true;
      assets().then(data=>{this._assets=data;this._prepare();this.redraw();})
        .catch(error=>{console.error('Game art could not load',error);this.options.onStatus?.('Game art could not load: '+error.message);});
    },
    onRemove(map) { map.off('moveend zoomend resize',this.redraw,this);this._canvas.remove();this._canvas=null;this._map=null; },
    bringToBack() { return this; },
    setWorld(world) { this._world=world;if(this._map)this._load();this._prepare();this.redraw();return this; },
    setRestoredLamps(restored) {
      this._restoredLamps=!!restored;this._prepare();this.redraw();return this;
    },
    _prepare() {
      if(!this._world||!this._assets)return;
      const scene={save:{},textures:this._assets.textures,cellM:WorldGen.CELL_M};
      const roles=new WeakMap();
      for(const e of this._world.tiles)for(const o of e.objects||[])if(o.kind==='house')roles.set(o,Houses.displayRole(scene.save,o));
      const {resolveAppearance:resolve,fruitList}=Render.objectAppearance(scene,roles);
      this._sprites=[];
      const tideDay=utcDayKey();
      const add=(e,o,category)=>{
        if(!Number.isFinite(o.x)||!Number.isFinite(o.y))return;
        const appearance=category==='creature'?creatureAppearance(o):category==='plant'?cropAppearance(o):o.kind==='trap'?{visible:true,texKey:'trap_hidden',scl:1,scaleYMul:1,origin:[.5,.5],dxPx:0,dyPx:0}:o.kind==='coindrop'?{visible:true,texKey:Render.coinPile(o).texture,frameVal:0,scl:1,scaleYMul:1,origin:[.5,.5],dxPx:0,dyPx:0,displayWidth:Render.coinPile(o).width,displayHeight:Render.coinPile(o).width}:resolve(o);
        if(o.kind==='_streetlamp'&&appearance?.visible) {
          // The shipping after hook owns lamp sizing and dark-stone alpha.
          appearance.spec.after({
            setDisplaySize(w,h) { appearance.displayWidth=w;appearance.displayHeight=h;return this; },
            setAlpha(alpha) { appearance.alpha=alpha;return this; },
          },o,scene);
        }
        const kind=category==='creature'?(e?(o.kind==='npc'?'resident: npc':Combat.isEnemy(o)?'enemy: '+o.kind:'animal: '+o.kind):'enemy: garrison'):o.kind==='wildplant'?'plant:'+o.crop:o.kind==='xmark'?'X mark':o.kind;
        // Reuse the game's crown hook, measured at the tree's local origin.
        // Keep fruit with its tree so filtering and painter order stay together.
        const fruit=[];
        if(o.kind==='fruittree'&&appearance?.visible) {
          const p=appearance;
          fruitList.length=0;
          p.spec.after({texture:{key:p.texKey},frame:{name:p.frameVal},
            originX:p.origin[0],originY:p.origin[1],scaleX:p.scl,scaleY:p.scl*p.scaleYMul,
            x:p.dxPx,y:p.dyPx,depth:0},o,scene);
          fruit.push(...fruitList);
        }
        this._sprites.push({e,o,category,kind,appearance,fruit});
      };
      for(const e of this._world.tiles) {
        // Lamps are generated infrastructure, outside the spawned-object filters.
        // Share geometry, procedural art and sprite appearance with the game.
        for(const lamp of MapScene.prototype._streetLampsForTile.call(scene,e.tx,e.ty,e)) {
          if(this._restoredLamps)MapScene.prototype._ensureStreetLampTex.call(scene,lamp.glow);
          add(e,{...lamp,kind:'_streetlamp',lit:!!this._restoredLamps},'infrastructure');
        }
        for(const o of e.reefCorals||[])add(e,o,'scenery');
        for(const o of e.objects||[])add(e,o,'object');
        for(const o of e.coinDrops||[])add(e,o,'object');
        for(const o of e.wildplants||[]) {
          const plant=ZoneReview.livePlant(o,tideDay);
          if(plant)add(e,plant,'plant');
        }
        for(const o of e.creatures||[])add(e,o,'creature');
        for(const o of e.traps||[])add(e,{...o,kind:'trap'},'object');
        for(const o of [e.treasure,...(e.extraTreasures||[]),...(e.parkingTreasures||[])])if(o)add(e,{...o,kind:'xmark'},'object');
      }
      for(const o of this._world.guards||[])add(null,o,'creature');
      this._sprites.sort((a,b)=>a.o.y-b.o.y||a.o.x-b.o.x);
    },
    redraw() {
      if(!this._map||!this._canvas)return this;
      const map=this._map,size=map.getSize(),c=this._canvas,dpr=Math.min(devicePixelRatio||1,2);
      c.width=size.x*dpr;c.height=size.y*dpr;c.style.width=size.x+'px';c.style.height=size.y+'px';
      L.DomUtil.setPosition(c,map.containerPointToLayerPoint([0,0]));
      const g=c.getContext('2d');g.scale(dpr,dpr);g.imageSmoothingEnabled=false;
      g.fillStyle='#24332b';g.fillRect(0,0,size.x,size.y);
      if(!this._world||!this._assets)return this;
      const edge=this.options.getEdge(),textures=this._assets.textures;
      const project=(x,y)=>map.latLngToContainerPoint(this.options.toLL(x,y,edge));
      const view=map.getBounds();
      let detailed=false,drawn=0;
      for(const e of this._world.tiles) {
        const bounds=L.latLngBounds(this.options.toLL(e.tx*edge,(e.ty+1)*edge,edge),this.options.toLL((e.tx+1)*edge,e.ty*edge,edge));
        if(!view.intersects(bounds))continue;
        const a=project(e.tx*edge,e.ty*edge),b=project((e.tx+1)*edge,(e.ty+1)*edge),N=e.cellsPerEdge;
        const dx=(b.x-a.x)/N,dy=(b.y-a.y)/N;
        const x0=Math.max(0,Math.floor(-a.x/dx)),y0=Math.max(0,Math.floor(-a.y/dy));
        const x1=Math.min(N,Math.ceil((size.x-a.x)/dx)),y1=Math.min(N,Math.ceil((size.y-a.y)/dy));
        detailed ||= dx>=4;
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++) {
          let type=e.grid[y*N+x];
          if(type===WorldGen.T.PATH&&e.pathUnder?.[`${x}_${y}`]!=null)type=e.pathUnder[`${x}_${y}`];
          const spec=BIOME_TEX[type],h=((e.tx*N+x)*2246822519)^((e.ty*N+y)*3266489917);
          g.fillStyle='#'+(zoneGroundColor(e,x,y,type)??COLORS[type]??0x71845b).toString(16).padStart(6,'0');g.fillRect(a.x+x*dx,a.y+y*dy,dx+.5,dy+.5);
          if(spec&&dx>=4)g.drawImage(textures.get(`biome${type}_${Math.abs(h)%spec.variants}`).getSourceImage(),a.x+x*dx,a.y+y*dy,dx+.5,dy+.5);

        }
        // Follow the source road centreline, using the game's physical widths.
        const roads=e.layers?.find(l=>l.name==='transportation');
        g.lineCap='round';g.lineJoin='round';
        for(const [fi,f] of (roads?.features||[]).entries()) {
          if(f.type!==2||WorldGen.isLotLane(f.tags)||WorldGen.classifyLine('transportation',f.tags)==null)continue;
          const width=WorldGen.roadOverlayWidthM(f.tags);if(!width)continue;
          const mvtToM=edge/(roads.extent||4096),isPath=WorldGen.PATH_CLASSES.has(f.tags?.class);
          g.lineWidth=width/edge*(b.x-a.x);
          for(const [li,line] of (f.geom||[]).entries()) {
            if(line.length<2)continue;
            for(const style of StreetVariants.lineStyles(e,f,fi,li,mvtToM)) {
              const key=JSON.stringify([style.variant,isPath,!!this._restoredLamps]);
              this._pavementTiles ||= new Map();
              let tile=this._pavementTiles.get(key);
              if(!tile) {
                tile=document.createElement('canvas');tile.width=tile.height=RoadOverlay.CLEAN_TILE_PX;
                RoadOverlay.paintPavementTile(tile.getContext('2d'),RoadOverlay.CLEAN_TILE_PX,isPath,!!this._restoredLamps,style.variant);
                this._pavementTiles.set(key,tile);
              }
              const pattern=g.createPattern(tile,'repeat');
              pattern.setTransform(new DOMMatrix([dx/32,0,0,dy/32,a.x-e.tx*N*dx,a.y-e.ty*N*dy]));
              g.strokeStyle=pattern;g.beginPath();
              Streets.subLineM(line,mvtToM,style.a,style.b).forEach((p,i)=>g[i?'lineTo':'moveTo'](a.x+p.x/edge*(b.x-a.x),a.y+p.y/edge*(b.y-a.y)));
              g.stroke();
            }
          }
        }
      }
      for(const item of this._sprites) {
        const {e,o,category,appearance:p}=item;
        if(category!=='infrastructure'&&this.options.visible&&!this.options.visible(e,o,category,item.kind))continue;
        const at=project(o.x,o.y);if(at.x < -180 || at.y < -180 || at.x>size.x+180||at.y>size.y+180)continue;
        const cellM=edge/(e?.cellsPerEdge||this._world.tiles[0].cellsPerEdge);
        const scale=(project(o.x+cellM,o.y).x-at.x)/32;
        if(scale*32<4)continue;
        if(o.kind==='xmark') { const r=5.1*scale;g.strokeStyle='#2a1d108c';g.lineWidth=2*scale;g.beginPath();g.moveTo(at.x-r,at.y-r);g.lineTo(at.x+r,at.y+r);g.moveTo(at.x+r,at.y-r);g.lineTo(at.x-r,at.y+r);g.stroke();continue; }
        const t=p?.visible&&textures.get(p.texKey),f=t&&t.get(p.frameVal);
        if(!f) {g.fillStyle='#ffd86a';g.fillRect(at.x-1,at.y-1,3,3);continue;}
        const w=(p.displayWidth??f.width*p.scl)*scale,h=(p.displayHeight??f.height*p.scl*p.scaleYMul)*scale;
        g.globalAlpha=p.alpha??1;
        g.drawImage(t.getSourceImage(),f.x,f.y,f.width,f.height,at.x+p.dxPx*scale-w*p.origin[0],at.y+p.dyPx*scale-h*p.origin[1],w,h);drawn++;
        g.globalAlpha=1;
        for(const fruit of item.fruit) {
          const ft=textures.get(fruit.key),ff=ft?.get(fruit.frame);
          if(!ff)continue;
          const fw=ff.width*fruit.scale*scale,fh=ff.height*fruit.scale*scale;
          g.drawImage(ft.getSourceImage(),ff.x,ff.y,ff.width,ff.height,
            at.x+fruit.x*scale-fw/2,at.y+fruit.y*scale-fh/2,fw,fh);
        }
      }
      this.options.onStatus?.(detailed?`Game art · ${drawn.toLocaleString()} sprites in view${this._assets.failures.length?' · '+this._assets.failures.length+' missing assets':''}`:'Game art · zoom in for textures and sprites');
      return this;
    },
  });
  return {layer:options=>new Layer(options)};
})();
