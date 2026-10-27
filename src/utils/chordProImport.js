// Importación masiva de ChordPro desde imágenes (capturas o páginas de PDF).
// El modelo lee QUÉ acordes y QUÉ letra hay; la imagen dice DÓNDE va cada acorde.
// Lógica pura: la usan la herramienta de la Mac (scripts/chordpro-import.mjs) y el panel de Administración.

export const CHORD_TOKEN = /^(?:[A-G](?:#|b)?(?:m|min|maj|M|dim|aug|sus|add|°|ø|\+)?\d{0,2}(?:(?:sus|add|maj|b|#)\d{1,2})*(?:\([^)]*\))?(?:\/[A-G](?:#|b)?)?|\|)$/;
export const normalizeChordToken = (token = '') => String(token).trim().replace(/ᵐ|™/g, 'm').replace(/♯/g, '#').replace(/♭/g, 'b');
export const isChordRowText = (text = '') => {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean).map(normalizeChordToken);
  return tokens.length > 0 && tokens.every((token) => CHORD_TOKEN.test(token)) && tokens.some((token) => token !== '|');
};

/** Fila que parece de acordes aunque el OCR la haya leído mal («AD» por «A D», «FAm» por «F#m»). */
export const isChordishText = (text = '') => {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => /^[A-G][A-Ga-g#b♯♭mMajsudi0-9/()+°øᵐ]{0,7}$|^\|$/.test(token));
};

/** Texto con palabras de verdad (no acordes mal leídos como «Fr» o «F С» con С cirílica). */
export const isLyricLikeText = (raw = '') => {
  // Anotaciones entre paréntesis en la línea de acordes («(Intro)», «(Final)», «(x2)») no son letra.
  const text = String(raw).replace(/\([^)]*\)/g, ' ').trim();
  return Boolean(text) && !isChordishText(text) && text.split(/\s+/).some((word) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ¿¡,.;:'"!?()-]{3,}$/.test(word) && !isChordishText(word.replace(/[^\p{L}\d#/]/gu, '')));
};

export const foldText = (value = '') => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9ñ]+/g, ' ').trim();

// Bigramas de letras: tolera erratas del OCR («suiro» por «sufrió»).
const bigrams = (value) => {
  const text = foldText(value).replace(/ /g, '');
  const counts = new Map();
  for (let i = 0; i < text.length - 1; i += 1) counts.set(text.slice(i, i + 2), (counts.get(text.slice(i, i + 2)) || 0) + 1);
  return counts;
};
export const textSimilarity = (a, b) => {
  const left = bigrams(a), right = bigrams(b);
  let common = 0, total = 0;
  for (const [key, count] of left) { common += Math.min(count, right.get(key) || 0); total += count; }
  for (const count of right.values()) total += count;
  return total ? (2 * common) / total : 0;
};

/** Una canción «ya tiene ChordPro» si queda algo más que directivas {…}. Esas no se transcriben. */
export const hasChordPro = (raw = '') => String(raw || '').split(/\r?\n/)
  .some((line) => line.trim() && !/^\{[^{}]*\}$/.test(line.trim()));

/** Líneas del OCR que pueden ser el título: texto grande en la parte de arriba de la primera imagen. */
export function titleCandidates(page) {
  const heights = page.lines.map((line) => line.bottom - line.top).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 0;
  return page.lines.filter((line) => line.top < page.height * 0.35 && line.bottom - line.top >= median * 1.25 && line.text.length <= 60);
}

/** Empareja un nombre de archivo o un título leído con el catálogo. */
export function matchSongTitle(name = '', songs = []) {
  const wanted = foldText(String(name).replace(/\.(png|jpe?g|webp|heic|pdf)$/i, '').replace(/[_-]+/g, ' ')
    .replace(/\b(guitarra|acordes|chords|cifra|letra|pdf|captura|\(\d+\)|p\d+)\b/gi, ' ')).replace(/\s+/g, ' ').trim();
  if (!wanted) return { song: null, score: 0, candidates: [] };
  const ranked = songs.map((song) => {
    const title = foldText(song.titulo || '');
    const score = title === wanted ? 1 : Math.max(textSimilarity(title, wanted), wanted.includes(title) && title.length > 3 ? 0.9 : 0);
    return { song, score };
  }).sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  // Solo se acepta sola una coincidencia clara; si dos títulos se parecen, decide la persona.
  const clear = best && best.score >= 0.82 && (!second || best.score - second.score >= 0.08);
  return { song: clear ? best.song : null, score: best?.score || 0, candidates: ranked.slice(0, 5).filter((row) => row.score >= 0.5) };
}

