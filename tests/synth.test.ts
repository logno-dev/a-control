import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebAudioSynth } from '../packages/synth/engine';
import { normalize } from '../packages/midi/normalize';

class Parameter {
  value = 0;
  setTargetAtTime(value: number) { this.value = value; }
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
  cancelAndHoldAtTime() {}
}
class Node {
  connections: unknown[] = [];
  connect(target: unknown) { this.connections.push(target); }
  disconnect() { this.connections = []; }
}
class Gain extends Node { gain = new Parameter(); }
class Oscillator extends Node {
  frequency = new Parameter(); detune = new Parameter(); type = 'sine';
  onended?: () => void;
  stop = vi.fn(); start() {}
}
class Context {
  static latest: Context;
  currentTime = 1; state = 'running'; destination = new Node();
  oscillators: Oscillator[] = []; gains: Gain[] = [];
  constructor() { Context.latest = this; }
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createOscillator() { const oscillator = new Oscillator(); this.oscillators.push(oscillator); return oscillator; }
  createDynamicsCompressor() { return new Node(); }
  async resume() {}
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('AudioContext', Context); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('touch strips and synth controller reset', () => {
  it('applies modulation to new and held voices without changing their pitch-bend offsets', () => {
    const synth = new WebAudioSynth(); const context = Context.latest;
    const send = (raw: number[]) => synth.event(normalize('device', raw)!);
    send([0xb0, 1, 127]); send([0xe0, 0, 96]); send([0x90, 60, 100]);
    const partials = context.oscillators.filter(oscillator => oscillator.frequency.value !== 5.5);
    const lfo = context.oscillators.find(oscillator => oscillator.frequency.value === 5.5)!;
    const depth = lfo.connections[0] as Gain;
    expect(depth.gain.value).toBe(45);
    expect(partials.every(oscillator => oscillator.detune.value === 100)).toBe(true);
    expect(depth.connections).toEqual(partials.map(oscillator => oscillator.detune));
    send([0xb1, 1, 0]); expect(depth.gain.value).toBe(45); // Other MIDI channel is independent.
    send([0xb0, 1, 0]); expect(depth.gain.value).toBe(0);
    send([0x80, 60, 0]); expect(lfo.stop).toHaveBeenCalled();
    expect(partials.every(oscillator => oscillator.stop.mock.calls.length === 1)).toBe(true);
  });
  it('releases sustained voices and resets pitch and modulation on CC121', () => {
    const synth = new WebAudioSynth(); const context = Context.latest;
    const send = (raw: number[]) => synth.event(normalize('device', raw)!);
    send([0x90, 60, 100]); send([0xb0, 64, 127]); send([0xb0, 1, 127]); send([0xe0, 0, 96]); send([0x80, 60, 0]);
    expect(context.oscillators.every(oscillator => !oscillator.stop.mock.calls.length)).toBe(true);
    send([0xb0, 121, 0]);
    expect(context.oscillators.every(oscillator => oscillator.stop.mock.calls.length === 1)).toBe(true);
    send([0x90, 62, 100]);
    expect(context.oscillators.at(-1)!.detune.value).toBe(0);
    const newLfo = context.oscillators.filter(oscillator => oscillator.frequency.value === 5.5).at(-1)!;
    expect((newLfo.connections[0] as Gain).gain.value).toBe(0);
    synth.panic();
  });
});
