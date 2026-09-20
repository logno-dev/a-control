import { type Config, type LedColor, type Mapping, type MidiEvent, ledColors } from '../shared/schema';
import { resolveMapping } from '../profiles/resolver';
import { utilityButtons } from './minilab';
import { findControl } from '../midi/match';

export const colorValues: Record<LedColor, number> = { off: 0, red: 1, green: 4, yellow: 5, blue: 16, magenta: 17, cyan: 20, white: 127 };
export const colorCSS: Record<LedColor, string> = { off: '#657065', red: '#ed8d87', green: '#b6edb0', yellow: '#e6d88d', blue: '#8aafe8', magenta: '#d89ee3', cyan: '#8bdce0', white: '#f0f3ec' };
export function ledMessage(address: number, color: LedColor): number[] {
  if (!Number.isInteger(address) || !((address >= 0x70 && address <= 0x7f) || utilityButtons.some(b => b.address === address))) throw new Error('Unknown MiniLab LED address');
  if (!Object.hasOwn(colorValues, color)) throw new Error('Unknown LED color');
  if (address < 0x70 && color !== 'off' && color !== 'white') throw new Error('Utility LEDs are on/off only');
  return [0xf0, 0x00, 0x20, 0x6b, 0x7f, 0x42, 0x02, 0x00, 0x10, address, colorValues[color], 0xf7];
}
export function mappingColor(config: Config, mapping: Mapping | undefined, muted: boolean | null): LedColor {
  if (!mapping?.enabled || config.settings.paused) return 'off';
  if (mapping.ledColor && mapping.ledColor !== 'auto') return mapping.ledColor;
  if (mapping.action === 'system.mute' && muted !== null) return muted ? 'red' : 'green';
  if (mapping.action === 'profile.switch') {
    const profile = config.profiles.find(p => p.id === config.activeProfile);
    return [profile?.id, profile?.name].includes(mapping.parameter.trim()) ? 'white' : 'blue';
  }
  if (mapping.action.startsWith('media.')) return 'green';
  if (mapping.action.startsWith('system.')) return 'yellow';
  if (['application.launch', 'url.open', 'file.open'].includes(mapping.action)) return 'blue';
  if (['command.run', 'powershell.run'].includes(mapping.action)) return 'magenta';
  return 'cyan';
}

export class MiniLabFeedback {
  private desired = new Map<number, LedColor>();
  private sent = new Map<number, LedColor>();
  private pulses = new Map<number, { color: LedColor; until: number }>();
  private active = false;
  constructor(private send: (raw: number[]) => boolean, private now = () => Date.now()) {}
  update(config: Config, foreground: string, muted: boolean | null, connected: boolean) {
    const active = connected && config.feedback.enabled && config.controller.id === 'minilab-mkii' && config.settings.mode === 'desktop';
    if (!active) { this.release(); return; }
    this.active = true;
    const desired = new Map<number, LedColor>();
    for (let pad = 1; pad <= 16; pad++) {
      const control = config.controller.controls.find(c => c.led === pad);
      const mapping = control ? resolveMapping(config, control.id, foreground)?.mapping : undefined;
      desired.set(0x6f + pad, mappingColor(config, mapping, muted));
    }
    for (const button of utilityButtons) {
      const setting = config.feedback.utility[button.id];
      if (setting !== 'hardware') desired.set(button.address, setting === 'on' ? 'white' : 'off');
      else if (this.desired.has(button.address)) {
        this.send(ledMessage(button.address, 'off')); this.sent.delete(button.address);
      }
    }
    this.desired = desired;
  }
  input(event: MidiEvent, config: Config, learning: boolean) {
    if (!this.active || event.value === 0 || !['note-on', 'cc'].includes(event.type)) return;
    const control = findControl(config.controller.controls, event);
    if (control?.led) this.pulse(control.led, learning ? 'cyan' : 'white');
  }
  pulse(pad: number, color: LedColor, duration = 180) {
    if (this.active && pad >= 1 && pad <= 16) this.pulses.set(0x6f + pad, { color, until: this.now() + duration });
  }
  test() {
    if (!this.active) throw new Error('Enable MiniLab LED feedback, select an online controller output, and use Desktop mode first');
    for (let pad = 1; pad <= 16; pad++) this.pulse(pad, ledColors[1 + ((pad - 1) % 7)], 1500);
  }
  invalidate() { this.sent.clear(); this.pulses.clear(); }
  flush() {
    if (!this.active) return;
    for (const [address, base] of this.desired) {
      const pulse = this.pulses.get(address);
      const color = pulse && pulse.until > this.now() ? pulse.color : base;
      if (pulse && pulse.until <= this.now()) this.pulses.delete(address);
      if (this.sent.get(address) !== color) {
        if (this.send(ledMessage(address, color))) this.sent.set(address, color);
        break; // At most one SysEx every 15 ms; newer state replaces queued state.
      }
    }
  }
  release() {
    if (this.active) for (const address of this.desired.keys()) this.send(ledMessage(address, 'off'));
    this.active = false; this.desired.clear(); this.invalidate();
  }
}
