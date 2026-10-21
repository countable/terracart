// Planters feed the same crop record and tap handlers as field beds.
(() => {
  const handler = name => TAP_HANDLERS.find(h => h.name === name);
  function fixture({ indoors = true, itemId = 'planter_clay', seed = 'potato_seed' } = {}) {
    const save = { energy: 100, starterShopId: 'home' };
    SaveState.defaults(save);
    save.inv = [{ id: seed, count: 2 }]; save.selSlot = 0; save.planted = [];
    const pot = { id: 'pot', itemId, x: 2.5, y: 2.5, depth: 0 };
    save.furniture = [pot];
    const scene = Object.assign(makeScene(), { save, depth: 0, cellM: 5,
      cellsPerTile: 32, tileEdgeM: 160, mPerPx: 5 / (WorldGen.TILE_PX / 32),
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 2.5, y: 2.5 },
      tilledSet: new Set(), placedRockSet: new Set(), buildInventoryDOM() {},
      spendEnergy() { this.spent = (this.spent || 0) + 1; return true; },
      flash(msg) { this.toast = msg; }, flashAtPlayer(msg) { this.toast = msg; },
      flashLoot() {}, addToInv: (id, n) => Inventory.add(save, id, n).accepted,
      presentFurniture() { this.opened = true; return true; },
      homeInside() { return indoors; }, _finishInventoryChange() {}, drawObjects() {},
      _placedFurniture: liftSceneMethod('_placedFurniture'),
      pickupFurniture: liftSceneMethod('pickupFurniture'),
    });
    const entry = { cellsPerEdge: 32, grid: new Uint8Array(1024).fill(WorldGen.T.GRASS),
      objects: [{ ...pot, kind: 'furniture' }], wildplants: [], traps: [],
      owners: new Uint8Array(1024), ownerKeys: ['home'] };
    if (indoors) entry.grid[0] = WorldGen.T.BUILDING;
    const ctx = { scene, save, sx: 0, sy: 0, cellKey: '0_0', cwmx: 2.5, cwmy: 2.5,
      wm: { x: 2.5, y: 2.5 }, cell: { tx: 0, ty: 0, ix: 0, iy: 0, type: entry.grid[0] } };
    return { scene, save, pot, entry, ctx };
  }
  function world(f, fn) {
    const old = [...WorldGen.tileCache];
    WorldGen.tileCache.clear(); WorldGen.tileCache.set(WorldGen.tileKey(0, 0), f.entry);
    try { fn(); } finally { WorldGen.tileCache.clear(); for (const [k, v] of old) WorldGen.tileCache.set(k, v); }
  }
  test('planter: every crop and flower seed plants indoors without tilling', () => {
    const seeds = Object.values(ITEM_BY_ID).filter(item => item.kind === 'seed' && !item.plants);
    assert.gt(seeds.length, 10);
    for (const itemId of ['planter_clay', 'planter_copper']) for (const seed of seeds) {
      const f = fixture({ itemId, seed: seed.id });
      world(f, () => {
        assert.falsy(handler('flavor').try(f.ctx), `${seed.id} reaches plant on building terrain`);
        assert.truthy(handler('plant').try(f.ctx));
        assert.eq(f.save.planted.length, 1, seed.id);
        assert.eq(f.save.planted[0].planter, f.pot.id);
        assert.eq(f.save.planted[0].crop, seed.grows);
        assert.eq(f.save.planted[0].depth, 0);
        assert.eq(f.pot.houseKey, 'home');
        assert.eq(Inventory.count(f.save, seed.id), 1);
        assert.eq(f.scene.tilledSet.size, 0);
      });
    }
  });
  test('planter: outdoors refuses without consuming a seed or energy; stale houseKey is cleared', () => {
    const f = fixture({ indoors: false }); f.pot.houseKey = 'home';
    world(f, () => {
      assert.truthy(handler('plant').try(f.ctx));
      assert.includes(f.scene.toast, 'indoors');
      assert.eq(f.save.planted.length, 0); assert.eq(Inventory.count(f.save, 'potato_seed'), 2);
      assert.eq(f.scene.spent || 0, 0); assert.eq(f.pot.houseKey, null);
    });
  });
  test('planter: held seeds plant directly, empty hands open furniture, growing crops retain tap ownership', () => {
    const f = fixture();
    world(f, () => {
      assert.falsy(handler('object').try(f.ctx)); assert.falsy(f.scene.opened);
      f.save.selSlot = -1;
      assert.truthy(handler('object').try(f.ctx)); assert.truthy(f.scene.opened);
      f.scene.opened = false; f.save.selSlot = 0;
      handler('plant').try(f.ctx); f.save.selSlot = -1;
      assert.falsy(handler('object').try(f.ctx)); assert.falsy(f.scene.opened);
      assert.truthy(handler('planted').try({ ...f.ctx, at: undefined }));
      assert.eq(f.save.planted.length, 1);
    });
  });
  test('planter: growth and harvest use Crops core, block pickup until harvest, and leave reusable furniture', () => {
    const f = fixture();
    world(f, () => {
      handler('plant').try(f.ctx);
      const crop = f.save.planted[0];
      assert.falsy(f.scene.pickupFurniture(f.pot)); assert.eq(f.scene.toast, 'Harvest first.');
      for (let stage = 0; stage < MAX_GROWTH_STAGE; stage++) {
        const now = 1000000 + stage * Crops.stageHoldMs(crop.crop);
        Crops.waterWithin(f.save, crop.x, crop.y, 1, now);
        Crops.advanceGrowth(f.save, now + Crops.stageHoldMs(crop.crop));
      }
      assert.truthy(Crops.isMature(crop));
      assert.truthy(handler('planted').try({ ...f.ctx, at: undefined }));
      assert.eq(f.save.planted.length, 0); assert.eq(f.save.furniture[0], f.pot);
      assert.inRange(Inventory.count(f.save, 'potato'), 1, 3);
      assert.truthy(handler('plant').try({ ...f.ctx, at: undefined }));
      assert.eq(f.save.planted[0].planter, f.pot.id, 'harvest does not require re-tilling');
    });
  });
  test('planter: tree saplings are refused and a stale planting tap cannot overwrite a crop', () => {
    for (const seed of ['acorn', 'apple_sapling']) {
      const f = fixture({ seed });
      world(f, () => {
        assert.truthy(handler('plant').try(f.ctx)); assert.eq(f.save.planted.length, 0);
        assert.eq(Inventory.count(f.save, seed), 2); assert.eq(f.scene.spent || 0, 0);
      });
    }
    const f = fixture();
    world(f, () => {
      handler('plant').try(f.ctx);
      assert.falsy(handler('plant').try({ ...f.ctx, at: undefined }));
      assert.eq(f.save.planted.length, 1); assert.eq(Inventory.count(f.save, 'potato_seed'), 1);
    });
  });
  test('planter: crop seat is 16px, with its top three pixels below the cell top', () => {
    for (let stage = 0; stage <= MAX_GROWTH_STAGE; stage++) {
      const seat = Render.plantPlacement({ planter: 'pot' }, null, stage, stage);
      assert.eq(seat.scl, 1); assert.eq(seat.oy, 0); assert.eq(seat.dyPx, -13);
    }
    for (const itemId of ['planter_clay', 'planter_copper']) {
      const b = SpriteLayout.ART_BOUNDS[`furniture:${furnitureFrame(itemId)}`];
      const scene = { save: { furniture: [{ id: 'pot', itemId }] } };
      const seat = Render.plantPlacement({ planter: 'pot' }, null, 1, 1, scene);
      const artHeight = (b.maxY - b.minY) * FURNITURE_SCALE;
      assert.lte(artHeight, CELL_PX, 'planters use the medium hoppable contact');
      assert.inRange(Math.abs(seat.dyPx - (-13 - artHeight / 6)), 0, 1e-8,
        'crop moves with its planter soil');
    }
    assert.eq(Render.plantPlacement({ crop: 'potato' }, null, 1, 1).scl, 1.6,
      'ordinary field crop presentation stays unchanged');
  });
})();
