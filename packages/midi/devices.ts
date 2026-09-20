import JZZ from 'jzz';
import { normalize } from './normalize';
import type { MidiEvent } from '../shared/schema';

export class MidiDevices {
  private engine: any;
  private input: any;
  private ports = new Map<string, any>();
  connected = '';
  outputName = '';
  feedbackName = '';
  backend = 'Initializing';
  inputs: string[] = [];
  outputs: string[] = [];
  constructor(private receive: (event: MidiEvent) => void, private error: (message: string) => void) {}
  async refresh() {
    if (!this.engine) this.engine = await JZZ({ engine: 'node' });
    await this.engine.refresh();
    const info = this.engine.info();
    this.backend = info.engine || 'none';
    this.inputs = info.inputs.map((p: { name: string }) => p.name);
    this.outputs = info.outputs.map((p: { name: string }) => p.name);
    if (this.connected && !this.inputs.includes(this.connected)) this.disconnectInput();
    for (const [name, port] of this.ports) if (!this.outputs.includes(name)) { port.close(); this.ports.delete(name); }
    if (!this.ports.has(this.outputName)) this.outputName = '';
    if (!this.ports.has(this.feedbackName)) this.feedbackName = '';
  }
  async connect(input: string, output: string, feedback = '') {
    if (input !== this.connected) {
      this.disconnectInput();
      if (input && this.inputs.includes(input)) {
        this.input = await this.engine.openMidiIn(input);
        this.connected = input;
        this.input.connect((message: ArrayLike<number>) => {
          const event = normalize(input, Array.from(message));
          if (event) this.receive(event);
        });
      }
    }
    const wanted = new Set([output, feedback].filter(name => name && this.outputs.includes(name)));
    for (const [name, port] of this.ports) if (!wanted.has(name)) { port.close(); this.ports.delete(name); }
    this.outputName = ''; this.feedbackName = '';
    for (const name of wanted) if (!this.ports.has(name)) this.ports.set(name, await this.engine.openMidiOut(name));
    this.outputName = this.ports.has(output) ? output : '';
    this.feedbackName = this.ports.has(feedback) ? feedback : '';
  }
  send(raw: number[]) {
    try { this.ports.get(this.outputName)?.send(raw); } catch (error) { this.error(String(error)); }
  }
  feedback(raw: number[]): boolean {
    const port = this.ports.get(this.feedbackName);
    if (!port) return false;
    try { port.send(raw); return true; } catch (error) { this.error(String(error)); return false; }
  }
  panic() {
    for (let channel = 0; channel < 16; channel++) {
      this.send([0xb0 | channel, 64, 0]);
      this.send([0xb0 | channel, 120, 0]);
      this.send([0xb0 | channel, 123, 0]);
    }
  }
  private disconnectInput() { this.input?.close(); this.input = undefined; this.connected = ''; }
  close() { this.panic(); this.disconnectInput(); for (const port of this.ports.values()) port.close(); this.ports.clear(); this.engine?.close(); }
}
