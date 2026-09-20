import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { join } from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { configSchema, actionLabels, type AudioMessage, type Config, type Notice, type State } from '../../../packages/shared/schema';
import { ConfigStore } from '../../../packages/config/storage';
import { MidiDevices } from '../../../packages/midi/devices';
import { MidiRouter } from '../../../packages/midi/router';
import { applicationProfile } from '../../../packages/profiles/resolver';
import { createPlatform } from '../../../packages/platforms/platform';
import { ActionEngine } from '../../../packages/actions/engine';

app.setName('MIDI Deck');
if (!app.isPackaged && process.env.MIDI_DECK_DATA_DIR) app.setPath('userData', process.env.MIDI_DECK_DATA_DIR);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let window: BrowserWindow | undefined;
let audioWindow: BrowserWindow | undefined;
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
const platform = createPlatform();
const broadcast = (notice: Notice) => { if (window && !window.isDestroyed()) window.webContents.send('deck:notice', notice); };
const log = (kind: 'info' | 'error' | 'action', message: string) => {
  broadcast({ type: 'activity', entry: { id: ++counter, time: Date.now(), kind, message } });
  if (kind === 'error') console.error(message);
};
const audio = (message: AudioMessage) => { if (audioLoaded && audioWindow && !audioWindow.isDestroyed()) audioWindow.webContents.send('deck:audio', message); };
const midi = new MidiDevices(event => {
  broadcast({ type: 'midi', event });
  router.route(event, config, foreground);
}, message => log('error', message));
const router = new MidiRouter({
  synth: event => audio({ type: 'midi', event }),
  passthrough: raw => midi.send(raw),
  action: (mapping, delta, profile) => {
    void actions.execute(mapping, delta, profile).then(() => log('action', `${profile.name} · ${actionLabels[mapping.action]} ${delta > 0 ? '+' : ''}${delta}`)).catch(error => log('error', String(error)));
  },
  learned: event => { clearTimeout(learnTimer); broadcast({ type: 'learn', event }); publish(); }
});
const actions = new ActionEngine(platform, {
  openExternal: url => shell.openExternal(url), openPath: path => shell.openPath(path),
  switchProfile: async id => {
    const profile = config.profiles.find(p => p.kind === 'user' && (p.id === id || p.name === id));
    if (!profile) throw new Error(`User profile not found: ${id}`);
    await queueSave({ ...config, activeProfile: profile.id });
  }
});
const state = (): State => ({ config, inputs: midi.inputs, outputs: midi.outputs, connected: midi.connected, backend: midi.backend, foreground,
  applicationProfile: applicationProfile(config, foreground)?.id ?? '', learning: router.learning, platform: process.platform });
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
  const next = configSchema.parse(value);
  if (next.settings.mode === 'passthrough' && (!next.output || !midi.outputs.includes(next.output))) throw new Error('Select an available MIDI output before enabling passthrough');
  const oldProfile = config.activeProfile;
  await store.save(next);
  panic(); cancelLearn();
  const loginChanged = config.settings.startAtLogin !== next.settings.startAtLogin;
  config = next;
  if (loginChanged && ['win32', 'darwin'].includes(process.platform)) app.setLoginItemSettings({ openAtLogin: config.settings.startAtLogin, args: ['--hidden'] });
  try { await midi.connect(config.input, config.output); } catch (error) { log('error', `MIDI connection: ${String(error)}`); }
  audio({ type: 'settings', settings: config.settings.synth });
  updateTray(); publish();
  if (oldProfile !== config.activeProfile && config.settings.overlay) broadcast({ type: 'overlay', text: `Profile · ${config.profiles.find(p => p.id === config.activeProfile)?.name}` });
  return state();
}
function loadPage(target: BrowserWindow, page: 'index' | 'audio') {
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) void target.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`);
  else void target.loadFile(join(__dirname, `../renderer/${page}.html`));
}
function secureWindow(target: BrowserWindow) {
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', event => event.preventDefault());
  target.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
function createWindow() {
  window = new BrowserWindow({ width: 1320, height: 900, minWidth: 980, minHeight: 700, show: false, backgroundColor: '#101214', title: 'MIDI Deck',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  secureWindow(window);
  window.on('close', event => { if (!quitting) { event.preventDefault(); window?.hide(); cancelLearn(); } });
  window.on('ready-to-show', () => { if (!process.argv.includes('--hidden')) window?.show(); });
  window.setMenuBarVisibility(false);
  loadPage(window, 'index');
}
function showWindow() { if (!window || window.isDestroyed()) createWindow(); window!.show(); window!.focus(); }
function updateTray() {
  if (!tray) return;
  tray.setToolTip(`MIDI Deck · ${midi.connected || 'No controller'}`);
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
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const bar = x >= 4 && x < 28 && (x % 8 < 5) && y >= (x < 12 ? 10 : x < 20 ? 4 : 14) && y < 28;
    if (bar) { const i = (y * size + x) * 4; pixels[i] = 168; pixels[i + 1] = 231; pixels[i + 2] = 201; pixels[i + 3] = 255; }
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size }).resize({ width: 16, height: 16 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
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
    cancelLearn(); router.learning = enabled;
    if (enabled) learnTimer = setTimeout(() => { cancelLearn(); publish(); log('info', 'MIDI Learn timed out'); }, 30000);
    publish();
  });
  handle('deck:panic', panic);
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
    const imported = configSchema.parse(JSON.parse(await readFile(file, 'utf8')));
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
    try {
      await midi.refresh();
      if (previous && previous !== midi.connected) panic();
      await midi.connect(config.input, config.output);
      updateTray(); publish();
    } catch (error) { log('error', `MIDI: ${String(error)}`); }
  });
  mutation = operation.then(() => {}, () => {});
  refreshing = operation.finally(() => { refreshing = undefined; });
  return refreshing;
}
async function start() {
  store = new ConfigStore(app.getPath('userData'));
  try { config = await store.load(); }
  catch (error) { dialog.showErrorBox('Configuration could not be loaded', String(error)); app.quit(); return; }
  registerIPC();
  createWindow(); createTray();
  audioWindow = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  secureWindow(audioWindow); loadPage(audioWindow, 'audio');
  audioWindow.webContents.on('render-process-gone', () => { audioLoaded = false; log('error', 'Synth process stopped. Restart MIDI Deck to restore audio.'); });
  await refreshDevices();
  devicePoll = setInterval(() => void refreshDevices(), 4000);
  let detecting = false;
  poll = setInterval(async () => {
    if (detecting || !config.settings.autoSwitch) return;
    detecting = true;
    try {
      const next = await platform.foreground();
      if (next !== foreground) {
        const previous = applicationProfile(config, foreground)?.id;
        foreground = next; publish();
        const profile = applicationProfile(config, foreground);
        if (previous !== profile?.id && config.settings.overlay) broadcast({ type: 'overlay', text: `Active · ${profile?.name ?? config.profiles.find(p => p.id === config.activeProfile)?.name}` });
      }
    } catch (error) { log('error', String(error)); }
    finally { detecting = false; }
  }, 1000);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('MIDI Deck could not start', String(error)); app.quit(); });
  app.on('activate', () => { if (config) showWindow(); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; clearInterval(poll); clearInterval(devicePoll); cancelLearn(); midi.close(); platform.close(); });
}
