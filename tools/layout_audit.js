// Vertical-layout audit — checks that fitGame's budget actually fits the HUD
// onto real devices. Node-scope (needs fs), so it's wired into
// test/node/run.js the same way the sprite and shell audits are.
//
// The bug that motivated it: the game box was pinned to top:0 and the HUD to
// the viewport bottom, so ALL the slack between them landed in one place and
// nothing measured it. That read very differently per device — an iPhone SE
// had the walking stick sitting 84px ON TOP of the map, while a tall desktop
// window had a 195px hole under it. Both from the same non-decision.
//
// The function under test is layOutVertically() in index.html. It is inline
// (the whole boot sequence is, because START_LAT/START_LON must be frozen
// before app.js parses), so the audit lifts the source out of the page and
// evaluates it rather than duplicating the arithmetic here — a copy would
// drift from the page and start passing while the real layout broke.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// Pull the budget constants + layOutVertically straight out of index.html.
// Anchored on the comment banner and the function's own closing return so a
// nearby edit fails loudly here instead of silently matching less code.
function loadLayout() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('const TOP_CHROME =');
  const endMark = 'return { s, top, stickBottom };';
  const end = html.indexOf(endMark, start);
  if (start < 0 || end < 0) {
    throw new Error('layout_audit: could not find the vertical budget in index.html');
  }
  const src = html.slice(start, end + endMark.length) + '\n}\n';
  const ctx = { BOX_W: 352, BOX_H: 844, Math };
  vm.createContext(ctx);
  // `const` at a script's top level makes a LEXICAL binding, not a property of
  // the context — reading ctx.TOP_CHROME back gives undefined, every number
  // downstream becomes NaN, and NaN fails every comparison silently, so the
  // whole audit passes no matter what the layout does. (It did exactly that
  // until two deliberately-broken layouts both came back green.) Export the
  // bindings explicitly instead.
  const EXPORTS = ['TOP_CHROME', 'TOP_ROW', 'CELL_GAME', 'INV_CLUSTER',
                   'MAP_TOP_GAME', 'MAP_H_GAME', 'STICK_PX',
                   'PHONE_MIN', 'PHONE_MAX'];
  const bridge = '\nglobalThis.__layout = layOutVertically;\n' +
    EXPORTS.map((k) => `globalThis.__${k} = ${k};`).join('\n');
  vm.runInContext(src + bridge, ctx, { filename: 'index.html#layOutVertically' });
  const out = { fn: ctx.__layout };
  for (const k of EXPORTS) {
    const v = ctx['__' + k];
    if (typeof v !== 'number' || !isFinite(v)) {
      throw new Error(`layout_audit: ${k} did not come back as a number (got ${v})`);
    }
    out[k] = v;
  }
  if (typeof out.fn !== 'function') throw new Error('layout_audit: layOutVertically not found');
  return out;
}

// Viewport sizes the game actually ships onto, smallest first. The two short
// ones are the interesting cases: they cannot fit map + stick + inventory at
// any scale, so they exercise the overlay fallback.
//
// These are DEVICE sizes — the full screen, as a home-screen app gets it. The
// same phones in a browser tab are 80-120px shorter (see BROWSER_VIEWPORTS),
// and that difference is a layout case of its own, not a rounding error.
const DEVICES = [
  { name: 'iPhone SE',         w: 375,  h: 667  },
  { name: 'Galaxy S8',         w: 360,  h: 740  },
  { name: 'iPhone 13 mini',    w: 375,  h: 812  },
  { name: 'iPhone 14',         w: 390,  h: 844  },
  { name: 'Pixel 7',           w: 412,  h: 915  },
  { name: 'iPhone 14 Pro Max', w: 430,  h: 932  },
  { name: 'desktop short',     w: 1280, h: 700  },
  { name: 'desktop tall',      w: 1280, h: 1000 },
];

