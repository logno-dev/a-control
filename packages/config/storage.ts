import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { configSchema, type Config } from '../shared/schema';
import { defaultConfig } from './defaults';
import { parseConfig } from './migration';

export class ConfigStore {
  readonly path: string;
  constructor(private directory: string) { this.path = join(directory, 'settings.json'); }
  async load(): Promise<Config> {
    try {
      const previous = JSON.parse(await readFile(this.path, 'utf8'));
      const config = parseConfig(previous);
      if (JSON.stringify(previous) !== JSON.stringify(config)) {
        const backup = join(this.directory, `settings.backup-${Date.now()}.json`);
        await copyFile(this.path, backup, constants.COPYFILE_EXCL);
        await this.save(config);
      }
      return config;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig();
      // Preserve invalid files rather than silently replacing user configuration.
      throw new Error(`Cannot load ${this.path}: ${String(error)}`);
    }
  }
  async save(config: Config): Promise<void> {
    const valid = configSchema.parse(config);
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(valid, null, 2), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
