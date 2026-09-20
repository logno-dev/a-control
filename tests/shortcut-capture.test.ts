import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturedShortcut, type ShortcutInput } from '../packages/shared/shortcut-capture';
import { parseMacShortcut } from '../packages/platforms/macos';
import { parseShortcut } from '../packages/platforms/platform';
import { ShortcutRecorder } from '../apps/desktop/main/shortcut-recorder';

const input = (code: string, key: string, options: Partial<ShortcutInput> = {}): ShortcutInput => ({ type: 'keyDown', code, key, ...options });
describe('keyboard chord capture', () => {
  it('serializes modifier chords into executable platform syntax', () => {
    const mac = capturedShortcut(input('KeyS', 'S', { meta: true, shift: true }), 'darwin');
    expect(mac).toBe('Cmd+Shift+S'); expect(parseMacShortcut(mac!)).toEqual({ key: 1, flags: 0x120000 });
    const windows = capturedShortcut(input('KeyS', 'S', { control: true, shift: true }), 'win32');
    expect(windows).toBe('Ctrl+Shift+S'); expect(parseShortcut(windows!)).toEqual([17, 16, 83]);
  });
  it('supports single keys, arrows, punctuation, function keys and plus without ambiguous separators', () => {
    expect(capturedShortcut(input('Space', ' '), 'darwin')).toBe('Space');
    expect(capturedShortcut(input('ArrowLeft', 'ArrowLeft', { alt: true }), 'darwin')).toBe('Option+Left');
    expect(capturedShortcut(input('F12', 'F12'), 'win32')).toBe('F12');
    expect(capturedShortcut(input('Equal', '+', { meta: true, shift: true }), 'darwin')).toBe('Cmd+Shift+Equals');
    expect(capturedShortcut(input('Quote', "'"), 'win32')).toBe("'");
    expect(parseShortcut("Ctrl+'" )).toEqual([17, 222]);
  });
  it('does not capture modifier-only, repeated, composing, or release events', () => {
    expect(capturedShortcut(input('MetaLeft', 'Meta', { meta: true }), 'darwin')).toBeNull();
    expect(capturedShortcut(input('KeyA', 'a', { isAutoRepeat: true }), 'darwin')).toBeNull();
    expect(capturedShortcut(input('KeyA', 'a', { isComposing: true }), 'darwin')).toBeNull();
    expect(capturedShortcut(input('KeyA', 'a', { type: 'keyUp' }), 'darwin')).toBeNull();
    expect(() => capturedShortcut(input('AudioVolumeUp', 'AudioVolumeUp'), 'darwin')).toThrow('Cannot record');
  });
});

function fixture() {
  const window = Object.assign(new EventEmitter(), { isFocused: vi.fn(() => true), isDestroyed: () => false,
    webContents: Object.assign(new EventEmitter(), { isDestroyed: () => false, setIgnoreMenuShortcuts: vi.fn() }) });
  const notify = vi.fn();
  const recorder = new ShortcutRecorder(window as unknown as BrowserWindow, notify, 'darwin');
  const send = (value: ShortcutInput) => { const event = { preventDefault: vi.fn() }; window.webContents.emit('before-input-event', event, value); return event; };
  return { window, notify, recorder, send };
}
afterEach(() => vi.useRealTimers());
describe('foreground-only recorder lifecycle', () => {
  it('suppresses app shortcuts until key release, preventing Cmd+Q from quitting while recording', () => {
    const { window, notify, recorder, send } = fixture(); recorder.start();
    expect(window.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    expect(send(input('KeyQ', 'q', { meta: true })).preventDefault).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenLastCalledWith({ type: 'shortcut-capture', status: 'preview', text: 'Cmd+Q' });
    send(input('KeyQ', 'q', { meta: true, isAutoRepeat: true }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(send(input('KeyQ', 'q', { type: 'keyUp', meta: true })).preventDefault).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenLastCalledWith({ type: 'shortcut-capture', status: 'captured', text: 'Cmd+Q' });
    expect(window.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    expect(send(input('KeyA', 'a')).preventDefault).not.toHaveBeenCalled(); recorder.dispose();
  });
  it.each(['Escape', 'Tab', 'Enter'])('records %s rather than closing, navigating, or submitting the editor', key => {
    const { recorder, notify, send } = fixture(); recorder.start();
    expect(send(input(key, key)).preventDefault).toHaveBeenCalledOnce();
    send(input(key, key, { type: 'keyUp' }));
    expect(notify).toHaveBeenLastCalledWith({ type: 'shortcut-capture', status: 'captured', text: key }); recorder.dispose();
  });
  it('finishes a macOS Command chord when its key-up is omitted, after all modifiers are released', () => {
    const { recorder, notify, send } = fixture(); recorder.start();
    send(input('KeyS', 'S', { meta: true, shift: true }));
    send(input('ShiftLeft', 'Shift', { type: 'keyUp', meta: true }));
    expect(notify).toHaveBeenCalledTimes(1); // Keep suppressing repeat keys while Cmd is held.
    send(input('MetaLeft', 'Meta', { type: 'keyUp' }));
    expect(notify).toHaveBeenLastCalledWith({ type: 'shortcut-capture', status: 'captured', text: 'Cmd+Shift+S' });
    recorder.dispose();
  });
  it('allows explicit confirmation when the OS omits release events entirely', () => {
    const { recorder, notify, send, window } = fixture(); recorder.start();
    expect(() => recorder.finish()).toThrow('Press a key');
    send(input('KeyQ', 'q', { meta: true })); recorder.finish();
    expect(notify).toHaveBeenLastCalledWith({ type: 'shortcut-capture', status: 'captured', text: 'Cmd+Q' });
    expect(window.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false); recorder.dispose();
  });
  it('cancels when focus is lost or recording times out, restoring normal keyboard behavior', () => {
    vi.useFakeTimers(); const { recorder, notify, window, send } = fixture();
    recorder.start(); window.emit('blur');
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(send(input('KeyS', 's')).preventDefault).not.toHaveBeenCalled();
    recorder.start(); vi.advanceTimersByTime(30000);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled', text: 'Shortcut recording timed out' }));
    expect(window.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false); recorder.dispose();
  });
  it('rejects unsupported keys without silently saving an unusable mapping', () => {
    const { recorder, notify, send } = fixture(); recorder.start();
    send(input('F24', 'F24'));
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }));
    send(input('KeyS', 's')); send(input('KeyS', 's', { type: 'keyUp' }));
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'captured', text: 'S' })); recorder.dispose();
  });
  it('refuses to arm while another app has focus and removes hooks on disposal', () => {
    const { recorder, window } = fixture(); window.isFocused.mockReturnValue(false);
    expect(() => recorder.start()).toThrow('Focus MIDI Deck');
    recorder.dispose(); expect(window.webContents.listenerCount('before-input-event')).toBe(0);
  });
});
