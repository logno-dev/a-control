# MIDI Deck — Project Plan

## 1. Project Overview

MIDI Deck is a Windows-first, eventually cross-platform desktop application that repurposes standard USB MIDI controllers as programmable desktop control surfaces while preserving their normal musical functionality.

The initial development target is the **Arturia MiniLab MkII**, but the core application should not depend on Arturia-specific behavior. Any standard MIDI controller should eventually be usable.

The application will run primarily as a background/tray application. MIDI input will be routed according to configurable mappings and the currently active application.

The MiniLab can therefore simultaneously function as:

* A playable piano/synth
* A desktop macro controller
* A media controller
* An application launcher
* A system control surface
* An art/animation navigation controller
* A DAW/MIDI controller
* A programmable command surface

The keyboard should remain playable as an instrument during normal desktop use.

---

# 2. Primary Goals

## Core Goals

1. Detect and connect to USB MIDI controllers.
2. Listen to MIDI Note, CC, pitch bend, and related events.
3. Distinguish musical keyboard input from control-surface input.
4. Route keyboard notes to a low-latency software instrument.
5. Map pads, encoders, buttons, and other MIDI controls to desktop actions.
6. Support relative/endless rotary encoders.
7. Automatically change mappings according to the foreground application.
8. Provide an easy graphical configuration interface.
9. Provide MIDI Learn for creating mappings without manually entering MIDI values.
10. Run unobtrusively in the Windows system tray.
11. Start automatically with Windows if enabled.
12. Preserve the ability to use the controller normally with DAWs.

## Long-Term Goals

* macOS support
* Linux support
* Multiple MIDI controllers
* Shareable controller profiles
* Shareable application profiles
* Community-created application adapters
* Plugin/action API
* Visual on-screen overlays
* Advanced MIDI routing

---

# 3. Technology Stack

## Application

**Electron + TypeScript**

Electron will provide:

* Cross-platform desktop UI
* Tray integration
* Background process
* Configuration UI
* IPC between UI and engine
* Application lifecycle management
* Auto-start integration
* Packaging/updating

The Electron renderer should contain no privileged system logic.

## Architecture

```text
┌───────────────────────────────────────────┐
│                Electron App               │
│                                           │
│  ┌──────────────┐       ┌──────────────┐  │
│  │   Renderer   │ IPC   │ Main Process │  │
│  │              │◄─────►│              │  │
│  │ Config UI    │       │ MIDI Engine  │  │
│  │ MIDI Learn   │       │ Profiles     │  │
│  │ Profiles     │       │ Action Router│  │
│  │ Status       │       │ App Detector │  │
│  └──────────────┘       └───────┬──────┘  │
│                                 │         │
└─────────────────────────────────┼─────────┘
                                  │
                  ┌───────────────┼──────────────┐
                  ▼               ▼              ▼
             Synth Engine    OS Adapter     App Adapters
                  │               │              │
                  ▼               ▼              ▼
               Audio          Windows        Affinity
                              macOS          OpenToonz
                              Linux          etc.
```

---

# 4. Process Model

## Electron Main Process

Responsible for:

* MIDI device discovery
* MIDI event handling
* MIDI routing
* Profile management
* Foreground application detection
* Action dispatch
* Tray behavior
* System integrations
* Configuration persistence
* Communication with synth/audio backend

The main process should continue running when the configuration window is closed.

## Renderer

Responsible only for UI.

Functions include:

* Device selection
* Mapping editor
* MIDI Learn
* Profile configuration
* Application profile configuration
* Synth configuration
* Controller visualization
* Status information

Renderer access to privileged functionality must occur through a narrow IPC/preload API.

## Audio/Synth Process

Audio should eventually be isolated from the Electron renderer.

Possible implementation:

```text
Electron Main
     │
     │ MIDI note events
     ▼
Synth Process
     │
     ▼
Audio Output
```

The synth backend should be replaceable so that low-latency native solutions can be introduced without redesigning the application.

