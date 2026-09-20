import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { join } from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { actionLabels, type Activity, type AudioMessage, type Config, type Notice, type PermissionCheck, type State } from '../../../packages/shared/schema';
import { permissionResult } from '../../../packages/platforms/macos/permissions';
import { verifyKeyboardInput } from './keyboard-probe';
import { version } from '../../../package.json';
import { ProfileOverlay } from './overlay';
import { ShortcutRecorder } from './shortcut-recorder';
import { parseConfig } from '../../../packages/config/migration';
import { MiniLabFeedback } from '../../../packages/controllers/feedback';
import { ConfigStore } from '../../../packages/config/storage';
import { MidiDevices } from '../../../packages/midi/devices';
import { MidiRouter } from '../../../packages/midi/router';
import { applicationProfile } from '../../../packages/profiles/resolver';
import { createPlatform } from '../../../packages/platforms/platform';
import { ActionEngine } from '../../../packages/actions/engine';
import { ProfileChangeNotifier } from '../../../packages/profiles/notifications';

app.setName('MIDI Deck');
if (process.platform === 'win32') app.setAppUserModelId('dev.midideck.desktop');
if (process.env.MIDI_DECK_DATA_DIR) app.setPath('userData', process.env.MIDI_DECK_DATA_DIR);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let window: BrowserWindow | undefined;
let audioWindow: BrowserWindow | undefined;
let profileOverlay: ProfileOverlay | undefined;
let shortcutRecorder: ShortcutRecorder | undefined;
let tray: Tray;
let quitting = false;
let config: Config;
let store: ConfigStore;
let foreground = '';
let audioLoaded = false;
let counter = 0;
let poll: NodeJS.Timeout;
let devicePoll: NodeJS.Timeout;
let learnTimer: NodeJS.Timeout | undefined;
let feedbackTimer: NodeJS.Timeout;
let routeTimer: NodeJS.Timeout | undefined;
let volumeFeedbackTimer: NodeJS.Timeout | undefined;
let lastRoute: State['lastRoute'] = null;
let nativeNotice: Notification | undefined;
let notificationError = '';
let permissionCheck: PermissionCheck | null = null;
let midiEvents = 0;
let lastMidiAt: number | null = null;
let actionCount = 0;
let lastAction: Activity | null = null;
const activity: Activity[] = [];
let system: State['system'] = { accessibility: null, muted: null, error: '' };
const platform = createPlatform(app.isPackaged ? join(process.resourcesPath, 'native/midi-deck-macos.node') : join(__dirname, '../native/midi-deck-macos.node'));
const broadcast = (notice: Notice) => { if (window && !window.isDestroyed()) window.webContents.send('deck:notice', notice); };
const log = (kind: 'info' | 'error' | 'action', message: string) => {
  const entry: Activity = { id: ++counter, time: Date.now(), kind, message };
  activity.unshift(entry); if (activity.length > 80) activity.pop();
  if (kind === 'action' || kind === 'error') lastAction = entry;
  broadcast({ type: 'activity', entry });
  if (kind === 'error') console.error(message);
};
const audio = (message: AudioMessage) => { if (audioLoaded && audioWindow && !audioWindow.isDestroyed()) audioWindow.webContents.send('deck:audio', message); };
const midi = new MidiDevices(event => {
  midiEvents++; lastMidiAt = Date.now();
  broadcast({ type: 'midi', event });
  feedback.input(event, config, router.learning);
  router.route(event, config, foreground);
}, message => log('error', message));
const feedback = new MiniLabFeedback(raw => midi.feedback(raw));
function nativeProfileNotice(title: string, body: string) {
  if (!Notification.isSupported()) throw new Error('Native notifications are not supported on this desktop');
  nativeNotice?.close();
  nativeNotice = new Notification({ title, body, silent: true, timeoutType: 'default' });
  nativeNotice.on('click', showWindow);
  nativeNotice.on('failed', (_event, error) => {
    notificationError = `macOS/system notification request was rejected: ${error}. The on-screen overlay remains available. Allow MIDI Deck in System Settings → Notifications, then use Test native notification to retry.`;
    log('info', notificationError); publish();
  });
  nativeNotice.show();
}
const profileNotifier = new ProfileChangeNotifier((profile, application) => {
  const text = `Active profile · ${profile.name}`;
  log('info', `${text}${application ? ` · ${application}` : ''}`);
  if (config.settings.overlay) {
    broadcast({ type: 'overlay', text });
    profileOverlay?.show(profile.name, application || 'Desktop controls');
  }
  if (config.settings.nativeNotifications && !notificationError && Notification.isSupported()) nativeProfileNotice(text, application ? `Foreground app: ${application}` : 'Your desktop controls are ready');
});
function updateFeedback() { feedback.update(config, foreground, system.muted, !!midi.feedbackName && midi.feedbackName === feedbackOutput()); }
function feedbackOutput() { return config.feedback.enabled && config.settings.mode === 'desktop' ? config.feedback.output : ''; }
function showVolumeFeedback() {
  if (!config.settings.overlay || !platform.status || volumeFeedbackTimer) return;
  volumeFeedbackTimer = setTimeout(async () => {
    try {
      const status = await platform.status!();
      system = { ...status, error: '' }; publish(); updateFeedback();
      if (status.volume != null) profileOverlay?.show(`Volume ${Math.round(status.volume * 100)}%${status.muted ? ' · Muted' : ''}`, status.outputName ?? 'System output', 'SYSTEM VOLUME');
    } catch (error) { log('error', String(error)); }
    finally { volumeFeedbackTimer = undefined; }
  }, 100);
}
const router = new MidiRouter({
  synth: event => audio({ type: 'midi', event }),
  passthrough: raw => midi.send(raw),
  action: (mapping, delta, profile) => {
    actionCount++;
    void actions.execute(mapping, delta, profile).then(() => {
      log('action', `${profile.name} · ${actionLabels[mapping.action]} ${delta > 0 ? '+' : ''}${delta}`);
      if (mapping.action === 'system.mute') void pollSystem();
      if (mapping.action === 'system.volume.change' || mapping.action === 'system.mute') showVolumeFeedback();
    }).catch(error => {
      const control = config.controller.controls.find(c => c.id === mapping.controlId);
      if (control?.led) feedback.pulse(control.led, 'red', 600);
      log('error', `${profile.name} · ${actionLabels[mapping.action]}: ${String(error)}`);
      if (config.settings.overlay) {
        const access = process.platform === 'darwin' && /Accessibility|keyboard-posting/.test(String(error));
        profileOverlay?.show(access ? 'Enable Accessibility for MIDI Deck' : `${actionLabels[mapping.action]} failed`, access
          ? 'System Settings → Privacy & Security → Accessibility.\nEnable MIDI Deck. If missing, use + to add this app.\nFull steps: MIDI Deck → Settings → macOS integration.'
          : String(error).replace(/^Error: /, ''), 'ACTION ERROR');
      }
    });
  },
  learned: event => { clearTimeout(learnTimer); broadcast({ type: 'learn', event }); publish(); },
  report: route => {
    lastRoute = route;
    if (!routeTimer) routeTimer = setTimeout(() => {
      routeTimer = undefined;
      if (lastRoute) broadcast({ type: 'route', route: lastRoute });
    }, 60);
  }
});
const actions = new ActionEngine(platform, {
  openExternal: url => shell.openExternal(url), openPath: path => shell.openPath(path),
  switchProfile: async id => {
    const profile = config.profiles.find(p => p.kind === 'user' && (p.id === id || p.name === id));
    if (!profile) throw new Error(`User profile not found: ${id}`);
    await queueSave({ ...config, activeProfile: profile.id });
  }
});
const applicationPath = () => process.execPath.includes('.app/Contents/MacOS/') ? process.execPath.slice(0, process.execPath.lastIndexOf('.app/Contents/MacOS/') + 4) : process.execPath;
const state = (): State => ({ config,
  runtime: { version, executable: app.isPackaged ? process.execPath : app.getAppPath(), applicationPath: applicationPath(), configPath: store.path, packaged: app.isPackaged, notificationError },
  diagnostics: { midiEvents, lastMidiAt, actions: actionCount, lastAction, recentActivity: activity.slice() },
  inputs: midi.inputs, outputs: midi.outputs, connected: midi.connected, backend: midi.backend, foreground,
  applicationProfile: applicationProfile(config, foreground)?.id ?? '', learning: router.learning, platform: process.platform,
  feedbackConnected: midi.feedbackName, system, lastRoute, permissionCheck });
