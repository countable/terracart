// A park's temples share one permanent awakening and one treasure gift.
(function (root) {
  'use strict';
  const CONTEXT = 'treasure:temple';
  let epoch = 0, nextEntryId = 1;
  const entryIds = new WeakMap(), observed = new WeakMap(), pending = new WeakMap();
  const STORY = {
    title: 'The temple awakens', art: 'temple_activated', kind: 'story',
    body: 'With the park’s enemies defeated, blue light fills the temple’s carved runes. Enter the temple and climb to the marble nexus above. A trial guards its gift of magic.',
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
      // Resolve ownership once per anchor, not once per terrain cell. A
      // native mask search proves presence; only the perimeter can lead to
      // another tile. Read it live so in-place coverage edits, replacement
      // masks and newly loaded/spawned neighbours are immediately respected.
      const slots = new Set();
      for (let i = 0; i < (f.anchors?.length || 0); i++) {
        if (sameZone(f.anchors[i], key)) slots.add(i + 1);
      }
      if (![...slots].some(slot => mask.includes(slot))) continue;
      found = true;
      entries.push({ entry, tx, ty });
      let west = false, east = false, north = false, south = false;
      for (let i = 0; i < N; i++) {
        west ||= slots.has(mask[i * N]);
        east ||= slots.has(mask[i * N + N - 1]);
        north ||= slots.has(mask[i]);
        south ||= slots.has(mask[(N - 1) * N + i]);
        if (west && east && north && south) break;
      }
      if (west) queue.push([tx - 1, ty]);
      if (east) queue.push([tx + 1, ty]);
      if (north) queue.push([tx, ty - 1]);
      if (south) queue.push([tx, ty + 1]);
      if (slots.has(mask[0])) queue.push([tx - 1, ty - 1]);
      if (slots.has(mask[N - 1])) queue.push([tx + 1, ty - 1]);
      if (slots.has(mask[(N - 1) * N])) queue.push([tx - 1, ty + 1]);
      if (slots.has(mask[N * N - 1])) queue.push([tx + 1, ty + 1]);
    }
    return { complete: complete && found, entries };
  }
  function status(save, o, opts = {}) {
    if (isActive(save, o)) return { active: true, ready: true, remaining: 0 };
    const tileEdgeM = opts.tileEdgeM, cache = opts.tileCache || root.WorldGen?.tileCache;
    const key = zoneKey(o), region = coverage(o, cache, tileEdgeM);
    if (!region.complete) return { active: false, ready: false, remaining: null, reason: 'Explore the whole park before awakening its temple.' };
    const scene = opts.scene || { save };
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
      if (root.EnemySpawns && !root.EnemySpawns.homeEligible(scene, c)) return;
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
      if (entry.templeEnemySites) {
        for (const c of entry.templeEnemySites) count(c);
      } else for (const guard of entry.zoneDress?.guards || []) {
        // Match the authored guard's home used by spawnInTileSteps.
        count({ ...guard, lair: guard.burrowCells ? null : (guard.lair || guard.id),
          lairX: guard.homeX ?? guard.x, lairY: guard.homeY ?? guard.y });
      }
      if (!root.Lairs || !entry._spawnOpts) continue;
      const cellM = tileEdgeM / entry.cellsPerEdge;
      // Reuse a finished residency index. An unfinished one cannot prove a
      // park clear; retain the full census without advancing that sliced job.
      const index = entry._lairIndex?.done ? entry._lairIndex
        : root.Lairs.buildIndex(entry, tx, ty, cellM, tileEdgeM);
      for (const bucket of index.buckets.values()) for (const cand of bucket) {
        if (!inZone(cand.wx, cand.wy)) continue;
        if (root.Difficulty?.get?.().derelictLairs === false && !root.Lairs.ALWAYS_AWAKE_TIERS.has(cand.tier)) continue;
        for (const c of root.Lairs.garrisonFor(entry, cand, { tileEdgeM, cellM, caughtSet: new Set() })) count(c);
      }
    }
    return { active: false, ready: remaining.size === 0, remaining: remaining.size,
      // AUTHORED is the proof half of `ready`: this census actually saw the
      // park's authored foes and found every one defeated. Zero authored
      // means they are hidden from this player (the quiet-home hold, the
      // starter safe ring) or their lairs are derelict on this difficulty —
      // never a clear, so a stale hadEnemies stamp must not awaken alone.
      authored: authored.size,
      hadEnemies: authored.size > 0 || !!save.temples?.[key]?.hadEnemies,
      reason: remaining.size ? `Defeat the park's remaining enemies (${remaining.size}) to awaken the temple.` : null };
  }
  function interact(ctx, o) {
    const { scene, save, sx, sy } = ctx;
    const state = status(save, o, { tileEdgeM: scene.tileEdgeM, scene });
    if (!state.active) {
      const body = state.reason || 'Seek the hidden spirit in this park to awaken the shrine.';
      if (scene.showMessageModal) scene.showMessageModal({ title: 'The sleeping temple', body, kind: 'story' });
      else scene.flash('The temple is still asleep.', sx, sy);
      return true;
    }
    const key = zoneKey(o);
    const record = (save.temples ||= {})[key] ||= { active: true, rewardClaimed: false };
    if (o.templeKind === 'grove' || o.templeAnchor?.kind === 'grove') {
      if (!coverage(o, root.WorldGen.tileCache, scene.tileEdgeM).complete) {
        scene.showMessageModal?.({ title: 'The upper temple', kind: 'story',
          body: 'Explore the whole park before entering its upper temple.' });
        return true;
      }
      const plan = root.TempleLayout.plan(o, root.WorldGen.tileCache, scene.tileEdgeM);
      if (!plan) {
        scene.showMessageModal?.({ title: 'The upper temple', kind: 'story',
          body: 'There is no clear space for a trial at this grove’s nexus. Explore the surrounding park to reveal any unseen ground.' });
        return true;
      }
      root.TempleScene.enter(scene, o, plan);
      return true;
    }
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
  function complete(scene, o) {
    const record = scene.save.temples?.[zoneKey(o)];
    if (!record?.active) return false;
    record.challengeComplete = true;
    if (record.rewardClaimed) { persistSave(scene.save); return false; }
    record.rewardClaimed = true;
    // Claim before the reward ceremony so repeated completion cannot pay twice.
    persistSave(scene.save);
    const p = scene.playerScreen();
    grantTreasureRoll(scene, scene.save, p.x, p.y, '✦', CONTEXT, {
      rollBonus: 1, ceremony: { art: STORY.art, header: 'The temple’s gift', kind: 'treasure' },
    });
    persistSave(scene.save);
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
  function hasPending(scene) { return pending.has(scene); }
  function observe(scene) {
    if (scene.depth > 0) {
      pending.delete(scene);
      observed.delete(scene);
      return;
    }
    if (scene._dialogOpen?.()) return;
    let pass = pending.get(scene);
    if (!pass) {
      const pc = scene.playerToWorldCell?.();
      const entries = [];
      for (const entry of root.WorldGen.tileCache.values()) {
        if (!entryIds.has(entry)) entryIds.set(entry, nextEntryId++);
        entries.push(`${entryIds.get(entry)}:${entry._spawned ? 1 : 0}`);
      }
      const stamp = `${pc?.tx},${pc?.ty},${Math.floor(pc?.cx)},${Math.floor(pc?.cy)}|${scene.save.caught?.length || 0}|${epoch}|${entries.join(',')}`;
      if (observed.get(scene) === stamp) return;
      observed.set(scene, stamp);
      pass = { candidates: [], next: 0 };
      const seen = new Set();
      for (const entry of root.WorldGen.tileCache.values()) for (const o of derivedObjects(entry, '_temples', o => o.kind === 'temple')) {
        const key = zoneKey(o);
        if (o.kind !== 'temple' || seen.has(key) || isActive(scene.save, o)) continue;
        if (pc && (Math.abs(Math.floor(o.x / scene.tileEdgeM) - pc.tx) > 1
            || Math.abs(Math.floor(o.y / scene.tileEdgeM) - pc.ty) > 1)) continue;
        seen.add(key);
        pass.candidates.push(o);
      }
      pending.set(scene, pass);
    }
    // Finish this pass even if walking changes its stamp. Restarting it at
    // each crossing would starve the later parks. Each candidate's census
    // and activation run together against the current save and tile cache.
    // One census per call keeps a whole ring of parks off a single frame.
    while (pass.next < pass.candidates.length) {
      const o = pass.candidates[pass.next++], key = zoneKey(o);
      if (pass.next === pass.candidates.length) pending.delete(scene);
      if (o.kind !== 'temple' || isActive(scene.save, o)) continue;
      const state = status(scene.save, o, { tileEdgeM: scene.tileEdgeM, scene });
      if (state.hadEnemies) {
        const record = (scene.save.temples ||= {})[key] ||= {};
        if (!record.hadEnemies) { record.hadEnemies = true; persistSave(scene.save); }
        // Hidden is not defeated: awaken only when this census SAW the
        // authored foes and found them all defeated (authored > 0). A stamp
        // from an earlier pass with nothing visible now waits, instead of
        // telling an enemies-defeated story nobody earned.
        if (state.ready && state.authored > 0 && activate(scene, o)) return; // one story at a time
      } else if (state.ready) root.HiddenObjects?.ensureSpirit(scene, o, state);
      return;
    }
    pending.delete(scene);
  }
  root.Temples = { CONTEXT, STORY, zoneKey, isActive, coverage, status, interact, complete, observe, hasPending, discoverSpirit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
