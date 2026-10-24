// Runner behavior is tested independently of the shared game VM. Temporary
// reports and injected CLI cases never modify the repository's tests or assets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Runner = require('./node/runner.cjs');
const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(__dirname, 'node/run.js');
const silent = () => {};

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'terracart-runner-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function cli(args) {
  return spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024,
  });
}
function injectedCli(args, registration) {
  // Compile the real entry point with extra in-memory registrations, preserving
  // its module paths, CLI handling, selection, reporting and exit behavior.
  const code = `
    const fs = require('node:fs'), Module = require('node:module'), path = require('node:path');
    const filename = ${JSON.stringify(ENTRY)};
    const marker = '// ── Run + report';
    let source = fs.readFileSync(filename, 'utf8');
    if (!source.includes(marker)) throw new Error('Runner registration marker changed');
    source = source.replace(marker, ${JSON.stringify(registration)} + '\\n' + marker);
    process.argv = [process.execPath, filename, ...${JSON.stringify(args)}];
    const module = new Module(filename);
    module.filename = filename;
    module.paths = Module._nodeModulePaths(path.dirname(filename));
    module._compile(source, filename);
  `;
  return spawnSync(process.execPath, ['-e', code], {
    cwd: ROOT, encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024,
  });
}
function successful(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('arguments have explicit defaults and reject unknown, incomplete and contradictory options', () => {
  assert.deepEqual(Runner.parseArgs([]), {
    suite: 'all', files: [], match: '', quiet: false, list: false,
  });
  const options = Runner.parseArgs(['--suite', 'stress', '--file', 'test\\node\\one.test.js',
    '--file', '*two*', '--match', 'DUST', '--quiet', '--report', '/tmp/result.json']);
  assert.deepEqual(options.files, ['test/node/one.test.js', '*two*']);
  assert.equal(options.suite, 'stress');
  assert.equal(options.match, 'DUST');
  assert.equal(options.quiet, true);
  assert.equal(options.report, '/tmp/result.json');
  assert.equal(Runner.parseArgs(['-h']).help, true);
  assert.equal(Runner.parseArgs(['--help']).help, true);
  for (const args of [['--wat'], ['--suite', 'unknown'], ['--suite'], ['--file'],
    ['--match'], ['--report'], ['--file', '--quiet'], ['--match', ''],
    ['--list', '--report', 'out.json']]) {
    assert.throws(() => Runner.parseArgs(args), Error, JSON.stringify(args));
  }
});

test('filename patterns support glob wildcards while treating regex punctuation literally', () => {
  const file = 'test/node/edge[1]+(a){b}^$|.test.js';
  assert.equal(Runner.matchesFile(file, path.posix.basename(file)), true);
  assert.equal(Runner.matchesFile(file, file), true);
  assert.equal(Runner.matchesFile(file, 'test/node/*.test.js'), true);
  assert.equal(Runner.matchesFile('test/node/a.test.js', '?.test.js'), true);
  assert.equal(Runner.matchesFile('test/node/ab.test.js', '?.test.js'), false);
  assert.equal(Runner.matchesFile('test/node/aXtest.js', 'a.test.js'), false);
  assert.equal(Runner.matchesFile('test/node/a.test.js.extra', 'a.test.js'), false);
  assert.equal(Runner.matchesFile('test/node/a1.test.js', 'a[1].test.js'), false);
  assert.equal(Runner.matchesFile('test/node/Particles.test.js', 'particles.test.js'), false);
});

test('suite, OR filename patterns and case-insensitive name filters intersect without running cases', () => {
  let calls = 0;
  const cases = [
    { file: 'test/node/one.test.js', name: 'Dust settles', fn: () => calls++ },
    { file: 'test/node/one.test.js', name: 'Other behavior', fn: () => calls++ },
    { file: 'test/node/two.test.js', name: 'DUST floats', fn: () => calls++ },
    { file: 'test/node/three.test.js', name: 'Dust expands', fn: () => calls++ },
  ];
  const stress = new Set(['test/node/one.test.js', 'test/node/two.test.js']);
  const selected = Runner.selectTests(cases, Runner.parseArgs(['--suite', 'stress',
    '--file', 'one.test.js', '--file', 'test/node/two.test.js', '--match', 'dust']), stress);
  assert.deepEqual(selected.map(row => row.name), ['Dust settles', 'DUST floats']);
  assert(selected.every(row => row.suite === 'stress'));
  assert.equal(calls, 0);
  assert(cases.every(row => !Object.hasOwn(row, 'suite')), 'selection does not alter registrations');
  assert.deepEqual(Runner.selectTests(cases, Runner.parseArgs(['--file', 'absent']), stress), []);
});

test('all is the disjoint union of fast and stress, with new files included in fast', () => {
  const cases = ['heavy', 'small', 'new'].map(name => ({
    file: `test/node/${name}.test.js`, name, fn: silent,
  }));
  const stress = new Set(['test/node/heavy.test.js']);
  const choose = suite => Runner.selectTests(cases, Runner.parseArgs(['--suite', suite]), stress);
  const all = choose('all'), fast = choose('fast'), slow = choose('stress');
  assert.deepEqual(fast.map(row => row.name), ['small', 'new']);
  assert.deepEqual(slow.map(row => row.name), ['heavy']);
  assert.equal(new Set([...fast, ...slow].map(row => row.file)).size, all.length);
  assert.deepEqual([...fast, ...slow].map(row => row.name).sort(), all.map(row => row.name).sort());
});

test('execution awaits each callback, records sync and async failures, and continues after thrown undefined', async () => {
  const events = [], lines = [];
  const result = await Runner.runTests([
    { file: 'a', name: 'awaited', suite: 'fast', fn: async () => {
      events.push('start'); await new Promise(resolve => setTimeout(resolve, 5)); events.push('end');
    } },
    { file: 'a', name: 'throw undefined', suite: 'fast', fn: () => { events.push('undefined'); throw undefined; } },
    { file: 'b', name: 'reject', suite: 'stress', fn: async () => { events.push('reject'); throw new Error('async failure'); } },
    { file: 'b', name: 'after failures', suite: 'stress', fn: () => { events.push('last'); } },
  ], { log: line => lines.push(line), quiet: true });
  assert.deepEqual(events, ['start', 'end', 'undefined', 'reject', 'last']);
  assert.equal(result.passed, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.cases[1].error, 'undefined');
  assert.match(result.cases[2].error, /async failure/);
  assert.deepEqual(result.cases.map(row => row.status), ['passed', 'failed', 'failed', 'passed']);
  assert.deepEqual(result.files.map(row => [row.file, row.passed, row.failed]), [['a', 1, 1], ['b', 1, 1]]);
  assert(lines.some(line => line.includes('throw undefined')), 'quiet mode still reports failures');
  assert(!lines.some(line => line.includes('0 failed')), 'quiet mode omits passing file summaries');
  for (const row of result.cases) assert(Number.isFinite(row.durationMs) && row.durationMs >= 0);
  for (const row of result.files) {
    assert.equal(row.durationMs, result.cases.filter(item => item.file === row.file).reduce((n, item) => n + item.durationMs, 0));
  }
  assert(result.durationMs >= result.files.reduce((n, row) => n + row.durationMs, 0));
});

test('host timing remains monotonic when a case rewrites Date.now', async () => {
  const original = Date.now;
  try {
    const before = Runner.now();
    const result = await Runner.runTests([{ file: 'clock', name: 'fake clock', suite: 'fast', fn: async () => {
      Date.now = () => -Infinity;
      await new Promise(resolve => setTimeout(resolve, 5));
      Date.now = () => Infinity;
    } }], { log: silent });
    assert.equal(result.failed, 0);
    assert(Number.isFinite(result.durationMs));
    assert(result.durationMs >= 0);
    assert(Runner.now() >= before);
    assert(Number.isFinite(result.cases[0].durationMs));
  } finally { Date.now = original; }
});

test('summary names selected and registered counts and sorts slowest cases without mutating results', () => {
  const lines = [];
  const cases = [
    { file: 'a', name: 'quick', durationMs: 1 },
    { file: 'b', name: 'slow', durationMs: 40 },
    { file: 'c', name: 'also slow', durationMs: 40 },
  ];
  Runner.printSummary({ passed: 2, failed: 1, selected: 3, registered: 99,
    suite: 'fast', setupMs: 100, durationMs: 81, totalMs: 181, cases }, line => lines.push(line));
  assert.match(lines[0], /3 selected \/ 99 registered; suite: fast/);
  assert.match(lines[1], /Setup 0.10s; tests 0.08s; total 0.18s/);
  assert.match(lines[3], /b — slow$/);
  assert.match(lines[4], /c — also slow$/);
  assert.match(lines[5], /a — quick$/);
  assert.deepEqual(cases.map(row => row.name), ['quick', 'slow', 'also slow']);
});

test('JSON reports create parent directories and preserve outcomes and timing metadata', async t => {
  const reportFile = path.join(temporary(t), 'nested', 'report.json');
  const result = await Runner.runTests([{file: 'fixture', name: 'pass', suite: 'fast', fn: silent}], {log: silent});
  const report = {schemaVersion: 1, suite: 'fast', selected: 1, registered: 2,
    filters: {files: ['fixture'], match: ''}, setupMs: 10, totalMs: 10 + result.durationMs,
    registration: [{file: 'fixture', durationMs: 3}], ...result};
  Runner.writeReport(reportFile, report);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportFile, 'utf8')), report);
  assert(!fs.readFileSync(reportFile, 'utf8').includes('"fn"'));
});

