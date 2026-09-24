import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, engine, compare, corpusDigest, loadCorpus } from './corpus.mjs';

export const HOSTS = ['native', 'browser', 'server'];

export function readReport(host, digest) {
  const report = JSON.parse(fs.readFileSync(path.join(root, `.cache/${host}.json`), 'utf8'));
  if (report.host !== host || !report.fullCorpus || report.engine.revision !== engine.revision || report.corpusDigest !== digest) throw Error(`${host} report is stale or incomplete; rerun the complete corpus`);
  return report;
}

/// The one comparison every host pair goes through. A case is identical when
/// both hosts produced complete outcomes that agree on ok, stage, stdout and
/// stderr, and neither graded FAIL/XPASS. Skipping on both hosts is recorded,
/// not counted as parity. A host may decline a case it cannot express only
/// when its report marks it `unsupported` and the case uses a parser-only API
/// (every executable document must run everywhere); that is listed, never silently
/// counted as a match. Anything else is a divergence.
export function compareReports(cases, left, right) {
  const tally = { identical: 0, skipped: 0, unsupported: [], divergences: [] };
  const byId = report => new Map(report.results.map(result => [result.id, result]));
  const [a, b] = [byId(left), byId(right)];
  for (const test of cases) {
    const l = a.get(test.id), r = b.get(test.id);
    if (!l || !r) { tally.divergences.push({ id: test.id, reason: `${!l ? left.host : right.host} report has no result` }); continue; }
    if (l.status === 'SKIP' && r.status === 'SKIP') { tally.skipped++; continue; }
    const declined = [l, r].find(result => result.status === 'SKIP');
    if (declined?.unsupported && test.api !== 'file') { tally.unsupported.push({ id: test.id, host: declined === l ? left.host : right.host, reason: declined.reason }); continue; }
    const fields = l.actual && r.actual ? compare(l.actual, r.actual) : ['outcome'];
    const graded = [l, r].filter(result => ['FAIL', 'XPASS'].includes(result.status));
    if (fields.length || graded.length) tally.divergences.push({ id: test.id, fields, statuses: [l.status, r.status], [left.host]: l.actual ?? l.reason, [right.host]: r.actual ?? r.reason });
    else tally.identical++;
  }
  return tally;
}

export function compareHosts(hosts = HOSTS) {
  const cases = loadCorpus();
  const digest = corpusDigest(cases);
  const reports = Object.fromEntries(hosts.map(host => [host, readReport(host, digest)]));
  let failed = false;
  for (let i = 0; i < hosts.length; i++) for (let j = i + 1; j < hosts.length; j++) {
    const tally = compareReports(cases, reports[hosts[i]], reports[hosts[j]]);
    for (const divergence of tally.divergences) console.error(`DIVERGED ${hosts[i]}/${hosts[j]} ${divergence.id}: ${JSON.stringify(divergence)}`);
    for (const { id, host, reason } of tally.unsupported) console.log(`N/A      ${hosts[i]}/${hosts[j]} ${id} — ${host}: ${reason}`);
    console.log(`Parity ${hosts[i]}/${hosts[j]}: ${tally.identical} identical outcomes, ${tally.divergences.length} divergences, ${tally.skipped} skipped on both hosts, ${tally.unsupported.length} unsupported on one host`);
    if (tally.divergences.length || !tally.identical) failed = true;
  }
  return !failed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const hosts = process.argv.slice(2);
    if (hosts.some(host => !HOSTS.includes(host)) || (hosts.length && hosts.length < 2)) throw Error(`usage: node scripts/compare-hosts.mjs [${HOSTS.join(' ')}] (at least two; default all)`);
    if (!compareHosts(hosts.length ? hosts : HOSTS)) process.exitCode = 1;
  } catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 2; }
}
