# Architecture

```text
Native MIDI input (JZZ / jazz-midi)
  → normalization
  → router
      → isolated audio window / SynthBackend
      → profile resolver → action engine → platform adapter
      → MIDI output (DAW mode)
      → MIDI Learn / inspector notifications
```

## Electron process boundaries

The main process owns devices, configuration, routing, desktop actions, foreground polling, login integration, and the tray. The React configuration window is sandboxed with `nodeIntegration: false` and `contextIsolation: true`.

The preload exports only explicit configuration, device-refresh, Learn, panic, import/export, and notification methods. Main-process handlers validate the sending WebContents and main frame. Configuration is validated with Zod before use or storage. Arbitrary IPC channels, Node primitives, shell execution APIs, navigation, popups, and remote configuration are not exposed.

Audio runs in a separate hidden, unthrottled BrowserWindow with Web Audio. It remains alive when the configuration window is hidden. The audio page can receive MIDI/settings and announce readiness; it cannot use configuration mutation IPC because it is not the authorized configuration WebContents. `SynthBackend` is a replaceable interface for a future native or SoundFont engine.

## State and persistence

The main process is authoritative. Mutations are serialized, validated, and written through a temporary-file rename. Save success returns a full state snapshot. Existing corrupt files fail visibly at startup rather than being reset. Runtime configuration changes issue all-notes-off, clear encoder state, stop learning, and reconfigure routing/audio; this prevents hanging voices at the cost of interrupting currently held notes when settings change.

Devices are rediscovered every four seconds. The saved port name is reconnected when it becomes available. Foreground detection runs once per second, with one outstanding query at a time. Profile changes preserve already-playing notes' release routing. MIDI input is displayed in bounded buffers so the UI cannot grow indefinitely.

## Platform integration

Windows uses a persistent local PowerShell process with a fixed embedded C# Win32 bridge. Messages are JSON-lines requests, not interpolated PowerShell source. The worker provides foreground lookup, virtual-key sequences, media keys, and wheel events. A bounded request queue and timeouts prevent unbounded dispatch. Explicit user-defined PowerShell actions run separately from this worker.

macOS uses a compiled universal arm64/x86_64 Objective-C Node-API module **inside the Electron main process**. CoreAudio provides volume/mute; NSWorkspace supplies foreground application names; Quartz/AppKit provide keyboard, scroll, and media events. Permission checks, permission requests, and injection now share the app's PID and signing identity. No production input helper is spawned. The former JSON-lines executable is still compiled for low-level diagnostic tests, but is not shipped or used as an input fallback. Missing native modules fail visibly rather than silently switching permission identities.

The Node-API entry accepts bounded JSON requests for a fixed method set; it is available only to main-process code. The renderer retains its narrow validated IPC bridge. Keyboard posting uses `CGPreflightPostEventAccess` as the relevant capability; AX tree trust is reported separately and is not an extra input gate. The explicit permission check verifies the backend PID against the host PID, reports a durable result, and—when allowed—posts an F20 probe only to its own focused window. A temporary `before-input-event` handler consumes that probe and confirms delivery or reports a timeout. No test key is sent into another app. A local `permission-check.json` preserves the result for diagnosis.

The build ships `Contents/Resources/native/midi-deck-macos.node`. Node-API headers avoid an Electron-ABI-specific rebuild. There is no interpolated AppleScript, runtime compilation, or Automation permission dependency. Linux input integration remains unimplemented.

## Controller feedback

MiniLab feedback is an explicitly enabled, independently selected MIDI output. `MidiDevices` shares a connection if DAW and feedback outputs name the same port and otherwise keeps destinations isolated. No arbitrary SysEx IPC is exposed. The main process produces only fixed, validated LED messages from structured configuration.

The feedback engine resolves pad colors using the same profile layers as actions, and reads actual macOS mute state instead of guessing toggle state. It coalesces desired changes and sends at most one normal-update SysEx per 15 ms. Input/Learn pulses restore the latest resolved color. Reconnects invalidate the cache; DAW mode, disabling feedback, and shutdown clear owned lights and stop feedback. Clearing on handoff is sent immediately before the port closes. Utility LEDs default to hardware ownership; only explicitly overridden utility indicators are touched.

