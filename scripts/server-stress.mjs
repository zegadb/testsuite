// Stress `zega start` (the zega-server routes) as a deployment would use it:
// concurrent mixed load, kill -9 durability, growth to 100k nodes / 300k
// relationships, bad input under load, and latency percentiles. One JSON line
// per result on stdout and in .cache/server-stress.jsonl. Exit 1 on any failed
// check, 2 when the harness itself cannot run.
//
//   node scripts/server-stress.mjs [--zega PATH] [--duration 120] [--only concurrency,durability,growth,bad-input,nesting]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { root } from './corpus.mjs';
import { defaultZega, assertPinnedZega, startServer } from './server.mjs';

const { values } = parseArgs({ options: {
  zega: { type: 'string', default: defaultZega },
  duration: { type: 'string', default: '120' },
  only: { type: 'string' },
  nodes: { type: 'string', default: '100000' },
} });
const zega = path.resolve(values.zega);
const durationMs = Number(values.duration) * 1000;
const totalNodes = Number(values.nodes);
const selected = values.only ? values.only.split(',') : ['concurrency', 'durability', 'growth', 'bad-input', 'nesting'];
const out = path.join(root, '.cache/server-stress.jsonl');
let failed = false;

const SCHEMA = `schema {
  type Item {
    key: String
    a: String
    b: String
    c: Int
    d: Bool
    links -> Item[]
  }
}

unique {
  Item { key }
}
`;
const str = value => JSON.stringify(value);
const doc = body => ({ query: `${SCHEMA}\n${body}`, document: true });

function emit(record) {
  const line = JSON.stringify(record);
  console.log(line);
  fs.appendFileSync(out, line + '\n');
  if (record.ok === false) failed = true;
}

function rssKb(pid) {
  try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) || null; } catch { return null; }
}

function peakRss(pid, everyMs = 20) {
  let peak = rssKb(pid) ?? 0;
  const timer = setInterval(() => { peak = Math.max(peak, rssKb(pid) ?? 0); }, everyMs);
  return () => { clearInterval(timer); return Math.max(peak, rssKb(pid) ?? 0); };
}

const percentile = (samples, p) => {
  if (!samples.length) return null;
  const sorted = [...samples].sort((x, y) => x - y);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(2));
};
const stats = samples => ({ n: samples.length, p50_ms: percentile(samples, 50), p99_ms: percentile(samples, 99), max_ms: percentile(samples, 100) });

const workRoot = () => {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  return fs.mkdtempSync(path.join(root, '.tmp/stress-'));
};
const launch = (work, extra = {}) => startServer(zega, { cwd: work, data: path.join(work, 'data'), token: randomBytes(24).toString('hex'), ...extra });

async function timed(server, body) {
  const started = performance.now();
  const response = await server.request('POST', '/zql', body);
  return { ...response, ms: performance.now() - started };
}

// Every field of an Item written here encodes the same (key, c) pair, so any
// read that mixes two writes shows up as a != b or a != `${key}#${c}`.
const itemFields = (key, c, d = true) => `key: ${str(key)} && a: ${str(`${key}#${c}`)} && b: ${str(`${key}#${c}`)} && c: ${c} && d: ${d}`;
const torn = item => item.a !== item.b || item.a !== `${item.key}#${item.c}`;

async function allItems(server) {
  const response = await server.request('POST', '/zql', doc('query {\n  Item { key a b c d }\n}\n'));
  if (response.status !== 200) throw Error(`full scan failed: HTTP ${response.status} ${response.text.slice(0, 200)}`);
  return JSON.parse(response.text).result;
}

