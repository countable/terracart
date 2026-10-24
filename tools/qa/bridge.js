/* Injected by the QA runner only. No resource grants, save edits or warps. */
(function installGameplayQA() {
  'use strict';
  if (window.GameplayQA) return;
  const ids = new WeakMap();
  let serial = 0, move = null, hookedScene = null, motion = null;
  const scene = () => window.__scene;
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    if (!el?.isConnected || !el.getClientRects().length) return false;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(el)) return false;
      const inherited = getComputedStyle(parent);
      if (inherited.display === 'none' || inherited.visibility === 'hidden' || Number(inherited.opacity) === 0) return false;
    }
    const style = getComputedStyle(el), box = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none'
      && Number(style.opacity) !== 0 && box.bottom > 0 && box.right > 0
      && box.top < innerHeight && box.left < innerWidth;
  };
  const unobstructed = el => {
    const box = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, box.left + box.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, box.top + box.height / 2));
    const hit = document.elementFromPoint(x, y);
    return hit === el || el.contains(hit);
  };
  function controls() {
    const modals = [...document.querySelectorAll('.game-modal')].filter(visible);
    const candidates = [...document.querySelectorAll('button, summary, [role="button"], input, select, a[href], #move-pad')];
    // Reward/safety cards visibly invite a tap on the card itself. Dispatch
    // its existing click handler; never remove a modal or call its callback.
    for (const modal of modals) {
      if (/tap to continue/i.test(modal.innerText) && !candidates.some(el => modal.contains(el) && visible(el))) candidates.push(modal);
    }
    return candidates
      .filter(el => !el.closest('#devtools, #teleport-section, [id^="debug-"], #reset-save, #new-save')
        && visible(el) && unobstructed(el) && (!modals.length || modals.some(m => m.contains(el))))
      .map(el => {
        if (!ids.has(el)) ids.set(el, `control:${++serial}`);
        return { el, id: ids.get(el), label: el.matches('.game-modal') ? 'Tap to continue' : clean(el.getAttribute('aria-label') || el.title || el.innerText || el.value || el.id),
          disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
          domId: el.id || undefined, slot: el.dataset.slot, gear: el.dataset.gear };
      });
  }
  function position(s) {
    const p = playerWorldM(s), c = worldMetersToAbsCell(s, p.x, p.y);
    return { x: p.x, y: p.y, ...c };
  }
  function inView(s, x, y) {
    const p = s.worldMetersToScreen(x, y);
    return p.x >= s.viewLeft && p.x <= s.viewLeft + s.viewSize
      && p.y >= s.viewTop && p.y <= s.viewTop + s.viewSize;
  }
  function seen(s, x, y) {
    if ((s.depth || 0) > 0 || typeof Fog === 'undefined') return true;
    const c = s.cellAt(x, y);
    return Fog.seen(c.tx, c.ty, c.ix, c.iy);
  }
  function targets(s) {
    const list = [], pc = position(s), spent = typeof spentSets === 'function' ? spentSets(s, s.save) : null;
    const add = (o, layer, key) => {
      if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || !inView(s, o.x, o.y) || !seen(s, o.x, o.y)) return;
      if (typeof HiddenObjects !== 'undefined' && HiddenObjects.isHidden(s.save, o)) return;
      if (layer !== 'creatures' && typeof RoadSafety !== 'undefined' && RoadSafety.objectHidden(s, o)) return;
      if (spent && typeof isSpent === 'function' && isSpent(o, spent)) return;
      if (layer === 'creatures' && ((s.save.caught || []).includes(o.id) || o.dead || o.hp <= 0)) return;
      if (layer === 'creatures' && ((typeof Combat !== 'undefined' && Combat.isConcealed(o))
        || (typeof EnemySpawns !== 'undefined' && !EnemySpawns.surfaceActive(s, o)))) return;
      const c = worldMetersToAbsCell(s, o.x, o.y), d = absCellDelta(s, pc.cellIX, pc.cellIY, c.cellIX, c.cellIY);
      const role = o.kind === 'house' && typeof Houses !== 'undefined' ? Houses.displayRole(s.save, o) : undefined;
      const houseName = role === 'trailer' ? 'Home' : role === 'wreck' ? 'Wreck' : undefined;
      const crop = o.crop;
      list.push({ id: `${layer}:${o.id || key}`, kind: o.kind || o.item || crop || layer,
        name: houseName || o.name || (crop && typeof cropName === 'function' ? cropName(crop) : undefined),
        role, crop,
        dx: d.dx, dy: d.dy, cellIX: c.cellIX, cellIY: c.cellIY, x: o.x, y: o.y,
        stage: o.stage, hp: layer === 'creatures' ? o.hp : undefined });
    };
    for (const entry of WorldGen.tileCache.values()) {
      for (const layer of ['objects', 'wildplants', 'creatures']) {
        for (const [i, o] of (entry[layer] || []).entries()) add(o, layer, `${o.x},${o.y}:${i}`);
      }
    }
    for (const layer of ['planted', 'fires', 'scarecrows']) {
      for (const [i, o] of (s.save[layer] || []).entries()) {
        if ((o.depth || 0) === (s.depth || 0)) add(o, layer, `${o.x},${o.y}:${i}`);
      }
    }
    return list.sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
  }
  function cells(s) {
    const result = [], pc = position(s);
    const names = Object.fromEntries(Object.entries(WorldGen.T || {}).map(([k, v]) => [v, k.toLowerCase()]));
    // The square viewport is eleven cells wide; a generous bound also covers
    // its partial edge cells and alternate zoom settings, then screen-culls.
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const abs = absCellOffset(s, pc.cellIX, pc.cellIY, dx, dy), p = absCellCenterMeters(s, abs.cellIX, abs.cellIY);
      if (!inView(s, p.x, p.y)) continue;
      const known = seen(s, p.x, p.y), c = s.cellAt(p.x, p.y);
      result.push({ id: `cell:${abs.cellIX},${abs.cellIY}`, dx, dy,
        terrain: known ? names[c.type] || `terrain_${c.type}` : 'unexplored',
        road: known ? c.underRoad : undefined,
        tilled: known ? !!s.tilledSet?.has(cellKeyFromAbsCell(abs.cellIX, abs.cellIY)) : undefined,
        x: p.x, y: p.y });
    }
    return result;
  }
  function stopMove(reason = 'released') {
    const s = scene();
    if (s) { s.joystickVec = { x: 0, y: 0 }; s._movePadHeld = false; }
    if (move) { move.active = false; move.reason = reason; }
    return movement();
  }
  function movement() {
    const s = scene();
    return { ...(move || { active: false }), position: s?.playerM ? position(s) : null,
      driftingHome: !!s?._driftingHome, gpsAwayMeters: s?._gpsAwayM?.(),
      lastStickAt: s?._lastStickT, workInProgress: !!s?._workProgress };
  }
  function tick() {
    if (!move?.active) return;
    const s = scene(), p = position(s);
    if (s._dialogOpen()) return stopMove('dialog');
    if (p.cellIX === move.destination.cellIX && p.cellIY === move.destination.cellIY) return stopMove('arrived');
    // Collision sliding can enter a different adjacent cell. Release there
    // instead of holding the stick while chasing an unreachable exact cell.
    if (p.cellIX !== move.origin.cellIX || p.cellIY !== move.origin.cellIY) return stopMove('cell-crossed');
    const epsilon = Math.max(.01, (s.cellM || 1) * .01);
    if ((p.x - motion.x) ** 2 + (p.y - motion.y) ** 2 >= epsilon ** 2)
      motion = { x: p.x, y: p.y, at: Date.now() };
    if (Date.now() - motion.at >= 2000) return stopMove('blocked');
    if (Date.now() - move.startedAt > 30000) return stopMove('timeout');
    if (s.save.energy <= 0) return stopMove('exhausted');
  }
  function beginMove(direction) {
    const s = scene(), dirs = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
    if (!s?.playerM) return { ok: false, error: 'Game is not ready.' };
    if (!dirs[direction]) return { ok: false, error: 'Use north, east, south, or west.' };
    if (s._dialogOpen()) return { ok: false, error: 'Dismiss the displayed menu first.' };
    if (typeof CompassModules !== 'undefined' && !CompassModules.isActive(s.save, 'joystick'))
      return { ok: false, error: 'Activate the joystick through its displayed control before moving.' };
    if (move?.active) return { ok: false, error: 'A move is already active.' };
    if (hookedScene !== s) { s.events.on('postupdate', tick); hookedScene = s; }
    const p = position(s), [dx, dy] = dirs[direction];
    motion = { x: p.x, y: p.y, at: Date.now() };
    move = { active: true, direction, startedAt: Date.now(),
      origin: { cellIX: p.cellIX, cellIY: p.cellIY },
      destination: absCellOffset(s, p.cellIX, p.cellIY, dx, dy) };
    // Same inputs as the on-screen stick. Normal update owns movement speed,
    // collisions, energy, condition effects and the return-to-GPS timer.
    s.joystickVec = { x: dx, y: dy }; s._movePadHeld = true;
    return { ok: true, ...movement() };
  }
  function observe() {
    const s = scene(), cs = controls().map(({ el, ...c }) => c);
    const menus = [...document.querySelectorAll('.game-modal')].filter(el => visible(el) && unobstructed(el))
      .map(el => ({ kind: el.dataset.kind || el.id, text: clean(el.innerText) }));
    const result = { ready: !!s?.save, controls: cs, menus,
      text: clean(menus.length ? menus.map(m => m.text).join('\n') : document.body.innerText).slice(0, 20000) };
    if (!s?.save || !s.playerM) return result;
    const feedback = [];
    const readText = children => {
      for (const child of children || []) {
        if (child.visible === false || child.alpha === 0) continue;
        if (typeof child.text === 'string' && clean(child.text)) feedback.push(clean(child.text));
        if (Array.isArray(child.list)) readText(child.list);
      }
    };
    readText(s.children?.list);
    const map = cells(s), objects = targets(s);
    const rows = [...new Set(map.map(c => c.dy))].sort((a, b) => a - b);
    const glyph = c => c.dx === 0 && c.dy === 0 ? '@' : c.terrain === 'unexplored' ? '?'
      : objects.some(o => o.dx === c.dx && o.dy === c.dy) ? '*'
      : c.road ? '=' : c.terrain.includes('water') ? '~' : c.terrain.includes('building') ? '#' : '.';
    return { ...result, position: position(s), depth: s.depth || 0,
      hud: { money: s.save.money, energy: s.save.energy, maxEnergy: s.save.maxEnergy,
        objective: visible(document.querySelector('#objective')) ? clean(document.querySelector('#objective').innerText) : '',
        status: visible(document.querySelector('#status-row')) ? clean(document.querySelector('#status-row').innerText) : '' },
      inventory: (s.save.inv || []).map((e, slot) => e && ({ slot, id: e.id, count: e.count,
        name: typeof ITEM_BY_ID !== 'undefined' ? ITEM_BY_ID[e.id]?.name : e.id, selected: slot === s.save.selSlot })),
      mapText: rows.map(dy => map.filter(c => c.dy === dy).sort((a, b) => a.dx - b.dx).map(glyph).join('')).join('\n'),
      legend: '@ player; * visible target; ? unexplored; = road; ~ water; # building; . terrain',
      cells: map.map(({ x, y, ...c }) => c), targets: objects, feedback: [...new Set(feedback)].slice(-50),
      movement: movement(), work: s._workProgress ? { remainingMs: Math.max(0,
        s._workProgress.durationMs - (performance.now() - s._workProgress.startT)), tool: s._workProgress.toolSlot } : null };
  }
  function interact(id) {
    const s = scene();
    if (!s?.save) return { ok: false, error: 'Game is not ready.' };
    if (s._dialogOpen()) return { ok: false, error: 'Dismiss the displayed menu first.' };
    const target = [...targets(s), ...cells(s).filter(c => c.terrain !== 'unexplored')].find(t => t.id === id);
    if (!target) return { ok: false, error: 'Target is stale, hidden or outside the viewport.' };
    stopMove('interaction');
    const screen = s.worldMetersToScreen(target.x, target.y);
    s.handleWorldTap(screen.x, screen.y);
    return { ok: true, target: id, observation: observe() };
  }
  function activate(id) {
    const c = controls().find(c => c.id === id);
    if (!c || c.disabled) return { ok: false, error: 'Control is unavailable or disabled.' };
    if (c.el.id === 'move-pad') {
      if (typeof CompassModules !== 'undefined' && CompassModules.isActive(scene()?.save, 'joystick'))
        return { ok: false, error: 'The joystick is already active. Use a movement command.' };
      const box = c.el.getBoundingClientRect();
      const pointer = { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
        clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
      c.el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
      c.el.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
    } else c.el.click();
    return { ok: true, control: c.label, observation: observe() };
  }
  // Reviewer-only checkpoint; never feed hidden save flags to the player.
  function checkpoint() {
    const s = scene();
    return { at: Date.now(), position: s?.playerM ? position(s) : null,
      save: s?.save ? JSON.parse(JSON.stringify(s.save)) : null };
  }
  window.GameplayQA = { observe, beginMove, movement, stopMove, interact, activate, checkpoint, tick };
})();
