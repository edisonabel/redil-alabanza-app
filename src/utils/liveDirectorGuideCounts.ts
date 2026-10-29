// Conteos de la guía grabada: dónde dice «1, 2, 3, 4» antes de cada sección. La guía dinámica cuenta en
// esos mismos tiempos, que son el pulso que siente la canción (en una de 128 BPM que se cuenta en blancas,
// cada número cae cada 0,94 s, no cada 0,47 s) y la entrada real aunque el marcador esté corrido.
export type GuideCountSeries = { onsets: number[]; spacing: number; entry: number };

const WINDOW_SECONDS = .01;
/** Pico por ventana de 10 ms; basta para ubicar el ataque de cada palabra. */
export function guideEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS)), out = new Float32Array(Math.ceil(samples.length / size));
  for (let w = 0; w < out.length; w++) {
    let peak = 0;
    for (let i = w * size, end = Math.min(samples.length, i + size); i < end; i++) { const v = Math.abs(samples[i]); if (v > peak) peak = v; }
    out[w] = peak;
  }
  return out;
}

/** Ataques de palabra: cruce hacia arriba tras al menos 80 ms bajo el umbral (las sílabas de «cua-tro» no cuentan). */
export function guideOnsets(envelope: Float32Array): number[] {
  const sorted = Array.from(envelope).filter(v => v > 1e-4).sort((a, b) => a - b);
  if (sorted.length < 20) return [];
  const threshold = Math.max(.01, sorted[Math.floor(sorted.length * .995)] * .2), quietWindows = 8, onsets: number[] = [];
  let quiet = quietWindows;
  for (let w = 0; w < envelope.length; w++) {
    if (envelope[w] >= threshold) {
      const t = w * WINDOW_SECONDS;
      if (quiet >= quietWindows && (!onsets.length || t - onsets[onsets.length - 1] >= .3)) onsets.push(Math.round(t * 1000) / 1000);
      quiet = 0;
    } else quiet++;
  }
  return onsets;
}

/** Cuatro ataques parejos (entre 0,3 y 1,6 s) son un conteo; de una tira más larga cuentan los últimos cuatro. */
export function detectGuideCounts(onsets: readonly number[]): GuideCountSeries[] {
  const series: GuideCountSeries[] = [];
  const even = (a: number, b: number) => a >= .3 && a <= 1.6 && Math.abs(a - b) <= Math.max(.04, b * .07);
  for (let i = 0; i + 3 < onsets.length;) {
    const spacing = onsets[i + 1] - onsets[i];
    let end = i + 1;
    while (end + 1 < onsets.length && even(onsets[end + 1] - onsets[end], spacing)) end++;
    if (end - i >= 3 && even(spacing, spacing)) {
      const four = onsets.slice(end - 3, end + 1), step = (four[3] - four[0]) / 3;
      series.push({ onsets: four, spacing: step, entry: Math.round((four[3] + step) * 1000) / 1000 });
      i = end + 1;
    } else i++;
  }
  return series;
}

/** El conteo de la guía que lleva a una sección: su entrada cae cerca del marcador (que puede estar corrido). */
export function guideCountForBoundary(series: readonly GuideCountSeries[], boundary: number): GuideCountSeries | null {
  let best: GuideCountSeries | null = null;
  for (const item of series) {
    const distance = Math.abs(item.entry - boundary);
    // Los marcadores viejos pueden estar hasta un par de segundos corridos; los conteos van separados por secciones enteras.
    if (distance <= Math.max(1.6, item.spacing * 2.7) && (!best || distance < Math.abs(best.entry - boundary))) best = item;
  }
  return best;
}

/** Pulso con que cuenta la guía grabada (la mediana de sus conteos), para contar igual donde ella no cuenta. */
export function guideCountPulse(series: readonly GuideCountSeries[]): number | null {
  if (!series.length) return null;
  const spacings = series.map(item => item.spacing).sort((a, b) => a - b);
  return spacings[Math.floor(spacings.length / 2)];
}

const CACHE_PREFIX = 'live-director:guide-counts:v1:';
/** Analiza la pista Guide una vez por archivo (a 8 kHz, mono) y lo recuerda en este equipo. */
export async function loadGuideCounts(url: string, signal?: AbortSignal): Promise<GuideCountSeries[]> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_PREFIX + url) || 'null');
    if (Array.isArray(cached)) return cached;
  } catch { /* sin caché: se analiza */ }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`No se pudo leer la guía grabada (${response.status}).`);
  const data = await response.arrayBuffer();
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
  const sampleRate = 8000;
  const audio = await new OfflineAudioContext(1, sampleRate, sampleRate).decodeAudioData(data);
  const series = detectGuideCounts(guideOnsets(guideEnvelope(audio.getChannelData(0), audio.sampleRate)));
  try { localStorage.setItem(CACHE_PREFIX + url, JSON.stringify(series)); } catch { /* sin espacio: se vuelve a analizar */ }
  return series;
}
