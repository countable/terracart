// Static game art on Leaflet: shipping textures and object appearance, with no
// player/save, fog, lighting or animation loop. Only the viewport is painted.
const MapReviewArt = (() => {
  const PIRATE_SAND = { colour: '#c98f73', wash: 'rgba(184,86,48,.28)' };
  // Use the cell's actual coverage winner, not the anchor's circular influence.
  function pirateSand(e, i) {
    const zone = e.zone, slot = zone?.coverage?.[i];
    return e.grid[i] === WorldGen.T.SAND && slot && zone.anchors[slot - 1]?.variant === 'pirate_cove'
      ? PIRATE_SAND : null;
  }
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
        getSourceImage: () => source, getContext: () => source.getContext('2d'),
        get context() { return source.getContext('2d'); }, refresh() {}, setFilter() {},
        // Phaser treats numeric frame IDs and their string forms identically.
        add(name, index, x, y, width, height) { frames.set(String(name),{x,y,width,height,sourceIndex:index,cutX:x,cutY:y,cutWidth:width,cutHeight:height,realWidth:width,realHeight:height,source:{image:source}}); },
        remove(name) { return frames.delete(String(name)); },
        get(name) { return frames.get(String(name ?? '__BASE')) || frames.get('0') || frames.get('__BASE'); },
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
      // Static previews load the same texture hooks, but never animate a player.
      const textures=textureStore(), scene={textures,_createAnim(){},isDragonActive:()=>false};
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
      makeBerryBushTexture(scene);makeTowerTexture(scene); makePotOfGoldTexture(scene); makeTrapTextures(scene);
      // Only phase zero is needed. Use the very same painter and seed as the game.
      for(const [type,spec] of Object.entries(BIOME_TEX)) for(let v=0;v<spec.variants;v++) {
        const t=textures.createCanvas(`biome${type}_${v}`,32,32);
        drawBiomeTexture(t.getContext(),32,type,v,0);
      }
      if (typeof ZONE_SELECTED_MATERIALS !== 'undefined') {
        for (const id of new Set(Object.values(ZONE_SELECTED_MATERIALS))) {
          const t=textures.createCanvas('zone_ground_'+id,32,32);
          drawSelectedMaterial(t.getContext(),32,id);
        }
      }
      if (typeof TerrainTransitions !== 'undefined') TerrainTransitions.prepare(scene);
      return {textures,failures,scene};
    })();
    return assetsPromise;
  }
  function cropAppearance(o,scene) {
    const spec=wildplantSprite(o), stage=Math.min(MAX_GROWTH_STAGE,o.stage ?? MAX_GROWTH_STAGE);
    const custom=spec?.custom, spring=spec?.sheet==='springcrops';
    const frameVal=custom?wildplantFrame(o):spring?spec.row*SPRING_CROPS_COLS+stage:(CROP_ROW[o.crop]??1)*CROPS_SHEET_COLS+stage;
    const placement=Render.plantPlacement(o,spec,wildplantFrame(o),stage,scene);
    return { visible:true, texKey:custom?(spec.texture||spec.sheet):spring?'springcrops':'crops',frameVal,
      scl:placement.scl,scaleYMul:1,tint:spec?.tint??((o.crop==='rubble'?mineralRockTint(o):BiomeProfiles.tint(o._biome,o.crop))||0xffffff),
      origin:[.5,placement.oy],dxPx:placement.dxPx,dyPx:placement.dyPx };
  }
  function creatureAppearance(o,scene) {
    const art=SpriteLayout.creatureArt(o.kind); if(!art)return null;
    const npc=o.kind==='npc'?SpriteLayout.npcAppearance(o,0,false):null;
    const pose=npc||SpriteLayout.creatureAppearance({...o,_attackUntil:0,_moveUntil:0},0);
    const elite=!npc&&Combat.isElite(o),pet=!npc&&Combat.isTame(o);
    const texKey=npc?.sheet||(pet?Render.petTexture(scene,o.kind,art.sheet,o.tint):elite?Render.vividTexture(scene,o.kind,art.sheet):art.sheet);
    return {visible:true,texKey,frameVal:pose.frame,flipX:!!pose.flipX,
      scl:SpriteLayout.creatureScale(o.kind,SpriteLayout.creatureInstScale(o)),scaleYMul:1,
      origin:[.5,art.foot],dxPx:0,dyPx:SpriteLayout.CREATURE_GROUND_DY-(art.float||0),
      tint:pet&&Number.isFinite(o.tint)?o.tint:npc?.tint??SpriteLayout.creatureTint(o.kind),alpha:SpriteLayout.creatureAlpha(o.kind)};
  }
  function pressurePlateAppearance(o) {
    return {visible:true,texKey:'cave_mechanisms',
      frameVal:((fnv1aFrom(0x706c6174,o.id)>>>0)%2?16:2)+(o.pressed?1:0),
      scl:1,scaleYMul:1,origin:[.5,.5],dxPx:0,dyPx:0,
      displayWidth:SpriteLayout.CELL_PX,displayHeight:SpriteLayout.CELL_PX,
      alpha:o.effect==='ghost'?1:PressureTraps.CONFIG.plateAlpha,tint:o.pressed?0x999999:0xffffff};
  }
  // Review symbols describe the current role without resurrecting facade art.
  // Specialised shop glyphs come from the game's own roof signs.
  const SYMBOLS={
    plain:{label:'House',px:['....#....','...###...','..#####..','.#######.','##.....##','.#.....#.','.#..#..#.','.#..#..#.','.#######.']},
    trailer:{label:'Home',px:['....#....','...###...','..#####..','.#######.','##.....##','.#.#.#.#.','.#.###.#.','.#..#..#.','.#######.']},
    wreck:{label:'Ruin',px:['....#....','...#.#...','..#...#..','.#.....#.','##.....##','.#...#...','.#..#....','.#.#...#.','.##..###.']},
    fort:{label:'Fort',px:['#.#.#.#.#','#########','#.......#','#.......#','#.......#','#..###..#','#..#.#..#','#..#.#..#','#########']},
    castle:{label:'Castle',px:['#.#...#.#','###.#.###','.#.###.#.','.#..#..#.','.#..#..#.','.#.....#.','.#.###.#.','.#.#.#.#.','.#######.']},
    temple:{label:'Temple',px:['....#....','..#####..','#########','.........','.#..#..#.','.#..#..#.','.#..#..#.','.........','#########']},
    shop:{label:'Shop',px:['.#######.','#########','#.#.#.#.#','.........','.#.....#.','.#.##..#.','.#.##..#.','.#.....#.','.#######.']},
    trader:{label:'Trader',px:['.........','..#####..','.#######.','#.......#','.#######.','..#...#..','..#...#..','...###...','.........']},
    wizard:{label:'Wizard',px:['....#....','....##...','...###...','...####..','..#####..','..######.','.#######.','#########','.........']},
    turret:{label:'Turret',px:['..#.#.#..','..#####..','...###...','...#.#...','...###...','...#.#...','...###...','..#####..','.#######.']},
  };
  function buildingSymbol(o,scene) {
    const role=o.kind==='temple'?'temple':scene.save?.starterShopId&&scene.save.starterShopId===o.id?'trailer':o.kind==='tower'||o.tier===12?'castle':Houses.displayRole(scene.save,o)||'plain';
    const theme=role==='shop'?Shops.lineFor(scene.save,o)?.theme:null;
    const glyph=Render.shopSignGlyph(theme,role);
    return {key:theme?`shop:${theme}`:role,label:Shops.roleLabel(role,theme)||SYMBOLS[role]?.label||'House',
      px:glyph||(SYMBOLS[role]||SYMBOLS.plain).px};
  }
  function symbolCanvas(symbol) {
    const c=document.createElement('canvas');c.width=c.height=26;
    const g=c.getContext('2d');
    g.fillStyle='#24291fe8';g.fillRect(2,2,22,22);g.strokeStyle='#d3c7a4';g.lineWidth=1;g.strokeRect(2.5,2.5,21,21);
    g.fillStyle='#f4e5bd';
    symbol.px.forEach((row,y)=>[...row].forEach((v,x)=>{if(v==='#')g.fillRect(4+x*2,4+y*2,2,2);}));
    return c;
  }
  // A horizontal interior span seats a marker inside concave footprints too.
  function footprintPoint(ring) {
    const ys=[];for(let i=1;i<ring.length;i+=2)ys.push(ring[i]);
    const y=(Math.min(...ys)+Math.max(...ys))/2,xs=[];
    for(let i=0,j=ring.length-2;i<ring.length;j=i,i+=2) {
      if((ring[i+1]>y)!==(ring[j+1]>y))xs.push(ring[i]+(y-ring[i+1])*(ring[j]-ring[i])/(ring[j+1]-ring[i+1]));
    }
    xs.sort((a,b)=>a-b);let best=null;
    for(let i=0;i+1<xs.length;i+=2)if(!best||xs[i+1]-xs[i]>best.width)best={x:(xs[i]+xs[i+1])/2,y,width:xs[i+1]-xs[i]};
    return best||{x:ring[0],y:ring[1]};
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
      return assets().then(data=>{this._assets=data;this._prepare();this.redraw();})
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
      this._groundCache.clear();this._groundBytes=0;this._terrainRings=new WeakMap();
      // A changed world or lamp mode must never retain previous art.
      this._canvasTopLeft=null;
      this._drawnSymbols=[];
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
    setReviewTints(enabled) { this._reviewTints=!!enabled;this._invalidateGround();this.redraw();return this; },
    symbolAt(point) { return this._drawnSymbols?.find(s=>Math.abs(s.at.x-point.x)<=s.size/2&&Math.abs(s.at.y-point.y)<=s.size/2); },
    _prepare() {
      if(!this._world||!this._assets)return;
      const scene={save:this._world.scene.save,depth:this._world.scene.depth,textures:this._assets.textures,cellM:WorldGen.CELL_M};
      const roles=new WeakMap();
      for(const e of this._world.tiles)for(const o of e.objects||[])if(o.kind==='house')roles.set(o,Houses.displayRole(scene.save,o));
      const appearancePass=Render.objectAppearance(scene,roles);
      const {resolveAppearance:resolve,fruitList}=appearancePass;
      this._sprites=[];
      const tideDay=utcDayKey();
      const spent=spentSets(scene,scene.save);
      let connectedArt=new Map();
      const add=(e,o,category,symbol=null)=>{
        if(!Number.isFinite(o.x)||!Number.isFinite(o.y))return;
        const override=connectedArt.get(o);
        const art=override?{...o,...override}:o;
        const appearance=symbol?null:o.kind==='pressure_plate'?pressurePlateAppearance(o):o.kind==='_pathvent'?{visible:true,texKey:EnvironmentHazards.CONFIG.vent.texture,frameVal:EnvironmentHazards.VENTS[o.ventKind].row*5+3,scl:SpriteLayout.CELL_PX/EnvironmentHazards.CONFIG.vent.frameSize,scaleYMul:1,origin:EnvironmentHazards.CONFIG.vent.renderAnchor,dxPx:0,dyPx:0}:category==='creature'?creatureAppearance(o,this._assets.scene):category==='plant'?cropAppearance(art,scene):o.kind==='trap'?{visible:true,texKey:'trap_hidden',scl:1,scaleYMul:1,origin:[.5,.5],dxPx:0,dyPx:0}:o.kind==='coindrop'?{visible:true,texKey:Render.coinPile(o).texture,frameVal:0,scl:1,scaleYMul:1,origin:[.5,.5],dxPx:0,dyPx:0,displayWidth:Render.coinPile(o).width,displayHeight:Render.coinPile(o).width}:resolve(art);
        if(appearance?.visible&&category!=='plant'&&category!=='creature'&&o.kind!=='pressure_plate')appearance.tint=Render.spriteTint(art,scene,appearance.texKey);
        if(o.kind==='_streetlamp'&&appearance?.visible&&typeof appearance.spec?.after==='function') {
          // The shipping after hook owns lamp sizing and dark-stone alpha.
          appearance.spec.after({
            setDisplaySize(w,h) { appearance.displayWidth=w;appearance.displayHeight=h;return this; },
            setAlpha(alpha) { appearance.alpha=alpha;return this; },
          },o,scene,appearancePass);
        }
        const kind=category==='creature'?(e?(o.kind==='npc'?'resident: npc':Combat.isEnemy(o)?'enemy: '+o.kind:'animal: '+o.kind):'enemy: garrison'):o.kind==='wildplant'?'plant:'+o.crop:o.kind==='xmark'?'X mark':o.kind;
        // Reuse the game's crown hook, measured at the tree's local origin.
        // Keep fruit with its tree so filtering and painter order stay together.
        const fruit=[];
        if(o.kind==='fruittree'&&appearance?.visible&&typeof appearance.spec?.after==='function') {
          const p=appearance;
          fruitList.length=0;
          p.spec.after({texture:{key:p.texKey},frame:{name:p.frameVal},
            originX:p.origin[0],originY:p.origin[1],scaleX:p.scl,scaleY:p.scl*p.scaleYMul,
            x:p.dxPx,y:p.dyPx,depth:0},o,scene,appearancePass);
          fruit.push(...fruitList);
        }
        this._sprites.push({e,o,category,kind,appearance,fruit,symbol});
      };
      const buildings=new Map(),represented=new Set();
      for(const e of this._world.tiles)for(const o of e.objects||[])if(o.kind==='house'||o.kind==='temple')buildings.set(o.id,o);
      // One identity marker per source footprint, including buildings without
      // a surviving house anchor. Castle corner towers never multiply icons.
      if(!scene.depth)for(const e of this._world.tiles)for(const shape of e.buildingShapes||[]) {
        if(!shape.ring||shape.ring.length<6||shape.key&&represented.has(shape.key))continue;
        const anchor=footprintPoint(shape.ring),original=buildings.get(shape.key);
        const o={...(original||{kind:shape.kind==='temple'?'temple':shape.tier===12?'tower':'house',id:shape.key,tier:shape.tier}),
          x:e.tx*this.options.getEdge()+anchor.x,y:e.ty*this.options.getEdge()+anchor.y};
        if(shape.key)represented.add(shape.key);
        add(e,o,'object',buildingSymbol(o,scene));
      }
      for(const e of this._world.tiles) {
        const edge=this.options.getEdge();
        connectedArt=Render.connectedArtForTile(e,e.tx,e.ty,edge,spent,
          (e.tx+.5)*edge,(e.ty+.5)*edge,edge/2);
        // Lamps are generated infrastructure, outside the spawned-object filters.
        // Share native Rogue geometry and sprite appearance with the game.
        for(const lamp of MapScene.prototype._streetLampsForTile.call(scene,e.tx,e.ty,e)) {
          add(e,{...lamp,kind:'_streetlamp',lit:!!this._restoredLamps},'infrastructure');
        }
        for(const o of e.reefCorals||[])add(e,o,'scenery');
        for(const o of e.objects||[]) {
          if(['house','tower','temple'].includes(o.kind)) {
            const key=o.kind==='tower'?o.castle:o.id;
            if(key&&represented.has(key))continue;
            if(key)represented.add(key);
            add(e,o,'object',buildingSymbol(o,scene));
          } else add(e,o,'object');
        }
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
        for(const o of e.pathVents||e.streetDress?.vents||[])add(e,{...o,ventKind:o.kind,kind:'_pathvent'},'object');
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
    _terrainRing(entry) {
      this._terrainRings ||= new WeakMap();
      if(this._terrainRings.has(entry))return this._terrainRings.get(entry);
      const n=entry.cellsPerEdge,stride=n+2;
      const types=new Int8Array(stride*stride),materials=new Int8Array(stride*stride);
      types.fill(-1);materials.fill(-1);
      const byTile=new Map(this._world.tiles.map(e=>[`${e.tx},${e.ty}`,e]));
      // Only the one-cell border needs cross-tile coordinate resolution.
      for(let y=0;y<n;y++)types.set(entry.grid.subarray(y*n,(y+1)*n),(y+1)*stride+1);
      for(let y=-1;y<=n;y++)for(let x=-1;x<=n;x++) {
        if(x>=0&&x<n&&y>=0&&y<n)continue;
        const gx=entry.tx+(x+.5)/n,gy=entry.ty+(y+.5)/n;
        const tx=Math.floor(gx),ty=Math.floor(gy),e=byTile.get(`${tx},${ty}`);
        if(!e)continue;
        const m=e.cellsPerEdge,ix=Math.floor((gx-tx)*m),iy=Math.floor((gy-ty)*m);
        types[(y+1)*stride+x+1]=e.grid[iy*m+ix];
      }
      // Resolve materials only for visible cells at a zoom that displays them.
      // -1 is a valid missing material; -2 means it has not been resolved yet.
      materials.fill(-2);
      const result={types,materials,stride};this._terrainRings.set(entry,result);return result;
    },
    _terrainMaterial(entry,x,y,native,cell) {
      const index=(y+1)*native.stride+x+1;
      if(native.materials[index]!==-2)return native.materials[index];
      const i=y*entry.cellsPerEdge+x;
      let type=entry.grid[i],material=-1;
      const tintedNative=type===WorldGen.T.CHURCHYARD||type===WorldGen.T.TAR_YARD;
      let textureKey=zoneGroundTexture(entry,i,type);
      if(tintedNative||textureKey||zoneGroundColor(entry,x,y,type)==null) {
        if(WorldGen.isCobbleTerrain(type))type=Render.roadBackdropType(this._world.scene,type,cell.cellIX,cell.cellIY);
        else if(isBuildingType(type)&&!entry.syntheticBuildingCells?.[i])type=this._world.scene.neighborNonRoadType(cell.cellIX,cell.cellIY);
        if(type!=null)material=TerrainTransitions.materialForGround(type,textureKey,cell.cellIX,cell.cellIY);
      }
      if(native.types[index]===32&&typeof MountainEdges!=='undefined') {
        type=MountainEdges.groundType(native.types,native.stride,index);
        textureKey=zoneGroundTexture(entry,i,type);
        material=TerrainTransitions.materialForGround(type,textureKey,cell.cellIX,cell.cellIY);
      }
      native.materials[index]=material;
      return material;
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
            for(const points of MapReviewPaths.clipLine(Streets.subLineM(line,mvtToM,style.a,style.b),edge)) {
              let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
              for(const p of points) {minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
              result.push({width,isPath,variant:style.variant,points,minX,minY,maxX,maxY});
            }
          }
        }
      }
      this._roadGeometry.set(e,result);return result;
    },
    _paintPathWebs(g,e,edge,size,project) {
      const cellM=edge/e.cellsPerEdge;
      const anchors=[[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
      for(const web of e.spiderPathWebs||e.streetDress?.webs||[]) {
        const at=project(web.x,web.y),side=Math.abs(project(web.x+cellM,web.y).x-at.x),half=side/2;
        if(side<4||at.x+half<0||at.y+half<0||at.x-half>size.x||at.y-half>size.y)continue;
        const radius=half-Math.max(.5,side/32);
        g.fillStyle='rgba(224,232,239,.1)';g.fillRect(at.x-half,at.y-half,side,side);
        g.lineWidth=Math.max(.5,side/32);g.strokeStyle='rgba(229,237,244,.8)';g.beginPath();
        for(const [x,y] of anchors){g.moveTo(at.x,at.y);g.lineTo(at.x+x*radius,at.y+y*radius);}g.stroke();
        g.strokeStyle='rgba(211,227,238,.65)';
        for(const fraction of [.28,.56,.84,1]) {
          g.beginPath();
          anchors.forEach(([x,y],i)=>{
            if(!i){g.moveTo(at.x+x*radius*fraction,at.y+y*radius*fraction);return;}
            const prev=anchors[i-1];
            g.lineTo(at.x+(prev[0]+x)*radius*fraction*.44,at.y+(prev[1]+y)*radius*fraction*.44);
            g.lineTo(at.x+x*radius*fraction,at.y+y*radius*fraction);
          });
          g.lineTo(at.x+(anchors[7][0]+anchors[0][0])*radius*fraction*.44,
            at.y+(anchors[7][1]+anchors[0][1])*radius*fraction*.44);
          g.closePath();g.stroke();
        }
        g.fillStyle='rgba(246,248,255,.85)';g.beginPath();g.arc(at.x,at.y,Math.max(.6,side/32*1.5),0,Math.PI*2);g.fill();
      }
    },
    _paintBuildingFootprints(g,size,project) {
      if(this._world.scene.depth)return;
      const edge=this.options.getEdge();
      this._buildingBounds ||= new WeakMap();
      for(const e of this._world.tiles)for(const shape of e.buildingShapes||[]) {
        const ring=shape.ring;
        if(!ring||ring.length<6)continue;
        let bounds=this._buildingBounds.get(shape);
        if(!bounds) {
          bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
          for(let i=0;i<ring.length;i+=2) {
            bounds.minX=Math.min(bounds.minX,ring[i]);bounds.maxX=Math.max(bounds.maxX,ring[i]);
            bounds.minY=Math.min(bounds.minY,ring[i+1]);bounds.maxY=Math.max(bounds.maxY,ring[i+1]);
          }
          this._buildingBounds.set(shape,bounds);
        }
        const ox=e.tx*edge,oy=e.ty*edge;
        const a=project(ox+bounds.minX,oy+bounds.minY),b=project(ox+bounds.maxX,oy+bounds.maxY);
        if(a.x>size.x+1||a.y>size.y+1||b.x<-1||b.y<-1)continue;
        g.beginPath();
        for(let i=0;i<ring.length;i+=2) {
          const p=project(ox+ring[i],oy+ring[i+1]);
          g[i?'lineTo':'moveTo'](p.x,p.y);
        }
        g.closePath();
        g.fillStyle='#'+(BUILDING_FACE_COLOR[shape.tier]??BUILDING_FACE_COLOR[9]).toString(16).padStart(6,'0');
        g.fill();g.strokeStyle='#302c26';g.lineWidth=1;g.lineJoin='round';g.stroke();
      }
    },
    _paintGround(g,size,project) {
      const edge=this.options.getEdge(),textures=this._assets.textures;
      for(const e of this._world.tiles) {
        const a=project(e.tx*edge,e.ty*edge),b=project((e.tx+1)*edge,(e.ty+1)*edge),N=e.cellsPerEdge;
        const dx=(b.x-a.x)/N,dy=(b.y-a.y)/N;
        // Include road caps that extend beyond the source tile.
        if(a.x>size.x+128||a.y>size.y+128||b.x < -128||b.y < -128)continue;
        const native=!this._world.scene.depth&&this._assets.scene?._terrainTransitionsReady?this._terrainRing(e):null;
        const x0=Math.max(0,Math.floor(-a.x/dx)),y0=Math.max(0,Math.floor(-a.y/dy));
        const x1=Math.min(N,Math.ceil((size.x-a.x)/dx)),y1=Math.min(N,Math.ceil((size.y-a.y)/dy));
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++) {
          let type=e.grid[y*N+x];
          if(WorldGen.isCobbleTerrain(type)) {
            const cell=tileCellToAbs(this._world.scene,e.tx,e.ty,x,y);
            type=Render.roadBackdropType(this._world.scene,type,cell.cellIX,cell.cellIY);
          }
          // Source polygons own the building silhouette. Keep ordinary ground
          // beneath them instead of leaking square floor tiles around the ring.
          const polygonGround=!this._world.scene.depth&&e.buildingShapes?.length&&isBuildingType(type)&&!e.syntheticBuildingCells?.[y*N+x];
          if(polygonGround) {
            const cell=tileCellToAbs(this._world.scene,e.tx,e.ty,x,y);
            type=this._world.scene.neighborNonRoadType(cell.cellIX,cell.cellIY)??WorldGen.T.GRASS;
          }
          const zoneTexture=typeof zoneGroundTexture==='function' && zoneGroundTexture(e,y*N+x,polygonGround?type:e.grid[y*N+x]);
          let selected=null,rock=null;
          if(native&&type===32&&typeof MountainEdges!=='undefined') {
            const cell=tileCellToAbs(this._world.scene,e.tx,e.ty,x,y),index=(y+1)*native.stride+x+1;
            rock=MountainEdges.select(native.types,native.stride,index,cell.cellIX,cell.cellIY);
            type=MountainEdges.groundType(native.types,native.stride,index);
          }
          if(native&&dx>=4) {
            const cell=tileCellToAbs(this._world.scene,e.tx,e.ty,x,y),index=(y+1)*native.stride+x+1;
            // Review the actual material interior without blending neighbouring cells.
            const material=this._terrainMaterial(e,x,y,native,cell);
            selected=TerrainTransitions.select(this._assets.scene,[material,material,material,material],2,0,cell.cellIX,cell.cellIY);
          }
          const texture=selected&&textures.get(selected.key),frame=texture?.get(selected.frame);
          if(frame) {
            // Integer coverage prevents the old ground colour leaking between cells.
            const left=Math.floor(a.x+x*dx),top=Math.floor(a.y+y*dy);
            g.drawImage(texture.getSourceImage(),frame.cutX,frame.cutY,frame.width,frame.height,left,top,
              Math.ceil(a.x+(x+1)*dx)-left,Math.ceil(a.y+(y+1)*dy)-top);
            for(const layer of selected.layers||[]) {
              const overlay=texture.get(layer);
              g.drawImage(texture.getSourceImage(),overlay.cutX,overlay.cutY,overlay.width,overlay.height,left,top,
                Math.ceil(a.x+(x+1)*dx)-left,Math.ceil(a.y+(y+1)*dy)-top);
            }

          } else {
            const spec=BIOME_TEX[type],h=((e.tx*N+x)*2246822519)^((e.ty*N+y)*3266489917);
            g.fillStyle='#'+(zoneGroundColor(e,x,y,type)??COLORS[type]??0x71845b).toString(16).padStart(6,'0');g.fillRect(a.x+x*dx,a.y+y*dy,dx+.5,dy+.5);
            if((zoneTexture||spec)&&dx>=4)g.drawImage(textures.get(zoneTexture||`biome${type}_${Math.abs(h)%spec.variants}`).getSourceImage(),a.x+x*dx,a.y+y*dy,dx+.5,dy+.5);
          }
          if(rock&&dx>=4) {
            const texture=textures.get(rock.key),frame=texture?.get(rock.frame);
            if(frame)g.drawImage(texture.getSourceImage(),frame.cutX,frame.cutY,frame.width,frame.height,
              Math.floor(a.x+x*dx),Math.floor(a.y+y*dy),Math.ceil(a.x+(x+1)*dx)-Math.floor(a.x+x*dx),Math.ceil(a.y+(y+1)*dy)-Math.floor(a.y+y*dy));
          }
          const sand=this._reviewTints&&pirateSand(e,y*N+x);
          if(sand){g.fillStyle=sand.wash;g.fillRect(a.x+x*dx,a.y+y*dy,dx+.5,dy+.5);}
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
              const selected=RoadOverlay.selectedRoadTile(road.variant,!!this._restoredLamps);
              tile=document.createElement('canvas');tile.width=tile.height=selected?.width||RoadOverlay.CLEAN_TILE_PX;
              RoadOverlay.paintPavementTile(tile.getContext('2d'),tile.width,road.isPath,!!this._restoredLamps,road.variant);
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
        this._paintPathWebs(g,e,edge,size,project);
      }
      // All terrain first: a ring crossing a tile boundary must not be erased
      // by the neighbouring tile. This pass is retained in the ground cache.
      this._paintBuildingFootprints(g,size,project);
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
      const symbols=[];
      this._drawGround(g,chunks);
      const first=this._world.tiles[0];
      if(first)detailed=(project((first.tx+1)*edge,first.ty*edge).x-project(first.tx*edge,first.ty*edge).x)/first.cellsPerEdge>=4;
      for(const item of this._visibleSprites(size,project)) {
        const {e,o,category,appearance:p}=item;
        if(category!=='infrastructure'&&this.options.visible&&!this.options.visible(e,o,category,item.kind))continue;
        const at=project(o.x,o.y);if(at.x < -180 || at.y < -180 || at.x>size.x+180||at.y>size.y+180)continue;
        if(item.symbol) { if(zoom>=17)symbols.push({symbol:item.symbol,at,o});continue; }
        const cellM=edge/(e?.cellsPerEdge||this._world.tiles[0].cellsPerEdge);
        const scale=(project(o.x+cellM,o.y).x-at.x)/32;
        if(scale*32<4)continue;
        if(o.kind==='xmark') { const great=isGreatX(o);const r=(great?GREAT_X.halfSize:5.1)*scale;g.strokeStyle=great?'#6e0b0be6':'#2a1d108c';g.lineWidth=(great?GREAT_X.width:2)*scale;g.beginPath();g.moveTo(at.x-r,at.y-r);g.lineTo(at.x+r,at.y+r);g.moveTo(at.x+r,at.y-r);g.lineTo(at.x-r,at.y+r);g.stroke();continue; }
        if(!p?.visible)continue;
        const t=p?.visible&&textures.get(p.texKey),f=t&&t.get(p.frameVal);
        if(!f) {g.fillStyle='#ffd86a';g.fillRect(at.x-1,at.y-1,3,3);continue;}
        const w=(p.displayWidth??f.width*p.scl)*scale,h=(p.displayHeight??f.height*p.scl*p.scaleYMul)*scale;
        g.globalAlpha=p.alpha??1;
        const source=this._tintedFrame(t,f,p.tint);
        g.save();g.translate(at.x+p.dxPx*scale,at.y+p.dyPx*scale);
        if(p.flipX)g.scale(-1,1);
        g.drawImage(source,0,0,f.width,f.height,-w*p.origin[0],-h*p.origin[1],w,h);g.restore();drawn++;
        g.globalAlpha=1;
        for(const fruit of item.fruit) {
          const ft=textures.get(fruit.key),ff=ft?.get(fruit.frame);
          if(!ff)continue;
          const fw=ff.width*fruit.scale*scale,fh=ff.height*fruit.scale*scale;
          g.drawImage(ft.getSourceImage(),ff.x,ff.y,ff.width,ff.height,
            at.x+fruit.x*scale-fw/2,at.y+fruit.y*scale-fh/2,fw,fh);
        }
      }
      this._symbolCanvases ||= new Map();
      this._drawnSymbols=[];
      const occupied=new Set(),symbolSize=zoom>=19?26:22;
      const priority={trailer:0,temple:1,castle:2,fort:3,wreck:5};
      symbols.sort((a,b)=>(priority[a.symbol.key]??4)-(priority[b.symbol.key]??4));
      for(const {symbol,at,o} of symbols) {
        const cells=[];
        for(let y=Math.floor((at.y-symbolSize/2)/26);y<=Math.floor((at.y+symbolSize/2)/26);y++)
          for(let x=Math.floor((at.x-symbolSize/2)/26);x<=Math.floor((at.x+symbolSize/2)/26);x++)cells.push(x+','+y);
        if(cells.some(key=>occupied.has(key)))continue;
        cells.forEach(key=>occupied.add(key));
        if(!this._symbolCanvases.has(symbol.key))this._symbolCanvases.set(symbol.key,symbolCanvas(symbol));
        g.drawImage(this._symbolCanvases.get(symbol.key),Math.round(at.x-symbolSize/2),Math.round(at.y-symbolSize/2),symbolSize,symbolSize);
        this._drawnSymbols.push({symbol,at,o,size:symbolSize});
      }
      this.options.onStatus?.(detailed?`Game art · ${drawn.toLocaleString()} sprites in view${this._assets.failures.length?' · '+this._assets.failures.length+' missing assets':''}`:'Game art · zoom in for textures and sprites');
      return this;
    },
  });
  return {layer:options=>new Layer(options),pirateSand,cropAppearance,creatureAppearance,buildingSymbol,footprintPoint,
    symbolLegend:()=>[...Object.values(SYMBOLS),...['blacksmith','workshop'].map(role=>({label:Shops.roleLabel(role),px:Render.shopSignGlyph(null,role)}))].map(symbol=>({label:symbol.label,url:symbolCanvas(symbol).toDataURL()}))};
})();
