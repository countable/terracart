// Fit the wide preview independently of the normal phone-sized game shell.
(() => {
  function fit() {
    const scale = Math.max(0.1, Math.min((innerWidth - 16) / 672, (innerHeight - 90) / 608, 1.3));
    document.documentElement.style.setProperty('--ra-scale', scale);
    document.documentElement.style.setProperty('--ra-top', (56 + Math.max(0, innerHeight - 90 - 608 * scale) / 2) + 'px');
  }
  addEventListener('resize', fit);
  visualViewport?.addEventListener('resize', fit);
  fit();
})();
