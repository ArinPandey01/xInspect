import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzePackage } from './analyze.js';
import { renderHtml } from './report.js';
import { observePackage } from './dynamic/observe.js';

const PORT = Number(process.env.XINSPECT_WEB_PORT ?? 4173);
const OBSERVE_PORT = Number(process.env.XINSPECT_OBSERVE_PORT ?? 8765);
const MAX_UPLOAD = 25 * 1024 * 1024;
const REPORT_ROOT = resolve(process.env.XINSPECT_REPORTS_DIR ?? 'reports/web');
const HASH_LIST_PATH = process.env.XINSPECT_HASH_LIST ? resolve(process.env.XINSPECT_HASH_LIST) : undefined;
type Mode = 'static' | 'dynamic' | 'both';
type Job = {
  id: string; name: string; mode: Mode; status: 'running' | 'complete' | 'failed';
  stage: string; log: string[]; startedAt: string; finishedAt?: string;
  reports: Record<string, string>; error?: string; observationStatus?: string;
};
const jobs = new Map<string, Job>();
let activeJob: string | undefined;
const sizeText = (bytes: number): string => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

const page = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>XInspect · Extension review</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#172536;background:#f4f7fb;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box}body{margin:0;min-height:100vh}.shell{max-width:1050px;margin:auto;padding:52px 24px 80px}.brand{font-size:12px;font-weight:750;letter-spacing:.16em;text-transform:uppercase;color:#62758a}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:46px}.local{font-size:12px;color:#63758a;display:flex;align-items:center;gap:8px}.dot{width:8px;height:8px;border-radius:50%;background:#31a27a}.hero{max-width:740px;margin-bottom:32px}h1{font-size:clamp(34px,6vw,54px);letter-spacing:-.045em;line-height:1.04;margin:0 0 16px;font-weight:730}.lead{font-size:17px;color:#586b80;line-height:1.65;margin:0}.card{background:#fff;border:1px solid #dbe4ee;border-radius:17px;padding:26px;margin:18px 0;box-shadow:0 8px 30px #24364a08}.card h2{font-size:16px;margin:0 0 18px;letter-spacing:-.01em}.drop{position:relative;border:1.5px dashed #bac8d8;border-radius:13px;background:#f9fbfd;min-height:174px;display:grid;place-items:center;text-align:center;transition:.18s}.drop.over{border-color:#276b9f;background:#f0f7fc}.drop input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.drop-content{pointer-events:none;padding:20px}.upload-icon{width:42px;height:42px;margin:0 auto 12px;display:grid;place-items:center;border-radius:12px;background:#eaf2f8;color:#245f8c;font-size:22px}.drop strong{display:block;font-size:15px}.drop span{display:block;color:#708197;font-size:13px;margin-top:6px}.file{margin-top:14px;padding:12px 14px;border:1px solid #dbe4ee;border-radius:10px;display:flex;justify-content:space-between;align-items:center;color:#42566e;font-size:14px}.file[hidden]{display:none}.file small{color:#78899b}.modes{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.mode{border:1px solid #dbe4ee;border-radius:11px;padding:14px;background:#fff;cursor:pointer;text-align:left;color:#24374b;font:inherit}.mode:hover{border-color:#9db5ca}.mode.selected{border-color:#2a719f;box-shadow:0 0 0 2px #2a719f18;background:#f6fbff}.mode b{display:block;font-size:14px;margin-bottom:4px}.mode span{display:block;font-size:12px;line-height:1.45;color:#75869a}.settings{display:flex;align-items:center;gap:10px;margin:18px 0 0;color:#586b80;font-size:13px}.settings[hidden]{display:none}.settings input[type=number]{width:78px;border:1px solid #d4dfea;border-radius:8px;padding:8px;font:inherit;color:#23364a}.warning{display:flex;gap:11px;padding:13px 15px;border:1px solid #eed9ae;border-radius:10px;background:#fffaf0;color:#735722;font-size:13px;line-height:1.5;margin-top:18px}.warning[hidden]{display:none}.warning strong{display:block;color:#624815;margin-bottom:3px}.ack{display:flex;align-items:flex-start;gap:9px;margin-top:12px;color:#5f6f81;font-size:12px;line-height:1.5}.ack[hidden]{display:none}.ack input{margin:3px 0 0;accent-color:#276b9f}.run{margin-top:22px;border:0;background:#1f5f8d;color:white;border-radius:10px;padding:13px 20px;font:700 14px inherit;cursor:pointer;box-shadow:0 4px 12px #1f5f8d22}.run:hover{background:#174d75}.run:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}.footnote{font-size:12px;color:#8090a1;margin:13px 0 0}.progress-head{display:flex;justify-content:space-between;align-items:center;gap:20px}.status{font-size:12px;font-weight:700;color:#246b53;background:#e5f5ee;padding:5px 9px;border-radius:999px}.status.running{color:#275d83;background:#e9f3fa}.status.failed{color:#963e3a;background:#fff0ef}.stage{font-size:14px;color:#485e74;margin:2px 0 16px}.bar{height:5px;border-radius:10px;background:#e9eef3;overflow:hidden;margin-bottom:16px}.bar span{display:block;width:35%;height:100%;background:#3684ad;border-radius:10px;animation:move 1.4s ease-in-out infinite alternate}.bar.done span{width:100%;animation:none;background:#35a17a}@keyframes move{to{transform:translateX(185%)}}.logs{max-height:210px;overflow:auto;border-radius:9px;background:#f6f8fa;padding:13px 15px;font:12px/1.7 ui-monospace,SFMono-Regular,monospace;color:#5c6e82;white-space:pre-wrap}.results{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.results a{display:inline-flex;padding:9px 12px;border:1px solid #cddbe7;border-radius:9px;text-decoration:none;color:#215f8c;font-size:13px;font-weight:650}.results a:hover{background:#f4f9fc}.results[hidden],#progress[hidden]{display:none}.error{color:#9b3935;font-size:13px;margin-top:12px}.principle{display:flex;gap:13px;color:#63758a;font-size:13px;line-height:1.55;margin-top:26px}.principle b{color:#344b62}@media(max-width:650px){.shell{padding:28px 16px 50px}.top{margin-bottom:34px}.modes{grid-template-columns:1fr}.card{padding:20px}.local{font-size:11px}}
</style></head><body><main class="shell">
<div class="top"><div class="brand">XInspect</div><div class="local"><i class="dot"></i>Runs on this computer</div></div>
<section class="hero"><h1>Review an extension.</h1><p class="lead">Inspect the package contents, observe its behavior in a controlled Firefox run, or do both. Results stay on this computer.</p></section>
<section class="card"><h2>Choose an XPI or ZIP package</h2>
<div class="drop" id="drop"><input id="fileInput" type="file" accept=".xpi,.zip,application/zip"><div class="drop-content"><div class="upload-icon">↑</div><strong>Drop a package here or browse files</strong><span>Firefox .xpi or .zip · up to 25 MiB</span></div></div>
<div class="file" id="fileInfo" hidden><span id="fileName"></span><small id="fileSize"></small></div>
<h2 style="margin-top:28px">Choose the review</h2><div class="modes" role="group" aria-label="Analysis type">
<button class="mode selected" data-mode="static"><b>Source review</b><span>Inspect permissions, files, and code patterns</span></button>
<button class="mode" data-mode="dynamic"><b>Browser observation</b><span>Run in Firefox against a local test page</span></button>
<button class="mode" data-mode="both"><b>Both</b><span>Run source review and browser observation</span></button></div>
<div class="settings" id="settings" hidden><label for="seconds">Observation window</label><input id="seconds" type="number" min="1" max="60" value="5"><span>seconds</span></div>
<label class="ack"><input id="mozillaCheck" type="checkbox"><span>Check Mozilla’s online blocklist for this Firefox extension ID and version. This sends the ID to Mozilla.</span></label>
<div class="warning" id="warning" hidden><span>⚠</span><div><strong>Browser observation runs the extension code.</strong> Firefox uses a temporary profile, a local test page, and restricted HTTP connections. These controls are not an operating-system sandbox.</div></div>
<label class="ack" id="ack" hidden><input id="ackCheck" type="checkbox"><span>I understand that unknown or untrusted packages should only be run inside a disposable isolated virtual machine.</span></label>
<button id="run" class="run" disabled>Start source review</button><p class="footnote">Archives are checked against XInspect’s package limits before analysis begins.</p>
</section>
<section class="card" id="progress" hidden><div class="progress-head"><h2 style="margin:0">Analysis progress</h2><span id="status" class="status running">In progress</span></div><p class="stage" id="stage">Preparing…</p><div class="bar" id="bar"><span></span></div><div class="logs" id="logs" aria-live="polite"></div><div class="error" id="error"></div><div class="results" id="results" hidden></div></section>
<div class="principle"><span>●</span><div><b>Evidence, not verdicts.</b> Findings highlight code and access that may deserve review. They do not classify an extension as malware.</div></div>
</main><script>
const input=document.querySelector('#fileInput'),drop=document.querySelector('#drop'),fileInfo=document.querySelector('#fileInfo'),fileName=document.querySelector('#fileName'),fileSize=document.querySelector('#fileSize'),run=document.querySelector('#run'),buttons=[...document.querySelectorAll('.mode')],settings=document.querySelector('#settings'),warning=document.querySelector('#warning'),ack=document.querySelector('#ack'),ackCheck=document.querySelector('#ackCheck'),mozillaCheck=document.querySelector('#mozillaCheck'),seconds=document.querySelector('#seconds'),progress=document.querySelector('#progress'),status=document.querySelector('#status'),stage=document.querySelector('#stage'),bar=document.querySelector('#bar'),logs=document.querySelector('#logs'),error=document.querySelector('#error'),results=document.querySelector('#results');let file=null,mode='static',busy=false;
const sizeText=n=>n<1024*1024?(n/1024).toFixed(0)+' KiB':(n/1024/1024).toFixed(1)+' MiB';
function setFile(f){if(!f)return;file=f;fileInfo.hidden=false;fileName.textContent=f.name;fileSize.textContent=sizeText(f.size);updateButton()}
function updateButton(){const unsafe=mode!=='static'&&!ackCheck.checked;run.disabled=busy||!file||unsafe;run.textContent=mode==='static'?'Start source review':mode==='dynamic'?'Start browser observation':'Start both reviews'}
input.addEventListener('change',()=>setFile(input.files[0]));for(const ev of ['dragenter','dragover'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over')});for(const ev of ['dragleave','drop'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over')});drop.addEventListener('drop',e=>setFile(e.dataTransfer.files[0]));
buttons.forEach(b=>b.addEventListener('click',()=>{buttons.forEach(x=>x.classList.toggle('selected',x===b));mode=b.dataset.mode;const dynamic=mode!=='static';settings.hidden=!dynamic;warning.hidden=!dynamic;ack.hidden=!dynamic;if(!dynamic)ackCheck.checked=false;updateButton()}));ackCheck.addEventListener('change',updateButton);
function showJob(job){status.textContent=job.status==='running'?'In progress':job.status==='failed'?'Could not complete':job.observationStatus==='partial'?'Completed with partial observation':job.observationStatus==='failed'?'Source review ready · browser observation failed':'Complete';status.className='status '+(job.status==='running'?'running':job.status==='failed'||job.observationStatus==='failed'?'failed':'');stage.textContent=job.stage;logs.textContent=job.log.join('\n');logs.scrollTop=logs.scrollHeight;error.textContent=job.error||'';bar.classList.toggle('done',job.status!=='running');results.replaceChildren();for(const [label,url] of Object.entries(job.reports||{})){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=label;results.append(a)}results.hidden=!Object.keys(job.reports||{}).length}
async function poll(id){while(true){const r=await fetch('/api/jobs/'+id,{cache:'no-store'});if(!r.ok)throw new Error('Could not read analysis progress');const job=await r.json();showJob(job);if(job.status!=='running')return job;await new Promise(resolve=>setTimeout(resolve,600))}}
run.addEventListener('click',()=>{if(!file||busy)return;busy=true;updateButton();progress.hidden=false;error.textContent='';results.hidden=true;logs.textContent='Uploading package…';stage.textContent='Uploading package';bar.classList.remove('done');const xhr=new XMLHttpRequest();xhr.open('POST','/api/jobs?mode='+mode+'&seconds='+encodeURIComponent(seconds.value)+'&mozilla='+mozillaCheck.checked+'&filename='+encodeURIComponent(file.name));xhr.setRequestHeader('X-XInspect-Request','1');xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.upload.onprogress=e=>{if(e.lengthComputable)stage.textContent='Uploading package · '+Math.round(e.loaded/e.total*100)+'%'};xhr.onload=async()=>{try{const body=JSON.parse(xhr.responseText);if(xhr.status!==202)throw new Error(body.error||'Could not start analysis');stage.textContent='Package received; starting analysis';const job=await poll(body.id);if(job.status==='failed')throw new Error(job.error||'Analysis failed');}catch(e){error.textContent=e.message;status.textContent='Could not complete';status.className='status failed'}finally{busy=false;updateButton()}};xhr.onerror=()=>{error.textContent='Upload failed. Check that the local XInspect server is running.';status.textContent='Could not complete';status.className='status failed';busy=false;updateButton()};xhr.send(file)});
</script></body></html>`;

function respond(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(body);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  respond(res, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

function readUpload(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveUpload, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD) { reject(new Error('Package exceeds the 25 MiB upload limit')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolveUpload(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function addLog(job: Job, message: string): void {
  job.stage = message.replace(/[.…]+$/, '');
  job.log.push(`${new Date().toLocaleTimeString()}  ${message}`);
}

async function execute(job: Job, bytes: Buffer, mode: Mode, seconds: number, mozillaBlocklist: boolean): Promise<void> {
  let workDir: string | undefined;
  try {
    workDir = await mkdtemp(join(tmpdir(), 'xinspect-web-'));
    const packagePath = join(workDir, `sample${extname(job.name).toLowerCase()}`);
    await writeFile(packagePath, bytes, { mode: 0o600 });
    if (mode === 'static' || mode === 'both') {
      addLog(job, 'Checking archive structure and scanning manifest, JavaScript, and HTML…');
      const report = await analyzePackage(packagePath, { mozillaBlocklist, hashListPath: HASH_LIST_PATH });
      const out = join(REPORT_ROOT, job.id, 'static');
      await mkdir(out, { recursive: true });
      await Promise.all([
        writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'),
        writeFile(join(out, 'report.html'), renderHtml(report))
      ]);
      job.reports['Source review'] = `/reports/${job.id}/static/report.html`;
      job.reports['Source data (JSON)'] = `/reports/${job.id}/static/report.json`;
      addLog(job, `Source review complete · ${report.findings.length} finding groups`);
    }
    if (mode === 'dynamic' || mode === 'both') {
      addLog(job, 'Preparing two fresh Firefox profiles and the restricted local test environment…');
      const out = join(REPORT_ROOT, job.id, 'dynamic');
      const observation = await observePackage(packagePath, {
        output: out, seconds, port: OBSERVE_PORT,
        firefox: process.env.FIREFOX_BINARY ?? 'firefox', headed: false,
        mozillaBlocklist, hashListPath: HASH_LIST_PATH
      }, message => addLog(job!, message));
      job.observationStatus = observation.status;
      job.reports['Browser observation'] = `/reports/${job.id}/dynamic/observation.html`;
      job.reports['Observation data (JSON)'] = `/reports/${job.id}/dynamic/observation.json`;
      if (mode === 'dynamic') job.reports['Source review'] = `/reports/${job.id}/dynamic/report.html`;
      addLog(job, observation.status === 'complete' ? 'Browser observation complete.' : `Browser observation finished with ${observation.status} results.`);
    }
    job.status = 'complete';
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    addLog(job, `Stopped · ${job.error}`);
  } finally {
    if (workDir) {
      try { await rm(workDir, { recursive: true, force: true }); }
      catch (error) { addLog(job, `Temporary-file cleanup warning · ${String(error)}`); }
    }
    job.finishedAt = new Date().toISOString();
    activeJob = undefined;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const base = `http://127.0.0.1:${PORT}`;
  const url = new URL(req.url ?? '/', base);
  if (req.method === 'GET' && url.pathname === '/') {
    respond(res, 200, page, 'text/html; charset=utf-8');
    return;
  }
  const jobMatch = /^\/api\/jobs\/([a-f0-9-]+)$/.exec(url.pathname);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]!);
    if (!job) { json(res, 404, { error: 'Analysis job not found' }); return; }
    json(res, 200, job);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    const origin = req.headers.origin;
    if ((origin && origin !== base) || req.headers['x-xinspect-request'] !== '1') {
      json(res, 403, { error: 'Request must come from this local XInspect page' }); return;
    }
    const mode = url.searchParams.get('mode') as Mode | null;
    const seconds = Number(url.searchParams.get('seconds') ?? '5');
    const mozilla = url.searchParams.get('mozilla');
    if (!mode || !['static', 'dynamic', 'both'].includes(mode)) { json(res, 400, { error: 'Select source, browser, or both reviews' }); return; }
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) { json(res, 400, { error: 'Observation window must be between 1 and 60 seconds' }); return; }
    if (mozilla !== 'true' && mozilla !== 'false') { json(res, 400, { error: 'Invalid Mozilla lookup option' }); return; }
    if (activeJob) { json(res, 409, { error: 'Another analysis is already running. Wait for it to finish first.' }); return; }
    activeJob = 'uploading';
    let bytes: Buffer;
    try { bytes = await readUpload(req); }
    catch (error) { activeJob = undefined; if (!res.destroyed) json(res, 413, { error: error instanceof Error ? error.message : String(error) }); return; }
    const name = basename(url.searchParams.get('filename') ?? 'extension.xpi');
    if (!['.xpi', '.zip'].includes(extname(name).toLowerCase())) { activeJob = undefined; json(res, 400, { error: 'Choose a .xpi or .zip package' }); return; }
    if (!bytes.length) { activeJob = undefined; json(res, 400, { error: 'The selected package is empty' }); return; }
    const id = randomUUID();
    const job: Job = { id, name, mode, status: 'running', stage: 'Preparing analysis', log: [], startedAt: new Date().toISOString(), reports: {} };
    jobs.set(id, job); activeJob = id; addLog(job, `${name} received · ${sizeText(bytes.length)}`);
    json(res, 202, { id });
    void execute(job, bytes, mode, seconds, mozilla === 'true');
    return;
  }
  const reportMatch = /^\/reports\/([a-f0-9-]+)\/(static|dynamic)\/(report\.html|report\.json|observation\.html|observation\.json)$/.exec(url.pathname);
  if (req.method === 'GET' && reportMatch) {
    const [, id, kind, file] = reportMatch;
    const path = resolve(REPORT_ROOT, id!, kind!, file!);
    try {
      const contents = await readFile(path);
      const type = file!.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8';
      respond(res, 200, contents.toString(), type);
    } catch { respond(res, 404, 'Report is not ready'); }
    return;
  }
  respond(res, 404, 'Not found');
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('XINSPECT_WEB_PORT must be between 1 and 65535');
if (!Number.isInteger(OBSERVE_PORT) || OBSERVE_PORT < 1 || OBSERVE_PORT > 65535) throw new Error('XINSPECT_OBSERVE_PORT must be between 1 and 65535');
await mkdir(REPORT_ROOT, { recursive: true });
const server = createServer((req, res) => { void handle(req, res).catch(error => { if (!res.headersSent) json(res, 500, { error: error instanceof Error ? error.message : String(error) }); else res.destroy(); }); });
server.on('error', error => {
  console.error(`Could not start the XInspect web server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(PORT, '127.0.0.1', () => {
  const address = `http://127.0.0.1:${PORT}`;
  console.log(`XInspect web app: ${address}`);
  console.log('Bound to loopback; this interface is available only on this computer.');
  console.log(`Reports: ${pathToFileURL(REPORT_ROOT).href}`);
});
