// Motor de lectura de ChordPro desde imágenes (capturas o PDF). Solo en macOS: usa Vision y PDFKit
// mediante scripts/chordpro-import/alabanza-imagen.swift. El modelo lee QUÉ acordes y QUÉ letra hay;
// la imagen dice DÓNDE va cada acorde. Lo usan el panel de Administración y la herramienta de terminal.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  buildChordPro, buildOcrRows, chordBand, chordOnlyLine, findLyricRow, inkGroups, lyricContent,
  normalizeChordToken, placeChords, textSimilarity,
} from '../../utils/chordProImport.js';

const SHEET_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'artist', 'key', 'tempo', 'time', 'notes', 'sections'],
  properties: {
    title: { type: 'string' }, artist: { type: 'string' }, key: { type: 'string' }, tempo: { type: 'string' }, time: { type: 'string' }, notes: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'inferred', 'repeat', 'lines'], properties: {
      name: { type: 'string' }, inferred: { type: 'boolean' }, repeat: { type: 'boolean' },
      lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['chords', 'lyric'], properties: {
        chords: { type: 'array', items: { type: 'string' } }, lyric: { type: 'string' },
      } } },
    } } },
  },
};
// Solo en la relectura de una línea dudosa se pide la ubicación ("inline"), por si la imagen no la confirma.
const LINE_SCHEMA = { type: 'object', additionalProperties: false, required: ['chords', 'lyric', 'inline'],
  properties: { chords: { type: 'array', items: { type: 'string' } }, lyric: { type: 'string' }, inline: { type: 'string' } } };

const SHEET_PROMPT = `Transcribe esta hoja de acordes de una canción de alabanza, con exactitud total. Las imágenes son partes consecutivas de la misma canción y pueden solaparse: no dupliques líneas.
Para cada línea de letra devuelve:
- "chords": los acordes escritos ENCIMA de esa línea, de izquierda a derecha, exactamente como están (C#m, E/G#, Bb, F#m7, Dsus4…). Una "m" pequeña o en superíndice (Dᵐ) es "m". No inventes ni omitas acordes.
- "lyric": la letra exacta (tildes, signos, mayúsculas). No la corrijas.
Líneas de solo acordes (intro, puente instrumental): "lyric" vacío y los acordes en "chords"; conserva "|" como acorde "|".
Secciones: usa el nombre que muestra la hoja (Intro, Verso 1, Pre-coro, Coro, Puente, Interludio, Instrumental, Final, Outro…). «Estribillo» o «Chorus» es Coro. Si la hoja NO nombra una parte, ponle el nombre más probable y marca "inferred": true.
«REPITEN CORO», «Coro x2» y similares: una sección con ese nombre, "repeat": true y sin líneas.
Metadatos solo si se ven (tono, tempo/BPM, compás); si no, cadena vacía.
Ignora menús, diagramas de acordes, videos, canciones relacionadas, anuncios y pies de página.`;
const LINE_PROMPT = `La imagen es UNA línea de una hoja de acordes: acordes arriba, letra abajo (puede verse un poco de las líneas vecinas: ignóralas).
Devuelve "chords" con los acordes escritos encima de la letra principal, de izquierda a derecha, exactamente como están, "lyric" con esa letra exacta e "inline" con la línea en ChordPro, cada acorde justo antes de la sílaba sobre la que está ("[C#m]Cuando al mo[E]rir"). Una "m" en superíndice es "m". Usa el cifrado tal como aparece (A, B, C…); no lo traduzcas a Do, Re, Mi. No inventes ni omitas acordes.`;

export const isChordProReaderAvailable = () => process.platform === 'darwin';

/**
 * Crea el lector. `ask` se puede sustituir (pruebas sin gastar tokens).
 * Cada respuesta del modelo queda en caché: la misma imagen no se paga dos veces.
 */
