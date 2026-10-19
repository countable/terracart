// Restoration is the boundary for the player's machinery language. The cel
// draw hashes were recorded from the unmodified renderer before this lane:
// FNV-1a over ordered [colour,x,y,w,h] fillRect commands, without pixel readback.
// They protect every unrestored facade, especially the excluded turret/wrecks.
// The wizard is an octagonal tower with its own geometry and sheet, so it has
// no cel hash; its own test below pins the tower shape.
(() => {
  const legacyDraw = {
    plain:'dc07bb39', home:'dc07bb39', blacksmith:'9ac6f375', trader:'2decdc36',
    shop:'fb351d54', seed:'9726ff68', supply:'3e8d8cc2', potion:'ff5c4622',
    relic:'585f4c84', pet:'12302f53', book:'b1d1cfe1',
    turret:'96256447', wreck:'6ca590b9',
  };
  const roofs = { plain:'copper', home:'copper', blacksmith:'blueSlate',
    shop:'blueSlate', trader:'verdigris', seed:'strawGreen', supply:'verdigris',
    potion:'violet', relic:'red', pet:'strawGreen', book:'plum' };
  // B3 baselines pin roof texture commands (without/with packed art) and
  // vertex positions for rectangle/L footprints. Chimney UVs may change;
  // no texture detail is allowed to grow the mesh or move a roof vertex.
  const roofDraw = {
    plain:['b29b6d3f','9072ceff'], home:['b29b6d3f','9072ceff'],
    blacksmith:['d581b23c','64195590'], shop:['d581b23c','64195590'],
    trader:['bccfe5e0','5ff58604'], supply:['bccfe5e0','5ff58604'],
    seed:['5c21a07','2b4309f3'], pet:['5c21a07','2b4309f3'],
    potion:['fcfb926e','84f757b6'], relic:['fad7ce38','8a026a7c'],
    book:['47314874','43d150fc'],
  };
  const geometryDraw = {
    single:['f6eee85d','7042b8a6'], double:['42c7c52b','58dfc70b'],
    smith:['68274d75','e446060a'],
  };
  const shops = ['shop','trader','seed','supply','potion','relic','pet','book'];
  // Expose the real private baker locally so cache tests need no WebGL/DOM.
  const source = BUILDING_LOWPOLY_SRC.replace('global.BuildingLowPoly={', 'global.BuildingLowPoly={celSheet,SHEET_SRC,facadeMaterials,');
  const api = new Function('window','BuildingStyles','Phaser', source + '\nreturn window.BuildingLowPoly;')(
    {}, window.BuildingStyles, { Textures:{FilterMode:{NEAREST:0}} });
  // The release list gates which designs are live; these tests cover every design.
  const live=api.LOOK.restoredRoles;api.LOOK.restoredRoles=null;
  test('steampunk: only the relic shop is restored in the live game', () => {
    assert.eq(JSON.stringify(live),JSON.stringify(['relic']));
    const gated=new Function('window','BuildingStyles','Phaser', source + '\nreturn window.BuildingLowPoly;')({}, window.BuildingStyles, { Textures:{FilterMode:{NEAREST:0}} });
    for(const role of Object.keys(roofs)) {
      const restored=gated.recipeFor(role,{},undefined,true),old=gated.recipeFor(role,{},undefined,false);
      if(role==='relic')assert.eq(restored.facadeKit,'shop','relic restored');
      else assert.eq(JSON.stringify(restored),JSON.stringify(old),role+' stays legacy when restored');
    }
  });
  function sceneStub() {
    const textures = new Map();
    const scene = { baked:0,
      loadSource() { textures.set('approved_materials_v1',{getSourceImage:() => ({source:'approved-materials-v1'})}); },
      textures:{
      exists:key => textures.has(key), get:key => textures.get(key),
      createCanvas(key) {
        scene.baked++;
        const commands = [], ctx = { fillStyle:'', imageSmoothingEnabled:false,
          fillRect(...args) { commands.push([this.fillStyle,...args]); },
          drawImage(...args) { commands.push(['drawImage',...args]); },
          save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
          getImageData() { throw new Error('Restoration must not read pixels during a rebuild'); },
        };
        const texture = { key, commands, getContext:() => ctx, refresh() {}, setFilter() {} };
        textures.set(key,texture); return texture;
      },
    } };
    return scene;
  }
  function drawHash(commands) {
    let hash=2166136261;
    for(const c of JSON.stringify(commands)) hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
    return hash.toString(16);
  }
  test('steampunk: only explicitly restored in-scope roles select the new materials', () => {
    assert.eq(JSON.stringify(Object.keys(api.RESTORED_ROLES).sort()), JSON.stringify(Object.keys(roofs).sort()));
    for(const [role, roof] of Object.entries(roofs)) {
      const old = api.recipeFor(role,{},undefined,false), restored = api.recipeFor(role,{},undefined,true);
      assert.eq(JSON.stringify(api.recipeFor(role)),JSON.stringify(old),role+' defaults to legacy');
      assert.eq(restored.roofMaterial,roof,role+' concept roof');
      assert.eq(restored.facadeTrim,'brass',role+' brass opening frames');
      const house=role==='plain'||role==='home',smith=role==='blacksmith';
      assert.eq(restored.wallCell,smith?'smithStone':house?'whitePlaster':'orangeBrick',role+' wall tile');
      assert.eq(restored.facadeKit,smith?'smith':house?'house':'shop',role+' opening family');
      assert.eq(restored.chimneyFinish,'wall',role+' chimney uses its wall material');
      assert.eq(restored.upperWallCell,house||smith?undefined:'whitePlaster',role+' upper wall');
      assert.eq(!!restored.braces,house,role+' full-panel braces only on homes');
      assert.eq(restored.emblem,smith?'cog':house?undefined:role,role+' single emblem');
      if(house)assert.eq(restored.body,0xeeeee4,role+' white plaster');
      for(const key of ['facadeKit','braces','emblem','chimneyFinish','awning','upperWallCell','shopWalls'])
        assert.falsy(old[key],role+' unrestored '+key+' stays legacy');
      assert.falsy(old.wallCell,role+' unrestored wall stays legacy');
      assert.falsy(old.facadeTrim,role+' unrestored frames stay legacy');
    }
  });
  test('steampunk: unrestored cel drawing remains byte-for-byte equivalent in every role', () => {
    for(const [role, expected] of Object.entries(legacyDraw)) {
      const texture=api.celSheet(sceneStub(),api.recipeFor(role));
      assert.eq(drawHash(texture.commands),expected,role+' legacy fill commands');
    }
  });
  test('steampunk: excluded roles ignore restoration for all recipe inputs', () => {
    for(const role of ['wizard','fort','castle','turret','wreck']) {
      for(const palette of [{},{wall:0xa0b0c0,roof:0x493627,trim:0x765432}]) for(const stories of [undefined,1,3]) {
        const old=api.recipeFor(role,palette,stories,false), restored=api.recipeFor(role,palette,stories,true);
        assert.eq(JSON.stringify(restored),JSON.stringify(old),role+' recipe unchanged');
      }
      if(legacyDraw[role]) {
        const texture=api.celSheet(sceneStub(),api.recipeFor(role,{},undefined,true));
        assert.eq(drawHash(texture.commands),legacyDraw[role],role+' restored fill commands unchanged');
      }
    }
  });
  test('steampunk: commerce roles share the complete facade language', () => {
    const first=api.recipeFor('shop',{},undefined,true);
    for(const role of shops) {
      const recipe=api.recipeFor(role,{},undefined,true);
      for(const key of ['material','wallCell','body','finish','window','framing','facadeTrim','trim','shopfront','facadeKit','braces','chimneyFinish','awning','upperWallCell','shopWalls']) {
        assert.eq(recipe[key],first[key],role+' shares '+key);
      }
      assert.eq(recipe.window,'brassShop'); assert.eq(recipe.shopfront,true);
      assert.eq(recipe.framing,'darkTimber');
    }
    for(const role of ['plain','home','blacksmith']) assert.eq(api.recipeFor(role,{},undefined,true).window,'porthole');
  });
  test('steampunk: facade options separate cached sheets; repeated recipes and storeys reuse them', () => {
    const scene=sceneStub(), base=api.recipeFor('shop',{},undefined,true), original=api.celSheet(scene,base);
    assert.eq(api.celSheet(scene,{...base}),original,'same recipe reuses canvas');
    assert.eq(api.celSheet(scene,{...base,stories:3}),original,'storeys are UV choices');
    assert.eq(scene.baked,1,'no per-building allocation');
    for(const [key,value] of Object.entries({facadeTrim:undefined,framing:undefined,shopfront:false,wallCell:undefined,window:'porthole',facadeKit:'house',braces:true,emblem:'potion',chimneyFinish:undefined,awning:false,facadeVariant:'B',shopWalls:'plank',upperWallCell:'boards'})) {
      const changed=api.celSheet(scene,{...base,[key]:value});
      assert.truthy(changed!==original,key+' must participate in the cache key');
      assert.eq(api.celSheet(scene,{...base,[key]:value}),changed,key+' variant is cached');
    }
  });
  test('steampunk: PP variants and shop wall alternative select separate reusable material sheets', () => {
    const scene=sceneStub();scene.loadSource();
    const recipe=api.recipeFor('shop',{},undefined,true),a=api.celSheet(scene,recipe);
    const b=api.celSheet(scene,{...recipe,facadeVariant:'B'});
    assert.truthy(a!==b,'A and B must not share a cache entry');
    assert.eq(api.celSheet(scene,{...recipe,facadeVariant:'B'}),b,'B is reusable');
    api.LOOK.facadeVariant='B';
    try {
      assert.eq(api.celSheet(scene,recipe),b,'global switch selects B');
      assert.eq(api.celSheet(scene,{...recipe,facadeVariant:'A'}),a,'recipe override selects A');
      for(const [role,expected] of Object.entries(legacyDraw))
        assert.eq(drawHash(api.celSheet(scene,api.recipeFor(role)).commands),expected,role+' ignores global variant');
    } finally { api.LOOK.facadeVariant='A'; }
    for(const variant of ['A','B'])for(const role of Object.keys(roofs)) {
      const base={...api.recipeFor(role,{},undefined,true),facadeVariant:variant};
      const choices=role==='plain'||role==='home'?['whitePlaster']:role==='blacksmith'?['smithStone']:['orangeBrick','whitePlaster'];
      const texture=api.celSheet(scene,base);
      for(const [i,material] of choices.entries()) {
        const rect=api.SHEET_SRC.surfaces[variant+material];
        assert.truthy(rect,variant+' '+material+' packed surface');
        const samples=texture.commands.filter(c=>c[0]==='drawImage'&&c[2]===rect[0]&&c[3]===rect[1]);
        assert.truthy(samples.some(c=>c[7]===0),role+' '+variant+' wall samples '+material);
        if(i===0)assert.truthy(samples.some(c=>c[7]===105),role+' '+variant+' chimney samples the same ground wall');
      }
    }
    const plank={...recipe,shopWalls:'plank'},material=api.facadeMaterials(plank);
    assert.eq(material.wall,'boards');assert.eq(material.upper,'boards');
    assert.truthy(api.celSheet(scene,plank)!==a,'all-plank option separates the cache');
  });
  test('steampunk: source availability invalidates fallback once and samples restored cells without pixel readback', () => {
    const scene=sceneStub(), recipe=api.recipeFor('shop',{},undefined,true);
    const fallback=api.celSheet(scene,recipe);
    assert.falsy(fallback.commands.some(c=>c[0]==='drawImage'),'fallback has no source samples');
    scene.loadSource();
    const packed=api.celSheet(scene,recipe);
    assert.truthy(packed!==fallback,'loaded source cannot reuse the fallback');
    assert.truthy(packed.commands.some(c=>c[0]==='drawImage'),'the shipped sheet supplies restored surfaces');
    assert.eq(api.celSheet(scene,recipe),packed,'loaded recipe reuses its single baked sheet');
    assert.eq(scene.baked,2,'one fallback and one loaded sheet');
    for(const role of ['turret','wreck']) {
      const texture=api.celSheet(scene,api.recipeFor(role,{},undefined,true));
      assert.eq(drawHash(texture.commands),legacyDraw[role],role+' still uses its legacy facade with source loaded');
    }
  });
  test('steampunk: restored openings and single role emblems sample the packed facade parts', () => {
    for(const role of Object.keys(roofs)) {
      const scene=sceneStub();scene.loadSource();
      const recipe=api.recipeFor(role,{},undefined,true),texture=api.celSheet(scene,recipe);
      const house=role==='plain'||role==='home',smith=role==='blacksmith';
      const v=recipe.facadeVariant||api.LOOK.facadeVariant;
      const parts=[v+(house?'houseDoor':smith?'smithDoor':'shopDoor'),v+(house||smith?'timberWindow':'shopWindow')];
      if(recipe.emblem)parts.push(recipe.emblem);
      for(const name of parts) {
        const [x0,y0,x1,y1]=api.SHEET_SRC.parts[name];
        const samples=texture.commands.filter(c=>c[0]==='drawImage'&&c[2]===x0&&c[3]===y0&&c[4]===x1-x0&&c[5]===y1-y0);
        assert.truthy(samples.length,role+' samples '+name+' from shipped art');
        if(name===recipe.emblem)assert.eq(samples.length,1,role+' has one emblem on the entrance');
      }
    }
  });
  function partSamples(texture,name,variant='A') {
    const [x0,y0,x1,y1]=api.SHEET_SRC.parts[variant+name]||api.SHEET_SRC.parts[name];
    return texture.commands.filter(c=>c[0]==='drawImage'&&c[2]===x0&&c[3]===y0&&c[4]===x1-x0&&c[5]===y1-y0)
      .map(c=>({x:c[6],y:c[7],w:c[8],h:c[9]}));
  }
  function overlaps(a,b) { return a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h; }
  test('steampunk: commerce glazing fills every bay with roof-coloured awnings and a separate upper sign', () => {
    for(const role of shops) {
      const scene=sceneStub();scene.loadSource();
      const recipe=api.recipeFor(role,{},undefined,true),texture=api.celSheet(scene,recipe);
      const door=partSamples(texture,'shopDoor'),sign=partSamples(texture,role);
      assert.eq(door.length,1,role+' one glazed entrance');
      assert.eq(door[0].w,20);assert.eq(door[0].h,24);
      assert.eq(sign.length,1,role+' one sign');assert.eq(sign[0].w,20);assert.eq(sign[0].h,18);
      assert.lte(sign[0].y+sign[0].h,door[0].y,role+' sign clears the full-height door');
      assert.falsy(overlaps(sign[0],door[0]),role+' sign does not cover door glass');
      const windows=partSamples(texture,'brassWindow');
      for(let floor=1;floor<4;floor++)for(let bay=0;bay<13;bay++) {
        const x=Math.round(2+39*bay+(39-16)/2),y=105-24*(floor+1)+4;
        assert.eq(windows.filter(w=>w.x===x&&w.y===y&&w.w===16&&w.h===16).length,
          floor===1&&bay===6?0:1,role+' upper window in floor '+floor+' bay '+bay);
      }
      for(const window of windows)assert.falsy(overlaps(sign[0],window),role+' sign replaces its upper window');
      const displays=partSamples(texture,'shopWindow'),awnings=partSamples(texture,'awning'+roofs[role]);
      assert.truthy(displays.some(w=>w.w===74&&w.h===15),role+' two-bay display');
      for(let bay=0;bay<13;bay++)if(bay!==6)
        assert.truthy(displays.some(w=>w.x===4+39*bay&&w.y===89&&w.w===35&&w.h===15),role+' ground glazing in bay '+bay);
      assert.eq(awnings.length,displays.length,role+' every display has an awning');
      for(const display of displays) {
        assert.falsy(overlaps(door[0],display),role+' display clears entrance');
        assert.truthy(awnings.some(a=>a.x===display.x-1&&a.y+a.h===display.y&&a.w===display.w+2&&a.h===8),role+' canopy sits directly above glass');
      }
      for(const name of Object.keys(api.SHEET_SRC.parts).filter(n=>n.startsWith('awning')&&n!=='awning'+roofs[role]))
        assert.eq(partSamples(texture,name).length,0,role+' never samples another roof tint');
    }
  });
  test('steampunk: smith cog sits beside a full-height door and long faces gain windows in every bay', () => {
    for(const role of ['plain','home','blacksmith']) {
      const scene=sceneStub();scene.loadSource();
      const recipe=api.recipeFor(role,{},undefined,true),texture=api.celSheet(scene,recipe),smith=role==='blacksmith';
      const v=recipe.facadeVariant||api.LOOK.facadeVariant;
      const door=partSamples(texture,smith?'smithDoor':'houseDoor',v)[0];
      assert.eq(door.h,24,role+' full-height entrance');
      const windows=partSamples(texture,'timberWindow',v);
      for(const bay of [0,1,2,3,4,5,7,8,9,10,11,12])
        assert.truthy(windows.some(w=>w.x===Math.round(2+39*bay+(39-14)/2)&&w.y===85&&w.w===14&&w.h===14),role+' opening in ground bay '+bay);
      if(smith) {
        const cog=partSamples(texture,'cog');assert.eq(cog.length,1);
        assert.eq(cog[0].w,18);assert.eq(cog[0].h,18);
        assert.gte(cog[0].x,door.x+door.w,role+' cog beside door');
        assert.falsy(overlaps(cog[0],door),'cog leaves door panel visible');
        for(const window of windows)assert.falsy(overlaps(cog[0],window),'cog clears neighbouring windows');
      }
    }
  });
  test('steampunk: restored walls fit narrow L returns without repeating entrance details', () => {
    const lot=[{x:0,y:0},{x:96,y:0},{x:96,y:32},{x:64,y:32},{x:64,y:64},{x:0,y:64}];
    for(const role of ['plain','home','shop','blacksmith']) {
      const scene=sceneStub();scene.loadSource();
      scene._lowpoly={buildings:[],faces:[],keys:new Set(),textures:new Set(),
        pool:[{_huAnchor:{},setPosition(){},setDepth(){}}],offsetX:0,offsetY:0};
      const mesh=api.add(scene,lot,api.recipeFor(role,{},undefined,true),'ridge','opening-test',[],2),walls=new Map();
      for(const face of mesh.faces) {
        if(face.kind!=='wall'||!face.wallSpan||face.rawUV||face.solid)continue;
        const [lo,hi]=face.wallSpan;
        if(Math.abs((lo+hi)/2-253.5)<1e-6) {
          for(const p of face.points) {
            const wrap=(p.u-p.tu*512)/468;
            assert.truthy(Math.abs(wrap-Math.round(wrap))<1e-6,role+' entrance UV keeps its original bay, allowing only atlas wrap');
          }
          continue;
        }
        const key=JSON.stringify([face.wallSpan,face.wallDirection]);
        if(!walls.has(key))walls.set(key,[]);
        walls.get(key).push(...face.points.map(p=>p.tu*512));
      }
      assert.gte(walls.size,3,role+' exercises several non-entrance spans');
      let narrow=false;
      for(const [key,texels] of walls) {
        const [[lo,hi]]=JSON.parse(key),bays=Math.max(1,Math.min(5,Math.round((hi-lo)/39)));
        if(bays===1)narrow=true;
        assert.truthy(Math.abs(Math.min(...texels)-2)<1e-6,role+' first opening bay starts at wall edge');
        assert.truthy(Math.abs(Math.max(...texels)-(2+bays*39))<1e-6,role+' full final opening bay survives corner treatment');
      }
      assert.truthy(narrow,role+' narrow return includes one complete opening bay');
    }
  });
  test('steampunk: restored door panels keep their geometry and sample facade art after camera rotation', () => {
    const lot=[{x:0,y:0},{x:96,y:0},{x:96,y:64},{x:0,y:64}];
    const place=recipe=>{
      const scene=sceneStub();scene.loadSource();
      scene._lowpoly={buildings:[],faces:[],keys:new Set(),textures:new Set(),
        pool:[{_huAnchor:{},setPosition(){},setDepth(){}}],offsetX:0,offsetY:0};
      scene.buildingWallContainer={sort(){}};
      const mesh=api.add(scene,lot,recipe,'ridge','door-test',[],2);
      return {scene,faces:mesh.faces.filter(f=>f.door)};
    };
    for(const role of ['plain','shop','blacksmith']) {
      const recipe=api.recipeFor(role,{},undefined,true);
      const restored=place(recipe),old=place({...recipe,facadeKit:undefined});
      const vertices=faces=>faces.map(f=>f.points.map(p=>[p.x,p.y,p.z]));
      assert.truthy(restored.faces.length,role+' has an entrance panel');
      assert.eq(JSON.stringify(vertices(restored.faces)),JSON.stringify(vertices(old.faces)),role+' reuses entrance geometry');
      for(const angle of [0,Math.PI/4]) {
        restored.scene.mapRot=angle;api.update(restored.scene);
        for(const face of restored.faces) {
          assert.truthy(face.facadeDoor,role+' entrance uses the facade material');
          for(const p of face.projected) {
            assert.truthy(p.u!==510/512||p.v!==126/512,role+' entrance must not sample the solid trim texel');
            assert.gte(p.v,81/512,role+' entrance inside opening rows');
            assert.lte(p.v,105/512,role+' entrance above ground line');
          }
        }
      }
    }
  });
  test('steampunk: only restored chimneys gain metal caps, dark mouths and soot below the cap', () => {
    const lot=[{x:0,y:0},{x:96,y:0},{x:96,y:64},{x:0,y:64}];
    for(const role of Object.keys(roofs))for(const restored of ['plain','home','blacksmith'].includes(role)?[false,true]:[true]) {
      const scene=sceneStub();scene.loadSource();
      scene._lowpoly={buildings:[],faces:[],keys:new Set(),textures:new Set(),
        pool:[{_huAnchor:{},setPosition(){},setDepth(){}}],offsetX:0,offsetY:0};
      const recipe=api.recipeFor(role,{},undefined,restored);
      const mesh=api.add(scene,lot,recipe,'ridge','chimney-test',[],2);
      const chimney=mesh.faces.filter(f=>f.chimney),sides=chimney.filter(f=>f.kind==='wall');
      const smith=role==='blacksmith',label=role+' '+(restored?'restored':'legacy');
      assert.truthy(sides.length,label+' retains its stack');
      for(const [layer,expected] of [[2.62,restored?0x9c6b3d:(smith?recipe.body:0x9c8f84)],
        [2.7,restored?recipe.trim:(smith?recipe.body:0x9c8f84)],
        [2.71,restored?0x32131e:0x2a2229]]) {
        const faces=chimney.filter(f=>f.layer===layer);
        assert.truthy(faces.length,label+' retains cap/mouth layer '+layer);
        for(const face of faces)assert.eq(face.color,expected,label+' cap/mouth color '+layer);
      }
      const commands=api.celSheet(scene,recipe).commands;
      const soot=commands.some(c=>c[0]==='#32131e'&&c[1]===0&&c[2]===105&&c[3]===508&&c[4]===2);
      assert.eq(soot,restored,label+' soot is restoration-only');
      if(restored)for(const face of sides) {
        assert.eq(face.color,0xffffff,label+' samples untinted courses');
        const top=Math.max(...face.points.map(p=>p.z));
        for(const p of face.points) {
          assert.gte(p.tv,105/512,label+' side stays in chimney rows');
          assert.lte(p.tv,128/512,label+' side never samples the roof');
          if(p.z===top)assert.eq(p.tv,105/512,label+' top samples soot immediately below the cap');
          else assert.truthy(p.tv>105/512,label+' courses extend down from soot');
        }
      }
    }
  });
  test('steampunk: wall detail preserves every restored roof texture and roof tint', () => {
    for(const [role,expected] of Object.entries(roofDraw))for(const packed of [false,true])for(const variant of ['A','B']) {
      const scene=sceneStub();if(packed)scene.loadSource();
      const texture=api.celSheet(scene,{...api.recipeFor(role,{},undefined,true),facadeVariant:variant});
      // fillRect: [colour,x,y,w,h]; drawImage: [tag,image,sx,sy,sw,sh,x,y,w,h].
      // Earlier plaster/plinth strokes may cross y128, but the opaque roof
      // base overwrites them. Hash the roof pass after that base fill only.
      const start=texture.commands.findIndex(c=>c[0]!=='drawImage'&&c[1]===0&&c[2]===128&&c[3]===512&&c[4]===384);
      assert.gte(start,0,'roof pass starts with its opaque base');
      const roofCommands=texture.commands.slice(start).filter(c=>c[0]==='drawImage'?c[7]>=128:c[2]>=128);
      assert.eq(drawHash(roofCommands),expected[Number(packed)],role+' '+variant+' roof commands '+(packed?'packed':'fallback'));
    }
  });
  test('steampunk: facade and chimney detail leaves rectangle and L mesh vertices unchanged', () => {
    const lots=[
      [{x:0,y:0},{x:96,y:0},{x:96,y:64},{x:0,y:64}],
      [{x:0,y:0},{x:96,y:0},{x:96,y:32},{x:64,y:32},{x:64,y:64},{x:0,y:64}],
    ];
    for(const role of Object.keys(roofs))for(const [i,lot] of lots.entries()) {
      const recipe=api.recipeFor(role,{},undefined,true);
      const chimney=recipe.chimneyFlare?{count:1,scale:1,flare:recipe.chimneyFlare}:null;
      const mesh=api.geometry(lot,recipe.variant||'ridge',recipe.stories*15.6+2.5,5,chimney);
      const vertices=mesh.faces.map(f=>[f.kind,f.points.map(p=>[p.x,p.y,p.z])]);
      const expected=geometryDraw[role==='blacksmith'?'smith':recipe.stories===1?'single':'double'][i];
      assert.eq(drawHash(vertices),expected,role+' '+(i?'L':'rectangle')+' unchanged mesh');
    }
  });
  test('steampunk: the wizard is a narrow four-storey octagon under a pointed roof', () => {
    const lot=[{x:0,y:0},{x:96,y:0},{x:96,y:64},{x:0,y:64}];
    const mesh=api.specialGeometry(lot,api.recipeFor('wizard'),[]);
    assert.eq(mesh.ring.length,8,'octagonal body');
    assert.eq(api.recipeFor('wizard').stories,4,'four storeys');
    assert.truthy(mesh.height-mesh.eaveHeight>10,'roof rises to a point above the eave');
    assert.truthy(mesh.height-mesh.eaveHeight<mesh.eaveHeight*.5,'roof stays lower than half the body');
    assert.truthy(mesh.faces.length<=200,'tower stays within a small triangle budget: '+mesh.faces.length);
  });
})();
