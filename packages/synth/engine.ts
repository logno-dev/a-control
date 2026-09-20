import type { Config, MidiEvent } from '../shared/schema';

export interface SynthBackend {
  configure(settings: Config['settings']['synth']): void;
  event(event: MidiEvent): void;
  panic(): void;
}
interface Voice { channel: number; note: number; oscillators: OscillatorNode[]; envelope: GainNode; released: boolean; started: number }
// A self-contained fallback instrument. Replace this backend for sampled SoundFont/native audio.
export class WebAudioSynth implements SynthBackend {
  private context = new AudioContext({ latencyHint: 'interactive' });
  private master = this.context.createGain();
  private compressor = this.context.createDynamicsCompressor();
  private voices = new Map<string, Voice>();
  private sustain = new Set<number>();
  private bend = new Map<number, number>();
  private settings: Config['settings']['synth'] = { enabled: true, instrument: 'piano', volume: 0.5 };
  constructor() {
    this.master.connect(this.compressor); this.compressor.connect(this.context.destination);
    this.master.gain.value = 0.25;
  }
  configure(settings: Config['settings']['synth']) {
    if (settings.instrument !== this.settings.instrument || !settings.enabled) this.panic();
    this.settings = settings;
    this.master.gain.setTargetAtTime(settings.volume * 0.5, this.context.currentTime, 0.02);
  }
  event(event: MidiEvent) {
    if (!this.settings.enabled) return;
    if (this.context.state === 'suspended') void this.context.resume();
    const key = `${event.channel}:${event.number}`;
    if (event.type === 'note-on') this.noteOn(key, event);
    if (event.type === 'note-off') {
      const voice = this.voices.get(key);
      if (voice) { voice.released = true; if (!this.sustain.has(event.channel)) this.release(key); }
    }
    if (event.type === 'cc' && event.number === 64) {
      if (event.value >= 64) this.sustain.add(event.channel);
      else {
        this.sustain.delete(event.channel);
        for (const [id, voice] of this.voices) if (voice.channel === event.channel && voice.released) this.release(id);
      }
    }
    if (event.type === 'cc' && [120, 123].includes(event.number)) {
      for (const [id, voice] of this.voices) if (voice.channel === event.channel) this.release(id, true);
    }
    if (event.type === 'pitch-bend') {
      const cents = (event.value - 8192) / 8192 * 200;
      this.bend.set(event.channel, cents);
      for (const voice of this.voices.values()) if (voice.channel === event.channel) for (const oscillator of voice.oscillators) oscillator.detune.setTargetAtTime(cents, this.context.currentTime, 0.005);
    }
  }
  private noteOn(key: string, event: MidiEvent) {
    this.release(key, true);
    if (this.voices.size >= 48) this.release(this.voices.keys().next().value!, true);
    const now = this.context.currentTime;
    const envelope = this.context.createGain(); envelope.connect(this.master);
    const instrument = this.settings.instrument;
    const partials = instrument === 'piano' ? [[1, 1], [2, 0.35], [3, 0.12], [4, 0.05]] : instrument === 'electric' ? [[1, 1], [3, 0.25], [7, 0.04]] : instrument === 'organ' ? [[1, 0.65], [2, 0.35], [4, 0.2]] : [[1, 0.7]];
    const frequency = 440 * 2 ** ((event.number - 69) / 12);
    const oscillators = partials.map(([multiple, level]) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain(); gain.gain.value = level;
      oscillator.type = instrument === 'synth' ? 'triangle' : instrument === 'strings' ? 'sawtooth' : 'sine';
      oscillator.frequency.value = Math.min(20000, frequency * multiple);
      oscillator.detune.value = this.bend.get(event.channel) ?? 0;
      oscillator.connect(gain); gain.connect(envelope); oscillator.start();
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      return oscillator;
    });
    const amplitude = (event.value / 127) ** 1.5 * 0.3;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(amplitude, now + (instrument === 'strings' ? 0.12 : 0.005));
    if (instrument === 'piano' || instrument === 'electric') {
      envelope.gain.exponentialRampToValueAtTime(Math.max(amplitude * 0.001, 0.00001), now + 6);
    }
    this.voices.set(key, { channel: event.channel, note: event.number, oscillators, envelope, released: false, started: now });
  }
  private release(key: string, immediate = false) {
    const voice = this.voices.get(key);
    if (!voice) return;
    this.voices.delete(key);
    const now = this.context.currentTime;
    const release = immediate ? 0.01 : this.settings.instrument === 'strings' ? 0.45 : 0.16;
    voice.envelope.gain.cancelAndHoldAtTime(now);
    voice.envelope.gain.linearRampToValueAtTime(0, now + release);
    for (const oscillator of voice.oscillators) oscillator.stop(now + release + 0.01);
    setTimeout(() => voice.envelope.disconnect(), (release + 0.1) * 1000);
  }
  panic() { for (const key of this.voices.keys()) this.release(key, true); this.sustain.clear(); this.bend.clear(); }
}