// The SAME phones with browser chrome on screen — window.innerHeight in an
// iOS Safari / Android Chrome tab, which is what fitGame actually reads. This
// list is the regression: every one of these is short enough that the old
// `band / MAP_H_GAME` clamp scaled the column DOWN below the width fit, so a
// portrait phone grew gutters and shrank its whole HUD with nothing changed
// but the browser's toolbars (a 393-wide viewport got a 376px column; a
// 375x553 one got 299px — a 20% zoom-out).
const BROWSER_VIEWPORTS = [
  { name: 'iPhone SE / Safari',      w: 375, h: 553 },
  { name: 'iPhone 13 mini / Safari', w: 375, h: 629 },
  { name: 'iPhone 15 Pro / Safari',  w: 393, h: 659 },
  { name: 'iPhone 15 Pro / tab bar', w: 393, h: 630 },
  { name: 'iPhone 14 / Safari',      w: 390, h: 664 },
  { name: 'Pro Max / Safari',        w: 430, h: 745 },
  { name: 'Pixel 7 / Chrome',        w: 412, h: 780 },
  { name: 'squat phone',             w: 412, h: 600 },
];

// Reproduce what fitGame does with the result, in CSS px measured from the
// top of the viewport, so the checks below can talk about what the player
// actually sees rather than about the box's internal coordinates.
function geometry(L, dev) {
  // Portrait clamps the column at PHONE_MAX; the desktop branch always asks
  // for PHONE_MAX and lets the height decide. Both funnel through the same
  // layOutVertically, so testing the portrait ask covers the shared maths and
  // the desktop rows below pin the wide-viewport ask.
  const capW = L.PHONE_MAX / 352;
  const portrait = dev.w < dev.h;
  const sByWidth = portrait ? Math.min(dev.w / 352, capW) : capW;
  // fillWidth is the portrait promise: a phone column never shrinks below the
  // width fit. Passing it here is what makes the audit test the real page.
  const { s, top, stickBottom } = L.fn(sByWidth, dev.h, portrait);
  const mapTop = top + L.MAP_TOP_GAME * s;
  const mapBottom = mapTop + L.MAP_H_GAME * s;
  const stickTop = dev.h - stickBottom - L.STICK_PX;
  const stickBottomPx = stickTop + L.STICK_PX;
  const tabsTop = dev.h - L.INV_CLUSTER;
  const band = Math.max(160, dev.h - L.TOP_CHROME - L.INV_CLUSTER);
  return { s, top, mapTop, mapBottom, stickTop, stickBottomPx, tabsTop, band,
           colW: 352 * s, gutter: (dev.w - 352 * s) / 2,
           mapCentreY: (mapTop + mapBottom) / 2 };
}

const CHECKS = [];

for (const dev of [...DEVICES, ...BROWSER_VIEWPORTS]) {
  const label = `${dev.name} ${dev.w}x${dev.h}`;

  // A PHONE fills its viewport. The column may only be narrower than the
  // screen when the screen is wider than a phone column (tablet portrait,
  // desktop) — never because the viewport was short. This is the check the
  // audit was missing: every invariant below was green while an ordinary iOS
  // Safari viewport rendered a 376px column inside 393px of screen.
  if (dev.w < dev.h) {
    CHECKS.push({ name: `layout: the column fills the width — ${label}`, run: () => {
      const L = loadLayout(), g = geometry(L, dev);
      const want = Math.min(dev.w, L.PHONE_MAX);
      if (g.colW < want - 0.5) {
        throw new Error(`column is ${g.colW.toFixed(1)}px wide in a ${dev.w}px viewport ` +
          `(${g.gutter.toFixed(1)}px gutters, scale ${g.s.toFixed(4)})`);
      }
    } });
  }

  // The map must never run under the inventory — except by the one ring of
  // cells the fill-the-width trade is allowed to spend on a short screen, and
  // then only on a screen whose band genuinely could not seat it.
  CHECKS.push({ name: `layout: map clears the inventory — ${label}`, run: () => {
    const L = loadLayout(), g = geometry(L, dev);
    const bleed = g.band >= L.MAP_H_GAME * g.s ? 0 : L.CELL_GAME * g.s;
    if (g.mapBottom > g.tabsTop + bleed + 0.5) {
      throw new Error(`map bottom ${g.mapBottom.toFixed(1)} runs ` +
        `${(g.mapBottom - g.tabsTop).toFixed(1)}px past tabs top ${g.tabsTop} ` +
        `(at most ${bleed.toFixed(1)}px allowed here)`);
    }
  } });

  // The map must start below the money/energy row — that row is opaque chrome
  // the world can never be read through. It may start under the OBJECTIVE CHIP
  // when the band is too short to hold it (the chip retires; the row doesn't),
  // but only then: a screen with slack to spend still clears the whole budget.
  CHECKS.push({ name: `layout: map clears the top chrome — ${label}`, run: () => {
    const L = loadLayout(), g = geometry(L, dev);
    const floor = g.band >= L.MAP_H_GAME * g.s ? L.TOP_CHROME : L.TOP_ROW;
    if (g.mapTop < floor - 0.5) {
      throw new Error(`map top ${g.mapTop.toFixed(1)} is above the ${floor} floor`);
    }
  } });

  // The stick may overlay the MAP on a screen too short to seat it below —
  // that is the deliberate fallback — but it must never cover the inventory,
  // which would eat taps meant for item slots.
  CHECKS.push({ name: `layout: stick never covers the inventory — ${label}`, run: () => {
    const L = loadLayout(), g = geometry(L, dev);
    if (g.stickBottomPx > g.tabsTop + 0.5) {
      throw new Error(`stick bottom ${g.stickBottomPx.toFixed(1)} overlaps tabs top ${g.tabsTop}`);
    }
  } });

  // When the stick DOES have to overlay the map, it must stay in the bottom
  // corner: the player is drawn at the map's centre, and a control sitting on
  // the player is the one occlusion that actually costs the game something.
  CHECKS.push({ name: `layout: stick never reaches the player — ${label}`, run: () => {
    const L = loadLayout(), g = geometry(L, dev);
    if (g.stickTop < g.mapCentreY + 40) {
      throw new Error(`stick top ${g.stickTop.toFixed(1)} is within 40px of the map centre ` +
        `${g.mapCentreY.toFixed(1)}`);
    }
  } });

  // Scale must stay sane: never upscaled past the phone-column cap, and never
  // shrunk so far that the world becomes a postage stamp in a wide gutter.
  CHECKS.push({ name: `layout: scale stays in range — ${label}`, run: () => {
    const L = loadLayout(), g = geometry(L, dev);
    if (g.s > L.PHONE_MAX / 352 + 1e-9) throw new Error(`scale ${g.s} exceeds the phone-column cap`);
    if (g.s < 0.8) throw new Error(`scale ${g.s} shrinks the world below 0.8`);
  } });
}

