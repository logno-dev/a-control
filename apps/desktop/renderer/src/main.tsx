import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { actionIds, actionLabels, type Activity, type Config, type Control, type Mapping, type MidiEvent, type Profile, type State } from '../../../../packages/shared/schema';
import { effectiveProfile, resolveMapping, resolvePreview } from '../../../../packages/profiles/resolver';
import './styles.css';
import './hardware.css';
import { ControllerSurface } from './ControllerSurface';
import { HardwareSettings } from './HardwareSettings';
import { ledColors } from '../../../../packages/shared/schema';
import { findControl } from '../../../../packages/midi/match';
import { RoutingDiagnostic } from './RoutingDiagnostic';
import appIcon from '../../../../icon.svg?url';
import { ShortcutEditor } from './ShortcutEditor';
import { defaultActionSensitivity } from '../../../../packages/actions/sensitivity';

type Page = 'Overview' | 'Profiles' | 'MIDI inspector' | 'Settings';
const uid = () => crypto.randomUUID();
const describe = (event: MidiEvent) => `${event.type.toUpperCase()} · CH ${event.channel} · ${event.type === 'cc' ? 'CC' : 'NOTE'} ${event.number} · ${event.value}`;
function App() {
  const [state, setState] = useState<State>();
  const [page, setPage] = useState<Page>('Overview');
  const [events, setEvents] = useState<MidiEvent[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ profileId: string; mapping?: Mapping; control?: Control; inheritedFrom?: string }>();
  const [overviewProfileId, setOverviewProfileId] = useState('');
  const [profileEditor, setProfileEditor] = useState<Profile>();
  const [learned, setLearned] = useState<MidiEvent>();
  const [inspectorPaused, setInspectorPaused] = useState(false);
  const inspectorPausedRef = useRef(false);
  const eventBuffer = useRef<MidiEvent[]>([]);
  const activityBuffer = useRef<Activity[]>([]);
  const [lastEvent, setLastEvent] = useState<MidiEvent>();
  const [surfaceEvents, setSurfaceEvents] = useState<MidiEvent[]>([]);
  useEffect(() => {
    if (!window.deck) { setError('Launch this application with npm run dev; the Electron bridge is required.'); return; }
    void window.deck.state().then(next => { setState(next); setActivity(next.diagnostics.recentActivity); }).catch(e => setError(String(e)));
    const unsubscribe = window.deck.subscribe(notice => {
      if (notice.type === 'state') setState(notice.state);
      if (notice.type === 'route') setState(previous => previous ? { ...previous, lastRoute: notice.route } : previous);
      if (notice.type === 'activity') {
        activityBuffer.current = [notice.entry, ...activityBuffer.current].slice(0, 80);
        if (notice.entry.kind === 'error') setError(notice.entry.message);
      }
      if (notice.type === 'midi') eventBuffer.current = [notice.event, ...eventBuffer.current].slice(0, 150);
      if (notice.type === 'learn') setLearned(notice.event);
      if (notice.type === 'overlay') setToast(notice.text);
    });
    const timer = setInterval(() => {
      if (eventBuffer.current.length) {
        const batch = eventBuffer.current; eventBuffer.current = [];
        setLastEvent(batch[0]);
        setSurfaceEvents(batch);
        if (!inspectorPausedRef.current) setEvents(previous => [...batch, ...previous].slice(0, 150));
      }
      if (activityBuffer.current.length) { const batch = activityBuffer.current; activityBuffer.current = []; setActivity(previous => [...batch, ...previous].slice(0, 80)); }
    }, 70);
    return () => { unsubscribe(); clearInterval(timer); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  async function task<T,>(operation: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError('');
    try { return await operation(); } catch (e) { setError(String(e).replace(/^Error: Error invoking remote method '[^']+': Error: /, '')); }
    finally { setBusy(false); }
  }
  async function save(next: Config) { return task(async () => { const result = await window.deck.save(next); setState(result); return result; }); }
  if (!state) return <div className="loading"><img className="app-icon loading-icon" src={appIcon} alt=""/><h1>MIDI Deck</h1><p>{error || 'Connecting to your workspace…'}</p></div>;
  const config = state.config;
  const active = config.profiles.find(p => p.id === config.activeProfile)!;
  const application = config.profiles.find(p => p.id === state.applicationProfile);
  const overviewProfile = config.profiles.find(p => p.id === overviewProfileId) ?? effectiveProfile(config, state.foreground);
  const setSettings = (settings: Partial<Config['settings']>) => void save({ ...config, settings: { ...config.settings, ...settings } });
  const edit = (control?: Control, mapping?: Mapping) => { setLearned(undefined); setEditor({ profileId: overviewProfile.id, control, mapping }); };
  const enabledCount = config.controller.controls.filter(c => resolveMapping(config, c.id, state.foreground)?.mapping.enabled).length;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="app-icon" src={appIcon} alt=""/><div>MIDI Deck<span>BEYOND THE KEYS</span></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{(['Overview', 'Profiles', 'MIDI inspector', 'Settings'] as Page[]).map((item, i) => <button key={item} className={`nav-item ${page === item ? 'active' : ''}`} onClick={() => setPage(item)}><span className="nav-icon">{['◫', '▱', '≋', '⚙'][i]}</span>{item}{item === 'Overview' && <small>{enabledCount}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="device-mini"><i className={`dot ${state.connected ? 'green' : ''}`}/><div>{state.connected || 'No controller connected'}<span>{state.connected ? 'MIDI input online' : 'Select a device in Settings'}</span></div></div><div className="version">MIDI DECK <span>v{state.runtime.version}</span></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><span className="muted">Workspace</span><span className="slash">/</span>{page}</div><div className="topbar-right"><span className="status-pill"><i className={`dot ${config.settings.paused ? '' : 'green'}`}/>{config.settings.mode === 'passthrough' ? 'DAW passthrough' : config.settings.paused ? 'Mappings paused' : 'Desktop mode'}</span><button className="icon-button" title="All notes off" onClick={() => void task(() => window.deck.panic())}>■</button></div></header>
      <main>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
        <div className="page-heading"><div><div className="eyebrow">YOUR CONTROLLER. YOUR WORKFLOW.</div><h1>{page === 'Overview' ? 'A little more control.' : page}</h1><p>{({ Overview: 'Choose a profile below, then click a control to edit its mapping.', Profiles: 'The right controls, in the right context.', 'MIDI inspector': 'See exactly what your controller is sending.', Settings: 'Make MIDI Deck feel at home in your setup.' })[page]}</p></div><div className="heading-actions">{page === 'Profiles' ? <button className="primary" onClick={() => setProfileEditor({ id: uid(), name: 'New profile', kind: 'user', match: '', adapter: 'generic', mappings: [] })}>＋ New profile</button> : <button disabled={busy} onClick={() => void task(async () => { setState(await window.deck.refresh()); setToast('MIDI devices refreshed'); })}>↻ Refresh devices</button>}</div></div>

        {page === 'Overview' && <>
          <div className="stat-grid"><Stat label="CONTROLLER" value={state.connected ? config.controller.name : 'Ready when you are'} detail={state.connected || 'Connect a USB MIDI controller'} dot={!!state.connected}/><Stat label="ACTIVE PROFILE" value={application?.name ?? active.name} detail={application ? state.foreground : `${enabledCount} active mappings · Global fallback`}/><Stat label="KEYBOARD ROUTING" value={config.settings.mode === 'passthrough' ? 'MIDI output' : config.settings.synth.enabled ? 'Always-on instrument' : 'Synth is off'} detail={config.settings.mode === 'passthrough' ? config.output : `${config.settings.synth.instrument} · ${Math.round(config.settings.synth.volume * 100)}% volume`} accent/></div>
          <ControllerSurface state={state} events={surfaceEvents} profile={overviewProfile} selection={config.profiles.some(p => p.id === overviewProfileId) ? overviewProfileId : ''} select={setOverviewProfileId} addMapping={() => edit()} edit={control => {
            setLearned(undefined);
            const resolved = resolvePreview(config, control.id, overviewProfile);
            const inherited = resolved && resolved.profile.id !== overviewProfile.id;
            setEditor({ profileId: overviewProfile.id, control, mapping: resolved ? { ...resolved.mapping, id: inherited ? uid() : resolved.mapping.id } : undefined, inheritedFrom: inherited ? resolved.profile.name : undefined });
          }} editNamed={name => {
            const existing = config.controller.controls.find(c => c.name === name);
            setLearned(undefined);
            setEditor({ profileId: overviewProfile.id, control: existing ?? { id: uid(), name, type: 'cc', channel: 0, number: 0, mode: name.includes('click') ? 'button' : 'relative-offset', sensitivity: 1, inverted: false, acceleration: false, surface: 'button' }, mapping: existing ? overviewProfile.mappings.find(m => m.controlId === existing.id) : undefined });
            void task(() => window.deck.learn(true));
          }}/>
          <RoutingDiagnostic route={state.lastRoute} inspect={() => setPage('MIDI inspector')}/>
          <div className="bottom-grid"><section className="panel"><div className="panel-heading"><h2>Quick controls</h2><span className="tiny-label">LIVE</span></div><div className="quick-controls"><label>Current profile<select value={config.activeProfile} onChange={e => void save({ ...config, activeProfile: e.target.value })}>{config.profiles.filter(p => p.kind === 'user').map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><Toggle label="Automatic app switching" description={state.foreground || 'Uses foreground application on Windows and macOS'} checked={config.settings.autoSwitch} onChange={value => setSettings({ autoSwitch: value })}/><Toggle label="Desktop mappings" description="Keep the instrument on while mappings are paused" checked={!config.settings.paused} onChange={value => setSettings({ paused: !value })}/></div></section><section className="panel"><div className="panel-heading"><h2>Recent activity</h2><button className="text-button" onClick={() => setPage('MIDI inspector')}>Inspector ↗</button></div><div className="activity-list">{activity.slice(0, 5).map(entry => <div key={entry.id} className={`activity-row ${entry.kind}`}><span className="activity-symbol">{entry.kind === 'error' ? '!' : '↗'}</span><span>{entry.message}</span><time>{new Date(entry.time).toLocaleTimeString([], { hour12: false })}</time></div>)}{!activity.length && <div className="empty-small"><span>≋</span><p>Waiting for your first move</p><small>Controller actions will appear here.</small></div>}</div></section></div>
        </>}

        {page === 'Profiles' && <><div className="profile-grid">{config.profiles.map(profile => <section className={`panel profile-card ${profile.id === config.activeProfile ? 'current' : ''}`} key={profile.id}><div className="profile-card-top"><span className="profile-icon">{profile.kind === 'global' ? '◎' : profile.kind === 'application' ? '▧' : '▱'}</span><span className="tag">{profile.id === config.activeProfile ? 'ACTIVE' : profile.kind.toUpperCase()}</span></div><h2>{profile.name}</h2><p>{profile.kind === 'application' ? profile.match : profile.kind === 'global' ? 'The foundation for every workspace' : 'Switch manually or with a mapped control'}</p><div className="profile-card-footer"><span>{profile.mappings.length} mappings</span><div>{profile.kind === 'user' && profile.id !== config.activeProfile && <button className="text-button" onClick={() => void save({ ...config, activeProfile: profile.id })}>Activate</button>}<button onClick={() => setProfileEditor(structuredClone(profile))}>Edit</button></div></div></section>)}</div><div className="hint">Application profiles match exact executable names, separated by commas, on Windows and macOS. Current: <code>{state.foreground || 'Not detected'}</code></div></>}

        {page === 'MIDI inspector' && <><div className="stat-grid"><Stat label="INPUT BACKEND" value={state.backend} detail={state.connected || 'No input selected'}/><Stat label="LATEST EVENT" value={lastEvent?.type ?? 'Waiting'} detail={lastEvent ? describe(lastEvent) : 'Move a knob or press a key'}/><Stat label="EVENT BUFFER" value={`${events.length} / 150`} detail="Latest events first · bounded live feed"/></div><section className="panel"><div className="panel-heading"><h2>Incoming MIDI</h2><div className="button-row"><button onClick={() => { inspectorPausedRef.current = !inspectorPaused; setInspectorPaused(!inspectorPaused); }}>{inspectorPaused ? 'Resume display' : 'Pause display'}</button><button onClick={() => { eventBuffer.current = []; setEvents([]); }}>Clear</button></div></div><div className="table-wrap inspector"><table><thead><tr><th>TIME</th><th>TYPE</th><th>CHANNEL</th><th>NUMBER</th><th>VALUE</th><th>RAW HEX</th></tr></thead><tbody>{events.map((event, index) => <tr key={`${event.timestamp}-${index}`}><td><code>{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}.{String(event.timestamp % 1000).padStart(3, '0')}</code></td><td><span className={`event-type ${event.type}`}>{event.type}</span></td><td>{event.channel}</td><td>{event.number}</td><td>{event.value}</td><td><code>{event.raw.map(n => n.toString(16).padStart(2, '0').toUpperCase()).join(' ')}</code></td></tr>)}</tbody></table>{!events.length && <Empty title="Listening for MIDI" description="Choose your MIDI input in Settings, then press a key or move a control."/>}</div></section><section className="panel"><div className="panel-heading"><h2>Action log</h2><button onClick={() => { activityBuffer.current = []; setActivity([]); }}>Clear</button></div><div className="action-log">{activity.map(entry => <div className={`activity-row ${entry.kind}`} key={entry.id}><time>{new Date(entry.time).toLocaleTimeString()}</time><span>{entry.message}</span></div>)}{!activity.length && <p className="muted">No desktop actions yet.</p>}</div></section></>}

        {page === 'Settings' && <div className="settings-grid"><section className="panel settings-section"><h2>MIDI & routing</h2><p>One input, a world of possibilities.</p><label>MIDI input<select value={config.input} onChange={e => void save({ ...config, input: e.target.value })}><option value="">Select a controller</option>{config.input && !state.inputs.includes(config.input) && <option value={config.input}>{config.input} (offline)</option>}{state.inputs.map(input => <option key={input}>{input}</option>)}</select></label><label>MIDI output<select value={config.output} onChange={e => void save({ ...config, output: e.target.value })}><option value="">No output</option>{config.output && !state.outputs.includes(config.output) && <option value={config.output}>{config.output} (offline)</option>}{state.outputs.map(output => <option key={output}>{output}</option>)}</select></label><label>Routing mode<select value={config.settings.mode} onChange={e => setSettings({ mode: e.target.value as Config['settings']['mode'] })}><option value="desktop">Desktop — instrument + actions</option><option value="passthrough">DAW — all MIDI to output</option></select></label><div className="inline-note">For DAW routing on Windows, create a virtual MIDI port with loopMIDI and select it as the output. Select that port as your DAW input.</div><label>Controller name<input defaultValue={config.controller.name} key={config.controller.name} onBlur={e => { if (e.target.value.trim() && e.target.value !== config.controller.name) void save({ ...config, controller: { ...config.controller, name: e.target.value.trim() } }); }}/></label></section>
          <section className="panel settings-section"><h2>Always-on instrument</h2><p>Musical keys, even when you're doing other things.</p><Toggle label="Enable synth" description="Independent audio window stays active in the tray" checked={config.settings.synth.enabled} onChange={enabled => setSettings({ synth: { ...config.settings.synth, enabled } })}/><label>Instrument<select value={config.settings.synth.instrument} onChange={e => setSettings({ synth: { ...config.settings.synth, instrument: e.target.value as Config['settings']['synth']['instrument'] } })}>{[['piano', 'Piano · synthesized'], ['electric', 'Electric keys'], ['organ', 'Organ'], ['synth', 'Soft synth'], ['strings', 'Strings']].map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label>Master volume <span className="label-value">{Math.round(config.settings.synth.volume * 100)}%</span><input type="range" min="0" max="100" defaultValue={config.settings.synth.volume * 100} key={config.settings.synth.volume} onPointerUp={e => setSettings({ synth: { ...config.settings.synth, volume: Number(e.currentTarget.value) / 100 } })} onKeyUp={e => setSettings({ synth: { ...config.settings.synth, volume: Number(e.currentTarget.value) / 100 } })}/></label><div className="inline-note">48-voice Web Audio engine with velocity, sustain, and pitch bend. The included instruments are synthesized; sampled pianos and custom SoundFonts are a future backend.</div><button onClick={() => void task(() => window.deck.panic())}>■ All notes off</button></section>
          <HardwareSettings state={state} busy={busy} save={save} run={operation => task(operation)}/>
          <section className="panel settings-section"><h2>Workspace behavior</h2><Toggle label="Start at login" description="Available on Windows and macOS" checked={config.settings.startAtLogin} onChange={startAtLogin => setSettings({ startAtLogin })}/><Toggle label="Automatic profiles" description="Follow the foreground Windows or macOS application" checked={config.settings.autoSwitch} onChange={autoSwitch => setSettings({ autoSwitch })}/><div className="inline-note">Closing the window keeps MIDI Deck running. Use the tray menu to reopen it or quit.</div></section>
          <section className="panel settings-section"><h2>Your configuration</h2><p>Take your controller setup with you.</p><div className="button-row"><button disabled={busy} onClick={() => void task(async () => { if (await window.deck.exportConfig()) setToast('Configuration exported'); })}>↗ Export JSON</button><button disabled={busy} onClick={() => void task(async () => { const result = await window.deck.importConfig(); if (result) { setState(result); setToast('Configuration imported'); } })}>↙ Import JSON</button></div><div className="inline-note">Imports include the controller definition, profiles, LED settings, and actions. Commands and launch targets are shown for review before activation.</div><div className="platform-note"><span className="tag">{state.platform.toUpperCase()}</span><p>{['win32', 'darwin'].includes(state.platform) ? 'Desktop actions and foreground detection are available. MiniLab LED feedback works through its MIDI output.' : 'Native desktop input actions are currently supported on Windows and macOS. MIDI, LED feedback, synth, files, URLs, and shell commands are available here.'}</p></div></section></div>}
        <footer><span><i className={`dot ${state.connected ? 'green' : ''}`}/>{state.connected ? 'Controller connected' : 'Waiting for a controller'}</span><span>Built for flow. Tuned by you.</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status">✓ {toast}</div>}
    {error && (editor || profileEditor) && <div className="toast" role="alert">{error}</div>}
    {editor && <MappingEditor key={`${editor.profileId}-${editor.mapping?.id ?? editor.control?.id ?? 'new'}`} config={config} editor={editor} learned={learned} learning={state.learning} busy={busy} onLearn={() => void task(() => window.deck.learn(!state.learning))} onClose={() => { setEditor(undefined); void task(() => window.deck.learn(false)); }} onSave={async (control, mapping) => {
      const controls = config.controller.controls.some(c => c.id === control.id) ? config.controller.controls.map(c => c.id === control.id ? control : c) : [...config.controller.controls, control];
      const profiles = config.profiles.map(p => p.id === editor.profileId ? { ...p, mappings: [...p.mappings.filter(m => m.id !== editor.mapping?.id && m.controlId !== control.id), mapping] } : p);
      if (await save({ ...config, controller: { ...config.controller, controls }, profiles })) { setEditor(undefined); setToast('Mapping saved'); }
    }} onDelete={editor.mapping && !editor.inheritedFrom ? async () => { if (await save({ ...config, profiles: config.profiles.map(p => p.id === editor.profileId ? { ...p, mappings: p.mappings.filter(m => m.id !== editor.mapping?.id) } : p) })) setEditor(undefined); } : undefined}/>}
    {profileEditor && <ProfileEditor profile={profileEditor} config={config} busy={busy} onClose={() => setProfileEditor(undefined)} onSave={async profile => { if (await save({ ...config, profiles: config.profiles.some(p => p.id === profile.id) ? config.profiles.map(p => p.id === profile.id ? profile : p) : [...config.profiles, profile] })) setProfileEditor(undefined); }} onDelete={async () => { if (await save({ ...config, profiles: config.profiles.filter(p => p.id !== profileEditor.id) })) setProfileEditor(undefined); }}/>} 
  </div>;
}
function Stat({ label, value, detail, dot, accent }: { label: string; value: string; detail: string; dot?: boolean; accent?: boolean }) { return <section className={`stat ${accent ? 'accent-stat' : ''}`}><div className="tiny-label">{label}{dot && <i className="dot green"/>}</div><h3>{value}</h3><p>{detail}</p></section>; }
function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange(value: boolean): void }) { return <div className="toggle-row"><div><strong>{label}</strong><small>{description}</small></div><button role="switch" aria-label={label} aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span/></button></div>; }
function Empty({ title, description, action, onClick }: { title: string; description: string; action?: string; onClick?(): void }) { return <div className="empty"><span>⌘</span><h3>{title}</h3><p>{description}</p>{action && <button className="primary" onClick={onClick}>{action}</button>}</div>; }
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose(): void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop"><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button aria-label="Close dialog" onClick={onClose}>×</button></div>{children}</div></div>;
}
function MappingEditor({ config, editor, learned, learning, busy, onLearn, onClose, onSave, onDelete }: {
  config: Config; editor: { profileId: string; control?: Control; mapping?: Mapping; inheritedFrom?: string }; learned?: MidiEvent; learning: boolean; busy: boolean;
  onLearn(): void; onClose(): void; onSave(control: Control, mapping: Mapping): Promise<void>; onDelete?(): Promise<void>;
}) {
  const [control, setControl] = useState<Control>(editor.control ? structuredClone(editor.control) : { id: uid(), name: 'New control', type: 'cc', channel: 1, number: 0, mode: 'relative-offset', sensitivity: 1, inverted: false, acceleration: false });
  const [mapping, setMapping] = useState<Mapping>(editor.mapping ? structuredClone(editor.mapping) : { id: uid(), controlId: control.id, action: 'media.playPause', parameter: '', enabled: true });
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const [autoRecord, setAutoRecord] = useState(false);
  useEffect(() => {
    if (!learned || learned.type === 'note-off' || learned.type === 'other') return;
    const existing = findControl(config.controller.controls, learned);
    setControl(previous => (!editor.control && existing) ? existing : { ...previous, type: learned.type as Control['type'], channel: learned.channel, number: learned.number, mode: learned.type === 'note-on' ? 'button' : learned.type === 'pitch-bend' ? 'absolute' : previous.mode });
  }, [learned]);
  const requiresParameter = ['application.launch', 'url.open', 'file.open', 'command.run', 'powershell.run', 'profile.switch'].includes(mapping.action);
  const shortcutAction = mapping.action === 'shortcut.send' || mapping.action === 'canvas.rotate';
  return <Modal title={editor.mapping ? 'Edit mapping' : 'Create a mapping'} subtitle={`Assign a control in ${config.profiles.find(p => p.id === editor.profileId)?.name}`} onClose={onClose}><form onSubmit={event => { event.preventDefault(); void onSave(control, { ...mapping, controlId: control.id }); }}>
    <div className="modal-body">
      {editor.inheritedFrom && <div className="inline-note">Inherited from {editor.inheritedFrom}. Saving creates an override in {config.profiles.find(p => p.id === editor.profileId)?.name}; choose {editor.inheritedFrom} in the overview selector to edit the source mapping.</div>}
      <h3 className="editor-step">1 · MIDI trigger</h3>
      <button type="button" disabled={shortcutRecording} className={`learn-box ${learning ? 'listening' : ''}`} onClick={onLearn}><span>◎</span><div><strong>{learning ? 'Listening to your MIDI device…' : learned ? `MIDI input learned: ${describe(learned)}` : 'Learn MIDI input'}</strong><small>{learning ? 'Press a MIDI pad, turn a knob, or slide a strip · click to cancel' : 'Optional: identify a physical MIDI control. Computer-keyboard recording is below.'}</small></div><span>{learning ? '●' : '↗'}</span></button>
      <label>Controller control<select aria-label="Controller control" value={config.controller.controls.some(c => c.id === control.id) ? control.id : 'new'} onChange={e => { const existing = config.controller.controls.find(c => c.id === e.target.value); setControl(existing ? structuredClone(existing) : { ...control, id: uid(), name: 'New control', led: undefined }); }}><option value="new">＋ Custom control</option>{config.controller.controls.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
      <label>Control name<input required maxLength={100} value={control.name} onChange={e => setControl({ ...control, name: e.target.value })}/></label>
      <div className="form-grid three">
        <label>Input type<select value={control.type} onChange={e => setControl({ ...control, type: e.target.value as Control['type'], number: e.target.value === 'pitch-bend' ? 0 : control.number, mode: e.target.value === 'note-on' ? 'button' : 'absolute' })}><option value="cc">Control change</option><option value="note-on">Note / pad</option><option value="pitch-bend">Pitch bend</option></select></label>
        <label>Channel<select aria-label="MIDI channel" value={control.channel} onChange={e => setControl({ ...control, channel: Number(e.target.value) })}><option value="0">Any (follow keyboard)</option>{Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
        <label>CC / note number<input type="number" min="0" max="127" required disabled={control.type === 'pitch-bend'} value={control.number} onChange={e => setControl({ ...control, number: Number(e.target.value) })}/></label>
      </div>
      <div className="form-grid">
        <label>Behavior<select aria-label="Behavior" value={control.mode} onChange={e => setControl({ ...control, mode: e.target.value as Control['mode'] })}><option value="button">Button / pad</option><option value="absolute">Absolute (position deltas)</option><option value="relative-offset">Relative · 63 / 65 (Arturia 1)</option><option value="relative-twos">Relative · 127 / 1 (Arturia 2)</option><option value="relative-arturia-3">Relative · 15 / 17 (Arturia 3)</option><option value="relative-sign">Relative · 65 / 1 (signed)</option></select></label>
        <label>Sensitivity<input type="number" min="0.1" max="10" step="0.1" required value={control.sensitivity} onChange={e => setControl({ ...control, sensitivity: Number(e.target.value) })}/></label>
      </div>
      <div className="form-grid">
        <label>Surface position<select aria-label="Surface position" value={control.surface ?? ''} onChange={e => setControl({ ...control, surface: e.target.value as Control['surface'] || undefined })}><option value="">Automatic</option><option value="encoder">Encoder</option><option value="pad">Pad</option><option value="pitch-strip">Pitch strip</option><option value="mod-strip">Modulation strip</option><option value="button">Other / shifted button</option></select></label>
        {config.controller.id === 'minilab-mkii' && <label>Physical pad LED<select aria-label="Physical pad LED" value={control.led ?? ''} onChange={e => setControl({ ...control, led: e.target.value ? Number(e.target.value) : undefined })}><option value="">None</option>{Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>Pad {i + 1}</option>)}</select></label>}
      </div>
      <div className="checkbox-row"><label><input type="checkbox" checked={control.inverted} onChange={e => setControl({ ...control, inverted: e.target.checked })}/>Reverse direction</label><label><input type="checkbox" checked={control.acceleration} onChange={e => setControl({ ...control, acceleration: e.target.checked })}/>Acceleration</label></div>
      {control.type === 'pitch-bend' && <label className="checkbox-setting"><input type="checkbox" checked={control.ignoreReturn !== false} onChange={event => setControl({ ...control, ignoreReturn: event.target.checked })}/> Ignore spring return to center for desktop actions</label>}
      <div className="form-divider"/>
      <h3 className="editor-step">2 · Action to run</h3>
      <label className="checkbox-setting"><input type="checkbox" checked={mapping.enabled} onChange={event => setMapping({ ...mapping, enabled: event.target.checked })}/> Enable this mapping (disabled overrides block inherited actions)</label>
      <label>Action<select aria-label="Action" value={mapping.action} disabled={shortcutRecording} onChange={e => { setAutoRecord(false); setMapping({ ...mapping, action: e.target.value as Mapping['action'], parameter: '' }); }}>{actionIds.map(action => <option value={action} key={action}>{actionLabels[action]}</option>)}</select></label>
      {control.mode !== 'button' && <label>Action sensitivity (this profile)<input type="number" min="0.01" max="10" step="0.01" value={mapping.sensitivity ?? defaultActionSensitivity(mapping.action, control.mode)} onChange={event => setMapping({ ...mapping, sensitivity: Number(event.target.value) })}/><small className="cell-sub">Lower is slower. Zoom: relative dials default to 0.25, strips/absolute controls to 0.10. At most one zoom step every 120 ms; touch starts are relative.</small></label>}
      {!shortcutAction && <button type="button" className="record-shortcut-action" disabled={busy || learning} onClick={() => { setMapping({ ...mapping, action: 'shortcut.send', parameter: '' }); setAutoRecord(true); }}>⌨ Record a keyboard shortcut</button>}
      {shortcutAction && <ShortcutEditor value={mapping.parameter} onChange={parameter => setMapping(previous => ({ ...previous, parameter }))} directional={control.mode !== 'button' || mapping.action === 'canvas.rotate'} disabled={busy || learning} onRecordingChange={setShortcutRecording} autoStart={autoRecord} onAutoStart={() => setAutoRecord(false)}/>}
      {requiresParameter && <label>{mapping.action === 'profile.switch' ? 'Profile name or ID' : 'Target / command'}<input required value={mapping.parameter} maxLength={4096} placeholder={mapping.action === 'url.open' ? 'https://example.com' : 'Enter a target…'} onChange={e => setMapping({ ...mapping, parameter: e.target.value })}/></label>}
      {control.led && <label>Pad color for this mapping<select aria-label="Pad color for this mapping" value={mapping.ledColor ?? 'auto'} onChange={e => setMapping({ ...mapping, ledColor: e.target.value as Mapping['ledColor'] })}><option value="auto">Automatic · action / state</option>{ledColors.map(color => <option key={color}>{color}</option>)}</select></label>}
      <div className="inline-note">Hardware input settings apply to all profiles; the action and pad color apply to this profile. Any channel follows the MiniLab keyboard-channel selection. Unmapped strips remain musical. Spring-return suppression prevents releasing the pitch strip from undoing a desktop zoom/volume gesture. Choose the encoder mode matching your device memory.</div>
    </div>
    <div className="modal-footer">{onDelete && <button type="button" className="danger" disabled={busy || shortcutRecording} onClick={() => void onDelete()}>Delete mapping</button>}<div className="spacer"/><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy || learning || shortcutRecording}>{busy ? 'Saving…' : 'Save mapping'}</button></div>
  </form></Modal>;
}
function ProfileEditor({ profile, config, busy, onClose, onSave, onDelete }: { profile: Profile; config: Config; busy: boolean; onClose(): void; onSave(profile: Profile): Promise<void>; onDelete(): Promise<void> }) {
  const [draft, setDraft] = useState(profile);
  const exists = config.profiles.some(p => p.id === profile.id);
  return <Modal title={exists ? 'Edit profile' : 'New profile'} subtitle="Build a workspace around the way you work." onClose={onClose}><form onSubmit={e => { e.preventDefault(); void onSave(draft); }}><div className="modal-body"><label>Profile name<input required maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>{draft.kind !== 'global' && <label>Profile type<select disabled={exists} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Profile['kind'] })}><option value="user">User profile · switch manually</option><option value="application">Application profile · activate automatically</option></select></label>}{draft.kind === 'application' && <label>Executable names (comma-separated)<input required placeholder="Photo.exe, Designer.exe" value={draft.match} onChange={e => setDraft({ ...draft, match: e.target.value })}/></label>}<label>Application adapter<select value={draft.adapter} onChange={e => setDraft({ ...draft, adapter: e.target.value as Profile['adapter'] })}><option value="generic">Generic desktop</option><option value="affinity">Affinity</option><option value="opentoonz">OpenToonz</option></select></label><div className="inline-note">Adapters use default application shortcuts. Customize directional shortcut mappings when your shortcuts differ.</div></div><div className="modal-footer">{exists && draft.kind !== 'global' && draft.id !== config.activeProfile && <button type="button" className="danger" disabled={busy} onClick={() => { if (confirm('Delete this profile and its mappings?')) void onDelete(); }}>Delete profile</button>}<div className="spacer"/><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={busy}>Save profile</button></div></form></Modal>;
}

createRoot(document.getElementById('root')!).render(<App/>);
