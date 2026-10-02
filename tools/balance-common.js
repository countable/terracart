/* Shared formatting and sortable tables for balance dashboards. */
const $ = (id) => document.getElementById(id);
const fmt$ = (v) => '$' + (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1));
const pct = (v) => (v * 100).toFixed(1) + '%';
const table = (el, head, body) => { el.innerHTML = `<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody>`; SortableTables.refresh(el); };
const barCell = (share) => `<td><span class="bar" style="width:${Math.round(share * 120)}px"></span>${pct(share)}</td>`;

function describe(r) {
  if (!r) return { cls: '(nothing)', key: '(nothing)', value: 0, tier: 0, text: '—' };
  if (r.kind === 'gold') {
    const cls = r.cls === 'cash' ? 'cash' : (r.slot ? 'gear → coins' : 'cash');
    return { cls, key: cls === 'cash' ? 'coins' : `coins (${r.slot} T${r.tier} owned)`,
      value: (r.amount || 0) + (r.consolation || 0), tier: r.tier || 0, text: `$${r.amount}${r.slot ? ` (for ${r.slot} T${r.tier}, owned)` : ''}${r.consolation ? ` + $${r.consolation}` : ''}` };
  }
  if (r.slot && r.tier && (r.kind === 'relic' || r.kind === 'armor' || !r.kind)) {
    // Display name only: the gear the game internally calls a relic reads as
    // EQUIPMENT here, so it never collides with the unique-relic finds
    // (telescope, amulets, rings) the same tables now show.
    const kind = r.kind === 'armor' ? 'armor' : 'equipment';
    const v = (typeof gearPrice === 'function') ? gearPrice(kind, r.slot, r.tier) : 0;
    return { cls: kind, key: `${kind}: ${r.slot} T${r.tier}`, value: (v || 0) + (r.consolation || 0), tier: r.tier,
      text: `${r.slot} T${r.tier}${r.consolation ? ` + $${r.consolation}` : ''}` };
  }
  const id = r.id, qty = r.qty || 1;
  const item = ITEM_BY_ID[id];
  const unit = (typeof itemValue === 'function') ? itemValue(id) : (PRICES[id] ?? 1);
  return { cls: r.cls === 'bundle' ? 'Building materials' : (r.cls || item?.kind || '?'), key: item?.name || id, id, value: unit * qty + (r.consolation || 0),
    tier: r.tier || item?.baseTier || 0, qty, text: `${qty}× ${item?.name || id}${r.consolation ? ` + $${r.consolation}` : ''}` };
}

