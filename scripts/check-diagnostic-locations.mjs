// Formatting may move source excerpts and spans, never diagnostic prose or results.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.argv[2];
if (!base) throw Error('Usage: node scripts/check-diagnostic-locations.mjs <base-revision>');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
export function diagnostic(text) {
  const lines = text.split('\n');
  const normalized = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^  (?:schema|query):\d+:\d+$/.test(lines[i])) {
      const caret = lines[i + 2];
      assert.match(caret, /^ +\^+$/);
      // Keep the exact highlighted token(s), even though the surrounding line
      // may have been opened up. This catches moved-to-the-wrong-token spans.
      const start = caret.indexOf('^');
      normalized.push(`  location: ${lines[i + 1].slice(start, start + caret.trim().length)}`);
      i += 2;
    } else normalized.push(lines[i]);
  }
  return normalized.join('\n');
}
let checked = 0, changed = 0;
const files = git('ls-tree', '-r', '--name-only', base, 'tests').trim().split('\n');
for (const file of files.filter(f => /\.(stdout|stderr|pass\.zql|fail\.zql)$/.test(f))) {
  const before = git('show', `${base}:${file}`);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(file.endsWith('.stderr') ? diagnostic(after) : after,
    file.endsWith('.stderr') ? diagnostic(before) : before, `${file}: changed more than diagnostic locations`);
  checked++;
  if (before !== after) changed++;
}
console.log(`Verified ${checked} expected files: ${changed} diagnostic location/excerpt updates; all messages, highlighted tokens, stdout and outcome markers unchanged.`);
