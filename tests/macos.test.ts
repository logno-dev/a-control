import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { MacOSAdapter, parseMacShortcut } from '../packages/platforms/macos';
import { parseShortcut } from '../packages/platforms/platform';
import { permissionResult } from '../packages/platforms/macos/permissions';
import { loadNativeBridge } from '../packages/platforms/macos/native-bridge';

describe('macOS shortcuts', () => {
  it('distinguishes Command, Control, and cross-platform Primary', () => {
    expect(parseMacShortcut('Cmd+Shift+S')).toEqual({ key: 1, flags: 0x120000 });
    expect(parseMacShortcut('Ctrl+S')).toEqual({ key: 1, flags: 0x40000 });
    expect(parseMacShortcut('Primary+S')).toEqual(parseMacShortcut('Command+S'));
    expect(parseShortcut('Primary+S')).toEqual([17, 83]);
    expect(parseMacShortcut('a')).toEqual({ key: 0, flags: 0 });
  });
  it('supports navigation, punctuation, and function keys', () => {
    expect(parseMacShortcut('Option+Right')).toEqual({ key: 124, flags: 0x80000 });
    expect(parseMacShortcut('Primary+Plus')).toEqual({ key: 24, flags: 0x100000, literalPlus: true });
    expect(parseMacShortcut('Cmd+Shift+Plus')).toEqual({ key: 24, flags: 0x120000, literalPlus: true });
    expect(parseMacShortcut('Primary+Equals')).toEqual({ key: 24, flags: 0x100000 });
    expect(parseMacShortcut('F12').key).toBe(111);
    expect(parseMacShortcut('Add').key).toBe(69);
  });
  it('rejects malformed shortcuts before input injection', () => {
    for (const value of ['Cmd++S', 'Cmd+NotAKey', 'Foo+S', 'Cmd', 'A+B']) expect(() => parseMacShortcut(value)).toThrow();
  });
});

describe.skipIf(process.platform !== 'darwin')('native macOS helper', () => {
  it('loads production integration into the checking process instead of a helper', async () => {
    const adapter = new MacOSAdapter(resolve('out/native/midi-deck-macos.node'));
    try {
      const status = await adapter.status();
      expect(status.backend).toBe('in-process');
      expect(status.processId).toBe(process.pid);
      expect(typeof status.accessibilityTrusted).toBe('boolean');
      expect(typeof status.inputPosting).toBe('boolean');
      expect(status.accessibility).toBe(status.inputPosting);
      expect(typeof await adapter.foreground()).toBe('string');
    } finally { adapter.close(); }
  });
  it('rejects invalid native requests and missing production modules visibly', async () => {
    const bridge = loadNativeBridge(resolve('out/native/midi-deck-macos.node'));
    expect(JSON.parse(bridge.call('{"id":1,"method":"unknown"}')).error).toBe('Unknown operation');
    expect(() => bridge.call('x'.repeat(65537))).toThrow('Invalid native request size');
    const adapter = new MacOSAdapter('/nonexistent/midi-deck-macos.node');
    await expect(adapter.status()).rejects.toThrow('Cannot load the in-process macOS integration');
    adapter.close();
  });
  it('reads foreground and permission/mute state without changing system settings', async () => {
    const executable = resolve('out/native/midi-deck-macos');
    expect(existsSync(executable), 'Run npm run build:native before native tests').toBe(true);
    const adapter = new MacOSAdapter(executable);
    try {
      const status = await adapter.status();
      expect(typeof status.accessibility).toBe('boolean');
      expect([true, false, null]).toContain(status.muted);
      expect(typeof await adapter.foreground()).toBe('string');
      const results = await Promise.all([adapter.status(), adapter.foreground(), adapter.status()]);
      expect(results).toHaveLength(3);
    } finally { adapter.close(); }
  });
  it('reports a missing helper and settles pending requests', async () => {
    const adapter = new MacOSAdapter('/nonexistent/midi-deck-macos');
    try { await expect(adapter.foreground()).rejects.toThrow('macOS helper'); }
    finally { adapter.close(); }
  });
});

describe('permission check results', () => {
  const actor = { backend: 'in-process', processId: 123, bundleIdentifier: 'dev.midideck.desktop' };
  it('reports granted keyboard posting independently of AX tree access', () => {
    expect(permissionResult({ ...actor, inputPosting: true, accessibilityTrusted: false }, 123, 100)).toMatchObject({ status: 'granted', checkedAt: 100, accessibilityTrusted: false, inputPosting: true });
  });
  it('distinguishes denial from a running process that needs restarting', () => {
    expect(permissionResult({ ...actor, inputPosting: false, accessibilityTrusted: false }, 123).status).toBe('denied');
    expect(permissionResult({ ...actor, inputPosting: false, accessibilityTrusted: true }, 123)).toMatchObject({ status: 'restart-required', message: expect.stringContaining('Quit MIDI Deck') });
  });
  it('never mistakes a trusted child helper for permission granted to the app', () => {
    expect(permissionResult({ ...actor, backend: 'helper', inputPosting: true, accessibilityTrusted: true }, 123).status).toBe('error');
    expect(permissionResult({ ...actor, processId: 456, inputPosting: true }, 123).status).toBe('error');
  });
});
