export type Severity = 'low' | 'medium' | 'high';
export type SignalKind = 'broad-host' | 'sensitive-api' | 'dom-read' | 'dom-write' | 'network' | 'external-url' | 'dynamic-code';

export interface Evidence {
  file: string;
  line?: number;
  detail: string;
}

export interface Signal {
  kind: SignalKind;
  evidence: Evidence;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  reason: string;
  evidence: Evidence[];
}

export interface FileRecord {
  path: string;
  bytes: number;
  kind: 'manifest' | 'javascript' | 'html' | 'asset';
  scanned: boolean;
}

export interface ManifestSummary {
  name: string;
  version: string;
  manifestVersion: number;
  permissions: string[];
  optionalPermissions?: string[];
  hostPermissions: string[];
  optionalHostPermissions?: string[];
  contentScripts: string[];
  backgroundScripts: string[];
  pages: string[];
}

export interface Report {
  schemaVersion: 1;
  generatedAt: string;
  package: { name: string; bytes: number; sha256: string };
  manifest: ManifestSummary;
  inventory: FileRecord[];
  findings: Finding[];
  limitations: string[];
}
