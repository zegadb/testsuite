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
