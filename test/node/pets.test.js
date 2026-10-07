(function () {
  const wild = (id = 'dog_1',kind = 'dog') => ({id,kind,x:1,y:2,_hp:3});
  const save = () => ({released:[],wildAnimals:[],caught:[],inv:[]});
  // The catch needs no preparation: giving the favourite starts the wheel
  // (interact.js), and the wheel's completion bonds.
  function capture(s,c = wild()) { return Pets.bond(s,c); }
  test('pets: catching creates one individual, no inventory stack; one per species', () => {
    const s=save(), c=wild();
    assert.falsy(Pets.likes(c,'milk')); assert.truthy(Pets.likes(c,'meat'), 'meat is the dog\'s favourite');
    assert.falsy(Combat.isTame(c)); assert.truthy(Pets.canCatch(s,c), 'no preparation: a wild dog is catchable');
    assert.falsy('fed' in Pets); assert.falsy('feedWild' in Pets);
    const r=Pets.bond(s,c);
    assert.truthy(r.carried); assert.truthy(Combat.isTame(r)); assert.eq(s.inv.length,0);
    assert.falsy('favouriteFed' in r, 'no prepared flag'); assert.eq(r.favouriteFeeds,1);
    const other=wild('dog_2');
    assert.falsy(Pets.canCatch(s,other)); assert.falsy(Pets.bond(s,other));
    assert.falsy(Combat.isTame({id:'released_dog',kind:'dog'}),'prefix is no ownership proof');
  });
  test('pets: carry and deploy preserve identity, tint, individual stats and growth', () => {
    const s=save(),r=capture(s); r.bonuses.attack=3; r.favouriteFeeds=4; r.hp=2;
    const tint=r.tint;
    Pets.deploy(s,r.id,{x:5,y:6,tx:0,ty:0,stayHome:true});
    assert.falsy(r.carried); assert.truthy(Pets.ownedKind(s,'shiny_dog'));
    Pets.carry(s,r); assert.eq(Pets.list(s)[0],r); assert.eq(r.hp,2); assert.eq(r.tint,tint);
    assert.eq(Pets.stats(r).attack,3); assert.eq(r.favouriteFeeds,4);
  });
  test('pets: knockout survives reload, food leaves rest timer, return is one energy', () => {
    let s=save(); const r=capture(s); let c={...r,_hp:0};
    Pets.knockedOut(s,c,100000); assert.eq(c._hp,0); assert.truthy(Pets.isDown(c,159999));
    s=JSON.parse(JSON.stringify(s)); c={...Pets.get(s,c),_hp:0};
    Pets.feed(s,c,'meat'); assert.eq(c.recoverUntil,160000);
    assert.eq(c._hp,Combat.maxHp(c));
    Pets.tick(s,c,159999); assert.truthy(Pets.isDown(c,159999));
    Pets.tick(s,c,160000); assert.eq(c._hp,Combat.maxHp(c)); assert.falsy(Pets.isDown(c,160000));
    c._hp=1; c._lastDamagedT=null; Pets.tick(s,c,190000); assert.eq(c._hp,2);
  });
  test('pets: accessories transfer without duplication and apply effective stats', () => {
    const s=save(),r=capture(s); Inventory.add(s,'pet_collar',1); Inventory.add(s,'pet_fang_charm',1);
    const base=Combat.maxHp(r), attack=Combat.petBlow(r);
    assert.truthy(Pets.equip(s,r.id,'pet_collar')); assert.eq(Combat.maxHp(r),base+4);
    assert.eq(Inventory.count(s,'pet_collar'),0); assert.falsy(Pets.equip(s,r.id,'pet_collar'));
    assert.truthy(Pets.equip(s,r.id,'pet_fang_charm')); assert.gt(Combat.petBlow(r),attack);
    assert.truthy(Pets.unequip(s,r.id,'collar')); assert.eq(Inventory.count(s,'pet_collar'),1);
    assert.eq(Combat.maxHp(r),base);
    assert.truthy(Pets.release(s,r.id)); assert.eq(Inventory.count(s,'pet_fang_charm'),1);
    assert.eq(Pets.list(s).length,0); assert.eq(s.wildAnimals.length,1);
    assert.falsy(Pets.list(s).length, 'released'); assert.falsy(s.wildAnimals[0].pet);
    assert.truthy(Pets.canCatch(s,s.wildAnimals[0]),'released: wild again, caught with its favourite like any other');
  });
  test('pets: releasing and recatching preserves identity without hiding the deployed pet', () => {
    const s=save(),r=capture(s); r.bonuses.maxHp=2;
    const id=r.id, tint=r.tint;
    assert.truthy(Pets.release(s,id));
    const wild=s.wildAnimals[0];
    const again=Pets.bond(s,wild);
    assert.eq(again.id,id); assert.eq(again.tint,tint); assert.eq(again.bonuses.maxHp,2);
    assert.falsy(s.caught.includes(id)); assert.eq(s.wildAnimals.length,0);
    assert.eq(Pets.list(s).length,1);
  });
  test('pets: no-food recovery wakes at one energy and damage postpones slow regeneration', () => {
    const s=save(),r=capture(s),c={...r,_hp:0};
    Pets.knockedOut(s,c,100000); Pets.tick(s,c,160000);
    assert.eq(c._hp,1);
    c._lastDamagedT=189000; Pets.tick(s,c,190000); assert.eq(c._hp,1);
    Pets.tick(s,c,224000); assert.eq(c._hp,2);
  });
  test('pets: resting pets cannot be released as zero-energy wildlife', () => {
    const s=save(),r=capture(s),c={...r,_hp:0};
    Pets.knockedOut(s,c);
    assert.falsy(Pets.release(s,r.id));
    assert.eq(Pets.list(s).length,1); assert.eq(s.wildAnimals.length,0);
  });
  test('pets: carrying and accessory changes retain the latest live wounds', () => {
    const s=save(),r=capture(s),key='pet_test_live';
    r.carried=false;
    const c={...r,_hp:1,_lastDamagedT:Date.now()};
    WorldGen.tileCache.set(key,{creatures:[c]});
    try {
      Inventory.add(s,'pet_collar',1);
      assert.truthy(Pets.equip(s,r.id,'pet_collar'));
      assert.eq(r.hp,1); assert.eq(c._hp,1);
      c._hp=2;
      Pets.carry(s,r); assert.eq(r.hp,2);
    } finally { WorldGen.tileCache.delete(key); }
  });
  test('pets: a slime is a foe until caught; mid-catch it is nobody\'s enemy', () => {
    const s=save(),c=wild('slime_1','slime');
    assert.truthy(Combat.isEnemy(c)); assert.truthy(Pets.likes(c,'sapphire'));
    c._beingCaught=true;
    assert.falsy(Combat.isEnemy(c),'a catch is a truce'); assert.falsy(Combat.isTame(c));
    delete c._beingCaught; assert.truthy(Combat.isEnemy(c));
    const r=Pets.bond(s,c); assert.truthy(r); assert.falsy(Combat.isEnemy(r),'a bonded slime is docile');
  });
  test('pets: any roster enemy is catchable except a story foe', () => {
    const s=save();
    assert.truthy(Pets.catchable({id:'g',kind:'goblin'})); assert.truthy(Pets.canCatch(s,{id:'g',kind:'goblin'}));
    assert.falsy(Pets.catchable({id:'g',kind:'goblin',storyEncounter:'k'}),'a story encounter');
    assert.falsy(Pets.catchable({id:'d',kind:'red_demon'}),'a storyReward row');
    assert.falsy(Pets.eligible('goblin'),'the ANIMAL set (tint) stays animals');
    const r=Pets.bond(s,{id:'g',kind:'goblin',x:0,y:0});
    assert.truthy(r); assert.eq(r.kind,'goblin'); assert.falsy(Pets.canCatch(s,{id:'g2',kind:'goblin'}),'one per species');
  });
})();
