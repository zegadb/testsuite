import { corpus, reports } from '../lib/corpus';
import Catalog from './catalog';

export default function Home() {
  const data = corpus();
  const results = reports();
  return <>
    <section className="hero"><p className="eyebrow">ZQL / LANGUAGE CONTRACT</p><h1>Every query.<br /><span>The same answer.</span></h1><p className="intro">Explore the cases that define ZQL. Each one includes its graph, the query, and the exact result or diagnostic it expects.</p>
      <div className="facts"><div><strong>{data.cases.length}</strong><span>independent cases</span></div><div><strong>{new Set(data.cases.map(t => t.category)).size}</strong><span>language categories</span></div><div><strong>2</strong><span>engine hosts</span></div></div>
    </section>
    <section className="run-note"><span className="dot" /><p>Recorded results against <a href={`${data.engine.repository}/commit/${data.engine.revision}`}><code>{data.engine.revision.slice(0, 12)}</code></a>. Native and browser are shown separately; <strong>not run</strong> means no matching report was supplied. These are build-time results.</p></section>
    <Catalog cases={data.cases.map(({ source, files, ...test }) => ({ ...test, source: '', files: {} }))} reports={results} />
    <section className="method"><div><p className="eyebrow">REPRODUCIBLE BY DESIGN</p><h2>The graph travels<br />with the test.</h2></div><div><p>Every case starts with an empty database. Its schema, mutations, queries, and import files live in one directory. No shared fixture and no hidden setup.</p><p>Successful results preserve array order. Failed cases pin the complete diagnostic, including its location and help text. Both hosts compare against the same bytes.</p><a href="/corpus.json">Download the corpus JSON ↓</a><span className="method-separator"> / </span><a href="/results.json">Recorded results ↓</a></div></section>
  </>;
}
