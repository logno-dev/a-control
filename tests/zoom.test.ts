import { expect, it, vi } from 'vitest';
import { defaultConfig } from '../packages/config/defaults';
import { EncoderState, normalize } from '../packages/midi/normalize';
import { MidiRouter } from '../packages/midi/router';
import { ActionEngine } from '../packages/actions/engine';
import type { PlatformAdapter } from '../packages/platforms/platform';
import { applicationShortcut } from '../packages/applications/adapter';
import { defaultActionSensitivity } from '../packages/actions/sensitivity';

it('uses each touch contact as a relative origin instead of jumping from pitch center', () => {
  const state = new EncoderState(); const control = defaultConfig().controller.controls.find(c => c.id === 'pitch-strip')!;
  const event = (value: number, time: number) => normalize('MiniLab', [0xe7, value & 127, value >> 7], time)!;
  expect(state.delta(control, event(100, 100))).toBe(0);
  expect(state.delta(control, event(228, 110))).toBe(1);
  expect(state.delta(control, event(100, 120))).toBe(-1);
  expect(state.delta(control, event(8192, 130))).toBe(0);
  expect(state.delta(control, event(14000, 200))).toBe(0); // New contact, not a 45-step jump.
  expect(state.delta(control, event(13872, 210))).toBe(-1);
  expect(state.delta(control, event(2000, 700))).toBe(0); // Idle gesture reset.
});

it('slows relative zoom to four detents per step, limits bursts, and reverses direction', async () => {
  const config = defaultConfig();
  const shortcut = vi.fn(async () => {});
  const platform = { shortcut, media: vi.fn(), scroll: vi.fn(), foreground: vi.fn(), close: vi.fn() } as PlatformAdapter;
  let now = 1000;
  const engine = new ActionEngine(platform, { openExternal: async () => {}, openPath: async () => '', switchProfile: async () => {} }, () => now);
  const work: Promise<void>[] = [];
  const router = new MidiRouter({ synth() {}, passthrough() {}, learned() {}, action: (m, delta, p) => { work.push(engine.execute(m, delta, p)); } });
  for (let i = 0; i < 4; i++) router.route(normalize('MiniLab', [0xb7, 112, 65], now + i)!, config, 'Affinity Affinity Store');
  await Promise.all(work);
  expect(shortcut).toHaveBeenCalledExactlyOnceWith(process.platform === 'darwin' ? 'Primary+Add' : 'Primary+Plus', 1);
  for (let i = 0; i < 50; i++) router.route(normalize('MiniLab', [0xb7, 112, 67], now + i)!, config, 'Affinity Affinity Store');
  await Promise.all(work);
  expect(shortcut).toHaveBeenCalledTimes(1); // No flood or backlog of queued zoom keys.
  now += 150;
  for (let i = 0; i < 4; i++) router.route(normalize('MiniLab', [0xb7, 112, 63], now + i)!, config, 'Affinity Affinity Store');
  await Promise.all(work);
  expect(shortcut).toHaveBeenLastCalledWith('Primary+Minus', 1);
  expect(shortcut).toHaveBeenCalledTimes(2);
});

it('uses the verified Affinity keypad binding on macOS and distinct dial/strip speeds', () => {
  expect(applicationShortcut('affinity', 'canvas.zoom', true, '', 'darwin')).toBe('Primary+Add');
  expect(applicationShortcut('affinity', 'canvas.zoom', false, '', 'darwin')).toBe('Primary+Minus');
  expect(applicationShortcut('affinity', 'canvas.zoom', true, '', 'win32')).toBe('Primary+Plus');
  expect(applicationShortcut('affinity', 'canvas.zoom', true, 'Cmd+1 | Cmd+2', 'darwin')).toBe('Cmd+1');
  expect(defaultActionSensitivity('canvas.zoom', 'relative-offset')).toBe(0.25);
  expect(defaultActionSensitivity('canvas.zoom', 'absolute')).toBe(0.1);
  expect(defaultActionSensitivity('canvas.zoom', 'button')).toBe(1);
});

it('keeps volume sensitivity unchanged and zoom buttons at one step per press', () => {
  const config = defaultConfig(); const action = vi.fn();
  const router = new MidiRouter({ synth() {}, passthrough() {}, learned() {}, action });
  router.route(normalize('MiniLab', [0xb7, 112, 65])!, config, 'Finder');
  expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'system.volume.change' }), 1, expect.anything());
  config.profiles[0].mappings.push({ id: 'pad-zoom', controlId: 'pad-1', action: 'canvas.zoom', enabled: true, parameter: '' });
  router.route(normalize('MiniLab', [0x99, 36, 100])!, config, 'Finder');
  expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'canvas.zoom' }), 1, expect.anything());
});
