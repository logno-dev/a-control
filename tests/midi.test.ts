import { describe, expect, it, vi } from 'vitest';
import { normalize, relativeDelta, EncoderState } from '../packages/midi/normalize';
import { MidiRouter, type RouterPorts } from '../packages/midi/router';
import { defaultConfig } from '../packages/config/defaults';
import type { Control } from '../packages/shared/schema';

const event = (raw: number[], time = 100) => normalize('device', raw, time)!;
function fixture() {
  const ports: RouterPorts = { synth: vi.fn(), action: vi.fn(), learned: vi.fn(), passthrough: vi.fn(), report: vi.fn() };
  return { ports, router: new MidiRouter(ports), config: defaultConfig() };
}
describe('MIDI normalization', () => {
  it('normalizes zero-velocity note-on to note-off with one-based channels', () => {
    expect(event([0x99, 36, 0])).toMatchObject({ type: 'note-off', channel: 10, number: 36, value: 0 });
  });
  it('preserves 14-bit pitch bend and exact raw bytes', () => {
    expect(event([0xe0, 0, 64])).toMatchObject({ type: 'pitch-bend', value: 8192, number: 0, raw: [0xe0, 0, 64] });
    expect(event([0xe0, 127, 127]).value).toBe(16383);
  });
  it('ignores malformed channel messages but retains system data for passthrough', () => {
    expect(normalize('x', [0x90, 60])).toBeNull();
    expect(normalize('x', [0x90, 60, 200])).toBeNull();
    expect(normalize('x', [12])).toBeNull();
    expect(event([0xf8]).type).toBe('other');
  });
});
describe('encoder modes', () => {
  it.each([
    ['relative-offset', 65, 1], ['relative-offset', 63, -1], ['relative-offset', 64, 0], ['relative-offset', 0, 0],
    ['relative-arturia-3', 17, 1], ['relative-arturia-3', 15, -1], ['relative-arturia-3', 0, 0],
    ['relative-twos', 1, 1], ['relative-twos', 127, -1], ['relative-twos', 0, 0],
    ['relative-sign', 1, 1], ['relative-sign', 65, -1], ['relative-sign', 64, 0]
  ] as const)('%s decodes %d as %d', (mode, value, result) => { expect(relativeDelta(value, mode)).toBe(result); });
  it('establishes absolute baselines independently for each device', () => {
    const encoder = new EncoderState();
    const control: Control = { ...defaultConfig().controller.controls[0], mode: 'absolute' };
    expect(encoder.delta(control, event([0xb0, 74, 50]))).toBe(0);
    expect(encoder.delta(control, event([0xb0, 74, 55]))).toBe(5);
    expect(encoder.delta(control, { ...event([0xb0, 74, 100]), deviceId: 'second' })).toBe(0);
  });
  it('applies direction, sensitivity and optional acceleration', () => {
    const encoder = new EncoderState();
    const control = { ...defaultConfig().controller.controls[0], inverted: true, sensitivity: 0.5, acceleration: true };
    expect(encoder.delta(control, event([0xb0, 74, 65], 100))).toBe(-0.5);
    expect(encoder.delta(control, event([0xb0, 74, 65], 120))).toBe(-1);
  });
  it('re-arms pads on nonzero release velocity', () => {
    const encoder = new EncoderState();
    const control = defaultConfig().controller.controls[16];
    expect(encoder.delta(control, event([0x99, 36, 100]))).toBe(1);
    expect(encoder.delta(control, event([0x99, 36, 100]))).toBe(0);
    expect(encoder.delta(control, event([0x89, 36, 64]))).toBe(0);
    expect(encoder.delta(control, event([0x99, 36, 100]))).toBe(1);
  });
});
describe('routing', () => {
  it('plays keys and triggers controls independently', () => {
    const { router, config, ports } = fixture();
    router.route(event([0x90, 60, 100]), config, '');
    router.route(event([0xb0, 112, 65]), config, '');
    expect(ports.synth).toHaveBeenCalledOnce();
    expect(ports.action).toHaveBeenCalledWith(expect.objectContaining({ action: 'system.volume.change' }), 1, expect.objectContaining({ id: 'global' }));
  });
  it('sends all raw MIDI to DAW without synth, actions, or learn side effects', () => {
    const { router, config, ports } = fixture(); config.settings.mode = 'passthrough'; router.learning = true;
    const raw = [0xf0, 1, 2, 0xf7]; router.route(event(raw), config, '');
    expect(ports.passthrough).toHaveBeenCalledWith(raw);
    expect(ports.synth).not.toHaveBeenCalled(); expect(ports.action).not.toHaveBeenCalled(); expect(ports.learned).not.toHaveBeenCalled();
  });
  it('captures learn once without executing the learned input', () => {
    const { router, config, ports } = fixture(); router.learning = true;
    router.route(event([0xb0, 74, 65]), config, '');
    expect(ports.learned).toHaveBeenCalledOnce(); expect(ports.action).not.toHaveBeenCalled(); expect(router.learning).toBe(false);
  });
  it('releases an existing note even if an app override now consumes the key', () => {
    const { router, config, ports } = fixture();
    config.controller.controls.push({ ...config.controller.controls[16], id: 'key', channel: 1, number: 60 });
    config.profiles.find(p => p.id === 'affinity')!.mappings.push({ id: 'key-map', controlId: 'key', action: 'media.playPause', parameter: '', enabled: true });
    router.route(event([0x90, 60, 90]), config, '');
    router.route(event([0x80, 60, 64]), config, 'Photo.exe');
    expect(ports.synth).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'note-off' }));
    expect(ports.action).not.toHaveBeenCalled();
  });
  it('does not send mapped pads to the instrument', () => {
    const { router, config, ports } = fixture();
    router.route(event([0x99, 38, 100]), config, '');
    router.route(event([0x89, 38, 64]), config, '');
    expect(ports.action).toHaveBeenCalledOnce(); expect(ports.synth).not.toHaveBeenCalled();
  });
  it('keeps notes and sustain active while desktop mappings are paused', () => {
    const { router, config, ports } = fixture(); config.settings.paused = true;
    router.route(event([0x90, 60, 100]), config, ''); router.route(event([0xb0, 64, 127]), config, '');
    router.route(event([0xb0, 74, 65]), config, '');
    expect(ports.synth).toHaveBeenCalledTimes(3); expect(ports.action).not.toHaveBeenCalled();
  });
  it('releases sustain during Learn even though zero CC is not learned', () => {
    const { router, config, ports } = fixture(); router.learning = true;
    router.route(event([0xb0, 64, 0]), config, '');
    expect(ports.synth).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'cc', number: 64, value: 0 }));
    expect(router.learning).toBe(true); expect(ports.learned).not.toHaveBeenCalled();
  });
  it('routes both touch strips to synth by default and consumes mapped strips', () => {
    const { router, config, ports } = fixture();
    router.route(event([0xe0, 0, 80]), config, ''); router.route(event([0xb0, 1, 90]), config, '');
    expect(ports.synth).toHaveBeenCalledTimes(2);
    config.profiles[0].mappings.push({ id: 'mod-volume', controlId: 'mod-strip', action: 'system.volume.change', parameter: '', enabled: true });
    router.route(event([0xb0, 1, 50]), config, ''); router.route(event([0xb0, 1, 55]), config, '');
    expect(ports.synth).toHaveBeenCalledTimes(2);
    expect(ports.action).toHaveBeenCalledWith(expect.objectContaining({ action: 'system.volume.change' }), 5, expect.anything());
  });
  it('passes Reset All Controllers through Learn for the Shift+Octave panic combination', () => {
    const { router, config, ports } = fixture(); router.learning = true;
    router.route(event([0xb0, 121, 0]), config, '');
    expect(ports.synth).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'cc', number: 121 }));
  });
  it('routes the real MiniLab CC112 on keyboard channel 8 to system volume', () => {
    const { router, config, ports } = fixture();
    router.route(event([0xb7, 112, 65]), config, '');
    router.route(event([0xb7, 112, 0]), config, '');
    router.route(event([0xb7, 112, 63]), config, '');
    expect(ports.action).toHaveBeenCalledTimes(2);
    expect(ports.action).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'system.volume.change' }), 1, expect.anything());
    expect(ports.action).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: 'system.volume.change' }), -1, expect.anything());
  });
  it('uses absolute movement for ordinary factory encoders and keeps channel baselines separate', () => {
    const { router, config, ports } = fixture();
    config.profiles[0].mappings.push({ id: 'e2-volume', controlId: 'encoder-2', action: 'system.volume.change', parameter: '', enabled: true });
    router.route(event([0xb7, 74, 30]), config, ''); router.route(event([0xb7, 74, 31]), config, '');
    router.route(event([0xb2, 74, 90]), config, ''); router.route(event([0xb2, 74, 89]), config, '');
    expect(ports.action).toHaveBeenCalledTimes(2);
    expect(ports.action).toHaveBeenLastCalledWith(expect.anything(), -1, expect.anything());
  });
  it('maps pitch on channel 8 to the unified Affinity app without undoing zoom on release', () => {
    const { router, config, ports } = fixture();
    config.profiles.find(p => p.id === 'affinity')!.mappings.push({ id: 'pitch-zoom', controlId: 'pitch-strip', action: 'canvas.zoom', parameter: '', enabled: true });
    router.route(event([0xe7, 0, 68]), config, 'Affinity Affinity Store');
    expect(ports.action).not.toHaveBeenCalled(); // Touch-down establishes the origin.
    router.route(event([0xe7, 0, 72]), config, 'Affinity Affinity Store');
    router.route(event([0xe7, 0, 64]), config, 'Affinity Affinity Store');
    expect(ports.action).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'canvas.zoom' }), 0.4, expect.objectContaining({ id: 'affinity' }));
    expect(ports.synth).not.toHaveBeenCalled();
  });
  it('keeps explicit channel assignments ahead of wildcard mappings and reports mismatches', () => {
    const { router, config, ports } = fixture();
    config.controller.controls.push({ ...config.controller.controls[0], id: 'e8', channel: 8 });
    config.profiles[0].mappings.push({ id: 'e8-next', controlId: 'e8', action: 'media.next', parameter: '', enabled: true });
    router.route(event([0xb7, 112, 65]), config, '');
    expect(ports.action).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'media.next' }), 1, expect.anything());
    config.controller.controls[0].channel = 1;
    router.route(event([0xb6, 112, 65]), config, '');
    expect(ports.report).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'channel-mismatch', detail: expect.stringContaining('received 7') }));
  });
});
