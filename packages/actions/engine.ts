import { spawn } from 'node:child_process';
import type { Mapping, Profile } from '../shared/schema';
import type { PlatformAdapter } from '../platforms/platform';
import { applicationShortcut } from '../applications/adapter';

export interface ActionHost {
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<string>;
  switchProfile(id: string): Promise<void>;
}
export class ActionEngine {
  private fractions = new Map<string, number>();
  private lastLaunch = new Map<string, number>();
  private running = 0;
  constructor(private platform: PlatformAdapter, private host: ActionHost) {}
  async execute(mapping: Mapping, delta: number, profile: Profile) {
    const key = `${profile.id}:${mapping.id}`;
    const amount = (this.fractions.get(key) ?? 0) + delta;
    const steps = Math.trunc(amount);
    this.fractions.set(key, amount - steps);
    if (!steps) return;
    const count = Math.min(20, Math.abs(steps));
    const positive = steps > 0;
    const parameter = mapping.parameter.trim();
    switch (mapping.action) {
      case 'system.volume.change': return this.platform.media(positive ? 'volumeUp' : 'volumeDown', count);
      case 'system.mute': return this.platform.media('mute');
      case 'media.playPause': return this.platform.media('playPause');
      case 'media.next': return this.platform.media('next');
      case 'media.previous': return this.platform.media('previous');
      case 'shortcut.send': {
        const directions = parameter.split('|');
        return this.platform.shortcut((!positive && directions[1] ? directions[1] : directions[0]).trim(), count);
      }
      case 'canvas.zoom':
      case 'canvas.rotate':
      case 'brush.size':
      case 'timeline.seek': return this.platform.shortcut(applicationShortcut(profile.adapter, mapping.action, positive, parameter), count);
      case 'canvas.panX': return this.platform.scroll(positive ? count : -count, 0);
      case 'canvas.panY': return this.platform.scroll(0, positive ? count : -count);
      case 'profile.switch': return this.host.switchProfile(parameter);
    }
    if (!parameter) throw new Error('This action requires a target or command');
    if (Date.now() - (this.lastLaunch.get(key) ?? 0) < 700) return;
    this.lastLaunch.set(key, Date.now());
    if (mapping.action === 'url.open') {
      const url = new URL(parameter);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('URLs must use http or https');
      return this.host.openExternal(url.href);
    }
    if (mapping.action === 'file.open' || mapping.action === 'application.launch') {
      const error = await this.host.openPath(parameter);
      if (error) throw new Error(error);
      return;
    }
    if (mapping.action === 'powershell.run' && process.platform !== 'win32') throw new Error('PowerShell actions require Windows');
    if (this.running >= 4) throw new Error('Four commands are already running');
    this.running++;
    try {
      await new Promise<void>((resolve, reject) => {
        const child = mapping.action === 'powershell.run'
          ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parameter], { windowsHide: true, stdio: 'ignore' })
          : spawn(parameter, { shell: true, windowsHide: true, stdio: 'ignore' });
        const timeout = setTimeout(() => { child.kill(); reject(new Error('Command exceeded the 30-second limit')); }, 30000);
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Command exited with code ${code}`)); });
      });
    } finally { this.running--; }
  }
}
