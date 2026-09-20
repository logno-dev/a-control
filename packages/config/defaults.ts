import type { Config, Control, Mapping } from '../shared/schema';
import { factoryEncoders, touchControls } from '../controllers/minilab';

// Factory preset values vary with MIDI Control Center settings; Learn is authoritative.
const controls: Control[] = [
  ...factoryEncoders,
  ...Array.from({ length: 16 }, (_, i): Control => ({ id: `pad-${i + 1}`, name: `Pad ${i + 1}`, type: 'note-on', channel: 10, number: 36 + i, mode: 'button', sensitivity: 1, inverted: false, acceleration: false, surface: 'pad', led: i + 1 })),
  ...touchControls
];
const map = (controlId: string, action: Mapping['action'], parameter = ''): Mapping => ({ id: `${controlId}-${action}`, controlId, action, parameter, enabled: true });
export function defaultConfig(): Config {
  return {
    version: 1, input: '', output: '',
    feedback: { enabled: false, output: '', utility: { shift: 'hardware', bank: 'hardware', 'octave-down': 'hardware', 'octave-up': 'hardware' } },
    controller: { id: 'minilab-mkii', name: 'Arturia MiniLab MkII', revision: 2, controls: structuredClone(controls) },
    activeProfile: 'default',
    profiles: [
      { id: 'global', name: 'Global', kind: 'global', match: '', adapter: 'generic', mappings: [map('encoder-1', 'system.volume.change'), map('pad-3', 'media.playPause'), map('pad-4', 'system.mute')] },
      { id: 'default', name: 'Desktop', kind: 'user', match: '', adapter: 'generic', mappings: [] },
      { id: 'art', name: 'Art studio', kind: 'user', match: '', adapter: 'generic', mappings: [map('encoder-1', 'canvas.zoom'), map('encoder-5', 'brush.size')] },
      { id: 'affinity', name: 'Affinity', kind: 'application', match: 'Photo.exe,Designer.exe,Publisher.exe,Affinity Photo 2,Affinity Designer 2,Affinity Publisher 2,Affinity Photo,Affinity Designer,Affinity Publisher,Affinity,Affinity Affinity Store', adapter: 'affinity', mappings: [map('encoder-1', 'canvas.zoom'), map('encoder-5', 'brush.size')] },
      { id: 'opentoonz', name: 'OpenToonz', kind: 'application', match: 'OpenToonz.exe,OpenToonz', adapter: 'opentoonz', mappings: [map('encoder-1', 'canvas.zoom'), map('encoder-6', 'timeline.seek')] }
    ],
    settings: { mode: 'desktop', paused: false, autoSwitch: true, startAtLogin: false, overlay: false, nativeNotifications: false, synth: { enabled: true, instrument: 'piano', volume: 0.5 } }
  };
}
