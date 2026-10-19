// Dashboard-only framing. Keep every visible source pixel; game assets and
// original-size source links retain their authored padding and coordinates.
(function (root) {
  const cache = new Map();
  function trim(source) {
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (right < 0 || (left === 0 && top === 0 && right === width - 1 && bottom === height - 1)) return canvas;
    const fitted = document.createElement('canvas');
    fitted.width = right - left + 1; fitted.height = bottom - top + 1;
    fitted.getContext('2d').drawImage(canvas, left, top, fitted.width, fitted.height,
      0, 0, fitted.width, fitted.height);
    return fitted;
  }
  function load(url) {
    if (!cache.has(url)) cache.set(url, (async () => {
      const image = new Image(); image.src = url; await image.decode();
      return trim(image).toDataURL();
    })());
    return cache.get(url);
  }
  root.ArtPreviewFit = { trim, load };
})(window);
