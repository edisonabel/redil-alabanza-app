import {entryCountPlan} from '../utils/liveDirectorEntryCount';
import { guideVoiceLead, resolveGuideCue, type GuideCuePlan, type GuideInstructionCue } from '../utils/liveDirectorGuideCues';
import type { TrackOutputRoute } from '../utils/liveDirectorTrackRouting';
import { loadCueBuffer } from '../utils/cueAudioLibrary';
export type GuideAudioGraph = {
  context: AudioContext; destination: AudioNode;
  readState: () => { gain: number; route: TrackOutputRoute };
  setOverride: (enabled: boolean) => void;
  scheduleRecordedGuideDuck: (startAudioTime: number, endAudioTime: number, boundarySeconds?: number, voiceEndAudioTime?: number) => Promise<void>;
  clearRecordedGuideDuck: () => void;
};
type CueAsset = { key: string; url: string; label: string };
export class DynamicGuidePlayer {
  private buffers = new Map<string, AudioBuffer>();
  private gain: GainNode;
  private left: GainNode;
  private right: GainNode;
  private merger: ChannelMergerNode;
  private sources = new Set<AudioBufferSourceNode>();
  private duckScheduled = false;
  private cueGeneration = 0;
  private planKey = '';
  private played = new Set<string>();
  private lastTime: number | null = null;
  private lastWall = 0;
  private disposed = false;
  private previousGain = Number.NaN;
  private previousRoute = '';
  private available = new Set<string>();
  // Instructions keep their own sources and memory: a section cue change never cancels them.
  private cueSources = new Set<AudioBufferSourceNode>();
  private spoken = new Set<string>();
  private cueTime: number | null = null;
  private cueWall = 0;
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
        let buffer: AudioBuffer;
        try { buffer = await loadCueBuffer(this.graph.context, asset.url); }
        catch { throw new Error(`No se pudo preparar la voz ${asset.label}.`); }
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
    this.cueGeneration++;
    if (this.sources.size) {
      for(const source of this.sources){try{source.stop();}catch{}source.disconnect();}
      this.sources.clear();this.record(this.planKey,'cancelled');
    }
    if (this.duckScheduled) {
      this.graph.clearRecordedGuideDuck();
      this.duckScheduled = false;
    }
  }
  private stopInstructions() {
    for (const source of this.cueSources) { try { source.stop(); } catch {} source.disconnect(); }
    this.cueSources.clear();
  }
  private startVoice(key: string, when: number, boundary?: number) {
    const source = this.graph.context.createBufferSource(); source.buffer = this.buffers.get(key)!;
    source.connect(this.gain); this.cueSources.add(source);
    source.onended = () => { source.disconnect(); this.cueSources.delete(source); };
    source.start(when); this.record(key, 'scheduled', boundary);
  }
  pause() {
    this.stopSource(); this.planKey = ''; this.lastTime = null; this.played.clear();
    this.stopInstructions(); this.spoken.clear(); this.cueTime = null;
  }
  /** Speaks each instruction before its point with the section-name lead, gain and route. */
  updateInstructions(cues: ReadonlyArray<GuideInstructionCue>, songTime: number, bpm: number) {
    if (this.disposed) return;
    const wall = performance.now();
    if (this.cueTime !== null && (songTime < this.cueTime - .1 || songTime - this.cueTime > (wall - this.cueWall) / 1000 + .4)) {
      this.stopInstructions(); this.spoken.clear();
    }
    this.cueTime = songTime; this.cueWall = wall;
    const context = this.graph.context;
    for (const cue of cues) {
      const id = `${cue.id}:${cue.startSec}`;
      if (cue.startSec < songTime || this.spoken.has(id)) continue;
      const key = resolveGuideCue(cue.name, this.available);
      if (!key) { this.spoken.add(id); this.record(cue.name, 'missing', cue.startSec); continue; }
      const voice = this.buffers.get(key)!.duration;
      const delay = cue.startSec - guideVoiceLead(voice, bpm) - songTime;
      if (delay > 8) break;
      this.spoken.add(id);
      if (cue.startSec - songTime < voice + .3) { this.record(key, 'late', cue.startSec); continue; }
      this.startVoice(key, context.currentTime + Math.max(.12, delay), cue.startSec);
    }
  }
  /** Manual instruction from the live controls: speak it now. */
  speakNow(name: string): boolean {
    const key = this.disposed ? null : resolveGuideCue(name, this.available);
    if (!key) return false;
    this.syncMix(); this.startVoice(key, this.graph.context.currentTime + .05);
    return true;
  }
  update(plan: GuideCuePlan | null, songTime: number, bpm: number,meter?:{numerator:number;denominator:number}|null) {
    if (this.disposed) return;
    this.syncMix();
    const wall = performance.now();
    if (this.lastTime !== null && (songTime < this.lastTime - .1 || songTime - this.lastTime > (wall - this.lastWall) / 1000 + .4)) {
      this.stopSource(); this.planKey = ''; this.played.clear();
    }
    this.lastTime = songTime; this.lastWall = wall;
    const key = plan ? `${plan.id}:${plan.boundary}:${plan.name}:${plan.countIn?`${bpm}:${meter?.numerator??4}/${meter?.denominator??4}`:'voice'}` : '';
    if (key !== this.planKey) { this.stopSource(); this.planKey = key; }
    if (!plan || this.played.has(key)) return;
    const cueKey=resolveGuideCue(plan.name,this.available),buffer=cueKey?this.buffers.get(cueKey):undefined;
    const context=this.graph.context,boundaryAudioTime=context.currentTime+plan.boundary-songTime;
    const count=plan.countIn?entryCountPlan(bpm,meter,null):null;
    const canCount=count&&Array.from({length:count.beats},(_,i)=>this.buffers.has(String(i+1))).every(Boolean);
    const voices:Array<{key:string;buffer:AudioBuffer;when:number;rate:number}>=[];
    if(canCount&&count){
      const start=boundaryAudioTime-count.beats*count.beatSeconds;
      if(start>=context.currentTime+.12){
        const nameStart=buffer?start-buffer.duration-.15:start;
        if(nameStart-context.currentTime>8)return;
        if(buffer&&cueKey&&nameStart>=context.currentTime+.12)voices.push({key:cueKey,buffer,when:nameStart,rate:1});
        for(let i=0;i<count.beats;i++){
          const number=this.buffers.get(String(i+1))!;
          voices.push({key:String(i+1),buffer:number,when:start+i*count.beatSeconds,rate:Math.max(1,number.duration/(count.beatSeconds*.85))});
        }
      }else{
        // Never start an incomplete count. The existing destination-name cue
        // can still replace a misleading recorded phrase when there is time.
        this.record('count-in','late',plan.boundary);
      }
    }
    if(!voices.length){
      if(!buffer||!cueKey){this.played.add(key);this.record(key,'missing',plan.boundary);return;}
      const lead=Math.max(buffer.duration+.15,4*60/(Number.isFinite(bpm)&&bpm>0?bpm:120));
      const delay=plan.boundary-lead-songTime;if(delay>8)return;
      if(plan.boundary-songTime<buffer.duration+.3){this.played.add(key);this.record(cueKey,'late',plan.boundary);return;}
      voices.push({key:cueKey,buffer,when:context.currentTime+Math.max(.12,delay),rate:1});
    }
    this.played.add(key);
    const first=voices[0],last=voices[voices.length-1];
    const voiceEndAudioTime=last.when+last.buffer.duration/last.rate+.06;
    const preRoll=Math.max(.25,2*60/(Number.isFinite(bpm)&&bpm>0?bpm:120));
    const generation=this.cueGeneration;this.duckScheduled=true;
    const prepared=this.graph.scheduleRecordedGuideDuck(
      Math.max(context.currentTime,first.when-preRoll),Math.max(boundaryAudioTime,voiceEndAudioTime),plan.boundary,voiceEndAudioTime,
    );
    void prepared.then(()=>{
      if(this.disposed||generation!==this.cueGeneration)return;
      if(first.when<context.currentTime+.02){this.stopSource();this.record(plan.countIn?'count-in':cueKey!,'late',plan.boundary);return;}
      for(const voice of voices){
        const source=context.createBufferSource();source.buffer=voice.buffer;source.playbackRate.value=voice.rate;
        source.connect(this.gain);this.sources.add(source);
        source.onended=()=>{source.disconnect();this.sources.delete(source);};
        source.start(voice.when);this.record(voice.key,'scheduled',plan.boundary);
      }
    }).catch(()=>{
      if(this.disposed||generation!==this.cueGeneration)return;
      this.stopSource();this.record(plan.countIn?'count-in':cueKey!,'late',plan.boundary);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.pause(); this.graph.setOverride(false);
    this.gain.disconnect(); this.left.disconnect(); this.right.disconnect(); this.merger.disconnect(); this.buffers.clear(); this.available.clear();
  }
}
