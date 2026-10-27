// Regenerates the section list inside the REAPER helper from the guide manifest.
// Usage: node scripts/generate-reaper-section-catalog.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

const HELPER = 'public/downloads/Alabanza-Asistente.lua';
const bundle = buildSync({ entryPoints: ['src/utils/guideSectionCatalog.ts'], bundle: true, write: false, platform: 'node', format: 'iife', globalName: 'Catalog' });
const scope = {}; vm.runInNewContext(bundle.outputFiles[0].text, scope);
const { buildGuideSectionCatalog, renderReaperSectionCatalogLua, replaceReaperSectionCatalog } = scope.Catalog;

const manifest = JSON.parse(await readFile('public/audio/guide-es/manifest.json', 'utf8'));
const source = await readFile(HELPER, 'utf8');
const next = replaceReaperSectionCatalog(source, renderReaperSectionCatalogLua(buildGuideSectionCatalog(manifest)));
if (process.argv.includes('--check')) {
  if (next !== source) { console.error(`${HELPER} no coincide con el manifiesto de voces. Ejecuta npm run reaper:sections.`); process.exit(1); }
  console.log('REAPER helper section list matches the guide manifest.');
} else if (next !== source) {
  await writeFile(HELPER, next);
  console.log(`Updated ${HELPER}.`);
} else console.log(`${HELPER} already up to date.`);
