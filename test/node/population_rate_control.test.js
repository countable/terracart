// Baseline captured from 64cda139 across 512 terrain/Nexus/road/mode cases.
(() => {
  test('spawn consolidation: unchanged ambient populations retain baseline species counts', () => {
    const N=32, edge=N*7, results={};
    const cases=[...['GRASS','RESIDENTIAL','FOREST','WETLAND','ROCK','SAND','COMMERCIAL','SCHOOL'].map(id=>['terrain',id]),
      ...['meadow','ancient_grove','pirate_cove','broken_masonry'].map(id=>['zone',id]),
      ...['goblin_gang','barricade','snare','causeway'].map(id=>['road',id])];
    const add=(key,cs)=>{const row=results[key] ||= {};for(const c of cs)row[c.kind]=(row[c.kind]||0)+1;};
    for(const mode of ['easy','hard'])for(const [type,id] of cases)for(let seed=0;seed<16;seed++) {
      const tx=seed+10,ty=17,terrain=type==='terrain'?WorldGen.T[id]:WorldGen.T.GRASS;
      const entry={cellsPerEdge:N,tileEdgeM:edge,grid:new Uint8Array(N*N).fill(terrain),objects:[],gameplayTiers:new Uint8Array(N*N).fill(GameplayTiers.CORE)};
      if(type==='zone')entry.zone={coverage:new Uint16Array(N*N).fill(1),anchors:[{kind:'grove',variant:id,key:'control-'+seed}]};
      if(type==='road'){entry.streetArea=new Uint8Array(N*N).fill(1);entry.streetAreaVariants=new Uint16Array(N*N).fill(StreetVariants.VARIANT_BY_ID[id].code);}
      const creatures=WorldGen.runSteps(HabitatSpawns.populationSteps({tileEdgeM:edge,save:{caught:[]}},entry,tx,ty,{skipLegacy:true,spawnOpts:{gameplayTiers:entry.gameplayTiers}}));
      add(`${mode}:${type}:${id}`,creatures.filter(c=>HabitatSpawns.reserveVisible(c,Difficulty.PROFILES[mode])));
    }
    const baseline = {"easy:terrain:GRASS":{"butterfly":48,"chicken":44,"cow":33,"rabbit":32,"plant":42,"slime":9,"crow":15,"sheep":24,"snake":2,"horse":5},"easy:terrain:RESIDENTIAL":{"cat":34,"chicken":34,"deer":20,"dog":29,"ogre":19,"thief":14,"zombie":8,"cow":3,"raven":5},"easy:terrain:FOREST":{"deer":131,"rabbit":37,"giant_bear":33,"plant":47,"dog":11,"boar":12,"spider":9},"easy:terrain:WETLAND":{"butterfly":85,"dog":17,"pig":24,"rabbit":18,"golden_slime":37,"zombie":37,"slime":10,"spider":4,"snake":1},"easy:terrain:ROCK":{"dog":40,"rabbit":48,"skeleton_soldier":42,"skeleton":51},"easy:terrain:SAND":{"rabbit":40,"giant_crab":6,"dog":18},"easy:terrain:COMMERCIAL":{"cat":39,"dog":32,"sword_spirit":3,"club_goblin":8,"goblin":7,"goblin_archer":1,"thief":6},"easy:terrain:SCHOOL":{"butterfly":51,"chicken":48,"rabbit":28,"cat":38,"goblin_runt":7},"easy:zone:meadow":{"butterfly":123,"rabbit":99,"plant":100,"slime":89},"easy:zone:ancient_grove":{"crow":238,"giant_bear":73,"spider":66,"treant":74},"easy:zone:pirate_cove":{"pirate_grunt":213},"easy:zone:broken_masonry":{"dog":234,"club_goblin":196},"easy:road:goblin_gang":{"goblin_runt":17},"easy:road:barricade":{"goblin_runt":3,"spear_goblin":7},"easy:road:snare":{"goblin_runt":9,"goblin_trapper":17},"easy:road:causeway":{"giant_crab":5},"hard:terrain:GRASS":{"butterfly":48,"chicken":44,"cow":33,"rabbit":32,"plant":59,"slime":17,"crow":15,"sheep":24,"snake":5,"horse":5},"hard:terrain:RESIDENTIAL":{"cat":34,"chicken":34,"deer":20,"dog":29,"ogre":36,"thief":16,"zombie":12,"cow":3,"raven":5},"hard:terrain:FOREST":{"deer":131,"rabbit":37,"giant_bear":55,"plant":67,"boar":18,"dog":11,"spider":14},"hard:terrain:WETLAND":{"butterfly":85,"dog":17,"pig":24,"rabbit":18,"golden_slime":54,"zombie":52,"slime":15,"spider":5,"snake":4},"hard:terrain:ROCK":{"dog":40,"rabbit":48,"skeleton_soldier":58,"skeleton":92},"hard:terrain:SAND":{"rabbit":40,"giant_crab":7,"dog":18},"hard:terrain:COMMERCIAL":{"cat":39,"dog":32,"sword_spirit":5,"thief":8,"club_goblin":16,"goblin":20,"goblin_archer":1},"hard:terrain:SCHOOL":{"butterfly":51,"chicken":48,"rabbit":28,"cat":38,"goblin_runt":9},"hard:zone:meadow":{"butterfly":123,"rabbit":99,"plant":100,"slime":89},"hard:zone:ancient_grove":{"crow":238,"giant_bear":73,"spider":66,"treant":74},"hard:zone:pirate_cove":{"pirate_grunt":213},"hard:zone:broken_masonry":{"dog":234,"club_goblin":196},"hard:road:goblin_gang":{"goblin_runt":17},"hard:road:barricade":{"goblin_runt":3,"spear_goblin":7},"hard:road:snare":{"goblin_runt":9,"goblin_trapper":17},"hard:road:causeway":{"giant_crab":5}};
    for(const [key,counts] of Object.entries(baseline)) {
      assert.eq(JSON.stringify(results[key]),JSON.stringify(counts),key+' retains pre-consolidation species counts');
    }
  });
})();
