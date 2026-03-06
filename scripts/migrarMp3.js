#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1Fk4DgxWzizonrG_xB_DZN8wSqLSZY9myj7ROM7JLu-c/export?format=csv';

const args = new Set(process.argv.slice(2));
const overwrite = args.has('--overwrite');
const dryRun = args.has('--dry-run');

const normalizeToken = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const parseCsv = (input) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);
  return rows;
};

const loadSheetRows = async () => {
  const response = await fetch(SHEET_CSV_URL, { headers: { Accept: 'text/csv' } });
  if (!response.ok) {
    throw new Error(`No se pudo descargar Sheet CSV. HTTP ${response.status}`);
  }

  const csvText = await response.text();
  const rows = parseCsv(csvText);
  if (!rows.length) return [];

  let headerRowIndex = -1;
  let songCol = -1;
  let mp3Col = -1;

  for (let i = 0; i < rows.length; i += 1) {
    const normalized = rows[i].map((cell) => normalizeToken(cell));
    const sIndex = normalized.findIndex((cell) => cell === 'cancion' || cell.includes('cancion'));
    const mIndex = normalized.findIndex((cell) => cell === 'mp3');
    if (sIndex !== -1 && mIndex !== -1) {
      headerRowIndex = i;
      songCol = sIndex;
      mp3Col = mIndex;
      break;
    }
  }

  if (headerRowIndex === -1 || songCol === -1 || mp3Col === -1) {
    throw new Error('No se encontraron columnas "Cancion" y "MP3" en el Sheet.');
  }

  const out = [];
  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const title = (row[songCol] || '').trim();
    const mp3 = (row[mp3Col] || '').trim();
    if (!title || !mp3) continue;

    const mp3Norm = normalizeToken(mp3);
    if (mp3Norm === 'no esta') continue;

    out.push({ title, mp3 });
  }
  return out;
};

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Faltan variables de entorno para Supabase.');
  console.error('Requeridas: SUPABASE_URL/PUBLIC_SUPABASE_URL (o VITE_SUPABASE_URL) y una key valida.');
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Aviso: no se detecto SUPABASE_SERVICE_ROLE_KEY; se usara otra key disponible.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const main = async () => {
  console.log('Iniciando migracion one-shot de MP3...');
  console.log(`Modo: ${dryRun ? 'DRY-RUN' : 'UPDATE'}${overwrite ? ' + OVERWRITE' : ''}`);

  const sheetRows = await loadSheetRows();
  console.log(`Filas validas en Sheet: ${sheetRows.length}`);

  const mp3ByTitleNorm = new Map();
  for (const row of sheetRows) {
    const key = normalizeToken(row.title);
    if (!key || mp3ByTitleNorm.has(key)) continue;
    mp3ByTitleNorm.set(key, row.mp3);
  }

  const { data: cancionesDb, error: dbError } = await supabase
    .from('canciones')
    .select('id, titulo, mp3');

  if (dbError) {
    if (String(dbError.message || '').includes('column canciones.mp3 does not exist')) {
      throw new Error(
        'La columna public.canciones.mp3 no existe. Ejecuta primero: ' +
          'ALTER TABLE public.canciones ADD COLUMN IF NOT EXISTS mp3 text;'
      );
    }
    throw new Error(`Error leyendo canciones de Supabase: ${dbError.message}`);
  }

  const dbByTitleNorm = new Map();
  for (const song of cancionesDb || []) {
    const key = normalizeToken(song.titulo);
    if (!key) continue;
    if (!dbByTitleNorm.has(key)) dbByTitleNorm.set(key, []);
    dbByTitleNorm.get(key).push(song);
  }

  let updated = 0;
  let skippedExisting = 0;
  let skippedMissing = 0;
  let skippedSame = 0;
  let errors = 0;
  const missingTitles = [];

  for (const [titleNorm, mp3Value] of mp3ByTitleNorm.entries()) {
    const candidates = dbByTitleNorm.get(titleNorm) || [];
    if (!candidates.length) {
      skippedMissing += 1;
      missingTitles.push(titleNorm);
      continue;
    }

    const target = candidates[0];
    const currentMp3 = String(target.mp3 || '').trim();

    if (!overwrite && currentMp3) {
      skippedExisting += 1;
      continue;
    }

    if (currentMp3 === mp3Value) {
      skippedSame += 1;
      continue;
    }

    if (dryRun) {
      updated += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from('canciones')
      .update({ mp3: mp3Value })
      .eq('id', target.id);

    if (updateError) {
      errors += 1;
      console.error(`Error actualizando "${target.titulo}" (${target.id}): ${updateError.message}`);
      continue;
    }

    updated += 1;
  }

  console.log('----------------------------------------');
  console.log(`Actualizadas: ${updated}`);
  console.log(`Saltadas (ya tenian mp3): ${skippedExisting}`);
  console.log(`Saltadas (mp3 identico): ${skippedSame}`);
  console.log(`Sin match en DB: ${skippedMissing}`);
  console.log(`Errores: ${errors}`);

  if (missingTitles.length) {
    console.log('Ejemplos sin match (normalizados):');
    missingTitles.slice(0, 10).forEach((title) => console.log(` - ${title}`));
  }

  console.log('Migracion finalizada.');
};

main().catch((error) => {
  console.error('Migracion fallo:', error.message || error);
  process.exit(1);
});
