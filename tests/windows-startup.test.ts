import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocked.spawn }));
import { WindowsAdapter } from '../packages/platforms/platform';

afterEach(() => { vi.useRealTimers(); mocked.spawn.mockReset(); });
it('waits for PowerShell compilation readiness before starting the action timeout or writing a request', async () => {
  vi.useFakeTimers();
  const worker = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
  mocked.spawn.mockReturnValue(worker);
  const writes: string[] = [];
  worker.stdin.on('data', chunk => writes.push(String(chunk)));
  const adapter = new WindowsAdapter();
  const result = adapter.foreground();
  await vi.advanceTimersByTimeAsync(15000);
  expect(writes).toHaveLength(0);
  worker.stdout.write('{"ready":true}\n');
  await vi.advanceTimersByTimeAsync(0);
  expect(writes).toHaveLength(1);
  const request = JSON.parse(writes[0]);
  worker.stdout.write(JSON.stringify({ id: request.id, result: 'explorer.exe' }) + '\n');
  expect(await result).toBe('explorer.exe');
  adapter.close();
});