---

# 5. MIDI Input Model

Every MIDI message should be normalized into an internal representation.

Example:

```ts
interface MidiEvent {
  deviceId: string;
  type: "note-on" | "note-off" | "cc" | "pitch-bend";
  channel: number;
  control?: number;
  note?: number;
  value: number;
  timestamp: number;
}
```

Raw device-specific behavior should be normalized before reaching the action system.

---

# 6. MIDI Routing

MIDI events should pass through a routing layer.

```text
USB MIDI
   │
   ▼
MIDI Input
   │
   ▼
Normalizer
   │
   ▼
Router
   │
   ├── Musical Note ─────► Synth
   │
   ├── Desktop Control ──► Action Engine
   │
   ├── DAW Passthrough ──► MIDI Output
   │
   └── MIDI Learn ───────► Configuration UI
```

Routing decisions should be configurable.

---

# 7. Piano / Synth Functionality

Keyboard keys should remain musical during normal desktop operation.

Example:

```text
MiniLab key
     │
     ▼
Note On / Note Off
     │
     ▼
Synth Engine
     │
     ▼
Piano Sound
```

Required features:

* Velocity sensitivity
* Note On/Off
* Multiple simultaneous notes
* Sustain support
* Low latency
* Instrument selection
* Master synth volume

Initial instruments could include:

* Acoustic piano
* Rhodes
* Electric piano
* Organ
* Basic synth
* Strings

A SoundFont-based engine is a strong candidate for the initial implementation.

The application should eventually allow custom SoundFonts.

---

# 8. MIDI Controls

The MiniLab MkII provides several useful input types.

## Keyboard

Default behavior:

```text
Keys → Synth
```

Keys may optionally be mapped to actions in specific profiles.

## Pads

Primary use:

* Application launchers
* Commands
* Tool selection
* Media controls
* Application actions

Example:

```text
Pad 1 → Ghostty
Pad 2 → Browser
Pad 3 → Play/Pause
Pad 4 → Screenshot
```

## Endless Rotary Encoders

Encoders are particularly important.

They should support:

* Absolute MIDI CC
* Relative MIDI CC
* Acceleration
* Direction
* Sensitivity
* Per-application mappings

Example:

```text
Encoder clockwise
        ↓
      +1 event

Encoder counterclockwise
        ↓
      -1 event
```

Potential uses:

* Volume
* Zoom
* Canvas rotation
* Horizontal pan
* Vertical pan
* Timeline navigation
* Brush size
* Browser tabs
* Virtual desktops
* Media seeking

## Clickable Encoders

Where supported:

```text
Turn → continuous action
Click → secondary action
```

Example:

```text
Turn Encoder 1 → System Volume
Click Encoder 1 → Mute
```

## Touch Controls

Pitch/modulation strips should be exposed as configurable continuous controls.

They may remain assigned to the synth by default.

---

# 9. Action System

Mappings should reference semantic actions rather than directly containing platform-specific implementations wherever possible.

Example:

```text
system.volume.change
media.playPause
application.launch
canvas.zoom
canvas.rotate
canvas.panX
canvas.panY
timeline.seek
brush.size
```

The Action Engine resolves these actions.

```text
MIDI Event
    │
    ▼
Mapping
    │
    ▼
Semantic Action
    │
    ▼
Application / OS Adapter
```

---

# 10. System Actions

Initial Windows actions should include:

* Launch application
* Run executable
* Run command
* Run PowerShell
* Open URL
* Open file
* Open directory
* Send keyboard shortcut
* Media play/pause
* Media next
* Media previous
* Master volume
* Mute
* Foreground application detection

Later:

* Per-application volume
* Microphone mute
* Window positioning
* Virtual desktop switching
* Brightness
* Window focus
* Mouse input
* Scroll-wheel injection

---

# 11. Platform Abstraction

System actions must not be implemented directly inside mappings.

Define a platform interface.

Example:

