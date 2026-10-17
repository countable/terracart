// Optional image-ground trial. Source pixels are read only at startup; the
// renderer keeps its existing palette, blend masks and cached biome keys.
const GroundAtlas = (() => {
  const KEY = 'ground_atlas_trial', ART_SIZE = 24;
  const canvases = new Map();
  const preserved = new Set([9, 11, 12, 25, 30]);
  const animated = new Set([3, 23, 26]);
  const enabled = () => typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('groundAtlas') === 'true';

  function residual(pixels, size) {
    const mean = [0, 0, 0], out = new Float32Array(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      for (let c = 0; c < 3; c++) mean[c] += pixels[i * 4 + c] / (size * size);
    }
    for (let i = 0; i < size * size; i++) {
      for (let c = 0; c < 3; c++) out[i * 3 + c] = (pixels[i * 4 + c] - mean[c]) * .7;
    }
    return out;
  }

  // Equal opposite boundaries, shared by every decoration variant. The
  // interior retains the source motifs; corrections taper over four art pixels.
  function periodic(base, size) {
    const out = base.slice(), band = 4;
    for (let y = 0; y < size; y++) for (let c = 0; c < 3; c++) {
      const left = base[(y * size) * 3 + c], right = base[(y * size + size - 1) * 3 + c];
      for (let x = 0; x < band; x++) {
        const weight = 1 - x / band;
        out[(y * size + x) * 3 + c] += (right - left) * .5 * weight;
        out[(y * size + size - 1 - x) * 3 + c] += (left - right) * .5 * weight;
      }
    }
    const horizontal = out.slice();
    for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) {
      const top = horizontal[x * 3 + c], bottom = horizontal[((size - 1) * size + x) * 3 + c];
      for (let y = 0; y < band; y++) {
        const weight = 1 - y / band;
        out[(y * size + x) * 3 + c] += (bottom - top) * .5 * weight;
        out[((size - 1 - y) * size + x) * 3 + c] += (top - bottom) * .5 * weight;
      }
    }
    return out;
  }

  function overlay(base, detail, size, color) {
    const rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    const out = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, weight = Math.min(1, Math.min(x, y, size - 1 - x, size - 1 - y) / 4);
      const delta = rgb.map((_, c) => Math.max(-35, Math.min(35,
        base[i * 3 + c] * (1 - weight) + detail[i * 3 + c] * weight)));
      let alpha = 0;
      for (let c = 0; c < 3; c++) alpha = Math.max(alpha,
        Math.abs(delta[c]) / Math.max(1, delta[c] < 0 ? rgb[c] : 255 - rgb[c]));
      // Quantise alpha first so compositing stays accurate at low contrast.
      alpha = Math.ceil(alpha * 255) / 255;
      for (let c = 0; c < 3; c++) out[i * 4 + c] = alpha ? rgb[c] + delta[c] / alpha : 0;
      out[i * 4 + 3] = alpha * 255;
    }
    return out;
  }

  function prepare(scene, colors) {
    canvases.clear();
    if (!enabled() || !scene.textures.exists(KEY)) return;
    const image = scene.textures.get(KEY).getSourceImage();
    const scratch = document.createElement('canvas');
    scratch.width = scratch.height = ART_SIZE;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    for (let type = 0; type < 32; type++) {
      if (preserved.has(type)) continue;
      // Pier water shares water art and animation; its planks remain a separate layer.
      const sourceType = type === 23 ? 3 : type;
      const details = [];
      for (let v = 0; v < 2; v++) {
        const frame = sourceType * 2 + v, col = frame % 8, row = Math.floor(frame / 8);
        const x = Math.round(col * image.width / 8), y = Math.round(row * image.height / 8);
        const w = Math.round((col + 1) * image.width / 8) - x;
        const h = Math.round((row + 1) * image.height / 8) - y;
        ctx.clearRect(0, 0, ART_SIZE, ART_SIZE);
        ctx.drawImage(image, x, y, w, h, 0, 0, ART_SIZE, ART_SIZE);
        details.push(residual(ctx.getImageData(0, 0, ART_SIZE, ART_SIZE).data, ART_SIZE));
      }
      const boundary = periodic(details[0], ART_SIZE);
      for (let v = 0; v < 2; v++) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ART_SIZE;
        const target = canvas.getContext('2d'), pixels = target.createImageData(ART_SIZE, ART_SIZE);
        pixels.data.set(overlay(boundary, details[v], ART_SIZE, colors[type]));
        target.putImageData(pixels, 0, 0);
        canvases.set(`${type}_${v}`, canvas);
      }
    }
  }

  function draw(ctx, size, type, variant) {
    const canvas = canvases.get(`${type}_${variant % 2}`);
    if (!canvas) return false;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, size, size);
    ctx.restore();
    return true;
  }
  return { KEY, enabled, prepare, draw, animated, residual, periodic, overlay };
})();
