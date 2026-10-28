import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzePackage } from '../analyze.js';
import { renderHtml } from '../report.js';
import type { Report } from '../types.js';
import { emptyRun, runBrowser } from './browser.js';
import { DUMMY_MARKER, startDenyProxy, startFixture } from './fixture.js';
import { renderObservation } from './report.js';
import type { BrowserRun, Observation, ObserveOptions } from './types.js';

export function compareRuns(baseline: BrowserRun, extension: BrowserRun, report: Report): Observation['comparison'] {
  if (!baseline.snapshot || !extension.snapshot) return undefined;
  const patterns = (run: BrowserRun) => [
    ...run.network.filter(x => /^https?:/.test(x.url)).map(x => `Browser: ${x.method} ${x.url}`),
    ...run.localRequests.map(x => `Local server: ${x.method} ${x.path}`)
  ];
  const before = new Set(patterns(baseline));
  const proxyBefore = new Set(baseline.proxyAttempts);
  return {
    domChanged: baseline.snapshot.html !== extension.snapshot.html,
    textChanged: baseline.snapshot.text !== extension.snapshot.text,
    newRequestPatterns: [...new Set(patterns(extension).filter(x => !before.has(x)))],
    newProxyAttempts: [...new Set(extension.proxyAttempts.filter(x => !proxyBefore.has(x)))],
    dummyDataReceived: extension.localRequests.some(x => x.method === 'POST' && x.path === '/observe' && x.body.includes(DUMMY_MARKER)),
    staticPageModification: report.findings.some(x => x.id === 'dom-write'),
    staticNetworkCapability: report.findings.some(x => x.id === 'network')
  };
}

export async function observePackage(packagePath: string, options: ObserveOptions, progress: (message: string) => void = () => {}): Promise<Observation> {
  if (!Number.isFinite(options.seconds) || options.seconds < 1 || options.seconds > 60) throw new Error('--seconds must be between 1 and 60');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be between 1 and 65535');
  if (typeof WebSocket === 'undefined') throw new Error('observe requires Node.js 22 or newer');
  progress('Running source review before browser observation…');
  const report = await analyzePackage(packagePath, { mozillaBlocklist: options.mozillaBlocklist, hashListPath: options.hashListPath });
  progress('Source review complete; preparing the controlled Firefox test…');
  await mkdir(options.output, { recursive: true });
  if ((await readdir(options.output)).length) throw new Error('Observation output directory must be empty; choose a new --out directory');
  await writeFile(join(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(options.output, 'report.html'), renderHtml(report));
  const observation: Observation = {
    schemaVersion: 1, status: 'failed', generatedAt: new Date().toISOString(), package: report.package,
    extensionName: report.manifest.name,
    scenario: {
      url: `http://127.0.0.1:${options.port}/test-page.html`, seconds: options.seconds,
      actions: ['Load the same local page in two fresh Firefox profiles.', 'Fill the synthetic input field, dispatch an input event, and click the local test button.', 'Wait for the observation window, then capture page content, console, and network events.'],
      networkPolicy: 'Only the controlled local HTTP origin is allowed by BiDi interception. Other observed HTTP requests are rejected. A rejecting HTTP(S) proxy provides an additional restriction.'
    },
    baseline: emptyRun(), extension: emptyRun(), errors: [],
    limitations: [
      'This command executes extension code. A temporary Firefox profile and HTTP controls are not an OS sandbox. Use an isolated disposable VM with restricted networking for untrusted samples.',
      'Observations cover one local page and a fixed time window. Domain-specific triggers, popup-only actions, delayed behavior, and user interactions outside this scenario may not run.',
      'Extension-originated requests may be absent from Firefox BiDi events. The local collector independently records local requests; the rejecting proxy records HTTP URLs or HTTPS CONNECT destinations, not encrypted payloads.',
      'These are not complete system network traces. An extension can change proxy settings, and non-HTTP traffic is not comprehensively controlled. There is no proof that all outbound traffic was captured or blocked.',
      'Network requests can originate from Firefox or the page. Differences from baseline are observations, not guaranteed extension attribution or proof of maliciousness.',
      'DOM differences show changes, not page reads. No observed behavior does not establish safety. Static source locations cannot generally be assigned to runtime events.',
      'Network logs, console logs, request bodies, and DOM snapshots have documented size limits.'
    ]
  };
  let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
  let proxy: Awaited<ReturnType<typeof startDenyProxy>> | undefined;
  let sampleDir: string | undefined;
  try {
    options.signal?.throwIfAborted();
    sampleDir = await mkdtemp(join(tmpdir(), 'xinspect-sample-'));
    const sample = await readFile(packagePath);
    if (createHash('sha256').update(sample).digest('hex') !== report.package.sha256) throw new Error('Package changed after static analysis; rerun with a stable input');
    const frozenPackage = join(sampleDir, 'sample.xpi');
    await writeFile(frozenPackage, sample);
    progress('Starting the local test page and connection controls…');
    fixture = await startFixture(options.port);
    proxy = await startDenyProxy();
    for (const phase of ['baseline', 'extension'] as const) {
      fixture.reset(); proxy.reset();
      try {
        await runBrowser({ ...options, phase, origin: fixture.origin, proxyPort: proxy.port, ...(phase === 'extension' ? { packagePath: frozenPackage } : {}) }, observation[phase], progress);
      } finally {
        observation[phase].localRequests = fixture.requests();
        observation[phase].proxyAttempts = proxy.attempts();
        if (fixture.truncated()) observation[phase].warnings.push('Local request log capped at 2,000 entries.');
        if (proxy.truncated()) observation[phase].warnings.push('Proxy request log capped at 2,000 entries.');
        if (observation[phase].localRequests.some(x => x.truncated)) observation[phase].warnings.push('A local request body exceeded 64 KiB and was truncated.');
        if (observation[phase].snapshot) progress(`${phase === 'baseline' ? 'Baseline' : 'With extension'}: captured ${observation[phase].network.length} browser request events and ${observation[phase].proxyAttempts.length} proxy connection attempts.`);
      }
    }
    progress('Comparing the baseline and extension runs…');
    observation.comparison = compareRuns(observation.baseline, observation.extension, report);
    observation.status = observation.comparison ? 'complete' : 'partial';
    if ([observation.baseline, observation.extension].some(x => x.errors.length || x.warnings.length)) observation.status = 'partial';
  } catch (error) {
    observation.errors.push(error instanceof Error ? error.message : String(error));
    observation.status = observation.baseline.snapshot || observation.extension.snapshot ? 'partial' : 'failed';
    progress(`Observation stopped: ${observation.errors.at(-1)}`);
  } finally {
    progress('Closing local test services and saving available results…');
    for (const resource of [fixture, proxy]) {
      try { await resource?.close(); }
      catch (error) { observation.errors.push(`Cleanup: ${String(error)}`); observation.status = 'partial'; }
    }
    if (sampleDir) await rm(sampleDir, { recursive: true, force: true });
    observation.generatedAt = new Date().toISOString();
    await writeFile(join(options.output, 'observation.json'), JSON.stringify(observation, null, 2) + '\n');
    await writeFile(join(options.output, 'observation.html'), renderObservation(observation));
    progress('Observation report saved.');
  }
  return observation;
}
