# MIDI Deck

**Your MIDI controller, beyond music.** A Windows-first Electron + TypeScript tray application that turns pads and encoders into desktop controls while keeping the keyboard playable.

This is a working first implementation of the project in [`plan.md`](plan.md), with a hardware-independent MIDI engine and an editable MiniLab MkII preset.

## Run locally

Requires **Node.js 22.16+** and npm. Windows 10/11 is the primary desktop-action target; the app also runs on Intel and Apple Silicon macOS.

```sh
npm ci
npm run dev
```

Production build and local launch:

```sh
npm run build
npm start
```

Build installers for your current OS with `npm run package`. Output is in `release/`. GitHub Actions builds Windows and both macOS architectures automatically; see [releases](docs/releases.md).

## First connection

1. Plug in your controller and open **Settings**.
2. Choose its **MIDI input**. Device discovery refreshes every four seconds; saved selections reconnect when the device returns.
3. Open **MIDI inspector** and check the messages from the keyboard, pads, and encoders.
4. In **Mappings**, select a profile, add a mapping, and click **Learn a control**.
5. Move the control, choose its behavior and action, then save.
6. Play the keyboard: unmapped notes go to the synth. Mapped pads trigger actions rather than notes.

MiniLab factory presets differ by MIDI Control Center configuration. The included definition assumes encoders on channel 1 with **relative offset** encoding (65 = clockwise, 63 = counterclockwise) and pads on channel 10. These are editable starting values, not automatic hardware detection. See [controller profiles](docs/controller-profiles.md).

Closing the configuration window hides it. MIDI routing and audio continue in the background. Use the tray/menu-bar icon to reopen the window, change profiles, pause mappings, stop notes, or quit.

## Included

- Native USB MIDI discovery through JZZ / jazz-midi, hot-plug refresh, persistent input selection.
- Note, CC, pitch-bend normalization and raw-event inspection.
- MIDI Learn, custom logical controls, editable channel/CC/note values.
- Absolute encoders and three relative encodings; sensitivity, inversion, acceleration.
- Global, user, and foreground-application profiles with explicit override precedence.
- Windows keyboard shortcuts, media keys, volume adjustment, mute, scroll injection, and foreground detection.
- Launch applications, open paths/URLs, run shell commands, run PowerShell, and switch profiles.
- Affinity and OpenToonz starter profiles and a small semantic art-action adapter set.
- A separate audio window with a 48-voice Web Audio synth, velocity sensitivity, sustain, and two-semitone pitch bend.
- Synthesized piano, electric keys, organ, soft synth, and strings; master volume and all-notes-off.
- Full MIDI passthrough to a selected output; synth and desktop actions are disabled in passthrough mode.
- Tray controls, start-at-login on Windows/macOS, atomic JSON persistence, configuration import/export with action disclosure.
- Sandboxed renderers, context isolation, a narrow preload API, main-frame IPC validation, and schema-validated configuration.
- Automated core tests and macOS/Windows build and release workflows.

## Platform coverage

| Capability | Windows | macOS |
|---|---|---|
| MIDI input, MIDI Learn, profiles, passthrough | Yes | Yes |
| Synth, tray/menu-bar, start at login | Yes | Yes |
| Open application/file/URL and shell commands | Yes | Yes |
| Keyboard/media/volume/scroll injection | Yes | Planned |
| Foreground-application detection | Yes | Planned |
| PowerShell actions | Yes | — |

On macOS, select an application bundle's absolute path for launcher actions. On Windows, select an executable's absolute path. Input injection on Windows targets the foreground app and follows normal Windows integrity restrictions; an unelevated MIDI Deck cannot inject input into elevated applications.

Linux integration and packaging are experimental, and the supplied native MIDI package does not cover every Linux architecture.

## Routing and profiles

Mappings resolve in this order:

```text
Matching application profile → active user profile → Global
```

An override with **Disabled** status blocks inherited actions for that control. **Pause mappings** bypasses desktop actions while leaving the synth available. Applications match exact executable filenames, case-insensitively; comma-separated lists are supported. If several profiles match, the first one wins.

All raw MIDI, including system messages, is forwarded in **DAW mode**. On Windows, install a virtual-port driver such as loopMIDI, choose its port as MIDI Deck's output, and choose that same port as the DAW's input. Avoid routing the DAW's output back into MIDI Deck. Alternatively, select no MIDI Deck input to release the hardware port for direct DAW access.

## Configuration

`settings.json` is stored in Electron's user data directory:

- Windows: `%APPDATA%/MIDI Deck/settings.json`
- macOS: `~/Library/Application Support/MIDI Deck/settings.json`
- Linux: `~/.config/MIDI Deck/settings.json`

Invalid configuration files are preserved and reported at startup rather than overwritten. Export/import includes settings, hardware definitions, profiles, and mappings. Imports containing desktop actions are disclosed in a native confirmation dialog before activation.

For isolated development or testing, set `MIDI_DECK_DATA_DIR` to an existing temporary directory. This override is ignored by packaged applications.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run test:smoke
```

The Electron smoke test requires a desktop session and a completed production build. It uses an isolated temporary configuration and checks the actual UI, IPC validation, and background lifecycle without a MIDI device.

```text
apps/desktop/main/       Lifecycle, tray, validated IPC, routing host
apps/desktop/preload/    Restricted renderer bridge
apps/desktop/renderer/   React configuration UI and isolated audio page
packages/midi/          Device connections, normalization, encoders, routing
packages/config/        Defaults and atomic configuration store
packages/profiles/      Application matching and layered resolution
packages/actions/       Semantic action dispatch
packages/platforms/     OS interface and Windows input worker
packages/synth/         Replaceable synth backend and Web Audio instrument
packages/shared/        Runtime schemas, shared types, action catalog
tests/                  MIDI, routing, profile, persistence, action tests
.github/workflows/      Cross-platform installers and tagged releases
```

See [architecture](docs/architecture.md), [actions](docs/actions.md), and [release instructions](docs/releases.md).

## Current boundaries / next milestones

- Included instruments are synthesized, **not sampled acoustic instruments**. Custom SoundFonts, native audio, ASIO, audio-device selection, and measured latency tuning remain future work.
- Profile-change notifications currently appear inside the configuration window. A system-wide overlay is not implemented.
- Affinity/OpenToonz presets cover a small set of default shortcuts; rotation/panning workflows need application-specific tuning. There is no plugin API yet.
- One MIDI input and one hardware definition are active at a time. Multiple devices and selective passthrough remain future work.
- MIDI Learn captures identity, not encoder mode. Choose the encoder encoding using the inspector.
- Releases can be built without signing credentials. Public, frictionless distribution requires signing/notarization configuration described in the release guide.
- Native Windows actions and physical MiniLab behavior require verification on the target hardware. Unit tests cover routing and action dispatch independently of a connected controller.

The longer-term roadmap remains in `plan.md`.
