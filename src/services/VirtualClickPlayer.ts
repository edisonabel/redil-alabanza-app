import type { GuideAudioGraph } from './DynamicGuidePlayer';
import type { GeneratedClickSettings } from '../utils/liveDirectorGeneratedClick';

// Click para canciones sin pista Click: el mismo metrónomo digital de siempre (sus sonidos y sus capas Acento,
// Blancas, Negras, Corcheas y Semicorcheas, con el panel del metrónomo), agendado en el reloj del audio a partir
// del tiempo de la canción. Las capas siguen las mismas reglas que el click generado del motor.
const LOOKAHEAD_SECONDS = .25;
// Igual que el motor: los archivos tienen pico ~0,6; +3 dB en todas las capas, y el acento igualado a la negra.
const SAMPLE_GAIN = 1.41;
const SAMPLE_NAMES = ['accents', 'quarter', 'eighth', 'sixteenth'] as const;
let samplesPromise: { context: BaseAudioContext; promise: Promise<AudioBuffer[]> } | null = null;

function loadSamples(context: BaseAudioContext) {
  if (samplesPromise?.context === context) return samplesPromise.promise;
  const promise = Promise.all(SAMPLE_NAMES.map(async name => {
    const response = await fetch(`/audio/click-classic/${name}.wav`);
    if (!response.ok) throw new Error('No se pudieron cargar los sonidos del metrónomo.');
    return context.decodeAudioData(await response.arrayBuffer());
  })).then(buffers => {
    const peak = (buffer: AudioBuffer) => Math.max(...Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).reduce((max, value) => Math.max(max, Math.abs(value)), 0)));
    const accentGain = peak(buffers[1]) > peak(buffers[0]) && peak(buffers[0]) > 0 ? Math.min(4, peak(buffers[1]) / peak(buffers[0])) : 1;
    buffers.forEach((buffer, index) => {
      const gain = SAMPLE_GAIN * (index === 0 ? accentGain : 1);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.max(-1, Math.min(1, data[i] * gain));
      }
    });
    return buffers;
  }).catch(error => { samplesPromise = null; throw error; });
  samplesPromise = { context, promise };
  return promise;
}

export class VirtualClickPlayer {
  private gain: GainNode; private left: GainNode; private right: GainNode; private merger: ChannelMergerNode;
  private layerGains: GainNode[];
  private samples: AudioBuffer[] | null = null;
  private settings: GeneratedClickSettings | null = null;
  private scheduled = new Map<string, AudioBufferSourceNode>();
  private anchor: number | null = null;
  private lastReading: { time: number; wall: number } | null = null;
  private drift = 0;
  constructor(private graph: Pick<GuideAudioGraph, 'context' | 'destination' | 'readState'>) {
    const { context } = graph;
    this.gain = context.createGain(); this.left = context.createGain(); this.right = context.createGain();
    this.merger = context.createChannelMerger(2);
    this.gain.connect(this.left).connect(this.merger, 0, 0); this.gain.connect(this.right).connect(this.merger, 0, 1);
    this.merger.connect(graph.destination);
    this.layerGains = Array.from({ length: 5 }, () => { const layer = context.createGain(); layer.gain.value = 0; layer.connect(this.gain); return layer; });
  }
  async load() { this.samples = await loadSamples(this.graph.context); }
  /** Lo que eligió el panel del metrónomo; null lo apaga. Cambiar el tempo o el compás rehace lo agendado. */
  configure(settings: GeneratedClickSettings | null) {
    const grid = (value: GeneratedClickSettings | null) => value ? `${value.bpm}:${value.originSeconds}:${value.numerator}/${value.denominator}` : '';
    if (grid(settings) !== grid(this.settings)) this.stop();
    this.settings = settings;
    const now = this.graph.context.currentTime;
    this.layerGains.forEach((layer, index) => {
      const level = !settings || (index === 0 && !settings.accentConfirmed) ? 0 : settings.levels[index];
      layer.gain.setTargetAtTime(level, now, .01);
    });
    return Boolean(this.samples);
  }
  private syncMix() {
    const { context } = this.graph, state = this.graph.readState();
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(2, state.gain)), context.currentTime, .005);
    this.left.gain.value = state.route === 'right' ? 0 : 1;
    this.right.gain.value = state.route === 'left' ? 0 : 1;
  }
  stop() {
    for (const source of this.scheduled.values()) { try { source.stop(); } catch { /* ya terminó */ } source.disconnect(); }
    this.scheduled.clear(); this.anchor = null; this.lastReading = null; this.drift = 0;
  }
  /** `time`: segundo de la canción ahora mismo. Sin tocar, sin sonidos o sin metrónomo elegido, calla. */
  update(time: number, playing: boolean) {
    this.syncMix();
    const settings = this.settings, samples = this.samples;
    if (!playing || !settings || !samples || !Number.isFinite(time)) { this.stop(); return; }
    // Al arrancar o saltar, la primera lectura del tiempo puede venir corrida: se agenda solo cuando dos
    // lecturas seguidas avanzan al paso del reloj real.
    const wall = performance.now() / 1000, previous = this.lastReading;
    this.lastReading = { time, wall };
    if (!previous || Math.abs((time - previous.time) - (wall - previous.wall)) > .015) return;
    // La referencia del reloj queda fija mientras la canción avanza pareja (la lectura del tiempo llega por
    // bloques de audio y movería cada pulso unos milisegundos). Un salto (otra sección, una repetición) la
    // renueva al instante; una diferencia chica solo si se mantiene varias lecturas (no por una lectura suelta).
    const measured = this.graph.context.currentTime - time;
    const deviation = this.anchor === null ? 0 : Math.abs(measured - this.anchor);
    this.drift = deviation > .02 ? this.drift + 1 : 0;
    if (deviation > .25 || this.drift >= 4) { this.stop(); this.lastReading = { time, wall }; }
    if (this.anchor === null) this.anchor = measured;
    const anchor = this.anchor;
    // Capas como en el motor: acento por compás, blancas, negras, corcheas a contratiempo y semicorcheas.
    const quarter = 60 / settings.bpm;
    const layers = [
      { period: quarter * settings.numerator * 4 / settings.denominator, phase: 0, sample: 0 },
      { period: quarter * 2, phase: 0, sample: 1 },
      { period: quarter, phase: 0, sample: 1 },
      { period: quarter, phase: quarter / 2, sample: 2 },
      { period: quarter / 2, phase: quarter / 4, sample: 3 },
    ];
    layers.forEach((layer, layerIndex) => {
      const level = layerIndex === 0 && !settings.accentConfirmed ? 0 : settings.levels[layerIndex];
      if (!(level > 0)) return;
      const start = settings.originSeconds + layer.phase;
      const first = Math.ceil((time - start) / layer.period - 1e-6), last = Math.floor((time + LOOKAHEAD_SECONDS - start) / layer.period);
      for (let index = first; index <= last; index += 1) {
        const at = start + index * layer.period, key = `${layerIndex}:${index}`;
        if (at < 0 || this.scheduled.has(key)) continue;
        const source = this.graph.context.createBufferSource();
        source.buffer = samples[layer.sample];
        source.connect(this.layerGains[layerIndex]);
        source.onended = () => { source.disconnect(); if (this.scheduled.get(key) === source) this.scheduled.delete(key); };
        source.start(anchor + at);
        this.scheduled.set(key, source);
      }
    });
  }
  dispose() { this.stop(); this.layerGains.forEach(layer => layer.disconnect()); this.merger.disconnect(); this.gain.disconnect(); }
}