// Every screen that COULD seat the stick below the map must actually do so.
//
// The invariant is deliberately measured against the raw band — viewport minus
// the two chrome stacks — rather than against the gap the layout happened to
// leave. Asking "if there is room, use it" is not a real check here: the
// regression this guards against is a layout that spends the slack on a top
// margin FIRST and so destroys the room, which would then excuse itself. An
// earlier revision did exactly that and turned a clean 8px gap on a 360×740
// phone into a 24px overlap while this test stayed green.
CHECKS.push({ name: 'layout: every screen that can seat the stick below the map does', run: () => {
  const L = loadLayout();
  const bad = [];
  for (const dev of [...DEVICES, ...BROWSER_VIEWPORTS]) {
    const g = geometry(L, dev);
    const band = Math.max(160, dev.h - L.TOP_CHROME - L.INV_CLUSTER);
    const roomAtBestPlacement = band - L.MAP_H_GAME * g.s;
    if (roomAtBestPlacement >= L.STICK_PX + 16 && g.stickTop < g.mapBottom - 0.5) {
      bad.push(`${dev.name}: ${roomAtBestPlacement.toFixed(0)}px of band was available below ` +
        `the map but the stick still overlays it by ${(g.mapBottom - g.stickTop).toFixed(0)}px`);
    }
  }
  if (bad.length) throw new Error(bad.join('; '));
} });

// The slack has to be SHARED, not dumped in one place. Before the budget
// existed a tall desktop window left a 195px hole between the map and the
// controls; the stick now sits in that band on every screen that has one.
CHECKS.push({ name: 'layout: no screen leaves a stick-free hole over 120px', run: () => {
  const L = loadLayout();
  const bad = [];
  for (const dev of [...DEVICES, ...BROWSER_VIEWPORTS]) {
    const g = geometry(L, dev);
    const above = g.stickTop - g.mapBottom;      // empty band above the stick
    const below = g.tabsTop - g.stickBottomPx;   // empty band below it
    if (above > 120) bad.push(`${dev.name}: ${above.toFixed(0)}px empty above the stick`);
    if (below > 120) bad.push(`${dev.name}: ${below.toFixed(0)}px empty below the stick`);
  }
  if (bad.length) throw new Error(bad.join('; '));
} });

module.exports = { CHECKS, DEVICES, BROWSER_VIEWPORTS, loadLayout, geometry };
