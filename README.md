# MIDI Deck

**Your MIDI controller, beyond music.** A Windows-first Electron + TypeScript tray application that turns pads and encoders into desktop controls while keeping the keyboard playable.

Version **0.2.5** implements the project in [`plan.md`](plan.md), with a hardware-independent MIDI engine and an editable MiniLab MkII preset. Check the sidebar version or **Settings → Build & diagnostics** to identify the exact running build and executable path.

## Run locally

Requires **Node.js 22.16+** and npm. Windows 10/11 is the primary desktop-action target; the app also runs on Intel and Apple Silicon macOS.

For development on macOS, install **Xcode Command Line Tools** (`xcode-select --install`). The build compiles a universal Node-API module for system actions. It runs inside MIDI Deck's main process, so keyboard permission belongs to the app you enable in macOS. Installed releases include the module and do not require developer tools.

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
4. In **Overview**, select **Editing profile**, click a control (or **Add mapping**), and use **Learn MIDI input** if its hardware input needs identifying.
5. Move the control, choose its behavior and action, then save.
6. Play the keyboard: unmapped notes go to the synth. Mapped pads trigger actions rather than notes.

MiniLab presets differ by MIDI Control Center configuration. The corrected memory-1 definition uses CC112 for encoder 1, relative-offset encoding for encoders 1/9, absolute encoding for the others, and pads on channel 10. Encoders and touch strips accept **Any channel** so they follow the controller's keyboard-channel setting. These remain editable starting values. See [controller profiles](docs/controller-profiles.md).

The overview's **Editing profile** selector previews and edits Global, every user profile, and every application profile without changing live routing. There is no separate list-based Mappings page. Knobs, pads, and strips show the resolved action. Clicking an inherited action prefills it and explains that saving creates an override in the selected profile; select its source profile to edit the original. Enable/disable and delete actions in the mapping editor.

Continuous **Canvas zoom** defaults to **Action sensitivity 0.25** for relative dials (about four normal ticks per step) and **0.10** for strips/absolute controls. It emits at most one menu zoom step every 120 ms. Adjust that per-profile setting in the mapping editor; smaller values are slower. Buttons still zoom one step per press. Touch strips use the first position of each contact as a relative origin, so touching a different position does not jump the document zoom. Pitch-center release and a strip idle gap reset that origin. Affinity on macOS uses Command + native keypad Add for zoom-in and Command + Minus for zoom-out; the keypad key avoids Affinity ignoring a synthesized plus character on the equals key.

### Record a keyboard shortcut

1. Click the MIDI control you want to configure in Overview.
2. Under **2 · Action to run**, click **Record a keyboard shortcut** (or select the **Keyboard shortcut** action).
3. When the recorder says **Ready**, press a single key or hold modifiers and press a key, such as `Cmd+Shift+S` or `Ctrl+Shift+S`.
4. Release the keys. If the OS omits release events, click **Use captured shortcut**.
5. For an encoder or strip, optionally record a separate **negative** shortcut for the other direction.
6. Click **Save mapping**. The MIDI control will send that shortcut to the foreground application.

**Learn MIDI input** identifies the physical MIDI trigger; the **keyboard shortcut recorder** defines its output action. The selected control is already identified when opened from the overview, so MIDI Learn is optional. The recorder handles one chord, stops on cancellation/focus loss/timeout, and suppresses MIDI Deck's own keyboard/menu actions during capture. Escape, Tab, and Enter can be recorded; use the on-screen Cancel recording button to stop. OS-reserved shortcuts may be intercepted by the OS and can be entered manually. Recording inside MIDI Deck does not require macOS Accessibility access; executing the shortcut in another application does.

If a control seems inactive, the **Live input routing** panel shows the received channel/CC/value, the resolved profile/action, and explanations such as channel mismatch, missing mapping, or absolute-position baseline. Action errors appear as banners and on-screen overlays. Settings shows MIDI input counts, action dispatches, last errors, running app location, controller revision, and saved configuration path. macOS also has **Test volume and restore**, which checks CoreAudio independently of MIDI. The volume overlay explicitly indicates when the output is muted; adjusting level does not silently unmute it.

Closing the configuration window hides it. MIDI routing and audio continue in the background. Use the tray/menu-bar icon to reopen the window, change profiles, pause mappings, stop notes, or quit.

## Included

