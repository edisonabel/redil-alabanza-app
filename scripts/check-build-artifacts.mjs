import { readdir } from 'node:fs/promises';
import path from 'node:path';

const roots = ['dist', path.join('.netlify', 'v1', 'functions')];
const conflictCopyPattern = /(?:^|\s)(?:conflicted copy|[2-9]|[1-9]\d+)\.[^/]+$/i;
const invalidFiles = [];
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
    if (entry.name === '.DS_Store' || conflictCopyPattern.test(entry.name)) {
      invalidFiles.push(filePath);
    }
  }
};

for (const root of roots) {
  await walk(root);
}

if (invalidFiles.length > 0) {
  console.error('Build rechazado: se encontraron artefactos locales o copias de conflicto:');
  for (const filePath of invalidFiles) console.error(`- ${filePath}`);
  process.exitCode = 1;
} else {
  console.log(`build artifact hygiene: ok (${checkedFiles} archivos revisados)`);
}
