import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BidiClient } from './bidi.js';
import { allowedRequest } from './fixture.js';
import type { BrowserRun, ObserveOptions, Snapshot } from './types.js';

export function emptyRun(): BrowserRun {
  return { network: [], console: [], localRequests: [], proxyAttempts: [], errors: [], warnings: [] };
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  await new Promise<void>(resolve => {
    const hardKill = setTimeout(() => child.kill('SIGKILL'), 3000);
    const deadline = setTimeout(() => { clearTimeout(hardKill); resolve(); }, 6000);
    child.once('exit', () => { clearTimeout(hardKill); clearTimeout(deadline); resolve(); });
    child.kill('SIGTERM');
  });
  if (child.exitCode === null && child.signalCode === null) throw new Error('Firefox did not exit after termination');
}

function preferences(proxyPort: number): string {
  const prefs: Record<string, unknown> = {
    'browser.shell.checkDefaultBrowser': false,
    'browser.startup.page': 0,
    'browser.startup.homepage': 'about:blank',
    'browser.newtabpage.enabled': false,
    'browser.aboutwelcome.enabled': false,
    'browser.startup.homepage_override.mstone': 'ignore',
    'datareporting.policy.dataSubmissionEnabled': false,
    'datareporting.healthreport.uploadEnabled': false,
    'toolkit.telemetry.enabled': false,
    'app.update.auto': false,
    'extensions.update.enabled': false,
    'extensions.getAddons.cache.enabled': false,
    'browser.safebrowsing.downloads.enabled': false,
    'browser.safebrowsing.phishing.enabled': false,
    'browser.safebrowsing.malware.enabled': false,
    'network.captive-portal-service.enabled': false,
    'network.connectivity-service.enabled': false,
    'network.dns.disablePrefetch': true,
    'network.prefetch-next': false,
    'network.http.speculative-parallel-limit': 0,
    'network.trr.mode': 5,
    'media.peerconnection.enabled': false,
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': proxyPort,
    'network.proxy.ssl': '127.0.0.1',
    'network.proxy.ssl_port': proxyPort,
    'network.proxy.no_proxies_on': '127.0.0.1',
    'network.proxy.allow_hijacking_localhost': false
  };
  return Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n');
}

async function evaluate(client: BidiClient, context: string, expression: string): Promise<any> {
  const result = await client.command('script.evaluate', { expression, target: { context, sandbox: 'xinspect' }, awaitPromise: true });
  if (result.type === 'exception') throw new Error(`Page evaluation failed: ${result.exceptionDetails?.text ?? 'JavaScript exception'}`);
  return result.result?.value;
}

