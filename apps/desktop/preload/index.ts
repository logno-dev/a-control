import { contextBridge, ipcRenderer } from 'electron';
import type { DeckAPI, Notice, AudioMessage } from '../../../packages/shared/schema';

const api: DeckAPI = {
  state: () => ipcRenderer.invoke('deck:state'),
  save: config => ipcRenderer.invoke('deck:save', config),
  refresh: () => ipcRenderer.invoke('deck:refresh'),
  learn: enabled => ipcRenderer.invoke('deck:learn', enabled),
  panic: () => ipcRenderer.invoke('deck:panic'),
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
