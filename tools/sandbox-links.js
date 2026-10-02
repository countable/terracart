// Dashboard presentation only; destinations and aliases belong to the game.
(function (root) {
  'use strict';
  const escape = text => String(text ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function link(key, label) {
    const destination = root.SandboxDestinations.find(key);
    if (!destination) return '';
    return `<a class="sandbox-link" href="${escape(root.SandboxDestinations.href(key))}" target="_blank" rel="noopener">${escape(label || `Try ${destination.label || destination.name || destination.id} in sandbox`)} ↗</a>`;
  }
  function links() {
    return root.SandboxDestinations.entries.map(row => link(row.id)).join(' · ');
  }
  function mount() {
    document.querySelectorAll('[data-sandbox]').forEach(el => {
      el.innerHTML = link(el.dataset.sandbox, el.dataset.sandboxLabel);
    });
    document.querySelectorAll('[data-sandbox-directory]').forEach(el => { el.innerHTML = links(); });
  }
  root.SandboxLinks = { link, links, mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(window);
