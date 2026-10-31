test('concealed caches: stable tiers and dedicated looks ignore ordinary chest quotas and bonuses', () => {
  const tiers=new Set();
  for(const cacheTheme of Object.keys(CACHE_TYPES))for(let n=0;n<60;n++) {
    const o={kind:'chest',id:'cache-check-'+n,cache:true,cacheTheme};
    const tier=chestTier(o);tiers.add(tier);assert.inRange(tier,1,3);
    assert.eq(chestTier({...o,tierSeed:7,depth:7,zoneNexus:'tar'}),tier);
    assert.eq(chestTier(JSON.parse(JSON.stringify(o))),tier,'reload retains tier');
    assert.eq(chestThemeFor(o),CACHE_TYPES[cacheTheme].theme);
    assert.eq(chestLook(o).texKey,'box');assert.truthy(chestLook(o).cache);
    assert.eq(chestLook(o).cacheName,CACHE_TYPES[cacheTheme].name);
    assert.falsy(restocks(o));assert.falsy(chestHidesMimic(o));
    WorldGen.seedChestTiers([o]);assert.eq(o.tierSeed,undefined,'not a chest quota seat');
  }
  assert.eq(tiers.size,3);
  assert.eq(chestLook({kind:'chest',id:'ordinary-t3',tierSeed:3}).texKey,'chest');
});

test('concealed caches: each theme rolls its own valid item pool through tiers one to three', () => {
  const save={relics:{},armor:{},booksRead:0};
  for(const [id,type] of Object.entries(CACHE_TYPES))for(const tier of [1,2,3]) {
    const weights=ChestThemes.weights(type.theme,tier,{tier});
    assert.eq(Object.values(weights).reduce((a,b)=>a+b,0),100);
    assert.falsy(weights.bonusGear);assert.falsy(weights.plainBook);
    const members=new Set(Object.keys(weights).flatMap(group=>Object.keys(ChestThemes.members(group))));
    for(let i=0;i<80;i++) {
      const reward=pickReward('chest:'+type.theme,save,makeRng32(i+1),{tier});
      assert.truthy(reward,id+' returns a reward');assert.eq(reward.kind,'item');
      assert.truthy(members.has(reward.id),id+' stays in its matching pool: '+reward.id);
      assert.inRange(reward.rolledTier,1,3);assert.lte(ITEM_BY_ID[reward.id].baseTier||1,3);
      if(['paralysis_path','confusion_path'].includes(id)){
        const item=ITEM_BY_ID[reward.id];assert.eq(item.kind,'magic');assert.truthy(item.potion||item.scroll);
      }
    }
  }
});

test('explosive barrel eligibility: red barrels always arm and ordinary barrels keep a stable ten percent chance',()=>{
 let count=0;
 for(let i=0;i<10000;i++){
  const o={kind:'chest',id:'barrel-chance-'+i,barrel:true,barrelStyle:'barrel'};
  const first=isExplosiveBarrel(o);assert.eq(first,isExplosiveBarrel({...o}));if(first)count++;
  assert.truthy(isExplosiveBarrel({...o,redBarrel:true}));
  assert.falsy(isExplosiveBarrel({...o,barrelStyle:'clay_pot',redBarrel:true}));
  assert.falsy(isExplosiveBarrel({...o,cache:true,redBarrel:true}));
 }
 assert.inRange(count/10000,.08,.12);
});