async function concurrency() {
  const work = workRoot();
  const server = await launch(work);
  const clients = 16;
  const latency = { read: [], create: [], update: [], scan: [] };
  const errors = [], tornReads = [], staleReads = [];
  const acked = new Map(); // key -> last acknowledged c
  let deadline = Date.now() + durationMs;
  const client = async id => {
    const own = [];
    let seq = 0;
    while (Date.now() < deadline) {
      const roll = Math.random();
      try {
        if (roll < 0.3 || !own.length) {
          const key = `c${id}-${seq++}`;
          const r = await timed(server, doc(`mutation {\n  Item(${itemFields(key, 0)})\n}\n`));
          latency.create.push(r.ms);
          if (r.status !== 200) { errors.push({ op: 'create', key, status: r.status, body: r.text.slice(0, 300) }); continue; }
          own.push(key); acked.set(key, 0);
        } else if (roll < 0.5) {
          const key = own[Math.floor(Math.random() * own.length)];
          const c = acked.get(key) + 1;
          const token = str(`${key}#${c}`);
          const r = await timed(server, doc(`mutation {\n  Item(key: ${str(key)}) set a: ${token}, b: ${token}, c: ${c}\n}\n`));
          latency.update.push(r.ms);
          if (r.status !== 200) { errors.push({ op: 'update', key, status: r.status, body: r.text.slice(0, 300) }); continue; }
          acked.set(key, c);
        } else if (roll < 0.98) {
          // Read one of our own keys (read-your-writes: only this client
          // updates it, so the value must be exactly the last acknowledged one)
          // or anyone's key (must be internally consistent).
          const mine = Math.random() < 0.5;
          const keys = mine ? own : [...acked.keys()];
          const key = keys[Math.floor(Math.random() * keys.length)];
          const expected = acked.get(key);
          const r = await timed(server, doc(`query {\n  Item(key: ${str(key)}) { key a b c d }\n}\n`));
          latency.read.push(r.ms);
          if (r.status !== 200) { errors.push({ op: 'read', key, status: r.status, body: r.text.slice(0, 300) }); continue; }
          const item = JSON.parse(r.text).result;
          if (!item || torn(item)) tornReads.push({ key, item });
          else if (mine && item.c !== expected) staleReads.push({ key, expected, got: item.c });
          else if (!mine && item.c < expected) staleReads.push({ key, expected: `>= ${expected}`, got: item.c });
        } else {
          const started = performance.now();
          const items = await allItems(server);
          latency.scan.push(performance.now() - started);
          for (const item of items) if (torn(item)) tornReads.push({ key: item.key, item });
        }
      } catch (error) { errors.push({ op: 'transport', error: String(error) }); }
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: clients }, (_, id) => client(id)));
  const seconds = (Date.now() - started) / 1000;
  const final = await allItems(server);
  const byKey = new Map(final.map(item => [item.key, item]));
  const missing = [...acked.keys()].filter(key => !byKey.has(key));
  const extra = final.filter(item => !acked.has(item.key)).map(item => item.key);
  const wrongFinal = [...acked].filter(([key, c]) => byKey.get(key) && byKey.get(key).c !== c).map(([key, c]) => ({ key, acked: c, final: byKey.get(key).c }));
  const health = await server.request('GET', '/health');
  const alive = server.child.exitCode === null;
  await server.stop('SIGINT');
  const ops = Object.values(latency).reduce((n, s) => n + s.length, 0);
  const ok = !errors.length && !tornReads.length && !staleReads.length && !missing.length && !extra.length && !wrongFinal.length && final.length === acked.size && health.status === 200 && alive;
  emit({ test: 'concurrency', ok, clients, seconds, ops, ops_per_s: Math.round(ops / seconds), acked_creates: acked.size, final_nodes: final.length,
    errors: errors.length, torn_reads: tornReads.length, stale_reads: staleReads.length, missing: missing.length, extra: extra.length, wrong_final: wrongFinal.length,
    read: stats(latency.read), create: stats(latency.create), update: stats(latency.update), scan: stats(latency.scan),
    samples: { errors: errors.slice(0, 5), torn: tornReads.slice(0, 5), stale: staleReads.slice(0, 5), missing: missing.slice(0, 5), extra: extra.slice(0, 5), wrong_final: wrongFinal.slice(0, 5) } });
  fs.rmSync(work, { recursive: true, force: true });
}

