import type { Control, MidiEvent } from '../shared/schema';

export function normalize(deviceId: string, raw: number[], timestamp = Date.now()): MidiEvent | null {
  if (!raw.length || raw[0] < 0x80 || raw.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const status = raw[0] & 0xf0;
  if ([0x80, 0x90, 0xb0, 0xe0].includes(status) && (raw.length < 3 || raw[1] > 127 || raw[2] > 127)) return null;
  const base = { deviceId, channel: (raw[0] & 0x0f) + 1, number: raw[1] ?? 0, value: raw[2] ?? 0, timestamp, raw };
  if (status === 0x90) return { ...base, type: raw[2] === 0 ? 'note-off' : 'note-on' };
  if (status === 0x80) return { ...base, type: 'note-off' };
  if (status === 0xb0) return { ...base, type: 'cc' };
  if (status === 0xe0) return { ...base, type: 'pitch-bend', number: 0, value: raw[1] | (raw[2] << 7) };
  return { ...base, type: 'other' };
}

export function relativeDelta(value: number, mode: Control['mode']): number {
  // MiniLab sends a neutral zero between relative messages (manual §4.8.4).
  if (value === 0) return 0;
  if (mode === 'relative-arturia-3') return value - 16;
  if (mode === 'relative-twos') return value < 64 ? value : value - 128;
  if (mode === 'relative-offset') return value - 64;
  if (mode === 'relative-sign') return value < 64 ? value : 64 - value;
  return value;
}

export class EncoderState {
  private previous = new Map<string, { value: number; time: number; pressed: boolean }>();
  clear() { this.previous.clear(); }
  delta(control: Control, event: MidiEvent): number {
    const key = `${event.deviceId}:${event.channel}:${control.id}`;
    const last = this.previous.get(key);
    this.previous.set(key, { value: event.value, time: event.timestamp, pressed: event.type !== 'note-off' && event.value > 0 });
    let delta: number;
    if (control.mode === 'button') return event.type !== 'note-off' && event.value > 0 && !last?.pressed ? 1 : 0;
    if (control.mode === 'absolute') {
      const spring = event.type === 'pitch-bend' && control.ignoreReturn !== false;
      const touch = event.type === 'pitch-bend' || control.surface === 'mod-strip' || control.surface === 'pitch-strip';
      if (spring && Math.abs(event.value - 8192) <= 1) { this.previous.delete(key); return 0; }
      // Touch-down establishes a relative origin. A new contact after an idle gap
      // must not jump from the previous finger position or the pitch center.
      if (!last || touch && event.timestamp - last.time > 300) return 0;
      delta = (event.value - last.value) / (event.type === 'pitch-bend' ? 128 : 1);
    } else delta = relativeDelta(event.value, control.mode);
    const acceleration = control.acceleration && last && event.timestamp - last.time < 40 ? 2 : 1;
    return delta * control.sensitivity * acceleration * (control.inverted ? -1 : 1);
  }
}
