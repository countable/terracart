(function () {
  function withScene(fn) {
    const key = WorldGen.tileKey(0, 0), old = WorldGen.tileCache.get(key), realNow = Date.now;
    let wall = Date.UTC(2026, 8, 30, 12);
    Date.now = () => wall;
    const entry = { creatures: [] };
    WorldGen.tileCache.set(key, entry);
    const scene = {
      save: { money: 100, caught: [] }, cellM: 7, tileEdgeM: 1000,
      startWorldM: { x: 0, y: 0 }, playerM: { x: 7, y: 7 },
      playerToWorldCell: () => ({ tx: 0, ty: 0 }), flashAtWorld() {},
      cellAt: () => ({ loaded: true, type: WorldGen.T.GRASS }),
    };
    try { fn(scene, entry, ms => { wall += ms; scene._petFollowCheck = 0; }); }
    finally {
      Date.now = realNow;
      if (old) WorldGen.tileCache.set(key, old); else WorldGen.tileCache.delete(key);
    }
  }

  test('web paralysis: following pet cannot teleport out of its web before six seconds', () => withScene((s, entry, advance) => {
    const pet = WorldGen.makeCreature('dog', 10000, 10000, 'released_web_dog', { pet: true, stayHome: false });
    s.save.released = [{ id: pet.id, kind: pet.kind, pet: true, stayHome: false, x: pet.x, y: pet.y, tx: 10, ty: 10 }];
    entry.creatures.push(pet);
    Combat.paralyze(pet, 6000);
    Companions.tickPets(s);
    assert.eq(pet.x, 10000);
    // Losing the old level must retain the live held instance and its timer.
    const previous = { creatures: [pet] };
    entry.creatures = [];
    s._travellingPets.get(pet.id).entry = previous;
    advance(5999);
    Companions.tickPets(s);
    assert.eq(pet.x, 10000);
    assert.eq(s._travellingPets.get(pet.id).entry, previous);
    assert.eq(entry.creatures.length, 0);
    advance(1);
    Companions.tickPets(s);
    assert.truthy(entry.creatures.includes(pet));
    assert.falsy(previous.creatures.includes(pet));
    assert.lt(Math.hypot(pet.x - 7, pet.y - 7), 20);
  }));

  test('web paralysis: timed ally catch-up waits for expiry of paralysis', () => withScene((s, entry, advance) => {
    Companions.hire(s, 'mercenary');
    const ally = s._mercenary;
    ally.x = 10000;
    Combat.paralyze(ally, 6000);
    advance(5999);
    Companions.tick(s, 'mercenary');
    assert.eq(s._mercenary, ally);
    assert.eq(ally.x, 10000);
    assert.falsy(s.save.caught.includes(ally.id));
    advance(1);
    Companions.tick(s, 'mercenary');
    assert.truthy(s._mercenary !== ally);
    assert.includes(s.save.caught, ally.id);
  }));
})();
