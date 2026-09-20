import { z } from 'zod';

export const actionIds = [
  'system.volume.change', 'system.mute', 'media.playPause', 'media.next', 'media.previous',
  'application.launch', 'url.open', 'file.open', 'command.run', 'powershell.run',
  'shortcut.send', 'canvas.zoom', 'canvas.rotate', 'canvas.panX', 'canvas.panY',
  'brush.size', 'timeline.seek', 'profile.switch'
] as const;
export const actionLabels: Record<typeof actionIds[number], string> = {
  'system.volume.change': 'System volume', 'system.mute': 'Toggle mute',
  'media.playPause': 'Play / pause', 'media.next': 'Next track', 'media.previous': 'Previous track',
  'application.launch': 'Launch application', 'url.open': 'Open URL', 'file.open': 'Open file / folder',
  'command.run': 'Run command', 'powershell.run': 'Run PowerShell', 'shortcut.send': 'Keyboard shortcut',
  'canvas.zoom': 'Canvas zoom', 'canvas.rotate': 'Canvas rotation', 'canvas.panX': 'Horizontal pan',
  'canvas.panY': 'Vertical pan', 'brush.size': 'Brush size', 'timeline.seek': 'Timeline step',
  'profile.switch': 'Switch profile'
};
const id = z.string().min(1).max(120);
export const controlSchema = z.object({
  id, name: z.string().min(1).max(100),
  type: z.enum(['cc', 'note-on', 'pitch-bend']),
  channel: z.number().int().min(1).max(16),
  number: z.number().int().min(0).max(127),
  mode: z.enum(['button', 'absolute', 'relative-twos', 'relative-offset', 'relative-sign']),
  sensitivity: z.number().min(0.1).max(10),
  inverted: z.boolean(), acceleration: z.boolean()
});
export const mappingSchema = z.object({
  id, controlId: id, action: z.enum(actionIds),
  parameter: z.string().max(4096), enabled: z.boolean()
});
export const profileSchema = z.object({
  id, name: z.string().min(1).max(80),
  kind: z.enum(['global', 'user', 'application']),
  match: z.string().max(200), adapter: z.enum(['generic', 'affinity', 'opentoonz']),
  mappings: z.array(mappingSchema).max(500)
});
export const configSchema = z.object({
  version: z.literal(1),
  input: z.string().max(300), output: z.string().max(300),
  controller: z.object({ id, name: z.string().min(1).max(100), controls: z.array(controlSchema).max(500) }),
  profiles: z.array(profileSchema).min(1).max(100), activeProfile: id,
  settings: z.object({
    mode: z.enum(['desktop', 'passthrough']), paused: z.boolean(),
    autoSwitch: z.boolean(), startAtLogin: z.boolean(), overlay: z.boolean(),
    synth: z.object({ enabled: z.boolean(), instrument: z.enum(['piano', 'electric', 'organ', 'synth', 'strings']), volume: z.number().min(0).max(1) })
  })
}).superRefine((config, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (new Set(config.profiles.map(p => p.id)).size !== config.profiles.length) fail('Profile IDs must be unique');
  if (config.profiles.filter(p => p.kind === 'global').length !== 1) fail('Exactly one global profile is required');
  if (!config.profiles.some(p => p.id === config.activeProfile && p.kind === 'user')) fail('Select a valid user profile');
  const controls = new Set(config.controller.controls.map(c => c.id));
  if (controls.size !== config.controller.controls.length) fail('Control IDs must be unique');
  const signals = new Set(config.controller.controls.map(c => `${c.type}:${c.channel}:${c.number}`));
  if (signals.size !== config.controller.controls.length) fail('This MIDI input is already assigned to another control; select that control or edit its definition');
  if (config.controller.controls.some(c => c.type === 'pitch-bend' && c.number !== 0)) fail('Pitch-bend controls use number 0');
  for (const p of config.profiles) {
    if (p.kind === 'application' && !p.match.trim()) fail('Application profiles need an executable name');
    if (new Set(p.mappings.map(m => m.controlId)).size !== p.mappings.length) fail('Each control can have only one mapping per profile');
    if (new Set(p.mappings.map(m => m.id)).size !== p.mappings.length) fail('Mapping IDs must be unique');
    if (p.mappings.some(m => !controls.has(m.controlId))) fail('Mapping references an unknown control');
  }
});
export type Config = z.infer<typeof configSchema>;
export type Control = z.infer<typeof controlSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export type Profile = z.infer<typeof profileSchema>;
export interface MidiEvent {
  deviceId: string;
  type: 'note-on' | 'note-off' | 'cc' | 'pitch-bend' | 'other';
  channel: number;
  number: number;
  value: number;
  timestamp: number;
  raw: number[];
}
export interface Activity { id: number; time: number; kind: 'midi' | 'action' | 'info' | 'error'; message: string }
export interface State {
  config: Config;
  inputs: string[]; outputs: string[]; connected: string; backend: string;
  foreground: string; applicationProfile: string; learning: boolean;
  platform: string;
}
export type Notice = { type: 'state'; state: State } | { type: 'activity'; entry: Activity } |
  { type: 'midi'; event: MidiEvent } | { type: 'learn'; event: MidiEvent } | { type: 'overlay'; text: string };
export type AudioMessage = { type: 'midi'; event: MidiEvent } | { type: 'settings'; settings: Config['settings']['synth'] } | { type: 'panic' };
export interface DeckAPI {
  state(): Promise<State>;
  save(config: Config): Promise<State>;
  refresh(): Promise<State>;
  learn(enabled: boolean): Promise<void>;
  panic(): Promise<void>;
  exportConfig(): Promise<boolean>;
  importConfig(): Promise<State | null>;
  subscribe(callback: (notice: Notice) => void): () => void;
  onAudio(callback: (message: AudioMessage) => void): () => void;
  audioReady(): void;
}