async function durability() {
  // Each write is ONE statement creating a parent and three linked children.
  // After kill -9, every acknowledged write must be whole, and an
  // unacknowledged (in-flight) one must be whole or absent, never partial.
  const work = workRoot();
  const token = randomBytes(24).toString('hex');
  const cycles = 3, clients = 16;
  const acked = new Set(), inflight = new Set();
  const problems = [];
  const cycleReports = [];
  const children = key => [0, 1, 2].map(i => `${key}/${i}`);
  const write = key => doc(`mutation {\n  Item(${itemFields(key, 0, true)}) {\n${children(key).map(child => `    links -> Item(${itemFields(child, 0, false)})`).join('\n')}\n  }\n}\n`);
  for (let cycle = 0; cycle < cycles; cycle++) {
    const server = await launch(work, { token });
    let stop = false;
    let ackedThisCycle = 0;
    const client = async id => {
      for (let seq = 0; !stop; seq++) {
        const key = `k${cycle}-${id}-${seq}`;
        inflight.add(key);
        try {
          const r = await server.request('POST', '/zql', write(key));
          if (r.status === 200) { inflight.delete(key); acked.add(key); ackedThisCycle++; }
          else { inflight.delete(key); problems.push({ cycle, key, status: r.status, body: r.text.slice(0, 200) }); }
        } catch { return; } // the connection died with the process: stays in-flight
      }
    };
    const load = Promise.all(Array.from({ length: clients }, (_, id) => client(id)));
    await new Promise(resolve => setTimeout(resolve, 3000 + 1000 * cycle));
    server.child.kill('SIGKILL');
    stop = true;
    const exit = await server.exited;
    await load;
    cycleReports.push({ cycle, acked: ackedThisCycle, in_flight_at_kill: [...inflight].filter(key => key.startsWith(`k${cycle}-`)).length, exit_signal: exit.signal });
  }
  const restartStarted = performance.now();
  const server = await launch(work, { token });
  const parents = await server.request('POST', '/zql', doc('query {\n  Item(d != false) {\n    key a b c\n    links -> Item { key a b c }\n  }\n}\n'));
  const restartMs = performance.now() - restartStarted;
  const every = await allItems(server);
  await server.stop('SIGINT');
  if (parents.status !== 200) throw Error(`durability query failed: HTTP ${parents.status}`);
  const present = JSON.parse(parents.text).result;
  const presentKeys = new Set(present.map(item => item.key));
  const reached = new Set();
  for (const parent of present) {
    const linked = parent.links.map(child => child.key).sort();
    linked.forEach(key => reached.add(key));
    if (torn(parent) || parent.links.some(torn)) problems.push({ kind: 'torn', key: parent.key });
    if (str(linked) !== str(children(parent.key))) problems.push({ kind: 'partial', key: parent.key, linked });
    if (!acked.has(parent.key) && !inflight.has(parent.key)) problems.push({ kind: 'phantom', key: parent.key });
  }
  const lost = [...acked].filter(key => !presentKeys.has(key));
  const orphans = every.filter(item => !item.d && !reached.has(item.key)).map(item => item.key);
  const inflightPresent = [...inflight].filter(key => presentKeys.has(key)).length;
  const ok = !lost.length && !orphans.length && !problems.length && every.length === present.length * 4;
  emit({ test: 'durability', ok, cycles: cycleReports, acked_writes: acked.size, in_flight_writes: inflight.size, in_flight_present_whole: inflightPresent,
    parents_present: present.length, nodes_present: every.length, lost_acked: lost.length, orphan_children: orphans.length, problems: problems.length,
    restart_to_first_query_ms: Math.round(restartMs), wal_bytes: fs.statSync(path.join(work, 'data/wal.bin')).size,
    samples: { lost: lost.slice(0, 5), orphans: orphans.slice(0, 5), problems: problems.slice(0, 5) } });
  fs.rmSync(work, { recursive: true, force: true });
}

