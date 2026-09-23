import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { root } from './corpus.mjs';

export async function createBrowserHost() {
  if (!fs.existsSync(path.join(root, 'public/wasm/zql_conformance_host.js'))) throw Error('browser adapter missing; run node scripts/build-browser.mjs, then npx playwright install chromium');
  const staging = fs.mkdtempSync(path.join(root, '.tmp/browser-'));
  fs.cpSync(path.join(root, 'public/wasm'), path.join(staging, 'wasm'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'index.html'), '<!doctype html><title>ZQL browser host</title>');
  const server = await serve(staging);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(server.url);
    return {
      async run(test, request) {
        // The worker URL lives beside this case's assets. Relative import URLs
        // therefore resolve exactly like native's case-local working directory.
        const caseDir = path.join(staging, test.id);
        fs.mkdirSync(caseDir, { recursive: true });
        for (const [name, content] of Object.entries(test.files)) fs.writeFileSync(path.join(caseDir, name), content);
        fs.writeFileSync(path.join(caseDir, 'host.js'), `import init, { evaluate_json, import_locations } from '/wasm/zql_conformance_host.js';
await init();
self.onmessage = async ({ data }) => {
  try {
    data.sources = {};
    for (const location of JSON.parse(import_locations(data.source))) {
      const response = await fetch(location);
      if (!response.ok) throw Error('Cannot fetch ' + location + ': ' + response.status);
      data.sources[location] = await response.text();
    }
    self.postMessage({ result: JSON.parse(evaluate_json(JSON.stringify(data))) });
  }
  catch (error) { self.postMessage({ error: String(error) }); }
};
self.postMessage({ ready: true });`);
        return page.evaluate(({ id, request }) => new Promise((resolve, reject) => {
          const worker = new Worker(`/${id}/host.js`, { type: 'module' });
          const stop = () => { clearTimeout(timer); worker.terminate(); };
          const timer = setTimeout(() => { stop(); reject(Error('browser adapter timeout')); }, 30000);
          worker.onerror = event => { stop(); reject(Error(event.message)); };
          worker.onmessage = ({ data }) => {
            if (data.ready) { worker.postMessage(request); return; }
            stop();
            if (data.error) reject(Error(data.error)); else resolve(data.result);
          };
        }), { id: test.id, request });
      },
      async close() { await browser.close(); await server.close(); fs.rmSync(staging, { recursive: true, force: true }); },
    };
  } catch (error) {
    await browser?.close(); await server.close(); fs.rmSync(staging, { recursive: true, force: true }); throw error;
  }
}
