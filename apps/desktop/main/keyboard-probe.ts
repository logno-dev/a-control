import type { BrowserWindow, Event, Input } from 'electron';

/** Verify OS input delivery to our own focused window, without typing into another app. */
export function verifyKeyboardInput(window: BrowserWindow, post: () => Promise<void>, timeoutMs = 2000): Promise<void> {
  if (!window.isFocused()) return Promise.reject(new Error('Keep MIDI Deck focused while checking keyboard delivery'));
  return new Promise((resolve, reject) => {
    const contents = window.webContents;
    const finish = (error?: Error) => {
      clearTimeout(timer); contents.removeListener('before-input-event', receive);
      window.removeListener('blur', blurred); window.removeListener('closed', closed);
      error ? reject(error) : resolve();
    };
    const receive = (event: Event, input: Input) => {
      if (input.key !== 'F20' && input.code !== 'F20') return;
      event.preventDefault();
      if (input.type === 'keyDown') finish();
    };
    const blurred = () => finish(new Error('Keyboard test stopped because MIDI Deck lost focus. Click Check permission again while this window is active.'));
    const closed = () => finish(new Error('Keyboard test window closed'));
    const timer = setTimeout(() => finish(new Error('macOS reported permission, but the test key did not reach MIDI Deck. Quit and reopen the installed app, then check again.')), timeoutMs);
    contents.on('before-input-event', receive); window.once('blur', blurred); window.once('closed', closed);
    void post().catch(error => finish(error instanceof Error ? error : new Error(String(error))));
  });
}