```ts
interface PlatformAdapter {
  changeVolume(delta: number): Promise<void>;
  setVolume(value: number): Promise<void>;

  playPause(): Promise<void>;

  launch(target: string): Promise<void>;

  sendShortcut(shortcut: Shortcut): Promise<void>;

  getForegroundApplication(): Promise<ApplicationInfo>;

  scroll(x: number, y: number): Promise<void>;
}
```

Implementations:

```text
platform/
├── windows/
├── macos/
└── linux/
```

Windows is implemented first.

---

# 12. Application Profiles

Mappings can change according to the foreground application.

Priority:

```text
Application Mapping
        ↓
User Profile
        ↓
Global Mapping
```

Example:

```text
DESKTOP

Encoder 1 → Volume
Encoder 2 → Media Seek
Encoder 3 → Browser Tabs
Encoder 4 → Virtual Desktops
```

When OpenToonz becomes active:

```text
OPENTOONZ

Encoder 1 → Canvas Zoom
Encoder 2 → Canvas Rotate
Encoder 3 → Canvas Pan X
Encoder 4 → Canvas Pan Y
```

When Affinity becomes active:

```text
AFFINITY

Encoder 1 → Canvas Zoom
Encoder 2 → Canvas Rotate
Encoder 3 → Canvas Pan X
Encoder 4 → Canvas Pan Y
Encoder 5 → Brush Size
```

Keyboard notes can continue routing to the synth regardless of application profile.

---

# 13. Application Adapters

Application adapters translate semantic actions into application-specific input.

Example:

```text
canvas.zoom(+1)
       │
       ▼
Application Adapter
       │
       ├── Affinity
       │      → appropriate wheel/shortcut input
       │
       ├── OpenToonz
       │      → appropriate wheel/shortcut input
       │
       └── Krita
              → appropriate wheel/shortcut input
```

Adapters prevent users from needing to understand application-specific shortcut combinations.

Initial adapters:

1. Generic Desktop
2. Affinity
3. OpenToonz

Potential later adapters:

* Krita
* Photoshop
* Blender
* Ableton Live
* DaVinci Resolve
* Premiere
* VS Code
* Browser
* Spotify
* OBS

---

# 14. MIDI Learn

MIDI Learn is a core feature.

Workflow:

```text
Add Mapping
     ↓
"Move or press a control"
     ↓
User moves encoder
     ↓
MIDI event detected
     ↓
Control identified
     ↓
Choose action
     ↓
Save mapping
```

Example UI:

```text
Control Detected

Device:
Arturia MiniLab MkII

Input:
Control Change

Channel:
1

CC:
74

Behavior:
Relative Encoder

[Assign Action]
```

Users should rarely need to manually enter MIDI numbers.

---

# 15. Controller Profiles

Separate **controller profiles** from **application profiles**.

Controller profile describes hardware.

Example:

```text
Arturia MiniLab MkII

Control:
encoder-1

MIDI:
CC 74

Type:
relative-encoder
```

Application profiles then reference logical controls:

```text
encoder-1:
    action: canvas.zoom
```

This allows application mappings to potentially work across multiple controllers.

---

# 16. Configuration Model

Potential structure:

```text
config/
├── settings.json
├── devices/
│   └── arturia-minilab-mkii.json
├── profiles/
│   ├── default.json
│   ├── development.json
│   └── media.json
└── applications/
    ├── affinity.json
    └── opentoonz.json
```

Configuration should eventually be importable/exportable.

---

# 17. Profiles

Users should be able to manually switch profiles.

Examples:

* Default
* Development
* Work
* Media
* Art
* Gaming
* Music

Profiles can alter mappings without changing application-specific overrides.

Potential profile switch mechanisms:

* Tray menu
* MiniLab pad
* Encoder click
* Keyboard shortcut
* Application UI

---

# 18. Overlay

Provide an optional temporary overlay when:

