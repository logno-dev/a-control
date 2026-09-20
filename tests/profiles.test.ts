import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../packages/config/defaults';
import { configSchema } from '../packages/shared/schema';
import { ConfigStore } from '../packages/config/storage';
import { applicationProfile, resolveMapping } from '../packages/profiles/resolver';
import { legacyEncoderCCs } from '../packages/controllers/minilab';

const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });
describe('profile resolution', () => {
  it('uses application > user > global precedence', () => {
    const config = defaultConfig(); config.activeProfile = 'art';
    expect(resolveMapping(config, 'encoder-1', 'Photo.exe')?.profile.id).toBe('affinity');
    expect(resolveMapping(config, 'encoder-1', 'browser.exe')?.profile.id).toBe('art');
    expect(resolveMapping(config, 'pad-3', 'Photo.exe')?.profile.id).toBe('global');
  });
  it('matches exact case-insensitive executables and honors auto-switch', () => {
    const config = defaultConfig();
    expect(applicationProfile(config, 'C:\\Programs\\PHOTO.EXE')?.id).toBe('affinity');
    expect(applicationProfile(config, 'NotPhoto.exe')).toBeUndefined();
    config.settings.autoSwitch = false;
    expect(applicationProfile(config, 'Photo.exe')).toBeUndefined();
  });
  it('disabled overrides block inherited mappings', () => {
    const config = defaultConfig(); config.activeProfile = 'art';
    config.profiles.find(p => p.id === 'art')!.mappings[0].enabled = false;
    expect(resolveMapping(config, 'encoder-1', '')?.mapping.enabled).toBe(false);
  });
});
describe('configuration validation and persistence', () => {
  it('validates defaults and rejects dangling controls and invalid active profiles', () => {
    expect(configSchema.safeParse(defaultConfig()).success).toBe(true);
    const config = defaultConfig(); config.profiles[0].mappings[0].controlId = 'missing';
    expect(configSchema.safeParse(config).success).toBe(false);
    config.activeProfile = 'affinity'; expect(configSchema.safeParse(config).success).toBe(false);
  });
  it('rejects duplicate profile IDs, missing global profiles, and out-of-range MIDI values', () => {
    const config = defaultConfig(); config.profiles.push(config.profiles[0]);
    expect(configSchema.safeParse(config).success).toBe(false);
    const invalid = defaultConfig(); invalid.controller.controls[0].channel = 17;
    expect(configSchema.safeParse(invalid).success).toBe(false);
    invalid.profiles = invalid.profiles.filter(p => p.kind !== 'global');
    expect(configSchema.safeParse(invalid).success).toBe(false);
  });
  it('rejects ambiguous hardware definitions', () => {
    const config = defaultConfig(); config.controller.controls.push({ ...config.controller.controls[0], id: 'duplicate' });
    expect(configSchema.safeParse(config).success).toBe(false);
  });
  it('persists valid data atomically and preserves corrupt files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'midi-deck-test-')); temporary.push(directory);
    const store = new ConfigStore(directory);
    expect(await store.load()).toEqual(defaultConfig());
    const config = defaultConfig(); config.activeProfile = 'art'; await store.save(config);
    expect(await store.load()).toEqual(config);
    await writeFile(store.path, '{ invalid config');
    await expect(store.load()).rejects.toThrow('Cannot load');
    expect(await readFile(store.path, 'utf8')).toBe('{ invalid config');
  });
  it('backs up and persists migrated settings during startup, without needing a UI save', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'midi-deck-migration-')); temporary.push(directory);
    const store = new ConfigStore(directory);
    const old = defaultConfig(); old.controller.revision = 1;
    old.controller.controls.slice(0, 16).forEach((c, index) => Object.assign(c, { number: legacyEncoderCCs[index], channel: 1, mode: 'relative-offset' }));
    await writeFile(store.path, JSON.stringify(old));
    const upgraded = await store.load();
    expect(upgraded.controller.controls[0]).toMatchObject({ number: 112, channel: 0 });
    expect(JSON.parse(await readFile(store.path, 'utf8'))).toEqual(upgraded);
    const backups = (await readdir(directory)).filter(file => file.startsWith('settings.backup-'));
    expect(backups).toHaveLength(1);
    expect(JSON.parse(await readFile(join(directory, backups[0]), 'utf8'))).toEqual(old);
    await store.load();
    expect((await readdir(directory)).filter(file => file.startsWith('settings.backup-'))).toHaveLength(1);
  });
});
