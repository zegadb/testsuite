import fs from 'node:fs';
import path from 'node:path';
import { root, loadCorpus, engine, corpusDigest } from './corpus.mjs';

const cases = loadCorpus();
const digest = corpusDigest(cases);
const manifest = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
if ((manifest.match(new RegExp(`rev = "${engine.revision}"`, 'g')) ?? []).length !== 2) throw Error('Cargo dependencies and engine.json must pin the same revision');
const reports = {};
for (const host of ['native', 'browser']) {
  const file = path.join(root, `.cache/${host}.json`);
  if (!fs.existsSync(file)) continue;
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!report.fullCorpus || report.engine.revision !== engine.revision || report.corpusDigest !== digest) {
    console.warn(`Ignoring stale or partial ${host} report; run npm test -- --host ${host}`);
    continue;
  }
  reports[host] = report;
}
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/corpus.json'), JSON.stringify({ engine, digest, cases: cases.map(({ dir, ...test }) => test) }, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'public/results.json'), JSON.stringify(reports, null, 2) + '\n');
console.log(`Exported ${cases.length} cases; recorded hosts: ${Object.keys(reports).join(', ') || 'none (shown as not run)'}`);
