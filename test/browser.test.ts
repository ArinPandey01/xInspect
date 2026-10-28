// Opt-in integration suite: runs only team-authored fixtures in real Firefox.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { startFixture, DUMMY_MARKER } from '../src/dynamic/fixture.js';
import { observePackage } from '../src/dynamic/observe.js';

async function prepare(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'xinspect-browser-test-'));
  const archive = new JSZip();
  for (const [name, source] of Object.entries(files)) archive.file(name, source);
  const path = join(dir, 'fixture.xpi');
  await writeFile(path, await archive.generateAsync({ type: 'nodebuffer' }));
  const probe = await startFixture(0);
  const port = Number(new URL(probe.origin).port);
  await probe.close();
  return { path, dir, port };
}

const manifest = (extra = {}) => JSON.stringify({ manifest_version: 2, name: 'XInspect runtime test', version: '1', ...extra });
const firefox = process.env.FIREFOX_BINARY ?? 'firefox';

test('Firefox detects page mutation, local dummy-data request, and blocked background request', { timeout: 90000 }, async () => {
  const fixture = await prepare({
    'manifest.json': manifest({ permissions: ['<all_urls>'], content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }], background: { scripts: ['background.js'] } }),
    'content.js': `const p=document.createElement('p');p.textContent='fixture badge';document.body.appendChild(p);fetch(location.origin+'/observe',{method:'POST',body:document.body.innerText});const img=document.createElement('img');img.src='https://xinspect-page.invalid/image.png';document.body.appendChild(img);console.log('fixture active');`,
    // .invalid is reserved and this request must be blocked before it leaves Firefox.
    'background.js': `fetch('https://xinspect-blocked.invalid/test').catch(()=>{});`
  });
  const output = join(fixture.dir, 'output');
  const observation = await observePackage(fixture.path, { output, seconds: 1, port: fixture.port, firefox, headed: false });
  assert.equal(observation.status, 'complete', JSON.stringify(observation));
  assert.equal(observation.comparison?.domChanged, true);
  assert.equal(observation.comparison?.dummyDataReceived, true);
  assert.ok(observation.extension.localRequests.some(x => x.path === '/observe' && x.body.includes(DUMMY_MARKER)));
  assert.ok(observation.extension.proxyAttempts.includes('CONNECT xinspect-blocked.invalid:443'));
  assert.ok(observation.extension.network.some(x => x.url === 'https://xinspect-page.invalid/image.png' && x.blocked));
  assert.ok(observation.comparison?.newRequestPatterns.includes('Local server: POST /observe'));
  assert.ok(observation.comparison?.newProxyAttempts.includes('CONNECT xinspect-blocked.invalid:443'));
  assert.ok(observation.extension.snapshot?.text.includes('fixture badge'));
  const reused = await startFixture(fixture.port);
  await reused.close();
});

test('missing Firefox produces a failed report and releases the local server', { timeout: 20000 }, async () => {
  const fixture = await prepare({ 'manifest.json': manifest() });
  const output = join(fixture.dir, 'failure');
  const result = await observePackage(fixture.path, { output, seconds: 1, port: fixture.port, firefox: '/does-not-exist/firefox', headed: false });
  assert.equal(result.status, 'failed');
  assert.equal(result.comparison, undefined);
  assert.ok(result.errors.some(x => x.includes('Cannot launch Firefox')));
  assert.ok((await readFile(join(output, 'observation.html'), 'utf8')).includes('Status: Failed'));
  const reused = await startFixture(fixture.port);
  await reused.close();
});

test('interrupting observation stops Firefox and leaves a failure report', { timeout: 30000 }, async () => {
  const fixture = await prepare({ 'manifest.json': manifest() });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('test interruption')), 1500);
  try {
    const result = await observePackage(fixture.path, { output: join(fixture.dir, 'interrupted'), seconds: 30, port: fixture.port, firefox, headed: false, signal: controller.signal });
    assert.notEqual(result.status, 'complete');
    assert.ok(result.errors.length);
    const reused = await startFixture(fixture.port);
    await reused.close();
  } finally { clearTimeout(timer); }
});
