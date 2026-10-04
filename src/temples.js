// A park's temples share one permanent awakening and one treasure gift.
(function (root) {
  'use strict';
  const CONTEXT = 'treasure:temple';
  let epoch = 0, nextEntryId = 1;
  const entryIds = new WeakMap(), observed = new WeakMap();
  const STORY = {
    title: 'The temple awakens', art: 'temple_activated', kind: 'story',
    body: 'With the park’s enemies defeated, blue light fills the temple’s carved runes. A gift of magic waits within.',
  };
  function zoneKey(o) { return o?.templeZone || o?.templeAnchor?.key || null; }
  function isActive(save, o) { return !!save?.temples?.[zoneKey(o)]?.active; }
  function sameZone(anchor, key) { return anchor && String(anchor.key) === String(key); }
  function field(entry) { return entry?.zone; }
  function owns(entry, i, key) {
    const f = field(entry), mask = f?.coverage || f?.idx;
    return !!mask && sameZone(f.anchors?.[mask[i] - 1], key);
  }

  // Follow the actual park coverage across tile seams. An absent tile, or a
  // ready terrain tile whose creatures have not spawned, cannot prove a clear.
  function coverage(o, cache, tileEdgeM) {
    const key = zoneKey(o), queue = [], visited = new Set(), entries = [];
    if (!key || !cache || !(tileEdgeM > 0)) return { complete: false, entries };
    const a = o.templeAnchor;
    queue.push([Math.floor(o.x / tileEdgeM), Math.floor(o.y / tileEdgeM)]);
    if (a && Number.isFinite(a.gx) && Number.isFinite(a.gy)) queue.push([Math.floor(a.gx / 4096), Math.floor(a.gy / 4096)]);
    let complete = true, found = false;
    for (let q = 0; q < queue.length; q++) {
      const [tx, ty] = queue[q], tk = root.WorldGen.tileKey(tx, ty);
      if (visited.has(tk)) continue;
      visited.add(tk);
      const entry = cache.get(tk), N = entry?.cellsPerEdge;
      if (entry?.status !== 'ready' || !entry._spawned || !(N > 0)) { complete = false; continue; }
      const f = field(entry), mask = f?.coverage || f?.idx;
      // A fully spawned neighbour with no zones proves this edge ends here.
      if (!mask) continue;
      let present = false;
      for (let i = 0; i < mask.length; i++) {
        if (!owns(entry, i, key)) continue;
        present = true;
        const x = i % N, y = Math.floor(i / N);
        const dx = x === 0 ? -1 : x === N - 1 ? 1 : 0;
        const dy = y === 0 ? -1 : y === N - 1 ? 1 : 0;
        if (dx) queue.push([tx + dx, ty]);
        if (dy) queue.push([tx, ty + dy]);
        if (dx && dy) queue.push([tx + dx, ty + dy]);
      }
      if (present) { found = true; entries.push({ entry, tx, ty }); }
    }
    return { complete: complete && found, entries };
  }
  function status(save, o, opts = {}) {
    if (isActive(save, o)) return { active: true, ready: true, remaining: 0 };
    const tileEdgeM = opts.tileEdgeM, cache = opts.tileCache || root.WorldGen?.tileCache;
    const key = zoneKey(o), region = coverage(o, cache, tileEdgeM);
    if (!region.complete) return { active: false, ready: false, remaining: null, reason: 'Explore the whole park before awakening its temple.' };
    const caught = new Set(save.caught || []), remaining = new Set(), authored = new Set();
    const inZone = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      const tx = Math.floor(x / tileEdgeM), ty = Math.floor(y / tileEdgeM);
      const e = cache.get(root.WorldGen.tileKey(tx, ty)), N = e?.cellsPerEdge;
      if (!(N > 0)) return false;
      const ix = Math.floor((x / tileEdgeM - tx) * N), iy = Math.floor((y / tileEdgeM - ty) * N);
      return owns(e, iy * N + ix, key);
    };
    const count = c => {
      // Dormant, buried and charmed foes still have to be defeated. The combat
      // targeting predicate intentionally hides them, so use species here.
      if (!c?.id || c.id.startsWith('released_') || !root.Combat.isEnemyKind(c.kind)) return;
      const home = c._surfaceSpawn;
      if (inZone(c.x, c.y) || inZone(c.lairX, c.lairY) || inZone(home?.x, home?.y)) {
        authored.add(c.id);
        if (!caught.has(c.id)) remaining.add(c.id);
      }
    };
    // A park resident can chase outside its original tile; inspect all cached
    // creatures and retain ownership through its authored home coordinates.
    for (const entry of cache.values()) for (const c of entry.creatures || []) count(c);
    for (const { entry, tx, ty } of region.entries) {
      for (const c of entry.templeEnemySites || entry.zoneDress?.guards || []) count(c);
      if (!root.Lairs || !entry._spawnOpts) continue;
      const cellM = tileEdgeM / entry.cellsPerEdge;
      const index = root.Lairs.buildIndex(entry, tx, ty, cellM, tileEdgeM);
      for (const bucket of index.buckets.values()) for (const cand of bucket) {
        if (!inZone(cand.wx, cand.wy)) continue;
        if (root.Difficulty?.get?.().derelictLairs === false && !root.Lairs.ALWAYS_AWAKE_TIERS.has(cand.tier)) continue;
        for (const c of root.Lairs.garrisonFor(entry, cand, { tileEdgeM, cellM, caughtSet: new Set() })) count(c);
      }
    }
    return { active: false, ready: remaining.size === 0, remaining: remaining.size,
      hadEnemies: authored.size > 0 || !!save.temples?.[key]?.hadEnemies,
      reason: remaining.size ? `Defeat the park's remaining enemies (${remaining.size}) to awaken the temple.` : null };
  }
  function interact(ctx, o) {
    const { scene, save, sx, sy } = ctx;
    const state = status(save, o, { tileEdgeM: scene.tileEdgeM });
    if (!state.active) {
      const body = state.reason || 'Seek the hidden spirit in this park to awaken the shrine.';
      if (scene.showMessageModal) scene.showMessageModal({ title: 'The sleeping temple', body, kind: 'story' });
      else scene.flash('The temple is still asleep.', sx, sy);
      return true;
    }
    const key = zoneKey(o);
    const record = (save.temples ||= {})[key] ||= { active: true, rewardClaimed: false };
    if (record.rewardClaimed) { scene.flash('The temple shines.', sx, sy); return true; }
    record.active = true;
    ctx.dirty = true;
    persistSave(save);
    const claim = () => {
      if (record.rewardClaimed) return;
      record.rewardClaimed = true;
      grantTreasureRoll(scene, save, sx, sy, '✦', CONTEXT, {
        rollBonus: 1, ceremony: { art: STORY.art, header: 'The temple’s gift', kind: 'treasure' },
      });
      persistSave(save);
    };
    claim();
    return true;
  }
  function activate(scene, o, spirit = false) {
    const key = zoneKey(o);
    if (!key || isActive(scene.save, o)) return false;
    const record = (scene.save.temples ||= {})[key] ||= {};
    record.active = true;
    record.rewardClaimed = false;
    epoch++;
    persistSave(scene.save);
    scene.showMessageModal?.({ ...STORY,
      ...(spirit ? { title: 'Shrine spirit discovered', body: 'Shrine spirit discovered. The shrine begins to glow.' } : {}),
    });
    return true;
  }
  function discoverSpirit(scene, o) { return activate(scene, o, true); }
  function observe(scene) {
    if (scene.depth > 0 || scene._dialogOpen?.()) return;
    const pc = scene.playerToWorldCell?.();
    const entries = [];
    for (const entry of root.WorldGen.tileCache.values()) {
      if (!entryIds.has(entry)) entryIds.set(entry, nextEntryId++);
      entries.push(`${entryIds.get(entry)}:${entry._spawned ? 1 : 0}`);
    }
    const stamp = `${pc?.tx},${pc?.ty},${Math.floor(pc?.cx)},${Math.floor(pc?.cy)}|${scene.save.caught?.length || 0}|${epoch}|${entries.join(',')}`;
    if (observed.get(scene) === stamp) return;
    observed.set(scene, stamp);
    const seen = new Set();
    for (const entry of root.WorldGen.tileCache.values()) for (const o of derivedObjects(entry, '_temples', o => o.kind === 'temple')) {
      const key = zoneKey(o);
      if (o.kind !== 'temple' || seen.has(key) || isActive(scene.save, o)) continue;
      if (pc && (Math.abs(Math.floor(o.x / scene.tileEdgeM) - pc.tx) > 1
          || Math.abs(Math.floor(o.y / scene.tileEdgeM) - pc.ty) > 1)) continue;
      seen.add(key);
      const state = status(scene.save, o, { tileEdgeM: scene.tileEdgeM });
      if (state.hadEnemies) {
        const record = (scene.save.temples ||= {})[key] ||= {};
        if (!record.hadEnemies) { record.hadEnemies = true; persistSave(scene.save); }
        if (state.ready && activate(scene, o)) return; // one story at a time
      } else if (state.ready) root.HiddenObjects?.ensureSpirit(scene, o, state);
    }
  }
  root.Temples = { CONTEXT, STORY, zoneKey, isActive, coverage, status, interact, observe, discoverSpirit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
