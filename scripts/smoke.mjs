import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../package.json');
import { waitForState } from './test-utils.mjs';

const directory = await mkdtemp(join(tmpdir(), 'midi-deck-smoke-'));
const env = { ...process.env, MIDI_DECK_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
let midiFixture;
let inputWorker;
let restoreVolume;
async function recordKey(keyCode, modifiers = []) {
  // DevTools page.keyboard bypasses Electron's before-input-event hook. Use the
  // WebContents input path that the app's real keyboard recorder observes.
  await app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    const names = { meta: 'Meta', control: 'Control', shift: 'Shift', alt: 'Alt' };
    for (let index = 0; index < modifiers.length; index++) main.webContents.sendInputEvent({ type: 'keyDown', keyCode: names[modifiers[index]], modifiers: modifiers.slice(0, index + 1) });
    main.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    main.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    for (let index = modifiers.length - 1; index >= 0; index--) main.webContents.sendInputEvent({ type: 'keyUp', keyCode: names[modifiers[index]], modifiers: modifiers.slice(0, index) });
  }, { keyCode, modifiers });
}
async function finishRecordedKey(expected) {
  await page.waitForFunction(expected => document.querySelector('.capture-status')?.textContent.includes(expected), expected);
  if (!(await page.locator('.capture-status').innerText()).startsWith('Recorded ')) {
    await page.getByRole('button', { name: 'Use captured shortcut', exact: true }).click();
  }
}
try {
  app = await electron.launch({ ...(process.env.MIDI_DECK_EXECUTABLE ? { executablePath: resolve(process.env.MIDI_DECK_EXECUTABLE), args: [] } : { args: [resolve('out/main/index.js')] }), env, timeout: 30000 });
  const executableName = basename(await app.evaluate(() => process.execPath));
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
  assert.equal((await page.evaluate(() => window.deck.state())).runtime.version, version);
  assert.equal(await page.getByRole('button', { name: 'Mappings', exact: true }).count(), 0);
  assert.equal(await page.locator('.brand .app-icon').evaluate(icon => {
    for (let node = icon; node; node = node.parentElement) if (getComputedStyle(node).filter.includes('grayscale')) return false;
    return true;
  }), true, 'Application icon must retain its original color');
  if (process.platform === 'darwin' && process.env.MIDI_DECK_TEST_INPUT === '1') {
    // Capture real Quartz input in our own test window; suppress its default zoom action.
    await page.bringToFront();
    await app.evaluate(({ BrowserWindow, app, Menu }) => {
      const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
      app.focus({ steal: true });
      // Electron's default native Zoom menu can consume Cmd+Plus before the renderer.
      globalThis.__deckSmokeMenu = Menu.getApplicationMenu();
      Menu.setApplicationMenu(null);
      globalThis.__deckSmokeKeys = [];
      globalThis.__deckSmokeKeyListener = (event, input) => { globalThis.__deckSmokeKeys.push(input); event.preventDefault(); };
      window.webContents.on('before-input-event', globalThis.__deckSmokeKeyListener);
      window.focus();
    });
    await page.waitForFunction(() => document.hasFocus());
    await waitForState(page, state => state.foreground === executableName, 'test app foreground');
    await new Promise(resolve => setTimeout(resolve, 200));
    // Keep the sender alive until WindowServer delivers the events, just like production.
    inputWorker = spawn(resolve('out/native/midi-deck-macos'), [], { stdio: 'pipe' });
    const responses = createInterface({ input: inputWorker.stdout });
    const native = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Native input worker did not respond')), 5000);
      responses.once('line', line => { clearTimeout(timeout); resolve(JSON.parse(line)); });
      inputWorker.once('error', error => { clearTimeout(timeout); reject(error); });
      inputWorker.stdin.write(JSON.stringify({ id: 1, method: 'keys', key: 24, flags: 0x100000, literalPlus: true, count: 1 }) + '\n');
    });
    assert.equal(native.result, true, native.error);
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await app.evaluate(() => globalThis.__deckSmokeKeys.some(input => input.type === 'keyDown'))) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const input = await app.evaluate(() => globalThis.__deckSmokeKeys.find(input => input.type === 'keyDown'));
    if (!input) console.error('Input-debug state:', await app.evaluate(({ BrowserWindow }) => ({ pid: process.pid, focused: BrowserWindow.getFocusedWindow()?.webContents.getURL(), windows: BrowserWindow.getAllWindows().map(w => ({ url: w.webContents.getURL(), focused: w.isFocused(), visible: w.isVisible() })) })), 'Native response:', native);
    assert.ok(input, 'Quartz shortcut must reach the foreground window');
    assert.equal(input.meta, true); assert.equal(input.shift, false); assert.equal(input.key, '+');
    inputWorker.stdin.end();
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
      window.webContents.removeListener('before-input-event', globalThis.__deckSmokeKeyListener);
      window.webContents.setZoomFactor(1);
      Menu.setApplicationMenu(globalThis.__deckSmokeMenu);
      delete globalThis.__deckSmokeMenu;
      delete globalThis.__deckSmokeKeys; delete globalThis.__deckSmokeKeyListener;
    });
    console.log('Native macOS Cmd+Plus reached the isolated test window.');
  }
  await page.getByRole('button', { name: 'Configure Pitch strip' }).waitFor();
  await page.getByRole('button', { name: 'Configure Modulation strip' }).waitFor();
  await page.getByRole('button', { name: '9–16', exact: true }).click();
  await page.getByRole('button', { name: 'Pad 9 Unassigned', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Shift HARDWARE', exact: true }).click();
  await page.getByText('Shift: Hardware modifier:', { exact: false }).waitFor();
  // Exercise live strip visualization without sending any MIDI or system action.
  await app.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html'));
    for (const event of [
      { type: 'pitch-bend', number: 0, value: 16383, raw: [224, 127, 127] },
      { type: 'cc', number: 1, value: 127, raw: [176, 1, 127] }
    ]) target.webContents.send('deck:notice', { type: 'midi', event: { ...event, deviceId: 'smoke', channel: 1, timestamp: Date.now() } });
  });
  await page.getByRole('button', { name: 'Configure Pitch strip' }).getByText('16383', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Configure Modulation strip' }).getByText('127', { exact: true }).waitFor();
  // Edit the exact profile shown by the overview, including inherited-action prefills.
  await page.getByLabel('Overview profile').selectOption('global');
  await page.getByRole('button', { name: 'Configure Encoder 1', exact: true }).click();
  assert.equal(await page.getByRole('dialog').getByLabel('Action', { exact: true }).inputValue(), 'system.volume.change');
  assert.equal(await page.getByRole('dialog').getByLabel('MIDI channel').inputValue(), '0');
  await page.getByRole('button', { name: '⌨ Record a keyboard shortcut' }).click();
  await page.getByText('Ready — press a key or combination on your computer keyboard.', { exact: true }).waitFor();
  await recordKey('Escape');
  await finishRecordedKey('Escape');
  await page.getByRole('button', { name: 'Record positive shortcut' }).waitFor();
  assert.equal(await page.getByRole('dialog').getByLabel('Shortcut (positive | negative)').inputValue(), 'Escape');
  await page.getByRole('button', { name: 'Record positive shortcut' }).click();
  await page.getByText('Ready — press a key or combination on your computer keyboard.', { exact: true }).waitFor();
  await recordKey('Q', [process.platform === 'darwin' ? 'meta' : 'control']);
  await finishRecordedKey(process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q');
  await page.getByRole('button', { name: 'Record positive shortcut' }).waitFor();
  assert.equal(await page.getByRole('dialog').getByLabel('Shortcut (positive | negative)').inputValue(), process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Overview profile').selectOption('affinity');
  await page.getByRole('button', { name: 'Configure Pitch strip' }).click();
  await page.getByRole('dialog').getByLabel('Action', { exact: true }).selectOption('canvas.zoom');
  await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const afterPreviewEdit = await page.evaluate(() => window.deck.state());
  assert.equal(afterPreviewEdit.config.activeProfile, 'default');
  assert.equal(afterPreviewEdit.config.profiles.find(p => p.id === 'affinity').mappings.find(m => m.controlId === 'pitch-strip').action, 'canvas.zoom');
  await page.getByLabel('Overview profile').selectOption('default');
  await page.getByRole('button', { name: 'Configure Encoder 1', exact: true }).click();
  assert.equal(await page.getByRole('dialog').getByLabel('Action', { exact: true }).inputValue(), 'system.volume.change');
  await page.getByText('Inherited from Global.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Overview profile').selectOption('');
  await page.getByRole('button', { name: '＋ Add mapping' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Controller control/).selectOption('encoder-2');
  await dialog.getByLabel('Action', { exact: true }).selectOption('shortcut.send');
  await dialog.getByRole('button', { name: 'Record positive shortcut' }).click();
  await page.getByText('Ready — press a key or combination on your computer keyboard.', { exact: true }).waitFor();
  await recordKey('S', [process.platform === 'darwin' ? 'meta' : 'control', 'shift']);
  await finishRecordedKey(process.platform === 'darwin' ? 'Cmd+Shift+S' : 'Ctrl+Shift+S');
  await dialog.getByRole('button', { name: 'Record positive shortcut' }).waitFor();
  const recorded = process.platform === 'darwin' ? 'Cmd+Shift+S' : 'Ctrl+Shift+S';
  assert.equal(await dialog.getByLabel('Shortcut (positive | negative)').inputValue(), recorded);
  await dialog.getByRole('button', { name: 'Record negative shortcut' }).click();
  await page.getByText('Ready — press a key or combination on your computer keyboard.', { exact: true }).waitFor();
  await recordKey('Left');
  await finishRecordedKey('Left');
  await dialog.getByRole('button', { name: 'Record positive shortcut' }).waitFor();
  assert.equal(await dialog.getByLabel('Shortcut (positive | negative)').inputValue(), `${recorded} | Left`);
  await dialog.getByRole('button', { name: 'Save mapping' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const saved = await page.evaluate(() => window.deck.state());
  assert.equal(saved.backend, 'node', 'Native MIDI backend must initialize in Electron');
  const mapping = saved.config.profiles.find(p => p.id === 'default').mappings[0];
  assert.equal(mapping.controlId, 'encoder-2');
  assert.equal(mapping.action, 'shortcut.send');
  assert.equal(mapping.parameter, `${recorded} | Left`);
  await page.getByRole('button', { name: 'Profiles', exact: false }).first().click();
  await page.getByRole('button', { name: '＋ New profile' }).click();
  await page.getByLabel('Profile name').fill('Smoke test profile');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Smoke test profile' }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: false }).first().click();
  await page.getByRole('heading', { name: 'MiniLab lights' }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 400));
  assert.equal(await page.locator('.sidebar').evaluate(sidebar => Math.round(sidebar.getBoundingClientRect().top)), 0);
  await page.getByRole('button', { name: 'Test on-screen overlay' }).click();
  const overlayPage = app.windows().find(candidate => candidate.url().endsWith('/overlay.html'));
  assert.ok(overlayPage, 'Profile overlay window should exist');
  await overlayPage.getByText('Profile overlay is working', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.hasFocus()), true, 'Overlay must not steal focus');
  assert.equal(await page.getByRole('button', { name: 'Test pad colors' }).isDisabled(), true);
  if (process.platform === 'darwin') {
    await page.getByRole('heading', { name: 'macOS integration' }).waitFor();
    await page.getByRole('region', { name: 'macOS Accessibility setup' }).waitFor();
    assert.equal(await page.locator('.application-path').innerText(), (await page.evaluate(() => window.deck.state())).runtime.applicationPath);
    await page.getByRole('button', { name: 'Check permission again' }).click();
    await page.locator('.permission-result').waitFor();
    const checked = await waitForState(page, state => state.permissionCheck !== null, 'visible permission check result');
    assert.equal(checked.permissionCheck.backend, 'in-process');
    assert.equal(checked.permissionCheck.processId, await app.evaluate(() => process.pid));
    assert.equal(checked.permissionCheck.status === 'granted', checked.system.inputPosting);
    if (checked.system.inputPosting) assert.equal(checked.permissionCheck.keyboardTest, 'delivered');
    if (checked.runtime.packaged) assert.equal(checked.system.bundleIdentifier, 'dev.midideck.desktop');
    await waitForState(page, state => state.system.accessibility !== null, 'native helper status');
    assert.equal((await page.evaluate(() => window.deck.state())).system.error, '');
  }
  if (process.platform === 'darwin' && process.env.MIDI_DECK_TEST_MIDI === '1') {
    midiFixture = spawn(resolve('out/native/midi-deck-test-midi'), [], { stdio: 'pipe' });
    const lines = createInterface({ input: midiFixture.stdout });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Virtual MIDI source did not start')), 5000);
      lines.once('line', line => { clearTimeout(timer); resolve(line); });
      midiFixture.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const original = await page.evaluate(() => window.deck.state());
    await page.evaluate(async port => {
      let state;
      for (let attempt = 0; attempt < 30; attempt++) {
        state = await window.deck.refresh();
        if (state.inputs.includes(port)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!state.inputs.includes(port)) throw new Error(`Virtual MIDI input missing: ${port}; available: ${state.inputs.join(', ')}`);
      await window.deck.save({ ...state.config, input: port, settings: { ...state.config.settings, autoSwitch: false } });
    }, port);
    const before = (await page.evaluate(() => window.deck.state())).system;
    assert.equal(before.volumeWritable, true); assert.equal(typeof before.volume, 'number');
    const direction = before.volume > 0.95 ? -1 : 1;
    const helper = request => {
      const result = spawnSync(resolve('out/native/midi-deck-macos'), [], { input: JSON.stringify({ id: 1, ...request }) + '\n', encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr); const response = JSON.parse(result.stdout);
      if (response.error) throw new Error(response.error); return response.result;
    };
    restoreVolume = () => {
      const current = helper({ method: 'status' });
      if (current.outputName === before.outputName && current.volume != null && Math.abs(current.volume - before.volume - direction * 0.02) < 0.005) helper({ method: 'volume', steps: -direction });
    };
    const count = (await page.evaluate(() => window.deck.state())).diagnostics.midiEvents;
    midiFixture.stdin.write(direction > 0 ? '+\n' : '-\n');
    await waitForState(page, state => state.diagnostics.midiEvents > count && state.system.volume != null && Math.abs(state.system.volume - before.volume - direction * 0.02) < 0.005, 'MIDI volume change');
    const routed = await page.evaluate(() => window.deck.state());
    assert.equal(routed.lastRoute.event.channel, 8); assert.equal(routed.lastRoute.event.number, 112);
    assert.equal(routed.lastRoute.action, 'system.volume.change');
    midiFixture.stdin.write(direction > 0 ? '-\n' : '+\n');
    await waitForState(page, state => Math.abs(state.system.volume - before.volume) < 0.005, 'volume restoration');
    restoreVolume = undefined;
    midiFixture.stdin.end();
    await page.evaluate(config => window.deck.save(config), original.config);
    console.log('Real CoreMIDI → JZZ → main router → CoreAudio volume passed; original volume restored.');
  }
  await page.getByLabel(/^Instrument/).selectOption('organ');
  await waitForState(page, state => state.config.settings.synth.instrument === 'organ', 'saved instrument');
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
  if (process.platform === 'darwin' && process.env.MIDI_DECK_TEST_AFFINITY === '1') {
    await page.evaluate(async () => { const { config } = await window.deck.state(); await window.deck.save({ ...config, settings: { ...config.settings, overlay: true } }); });
    const activated = spawnSync('osascript', ['-e', 'tell application "/Applications/Affinity.app" to activate'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(activated.status, 0, activated.stderr);
    await waitForState(page, state => state.applicationProfile === 'affinity', 'Affinity profile');
    await overlayPage.getByText('Affinity', { exact: true }).waitFor();
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/overlay.html')).isVisible()), true);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.match((await page.evaluate(() => window.deck.state())).foreground, /Affinity/);
    await app.evaluate(({ BrowserWindow, app }) => {
      app.focus({ steal: true });
      const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
      window.show(); window.focus();
    });
    await waitForState(page, state => state.foreground === executableName, 'test app foreground');
    await overlayPage.getByText('Desktop', { exact: true }).waitFor();
    console.log('Real Affinity activation changed the profile and displayed the overlay without stealing focus.');
  }
  if (process.env.MIDI_DECK_SCREENSHOT) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: process.env.MIDI_DECK_SCREENSHOT, fullPage: true });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html')).close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 3, 'Closing UI must preserve tray, synth, and overlay');
  assert.deepEqual(errors, []);
  console.log('Electron smoke passed: UI, mappings, profiles, synth settings, IPC validation, and background lifecycle.');
} catch (error) {
  console.error('Open windows:', app?.windows().map(page => page.url()));
  if (page) console.error(await page.locator('body').innerText());
  throw error;
} finally {
  if (restoreVolume) restoreVolume();
  midiFixture?.kill();
  inputWorker?.kill();
  if (app) await app.close();
  await rm(directory, { recursive: true, force: true });
}
