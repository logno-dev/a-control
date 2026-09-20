import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { waitForState } from './test-utils.mjs';

if (process.platform !== 'darwin') throw new Error('This focus regression test requires macOS and /Applications/Affinity.app');
const directory = await mkdtemp(join(tmpdir(), 'midi-deck-focus-'));
const env = { ...process.env, MIDI_DECK_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
let application;
let fixture;
let restoreVolume;
try {
  fixture = spawn(resolve('out/native/midi-deck-test-midi'), [], { stdio: 'pipe' });
  const lines = createInterface({ input: fixture.stdout });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Build the MIDI fixture with MIDI_DECK_TEST_MIDI=1 npm run build')), 5000);
    lines.once('line', line => { clearTimeout(timer); resolve(line); });
    fixture.once('error', error => { clearTimeout(timer); reject(error); });
  });
  application = await electron.launch({
    ...(process.env.MIDI_DECK_EXECUTABLE ? { executablePath: resolve(process.env.MIDI_DECK_EXECUTABLE), args: [] } : { args: [resolve('out/main/index.js')] }),
    env, timeout: 30000
  });
  await application.firstWindow();
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    page = application.windows().find(w => w.url().endsWith('/index.html'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'Configuration window must load');
  await page.getByRole('heading', { name: 'A little more control.' }).waitFor();
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), directory, 'Test must not use the real user configuration');
  await application.evaluate(({ app, BrowserWindow }) => {
    globalThis.__deckFocusEvents = [];
    app.on('activate', () => globalThis.__deckFocusEvents.push('app activate'));
    for (const window of BrowserWindow.getAllWindows()) window.on('focus', () => globalThis.__deckFocusEvents.push(`window focus: ${window.webContents.getURL()}`));
  });
  const overlay = application.windows().find(w => w.url().endsWith('/overlay.html'));
  assert.ok(overlay);
  await page.evaluate(async port => {
    let state;
    for (let i = 0; i < 30; i++) {
      state = await window.deck.refresh();
      if (state.inputs.includes(port)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!state.inputs.includes(port)) throw new Error(`Virtual MIDI input not found: ${port}`);
    const profiles = state.config.profiles.map(p => p.id === 'affinity' ? { ...p, mappings: p.mappings.map(m => m.controlId === 'encoder-1' ? { ...m, action: 'system.volume.change' } : m) } : p);
    await window.deck.save({ ...state.config, input: port, profiles });
  }, port);
  async function assertAffinityStable(hidden, description) {
    let sawOverlay = false, sawDismissal = false;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.deck.state());
      const windows = await application.evaluate(({ BrowserWindow }) => ({
        main: BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).isVisible(),
        focused: BrowserWindow.getFocusedWindow()?.webContents.getURL(),
        overlay: BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/overlay.html')).isVisible(),
        focusEvents: globalThis.__deckFocusEvents.slice()
      }));
      if (state.applicationProfile !== 'affinity') {
        const probe = spawnSync(resolve('out/native/midi-deck-macos'), [], { input: '{"id":1,"method":"foreground"}\n', encoding: 'utf8' });
        windows.freshForeground = probe.stdout.trim();
      }
      assert.equal(state.applicationProfile, 'affinity', JSON.stringify({ description, foreground: state.foreground, windows }));
      assert.match(state.foreground, /Affinity/);
      assert.deepEqual(windows.focusEvents, [], `${description}: feedback must not activate or focus MIDI Deck`);
      if (hidden) assert.equal(windows.main, false, 'Notification must not reopen the editor');
      if (windows.overlay) sawOverlay = true;
      if (sawOverlay && !windows.overlay) sawDismissal = true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(sawOverlay, `${description}: overlay must appear`);
    assert.ok(sawDismissal, `${description}: test must cover dismissal`);
    console.log(`Focus held through display and dismissal: ${description}`);
  }
  for (const hidden of [false, true]) for (const nativeNotifications of [false, true]) {
    await application.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
      main.show(); main.focus();
    });
    await waitForState(page, state => state.applicationProfile === '', 'Desktop profile');
    await page.evaluate(async nativeNotifications => {
      const { config } = await window.deck.state();
      await window.deck.save({ ...config, feedback: { ...config.feedback, enabled: false }, settings: { ...config.settings, autoSwitch: true, overlay: true, nativeNotifications } });
    }, nativeNotifications);
    // Let any previous Desktop notification dismiss before starting this trial.
    await new Promise(resolve => setTimeout(resolve, 3300));
    if (hidden) await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).close());
    await application.evaluate(() => { globalThis.__deckFocusEvents = []; });
    const activation = spawnSync('osascript', ['-e', 'tell application "/Applications/Affinity.app" to activate'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(activation.status, 0, activation.stderr);
    await waitForState(page, state => state.applicationProfile === 'affinity', 'Affinity profile');
    const context = `editor ${hidden ? 'hidden' : 'visible'}, native banners ${nativeNotifications ? 'on' : 'off'}`;
    await assertAffinityStable(hidden, `profile change, ${context}`);
    const before = (await page.evaluate(() => window.deck.state())).system;
    assert.equal(before.volumeWritable, true); assert.equal(typeof before.volume, 'number');
    const direction = before.volume > 0.95 ? -1 : 1;
    const native = request => {
      const response = spawnSync(resolve('out/native/midi-deck-macos'), [], { input: JSON.stringify({ id: 1, ...request }) + '\n', encoding: 'utf8' });
      assert.equal(response.status, 0, response.stderr);
      const message = JSON.parse(response.stdout); if (message.error) throw new Error(message.error); return message.result;
    };
    restoreVolume = () => {
      const current = native({ method: 'status' });
      if (current.outputName === before.outputName && current.volume != null && Math.abs(current.volume - before.volume - direction * 0.02) < 0.005) native({ method: 'volume', steps: -direction });
    };
    fixture.stdin.write(direction > 0 ? '+\n' : '-\n');
    await waitForState(page, state => state.system.volume != null && Math.abs(state.system.volume - before.volume - direction * 0.02) < 0.005, 'volume change');
    await overlay.getByText(/^Volume \d/).waitFor();
    fixture.stdin.write(direction > 0 ? '-\n' : '+\n');
    await waitForState(page, state => Math.abs(state.system.volume - before.volume) < 0.005, 'volume restoration');
    restoreVolume = undefined;
    await assertAffinityStable(hidden, `volume updates, ${context}`);
  }
  // Genuine user activation must still bring the editor forward and select Desktop.
  await application.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    main.show(); main.focus();
  });
  await waitForState(page, state => state.applicationProfile === '', 'return to Desktop');
  console.log('Focus regression passed, including real return to the Desktop profile.');
} finally {
  try { restoreVolume?.(); }
  finally {
    fixture?.kill();
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true });
  }
}
