import { BrowserWindow, screen } from 'electron';

/** A click-through native window; it does not require Notification Center permission. */
export class ProfileOverlay {
  private window: BrowserWindow;
  private ready = false;
  private pending?: { title: string; detail: string; label: string };
  private timer?: NodeJS.Timeout;
  constructor(preload: string, load: (window: BrowserWindow) => void) {
    this.window = new BrowserWindow({ width: 430, height: 112, show: false, frame: false, transparent: true,
      // On macOS, showInactive() on an NSWindow does not prevent application
      // activation. A panel uses NSNonactivatingPanelMask for its entire lifetime.
      type: process.platform === 'darwin' ? 'panel' : undefined,
      resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false,
      alwaysOnTop: true, title: 'MIDI Deck Profile',
      webPreferences: { preload, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false }
    });
    this.window.setAlwaysOnTop(true, 'floating');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    this.window.setIgnoreMouseEvents(true, { forward: true });
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.window.webContents.on('did-finish-load', () => { this.ready = true; if (this.pending) this.show(this.pending.title, this.pending.detail, this.pending.label); });
    load(this.window);
  }
  show(title: string, detail: string, label = 'ACTIVE PROFILE') {
    this.pending = { title, detail, label };
    if (!this.ready || this.window.isDestroyed()) return;
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const error = label === 'ACTION ERROR';
    const width = Math.min(error ? 560 : 430, workArea.width - 32);
    const height = error ? 220 : 112;
    this.window.setBounds({ width, height, x: Math.round(workArea.x + (workArea.width - width) / 2), y: workArea.y + workArea.height - height - 28 });
    this.window.webContents.send('deck:notice', { type: 'overlay', text: title, detail, label });
    // Updating volume text must not reorder/re-show an already visible panel.
    if (!this.window.isVisible()) this.window.showInactive();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), error ? 9000 : 2800);
  }
  hide() { clearTimeout(this.timer); this.pending = undefined; if (!this.window.isDestroyed()) this.window.hide(); }
  close() { clearTimeout(this.timer); if (!this.window.isDestroyed()) this.window.destroy(); }
}
