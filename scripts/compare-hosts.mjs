import fs from 'node:fs';
import path from 'node:path';
import { root, engine, compare, corpusDigest, loadCorpus } from './corpus.mjs';

const digest = corpusDigest(loadCorpus());
const read = host => {
  const report = JSON.parse(fs.readFileSync(path.join(root, `.cache/${host}.json`), 'utf8'));
  if (!report.fullCorpus || report.engine.revision !== engine.revision || report.corpusDigest !== digest) throw Error(`${host} report is stale or incomplete; rerun the complete corpus`);
  return report;
};
const native = read('native');
const browser = read('browser');
let matched = 0, skipped = 0, failed = 0;
for (const left of native.results) {
  const right = browser.results.find(r => r.id === left.id);
  if (!right) throw Error(`browser report has no ${left.id}`);
  if (left.status === 'SKIP' && right.status === 'SKIP') { skipped++; continue; }
  if (!left.actual || !right.actual || compare(left.actual, right.actual).length || ['FAIL', 'XPASS'].includes(left.status) || ['FAIL', 'XPASS'].includes(right.status)) {
    console.error(`DIVERGED ${left.id}`); failed++;
  } else matched++;
}
console.log(`Parity: ${matched} identical outcomes, ${failed} divergences, ${skipped} skipped on both hosts`);
if (failed || !matched) process.exitCode = 1;
