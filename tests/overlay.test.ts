import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], windows: [] as any[] }));
vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    visible = false; destroyed = false;
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn() });
    showInactive = vi.fn(() => { this.visible = true; });
    hide = vi.fn(() => { this.visible = false; });
    focus = vi.fn(); show = vi.fn();
    setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn(); setIgnoreMouseEvents = vi.fn(); setBounds = vi.fn();
    constructor(options: Record<string, unknown>) { super(); mock.options.push(options); mock.windows.push(this); }
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 900 } }) }
}));
import { ProfileOverlay } from '../apps/desktop/main/overlay';

afterEach(() => { vi.useRealTimers(); mock.options.length = 0; mock.windows.length = 0; });
describe('passive feedback window lifecycle', () => {
  it('uses a non-activating panel on macOS and never takes key focus', () => {
    const overlay = new ProfileOverlay('preload', () => {});
    expect(mock.options[0]).toMatchObject({ focusable: false, show: false, skipTaskbar: true });
    if (process.platform === 'darwin') expect(mock.options[0].type).toBe('panel');
    overlay.close();
  });
  it('waits for the page, updates an existing volume panel without re-showing, and hides without focus', () => {
    vi.useFakeTimers(); const overlay = new ProfileOverlay('preload', () => {}); const window = mock.windows[0];
    overlay.show('Affinity', 'Affinity Affinity Store');
    expect(window.showInactive).not.toHaveBeenCalled();
    window.webContents.emit('did-finish-load');
    expect(window.showInactive).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2000);
    overlay.show('Volume 50%', 'Speakers', 'SYSTEM VOLUME');
    expect(window.showInactive).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000); expect(window.hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1800); expect(window.hide).toHaveBeenCalledOnce();
    expect(window.focus).not.toHaveBeenCalled(); expect(window.show).not.toHaveBeenCalled();
    overlay.close();
  });
  it('gives error instructions more room and time without making the panel interactive', () => {
    vi.useFakeTimers(); const overlay = new ProfileOverlay('preload', () => {}); const window = mock.windows[0];
    window.webContents.emit('did-finish-load');
    overlay.show('Enable Accessibility for MIDI Deck', 'System Settings → Privacy & Security → Accessibility.\nEnable MIDI Deck.', 'ACTION ERROR');
    expect(window.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ width: 560, height: 220 }));
    vi.advanceTimersByTime(8000); expect(window.hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); expect(window.hide).toHaveBeenCalledOnce();
    expect(window.focus).not.toHaveBeenCalled(); overlay.close();
  });
});
