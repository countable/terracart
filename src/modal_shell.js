// The modal SHELL — the one dialog box every DOM dialog in the game is built
// in: makeModalShell (the 4:3 scene frame, separate copy region, kind header
// and measured pagination), the stock dialogs
// built on it (showMessageModal, showConfirmModal, showOfferModal,
// showChestRewardModal), and
// the gate that mirrors "a dialog is open" onto body.modal-open
// (_installModalPadGate). Plus the tables they read: MODAL_KINDS and the
// scene-art fallback geometry (STORY_MODAL_GROW_PX).
//
// The methods live on `class SceneModals`, a
// MIXIN: app.js installs them onto MapScene.prototype right after the class
// closes (installSceneMixin, below), so every caller still says
// `this.showOfferModal(...)` / `scene.makeModalShell(...)` and nothing else
// changed. The consts stay plain top-level lexical globals (never window.X —
// see lexical_globals.test.js). This file loads BEFORE app.js, so an
// initializer here may only read literals or names defined above it; the
// methods read app.js / util.js names (UI_CONTROL_DIM, UI_TREASURE,
// VIEW_CELLS, CELL_PX, clamp, this.coinIconHTML, this._flushStarterCheers) at
// CALL time only.
//
// What this is NOT: the dialogs' CONTENT. The callers — presentTraderOffer,
// presentSmeltOffer, showQuestBoard, presentWreckRestoreModal, showEnergyHelp,
// the ☰ menu dialog, … — are shop / building / HUD logic and stay in app.js;
// so do the toasts (TOAST_TIER — a map message is not a dialog) and the icon
// renderers a dialog's copy uses (iconSpanHTML, worldIconHTML,
// _prewarmModalIcons). See CLAUDE.md "Every dialog opens on a PAINTING" before
// changing the frame or the band here, and tools/modal_audit.js for the
// every-dialog-has-a-kind check.

// Base geometry follows the map width; compass_panels.css extends the shared
// box to the visible viewport floor as an attached mechanical sheet. The
// story growth constants still define scene-painting composition and the
// fallback geometry before the stylesheet loads.
const STORY_MODAL_GROW_PX = 96;
// Scene paintings share a full-width crop under the fixed dragon rail.
// Approved 4:3 scenes keep their full frame; copy and actions occupy
// a separate viewport, with pages when the content needs more room.

// ── What KIND of dialog is this? ────────────────────────────────────────────
// Every modal opens with one of these: a hero icon and a one-word category, so
// the player knows what they are looking at before reading a line of it.
// The label is the CATEGORY, not the specific offer; callers may override it
// for a one-off outcome (the trail prize's "Thou hast traveled far").
//
// The icon is the FALLBACK glyph. A dialog whose subject is a thing standing on
// the map passes that thing's sprite instead (`kindIcon`, makeModalShell); an
// emoji remains for categories with no sprite behind them.
//
// `supplies` is separate from `treasure` so the tutorial's material handout
// does not spend the treasure ceremony meant for the spawn relic chest. The
// COLOUR stays blue-white either way (spec §UI COLOUR LANGUAGE).
//
// Keys are referenced by every modal call site and pinned by
// tools/modal_audit.js, which fails the build if a dialog opens without one.
// `art` is the category's default SCENE painting (assets/art/, see SCENE ART
// by STORY_MODAL_GROW_PX), used unless the caller hands a painting of its own.
// PIXEL RESOLVE's cuts, coarse to fine: ART_CUTS[stem] then the thumbnail
// itself (ART_THUMBS), all baked inline by tools/art_thumbs.js at the
// ART_CUT_WIDTHS it writes beside them. Never cut at runtime (canvas readbacks
// cost ~200 ms of main thread as the dialog opened).
// PIXEL RESOLVE's cuts, coarse to fine: ART_CUTS[stem] then the thumbnail
// itself (ART_THUMBS), all baked inline by tools/art_thumbs.js at the
// ART_CUT_WIDTHS it writes beside them. Never cut at runtime — that was four
// canvas-to-data-URL readbacks, ~200 ms of main thread as the dialog opened.
const RESOLVE_STEP_MS = 150;
function mosaicCuts(stem) {
  const cuts = (typeof ART_CUTS !== 'undefined') && ART_CUTS[stem];
  const thumb = (typeof ART_THUMBS !== 'undefined') && ART_THUMBS[stem];
  return (cuts && thumb) ? [...cuts, thumb] : null;
}
// The ONE address of a scene painting — the shell draws it and the boot
// preloader (app.js _prewarmModalIcons) fetches it, so the warm copy is the
// very URL the dialog asks for.
const sceneArtUrl = (stem) => stem.startsWith('data:image/') ? stem : `assets/art/${stem}.webp`;
const MODAL_KINDS = {
  quest:    { icon: '🏰', label: 'Quest', art: 'kind_quest' },   // castle quest board
  treasure: { icon: '💎', label: 'Treasure', art: 'kind_treasure' },   // chests, boxes, loot ceremonies
  supplies: { icon: '🧰', label: 'Supplies', art: 'kind_supplies' },   // the starter crates' handout — see below
  trail:    { icon: '🗺️', label: 'Trail', art: 'kind_trail' },   // road/trail completion rewards
  shop:     { coinIcon: true, label: 'Shop', art: 'kind_shop' },   // buying and selling for money — glyph is the coin asset (header reads `coinIcon`)
  trade:    { icon: '🤝', label: 'Trade', art: 'kind_trade' },   // goods-for-goods barter
  // The smithy's CATEGORY is 'Smithy', never 'Forge': Forge is one of its two
  // ACTIONS (the Forge / Smelt tab and button), and a header reading FORGE over
  // the Smelt tab used the one word for two unrelated things.
  forge:    { icon: '🔨', label: 'Smithy', art: 'kind_forge' },   // blacksmith: forging + smelting
  relics:   { icon: '💍', label: 'Relics', art: 'kind_relics' },   // relic + armor offers
  delivery: { icon: '📦', label: 'Delivery', art: 'kind_delivery' },   // household orders
  build:    { icon: '🛠', label: 'Build', art: 'kind_build' },   // restoring wrecks, unsealing forts, moving home
  craft:    { icon: '🪵', label: 'Craft', art: 'kind_craft' },   // Home's Craft page (HOME_RECIPES)
  wizard:   { icon: '🔮', label: 'Wizard', art: 'kind_wizard' },   // spends memories on gifts
  spirit:   { icon: '✧', label: 'Dragon Spirit', portrait: 'assets/portraits/dragon_spirit.png' },
  memory:   { icon: '🌟', label: 'Memories', art: 'kind_memory' },   // the memories chip's explainer
  slots:    { icon: '🎰', label: 'Slots', art: 'kind_slots' },   // a fort's slot machine (presentFortSlots)
  farm:     { icon: '🌾', label: 'Farm', art: 'kind_farm' },   // scarecrows, feeding fauna
  energy:   { icon: '⚡', label: 'Energy', art: 'kind_energy' },   // the energy explainer
  rest:     { icon: '😵', label: 'Exhausted', art: 'kind_rest' },   // passing out underground
  use:      { icon: '🎒', label: 'Use', art: 'kind_use' },   // confirming a consumable from the bag
  fire:     { icon: '🔥', label: 'Campfire', art: 'kind_fire' },   // burning a held item (presentBurnConfirm)
  note:     { icon: '📜', label: 'Note', art: 'kind_note' },   // generic message dialog
  // A neighbour speaking: the header is the speaker's name and role (callers pass it as
  // kindLabel — NPC.speech), the label below is only the fallback. Always
  // opened with the speaker's portrait, so the row has no default painting.
  talk:     { icon: '💬', label: 'Talk' },
  menu:     { icon: '☰', label: 'Menu', art: 'kind_menu' },   // the ☰ menu (_openMenuDialog)
  // A story splash (_storySplashOnce, a badge, a book): always carries its own
  // painting, so the row has no default one.
  story:    { icon: '📜', label: 'Story' },
};

