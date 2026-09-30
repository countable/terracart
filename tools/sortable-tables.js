/* Shared, opt-in sorting for review tables. Refresh after replacing table rows. */
(() => {
  'use strict';
  const states = new WeakMap();
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const style = document.createElement('style');
  style.textContent = '.table-sort{all:unset;display:inline-flex;align-items:center;gap:.5em;cursor:pointer;font:inherit;color:inherit}.table-sort:focus-visible{outline:2px solid currentColor;outline-offset:4px;border-radius:2px}.table-sort-indicator{font-size:.8em;opacity:.7}';
  document.head.append(style);
  function value(cell, type) {
    const text = (cell?.dataset.sortValue ?? cell?.textContent ?? '').trim();
    if (!text || /^(?:—|–|-|·|Special|Separate hazard|Coin theft)$/.test(text)) return null;
    if (type !== 'text') {
      const match = text.replaceAll(',', '').match(/^(?:\$|T)?\s*([+-]?(?:\d+\.?\d*|\.\d+))(?:\b|%|×|$)/);
      if (match) return Number(match[1]);
    }
    return text;
  }
  function apply(table, state) {
    const headers = [...(table.tHead?.rows[0]?.cells || [])];
    headers.forEach((th, index) => {
      const button = th.querySelector('.table-sort');
      if (!button) return;
      const active = state.column === index;
      th.setAttribute('aria-sort', active ? state.direction : 'none');
      button.querySelector('.table-sort-indicator').textContent = active ? (state.direction === 'ascending' ? '▲' : '▼') : '↕';
    });
    if (state.column == null || !headers[state.column]) return;
    const type = headers[state.column].dataset.sortType;
    for (const body of table.tBodies) {
      const rows = [...body.rows];
      const sortable = rows.filter(row => !row.hasAttribute('data-sort-fixed') && row.cells.length === headers.length);
      const keys = new Map(sortable.map(row => [row, value(row.cells[state.column], type)]));
      sortable.sort((a, b) => {
        const av = keys.get(a), bv = keys.get(b);
        if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
        const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv));
        return state.direction === 'ascending' ? order : -order;
      });
      let index = 0;
      const eligible = new Set(sortable);
      body.append(...rows.map(row => eligible.has(row) ? sortable[index++] : row));
    }
  }
  function refresh(table) {
    if (!table?.tHead?.rows.length) return;
    const state = states.get(table) || { column: null, direction: 'ascending' };
    const signature = [...table.tHead.rows[0].cells].map(th => {
      const copy = th.cloneNode(true); copy.querySelector('.table-sort-indicator')?.remove();
      return copy.textContent.trim();
    }).join('\u0000');
    if (state.signature != null && state.signature !== signature) state.column = null;
    state.signature = signature;
    states.set(table, state);
    [...table.tHead.rows[0].cells].forEach((th, index) => {
      if (th.dataset.sort === 'none' || th.querySelector('.table-sort')) return;
      th.scope = 'col';
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'table-sort';
      button.append(...th.childNodes);
      const indicator = document.createElement('span');
      indicator.className = 'table-sort-indicator'; indicator.setAttribute('aria-hidden', 'true');
      button.append(indicator); th.append(button);
      button.addEventListener('click', () => {
        state.direction = state.column === index && state.direction === 'ascending' ? 'descending' : 'ascending';
        state.column = index; apply(table, state);
      });
    });
    apply(table, state);
  }
  function clear(table) {
    const state = states.get(table);
    if (state) { state.column = null; apply(table, state); }
  }
  window.SortableTables = { refresh, clear };
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('table[data-sortable]').forEach(refresh));
})();