async function growth() {
  const work = workRoot();
  const token = randomBytes(24).toString('hex');
  let server = await launch(work, { token });
  const pid = server.child.pid;
  const batch = 1000;
  const checkpoints = new Set([10000, 50000, 100000, totalNodes]);
  const rss = { start_kb: rssKb(pid) };
  const loadMs = [];
  const loaded = performance.now();
  // Node i links to i-1, i-7, i-13 (all already present), or i+1..i+3 for the
  // first 13: exactly three relationships per node, loaded batch by batch.
  const targets = i => i >= 13 ? [i - 1, i - 7, i - 13] : [i + 1, i + 2, i + 3];
  for (let start = 0; start < totalNodes; start += batch) {
    const end = Math.min(totalNodes, start + batch);
    const rows = [], links = [];
    for (let i = start; i < end; i++) {
      rows.push({ key: `n${i}`, a: `n${i}#${i}`, b: `n${i}#${i}`, c: i, d: i % 2 === 0 });
    }
    for (let i = start; i < end; i++) for (const j of targets(i)) links.push({ from: `n${i}`, to: `n${j}` });
    const t = performance.now();
    const nodes = await server.request('POST', '/zql', { ...doc('mutation json ["./nodes.json"] {\n  Item(key: $key && a: $a && b: $b && c: $c && d: $d)\n}\n'), sources: { './nodes.json': str(rows) } });
    // Links for the first batch point forward inside it, so they follow its nodes.
    const edges = await server.request('POST', '/zql', { ...doc('mutation json ["./links.json"] {\n  Item(key: $from) {\n    links -> link Item(key: $to)\n  }\n}\n'), sources: { './links.json': str(links) } });
    loadMs.push(performance.now() - t);
    if (nodes.status !== 200 || edges.status !== 200) throw Error(`growth load failed at ${start}: ${nodes.status} ${edges.status} ${(nodes.status !== 200 ? nodes : edges).text.slice(0, 300)}`);
    if (checkpoints.has(end)) rss[`at_${end}_kb`] = rssKb(pid);
  }
  const loadSeconds = (performance.now() - loaded) / 1000;
  const walBytes = fs.statSync(path.join(work, 'data/wal.bin')).size;

  // Latency at full size, single client.
  const pick = () => Math.floor(Math.random() * totalNodes);
  const latency = { read: [], write: [], two_hop: [] };
  const twoHopSizes = new Set();
  for (let i = 0; i < 1000; i++) {
    const key = `n${pick()}`;
    let r = await timed(server, doc(`query {\n  Item(key: ${str(key)}) { key a b c d }\n}\n`));
    if (r.status !== 200 || torn(JSON.parse(r.text).result)) throw Error(`read ${key} failed: ${r.text.slice(0, 200)}`);
    latency.read.push(r.ms);
    r = await timed(server, doc(`query {\n  Item(key: ${str(key)}) {\n    key\n    links -> Item {\n      key\n      links -> Item { key }\n    }\n  }\n}\n`));
    if (r.status !== 200) throw Error(`2-hop ${key} failed: ${r.text.slice(0, 200)}`);
    const result = JSON.parse(r.text).result;
    twoHopSizes.add(result.links.reduce((n, child) => n + child.links.length, 0));
    latency.two_hop.push(r.ms);
    r = await timed(server, doc(`mutation {\n  Item(${itemFields(`w${i}`, 0)})\n}\n`));
    if (r.status !== 200) throw Error(`write failed: ${r.text.slice(0, 200)}`);
    latency.write.push(r.ms);
  }

  // The server exposes no snapshot/compaction (zega-server has no route, and
  // `zega start` never calls Zega::snapshot), so the heaviest whole-graph
  // operation a client can trigger is GET /graph. Measure it as the snapshot.
  const stopPeak = peakRss(pid);
  const dumpStarted = performance.now();
  const dump = await server.request('GET', '/graph');
  const dumpMs = performance.now() - dumpStarted;
  const dumpPeak = stopPeak();
  if (dump.status !== 200) throw Error(`GET /graph failed: HTTP ${dump.status}`);
  const graph = JSON.parse(dump.text).result;
  const countNodes = graph.nodes.length, countRels = graph.rels.length;
  rss.before_restart_kb = rssKb(pid);
  await server.stop('SIGINT');

  // Restart on the same data dir: WAL replay until the first answered query.
  const restartStarted = performance.now();
  server = await launch(work, { token });
  const listening = performance.now() - restartStarted;
  const first = await server.request('POST', '/zql', doc('query {\n  Item(key: "n0") { key }\n}\n'));
  const firstQueryMs = performance.now() - restartStarted;
  rss.after_restart_kb = rssKb(server.child.pid);
  const survived = await server.request('POST', '/zql', doc(`query {\n  Item(key: "n${totalNodes - 1}") {\n    key\n    links -> Item { key }\n  }\n}\n`));
  await server.stop('SIGINT');
  const tail = JSON.parse(survived.text).result;
  const expectedNodes = totalNodes + 1000, expectedRels = totalNodes * 3;
  const ok = first.status === 200 && countNodes === expectedNodes && countRels === expectedRels && tail?.links?.length === 3 && str([...twoHopSizes]) === '[9]';
  emit({ test: 'growth', ok, nodes: countNodes, relationships: countRels, expected_nodes: expectedNodes, expected_relationships: expectedRels,
    load_seconds: Number(loadSeconds.toFixed(1)), batch_ms: stats(loadMs), rss_kb: rss, wal_bytes: walBytes,
    snapshot: { exposed_by_server: false, measured: 'GET /graph', ms: Math.round(dumpMs), bytes: dump.text.length, peak_rss_kb: dumpPeak },
    restart: { listening_ms: Math.round(listening), first_query_ms: Math.round(firstQueryMs) } });
  emit({ test: 'timings', ok: true, at_nodes: totalNodes, relationships: countRels, read: stats(latency.read), write: stats(latency.write), two_hop: { ...stats(latency.two_hop), results_per_query: [...twoHopSizes] } });
  fs.rmSync(work, { recursive: true, force: true });
}

