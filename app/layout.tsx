import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = { title: 'ZQL conformance · Zega', description: 'An inspectable, reproducible contract for the Zega query language across native and browser hosts.' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>
    <header className="masthead"><Link href="/" className="wordmark"><span className="mark">z</span> zega <span className="divider">/</span> <span>conformance</span></Link><a href="https://github.com/zegadb/testsuite">View repository ↗</a></header>
    <main>{children}</main>
    <footer><span>A readable contract for a graph database.</span><span>One corpus. Native + browser.</span></footer>
  </body></html>;
}
