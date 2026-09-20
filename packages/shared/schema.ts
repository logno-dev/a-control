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
export const ledColors = ['off', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
export type LedColor = typeof ledColors[number];
export const utilityIds = ['shift', 'bank', 'octave-down', 'octave-up'] as const;
export type UtilityId = typeof utilityIds[number];
const utilityLight = z.enum(['hardware', 'off', 'on']);
export const feedbackSchema = z.object({
  enabled: z.boolean().default(false), output: z.string().max(300).default(''),
  utility: z.object({ shift: utilityLight.default('hardware'), bank: utilityLight.default('hardware'), 'octave-down': utilityLight.default('hardware'), 'octave-up': utilityLight.default('hardware') }).default({})
});
export const controlSchema = z.object({
  id, name: z.string().min(1).max(100),
  type: z.enum(['cc', 'note-on', 'pitch-bend']),
  channel: z.number().int().min(0).max(16), // 0 = any channel (keyboard-following controls).
  number: z.number().int().min(0).max(127),
  mode: z.enum(['button', 'absolute', 'relative-twos', 'relative-offset', 'relative-sign', 'relative-arturia-3']),
  sensitivity: z.number().min(0.1).max(10),
  inverted: z.boolean(), acceleration: z.boolean(),
  ignoreReturn: z.boolean().optional(),
  surface: z.enum(['encoder', 'pad', 'pitch-strip', 'mod-strip', 'button']).optional(),
  led: z.number().int().min(1).max(16).optional()
});
export const mappingSchema = z.object({
  id, controlId: id, action: z.enum(actionIds),
  parameter: z.string().max(4096), enabled: z.boolean(),
  ledColor: z.enum(['auto', ...ledColors]).optional(),
  sensitivity: z.number().min(0.01).max(10).optional()
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
  feedback: feedbackSchema.default({}),
  controller: z.object({ id, name: z.string().min(1).max(100), revision: z.union([z.literal(1), z.literal(2)]).optional(), controls: z.array(controlSchema).max(500) }),
  profiles: z.array(profileSchema).min(1).max(100), activeProfile: id,
  settings: z.object({
    mode: z.enum(['desktop', 'passthrough']), paused: z.boolean(),
    autoSwitch: z.boolean(), startAtLogin: z.boolean(), overlay: z.boolean(),
    nativeNotifications: z.boolean().default(false),
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
  const lights = config.controller.controls.flatMap(c => c.led === undefined ? [] : [c.led]);
  if (new Set(lights).size !== lights.length) fail('Each pad LED can belong to only one control');
  if (config.feedback.enabled && config.controller.id !== 'minilab-mkii') fail('LED feedback currently supports the MiniLab MkII definition only');
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
export interface RoutingStatus {
  event: MidiEvent;
  stage: 'action' | 'waiting' | 'unmapped' | 'channel-mismatch' | 'paused' | 'disabled' | 'learn' | 'passthrough' | 'synth';
  detail: string;
  controlId?: string;
  controlName?: string;
  profileName?: string;
  action?: Mapping['action'];
  delta?: number;
}
export interface State {
  runtime: { version: string; executable: string; applicationPath: string; configPath: string; packaged: boolean; notificationError: string };
  diagnostics: { midiEvents: number; lastMidiAt: number | null; actions: number; lastAction: Activity | null; recentActivity: Activity[] };
  config: Config;
  inputs: string[]; outputs: string[]; connected: string; backend: string;
  foreground: string; applicationProfile: string; learning: boolean;
  platform: string;
  feedbackConnected: string;
  lastRoute: RoutingStatus | null;
  permissionCheck: PermissionCheck | null;
  system: { accessibility: boolean | null; accessibilityTrusted?: boolean; inputPosting?: boolean; processId?: number; processPath?: string; bundleIdentifier?: string; backend?: string; muted: boolean | null; error: string; volume?: number | null; volumeWritable?: boolean; outputName?: string };
}
export interface PermissionCheck {
  checkedAt: number;
  status: 'granted' | 'denied' | 'restart-required' | 'error';
  message: string;
  accessibilityTrusted: boolean | null;
  inputPosting: boolean | null;
  processId: number | null;
  backend: string;
  bundleIdentifier: string;
  keyboardTest?: 'delivered' | 'not-received' | 'not-run';
}
export type Notice = { type: 'state'; state: State } | { type: 'activity'; entry: Activity } |
  { type: 'midi'; event: MidiEvent } | { type: 'learn'; event: MidiEvent } | { type: 'overlay'; text: string; detail?: string; label?: string } | { type: 'route'; route: RoutingStatus } |
  { type: 'shortcut-capture'; status: 'preview' | 'captured' | 'cancelled' | 'error'; text: string };
export type AudioMessage = { type: 'midi'; event: MidiEvent } | { type: 'settings'; settings: Config['settings']['synth'] } | { type: 'panic' };
export interface DeckAPI {
  state(): Promise<State>;
  save(config: Config): Promise<State>;
  refresh(): Promise<State>;
  learn(enabled: boolean): Promise<void>;
  panic(): Promise<void>;
  accessibility(): Promise<void>;
  recheckAccessibility(): Promise<PermissionCheck>;
  revealApplication(): Promise<void>;
  startShortcutCapture(): Promise<void>;
  finishShortcutCapture(): Promise<void>;
  cancelShortcutCapture(): Promise<void>;
  testLights(): Promise<void>;
  resyncLights(): Promise<void>;
  testNotification(): Promise<void>;
  testOverlay(): Promise<void>;
  testVolume(): Promise<void>;
  exportConfig(): Promise<boolean>;
  importConfig(): Promise<State | null>;
  subscribe(callback: (notice: Notice) => void): () => void;
  onAudio(callback: (message: AudioMessage) => void): () => void;
  audioReady(): void;
}