* Profiles change
* Encoder functions change
* Instruments change
* Applications activate
* Volume changes
* MIDI controls are learned

Example:

```text
┌────────────────────────────┐
│         ART PROFILE        │
│                            │
│ E1  Zoom       E5 Brush    │
│ E2  Rotate     E6 Frame    │
│ E3  Pan X      E7 Drawing  │
│ E4  Pan Y      E8 Undo     │
└────────────────────────────┘
```

Overlay should disappear automatically after a configurable duration.

---

# 19. Tray Application

Normal application state:

```text
Windows starts
      ↓
MIDI Deck starts
      ↓
Tray icon appears
      ↓
MIDI controller detected
      ↓
Mappings + Synth active
```

Tray menu:

```text
MIDI Deck
────────────
Controller: MiniLab MkII ✓

Profile
  ✓ Default
    Development
    Art
    Media

Synth
  ✓ Piano
    Rhodes
    Organ
    Off

Open MIDI Deck
Pause Mappings
Quit
```

Closing the configuration window should not terminate the application.

---

# 20. DAW Mode

Users must still be able to use the controller normally.

Provide:

```text
Desktop Mode
```

and

```text
DAW / Passthrough Mode
```

Potential behavior:

### Desktop Mode

```text
Keys → Synth
Controls → MIDI Deck
```

### DAW Mode

```text
Keys ──────┐
Pads ──────┤
Encoders ──┼──► DAW
Touch ─────┘
```

Eventually MIDI Deck could support selective passthrough rather than all-or-nothing routing.

---

# 21. Security

Because MIDI Deck can execute system commands, configuration must be treated as privileged.

Do not allow arbitrary remote configuration.

Imported profiles containing:

* Commands
* PowerShell
* Executables
* Scripts

must clearly disclose those actions before activation.

Electron renderer must never have unrestricted Node access.

Use:

```text
Renderer
   │
   ▼
Preload API
   │
   ▼
Validated IPC
   │
   ▼
Main Process
```

Enable context isolation.

Do not enable `nodeIntegration` in the renderer.

---

# 22. MVP

The first useful release should remain deliberately small.

## MVP 0 — MIDI Investigation

Goal: understand MiniLab output.

Implement:

* Detect MIDI devices
* Connect to MiniLab
* Log MIDI events
* Identify:

  * keys
  * pads
  * encoders
  * encoder clicks
  * pitch strip
  * modulation strip
* Determine MiniLab encoder mode

Deliverable:

```text
MiniLab input inspector
```

---

## MVP 1 — Macro Deck

Implement:

* Electron tray app
* MIDI input
* Mapping configuration
* MIDI Learn
* Run application
* Run command
* Send keyboard shortcut
* Media controls
* System volume
* Configuration persistence

At this point:

```text
MiniLab = functional desktop macro controller
```

---

## MVP 2 — Always-On Piano

Implement:

* Note routing
* Velocity
* Polyphony
* Piano instrument
* Synth volume
* Sustain
* Instrument selection

At this point:

```text
Keys → Piano
Controls → Desktop
```

simultaneously.

---

## MVP 3 — Application Awareness

Implement:

* Foreground application detection
* Application-specific profiles
* Automatic mapping changes
* Overlay showing active mappings

Initial targets:

* Desktop
* Affinity
* OpenToonz

---

## MVP 4 — Art Controls

Implement semantic actions:

```text
canvas.zoom
canvas.rotate
canvas.panX
canvas.panY
brush.size
timeline.seek
```

Implement Affinity and OpenToonz adapters.

Tune encoder:

* sensitivity
* acceleration
* direction
* repeat rate

This phase should make the MiniLab genuinely useful alongside a drawing tablet.

---

## MVP 5 — Generic MIDI Controller Support

Remove remaining MiniLab assumptions.

Implement:

* Generic device profiles
* Controller discovery
* Custom controller definitions
* Import/export
* Shareable profiles

MiniLab MkII becomes a built-in controller preset.

---

