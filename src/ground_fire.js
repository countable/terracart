// Permanent cell history and chronological fire simulation. Scene callbacks
// supply loaded terrain and remove fuel; this module owns no world objects.
const GroundFire = (() => {
  const MIN_DURATION_MS = 10000;
  const MAX_DURATION_MS = 30000;
  const SPREAD_INTERVAL_MS = 1000;

  function survives(object) {
    return object?.kind === 'tree' || object?.kind === 'fruittree';
  }
  function flammable(object) {
    return !!object && (survives(object) || ['tar', 'bush', 'shrub'].includes(object.kind) ||
      (object.kind === 'wildplant' && ['longgrass', 'shrub', 'bush'].includes(object.crop)));
  }
  function key(depth, cellIX, cellIY) { return `${depth}:${cellIX}_${cellIY}`; }
  function active(record, now) {
    return !!record && !record.extinguished && record.litAt <= now && now < record.until;
  }
  function ignite(save, depth, cellIX, cellIY, now, rng = Math.random) {
    const ledger = save.groundFire || (save.groundFire = {});
    const id = key(depth, cellIX, cellIY);
    if (Object.prototype.hasOwnProperty.call(ledger, id)) return false;
    const duration = MIN_DURATION_MS + Math.floor(
      Math.max(0, Math.min(1, rng())) * (MAX_DURATION_MS - MIN_DURATION_MS));
    ledger[id] = { depth, cellIX, cellIY, litAt: now,
      until: now + duration, spreadAt: now + SPREAD_INTERVAL_MS };
    return true;
  }

  function step(save, now, opts = {}, rng = Math.random) {
    const result = { ignited: [], extinguished: [] };
    const ledger = save.groundFire;
    if (!ledger) return result;
    // A min heap avoids repeatedly scanning every historical burned cell for
    // each second of a returning player's elapsed time. Passing records lets
    // the scene use its active index instead of scanning the permanent ledger.
    const heap = [];
    const before = (a, b) => a.at < b.at || (a.at === b.at &&
      (a.expire > b.expire || (a.expire === b.expire && a.id < b.id)));
    function enqueue(record) {
      if (record.extinguished) return;
      const expire = record.until <= record.spreadAt;
      const event = { record, expire, at: expire ? record.until : record.spreadAt,
        id: key(record.depth, record.cellIX, record.cellIY) };
      if (event.at > now) return;
      let i = heap.length;
      heap.push(event);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!before(event, heap[parent])) break;
        heap[i] = heap[parent]; i = parent;
      }
      heap[i] = event;
    }
    function pop() {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
          if (!before(heap[child], last)) break;
          heap[i] = heap[child]; i = child;
        }
        heap[i] = last;
      }
      return first;
    }
    for (const record of opts.records || Object.values(ledger)) enqueue(record);
    while (heap.length) {
      const event = pop(), record = event.record;
      if (event.expire) {
        record.extinguished = true;
        result.extinguished.push(record);
        if (opts.onExtinguish) opts.onExtinguish(record);
        continue;
      }
      record.spreadAt = event.at + SPREAD_INTERVAL_MS;
      const neighbors = opts.neighbors ? opts.neighbors(record) : [];
      for (const cell of neighbors) {
        const id = key(cell.depth, cell.cellIX, cell.cellIY);
        if (Object.prototype.hasOwnProperty.call(ledger, id)) continue;
        if (!opts.flammable || !opts.flammable(cell)) continue;
        ignite(save, cell.depth, cell.cellIX, cell.cellIY, event.at, rng);
        const added = ledger[id];
        result.ignited.push(added);
        if (opts.onIgnite) opts.onIgnite(added);
        enqueue(added);
      }
      enqueue(record);
    }
    return result;
  }
  return { MIN_DURATION_MS, MAX_DURATION_MS, SPREAD_INTERVAL_MS,
    flammable, survives, key, active, ignite, step };
})();
