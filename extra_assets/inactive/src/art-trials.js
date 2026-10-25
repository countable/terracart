// Review-only artwork. No URL opt-in means no extra textures or changed art.
// Tree growth, species, harvesting and saves continue to use the original data.
const ArtTrials = (() => {
  const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const mode = query.get('artTrial');
  const trees = mode === 'trees-water' || mode === 'trees';
  const water = mode === 'trees-water' || mode === 'water';
  const broadleaf = ['ALT-0038', 'ALT-0176', 'ALT-0245'];
  const chosen = broadleaf.includes(query.get('artTree')) ? query.get('artTree') : null;
  // Exact exported crop dimensions and alpha bounds; see build_art_trials.py.
  const crops = {
    'ALT-0168': [32, 32, 2, 0, 30, 32],
    'ALT-0038': [32, 48, 5, 8, 27, 48],
    'ALT-0176': [48, 48, 9, 2, 40, 46],
    'ALT-0245': [32, 48, 2, 0, 30, 48],
    'ALT-0131': [16, 16, 0, 0, 16, 16],
  };
  const keyFor = id => 'art_trial_' + id.toLowerCase().replace('-', '_');
  function tree(object) {
    // Selected sheets contain full trees, not growth stages. Keep young art.
    if (!trees || treeArtFrame(object) !== 3) return null;
    let id = 'ALT-0168';
    if (object.species !== 'pine') {
      const identity = String(object.id ?? `${object.lat ?? object._ix},${object.lon ?? object._iy}`);
      let hash = 2166136261;
      for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
      id = chosen || broadleaf[(hash >>> 0) % broadleaf.length];
    }
    return { key: keyFor(id), frame: 0, alternativeId: id };
  }
  function install(assets, bounds) {
    const ids = [...(trees ? ['ALT-0168', ...broadleaf] : []), ...(water ? ['ALT-0131'] : [])];
    for (const id of ids) {
      const [fw, fh, minX, minY, maxX, maxY] = crops[id];
      const key = keyFor(id);
      assets[key] = { kind: 'spritesheet', path: `assets/ArtTrials/${id}.png`, frameWidth: fw, frameHeight: fh };
      if (bounds) bounds[`${key}:0`] = { fw, fh, minX, minY, maxX, maxY };
    }
  }
  return { trees, water, tree, install, waterKey: keyFor('ALT-0131') };
})();
if (typeof ASSETS !== 'undefined') {
  ArtTrials.install(ASSETS, typeof SpriteLayout !== 'undefined' ? SpriteLayout.ART_BOUNDS : null);
}
if (typeof window !== 'undefined') window.ArtTrials = ArtTrials;
