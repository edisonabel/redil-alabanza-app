import { resolveGuideCue, type GuideCuePlan } from '../utils/liveDirectorGuideCues';
import type { TrackOutputRoute } from '../utils/liveDirectorTrackRouting';
export type GuideAudioGraph = {
  context: AudioContext; destination: AudioNode;
  readState: () => { gain: number; route: TrackOutputRoute };
  setOverride: (enabled: boolean) => void;
  scheduleRecordedGuideDuck?: (startAudioTime: number, endAudioTime: number, boundarySeconds?: number) => void;
  clearRecordedGuideDuck?: () => void;
};
type CueAsset = { key: string; url: string; label: string };
export class DynamicGuidePlayer {
  private buffers = new Map<string, AudioBuffer>();
  private gain: GainNode;
  private left: GainNode;
  private right: GainNode;
  private merger: ChannelMergerNode;
  private source: AudioBufferSourceNode | null = null;
  private duckScheduled = false;
  private planKey = '';
  private played = new Set<string>();
  private lastTime: number | null = null;
  private lastWall = 0;
  private disposed = false;
  private previousGain = Number.NaN;
  private previousRoute = '';
  private available = new Set<string>();
  public events: Array<{ key: string; status: 'scheduled' | 'late' | 'missing' | 'cancelled'; audioTime: number; boundary?: number }> = [];
  constructor(private graph: GuideAudioGraph) {
    const context = graph.context;
    this.gain = context.createGain(); this.left = context.createGain(); this.right = context.createGain();
    this.merger = context.createChannelMerger(2);
    this.gain.connect(this.left).connect(this.merger, 0, 0);
    this.gain.connect(this.right).connect(this.merger, 0, 1);
    this.merger.connect(graph.destination);
    this.syncMix();
  }
  private record(key: string, status: 'scheduled' | 'late' | 'missing' | 'cancelled', boundary?: number) {
    this.events.push({ key, status, audioTime: this.graph.context.currentTime, boundary });
    if (this.events.length > 64) this.events.shift();
  }
  async load(signal: AbortSignal) {
    const response = await fetch('/audio/guide-es/manifest.json', { signal });
    if (!response.ok) throw new Error('No se encontró la biblioteca de voces.');
    const assets = await response.json() as CueAsset[];
    // Small local mono samples; keep network/decode concurrency bounded.
    let index = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (index < assets.length) {
        const asset = assets[index++];
        const response = await fetch(asset.url, { signal });
        if (!response.ok) throw new Error(`No se pudo preparar la voz ${asset.label}.`);
        const buffer = await this.graph.context.decodeAudioData(await response.arrayBuffer());
        if (signal.aborted || this.disposed) throw new DOMException('Cancelado', 'AbortError');
        this.buffers.set(asset.key, buffer); this.available.add(asset.key);
      }
    }));
    return this.buffers.size;
  }
  syncMix() {
    const { context } = this.graph, state = this.graph.readState();
    const gain = Math.max(0, Math.min(2, state.gain));
    if (!Number.isFinite(this.previousGain) || Math.abs(gain - this.previousGain) > .0001) {
      if (gain === 0) {
        this.gain.gain.cancelScheduledValues(context.currentTime);
        this.gain.gain.setValueAtTime(0, context.currentTime);
      } else this.gain.gain.setTargetAtTime(gain, context.currentTime, .005);
      this.previousGain = gain;
    }
    // Guide is mono and hard-panned to the guide route, never stereo.
    if (state.route !== this.previousRoute) {
      this.left.gain.setValueAtTime(state.route === 'right' ? 0 : 1, context.currentTime);
      this.right.gain.setValueAtTime(state.route === 'right' ? 1 : 0, context.currentTime);
      this.previousRoute = state.route;
    }
  }
  private stopSource() {
    if (this.source) {
      try { this.source.stop(); } catch { /* already ended */ }
      this.source.disconnect(); this.source = null;
      this.record(this.planKey, 'cancelled');
    }
    if (this.duckScheduled) {
      this.graph.clearRecordedGuideDuck?.();
      this.duckScheduled = false;
    }
  }
  pause() {
    this.stopSource(); this.planKey = ''; this.lastTime = null; this.played.clear();
  }
  update(plan: GuideCuePlan | null, songTime: number, bpm: number) {
    if (this.disposed) return;
    this.syncMix();
    const wall = performance.now();
    if (this.lastTime !== null && (songTime < this.lastTime - .1 || songTime - this.lastTime > (wall - this.lastWall) / 1000 + .4)) {
      this.stopSource(); this.planKey = ''; this.played.clear();
    }
    this.lastTime = songTime; this.lastWall = wall;
    const key = plan ? `${plan.id}:${plan.boundary}:${plan.name}` : '';
    if (key !== this.planKey) { this.stopSource(); this.planKey = key; }
    if (!plan || this.played.has(key)) return;
    const cueKey = resolveGuideCue(plan.name, this.available);
    if (!cueKey) { this.played.add(key); this.record(key, 'missing', plan.boundary); return; }
    const buffer = this.buffers.get(cueKey)!;
    const lead = Math.max(buffer.duration + .15, 4 * 60 / (Number.isFinite(bpm) && bpm > 0 ? bpm : 120));
    const delay = plan.boundary - lead - songTime;
    if (delay > 8) return;
    this.played.add(key);
    if (plan.boundary - songTime < buffer.duration + .1) { this.record(cueKey, 'late', plan.boundary); return; }
    const source = this.graph.context.createBufferSource(); source.buffer = buffer;
    source.connect(this.gain); this.source = source;
    source.onended = () => { source.disconnect(); if (this.source === source) this.source = null; };
    const when = this.graph.context.currentTime + Math.max(.01, delay);
    // Keep the recorded guide for normal playback. Suppress its original
    // next-section cue only while the navigation announcement takes over.
    // The render thread owns this window, including restoration at the jump.
    const boundaryAudioTime = this.graph.context.currentTime + plan.boundary - songTime;
    this.graph.scheduleRecordedGuideDuck?.(Math.max(this.graph.context.currentTime, when - .015), boundaryAudioTime - .005, plan.boundary);
    this.duckScheduled = Boolean(this.graph.scheduleRecordedGuideDuck);
    source.start(when); this.record(cueKey, 'scheduled', plan.boundary);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.pause(); this.graph.setOverride(false);
    this.gain.disconnect(); this.left.disconnect(); this.right.disconnect(); this.merger.disconnect(); this.buffers.clear(); this.available.clear();
  }
}
