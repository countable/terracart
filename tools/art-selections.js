/* Shared shortlist for the item and world review dashboards. */
(() => {
  const storageKey = 'terracart.artAlternativeSelections.v1';
  const identity = entry => JSON.stringify([entry.domain, entry.target, entry.alt]);
  const valid = entry => entry && ['world', 'item'].includes(entry.domain)
    && typeof entry.target === 'string' && typeof entry.label === 'string'
    && /^ALT-\d+$/.test(entry.alt);
  function read() {
    try {
      const entries = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(entries) ? [...new Map(entries.filter(valid).map(e => [identity(e), e])).values()] : [];
    } catch { return []; }
  }
  let selections = read();
  let storageAvailable = true;
  const panel = document.createElement('section');
  panel.className = 'art-selections';
  panel.setAttribute('aria-label', 'Saved art selections');
  panel.innerHTML = `<details><summary>Saved selections (<span data-selection-count>0</span>)</summary>
    <p>Click a variant to save it; click again to remove it. This list is shared between both dashboards and saved in this browser. It does not replace game art.</p>
    <textarea aria-label="Selections to copy" rows="5" readonly></textarea>
    <div class="selection-actions"><button type="button" data-copy-selections>Copy list</button><button type="button" data-clear-selections>Clear list</button></div>
    <ul data-selection-list></ul></details><p class="selection-status" role="status" aria-live="polite"></p>`;
  document.querySelector('.controls').before(panel);
  const status = panel.querySelector('.selection-status');
  const textarea = panel.querySelector('textarea');
  function refresh() {
    const selected = new Set(selections.map(identity));
    document.querySelectorAll('.art-choice').forEach(button => {
      const key = identity({ domain: button.dataset.artDomain, target: button.dataset.artTarget, alt: button.dataset.artAlt });
      button.setAttribute('aria-pressed', String(selected.has(key)));
    });
  }
  function render() {
    panel.querySelector('[data-selection-count]').textContent = selections.length;
    textarea.value = selections.map(entry => `${entry.domain === 'world' ? 'World' : 'Item'}: ${entry.label} [${entry.target}] → ${entry.alt}`).join('\n');
    const list = panel.querySelector('[data-selection-list]');
    list.replaceChildren();
    for (const entry of selections) {
      const li = document.createElement('li');
      li.append(document.createTextNode(`${entry.label} → ${entry.alt} `));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${entry.alt} for ${entry.label}`);
      remove.addEventListener('click', () => save(selections.filter(e => identity(e) !== identity(entry)), `Removed ${entry.alt}.`));
      li.append(remove);
      list.append(li);
    }
    panel.querySelector('[data-copy-selections]').disabled = !selections.length;
    panel.querySelector('[data-clear-selections]').disabled = !selections.length;
    refresh();
  }
  function save(next, message) {
    selections = next;
    try {
      localStorage.setItem(storageKey, JSON.stringify(selections));
      status.textContent = message;
    } catch {
      storageAvailable = false;
      status.textContent = 'Browser storage is unavailable. Copy this list before leaving the page.';
    }
    render();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('.art-choice');
    if (!button) return;
    const entry = { domain: button.dataset.artDomain, target: button.dataset.artTarget,
      label: button.dataset.artLabel, alt: button.dataset.artAlt };
    if (!valid(entry)) return;
    // Read the latest shared list before changing it, including edits in another tab.
    if (storageAvailable) selections = read();
    const exists = selections.some(e => identity(e) === identity(entry));
    save(exists ? selections.filter(e => identity(e) !== identity(entry)) : [...selections, entry],
      `${exists ? 'Removed' : 'Saved'} ${entry.alt} for ${entry.label}.`);
  });
  panel.querySelector('[data-copy-selections]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      status.textContent = 'Selection list copied.';
    } catch {
      panel.querySelector('details').open = true;
      textarea.focus();
      textarea.select();
      status.textContent = 'Select Copy in your browser, or press Ctrl+C / ⌘C.';
    }
  });
  panel.querySelector('[data-clear-selections]').addEventListener('click', () => save([], 'Selection list cleared.'));
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) { selections = read(); render(); }
  });
  new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1
      && (node.matches('.art-choice') || node.querySelector('.art-choice'))))) refresh();
  }).observe(document.body, { childList: true, subtree: true });
  render();
})();
