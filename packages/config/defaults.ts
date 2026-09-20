import type { Config, Control, Mapping } from '../shared/schema';

// Factory preset values vary with MIDI Control Center settings; Learn is authoritative.
const encoders = [74, 71, 76, 77, 93, 18, 19, 16, 17, 91, 79, 72, 73, 75, 114, 115];
const controls: Control[] = [
  ...encoders.map((number, i): Control => ({ id: `encoder-${i + 1}`, name: `Encoder ${i + 1}`, type: 'cc', channel: 1, number, mode: 'relative-offset', sensitivity: 1, inverted: false, acceleration: false })),
  ...Array.from({ length: 16 }, (_, i): Control => ({ id: `pad-${i + 1}`, name: `Pad ${i + 1}`, type: 'note-on', channel: 10, number: 36 + i, mode: 'button', sensitivity: 1, inverted: false, acceleration: false }))
];
const map = (controlId: string, action: Mapping['action'], parameter = ''): Mapping => ({ id: `${controlId}-${action}`, controlId, action, parameter, enabled: true });
export function defaultConfig(): Config {
  return {
    version: 1, input: '', output: '',
    controller: { id: 'minilab-mkii', name: 'Arturia MiniLab MkII', controls: structuredClone(controls) },
    activeProfile: 'default',
    profiles: [
      { id: 'global', name: 'Global', kind: 'global', match: '', adapter: 'generic', mappings: [map('encoder-1', 'system.volume.change'), map('pad-3', 'media.playPause'), map('pad-4', 'system.mute')] },
      { id: 'default', name: 'Desktop', kind: 'user', match: '', adapter: 'generic', mappings: [] },
      { id: 'art', name: 'Art studio', kind: 'user', match: '', adapter: 'generic', mappings: [map('encoder-1', 'canvas.zoom'), map('encoder-5', 'brush.size')] },
      { id: 'affinity', name: 'Affinity', kind: 'application', match: 'Photo.exe,Designer.exe,Publisher.exe', adapter: 'affinity', mappings: [map('encoder-1', 'canvas.zoom'), map('encoder-5', 'brush.size')] },
      { id: 'opentoonz', name: 'OpenToonz', kind: 'application', match: 'OpenToonz.exe', adapter: 'opentoonz', mappings: [map('encoder-1', 'canvas.zoom'), map('encoder-6', 'timeline.seek')] }
    ],
    settings: { mode: 'desktop', paused: false, autoSwitch: true, startAtLogin: false, overlay: true, synth: { enabled: true, instrument: 'piano', volume: 0.5 } }
  };
}
