// Viewport-vignette audit — checks that the map's rim still fades the way the
// two edges need, which is NOT the same way on all four sides.
//
// The bug it guards: the vignette's rim lip (the outer 4px ramped to
// near-opaque, added so art overhanging the mask fades instead of being sliced
// mid-pixel — UX audit §15) was applied to all four edges with one strokeRect.
// The map box spans the whole viewport width on a phone, so the left and right
// rings ARE the outermost pixels of the screen: the lip painted a ~4px black
// bar down both sides, and the game read as not being full width. Sampled off
// a real iPhone 15 viewport, the map's own leftmost pixels came back
// rgb(6,6,4), rgb(19,19,14), rgb(31,32,24), rgb(44,45,34) before the grass at
// rgb(68,73,51) finally started.
//
// So the rule has two halves and the audit pins both:
//   * TOP and BOTTOM keep the lip — they sit in the middle of the screen with
//     HUD chrome above and below, so a hard cut there is visible against the
//     page, and vertical overhang is the big one (art is seated at the cell's
//     bottom edge).
//   * LEFT and RIGHT get the soft ramp only — nothing is sliced at the screen
//     edge that the bezel doesn't slice anyway.
//
// Like layout_audit, this lifts the real source out of src/app.js and
// evaluates it rather than restating the arithmetic here — a copy would drift
// from the page and start passing while the map grew its bars back.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// Pull the vignette block out of create(). Anchored on the graphics object it
// declares and on the loop's closing brace, so a nearby edit fails loudly here
// instead of silently matching less code.
function loadVignette() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  const start = src.indexOf('const vignette = this.add.graphics()');
  if (start < 0) throw new Error('vignette_audit: the vignette block is gone from src/app.js');
  const loopAt = src.indexOf('for (let i = 0; i < VIG_PX; i++) {', start);
  if (loopAt < 0) throw new Error('vignette_audit: the vignette ring loop is gone from src/app.js');
  const end = src.indexOf('\n    }\n', loopAt);
  if (end < 0) throw new Error('vignette_audit: could not find the end of the ring loop');
  const block = src.slice(start, end + 6);
  const body = src.slice(src.indexOf('{', loopAt) + 1, end);

  // Evaluate the alpha ramps. `this.viewLeft` etc. aren't available out here,
  // and aren't needed — the geometry is checked structurally below.
  const ctx = { Math };
  vm.createContext(ctx);
  const decls = block
    .split('\n')
    .filter((l) => /^\s*const (VIG_PX|VIG_LIP|vigSoft|vigLip)\b/.test(l) || /^\s*[?:]/.test(l))
    .join('\n');
  vm.runInContext(
    decls + '\nglobalThis.__v = { VIG_PX, VIG_LIP, vigSoft, vigLip };',
    ctx, { filename: 'app.js#vignette' });
  const v = ctx.__v;
  for (const k of ['VIG_PX', 'VIG_LIP']) {
    if (typeof v[k] !== 'number' || !isFinite(v[k])) {
      throw new Error(`vignette_audit: ${k} did not come back as a number (got ${v[k]})`);
    }
  }
  for (const k of ['vigSoft', 'vigLip']) {
    if (typeof v[k] !== 'function') throw new Error(`vignette_audit: ${k} is not a function`);
  }
  return { ...v, body };
}

// Read the loop body as a sequence of draw calls, carrying the alpha that was
// last set. Each ring should set an alpha and then stroke edges with it.
//
// A line is HORIZONTAL when its two y arguments match and VERTICAL when its
// two x arguments match — compared as source text, which is exact here because
// both ends of an edge are written from the same expression.
function drawCalls(body) {
  const calls = [];
  let alpha = null;
  const re = /vignette\.(lineStyle|lineBetween)\(([^;]*?)\)\s*;/g;
  let m;
  while ((m = re.exec(body))) {
    const args = m[2].split(',').map((a) => a.trim());
    if (m[1] === 'lineStyle') {
      alpha = args[2];
    } else {
      const [x1, y1, x2, y2] = args;
      const axis = x1 === x2 ? 'vertical' : (y1 === y2 ? 'horizontal' : 'diagonal');
      calls.push({ axis, alpha });
    }
  }
  return calls;
}

const CHECKS = [
  { name: 'vignette: the rim ramps are actually parseable', run: () => {
    const v = loadVignette();
    if (!(v.VIG_LIP > 0 && v.VIG_LIP < v.VIG_PX)) {
      throw new Error(`VIG_LIP ${v.VIG_LIP} must sit inside VIG_PX ${v.VIG_PX}`);
    }
  } },

  // The half that fixes the bars: whatever the left and right edges are drawn
  // with must stay light at the very rim. 0.2 is the soft ramp's own ceiling
  // (0.15) with room to retune; the lip's 0.92 fails it by a mile.
  { name: 'vignette: the soft ramp never darkens the screen-edge pixels', run: () => {
    const v = loadVignette();
    if (v.vigSoft(0) > 0.2) {
      throw new Error(`the soft ramp opens at alpha ${v.vigSoft(0)} — a bar down the screen edges`);
    }
    if (v.vigSoft(v.VIG_PX - 1) > v.vigSoft(0)) throw new Error('the soft ramp darkens inward');
  } },

  // The other half: the lip that stops overhanging art being sliced mid-pixel
  // has to still be a lip. Deleting it outright would also clear the check
  // above, and take UX audit §15's fix with it.
  { name: 'vignette: the top/bottom lip still fades a sliced sprite', run: () => {
    const v = loadVignette();
    if (v.vigLip(0) < 0.8) {
      throw new Error(`the rim lip opens at alpha ${v.vigLip(0)} — too light to sell the mask cut`);
    }
    if (Math.abs(v.vigLip(v.VIG_LIP) - v.vigSoft(v.VIG_LIP)) > 1e-9) {
      throw new Error('the lip does not hand over to the soft ramp at VIG_LIP — visible seam');
    }
  } },

  // And the part that actually decides which edge gets which: the horizontal
  // edges carry the lip, the vertical ones carry the soft ramp. A single
  // strokeRect can't express that, which is how the bars got there.
  { name: 'vignette: the screen edges get the soft ramp, not the lip', run: () => {
    const v = loadVignette();
    const calls = drawCalls(v.body);
    const vert = calls.filter((c) => c.axis === 'vertical');
    const horiz = calls.filter((c) => c.axis === 'horizontal');
    if (calls.some((c) => c.axis === 'diagonal')) {
      throw new Error('a vignette edge is neither horizontal nor vertical');
    }
    if (vert.length !== 2 || horiz.length !== 2) {
      throw new Error(`each ring should stroke 2 horizontal + 2 vertical edges, ` +
        `found ${horiz.length} + ${vert.length}`);
    }
    for (const c of vert) {
      if (!/vigSoft/.test(c.alpha || '')) {
        throw new Error(`a left/right edge is drawn at alpha \`${c.alpha}\` — ` +
          `only vigSoft may reach the screen edges`);
      }
    }
    for (const c of horiz) {
      if (!/vigLip/.test(c.alpha || '')) {
        throw new Error(`a top/bottom edge is drawn at alpha \`${c.alpha}\` — ` +
          `it should carry the rim lip`);
      }
    }
  } },
];

module.exports = { CHECKS, loadVignette, drawCalls };
