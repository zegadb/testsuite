import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { root, engine, loadCorpus, loadCase, grade, corpusDigest } from './corpus.mjs';
import { defaultZega } from './server.mjs';

async function main() {
  const { values } = parseArgs({ options: {
    host: { type: 'string', default: 'native' },
    filter: { type: 'string' }, case: { type: 'string' },
    online: { type: 'boolean', default: false },
    reverse: { type: 'boolean', default: false },
    binary: { type: 'string', default: path.join(root, '.target/debug/zql-native') },
    zega: { type: 'string', default: defaultZega },
    report: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node scripts/run.mjs [--host native|browser|server] [--case DIRECTORY | --filter TEXT] [--reverse] [--online] [--binary PATH] [--zega PATH] [--report PATH]');
    return;
  }
  if (!['native', 'browser', 'server'].includes(values.host)) throw Error('host must be native, browser or server');
  let cases = values.case ? [loadCase(values.case)] : loadCorpus();
  if (values.filter) cases = cases.filter(test => test.id.includes(values.filter));
  if (!cases.length) throw Error('no cases selected');
  if (values.reverse) cases.reverse();
  let adapter;
  if (values.host === 'browser') {
    const { createBrowserHost } = await import('./browser.mjs');
    adapter = await createBrowserHost();
  } else if (values.host === 'server') {
    const { createServerHost } = await import('./server.mjs');
    adapter = await createServerHost(path.resolve(values.zega));
  } else if (!fs.existsSync(values.binary)) {
    throw Error('native adapter missing; run CARGO_TARGET_DIR="$PWD/.target" cargo build --locked --bin zql-native');
  }
  const results = [];
  const counts = { PASS: 0, FAIL: 0, XFAIL: 0, XPASS: 0, SKIP: 0 };
  console.log(`ZQL conformance | host=${values.host} | engine=${engine.revision.slice(0, 12)} | ${values.online ? 'online' : 'offline'}`);
  try {
    for (const test of cases) {
      let reason, unsupported = false;
      if (test.network && !values.online) reason = 'remote import requires --online';
      if (adapter?.supports && !adapter.supports(test)) { reason = `unsupported: the ${values.host} host has no ${test.api} parser API`; unsupported = true; }
      if (test.network && values.online) {
        try {
          const response = await fetch(test.network, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw Error(`remote fixture returned HTTP ${response.status}`);
          await response.arrayBuffer();
        } catch (error) {
          if (error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name)) reason = 'offline: remote fixture unreachable';
          else throw error;
        }
      }
      if (reason) {
        counts.SKIP++;
        results.push({ id: test.id, status: 'SKIP', reason, ...(unsupported && { unsupported }) });
        console.log(`SKIP  ${test.id} — ${reason}`);
        continue;
      }
      const request = { source: test.source, api: test.api };
      let actual;
      if (adapter) actual = await adapter.run(test, request);
      else {
        const child = spawnSync(path.resolve(values.binary), [], { cwd: test.dir, input: JSON.stringify(request), encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
        if (child.error || child.status !== 0 || child.stderr) throw Error(`${test.id}: native adapter failed: ${child.error ?? child.stderr ?? child.signal}`);
        actual = JSON.parse(child.stdout);
      }
      if (typeof actual.ok !== 'boolean' || !['parse', 'run'].includes(actual.stage) || typeof actual.stdout !== 'string' || typeof actual.stderr !== 'string') throw Error(`${test.id}: malformed host outcome`);
      const verdict = grade(test, actual);
      counts[verdict.status]++;
      results.push({ id: test.id, ...verdict, actual });
      console.log(`${verdict.status.padEnd(5)} ${test.id}${verdict.status === 'XFAIL' ? ` — ${test.knownFailure.reason}` : ''}`);
      if (['FAIL', 'XPASS'].includes(verdict.status)) {
        for (const key of verdict.differences) {
          console.log(`  ${key} expected: ${JSON.stringify(test.expected[key])}`);
          console.log(`  ${key} actual:   ${JSON.stringify(actual[key])}`);
        }
        if (verdict.status === 'XPASS') console.log('  engine now matches the desired contract; remove the knownFailure record');
      }
    }
  } finally { await adapter?.close(); }
  const report = { host: values.host, engine, corpusDigest: corpusDigest(cases), fullCorpus: !values.case && !values.filter, online: values.online, counts, results };
  const reportPath = path.resolve(values.report ?? path.join(root, `.cache/${values.host}${report.fullCorpus ? '' : '-selection'}.json`));
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${values.host}: ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.XFAIL} known failures, ${counts.XPASS} unexpected passes, ${counts.SKIP} skipped; ${cases.length} total`);
  if (counts.FAIL || counts.XPASS) process.exitCode = 1;
  if (!counts.PASS && !counts.FAIL && !counts.XFAIL && !counts.XPASS) throw Error('all selected cases were skipped; no conformance was tested');
}

main().catch(error => { console.error(`BLOCKED: ${error.message}`); process.exitCode = 2; });
