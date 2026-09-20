const { spawnSync } = require('node:child_process');
const { mkdirSync, readdirSync, realpathSync } = require('node:fs');
const { resolve, dirname, join } = require('node:path');
if (process.platform !== 'darwin') {
  console.log('macOS helper: skipped on this platform');
  process.exit(0);
}
mkdirSync(resolve('out/native'), { recursive: true });
const args = ['clang', '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Werror', '-mmacosx-version-min=12.0',
  '-arch', 'arm64', '-arch', 'x86_64', '-framework', 'Cocoa', '-framework', 'ApplicationServices', '-framework', 'CoreAudio',
  resolve('native/macos/helper.m'), '-o', resolve('out/native/midi-deck-macos')];
let environment = process.env;
let result = spawnSync('xcrun', args, { encoding: 'utf8', env: environment });
// A beta SDK can be installed alongside an older linker. Retry an installed stable SDK,
// but only for that specific toolchain mismatch; never hide source/compilation errors.
if (result.status !== 0 && !process.env.SDKROOT && result.stderr?.includes('unknown architecture')) {
  const sdk = spawnSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).stdout?.trim();
  if (sdk) {
    const directory = dirname(sdk);
    const candidates = readdirSync(directory).filter(name => /^MacOSX\d+\.\d+\.sdk$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const name of candidates) {
      const candidate = join(directory, name);
      if (realpathSync(candidate) === realpathSync(sdk)) continue;
      console.warn(`Default SDK is incompatible with the linker; trying ${candidate}`);
      environment = { ...process.env, SDKROOT: candidate };
      result = spawnSync('xcrun', args, { encoding: 'utf8', env: environment });
      if (result.status === 0 || !result.stderr?.includes('unknown architecture')) break;
    }
  }
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error('Install Xcode Command Line Tools (xcode-select --install).', result.error.message);
if (result.status === 0) {
  const headers = join(dirname(require.resolve('node-api-headers/package.json')), 'include');
  const addon = spawnSync('xcrun', ['clang', '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Werror', '-mmacosx-version-min=12.0',
    '-arch', 'arm64', '-arch', 'x86_64', '-dynamiclib', '-undefined', 'dynamic_lookup', '-DMIDI_DECK_NODE_ADDON', '-I', headers,
    '-framework', 'Cocoa', '-framework', 'ApplicationServices', '-framework', 'CoreAudio',
    resolve('native/macos/helper.m'), '-o', resolve('out/native/midi-deck-macos.node')], { stdio: 'inherit', env: environment });
  if (addon.status !== 0) process.exit(addon.status ?? 1);
}
if (result.status === 0 && process.env.MIDI_DECK_TEST_MIDI === '1') {
  const fixture = spawnSync('xcrun', ['clang', '-O2', '-Wno-deprecated-declarations', '-framework', 'CoreMIDI', '-framework', 'CoreFoundation',
    resolve('native/macos/test-midi.m'), '-o', resolve('out/native/midi-deck-test-midi')], { stdio: 'inherit', env: environment });
  if (fixture.status !== 0) process.exit(fixture.status ?? 1);
}
process.exit(result.status ?? 1);
