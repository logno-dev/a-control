import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { verifyKeyboardInput } from '../apps/desktop/main/keyboard-probe';

function fixture() {
  return Object.assign(new EventEmitter(), { isFocused: vi.fn(() => true), webContents: new EventEmitter() });
}
afterEach(() => vi.useRealTimers());
it('confirms native delivery and suppresses the probe key inside the configuration window', async () => {
  const window = fixture(); const prevented = vi.fn();
  await verifyKeyboardInput(window as unknown as BrowserWindow, async () => {
    window.webContents.emit('before-input-event', { preventDefault: prevented }, { type: 'keyDown', key: 'F20', code: 'F20' });
  });
  expect(prevented).toHaveBeenCalledOnce();
  expect(window.webContents.listenerCount('before-input-event')).toBe(0);
  expect(window.listenerCount('blur')).toBe(0);
});
it('reports delivery failure rather than equating a permission flag with success', async () => {
  vi.useFakeTimers(); const window = fixture();
  const outcome = verifyKeyboardInput(window as unknown as BrowserWindow, async () => {}, 100).catch(error => error);
  await vi.advanceTimersByTimeAsync(100);
  expect((await outcome).message).toContain('test key did not reach');
  expect(window.webContents.listenerCount('before-input-event')).toBe(0);
});
it('does not send a test key while another application is focused', async () => {
  const window = fixture(); window.isFocused.mockReturnValue(false); const post = vi.fn();
  await expect(verifyKeyboardInput(window as unknown as BrowserWindow, post)).rejects.toThrow('Keep MIDI Deck focused');
  expect(post).not.toHaveBeenCalled();
});
