// Cross-system first-session contract. UI shells are captured at their public
// callbacks; quests, inventory, delivery, housing and introduction gates are real.
(() => {
  test('opening flow: potato delivery, Tilly gratitude, chicken entrance and weapon choice release the onward thief in order', () => {
    const mode = Difficulty.mode(), cache = WorldGen.tileCacheFor(0), previous = [...cache];
    const visit = NPCBenefits.visit;
    Difficulty.setMode('easy'); cache.clear(); NPCBenefits.visit = () => null;
    const cell = 7, size = 100, edge = cell * size;
    const home = { id: 'opening-home', kind: 'house', x: 20.5 * cell, y: 20.5 * cell };
    const house = { id: 'opening-tilly', kind: 'house', tier: 9, x: home.x + 4 * cell, y: home.y + 3 * cell };
    const wreck = { id: 'opening-onward', kind: 'house', tier: 9, x: home.x + 410, y: home.y };
    const entry = { cellsPerEdge: size, _spawned: true, grid: new Uint8Array(size * size).fill(WorldGen.T.GRASS),
      roadMask: new Uint8Array(size * size), spawnWhy: new Uint8Array(size * size),
      objects: [home, house, wreck], genObjects: [home, house, wreck], wildplants: [], creatures: [],
      buildingShapes: [{ key: wreck.id, tier: 9, ring: [wreck.x - cell, wreck.y - cell,
        wreck.x + cell, wreck.y - cell, wreck.x + cell, wreck.y + cell, wreck.x - cell, wreck.y + cell] }] };
    entry._spawnOpts = WorldGen.spawnOptsOf(entry);
    cache.set(WorldGen.tileKey(0, 0), entry);
    let message, offer;
    const ceremonies = [];
    const s = { save: SaveState.defaults({ restoredHouses: {}, discovered: {}, starterCratesAt: { x: home.x, y: home.y },
        trail: { metres: 0, prizes: 0, greeted: true } }),
      depth: 0, cellM: cell, tileEdgeM: edge, startWorldM: { x: 0, y: 0 }, playerM: { x: home.x, y: home.y },
      _starterTrailAnchor() { return this.save.starterCratesAt; }, homeWorldPos: () => home,
      inHomeRing: (x, y) => Math.hypot(x - home.x, y - home.y) <= 8 * cell,
      viewLeft: 0, viewTop: 0, viewSize: 200,
      worldMetersToScreen: (x, y) => ({ x: 100 + (x - home.x) * 20 / cell, y: 100 + (y - home.y) * 20 / cell }),
      _dialogOpen: () => false, showMessageModal(panel) { message = panel; }, showOfferModal(panel) { offer = panel; },
      showChestRewardModal() {}, _offerTreasurePick(panel) { offer = panel; },
      _enqueueCeremony(kind, open, options) { ceremonies.push({ kind, open, ...options }); },
      _afterRestoreBeat(fn) { fn(); }, _toast() {}, _clampSelSlot() {},
      buildInventoryDOM() {}, _celebrateStarterStep() {}, updateObjectiveDOM() {},
      _seatStoryNeighbours() {}, _popEnergy() {}, _settleDeal() {}, flashShiny() {}, _storySplashOnce() {},
      flash() {}, flashLoot() {}, markRelicsDirty() {}, iconSpanHTML: id => id,
      gearIconHTML: (kind, slot) => slot, moneyHTML: text => text,
      addToInv(id, qty) { return Inventory.add(this.save, id, qty).accepted; },
      getMaxEnergy() { return Energy.maxEnergy(this.save); },
    };
    for (const method of ['questEvent', 'presentDeliveryOffer', 'wantedProduce', 'isHouseSatisfied',
      '_bankDiscovery', 'memoriesUnspent', 'memoriesTotal', '_bankStreetMetres', '_armTrailIntro',
      '_fireTrailPrize', '_claimTrailReward', '_resumeFirstWeaponPrize', 'acknowledgeObjective']) {
      s[method] = liftSceneMethod(method);
    }
    const tilly = WorldGen.makeCreature('npc', home.x - 3 * cell, home.y, 'opening-tilly-person',
      { ...NPC.storyNeighbour('opening-tilly-person', 'wanderer'), _homeAnchor: '',
        homeX: home.x - 3 * cell, homeY: home.y });
    entry.creatures.push(tilly);
    try {
      Starter.placeHomeGreeter(s, entry, 0, 0);
      assert.falsy(entry.creatures.some(c => c.kind === 'chicken'));
      // Road progress may arrive early, but its gift must wait for the opening.
      s._bankStreetMetres(Trail.goalFor(0), null, 10000);
      const weaponCeremony = ceremonies.find(c => c.key === 'trail:first-weapon');
      assert.truthy(s.save.trail.firstWeaponPending);
      assert.truthy(weaponCeremony.hold());
      runInteractable(makeCtx(s, s.save), { kind: 'groundstack', id: 'opening-seeds', itemId: 'potato_seed', qty: 1, x: home.x, y: home.y });
      assert.eq(Quests.starterCurrent(s.save).event, 'plant');
      s.questEvent('plant'); assert.eq(Quests.starterCurrent(s.save).event, 'water');
      s.questEvent('water'); assert.eq(Quests.starterCurrent(s.save).event, 'restore');
      s.save.restoredHouses[house.id] = 'plain'; s.questEvent('restore');
      assert.eq(Quests.starterCurrent(s.save).event, 'tilly');
      assert.eq(Delivery.wantedProduce(s.save, house).join(','), 'potato');
      NPC.interact(s, tilly, 0, 0); message.onDismiss();
      assert.truthy(s.save.npcMet[tilly.id]);
      assert.eq(NPC.houseNeighbours(s, { now: Date.now() + NPC.MOVE_IN_DELAY_MS }), 0,
        'meeting and restoring cannot bypass the potato');
      Inventory.add(s.save, 'potato', 1); // The one harvested crop; growth timing has separate crop tests.
      s.presentDeliveryOffer(0, 0, house); offer.onAccept();
      assert.eq(Inventory.count(s.save, 'potato'), 0);
      assert.truthy(Delivery.isSatisfied(s.save, house));
      assert.eq(s.save.deliveryCount, 1);
      assert.eq(NPC.houseNeighbours(s, { now: s.save.npcMoveInAfter[house.id] }), 1);
      assert.eq(NPC.residentOf(s.save, house).id, tilly.id);
      NPC.interact(s, tilly, 0, 0);
      assert.truthy(message.body.includes('Thank you, Hood'));
      assert.eq(Quests.starterCurrent(s.save).event, 'tilly', 'gratitude must be read before advancing');
      message.onDismiss();
      assert.eq(Quests.starterCurrent(s.save).event, 'roads');
      Starter.placeHomeGreeter(s, entry, 0, 0);
      assert.falsy(entry.creatures.some(c => c.kind === 'chicken'), 'the road sign-off still belongs to guidance');
      s.acknowledgeObjective();
      assert.truthy(Quests.starterAllDone(s.save));
      Starter.placeHomeGreeter(s, entry, 0, 0);
      const chicken = entry.creatures.find(c => c.kind === 'chicken');
      assert.truthy(chicken);
      assert.truthy(weaponCeremony.hold(), 'an offscreen seat alone is not the bird entrance');
      // Simulate ordinary arrival at its assigned destination; do not catch it.
      chicken.x = chicken._homeX; chicken.y = chicken._homeY;
      Starter.tickIntroductions(s);
      assert.truthy(s.save.starter.chickenArrived);
      assert.falsy(weaponCeremony.hold());
      const candidate = [...Lairs.buildIndex(entry, 0, 0, cell, edge).buckets.values()].flat()
        .find(c => c.key === wreck.id);
      assert.eq(Starter.introductionLair(s, candidate), null, 'exploring early cannot wake the thief');
      weaponCeremony.open(() => {});
      assert.eq(offer.choices.map(r => r.slot).join(','), 'sword,bow,staff');
      assert.falsy(s.save.trail.firstWeaponClaimed);
      s._claimTrailReward(offer.choices[1]);
      assert.eq(s.save.activeWeapon, 'bow');
      assert.truthy(s.save.trail.firstWeaponClaimed);
      assert.falsy(s.save.trail.firstWeaponPending);
      assert.falsy(s.save.caught.includes(chicken.id), 'catching is never required');
      const onward = Starter.introductionLair(s, candidate);
      assert.eq(onward.tier, 'starter_thief');
      const guards = Lairs.garrisonFor(entry, onward, { tileEdgeM: edge,
        spawnOpts: entry._spawnOpts, caughtSet: new Set(s.save.caught) });
      assert.eq(guards.length, 1); assert.eq(guards[0].kind, 'thief');
    } finally {
      cache.clear(); for (const [key, value] of previous) cache.set(key, value);
      NPCBenefits.visit = visit; Difficulty.setMode(mode);
    }
  });
})();
