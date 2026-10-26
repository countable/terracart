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

// Street fixtures remain deterministic; review a shorter central window without
// stretching art or recomputing the full-fixture inventory printed on each card.
(() => {
  const section = document.getElementById('streets');
  if (!section) return;
  const controls = document.createElement('div');
  controls.className = 'controls street-length-controls';
  controls.setAttribute('aria-label', 'Road sample length');
  const groups = [];
  for (const [size, label, param] of [
    ['minor', 'Road length (m)', 'roadLength'],
    ['path', 'Path length (m)', 'pathLength'],
  ]) {
    const previews = [...section.querySelectorAll(`#roads-${size} article > figure > svg`)].map(svg => {
      const box = svg.viewBox.baseVal;
      const line = svg.querySelector('path[stroke="#786955"]');
      return { svg, x: box.x, y: box.y, width: box.width, height: box.height,
        length: line.getTotalLength(), label: svg.getAttribute('aria-label') };
    });
    if (!previews.length) continue;
    const maximum = Math.round(Math.min(...previews.map(p => p.length)) * 10) / 10;
    const wrapper = document.createElement('label');
    wrapper.textContent = `${label} `;
    const input = document.createElement('input');
    Object.assign(input, { id: `${size}-sample-length`, type: 'number', min: '21',
      max: String(maximum), step: 'any', value: String(maximum) });
    input.style.width = '7em';
    wrapper.append(input);
    controls.append(wrapper);
    for (const preview of previews) {
      preview.caption = document.createElement('span');
      preview.svg.closest('figure').querySelector('figcaption').append(preview.caption);
    }
    groups.push({ input, previews, maximum, param, current: maximum });
  }
  if (!groups.length) return;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset length';
  controls.append(reset);
  const note = document.createElement('p');
  note.textContent = 'Shorter lengths show the centre of each generated sample. Prop and lamp counts describe the full sample. Maximum length is the generated fixture; close-ups stay fixed.';
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
      if (group.current === group.maximum) url.searchParams.delete(group.param);
      else url.searchParams.set(group.param, String(group.current));
    }
    history.replaceState(history.state, '', url);
  }
  function readUrl() {
    const params = new URL(location.href).searchParams;
    for (const group of groups) show(group, normalise(params.get(group.param), group, group.maximum));
  }
  for (const group of groups) {
    for (const event of ['input', 'change']) group.input.addEventListener(event, () => {
      if (event === 'input' && (!group.input.validity.valid || group.input.value === '')) return;
      show(group, normalise(group.input.value, group, group.current));
      save();
    });
  }
  reset.addEventListener('click', () => {
    for (const group of groups) show(group, group.maximum);
    save();
  });
  addEventListener('popstate', readUrl);
  readUrl();
})();
