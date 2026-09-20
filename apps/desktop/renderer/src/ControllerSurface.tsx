import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { actionLabels, type Control, type MidiEvent, type Profile, type State } from '../../../../packages/shared/schema';
import { surfaceKind, utilityButtons } from '../../../../packages/controllers/minilab';
import { colorCSS, mappingColor } from '../../../../packages/controllers/feedback';
import { resolvePreview } from '../../../../packages/profiles/resolver';
import { findControl } from '../../../../packages/midi/match';

export function ControllerSurface({ state, events, profile, selection, select, edit, editNamed, addMapping }: {
  state: State; events: MidiEvent[]; edit(control: Control): void; editNamed(name: string): void; addMapping(): void;
  profile: Profile; selection: string; select(id: string): void;
}) {
  const { config } = state;
  const [bank, setBank] = useState(0);
  const [info, setInfo] = useState('');
  const [values, setValues] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, number>>({});
  const held = useRef<Record<string, number>>({});
  const [keyboardBase, setKeyboardBase] = useState(48);
  useEffect(() => {
    if (!events.length) return;
    const updates: Record<string, number> = {};
      const next = { ...held.current };
      for (const event of [...events].reverse()) {
        const key = `${event.channel}:${event.number}`;
        const control = findControl(config.controller.controls, event);
        if (control) {
          updates[control.id] = event.type === 'note-off' ? 0 : event.value;
        }
        if (event.type === 'note-on' && (!control || surfaceKind(control) !== 'pad')) next[key] = event.number;
        if (event.type === 'note-off') delete next[key];
        if (event.type === 'cc' && [120, 123].includes(event.number)) for (const id of Object.keys(next)) if (id.startsWith(`${event.channel}:`)) delete next[id];
      }
      held.current = next;
      setNotes(next);
    // Find the most recent pad without relying on its note number (pads may send CC).
    for (const event of events) {
      const pad = findControl(config.controller.controls, event);
      if (pad?.led && event.value > 0) { setBank(pad.led > 8 ? 1 : 0); break; }
    }
    setValues(previous => ({ ...previous, ...updates }));
    const note = events.find(event => {
      const control = findControl(config.controller.controls, event);
      return event.type === 'note-on' && (!control || surfaceKind(control) !== 'pad');
    });
    if (note && (note.number < keyboardBase || note.number > keyboardBase + 24)) setKeyboardBase(Math.max(0, Math.min(96, Math.floor(note.number / 12) * 12)));
  }, [events]);
  useEffect(() => { held.current = {}; setNotes({}); setValues({}); }, [state.connected, config.settings.mode, config.settings.synth.enabled]);
  const resolved = (control: Control) => resolvePreview(config, control.id, profile);
  const mapped = (control: Control) => resolved(control)?.mapping;
  const label = (control: Control, fallback = 'Unmapped') => {
    const mapping = mapped(control);
    return mapping ? `${mapping.enabled ? '' : 'Disabled · '}${actionLabels[mapping.action]}` : fallback;
  };
  const encoders = config.controller.controls.filter(c => surfaceKind(c) === 'encoder').slice(0, 16);
  const pads = config.controller.controls.filter(c => surfaceKind(c) === 'pad');
  const visiblePads = pads.filter(c => c.led ? (c.led > 8 ? 1 : 0) === bank : bank === 0).slice(0, 8);
  const strips = config.controller.controls.filter(c => ['pitch-strip', 'mod-strip'].includes(surfaceKind(c)));
  return <section className="panel controller-panel">
    <div className="panel-heading"><div><h2>Your control surface</h2><p>{config.controller.name} <span className="tag">{config.controller.controls.length} MIDI CONTROLS</span></p></div><button className="primary" onClick={addMapping}>＋ Add mapping</button></div>
    <div className="overview-profile-bar"><label>Editing profile<select aria-label="Overview profile" value={selection} onChange={event => select(event.target.value)}><option value="">Follow active profile</option>{(['global', 'user', 'application'] as const).map(kind => <optgroup key={kind} label={kind === 'global' ? 'Global' : kind === 'user' ? 'User profiles' : 'Application profiles'}>{config.profiles.filter(p => p.kind === kind).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}</select></label><p><strong>{profile.name}</strong> · {selection === '' ? 'Following the active context' : 'Editing preview; live routing is unchanged'}. Click any control to edit. Inherited actions are shown and can be overridden here.</p></div>
    <div className="controller expanded-controller">
      <div className="surface-layout">
        <div className="utility-area">
          {config.controller.id === 'minilab-mkii' && <div className="utility-buttons">{utilityButtons.map(button => <button key={button.id} title={button.description} onClick={() => setInfo(`${button.name}: ${button.description}`)}>{button.name}<small>HARDWARE</small></button>)}</div>}
          <div className="touch-strips">{strips.map(control => {
            const pitch = control.type === 'pitch-bend';
            const value = values[control.id] ?? (pitch ? 8192 : 0);
            return <button key={control.id} className="touch-strip" aria-label={`Configure ${control.name}`} onClick={() => edit(control)} title={`${control.name} · ${label(control, 'Synth')} · ${value}`}>
              <small>{surfaceKind(control) === 'pitch-strip' ? 'PITCH' : 'MOD'}</small><span className="strip-track"><i style={{ bottom: `${value / (pitch ? 16383 : 127) * 94}%` }}/>{pitch && <b/>}</span><code>{value}</code><span className="strip-action">{label(control, 'Synth')}</span>
            </button>;
          })}</div>
        </div>
        <div className="surface-controls">
          <div className="encoders">{encoders.map(control => <button key={control.id} aria-label={`Configure ${control.name}`} title={`${control.name}: ${label(control)}${resolved(control) ? ` · From ${resolved(control)!.profile.name}` : ''}`} className="encoder" onClick={() => edit(control)}><span className="knob"><i/></span><small>{control.name.replace('Encoder ', 'E')}</small><span className="encoder-action">{label(control)}</span></button>)}</div>
          <div className="bank-toolbar"><span>PAD BANK PREVIEW</span><div>{[0, 1].map(value => <button key={value} className={bank === value ? 'selected' : ''} aria-pressed={bank === value} onClick={() => setBank(value)}>{value === 0 ? '1–8' : '9–16'}</button>)}</div></div>
          <div className="pads">{visiblePads.map(control => {
            const mapping = mapped(control);
            const color = mappingColor(config, mapping, state.system.muted);
            return <button key={control.id} className={`pad ${mapping?.enabled ? 'assigned' : ''} ${values[control.id] > 0 ? 'hit' : ''}`} title={`${label(control, 'Unassigned')}${resolved(control) ? ` · From ${resolved(control)!.profile.name}` : ''}`} style={{ '--pad-color': colorCSS[color] } as CSSProperties} onClick={() => edit(control)}><small>{control.name}</small><span>{label(control, 'Unassigned')}</span></button>;
          })}</div>
        </div>
      </div>
      <div className="keyboard" aria-label="Keyboard MIDI activity">{Array.from({ length: 25 }, (_, i) => {
        const note = keyboardBase + i;
        return <div key={note} className={`key ${[1, 3, 6, 8, 10].includes(note % 12) ? 'black' : 'white'} ${Object.values(notes).includes(note) ? 'pressed' : ''}`}/>;
      })}</div>
      <div className="controller-footer"><span>Notes {keyboardBase}–{keyboardBase + 24} · Pitch + modulation stay musical until mapped</span><span>{state.feedbackConnected ? 'LED output connected' : 'LED output not connected'}</span></div>
    </div>
    {config.controller.controls.some(c => surfaceKind(c) === 'button') && <div className="surface-extras"><span>Custom buttons</span>{config.controller.controls.filter(c => surfaceKind(c) === 'button').map(control => <button key={control.id} onClick={() => edit(control)}>{control.name} · {label(control)}</button>)}</div>}
    {info && <div className="hardware-info"><p>{info}</p><button className="text-button" onClick={() => setInfo('')}>Dismiss</button></div>}
    {config.controller.id === 'minilab-mkii' && <div className="surface-extras"><span>Additional MIDI controls</span>{['Shift + Encoder 1', 'Shift + Encoder 9', 'Encoder 1 click', 'Encoder 9 click'].map(name => <button key={name} onClick={() => editNamed(name)}>Learn {name}</button>)}</div>}
  </section>;
}
