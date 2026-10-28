import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderHtml } from '../dist/src/report.js';
import { renderObservation } from '../dist/src/dynamic/report.js';

async function refresh(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += await refresh(path);
    else if (entry.name === 'report.json') {
      const report = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(join(directory, 'report.html'), renderHtml(report));
      count++;
    } else if (entry.name === 'observation.json') {
      const report = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(join(directory, 'observation.html'), renderObservation(report));
      count++;
    }
  }
  return count;
}

const root = resolve(process.argv[2] ?? 'reports');
console.log(`Refreshed ${await refresh(root)} HTML reports in ${root}`);
