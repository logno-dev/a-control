import type { Control, MidiEvent } from '../shared/schema';

export function matchesSignal(control: Control, event: MidiEvent): boolean {
  return control.number === event.number && (control.type === event.type || control.type === 'note-on' && event.type === 'note-off');
}
export function matchesControl(control: Control, event: MidiEvent): boolean {
  return matchesSignal(control, event) && (control.channel === 0 || control.channel === event.channel);
}
// An explicitly configured channel takes precedence over a wildcard fallback.
export function findControl(controls: Control[], event: MidiEvent): Control | undefined {
  return controls.find(c => c.channel === event.channel && matchesSignal(c, event)) ?? controls.find(c => c.channel === 0 && matchesSignal(c, event));
}
