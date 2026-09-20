import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'midi-deck-smoke-'));
const env = { ...process.env, MIDI_DECK_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
try {
  app = await electron.launch({ args: [resolve('out/main/index.js')], env, timeout: 30000 });
  await app.firstWindow();
  for (let attempt = 0; attempt < 100; attempt++) {
    page = app.windows().find(candidate => candidate.url().endsWith('/index.html'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'Configuration window should load');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'A little more control.' }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined', 'Renderer must not have Node access');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), directory);
  await page.getByRole('button', { name: 'Mappings', exact: false }).first().click();
  await page.getByRole('button', { name: '＋ Add mapping' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Controller control/).selectOption('encoder-2');
  await dialog.getByLabel(/^Action/).selectOption('shortcut.send');
  await dialog.getByLabel('Shortcut (positive | negative)').fill('Ctrl+Tab | Ctrl+Shift+Tab');
  await dialog.getByRole('button', { name: 'Save mapping' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const saved = await page.evaluate(() => window.deck.state());
  assert.equal(saved.backend, 'node', 'Native MIDI backend must initialize in Electron');
  const mapping = saved.config.profiles.find(p => p.id === 'default').mappings[0];
  assert.equal(mapping.controlId, 'encoder-2');
  assert.equal(mapping.action, 'shortcut.send');
  await page.getByRole('button', { name: 'Profiles', exact: false }).first().click();
  await page.getByRole('button', { name: '＋ New profile' }).click();
  await page.getByLabel('Profile name').fill('Smoke test profile');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Smoke test profile' }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: false }).first().click();
  await page.getByLabel(/^Instrument/).selectOption('organ');
  await page.waitForFunction(async () => (await window.deck.state()).config.settings.synth.instrument === 'organ');
  // Invalid configurations must be rejected at the process boundary.
  const rejected = await page.evaluate(async () => {
    const { config } = await window.deck.state();
    config.activeProfile = 'does-not-exist';
    try { await window.deck.save(config); return false; } catch { return true; }
  });
  assert.equal(rejected, true);
  // The separate audio renderer cannot call configuration IPC.
  const audioPage = app.windows().find(candidate => candidate.url().endsWith('/audio.html'));
  assert.ok(audioPage, 'Audio window should exist');
  assert.equal(await audioPage.evaluate(async () => {
    try { await window.deck.state(); return false; } catch { return true; }
  }), true);
  await page.getByRole('button', { name: 'Overview', exact: false }).first().click();
  if (process.env.MIDI_DECK_SCREENSHOT) await page.screenshot({ path: process.env.MIDI_DECK_SCREENSHOT, fullPage: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible()).close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2, 'Closing UI must preserve tray and synth');
  assert.deepEqual(errors, []);
  console.log('Electron smoke passed: UI, mappings, profiles, synth settings, IPC validation, and background lifecycle.');
} catch (error) {
  console.error('Open windows:', app?.windows().map(page => page.url()));
  if (page) console.error(await page.locator('body').innerText());
  throw error;
} finally {
  if (app) await app.close();
  await rm(directory, { recursive: true, force: true });
}
