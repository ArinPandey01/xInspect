import type { ManifestSummary, Signal } from './types.js';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function unique(values: string[]): string[] { return [...new Set(values)].sort(); }

function isHostPattern(value: string): boolean { return value === '<all_urls>' || value.includes('://'); }

export function parseManifest(source: string): { summary: ManifestSummary; signals: Signal[] } {
  let data: Record<string, any>;
  try { data = object(JSON.parse(source)); }
  catch (error) { throw new Error(`Invalid manifest.json: ${error instanceof Error ? error.message : String(error)}`); }
  if (![2, 3].includes(data.manifest_version) || typeof data.name !== 'string' || typeof data.version !== 'string') {
    throw new Error('manifest.json must have a name, version, and manifest_version 2 or 3');
  }
  const permissions = strings(data.permissions);
  const optionalPermissions = strings(data.optional_permissions);
  const content = Array.isArray(data.content_scripts) ? data.content_scripts.map(object) : [];
  const hosts = unique([...permissions.filter(isHostPattern), ...strings(data.host_permissions), ...content.flatMap(x => strings(x.matches))]);
  const optionalHosts = unique([...optionalPermissions.filter(isHostPattern), ...strings(data.optional_host_permissions)]);
  const background = object(data.background);
  const gecko = object(object(data.browser_specific_settings).gecko);
  const legacyGecko = object(object(data.applications).gecko);
  const extensionId = typeof gecko.id === 'string' ? gecko.id : typeof legacyGecko.id === 'string' ? legacyGecko.id : undefined;
  const pages = unique([
    background.page, data.options_page, object(data.options_ui).page, data.devtools_page,
    object(data.action).default_popup, object(data.browser_action).default_popup,
    object(data.page_action).default_popup, object(data.sidebar_action).default_panel
  ].filter((x): x is string => typeof x === 'string'));
  const summary: ManifestSummary = {
    name: data.name,
    version: data.version,
    ...(extensionId ? { extensionId } : {}),
    manifestVersion: data.manifest_version,
    permissions: unique(permissions.filter(x => !isHostPattern(x))),
    optionalPermissions: unique(optionalPermissions.filter(x => !isHostPattern(x))),
    hostPermissions: hosts,
    optionalHostPermissions: optionalHosts,
    contentScripts: unique(content.flatMap(x => strings(x.js))),
    backgroundScripts: unique([...strings(background.scripts), ...(typeof background.service_worker === 'string' ? [background.service_worker] : [])]),
    pages
  };
  const signals: Signal[] = [];
  for (const [host, optional] of [...hosts.map(x => [x, false] as const), ...optionalHosts.map(x => [x, true] as const)]) {
    if (host === '<all_urls>' || /^\*:\/\/\*\//.test(host) || /^https?:\/\/\*\//.test(host)) {
      const index = source.indexOf(JSON.stringify(host));
      const line = index >= 0 ? source.slice(0, index).split('\n').length : undefined;
      signals.push({ kind: 'broad-host', evidence: { file: 'manifest.json', ...(line ? { line } : {}), detail: `${optional ? 'Optional broad host access' : 'Broad host access'}: ${host}` } });
    }
  }
  for (const [permission, optional] of [...summary.permissions.map(x => [x, false] as const), ...summary.optionalPermissions!.map(x => [x, true] as const)]) {
    if (['cookies', 'tabs', 'history', 'webRequest', 'downloads'].includes(permission)) {
      const index = source.indexOf(JSON.stringify(permission));
      const line = index >= 0 ? source.slice(0, index).split('\n').length : undefined;
      signals.push({ kind: 'sensitive-api', evidence: { file: 'manifest.json', ...(line ? { line } : {}), detail: `${optional ? 'Optional ' : ''}permission: ${permission}` } });
    }
  }
  return { summary, signals };
}
