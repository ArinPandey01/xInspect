import type { Report } from '../types.js';

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  context: string | null;
  time: string;
  blocked: boolean;
  status?: number;
  error?: string;
}

export interface LocalRequest {
  method: string;
  path: string;
  body: string;
  truncated: boolean;
}

export interface Snapshot {
  title: string;
  text: string;
  html: string;
  elements: number;
  truncated: boolean;
}

export interface BrowserRun {
  browserVersion?: string;
  extensionId?: string;
  snapshot?: Snapshot;
  network: NetworkRequest[];
  console: { level: string; text: string }[];
  localRequests: LocalRequest[];
  proxyAttempts: string[];
  errors: string[];
  warnings: string[];
}

export interface Observation {
  schemaVersion: 1;
  status: 'complete' | 'partial' | 'failed';
  generatedAt: string;
  package: Report['package'];
  extensionName: string;
  scenario: { url: string; seconds: number; actions: string[]; networkPolicy: string };
  baseline: BrowserRun;
  extension: BrowserRun;
  comparison?: {
    domChanged: boolean;
    textChanged: boolean;
    newRequestPatterns: string[];
    newProxyAttempts: string[];
    dummyDataReceived: boolean;
    staticPageModification: boolean;
    staticNetworkCapability: boolean;
  };
  limitations: string[];
  errors: string[];
}

export interface ObserveOptions {
  output: string;
  seconds: number;
  port: number;
  firefox: string;
  headed: boolean;
  signal?: AbortSignal;
}
