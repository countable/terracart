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
      makeTowerTexture(scene); makePotOfGoldTexture(scene); makeTrapTextures(scene);
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
      scl:spec?.scale??2,scaleYMul:1,tint:BiomeProfiles.tint(o._biome,o.crop)||0xffffff,origin:[.5,stage===0&&!custom&&!spring?.85:.5],dxPx:0,dyPx:0 };
  }
  function creatureAppearance(o) {
    const art=SpriteLayout.creatureArt(o.kind); if(!art)return null;
    const npc=o.kind==='npc'?SpriteLayout.npcAppearance(o,0,false):null;
    return {visible:true,texKey:npc?.sheet||art.sheet,frameVal:npc?.frame??0,
      scl:SpriteLayout.creatureScale(o.kind,SpriteLayout.creatureInstScale(o)),scaleYMul:1,
      origin:[.5,art.foot],dxPx:0,dyPx:-(art.float||0),
      tint:npc?.tint??SpriteLayout.creatureTint(o.kind),alpha:SpriteLayout.creatureAlpha(o.kind)};
  }
  const Layer = L.Layer.extend({
    initialize(options) { L.setOptions(this,options); this._world=null; this._sprites=[];this._groundCache=new Map();this._groundBytes=0; },
    onAdd(map) {
      this._map=map;
      const pane=map.getPane('gameArt')||map.createPane('gameArt'); pane.style.zIndex=250; pane.style.pointerEvents='none';
      this._canvas=L.DomUtil.create('canvas','leaflet-layer leaflet-zoom-animated',pane);
      this._canvasTopLeft=null;
      this._canvas.style.pointerEvents='none'; this._canvas.style.imageRendering='pixelated';
      map.on('moveend zoomend resize',this._requestRedraw,this);
      map.on('zoomanim',this._animateZoom,this);
      this.redraw();
      this._load();
    },
    _load() {
      if(typeof ASSETS==='undefined'||this._assets||this._loading)return;
      this._loading=true;
      assets().then(data=>{this._assets=data;this._prepare();this.redraw();})
        .catch(error=>{console.error('Game art could not load',error);this.options.onStatus?.('Game art could not load: '+error.message);});
    },
    onRemove(map) { map.off('moveend zoomend resize',this._requestRedraw,this);map.off('zoomanim',this._animateZoom,this);clearTimeout(this._groundTimer);this._groundJob=null;cancelAnimationFrame(this._redrawFrame);this._redrawFrame=null;this._canvas.remove();this._canvas=null;this._map=null; },
    _animateZoom(event) {
      if(!this._canvasTopLeft)return;
      const scale=this._map.getZoomScale(event.zoom,this._canvasZoom);
      L.DomUtil.setTransform(this._canvas,this._map._latLngToNewLayerPoint(this._canvasTopLeft,event.zoom,event.center),scale);
    },
    _invalidateGround() {
      clearTimeout(this._groundTimer);this._groundJob=null;
      this._groundCache.clear();this._groundBytes=0;
      // A changed world or lamp mode must never retain previous art.
      this._canvasTopLeft=null;
      if(this._canvas)this._canvas.getContext('2d').clearRect(0,0,this._canvas.width,this._canvas.height);
    },
    _requestRedraw() {
      if(this._redrawFrame==null)this._redrawFrame=requestAnimationFrame(()=>{this._redrawFrame=null;this.redraw();});
    },
    bringToBack() { return this; },
    setWorld(world) { this._invalidateGround();this._roadGeometry=new WeakMap();this._world=world;if(this._map)this._load();this._prepare();this.redraw();return this; },
    setRestoredLamps(restored) {
      this._invalidateGround();this._restoredLamps=!!restored;this._prepare();this.redraw();return this;
    },
    _prepare() {
      if(!this._world||!this._assets)return;
      const scene={save:{},textures:this._assets.textures,cellM:WorldGen.CELL_M};
      const roles=new WeakMap();
      for(const e of this._world.tiles)for(const o of e.objects||[])if(o.kind==='house')roles.set(o,Houses.displayRole(scene.save,o));
      const {resolveAppearance:resolve,fruitList}=Render.objectAppearance(scene,roles);
      this._sprites=[];
      const tideDay=utcDayKey();
      const spent=spentSets(scene,scene.save);
      let connectedArt=new Map();
      const add=(e,o,category)=>{
        if(!Number.isFinite(o.x)||!Number.isFinite(o.y))return;
        const override=connectedArt.get(o);
        const art=override?{...o,...override}:o;
        const appearance=category==='creature'?creatureAppearance(o):category==='plant'?cropAppearance(art):o.kind==='trap'?{visible:true,texKey:'trap_hidden',scl:1,scaleYMul:1,origin:[.5,.5],dxPx:0,dyPx:0}:o.kind==='coindrop'?{visible:true,texKey:Render.coinPile(o).texture,frameVal:0,scl:1,scaleYMul:1,origin:[.5,.5],dxPx:0,dyPx:0,displayWidth:Render.coinPile(o).width,displayHeight:Render.coinPile(o).width}:resolve(art);
        if(appearance?.visible&&category!=='plant'&&category!=='creature')appearance.tint=Render.spriteTint(art,scene,appearance.texKey);
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
        const edge=this.options.getEdge();
        connectedArt=Render.connectedArtForTile(e,e.tx,e.ty,edge,spent,
          (e.tx+.5)*edge,(e.ty+.5)*edge,edge/2);
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
          if(plant) {
            const override=connectedArt.get(o);
            if(override)connectedArt.set(plant,override);
            add(e,plant,'plant');
          }
        }
        for(const o of e.creatures||[])add(e,o,'creature');
        for(const o of e.traps||[])add(e,{...o,kind:'trap'},'object');
        for(const o of [e.treasure,...(e.extraTreasures||[]),...(e.parkingTreasures||[])])if(treasureExposed(o,this._world.scene))add(e,{...o,kind:'xmark'},'object');
      }
      connectedArt=new Map();
      for(const o of this._world.guards||[])add(null,o,'creature');
      this._sprites.sort((a,b)=>a.o.y-b.o.y||a.o.x-b.o.x);
      this._spriteBuckets=new Map();
      this._bucketSize=this.options.getEdge()/16;
      this._sprites.forEach((item,order)=>{
        item.order=order;
        const key=Math.floor(item.o.x/this._bucketSize)+','+Math.floor(item.o.y/this._bucketSize);
        let bucket=this._spriteBuckets.get(key);
        if(!bucket)this._spriteBuckets.set(key,bucket=[]);
        bucket.push(item);
      });
    },
    _tintedFrame(texture,frame,tint=0xffffff) {
      // Cache the cropped, multiply-tinted frame just as Phaser's sprite tint
      // colours shared sheets without changing their source pixels.
      this._frameImages ||= new WeakMap();
      let variants=this._frameImages.get(frame);
      if(!variants)this._frameImages.set(frame,variants=new Map());
      if(variants.has(tint))return variants.get(tint);
      const canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;
      const g=canvas.getContext('2d'),source=texture.getSourceImage();
      const draw=()=>g.drawImage(source,frame.x,frame.y,frame.width,frame.height,0,0,frame.width,frame.height);
      draw();
      if(tint!==0xffffff) {
        g.globalCompositeOperation='multiply';
        g.fillStyle='#'+tint.toString(16).padStart(6,'0');g.fillRect(0,0,frame.width,frame.height);
        g.globalCompositeOperation='destination-in';draw();
      }
      variants.set(tint,canvas);return canvas;
    },
    _roadsForTile(e,edge) {
      this._roadGeometry ||= new WeakMap();
      if(this._roadGeometry.has(e))return this._roadGeometry.get(e);
      const result=[],roads=e.layers?.find(l=>l.name==='transportation');
      for(const [fi,f] of (roads?.features||[]).entries()) {
        if(f.type!==2||WorldGen.isLotLane(f.tags)||WorldGen.classifyLine('transportation',f.tags)==null)continue;
        const width=WorldGen.roadOverlayWidthM(f.tags);if(!width)continue;
        const mvtToM=edge/(roads.extent||4096),isPath=WorldGen.PATH_CLASSES.has(f.tags?.class);
        for(const [li,line] of (f.geom||[]).entries()) {
          if(line.length<2)continue;
          for(const style of StreetVariants.lineStyles(e,f,fi,li,mvtToM)) {
            const points=Streets.subLineM(line,mvtToM,style.a,style.b);
            let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
            for(const p of points) {minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
            result.push({width,isPath,variant:style.variant,points,minX,minY,maxX,maxY});
          }
        }
      }
      this._roadGeometry.set(e,result);return result;
    },
    _paintGround(g,size,project) {
      const edge=this.options.getEdge(),textures=this._assets.textures;
      for(const e of this._world.tiles) {
        const a=project(e.tx*edge,e.ty*edge),b=project((e.tx+1)*edge,(e.ty+1)*edge),N=e.cellsPerEdge;
        const dx=(b.x-a.x)/N,dy=(b.y-a.y)/N;
        // Include road caps that extend beyond the source tile.
        if(a.x>size.x+128||a.y>size.y+128||b.x < -128||b.y < -128)continue;
        const x0=Math.max(0,Math.floor(-a.x/dx)),y0=Math.max(0,Math.floor(-a.y/dy));
        const x1=Math.min(N,Math.ceil((size.x-a.x)/dx)),y1=Math.min(N,Math.ceil((size.y-a.y)/dy));
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++) {
          let type=e.grid[y*N+x];
          if(type===WorldGen.T.PATH&&e.pathUnder?.[`${x}_${y}`]!=null)type=e.pathUnder[`${x}_${y}`];
          const spec=BIOME_TEX[type],h=((e.tx*N+x)*2246822519)^((e.ty*N+y)*3266489917);
          g.fillStyle='#'+(zoneGroundColor(e,x,y,type)??COLORS[type]??0x71845b).toString(16).padStart(6,'0');g.fillRect(a.x+x*dx,a.y+y*dy,dx+.5,dy+.5);
          if(spec&&dx>=4)g.drawImage(textures.get(`biome${type}_${Math.abs(h)%spec.variants}`).getSourceImage(),a.x+x*dx,a.y+y*dy,dx+.5,dy+.5);

        }
        // Follow the source road centreline, using the game's physical widths.
        g.lineCap='round';g.lineJoin='round';
        const patterns=new Map();
        for(const road of this._roadsForTile(e,edge)) {
          const lineWidth=road.width/edge*(b.x-a.x),pad=lineWidth/2;
          if(a.x+road.minX/edge*(b.x-a.x)>size.x+pad||a.y+road.minY/edge*(b.y-a.y)>size.y+pad||
            a.x+road.maxX/edge*(b.x-a.x)<-pad||a.y+road.maxY/edge*(b.y-a.y)<-pad)continue;
          const key=JSON.stringify([road.variant,road.isPath,!!this._restoredLamps]);
          let pattern=patterns.get(key);
          if(!pattern) {
            this._pavementTiles ||= new Map();
            let tile=this._pavementTiles.get(key);
            if(!tile) {
              tile=document.createElement('canvas');tile.width=tile.height=RoadOverlay.CLEAN_TILE_PX;
              RoadOverlay.paintPavementTile(tile.getContext('2d'),RoadOverlay.CLEAN_TILE_PX,road.isPath,!!this._restoredLamps,road.variant);
              this._pavementTiles.set(key,tile);
            }
            pattern=g.createPattern(tile,'repeat');
            pattern.setTransform(new DOMMatrix([dx/32,0,0,dy/32,a.x-e.tx*N*dx,a.y-e.ty*N*dy]));
            patterns.set(key,pattern);
          }
          g.lineWidth=lineWidth;g.strokeStyle=pattern;g.beginPath();
          road.points.forEach((p,i)=>g[i?'lineTo':'moveTo'](a.x+p.x/edge*(b.x-a.x),a.y+p.y/edge*(b.y-a.y)));
          g.stroke();
        }
      }
    },
    _groundChunks(size,project,dpr) {
      const edge=this.options.getEdge(),first=this._world.tiles[0];
      if(!first)return [];
      const anchor=project(first.tx*edge,first.ty*edge),chunkSize=256;
      const x0=Math.floor(-anchor.x/chunkSize),y0=Math.floor(-anchor.y/chunkSize);
      const x1=Math.ceil((size.x-anchor.x)/chunkSize),y1=Math.ceil((size.y-anchor.y)/chunkSize);
      const chunks=[];
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)chunks.push({
        key:[this._map.getZoom(),dpr,x,y].join(','),
        x:anchor.x+x*chunkSize,y:anchor.y+y*chunkSize,size:chunkSize,
      });
      return chunks;
    },
    _paintChunk(chunk,project,dpr) {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=chunk.size*dpr;
      const cg=canvas.getContext('2d');cg.scale(dpr,dpr);cg.imageSmoothingEnabled=false;
      this._paintGround(cg,{x:chunk.size,y:chunk.size},(wx,wy)=>{
        const p=project(wx,wy);return {x:p.x-chunk.x,y:p.y-chunk.y};
      });
      this._groundCache.set(chunk.key,canvas);this._groundBytes+=canvas.width*canvas.height*4;
    },
    _prepareGround(chunks,project,dpr) {
      const missing=chunks.filter(chunk=>!this._groundCache.has(chunk.key));
      if(!missing.length)return true;
      // First paint has no previous image to retain. Subsequent cold views
      // yield between small chunks so navigation and zoom stay responsive.
      if(!this._canvasTopLeft) {
        for(const chunk of missing)this._paintChunk(chunk,project,dpr);
        return true;
      }
      const key=chunks.map(chunk=>chunk.key).join(';');
      if(this._groundJob?.key===key)return false;
      clearTimeout(this._groundTimer);
      const job=this._groundJob={key};
      const next=()=>{
        if(this._groundJob!==job||!this._map)return;
        this._paintChunk(missing.shift(),project,dpr);
        if(missing.length)this._groundTimer=setTimeout(next,0);
        else {this._groundJob=null;this._requestRedraw();}
      };
      this._groundTimer=setTimeout(next,0);
      return false;
    },
    _drawGround(g,chunks) {
      for(const chunk of chunks) {
        const canvas=this._groundCache.get(chunk.key);
        this._groundCache.delete(chunk.key);this._groundCache.set(chunk.key,canvas);
        g.drawImage(canvas,chunk.x,chunk.y,chunk.size,chunk.size);
      }
      // Keep the viewport even when it exceeds the usual memory budget.
      const needed=new Set(chunks.map(chunk=>chunk.key));
      for(const [key,canvas] of this._groundCache) {
        if(this._groundBytes<=64*1024*1024)break;
        if(needed.has(key))continue;
        this._groundBytes-=canvas.width*canvas.height*4;this._groundCache.delete(key);
      }
    },
    _visibleSprites(size,project) {
      const first=this._world.tiles[0];
      if(!first||!this._spriteBuckets)return [];
      const edge=this.options.getEdge(),wx=first.tx*edge,wy=first.ty*edge;
      const anchor=project(wx,wy);
      // Use unrounded world scale for bucket selection. The two extra pixels
      // cover Leaflet's rounding; retain the renderer's 180px sprite overhang.
      const a=this._map.project(this.options.toLL(wx,wy,edge));
      const b=this._map.project(this.options.toLL(wx+edge,wy+edge,edge));
      const sx=(b.x-a.x)/edge,sy=(b.y-a.y)/edge,bs=this._bucketSize,margin=182;
      const x0=Math.floor((wx+(-margin-anchor.x)/sx)/bs),x1=Math.floor((wx+(size.x+margin-anchor.x)/sx)/bs);
      const y0=Math.floor((wy+(-margin-anchor.y)/sy)/bs),y1=Math.floor((wy+(size.y+margin-anchor.y)/sy)/bs);
      const items=[];
      // At distant zoom, visiting occupied buckets is cheaper than walking a
      // huge empty coordinate range surrounding the loaded world.
      if((x1-x0+1)*(y1-y0+1)>this._spriteBuckets.size*2) {
        for(const [key,bucket] of this._spriteBuckets) {
          const [x,y]=key.split(',').map(Number);
          if(x>=x0&&x<=x1&&y>=y0&&y<=y1)items.push(...bucket);
        }
      } else {
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
          const bucket=this._spriteBuckets.get(x+','+y);if(bucket)items.push(...bucket);
        }
      }
      return items.sort((a,b)=>a.order-b.order);
    },
    redraw() {
      cancelAnimationFrame(this._redrawFrame);this._redrawFrame=null;
      if(!this._map||!this._canvas)return this;
      const map=this._map,size=map.getSize(),c=this._canvas,dpr=Math.min(devicePixelRatio||1,2);
      if(!this._world||!this._assets)return this;
      const edge=this.options.getEdge(),textures=this._assets.textures,zoom=map.getZoom();
      // Deferred chunks use the captured projection, even if the map moves.
      const origin=map.getPixelOrigin().add(map.containerPointToLayerPoint([0,0]));
      const project=(x,y)=>map.project(this.options.toLL(x,y,edge),zoom).round().subtract(origin);
      const chunks=this._groundChunks(size,project,dpr);
      this._animateZoom({zoom,center:map.getCenter()});
      if(!this._prepareGround(chunks,project,dpr))return this;
      clearTimeout(this._groundTimer);this._groundJob=null;
      c.width=size.x*dpr;c.height=size.y*dpr;c.style.width=size.x+'px';c.style.height=size.y+'px';
      L.DomUtil.setPosition(c,map.containerPointToLayerPoint([0,0]));
      this._canvasTopLeft=map.containerPointToLatLng([0,0]);this._canvasZoom=zoom;
      const g=c.getContext('2d');g.scale(dpr,dpr);g.imageSmoothingEnabled=false;
      g.fillStyle='#24332b';g.fillRect(0,0,size.x,size.y);
      let detailed=false,drawn=0;
      this._drawGround(g,chunks);
      const first=this._world.tiles[0];
      if(first)detailed=(project((first.tx+1)*edge,first.ty*edge).x-project(first.tx*edge,first.ty*edge).x)/first.cellsPerEdge>=4;
      for(const item of this._visibleSprites(size,project)) {
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
        const source=this._tintedFrame(t,f,p.tint);
        g.drawImage(source,0,0,f.width,f.height,at.x+p.dxPx*scale-w*p.origin[0],at.y+p.dyPx*scale-h*p.origin[1],w,h);drawn++;
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
