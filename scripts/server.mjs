import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { root, engine } from './corpus.mjs';

export const defaultZega = path.join(root, '.tmp/tools/bin/zega');

// The server's success body is serde_json's `json!({"ok": true, "result": v})`,
// whose keys are sorted, so the engine's own bytes for `v` sit between this
// prefix and the closing brace. Slicing them (instead of JSON.parse and
// JSON.stringify) keeps the comparison byte-exact: JavaScript would reorder
// integer-like object keys and could reformat numbers.
const SUCCESS_PREFIX = '{"ok":true,"result":';
// Every engine error reaches HTTP as the Display of `ZegaError`. `apply_zql`
// reports a parse failure as `ZegaError::Execution(rendered)`, so the same
// rendered diagnostic native gets from `check_zql` arrives behind this prefix.
const EXECUTION_PREFIX = 'execution error: ';

/// Starts `zega start` on an ephemeral port with a fresh data directory and a
/// generated bearer token, from `cwd` (relative imports resolve against it,
/// exactly like native's case-local working directory).
export async function startServer(zega, { cwd, data, token, extraArgs = [] }) {
  const tokenFile = path.join(path.dirname(data), 'token');
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  const child = spawn(zega, ['start', '--data', data, '--port', '0', '--token-file', tokenFile, ...extraArgs], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(Error(`zega start printed no address: ${stderr}`)), 30000);
    child.stdout.on('data', chunk => {
      out += chunk;
      const line = out.split('\n')[0];
      if (out.includes('\n')) { clearTimeout(timer); line.startsWith('http://') ? resolve(line.trim()) : reject(Error(`unexpected zega start output: ${line}`)); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    exited.then(({ code, signal }) => { clearTimeout(timer); reject(Error(`zega start exited (${code ?? signal}): ${stderr}`)); });
  });
  const auth = { authorization: `Bearer ${token}` };
  return {
    url, child, exited, auth,
    stderr: () => stderr,
    async request(method, route, body, headers = auth) {
      const response = await fetch(url + route, {
        method, headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      return { status: response.status, text: await response.text() };
    },
    async stop(signal = 'SIGTERM') {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      return exited;
    },
  };
}

/// Maps one `POST /zql` HTTP response to the outcome shape every host reports.
/// The HTTP contract carries ok/result/error only, with no parse/run stage, so
/// a failure's stage is the one the case declares; for a parse-stage case the
/// server's message must be exactly `execution error: ` + the diagnostic.
export function serverOutcome(test, { status, text }) {
  if (status === 200) {
    if (!text.startsWith(SUCCESS_PREFIX) || !text.endsWith('}')) throw Error(`unexpected success body: ${text.slice(0, 200)}`);
    const result = text.slice(SUCCESS_PREFIX.length, -1);
    JSON.parse(result);
    return { ok: true, stage: 'run', stdout: `${result}\n`, stderr: '' };
  }
  if (status !== 400) throw Error(`HTTP ${status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  if (body.ok !== false || typeof body.error !== 'string' || Object.keys(body).length !== 2) throw Error(`unexpected error body: ${text.slice(0, 200)}`);
  // Without the prefix the message stays marked, so it can never equal the
  // native diagnostic and the case diverges instead of passing leniently.
  const message = test.stage !== 'parse' ? body.error
    : body.error.startsWith(EXECUTION_PREFIX) ? body.error.slice(EXECUTION_PREFIX.length) : `[no "${EXECUTION_PREFIX}" prefix] ${body.error}`;
  return { ok: false, stage: test.stage, stdout: '', stderr: `${message}\n` };
}

/// `zega --version` names only the crate version, so the revision comes from
/// the install receipt `cargo install --root <dir>` writes beside `bin/`.
/// A binary built from any other engine revision is refused, never run.
export function assertPinnedZega(zega) {
  if (!fs.existsSync(zega)) throw Error(`server adapter missing: ${zega}; build the pinned engine's CLI (see README "Server host")`);
  const receipt = path.join(path.dirname(path.dirname(zega)), '.crates2.json');
  const installs = fs.existsSync(receipt) ? Object.keys(JSON.parse(fs.readFileSync(receipt, 'utf8')).installs ?? {}) : [];
  if (!installs.some(key => key.startsWith('zega-cli ') && key.includes(`?rev=${engine.revision}#`))) throw Error(`${zega} was not installed from zega ${engine.revision}; reinstall it with cargo install --root (see README "Server host")`);
}

export async function createServerHost(zega = defaultZega) {
  assertPinnedZega(zega);
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, '.tmp/server-'));
  let serial = 0;
  return {
    // The HTTP API has no parser-only entry point; `document: false` runs
    // statements against a schema, which is a different parser API.
    supports: test => test.api === 'file',
    async run(test, request) {
      // One process and one empty data directory per case: nothing a case
      // writes (graph, WAL, indexes, uniques) can reach the next one.
      const work = path.join(staging, String(serial++));
      fs.mkdirSync(work, { recursive: true });
      const token = randomBytes(24).toString('hex');
      const server = await startServer(zega, { cwd: test.dir, data: path.join(work, 'data'), token });
      try {
        const denied = await server.request('GET', '/health', undefined, {});
        if (denied.status !== 401) throw Error(`server accepted a request without its bearer token (HTTP ${denied.status})`);
        return serverOutcome(test, await server.request('POST', '/zql', { query: request.source, document: true }));
      } finally {
        await server.stop();
        fs.rmSync(work, { recursive: true, force: true });
      }
    },
    async close() { fs.rmSync(staging, { recursive: true, force: true }); },
  };
}
