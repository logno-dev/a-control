# Controller definitions and MIDI Learn

A controller definition describes hardware; application and user profiles reference its **logical control IDs**. For example, `encoder-1` can mean system volume globally and canvas zoom in Affinity without duplicating the MIDI details.

Each control specifies:

- Stable ID and display name.
- MIDI type (`cc`, `note-on`, or `pitch-bend`).
- One-based channel (1–16), or **0 / Any** to follow input across channels. Exact-channel definitions take precedence over an Any-channel fallback for the same signal.
- CC or note number (0–127); pitch bend uses 0.
- Behavior, sensitivity, inversion, and acceleration.

Use **Overview → Editing profile → Add mapping → Learn MIDI input**, or click a physical control in the visualization. The next note-on, nonzero CC, or pitch-bend message fills in the input identity. Learning suppresses that input's action and expires after 30 seconds. Existing sounding keys still receive note-off messages.

The editor separates **1 · MIDI trigger** from **2 · Action to run**. MIDI Learn identifies hardware input. **Record a keyboard shortcut** captures a computer-keyboard chord for the `shortcut.send` output action. These are independent operations; you do not need to relearn an already selected MIDI control to record its shortcut. The output is stored using the same portable action/parameter model as manually entered shortcuts.

When editing an existing logical control, Learn updates that control. When creating a new mapping, Learn reuses an existing matching definition if possible. Controller edits apply to every profile. You can also choose **Custom control** and enter values manually for any standard MIDI device.

## Choosing an encoder mode

Inspect slow clockwise and counterclockwise turns:

| Typical clockwise | Typical counterclockwise | Mode |
|---|---|---|
| 65 | 63 | Relative offset |
| 1 | 127 | Relative two's complement |
| 1 | 65 | Relative signed magnitude |
| 17 | 15 | Arturia Relative 3 (offset 16) |
| Increasing 0–127 | Decreasing 127–0 | Absolute |

Absolute controls establish a baseline on their first message and then generate signed deltas. They do not set an absolute system volume. Relative magnitude is retained. Hardware sensitivity multiplies the delta; per-profile **Action sensitivity** applies afterward. Fractional action steps accumulate. Acceleration doubles encoder movement when consecutive events arrive within 40 ms. Most actions are capped at 20 repetitions per dispatch. Canvas zoom has a stricter one-step / 120 ms cap and defaults to 0.25 action sensitivity for relative dials or 0.10 for strips/absolute controls, with no queued backlog of zoom keystrokes.

Arturia calls offset-64 **Relative 1**, two's complement **Relative 2**, and offset-16 **Relative 3**. The device may insert a neutral `00` between relative messages; MIDI Deck ignores it instead of interpreting it as a large negative movement. Signed magnitude is an additional generic mode, not Arturia's Relative 3.

Buttons trigger on press, not release. Note-off messages with nonzero release velocity also re-arm pads correctly.

## MiniLab MkII starting preset

- Encoders 1–16: Any channel, CCs `112, 74, 71, 76, 77, 93, 73, 75, 114, 18, 19, 16, 17, 91, 79, 72`.
- Encoders 1 and 9 use Relative 1; the other factory memory-1 encoders use Absolute. Encoder click messages are separate (commonly CC113/115); learn them independently.
- Pads 1–16: channel 10, notes 36–51.
- Factory MIDI Control Center settings may differ. Confirm all controls with the inspector and Learn.
- Encoder push switches, when configured to emit MIDI, can be added as custom button controls.

The visualization shows sixteen encoders, both touch strips, eight pads from the selected preview bank, and the four hardware utility buttons. Pad identity and LED address are independent of MIDI note/CC values, so learned pad assignments retain their physical light. All definitions remain accessible in the library. Surface position and physical pad LED can be edited explicitly.

## Touch strips and the four top-left buttons

Pitch defaults to Any channel, 14-bit pitch bend; modulation defaults to Any channel, CC1. The built-in synth applies pitch bend and a 5.5 Hz vibrato with depth controlled by modulation. Channels are independent. Unmapped strips remain musical; mapped strips are consumed by desktop routing. Each touch gesture establishes a relative baseline on its first sample. The pitch strip's center-reset ends that gesture, and a gap longer than 300 ms establishes a fresh baseline for either strip. The hardware provides no separate touch-down/up event, so the idle gap is a gesture heuristic. **Ignore spring return to center** is enabled by default for desktop pitch mappings, preventing the reset packet from undoing a zoom or volume gesture. Disable it if you want center motion to count (for example with the hardware's Hold setting). This never alters raw pitch/modulation messages sent to the synth or DAW.

