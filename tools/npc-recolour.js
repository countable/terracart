/* global ArtPreviewColour */
'use strict';
// Draft recolour for proposed NPC art: bring brighter packs into the shipping
// citizen sheets' palette. Preview only; no asset is written.
//
// 1. Measure the citizen sheets in OKLab: their colours, median chroma,
//    lightness band and outline ink.
// 2. Per sprite, scale chroma so its median matches the citizens', with a
//    soft ceiling at their maximum; move its lightness median onto theirs
//    and narrow the spread. Silhouette edges and near-black pixels take the
//    citizens' warm outline ink, as every citizen sheet is inked that way.
// 3. Pull hues toward the nearest citizen colour with ArtPreviewColour's
//    luminance-preserving transfer, the map-art treatment.
globalThis.NpcRecolour = (() => {
  // Tuning. HUE_PULL is ArtPreviewColour strength; the rest are OKLab.
  const HUE_PULL = 0.25;
  const OUTLINE_L = 0.3;        // below this a pixel is outline ink
  const LIGHT_SQUEEZE = 0.85;   // lightness spread kept, centred on the citizens' median
  const CHROMA_SOFT = 0.8;      // fraction of the citizens' max chroma before the soft knee

  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const gam = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  function toLab(r, g, b) {
    r = lin(r); g = lin(g); b = lin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function toRgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960771 * l - 0.7034186147 * m + 1.7076147010 * s]
      .map(v => Math.max(0, Math.min(255, Math.round(gam(Math.max(0, Math.min(1, v)))))));
  }
  const median = list => { const s = [...list].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

  // Reference from the citizen images (HTMLImageElements).
  function reference(images) {
    const counts = new Map();
    for (const im of images) {
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
    }
    const colours = [...counts.keys()].map(k => [k >> 16 & 255, k >> 8 & 255, k & 255]);
    const labs = colours.map(c => toLab(...c));
    const chromas = labs.map(([, a, b]) => Math.hypot(a, b)), lights = labs.map(([L]) => L);
    const ink = labs.reduce((best, lab) => (lab[0] < best[0] ? lab : best));
    return {
      hexes: colours.map(c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')),
      chromaMedian: median(chromas), chromaMax: Math.max(...chromas),
      lightMedian: median(lights), lightMin: Math.min(...lights), lightMax: Math.max(...lights), ink,
    };
  }

  // Recolour a canvas in place toward `ref`.
  function apply(canvas, ref) {
    const ctx = canvas.getContext('2d'), img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    const labs = [];
    for (let i = 0; i < d.length; i += 4) labs.push(d[i + 3] ? toLab(d[i], d[i + 1], d[i + 2]) : null);
    const w = canvas.width, h = canvas.height;
    const edge = p => { const x = p % w, y = (p / w) | 0; return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X < 0 || Y < 0 || X >= w || Y >= h || !labs[Y * w + X]; }); };
    const body = labs.filter(l => l && l[0] >= OUTLINE_L);
    const chromaOf = body.map(([, a, b]) => Math.hypot(a, b));
    const lightMedian = median(body.map(([L]) => L));
    const scale = Math.min(1, ref.chromaMedian / Math.max(1e-4, median(chromaOf)));
    const knee = ref.chromaMax * CHROMA_SOFT, ceiling = ref.chromaMax;
    labs.forEach((lab, p) => {
      if (!lab) return;
      let [L, a, b] = lab;
      if (L < OUTLINE_L || (edge(p) && L < lightMedian)) {
        // Outline ink: keep its depth, take the citizens' warm hue.
        const [iL, ia, ib] = ref.ink;
        [L, a, b] = [Math.max(L, iL), ia, ib];
      } else {
        let C = Math.hypot(a, b) * scale;
        if (C > knee) C = knee + (ceiling - knee) * Math.tanh((C - knee) / (ceiling - knee));
        const h = Math.atan2(b, a);
        a = C * Math.cos(h); b = C * Math.sin(h);
        L = ref.lightMedian + (L - lightMedian) * LIGHT_SQUEEZE;
        L = Math.max(ref.lightMin, Math.min(ref.lightMax, L));
      }
      const rgb = toRgb(L, a, b);
      d[p * 4] = rgb[0]; d[p * 4 + 1] = rgb[1]; d[p * 4 + 2] = rgb[2];
    });
    ctx.putImageData(img, 0, 0);
    ArtPreviewColour.recolour(canvas, ref.hexes, { strength: HUE_PULL });
    return canvas;
  }
  return { reference, apply, toLab, HUE_PULL, OUTLINE_L, LIGHT_SQUEEZE, CHROMA_SOFT };
})();
