import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

const roots = ['dist', path.join('.netlify', 'v1', 'functions')];
const conflictCopyPattern = /(?:^|\s)(?:conflicted copy|[2-9]|[1-9]\d+)\.[^/]+$/i;
const invalidFiles = [];
const missingAssets = [];
let checkedFiles = 0;

const walk = async (directory) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(filePath);
      continue;
    }

    checkedFiles += 1;
    if (directory.startsWith(path.join('dist', '_astro')) && entry.name.endsWith('.js')) {
      const source = await readFile(filePath, 'utf8');
      for (const match of source.matchAll(/["']\/?(_astro\/[^"'?\s]+\.(?:js|css))["']/g)) {
        try { await access(path.join('dist', match[1])); }
        catch { missingAssets.push(`${filePath} -> ${match[1]}`); }
      }
    }
    // These short filenames are intentional spoken count-in samples, not
    // Finder conflict copies such as `worker 2.js`. Keep the exception scoped.
    const isGuideCount = /^dist\/audio\/guide-es\/[1-8]\.wav$/.test(filePath.replaceAll(path.sep, '/'));
    if (entry.name === '.DS_Store' || (conflictCopyPattern.test(entry.name) && !isGuideCount)) {
      invalidFiles.push(filePath);
    }
  }
};

for (const root of roots) {
  await walk(root);
}

if (missingAssets.length > 0) {
  console.error('Build rechazado: hay dependencias de CSS/JS que no fueron emitidas:');
  for (const reference of [...new Set(missingAssets)]) console.error(`- ${reference}`);
  process.exitCode = 1;
}

if (invalidFiles.length > 0) {
  console.error('Build rechazado: se encontraron artefactos locales o copias de conflicto:');
  for (const filePath of invalidFiles) console.error(`- ${filePath}`);
  process.exitCode = 1;
} else if (missingAssets.length === 0) {
  console.log(`build artifact hygiene: ok (${checkedFiles} archivos revisados)`);
}
