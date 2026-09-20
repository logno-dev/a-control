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

macOS/Linux adapters report unsupported input-injection actions explicitly. Shared Electron shell integrations and normal shell commands still work there. This leaves the platform boundary ready for native implementations without coupling it to MIDI definitions.

## Tests

Unit tests cover MIDI parsing, relative encoder formats, button release semantics, profile priority, learning suppression, note-release ownership across profile changes, passthrough, validation, persistence, shortcut parsing, fractional action steps, and launcher errors. A Windows-only integration test starts the real worker and queries foreground state without injecting input.

Physical controller communication, real audio latency, DAW routing, and per-application shortcuts still need hardware/OS acceptance testing. CI builds both supported installer platforms without requiring a connected controller.
