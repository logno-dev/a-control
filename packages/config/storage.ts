import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configSchema, type Config } from '../shared/schema';
import { defaultConfig } from './defaults';

export class ConfigStore {
  readonly path: string;
  constructor(private directory: string) { this.path = join(directory, 'settings.json'); }
  async load(): Promise<Config> {
    try { return configSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
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