// El acorde va al inicio de la sílaba en español: «g|loria» → «|gloria», «at|rás» → «a|trás», «Jesú|s» → «Je|sús».
const VOWEL = /[aeiouáéíóúü]/i;
const ONSET = /^(?:bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|tr|ch|ll|rr)$/i;
const isLetter = (char) => /\p{L}/u.test(char || '');
export function syllableStart(text, index) {
  let i = index;
  let start = i; while (start > 0 && isLetter(text[start - 1])) start -= 1;
  if (i === start || !isLetter(text[i])) return i;
  let end = i; while (end < text.length && isLetter(text[end])) end += 1;
  if (end - start <= 3) return start; // El, en, mi, Tu: una sílaba
  if (!VOWEL.test(text[i]) && !VOWEL.test(text[i + 1] || '')) {
    // Consonante que cierra sílaba: al final de la palabra vuelve a su sílaba; si inicia la siguiente, avanza.
    if (i + 2 < end && VOWEL.test(text[i + 2])) return ONSET.test(text.slice(i, i + 2)) ? i : i + 1;
    i -= 1;
    while (i > start && VOWEL.test(text[i - 1])) i -= 1;
  }
  if (VOWEL.test(text[i]) && i > start && !VOWEL.test(text[i - 1])) i -= 1;
  if (i - 1 >= start && ONSET.test(text.slice(i - 1, i + 1))) i -= 1;
  return i;
}

/** Filas de texto del OCR en orden de lectura, a través de varias imágenes de una misma canción. */
export function buildOcrRows(pages) {
  const rows = [];
  pages.forEach((page, pageIndex) => {
    const sorted = [...page.lines].sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom));
    for (const line of sorted) {
      const row = rows.at(-1);
      const center = (line.top + line.bottom) / 2;
      if (row && row.page === pageIndex && center > row.top && center < row.bottom) row.items.push(line);
      else rows.push({ page: pageIndex, items: [line], top: line.top, bottom: line.bottom });
      const current = rows.at(-1);
      current.top = Math.min(current.top, line.top); current.bottom = Math.max(current.bottom, line.bottom);
    }
  });
  for (const row of rows) { row.items.sort((a, b) => a.x0 - b.x0); row.text = row.items.map((item) => item.text).join(' '); }
  return rows;
}

/** Primera fila (desde `cursor`) que contiene esa letra; un coro repetido no debe saltarse líneas. */
export function findLyricRow(rows, lyric, cursor = 0, window = 40, used = new Set()) {
  let best = -1, score = 0;
  for (let i = cursor; i < Math.min(rows.length, cursor + window); i += 1) {
    if (used.has(i)) continue;
    const s = Math.max(...rows[i].items.map((item) => textSimilarity(item.text, lyric)), textSimilarity(rows[i].text, lyric), textSimilarity(lyricText(rows[i], lyric), lyric));
    if (s > score + 0.05) { score = s; best = i; }
    if (s >= 0.8) break;
  }
  return score >= 0.6 ? { index: best, score } : null;
}

