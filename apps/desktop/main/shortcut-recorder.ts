import type { BrowserWindow, Event, Input } from 'electron';
import { capturedShortcut } from '../../../packages/shared/shortcut-capture';
import type { Notice } from '../../../packages/shared/schema';
import { parseShortcut } from '../../../packages/platforms/platform';
import { parseMacShortcut } from '../../../packages/platforms/macos';

type CaptureNotice = Extract<Notice, { type: 'shortcut-capture' }>;
export class ShortcutRecorder {
  private active = false;
  private pending?: { shortcut: string; code: string; key: string; modifiers: ('control' | 'alt' | 'shift' | 'meta')[] };
  private timer?: NodeJS.Timeout;
  constructor(private window: BrowserWindow, private notify: (notice: CaptureNotice) => void, private platform = process.platform) {
    window.webContents.on('before-input-event', this.input);
    window.on('blur', this.blur);
    window.on('closed', this.closed);
  }
  start() {
    if (!this.window.isFocused()) throw new Error('Focus MIDI Deck before recording a shortcut');
    this.stop(); this.active = true;
    this.window.webContents.setIgnoreMenuShortcuts(true);
    this.timer = setTimeout(() => this.cancel('Shortcut recording timed out'), 30000);
  }
  cancel(message = 'Shortcut recording cancelled') {
    const wasActive = this.active; this.stop();
    if (wasActive) this.notify({ type: 'shortcut-capture', status: 'cancelled', text: message });
  }
  finish() {
    if (!this.active) return; // Key-up may have completed capture just before the click.
    if (!this.pending) throw new Error('Press a key or combination before confirming the shortcut');
    const shortcut = this.pending.shortcut;
    this.stop(); this.notify({ type: 'shortcut-capture', status: 'captured', text: shortcut });
  }
  private stop() {
    this.active = false; this.pending = undefined; clearTimeout(this.timer);
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.setIgnoreMenuShortcuts(false);
  }
  private input = (event: Event, input: Input) => {
    if (!this.active) return;
    event.preventDefault(); // Suppress page navigation, modal Escape/Enter, and menu accelerators.
    if (this.pending) {
      const releasedKey = this.pending.code ? input.code === this.pending.code : input.key === this.pending.key;
      // macOS can omit the primary key-up while Command is held. Releasing all
      // original modifiers also ends the chord without leaving the recorder stuck.
      const releasedModifiers = this.pending.modifiers.length > 0 && ['Control', 'Alt', 'Shift', 'Meta'].includes(input.key) && this.pending.modifiers.every(modifier => !input[modifier]);
      if (input.type === 'keyUp' && (releasedKey || releasedModifiers)) {
        this.finish();
      }
      return;
    }
    try {
      const shortcut = capturedShortcut(input, this.platform);
      if (!shortcut) return;
      if (this.platform === 'darwin') parseMacShortcut(shortcut); else parseShortcut(shortcut);
      this.pending = { shortcut, code: input.code, key: input.key, modifiers: (['control', 'alt', 'shift', 'meta'] as const).filter(modifier => input[modifier]) };
      this.notify({ type: 'shortcut-capture', status: 'preview', text: shortcut });
    } catch (error) {
      this.notify({ type: 'shortcut-capture', status: 'error', text: String(error).replace(/^Error: /, '') });
    }
  };
  private blur = () => this.cancel('Recording stopped because MIDI Deck lost focus');
  private closed = () => this.cancel();
  dispose() {
    this.stop();
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.removeListener('before-input-event', this.input);
    this.window.removeListener('blur', this.blur); this.window.removeListener('closed', this.closed);
  }
}
