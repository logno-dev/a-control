import JZZ from 'jzz';
import { normalize } from './normalize';
import type { MidiEvent } from '../shared/schema';

export class MidiDevices {
  private engine: any;
  private input: any;
  private output: any;
  connected = '';
  outputName = '';
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
    if (this.outputName && !this.outputs.includes(this.outputName)) { this.output?.close(); this.output = undefined; this.outputName = ''; }
  }
  async connect(input: string, output: string) {
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
    if (output !== this.outputName) {
      this.output?.close(); this.output = undefined; this.outputName = '';
      if (output && this.outputs.includes(output)) { this.output = await this.engine.openMidiOut(output); this.outputName = output; }
    }
  }
  send(raw: number[]) {
    try { this.output?.send(raw); } catch (error) { this.error(String(error)); }
  }
  panic() {
    for (let channel = 0; channel < 16; channel++) {
      this.send([0xb0 | channel, 64, 0]);
      this.send([0xb0 | channel, 120, 0]);
      this.send([0xb0 | channel, 123, 0]);
    }
  }
  private disconnectInput() { this.input?.close(); this.input = undefined; this.connected = ''; }
  close() { this.panic(); this.disconnectInput(); this.output?.close(); this.engine?.close(); }
}