Configuration remains version 1 with backwards-compatible defaults. Definition revision 1 added strips and LED metadata. Revision 2 repairs the identifiable original encoder preset's CC order/encoding and adds Any-channel matching for keyboard-following inputs; partially customized encoder sets are preserved. Known default Affinity matches gain the unified application's executable names. Revisions prevent subsequent user edits from being overwritten.

## Profile editing and notifications

`resolvePreview` mirrors mapping inheritance for an explicitly selected editor profile without mutating runtime configuration: Global alone; selected user + Global; selected application + active user + Global. Overview controls show the resolved mapping and source; inherited mappings are copied into the selected layer only when saved.

`ProfileChangeNotifier` tracks effective profile identity, debounces transitions, and suppresses repeat polls and same-profile app changes. The primary feedback is a transparent, always-on-top, click-through BrowserWindow. On macOS it explicitly uses `type: 'panel'` (a non-activating NSPanel), in addition to `focusable: false` and `showInactive()`. Normal NSWindow instances can still activate their owning application; `showInactive()` alone is insufficient. Existing visible panels receive content updates without being shown again. The passive app `activate` handler only reopens a hidden editor and never force-focuses the application; explicit tray/open actions retain their normal focus behavior.

The overlay is sandboxed and can display across macOS Spaces/fullscreen. It receives only display notices through preload; main mutation IPC rejects it. The same overlay shows volume/mute state and failed actions. It does not depend on Notification Center permission. Optional Electron native `Notification` banners have a separate setting and remain subject to OS permissions/Focus mode. Foreground detection polls every 350 ms.

Routing reports distinguish received input from actual profile resolution, channel mismatches, baseline/neutral input, disabled overrides, learning, and passthrough. The latest report is kept in state and streamed at a bounded rate; action failures are also displayed as renderer banners. This makes hardware identity/mode errors diagnosable without relying on an action log entry that never occurs.

State includes runtime version/location, MIDI counters, last input time, action dispatch counts, and a bounded recent-activity buffer. Startup migrations create an original-file backup and persist their result immediately, rather than relying on a subsequent user save. `scripts/build-assets.cjs` renders `icon.svg` into portable PNG/ICO/ICNS resources on each build platform.

The focus regression uses real Affinity activation and real CoreMIDI volume messages, observes the full appearance/update/dismissal lifecycle, and records app/window focus events. It runs against development and packaged builds with isolated data directories. IPC state is polled from Node using `waitForState`; async `page.waitForFunction` predicates would treat a pending Promise as truthy before its boolean result and are deliberately avoided.

## Keyboard shortcut recording and permission help

`ShortcutRecorder` listens to the configuration window's `before-input-event` only during an explicit recording session. Narrow start/finish/cancel IPC methods authorize that window's main frame. Capture prevents page defaults and menu accelerators, handles missing macOS Command key-up via modifier release or explicit confirmation, and restores normal keyboard handling on completion, blur, cancel, timeout, window close, or disposal. The renderer also guards the brief IPC arming interval so Escape/Enter cannot close/submit the modal before capture starts. No global keyboard hook or Accessibility permission is required to record.

The renderer converts completed captures into the existing `shortcut.send` action parameters; it does not inject OS input. The in-process native module handles execution and permission checks as the same app identity the user authorizes. The settings guide shows the exact running app bundle with fixed-purpose Finder/recheck actions. The error overlay uses a larger, wrapped layout and nine-second timeout; it remains non-activating and click-through. Full instructions and check results persist in Settings.

Recorder integration tests use Electron's `webContents.sendInputEvent`, because DevTools keyboard events bypass the main-process `before-input-event` hook. Tests cover Escape and Cmd+Q suppression, release handling, directional capture, and persistence.

## Tests

Tests cover MIDI parsing, four relative encoder formats and MiniLab neutral messages, button release semantics, profile priority, learning suppression, note-release ownership across profile changes, passthrough, validation, persistence, both shortcut parsers, fractional action steps, launcher errors, LED byte sequences and lifecycle, output isolation, and configuration upgrades. Synth tests verify pitch/modulation interaction, MIDI-channel independence, and reset/release behavior. OS-specific integration tests start the real helpers and query foreground/permission/audio state without injecting input or changing volume. The Electron smoke test verifies the additional hardware UI and macOS helper readiness.

Physical controller communication, real audio latency, DAW routing, and per-application shortcuts still need hardware/OS acceptance testing. CI builds both supported installer platforms without requiring a connected controller.