/** Observaciones de la fila que forman la letra (fuera queda lo que esté al lado, como una barra lateral). */
export function lyricContent(row, lyric) {
  const folded = foldText(lyric);
  const anchor = row.items.reduce((a, item) => (textSimilarity(item.text, lyric) > textSimilarity(a.text, lyric) ? item : a));
  // Un hueco grande puede partir la línea en trozos («Y gozo por      la eternidad»): entra cada trozo
  // que sea parte de esta letra; lo de la otra columna o una barra lateral no lo es.
  const belongs = (item) => item === anchor || (foldText(item.text).length >= 2 && folded.includes(foldText(item.text)))
    || textSimilarity(item.text, lyric) > 0.5;
  const pieces = row.items.filter(belongs).sort((a, b) => a.x0 - b.x0);
  const lineHeight = anchor.bottom - anchor.top;
  // Solo trozos contiguos alrededor del ancla (una columna vecina queda lejos).
  const start = pieces.indexOf(anchor);
  let first = start, last = start;
  while (first > 0 && pieces[first].x0 - pieces[first - 1].x1 < lineHeight * 8) first -= 1;
  while (last < pieces.length - 1 && pieces[last + 1].x0 - pieces[last].x1 < lineHeight * 8) last += 1;
  return pieces.slice(first, last + 1);
}
const lyricText = (row, lyric) => lyricContent(row, lyric).map((item) => item.text).join(' ');

/** Franja de la imagen donde están los acordes de una línea de letra (para medir tinta o recortar). */
const backgroundOf = (page, x0, x1, y0, y1) => {
  const histogram = new Map();
  for (let y = Math.max(0, Math.round(y0)); y < Math.round(y1); y += 2) for (let x = Math.max(0, Math.round(x0)); x <= Math.min(page.width - 1, Math.round(x1)); x += 2) {
    const bucket = page.pixels[y * page.width + x] >> 3; histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
  }
  return histogram.size ? ([...histogram].sort((a, b) => b[1] - a[1])[0][0] << 3) + 4 : 255;
};
// Cuando los acordes van muy pegados, el OCR mete acordes y letra (y a veces el inicio de la línea
// siguiente) en una sola caja. Se separan los bloques de tinta por filas: la letra es el más denso.
function lyricInk(page, content, top, bottom) {
  if (!page.pixels) return null;
  const x0 = Math.round(content[0].x0), x1 = Math.round(content.at(-1).x1);
  const background = backgroundOf(page, x0, x1, top, bottom);
  const runs = [];
  for (let y = Math.max(0, Math.round(top)); y < Math.min(page.pixels.length / page.width, Math.round(bottom)); y += 1) {
    let ink = 0;
    for (let x = x0; x <= x1; x += 1) if (Math.abs(page.pixels[y * page.width + x] - background) > 70) ink += 1;
    if (!ink) continue;
    const last = runs.at(-1);
    if (last && y - last.bottom <= 3) { last.bottom = y; last.ink += ink; } else runs.push({ top: y, bottom: y, ink });
  }
  return runs.length ? runs.reduce((a, b) => (b.ink > a.ink ? b : a)) : null;
}

export function chordBand(page, content) {
  const boxTop = Math.min(...content.map((item) => item.top)), boxBottom = Math.max(...content.map((item) => item.bottom));
  const ink = lyricInk(page, content, boxTop, boxBottom);
  // Solo se corrige si encima de la letra quedó otro bloque de tinta dentro de la caja (los acordes).
  const merged = ink && ink.top - boxTop > (ink.bottom - ink.top) * 0.6;
  const top = merged ? ink.top : boxTop;
  const height = merged ? (ink.bottom - ink.top) * 1.2 : boxBottom - boxTop;
  const left = content[0].x0 - height * 1.5;
  const right = content.at(-1).x1 + page.width * 0.12;
  // La franja empieza donde termina la línea anterior de la misma columna (sus colas p, q no son acordes).
  let previous = 0;
  for (const item of page.lines) {
    if (item.bottom < top && item.bottom > top - height * 3 && item.x1 > left && item.x0 < right && isLyricLikeText(item.text)) {
      previous = Math.max(previous, item.bottom + 2);
    }
  }
  // Hasta la línea anterior (el espacio entre acordes y letra cambia con el zoom de la captura);
  // sin línea anterior cerca, un tope de algo más de dos líneas.
  const bandTop = previous > 0 ? previous : top - height * 2.2, bandBottom = top - height * 0.12;
  // Anotaciones entre paréntesis en la fila de acordes («(Intro)», «(Final)», «(x2)»): el OCR sabe dónde
  // están; esa tinta no es un acorde.
  const skip = [];
  for (const item of page.lines) {
    const center = (item.top + item.bottom) / 2;
    if (center < bandTop || center > bandBottom + height * 0.3 || item.x1 < left || item.x0 > right) continue;
    for (const match of item.text.matchAll(/\([^)]*\)?/g)) {
      const from = item.chars[match.index], to = item.chars[Math.min(item.chars.length - 1, match.index + match[0].length - 1)];
      if (from >= 0 && to >= 0) skip.push({ x0: from - 2, x1: to + (item.x1 - item.x0) / Math.max(1, item.text.length) + 2 });
    }
  }
  // Ancho medio de letra de esta línea: separa acordes en cualquier tipo de letra (proporcional o monoespaciada).
  const letters = content.reduce((sum, item) => sum + item.text.length, 0);
  const charWidth = (content.at(-1).x1 - content[0].x0) / Math.max(1, letters + content.length - 1);
  return { top: bandTop, bottom: bandBottom, left, right, lyricTop: top, height, skip, charWidth, afterPrevious: previous > 0 };
}

