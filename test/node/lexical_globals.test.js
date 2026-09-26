// A top-level `const` / `let` in a classic <script> is a global BINDING, not a
// property of window: other scripts reach it by bare name, but `window.X` /
// `root.X` / `globalThis.X` read undefined in the browser. run.js's bridge
// copies those consts onto globalThis for the test files, which hid exactly
// this bug (lairs.js › garrisonFor read `root.SHINY_RATE.monster` and threw
// every tick in the game). So pin it from the source text instead.

test('no module reads a top-level const/let through window/root/globalThis', () => {
  const lexical = new Set();
  for (const src of Object.values(ALL_SRC)) {
    for (const m of src.matchAll(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm)) lexical.add(m[1]);
  }
  const bad = [];
  for (const [file, src] of Object.entries(ALL_SRC)) {
    for (const m of src.matchAll(/\b(?:root|window|globalThis|self)\.([A-Za-z_$][\w$]*)/g)) {
      if (!lexical.has(m[1])) continue;
      // An assignment publishes a name onto window — that's the fix, not the bug.
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 4);
      if (/^\s*=[^=]/.test(after)) continue;
      // A module that also assigns it (window.X = X) makes the read good.
      if (new RegExp(`\\b(?:root|window|globalThis|self)\\.${m[1]}\\s*=[^=]`).test(Object.values(ALL_SRC).join('\n'))) continue;
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${file}:${line} ${m[0]}`);
    }
  }
  assert.eq(bad.length, 0, `read a lexical global by bare name instead: ${bad.join(', ')}`);
});