function publish() { broadcast({ type: 'state', state: state() }); }
function panic() { audio({ type: 'panic' }); midi.panic(); router.reset(); }
function cancelLearn() { clearTimeout(learnTimer); router.learning = false; }

let mutation = Promise.resolve();
function queueSave(value: unknown): Promise<State> {
  const result = mutation.then(() => save(value));
  mutation = result.then(() => {}, () => {});
  return result;
}
async function save(value: unknown): Promise<State> {
  const next = parseConfig(value);
  if (next.settings.mode === 'passthrough' && (!next.output || !midi.outputs.includes(next.output))) throw new Error('Select an available MIDI output before enabling passthrough');
  await store.save(next);
  panic(); cancelLearn();
  shortcutRecorder?.cancel();
  if (config.feedback.output !== next.feedback.output || !next.feedback.enabled || next.settings.mode === 'passthrough') feedback.release();
  const loginChanged = config.settings.startAtLogin !== next.settings.startAtLogin;
  config = next;
  if (loginChanged && ['win32', 'darwin'].includes(process.platform)) app.setLoginItemSettings({ openAtLogin: config.settings.startAtLogin, args: ['--hidden'] });
  const previousFeedback = midi.feedbackName;
  try { await midi.connect(config.input, config.output, feedbackOutput()); } catch (error) { log('error', `MIDI connection: ${String(error)}`); }
  if (previousFeedback !== midi.feedbackName) feedback.invalidate();
  updateFeedback();
  audio({ type: 'settings', settings: config.settings.synth });
  updateTray(); publish();
  profileNotifier.update(config, foreground);
  return state();
}
function loadPage(target: BrowserWindow, page: 'index' | 'audio' | 'overlay') {
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) void target.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`);
  else void target.loadFile(join(__dirname, `../renderer/${page}.html`));
}
function secureWindow(target: BrowserWindow) {
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', event => event.preventDefault());
  target.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
function createWindow() {
  shortcutRecorder?.dispose();
  window = new BrowserWindow({ width: 1320, height: 900, minWidth: 980, minHeight: 700, show: false, backgroundColor: '#121212', title: `MIDI Deck ${version}`, icon: join(__dirname, '../assets/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  secureWindow(window);
  shortcutRecorder = new ShortcutRecorder(window, broadcast);
  window.on('close', event => { shortcutRecorder?.cancel(); if (!quitting) { event.preventDefault(); window?.hide(); cancelLearn(); } });
  window.on('ready-to-show', () => { if (!process.argv.includes('--hidden')) window?.show(); });
  window.setMenuBarVisibility(false);
  loadPage(window, 'index');
}
function showWindow() { if (!window || window.isDestroyed()) createWindow(); if (process.platform === 'darwin') app.focus({ steal: true }); window!.show(); window!.focus(); }
function updateTray() {
  if (!tray) return;
  tray.setToolTip(`MIDI Deck ${version} · ${midi.connected || 'No controller'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Controller: ${midi.connected || 'Not connected'}`, enabled: false },
    { type: 'separator' },
    { label: 'Open MIDI Deck', click: showWindow },
    { label: 'Profile', submenu: config.profiles.filter(p => p.kind === 'user').map(p => ({ label: p.name, type: 'radio' as const, checked: p.id === config.activeProfile, click: () => void queueSave({ ...config, activeProfile: p.id }).catch(error => log('error', String(error))) })) },
    { label: 'Synth', type: 'checkbox', checked: config.settings.synth.enabled, click: item => void queueSave({ ...config, settings: { ...config.settings, synth: { ...config.settings.synth, enabled: item.checked } } }).catch(error => log('error', String(error))) },
    { label: 'Pause mappings', type: 'checkbox', checked: config.settings.paused, click: item => void queueSave({ ...config, settings: { ...config.settings, paused: item.checked } }).catch(error => log('error', String(error))) },
    { label: 'All notes off', click: panic },
    { type: 'separator' }, { label: 'Quit', click: () => app.quit() }
  ]));
}
function createTray() {
  const icon = nativeImage.createFromPath(join(__dirname, '../assets/tray.png')).resize({ width: 18, height: 18 });
  if (icon.isEmpty()) throw new Error('App icons are missing. Run npm run build:assets.');
  tray = new Tray(icon); tray.on('double-click', showWindow); updateTray();
}
function registerIPC() {
  const handle = (channel: string, callback: (...args: any[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unauthorized IPC sender');
    return callback(...args);
  });
  handle('deck:state', state);
  handle('deck:save', queueSave);
  handle('deck:refresh', async () => { await refreshDevices(); return state(); });
  handle('deck:learn', (enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid Learn state');
    if (enabled && config.settings.mode === 'passthrough') throw new Error('Switch to Desktop mode to use MIDI Learn');
    shortcutRecorder?.cancel(); cancelLearn(); router.learning = enabled;
    if (enabled) learnTimer = setTimeout(() => { cancelLearn(); publish(); log('info', 'MIDI Learn timed out'); }, 30000);
    publish();
  });
  handle('deck:panic', panic);
  handle('deck:accessibility', async () => {
    if (process.platform !== 'darwin') throw new Error('Accessibility setup is only needed on macOS');
    await platform.requestAccessibility?.();
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });
  handle('deck:recheck-accessibility', async () => {
    try {
      if (process.platform !== 'darwin' || !platform.status) throw new Error('This permission check is only available on macOS');
      const status = await platform.status();
      system = { ...status, error: '' };
      permissionCheck = permissionResult(status, process.pid);
      if (permissionCheck.status === 'granted' && platform.testInput) {
        if (window!.isFocused()) {
          shortcutRecorder?.cancel();
          try {
            await verifyKeyboardInput(window!, () => platform.testInput!());
            permissionCheck = { ...permissionCheck, keyboardTest: 'delivered', message: 'Permission granted and the native test key reached MIDI Deck. Keyboard control is ready; try your Affinity zoom mapping.' };
          } catch (error) {
            permissionCheck = { ...permissionCheck, status: 'error', keyboardTest: 'not-received', message: String(error).replace(/^Error: /, '') };
          }
        } else permissionCheck = { ...permissionCheck, keyboardTest: 'not-run', message: 'Keyboard-posting permission is granted. Focus this window and check again to verify delivery.' };
      }
    } catch (error) {
      permissionCheck = { checkedAt: Date.now(), status: 'error', message: String(error), accessibilityTrusted: null,
        inputPosting: null, processId: null, backend: 'unavailable', bundleIdentifier: '' };
    }
    log('info', `Keyboard permission check: ${permissionCheck.status}. ${permissionCheck.message}`);
    publish();
    // Local, read-only diagnostic for support: no mappings, commands, or keystrokes.
    await writeFile(join(app.getPath('userData'), 'permission-check.json'), JSON.stringify({ ...permissionCheck, applicationPath: applicationPath(), version }, null, 2), { mode: 0o600 }).catch(error => log('info', `Could not save the permission diagnostic: ${String(error)}`));
    return permissionCheck;
  });
  handle('deck:reveal-application', () => shell.showItemInFolder(applicationPath()));
  handle('deck:shortcut-start', () => { cancelLearn(); shortcutRecorder!.start(); publish(); });
  handle('deck:shortcut-finish', () => shortcutRecorder!.finish());
  handle('deck:shortcut-cancel', () => shortcutRecorder?.cancel());
  handle('deck:test-lights', () => { updateFeedback(); feedback.test(); });
  handle('deck:resync-lights', () => { feedback.invalidate(); updateFeedback(); });
  handle('deck:test-notification', () => { notificationError = ''; nativeProfileNotice('MIDI Deck notifications', 'Application-driven profile changes will appear here.'); });
  handle('deck:test-overlay', () => profileOverlay?.show('Profile overlay is working', `MIDI Deck ${version} · This window never steals focus`));
  handle('deck:test-volume', async () => {
    if (process.platform !== 'darwin' || !platform.status) throw new Error('Volume diagnostics currently require macOS');
    const before = await platform.status();
    if (!before.volumeWritable || before.volume == null) throw new Error(`${before.outputName || 'Default output'} does not expose software volume`);
    const direction = before.volume > 0.95 ? -1 : 1;
    try {
      await platform.media(direction > 0 ? 'volumeUp' : 'volumeDown');
      await new Promise(resolve => setTimeout(resolve, 150));
      const after = await platform.status();
      if (after.outputName !== before.outputName || after.volume == null || Math.abs(after.volume - before.volume - direction * 0.02) > 0.005) throw new Error('The output did not report the expected volume change');
      log('info', `Volume test passed on ${after.outputName}. MIDI input can now be checked independently.`);
    } finally {
      const current = await platform.status();
      if (current.outputName === before.outputName && current.volume != null && Math.abs(current.volume - before.volume - direction * 0.02) < 0.005) await platform.media(direction > 0 ? 'volumeDown' : 'volumeUp');
      await pollSystem();
    }
  });
  handle('deck:export', async () => {
    const result = await dialog.showSaveDialog(window!, { defaultPath: 'midi-deck-profile.json', filters: [{ name: 'MIDI Deck configuration', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, JSON.stringify(config, null, 2)); return true;
  });
  handle('deck:import', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: 'MIDI Deck configuration', extensions: ['json'] }] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error('Configuration exceeds 2 MB');
    const imported = parseConfig(JSON.parse(await readFile(file, 'utf8')));
    const commands = imported.profiles.flatMap(p => p.mappings.filter(m => ['command.run', 'powershell.run', 'application.launch', 'file.open', 'url.open', 'shortcut.send'].includes(m.action)).map(m => `${p.name} / ${actionLabels[m.action]}: ${m.parameter}`));
    const confirmation = await dialog.showMessageBox(window!, { type: 'warning', title: 'Import configuration', message: 'Replace your configuration with this file?', detail: `Only import profiles you trust.\n\n${commands.length ? 'This file contains these desktop actions:\n' + commands.join('\n') : 'No command, launcher, file, URL, or shortcut actions.'}`, buttons: ['Cancel', 'Import'], defaultId: 0, cancelId: 0, noLink: true });
    if (confirmation.response !== 1) return null;
    return queueSave(imported);
  });
  ipcMain.on('deck:audio-ready', event => {
    if (audioWindow && event.sender === audioWindow.webContents && event.senderFrame === audioWindow.webContents.mainFrame) {
      audioLoaded = true; audio({ type: 'settings', settings: config.settings.synth });
    }
  });
}
let refreshing: Promise<void> | undefined;
function refreshDevices(): Promise<void> {
  if (refreshing) return refreshing;
  // Device refresh/reconnection and configuration writes share one mutation queue.
  const operation = mutation.then(async () => {
    const previous = midi.connected;
    const previousFeedback = midi.feedbackName;
    try {
      await midi.refresh();
      if (previous && previous !== midi.connected) panic();
      const feedbackDisconnected = previousFeedback !== midi.feedbackName;
      await midi.connect(config.input, config.output, feedbackOutput());
      if (feedbackDisconnected || previousFeedback !== midi.feedbackName) feedback.invalidate();
      updateFeedback();
      updateTray(); publish();
    } catch (error) { log('error', `MIDI: ${String(error)}`); }
  });
  mutation = operation.then(() => {}, () => {});
  refreshing = operation.finally(() => { refreshing = undefined; });
  return refreshing;
}
let detecting = false;
async function pollSystem() {
  if (detecting || quitting) return;
  detecting = true;
  try {
    const status = platform.status ? await platform.status() : { accessibility: null, muted: null };
    const next = config.settings.autoSwitch ? await platform.foreground() : foreground;
    const changed = next !== foreground || JSON.stringify(system) !== JSON.stringify({ ...status, error: '' });
    foreground = next; system = { ...status, error: '' };
    updateFeedback();
    if (changed) publish();
    profileNotifier.update(config, foreground);
  } catch (error) {
    const message = String(error);
    if (system.error !== message) log('error', message);
    system = { accessibility: null, muted: null, error: message }; updateFeedback(); publish();
  } finally { detecting = false; }
}
async function start() {
  store = new ConfigStore(app.getPath('userData'));
  try { config = await store.load(); }
  catch (error) { dialog.showErrorBox('Configuration could not be loaded', String(error)); app.quit(); return; }
  registerIPC();
  if (process.platform === 'darwin') app.dock?.setIcon(join(__dirname, '../assets/icon.png'));
  createWindow(); createTray();
  profileOverlay = new ProfileOverlay(join(__dirname, '../preload/index.js'), target => loadPage(target, 'overlay'));
  log('info', `MIDI Deck ${version} · Definition revision ${config.controller.revision ?? 'custom'} · ${store.path}`);
  audioWindow = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  secureWindow(audioWindow); loadPage(audioWindow, 'audio');
  audioWindow.webContents.on('render-process-gone', () => { audioLoaded = false; log('error', 'Synth process stopped. Restart MIDI Deck to restore audio.'); });
  await refreshDevices();
  await pollSystem();
  devicePoll = setInterval(() => void refreshDevices(), 4000);
  poll = setInterval(() => void pollSystem(), 350);
  feedbackTimer = setInterval(() => feedback.flush(), 15);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('MIDI Deck could not start', String(error)); app.quit(); });
  app.on('activate', (_event, hasVisibleWindows) => {
    // Activation is also emitted for auxiliary macOS window lifecycle events.
    // Only reopen a hidden editor; never force application focus from this event.
    if (quitting || !config || hasVisibleWindows || window && !window.isDestroyed() && window.isVisible()) return;
    if (!window || window.isDestroyed()) createWindow();
    window!.show();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; clearInterval(poll); clearInterval(devicePoll); clearInterval(feedbackTimer); clearTimeout(routeTimer); clearTimeout(volumeFeedbackTimer); shortcutRecorder?.dispose(); profileNotifier.close(); profileOverlay?.close(); nativeNotice?.close(); cancelLearn(); feedback.release(); midi.close(); platform.close(); });
}
