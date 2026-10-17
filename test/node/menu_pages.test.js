// THE ☰ MENU'S PAGES (owner, Oct 2026): the saved games under "Load game",
// the developer tools under "Developer" — each a second scrolling dialog with
// a Back button, the main list kept short. Source-level pins: the markup, the
// move-and-return, the modal gate's exception.
test('menu pages: the saved games and the developer tools are pages of the menu, not inline sections', () => {
  const list = INDEX_HTML_SRC.slice(INDEX_HTML_SRC.indexOf('<div class="items menu-items" id="menu-items">'),
    INDEX_HTML_SRC.indexOf('<button class="danger" id="reset-save"'));
  assert.truthy(/<button id="load-game">Load game ›<\/button>\s*<button id="dev-tools">Developer ›<\/button>/.test(list),
    'two page buttons in the main list, below Move Home');
  const pages = list.slice(list.indexOf('<div id="menu-pages" hidden>'));
  assert.truthy(pages.includes('<div id="saves-section">') && pages.includes('<div id="saves-list">') && pages.includes('<button id="new-save">'),
    'the saves section lives in the hidden page holder');
  assert.truthy(pages.includes('<details id="devtools">') && pages.includes('<div id="teleport-section"'),
    'so do the developer tools and the teleport presets');
  assert.falsy(/Saved games<\/div>/.test(list), 'no inline "Saved games" heading left in the list');
  assert.truthy(/\.game-modal \.menu-page#devtools > summary \{ display: none; \}/.test(INDEX_HTML_SRC), 'on its page the Developer details shows no summary');
});

test('menu pages: a page moves its markup into a second scrolling dialog and home again; the gate ignores both menu dialogs', () => {
  const open = SCENE_SRC.slice(SCENE_SRC.indexOf('\n  _openMenuPage(pageId, title) {'), SCENE_SRC.indexOf('\n  _closeMenuPage() {'));
  assert.truthy(/this\.makeModalShell\('menu-page-modal', \{\n\s*kind: 'menu', textAlign: 'left', art: false, header: false, scroll: true,/.test(open),
    'the page is the menu\'s own kind of dialog, and scrolls');
  assert.truthy(open.includes("if (page.tagName === 'DETAILS') page.open = true;"), 'the Developer details is forced open on its page');
  assert.truthy(/back\.addEventListener\('click', \(e\) => \{ e\.stopPropagation\(\); this\._closeMenuPage\(\); this\._openMenuDialog\(\); \}\);/.test(open),
    'Back returns to the main menu');
  assert.truthy(open.includes("onClose: () => { menu.open = false; },"), 'the backdrop closes the whole menu');
  const close = SCENE_SRC.slice(SCENE_SRC.indexOf('\n  _closeMenuPage() {'), SCENE_SRC.indexOf('\n  _closeMenuDialog() {'));
  assert.truthy(close.includes("const home = document.getElementById('menu-pages');") && close.includes('home.appendChild(page)'),
    'the page goes home to the hidden holder');
  const main = SCENE_SRC.slice(SCENE_SRC.indexOf('\n  _openMenuDialog() {'), SCENE_SRC.indexOf('\n  _openMenuPage(pageId, title) {'));
  assert.truthy(/\[\['load-game', 'saves-section', 'Load game'\], \['dev-tools', 'devtools', 'Developer'\]\]/.test(main), 'the two buttons open their pages');
  const closeDialog = SCENE_SRC.slice(SCENE_SRC.indexOf('\n  _closeMenuDialog() {'), SCENE_SRC.indexOf('\n  }\n', SCENE_SRC.indexOf('\n  _closeMenuDialog() {')));
  assert.truthy(closeDialog.includes('this._closeMenuPage();'), 'closing the menu closes its page too');
  assert.truthy(SCENE_SRC.includes("if (openModals.some(el => el.id !== 'menu-modal' && el.id !== 'menu-page-modal')) {"),
    'the modal gate counts neither menu dialog as a dialog over the menu');
  assert.truthy(INDEX_HTML_SRC.includes("if (document.getElementById('menu-modal') || document.getElementById('menu-page-modal')) return;"),
    'nor does the page\'s outside-tap guard treat a tap in a page as outside the menu');
});
