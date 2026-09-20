import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { windowsHelper } from './windows/helper';
import { MacOSAdapter } from './macos';

export interface PlatformAdapter {
  foreground(): Promise<string>;
  shortcut(shortcut: string, count?: number): Promise<void>;
  media(key: 'playPause' | 'next' | 'previous' | 'mute' | 'volumeUp' | 'volumeDown', count?: number): Promise<void>;
  scroll(x: number, y: number): Promise<void>;
  status?(): Promise<{ accessibility: boolean; accessibilityTrusted?: boolean; inputPosting?: boolean; processId?: number; processPath?: string; bundleIdentifier?: string; backend?: string; muted: boolean | null; volume?: number | null; volumeWritable?: boolean; outputName?: string }>;
  requestAccessibility?(): Promise<void>;
  testInput?(): Promise<void>;
  close(): void;
}
const keys: Record<string, number> = {
  ctrl: 17, control: 17, primary: 17, alt: 18, shift: 16, win: 91, meta: 91,
  enter: 13, return: 13, tab: 9, space: 32, escape: 27, esc: 27, backspace: 8,
  delete: 46, insert: 45, home: 36, end: 35, pageup: 33, pagedown: 34,
  left: 37, up: 38, right: 39, down: 40, plus: 187, equals: 187, '=': 187, minus: 189,
  add: 107, subtract: 109,
  '[': 219, ']': 221, ',': 188, '.': 190, '/': 191, ';': 186, "'": 222, '\\': 220, '`': 192
};
export function parseShortcut(shortcut: string): number[] {
  const parts = shortcut.toLowerCase().split('+').map(s => s.trim());
  if (!parts.length || parts.length > 5) throw new Error('Use a shortcut such as Ctrl+Shift+S');
  return parts.map(part => {
    if (keys[part]) return keys[part];
    if (/^[a-z0-9]$/.test(part)) return part.toUpperCase().charCodeAt(0);
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(part)) return 111 + Number(part.slice(1));
    throw new Error(`Unknown shortcut key: ${part}`);
  });
}

export class WindowsAdapter implements PlatformAdapter {
  private worker?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private waiting = 0;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private start(): Promise<void> {
    if (this.worker && this.ready) return this.ready;
    const worker = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsHelper, 'utf16le').toString('base64')], { windowsHide: true });
    this.worker = worker;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    this.ready = ready;
    const startupTimer = setTimeout(() => { fail(new Error('Windows input worker did not initialize within 30 seconds')); worker.kill(); }, 30000);
    let stderr = '';
    worker.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
    const fail = (error: Error) => {
      clearTimeout(startupTimer); rejectReady(error);
      if (this.worker !== worker) return;
      this.worker = undefined; this.ready = undefined;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', () => fail(new Error(stderr || 'Windows input worker stopped')));
    worker.stdin.on('error', fail);
    createInterface({ input: worker.stdout }).on('line', line => {
      try {
        const response = JSON.parse(line);
        if (response.ready === true) { clearTimeout(startupTimer); resolveReady(); return; }
        const request = this.pending.get(response.id);
        if (!request) return;
        clearTimeout(request.timer); this.pending.delete(response.id);
        if (response.error) request.reject(new Error(response.error)); else request.resolve(response.result);
      } catch { /* Ignore PowerShell startup output. */ }
    });
    return ready;
  }
  private async call(method: string, args: Record<string, unknown> = {}): Promise<string> {
    if (this.pending.size + this.waiting >= 32) throw new Error('Windows action queue is full');
    this.waiting++;
    try { await this.start(); } finally { this.waiting--; }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Windows action timed out')); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.stdin.write(JSON.stringify({ id, method, ...args }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  foreground() { return this.call('foreground'); }
  async shortcut(shortcut: string, count = 1) { await this.call('keys', { keys: parseShortcut(shortcut), count: Math.min(20, count) }); }
  async media(key: 'playPause' | 'next' | 'previous' | 'mute' | 'volumeUp' | 'volumeDown', count = 1) {
    await this.call('keys', { keys: [{ playPause: 179, next: 176, previous: 177, mute: 173, volumeUp: 175, volumeDown: 174 }[key]], count: Math.min(20, count) });
  }
  async scroll(x: number, y: number) { await this.call('scroll', { x, y }); }
  close() { this.worker?.kill(); }
}
class UnsupportedAdapter implements PlatformAdapter {
  async foreground() { return ''; }
  async shortcut(_shortcut: string, _count?: number): Promise<void> { throw new Error('Desktop input actions currently require Windows'); }
  async media(): Promise<void> { throw new Error('Media and volume actions currently require Windows'); }
  async scroll(): Promise<void> { throw new Error('Scroll injection currently requires Windows'); }
  close() {}
}
export function createPlatform(macHelperPath = ''): PlatformAdapter {
  if (process.platform === 'win32') return new WindowsAdapter();
  if (process.platform === 'darwin') return new MacOSAdapter(macHelperPath);
  return new UnsupportedAdapter();
}