- Native USB MIDI discovery through JZZ / jazz-midi, hot-plug refresh, persistent input selection.
- Note, CC, pitch-bend normalization and raw-event inspection.
- MIDI Learn, custom logical controls, editable channel/CC/note values.
- Absolute encoders and four relative encodings (including all three MiniLab modes); sensitivity, inversion, acceleration.
- Global, user, and foreground-application profiles with explicit override precedence.
- Windows and macOS keyboard shortcuts, media keys, volume adjustment, mute, scroll injection, and foreground detection.
- MiniLab MkII pad LED feedback for both banks, per-mapping colors, real macOS mute-state colors, utility-light overrides, test/resync controls, and separate LED output selection.
- Pitch/modulation strip visualization and mapping, synth modulation/vibrato, bank previews, and explanations of the four hardware utility buttons.
- Launch applications, open paths/URLs, run shell commands, run PowerShell, and switch profiles.
- Affinity and OpenToonz starter profiles and a small semantic art-action adapter set.
- A separate audio window with a 48-voice Web Audio synth, velocity sensitivity, sustain, and two-semitone pitch bend.
- Synthesized piano, electric keys, organ, soft synth, and strings; master volume and all-notes-off.
- Full MIDI passthrough to a selected output; synth and desktop actions are disabled in passthrough mode.
- Tray controls, start-at-login on Windows/macOS, atomic JSON persistence, configuration import/export with action disclosure.
- A click-through, non-focus-stealing status overlay for profile changes, volume, and action errors, including in tray mode; optional native Notification Center banners.
- App, tray, Dock, Windows ICO, and macOS ICNS icons generated from the project-root `icon.svg`. The icon retains its original colors within the grayscale interface.
- Sandboxed renderers, context isolation, a narrow preload API, main-frame IPC validation, and schema-validated configuration.
- Automated core tests and macOS/Windows build and release workflows.

## Platform coverage

| Capability | Windows | macOS |
|---|---|---|
| MIDI input, MIDI Learn, profiles, passthrough | Yes | Yes |
| Synth, tray/menu-bar, start at login | Yes | Yes |
| Open application/file/URL and shell commands | Yes | Yes |
| Keyboard/media/scroll injection | Yes | Yes, with Accessibility permission |
| System volume and mute | Yes | Yes, if the output supports software control |
| Foreground-application detection | Yes | Yes |
| MiniLab pad/utility LED output | Yes | Yes |
| PowerShell actions | Yes | — |

On macOS, select an application bundle's absolute path for launcher actions. On Windows, select an executable's absolute path. Input injection on Windows targets the foreground app and follows normal Windows integrity restrictions; an unelevated MIDI Deck cannot inject input into elevated applications.

