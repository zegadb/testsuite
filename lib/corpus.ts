import fs from 'node:fs';
import path from 'node:path';

export type Outcome = { ok: boolean; stage: string; stdout: string; stderr: string };
export type Case = {
  id: string; name: string; category: string; title: string; notes: string;
  stage: string; api: string; hosts: ['native', 'browser']; source: string;
  expected: Outcome; files: Record<string, string>; network?: string;
  knownFailure?: { reason: string; observed: Outcome };
};
export type Result = { id: string; status: string; reason?: string; actual?: Outcome };
export type Report = { counts: Record<string, number>; results: Result[] };
export function corpus(): { engine: { revision: string; repository: string }; digest: string; cases: Case[] } {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/corpus.json'), 'utf8'));
}
export function reports(): Partial<Record<'native' | 'browser', Report>> {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/results.json'), 'utf8'));
}
export function status(host: Report | undefined, id: string) {
  return host?.results.find(r => r.id === id)?.status ?? 'NOT RUN';
}
