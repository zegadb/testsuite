import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { root } from './corpus.mjs';

const { values } = parseArgs({ options: { bindgen: { type: 'string', default: 'wasm-bindgen' } } });
const lock = fs.readFileSync(path.join(root, 'Cargo.lock'), 'utf8');
const version = lock.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)[1];
const tool = spawnSync(values.bindgen, ['--version'], { encoding: 'utf8' });
if (tool.status !== 0 || tool.stdout.trim() !== `wasm-bindgen ${version}`) {
  throw Error(`Install matching bindings: cargo install wasm-bindgen-cli --version ${version} --locked; or pass --bindgen /path/to/wasm-bindgen`);
}
const target = path.join(root, '.target');
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true, mode: 0o700 });
for (const [command, args] of [
  ['cargo', ['build', '--locked', '--lib', '--target', 'wasm32-unknown-unknown']],
  [values.bindgen, [path.join(target, 'wasm32-unknown-unknown/debug/zql_conformance_host.wasm'), '--target', 'web', '--out-dir', path.join(root, 'public/wasm')]],
]) {
  const child = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target, TMPDIR: path.join(root, '.tmp') } });
  if (child.error || child.status !== 0) throw Error(`${command} failed: ${child.error ?? child.status}`);
}