/** Ajustes: «normal» es barato (lo confirma la imagen); «preciso» usa el modelo fuerte solo cuando la persona lo pide. */
export const CHORDPRO_READING_MODES = {
  normal: { model: 'gpt-5.4', effort: 'low', lineEffort: 'low', tieEffort: 'medium' },
  preciso: { model: 'gpt-5.5', effort: 'medium', lineEffort: 'medium', tieEffort: 'high' },
};

export function createChordProReader({ root, openaiKey, mode = 'normal', model, effort, lineEffort, tieEffort, ask: askOverride, cacheOnly = false } = {}) {
  const preset = CHORDPRO_READING_MODES[mode] || CHORDPRO_READING_MODES.normal;
  model ||= preset.model; effort ||= preset.effort; lineEffort ||= preset.lineEffort; tieEffort ||= preset.tieEffort;
  const work = join(root, '.lab', 'chordpro-import');
  const cacheDir = join(work, 'cache');
  mkdirSync(cacheDir, { recursive: true });
  const toolPath = join(work, 'alabanza-imagen'), toolSource = join(root, 'scripts/chordpro-import/alabanza-imagen.swift');
  const ensureTool = () => {
    if (!existsSync(toolPath) || statSync(toolPath).mtimeMs < statSync(toolSource).mtimeMs) {
      execFileSync('swiftc', ['-O', toolSource, '-o', toolPath], { stdio: 'ignore' });
    }
  };
  const tool = (...args) => { ensureTool(); return execFileSync(toolPath, args.map(String), { maxBuffer: 256 << 20 }); };
  const usage = { input: 0, output: 0, reasoning: 0, calls: 0, cached: 0 };

  async function ask(prompt, imagePaths, schema, level) {
    const content = [{ type: 'input_text', text: prompt }];
    for (const path of imagePaths) content.push({ type: 'input_image', detail: 'high', image_url: `data:image/png;base64,${readFileSync(path).toString('base64')}` });
    // Las respuestas simuladas (pruebas) nunca entran ni salen de la caché real.
    if (askOverride) return askOverride({ prompt, imagePaths, schema, effort: level, kind: schema === SHEET_SCHEMA ? 'sheet' : 'line' });
    const key = createHash('sha256').update(JSON.stringify([model, level, schema, content])).digest('hex');
    const cached = join(cacheDir, `${key}.json`);
    if (existsSync(cached)) { usage.cached += 1; return JSON.parse(readFileSync(cached, 'utf8')); }
    // Modo «solo caché»: reproduce una corrida anterior sin llamar nunca a OpenAI (diagnóstico sin gastar).
    if (cacheOnly) {
      if (schema === SHEET_SCHEMA) throw new Error('Sin lectura en caché para estas imágenes (modo solo caché).');
      return { chords: [], lyric: '', inline: '' };
    }
    const remember = (result) => { writeFileSync(cached, JSON.stringify(result)); return result; };
    if (!openaiKey) throw Object.assign(new Error('Falta OPENAI_API_KEY en el servidor.'), { status: 500 });
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: [{ role: 'user', content }], reasoning: { effort: level }, max_output_tokens: 32000,
            text: { format: { type: 'json_schema', name: 'lectura', schema, strict: true } } }),
        });
      } catch (error) {
        // Cortes de red: se reintenta igual que un error del servidor.
        if (attempt >= 4) throw new Error(`Sin conexión con OpenAI (${error.message}).`);
        await new Promise((done) => setTimeout(done, 3000 * attempt));
        continue;
      }
      const body = await response.json().catch(() => ({}));
      if (body.usage) { usage.input += body.usage.input_tokens; usage.output += body.usage.output_tokens; usage.reasoning += body.usage.output_tokens_details?.reasoning_tokens || 0; usage.calls += 1; }
      const text = body.output?.find((item) => item.type === 'message')?.content?.find((part) => part.type === 'output_text')?.text;
      if (response.ok && body.status === 'completed' && text) return remember(JSON.parse(text));
      // Reintenta límites, errores del servidor y falsos positivos del filtro de contenido.
      const retry = [429, 500, 502, 503].includes(response.status) || body.incomplete_details?.reason === 'content_filter';
      if (!retry || attempt >= 4) throw new Error(`OpenAI ${response.status} ${body.error?.message || body.incomplete_details?.reason || body.status}`);
      await new Promise((done) => setTimeout(done, 2000 * attempt));
    }
  }
  async function pool(items, limit, fn) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
  }

  /** Imágenes listas para medir: PDF a páginas, capturas ampliadas, OCR con posiciones y píxeles. */
  function preparePages(files, dir) {
    mkdirSync(dir, { recursive: true });
    const pages = [];
    for (const file of files) {
      if (/\.pdf$/i.test(file)) {
        const prefix = join(dir, `${pages.length}-${basename(file, extname(file)).replace(/[^\w-]+/g, '_')}`);
        const count = Number(String(tool('pdf', file, prefix, 2600)).trim());
        for (let p = 1; p <= count; p += 1) pages.push(`${prefix}-p${p}.png`);
      } else {
        const out = join(dir, `${pages.length}-pagina.png`);
        tool('prepare', file, out, 2400); pages.push(out);
      }
    }
    return pages.map((path, i) => {
      const ocr = JSON.parse(String(tool('ocr', path)));
      const raw = join(dir, `${i}.raw`); tool('gray', path, raw);
      return { path, ...ocr, pixels: readFileSync(raw) };
    });
  }
  // Capturas de página completa muy altas: en trozos solapados para que el modelo vea la letra pequeña.
  function readingImages(pages, dir) {
    const images = [];
    pages.forEach((page, p) => {
      if (page.height <= page.width * 1.6) { images.push(page.path); return; }
      const tile = Math.round(page.width * 1.25), step = Math.round(tile - page.width * 0.12);
      for (let y = 0, k = 0; y < page.height; y += step, k += 1) {
        const out = join(dir, `tile-${p}-${k}.png`);
        tool('crop', page.path, 0, y, page.width, Math.min(tile, page.height - y), 1, out); images.push(out);
        if (y + tile >= page.height) break;
      }
    });
    return images;
  }

  /**
   * Lee una canción. `pages` viene de preparePages. Devuelve el ChordPro, lo que hay que revisar y el gasto.
   * Solo relee las líneas que la imagen no confirma (rereadAll relee todas: más exacto y más caro).
   */
  async function transcribe(pages, dir, { title = '', reread = true, rereadAll = false } = {}) {
    const before = { ...usage };
    const review = [];
    const sheet = await ask(SHEET_PROMPT, readingImages(pages, dir), SHEET_SCHEMA, effort);
    const rows = buildOcrRows(pages);
    let cursor = 0;
    const used = new Set();
    const lineJobs = [];
    const inferred = [...new Set(sheet.sections.filter((section) => section.inferred).map((section) => section.name))];
    if (inferred.length) review.push({ reason: `La hoja no nombra estas secciones; revisa los nombres deducidos: ${inferred.join(', ')}.` });
    for (const section of sheet.sections) {
      for (const line of section.lines) {
        line.chords = line.chords.map(normalizeChordToken).filter(Boolean);
        if (!line.lyric.trim()) { line.text = chordOnlyLine(line.chords); continue; }
        if (!line.chords.some((chord) => chord !== '|')) { line.text = line.lyric; continue; }
        // Si la imagen no lo confirma ni hay relectura, los acordes quedan al inicio y la línea se marca para revisar.
        line.text = `${line.chords.filter((chord) => chord !== '|').map((chord) => `[${chord}]`).join('')}${line.lyric}`;
        // Primero hacia adelante; si no, en cualquier fila aún libre (páginas a dos columnas: la
        // columna derecha está «arriba» de donde terminó la izquierda).
        const found = findLyricRow(rows, line.lyric, cursor, 40, used) || findLyricRow(rows, line.lyric, 0, rows.length, used);
        if (!found) { line.problem = 'No encontré esta letra en la imagen: posición sin verificar.'; continue; }
        used.add(found.index);
        cursor = found.index + 1;
        const row = rows[found.index], page = pages[row.page];
        const content = lyricContent(row, line.lyric);
        const band = chordBand(page, content);
        line.geometry = { page, content, band, groups: inkGroups(page, band) };
        lineJobs.push(line);
      }
    }
    await pool(lineJobs, 4, async (line, i) => {
      const { page, content, band, groups } = line.geometry;
      const playable = (list) => list.filter((c) => c !== '|').length;
      const rereadLine = async (scale, level, name) => {
        const bottom = Math.max(...content.map((item) => item.bottom));
        const crop = join(dir, `${name}-${i}.png`);
        const width = band.right - band.left, factor = Math.min(scale, 3600 / Math.max(1, width));
        tool('crop', page.path, band.left, band.top - band.height * 0.25, width, bottom - band.top + band.height * 0.4, factor, crop);
        const result = await ask(LINE_PROMPT, [crop], LINE_SCHEMA, level);
        // Una relectura que no ve la línea completa (recorte parcial) no vota.
        if (textSimilarity(result.lyric, line.lyric) < 0.85) return null;
        if (result.inline && !line.estimate) line.estimate = result.inline;
        return result.chords.map(normalizeChordToken).filter(Boolean);
      };
      let chords = line.chords;
      const confirmed = !rereadAll && placeChords({ lyric: line.lyric, chords, content, groups });
      if (reread && !confirmed) {
        const reads = [chords];
        const second = await rereadLine(3, lineEffort, 'linea');
        if (second) reads.push(second);
        if (second && second.join(' ') !== chords.join(' ')) {
          // Desempate: tercera lectura con más zoom y más razonamiento; gana la mayoría.
          const third = await rereadLine(4, tieEffort, 'desempate');
          if (third) reads.push(third);
        }
        const votes = new Map();
        for (const read of reads) votes.set(read.join(' '), (votes.get(read.join(' ')) || 0) + 1);
        const fits = (key) => groups.length > 0 && playable(key.split(' ').filter(Boolean)) === groups.length;
        const [best, count] = [...votes].sort((a, b) => b[1] - a[1] || Number(fits(b[0])) - Number(fits(a[0])))[0];
        // Una medición de 0 acordes nunca sustituye una lectura con acordes (suele ser un recorte fallido).
        const winner = best.split(' ').filter(Boolean);
        if (count >= 2 && (playable(winner) > 0 || playable(chords) === 0)) chords = winner;
        else if (votes.size > 1) line.problem = `Las lecturas no coinciden (${[...votes.keys()].join(' / ')}).`;
      }
      const placed = placeChords({ lyric: line.lyric, chords, content, groups });
      if (placed) line.text = placed;
      else if (line.estimate) line.text = line.estimate;
      if (!placed) line.problem ||= `Posición sin verificar: la imagen muestra ${groups.length} acordes y la lectura ${playable(chords)}.`;
    });
    const chordpro = buildChordPro({ title: title || sheet.title, artist: sheet.artist, key: sheet.key,
      tempo: sheet.tempo.replace(/[^\d.]/g, ''), time: sheet.time, sections: sheet.sections });
    const lines = chordpro.split('\n');
    for (const section of sheet.sections) for (const line of section.lines) {
      if (!line.problem) continue;
      review.push({ line: lines.indexOf(line.text) + 1 || null, text: line.text, reason: line.problem });
    }
    return {
      chordpro, review, title: sheet.title, notes: sheet.notes, mode, model,
      stats: { lines: lineJobs.length, verified: lineJobs.filter((line) => !line.problem).length },
      usage: { input: usage.input - before.input, output: usage.output - before.output, calls: usage.calls - before.calls, cached: usage.cached - before.cached },
    };
  }

  const thumbnail = (page, out) => { tool('thumb', page.path, 1100, out); return `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`; };
  return { preparePages, transcribe, thumbnail, usage };
}
