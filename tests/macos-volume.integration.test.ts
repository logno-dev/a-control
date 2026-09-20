import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { MacOSAdapter } from '../packages/platforms/macos';
import { MidiRouter } from '../packages/midi/router';
import { ActionEngine } from '../packages/actions/engine';
import { defaultConfig } from '../packages/config/defaults';
import { normalize } from '../packages/midi/normalize';

// Explicitly opt in: exercises actual system volume, then restores the original level.
it.skipIf(process.platform !== 'darwin' || process.env.MIDI_DECK_TEST_VOLUME !== '1')('routes a channel-8 MiniLab encoder packet to real CoreAudio volume and restores it', async () => {
  const platform = new MacOSAdapter(resolve('out/native/midi-deck-macos'));
  const before = await platform.status();
  const wait = () => new Promise(resolve => setTimeout(resolve, 150));
  const direction = before.volume !== null && before.volume > 0.95 ? -1 : 1;
  try {
    expect(before.volumeWritable).toBe(true); expect(before.volume).not.toBeNull();
    const engine = new ActionEngine(platform, { openExternal: async () => {}, openPath: async () => '', switchProfile: async () => {} });
    const requests: Promise<void>[] = [];
    const router = new MidiRouter({ synth() {}, learned() {}, passthrough() {}, action: (mapping, delta, profile) => { requests.push(engine.execute(mapping, delta, profile)); } });
    router.route(normalize('Arturia MiniLab mkII', [0xb7, 112, direction > 0 ? 65 : 63])!, defaultConfig(), '');
    expect(requests).toHaveLength(1); await Promise.all(requests); await wait();
    const after = await platform.status();
    expect(after.outputName).toBe(before.outputName);
    expect(after.volume!).toBeCloseTo(before.volume! + direction * 0.02, 2);
  } finally {
    const now = await platform.status();
    if (now.outputName === before.outputName && now.volume !== null && before.volume !== null && Math.abs(now.volume - before.volume - direction * 0.02) < 0.005) {
      await platform.media(direction > 0 ? 'volumeDown' : 'volumeUp'); await wait();
      expect((await platform.status()).volume!).toBeCloseTo(before.volume, 2);
    }
    platform.close();
  }
}, 10000);
