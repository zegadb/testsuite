import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, grade, loadCase } from './corpus.mjs';

function invoke(args) {
  const child = spawnSync(process.execPath, ['scripts/run.mjs', ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.ifError(child.error);
  return child;
}

function copiedCase(id, work) {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const folder = fs.mkdtempSync(path.join(root, '.tmp/runner-test-'));
  const dest = path.join(folder, path.basename(id));
  fs.cpSync(path.join(root, 'tests', id), dest, { recursive: true });
  try { work(dest, ['--case', dest, '--report', path.join(folder, 'report.json')]); }
  finally { fs.rmSync(folder, { recursive: true, force: true }); }
}

test('a relocated case reads only its own local import and fails on wrong result bytes', () => {
  copiedCase('import/json_array', (dir, args) => {
    assert.equal(invoke(args).status, 0);
    const stdout = path.join(dir, 'json_array.stdout');
    const original = fs.readFileSync(stdout);
    fs.writeFileSync(stdout, '[]\n');
    const wrong = invoke(args);
    assert.equal(wrong.status, 1, wrong.stdout + wrong.stderr);
    assert.match(wrong.stdout, /stdout expected: "\[\]\\n"/);
    fs.writeFileSync(stdout, original);
    assert.equal(invoke(args).status, 0);
  });
});

test('diagnostic text, outcome and stage are independently enforced', () => {
  copiedCase('constraints/unique_insert', (dir, args) => {
    assert.equal(invoke(args).status, 0);
    const stderr = path.join(dir, 'unique_insert.stderr');
    const original = fs.readFileSync(stderr);
    fs.writeFileSync(stderr, 'wrong diagnostic\n');
    assert.equal(invoke(args).status, 1);
    fs.writeFileSync(stderr, original);
    const metadata = path.join(dir, 'unique_insert.json');
    const meta = JSON.parse(fs.readFileSync(metadata));
    fs.writeFileSync(metadata, JSON.stringify({ ...meta, stage: 'parse' }));
    assert.equal(invoke(args).status, 1);
    fs.writeFileSync(metadata, JSON.stringify(meta));
    fs.renameSync(path.join(dir, 'unique_insert.fail.zql'), path.join(dir, 'unique_insert.pass.zql'));
    fs.writeFileSync(stderr, '');
    assert.equal(invoke(args).status, 1);
  });
});

test('missing coverage, invalid hosts and broken adapters fail closed', () => {
  assert.equal(invoke(['--filter', 'not-a-case']).status, 2);
  assert.equal(invoke(['--host', 'http']).status, 2);
  assert.equal(invoke(['--binary', '/nonexistent/adapter']).status, 2);
  assert.equal(invoke(['--filter', 'remote_url']).status, 2);
  copiedCase('query/empty_scan', (dir, args) => {
    const file = path.join(dir, 'empty_scan.json');
    const meta = JSON.parse(fs.readFileSync(file));
    fs.writeFileSync(file, JSON.stringify({ ...meta, hosts: ['native', 'browser', 'http'] }));
    assert.equal(invoke(args).status, 2);
    fs.writeFileSync(file, JSON.stringify(meta));
    fs.unlinkSync(path.join(dir, 'empty_scan.stdout'));
    assert.throws(() => loadCase(dir));
  });
});

test('known failures require the exact recorded bug and XPASS needs review', () => {
  const expected = { ok: true, stage: 'run', stdout: '[]\n', stderr: '' };
  const observed = { ...expected, stdout: 'null\n' };
  const fixture = { expected, knownFailure: { reason: 'specific engine bug', observed } };
  assert.equal(grade(fixture, observed).status, 'XFAIL');
  assert.equal(grade(fixture, expected).status, 'XPASS');
  assert.equal(grade(fixture, { ...observed, stderr: 'different failure' }).status, 'FAIL');
});

test('host parity fails on any divergence and never counts a declined document as a match', async () => {
  const { compareReports } = await import('./compare-hosts.mjs');
  const { serverOutcome } = await import('./server.mjs');
  const cases = [{ id: 'a/doc', api: 'file', stage: 'run' }, { id: 'a/parser', api: 'query', stage: 'parse' }];
  const outcome = { ok: true, stage: 'run', stdout: '[]\n', stderr: '' };
  const report = (host, results) => ({ host, results });
  const native = report('native', [{ id: 'a/doc', status: 'PASS', actual: outcome }, { id: 'a/parser', status: 'PASS', actual: { ...outcome, ok: false, stage: 'parse' } }]);
  const declined = { status: 'SKIP', reason: 'unsupported', unsupported: true };
  const good = compareReports(cases, native, report('server', [{ id: 'a/doc', status: 'PASS', actual: outcome }, { id: 'a/parser', ...declined }]));
  assert.deepEqual([good.identical, good.divergences.length, good.unsupported.length], [1, 0, 1]);
  const bytes = compareReports(cases, native, report('server', [{ id: 'a/doc', status: 'PASS', actual: { ...outcome, stdout: '[ ]\n' } }, { id: 'a/parser', ...declined }]));
  assert.deepEqual(bytes.divergences.map(d => d.fields), [['stdout']]);
  const dodged = compareReports(cases, native, report('server', [{ id: 'a/doc', ...declined }, { id: 'a/parser', ...declined }]));
  assert.equal(dodged.divergences.length, 1);
  const missing = compareReports(cases, native, report('server', [{ id: 'a/parser', ...declined }]));
  assert.equal(missing.divergences.length, 1);
  // The server's body is sliced, not re-serialized: JavaScript would move "10" before "b".
  assert.equal(serverOutcome(cases[0], { status: 200, text: '{"ok":true,"result":{"b":1,"10":2.0}}' }).stdout, '{"b":1,"10":2.0}\n');
  const parse = { stage: 'parse' };
  assert.equal(serverOutcome(parse, { status: 400, text: '{"error":"execution error: error: x","ok":false}' }).stderr, 'error: x\n');
  assert.notEqual(serverOutcome(parse, { status: 400, text: '{"error":"error: x","ok":false}' }).stderr, 'error: x\n');
  assert.throws(() => serverOutcome(parse, { status: 500, text: '{"error":"database worker failed","ok":false}' }));
});
