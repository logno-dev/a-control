import { configSchema, type Config } from '../shared/schema';
import { factoryEncoders, legacyEncoderCCs, touchControls } from '../controllers/minilab';

// Add hardware metadata without resetting existing MIDI assignments or profile mappings.
export function parseConfig(value: unknown): Config {
  const config = configSchema.parse(value);
  if (config.controller.id !== 'minilab-mkii' || config.controller.revision === 2) return config;
  const previousRevision = config.controller.revision;
  if (previousRevision === undefined) {
  for (const control of config.controller.controls) {
    const pad = /^pad-([1-9]|1[0-6])$/.exec(control.id);
    if (pad) {
      control.surface ??= 'pad';
      const led = Number(pad[1]);
      if (control.led === undefined && !config.controller.controls.some(c => c.led === led)) control.led = led;
    } else if (/^encoder-\d+$/.test(control.id)) control.surface ??= 'encoder';
  }
  for (const touch of touchControls) {
    if (config.controller.controls.some(c => c.id === touch.id || c.surface === touch.surface)) continue;
    const existing = config.controller.controls.find(c => c.type === touch.type && c.number === touch.number);
    if (existing) existing.surface ??= touch.surface;
    else if (config.controller.controls.length < 500) config.controller.controls.push(structuredClone(touch));
  }
  }
  // Only replace the recognizably broken full preset, never a partly learned/custom set.
  const legacy = legacyEncoderCCs.every((number, index) => {
    const c = config.controller.controls.find(c => c.id === `encoder-${index + 1}`);
    return c?.type === 'cc' && c.channel === 1 && c.number === number && c.mode === 'relative-offset';
  });
  const encoderIds = new Set(factoryEncoders.map(c => c.id));
  const conflicts = config.controller.controls.some(c => !encoderIds.has(c.id) && c.channel === 0 && c.type === 'cc' && factoryEncoders.some(e => e.number === c.number));
  if (legacy && !conflicts) for (const factory of factoryEncoders) {
    const c = config.controller.controls.find(c => c.id === factory.id)!;
    Object.assign(c, { number: factory.number, channel: 0, mode: factory.mode });
  }
  for (const touch of touchControls) {
    const c = config.controller.controls.find(c => c.id === touch.id);
    if (c?.type === touch.type && c.number === touch.number && c.channel === 1 && !config.controller.controls.some(other => other.id !== c.id && other.type === c.type && other.number === c.number && other.channel === 0)) c.channel = 0;
  }
  config.controller.revision = 2;
  for (const profile of config.profiles) {
    if (profile.id === 'affinity' && profile.match === 'Photo.exe,Designer.exe,Publisher.exe') profile.match += ',Affinity Photo 2,Affinity Designer 2,Affinity Publisher 2,Affinity Photo,Affinity Designer,Affinity Publisher';
    if (profile.id === 'opentoonz' && profile.match === 'OpenToonz.exe') profile.match += ',OpenToonz';
    if (profile.adapter === 'affinity' && profile.match === 'Photo.exe,Designer.exe,Publisher.exe,Affinity Photo 2,Affinity Designer 2,Affinity Publisher 2,Affinity Photo,Affinity Designer,Affinity Publisher') profile.match += ',Affinity,Affinity Affinity Store';
  }
  return configSchema.parse(config);
}