test('CLI help succeeds and invalid or empty selections exit 2', () => {
  const help = cli(['--help']); successful(help);
  assert.match(help.stdout, /--suite all\|fast\|stress/);
  assert(!help.stdout.includes('registered'));
  for (const args of [['--unknown'], ['--file'], ['--suite', 'absent'],
    ['--list', '--file', '__no_such_test__.test.js']]) {
    const result = cli(args);
    assert.ifError(result.error);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert(result.stderr.trim());
  }
});

test('CLI list never executes selected callbacks', () => {
  const result = injectedCli(['--list', '--file', 'runner-fixture.js'],
    "ctx.__tests.push({file:'runner-fixture.js',name:'list-only sentinel',fn(){throw new Error('must not execute')}});");
  successful(result);
  assert.match(result.stdout, /runner-fixture\.js  list-only sentinel/);
  assert.match(result.stdout, /1 selected \/ \d+ registered/);
  assert(!result.stdout.includes('must not execute'));
  assert(!result.stdout.includes('Slowest tests:'));
});

test('CLI scoped particle tests produce a successful report with source attribution', t => {
  const reportFile = path.join(temporary(t), 'particles.json');
  const result = cli(['--file', 'particles.test.js', '--quiet', '--report', reportFile]);
  successful(result);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.failed, 0);
  assert(report.selected > 0 && report.selected < report.registered);
  assert.equal(report.passed, report.selected);
  assert.equal(report.cases.length, report.selected);
  assert(report.cases.every(row => row.file === 'test/node/particles.test.js' && row.status === 'passed'));
  assert.deepEqual(report.filters, {files: ['particles.test.js'], match: ''});
  assert(report.registration.some(row => row.file === 'test/node/particles.test.js'));
  assert(report.totalMs >= report.durationMs && report.setupMs >= 0);
  assert.match(result.stdout, /selected \/ \d+ registered/);
});

test('CLI failures exit 1, retain reports and continue after rejected and undefined throws', t => {
  const reportFile = path.join(temporary(t), 'failures.json');
  const result = injectedCli(['--file', 'runner-fixture.js', '--quiet', '--report', reportFile], `
    ctx.__tests.push({file:'runner-fixture.js',name:'undefined',fn(){throw undefined}});
    ctx.__tests.push({file:'runner-fixture.js',name:'rejection',async fn(){throw new Error('intentional rejection')}});
    ctx.__tests.push({file:'runner-fixture.js',name:'last',fn(){}});
  `);
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(report.failed, 2); assert.equal(report.passed, 1); assert.equal(report.selected, 3);
  assert.equal(report.cases[0].error, 'undefined');
  assert.match(report.cases[1].error, /intentional rejection/);
  assert.equal(report.cases[2].status, 'passed');
  assert.match(result.stdout, /2 failed \(3 selected/);
});
