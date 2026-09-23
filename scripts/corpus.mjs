import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const engine = JSON.parse(fs.readFileSync(path.join(root, 'engine.json'), 'utf8'));
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');
const folders = dir => fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();

export function loadCase(dir, category = path.basename(path.dirname(dir))) {
  dir = path.resolve(dir);
  const name = path.basename(dir);
  const files = fs.readdirSync(dir).sort();
  const markers = files.filter(f => /\.(pass|fail)\.zql$/.test(f));
  if (markers.length !== 1 || ![`${name}.pass.zql`, `${name}.fail.zql`].includes(markers[0])) throw Error(`${dir}: exactly one ${name}.pass.zql or .fail.zql is required`);
  if (read(dir, markers[0]) !== '') throw Error(`${dir}: outcome marker must be empty; source belongs in .code`);
  const meta = JSON.parse(read(dir, `${name}.json`));
  if (JSON.stringify(meta.hosts) !== '["native","browser"]') throw Error(`${dir}: hosts must be exactly native, browser`);
  if (!['parse', 'run'].includes(meta.stage) || !meta.title?.trim() || !meta.notes?.trim()) throw Error(`${dir}: title, stage and assertion notes are required`);
  if (meta.api && !['file', 'query', 'statement'].includes(meta.api)) throw Error(`${dir}: invalid API`);
  const expected = { ok: markers[0].endsWith('.pass.zql'), stage: meta.stage, stdout: read(dir, `${name}.stdout`), stderr: read(dir, `${name}.stderr`) };
  if (!expected.ok && !expected.stderr.trim()) throw Error(`${dir}: failures must pin the diagnostic text`);
  if (expected.ok && expected.stderr !== '') throw Error(`${dir}: passing cases must have empty stderr`);
  const source = read(dir, `${name}.code`);
  if (!source.trim()) throw Error(`${dir}: empty source`);
  if (meta.knownFailure && (!meta.knownFailure.reason || !meta.knownFailure.observed)) throw Error(`${dir}: known failures must pin the observed outcome and explain the engine bug`);
  return { ...meta, id: `${category}/${name}`, name, category, dir, api: meta.api ?? 'file', source, expected,
    files: Object.fromEntries(files.filter(f => !f.startsWith(`${name}.`)).map(f => [f, read(dir, f)])) };
}

export function loadCorpus(base = path.join(root, 'tests')) {
  const cases = folders(base).flatMap(category => folders(path.join(base, category)).map(name => loadCase(path.join(base, category, name), category)));
  if (!cases.length) throw Error('corpus is empty');
  return cases;
}

export function compare(actual, expected) {
  return ['ok', 'stage', 'stdout', 'stderr'].filter(key => actual[key] !== expected[key]);
}

export function grade(test, actual) {
  const differences = compare(actual, test.expected);
  if (!differences.length) return { status: test.knownFailure ? 'XPASS' : 'PASS', differences };
  if (test.knownFailure && !compare(actual, test.knownFailure.observed).length) return { status: 'XFAIL', differences };
  return { status: 'FAIL', differences };
}

export function corpusDigest(cases) {
  const stable = [...cases].sort((a, b) => a.id.localeCompare(b.id)).map(({ dir, ...test }) => test);
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
