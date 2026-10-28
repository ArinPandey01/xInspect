import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { openArchive } from './archive.js';
import { parseManifest } from './manifest.js';
import { scanHtml, scanJavaScript } from './scan.js';
import type { Evidence, FileRecord, Finding, Report, Severity, Signal, SignalKind } from './types.js';

const TITLES: Record<SignalKind, string> = {
  'broad-host': 'Broad site access',
  'sensitive-api': 'Sensitive browser permission or API',
  'dom-read': 'Page content access',
  'dom-write': 'Page modification',
  'network': 'Network request capability',
  'external-url': 'External URL',
  'dynamic-code': 'Dynamic code execution'
};

const REASONS: Record<SignalKind, string> = {
  'broad-host': 'The extension requests access to many sites; review whether this is necessary.',
  'sensitive-api': 'The extension requests or uses an API that can expose browsing data or affect browser behavior.',
  'dom-read': 'Code reads or selects page content. This can be expected for extensions that work on web pages.',
  'dom-write': 'Code changes page content. Review what is changed and on which sites.',
  'network': 'Code can make a network request. The destination and transferred data may depend on runtime values.',
  'external-url': 'A literal remote URL appears in source or HTML. Its presence alone does not show a request occurs.',
  'dynamic-code': 'Code can execute generated strings, which makes static review less complete.'
};

function dedupeEvidence(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter(x => {
    const key = `${x.file}\0${x.line ?? ''}\0${x.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findingsFrom(signals: Signal[]): Finding[] {
  const byKind = new Map<SignalKind, Evidence[]>();
  for (const signal of signals) byKind.set(signal.kind, [...(byKind.get(signal.kind) ?? []), signal.evidence]);
  const findings: Finding[] = [];
  const combined = (id: string, title: string, reason: string, kinds: SignalKind[]) => {
    if (kinds.every(x => byKind.has(x))) {
      const representative = kinds.map(x => byKind.get(x)![0]!);
      const remaining = kinds.flatMap(x => byKind.get(x) ?? []);
      findings.push({ id, title, severity: 'high', reason, evidence: dedupeEvidence([...representative, ...remaining]).slice(0, 20) });
    }
  };
  combined('broad-page-network', 'Broad page access with reading and network capability',
    'Broad site access, page reading, and a network request appear together. Review the data flow; this combination does not prove exfiltration.',
    ['broad-host', 'dom-read', 'network']);
  combined('sensitive-api-network', 'Sensitive browser access with network capability',
    'A sensitive browser API or permission appears alongside a network request. Review the data flow and requested access.',
    ['sensitive-api', 'network']);
  for (const [kind, evidence] of byKind) {
    const severity: Severity = ['broad-host', 'sensitive-api', 'network', 'dynamic-code'].includes(kind) ? 'medium' : 'low';
    findings.push({ id: kind, title: TITLES[kind], severity, reason: REASONS[kind], evidence: dedupeEvidence(evidence).slice(0, 30) });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
}

export async function analyzePackage(filePath: string): Promise<Report> {
  const extension = extname(filePath).toLowerCase();
  if (extension !== '.xpi' && extension !== '.zip') throw new Error('Input must be a .xpi or .zip package');
  const archive = await openArchive(filePath);
  const manifestEntry = archive.entries.find(x => x.path === 'manifest.json');
  if (!manifestEntry) throw new Error('Root manifest.json is missing');
  const manifestSource = await manifestEntry.readText();
  const { summary, signals: manifestSignals } = parseManifest(manifestSource);
  const signals: Signal[] = [...manifestSignals];
  const limitations: string[] = [
    'Review priority is not a malware classification. Static inspection cannot confirm runtime behavior or data transfer.',
    'Known-malware hash matching is not included in this version.'
  ];
  const inventory: FileRecord[] = [];
  const paths = new Set(archive.entries.map(x => x.path));
  const manifestData = JSON.parse(manifestSource) as Record<string, unknown>;
  const nameKey = /^__MSG_(.+)__$/.exec(summary.name)?.[1];
  const locale = manifestData.default_locale;
  if (nameKey && typeof locale === 'string' && /^[A-Za-z0-9_-]+$/.test(locale)) {
    const messages = archive.entries.find(x => x.path === `_locales/${locale}/messages.json`);
    if (messages) {
      try {
        const data = JSON.parse(await messages.readText()) as Record<string, { message?: string }>;
        const match = Object.entries(data).find(([key]) => key.toLowerCase() === nameKey.toLowerCase());
        if (typeof match?.[1]?.message === 'string') summary.name = match[1].message;
      } catch { limitations.push(`Could not resolve localized extension name from ${messages.path}`); }
    }
  }
  for (const referenced of [...summary.contentScripts, ...summary.backgroundScripts, ...summary.pages]) {
    const normalized = referenced.replace(/^\//, '').replace(/[?#].*$/, '');
    if (!paths.has(normalized)) limitations.push(`Manifest references a missing file: ${referenced}`);
  }
  for (const entry of archive.entries) {
    const lower = entry.path.toLowerCase();
    const kind: FileRecord['kind'] = entry.path === 'manifest.json' ? 'manifest' :
      /\.(js|mjs|cjs)$/.test(lower) ? 'javascript' : /\.(html|htm)$/.test(lower) ? 'html' : 'asset';
    const record: FileRecord = { path: entry.path, bytes: entry.bytes, kind, scanned: false };
    inventory.push(record);
    if (kind !== 'javascript' && kind !== 'html') continue;
    try {
      const source = await entry.readText();
      if (kind === 'javascript') signals.push(...scanJavaScript(source, entry.path));
      else {
        const result = scanHtml(source, entry.path);
        signals.push(...result.signals);
        limitations.push(...result.limitations);
      }
      record.scanned = true;
    } catch (error) {
      limitations.push(`Could not scan ${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    package: { name: basename(filePath), bytes: archive.bytes.length, sha256: createHash('sha256').update(archive.bytes).digest('hex') },
    manifest: summary,
    inventory,
    findings: findingsFrom(signals),
    limitations
  };
}
