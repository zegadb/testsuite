import Link from 'next/link';
import { notFound } from 'next/navigation';
import { corpus, reports, status } from '../../../../lib/corpus';

export function generateStaticParams() { return corpus().cases.map(t => ({ category: t.category, name: t.name })); }
export const dynamicParams = false;

export default async function CasePage({ params }: { params: Promise<{ category: string; name: string }> }) {
  const { category, name } = await params;
  const test = corpus().cases.find(t => t.id === `${category}/${name}`);
  if (!test) notFound();
  const results = reports();
  return <article className="case-page">
    <Link href="/" className="back">← All cases</Link><p className="eyebrow">{test.category} / {test.stage}</p><h1>{test.title}</h1><p className="intro">{test.notes}</p>
    <div className="case-meta"><span>Expects <strong>{test.expected.ok ? 'success' : 'rejection'}</strong></span><span>Native <strong>{status(results.native, test.id)}</strong></span><span>Browser <strong>{status(results.browser, test.id)}</strong></span></div>
    {test.network && <aside>Remote import: skipped when offline. Online runs fetch <a href={test.network}>this immutable fixture</a>.</aside>}
    {test.api !== 'file' && <aside>Parser API: <code>parse_{test.api}</code>. This case fails before graph execution; its input is complete for that API.</aside>}
    {test.knownFailure && <aside><strong>Known engine failure:</strong> {test.knownFailure.reason}</aside>}
    <section className="code-section"><div className="section-bar"><h2>Source + graph setup</h2><span>{test.name}.code</span></div><pre><code>{test.source}</code></pre></section>
    {Object.entries(test.files).map(([file, text]) => <section className="code-section" key={file}><div className="section-bar"><h2>Local fixture</h2><span>{file}</span></div><pre><code>{text || '(empty file)'}</code></pre></section>)}
    <div className="expected-grid"><section className="code-section"><div className="section-bar"><h2>Expected stdout</h2><span>exact bytes</span></div><pre><code>{test.expected.stdout || '(empty — 0 bytes)'}</code></pre></section><section className="code-section"><div className="section-bar"><h2>Expected diagnostic</h2><span>exact bytes</span></div><pre><code>{test.expected.stderr || '(empty — 0 bytes)'}</code></pre></section></div>
    <section className="reproduce"><h2>Run this case</h2><p>From a built checkout, with a fresh in-memory graph:</p><pre><code>{`npm test -- --host native --case tests/${test.id}`}</code></pre><a href={`https://github.com/zegadb/testsuite/tree/codex/testsuite/tests/${test.id}`}>Open this directory on GitHub ↗</a></section>
  </article>;
}
