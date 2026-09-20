# Controller definitions and MIDI Learn

A controller definition describes hardware; application and user profiles reference its **logical control IDs**. For example, `encoder-1` can mean system volume globally and canvas zoom in Affinity without duplicating the MIDI details.

Each control specifies:

- Stable ID and display name.
- MIDI type (`cc`, `note-on`, or `pitch-bend`).
- One-based channel (1–16).
- CC or note number (0–127); pitch bend uses 0.
- Behavior, sensitivity, inversion, and acceleration.

Use **Mappings → Add mapping → Learn a control**. The next note-on, nonzero CC, or pitch-bend message fills in the input identity. Learning suppresses that input's action and expires after 30 seconds. Existing sounding keys still receive note-off messages.

When editing an existing logical control, Learn updates that control. When creating a new mapping, Learn reuses an existing matching definition if possible. Controller edits apply to every profile. You can also choose **Custom control** and enter values manually for any standard MIDI device.

## Choosing an encoder mode

Inspect slow clockwise and counterclockwise turns:

| Typical clockwise | Typical counterclockwise | Mode |
|---|---|---|
| 65 | 63 | Relative offset |
| 1 | 127 | Relative two's complement |
| 1 | 65 | Relative signed magnitude |
| Increasing 0–127 | Decreasing 127–0 | Absolute |

Absolute controls establish a baseline on their first message and then generate signed deltas. They do not set an absolute system volume. Relative magnitude is retained. Sensitivity multiplies the delta; fractional action steps accumulate. Acceleration doubles encoder movement when consecutive events arrive within 40 ms. Each dispatched action is capped at 20 repetitions to bound rapid input bursts.

Buttons trigger on press, not release. Note-off messages with nonzero release velocity also re-arm pads correctly.

## MiniLab MkII starting preset

- Encoders 1–16: channel 1, CCs `74, 71, 76, 77, 93, 18, 19, 16, 17, 91, 79, 72, 73, 75, 114, 115`.
- Pads 1–16: channel 10, notes 36–51.
- Factory MIDI Control Center settings may differ. Confirm all controls with the inspector and Learn.
- Encoder push switches, when configured to emit MIDI, can be added as custom button controls.

The visualization shows the first sixteen CC controls and first eight pad controls. All definitions and mappings are accessible in the editor/library, including the second pad bank.

Exported configuration files contain the controller definition and all profiles. The current import operation replaces the entire configuration after validation and confirmation rather than merging definitions.
