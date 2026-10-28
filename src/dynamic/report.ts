import type { BrowserRun, Observation } from './types.js';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const list = (values: string[], empty = 'None recorded.'): string => values.length
  ? `<ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : `<p class="muted">${esc(empty)}</p>`;

function resultCard(title: string, value: string, note: string, tone: string): string {
  return `<article class="result ${tone}"><h3>${esc(title)}</h3><p class="value">${esc(value)}</p><p>${esc(note)}</p></article>`;
}

function requestTable(run: BrowserRun): string {
  return run.network?.length ? `<table><thead><tr><th>Method</th><th>URL</th><th>Result</th></tr></thead><tbody>${run.network.map(request => `<tr><td>${esc(request.method)}</td><td>${esc(request.url)}</td><td>${esc(request.blocked ? 'Blocked' : request.error ?? request.status ?? 'No completion recorded')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No browser request events recorded.</p>';
}

function runDetails(label: string, run: BrowserRun): string {
  const local = (run.localRequests ?? []).filter(request => !(request.method === 'GET' && request.path === '/test-page.html'));
  return `<details class="panel"><summary>${esc(label)}: captured details</summary>
<p class="muted">Firefox ${esc(run.browserVersion ?? 'not started')}${run.extensionId ? ` · Extension ID ${esc(run.extensionId)}` : ''}</p>
<h3>Other requests to the local test server</h3>${local.length ? local.map(request => `<div class="evidence"><strong>${esc(request.method)} ${esc(request.path)}</strong>${request.body ? `<details><summary>Show request body${request.truncated ? ' (truncated)' : ''}</summary><pre>${esc(request.body)}</pre></details>` : ''}</div>`).join('') : '<p class="muted">None beyond loading the test page.</p>'}
<h3>Connections rejected by the proxy</h3>${list(run.proxyAttempts ?? [])}
<details><summary>Browser request events (${run.network?.length ?? 0})</summary>${requestTable(run)}</details>
<details><summary>Console messages (${run.console?.length ?? 0})</summary>${list((run.console ?? []).map(entry => `${entry.level}: ${entry.text}`))}</details>
<details><summary>Captured page text</summary>${run.snapshot ? `<pre>${esc(run.snapshot.text)}</pre>` : '<p class="muted">No page snapshot.</p>'}</details>
${run.errors?.length ? `<h3>Run errors</h3>${list(run.errors)}` : ''}${run.warnings?.length ? `<h3>Coverage notes</h3>${list(run.warnings)}` : ''}
</details>`;
}

export function renderObservation(report: Observation): string {
  const comparison = report.comparison;
  const connections = comparison?.newProxyAttempts?.length ?? 0;
  const pageChanged = Boolean(comparison?.domChanged || comparison?.textChanged);
  const status = report.status === 'complete' ? 'Completed' : report.status === 'partial' ? 'Incomplete' : 'Failed';
  const headline = !comparison ? 'The browser comparison could not be completed.'
    : comparison.dummyDataReceived ? 'Dummy page data reached the local test server.'
    : pageChanged ? 'The page changed when the extension was installed.'
    : connections ? 'Connection attempts were recorded; the page looked unchanged.'
    : 'No change was detected in this local page test.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>XInspect observation: ${esc(report.extensionName)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;max-width:1120px;margin:0 auto;padding:2rem 1.25rem 4rem;background:#f4f7fb;color:#172437}h1,h2,h3,p{margin-top:0}h1{font-size:2rem;line-height:1.2;margin-bottom:.35rem}h2{font-size:1.35rem}h3{font-size:1rem}a{color:#175c99}header{margin-bottom:1.5rem}.eyebrow{text-transform:uppercase;letter-spacing:.1em;color:#53677f;font-size:.75rem;font-weight:700}.muted,.meta{color:#54657a}.meta{font-size:.9rem}.panel{background:white;border:1px solid #dce5ee;border-radius:12px;padding:1.25rem;margin:1rem 0;box-shadow:0 2px 8px #17243708}.hero{border-left:5px solid #367b9c}.hero h2{font-size:1.45rem;margin-bottom:.35rem}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.result{background:white;border:1px solid #dce5ee;border-radius:12px;padding:1rem}.result h3{color:#50637a;margin-bottom:.7rem}.value{font-size:1.35rem;font-weight:700;margin-bottom:.35rem}.result p:last-child{font-size:.9rem;color:#52647a;margin-bottom:0}.result.notice{border-top:4px solid #bd8b32}.result.neutral{border-top:4px solid #7c8ea0}.badge{display:inline-block;border-radius:999px;padding:.16rem .6rem;background:#d9ede7;color:#175d48;font-size:.8rem;font-weight:700}.badge.incomplete{background:#fff0d6;color:#765018}.badge.failed{background:#fce3e2;color:#943532}summary{cursor:pointer;font-weight:650}details details{margin:.8rem 0}details[open]>summary{margin-bottom:.8rem}.evidence{border-left:3px solid #8ca5bc;padding:.35rem .75rem;margin:.5rem 0}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;vertical-align:top;padding:.5rem;border-bottom:1px solid #e5ebf1;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:.8rem;border-radius:6px;font-size:.85rem}code{overflow-wrap:anywhere}ul{padding-left:1.35rem}li{margin:.2rem 0}.callout{padding:.7rem 1rem;border-radius:8px;background:#edf3f8;color:#344b63}@media(max-width:750px){.grid{grid-template-columns:1fr}body{padding:1.25rem .75rem}}
</style></head><body>
<header><p class="eyebrow">XInspect · Browser observation</p><h1>${esc(report.extensionName)}</h1><p class="meta"><span class="badge ${report.status === 'complete' ? '' : report.status === 'partial' ? 'incomplete' : 'failed'}">Status: ${status}</span> · ${esc(report.generatedAt)} · ${esc(report.scenario.seconds)} second test</p><p><a href="report.html">View source review</a> · <a href="observation.json">Download observation data</a></p></header>
<section class="panel hero"><h2>${esc(headline)}</h2><p>We compared the same local test page in Firefox without and with the extension. The page has no ads or third-party trackers, and no extension shortcuts were pressed.</p>${!comparison ? '<p><strong>Comparison unavailable.</strong> Both browser runs need a page snapshot.</p>' : ''}</section>
${comparison ? `<section class="grid" aria-label="Key results">
${resultCard('Page appearance', pageChanged ? 'Changed' : 'No difference seen', pageChanged ? 'Page content or visible text differed from the baseline.' : 'The captured page content matched the baseline.', pageChanged ? 'notice' : 'neutral')}
${resultCard('Test page data sent', comparison.dummyDataReceived ? 'Captured' : 'Not captured', comparison.dummyDataReceived ? 'The local test server received the page marker in a POST request.' : 'The local test server received no POST containing the page marker.', comparison.dummyDataReceived ? 'notice' : 'neutral')}
${resultCard('Blocked connections', String(connections), connections ? 'Destinations absent from baseline. Their source may be Firefox or the extension.' : 'No new proxy destinations were recorded.', connections ? 'notice' : 'neutral')}
</section>
${connections ? `<section class="panel"><h2>Blocked connection destinations</h2><p class="muted">The local proxy rejected these attempts. A destination alone does not show what data, if any, was sent or which component initiated it.</p>${list((comparison.newProxyAttempts ?? []).map(value => value.replace(/^CONNECT /, '')))}</section>` : ''}
${comparison.newRequestPatterns?.length ? `<details class="panel"><summary>Other requests absent from baseline (${comparison.newRequestPatterns.length})</summary>${list(comparison.newRequestPatterns)}</details>` : ''}` : ''}
${report.errors.length ? `<section class="panel"><h2>Observation errors</h2>${list(report.errors)}</section>` : ''}
<details class="panel"><summary>How this test was run</summary><p>Firefox opened a local page in a fresh profile, filled a dummy field, clicked its test button, and waited ${esc(report.scenario.seconds)} seconds. A second fresh profile repeated those steps with the extension installed.</p><p><strong>Test page:</strong> <code>${esc(report.scenario.url)}</code></p><p>${esc(report.scenario.networkPolicy)}</p><p><strong>Package SHA-256:</strong> <code>${esc(report.package.sha256)}</code></p></details>
${runDetails('With extension', report.extension)}${runDetails('Baseline without extension', report.baseline)}
<details class="panel"><summary>What this result does and does not show</summary><p class="callout">A quiet result does not prove an extension is safe. This test uses one local page and a short observation window.</p><p>The <a href="report.html">source review</a> found ${comparison?.staticPageModification ? 'page modification code' : 'no selected page modification indicator'} and ${comparison?.staticNetworkCapability ? 'network code' : 'no selected network indicator'}. Source indicators do not establish what ran in this browser test.</p>${list(report.limitations)}</details>
</body></html>`;
}
