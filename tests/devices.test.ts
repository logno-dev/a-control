import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ info: { engine: 'node', inputs: [] as { name: string }[], outputs: [{ name: 'MiniLab' }, { name: 'DAW' }] }, open: vi.fn() }));
vi.mock('jzz', () => ({ default: async () => ({ refresh: async () => {}, info: () => mock.info, openMidiOut: mock.open, close: vi.fn() }) }));
import { MidiDevices } from '../packages/midi/devices';

describe('MIDI output isolation', () => {
  it('routes feedback separately, shares identical ports, and reopens disconnected outputs', async () => {
    const ports: Record<string, { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = {};
    mock.open.mockImplementation(async name => ports[name] = { send: vi.fn(), close: vi.fn() });
    const devices = new MidiDevices(vi.fn(), vi.fn());
    await devices.refresh(); await devices.connect('', 'DAW', 'MiniLab');
    devices.send([0x90, 60, 100]); devices.feedback([0xf0, 0x7d, 0xf7]);
    expect(ports.DAW.send).toHaveBeenCalledExactlyOnceWith([0x90, 60, 100]);
    expect(ports.MiniLab.send).toHaveBeenCalledExactlyOnceWith([0xf0, 0x7d, 0xf7]);
    await devices.connect('', 'MiniLab', 'MiniLab');
    expect(mock.open).toHaveBeenCalledTimes(2); expect(ports.DAW.close).toHaveBeenCalledOnce();
    mock.info.outputs = []; await devices.refresh();
    expect(devices.feedbackName).toBe(''); expect(devices.feedback([0xf8])).toBe(false);
    mock.info.outputs = [{ name: 'MiniLab' }]; await devices.refresh(); await devices.connect('', '', 'MiniLab');
    expect(mock.open).toHaveBeenCalledTimes(3); expect(devices.feedbackName).toBe('MiniLab');
    devices.close();
  });
});
