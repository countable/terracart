/* Evidence-backed usage labels for review dashboards; never affects game assets. */
const ArtUsageStatus = (() => {
  let rows = new Map();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = { unused: 'Not used in game', planned: 'Not used · planned', uncertain: 'Usage unconfirmed' };
  async function load() {
    const response = await fetch('art-usage-audit.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load art usage audit');
    const data = await response.json();
    rows = new Map(data.rows.map(row => [row.catalogue + ':' + row.id, row]));
  }
  function badge(catalogue, id) {
    const row = rows.get(catalogue + ':' + id);
    if (!row || !labels[row.status]) return '';
    const evidence = (row.evidence || []).map(e => `${e.file}:${e.line} — ${e.detail}`).join('\n');
    return `<details class="art-usage-status" data-usage="${row.status}"><summary>${labels[row.status]}</summary><p>${escape(row.reason)}</p><small>${escape(evidence).replaceAll('\n', '<br>')}</small></details>`;
  }
  function search(catalogue, id) {
    const row = rows.get(catalogue + ':' + id);
    return row ? `${row.status === 'planned' ? 'unused ' : ''}${row.status} ${labels[row.status] || ''} ${row.reason}` : '';
  }
  return { load, badge, search };
})();
