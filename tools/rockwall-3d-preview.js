/* Comparison fixtures using the same full-cell materials and prisms as the game. */
(async () => {
  'use strict';
  await loadGame(); window.Phaser = RockwallReviewPhaser;
  const materials=await (await fetch('rockwall-floor-materials.json')).json();
  const THEMES=materials.themes;
  const C=32, HEIGHT=FloorWallMaterials.height;
  const MAPS={
    cave:['##########','##########','###....###','##......##','#...##...#','#...##....','#........#','##..#...##','###.....##','####..####'],
    island:['..........','..........','..##..#...','..##......','..........','.....##...','.....##...','..........','..........','..........'],
    stairs:['..........','.#######..','.##....#..','.###...#..','.####..#..','.##....#..','.######...','..........','..........','..........'],
    junction:['..........','....#.....','....#.....','..######..','....#.....','....###...','......#...','..........','..........','..........'],
  };
  let spinning=false, scene;
  const angleInput=document.getElementById('angle');
  const angle=()=>+angleInput.value*Math.PI/180;
  function makeGround(s,theme,room,pipes) {
    const key=`floor-ground-${theme.id}-${room}-${pipes}`;
    const tex=s.textures.createCanvas(key,320,320),g=tex.getContext();g.imageSmoothingEnabled=false;
    g.fillStyle='#5b4f40';g.fillRect(0,0,320,320);
    const tile=(ref,x,y)=>{
      const source=s.textures.get('floor-source-'+ref.sheet).getSourceImage();
      g.drawImage(source,ref.x*16,ref.y*16,16,16,x,y,C,C);
    };
    if(!theme.original) {
      for(let y=0;y<10;y++)for(let x=0;x<10;x++) {
        if(theme.id==='l1')g.drawImage(s.textures.get('floor-sewer-'+FloorWallMaterials.sewerGroundRole(x,y)).getSourceImage(),x*C,y*C,C,C);
        else tile(theme.ground,x*C,y*C);
      }
      if(room)for(let x=0;x<10;x++)tile(theme.road,x*C,6*C);
      // Stable one-in-five floor accents, including the route through the room.
      if(theme.groundAccent)for(let y=0;y<10;y++)for(let x=0;x<10;x++) {
        if(avalanche32(fnv1a(`ember-floor:${theme.id}:${x},${y}`)) % 5 === 0)
          tile(theme.groundAccent,x*C,y*C);
      }
      if(room&&theme.id==='l1') {
        const source=s.textures.get('floor-source-sewer').getSourceImage();
        for(let x=0;x<10;x++) {
          g.drawImage(source,2*16,16*16,16,5,x*C,6*C-10,C,10);
          g.drawImage(source,2*16,20*16+11,16,5,x*C,7*C,C,10);
        }
        if(pipes) {
          // Draw into the ground texture, not the wall batch: z=0, always
          // underneath both cap and face geometry at every compass heading.
          for(const [x,y,tx,ty] of [[3,3,10,0],[4,3,10,2],[5,3,10,2],[6,3,12,0],
              [3,4,11,3],[6,4,11,3],[3,5,12,5],[6,5,13,5]])
            tile({sheet:'sewer',x:tx,y:ty},x*C,y*C);
        }
      }
    }
    tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return key;
  }
  function groundKey(theme) {
    const room=document.getElementById('fixture').value==='cave';
    const pipes=theme.id==='l1'&&room&&document.getElementById('pipes').checked;
    return `floor-ground-${theme.id}-${room}-${pipes}`;
  }
  function showSources(theme) {
    const target=document.getElementById('sources');target.replaceChildren();
    for(const [role,ref] of Object.entries({face:theme.face,cracks:theme.faceAccent,ground:theme.ground,embers:theme.groundAccent,road:theme.road})) {
      if(!ref)continue;
      const a=document.createElement('a');
      a.href='../extra_assets/'+materials.sheets[ref.sheet].split('/').map(encodeURIComponent).join('/');
      a.target='_blank';a.rel='noopener';a.textContent=`${role}: ${ref.sheet} (${ref.x},${ref.y})`;
      target.append(a,document.createTextNode(' · '));
    }
    document.getElementById('material-note').textContent=theme.note;
    document.getElementById('pipes').disabled=theme.id!=='l1';
  }
  function rebuild() {
    const theme=THEMES.find(t=>t.id===document.getElementById('floor').value);
    showSources(theme);scene.rockAtlas=scene.floorAtlases[theme.id];
    const map=MAPS[document.getElementById('fixture').value],n=map.length;
    if(scene.panels)for(const panel of scene.panels)panel.root.destroy(true);
    const roots=[scene.add.container(290,345),scene.add.container(900,345)];
    const solid=(x,y)=>y>=0&&y<n&&x>=0&&x<n&&map[y][x]==='#';
    const left=roots[0],root=roots[1],ground=scene.add.image(-160,-160,groundKey(theme)).setOrigin(0);root.add(ground);
    const referenceGround=scene.add.graphics();left.add(referenceGround);
    const grids=[];
    for(const [container,g] of [[left,referenceGround],[root,ground]]) {
      if(g===referenceGround){g.fillStyle(0x5b4f40);g.fillRect(-160,-160,320,320);}
      const grid=scene.add.graphics();container.add(grid);grid.lineStyle(1,0xb4a186,.3);
      for(let i=0;i<=n;i++){grid.lineBetween(i*C-160,-160,i*C-160,160);grid.lineBetween(-160,i*C-160,160,i*C-160);}
      grids.push(grid);
    }
    // An isolated scene adapter keeps these comparison fixtures independent
    // of the live map. Wall materials and geometry use the runtime modules.
    const adapter={_headingUp:true,depth:0,mapRot:angle(),events:scene.events,add:scene.add,
      textures:scene.textures,buildingWallContainer:root,worldContainer:root};
    const group=WallPerspective.begin(adapter,'rockwall');group.perWall=true;
    const open=[];
    for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
      if(!solid(x,y)){open.push({x:x*C-144,y:y*C-144});continue;}
      let mask=(!solid(x,y-1)?1:0)|(!solid(x+1,y)?2:0)|(!solid(x,y+1)?4:0)|(!solid(x-1,y)?8:0);
      let legacy=mask;
      if(!(mask&4)){if(solid(x-1,y)&&!solid(x-1,y+1))legacy|=16;if(solid(x+1,y)&&!solid(x+1,y+1))legacy|=32;}
      const originalVariant=((x*31)^y)&3;
      // An avalanche hash avoids the diagonal stripes of the old x/y low bits.
      // One of four atlas variants carries cracks; the other three are plain.
      const v=FloorWallMaterials.variant(Number(theme.id.slice(1)),x,y);
      const ox=x*C-160,oy=y*C-160;
      left.add(scene.add.image(ox,oy-CAVE_WALL_TOP_LIFT,'cave_wall_edges',originalVariant*64+legacy).setOrigin(0));
      const points=[{x:ox,y:oy},{x:ox+C,y:oy},{x:ox+C,y:oy+C},{x:ox,y:oy+C}];
      const diagonalMask=(solid(x-1,y-1)?1:0)|(solid(x+1,y-1)?2:0)
        |(solid(x+1,y+1)?4:0)|(solid(x-1,y+1)?8:0);
      const faces=FloorWallMaterials.geometry(points,mask,v,Number(theme.id.slice(1)),diagonalMask);
      WallPerspective.prism(adapter,'rockwall',points,0,HEIGHT,{face:0x302a24,top:0x625646,dark:0x151310},null,true,{materialFaces:faces});
    }
    WallPerspective.finish(adapter,'rockwall');
    for(const part of group.parts)part._wallAtlas=scene.rockAtlas;
    const marker=scene.add.image(0,0,'rockwall-marker').setOrigin(.5,1);root.add(marker);
    const markerIndex=Math.floor(open.length/2);marker.setPosition(open[markerIndex].x,open[markerIndex].y);
    scene.panels=[{root:left},{root}];scene.review={adapter,group,root,left,grids,ground,referenceGround,open,marker,markerIndex,theme};
    scene.themeLabel.setText(theme.label+' · full-cell 3D');
    update();
  }
  function update() {
    if(!scene?.review)return;
    const r=scene.review,a=angle(),s=Math.sin(a),c=Math.cos(a);
    r.adapter.mapRot=a;r.root.setRotation(a).setScale(1.25);r.left.setScale(1.25);
    WallPerspective.update(r.adapter);
    // Walls and marker share the same ground-depth order. Marker seats are
    // cell centres only; continuous player sorting remains a later integration.
    r.ground.depth=-1e6;r.grids[1].depth=-1e6+1;r.group.gfx.depth=-1e6+2;
    for(let i=0;i<r.group.blocks.length;i++) {
      const b=r.group.blocks[i],part=r.group.parts[i];part._wallAtlas=scene.rockAtlas;
      part.depth=s*b.x+c*b.y;
    }
    r.marker.setRotation(-a).setDepth(s*r.marker.x+c*r.marker.y+.01);r.root.sort('depth');
    for(const grid of r.grids)grid.visible=document.getElementById('grid').checked;
    document.getElementById('degrees').textContent=Math.round(+angleInput.value)+'°';
  }
  window.rockwallReviewGame=new Phaser.Game({type:Phaser.WEBGL,width:1200,height:700,parent:'game',
    backgroundColor:'#201d17',pixelArt:true,antialias:false,render:{preserveDrawingBuffer:true},scene:{
      preload(){
        this.load.image('floor_wall_sources','../'+ASSETS.floor_wall_sources.path);
        for(const [id,path] of Object.entries(materials.sheets))this.load.image('floor-source-'+id,
          '../extra_assets/'+path.split('/').map(encodeURIComponent).join('/'));
      },
      create(){
        scene=this;window.rockwallReviewScene=this;this.floorAtlases={};
        FloorWallMaterials.prepareGround(this);
        for(const theme of THEMES) {
          this.floorAtlases[theme.id]=FloorWallMaterials.prepare(this,Number(theme.id.slice(1)));
          makeGround(this,theme,false,false);makeGround(this,theme,true,false);
          if(theme.id==='l1')makeGround(this,theme,true,true);
        }
        const markerTex=this.textures.createCanvas('rockwall-marker',16,28),g=markerTex.getContext();
        g.fillStyle='#1d1510';g.fillRect(4,24,9,3);g.fillStyle='#dfb86a';g.fillRect(5,0,7,7);
        g.fillStyle='#48b1c2';g.fillRect(3,8,11,12);g.fillStyle='#a9d3db';g.fillRect(5,20,3,6);g.fillRect(10,20,3,6);markerTex.refresh();
        this.add.text(40,20,'Current rockwall · north-up reference',{fontSize:'18px',color:'#eee7d9'});
        this.themeLabel=this.add.text(650,20,'Full-cell 3D · compass-controlled',{fontSize:'18px',color:'#eee7d9'});
        rebuild();window.rockwall3D={ready:true,rebuild,update,height:HEIGHT,cell:C};
        document.getElementById('status').textContent='Ready · WebGL textured prisms · 32×32 footprint · 19px height';
      },
      update(_,dt){if(spinning){angleInput.value=(+angleInput.value+dt*.022)%360;}update();}
    }});
  document.getElementById('rotate').onclick=()=>{spinning=!spinning;document.getElementById('rotate').textContent=spinning?'Pause':'Spin compass';};
  document.getElementById('north').onclick=()=>{spinning=false;angleInput.value=0;document.getElementById('rotate').textContent='Spin compass';update();};
  document.getElementById('fixture').onchange=rebuild;
  document.getElementById('floor').onchange=rebuild;
  document.getElementById('pipes').onchange=()=>scene.review.ground.setTexture(groundKey(scene.review.theme));
  document.getElementById('marker').onclick=()=>{const r=scene.review;r.markerIndex=(r.markerIndex+1)%r.open.length;r.marker.setPosition(r.open[r.markerIndex].x,r.open[r.markerIndex].y);update();};
})().catch(error=>{document.getElementById('status').textContent=error.message;console.error(error);});
