// The generator samples the full area once. Changing the review dimensions
// crops around each sample centre without stretching cells or moving objects.
(() => {
  const widthInput = document.getElementById('zone-width');
  const heightInput = document.getElementById('zone-height');
  if (!widthInput || !heightInput) return;

  const previews = [...document.querySelectorAll('svg[data-zone-preview]')];
  const streets = [...document.querySelectorAll('#streets article > figure > svg')].map(svg => {
    const box = svg.viewBox.baseVal;
    const caption = document.createElement('span');
    svg.closest('figure').querySelector('figcaption')?.append(caption);
    return { svg, caption, x: box.x, y: box.y, width: box.width, height: box.height,
      length: svg.querySelector('path[stroke="#786955"]').getTotalLength(),
      label: svg.getAttribute('aria-label') };
  });
  const status = document.getElementById('zone-size-status');
  const reset = document.getElementById('zone-size-reset');
  const defaults = {
    width: Number(widthInput.defaultValue) || 20,
    height: Number(heightInput.defaultValue) || 7,
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
    for (const p of streets) {
      const metresWide = Math.min(width * 7, p.width);
      const metresHigh = Math.min(height * 7, p.height);
      const visibleLength = Math.round(Math.min(metresWide, p.length) * 10) / 10;
      p.svg.setAttribute('viewBox', `${p.x + (p.width - metresWide) / 2} ${p.y + (p.height - metresHigh) / 2} ${metresWide} ${metresHigh}`);
      p.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      p.svg.style.aspectRatio = `${metresWide} / ${metresHigh}`;
      const dimensions = `${Math.round(metresWide * 10) / 10} × ${Math.round(metresHigh * 10) / 10} m`;
      p.svg.setAttribute('aria-label', `${p.label} · ${dimensions} view · ${visibleLength} m visible length`);
      p.caption.textContent = ` · ${dimensions} view · ${visibleLength} m visible length`;
    }
    if (status) status.textContent = `${width} × ${height} cells · ${width * 7} × ${height * 7} m`;
    if (saveUrl) {
      const url = new URL(location.href);
      url.searchParams.set('zoneWidth', String(width));
      url.searchParams.set('zoneHeight', String(height));
      url.searchParams.delete('roadLength');
      url.searchParams.delete('pathLength');
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

// Keep controls together and show only settings for the selected review.
(() => {
  const display = document.getElementById('show-art')?.closest('.controls');
  if (!display) return;
  const settings = document.createElement('section');
  settings.className = 'review-settings';
  settings.setAttribute('aria-label', 'Preview settings');
  display.before(settings);

  function group(title, nodes, view) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = title;
    fieldset.append(legend, ...nodes.filter(Boolean));
    if (view) fieldset.dataset.settingsView = view;
    settings.append(fieldset);
    return fieldset;
  }
  group('Display', [display]);
  const viewport = document.querySelector('.zone-size-controls');
  viewport?.setAttribute('aria-label', 'Viewport size');
  const viewportNote = document.createElement('p');
  viewportNote.textContent = 'Roads and paths fit this window, up to the sample bounds.';
  group('Viewport', [viewport, viewportNote], 'zones streets');

  function roadSettings() {
    const note = document.createElement('p');
    note.textContent = 'Counts cover the full sample; close-ups stay fixed.';
    const pavement = document.getElementById('restored-pavement')?.closest('label');
    group('Road preview', [pavement, note], 'streets');
    group('Road selection', [document.querySelector('.affinity-controls')], 'streets');
    const floor = document.getElementById('ambient-floor')?.closest('label');
    if (floor) group('Floor', [floor], 'ambient-layouts');
    selectView();
  }
  function selectView() {
    const active = document.querySelector('[data-view][aria-current="page"]')?.dataset.view || 'basic-zones';
    for (const fieldset of settings.querySelectorAll('[data-settings-view]')) {
      fieldset.hidden = !fieldset.dataset.settingsView.split(' ').includes(active);
    }
  }
  const style = document.createElement('style');
  style.textContent = `
    .review-settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px;margin:24px 0}
    .review-settings fieldset{min-width:0;margin:0;padding:14px 16px;border:1px solid #405745;border-radius:10px;background:#172820}
    .review-settings legend{padding:0 6px;font-weight:650;color:#b4c6b4}
    .review-settings .controls{position:static;display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;margin:0;padding:0;background:none}
    .review-settings label{display:inline-flex;align-items:center;gap:6px;max-width:100%}
    .review-settings input[type=number]{width:6em}
    .review-settings input[type=number],.review-settings select,.review-settings button{font:inherit;padding:6px 8px;border:1px solid #60836d;border-radius:6px;background:#263b2d;color:#e5ecdf}
    .review-settings select{max-width:100%}
    .review-settings button{cursor:pointer}
    .review-settings p,.review-settings output{font-size:13px;line-height:1.5;color:#b4c6b4}
    .review-settings p{margin:10px 0 0}
    .review-settings output{flex-basis:100%}
    .review-settings .art-switch{margin:12px 0 0}
  `;
  document.head.append(style);
  addEventListener('hashchange', selectView);
  selectView();
  roadSettings();
})();