The four top-left buttons manage the controller internally:

- **Shift**: hold with a pad to select device memory, with a keyboard key to select MIDI channel, or with encoder 1/9 to send their alternate assignments.
- **Pad 1–8 / 9–16**: changes the physical pad bank. MIDI Deck recognizes the resulting learned pad input and follows that bank on screen. Its preview selector does not send a hardware bank command.
- **Oct − / Oct +**: transpose the keyboard in hardware. MIDI Deck receives and plays the changed note numbers; pressing both resets the range.
- **Shift + both octave buttons**: sends All Notes Off / Reset All Controllers. The synth honors these even while MIDI Learn is active.

These are not four extra note/CC macro buttons in normal operation. The UI explains this instead of assigning invented MIDI addresses. **Learn Shift + Encoder 1/9** and **Learn Encoder 1/9 click** capture the actual MIDI messages those gestures emit; use a custom device memory if needed. Changing memories or the hardware keyboard channel can change the messages your controls send; Learn is authoritative.

## MiniLab LED feedback

Enable it in Settings and explicitly select the MiniLab's hardware output. There are sixteen logical pad LED addresses (two banks), eight supported colors including Off, and four monochrome utility LEDs. Per-mapping **Automatic** colors distinguish action families; explicit colors override this. Mute is red when the macOS output reports muted, green when unmuted, and assignment-yellow when its state is unknown (including the current Windows adapter). Playback colors indicate action assignments, not actual player state. Active `profile.switch` pads are white. Disabled or paused mappings are off.

Pad presses flash white, learned pads cyan, and failed pad actions red. **Test pad colors** temporarily shows the palette and restores resolved colors. **Reapply colors** is useful after recalling a memory or another application takes over the lights. The engine is suspended in DAW mode and clears the lights it owns before releasing the port or quitting. Utility overrides have on/off choices; **Hardware controlled** stops overriding them. Hardware gestures can redraw native indicators. Recall your MiniLab memory to restore its stored colors/indicators after disabling feedback; MIDI Deck does not read or persist the original light state.

Only transient LED commands are sent. No device-memory writes, firmware changes, or remapping SysEx is performed. MIDI Control Center's *Pad off Backlight* setting and firmware/preset behavior can affect what stays illuminated; physical testing is necessary on your unit.

Protocol packet: `F0 00 20 6B 7F 42 02 00 10 <address> <color> F7`.

- Pad addresses: `70`–`7F` (hex), pads 1–16.
- Utility addresses: Shift `2E`, Bank `2F`, Oct − `10`, Oct + `11` (hex).
- Colors: Off `00`, Red `01`, Green `04`, Yellow `05`, Blue `10`, Magenta `11`, Cyan `14`, White `7F`. Utility lights use only Off/White.

References: [Arturia MiniLab MkII manual v1.1](https://dl.arturia.net/products/minilab-mkII/manual/minilab-mkii_Manual_1_1_EN.pdf), sections 2.1, 4.6, 4.7, and 4.8; [community protocol examples](https://github.com/psitech/Arturia-Minilab-MKII-LED-control) for LED addresses and color values. Hardware behavior is documented separately from the community-derived feedback protocol.

## Correcting the original preset

Definition revision 2 repairs the original, recognizably untouched sixteen-encoder preset as a group. The original CC order was wrong (including CC74 instead of CC112 for encoder 1), all knobs were incorrectly declared relative, and keyboard-following controls were pinned to channel 1. Actions, profile memberships, names, sensitivity, and inversion are preserved. Partly learned/custom encoder sets are not reset. Original channel-1 strip definitions become Any-channel definitions; other explicitly selected channels are preserved. Revision 2 also adds the current unified Affinity executable names to the known default Affinity match list.

Read-only queries against a connected MiniLab confirmed the corrected CC order, different encoder modes, and `0x41` (follow keyboard) channel assignments. The device's keyboard channel can be changed with Shift+key, so it must not be assumed to stay at channel 1. Absolute baselines are maintained per device **and actual MIDI channel**.

Exported configuration files contain the controller definition and all profiles. The current import operation replaces the entire configuration after validation and confirmation rather than merging definitions.