class SceneModals {
  // Shared factory for all modal overlays. Returns { wrap, box, mount, mkBtn }.
  //   onClose — if provided, backdrop click (tap on wrap outside box) removes
  //             the modal and calls onClose(). Pass () => {} for no-op backdrop.
  //   mkBtn(label, primary, disabled) — standardised button factory reused by
  //             every modal so styling stays consistent site-wide.
  //   borderColor — defaults to the CONTROL gold: an ordinary dialog is
  //             something the player drives. Treasure ceremonies override it
  //             with the blue-white (spec §UI COLOUR LANGUAGE).
  //   scroll — the copy viewport SCROLLS instead of turning pages (the ☰
  //             menu: one list, thumbed through, never split across pages —
  //             owner, Oct 2026). Copy that is read, not browsed, keeps pages.
  makeModalShell(id, { zIndex = 50, borderColor = UI_CONTROL_DIM,
    textAlign = 'center', wrapBg = '#0002', wrapExtra = '', boxExtra = '', onClose,
    kind, kindLabel, kindIcon, header = true, story = false, art, portrait, centerBody = false, fullscreen = false, source, bookPage = false, scroll = false, scrollContent = false } = {}) {
    document.getElementById(id)?.remove();
    // Every dialog opens on a painting: the caller's, or its kind's default.
    // Scene art is a story-sized dialog with a 4:3 image above its copy.
    const kRow = typeof kind === 'string' ? MODAL_KINDS[kind] : kind;
    const speech = kind === 'spirit' || kind === 'talk';
    portrait = portrait || kRow?.portrait;
    art = portrait || art === false ? null : art || kRow?.art;
    if (portrait) story = true;
    // FULLSCREEN (the wreck's build pick): the box fills the whole visible
    // game slice instead of the map square, and drops the painting — a
    // portrait frame cut to the square has no shape to fill it. The kind
    // header falls back to its plain icon-and-label row.
    if (fullscreen) art = null;
    if (art) story = true;
    const wrap = document.createElement('div');
    wrap.id = id;
    // Shared marker so _installModalPadGate can tell when ANY dialog is open and
    // hide the movement pads (which otherwise sit on top of the modal — see the
    // gate). Every modal goes through here, so one class covers them all.
    wrap.classList.add('game-modal');
    wrap.classList.add(speech ? 'speech-dialog' : 'compass-panel');
    if (bookPage) wrap.classList.add('book-page-modal');
    // …and its KIND on the same node, so a rule about one category of dialog
    // (a foe's blow closes a shop — _closeShopOnHit) can find it.
    if (typeof kind === 'string') wrap.dataset.kind = kind;
    // The backdrop covers the VISIBLE slice of the game box (fitGame
    // publishes it as --view-top/--view-h in game px); the box itself is
    // seated on the MAP VIEWPORT, not centred on the backdrop — see
    // STORY_MODAL_GROW_PX. Every dialog goes through here, so every dialog
    // is the same square in the same place.
    wrap.style.cssText =
      `position:absolute;left:0;right:0;top:var(--view-top,0px);height:var(--view-h,100%);` +
      `z-index:${zIndex};box-sizing:border-box;` +
      `background:${wrapBg};pointer-events:auto;${wrapExtra}`;
    const vSize = this.viewSize || VIEW_CELLS * CELL_PX;
    const vLeft = this.viewLeft ?? 0;
    const vTop = this.viewTop ?? 0;
    const grow = story ? STORY_MODAL_GROW_PX : 0;
    const frameBorder = borderColor === UI_CONTROL_DIM ? UI_DIALOG_BORDER : borderColor;
    const box = document.createElement('div');
    box.style.cssText = fullscreen
      ? 'position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;' +
        'background:#1a1612;color:#fff;border:0;border-radius:0;' +
        'padding:max(14px, env(safe-area-inset-top)) 16px max(14px, env(safe-area-inset-bottom));' +
        'font:13px var(--font-ui);overflow:hidden;' +
        (textAlign ? `text-align:${textAlign};` : '') + boxExtra
      :
      // Seated on the map square, in #game's own (game px) space; the wrap
      // starts at --view-top, so the box's top is measured back from it.
      `position:absolute;left:${vLeft}px;width:${vSize}px;` +
      `top:calc(${vTop - Math.round(grow / 4)}px - var(--view-top, 0px));height:${vSize + grow}px;` +
      `box-sizing:border-box;display:flex;flex-direction:column;` +
      `background:#1a1612;color:#fff;` +
      `border:2px solid ${frameBorder};border-radius:10px;padding:10px 12px;` +
      `font:13px var(--font-ui);` +
      // Content that outgrows the square uses pages; the box never grows to fit.
      `overflow:hidden;` +
      (textAlign ? `text-align:${textAlign};` : '') +
      boxExtra;
    // The 750×220 dragon rail must keep its full height at this panel width.
    box.style.setProperty('--panel-rail-height', `${vSize * 220 / 750}px`);
    // PIXEL RESOLVE. The painting is a request; its TONE and thumbnail
    // (ART_TONES / ART_THUMBS, src/art_thumbs.js) are inline. An uncached
    // painting opens on a solid block of its tone and resolves on a MOSAIC
    // layer through ever finer baked cuts (ART_CUTS, then the thumbnail; one per
    // RESOLVE_STEP_MS), then breathes on the last cut while it still waits —
    // so the wait reads as LOADING, not as a blurry picture. When the
    // painting lands, the mosaic takes the full thumbnail and the painting
    // fades in over it on a layer of its own. A cached painting skips all of
    // it and is simply there. Both layers share the same fitted crop.
    const artLayer = art ? document.createElement('div') : null;
    const mosaicLayer = art ? document.createElement('div') : null;
    let mosaicImg = null;
    // Dynamic pet paintings use the same 4:3 frame as installed scenes.
    const artAspect = (art && typeof ART_ASPECTS !== 'undefined' && ART_ASPECTS[art]) || 4 / 3;
    const fullFrameArt = Math.abs(artAspect - 4 / 3) < 0.01;
    const squareArt = Math.abs(artAspect - 1) < 0.01;
    const tone = (art && typeof ART_TONES !== 'undefined' && ART_TONES[art]) || '#1a1612';
    const paintLayer = (el, img) => {
      el.style.backgroundImage = img ? `url(${img})` : `linear-gradient(${tone}, ${tone})`;
      el.style.backgroundSize = '100% auto';
      el.style.backgroundPosition = 'center top';
      el.style.backgroundRepeat = 'no-repeat';
      el.style.imageRendering = 'pixelated';
    };
    if (art) {
      for (const el of [mosaicLayer, artLayer]) {
        el.style.cssText =
          'position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;';
      }
      mosaicLayer.className = 'modal-art-mosaic';
      artLayer.className = 'modal-art';
      box.classList.add('modal-scene');
      paintLayer(mosaicLayer, mosaicImg);
      paintLayer(artLayer, sceneArtUrl(art));
      const img = new Image();
      img.src = sceneArtUrl(art);
      if (img.complete) {
        artLayer.style.opacity = '1';
      } else {
        artLayer.style.opacity = '0';
        artLayer.style.transition = 'opacity 420ms ease-out';
        const timers = [];
        const setCut = (url) => { mosaicImg = url; paintLayer(mosaicLayer, url); };
        const cuts = mosaicCuts(art);
        if (cuts) {
          cuts.slice(0, -1).forEach((url, i) =>
            timers.push(setTimeout(() => setCut(url), (i + 1) * RESOLVE_STEP_MS)));
          timers.push(setTimeout(() => mosaicLayer.classList.add('modal-art-waiting'),
            (cuts.length - 1) * RESOLVE_STEP_MS));
        }
        img.onload = () => {
          timers.forEach(clearTimeout);
          mosaicLayer.classList.remove('modal-art-waiting');
          if (cuts) setCut(cuts[cuts.length - 1]);
          artLayer.style.opacity = '1';
        };
      }
    }
    let closed = false;
    const dismissShell = () => {
      if (closed) return;
      closed = true;
      wrap.remove();
      onClose?.();
    };
    if (onClose !== undefined) {
      wrap.addEventListener('click', (e) => { if (e.target === wrap && !speech) dismissShell(); });
    }
    // ── The kind header ────────────────────────────────────────────────
    // A hero icon plus the one-word category (MODAL_KINDS), so every dialog
    // announces what it is before its first line of copy. `kindLabel`
    // overrides the word for a one-off outcome while keeping the icon, and
    // `kindIcon` overrides the GLYPH the same way — HTML rather than text, so
    // a dialog whose subject is a thing on the map can open with that thing's
    // own sprite.
    //
    // Built here but inserted in mount(), NOT appended to `box` now: several
    // callers build their contents with `box.innerHTML = …`, which would
    // silently wipe a header added up front. mount() runs after all of them,
    // so injecting at the top there is the one placement no caller can undo.
    const k = typeof kind === 'string' ? MODAL_KINDS[kind] : kind;
    let kindNode = null;
    // `header: false` (the ☰ menu): no kind header at all — the list is the
    // whole dialog.
    if (!header || (art && kind === 'story' && (!kindLabel || kindLabel === 'Story'))) {
      // no header
    } else if (k && art) {
      // With a painting, the painting is the hero: the category shrinks to a
      // bare label chip on its top-left corner.
      kindNode = document.createElement('div');
      kindNode.className = 'modal-kind';
      kindNode.style.cssText =
        'position:absolute;top:10px;left:10px;z-index:1;padding:3px 8px;border-radius:4px;' +
        'display:flex;align-items:center;gap:6px;' +
        `background:rgba(20,16,12,.72);border:1px solid ${borderColor}8c;` +
        'font:700 10px var(--font-ui);letter-spacing:.14em;text-transform:uppercase;' +
        `color:${borderColor};`;
      kindNode.textContent = kindLabel ?? k.label;
    } else if (k) {
      kindNode = document.createElement('div');
      kindNode.className = 'modal-kind';
      kindNode.style.cssText =
        'display:flex;align-items:center;justify-content:center;gap:7px;' +
        'margin:-2px 0 10px;padding-bottom:8px;' +
        `border-bottom:1px solid ${borderColor}59;`;
      const ico = document.createElement('span');
      if (kindIcon) {
        // A SPRITE hero glyph: the art the world drew for the thing this dialog
        // is about (scene.worldIconHTML). NOT desaturated: the greying below
        // suits an emoji, and reads as broken for pixel art.
        ico.style.cssText = 'display:flex;align-items:center;line-height:0';
        ico.innerHTML = kindIcon;
      } else if (k.coinIcon) {
        // The shop kind's glyph is the coin ASSET (MODAL_KINDS row's
        // `coinIcon`), money's one face - pixel art like the hero glyph, so
        // it is not greyed either.
        ico.style.cssText = 'display:flex;align-items:center;line-height:0';
        ico.innerHTML = this.coinIconHTML(22);
      } else {
        // Desaturated: the emoji is a category glyph, not a prize, so it reads
        // in the chrome's own greys rather than pulling colour off the copy —
        // the same treatment the inactive inventory tab glyphs get.
        ico.style.cssText = 'font-size:22px;line-height:1;filter:grayscale(1)';
        ico.textContent = k.icon;
      }
      const lbl = document.createElement('span');
      lbl.style.cssText =
        'font:700 11px var(--font-ui);letter-spacing:.14em;' +
        `text-transform:uppercase;color:${borderColor};`;
      lbl.textContent = kindLabel ?? k.label;
      kindNode.appendChild(ico);
      kindNode.appendChild(lbl);
    }
    const mount = () => {
      // The body holds the art or portrait above a fitted copy viewport.
      // Copy and buttons stay together, using pages when they need more
      // room. Short unpainted dialogs retain their centred content.
      const body = document.createElement('div');
      body.className = 'modal-body';
      body.style.cssText =
        'flex:1 1 auto;min-height:0;margin:0;overflow:hidden;' +
        'display:flex;flex-direction:column;box-sizing:border-box;' +
        // Leave room for the controls' 2px press travel and raised edge.
        // Without it, pressing the last button briefly creates overflow.
        'padding-bottom:3px;' +
        // Above the painting layer (PIXEL RESOLVE), which is absolute.
        (art ? 'text-shadow:0 1px 2px #000;position:relative;z-index:1;' : '');
      // The full-width crop tucks under the rail. Fit trims its bottom
      // to leave room for the copy, including reward ceremonies.
      const spacer = art ? document.createElement('div') : null;
      if (spacer) {
        spacer.className = 'modal-art-spacer';
        spacer.style.cssText = 'position:relative;flex:0 0 auto;';
        spacer.append(mosaicLayer, artLayer);
      }
      const into = document.createElement('div');
      into.className = 'modal-content';
      into.style.cssText = art ? 'margin:0;flex:0 0 auto;' : 'margin:auto 0;flex:0 0 auto;';
      while (box.firstChild) into.appendChild(box.firstChild);
      // Useful categories sit with the copy below a painting; generic
      // Story adds no information and is omitted above.
      if (kindNode && !art) { kindNode.style.flex = '0 0 auto'; body.appendChild(kindNode); }
      if (speech && kindNode) {
        kindNode.classList.add('speech-speaker');
        kindNode.firstElementChild?.remove();
      }
      if (portrait) {
        // A square character portrait keeps its own size above the copy. It
        // is never stretched into a scene painting.
        const image = document.createElement('img');
        image.className = 'modal-portrait';
        image.src = portrait;
        image.alt = '';
        image.width = 128;
        image.height = 128;
        image.style.cssText = 'display:block;width:128px;height:128px;flex:0 0 128px;align-self:center;object-fit:contain;margin:0 0 10px;image-rendering:pixelated;';
        image.addEventListener('error', () => { image.style.display = 'none'; });
        if (speech && kindNode) kindNode.insertBefore(image, kindNode.firstChild);
        else body.appendChild(image);
      }
      if (spacer) body.appendChild(spacer);
      const viewport = document.createElement('div');
      viewport.className = 'modal-copy';
      // A scrolling dialog (the menu) thumbs its one list; every other dialog
      // keeps its copy still and turns pages (fit, below).
      viewport.style.cssText = scroll
        ? 'flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;'
        : 'flex:1 1 auto;min-height:0;overflow:hidden;';
      viewport.appendChild(into);
      body.appendChild(viewport);
      box.style.overflow = 'hidden';
      box.appendChild(body);
      if (kindNode && art) into.insertBefore(kindNode, into.firstChild);
      // Mount last: caller innerHTML cannot erase the fixed rail control.
      // The same cancellation path as backdrop dismissal preserves decisions,
      // mandatory acknowledgements, and the wrapper's capture-phase arming.
      if (onClose !== undefined && !speech) {
        const close = mkBtn('×', { variant: 'ghost' });
        close.style.cssText = '';
        close.type = 'button';
        close.className = 'compass-panel-close';
        close.setAttribute('aria-label', 'Close panel');
        close.title = 'Close panel';
        close.textContent = '×';
        close.addEventListener('click', (e) => { e.stopPropagation(); dismissShell(); });
        box.appendChild(close);
      }
      // The ENTRANCE (index.html .modal-anim): the backdrop fades in and the
      // box pops up from a touch smaller and lower. Only when nothing was on
      // screen — body.modal-open is synced by a MutationObserver that runs
      // AFTER this tap's handler, so a dialog that REPLACES another in the
      // same tap (a pager turn, a re-roll, a tab) still sees it set and swaps
      // in place instead of popping on every page.
      box.classList.add('modal-box');
      if (!document.body.classList.contains('modal-open')) wrap.classList.add('modal-anim');
      wrap.appendChild(box);
      (speech ? document.body : document.getElementById('game') || document.body).appendChild(wrap);
      if (speech) { this._syncModalGate?.(); this._placeSpeechBubble(wrap, box, source); }
      // Build cards stay in one scrollable grid; price and actions remain visible.
      if (scrollContent) {
        wrap.classList.add('modal-scroll-content');
        viewport.style.overflowY = 'auto';
        viewport.style.overflowX = 'hidden';
        viewport.style.overscrollBehavior = 'contain';
        into.style.margin = '0';
        into.style.padding = '4px';
        if (spacer) spacer.style.height = 'clamp(100px, 28vh, 220px)';
        const footer = document.createElement('div');
        footer.className = 'modal-offer-footer';
        footer.style.cssText = 'flex:0 0 auto;padding:8px 16px max(12px, env(safe-area-inset-bottom));';
        for (const node of into.querySelectorAll('.offer-cost, .offer-actions')) footer.appendChild(node);
        body.appendChild(footer);
        return;
      }
      // Refit live content and paginate overflow without shrinking type.
      let page = 0, pageCount = 1, frame = 0;
      const pages = document.createElement('div');
      pages.className = 'modal-pages';
      pages.style.cssText = 'display:none;align-items:center;justify-content:center;gap:10px;flex:0 0 auto;margin-top:6px;';
      const previous = mkBtn('‹', { variant: 'ghost', css: 'min-width:40px;min-height:36px;padding:4px 10px;' });
      const next = mkBtn('›', { variant: 'ghost', css: 'min-width:40px;min-height:36px;padding:4px 10px;' });
      previous.setAttribute('aria-label', 'Previous page');
      next.setAttribute('aria-label', 'Next page');
      const count = document.createElement('span');
      count.setAttribute('aria-live', 'polite');
      pages.append(previous, count, next);
      box.appendChild(pages);
      const showPage = (index) => {
        page = Math.max(0, Math.min(pageCount - 1, index));
        into.style.transform = page ? `translateX(${-page * (viewport.clientWidth + 16)}px)` : '';
        previous._setEnabled(page > 0);
        next._setEnabled(page < pageCount - 1);
        count.textContent = `${page + 1} / ${pageCount}`;
      };
      previous.addEventListener('click', e => { e.stopPropagation(); showPage(page - 1); });
      next.addEventListener('click', e => { e.stopPropagation(); showPage(page + 1); });
      into.addEventListener('focusin', e => {
        if (pageCount < 2) return;
        const x = e.target.getBoundingClientRect().left - into.getBoundingClientRect().left;
        showPage(Math.floor(x / (viewport.getBoundingClientRect().width * (1 + 16 / viewport.clientWidth))));
      });
      const fit = () => {
        frame = 0;
        if (!wrap.isConnected) return;
        into.style.height = '';
        into.style.columnWidth = '';
        into.style.columnGap = '';
        into.style.columnFill = '';
        into.style.transform = '';
        pages.style.display = 'none';
        if (spacer) {
          // Preserve approved 4:3 compositions and paginate their copy.
          // Legacy squares/portraits retain their existing bottom crop.
          const full = fullFrameArt ? body.clientWidth / artAspect : body.clientWidth * .9;
          const minimum = fullFrameArt ? full : squareArt ? body.clientWidth * .7
            : Math.min(full, parseFloat(box.style.getPropertyValue('--panel-rail-height')) + 8);
          spacer.style.height = `${full}px`;
          const deficit = into.scrollHeight - viewport.clientHeight;
          if (deficit > 0) spacer.style.height = `${Math.max(minimum, full - deficit)}px`;
        }
        pageCount = 1;
        // A scrolling dialog never pages: its overflow is the viewport's to scroll.
        if (!scroll && into.scrollHeight > viewport.clientHeight + 1) {
          pages.style.display = 'flex';
          // Reserve the pager inside the content region, below the columns.
          const available = viewport.clientHeight - 3;
          into.style.margin = '0';
          into.style.height = `${Math.max(44, available)}px`;
          into.style.columnWidth = `${viewport.clientWidth}px`;
          into.style.columnGap = '16px';
          into.style.columnFill = 'auto';
          pageCount = Math.max(1, Math.ceil((into.scrollWidth + 16) / (viewport.clientWidth + 16)));
        }
        showPage(page);
      };
      const scheduleFit = () => {
        if (!frame) frame = requestAnimationFrame(fit);
      };
      const changes = new MutationObserver(scheduleFit);
      changes.observe(into, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['open', 'hidden'] });
      const resize = new ResizeObserver(scheduleFit);
      resize.observe(box);
      into.addEventListener('load', scheduleFit, true);
      document.fonts?.ready.then(scheduleFit);
      const removal = new MutationObserver(() => {
        if (wrap.isConnected) return;
        changes.disconnect(); resize.disconnect(); removal.disconnect();
        cancelAnimationFrame(frame);
      });
      removal.observe(wrap.parentNode, { childList: true });
      fit();
    };
    // ONE button factory for every button a modal shows, in two VARIANTS:
    //   primary — a CONTROL: gold, always (spec §UI COLOUR LANGUAGE), or a
    //             ceremony's accent. Enabled, it is RAISED (a darker-gold
    //             under-edge and a soft glow) so it reads as something to
    //             press, and it presses: the tap sinks it onto its edge.
    //             Disabled, it is the flat UI_CONTROL_DIM the token is named
    //             for ("inactive controls"), faded.
    //   ghost   — transparent with a thin grey border: Cancel, a secondary
    //             action, a choice card, a pager arrow, an
    //             inactive tab. One ghost (it used to be #eee/#666 on Cancel
    //             and #ddd/#555 on the rest).
    // Every button carries _setEnabled(on): the ONE disabled look (faded, no
    // pointer) for the first paint and every live toggle (choice
    // controls’ canAfford, the reward card's Take arming), so looks can't
    // drift. `mkBtn(label, { variant, disabled, accent, css })`; the older
    // `mkBtn(label, primary, disabled)` spelling still reads as before.
    const RAISED = 'inset 0 1px 0 #fff5c9, inset 0 -1px 0 #977330, 0 2px 2px #171b1790, 0 0 7px #ffe06624';
    const PRESSED = 'inset 0 1px 3px #77582099, 0 1px 0 #e8cf8a66';
    const GHOST = 'background:transparent;color:#ddd;border:2px solid #555;';
    const mkBtn = (label, opts = true, disabled = false) => {
      const o = (opts && typeof opts === 'object') ? opts : { variant: opts ? 'primary' : 'ghost', disabled };
      const primary = o.variant !== 'ghost';
      const b = document.createElement('button');
      b.classList.add('compass-action', primary ? 'compass-action-primary' : 'compass-action-ghost');
      if (o.accent) b.classList.add('compass-action-accent');
      b.innerHTML = label;
      b.style.cssText =
        `padding:8px 14px;border-radius:6px;font:700 13px var(--font-ui);cursor:pointer;` +
        'transition:transform 60ms,box-shadow 60ms,background-color 120ms;' +
        (primary ? `color:#1a1612;border:0;` : GHOST) +
        (o.css || '');
      b._setEnabled = (on) => {
        b.disabled = !on;
        b.style.opacity = on ? '1' : '0.4';
        b.style.cursor = on ? 'pointer' : 'not-allowed';
        b.style.transform = '';
        if (primary) {
          b.style.background = on ? (o.accent || UI_CONTROL) : UI_CONTROL_DIM;
          b.style.boxShadow = on ? RAISED : 'none';
        }
      };
      const press = (down) => {
        if (b.disabled) return;
        b.style.transform = down ? 'translateY(2px)' : '';
        if (primary) b.style.boxShadow = down ? PRESSED : RAISED;
      };
      b.addEventListener('pointerdown', () => press(true));
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
        b.addEventListener(ev, () => press(false));
      }
      b._setEnabled(!o.disabled);
      return b;
    };
    return { wrap, box, mount, mkBtn };
  }

  // Sources use viewport coordinates, independent of Phaser's scaled wrapper.
  // Reposition only for resize/content changes or moving world anchors.
  _placeSpeechBubble(wrap, box, source) {
    let frame = 0, resizeFrame = 0, lastRect = null, lastLayout = null;
    const position = () => {
      if (!wrap.isConnected) return;
      const game = document.getElementById('game');
      const bounds = game?.getBoundingClientRect();
      const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
      const leftLimit = Math.max(10, bounds?.left || 0);
      const rightLimit = Math.min(viewportWidth - 10, bounds?.right || viewportWidth);
      const width = Math.max(180, Math.min(330, rightLimit - leftLimit));
      const target = typeof source === 'function' ? source() : source;
      const candidate = target?.getBoundingClientRect ? target.getBoundingClientRect() : target;
      if (candidate && Number.isFinite(candidate.left ?? candidate.x)) lastRect = candidate;
      const rect = lastRect;
      const x = rect ? (rect.left ?? rect.x) + (rect.width || 0) / 2 : (leftLimit + rightLimit) / 2;
      const y = Math.max(20, Math.min(viewportHeight - 20, rect ? (rect.top ?? rect.y) + (rect.height || 0) / 2 : viewportHeight * .4));
      const below = y < viewportHeight / 2;
      const sourceEdge = y + (below ? 1 : -1) * (rect?.height || 0) / 2;
      const gap = 18;
      const available = Math.max(100, below ? viewportHeight - sourceEdge - gap - 12 : sourceEdge - gap - 12);
      const left = Math.max(leftLimit, Math.min(rightLimit - width, x - width / 2));
      const layout = [width, left, x, sourceEdge, below, available].join(',');
      if (layout === lastLayout) return;
      lastLayout = layout;
      box.style.setProperty('--speech-width', `${width}px`);
      box.style.setProperty('--speech-max-height', `${available}px`);
      box.style.setProperty('--speech-left', `${left}px`);
      box.style.setProperty('--speech-tail-x', `${Math.max(22, Math.min(width - 22, x - left))}px`);
      wrap.dataset.placement = below ? 'below' : 'above';
      box.style.setProperty('--speech-top', `${below ? sourceEdge + gap : sourceEdge - gap - box.offsetHeight}px`);
    };
    const refresh = () => { lastLayout = null; cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(position); };
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refresh) : null;
    resize?.observe(box);
    window.addEventListener('resize', refresh);
    window.visualViewport?.addEventListener('resize', refresh);
    const follow = () => { position(); if (wrap.isConnected) frame = requestAnimationFrame(follow); };
    position();
    if (typeof source === 'function') frame = requestAnimationFrame(follow);
    const removed = new MutationObserver(() => {
      if (wrap.isConnected) return;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      resize?.disconnect();
      removed.disconnect();
      window.removeEventListener('resize', refresh);
      window.visualViewport?.removeEventListener('resize', refresh);
    });
    removed.observe(document.body, { childList: true });
  }

  // Canonical accept/cancel modal for a simple decision. The caller supplies
  // trusted body HTML because feed icons and prices are richer than plain
  // text; this method owns dismissal so every exit closes before one callback.
  showConfirmModal({ id = 'confirm-modal', kind = 'note', title, body,
    acceptLabel = 'OK', cancelLabel = 'Cancel', onAccept, onCancel, art, kindIcon, source }) {
    // A rapid second tap must not replace the first decision or transfer its
    // action to a fresh set of buttons.
    if (document.getElementById(id)) return;

    let wrap;
    let settled = false;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      wrap.remove();
      if (typeof callback === 'function') callback();
    };
    const shell = this.makeModalShell(id, {
      zIndex: 60,
      onClose: () => settle(onCancel),
      kind,
      kindIcon,
      art, source,
    });
    ({ wrap } = shell);
    const { box, mount, mkBtn } = shell;

    if (title) {
      const titleNode = document.createElement('div');
      titleNode.className = 'modal-title';
      titleNode.style.cssText = 'opacity:.85;font-size:13px;margin-bottom:8px;color:#ffe066';
      titleNode.textContent = title;
      box.appendChild(titleNode);
    }
    if (body != null && body !== '') {
      const bodyNode = document.createElement('div');
      bodyNode.style.cssText = 'margin:6px 0 12px';
      if (kind === 'spirit' || kind === 'talk') bodyNode.className = 'modal-speech';
      bodyNode.innerHTML = body;
      box.appendChild(bodyNode);
    }

    const row = document.createElement('div');
    row.className = 'modal-confirm-actions';
    row.style.cssText = 'display:flex;gap:8px;justify-content:center';
    const cancel = mkBtn(cancelLabel, false);
    const accept = mkBtn(acceptLabel, true);
    cancel.addEventListener('click', (e) => { e.stopPropagation(); settle(onCancel); });
    accept.addEventListener('click', (e) => { e.stopPropagation(); settle(onAccept); });
    row.appendChild(cancel);
    row.appendChild(accept);
    box.appendChild(row);
    mount();
  }

  // Simple OK-button modal for ambient game messages (eat effects, status, etc.).
  // `art` (optional) — the story's own SCENE painting (assets/art/ stem); a
  // dialog with one is a STORY unless the caller names another kind.
  // `kind` (optional) — the MODAL_KINDS category; a plain message is a 'note'.
  showMessageModal({ title, body, okLabel, onDismiss, art, portrait, kind = art ? 'story' : 'note', kindLabel, mustAcknowledge = false, source, bookPage = false }) {
    document.getElementById('offer-modal')?.remove();
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      // The wrap is already gone. Post-story consequences run before the
      // next frame, so refresh immunity now while retaining any other story.
      Conditions.setDialogShield(this.save, this._storyDialogOpen?.() || false);
      if (typeof onDismiss === 'function') onDismiss();
    };
    const { wrap, box, mount, mkBtn } = this.makeModalShell('message-modal',
      { zIndex: 60, onClose: mustAcknowledge ? undefined : dismiss, kind: kind, kindLabel, art: bookPage ? false : art, portrait, source, bookPage, header: !bookPage });
    const safeBody = String(body).replace(/\n/g, '<br>');
    // No title, no title line: a page whose own heading is in the body (the
    // Book's volume line) starts on it, with no empty gold row above.
    const titleHTML = title
      ? `<div class="modal-title" style="opacity:.85;font-size:13px;margin-bottom:8px;color:#ffe066">${kind === 'memory' ? this.iconSpanHTML('memory', 18) + ' ' : ''}${title}</div>`
      : '';
    box.innerHTML = titleHTML + `<div class="${kind === 'spirit' || kind === 'talk' ? 'modal-speech' : ''}" style="margin:6px 0 12px;white-space:pre-wrap">${safeBody}</div>`;
    const speech = kind === 'spirit' || kind === 'talk';
    const btn = mkBtn(okLabel || (speech ? 'Got it' : 'OK'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap.remove();
      dismiss();
    });
    box.appendChild(btn);
    mount();
    if (speech) {
      const opened = performance.now();
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input, select, textarea') || performance.now() - opened < 2000) return;
        e.preventDefault();
        e.stopPropagation();
        wrap.remove();
        dismiss();
      });
    }
  }

  // Watch #game for modal dialogs and mirror their presence onto a
  // body.modal-open class. CSS uses it to hide the movement pads while any
  // dialog is up — the pads are fixed on <body> above #game's transform
  // stacking context, so without this they'd cover an open modal and steal the
  // taps meant to close it (the "taps stop working after opening a crate" bug).
  // Observing #game's direct children is enough: makeModalShell appends every
  // wrap there, and pads created mid-dialog are caught by the CSS rule itself.
  _installModalPadGate() {
    if (typeof MutationObserver === 'undefined') return;
    this._modalPadObserver?.disconnect();
    const gameEl = document.getElementById('game');
    // The four hand-written overlays in index.html (#story / #safety /
    // #locating / #howto) carry .game-modal too, but unlike makeModalShell's
    // wraps they are always IN the document and toggle display — so presence
    // alone can't gate anything, or the HUD would hide forever. Test that the
    // element actually renders: getClientRects() is empty under display:none
    // and non-empty for a visible fixed-position overlay (offsetParent is null
    // for those, so it can't be used here).
    const shown = (el) => el.getClientRects().length > 0;
    const sync = () => {
      // The upper temple is a Phaser scene, so it has no DOM modal to query.
      // Keep its HUD gate until TempleScene's shutdown clears the scene flag.
      const openModals = [...document.querySelectorAll('.game-modal')].filter(shown);
      const any = !!this._templeSceneActive || openModals.length > 0;
      const speechOnly = any && !this._templeSceneActive && openModals.every(el => el.classList.contains('speech-dialog'));
      if (speechOnly && !document.body.classList.contains('speech-open')) {
        // A bubble may replace a mechanical panel in the same event turn.
        // Sample the HUD's normal display, not the outgoing sheet's gate.
        document.body.classList.remove('modal-open');
        for (const el of document.querySelectorAll('#map-zoom, #move-pad, #gps-pad, #inv-tabs, #inv, #inv-name, #hud, #objective, #menu, #mp-btn, #compass-inventory-shutter')) {
          el.style.setProperty('--speech-display', getComputedStyle(el).display);
        }
      }
      document.body.classList.toggle('modal-open', any);
      document.body.classList.toggle('speech-open', speechOnly);
      if (any && this._movePadHeld) this._resetMovePad?.();
      // The chassis lives outside the scaled game. Clip at the sheet's actual
      // screen edge, retaining silver shoulders around the circular map. Its
      // layout position ignores the entrance transform and follows resizing.
      if (document.getElementById('compass-body')) {
        const money = document.getElementById('money');
        const moneyTop = money && shown(money) ? money.getBoundingClientRect().top : null;
        for (const box of document.querySelectorAll('.compass-panel[data-kind="story"] > .modal-box')) {
          const wrap = box.parentElement, bounds = wrap.getBoundingClientRect();
          const scale = bounds.height / wrap.offsetHeight;
          if (moneyTop != null && scale > 0) {
            // Keep the story rail above the whole coin readout, even when
            // the scaled game and body-level HUD use different coordinates.
            const top = `${Math.max(0, (moneyTop - 6 - bounds.top) / scale)}px`;
            if (box.style.getPropertyValue('--story-panel-top') !== top) {
              box.style.setProperty('--story-panel-top', top);
            }
          }
        }
        const tops = [...document.querySelectorAll('.compass-panel > .modal-box')]
          .filter(shown).map(el => {
            const wrap = el.parentElement, bounds = wrap.getBoundingClientRect();
            return bounds.top + el.offsetTop * bounds.height / wrap.offsetHeight;
          });
        if (tops.length) {
          const edge = `${Math.max(0, Math.min(...tops))}px`;
          if (document.body.style.getPropertyValue('--compass-panel-edge') !== edge) {
            document.body.style.setProperty('--compass-panel-edge', edge);
          }
        } else if (document.body.style.getPropertyValue('--compass-panel-edge')) {
          document.body.style.removeProperty('--compass-panel-edge');
        }
      }
      // The ☰ menu is hidden under the class (index.html); fold it shut as
      // well, so a menu left open behind a dialog doesn't spring back open
      // the moment the dialog is dismissed.
      // Its OWN dialogs (#menu-modal, _openMenuDialog; #menu-page-modal, a
      // page of it, _openMenuPage) are the menu itself, not a dialog over
      // it — counting one would shut the menu the frame it opens.
      if (openModals.some(el => el.id !== 'menu-modal' && el.id !== 'menu-page-modal')) {
        const m = document.getElementById('menu'); if (m && m.open) m.open = false;
      }
      // Nothing covering the screen: anything the starter ladder is holding can
      // be said now (_celebrateStarterStep). The test is "no modal" rather than
      // "a modal just closed" because when a step completes the answer is not
      // yet knowable: the chest handler credits the step one line BEFORE it
      // opens the reward modal. One frame later it is.
      if (any && this._pendingStarterCheers?.length) this._starterCheerBehindDialog = true;
      if (!any) this._flushStarterCheers();
    };
    this._modalPadObserver = new MutationObserver(sync);
    // makeModalShell appends its wrap as a direct child of #game…
    if (gameEl) this._modalPadObserver.observe(gameEl, { childList: true });
    this._modalPadObserver.observe(document.body, { childList: true });
    // …and the static overlays just flip their own style, so watch that.
    for (const id of ['story', 'safety', 'locating', 'howto', 'tooshort']) {
      const el = document.getElementById(id);
      if (el) this._modalPadObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    const observer = this._modalPadObserver;
    this.events?.once('shutdown', () => {
      observer.disconnect();
      if (this._modalPadObserver === observer) {
        delete this._modalPadObserver;
        delete this._syncModalGate;
      }
    });
    // The observer alone is not enough: an overlay that is REMOVED from the
    // document (the story and safety cards are, rather than hidden) fires no
    // mutation any of the above watches, so the class latched on and the whole
    // HUD stayed hidden. The per-frame call in update() is the backstop — a
    // querySelectorAll over a handful of .game-modal nodes.
    this._syncModalGate = sync;
    sync();
  }

  // Canonical "trade with the shopkeep" modal. Used by every shop path —
  // sell, buy, relic, blacksmith forge — so the chrome (stone-tablet panel,
  // Cancel/accept layout, dismiss-on-overlay-click) stays in one place.
  //   title:        small caption ("A trader offers:")
  //   get:          HTML for the headline (gear icon + name, item ×1, +$5)
  //   blurb:        OPTIONAL HTML, smaller text below `get` (e.g. relic effect)
  //   cost:         HTML for the price line ("$30", "1× icon Item", "5× gem")
  //   canAfford:    grey out the accept button when false
  //   disabledReason: explain a non-money blocker without marking the cost unaffordable
  //   onAccept:     called after the modal closes
  //   repeat:       re-present a counter after each transaction with live state
  //   onCancel:     optional work deferred until the player leaves
  //   acceptLabel:  primary button label ('Buy' default; 'Sell' / 'Trade'…)
  //   cancelLabel:  dismiss button label. Defaults to 'Cancel'; pass 'Later'
  //                 for offers tied to a persistent venue (a shop, a wreck,
  //                 a sealed building) the player can simply come back to —
  //                 "Later" reads as "still on the table" rather than "gone".
  //   secondary:    OPTIONAL { label: HTML, disabled: bool, onClick: fn, withChoice?, takes? }
  //                 — rendered between Cancel and accept (re-roll button).
  //                 `withChoice`: a second way to ACCEPT the pick (restore
  //                 with the hammer): armed exactly as accept is, and its
  //                 onClick receives the selected card's key. `takes(key)`
  //                 (optional, with withChoice) says whether that card may
  //                 be accepted this way — the hammer refuses a plain
  //                 House — and the button greys on a card it refuses.
  //   pager:        OPTIONAL { index, count, onPrev, onNext } — the page is
  //                 one of `count` options (a smelt bar, a Home recipe), and
  //                 small ‹ › arrows flank the `get` line with an "i / n"
  //                 under it (paging is not an action, so no extra button).
  //                 `showIndex: false` drops the "i / n" line and keeps the arrows.
  //   choices:      OPTIONAL [{ key, label, info, iconHTML?, suggested?, cost?, canAfford?, disabled? }]
  //                 — the offer is ONE OF several things (what a wreck is
  //                 restored as). Laid out as cards between the headline and
  //                 the cost; a tap SELECTS a card (outlined, its `info` on
  //                 the line under the row) and only the accept button pays,
  //                 with the selected `key` as its argument. A card with its
  //                 own `cost` (and `canAfford`) puts THAT on the cost line
  //                 when it is selected and arms accept by it — the cards
  //                 need not share a price.
  //                 Until a card is selected `pickHint` sits on that line and
  //                 accept is disabled; `choice` names a card selected from
  //                 the start (a single card is selected on its own, so the
  //                 dialog reads as the plain price tag it is). A `suggested`
  //                 card wears a soft outline until something is picked.
  showOfferModal({ headline, title, get, blurb, cost, canAfford, disabledReason, onAccept, repeat, receipt, onCancel, acceptLabel = 'Buy', cancelLabel = 'Cancel', secondary, pager, tabs, forLabel = 'for', getLabel, costLabel, kind, kindLabel, kindIcon, art, portrait, fullscreen = false, source, choices, choice = null, pickHint = 'Tap one to see what it does' }) {
    // What the last accept of a REPEAT offer said (its flashLoot / flash
    // toasts, captured by the accept below): those draw on the map behind
    // this dialog, so the dialog that reopens prints them as its receipt.
    const offerToasts = this._offerToasts; this._offerToasts = null;
    let closed = false;
    const close = (reason = 'cancel') => {
      if (closed) return false;
      closed = true;
      wrap.remove();
      if (reason === 'cancel' || reason === 'hit') onCancel?.();
      return true;
    };
    const { wrap, box, mount, mkBtn } = this.makeModalShell('offer-modal',
      { onClose: repeat ? undefined : () => close(), kind, kindLabel, kindIcon, art, portrait, fullscreen, source,
        scrollContent: kind === 'build' && choices?.length > 0 });
    // Transitions and acceptance retain pending work; leaving or interruption
    // releases it exactly once, after the wrapper is out of the document.
    wrap.closeModal = close;
    // Optional tab row (e.g. the blacksmith's Forge / Smelt switch). Each tab
    // is { label, active, onSelect }. Tapping an inactive tab closes this modal
    // and calls onSelect, which re-presents the sibling modal — cheap "tabs"
    // without restructuring the single-offer modal into a stateful panel.
    if (tabs && tabs.length) {
      const tabRow = document.createElement('div');
      tabRow.style.cssText = 'display:flex;gap:4px;justify-content:center;margin-bottom:4px;';
      for (const t of tabs) {
        const tb = mkBtn(t.label, { variant: 'ghost', css:
          'flex:1;padding:6px 4px;border-radius:6px 6px 0 0;font:700 12px var(--font-ui);border-bottom:none;'
          + (t.active
              ? 'background:#3a3322;color:#ffe066;border-color:#c8a64a;'
              : 'color:#999;') });
        if (!t.active) {
          tb.addEventListener('click', (e) => { e.stopPropagation(); close('transition'); t.onSelect(); });
        }
        tabRow.appendChild(tb);
      }
      box.appendChild(tabRow);
    }
    // Built from individual nodes so choice controls can update the
    // get/cost lines without re-rendering the whole modal.
    if (title) {
      const titleDiv = document.createElement('div');
      titleDiv.style.cssText = 'opacity:.75;font-size:11px;margin-bottom:6px';
      titleDiv.textContent = title;
      box.appendChild(titleDiv);
    }
    // `getLabel` / `costLabel` caption the two halves of a goods-for-goods
    // trade ("You receive" / "You give") so which side is the price is not a
    // guess; `costLabel` REPLACES the "for" row rather than stacking on it.
    const mkCaption = (text) => {
      const c = document.createElement('div');
      c.style.cssText = 'font:700 10px var(--font-ui);letter-spacing:.12em;'
        + 'text-transform:uppercase;opacity:.6;margin:6px 0 2px';
      c.textContent = text;
      return c;
    };
    if (getLabel) box.appendChild(mkCaption(getLabel));
    const getDiv = document.createElement('div');
    // `headline: 'banner'` dresses the headline as a title (a castle quest's
    // name): larger, glowing and ruled off from the caption and the blurb.
    getDiv.style.cssText = headline === 'banner'
      ? 'font:800 22px/1.25 var(--font-ui);letter-spacing:.02em;margin:4px 0 8px;padding:6px 0;color:#ffe066;'
        + 'text-shadow:0 2px 0 #5a3d0a,0 0 12px rgba(255,200,80,.45);'
        + 'border-top:1px solid rgba(200,166,74,.55);border-bottom:1px solid rgba(200,166,74,.55)'
      : 'font-size:16px;font-weight:700;margin:2px 0;color:#ffe066';
    getDiv.innerHTML = get ?? '';
    if (pager?.options?.length) {
      // Recipe counters can jump straight to any known recipe, including
      // unavailable ones whose ingredient requirements the player wants to see.
      const picker = document.createElement('div');
      picker.className = 'recipe-picker';
      picker.style.cssText = 'display:grid;grid-template-columns:36px minmax(0,1fr);align-items:center;gap:10px;margin:4px 0;';
      const icon = document.createElement('span');
      icon.style.cssText = 'line-height:0;text-align:center;';
      icon.innerHTML = pager.iconHTML || '';
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Recipe');
      select.setAttribute('aria-describedby', 'offer-recipe-caption');
      select.style.cssText = 'width:100%;min-width:0;min-height:44px;padding:8px;border:1px solid #8c7950;border-radius:6px;background:#211c15;color:#ffe066;font:700 15px var(--font-ui);';
      pager.options.forEach((option, index) => {
        const node = document.createElement('option');
        node.value = String(index); node.textContent = option.label;
        select.appendChild(node);
      });
      select.value = String(pager.index);
      select.addEventListener('change', (e) => {
        e.stopPropagation();
        const selected = pager.options[Number(select.value)];
        if (!selected || Number(select.value) === pager.index) return;
        close('transition'); selected.onSelect();
      });
      picker.appendChild(icon); picker.appendChild(select); box.appendChild(picker);
      const caption = document.createElement('div');
      caption.id = 'offer-recipe-caption';
      caption.style.cssText = 'font-size:12px;color:#c9c1af;margin:0 0 4px;';
      caption.textContent = pager.caption || `${pager.index + 1} / ${pager.count}`;
      box.appendChild(caption);
    } else if (pager && pager.count > 1) {
      const pageRow = document.createElement('div');
      pageRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;';
      const mkArrow = (glyph, aria, fn) => {
        const b = mkBtn(glyph, { variant: 'ghost', css:
          'flex:none;width:32px;height:32px;border-radius:50%;line-height:1;font:700 18px var(--font-ui);' });
        b.setAttribute('aria-label', aria);
        b.addEventListener('click', (e) => { e.stopPropagation(); close('transition'); fn(); });
        return b;
      };
      getDiv.style.flex = '1';
      pageRow.appendChild(mkArrow('‹', 'Previous', pager.onPrev));
      pageRow.appendChild(getDiv);
      pageRow.appendChild(mkArrow('›', 'Next', pager.onNext));
      box.appendChild(pageRow);
      if (pager.showIndex !== false) {
        const pageNo = document.createElement('div');
        pageNo.style.cssText = 'font:700 10px var(--font-ui);opacity:.55;margin-bottom:2px';
        pageNo.textContent = `${pager.index + 1} / ${pager.count}`;
        box.appendChild(pageNo);
      }
    } else if (get != null && get !== '') {
      // No headline (the wreck's pick): the cards start at the top.
      box.appendChild(getDiv);
    }
    if (blurb) {
      const blurbDiv = document.createElement('div');
      blurbDiv.style.cssText = 'font-size:11px;opacity:.75;margin-bottom:4px';
      blurbDiv.innerHTML = blurb;
      box.appendChild(blurbDiv);
    }
    // The choice cards (see `choices` above). A row that wraps, so six
    // buildings fit a phone two or three to a line; the accept button below
    // is armed by `syncAccept` once it exists.
    const hasChoices = Array.isArray(choices) && choices.length > 0;
    let selected = null;
    let syncAccept = () => {};
    let liveCanAfford = canAfford;
    let costDiv = null;
    // Cards that price themselves and carry no `info` (the wreck's build
    // pick) spend the dialog's height on the cards: no info line, no cost
    // caption — the hint and then the price sit on the one cost line.
    const priced = hasChoices && choices.some((c) => c.cost != null) && !choices.some((c) => c.info);
    // The selected card's own price, if it carries one, onto the cost line.
    const applyChoiceCost = () => {
      if (!selected || selected.cost == null) return;
      liveCanAfford = selected.canAfford !== false;
      if (costDiv) { costDiv.innerHTML = selected.cost; costDiv.style.color = liveCanAfford ? '#a7ffb0' : '#ff8a7a'; }
    };
    if (hasChoices) {
      const cardRow = document.createElement('div');
      // Fullscreen: an even grid of larger cards; otherwise three to a line.
      cardRow.style.cssText = fullscreen
        ? 'display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;margin:10px 0 4px;'
        : 'display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin:2px 0 2px;';
      // Cards with no `info` (names and badges only) need just the hint line
      // — and when they price themselves, not even that: the hint sits on
      // the cost line until a card is picked (the dialog's height is what
      // a six-card pick spends it on).
      const anyInfo = choices.some((c) => c.info);
      const infoLine = document.createElement('div');
      infoLine.style.cssText = 'font-size:12px;line-height:1.35;opacity:.9;margin:4px 0 6px;'
        + `min-height:${anyInfo ? 2.7 : 1.4}em;`;
      const cards = [];
      const paint = () => {
        for (const { c, b } of cards) {
          b.ariaPressed = String(selected === c);
          b.style.outline = selected === c ? '2px solid #ffe066'
            : (!selected && c.suggested) ? '2px dashed #a7ffb0' : '';
        }
        infoLine.innerHTML = selected ? (selected.info || '') : `<span style="opacity:.6">${pickHint}</span>`;
        applyChoiceCost();
        syncAccept();
      };
      for (const c of choices) {
        const b = mkBtn((c.iconHTML ? `<div style="font-size:0;margin-bottom:2px">${c.iconHTML}</div>` : '') + c.label,
          { variant: 'ghost', disabled: !!c.disabled, css: (fullscreen
            ? 'padding:12px 6px 10px;font:700 13px var(--font-ui);'
            : 'flex:1 1 30%;min-width:84px;max-width:32.5%;padding:5px 3px 3px;font:700 12px var(--font-ui);')
            + 'border-radius:7px;' });
        b.addEventListener('click', (e) => { e.stopPropagation(); if (c.disabled) return; selected = c; paint(); });
        cardRow.appendChild(b);
        cards.push({ c, b });
      }
      box.appendChild(cardRow);
      if (!priced) box.appendChild(infoLine);
      selected = choices.length === 1 ? choices[0] : (choices.find((c) => c.key === choice) || null);
      if (selected?.disabled) selected = null;
      paint();
    }
    // `cost` is what the player PAYS, the second half of "you get X FOR y";
    // `forLabel` is the literal word joining them. Callers that are no trade
    // (the quest board) pass no cost and get neither row.
    const hasCost = (cost != null && cost !== '') || (hasChoices && choices.some((c) => c.cost != null));
    if (hasCost) {
      if (priced) {
        // no caption: the line below is the cost
      } else if (costLabel) {
        box.appendChild(mkCaption(costLabel));
      } else if (forLabel) {
        const forDiv = document.createElement('div');
        forDiv.style.cssText = 'opacity:.85;margin:6px 0 4px';
        forDiv.textContent = forLabel;
        box.appendChild(forDiv);
      }
      costDiv = document.createElement('div');
      costDiv.className = 'offer-cost';
      costDiv.setAttribute('aria-live', 'polite');
      costDiv.style.cssText = priced ? 'font-size:15px;font-weight:700;margin:4px 0 6px;' : 'font-size:16px;font-weight:700;margin:3px 0 8px;';
      costDiv.style.color = canAfford ? '#a7ffb0' : '#ff8a7a';
      // No price until a card is picked: the hint sits on the line instead.
      costDiv.innerHTML = (cost != null && cost !== '') ? cost
        : `<span style="opacity:.6;font-weight:400;font-size:12px">${pickHint}</span>`;
      box.appendChild(costDiv);
      applyChoiceCost();
    }
    if (disabledReason) {
      const reason = document.createElement('div');
      reason.className = 'offer-disabled-reason';
      reason.style.cssText = 'color:#ffcf8a;font-size:13px;margin:4px 0;';
      reason.textContent = disabledReason;
      box.appendChild(reason);
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;justify-content:center;margin-top:4px;flex-wrap:wrap;';
    // A repeating counter covers canvas loot toasts. Keep its last completed
    // transaction visible beside the controls in the refreshed dialog.
    if (receipt) {
      const status = document.createElement('div');
      status.setAttribute('role', 'status');
      status.style.cssText = `color:${UI_GOLD};font-size:12px;margin:6px 0;`;
      status.textContent = `✓ ${receipt}`;
      box.appendChild(status);
    } else if (offerToasts?.length) {
      // A loot toast reads as it did on the map (its icon, its text, ✓); a
      // note (a refusal: "Need 2 more Iron", a full bag) reads plain.
      const esc = (t) => String(t).replace(/\n/g, ' ').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
      const status = document.createElement('div');
      status.setAttribute('role', 'status');
      status.style.cssText = `color:${UI_GOLD};font-size:12px;margin:6px 0;`;
      status.innerHTML = offerToasts.map(t => t.loot
        ? `✓ ${t.itemId && this.iconSpanHTML ? this.iconSpanHTML(t.itemId, 16) + ' ' : ''}${esc(t.text)}`
        : `<span style="color:#ddd">${esc(t.text)}</span>`).join('<br>');
      box.appendChild(status);
    }
    const cancel = mkBtn(cancelLabel, false, false);
    const sec    = secondary ? mkBtn(secondary.label, false, !!secondary.disabled || !!(secondary.withChoice && hasChoices && !selected)) : null;
    const accept = mkBtn(acceptLabel, true, !canAfford || !!disabledReason || (hasChoices && !selected));
    cancel.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    let accepted = false;
    accept.addEventListener('click', (e) => {
      e.stopPropagation();
      if (closed || accepted || accept.disabled) return;
      if (hasChoices && !selected) return;
      accepted = true;
      close('accept');
      if (repeat) this._offerToastLog = [];
      try { onAccept(hasChoices ? selected.key : undefined); }
      finally { if (repeat) { this._offerToasts = this._offerToastLog; this._offerToastLog = null; } }
      if (repeat) { repeat(); this._offerToasts = null; }
    });
    if (hasChoices) {
      syncAccept = () => {
        const armed = liveCanAfford && !disabledReason && !!selected;
        accept.innerHTML = selected?.acceptLabel || acceptLabel;
        accept._setEnabled(armed);
        if (sec && secondary.withChoice) {
          sec._setEnabled(armed && !secondary.disabled && (!secondary.takes || !!secondary.takes(selected.key)));
        }
      };
      syncAccept();
    }
    if (sec) sec.addEventListener('click', (e) => {
      e.stopPropagation();
      if (secondary.withChoice) {
        if (accepted || sec.disabled || (hasChoices && !selected)) return;
        accepted = true;
        close('transition');
        secondary.onClick(hasChoices ? selected.key : undefined);
        return;
      }
      close('transition'); secondary.onClick();
    });
    row.className = 'offer-actions';
    row.appendChild(cancel);
    if (sec) row.appendChild(sec);
    row.appendChild(accept);
    box.appendChild(row);
    mount();
  }

  // Big "ceremony" modal for chest opens — chest loot earns a stop-everything
  // celebration (the player walked over and tapped a chest; they want to
  // SEE what they got). Tap anywhere to dismiss. Quick-feedback pickups
  // (X-marks, harvests, mining drops) keep using flashLoot — only chests
  // route through this.
  //
  //   iconHTML      string? → HTML for the icon (renderItemIcon('inline')
  //                          for items, gearIconHTML for relics, or a
  //                          standalone emoji span for gold). Omit it and
  //                          the row is not drawn at all — right for a
  //                          ceremony whose art banner or buttons already
  //                          carry the picture.
  //   name          string → big bold label (e.g. "Egg", "Wood Pickaxe").
  //   sub           string? → smaller line under the name (e.g. "× 3"
  //                          for stacks, or a relic-equipped tagline).
  //   color         string? → tier / semantic colour for the NAME + qty lines
  //                          (rarity tier, coin gold, …). Defaults to the
  //                          treasure blue-white.
  //   accent        string? → the modal's CHROME colour: frame, sparkle burst,
  //                          primary button. Defaults to UI_TREASURE, because
  //                          this modal is the treasure ceremony (spec
  //                          §UI COLOUR LANGUAGE: blue-white = treasure &
  //                          powerups). The few NON-treasure ceremonies that
  //                          reuse this shell (passing out, restoring a wreck)
  //                          pass their own accent so they don't read as loot.
  //   onDismiss     fn?    → called after the modal closes.
  //   actions       array? → [{ label, primary?, onClick }]. When present the
  //                          modal becomes a CHOICE (explicit buttons, no
  //                          tap-to-dismiss) instead of a tap-to-continue
  //                          acknowledgement — used for the bag-full chest open.
  //                          An action may carry `info` (HTML): in the card
  //                          pick it is the line shown under the row while
  //                          that card is selected (what the thing does).
  //   cards         bool?  → lay the actions out as equal-width cards on ONE
  //                          row (the pick) instead of wrapping word buttons.
  //                          A card is SELECTED by a tap (outlined, its info
  //                          below), and paid only by the one `confirmLabel`
  //                          button under the row — so a card is read and
  //                          compared before it is taken, and nothing is
  //                          chosen by looking. Until a tap, `pickHint` sits
  //                          on that line and the button is disabled.
  //   confirmLabel  string? → the pick's button (default 'Take').
  //   pickHint      string? → the line under an unselected row.
  //   desc          string? → what the reward IS (Rewards.desc); when present
  //                          the body splits, found on the left, desc right.
  //   kindIcon      string? → HTML for the kind header's hero GLYPH, replacing
  //                          the MODAL_KINDS emoji (see makeModalShell). The
  //                          chest ceremony passes the sprite the chest it came
  //                          out of was standing as — scene.worldIconHTML off
  //                          loot.js chestLook's texKey — so a crate opens
  //                          under a crate and a trunk under a trunk.
  // `header` is the legacy per-reward line ('Thou hast traveled far', 'Restored!').
  // It now feeds the shared kind header as a LABEL OVERRIDE — the dialog keeps
  // its outcome wording and gains the kind's hero icon — so this modal shows
  // one header, not two. Callers that say nothing get TREASURE, which is what
  // a chest is.
  // `tier` (1..7) hangs the TIER BADGE (items.js tierBadgeHTML — the rarity
  // word on its ore's colour) under the name: an item's baseTier, a relic's
  // own tier. Left out for cash, a story card or a pick with no one thing.
  // A BABY PET found (a nest bush, `how` 'bush') or hatched (an egg, `how`
  // 'egg') — the reward ceremony on the farm painting, the baby drawn small.
  // One fact, told through the world: it wants setting down, and it grows.
  showBabyFound(babyId, how) {
    const item = ITEM_BY_ID[babyId];
    if (!item) return;
    const hatched = how === 'egg';
    this.showChestRewardModal({
      kind: 'farm',
      header: hatched ? 'Hatched' : 'Found',
      iconHTML: this.iconSpanHTML ? this.iconSpanHTML(babyId, 36) : '',
      name: item.name,
      sub: hatched
        ? `The shell falls away, and a hungry baby blinks up at you. Give it its favourite food, then catch it to make it your pet. Feed it ${SpriteLayout.PET_BABY.feeds} times to raise it to adulthood in ${spokenDuration(SpriteLayout.PET_BABY.growMs)}.`
        : `You find a baby curled in the leaves. Give it its favourite food, then catch it to make it your pet. Feed it ${SpriteLayout.PET_BABY.feeds} times to raise it to adulthood in ${spokenDuration(SpriteLayout.PET_BABY.growMs)}.`,
      color: UI_TREASURE,
      tier: item.baseTier || 0,
    });
  }
  showChestRewardModal({ iconHTML, name, sub, qty, color = UI_TREASURE, accent = UI_TREASURE,
    onDismiss, header, kind = 'treasure', kindIcon, actions, art, portrait, source, cards = false, tier = 0, desc,
    confirmLabel = 'Take', pickHint = 'Tap one to see what it does' }) {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('chest-reward-modal', {
      zIndex: 55, borderColor: accent, wrapBg: '#000c', art, portrait, centerBody: true,
      kind, kindLabel: header, kindIcon, source,
      wrapExtra: 'animation:chestModalIn 180ms ease-out;',
      boxExtra: `border-width:3px;border-radius:14px;padding:12px 14px 10px;font-size:14px;` +
        `animation:chestRewardPop 320ms cubic-bezier(.34,1.56,.64,1);`,
    });
    // Keyframes injected once. The sparkle keyframe reads its drift vector
    // from per-element --dx/--dy so one rule serves every sparkle.
    if (!document.getElementById('chest-modal-css')) {
      const s = document.createElement('style');
      s.id = 'chest-modal-css';
      s.textContent =
        '@keyframes chestModalIn { from { opacity:0 } to { opacity:1 } }' +
        '@keyframes chestRewardPop { 0% { transform:scale(.6); opacity:0 } ' +
        '60% { transform:scale(1.08); opacity:1 } 100% { transform:scale(1); opacity:1 } }' +
        '@keyframes chestSparkle {' +
        ' 0%   { transform: translate(-50%, -50%) scale(0);   opacity: 0 }' +
        ' 18%  { transform: translate(calc(-50% + var(--dx) * 0.18), calc(-50% + var(--dy) * 0.18)) scale(1.15); opacity: 1 }' +
        ' 100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.35); opacity: 0 }' +
        '}';
      document.head.appendChild(s);
    }
    // Keep the item and its amount together; rarity sits on the next line.
    const qtyHtml = qty ? ` <span style="white-space:nowrap">${qty}</span>` : '';
    const subHtml = sub
      ? `<div class="${kind === 'spirit' || kind === 'talk' ? 'modal-speech' : ''}" style="margin-top:4px;font-size:13px;opacity:.85">${sub}</div>`
      : '';
    const badge = (tier > 0 && typeof tierBadgeHTML === 'function') ? tierBadgeHTML(tier, 11) : '';
    const tierHtml = badge ? `<div style="margin-top:6px;line-height:0">${badge}</div>` : '';
    const hasActions = Array.isArray(actions) && actions.length > 0;
    const found =
      // The icon row is optional and collapses when a card passes no
      // iconHTML: the story cards let the banner carry the picture, and a
      // ceremony with an art banner plus card buttons (the trail pick) has
      // no room for a third picture - an empty div would still cost its
      // margins as a blank band under the banner.
      (iconHTML ? `<div style="margin:0 0 6px;font-size:0">${iconHTML}</div>` : '') +
      `<div style="font-size:18px;font-weight:700;color:${color};line-height:1.2">${name}${qtyHtml}</div>` +
      tierHtml +
      subHtml;
    // A reward card with a `desc` (Rewards.desc — the item's own ITEM_EFFECTS
    // line or gear blurb) splits in two: what was found on the left, what it
    // is on the right. No desc (gold, a story card) keeps the single column.
    box.innerHTML = desc
      ? '<div class="reward-split" style="display:flex;gap:12px;align-items:center">' +
          `<div style="flex:1 1 0;min-width:0">${found}</div>` +
          `<div class="reward-desc" style="flex:1 1 0;min-width:0;text-align:left;font-size:13px;line-height:1.4;` +
            `opacity:.9;padding-left:12px;border-left:1px solid ${accent}55">${desc}</div>` +
        '</div>'
      : found;
    const close = () => {
      wrap.remove();
      if (typeof onDismiss === 'function') onDismiss();
    };
    if (hasActions) {
      // Choice variant: explicit buttons, and NO tap-to-dismiss — the player
      // must pick an action so the chest is never left half-resolved. Overlay
      // clicks are inert (no close listener on wrap).
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:' + (cards ? 6 : 8) + 'px;justify-content:center;margin-top:10px;'
        + (cards ? 'flex-wrap:nowrap;align-items:stretch;' : 'flex-wrap:wrap;');
      // One shared line under the row: the pick's hint, then the SELECTED
      // card's info. Word buttons (no cards) have no line.
      const infoLine = document.createElement('div');
      infoLine.style.cssText = 'margin-top:6px;font-size:12px;line-height:1.35;opacity:.9;min-height:1.35em;'
        + (cards ? '' : 'display:none;');
      if (cards) infoLine.innerHTML = `<span style="opacity:.6">${pickHint}</span>`;
      const choose = (a) => {
        wrap.remove();
        if (typeof a.onClick === 'function') a.onClick();
        if (typeof onDismiss === 'function') onDismiss();
      };
      let selected = null;
      let take = null;
      // The card buttons: a primary word in the ceremony's accent (the shell's
      // raised control), the rest ghosts. A card row's buttons share the row.
      const cardCss = 'position:relative;border-radius:7px;font:700 12px var(--font-ui);' +
        (cards ? 'flex:1 1 0;min-width:0;padding:8px 4px 6px;' : 'padding:9px 14px;');
      for (const a of actions) {
        const b = mkBtn(a.label, a.primary ? { accent, css: cardCss } : { variant: 'ghost', css: cardCss });
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!cards) { choose(a); return; }
          // A tap on a card SELECTS it: the outline moves, its line shows,
          // the Take button arms. Selecting a card never pays it.
          selected = a;
          for (const other of row.children) other.style.outline = other === b ? `2px solid ${accent}` : '';
          infoLine.innerHTML = a.info || '';
          if (take) take._setEnabled(true);
        });
        row.appendChild(b);
      }
      box.appendChild(row);
      box.appendChild(infoLine);
      if (cards) {
        // The one button that pays: the shell's primary in the ceremony's
        // accent, dead until a card is selected.
        take = mkBtn(confirmLabel, { accent, css:
          'margin-top:8px;min-width:55%;padding:10px 18px;border-radius:7px;font:700 14px var(--font-ui);' });
        take._setEnabled(false);
        take.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selected) choose(selected);
        });
        box.appendChild(take);
      }
    } else {
      const ok = mkBtn(kind === 'spirit' || kind === 'talk' ? 'Got it' : 'OK', { accent, css: 'margin-top:14px;min-width:90px;padding:10px 18px;' });
      ok.addEventListener('click', (e) => { e.stopPropagation(); close(); });
      box.appendChild(ok);
    }
    mount();
    if (kind === 'spirit' || kind === 'talk') {
      if (!hasActions) {
        const opened = performance.now();
        wrap.addEventListener('click', (e) => {
          if (e.target.closest('button, a, input, select, textarea') || performance.now() - opened < 2000) return;
          e.preventDefault(); e.stopPropagation(); close();
        });
      }
      return;
    }
    // Sparkle burst around the modal. Spawned AFTER the wrap is in the DOM so
    // getBoundingClientRect() gives the box's real footprint; each sparkle
    // animates from a random perimeter point outward along its --dx/--dy.
    requestAnimationFrame(() => {
      const wr = wrap.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      // Coords RELATIVE to wrap (which is the absolute-positioned overlay).
      const bx = br.left - wr.left, by = br.top - wr.top;
      const bw = br.width, bh = br.height;
      const SPARKLE_COUNT = 14;
      for (let i = 0; i < SPARKLE_COUNT; i++) {
        // Pick a point on the box perimeter (parametrise the rectangle by
        // its perimeter length so corners aren't oversampled).
        const t = Math.random() * 2 * (bw + bh);
        let px, py;
        if (t < bw)                        { px = bx + t;            py = by; }
        else if (t < bw + bh)              { px = bx + bw;           py = by + (t - bw); }
        else if (t < 2 * bw + bh)          { px = bx + bw - (t - bw - bh); py = by + bh; }
        else                                { px = bx;                py = by + bh - (t - 2 * bw - bh); }
        // Drift outward from the box centre — vector from centre through the
        // perimeter point, scaled to 40..90 px.
        const cx = bx + bw / 2, cy = by + bh / 2;
        let vx = px - cx, vy = py - cy;
        const vlen = Math.hypot(vx, vy) || 1;
        const drift = 40 + Math.random() * 50;
        const dx = (vx / vlen) * drift;
        const dy = (vy / vlen) * drift;
        const sp = document.createElement('div');
        const size = 8 + Math.floor(Math.random() * 6);   // 8..13 px
        const delay = Math.random() * 220;                // 0..220 ms stagger
        sp.style.cssText =
          `position:absolute;left:${px}px;top:${py}px;` +
          `width:${size}px;height:${size}px;pointer-events:none;` +
          `--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px;` +
          // Soft radial glow: white core on an accent halo fading to transparent.
          `background:` +
            `radial-gradient(circle at 50% 50%, #ffffff 0%, #ffffff 18%, ` +
            `${accent} 40%, ${accent}88 65%, transparent 100%);` +
          `border-radius:50%;` +
          `box-shadow:0 0 6px 1px ${accent}cc, 0 0 12px 2px ${accent}55;` +
          `transform:translate(-50%,-50%) scale(0);opacity:0;` +
          `animation:chestSparkle 1100ms ease-out ${delay.toFixed(0)}ms forwards;`;
        wrap.appendChild(sp);
      }
    });
  }
}

// Copy every own method / accessor of `Mixin.prototype` (except constructor)
// onto `Target.prototype`, by property descriptor, so a getter stays a getter.
// THROWS when Target already owns the name: a stale copy left behind in the
// class it is mixed into would otherwise silently shadow — or be shadowed by —
// the moved one, and the two would drift.
function installSceneMixin(Target, Mixin) {
  for (const name of Object.getOwnPropertyNames(Mixin.prototype)) {
    if (name === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(Target.prototype, name)) {
      throw new Error(`installSceneMixin: ${Target.name}.prototype already has "${name}" (${Mixin.name})`);
    }
    Object.defineProperty(Target.prototype, name,
      Object.getOwnPropertyDescriptor(Mixin.prototype, name));
  }
}
