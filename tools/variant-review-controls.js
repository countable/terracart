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

// Street fixtures remain deterministic; review a shorter central window without
// stretching art or recomputing the full-fixture inventory printed on each card.
(() => {
  const section = document.getElementById('streets');
  if (!section) return;
  const controls = document.createElement('div');
  controls.className = 'controls street-length-controls';
  controls.setAttribute('aria-label', 'Road sample length');
  const groups = [];
  for (const [size, label, param, defaultLength] of [
    ['minor', 'Road length (m)', 'roadLength', 100],
    ['path', 'Path length (m)', 'pathLength', 60],
  ]) {
    const previews = [...section.querySelectorAll(`#roads-${size} article > figure > svg`)].map(svg => {
      const box = svg.viewBox.baseVal;
      const line = svg.querySelector('path[stroke="#786955"]');
      // Keep the road centred while removing half the surrounding ground.
      const height = box.height / 2;
      return { svg, x: box.x, y: box.y + (box.height - height) / 2, width: box.width, height,
        length: line.getTotalLength(), label: svg.getAttribute('aria-label') };
    });
    if (!previews.length) continue;
    const maximum = Math.round(Math.min(...previews.map(p => p.length)) * 10) / 10;
    const wrapper = document.createElement('label');
    wrapper.textContent = `${label} `;
    const input = document.createElement('input');
    Object.assign(input, { id: `${size}-sample-length`, type: 'number', min: '21',
      max: String(maximum), step: 'any', value: String(defaultLength) });
    input.style.width = '7em';
    wrapper.append(input);
    controls.append(wrapper);
    for (const preview of previews) {
      preview.caption = document.createElement('span');
      preview.svg.closest('figure').querySelector('figcaption').append(preview.caption);
    }
    groups.push({ input, previews, maximum, param, defaultLength, current: defaultLength });
  }
  if (!groups.length) return;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset length';
  controls.append(reset);
  const note = document.createElement('p');
  note.textContent = 'Length crops the sample around its centre. Counts cover the full sample; close-ups stay fixed.';
  section.querySelector('.art-switch').after(controls, note);

  function normalise(value, group, fallback) {
    if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value))) return fallback;
    return Math.max(Number(group.input.min), Math.min(group.maximum, Number(value)));
  }
  function show(group, length) {
    group.current = length;
    group.input.value = String(length);
    for (const p of group.previews) {
      const full = length === group.maximum;
      const width = full ? p.width : length;
      p.svg.setAttribute('viewBox', `${p.x + (p.width - width) / 2} ${p.y} ${width} ${p.height}`);
      p.svg.style.aspectRatio = `${width} / ${p.height}`;
      p.svg.setAttribute('aria-label', `${p.label} · ${length} m${full ? '' : ' central crop'}`);
      p.caption.textContent = ` · ${length} m${full ? ' full sample' : ' central crop'}`;
    }
  }
  function save() {
    const url = new URL(location.href);
    for (const group of groups) {
      if (group.current === group.defaultLength) url.searchParams.delete(group.param);
      else url.searchParams.set(group.param, String(group.current));
    }
    history.replaceState(history.state, '', url);
  }
  function readUrl() {
    const params = new URL(location.href).searchParams;
    for (const group of groups) show(group, normalise(params.get(group.param), group, group.defaultLength));
  }
  for (const group of groups) {
    for (const event of ['input', 'change']) group.input.addEventListener(event, () => {
      if (event === 'input' && (!group.input.validity.valid || group.input.value === '')) return;
      show(group, normalise(group.input.value, group, group.current));
      save();
    });
  }
  reset.addEventListener('click', () => {
    for (const group of groups) show(group, group.defaultLength);
    save();
  });
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
  group('Sample size', [document.querySelector('.zone-size-controls')], 'zones');

  function roadSettings() {
    const length = document.querySelector('.street-length-controls');
    const note = length?.nextElementSibling;
    const pavement = document.getElementById('restored-pavement')?.closest('label');
    group('Road preview', [length, pavement, note?.tagName === 'P' ? note : null], 'streets');
    group('Road selection', [document.querySelector('.affinity-controls')], 'streets');
    const floor = document.getElementById('ambient-floor')?.closest('label');
    if (floor) group('Floor', [floor], 'ambient-layouts');
    selectView();
  }
  function selectView() {
    const active = document.querySelector('[data-view][aria-current="page"]')?.dataset.view || 'basic-zones';
    for (const fieldset of settings.querySelectorAll('[data-settings-view]')) {
      fieldset.hidden = fieldset.dataset.settingsView !== active;
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
