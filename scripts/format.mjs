// The .zql files are empty outcome markers. Format the actual .code source too.
import { spawnSync } from 'node:child_process';
import { loadCorpus } from './corpus.mjs';
import path from 'node:path';
const [binary, ...options] = process.argv.slice(2);
if (!binary || options.some(option => option !== '--check')) throw Error('Usage: node scripts/format.mjs /path/to/zega [--check]');
const cases = loadCorpus();
const sourceFiles = cases.map(test => path.join(test.dir, `${test.name}.code`));
const result = spawnSync(path.resolve(binary), ['fmt', ...options, 'tests', ...sourceFiles], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal || result.status === null) throw Error(`formatter terminated: ${result.signal}`);
process.exitCode = result.status;
