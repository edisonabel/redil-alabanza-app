// Importación masiva de ChordPro desde capturas y PDF. Corre en la Mac (usa Vision/PDFKit de macOS).
// Prioriza exactitud: lectura completa + relectura de cada línea + posición verificada en la imagen.
//
//   npm run chordpro:importar -- "<carpeta>" [--preciso] [--modelo gpt-5.4] [--razonamiento low] [--solo "texto"]
//                                            [--presupuesto 150000] [--relectura-total] [--sin-relectura] [--forzar]
// Cuida los tokens: guarda cada lectura en caché (repetir una imagen no cuesta nada), solo relee las líneas
// que la imagen no confirma y no empieza canciones nuevas al pasar el presupuesto.
//
// <carpeta>: una imagen o PDF por canción, o una subcarpeta por canción con varias capturas en orden.
// Resultado en <carpeta>/_alabanza: borradores.json (para Administración → Importar ChordPro), .cho e informe.md.
// No escribe en la base de datos: solo lee el catálogo para emparejar y omitir lo que ya tiene ChordPro.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasChordPro, matchSongTitle, textSimilarity, titleCandidates } from '../src/utils/chordProImport.js';
import { createChordProReader } from '../src/lib/server/chordproFromImages.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = /\.(png|jpe?g|webp|heic|tiff?)$/i;
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(name);
const folder = resolve(argv.find((arg, i) => !arg.startsWith('--') && !argv[i - 1]?.startsWith('--')) || '');
const MODE = flag('--preciso') ? 'preciso' : 'normal';
const MODEL = option('--modelo', MODE === 'preciso' ? 'gpt-5.5' : 'gpt-5.4');
const EFFORT = option('--razonamiento', MODE === 'preciso' ? 'medium' : 'low');
const ONLY = option('--solo', '');
const REREAD_ALL = flag('--relectura-total');
const REREAD = !flag('--sin-relectura');
const BUDGET = Number(option('--presupuesto', 150000));
if (!folder || !existsSync(folder) || !statSync(folder).isDirectory()) {
  console.error('Uso: npm run chordpro:importar -- "<carpeta con capturas o PDF>"'); process.exit(1);
}

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .map((line) => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value.trim().replace(/^['"]|['"]$/g, '')]));
const SUPABASE_URL = (env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
if (!env.OPENAI_API_KEY) { console.error('Falta OPENAI_API_KEY en .env'); process.exit(1); }
const OUT = join(folder, '_alabanza'); mkdirSync(OUT, { recursive: true });
const WORK = join(ROOT, '.lab', 'chordpro-import');
const reader = createChordProReader({ root: ROOT, openaiKey: env.OPENAI_API_KEY, mode: MODE, model: MODEL, effort: EFFORT, lineEffort: option('--razonamiento-linea', undefined) });
const usage = reader.usage;

async function loadCatalog() {
  if (!SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.warn('Sin credenciales de Supabase: no se puede omitir lo que ya tiene ChordPro.'); return []; }
  const songs = [];
  for (let from = 0; ; from += 1000) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/canciones?select=id,titulo,chordpro,repertorio&order=titulo`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Range: `${from}-${from + 999}` },
    });
    if (!response.ok) throw new Error(`No pude leer el catálogo (${response.status}).`);
    const page = await response.json(); songs.push(...page);
    if (page.length < 1000) break;
  }
  return songs;
}

async function processSong(song, catalog) {
  const dir = join(WORK, 'canciones', song.id);
  const report = { name: song.name, files: song.files.map((f) => basename(f)), status: 'listo', review: [], notes: '' };
  let match = matchSongTitle(song.name, catalog);
  const skip = (found) => ({ ...report, match: { id: found.id, titulo: found.titulo }, status: 'omitida', notes: 'Ya tiene ChordPro: no se transcribe.' });
  if (match.song && hasChordPro(match.song.chordpro) && !flag('--forzar')) return skip(match.song);
  const pages = reader.preparePages(song.files, dir);
  if (!match.song && catalog.length) {
    // El título casi siempre está en la imagen: se busca con el OCR local, sin gastar tokens.
    // Solo texto grande arriba (nunca una línea de la letra), y siempre queda para que la persona lo confirme.
    for (const line of titleCandidates(pages[0])) {
      const candidate = matchSongTitle(line.text, catalog);
      if (candidate.song && candidate.score > match.score) { match = candidate; match.fromImage = line.text; }
    }
  }
  report.match = match.song ? { id: match.song.id, titulo: match.song.titulo } : null;
  report.candidates = match.candidates.map(({ song: s, score }) => ({ id: s.id, titulo: s.titulo, score: Number(score.toFixed(2)) }));
  if (match.song && hasChordPro(match.song.chordpro) && !flag('--forzar')) return skip(match.song);
  if (!match.song) report.status = 'sin-coincidencia';
  else if (match.fromImage) report.review.push({ reason: `Canción elegida por el título de la imagen («${match.fromImage}»): confirma que es «${match.song.titulo}».` });
  const result = await reader.transcribe(pages, dir, { title: match.song?.titulo || '', reread: REREAD, rereadAll: REREAD_ALL });
  return { ...report, ...result, review: [...report.review, ...result.review],
    images: pages.map((page, i) => reader.thumbnail(page, join(dir, `vista-${i}.jpg`))) };
}

// ---------- carpeta ----------
const natural = (a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
const songs = [];
for (const entry of readdirSync(folder).sort(natural)) {
  if (entry.startsWith('.') || entry === '_alabanza') continue;
  const path = join(folder, entry);
  if (statSync(path).isDirectory()) {
    const files = readdirSync(path).filter((f) => IMAGE.test(f) || /\.pdf$/i.test(f)).sort(natural).map((f) => join(path, f));
    if (files.length) songs.push({ name: entry, files });
  } else if (IMAGE.test(entry) || /\.pdf$/i.test(entry)) songs.push({ name: basename(entry, extname(entry)), files: [path] });
}
const selected = ONLY ? songs.filter((song) => textSimilarity(song.name, ONLY) > 0.6 || song.name.toLowerCase().includes(ONLY.toLowerCase())) : songs;
selected.forEach((song, i) => { song.id = `${String(i + 1).padStart(3, '0')}-${song.name.replace(/[^\w-]+/g, '_').slice(0, 40)}`; });
console.log(`Modelo ${MODEL} (razonamiento ${EFFORT}; relectura ${REREAD_ALL ? 'de todas las líneas' : REREAD ? 'solo de líneas dudosas' : 'desactivada'}) · ${selected.length} canciones · presupuesto ${BUDGET} tokens`);

const catalog = await loadCatalog();
const results = [];
const spent = () => usage.input + usage.output;
for (const [i, song] of selected.entries()) {
  if (spent() >= BUDGET) {
    console.log(`Presupuesto alcanzado (${spent()} tokens): quedan ${selected.length - i} canciones sin procesar. Sube --presupuesto para continuar; lo ya leído no se vuelve a pagar.`);
    break;
  }
  process.stdout.write(`[${i + 1}/${selected.length}] ${song.name}… `);
  try {
    const result = await processSong(song, catalog);
    results.push(result);
    if (result.chordpro) writeFileSync(join(OUT, `${song.id}.cho`), result.chordpro);
    console.log(result.status === 'omitida' ? 'omitida (ya tiene ChordPro)'
      : `${result.stats.verified}/${result.stats.lines} líneas verificadas · ${result.review.length} por revisar · ${result.usage.input + result.usage.output} tokens${result.match ? '' : ' · sin coincidencia en el catálogo'}`);
  } catch (error) {
    results.push({ name: song.name, files: song.files.map((f) => basename(f)), status: 'error', notes: error.message, review: [] });
    console.log(`error: ${error.message}`);
  }
  writeFileSync(join(OUT, 'borradores.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), model: MODEL, effort: EFFORT, songs: results }));
}
const summary = [
  '# Importación de ChordPro', '', `Modelo: ${MODEL} · razonamiento ${EFFORT} · relectura ${REREAD_ALL ? 'de todas las líneas' : REREAD ? 'solo de líneas dudosas' : 'desactivada'}`,
  `Tokens: ${usage.input} de entrada, ${usage.output} de salida (${usage.reasoning} de razonamiento) en ${usage.calls} llamadas pagadas; ${usage.cached} respuestas salieron de la caché sin costo.`, '',
  '| Canción | Estado | Catálogo | Líneas verificadas | Por revisar |', '|---|---|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.status} | ${r.match?.titulo || '—'} | ${r.stats ? `${r.stats.verified}/${r.stats.lines}` : '—'} | ${r.review.length} |`),
  '', 'Revisa y aprueba en Administración → Importar ChordPro, cargando `borradores.json`.',
];
writeFileSync(join(OUT, 'informe.md'), `${summary.join('\n')}\n`);
console.log(`\nListo: ${join(OUT, 'borradores.json')}\n${summary[3]}`);
