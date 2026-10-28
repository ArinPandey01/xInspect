import { open } from 'node:fs/promises';
import JSZip from 'jszip';

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 1000;

export interface ArchiveEntry {
  path: string;
  bytes: number;
  readText(): Promise<string>;
}

export interface Archive {
  bytes: Buffer;
  entries: ArchiveEntry[];
}

async function readArchiveBytes(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Input package must be a regular file');
    if (info.size > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds 25 MiB');
    const chunks: Buffer[] = [];
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds 25 MiB');
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function preflight(bytes: Buffer): Map<string, number> {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Invalid ZIP: central directory was not found');
  const count = bytes.readUInt16LE(end + 10);
  const centralBytes = bytes.readUInt32LE(end + 12);
  const centralStart = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || centralBytes === 0xffffffff || centralStart === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported');
  }
  if (count > MAX_FILES) throw new Error(`Archive has more than ${MAX_FILES} entries`);
  if (centralStart + centralBytes > end) throw new Error('Invalid ZIP central directory bounds');
  const entries = new Map<string, number>();
  let total = 0;
  let pos = centralStart;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid ZIP central directory entry');
    const flags = bytes.readUInt16LE(pos + 8);
    const method = bytes.readUInt16LE(pos + 10);
    const size = bytes.readUInt32LE(pos + 24);
    const nameLength = bytes.readUInt16LE(pos + 28);
    const extraLength = bytes.readUInt16LE(pos + 30);
    const commentLength = bytes.readUInt16LE(pos + 32);
    const next = pos + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new Error('Invalid ZIP entry length');
    if (flags & 1) throw new Error('Encrypted ZIP entries are not supported');
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method: ${method}`);
    if (size === 0xffffffff) throw new Error('ZIP64 entries are not supported');
    const path = bytes.subarray(pos + 46, pos + 46 + nameLength).toString((flags & 0x800) ? 'utf8' : 'latin1');
    if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => part === '..' || part === '.')) {
      throw new Error(`Unsafe archive path: ${path}`);
    }
    if (entries.has(path)) throw new Error(`Duplicate archive path: ${path}`);
    if (!path.endsWith('/')) {
      const source = path === 'manifest.json' || /\.(js|mjs|cjs|html|htm)$/i.test(path);
      const limit = source ? MAX_SOURCE_BYTES : MAX_ASSET_BYTES;
      if (size > limit) throw new Error(`Archive entry exceeds ${source ? 5 : 25} MiB: ${path}`);
      total += size;
      if (total > MAX_TOTAL_BYTES) throw new Error('Archive expands beyond 100 MiB');
      entries.set(path, size);
    }
    pos = next;
  }
  if (pos !== centralStart + centralBytes) throw new Error('Invalid ZIP central directory size');
  return entries;
}

export async function openArchive(filePath: string): Promise<Archive> {
  const bytes = await readArchiveBytes(filePath);
  const sizes = preflight(bytes);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  } catch (error) {
    throw new Error(`Invalid ZIP: ${error instanceof Error ? error.message : String(error)}`);
  }
  const entries: ArchiveEntry[] = [];
  for (const [path, size] of sizes) {
    const file = zip.file(path);
    if (!file) throw new Error(`Invalid ZIP entry: ${path}`);
    entries.push({ path, bytes: size, readText: () => file.async('string') });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { bytes, entries };
}