/** Grupos de tinta en una franja: cada acorde es un grupo separado por al menos un espacio. */
export function inkGroups(page, band) {
  const { width, pixels } = page;
  const top = Math.max(0, Math.round(band.top)), bottom = Math.round(band.bottom);
  const x0 = Math.max(0, Math.round(band.left)), x1 = Math.min(width - 1, Math.round(band.right));
  if (bottom - top < 3 || x1 <= x0) return [];
  const histogram = new Map();
  for (let y = top; y < bottom; y += 2) for (let x = x0; x <= x1; x += 2) {
    const bucket = pixels[y * width + x] >> 3; histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
  }
  const background = ([...histogram].sort((a, b) => b[1] - a[1])[0][0] << 3) + 4;
  const rowInk = (y) => { for (let x = x0; x <= x1; x += 1) if (Math.abs(pixels[y * width + x] - background) > 70) return true; return false; };
  // Colas (y, g, p) de la línea anterior al principio de la franja: si después hay un renglón vacío,
  // la franja empieza tras ese hueco (sin cortar acordes que vayan pegados).
  // Los acordes de una línea son el primer bloque de tinta justo encima de ella: desde abajo hacia arriba
  // hasta el primer hueco. Así no entran colas de la línea anterior ni otras filas, aunque el OCR haya
  // unido varias filas en una caja o la captura tenga más espacio.
  let blockBottom = bottom - 1;
  while (blockBottom > top && !rowInk(blockBottom)) blockBottom -= 1;
  let start = blockBottom, empty = 0;
  const gapRows = Math.max(3, Math.round(band.height * 0.08));
  for (let y = blockBottom; y >= top; y -= 1) {
    if (rowInk(y)) { start = y; empty = 0; } else if (++empty >= gapRows) break;
  }
  const end = blockBottom + 1;
  const runs = [];
  for (let x = x0; x <= x1; x += 1) {
    let inkTop = -1, inkBottom = -1;
    for (let y = start; y < end; y += 1) if (Math.abs(pixels[y * width + x] - background) > 70) { if (inkTop < 0) inkTop = y; inkBottom = y; }
    if (inkTop < 0) continue;
    const last = runs.at(-1);
    if (last && x - last.x1 <= 1) { last.x1 = x; last.top = Math.min(last.top, inkTop); last.bottom = Math.max(last.bottom, inkBottom); }
    else runs.push({ x0: x, x1: x, top: inkTop, bottom: inkBottom });
  }
  // Un espacio entre acordes en negrita proporcional mide ~0,2 em; dentro de un acorde (Dm7, Bb/C) casi nada.
  // Entre acordes hay al menos un espacio (≥ ~0,55 letras en negrita, 1 letra en monoespaciada);
  // dentro de un acorde (Dm7, D#/G) los huecos son menores.
  const gap = Math.max(3, band.charWidth ? band.charWidth * 0.45 : band.height * 0.17), minWidth = band.height * 0.2;
  const groups = [];
  for (const run of runs) {
    const last = groups.at(-1);
    if (last && run.x0 - last.x1 <= gap) { last.x1 = run.x1; last.top = Math.min(last.top, run.top); last.bottom = Math.max(last.bottom, run.bottom); }
    else groups.push({ ...run });
  }
  // Tildes, puntos y comas sueltos son demasiado estrechos para ser un acorde; un subrayado
  // (VERSO 1, CORO) o una raya son tinta plana: tampoco.
  // Lo que solo toca el borde de arriba de la franja son colas de la línea anterior, no acordes.
  const upperEdge = start + (end - start) * 0.3;
  const annotated = (group) => (band.skip || []).some((range) => (group.x0 + group.x1) / 2 >= range.x0 && (group.x0 + group.x1) / 2 <= range.x1);
  return groups.filter((group) => group.x1 - group.x0 >= minWidth && group.bottom - group.top >= band.height * 0.3 && group.bottom > upperEdge && !annotated(group))
    .map(({ x0: gx0, x1: gx1 }) => ({ x0: gx0, x1: gx1 }));
}