On macOS, use **Settings → macOS integration → Open Accessibility settings** to authorize keyboard, scroll, and media events. Volume/mute use CoreAudio and foreground detection uses NSWorkspace; neither requires Accessibility or AppleScript Automation permission. Use `Cmd+S` for a Mac shortcut, `Ctrl+S` for actual Control, or `Primary+S` for Command on Mac / Control on Windows. Profile matching uses the executable name shown in Settings (for example, `Affinity Photo 2` or the unified app's `Affinity Affinity Store`). Existing default app profiles are upgraded without overwriting customized matches.

For blocked zoom/shortcuts, follow the persistent setup guide in **Settings → macOS integration**: open **System Settings → Privacy & Security → Accessibility**, enable **MIDI Deck**, or use **+** to add it. **Show app in Finder** reveals the exact running `.app`; remove/re-add a stale entry if it refers to an older copy. **Check permission again** now returns a persistent result, separate Accessibility/keyboard-posting flags, the checking process, and a timestamp. If posting is allowed and the window is focused, it sends a harmless test key to MIDI Deck itself and confirms receipt. It explicitly reports denial, a restart requirement, native loading errors, or failed delivery instead of merely refreshing the page.

Version 0.2.3 replaces the old child-process input helper and packages macOS builds with their own bound signing identity. Upgrades from older builds may require removing the old Accessibility entry and re-adding the installed app. Local builds are ad-hoc signed; Developer ID signing is required for stable public-distribution trust across updates. The last explicit check is saved locally as `permission-check.json` next to `settings.json`; it contains only permission/process diagnostics, not mappings or recorded keystrokes. Error overlays wrap the essential instructions and stay visible for nine seconds without taking focus.

Automatic overlays and native banners are **off by default**. Under **Settings → On-screen profile changes**, you can enable the overlay and click **Test on-screen overlay**. It appears near the bottom of the cursor's display and does not require Notification Center permission. If displaying a popup changes focus on your desktop/window-manager setup, leave automatic popups disabled; application-profile switching still works. Optional native banners have a separate toggle/test button and require macOS notification permission. Profile transitions are debounced.

## MiniLab lights and additional controls

1. In **Settings → MiniLab lights**, select the **MiniLab hardware MIDI output**, separately from any DAW passthrough output.
2. Enable feedback and click **Test pad colors**. Choose custom colors inside a mapping's editor, or leave **Automatic** for action-based colors.
3. Both banks are updated. The overview's **1–8 / 9–16** buttons change only the preview; playing a known pad selects that bank on screen.
4. Click the **Pitch** or **Mod** strip to map it. With no desktop mapping, pitch bend and modulation/vibrato control the synth. Use Learn if your device uses another MIDI channel or CC.
5. Click a utility button in the overview for its hardware function. **Shift, Pad Bank, Oct −, and Oct + are not ordinary assignable note/CC buttons.** Their effects already happen on the device: bank changes alter subsequent pad input, and octave changes alter keyboard notes. Shift+encoder 1/9 and encoder clicks can be learned as separate MIDI controls.

Utility-button **lights** can be overridden independently in Settings; default **Hardware controlled** preserves their normal indicators. Feedback pauses in DAW mode. See [controller details and protocol references](docs/controller-profiles.md) for behavior, limitations, and restoring hardware colors.

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

Valid older configurations are migrated and **saved immediately at startup**, with the original preserved as `settings.backup-<timestamp>.json` in the same directory. This applies the corrected MiniLab preset even if you never press Save in the UI. Backups are not created again when no migration is needed.

For an isolated profile or test run, set `MIDI_DECK_DATA_DIR` to an existing directory. It is supported in both development and packaged applications so the shipped app can be tested without touching normal user settings. Omit it for the normal configuration location.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run test:smoke
```

The Electron smoke test requires a desktop session and a completed production build. It uses an isolated temporary configuration and checks the actual UI, IPC validation, and background lifecycle without a MIDI device.

Opt-in macOS checks exercise real system APIs:

```sh
# Briefly change system volume by 2 percentage points, verify, and restore it:
MIDI_DECK_TEST_VOLUME=1 npx vitest run tests/macos-volume.integration.test.ts
# Send Cmd+Plus into the isolated smoke-test window (Accessibility required):
MIDI_DECK_TEST_INPUT=1 npm run test:smoke
# Exercise a real CoreMIDI source through JZZ, the running app, and CoreAudio:
MIDI_DECK_TEST_MIDI=1 npm run build
MIDI_DECK_TEST_MIDI=1 npm run test:smoke
# Also activate an installed /Applications/Affinity.app and verify profile/overlay changes:
MIDI_DECK_TEST_MIDI=1 MIDI_DECK_TEST_AFFINITY=1 npm run test:smoke
# Watch complete profile and volume overlay lifecycles, with the editor shown/hidden:
npm run test:focus
# Run the same focus regression against a packaged app using isolated settings:
MIDI_DECK_EXECUTABLE="release/mac-arm64/MIDI Deck.app/Contents/MacOS/MIDI Deck" npm run test:focus
```

The focus test requires the MIDI fixture built by `MIDI_DECK_TEST_MIDI=1 npm run build` and an installed Affinity app. It watches each display/dismissal cycle for six seconds, verifies that MIDI Deck never receives activation/focus, and checks native banners enabled and disabled. Volume changes are restored after each trial. On macOS the overlay is an explicitly non-activating panel; updating it does not re-show it, and passive application activation no longer invokes the editor's force-focus path.

```text
apps/desktop/main/       Lifecycle, tray, validated IPC, routing host
apps/desktop/preload/    Restricted renderer bridge
apps/desktop/renderer/   React configuration UI and isolated audio page
packages/midi/          Device connections, normalization, encoders, routing
packages/config/        Defaults and atomic configuration store
packages/profiles/      Application matching and layered resolution
packages/actions/       Semantic action dispatch
packages/platforms/     OS interface and Windows input worker
native/macos/           In-process Node-API CoreAudio/AppKit/Quartz integration
packages/controllers/  MiniLab definitions, LED protocol, feedback lifecycle
packages/synth/         Replaceable synth backend and Web Audio instrument
packages/shared/        Runtime schemas, shared types, action catalog
tests/                  MIDI, routing, profile, persistence, action tests
.github/workflows/      Cross-platform installers and tagged releases
```

See [architecture](docs/architecture.md), [actions](docs/actions.md), and [release instructions](docs/releases.md).

## Current boundaries / next milestones

- Included instruments are synthesized, **not sampled acoustic instruments**. Custom SoundFonts, native audio, ASIO, audio-device selection, and measured latency tuning remain future work.
- The status overlay is implemented; advanced per-control overlays and visual layout customization remain future work.
- Affinity/OpenToonz presets cover a small set of default shortcuts; rotation/panning workflows need application-specific tuning. There is no plugin API yet.
- One MIDI input and one hardware definition are active at a time. Multiple devices and selective passthrough remain future work.
- MIDI Learn captures identity, not encoder mode. Choose the encoder encoding using the inspector. Firmware-only utility buttons cannot be converted into MIDI macro inputs by the app.
- Releases can be built without signing credentials. Public, frictionless distribution requires signing/notarization configuration described in the release guide.
- Physical MiniLab lights, firmware-dependent messages, real audio latency, and desktop input require target-hardware acceptance testing. Automated tests cover routing/feedback, both native workers' read-only status operations on their OS, configuration upgrades, and Electron integration.

The longer-term roadmap remains in `plan.md`.
