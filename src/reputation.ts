import { readFile } from 'node:fs/promises';
import type { ManifestSummary, ReputationCheck } from './types.js';

const MOZILLA_API = 'https://addons.mozilla.org/api/v5/blocklist/block/';

export async function checkMozillaBlocklist(manifest: ManifestSummary, fetcher: typeof fetch = fetch): Promise<ReputationCheck> {
  const source = 'Mozilla Add-ons blocklist';
  if (!manifest.extensionId) return { source, status: 'unavailable', detail: 'The manifest has no Firefox extension ID, so the blocklist cannot be checked.' };
  const url = `${MOZILLA_API}${encodeURIComponent(manifest.extensionId)}/`;
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (response.status === 404) return { source, status: 'not-listed', detail: 'This extension ID was not found in Mozilla’s blocklist at the time of the check.', checkedAt };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as Record<string, unknown>;
    if (data.guid !== manifest.extensionId || !Array.isArray(data.blocked) || !Array.isArray(data.soft_blocked)) throw new Error('Unexpected blocklist response');
    const blocked = data.blocked.filter((x): x is string => typeof x === 'string');
    const soft = data.soft_blocked.filter((x): x is string => typeof x === 'string');
    const reason = typeof data.reason === 'string' && data.reason.trim() ? ` Reason: ${data.reason.trim()}` : '';
    const urlValue = typeof data.url === 'object' && data.url !== null ? (data.url as Record<string, unknown>).url : data.url;
    const reference = typeof urlValue === 'string' && /^https:\/\//i.test(urlValue) ? urlValue : undefined;
    if (blocked.includes(manifest.version) || (data.is_all_versions === true && blocked.length > 0)) return { source, status: 'blocked', detail: `Mozilla hard-blocks version ${manifest.version}.${reason}`, ...(reference ? { url: reference } : {}), checkedAt };
    if (soft.includes(manifest.version) || (data.is_all_versions === true && soft.length > 0)) return { source, status: 'soft-blocked', detail: `Mozilla soft-blocks version ${manifest.version}.${reason}`, ...(reference ? { url: reference } : {}), checkedAt };
    return { source, status: 'not-listed', detail: `Mozilla has a blocklist record for this ID, but version ${manifest.version} is not listed as blocked.`, checkedAt };
  } catch (error) {
    return { source, status: 'unavailable', detail: `The Mozilla blocklist check could not complete: ${error instanceof Error ? error.message : String(error)}`, checkedAt };
  }
}

interface HashRecord { sha256: string; label: string; source: string; url?: string }

export async function checkHashList(sha256: string, path?: string): Promise<ReputationCheck> {
  const source = 'Local SHA-256 reference list';
  if (!path) return { source, status: 'not-checked', detail: 'No hash list was supplied.' };
  try {
    const raw = await readFile(path);
    if (raw.length > 5 * 1024 * 1024) throw new Error('Hash list exceeds 5 MiB');
    const data: unknown = JSON.parse(raw.toString('utf8'));
    if (!Array.isArray(data) || data.length > 50000 || !data.every((x: unknown) => {
      if (!x || typeof x !== 'object') return false;
      const item = x as Partial<HashRecord>;
      return typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(item.sha256) && typeof item.label === 'string' && !!item.label.trim() && typeof item.source === 'string' && !!item.source.trim() && (item.url === undefined || typeof item.url === 'string');
    })) throw new Error('Expected an array of up to 50,000 records with sha256, label, and source');
    const match = (data as HashRecord[]).find(x => x.sha256.toLowerCase() === sha256);
    const checkedAt = new Date().toISOString();
    if (!match) return { source, status: 'not-listed', detail: `No exact package hash match in the supplied list (${data.length} records). This does not establish safety.`, checkedAt };
    return { source, status: 'hash-match', detail: `Exact package hash match: ${match.label}. Source: ${match.source}.`, ...(match.url && /^https:\/\//i.test(match.url) ? { url: match.url } : {}), checkedAt };
  } catch (error) {
    return { source, status: 'unavailable', detail: `The hash list could not be used: ${error instanceof Error ? error.message : String(error)}` };
  }
}
