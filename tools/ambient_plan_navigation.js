// Review-only floor fragments: keep just the selected floor in the document.
(() => {
  const panel = document.getElementById('ambient-layouts');
  const select = document.getElementById('ambient-floor');
  const content = document.getElementById('ambient-floor-content');
  const status = document.getElementById('ambient-floor-status');
  let request = 0, loaded = null;
  const floors = new Set([...select.options].map(option => option.value));
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
