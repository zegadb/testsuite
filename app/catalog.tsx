'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Case, Report } from '../lib/corpus';

export default function Catalog({ cases, reports }: { cases: Case[]; reports: Partial<Record<'native' | 'browser', Report>> }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const categories = [...new Set(cases.map(t => t.category))];
  const visible = cases.filter(t => (category === 'all' || t.category === category) && `${t.id} ${t.title} ${t.notes}`.toLowerCase().includes(query.toLowerCase()));
  const state = (host: 'native' | 'browser', id: string) => reports[host]?.results.find(r => r.id === id)?.status ?? 'NOT RUN';
  return <section className="catalog" aria-label="Conformance cases">
    <div className="catalog-heading"><h2>The corpus</h2><label className="search"><span>Search cases</span><input type="search" placeholder="Search an assertion or diagnostic…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    <div className="filters" aria-label="Categories">{['all', ...categories].map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}<span>{c === 'all' ? cases.length : cases.filter(t => t.category === c).length}</span></button>)}</div>
    <p className="result-count" aria-live="polite">{visible.length} cases · expected rejection is a passing assertion when the diagnostic matches</p>
    <div className="table-wrap"><table><thead><tr><th>Case / assertion</th><th>Expects</th><th>Native</th><th>Browser</th></tr></thead><tbody>{visible.map(test => <tr key={test.id}>
      <td><Link href={`/case/${test.id}/`}><span className="case-category">{test.category}</span><strong>{test.title}</strong></Link><p>{test.notes}</p></td>
      <td data-label="Expects"><span className={`expect ${test.expected.ok ? '' : 'reject'}`}>{test.expected.ok ? 'result' : 'diagnostic'}</span></td>
      {(['native', 'browser'] as const).map(host => <td key={host} data-label={host}><span className={`status ${state(host, test.id).toLowerCase().replace(' ', '-')}`}>{state(host, test.id)}</span></td>)}
    </tr>)}</tbody></table></div>
    {!visible.length && <p className="empty">No cases match. Try a broader search or another category.</p>}
  </section>;
}
