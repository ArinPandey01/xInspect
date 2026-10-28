#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzePackage } from './analyze.js';
import { renderHtml } from './report.js';
import { observePackage } from './dynamic/observe.js';

function usage(): string { return `Usage:
  xinspect analyze <package.xpi|package.zip> --out <directory>
  xinspect observe <package.xpi|package.zip> --out <empty-directory> [--seconds 5] [--port 8765] [--firefox /path/to/firefox] [--headed]

observe compares fresh Firefox sessions without and with the extension on a controlled local test page.
Requires Node.js 22+ and Firefox with WebDriver BiDi support. Use an isolated VM for untrusted packages.`; }

async function observe(args: string[]): Promise<void> {
  const values = new Map<string, string>();
  let headed = false;
  for (let i = 2; i < args.length; i++) {
    const key = args[i]!;
    if (key === '--headed' && !headed) { headed = true; continue; }
    if (!['--out', '--seconds', '--port', '--firefox'].includes(key) || values.has(key) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(usage());
    values.set(key, args[++i]!);
  }
  if (!values.has('--out') || !args[1] || args[1].startsWith('--')) throw new Error(usage());
  const output = resolve(values.get('--out')!);
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Observation interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    console.log('observe runs extension code in a temporary Firefox profile. Use an isolated VM for untrusted packages.');
    const result = await observePackage(resolve(args[1]), {
      output, seconds: Number(values.get('--seconds') ?? 5), port: Number(values.get('--port') ?? 8765),
      firefox: values.get('--firefox') ?? process.env.FIREFOX_BINARY ?? 'firefox', headed, signal: controller.signal
    }, message => console.log(message));
    console.log(`Observation ${result.status}: ${result.extensionName}`);
    console.log(`Open in browser: ${pathToFileURL(join(output, 'observation.html')).href}`);
    for (const error of result.errors) console.error(error);
    if (result.status !== 'complete') process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

async function main(args: string[]): Promise<void> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { console.log(usage()); return; }
  if (args[0] === 'observe') { await observe(args); return; }
  if (args[0] !== 'analyze' || !args[1]) throw new Error(usage());
  const outIndex = args.indexOf('--out');
  if (outIndex < 0 || !args[outIndex + 1] || args.length !== 4 || outIndex !== 2) throw new Error(usage());
  const report = await analyzePackage(resolve(args[1]));
  const output = resolve(args[outIndex + 1]!);
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'),
    writeFile(join(output, 'report.html'), renderHtml(report))
  ]);
  console.log(`Analyzed ${report.package.name}: ${report.findings.length} findings`);
  console.log(`Reports: ${join(output, 'report.json')}, ${join(output, 'report.html')}`);
  console.log(`Open in browser: ${pathToFileURL(join(output, 'report.html')).href}`);
}

main(process.argv.slice(2)).catch(error => { console.error(`xinspect: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
