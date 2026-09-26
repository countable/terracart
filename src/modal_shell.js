// The modal SHELL — the one dialog box every DOM dialog in the game is built
// in: makeModalShell (the box seated on the map square, the scene painting as
// its full-bleed background, the kind header, and mount(), which MEASURES the
// copy and switches a text-heavy dialog to THE BAND), the three stock dialogs
// built on it (showMessageModal, showOfferModal, showChestRewardModal), and
// the gate that mirrors "a dialog is open" onto body.modal-open
// (_installModalPadGate). Plus the tables they read: MODAL_KINDS and the
// scene-art frame constants (STORY_MODAL_GROW_PX, ART_FRAME_ASPECT,
// ART_DETAIL_FRAC, ART_BAND_*).
//
// Moved verbatim out of app.js. The methods live on `class SceneModals`, a
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

// How far above dead-centre every dialog rides (game px, in #game's 844-tall
// box). Reserved as bottom padding on the shared modal wrap so the flex-centred
// box lifts clear of the bottom inventory/HUD cluster. See makeModalShell —
// this is the one knob that moves all dialogs together.
// EVERY DIALOG IS THE MAP VIEWPORT: makeModalShell seats its box exactly
// over the map square (viewLeft/viewTop/viewSize — 352×352 game px) whatever
// it holds; the content never sizes the box. Short content sits centred in
// it, long content scrolls inside it. A STORY dialog (one with an art banner
// — story splashes, ceremonies) may be a little bigger: the square grows by
// STORY_MODAL_GROW_PX, a quarter of it above the map and the rest below.
// (The map already spans the column's full width, so "bigger" is taller.)
const STORY_MODAL_GROW_PX = 96;
// SCENE ART — the standard for a dialog with a painting (makeModalShell
// `art`). The piece IS the box: generated tall and cut to the story box's own
// shape (ART_FRAME_ASPECT, width:height), drawn full-bleed as its background.
// Every piece is composed to one rule (tools/gen_story_art.js SCENE): the
// subject and all the detail in the top ART_DETAIL_FRAC of the frame, and a
// calm, low-detail QUIET ZONE below it. The copy is the dialog's CONTENT
// REGION: anchored to the bottom, never taller than the quiet zone (it
// scrolls inside it rather than climbing onto the subject), over a scrim
// that darkens exactly the quiet zone — so text and subject cannot collide
// whatever the dialog says.
const ART_FRAME_ASPECT = 352 / (352 + STORY_MODAL_GROW_PX);
const ART_DETAIL_FRAC = 0.42;
// THE BAND — the same painting for a TEXT-HEAVY dialog. When the copy will
// not fit the quiet zone, the shell (mount()) shows only the painting's
// subject line, rows ART_BAND_FROM..ART_DETAIL_FRAC (the sky above it is what
// gives), in a band ART_BAND_FRAC of the box tall, and the content region
// takes the rest. Chosen by MEASURING the copy, never by the caller, so a
// dialog that grows a paragraph moves to the band by itself.
const ART_BAND_FROM = 0.14;
const ART_BAND_FRAC = ART_DETAIL_FRAC - ART_BAND_FROM;

