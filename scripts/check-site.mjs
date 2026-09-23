import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { root, loadCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

const cases = loadCorpus();
const server = await serve(path.join(root, 'out'));
let browser;
try {
  for (const test of cases) {
    const response = await fetch(`${server.url}/case/${test.id}/`);
    assert.equal(response.status, 200, test.id);
    assert.match(await response.text(), /Source \+ graph setup/);
  }
  const data = await (await fetch(`${server.url}/corpus.json`)).json();
  assert.equal(data.cases.length, cases.length);
  assert.equal((await fetch(`${server.url}/not-a-route/`)).status, 404);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.url);
  await page.getByRole('heading', { name: 'The corpus', exact: true }).waitFor();
  await page.getByRole('searchbox', { name: 'Search cases' }).fill('Outgoing');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByRole('link', { name: 'query Outgoing', exact: true }).click();
  await page.getByRole('heading', { name: 'Source + graph setup' }).waitFor();
  assert.match(await page.locator('pre').first().innerText(), /wrote -> Book/);
  await page.screenshot({ path: path.join(root, '.tmp/site-case.png'), fullPage: true });
  await page.goto(server.url);
  await page.screenshot({ path: path.join(root, '.tmp/site-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(server.url);
  await page.getByRole('button', { name: /^import/ }).click();
  assert.equal(await page.locator('tbody tr').count(), cases.filter(t => t.category === 'import').length);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(root, '.tmp/site-mobile.png') });
  assert.deepEqual(errors, []);
  console.log(`Static site: ${cases.length} case routes + corpus JSON served; search, navigation, category filter, mobile layout and browser console passed`);
} finally { await browser?.close(); await server.close(); }