async function badInput() {
  const work = workRoot();
  const server = await launch(work);
  const seed = Array.from({ length: 200 }, (_, i) => `mutation {\n  Item(${itemFields(`s${i}`, 0)})\n}\n`).join('\n');
  if ((await server.request('POST', '/zql', doc(seed))).status !== 200) throw Error('seed failed');
  const seconds = Math.max(10, Math.min(30, durationMs / 4000));
  const phase = async (withBad) => {
    const deadline = Date.now() + seconds * 1000;
    const good = { read: [], write: [] }, goodErrors = [], badResults = {};
    const goodClient = async id => {
      for (let seq = 0; Date.now() < deadline; seq++) {
        try {
          if (seq % 3 === 0) {
            const r = await timed(server, doc(`mutation {\n  Item(${itemFields(`g${withBad}-${id}-${seq}`, 0)})\n}\n`));
            good.write.push(r.ms);
            if (r.status !== 200) goodErrors.push({ status: r.status, body: r.text.slice(0, 200) });
          } else {
            const r = await timed(server, doc(`query {\n  Item(key: "s${seq % 200}") { key a b c }\n}\n`));
            good.read.push(r.ms);
            if (r.status !== 200 || torn(JSON.parse(r.text).result)) goodErrors.push({ status: r.status, body: r.text.slice(0, 200) });
          }
        } catch (error) { goodErrors.push({ transport: String(error) }); }
      }
    };
    const raw = async (name, body, headers = { ...server.auth, 'content-type': 'application/json' }) => {
      try {
        const response = await fetch(server.url + '/zql', { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) });
        await response.arrayBuffer();
        return response.status;
      } catch (error) { return `transport: ${error.cause?.code ?? error.message}`; }
    };
    const bad = [
      ['malformed_json', () => raw('malformed_json', '{"query": "schema {')],
      ['not_json', () => raw('not_json', 'query { Item { key } }')],
      ['wrong_content_type', () => raw('wrong_content_type', str(doc('query {\n  Item { key }\n}\n')), { ...server.auth, 'content-type': 'text/plain' })],
      ['unknown_field', () => raw('unknown_field', str({ ...doc('query {\n  Item { key }\n}\n'), extra: 1 }))],
      ['wrong_type', () => raw('wrong_type', str({ query: 42, document: 'yes' }))],
      ['empty_body', () => raw('empty_body', '')],
      ['invalid_utf8', () => raw('invalid_utf8', Buffer.from([0x7b, 0x22, 0x71, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]))],
      ['malformed_zql', () => raw('malformed_zql', str(doc('query {\n  Item(key: ) {\n')))],
      ['unknown_type', () => raw('unknown_type', str(doc('query {\n  Nope { key }\n}\n')))],
      ['deep_json_nesting', () => raw('deep_json_nesting', '['.repeat(100000))],
      ['no_token', () => raw('no_token', str(doc('query {\n  Item { key }\n}\n')), { 'content-type': 'application/json' })],
      ['oversized_body', () => raw('oversized_body', str({ query: 'x'.repeat(17_000_000), document: true }))],
    ];
    const badClient = async id => {
      for (let i = id; Date.now() < deadline; i++) {
        const [name, send] = bad[i % bad.length];
        const status = await send();
        (badResults[name] ??= {})[status] = ((badResults[name] ??= {})[status] ?? 0) + 1;
      }
    };
    await Promise.all([
      ...Array.from({ length: 8 }, (_, id) => goodClient(id)),
      ...(withBad ? Array.from({ length: 8 }, (_, id) => badClient(id)) : []),
    ]);
    return { good, goodErrors, badResults };
  };
  const baseline = await phase(false);
  const loaded = await phase(true);
  const health = await server.request('GET', '/health');
  const alive = server.child.exitCode === null && server.child.signalCode === null;
  const stderr = server.stderr();
  await server.stop('SIGINT');
  // A bad request must be refused with a 4xx; a 5xx, a dropped connection
  // (other than below) or a dead process is a failure.
  // An oversized body may also see its connection closed before the client
  // finishes sending: the server answered without reading past its limit.
  const refused = (name, status) => /^4\d\d$/.test(status) || (name === 'oversized_body' && /^transport: (ECONNRESET|EPIPE)$/.test(status));
  const badOutcomes = Object.entries(loaded.badResults).map(([name, statuses]) => ({ name, statuses, refused_4xx: Object.keys(statuses).every(status => refused(name, status)) }));
  const ok = !baseline.goodErrors.length && !loaded.goodErrors.length && badOutcomes.every(o => o.refused_4xx) && health.status === 200 && alive;
  emit({ test: 'bad-input', ok, seconds_per_phase: seconds, alive, health: health.status,
    good_errors: loaded.goodErrors.length + baseline.goodErrors.length,
    good_read_baseline: stats(baseline.good.read), good_read_under_bad_load: stats(loaded.good.read),
    good_write_baseline: stats(baseline.good.write), good_write_under_bad_load: stats(loaded.good.write),
    bad: badOutcomes, server_stderr: stderr.slice(0, 500), samples: loaded.goodErrors.slice(0, 5) });
  fs.rmSync(work, { recursive: true, force: true });
}

