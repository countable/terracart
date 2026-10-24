// The generator samples the full area once. Changing the review dimensions
// crops around its POI without stretching cells or changing their placement.
(() => {
  const widthInput = document.getElementById('zone-width');
  const heightInput = document.getElementById('zone-height');
  if (!widthInput || !heightInput) return;

  const previews = [...document.querySelectorAll('svg[data-zone-preview]')];
  const status = document.getElementById('zone-size-status');
  const reset = document.getElementById('zone-size-reset');
  const defaults = {
    width: Number(widthInput.defaultValue) || 29,
    height: Number(heightInput.defaultValue) || 29,
  };
  let current = { ...defaults };

  function dimension(value, input, fallback) {
    const number = value == null || String(value).trim() === '' ? NaN : Number(value);
    return Number.isFinite(number)
      ? Math.max(Number(input.min) || 3, Math.min(Number(input.max) || 49, Math.round(number)))
      : fallback;
  }

  function show(width, height, saveUrl) {
    current = { width, height };
    widthInput.value = String(width);
    heightInput.value = String(height);
    for (const svg of previews) {
      const unit = Number(svg.dataset.unit) || 10;
      const maximum = Number(svg.dataset.maxCells) || 49;
      const columns = Math.min(width, maximum), rows = Math.min(height, maximum);
      const centreX = Number(svg.dataset.centreX), centreY = Number(svg.dataset.centreY);
      svg.setAttribute('viewBox', `${centreX - columns * unit / 2} ${centreY - rows * unit / 2} ${columns * unit} ${rows * unit}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      // Match the viewport to its viewBox so rectangular samples keep square cells.
      svg.style.aspectRatio = `${columns} / ${rows}`;
      if (!svg.dataset.zoneBaseLabel) svg.dataset.zoneBaseLabel = svg.getAttribute('aria-label') || 'Zone preview';
      svg.setAttribute('aria-label', `${svg.dataset.zoneBaseLabel} · ${columns} by ${rows} cells`);
      const caption = svg.closest('figure')?.querySelector('[data-zone-dimensions]');
      if (caption) caption.textContent = `${columns} × ${rows} cells`;
    }
    if (status) status.textContent = `${width} × ${height} cells · ${width * 7} × ${height * 7} m`;
    if (saveUrl) {
      const url = new URL(location.href);
      url.searchParams.set('zoneWidth', String(width));
      url.searchParams.set('zoneHeight', String(height));
      history.replaceState(history.state, '', url);
    }
  }

  function readUrl() {
    const query = new URL(location.href).searchParams;
    show(dimension(query.get('zoneWidth'), widthInput, defaults.width),
      dimension(query.get('zoneHeight'), heightInput, defaults.height), false);
  }

  function readInputs(commit) {
    // Leave incomplete typing alone; normalise a blank or out-of-range field
    // once the edit is committed rather than fighting the next keystroke.
    if (!commit && (!widthInput.validity.valid || !heightInput.validity.valid
      || widthInput.value === '' || heightInput.value === '')) return;
    show(dimension(widthInput.value, widthInput, current.width),
      dimension(heightInput.value, heightInput, current.height), true);
  }

  for (const input of [widthInput, heightInput]) {
    input.addEventListener('input', () => readInputs(false));
    input.addEventListener('change', () => readInputs(true));
  }
  reset?.addEventListener('click', () => show(defaults.width, defaults.height, true));
  addEventListener('popstate', readUrl);
  readUrl();
})();
