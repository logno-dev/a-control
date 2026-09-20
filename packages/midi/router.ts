import type { Config, MidiEvent, Mapping, Profile, RoutingStatus } from '../shared/schema';
import { findControl, matchesSignal } from './match';
import { defaultActionSensitivity } from '../actions/sensitivity';
import { resolveMapping } from '../profiles/resolver';
import { EncoderState } from './normalize';

export interface RouterPorts {
  synth(event: MidiEvent): void;
  passthrough(raw: number[]): void;
  action(mapping: Mapping, delta: number, profile: Profile): void;
  learned(event: MidiEvent): void;
  report?(status: RoutingStatus): void;
}
export class MidiRouter {
  learning = false;
  private encoders = new EncoderState();
  private synthNotes = new Set<string>();
  constructor(private ports: RouterPorts) {}
  reset() { this.encoders.clear(); this.synthNotes.clear(); }
  route(event: MidiEvent, config: Config, foreground: string) {
    const report = (stage: RoutingStatus['stage'], detail: string, extra: Partial<RoutingStatus> = {}) => {
      if (['cc', 'pitch-bend', 'note-on'].includes(event.type)) this.ports.report?.({ event, stage, detail, ...extra });
    };
    if (config.settings.mode === 'passthrough') { this.ports.passthrough(event.raw); report('passthrough', 'Sent to DAW output; desktop mappings are bypassed'); return; }
    const key = `${event.deviceId}:${event.channel}:${event.number}`;
    // Release voices even if the active profile changed after note-on.
    if (event.type === 'note-off' && this.synthNotes.delete(key)) this.ports.synth(event);
    const releaseController = event.type === 'cc' && ((event.number === 64 && event.value < 64) || [120, 121, 123].includes(event.number));
    // Pedal releases and panic must not be swallowed by Learn or a new profile.
    if (releaseController && config.settings.synth.enabled) this.ports.synth(event);
    if (this.learning && ['note-on', 'cc', 'pitch-bend'].includes(event.type)) {
      if (event.type !== 'cc' || event.value !== 0) {
        this.learning = false;
        report('learn', 'MIDI Learn captured this input; no action was triggered');
        this.ports.learned(event);
        return;
      }
    }
    // Learn suppresses actions but note releases must still reach the synth.
    if (this.learning) return;
    const control = findControl(config.controller.controls, event);
    const resolved = control ? resolveMapping(config, control.id, foreground) : undefined;
    if (control && resolved && !config.settings.paused) {
      const actionSensitivity = control.mode === 'button' ? 1 : resolved.mapping.sensitivity ?? defaultActionSensitivity(resolved.mapping.action, control.mode);
      const delta = this.encoders.delta(control, event) * actionSensitivity;
      const context = { controlId: control.id, controlName: control.name, profileName: resolved.profile.name, action: resolved.mapping.action, delta };
      if (!resolved.mapping.enabled) report('disabled', 'This profile disables the control, including inherited actions', context);
      else if (!delta) report('waiting', control.mode === 'absolute' ? 'Position baseline / unchanged value; continue moving the control' : 'Neutral or release message', context);
      else report('action', 'Dispatched to the action engine', context);
      if (resolved.mapping.enabled && delta !== 0) this.ports.action(resolved.mapping, delta, resolved.profile);
      return;
    }
    const mismatch = !control && config.controller.controls.find(c => matchesSignal(c, event));
    if (mismatch) report('channel-mismatch', `${mismatch.name} expects channel ${mismatch.channel}; received ${event.channel}. Learn this input or set Channel to Any.`, { controlName: mismatch.name, controlId: mismatch.id });
    else if (config.settings.paused && resolved) report('paused', 'Desktop mappings are paused', { controlName: control?.name });
    else if (event.type === 'cc' && event.number !== 1 && event.number !== 64) report('unmapped', control ? `${control.name} has no mapping in the active profile layers` : `CC ${event.number} is not defined. Use MIDI Learn to assign this physical control.`, { controlName: control?.name });
    else report('synth', 'No desktop mapping; musical input goes to the synth', { controlName: control?.name });
    if (!config.settings.synth.enabled) return;
    if (event.type === 'note-on') { this.synthNotes.add(key); this.ports.synth(event); }
    else if (event.type === 'pitch-bend' || (event.type === 'cc' && !releaseController)) this.ports.synth(event);
  }
}
