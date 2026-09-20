import type { Config, State } from '../../../../packages/shared/schema';
import { utilityButtons } from '../../../../packages/controllers/minilab';
import { AccessibilityGuide } from './AccessibilityGuide';

export function HardwareSettings({ state, busy, save, run }: { state: State; busy: boolean; save(config: Config): unknown; run(operation: () => Promise<unknown>): unknown }) {
  const { config } = state;
  const setFeedback = (feedback: Partial<Config['feedback']>) => save({ ...config, feedback: { ...config.feedback, ...feedback } });
  return <>
    {state.platform === 'darwin' && <section className="panel settings-section"><h2>macOS integration</h2><p>Native audio controls, media keys, shortcuts, scrolling, and foreground detection.</p>
      <div className="permission-status"><i className={`dot ${state.system.accessibility ? 'green' : ''}`}/><strong>{state.system.accessibility === null ? 'Checking native helper…' : state.system.accessibility ? 'Accessibility enabled' : 'Accessibility permission needed'}</strong></div>
      <AccessibilityGuide applicationPath={state.runtime.applicationPath} allowed={state.system.accessibility} busy={busy} run={run} result={state.permissionCheck}/>
      <div className="platform-note"><span className="tag">SYSTEM MUTE</span><p>{state.system.muted === null ? 'Not reported by this audio output' : state.system.muted ? 'Muted' : 'Unmuted'}</p></div>
      <div className="platform-note"><span className="tag">SYSTEM VOLUME</span><p>{state.system.outputName ?? 'Default output'} · {state.system.volume == null ? 'Not reported' : `${Math.round(state.system.volume * 100)}%`}{state.system.volumeWritable === false && ' · Hardware-only volume control'}</p></div>
      <button disabled={busy || !state.system.volumeWritable} onClick={() => run(() => window.deck.testVolume())}>Test volume and restore</button>
      <p className="utility-caption">Briefly changes volume by 2%, verifies the output changed, then restores it. This checks the OS action independently of MIDI input.</p>
      {state.system.error && <div className="inline-note" role="alert">{state.system.error}</div>}
      <p className="inline-note">Use Cmd+… for Mac shortcuts, or Primary+… for Command on macOS / Control on Windows. External interfaces and HDMI outputs may use hardware-only volume controls.</p>
      <p>Foreground application: <code>{state.foreground || 'Not detected'}</code></p>
    </section>}
    <section className="panel settings-section"><h2>MiniLab lights</h2><p>Pad colors follow resolved mappings, including application overrides.</p>
      <label className="checkbox-setting"><input type="checkbox" checked={config.feedback.enabled} disabled={busy || config.controller.id !== 'minilab-mkii'} onChange={event => setFeedback({ enabled: event.target.checked })}/> Enable MiniLab MkII LED feedback</label>
      <label>Controller LED output<select aria-label="Controller LED output" disabled={busy} value={config.feedback.output} onChange={event => setFeedback({ output: event.target.value })}><option value="">Choose the MiniLab hardware port</option>{config.feedback.output && !state.outputs.includes(config.feedback.output) && <option value={config.feedback.output}>{config.feedback.output} (offline)</option>}{state.outputs.map(output => <option key={output}>{output}</option>)}</select></label>
      <div className="permission-status"><i className={`dot ${state.feedbackConnected ? 'green' : ''}`}/>{config.settings.mode === 'passthrough' ? 'LED feedback suspended in DAW mode' : state.feedbackConnected || 'No LED output connected'}</div>
      <div className="button-row"><button disabled={busy || !state.feedbackConnected} onClick={() => run(() => window.deck.testLights())}>Test pad colors</button><button disabled={busy || !state.feedbackConnected} onClick={() => run(() => window.deck.resyncLights())}>Reapply colors</button></div>
      <div className="inline-note">Select the MiniLab output, not your DAW virtual port. Both pad banks are updated. Choose colors per mapping in the editor. Auto mute colors reflect macOS system state; media colors indicate assignments, not playback state. Pads briefly flash on input.</div>
      <h3>Utility-button lights</h3><p className="utility-caption">These settings change lights only. The buttons retain their hardware functions.</p>
      <div className="form-grid">{utilityButtons.map(button => <label key={button.id}>{button.name} light<select aria-label={`${button.name} light`} disabled={busy} value={config.feedback.utility[button.id]} onChange={event => setFeedback({ utility: { ...config.feedback.utility, [button.id]: event.target.value as 'hardware' | 'off' | 'on' } })}><option value="hardware">Hardware controlled</option><option value="off">Force off</option><option value="on">Force on</option></select></label>)}</div>
      <p className="inline-note">Feedback changes the current lights only; it does not store device memories. Disabling it, entering DAW mode, or quitting clears lights managed by MIDI Deck. Recall your device memory to restore its stored colors and indicators. MIDI Control Center / a DAW may overwrite live colors.</p>
    </section>
    <section className="panel settings-section"><h2>On-screen profile changes</h2><p>A click-through overlay shows profiles, system volume, and action errors over your active application without stealing focus.</p>
      <label className="checkbox-setting"><input type="checkbox" checked={config.settings.overlay} disabled={busy} onChange={event => save({ ...config, settings: { ...config.settings, overlay: event.target.checked } })}/> Show on-screen status overlay</label>
      <button disabled={busy} onClick={() => run(() => window.deck.testOverlay())}>Test on-screen overlay</button>
      <div className="inline-note">The overlay works while MIDI Deck is in the tray and does not depend on Notification Center permissions. It follows the display containing your cursor.</div>
      <p className="utility-caption">Automatic popups are off by default. If showing them changes focus on your desktop, leave them off; application-specific mappings continue to switch normally.</p>
      <label className="checkbox-setting"><input type="checkbox" checked={config.settings.nativeNotifications} disabled={busy} onChange={event => save({ ...config, settings: { ...config.settings, nativeNotifications: event.target.checked } })}/> Enable native profile notifications</label>
      <button disabled={busy} onClick={() => run(() => window.deck.testNotification())}>Test native notification</button>
      {state.runtime.notificationError && <div className="inline-note">{state.runtime.notificationError}</div>}
      <div className="inline-note">On macOS, allow MIDI Deck in System Settings → Notifications and choose Banners or Alerts. Focus / Do Not Disturb may silence them. Notifications are debounced and only appear when the effective profile changes, not for every foreground-app poll.</div>
    </section>
    <section className="panel settings-section"><h2>Build & diagnostics</h2><dl className="runtime-details">
      <dt>Running version</dt><dd>MIDI Deck {state.runtime.version} · {state.runtime.packaged ? 'Installed build' : 'Development build'}</dd>
      <dt>Application location</dt><dd>{state.runtime.executable}</dd>
      <dt>Saved configuration</dt><dd>{state.runtime.configPath}</dd>
      <dt>Controller definition</dt><dd>Revision {config.controller.revision ?? 'custom'} · Encoder 1: {config.controller.controls.find(c => c.id === 'encoder-1')?.number ?? 'not defined'}</dd>
      <dt>Input since launch</dt><dd>{state.diagnostics.midiEvents} messages · {state.diagnostics.lastMidiAt ? new Date(state.diagnostics.lastMidiAt).toLocaleTimeString() : 'No MIDI received'}</dd>
      <dt>Action dispatches</dt><dd>{state.diagnostics.actions}</dd>
      <dt>Last action / error</dt><dd>{state.diagnostics.lastAction?.message ?? 'No actions yet'}</dd>
    </dl><div className="inline-note">MIDI received but no action? Check Live input routing in Overview. Actions reporting permission errors? Enable Accessibility for this copy of MIDI Deck. A zero input count means the selected input port has not delivered a message.</div></section>
  </>;
}
