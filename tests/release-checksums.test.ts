import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const { createChecksums } = createRequire(resolve('package.json'))('./scripts/checksums.cjs') as { createChecksums(directory: string): number };
it('uses the exact GitHub download filenames in the checksum manifest and is repeatable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'midi-deck-checksums-'));
  try {
    writeFileSync(join(directory, 'MIDI Deck-0.2.5-win-x64.exe'), 'hello');
    expect(createChecksums(directory)).toBe(1);
    expect(existsSync(join(directory, 'MIDI.Deck-0.2.5-win-x64.exe'))).toBe(true);
    expect(readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  MIDI.Deck-0.2.5-win-x64.exe\n');
    expect(createChecksums(directory)).toBe(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it('refuses to overwrite colliding release assets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'midi-deck-checksums-'));
  try {
    writeFileSync(join(directory, 'MIDI Deck.exe'), 'first');
    writeFileSync(join(directory, 'MIDI.Deck.exe'), 'second');
    expect(() => createChecksums(directory)).toThrow('filename collision');
    expect(readFileSync(join(directory, 'MIDI Deck.exe'), 'utf8')).toBe('first');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
