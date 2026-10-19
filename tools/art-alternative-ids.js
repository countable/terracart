/* Stable references to original source coordinates, independent of row order. */
const ArtAlternativeIds = (() => {
  let registry;
  const key = entry => {
    const cell = entry.cell || 16, inset = entry.inset || 0;
    const crop = entry.crop || [entry.col * cell + inset, entry.row * cell + inset, 16, 16];
    return JSON.stringify([entry.source, ...crop]);
  };
  async function load() {
    const response = await fetch('art-alternative-ids.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load alternative IDs');
    const data = await response.json();
    registry = new Map(data.entries.map(entry => [key(entry), entry.id]));
  }
  function get(entry) {
    const id = registry.get(key(entry));
    if (!id) throw new Error('Unregistered alternative: ' + key(entry));
    return id;
  }
  return { load, get };
})();
