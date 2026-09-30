// Shared exact colour mapper for review canvases and the approved runtime export.
// Material masks keep leaf/cap colours separate from wood and pale stems.
(function () {
  'use strict';
  document.getElementById('preview-ground').addEventListener('change', event => {
    document.documentElement.style.setProperty('--preview-ground', event.target.value);
  });
  const data = JSON.parse(document.getElementById('recolour-data').textContent);
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const palette = Object.fromEntries(data.palette.map(p => [p.id, rgb(p.hex)]));
  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const family = (colour, kind, autumn) => {
    const [r, g, b] = colour, hi = Math.max(...colour), lo = Math.min(...colour);
    if (luminance(colour) < 42) return 'outline';
    if (kind === 'tree' || kind === 'bush') {
      if (autumn) return hi - lo > 30 && r > g * 1.15 ? 'body' : 'detail';
      return g > r * 1.08 && g > b * 0.8 ? 'body' : 'detail';
    }
    if (kind === 'mushroom') {
      const saturation = hi ? (hi - lo) / hi : 0;
      return hi > 100 && (saturation < 0.18 || (r > g && g >= b && saturation < 0.58)) ? 'detail' : 'body';
    }
    return 'body';
  };
  function ramps(combo) {
    const ids = combo.colours.filter(id => id !== 'ink');
    let detail = [], body = ids;
    const kind = combo.previewMaterial;
    if (kind === 'tree' || kind === 'bush') {
      detail = ids.filter(id => ['bark', 'earth', 'stone_light', 'cream'].includes(id));
      body = ids.filter(id => !detail.includes(id));
      if (combo.id === 'restored-hedge') { body = ids; detail = []; }
    } else if (kind === 'mushroom') {
      detail = ids.filter(id => ['cream', 'sacred_ivory'].includes(id));
      body = ids.filter(id => !detail.includes(id));
    }
    const sorted = keys => keys.map(key => palette[key]).sort((a, b) => luminance(a) - luminance(b));
    return { body: sorted(body.length ? body : ids), detail: sorted(detail.length ? detail : body) };
  }
  function recolour(source, combo) {
    const output = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    const sourceColours = { body: new Map(), detail: new Map() };
    const roles = [];
    for (let i = 0; i < source.data.length; i += 4) {
      if (!source.data[i + 3]) { roles.push(null); continue; }
      const colour = Array.from(source.data.slice(i, i + 3));
      const role = family(colour, combo.previewMaterial, combo.id === 'autumn-tree' || combo.id === 'autumn-bush');
      const key = colour.join(',');
      roles.push({ role, key });
      if (role !== 'outline') sourceColours[role].set(key, colour);
    }
    const target = ramps(combo), mapping = {};
    for (const role of ['body', 'detail']) {
      const ordered = [...sourceColours[role]].sort((a, b) => luminance(a[1]) - luminance(b[1]));
      ordered.forEach(([key], index) => {
        const fraction = ordered.length === 1 ? 0.5 : index / (ordered.length - 1);
        mapping[role + ':' + key] = target[role][Math.round(fraction * (target[role].length - 1))];
      });
    }
    roles.forEach((entry, pixel) => {
      if (!entry) return;
      const colour = entry.role === 'outline' ? palette.ink : mapping[entry.role + ':' + entry.key];
      output.data.set(colour, pixel * 4);
    });
    // Keep alpha and dimensions byte-identical; only RGB may change.
    for (let i = 3; i < output.data.length; i += 4) {
      if (output.data[i] !== source.data[i]) throw new Error('Preview changed transparency');
    }
    return output;
  }
  const combos = Object.fromEntries(data.combos.map(c => [c.id, c]));
  const tasks = [...document.querySelectorAll('canvas[data-recolour]')].map(async canvas => {
    const image = new Image();
    image.src = canvas.dataset.source;
    await image.decode();
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const output = recolour(source, combos[canvas.dataset.recolour]);
    ctx.putImageData(output, 0, 0);
    const allowed = new Set(combos[canvas.dataset.recolour].colours.map(id => palette[id].join(',')));
    let changed = 0;
    for (let i = 0; i < output.data.length; i += 4) {
      if (!output.data[i + 3]) continue;
      if (!allowed.has(Array.from(output.data.slice(i, i + 3)).join(','))) throw new Error('Off-palette preview colour');
      if (output.data.slice(i, i + 3).some((v, k) => v !== source.data[i + k])) changed++;
    }
    canvas.dataset.changedPixels = changed;
    canvas.dataset.alphaPreserved = 'true';
    canvas.dataset.ready = 'true';
  });
  Promise.all(tasks).then(() => { document.documentElement.dataset.recoloursReady = 'true'; })
    .catch(error => {
      document.documentElement.dataset.recolourError = error.message;
      document.querySelector('#recolour-status').textContent = 'Recolour preview failed: ' + error.message;
      console.error(error);
    });
})();