// ── What KIND of dialog is this? ────────────────────────────────────────────
// Every modal opens with one of these: a hero icon and a one-word category, so
// the player knows what they are looking at before reading a line of it — a
// castle says QUEST, a chest says TREASURE, a blacksmith says FORGE. Dialogs
// used to open straight into flavour copy ("The trader offers:"), which reads
// fine once you already know where you are and not at all when you don't.
//
// The label is the CATEGORY, not the specific offer — the flavour line under
// it still carries that. Callers may override the label for a one-off outcome
// (the trail prize's "Thou hast traveled far") and keep the kind's icon; see
// showChestRewardModal.
//
// The icon here is the FALLBACK glyph — what a dialog opens with when it has
// no picture of its own. A dialog whose subject is a thing standing on the map
// passes that thing's sprite instead (`kindIcon`, makeModalShell): the chest
// ceremony opens with the crate or the trunk the player just tapped, because
// TREASURE's diamond said nothing about which chest paid out and drew a gem
// over a handful of onion seeds. An emoji is what remains for the categories
// with no sprite behind them — a quest, a trade, the energy explainer.
//
// `supplies` exists because the tutorial's own material handout was opening as
// TREASURE: the objective chip calls them supply crates, they render as the
// humble box sprite precisely so they read as supplies, and then 9 wood
// arrived under a diamond. Spending the treasure ceremony there costs it its
// meaning for the thing at the end of the same trail that IS treasure — the
// spawn relic chest. The COLOUR stays blue-white either way: both are things
// the world gives the player (spec §UI COLOUR LANGUAGE). Only the word and the
// hero icon change.
//
// Keys are referenced by every modal call site and pinned by
// tools/modal_audit.js, which fails the build if a dialog opens without one.
// `art` is the category's default SCENE painting (assets/art/, see SCENE ART
// by STORY_MODAL_GROW_PX) — every dialog of the kind opens on it unless its
// caller hands a painting of its own.
// PIXEL RESOLVE's cuts: the 22×28 thumbnail redrawn at RESOLVE_STEPS widths
// (the box's 11:14), coarse to fine, the last the thumbnail itself. Cut once
// per painting on a canvas and kept; `cb` gets the list once the inline
// thumbnail has decoded (a few ms — the tone covers that).
const RESOLVE_STEPS = [3, 6, 11, 22];
const RESOLVE_STEP_MS = 150;
const mosaicCutsCache = new Map();
function mosaicCuts(stem, cb) {
  if (mosaicCutsCache.has(stem)) { cb(mosaicCutsCache.get(stem)); return; }
  const src = (typeof ART_THUMBS !== 'undefined') && ART_THUMBS[stem];
  if (!src || typeof document === 'undefined') return;
  const thumb = new Image();
  thumb.onload = () => {
    const cuts = RESOLVE_STEPS.map((w) => {
      const h = Math.round(w * 14 / 11);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(thumb, 0, 0, w, h);
      return c.toDataURL('image/png');
    });
    mosaicCutsCache.set(stem, cuts);
    cb(cuts);
  };
  thumb.src = src;
}
// The ONE address of a scene painting — the shell draws it and the boot
// preloader (app.js _prewarmModalIcons) fetches it, so the warm copy is the
// very URL the dialog asks for.
const sceneArtUrl = (stem) => `assets/art/${stem}.webp`;
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
  memory:   { icon: '🌟', label: 'Memories', art: 'kind_memory' },   // the memories chip's explainer
  slots:    { icon: '🎰', label: 'Slots', art: 'kind_slots' },   // a fort's slot machine (presentFortSlots)
  farm:     { icon: '🌾', label: 'Farm', art: 'kind_farm' },   // scarecrows, feeding fauna
  energy:   { icon: '⚡', label: 'Energy', art: 'kind_energy' },   // the energy explainer
  rest:     { icon: '😵', label: 'Exhausted', art: 'kind_rest' },   // passing out underground
  use:      { icon: '🎒', label: 'Use', art: 'kind_use' },   // confirming a consumable from the bag
  fire:     { icon: '🔥', label: 'Campfire', art: 'kind_fire' },   // burning a held item (presentBurnConfirm)
  note:     { icon: '📜', label: 'Note', art: 'kind_note' },   // generic message dialog
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
  makeModalShell(id, { zIndex = 50, borderColor = UI_CONTROL_DIM,
    textAlign = 'center', wrapBg = '#0008', wrapExtra = '', boxExtra = '', onClose,
    kind, kindLabel, kindIcon, story = false, art } = {}) {
    document.getElementById(id)?.remove();
    // Every dialog opens on a painting: the caller's, or its kind's default.
    // Scene art is a story-sized dialog by definition — its frame is cut to
    // the grown box (ART_FRAME_ASPECT).
    const kRow = typeof kind === 'string' ? MODAL_KINDS[kind] : kind;
    art = art || kRow?.art;
    if (art) story = true;
    const wrap = document.createElement('div');
    wrap.id = id;
    // Shared marker so _installModalPadGate can tell when ANY dialog is open and
    // hide the movement pads (which otherwise sit on top of the modal — see the
    // gate). Every modal goes through here, so one class covers them all.
    wrap.classList.add('game-modal');
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
    const box = document.createElement('div');
    box.style.cssText =
      // Seated on the map square, in #game's own (game px) space; the wrap
      // starts at --view-top, so the box's top is measured back from it.
      `position:absolute;left:${vLeft}px;width:${vSize}px;` +
      `top:calc(${vTop - Math.round(grow / 4)}px - var(--view-top, 0px));height:${vSize + grow}px;` +
      `box-sizing:border-box;display:flex;flex-direction:column;` +
      `background:#1a1612;color:#fff;` +
      `border:2px solid ${borderColor};border-radius:10px;padding:14px 16px;` +
      `font:13px ui-monospace,monospace;` +
      // Content that outgrows the square scrolls INSIDE it — the box never
      // grows to fit. (Stats & Relics is the long one.)
      `overflow-y:auto;overscroll-behavior:contain;` +
      (textAlign ? `text-align:${textAlign};` : '') +
      boxExtra;
    // The painting fills the box; the scrim darkens everything below the
    // art's line, so the content region always sits on near-solid ground.
    // The box itself stops scrolling — the body does (see mount()). `band`
    // lifts the painting so only its subject line shows (THE BAND).
    //
    // PIXEL RESOLVE. The painting is a request; its TONE and thumbnail
    // (ART_TONES / ART_THUMBS, src/art_thumbs.js) are inline. An uncached
    // painting opens on a solid block of its tone and resolves on a MOSAIC
    // layer through ever finer cuts of the thumbnail (RESOLVE_STEPS, one per
    // RESOLVE_STEP_MS), then breathes on the last cut while it still waits —
    // so the wait reads as LOADING, not as a blurry picture. When the
    // painting lands, the mosaic takes the full thumbnail and the painting
    // fades in over it on a layer of its own. A cached painting skips all of
    // it and is simply there. Every layer carries the same scrim, so the copy
    // sits on the same ground throughout.
    const artLayer = art ? document.createElement('div') : null;
    const mosaicLayer = art ? document.createElement('div') : null;
    let mosaicImg = null;   // the current cut (a data URL), or null for the bare tone
    const tone = (art && typeof ART_TONES !== 'undefined' && ART_TONES[art]) || '#1a1612';
    let scenePos = 'center, center top';
    let sceneScrim = '';
    const paintLayer = (el, img) => {
      el.style.backgroundImage = img
        ? `${sceneScrim}, url(${img})`
        : `${sceneScrim}, linear-gradient(${tone}, ${tone})`;
      el.style.backgroundSize = '100% 100%, cover';
      el.style.backgroundPosition = scenePos;
      el.style.backgroundRepeat = 'no-repeat';
      el.style.imageRendering = 'pixelated';
    };
    const paintScene = (band) => {
      const line = Math.round((band ? ART_BAND_FRAC : ART_DETAIL_FRAC) * 100);
      sceneScrim =
        `linear-gradient(to bottom, rgba(26,22,18,0) ${line - 8}%, rgba(26,22,18,.82) ${line + 6}%, #1a1612 ${line + 22}%)`;
      scenePos = band
        ? `center, center ${-Math.round(ART_BAND_FROM * vSize / ART_FRAME_ASPECT)}px`
        : 'center, center top';
      paintLayer(mosaicLayer, mosaicImg);
      paintLayer(artLayer, sceneArtUrl(art));
      box.style.overflow = 'hidden';
      box.classList.add('modal-scene');
      box.classList.toggle('modal-scene-band', !!band);
    };
    if (art) {
      for (const el of [mosaicLayer, artLayer]) {
        el.style.cssText =
          'position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;';
      }
      mosaicLayer.className = 'modal-art-mosaic';
      artLayer.className = 'modal-art';
      paintScene(false);
      const img = new Image();
      img.src = sceneArtUrl(art);
      if (img.complete) {
        artLayer.style.opacity = '1';
      } else {
        artLayer.style.opacity = '0';
        artLayer.style.transition = 'opacity 420ms ease-out';
        const timers = [];
        const setCut = (url) => { mosaicImg = url; paintLayer(mosaicLayer, url); };
        mosaicCuts(art, (cuts) => {
          if (img.complete) return;
          cuts.slice(0, -1).forEach((url, i) =>
            timers.push(setTimeout(() => setCut(url), (i + 1) * RESOLVE_STEP_MS)));
          timers.push(setTimeout(() => mosaicLayer.classList.add('modal-art-waiting'),
            (cuts.length - 1) * RESOLVE_STEP_MS));
        });
        img.onload = () => {
          timers.forEach(clearTimeout);
          mosaicLayer.classList.remove('modal-art-waiting');
          const full = mosaicCutsCache.get(art);
          if (full) setCut(full[full.length - 1]);
          artLayer.style.opacity = '1';
        };
      }
    }
    if (onClose !== undefined) {
      wrap.addEventListener('click', (e) => { if (e.target === wrap) { wrap.remove(); onClose?.(); } });
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
    if (k && art) {
      // With a painting, the painting is the hero: the category shrinks to a
      // bare label chip on its top-left corner — no emoji, no sprite, no rule
      // under it. The painting already shows the chest or the crate, so a
      // sprite of it in the corner was a second, smaller picture of it.
      kindNode = document.createElement('div');
      kindNode.className = 'modal-kind';
      kindNode.style.cssText =
        'position:absolute;top:10px;left:10px;z-index:1;padding:3px 8px;border-radius:4px;' +
        'display:flex;align-items:center;gap:6px;' +
        `background:rgba(20,16,12,.72);border:1px solid ${borderColor}8c;` +
        'font:700 10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;' +
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
        // A SPRITE hero glyph: the art the world drew for the very thing this
        // dialog is about (scene.worldIconHTML off the object's own texture
        // key), so a ceremony opens with its own source rather than a stand-in
        // — a chest that stands on the map as a crate opened under a diamond
        // until Sep 2026. NOT desaturated: the greying below is right for an
        // emoji, which is a category glyph borrowed from the font, and wrong
        // for pixel art of a real object, which reads as broken art in grey.
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
        'font:700 11px ui-monospace,monospace;letter-spacing:.14em;' +
        `text-transform:uppercase;color:${borderColor};`;
      lbl.textContent = kindLabel ?? k.label;
      kindNode.appendChild(ico);
      kindNode.appendChild(lbl);
    }
    const mount = () => {
      // Everything the caller put in the box rides in one body block with
      // auto margins: centred in the square when it is short, flush to the
      // top (and scrolling) when it is long — auto margins collapse to zero
      // on overflow, where centring would clip the top. The kind header stays
      // pinned to the top edge above it.
      const body = document.createElement('div');
      body.className = 'modal-body';
      body.style.cssText = art
        // THE CONTENT REGION of a scene dialog: bottom-anchored, capped at the
        // quiet zone, scrolling inside it when the copy is long.
        ? `margin-top:auto;flex:0 1 auto;max-height:${Math.round((1 - ART_DETAIL_FRAC) * 100)}%;` +
          'overflow-y:auto;overscroll-behavior:contain;text-shadow:0 1px 2px #000;' +
          // Above the painting layer (PIXEL RESOLVE), which is absolute.
          'position:relative;z-index:1;'
        : 'margin:auto 0;flex:0 0 auto;';
      while (box.firstChild) body.appendChild(box.firstChild);
      box.appendChild(body);
      if (artLayer) { box.insertBefore(artLayer, box.firstChild); box.insertBefore(mosaicLayer, artLayer); }
      if (kindNode) { kindNode.style.flex = '0 0 auto'; box.insertBefore(kindNode, box.firstChild); }
      // The ENTRANCE (index.html .modal-anim): the backdrop fades in and the
      // box pops up from a touch smaller and lower. Only when nothing was on
      // screen — body.modal-open is synced by a MutationObserver that runs
      // AFTER this tap's handler, so a dialog that REPLACES another in the
      // same tap (a pager turn, a re-roll, a tab) still sees it set and swaps
      // in place instead of popping on every page.
      box.classList.add('modal-box');
      if (!document.body.classList.contains('modal-open')) wrap.classList.add('modal-anim');
      wrap.appendChild(box);
      (document.getElementById('game') || document.body).appendChild(wrap);
      // TEXT-HEAVY → THE BAND. Measured now it is laid out: copy that
      // overflows the quiet zone gets the band's taller content region.
      if (art && body.scrollHeight > body.clientHeight + 1) {
        paintScene(true);
        body.style.maxHeight = `${Math.round((1 - ART_BAND_FRAC) * 100)}%`;
      }
    };
    const mkBtn = (label, primary = true, disabled = false) => {
      const b = document.createElement('button');
      b.innerHTML = label;
      b.style.cssText =
        `padding:8px 14px;border-radius:6px;font:700 13px ui-monospace,monospace;cursor:pointer;` +
        (primary
          // Buttons are CONTROLS — gold, always (spec §UI COLOUR LANGUAGE).
          ? `background:${UI_CONTROL_DIM};color:#1a1612;border:0;`
          : 'background:transparent;color:#ddd;border:2px solid #444;');
      if (disabled) { b.disabled = true; b.style.opacity = '0.4'; b.style.cursor = 'not-allowed'; }
      return b;
    };
    return { wrap, box, mount, mkBtn };
  }

  // Simple OK-button modal for ambient game messages (eat effects, status, etc.).
  // `art` (optional) — the story's own SCENE painting (assets/art/ stem); a
  // dialog with one is a STORY unless the caller names another kind.
  // `kind` (optional) — the MODAL_KINDS category; a plain message is a 'note'.
  showMessageModal({ title, body, okLabel = 'OK', onDismiss, art, kind = art ? 'story' : 'note' }) {
    document.getElementById('offer-modal')?.remove();
    const { wrap, box, mount, mkBtn } = this.makeModalShell('message-modal',
      { zIndex: 60, onClose: () => {}, kind: kind, art });
    const safeBody = String(body).replace(/\n/g, '<br>');
    box.innerHTML =
      `<div style="opacity:.85;font-size:13px;margin-bottom:8px;color:#ffe066">${title}</div>` +
      `<div style="margin:6px 0 12px;white-space:pre-wrap">${safeBody}</div>`;
    const btn = mkBtn(okLabel);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap.remove();
      if (typeof onDismiss === 'function') onDismiss();
    });
    box.appendChild(btn);
    mount();
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
      const any = [...document.querySelectorAll('.game-modal')].some(shown);
      document.body.classList.toggle('modal-open', any);
      // The ☰ menu is hidden under the class (index.html); fold it shut as
      // well, so a menu left open behind a dialog doesn't spring back open
      // the moment the dialog is dismissed.
      // Its OWN dialog (#menu-modal, _openMenuDialog) is the menu itself, not
      // a dialog over it — counting it would shut the menu the frame it opens.
      if ([...document.querySelectorAll('.game-modal')].some(el => el.id !== 'menu-modal' && shown(el))) {
        const m = document.getElementById('menu'); if (m && m.open) m.open = false;
      }
      // Nothing covering the screen — so anything the starter ladder is
      // holding can be said now. See _celebrateStarterStep: cheers always
      // queue and this is the only thing that plays them, which is why the
      // test is "no modal" rather than "a modal just closed". At the instant a
      // step completes the answer is not yet knowable: the chest handler
      // credits the step one line BEFORE it opens the reward modal, so at that
      // point no modal exists and none of this class's state has been updated
      // for the one that is about to. One frame later it has.
      if (!any) this._flushStarterCheers();
    };
    this._modalPadObserver = new MutationObserver(sync);
    // makeModalShell appends its wrap as a direct child of #game…
    if (gameEl) this._modalPadObserver.observe(gameEl, { childList: true });
    // …and the static overlays just flip their own style, so watch that.
    for (const id of ['story', 'safety', 'locating', 'howto', 'tooshort']) {
      const el = document.getElementById(id);
      if (el) this._modalPadObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    }
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
  //   onAccept:     called after the modal closes
  //   acceptLabel:  primary button label ('Buy' default; 'Sell' / 'Trade'…)
  //   cancelLabel:  dismiss button label. Defaults to 'Cancel'; pass 'Later'
  //                 for offers tied to a persistent venue (a shop, a wreck,
  //                 a sealed building) the player can simply come back to —
  //                 "Later" reads as "still on the table" rather than "gone".
  //   secondary:    OPTIONAL { label: HTML, disabled: bool, onClick: fn }
  //                 — rendered between Cancel and accept (re-roll button).
  //   pager:        OPTIONAL { index, count, onPrev, onNext } — the page is
  //                 one of `count` options (a smelt bar, a Home recipe), and
  //                 small ‹ › arrows flank the `get` line with an "i / n"
  //                 under it. Paging is not an action: it used to be a
  //                 full-size "Smelt Platinum" button beside the real one,
  //                 which read as a second way to SMELT rather than as a way
  //                 to look at the next bar.
  showOfferModal({ title, get, blurb, cost, canAfford, onAccept, acceptLabel = 'Buy', cancelLabel = 'Cancel', secondary, pager, quantity, tabs, forLabel = 'for', getLabel, costLabel, kind, kindLabel, kindIcon, art }) {
    const { wrap, box, mount, mkBtn } = this.makeModalShell('offer-modal',
      { onClose: () => {}, kind, kindLabel, kindIcon, art });
    // Optional tab row (e.g. the blacksmith's Forge / Smelt switch). Each tab
    // is { label, active, onSelect }. Tapping an inactive tab closes this modal
    // and calls onSelect, which re-presents the sibling modal — cheap "tabs"
    // without restructuring the single-offer modal into a stateful panel.
    if (tabs && tabs.length) {
      const tabRow = document.createElement('div');
      tabRow.style.cssText = 'display:flex;gap:4px;justify-content:center;margin-bottom:8px;';
      for (const t of tabs) {
        const tb = document.createElement('button');
        tb.textContent = t.label;
        tb.style.cssText =
          'flex:1;padding:6px 4px;border-radius:6px 6px 0 0;font:700 12px ui-monospace,monospace;'
          + 'border:2px solid #555;border-bottom:none;cursor:pointer;'
          + (t.active
              ? 'background:#3a3322;color:#ffe066;border-color:#c8a64a;'
              : 'background:transparent;color:#999;');
        if (!t.active) {
          tb.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); t.onSelect(); });
        }
        tabRow.appendChild(tb);
      }
      box.appendChild(tabRow);
    }
    // Build the chrome out of individual nodes so the quantity stepper (when
    // present) can live-update the get/cost lines without re-rendering the
    // whole modal — tap − / + and the headline price + cost-line stack count
    // refresh in place.
    if (title) {
      const titleDiv = document.createElement('div');
      titleDiv.style.cssText = 'opacity:.75;font-size:11px;margin-bottom:6px';
      titleDiv.textContent = title;
      box.appendChild(titleDiv);
    }
    // `getLabel` / `costLabel` are explicit captions over the two halves of
    // the trade ("You receive" / "You give"). A goods-for-goods trade like the
    // smithy's — gear for bars, or bars for bars on the Smelt tab — reads as
    // two equal lines with only the word "for" between them, and which side
    // was the price was a guess. A caption names each side; when `costLabel`
    // is given it REPLACES the "for" row rather than stacking on it.
    const mkCaption = (text) => {
      const c = document.createElement('div');
      c.style.cssText = 'font:700 10px ui-monospace,monospace;letter-spacing:.12em;'
        + 'text-transform:uppercase;opacity:.6;margin:8px 0 2px';
      c.textContent = text;
      return c;
    };
    if (getLabel) box.appendChild(mkCaption(getLabel));
    const getDiv = document.createElement('div');
    getDiv.style.cssText = 'font-size:16px;font-weight:700;margin:4px 0;color:#ffe066';
    getDiv.innerHTML = get;
    if (pager && pager.count > 1) {
      const pageRow = document.createElement('div');
      pageRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;';
      const mkArrow = (glyph, aria, fn) => {
        const b = document.createElement('button');
        b.textContent = glyph;
        b.setAttribute('aria-label', aria);
        b.style.cssText =
          'flex:none;width:32px;height:32px;border-radius:50%;cursor:pointer;line-height:1;'
          + 'font:700 18px ui-monospace,monospace;background:transparent;color:#ddd;border:2px solid #555;';
        b.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); fn(); });
        return b;
      };
      getDiv.style.flex = '1';
      pageRow.appendChild(mkArrow('‹', 'Previous', pager.onPrev));
      pageRow.appendChild(getDiv);
      pageRow.appendChild(mkArrow('›', 'Next', pager.onNext));
      box.appendChild(pageRow);
      const pageNo = document.createElement('div');
      pageNo.style.cssText = 'font:700 10px ui-monospace,monospace;opacity:.55;margin-bottom:2px';
      pageNo.textContent = `${pager.index + 1} / ${pager.count}`;
      box.appendChild(pageNo);
    } else {
      box.appendChild(getDiv);
    }
    if (blurb) {
      const blurbDiv = document.createElement('div');
      blurbDiv.style.cssText = 'font-size:11px;opacity:.75;margin-bottom:6px';
      blurbDiv.innerHTML = blurb;
      box.appendChild(blurbDiv);
    }
    // `cost` is what the player PAYS — the second half of a "you get X FOR y"
    // trade, and the `forLabel` row is the literal word joining the two. Not
    // every caller is a trade: the quest board reports progress and asks for
    // nothing. Those get neither row, rather than a dangling "for" over an
    // empty line — or, as the quest board did, the same sentence printed twice
    // because both halves were handed the same string.
    const hasCost = cost != null && cost !== '';
    let costDiv = null;
    if (hasCost) {
      if (costLabel) {
        box.appendChild(mkCaption(costLabel));
      } else {
        const forDiv = document.createElement('div');
        forDiv.style.cssText = 'opacity:.85;margin:6px 0 4px';
        forDiv.textContent = forLabel;
        box.appendChild(forDiv);
      }
      costDiv = document.createElement('div');
      costDiv.style.cssText = 'font-size:16px;font-weight:700;margin:4px 0 10px;';
      costDiv.style.color = canAfford ? '#a7ffb0' : '#ff8a7a';
      costDiv.innerHTML = cost;
      box.appendChild(costDiv);
    }
    // Quantity stepper (only when caller passes `quantity`). Lays out as
    // [ − ]  N / MAX  [ + ] just above the action-button row.
    let qty = 1;
    let liveCanAfford = canAfford;
    let stepperRefresh = null;
    if (quantity) {
      const minQ = quantity.min ?? 1;
      const maxQ = Math.max(minQ, quantity.max ?? 1);
      qty = clamp(quantity.initial ?? minQ, minQ, maxQ);
      const stepRow = document.createElement('div');
      stepRow.style.cssText =
        'display:flex;gap:10px;justify-content:center;align-items:center;margin:2px 0 10px;';
      const mkStep = (label) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText =
          'width:44px;height:44px;border-radius:6px;font:700 20px ui-monospace,monospace;cursor:pointer;' +
          'background:transparent;color:#ddd;border:2px solid #555;line-height:1;';
        return b;
      };
      const minusBtn = mkStep('−');
      const plusBtn  = mkStep('+');
      const countSpan = document.createElement('span');
      countSpan.style.cssText =
        'min-width:72px;text-align:center;font:700 14px ui-monospace,monospace;color:#fff';
      stepRow.appendChild(minusBtn);
      stepRow.appendChild(countSpan);
      stepRow.appendChild(plusBtn);
      box.appendChild(stepRow);
      stepperRefresh = () => {
        countSpan.textContent = `${qty} / ${maxQ}`;
        if (typeof quantity.format === 'function') {
          const r = quantity.format(qty) || {};
          if (r.get  != null) getDiv.innerHTML  = r.get;
          if (r.cost != null && costDiv) costDiv.innerHTML = r.cost;
          if (r.canAfford != null) {
            liveCanAfford = !!r.canAfford;
            if (costDiv) costDiv.style.color = liveCanAfford ? '#a7ffb0' : '#ff8a7a';
          }
        }
        const dim = (b, off) => {
          b.disabled = off;
          b.style.opacity = off ? '0.4' : '1';
          b.style.cursor  = off ? 'not-allowed' : 'pointer';
        };
        dim(minusBtn, qty <= minQ);
        dim(plusBtn,  qty >= maxQ);
        // Keep the primary action button in sync with the live canAfford.
        if (accept) {
          accept.disabled = !liveCanAfford;
          accept.style.opacity = liveCanAfford ? '1' : '0.4';
          accept.style.cursor  = liveCanAfford ? 'pointer' : 'not-allowed';
        }
      };
      minusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (qty > minQ) { qty--; stepperRefresh(); }
      });
      plusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (qty < maxQ) { qty++; stepperRefresh(); }
      });
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;justify-content:center;margin-top:4px;flex-wrap:wrap;';
    const cancel = mkBtn(cancelLabel, false, false);
    const sec    = secondary ? mkBtn(secondary.label, false, !!secondary.disabled) : null;
    const accept = mkBtn(acceptLabel, true, !canAfford);
    cancel.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    accept.addEventListener('click', (e) => {
      e.stopPropagation(); wrap.remove();
      onAccept(quantity ? qty : undefined);
    });
    if (sec) sec.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); secondary.onClick(); });
    row.appendChild(cancel);
    if (sec) row.appendChild(sec);
    row.appendChild(accept);
    box.appendChild(row);
    // First paint of stepper-driven state (also syncs accept-button disabled
    // colours with the format() canAfford if the caller computes it).
    if (stepperRefresh) stepperRefresh();
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
  //                          An action may carry `info` (HTML): its button
  //                          grows an ⓘ, and tapping THAT (not the button)
  //                          shows the text under the row — tap again, or
  //                          another card's ⓘ, to swap or hide it. Nothing is
  //                          chosen by reading.
  //   cards         bool?  → lay the actions out as equal-width cards on ONE
  //                          row (the pick) instead of wrapping word buttons.
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
  showChestRewardModal({ iconHTML, name, sub, qty, color = UI_TREASURE, accent = UI_TREASURE,
    onDismiss, header, kind = 'treasure', kindIcon, actions, art, cards = false }) {
    const { wrap, box, mount } = this.makeModalShell('chest-reward-modal', {
      zIndex: 55, borderColor: accent, wrapBg: '#000c', art,
      kind, kindLabel: header, kindIcon,
      wrapExtra: 'animation:chestModalIn 180ms ease-out;',
      boxExtra: `border-width:3px;border-radius:14px;padding:22px 22px 14px;font-size:14px;` +
        `animation:chestRewardPop 320ms cubic-bezier(.34,1.56,.64,1);`,
    });
    // Keyframes injected once. The sparkle keyframe reads its drift vector
    // from per-element CSS custom properties (--dx/--dy) so a single shared
    // rule animates N sparkles each along its own randomised direction. The
    // translate(-50%,-50%) prefix keeps each sparkle centred on its
    // perimeter anchor while drifting outward.
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
    // `qty` (e.g. "× 5") renders as a bold, full-size, coloured line so the
    // amount the player just received reads at a glance. `sub` stays the
    // quiet descriptive line ("equipped", "already owned", flavour text).
    const qtyHtml = qty
      ? `<div style="margin-top:6px;font-size:22px;font-weight:700;color:${color};line-height:1.1">${qty}</div>`
      : '';
    const subHtml = sub
      ? `<div style="margin-top:4px;font-size:13px;opacity:.85">${sub}</div>`
      : '';
    const hasActions = Array.isArray(actions) && actions.length > 0;
    box.innerHTML =
      // The icon row is optional and collapses when a card passes no
      // iconHTML: the story cards let the banner carry the picture, and a
      // ceremony with an art banner plus card buttons (the trail pick) has
      // no room for a third picture - an empty div would still cost its
      // margins as a blank band under the banner.
      (iconHTML ? `<div style="margin:6px 0 10px;font-size:0">${iconHTML}</div>` : '') +
      `<div style="font-size:18px;font-weight:700;color:${color};line-height:1.2">${name}</div>` +
      qtyHtml +
      subHtml +
      (hasActions ? '' : '<div style="margin-top:14px;opacity:.45;font-size:10px;letter-spacing:.06em">tap to continue</div>');
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
      // One shared line under the row for whichever card's ⓘ was tapped.
      const infoLine = document.createElement('div');
      infoLine.style.cssText = 'display:none;margin-top:10px;font-size:12px;line-height:1.35;opacity:.9;';
      let infoOpen = null;
      for (const a of actions) {
        const b = document.createElement('button');
        b.innerHTML = a.label;
        b.style.cssText =
          'position:relative;border-radius:7px;font:700 12px ui-monospace,monospace;cursor:pointer;' +
          (cards ? 'flex:1 1 0;min-width:0;padding:12px 4px 9px;' : 'padding:9px 14px;') +
          (a.primary
            ? `background:${accent};color:#1a1612;border:0;`
            : 'background:transparent;color:#ddd;border:2px solid #555;');
        if (a.info) {
          const i = document.createElement('span');
          i.textContent = 'ⓘ';
          i.setAttribute('role', 'button');
          i.setAttribute('aria-label', 'What does this do?');
          i.style.cssText = 'position:absolute;top:0;right:0;width:24px;height:24px;'
            + 'display:flex;align-items:center;justify-content:center;'
            + `font:400 15px/1 sans-serif;color:${accent};opacity:.85;`;
          i.addEventListener('click', (e) => {
            e.stopPropagation();   // reading a card never takes it
            const same = infoOpen === b;
            for (const other of row.children) other.style.outline = '';
            infoOpen = same ? null : b;
            infoLine.style.display = same ? 'none' : 'block';
            if (!same) { infoLine.innerHTML = a.info; b.style.outline = `2px solid ${accent}`; }
          });
          b.appendChild(i);
        }
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          wrap.remove();
          if (typeof a.onClick === 'function') a.onClick();
          if (typeof onDismiss === 'function') onDismiss();
        });
        row.appendChild(b);
      }
      box.appendChild(row);
      box.appendChild(infoLine);
    } else {
      // Dismiss on any tap — overlay or box, doesn't matter (this is a "tap
      // to acknowledge" not a "choose action" modal). stopPropagation on the
      // box would otherwise let the player click-through it.
      wrap.addEventListener('click', (e) => { e.stopPropagation(); close(); }, true);
    }
    mount();
    // Sparkle burst around the modal — drives the "fanfare" feel. Spawned
    // AFTER the wrap is in the DOM so getBoundingClientRect() gives us the
    // box's real on-screen footprint (it's flex-centred, so the rect depends
    // on viewport size). Each sparkle is parented to wrap and animates from
    // a randomised point on the box perimeter outward along its --dx/--dy
    // vector. Tier colour bleeds into the glow so chests/etc each
    // sparkle in their own hue.
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
          // Radial gradient = soft glow; the central white core sits on a
          // tier-coloured halo that fades to transparent. Layered with a thin
          // 4-point star (drawn via conic-gradient masking is overkill —
          // simpler to fake the star highlight with a tighter inner gradient).
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
