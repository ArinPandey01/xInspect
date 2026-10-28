import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';

await mkdir('examples/packages', { recursive: true });
for (const name of ['safe-observer', 'synthetic-risk']) {
  const zip = new JSZip();
  for (const file of ['manifest.json', 'content.js']) zip.file(file, await readFile(join('examples', name, file)));
  await writeFile(join('examples/packages', `${name}.xpi`), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`Created examples/packages/${name}.xpi`);
}
