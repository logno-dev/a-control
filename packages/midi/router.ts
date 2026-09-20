import type { Config, MidiEvent, Mapping, Profile } from '../shared/schema';
import { resolveMapping } from '../profiles/resolver';
import { EncoderState } from './normalize';

export interface RouterPorts {
  synth(event: MidiEvent): void;
  passthrough(raw: number[]): void;
  action(mapping: Mapping, delta: number, profile: Profile): void;
  learned(event: MidiEvent): void;
}
export class MidiRouter {
  learning = false;
  private encoders = new EncoderState();
  private synthNotes = new Set<string>();
  constructor(private ports: RouterPorts) {}
  reset() { this.encoders.clear(); this.synthNotes.clear(); }
  route(event: MidiEvent, config: Config, foreground: string) {
    if (config.settings.mode === 'passthrough') { this.ports.passthrough(event.raw); return; }
    const key = `${event.deviceId}:${event.channel}:${event.number}`;
    // Release voices even if the active profile changed after note-on.
    if (event.type === 'note-off' && this.synthNotes.delete(key)) this.ports.synth(event);
    const releaseController = event.type === 'cc' && ((event.number === 64 && event.value < 64) || [120, 123].includes(event.number));
    // Pedal releases and panic must not be swallowed by Learn or a new profile.
    if (releaseController && config.settings.synth.enabled) this.ports.synth(event);
    if (this.learning && ['note-on', 'cc', 'pitch-bend'].includes(event.type)) {
      if (event.type !== 'cc' || event.value !== 0) {
        this.learning = false;
        this.ports.learned(event);
        return;
      }
    }
    // Learn suppresses actions but note releases must still reach the synth.
    if (this.learning) return;
    const control = config.controller.controls.find(c => c.channel === event.channel && c.number === event.number &&
      (c.type === event.type || (c.type === 'note-on' && event.type === 'note-off')));
    const resolved = control ? resolveMapping(config, control.id, foreground) : undefined;
    if (control && resolved && !config.settings.paused) {
      const delta = this.encoders.delta(control, event);
      if (resolved.mapping.enabled && delta !== 0) this.ports.action(resolved.mapping, delta, resolved.profile);
      return;
    }
    if (!config.settings.synth.enabled) return;
    if (event.type === 'note-on') { this.synthNotes.add(key); this.ports.synth(event); }
    else if (event.type === 'pitch-bend' || (event.type === 'cc' && !releaseController)) this.ports.synth(event);
  }
}
