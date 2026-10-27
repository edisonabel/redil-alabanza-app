// Short cue samples (guide voice, count-in, click) are used by both the dynamic
// guide and the entry count. Each file is fetched and decoded once per context.
const decodedCues = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer>>>();

export function loadCueBuffer(context: BaseAudioContext, url: string): Promise<AudioBuffer> {
  let byUrl = decodedCues.get(context);
  if (!byUrl) {
    byUrl = new Map();
    decodedCues.set(context, byUrl);
  }
  const cached = byUrl.get(url);
  if (cached) return cached;

  const library = byUrl;
  const promise = fetch(url).then(async response => {
    if (!response.ok) throw new Error(`No se pudo cargar ${url} (${response.status}).`);
    return context.decodeAudioData(await response.arrayBuffer());
  });
  // A failed load must not stay cached; the next caller retries it.
  promise.catch(() => { if (library.get(url) === promise) library.delete(url); });
  library.set(url, promise);
  return promise;
}
