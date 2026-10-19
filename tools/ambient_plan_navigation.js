// Review-only floor fragments: keep just the selected floor in the document.
(() => {
  const panel = document.getElementById('ambient-layouts');
  const select = document.getElementById('ambient-floor');
  const content = document.getElementById('ambient-floor-content');
  const status = document.getElementById('ambient-floor-status');
  let request = 0, loaded = null;
  const floors = new Set([...select.options].map(option => option.value));
  function showCurrentNexuses() {
    for (const slot of content.querySelectorAll('[data-current-variant]')) {
      const source = document.getElementById(slot.dataset.currentVariant);
      if (!source) continue; // Keep the direct link if a snapshot lacks this card.
      const card = source.cloneNode(true);
      const nodes = [card, ...card.querySelectorAll('*')];
      const ids = new Map(nodes.filter(node => node.id).map(node => [node.id, `current-L0-${node.id}`]));
      for (const node of nodes) {
        if (node.id) node.id = ids.get(node.id);
        for (const attr of [...node.attributes]) {
          let value = attr.value;
          for (const [id, replacement] of ids) {
            if (value === `#${id}`) value = `#${replacement}`;
            value = value.replaceAll(`url(#${id})`, `url(#${replacement})`);
          }
          if (value !== attr.value) node.setAttribute(attr.name, value);
        }
      }
      slot.replaceChildren(card);
    }
  }
  async function showFloor() {
    if (panel.hidden) { request++; return; }
    const match = location.hash.match(/^#ambient-(L[0-7])(?:-|$)/);
    const floor = match?.[1] || select.value;
    select.value = floors.has(floor) ? floor : 'L0';
    const ticket = ++request;
    if (loaded !== select.value) {
      loaded = null;
      content.replaceChildren();
      content.setAttribute('aria-busy', 'true');
      status.textContent = `Loading ${select.value}…`;
      try {
        const response = await fetch(`floor-${select.value}.html`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const markup = await response.text();
        if (ticket !== request) return;
        content.innerHTML = markup;
        showCurrentNexuses();
        loaded = select.value;
        status.textContent = `${select.options[select.selectedIndex].text} · static planning samples`;
      } catch (error) {
        if (ticket !== request) return;
        status.textContent = `Could not load this floor (${error.message}).`;
        loaded = null;
        const retry = document.createElement('button');
        retry.textContent = 'Retry';
        retry.onclick = showFloor;
        content.replaceChildren(retry);
      } finally {
        if (ticket === request) content.removeAttribute('aria-busy');
      }
    }
    if (ticket !== request) return;
    const target = document.getElementById(location.hash.slice(1));
    if (target && target !== panel) target.scrollIntoView({block: 'start'});
  }
  select.addEventListener('change', () => { location.hash = `ambient-${select.value}`; });
  addEventListener('hashchange', showFloor);
  showFloor();
})();