export async function runBrowser(options: ObserveOptions & {
  phase: 'baseline' | 'extension'; origin: string; proxyPort: number; packagePath?: string;
}, run: BrowserRun, progress: (message: string) => void = () => {}): Promise<void> {
  const phase = options.phase === 'baseline' ? 'Baseline' : 'With extension';
  const profile = await mkdtemp(join(tmpdir(), 'xinspect-firefox-'));
  let child: ChildProcess | undefined;
  let client: BidiClient | undefined;
  let browserLog = '';
  const pending = new Set<Promise<void>>();
  const onAbort = () => { client?.close(); child?.kill('SIGTERM'); };
  try {
    options.signal?.throwIfAborted();
    await writeFile(join(profile, 'user.js'), preferences(options.proxyPort));
    const args = ['--no-remote', '--profile', profile, '--remote-debugging-port', '0', ...(options.headed ? [] : ['--headless']), 'about:blank'];
    progress(`${phase}: launching ${options.headed ? 'Firefox' : 'headless Firefox'} with a fresh profile…`);
    child = spawn(options.firefox, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: '1' } });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Firefox startup timed out (20 seconds)')), 20000);
      const finish = (error?: Error, url?: string) => { clearTimeout(timer); error ? reject(error) : resolve(url!); };
      child!.once('error', error => finish(new Error(`Cannot launch Firefox (${options.firefox}): ${error.message}`)));
      child!.once('exit', (code, signal) => { client?.close(); finish(new Error(`Firefox exited during startup (code ${code}, signal ${signal}). See ${options.phase}-firefox.log`)); });
      const read = (chunk: Buffer) => {
        if (browserLog.length < 128 * 1024) browserLog += chunk.toString().slice(0, 128 * 1024 - browserLog.length);
        const match = browserLog.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
        if (match) {
          const url = match[1]!.replace(/\/$/, '');
          finish(undefined, url.endsWith('/session') ? url : `${url}/session`);
        }
      };
      child!.stdout!.on('data', read);
      child!.stderr!.on('data', read);
    });
    options.signal?.throwIfAborted();
    client = await BidiClient.connect(endpoint);
    progress(`${phase}: connected to Firefox and enabling request capture…`);
    const bidi = client;
    const requests = new Map<string, BrowserRun['network'][number]>();
    const warning = (text: string) => { if (!run.warnings.includes(text)) run.warnings.push(text); };
    bidi.onEvent = (method, params) => {
      if (method === 'network.beforeRequestSent') {
        const request = params.request;
        const blocked = !allowedRequest(request.url, options.origin);
        if (run.network.length < 2000) {
          const entry = { id: String(request.request), url: String(request.url).slice(0, 8192), method: String(request.method), context: params.context ?? null, time: new Date().toISOString(), blocked: blocked && Boolean(params.isBlocked) };
          run.network.push(entry);
          requests.set(entry.id, entry);
        } else warning('Network request log capped at 2,000 entries; interception remains active.');
        if (params.isBlocked) {
          const work = bidi.command(blocked ? 'network.failRequest' : 'network.continueRequest', { request: request.request })
            .then(() => {}, error => {
              const entry = requests.get(String(request.request));
              if (entry) entry.blocked = false;
              if (run.errors.length < 20) run.errors.push(`Network interception failed: ${errorText(error)}`);
            })
            .finally(() => pending.delete(work));
          pending.add(work);
        } else if (blocked) warning('An external request was observed without an interception pause; proxy restrictions may still apply.');
      } else if (method === 'network.responseCompleted') {
        const entry = requests.get(params.request.request);
        if (entry) entry.status = params.response.status;
      } else if (method === 'network.fetchError') {
        const entry = requests.get(params.request.request);
        if (entry) entry.error = String(params.errorText).slice(0, 1000);
      } else if (method === 'log.entryAdded') {
        if (run.console.length < 500) run.console.push({ level: String(params.level), text: String(params.text ?? '').slice(0, 2000) });
        else warning('Console log capped at 500 entries.');
      }
    };
    const session = await bidi.command('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: false } } });
    run.browserVersion = session.capabilities?.browserVersion;
    await bidi.command('session.subscribe', { events: ['network.beforeRequestSent', 'network.responseCompleted', 'network.fetchError', 'log.entryAdded'] });
    await bidi.command('network.addIntercept', { phases: ['beforeRequestSent'] });
    if (options.packagePath) {
      progress('With extension: installing the selected package temporarily…');
      const result = await bidi.command('webExtension.install', { extensionData: { type: 'path', path: options.packagePath }, 'moz:permanent': false });
      run.extensionId = result.extension;
      progress('With extension: package installed in the temporary profile.');
    }
    options.signal?.throwIfAborted();
    const { context } = await bidi.command('browsingContext.create', { type: 'tab' });
    await bidi.command('browsingContext.setViewport', { context, viewport: { width: 1280, height: 800 }, devicePixelRatio: 1 });
    progress(`${phase}: loading the controlled local test page…`);
    await bidi.command('browsingContext.navigate', { context, url: `${options.origin}/test-page.html`, wait: 'complete' });
    progress(`${phase}: filling the test field and clicking the page button…`);
    const action = await evaluate(bidi, context, `(() => { const input = document.getElementById('test-field'); const button = document.getElementById('test-button'); if (!input || !button) return 'Test controls missing'; input.value = 'synthetic input'; input.dispatchEvent(new Event('input', {bubbles: true})); button.click(); return 'done'; })()`);
    if (action !== 'done') warning(String(action));
    progress(`${phase}: observing activity for ${options.seconds} seconds…`);
    await delay(options.seconds * 1000, undefined, { signal: options.signal });
    progress(`${phase}: capturing page content and recorded events…`);
    const raw = await evaluate(bidi, context, `JSON.stringify({title:document.title.slice(0,1000),text:(document.body?.innerText??'').slice(0,65536),html:document.documentElement.outerHTML.slice(0,1048576),elements:document.querySelectorAll('*').length,truncated:document.documentElement.outerHTML.length>1048576||(document.body?.innerText??'').length>65536})`);
    run.snapshot = JSON.parse(raw) as Snapshot;
    if (run.snapshot.truncated) warning('DOM snapshot exceeded its size limit and was truncated.');
    // Source snapshots use .txt so opening an artifact does not execute captured HTML.
    await writeFile(join(options.output, `${options.phase}-dom.txt`), run.snapshot.html);
    await Promise.all(pending);
    progress(`${phase}: page content and event capture saved.`);
  } catch (error) {
    run.errors.push(errorText(error));
    throw error;
  } finally {
    progress(`${phase}: closing Firefox and its temporary profile…`);
    options.signal?.removeEventListener('abort', onAbort);
    client?.close();
    let stopped = false;
    try { if (child) await stop(child); stopped = true; }
    finally {
      await writeFile(join(options.output, `${options.phase}-firefox.log`), browserLog);
      if (stopped) {
        await rm(profile, { recursive: true, force: true });
        progress(`${phase}: Firefox closed and temporary profile removed.`);
      }
      else run.errors.push(`Firefox may still be running; temporary profile retained at ${profile}`);
    }
  }
}
