import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyRun } from '../src/dynamic/browser.js';
import { allowedRequest, DUMMY_MARKER } from '../src/dynamic/fixture.js';
import { compareRuns } from '../src/dynamic/observe.js';
import { renderObservation } from '../src/dynamic/report.js';
import type { Observation } from '../src/dynamic/types.js';
import type { Report } from '../src/types.js';

const staticReport: Report = {
  schemaVersion: 1, generatedAt: 'test', package: { name: 'fixture.xpi', sha256: 'a'.repeat(64), bytes: 1 },
  manifest: { name: 'Fixture', version: '1', manifestVersion: 2, permissions: [], hostPermissions: [], contentScripts: [], backgroundScripts: [], pages: [] },
  inventory: [], findings: [{ id: 'network', title: 'Network', severity: 'medium', reason: 'test', evidence: [] }], limitations: []
};

test('request policy allows the exact local origin and blocks lookalikes and other ports', () => {
  const origin = 'http://127.0.0.1:8765';
  assert.ok(allowedRequest(`${origin}/observe`, origin));
  assert.ok(allowedRequest('moz-extension://example/script.js', origin));
  for (const url of ['https://example.org', 'http://127.0.0.1:9000', 'http://127.0.0.1.evil:8765', 'http://user:secret@127.0.0.1:8765', 'file:///etc/passwd', 'invalid']) {
    assert.equal(allowedRequest(url, origin), false, url);
  }
});

test('comparison requires two snapshots and distinguishes baseline traffic from dummy-data collection', () => {
  const baseline = emptyRun(); const extension = emptyRun();
  assert.equal(compareRuns(baseline, extension, staticReport), undefined);
  baseline.snapshot = { title: 'test', text: 'original', html: '<p>original</p>', elements: 1, truncated: false };
  extension.snapshot = { ...baseline.snapshot, text: 'changed', html: '<p>changed</p>' };
  const request = { id: '1', url: 'http://127.0.0.1:8765/test-page.html', method: 'GET', context: null, blocked: false, time: 'test' };
  baseline.network.push(request);
  extension.network.push(request, { ...request, id: '2', method: 'POST', url: 'http://127.0.0.1:8765/observe' });
  extension.localRequests.push({ method: 'POST', path: '/observe', body: DUMMY_MARKER, truncated: false });
  assert.deepEqual(compareRuns(baseline, extension, staticReport), {
    domChanged: true, textChanged: true, newRequestPatterns: ['Browser: POST http://127.0.0.1:8765/observe', 'Local server: POST /observe'], newProxyAttempts: [], dummyDataReceived: true,
    staticPageModification: false, staticNetworkCapability: true
  });
});

test('observation report escapes captured page, URL, and console content and labels failed runs', () => {
  const extension = emptyRun();
  extension.console.push({ level: 'error', text: '<script>alert(1)</script>' });
  extension.snapshot = { title: 'test', html: '<img src=x onerror=alert(1)>', text: '<img src=x onerror=alert(1)>', elements: 1, truncated: false };
  const observation: Observation = {
    schemaVersion: 1, status: 'failed', generatedAt: 'test', package: staticReport.package, extensionName: '<script>bad</script>',
    scenario: { url: 'http://localhost', seconds: 1, actions: [], networkPolicy: 'local' }, baseline: emptyRun(), extension,
    limitations: ['not a verdict'], errors: ['launch failed']
  };
  const html = renderObservation(observation);
  assert.ok(html.includes('Status: Failed'));
  assert.ok(html.includes('Comparison unavailable'));
  assert.ok(html.includes('How this test was run'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
});

test('observation report leads with plain results and keeps test mechanics in details', () => {
  const baseline = emptyRun(); const extension = emptyRun();
  const observation: Observation = {
    schemaVersion: 1, status: 'complete', generatedAt: 'test', package: staticReport.package, extensionName: 'Fixture',
    scenario: { url: 'http://127.0.0.1:8765/test-page.html', seconds: 5, actions: [], networkPolicy: 'technical policy' },
    baseline, extension, limitations: [], errors: [],
    comparison: { domChanged: false, textChanged: false, dummyDataReceived: false,
      newRequestPatterns: [], newProxyAttempts: ['CONNECT example.invalid:443'],
      staticPageModification: false, staticNetworkCapability: true }
  };
  const html = renderObservation(observation);
  assert.ok(html.includes('Connection attempts were recorded; the page looked unchanged.'));
  assert.ok(html.includes('Test page data sent'));
  assert.ok(html.includes('example.invalid:443'));
  assert.ok(html.indexOf('Blocked connection destinations') < html.indexOf('How this test was run'));
  assert.ok(html.includes('<details class="panel"><summary>How this test was run</summary>'));
});
