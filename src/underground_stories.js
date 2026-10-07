// Underground discovery panels share the normal once-per-save story ledger.
(function (root) {
  'use strict';
  const KINDS = {
    spring_cave: { art: 'underground_spring_cave', title: "Underground Spring", body: "Water bubbles into a clear pool. You follow the dry bank beneath the dripping stone." },
    goblin_warrens: { art: 'underground_goblin_warrens', title: "Goblin Warrens", body: "You hear movement beyond the narrow doorways. Barrels crowd the corners of these low stone rooms." },
    mushroom_cavern: { art: 'underground_mushroom_cavern', title: "Mushroom Cavern", body: "Pale mushrooms crowd the damp floor. A narrow path winds between their caps." },
    gemstone_cavern: { art: 'underground_gemstone_cavern', title: "Gemstone Cavern", body: "Your light catches pale crystals in the rock. The seams continue around the chamber." },
    mine_tunnels: { art: 'underground_mine_tunnels', title: "Mine Tunnels", body: "Tool marks cover the tunnel walls. Dark veins of ore run through the broken stone." },
    root_passage: { art: 'underground_root_passage', title: "Root Passage", body: "Roots hang low across the passage. Mushrooms grow in the damp earth beside your feet." },
    seep_passage: { art: 'underground_seep_passage', title: "Seep Passage", body: "A thin stream slips between the rocks. You keep to the dry bank." },
    miners_way: { art: 'underground_miners_way', title: "Miners’ Way", body: "You pass an abandoned ore cart. The worn path runs deeper between worked stone." },
    warren_run: { art: 'underground_warren_run', title: "Warren Run", body: "Small doorways open along the passage. You hear a scrape of stone ahead." },
    gemstone_path: { art: 'underground_gemstone_path', title: "Gemstone Path", body: "Pale crystals glimmer along the passage. You brush loose grit from the nearest seam." },
    sm_road_passage: { art: 'underground_sm_road_passage', title: "Buried Street", body: "The passage widens beneath the old street. Dark holes break the uneven floor." },
    depth2_rock_scatter: { art: 'underground_depth2_rock_scatter', title: "Crystals in the Rock", body: "Pink and violet crystals show among the loose stones. You kneel to inspect them." },
    bone_gallery: { art: 'underground_bone_gallery', title: "Bone Cache", body: "The floor is littered with bones. Perhaps you should go another way..." },
  };
  function at(entry, x, y) {
    const N = entry?.cellsPerEdge;
    if (!(N > 0) || x < 0 || y < 0 || x >= N || y >= N) return null;
    const plan = entry.underground;
    const route = plan?.routeAt?.get(y * N + x);
    // Region/route authors name the same catalog; absent variants never show.
    const nexus = entry.caveAreas?.areas.find(area => area.reserved.has(y * N + x));
    const variant = nexus?.kind || plan?.variantAt?.get(y * N + x) || route?.theme;
    return KINDS[variant] || null;
  }
  function tick(scene) {
    if (!(scene.depth > 0) || !scene.startWorldM) return false;
    const pc = scene.playerToWorldCell();
    const entry = root.WorldGen.tileCache.get(root.WorldGen.tileKey(pc.tx, pc.ty));
    if (!entry?._spawned) return false;
    const row = at(entry, Math.floor(pc.cx), Math.floor(pc.cy));
    if (!row || scene.save.storySeen?.[row.art]) return false;
    // A busy modal does not mark the story seen; retry while standing here.
    return scene._storySplashOnce(row.art, row);
  }
  root.UndergroundStories = { KINDS, at, tick };
})(typeof window !== 'undefined' ? window : globalThis);

