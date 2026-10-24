// Host-side runner utilities. The game tests share a VM and patch its clocks;
// measure with the host's monotonic clock and keep execution sequential.
const fs = require('node:fs');
const path = require('node:path');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const SUITES = ['all', 'fast', 'stress'];
const HELP = `Usage: node test/node/run.js [options]
  --suite all|fast|stress  Select a suite (default: all)
  --file PATTERN          Match a filename or repo-relative path; supports * and ?
                         Repeat to select several files (OR)
  --match TEXT            Case-insensitive substring of the test name
  --list                  List selected cases without running them
  --report PATH           Write timings and outcomes as JSON
  --quiet                 Print only failures, summary and slowest cases
  --help                  Show this help

Suite, file and name filters combine with AND. An empty selection is an error.
Examples:
  node test/node/run.js --suite fast
  node test/node/run.js --file particles.test.js --file '*toast*'
  node test/node/run.js --match 'wreck repair'
`;
function parseArgs(args) {
  const options = { suite: 'all', files: [], match: '', quiet: false, list: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--quiet' || arg === '--list') { options[arg.slice(2)] = true; continue; }
    if (!['--suite', '--file', '--match', '--report'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    if (arg === '--file') options.files.push(value.replace(/\\/g, '/'));
    else options[arg.slice(2)] = value;
  }
  if (!SUITES.includes(options.suite)) throw new Error(`Unknown suite: ${options.suite}`);
  if (options.list && options.report) throw new Error('--list cannot write an execution report');
  return options;
}
function matchesFile(file, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  const re = new RegExp(`^${escaped}$`);
  return re.test(file) || re.test(path.posix.basename(file));
}
function selectTests(tests, options, stressFiles) {
  return tests.map(t => ({ ...t, suite: stressFiles.has(t.file) ? 'stress' : 'fast' }))
    .filter(t => (options.suite === 'all' || t.suite === options.suite)
      && (!options.files.length || options.files.some(p => matchesFile(t.file, p)))
      && t.name.toLowerCase().includes(options.match.toLowerCase()));
}
async function runTests(tests, { log = console.log, quiet = false } = {}) {
  const results = [], files = new Map(), started = now();
  let currentFile;
  const printFile = () => {
    if (!currentFile || quiet) return;
    const f = files.get(currentFile);
    log(`  ${f.failed ? '✗' : '✓'} ${currentFile}: ${f.passed} passed, ${f.failed} failed (${f.durationMs.toFixed(1)} ms)`);
  };
  for (const t of tests) {
    if (t.file !== currentFile) { printFile(); currentFile = t.file; }
    const file = files.get(t.file) || { file: t.file, passed: 0, failed: 0, durationMs: 0 };
    files.set(t.file, file);
    const start = now();
    let error;
    try { await t.fn(); }
    catch (e) { error = String(e?.stack || e); }
    const durationMs = now() - start;
    const status = error === undefined ? 'passed' : 'failed';
    file[status]++; file.durationMs += durationMs;
    results.push({ file: t.file, name: t.name, suite: t.suite, status, durationMs, ...(error === undefined ? {} : { error }) });
    if (error !== undefined) {
      log(`  ✗ ${t.file}: ${t.name} (${durationMs.toFixed(1)} ms)`);
      for (const line of error.split('\n').slice(0, 4)) log(`      ${line}`);
    }
  }
  printFile();
  const failed = results.filter(r => r.status === 'failed').length;
  return { passed: results.length - failed, failed, durationMs: now() - started,
    cases: results, files: [...files.values()] };
}
function printSummary(report, log = console.log) {
  log(`\n${report.passed} passed, ${report.failed} failed (${report.selected} selected / ${report.registered} registered; suite: ${report.suite})`);
  log(`Setup ${(report.setupMs / 1000).toFixed(2)}s; tests ${(report.durationMs / 1000).toFixed(2)}s; total ${(report.totalMs / 1000).toFixed(2)}s`);
  log('Slowest tests:');
  for (const t of [...report.cases].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10))
    log(`  ${t.durationMs.toFixed(1).padStart(9)} ms  ${t.file} — ${t.name}`);
}
function writeReport(filename, report) {
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
}
module.exports = { now, HELP, parseArgs, matchesFile, selectTests, runTests, printSummary, writeReport };