# 23. Cross-Platform Roadmap

## Phase 1

Windows only.

Focus on:

* reliable MIDI
* low latency
* system integration
* input injection
* foreground application detection

## Phase 2

Linux.

Likely areas requiring platform-specific work:

* PipeWire
* desktop environment detection
* Wayland/X11 input behavior
* application detection

## Phase 3

macOS.

Implement:

* CoreAudio integration
* application detection
* system controls
* accessibility/input permissions

The application architecture should support these platforms from the beginning even though only Windows implementations initially exist.

---

# 24. Suggested Repository Structure

```text
midi-deck/
├── apps/
│   └── desktop/
│       ├── main/
│       │   ├── index.ts
│       │   ├── tray.ts
│       │   ├── windows.ts
│       │   └── ipc.ts
│       │
│       ├── preload/
│       │   └── index.ts
│       │
│       └── renderer/
│           ├── components/
│           ├── pages/
│           ├── hooks/
│           ├── state/
│           └── index.ts
│
├── packages/
│   ├── midi/
│   │   ├── devices/
│   │   │   ├── discovery.ts
│   │   │   └── connection.ts
│   │   ├── normalize/
│   │   │   ├── events.ts
│   │   │   └── encoders.ts
│   │   ├── routing/
│   │   │   ├── router.ts
│   │   │   └── passthrough.ts
│   │   └── learn/
│   │       └── midi-learn.ts
│   │
│   ├── controllers/
│   │   ├── generic/
│   │   │   └── profile.ts
│   │   └── minilab-mkii/
│   │       ├── profile.ts
│   │       └── controls.ts
│   │
│   ├── actions/
│   │   ├── system/
│   │   ├── media/
│   │   ├── application/
│   │   ├── canvas/
│   │   └── command/
│   │
│   ├── platforms/
│   │   ├── platform.ts
│   │   ├── windows/
│   │   │   ├── index.ts
│   │   │   ├── audio.ts
│   │   │   ├── foreground-app.ts
│   │   │   ├── input.ts
│   │   │   ├── launcher.ts
│   │   │   └── media.ts
│   │   ├── macos/
│   │   │   └── index.ts
│   │   └── linux/
│   │       └── index.ts
│   │
│   ├── applications/
│   │   ├── adapter.ts
│   │   ├── generic/
│   │   ├── affinity/
│   │   └── opentoonz/
│   │
│   ├── profiles/
│   │   ├── manager.ts
│   │   ├── resolver.ts
│   │   ├── schema.ts
│   │   └── storage.ts
│   │
│   ├── synth/
│   │   ├── engine.ts
│   │   ├── instruments.ts
│   │   ├── soundfont.ts
│   │   └── midi-to-synth.ts
│   │
│   ├── config/
│   │   ├── schema.ts
│   │   ├── defaults.ts
│   │   ├── migration.ts
│   │   └── storage.ts
│   │
│   └── shared/
│       ├── types/
│       ├── events/
│       ├── constants/
│       └── logging/
│
├── profiles/
│   ├── controllers/
│   │   └── arturia-minilab-mkii.json
│   ├── applications/
│   │   ├── affinity.json
│   │   └── opentoonz.json
│   └── examples/
│       ├── desktop.json
│       ├── art.json
│       └── media.json
│
├── assets/
│   ├── icons/
│   ├── controllers/
│   └── soundfonts/
│
├── native/
│   └── windows/
│       ├── input/
│       └── audio/
│
├── tests/
│   ├── midi/
│   ├── routing/
│   ├── actions/
│   ├── profiles/
│   └── controllers/
│
├── scripts/
│   ├── dev/
│   ├── build/
│   └── package/
│
├── docs/
│   ├── architecture.md
│   ├── controller-profiles.md
│   ├── application-adapters.md
│   └── actions.md
│
├── package.json
├── tsconfig.json
├── eslint.config.js
├── plan.md
├── README.md
└── LICENSE
```