/** Para cada letra del texto del OCR, la posición equivalente en la letra del modelo (alineación por edición). */
export function alignText(source, target) {
  const a = [...source].map((c) => foldText(c) || ' '), b = [...target].map((c) => foldText(c) || ' ');
  const n = a.length, m = b.length, cost = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i += 1) cost[i][0] = i;
  for (let j = 0; j <= m; j += 1) cost[0][j] = j;
  for (let i = 1; i <= n; i += 1) for (let j = 1; j <= m; j += 1) {
    cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const map = new Array(n).fill(0);
  let i = n, j = m;
  while (i > 0) {
    if (j > 0 && cost[i][j] === cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { map[i - 1] = j - 1; i -= 1; j -= 1; }
    else if (j > 0 && cost[i][j] === cost[i][j - 1] + 1) j -= 1;
    else { map[i - 1] = Math.min(j, m); i -= 1; }
  }
  return map;
}

/**
 * Coloca los acordes leídos por el modelo sobre su letra, usando la posición de la tinta.
 * Devuelve null si no se puede verificar (cantidad de acordes distinta o letra que no cuadra).
 */
export function placeChords({ lyric, chords, content, groups }) {
  const playable = chords.filter((chord) => chord !== '|');
  if (!playable.length || groups.length !== playable.length) return null;
  let text = '', xs = [];
  for (const item of content) {
    if (text) { text += ' '; xs.push(item.x0 - 1); }
    text += item.text;
    xs.push(...item.chars.slice(0, item.text.length).map((x, k) => (x >= 0 ? x : item.x0 + k)));
  }
  if (textSimilarity(text, lyric) < 0.6) return null;
  // La letra final es la del modelo; del OCR solo se usa la posición, alineando letra por letra
  // (tolera palabras unidas o partidas y erratas: «Ensiencio» ↔ «En silencio»).
  const map = alignText(text, lyric);
  const toModel = (i) => map[Math.min(i, map.length - 1)];
  const end = content.at(-1).x1, height = Math.max(...content.map((item) => item.bottom - item.top));
  const charWidth = (end - content[0].x0) / Math.max(1, text.length);
  const base = lyric.replace(/\s+$/, '');
  const inserts = playable.map((chord, k) => {
    const x = groups[k].x0;
    if (x > end + height * 0.3) return { at: base.length, chord, tail: true };
    // La letra sobre la que empieza el acorde (no la más cercana: en letra proporcional se corría).
    let i = 0; for (let j = 0; j < xs.length; j += 1) if (xs[j] <= x + charWidth * 0.3) i = j;
    if (text[i] === ' ' && i + 1 < text.length) i += 1;
    // Alineado con el comienzo de la palabra: va al inicio de la palabra («U|nigénito» → «|Unigénito»).
    let wordStart = i; while (wordStart > 0 && text[wordStart - 1] !== ' ') wordStart -= 1;
    let wordEnd = i; while (wordEnd + 1 < text.length && text[wordEnd + 1] !== ' ') wordEnd += 1;
    if (x - xs[wordStart] < charWidth * 0.8) i = wordStart;
    // Pasado el final de la palabra: va con la siguiente («abraza|rá [Dm7]mi»), o al final de la línea.
    else if (x > xs[wordEnd] + charWidth * 0.9) {
      let next = wordEnd + 1; while (next < text.length && text[next] === ' ') next += 1;
      if (next >= text.length) return { at: base.length, chord, tail: true };
      i = next;
    }
    return { at: syllableStart(base, Math.min(toModel(i), base.length)), chord };
  });
  // Nunca dos acordes en el mismo punto: el segundo pasa a la palabra siguiente o al final.
  for (let k = 1; k < inserts.length; k += 1) {
    if (inserts[k].tail || inserts[k].at > inserts[k - 1].at) continue;
    const after = base.indexOf(' ', inserts[k - 1].at);
    let next = after < 0 ? base.length : after; while (next < base.length && base[next] === ' ') next += 1;
    inserts[k] = next >= base.length ? { ...inserts[k], at: base.length, tail: true } : { ...inserts[k], at: next };
  }
  let merged = '', from = 0;
  for (const insert of inserts) {
    const at = Math.max(from, insert.at);
    merged += base.slice(from, at) + (insert.tail && !merged.endsWith(' ') && at === base.length ? ' ' : '') + `[${insert.chord}]`;
    from = at;
  }
  return merged + base.slice(from);
}

const SECTION_NAMES = [
  [/^intro/i, 'Intro'], [/^pre[\s-]?(?:coro|chorus)/i, 'Pre-coro'], [/^(?:verso|verse|estrofa)/i, 'Verso'],
  [/^(?:coro|chorus|estribillo|refr[aá]n)/i, 'Coro'], [/^(?:post[\s-]?coro|post[\s-]?chorus)/i, 'Post-coro'],
  [/^(?:puente|bridge)/i, 'Puente'], [/^(?:interludio|interlude)/i, 'Interludio'], [/^instrumental/i, 'Instrumental'],
  [/^solo/i, 'Solo'], [/^(?:final|ending)/i, 'Final'], [/^outro/i, 'Outro'], [/^(?:tag|repetir)/i, 'Repetir'], [/^vamp/i, 'Vamp'],
];
/** Nombres de sección como los usa la app y la guía dinámica (Verso 1, Coro, Pre-coro 2…). */
export function normalizeSectionName(raw = '') {
  // «REPITEN CORO», «Repetir el coro» → Coro (la repetición es el encabezado vacío). «Repetir» solo es un Tag.
  const clean = String(raw).replace(/^\[|\]$/g, '').trim().replace(/^(?:repiten?|repite|repetir)\s+(?:el\s+|la\s+)?(?=\S)/i, '');
  const number = clean.match(/(\d+)\s*$/)?.[1];
  for (const [pattern, name] of SECTION_NAMES) if (pattern.test(clean)) return number ? `${name} ${number}` : name;
  return clean ? clean[0].toUpperCase() + clean.slice(1) : 'Sección';
}

/** Arma el ChordPro de la app a partir de la lectura ya colocada. */
export function buildChordPro(sheet) {
  const out = [];
  if (sheet.title) out.push(`{title: ${sheet.title}}`);
  if (sheet.artist) out.push(`{artist: ${sheet.artist}}`);
  if (sheet.key) out.push(`{key: ${sheet.key}}`);
  if (sheet.tempo) out.push(`{tempo: ${sheet.tempo}}`);
  if (sheet.time) out.push(`{time: ${sheet.time}}`);
  for (const section of sheet.sections) {
    if (out.length) out.push('');
    out.push(`[${normalizeSectionName(section.name)}]`);
    // Una repetición («REPITEN CORO») es solo el encabezado: la app la interpreta como referencia.
    if (section.repeat) continue;
    for (const line of section.lines) out.push(line.text);
  }
  return `${out.join('\n').trim()}\n`;
}

/** Línea de solo acordes («[C#m] [E] [A] | [B]»). */
export const chordOnlyLine = (chords) => chords.map((chord) => (chord === '|' ? '|' : `[${normalizeChordToken(chord)}]`)).join(' ');
