// Offer-modal audit — checks that no caller of showOfferModal hands the SAME
// text to both halves of the dialog. Node-scope (needs fs), so it's wired into
// test/node/run.js the same way the sprite, shell and layout audits are.
//
// showOfferModal renders a trade: `get` is what you receive, `cost` is what
// you pay, and a literal "for" sits between them. The castle quest board
// reused it for something that is not a trade — there is nothing to pay — and
// filled BOTH halves with the same progress string. Every quest state then
// printed its own progress line twice with a stray "for" wedged between the
// copies ("3 / 10 defeated / for / 3 / 10 defeated"), and a finished quest did
// the same with the reward figure.
//
// That is a whole class of mistake rather than one typo: any future caller
// that isn't really a trade will be tempted to pad the unused half the same
// way. The fix made `cost` optional, and this audit keeps the temptation from
// coming back.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Replace every comment body with spaces, keeping newlines (and therefore
// every index and line number) intact. The scanners below track strings so a
// brace or comma inside one can't fool them — but a COMMENT is not a string,
// and app.js is heavily commented in prose. The apostrophe in a comment like
// "so the barter can't be read backwards" opened a phantom single-quoted
// string that swallowed the next two object entries whole, which is how the
// trade modal's get/cost pair first parsed as two empty strings — and two
// empty strings compare equal, so the audit would have reported a duplicate
// that was never there. Blank the comments and both scanners see only code.
function blankComments(src) {
  let out = '';
  let quote = null;
  const tmplStack = [];
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += src[++i] ?? ''; continue; }
      if (c === quote) { quote = null; continue; }
      if (quote === '`' && c === '$' && src[i + 1] === '{') {
        tmplStack.push(depth); quote = null; depth++; out += src[++i]; continue;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      out += '\n';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' ';
      i--;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (tmplStack.length && depth === tmplStack[tmplStack.length - 1]) {
        tmplStack.pop(); quote = '`';
      }
    }
    out += c;
  }
  return out;
}

// Walk an object literal from its opening brace and return the source between
// the braces. Tracks strings, template literals and nesting so a `${...}` or a
// brace inside a string can't end the slice early.
function objectLiteralAt(src, openBrace) {
  let depth = 0;
  let i = openBrace;
  let quote = null;        // ' " or ` when inside a string
  const tmplStack = [];    // depth of each `${` we're inside
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) { quote = null; continue; }
      if (quote === '`' && c === '$' && src[i + 1] === '{') {
        tmplStack.push(depth); quote = null; depth++; i++; continue;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (tmplStack.length && depth === tmplStack[tmplStack.length - 1]) {
        tmplStack.pop(); quote = '`'; continue;   // back inside the template
      }
      if (depth === 0) return src.slice(openBrace + 1, i);
      continue;
    }
  }
  return null;
}

// Split an object literal's body into top-level `key: value` pairs.
function topLevelEntries(body) {
  const out = [];
  let depth = 0, quote = null, start = 0;
  const tmplStack = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) { quote = null; continue; }
      if (quote === '`' && c === '$' && body[i + 1] === '{') {
        tmplStack.push(depth); quote = null; depth++; i++; continue;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (tmplStack.length && depth === tmplStack[tmplStack.length - 1]) {
        tmplStack.pop(); quote = '`';
      }
      continue;
    }
    if (c === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
  }
  out.push(body.slice(start));
  const pairs = new Map();
  for (const e of out) {
    const m = e.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*?)\s*$/);
    if (m && !pairs.has(m[1])) pairs.set(m[1], m[2]);
  }
  return pairs;
}

