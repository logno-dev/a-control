# Action reference

Mappings contain an action ID and optional parameter. Platform-specific input lives in `packages/platforms`, never in the controller definition.

| Action | Parameter / behavior |
|---|---|
| `system.volume.change` | Windows: media volume keys; macOS: ±2 percentage points per step on the default CoreAudio output |
| `system.mute` | Toggle system mute |
| `media.playPause`, `media.next`, `media.previous` | Native system media-key events on Windows and macOS; the OS chooses the receiving media application |
| `application.launch` | Absolute executable or macOS application bundle path |
| `file.open` | Absolute file or directory path, opened with the OS association |
| `url.open` | HTTP or HTTPS URL |
| `command.run` | Explicit shell command; Windows system shell or Unix `/bin/sh` |
| `powershell.run` | PowerShell source; Windows only |
| `shortcut.send` | Chord, optionally `positive chord | negative chord` |
| `profile.switch` | User profile name or ID |
| `canvas.zoom` | Affinity on macOS: Primary+Add / Primary+Minus; Affinity on Windows and generic: Primary+Plus / Primary+Minus; OpenToonz: numeric keypad Add / Subtract |
| `canvas.rotate` | Requires configured `clockwise shortcut | counterclockwise shortcut` matching your application's key bindings |
| `canvas.panX`, `canvas.panY` | Horizontal / vertical wheel events |
| `brush.size` | Right bracket / left bracket |
| `timeline.seek` | OpenToonz: Down / Up; generic: Right / Left; Affinity requires custom directional shortcuts |

Shortcut examples: `Primary+Shift+S`, `Cmd+Tab`, `Ctrl+Tab | Ctrl+Shift+Tab`, `Win+D`, `F5`. `Primary` means Control on Windows and Command on macOS. Explicit `Ctrl` always means Control. On macOS, `Cmd`, `Command`, and `Meta` mean Command; `Alt` / `Option` mean Option. Parsers support letters, digits, navigation keys, brackets, comma, period, slash, `Plus`, `Minus`, keypad `Add` / `Subtract`, and function keys (Windows F1–F24; macOS F1–F20). Keys use platform virtual key codes, so punctuation depends on keyboard layout.

The mapping editor can record these values from the computer keyboard. It captures a single key chord rather than a timed macro sequence. Positive and negative directions can be recorded separately for continuous controls. Modifier-only input and auto-repeat do not create additional captures, and unsupported keys are reported instead of silently saving unusable values. Command chords finish on key release, modifier release, or explicit **Use captured shortcut**, because macOS can omit key-up messages while Command is held. Semicolon, quote, backslash, and backquote are also supported by both platform parsers.

The in-process macOS module checks keyboard-posting permission before injecting keyboard, media, or scroll input and reports a clear error if denied. Checks and injection run as MIDI Deck itself, not as a child helper with a potentially different permission identity. CoreAudio volume and mute operate on the current default output (master control or stereo channels); devices without writable controls report an unsupported-output error rather than pretending to change volume. Media-key delivery follows macOS behavior, including which player currently owns media controls; it is not a player-specific API.

On macOS, `Plus` sends the literal `+` character with only the explicitly selected modifiers; `Cmd+Shift+Equals` preserves an explicitly recorded physical chord. Some apps resolve native key codes instead of the overridden character. Affinity's verified zoom-in binding therefore uses `Primary+Add` (native keypad plus) rather than synthesizing `+` on the equals key. This is selected automatically by the macOS Affinity adapter and can also be entered as `Primary+Add | Primary+Minus` in an override. The Windows Affinity binding is unchanged. Affinity automatic switching recognizes the unified `Affinity` / `Affinity Affinity Store` executable names in addition to older Photo/Designer/Publisher names.

Canvas zoom defaults to 0.25 sensitivity for relative dials and 0.10 for strips/absolute controls, and sends at most one shortcut every 120 ms. Oversized bursts are coalesced instead of queued, and reversing direction clears the opposite fractional movement. A profile's mapping can override action sensitivity independently of the shared hardware definition. Buttons retain one step per press. This slows menu-based zoom while keeping volume and unrelated controls at their existing speed.

Application adapter defaults assume standard shortcuts and the correct application tool/workspace. Affinity zoom/brush and OpenToonz zoom/timeline are included as starter mappings. For custom keymaps, use `shortcut.send` and explicitly specify clockwise/counterclockwise chords. Wheel panning behavior depends on the application; it is not simulated mouse dragging.

Commands have a 30-second execution limit and at most four direct child processes run concurrently. Launch/command actions are debounced for 700 ms per mapping. Command child processes may spawn independent processes; this is not a sandbox. Use launcher actions for long-running GUI applications.

The renderer never directly executes commands. Imported configuration displays command and launch targets in the native import dialog before replacing the current settings. Desktop action failures appear in the inspector's action log.
