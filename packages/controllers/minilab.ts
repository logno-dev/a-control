import type { Control, UtilityId } from '../shared/schema';

// MiniLab MkII memory 1: encoders 1/9 are relative; the remaining knobs are absolute.
export const factoryEncoderCCs = [112, 74, 71, 76, 77, 93, 73, 75, 114, 18, 19, 16, 17, 91, 79, 72];
export const legacyEncoderCCs = [74, 71, 76, 77, 93, 18, 19, 16, 17, 91, 79, 72, 73, 75, 114, 115];
export const factoryEncoders: Control[] = factoryEncoderCCs.map((number, index) => ({
  id: `encoder-${index + 1}`, name: `Encoder ${index + 1}`, type: 'cc', channel: 0, number,
  mode: index === 0 || index === 8 ? 'relative-offset' : 'absolute', sensitivity: 1, inverted: false, acceleration: false, surface: 'encoder'
}));

export const touchControls: Control[] = [
  { id: 'pitch-strip', name: 'Pitch strip', type: 'pitch-bend', channel: 0, number: 0, mode: 'absolute', sensitivity: 1, inverted: false, acceleration: false, surface: 'pitch-strip' },
  { id: 'mod-strip', name: 'Modulation strip', type: 'cc', channel: 0, number: 1, mode: 'absolute', sensitivity: 1, inverted: false, acceleration: false, surface: 'mod-strip' }
];
export const utilityButtons: { id: UtilityId; name: string; address: number; description: string }[] = [
  { id: 'shift', name: 'Shift', address: 0x2e, description: 'Hardware modifier: hold with a pad to select a device memory, a key to select the MIDI channel, or encoder 1 / 9 for alternate MIDI messages. Learn those alternate messages as separate controls.' },
  { id: 'bank', name: 'Pad bank', address: 0x2f, description: 'Switches physical pads between 1–8 and 9–16. Both banks can have independent mappings and colors. The screen follows the most recently played mapped pad; its bank selector is a preview, not a hardware bank command.' },
  { id: 'octave-down', name: 'Oct −', address: 0x10, description: 'Transposes the keyboard down in hardware. MIDI Deck plays the resulting MIDI notes. Press both octave buttons to reset the range.' },
  { id: 'octave-up', name: 'Oct +', address: 0x11, description: 'Transposes the keyboard up in hardware. Hold Shift and press both octave buttons to send All Notes Off / Reset All Controllers.' }
];
export function surfaceKind(control: Control): NonNullable<Control['surface']> {
  return control.surface ?? (control.type === 'pitch-bend' ? 'pitch-strip' : control.type === 'note-on' ? 'pad' : control.mode === 'button' ? 'button' : 'encoder');
}