// Recursion depth an authorized client controls. Each shape is sent at
// growing depth to a fresh server; the first depth that kills the process is
// the finding. A 4xx rejection or a normal answer at every depth passes.
const NESTING = {
  filter_parentheses: n => `${SCHEMA}\nquery {\n  Item(${'('.repeat(n)}key: "s1"${')'.repeat(n)}) { key }\n}\n`,
  flat_or_chain: n => `${SCHEMA}\nquery {\n  Item(${Array.from({ length: n }, (_, i) => `c = ${i}`).join(' || ')}) { key }\n}\n`,
  nested_selection: n => `${SCHEMA}\nquery {\n  Item(key: "s1") ${'{ links -> Item '.repeat(n)}{ key }${' }'.repeat(n)}\n}\n`,
  nested_mutation: n => `${SCHEMA}\nmutation {\n  ${Array.from({ length: n }, (_, i) => `Item(key: "m${n}-${i}" && a: "x" && b: "x" && c: 0 && d: true) { links -> `).join('')}Item(key: "leaf${n}" && a: "x" && b: "x" && c: 0 && d: true)${' }'.repeat(n)}\n}\n`,
};

async function nesting() {
  const shapes = [];
  for (const [shape, source] of Object.entries(NESTING)) {
    const work = workRoot();
    let server = await launch(work);
    const probes = [];
    let crashedAt = null;
    for (const depth of [100, 500, 1000, 2000, 5000, 10000, 50000]) {
      let status;
      try { status = (await server.request('POST', '/zql', { query: source(depth), document: true })).status; }
      catch (error) { status = `transport: ${error.cause?.code ?? error.message}`; }
      const exit = await Promise.race([server.exited, new Promise(resolve => setTimeout(() => resolve(null), 300))]);
      probes.push({ depth, status, ...(exit && { died: exit.signal ?? exit.code }) });
      if (exit) { crashedAt = { depth, signal: exit.signal, stderr: server.stderr().trim().split('\n').slice(-2).join(' | ') }; break; }
    }
    if (!crashedAt) await server.stop('SIGINT');
    shapes.push({ shape, ok: !crashedAt, crashed_at: crashedAt, probes });
    fs.rmSync(work, { recursive: true, force: true });
  }
  emit({ test: 'nesting', ok: shapes.every(shape => shape.ok), shapes });
}

try {
  assertPinnedZega(zega);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '');
  const version = execFileSync(zega, ['--version'], { encoding: 'utf8' }).trim();
  emit({ test: 'environment', zega: version, binary: path.relative(root, zega), platform: `${process.platform}-${process.arch}`, cpus: (await import('node:os')).cpus().length, node: process.version });
  const tests = { concurrency, durability, growth, 'bad-input': badInput, nesting };
  for (const name of selected) {
    if (!tests[name]) throw Error(`unknown test ${name}`);
    try { await tests[name](); } catch (error) { emit({ test: name, ok: false, error: error.message }); }
  }
} catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 2; }
if (failed && !process.exitCode) process.exitCode = 1;
