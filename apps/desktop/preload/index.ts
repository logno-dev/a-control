import { contextBridge, ipcRenderer } from 'electron';
import type { DeckAPI, Notice, AudioMessage } from '../../../packages/shared/schema';

const api: DeckAPI = {
  state: () => ipcRenderer.invoke('deck:state'),
  save: config => ipcRenderer.invoke('deck:save', config),
  refresh: () => ipcRenderer.invoke('deck:refresh'),
  learn: enabled => ipcRenderer.invoke('deck:learn', enabled),
  panic: () => ipcRenderer.invoke('deck:panic'),
  accessibility: () => ipcRenderer.invoke('deck:accessibility'),
  recheckAccessibility: () => ipcRenderer.invoke('deck:recheck-accessibility'),
  revealApplication: () => ipcRenderer.invoke('deck:reveal-application'),
  startShortcutCapture: () => ipcRenderer.invoke('deck:shortcut-start'),
  finishShortcutCapture: () => ipcRenderer.invoke('deck:shortcut-finish'),
  cancelShortcutCapture: () => ipcRenderer.invoke('deck:shortcut-cancel'),
  testLights: () => ipcRenderer.invoke('deck:test-lights'),
  resyncLights: () => ipcRenderer.invoke('deck:resync-lights'),
  testNotification: () => ipcRenderer.invoke('deck:test-notification'),
  testOverlay: () => ipcRenderer.invoke('deck:test-overlay'),
  testVolume: () => ipcRenderer.invoke('deck:test-volume'),
  exportConfig: () => ipcRenderer.invoke('deck:export'),
  importConfig: () => ipcRenderer.invoke('deck:import'),
  subscribe: callback => {
    const listener = (_event: Electron.IpcRendererEvent, notice: Notice) => callback(notice);
    ipcRenderer.on('deck:notice', listener);
    return () => { ipcRenderer.removeListener('deck:notice', listener); };
  },
  onAudio: callback => {
    const listener = (_event: Electron.IpcRendererEvent, message: AudioMessage) => callback(message);
    ipcRenderer.on('deck:audio', listener);
    return () => { ipcRenderer.removeListener('deck:audio', listener); };
  },
  audioReady: () => ipcRenderer.send('deck:audio-ready')
};
contextBridge.exposeInMainWorld('deck', api);
