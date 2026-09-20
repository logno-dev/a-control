import { describe, expect, it, vi } from 'vitest';
import { MiniLabFeedback, ledMessage, mappingColor } from '../packages/controllers/feedback';
import { defaultConfig } from '../packages/config/defaults';
import { normalize } from '../packages/midi/normalize';
import { parseConfig } from '../packages/config/migration';
import { configSchema } from '../packages/shared/schema';
import { legacyEncoderCCs } from '../packages/controllers/minilab';

describe('MiniLab protocol', () => {
  it('encodes the first and second banks and utility lights', () => {
    expect(ledMessage(0x70, 'red')).toEqual([0xf0, 0, 0x20, 0x6b, 0x7f, 0x42, 2, 0, 0x10, 0x70, 1, 0xf7]);
    expect(ledMessage(0x7f, 'cyan').slice(-3)).toEqual([0x7f, 0x14, 0xf7]);
    expect(ledMessage(0x2e, 'white').slice(-3)).toEqual([0x2e, 127, 0xf7]);
    expect(ledMessage(0x10, 'off').slice(-3)).toEqual([0x10, 0, 0xf7]);
    expect(() => ledMessage(0x12, 'red')).toThrow();
    expect(() => ledMessage(0x2e, 'red')).toThrow('on/off');
  });
});
describe('LED feedback lifecycle', () => {
  function fixture() {
    const config = defaultConfig(); config.feedback.enabled = true; config.feedback.output = 'MiniLab';
    const send = vi.fn((_raw: number[]) => true);
    let time = 1000;
    const feedback = new MiniLabFeedback(send, () => time);
    const flush = () => { for (let i = 0; i < 24; i++) feedback.flush(); };
    return { config, send, feedback, flush, advance: (amount: number) => { time += amount; } };
  }
  it('updates both banks and leaves hardware utility indicators alone by default', () => {
    const { config, send, feedback, flush } = fixture();
    feedback.update(config, '', null, true); flush();
    expect(send).toHaveBeenCalledTimes(16);
    expect(send.mock.calls.every(([raw]) => raw[9] >= 0x70 && raw[9] <= 0x7f)).toBe(true);
    flush(); expect(send).toHaveBeenCalledTimes(16);
  });
  it('uses app overrides, real mute state, and explicit colors', () => {
    const { config, send, feedback, flush } = fixture();
    feedback.update(config, '', true, true); flush();
    expect(send).toHaveBeenCalledWith(ledMessage(0x73, 'red'));
    feedback.update(config, '', false, true); flush();
    expect(send).toHaveBeenLastCalledWith(ledMessage(0x73, 'green'));
    config.profiles.find(p => p.id === 'affinity')!.mappings.push({ ...config.profiles[0].mappings[1], id: 'override', ledColor: 'blue' });
    feedback.update(config, 'Affinity Photo 2', false, true); flush();
    expect(send).toHaveBeenLastCalledWith(ledMessage(0x72, 'blue'));
  });
  it('pulses learned pads then restores current resolved colors', () => {
    const { config, send, feedback, flush, advance } = fixture();
    feedback.update(config, '', null, true); flush();
    feedback.input(normalize('MiniLab', [0x99, 38, 100])!, config, true); feedback.flush();
    expect(send).toHaveBeenLastCalledWith(ledMessage(0x72, 'cyan'));
    advance(300); flush(); expect(send).toHaveBeenLastCalledWith(ledMessage(0x72, 'green'));
  });
  it('coalesces updates, suspends in DAW mode, and replays after reconnect', () => {
    const { config, send, feedback, flush } = fixture();
    feedback.update(config, '', true, true); feedback.update(config, '', false, true); flush();
    expect(send).not.toHaveBeenCalledWith(ledMessage(0x73, 'red'));
    config.settings.mode = 'passthrough'; feedback.update(config, '', false, true);
    send.mockClear(); feedback.flush(); expect(send).not.toHaveBeenCalled();
    expect(() => feedback.test()).toThrow('Desktop mode');
    config.settings.mode = 'desktop'; feedback.invalidate(); feedback.update(config, '', false, true); flush();
    expect(send).toHaveBeenCalledTimes(16);
  });
  it('allows utility light overrides without giving them fabricated MIDI inputs', () => {
    const { config, send, feedback, flush } = fixture(); config.feedback.utility.shift = 'on';
    feedback.update(config, '', null, true); flush();
    expect(send).toHaveBeenCalledWith(ledMessage(0x2e, 'white'));
    config.feedback.utility.shift = 'hardware'; feedback.update(config, '', null, true); flush();
    expect(send).toHaveBeenLastCalledWith(ledMessage(0x2e, 'off'));
    expect(config.controller.controls.some(c => c.id === 'shift')).toBe(false);
  });
  it('shows active profile switches and does not invent mute state', () => {
    const config = defaultConfig();
    expect(mappingColor(config, config.profiles[0].mappings[2], null)).toBe('yellow');
    expect(mappingColor(config, { id: 'x', controlId: 'pad-1', action: 'profile.switch', parameter: 'Desktop', enabled: true }, null)).toBe('white');
  });
});
describe('existing configuration upgrades', () => {
  it('adds strips, LED metadata, and Mac app names without changing mappings or MIDI values', () => {
    const previous: any = defaultConfig(); delete previous.feedback; delete previous.controller.revision;
    previous.controller.controls = previous.controller.controls.slice(0, 32).map(({ surface, led, ...control }: any) => control);
    previous.controller.controls[0].number = 8;
    previous.profiles[3].match = 'Photo.exe,Designer.exe,Publisher.exe';
    const upgraded = parseConfig(previous);
    expect(upgraded.controller.controls).toHaveLength(34);
    expect(upgraded.controller.controls[0].number).toBe(8);
    expect(upgraded.profiles[0].mappings).toEqual(previous.profiles[0].mappings);
    expect(upgraded.feedback.enabled).toBe(false);
    expect(upgraded.controller.controls[16].led).toBe(1);
    expect(upgraded.profiles[3].match).toContain('Affinity Photo 2');
    expect(parseConfig(upgraded)).toEqual(upgraded);
  });
  it('preserves reassigned touch channels and does not re-add removed LED assignments', () => {
    const config = defaultConfig(); config.controller.controls.find(c => c.id === 'pitch-strip')!.channel = 4;
    delete config.controller.controls[16].led;
    const parsed = parseConfig(config);
    expect(parsed.controller.controls.find(c => c.id === 'pitch-strip')!.channel).toBe(4);
    expect(parsed.controller.controls[16].led).toBeUndefined();
  });
  it('rejects ambiguous LEDs and enabling the MiniLab protocol for unrelated definitions', () => {
    const config = defaultConfig(); config.controller.controls[17].led = 1;
    expect(configSchema.safeParse(config).success).toBe(false);
    const generic = defaultConfig(); generic.controller.id = 'generic'; generic.feedback.enabled = true;
    expect(configSchema.safeParse(generic).success).toBe(false);
  });
  it('repairs the old complete encoder preset while preserving actions and partial custom definitions', () => {
    const old = defaultConfig(); old.controller.revision = 1;
    for (let index = 0; index < 16; index++) Object.assign(old.controller.controls[index], { number: legacyEncoderCCs[index], channel: 1, mode: 'relative-offset' });
    old.controller.controls.find(c => c.id === 'pitch-strip')!.channel = 1;
    old.profiles.find(p => p.id === 'affinity')!.match = 'Photo.exe,Designer.exe,Publisher.exe,Affinity Photo 2,Affinity Designer 2,Affinity Publisher 2,Affinity Photo,Affinity Designer,Affinity Publisher';
    const repaired = parseConfig(old);
    expect(repaired.controller.controls[0]).toMatchObject({ number: 112, channel: 0, mode: 'relative-offset' });
    expect(repaired.controller.controls[1]).toMatchObject({ number: 74, channel: 0, mode: 'absolute' });
    expect(repaired.controller.controls[8]).toMatchObject({ number: 114, channel: 0, mode: 'relative-offset' });
    expect(repaired.controller.controls.find(c => c.id === 'pitch-strip')!.channel).toBe(0);
    expect(repaired.profiles[0].mappings).toEqual(old.profiles[0].mappings);
    expect(repaired.profiles.find(p => p.id === 'affinity')!.match).toContain('Affinity Affinity Store');
    old.controller.controls[0].number = 8;
    expect(parseConfig(old).controller.controls[0]).toMatchObject({ number: 8, channel: 1 });
  });
});