// Every showOfferModal({...}) call site, as { line, args }.
function offerCalls(file = 'src/app.js') {
  const src = blankComments(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
  const calls = [];
  const CALL = 'showOfferModal(';
  let at = 0;
  for (;;) {
    const i = src.indexOf(CALL, at);
    if (i < 0) break;
    at = i + CALL.length;
    // Skip the method DEFINITION — it destructures its parameter object.
    const lineStart = src.lastIndexOf('\n', i) + 1;
    if (!/[.\s]showOfferModal\($/.test(src.slice(lineStart, at))) continue;
    if (/^\s*showOfferModal\(\{\s*title/.test(src.slice(lineStart, at + 40))) continue;
    const brace = src.indexOf('{', at - 1);
    if (brace < 0 || brace > at + 4) continue;   // not a call with an object literal
    const body = objectLiteralAt(src, brace);
    if (body == null) continue;
    calls.push({ line: src.slice(0, i).split('\n').length, args: topLevelEntries(body) });
  }
  return calls;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Split a value expression into the alternatives it can actually render.
// `done ? A : B` renders A or B, never the literal ternary — so comparing the
// two halves of the dialog as whole strings misses the real bug. The quest
// board's two halves were NOT textually identical:
//     get:  done ? `$${reward}`         : progressLine
//     cost: done ? `Reward: $${reward}` : progressLine
// They only collided on the `progressLine` branch, which is exactly the branch
// a player in mid-quest sees — and that is what printed twice. Compare the
// BRANCH SETS and the collision is obvious.
function valueBranches(expr) {
  let depth = 0, quote = null, q = -1;
  const tmplStack = [];
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) { quote = null; continue; }
      if (quote === '`' && c === '$' && expr[i + 1] === '{') {
        tmplStack.push(depth); quote = null; depth++; i++; continue;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (tmplStack.length && depth === tmplStack[tmplStack.length - 1]) {
        tmplStack.pop(); quote = '`';
      }
      continue;
    }
    // A ternary '?', not optional chaining (?.) and not nullish coalescing (??).
    if (c === '?' && depth === 0 && expr[i + 1] !== '.' && expr[i + 1] !== '?'
        && expr[i - 1] !== '?') { q = i; break; }
  }
  if (q < 0) return [norm(expr)];
  // Find this ternary's ':' — skipping any nested ternary's own colon.
  let nested = 0; depth = 0; quote = null;
  for (let i = q + 1; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; continue; }
    if (depth !== 0) continue;
    if (c === '?' && expr[i + 1] !== '.' && expr[i + 1] !== '?' && expr[i - 1] !== '?') nested++;
    else if (c === ':') {
      if (nested > 0) { nested--; continue; }
      return [...valueBranches(expr.slice(q + 1, i)), ...valueBranches(expr.slice(i + 1))];
    }
  }
  return [norm(expr)];
}

// Branches that carry no text are not duplicates worth reporting.
const TRIVIAL = new Set(["''", '""', '``', 'null', 'undefined', '0', "' '"]);

const CHECKS = [
  {
    name: 'offer modal: the call sites are actually parseable',
    run: () => {
      const calls = offerCalls();
      // A parser that quietly matches nothing would make every check below
      // pass forever. app.js has had a dozen-plus offer modals for a long
      // time; if the count collapses, the scanner broke, not the code.
      if (calls.length < 10) {
        throw new Error(`only found ${calls.length} showOfferModal call sites — the scanner is broken`);
      }
      const withCost = calls.filter((c) => c.args.has('get') && c.args.has('cost'));
      if (withCost.length < 8) {
        throw new Error(`only ${withCost.length} call sites parsed a get+cost pair — the scanner is broken`);
      }
    },
  },
  {
    name: 'offer modal: no call fills both halves with the same text',
    run: () => {
      const bad = [];
      for (const c of offerCalls()) {
        const get = c.args.get('get'), cost = c.args.get('cost');
        if (get == null || cost == null) continue;
        const costBranches = new Set(valueBranches(cost).filter((b) => !TRIVIAL.has(b)));
        const shared = valueBranches(get).filter((b) => !TRIVIAL.has(b) && costBranches.has(b));
        if (shared.length) {
          bad.push(`src/app.js:${c.line} renders the same text as both get and cost: ` +
            shared.map((b) => JSON.stringify(b)).join(', '));
        }
      }
      if (bad.length) {
        throw new Error(bad.join('; ') +
          ' — showOfferModal renders "you get X for Y", so identical halves print ' +
          'the same line twice. A caller with nothing to charge should omit `cost`.');
      }
    },
  },
];

module.exports = { CHECKS, offerCalls, topLevelEntries, objectLiteralAt, blankComments, valueBranches };
