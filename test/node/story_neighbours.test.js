// THE STORY NEIGHBOURS by the starting trailer (Starter.placeSafeAreaWarden
// seats NPC.STORY_NEIGHBOURS; MemoryStory.npcDialogue speaks for them), and
// the ROLE-DRIVEN residents: the mason off the restoration ledger, the
// lamplighter off the lamp ledger, the zone keeper off Zones.ZONE_KINDS.
(function () {
  const T = WorldGen.T;
  const N = 40, CELL_M = 7, EDGE_M = N * CELL_M;
  const scene = (save = {}) => ({ tileEdgeM: EDGE_M, cellM: CELL_M, save: { caught: [], opened: [], ...save } });
  const starterEntry = () => ({
    grid: new Uint8Array(N * N).fill(T.GRASS), cellsPerEdge: N, _spawned: true,
    objects: [], wildplants: [], creatures: [], roadMask: new Uint8Array(N * N), spawnWhy: new Uint8Array(N * N),
  });
  const cellOf = c => ({ cx: Math.floor(c.x / CELL_M), cy: Math.floor(c.y / CELL_M) });
  const cheb = (a, b) => Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));
  const person = (role, id = `npc_${role}_0_0`) => ({ id, kind: 'npc', x: 0, y: 0, ...NPC.storyNeighbour(id, role) });
  const towerSave = (memories, { second = false, restored = 15 } = {}) => {
    const save = { discovered: {}, restoredHouses: {}, wizardTowers: { firstId: 'tower_1', secondId: second ? 'tower_2' : null } };
    for (let i = 0; i < memories; i++) save.discovered[`m${i}`] = 1;
    for (let i = 0; i < restored; i++) save.restoredHouses[`h${i}`] = i === 14 ? 'wizard' : 'plain';
    save.restoredHouses.tower_1 = 'wizard';
    if (second) save.restoredHouses.tower_2 = 'wizard';
    return save;
  };

  test('story neighbours: Tilly alone on a new save; the rest come in as memories return', () => {
    const entry = starterEntry(), anchor = { x: 20.5 * CELL_M, y: 20.5 * CELL_M };
    const save = { starterCratesAt: anchor, discovered: {} };
    const s = { tileEdgeM: EDGE_M, save, _starterTrailAnchor: () => anchor };
    const remember = (n) => { for (let i = Object.keys(save.discovered).length; i < n; i++) save.discovered[`m${i}`] = 1; };
    const present = () => NPC.STORY_NEIGHBOURS.filter(role => entry.creatures.some(c => c.id === `npc_${role}_0_0`));
    const at = role => entry.creatures.find(c => c.id === `npc_${role}_0_0`);
    assert.eq(JSON.stringify(NPC.STORY_NEIGHBOURS), JSON.stringify(['warden', 'witness', 'wanderer', 'believer', 'archaeologist']), 'existing neighbours retain their order');
    // The gates, in the owner's order (Oct 2026): Tilly, then Bryn at three,
    // Maud at six (through the goblin-archer rescue, never the trailer), Edda at nine.
    assert.eq(NPC.STORY_ROLES.wanderer.minMemories, 0);
    assert.eq(NPC.STORY_ROLES.warden.minMemories, 3);
    assert.eq(NPC.STORY_ROLES.witness.minMemories, 6);
    assert.eq(NPC.STORY_ROLES.believer.minMemories, 9);
    assert.eq(NPC.STORY_ROLES.witness.arrives, 'rescue', 'Maud arrives hunted, not by the trailer');
    assert.eq(JSON.stringify(['warden', 'witness', 'wanderer', 'believer'].map(r => NPC.STORY_ROLES[r].name)), JSON.stringify(['Bryn', 'Maud', 'Tilly', 'Edda']));
    assert.eq(Starter.placeSafeAreaWarden(s, entry, 0, 0), 1, 'one person seated');
    assert.eq(present().join(','), 'wanderer', 'the first morning: Tilly is the one neighbour');
    assert.eq(Starter.placeSafeAreaWarden(s, entry, 0, 0), 0, 'idempotent while nothing is due');
    remember(2);
    Starter.placeSafeAreaWarden(s, entry, 0, 0);
    assert.eq(present().join(','), 'wanderer', 'two memories: still alone');
    remember(3);
    assert.eq(Starter.placeSafeAreaWarden(s, entry, 0, 0), 1);
    assert.eq(present().join(','), 'warden,wanderer', 'three: Bryn is by the trailer');
    const bryn = JSON.stringify(cellOf(at('warden'))), tilly = JSON.stringify(cellOf(at('wanderer')));
    remember(NPC.STORY_ROLES.witness.minMemories);
    assert.eq(Starter.placeSafeAreaWarden(s, entry, 0, 0), 0, 'six: Maud is not seated by the trailer');
    remember(NPC.STORY_ROLES.believer.minMemories);
    Starter.placeSafeAreaWarden(s, entry, 0, 0);
    assert.eq(present().join(','), 'warden,wanderer,believer', 'nine: Edda joins them');
    const placed = NPC.STORY_NEIGHBOURS.filter(role => !NPC.STORY_ROLES[role].radiusM && !NPC.STORY_ROLES[role].arrives).map(at);
    assert.truthy(placed.every(Boolean), 'all three are here in the end');
    assert.eq(JSON.stringify(cellOf(at('warden'))), bryn, 'Bryn never moved');
    assert.eq(JSON.stringify(cellOf(at('wanderer'))), tilly, 'Tilly never moved');
    for (const c of placed) {
      assert.inRange(cheb(cellOf(c), { cx: 20, cy: 20 }), 3, 8, `${c.role} stands a few cells from the trailer`);
      assert.eq(c.roleLabel, NPC.STORY_ROLES[c.role].label);
      assert.eq(c.name, NPC.STORY_ROLES[c.role].name, 'a name of their own');
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      assert.gte(cheb(cellOf(placed[i]), cellOf(placed[j])), 1, `${placed[i].role} and ${placed[j].role} never share a cell`);
    }
    const before = JSON.stringify(entry.creatures);
    Starter.placeSafeAreaWarden(s, entry, 0, 0);
    assert.eq(JSON.stringify(entry.creatures), before, 'idempotent');
    // Nobody is watched arriving: a seat on screen waits for the player to
    // look away.
    const shy = starterEntry();
    assert.eq(Starter.placeSafeAreaWarden(s, shy, 0, 0, { offscreen: () => false }), 0, 'every seat is in view: nobody seated');
    assert.eq(Starter.placeSafeAreaWarden(s, shy, 0, 0, { offscreen: () => true }), 3, 'looked away: all three');
    assert.truthy(shy._starterTile, 'the tile is marked for the arrivals pass');
    // The runtime paths: a banked memory seats through the scene's starter-tile
    // lookup (off screen only), and the arrivals pass calls back later.
    const late = starterEntry();
    const ls = { ...s, _starterTileEntry: () => ({ entry: late, tx: 0, ty: 0 }) };
    assert.eq(Starter.seatStoryNeighbours(ls), 3, 'a banked memory seats whoever is due');
    ls._starterTileEntry = () => null;
    assert.eq(Starter.seatStoryNeighbours(ls), 0, 'underground or before the tile is up: a no-op');
    assert.truthy(/MemoryStory\.enqueue\(this\.save, this\.memoriesTotal\(\), label\);\n\s*this\._seatStoryNeighbours\(\);/.test(SCENE_SRC), 'the one memory writer seats the arrival');
    assert.truthy(/_seatStoryNeighbours\(\) \{ return Starter\.seatStoryNeighbours\(this\); \}/.test(SCENE_SRC), 'through the scene wrapper');
  });

  test('story neighbours: the survivor tells of the Warmonger, one act at a time, never the secret', () => {
    const w = person('witness');
    const act1 = NPC.dialogue(scene({ discovered: {}, restoredHouses: {} }), w).body;
    assert.truthy(/Warmonger/.test(act1) && /roofs/.test(act1), 'the night the roofs went');
    assert.eq(act1, MemoryStory.NEIGHBOURS.witness[1].join('\n\n'));
    // Act 2 is two panels: the roofs, then the elder's notice that the Hood
    // has not aged (the bible's foreshadowing, never the secret).
    const act2 = NPC.dialogue(scene(towerSave(12)), w);
    assert.eq(JSON.stringify(act2.pages), JSON.stringify(MemoryStory.NEIGHBOURS.witness[2]), 'the pages are the row');
    assert.eq(act2.pages.length, 2, 'two panels');
    assert.eq(act2.body, act2.pages.join('\n\n'), 'body is the pages joined');
    assert.truthy(/not changed a day/.test(act2.pages[1]), 'the elder notices the Hood has not aged');
    const late = towerSave(30, { second: true }); late.memoryStory = { act3Started: true };
    assert.eq(NPC.dialogue(scene(late), w).body, MemoryStory.NEIGHBOURS.witness[3].join('\n\n'));
    assert.truthy(/· Survivor$/.test(NPC.dialogue(scene(), w).title));
    const every = [...Object.values(MemoryStory.NEIGHBOURS.witness).flat(), ...Object.values(MemoryStory.NEIGHBOURS.wanderer), ...Object.values(MemoryStory.NEIGHBOURS.believer),
      ...MemoryStory.SURVIVORS, MemoryStory.HOME.body, MemoryStory.FIRST_ROOF, MemoryStory.RUMOUR,
      ...Object.values(Zones.ZONE_KINDS).flatMap(k => k.keeper || []), ...NPC.KEEPER_DEFAULT].join(' ');
    assert.falsy(/dragon|conquer|scales|wings|fire breath|sister|father|Tiamat|Ayo/i.test(every), 'no neighbour spoils the second tower');
    // The copy convention: an action is <em> on its own line, speech is in
    // curly quotes, and nothing else is markup.
    for (const line of every.split(' \n')) assert.falsy(/<(?!\/?em>)/.test(line), 'only <em> reaches a neighbour line: ' + line);
    assert.truthy(/<em>[^<\n]+<\/em>\n“/.test(MemoryStory.HOME.body), 'an action on its own line, then the words');
  });

  test('story neighbours: the wanderer is homeless until the second restoration after you meet them', () => {
    const w = person('wanderer');
    const s = scene({ discovered: {}, restoredHouses: { h0: 'blacksmith' } });
    assert.eq(NPC.dialogue(s, w).body, MemoryStory.NEIGHBOURS.wanderer.homeless, 'sad on the first meeting even after a restoration they never saw');
    assert.eq(s.save.memoryStory.met[w.id], 1, 'the meeting is stamped with the day\'s count');
    assert.eq(NPC.dialogue(s, w).body, MemoryStory.NEIGHBOURS.wanderer.homeless, 'still sad tomorrow');
    s.save.restoredHouses.h1 = 'trader';
    assert.eq(NPC.dialogue(s, w).body, MemoryStory.NEIGHBOURS.wanderer.homeless, 'one new roof is not enough');
    s.save.restoredHouses.h2 = 'plain';
    assert.eq(NPC.dialogue(s, w).body, MemoryStory.NEIGHBOURS.wanderer.housed, 'the second restoration gives them a roof');
    const reloaded = scene(JSON.parse(JSON.stringify(s.save)));
    assert.eq(NPC.dialogue(reloaded, w).body, MemoryStory.NEIGHBOURS.wanderer.housed);
    assert.eq(s.save.memoryStory.met[w.id], 1, 'the stamp never moves');
    const legacy = scene({ restoredHouses: { first: 'plain', second: 'plain' }, memoryStory: { met: { [w.id]: 1 } } });
    assert.eq(NPC.dialogue(legacy, w).body, MemoryStory.NEIGHBOURS.wanderer.housed, 'legacy child already housed after one new roof keeps the home');
    const later = scene(towerSave(12)); later.save.memoryStory = { met: { [w.id]: 3 } };
    assert.eq(NPC.dialogue(later, w).body, MemoryStory.NEIGHBOURS.wanderer.settled, 'settled by the second act');
    assert.truthy(/· Wanderer$/.test(NPC.dialogue(s, w).title));
  });

  test('roles: every role a zone draws has its own untinted sheet, one per label', () => {
    const byLabel = new Map();
    for (const [zone, p] of Object.entries(NPC.PROFILES)) for (const role of new Set(p.roles)) {
      const sheet = SpriteLayout.npcSheet({ role, zone });
      assert.eq(sheet.role, role, `${zone} ${role} has a sheet of its own`);
      assert.eq(sheet.tint, 0xffffff, `${zone} ${role} wears its own colours`);
      const label = NPC.LABELS[zone][role];
      assert.eq(byLabel.get(label) ?? sheet.idle, sheet.idle, `${label} looks the same in every zone`);
      byLabel.set(label, sheet.idle);
    }
    assert.eq(new Set(byLabel.values()).size, byLabel.size, 'no two labels share a look');
    const assets = new Function('window', 'EnemyRoster', 'SpriteLayout', ASSETS_SRC + '\nreturn ASSETS;')({}, EnemyRoster, SpriteLayout);
    for (const sheet of SpriteLayout.NPC_SHEETS) {
      assert.truthy(assets[sheet.idle] && assets[sheet.walk], `${sheet.idle} is preloaded`);
      assert.eq(assets[sheet.walk].path, sheet.path.replace(/_idle\.png$/, '_walk.png'));
      for (const key of [sheet.idle, sheet.walk]) {
        const dims = pngDims(assets[key].path);
        assert.truthy(dims, `${assets[key].path} exists`);
        assert.eq(dims.w, 48 * (sheet.cols || SpriteLayout.NPC_FRAME.cols), `${key}: whole 48px columns`);
        assert.eq(dims.h, 48 * 4, `${key}: front, back, left and right rows`);
      }
    }
    assert.falsy(Object.values(NPC.LABELS).some(l => /Elven/.test(Object.values(l).join())), 'no elves');
  });

  test('story neighbours: named dialogue uses paintings and ordinary residents keep their sprite portraits', () => {
    for (const role of NPC.STORY_NEIGHBOURS) {
      const c = person(role);
      c._portrait = 'data:image/png;base64,old-sprite';
      assert.eq(NPC.portrait({}, c), `npc_${c.name.toLowerCase()}`, `${c.name} uses the painting even after a cached sprite portrait`);
    }
    const ordinary = { role: 'mason', _portrait: 'data:image/png;base64,resident' };
    assert.eq(NPC.portrait({}, ordinary), ordinary._portrait, 'ordinary residents retain the sprite fallback');
    const homeless = MemoryStory.NEIGHBOURS.wanderer.homeless;
    assert.truthy(/clutching a doorknob/.test(homeless), 'Tilly holds the surviving piece of her home');
    assert.truthy(/doorknob is all that is left/.test(homeless), 'her words agree with the painting');
  });

  test('story neighbours: each named neighbour wears its own untinted sheet', () => {
    const sheets = {};
    for (const role of ['warden', 'witness', 'wanderer', 'believer']) {
      const sheet = SpriteLayout.npcSheet(person(role));
      assert.eq(sheet.role, role, `${role} has a sheet of its own`);
      assert.eq(sheet.tint, 0xffffff, `${role} is untinted`);
      sheets[role] = sheet.idle;
    }
    assert.eq(new Set([sheets.warden, sheets.witness, sheets.believer]).size, 3, 'the grown neighbours look different');
    assert.eq(sheets.wanderer, sheets.believer, 'Tilly is the believer sheet at child scale');
  });

  test('story neighbours: the wanderer is a child, drawn at seven tenths through the instance-size lane', () => {
    assert.eq(NPC.CHILD_SCALE, 0.7);
    const child = person('wanderer');
    assert.eq(child.artScale, NPC.CHILD_SCALE, 'the row stamps the instance size');
    assert.eq(SpriteLayout.creatureInstScale(child), NPC.CHILD_SCALE, 'the one lane every reader of drawn size uses');
    assert.eq(SpriteLayout.creatureScale('npc', SpriteLayout.creatureInstScale(child)), SpriteLayout.creatureScale('npc') * NPC.CHILD_SCALE);
    for (const role of ['warden', 'witness', 'believer']) {
      const grown = person(role);
      assert.eq(grown.artScale, undefined, `${role} is grown`);
      assert.eq(SpriteLayout.creatureInstScale(grown), 1);
    }
    for (const line of Object.values(MemoryStory.NEIGHBOURS.wanderer)) {
      const spoken = line.replace(/<em>[^<]*<\/em>\n?/g, '').replace(/[“”]/g, '');
      assert.lte(Math.max(...spoken.split(/[.!?]\s+/).map(t => t.split(' ').length)), 14, 'a child speaks in short sentences: ' + spoken);
    }
  });

  test('story neighbours: the believer follows the tower — ruin, sealed, open, abandoned, moved', () => {
    const b = person('believer'), L = MemoryStory.NEIGHBOURS.believer;
    assert.eq(NPC.dialogue(scene({ discovered: {}, restoredHouses: {} }), b).body, L.ruin);
    assert.truthy(/wise wizard/.test(L.ruin) && /tower/.test(L.ruin) && /come/.test(L.ruin), 'lauds him, and the tower may bring him back');
    assert.eq(NPC.dialogue(scene(towerSave(4)), b).body, L.locked);
    assert.eq(NPC.dialogue(scene(towerSave(12)), b).body, L.open);
    assert.eq(NPC.dialogue(scene(towerSave(24)), b).body, L.abandoned);
    assert.eq(NPC.dialogue(scene(towerSave(30, { second: true })), b).body, L.moved);
    const late = towerSave(30, { second: true }); late.memoryStory = { act3Started: true };
    assert.eq(NPC.dialogue(scene(late), b).body, L.moved, 'never learns what the player learns');
    assert.truthy(/· Believer$/.test(NPC.dialogue(scene(), b).title));
  });

  test('story neighbours: the warden still opens with the family and the safe area', () => {
    const w = person('warden');
    const talk = NPC.dialogue(scene({}), w);
    assert.truthy(talk.body.includes(NPC.WARDEN_LINE) && talk.body.includes(MemoryStory.HOME.body));
    assert.eq(talk.pages.length, 2, 'the plea, then the safe area: two panels');
    assert.eq(talk.pages[0], MemoryStory.HOME.body);
    assert.truthy(talk.pages[1].endsWith(NPC.WARDEN_LINE), 'the safe-area sentence closes the second');
    assert.eq(JSON.stringify(NPC.warden('npc_warden_1_2')), JSON.stringify(NPC.storyNeighbour('npc_warden_1_2', 'warden')));
  });

  test('roles: every zone labels every role, and the new roles are drawn', () => {
    const roles = new Set(Object.values(NPC.PROFILES).flatMap(p => p.roles));
    for (const role of ['mason', 'lamplighter', 'keeper']) assert.truthy(roles.has(role), `${role} is in a profile`);
    for (const [zone, labels] of Object.entries(NPC.LABELS)) for (const role of roles) assert.truthy(labels[role], `${zone} labels ${role}`);
    const seen = new Set();
    for (let i = 0; i < 600; i++) seen.add(NPC.identity(`npc_3_3_${i}_2`, 'village').role);
    for (const role of ['mason', 'lamplighter', 'scholar', 'scout', 'merchant', 'trader']) assert.truthy(seen.has(role), `a village draws a ${role}`);
  });

  test('roles: the mason counts the restoration ledger and points at the nearest wreck', () => {
    const c = Object.assign({ id: 'npc_1_1_1_1', x: 0, y: 0 }, NPC.identity('npc_1_1_1_1'), { role: 'mason', roleLabel: 'Mason' });
    const realWalk = WorldGen.forEachItemInBox;
    const cache = Array.from(WorldGen.tileCache.entries());
    WorldGen.tileCache.clear(); WorldGen.tileCache.set('0,0', {});
    const houses = [
      { kind: 'house', tier: 9, id: 'near', x: 0, y: -30 }, { kind: 'house', tier: 9, id: 'far', x: 10000, y: 0 },
      { kind: 'house', tier: 9, id: 'mended', x: 5, y: 0 }, { kind: 'house', tier: 11, id: 'fort', x: 3, y: 0 },
    ];
    WorldGen.forEachItemInBox = (tile, kind, x0, y0, x1, y1, fn) => { if (kind === 'objects') houses.forEach(fn); };
    try {
      const s = scene({ restoredHouses: { mended: 'plain' } });
      const talk = NPC.dialogue(s, c, Date.UTC(2026, 8, 28));
      assert.truthy(/One roof stands again/.test(talk.body), 'the ledger, in words');
      assert.truthy(/wreck .*north of here/.test(talk.body), 'the nearest wreck that still waits, not the mended one or the fort');
      s.save.restoredHouses = { mended: 'plain', b: 'plain', c: 'plain' };
      assert.truthy(/3 roofs stand again/.test(NPC.dialogue(s, c).body));
      s.save.restoredHouses = {};
      assert.truthy(/wreck/.test(NPC.dialogue(s, c).body), 'nothing mended yet: the wrecks are waiting');
      houses.length = 0;
      assert.truthy(/No wreck near here/.test(NPC.dialogue(s, c).body));
      assert.truthy(/· Mason$/.test(NPC.dialogue(s, c).title));
    } finally {
      WorldGen.forEachItemInBox = realWalk;
      WorldGen.tileCache.clear(); for (const [key, value] of cache) WorldGen.tileCache.set(key, value);
    }
  });

  test('roles: the lamplighter reads the living-lamp ledger', () => {
    const c = Object.assign({ id: 'npc_1_1_2_1', x: 0, y: 0 }, NPC.identity('npc_1_1_2_1'), { role: 'lamplighter' });
    const dark = NPC.dialogue(scene({}), c).body;
    assert.truthy(/lamp/i.test(dark) && !/\d/.test(dark), 'no lamps yet: an invitation, not a count');
    const lit = NPC.dialogue(scene({ lampVisits: { a: 1, b: 2, c: 3 } }), c).body;
    assert.truthy(/3 lamps burn brighter/.test(lit));
    assert.truthy(lit.includes(spokenDuration(Streets.LAMP_FADE_MS)), 'the fade is the owning constant, in a speaking voice');
    assert.truthy(/Stay away a day and/.test(lit), 'a neighbour says "a day", never "1d"');
    assert.falsy(/\d[smhd]\b/.test(lit), 'no lettered duration in speech');
    assert.truthy(/One lamp burns/.test(NPC.dialogue(scene({ lampVisits: { a: 1 } }), c).body));
  });

  test('roles: every named zone with residents has a keeper, who tells that zone\'s story', () => {
    for (const kind of ['grove', 'stones', 'beach']) {
      const e = {
        cellsPerEdge: 32, grid: new Uint8Array(32 * 32).fill(T.PARK), objects: [], genObjects: [], wildplants: [], roadMask: new Uint8Array(32 * 32),
        zone: { idx: new Uint8Array(32 * 32).fill(1), s: new Uint8Array(32 * 32).fill(255), anchors: [{ kind }] },
      };
      e.genObjects.push({ id: 'grove_shrine', kind: 'grove_shrine', x: 16 * 7, y: 16 * 7 });
      const s = { tileEdgeM: 32 * 7, cellM: 7, save: { caught: [], opened: [] } };
      const residents = NPC.spawn(s, e, 0, 0, {});
      assert.eq(residents.length, NPC.COUNT);
      assert.truthy(residents.every(c => c.zoneKind === kind), 'residents know their zone');
      const keepers = residents.filter(c => c.role === 'keeper');
      assert.gt(keepers.length, 0, `${kind} has a keeper`);
      assert.eq(keepers[0].roleLabel, NPC.LABELS[kind === 'grove' ? 'grove' : 'shrine'].keeper, 'the grove\'s keeper is a fox');
      const talk = NPC.dialogue(s, keepers[0]);
      assert.includes(Zones.ZONE_KINDS[kind].keeper, talk.body, `${kind}'s keeper tells its story`);
      const again = NPC.spawn(s, e, 0, 0, {});
      assert.eq(JSON.stringify(again.map(c => [c.id, c.role])), JSON.stringify(residents.map(c => [c.id, c.role])), 'the keeper is the same person every build');
    }
    // The guarantee reseats only when the roll left a zone without one.
    const people = [{ id: 'a', zone: 'shrine', zoneKind: 'grove', role: 'scout' }, { id: 'b', zone: 'shrine', zoneKind: 'grove', role: 'keeper' }, { id: 'c', zone: 'village', zoneKind: 'grove', role: 'scout' }];
    NPC.seatKeepers(people);
    assert.eq(people.map(p => p.role).join(','), 'scout,keeper,scout', 'a keeper already drawn is enough; villagers stay villagers');
    const plain = Object.assign({ id: 'npc_9_9_9_9', x: 0, y: 0 }, NPC.identity('npc_9_9_9_9', 'shrine'), { role: 'keeper' });
    assert.includes(NPC.KEEPER_DEFAULT, NPC.dialogue(scene(), plain).body, 'a keeper off a plain shrine has the default lines');
    for (const [kind, row] of Object.entries(Zones.ZONE_KINDS)) assert.truthy(Array.isArray(row.keeper) && row.keeper.length, `${kind} row carries its keeper column`);
  });
})();
