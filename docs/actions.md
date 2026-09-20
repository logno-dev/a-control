# Action reference

Mappings contain an action ID and optional parameter. Platform-specific input lives in `packages/platforms`, never in the controller definition.

| Action | Parameter / behavior |
|---|---|
| `system.volume.change` | Signed steps send volume-up/down media keys; Windows typically changes volume by 2% per key |
| `system.mute` | Toggle system mute |
| `media.playPause`, `media.next`, `media.previous` | Native Windows media keys |
| `application.launch` | Absolute executable or macOS application bundle path |
| `file.open` | Absolute file or directory path, opened with the OS association |
| `url.open` | HTTP or HTTPS URL |
| `command.run` | Explicit shell command; Windows system shell or Unix `/bin/sh` |
| `powershell.run` | PowerShell source; Windows only |
| `shortcut.send` | Chord, optionally `positive chord | negative chord` |
| `profile.switch` | User profile name or ID |
| `canvas.zoom` | Affinity/generic: Ctrl+Plus / Ctrl+Minus; OpenToonz: numeric keypad Add / Subtract |
| `canvas.rotate` | Requires configured `clockwise shortcut | counterclockwise shortcut` matching your application's key bindings |
| `canvas.panX`, `canvas.panY` | Horizontal / vertical wheel events |
| `brush.size` | Right bracket / left bracket |
| `timeline.seek` | OpenToonz: Down / Up; generic: Right / Left; Affinity requires custom directional shortcuts |

Shortcut examples: `Ctrl+Shift+S`, `Alt+Tab`, `Ctrl+Tab | Ctrl+Shift+Tab`, `Win+D`, `F5`. The parser supports A–Z, 0–9, F1–F24, modifier keys, navigation keys, brackets, comma, period, slash, `Plus`, and `Minus`. It uses Windows virtual key codes; punctuation can vary with keyboard layout.

Application adapter defaults assume standard shortcuts and the correct application tool/workspace. Affinity zoom/brush and OpenToonz zoom/timeline are included as starter mappings. For custom keymaps, use `shortcut.send` and explicitly specify clockwise/counterclockwise chords. Wheel panning behavior depends on the application; it is not simulated mouse dragging.

Commands have a 30-second execution limit and at most four direct child processes run concurrently. Launch/command actions are debounced for 700 ms per mapping. Command child processes may spawn independent processes; this is not a sandbox. Use launcher actions for long-running GUI applications.

The renderer never directly executes commands. Imported configuration displays command and launch targets in the native import dialog before replacing the current settings. Desktop action failures appear in the inspector's action log.
