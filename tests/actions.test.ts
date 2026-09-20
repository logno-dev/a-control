import { describe, expect, it, vi } from 'vitest';
import { ActionEngine, type ActionHost } from '../packages/actions/engine';
import { createPlatform, parseShortcut, type PlatformAdapter } from '../packages/platforms/platform';
import { defaultConfig } from '../packages/config/defaults';
import type { Mapping } from '../packages/shared/schema';
function fixture() {
  const platform: PlatformAdapter = { foreground: vi.fn(), shortcut: vi.fn(), media: vi.fn(), scroll: vi.fn(), close: vi.fn() };
  const host: ActionHost = { openExternal: vi.fn(), openPath: vi.fn(), switchProfile: vi.fn() };
  return { platform, host, engine: new ActionEngine(platform, host), profile: defaultConfig().profiles[0] };
}
const mapping = (action: Mapping['action'], parameter = ''): Mapping => ({ id: 'test', controlId: 'encoder-1', enabled: true, action, parameter });
describe('action dispatch', () => {
  it('accumulates fractional encoder movement', async () => {
    const { engine, platform, profile } = fixture();
    for (let i = 0; i < 4; i++) await engine.execute(mapping('system.volume.change'), 0.25, profile);
    expect(platform.media).toHaveBeenCalledExactlyOnceWith('volumeUp', 1);
  });
  it('selects directional shortcuts and bounds repeat bursts', async () => {
    const { engine, platform, profile } = fixture();
    await engine.execute(mapping('shortcut.send', 'Ctrl+Tab | Ctrl+Shift+Tab'), -100, profile);
    expect(platform.shortcut).toHaveBeenCalledWith('Ctrl+Shift+Tab', 20);
  });
  it('uses application-specific defaults and rejects undefined shortcuts', async () => {
    const { engine, platform, profile } = fixture();
    await engine.execute(mapping('canvas.zoom'), 1, { ...profile, id: 'affinity', adapter: 'affinity' });
    expect(platform.shortcut).toHaveBeenLastCalledWith(process.platform === 'darwin' ? 'Primary+Add' : 'Primary+Plus', 1);
    await engine.execute(mapping('canvas.zoom'), -1, { ...profile, id: 'opentoonz', adapter: 'opentoonz' });
    expect(platform.shortcut).toHaveBeenLastCalledWith('Subtract', 1);
    await expect(engine.execute(mapping('canvas.rotate'), 1, profile)).rejects.toThrow('positive | negative');
  });
  it('rejects unsafe URL schemes and reports launcher errors', async () => {
    const { engine, host, profile } = fixture();
    await expect(engine.execute(mapping('url.open', 'javascript:alert(1)'), 1, profile)).rejects.toThrow('http or https');
    expect(host.openExternal).not.toHaveBeenCalled();
    vi.mocked(host.openPath).mockResolvedValue('File not found');
    await expect(engine.execute({ ...mapping('application.launch', '/missing'), id: 'other' }, 1, profile)).rejects.toThrow('File not found');
  });
  it('parses keyboard chords without passing strings into PowerShell source', () => {
    expect(parseShortcut('Ctrl+Shift+S')).toEqual([17, 16, 83]);
    expect(parseShortcut('F24')).toEqual([135]);
    expect(() => parseShortcut('Ctrl+anything')).toThrow('Unknown shortcut');
  });
  it.skipIf(process.platform !== 'win32')('starts the Windows worker and reads the foreground process', async () => {
    const platform = createPlatform();
    try { expect(typeof await platform.foreground()).toBe('string'); } finally { platform.close(); }
  }, 45000);
});
