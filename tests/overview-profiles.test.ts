import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../packages/config/defaults';
import { resolvePreview, applicationProfile } from '../packages/profiles/resolver';
import { ProfileChangeNotifier } from '../packages/profiles/notifications';

afterEach(() => vi.useRealTimers());
describe('overview profile previews', () => {
  it('resolves every kind of profile without switching the active user profile', () => {
    const config = defaultConfig();
    const profile = (id: string) => config.profiles.find(p => p.id === id)!;
    expect(resolvePreview(config, 'encoder-1', profile('global'))?.mapping.action).toBe('system.volume.change');
    expect(resolvePreview(config, 'encoder-1', profile('art'))?.mapping.action).toBe('canvas.zoom');
    expect(resolvePreview(config, 'encoder-1', profile('affinity'))?.profile.id).toBe('affinity');
    expect(resolvePreview(config, 'pad-3', profile('affinity'))?.profile.id).toBe('global');
    expect(config.activeProfile).toBe('default');
  });
  it('shows user overrides and disabled mappings accurately in application previews', () => {
    const config = defaultConfig();
    config.profiles[1].mappings.push({ id: 'disabled', controlId: 'pad-3', action: 'media.next', parameter: '', enabled: false });
    expect(resolvePreview(config, 'pad-3', config.profiles[3])).toMatchObject({ profile: { id: 'default' }, mapping: { enabled: false, action: 'media.next' } });
  });
  it('recognizes installed unified and older Affinity executables', () => {
    const config = defaultConfig();
    for (const name of ['Affinity Affinity Store', 'Affinity', 'Affinity Photo 2', 'Designer.exe']) expect(applicationProfile(config, name)?.id).toBe('affinity');
    expect(applicationProfile(config, 'Unrelated Affinity App')).toBeUndefined();
  });
});
describe('native profile notification transitions', () => {
  it('notifies once on effective profile changes and on returning to Desktop', () => {
    vi.useFakeTimers(); const notify = vi.fn(); const notifier = new ProfileChangeNotifier(notify);
    const config = defaultConfig();
    notifier.update(config, 'Finder'); notifier.update(config, 'Affinity Affinity Store');
    vi.advanceTimersByTime(350);
    expect(notify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'affinity' }), 'Affinity Affinity Store');
    notifier.update(config, 'Affinity Affinity Store'); notifier.update(config, 'Affinity Photo 2');
    vi.advanceTimersByTime(1000); expect(notify).toHaveBeenCalledTimes(1);
    notifier.update(config, 'Finder'); vi.advanceTimersByTime(350);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'default' }), 'Finder');
    notifier.close();
  });
  it('debounces transient switches and does not announce preview edits', () => {
    vi.useFakeTimers(); const notify = vi.fn(); const notifier = new ProfileChangeNotifier(notify); const config = defaultConfig();
    notifier.update(config, 'Finder'); notifier.update(config, 'Affinity');
    vi.advanceTimersByTime(100); notifier.update(config, 'Finder'); vi.advanceTimersByTime(1000);
    resolvePreview(config, 'encoder-1', config.profiles[3]); notifier.update(config, 'Finder');
    expect(notify).not.toHaveBeenCalled();
    notifier.update(config, 'OpenToonz'); notifier.close(); vi.advanceTimersByTime(1000);
    expect(notify).not.toHaveBeenCalled();
  });
});
