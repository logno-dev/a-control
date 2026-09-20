import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export interface NativeBridge { call(request: string): string }
const load = createRequire(resolve(process.execPath, '../midi-deck-native-loader.cjs'));
export function loadNativeBridge(path: string): NativeBridge {
  try {
    const bridge = load(path) as NativeBridge;
    if (typeof bridge.call !== 'function') throw new Error('Missing native entry point');
    return bridge;
  } catch (error) {
    throw new Error(`Cannot load the in-process macOS integration at ${path}: ${String(error)}. Rebuild or reinstall MIDI Deck.`);
  }
}
