import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { PlatformAdapter } from '../platform';
import { loadNativeBridge, type NativeBridge } from './native-bridge';

export interface MacStatus {
  accessibility: boolean; accessibilityTrusted: boolean; inputPosting: boolean;
  processId: number; processPath: string; bundleIdentifier: string; backend: 'in-process' | 'helper';
  muted: boolean | null; volume: number | null; volumeWritable: boolean; outputName: string;
}

// macOS virtual key codes (US physical layout). Explicit Ctrl remains Control; Primary is Command.
const keyCodes: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11,
  q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, '1': 18, '2': 19, '3': 20, '4': 21,
  '6': 22, '5': 23, plus: 24, equals: 24, '=': 24, '9': 25, '7': 26, minus: 27, '8': 28, '0': 29,
  ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35, enter: 36, return: 36,
  l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46,
  '.': 47, tab: 48, space: 49, '`': 50, backspace: 51, escape: 53, esc: 53,
  add: 69, subtract: 78, home: 115, pageup: 116, delete: 117, end: 119, pagedown: 121,
  left: 123, right: 124, down: 125, up: 126,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101,
  f10: 109, f11: 103, f12: 111, f13: 105, f14: 107, f15: 113, f16: 106, f17: 64, f18: 79, f19: 80, f20: 90
};
const modifiers: Record<string, number> = {
  shift: 0x20000, ctrl: 0x40000, control: 0x40000, alt: 0x80000, option: 0x80000,
  cmd: 0x100000, command: 0x100000, meta: 0x100000, win: 0x100000, primary: 0x100000
};
export function parseMacShortcut(shortcut: string): { key: number; flags: number; literalPlus?: boolean } {
  const parts = shortcut.toLowerCase().split('+').map(part => part.trim());
  if (parts.length > 5 || parts.some(part => !part)) throw new Error('Use a shortcut such as Cmd+Shift+S');
  let flags = 0;
  for (const modifier of parts.slice(0, -1)) {
    if (!modifiers[modifier]) throw new Error(`Unknown shortcut modifier: ${modifier}`);
    flags |= modifiers[modifier];
  }
  const key = keyCodes[parts[parts.length - 1]];
  if (key === undefined) throw new Error(`Unknown shortcut key: ${parts[parts.length - 1]}`);
  // Affinity's menu shortcut is Command + literal '+', with no Shift modifier.
  // Keep explicit Shift (recorded physical chords) distinct from the Plus symbol.
  return parts[parts.length - 1] === 'plus' ? { key, flags, literalPlus: true } : { key, flags };
}
export class MacOSAdapter implements PlatformAdapter {
  private worker?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private closed = false;
  private native?: NativeBridge;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(private executable: string) {}
  private start() {
    if (this.closed) throw new Error('macOS adapter is closed');
    if (this.worker) return;
    const worker = spawn(this.executable, [], { stdio: 'pipe' });
    this.worker = worker;
    let stderr = '';
    const fail = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
    };
    worker.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
    worker.on('error', error => fail(new Error(`macOS helper: ${error.message}. Run npm run build:native in development.`)));
    worker.on('exit', () => fail(new Error(stderr || 'macOS helper stopped')));
    worker.stdin.on('error', fail);
    createInterface({ input: worker.stdout }).on('line', line => {
      try {
        const response = JSON.parse(line);
        const request = this.pending.get(response.id);
        if (!request) return;
        clearTimeout(request.timer); this.pending.delete(response.id);
        response.error ? request.reject(new Error(response.error)) : request.resolve(response.result);
      } catch { fail(new Error('Invalid macOS helper response')); worker.kill(); }
    });
  }
  private call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('macOS adapter is closed'));
    if (this.executable.endsWith('.node')) {
      try {
        this.native ??= loadNativeBridge(this.executable);
        const response = JSON.parse(this.native.call(JSON.stringify({ id: ++this.sequence, method, ...args })));
        if (response.error) throw new Error(response.error);
        return Promise.resolve(response.result as T);
      } catch (error) { return Promise.reject(error); }
    }
    this.start();
    if (this.pending.size >= 32) return Promise.reject(new Error('macOS action queue is full'));
    const worker = this.worker!;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.kill(); this.pending.delete(id); reject(new Error('macOS action timed out')); }, 5000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      worker.stdin.write(JSON.stringify({ id, method, ...args }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  foreground() { return this.call<string>('foreground'); }
  async requestAccessibility() { await this.call('request-accessibility'); }
  async testInput() {
    if (!this.executable.endsWith('.node')) throw new Error('Keyboard delivery testing requires in-process integration');
    await this.call('test-input');
  }
  status() { return this.call<MacStatus>('status'); }
  async shortcut(shortcut: string, count = 1) { await this.call('keys', { ...parseMacShortcut(shortcut), count: Math.min(20, Math.max(1, Math.trunc(count))) }); }
  async media(key: 'playPause' | 'next' | 'previous' | 'mute' | 'volumeUp' | 'volumeDown', count = 1) {
    if (key === 'mute') { await this.call('mute'); return; }
    if (key === 'volumeUp' || key === 'volumeDown') {
      await this.call('volume', { steps: Math.min(20, Math.max(1, Math.trunc(count))) * (key === 'volumeUp' ? 1 : -1) }); return;
    }
    await this.call('media', { key: { playPause: 16, next: 17, previous: 18 }[key] });
  }
  async scroll(x: number, y: number) { await this.call('scroll', { x: Math.max(-20, Math.min(20, Math.trunc(x))), y: Math.max(-20, Math.min(20, Math.trunc(y))) }); }
  close() {
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('macOS adapter closed')); }
    this.pending.clear(); this.worker?.kill(); this.worker = undefined;
  }
}
