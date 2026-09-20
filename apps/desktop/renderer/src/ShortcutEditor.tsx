import { useEffect, useRef, useState } from 'react';

export function ShortcutEditor({ value, onChange, directional, disabled, onRecordingChange, autoStart, onAutoStart }: {
  value: string; onChange(value: string): void; directional: boolean; disabled: boolean; onRecordingChange(recording: boolean): void;
  autoStart?: boolean; onAutoStart?(): void;
}) {
  const [recording, setRecording] = useState<0 | 1 | null>(null);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState('');
  const target = useRef<0 | 1 | null>(null);
  const generation = useRef(0);
  const current = useRef(value); current.current = value;
  const change = useRef(onChange); change.current = onChange;
  const recordingChange = useRef(onRecordingChange); recordingChange.current = onRecordingChange;
  useEffect(() => {
    // Guard the short IPC arming interval too: Escape/Enter must not reach the
    // modal before the main-process recorder has acknowledged that it is ready.
    const guard = (event: KeyboardEvent) => {
      if (target.current !== null) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', guard, true);
    window.addEventListener('keyup', guard, true);
    const unsubscribe = window.deck.subscribe(notice => {
      if (notice.type !== 'shortcut-capture' || target.current === null) return;
      if (notice.status === 'preview') { setPreview(notice.text); setMessage(`${notice.text} — release the keys or click Use captured shortcut`); }
      if (notice.status === 'error') setMessage(notice.text);
      if (notice.status === 'captured') {
        const parts = current.current.split('|').map(part => part.trim());
        parts[target.current] = notice.text;
        change.current(parts.slice(0, 2).join(' | '));
        setMessage(`Recorded ${notice.text}. Save the mapping to assign it.`);
      }
      if (notice.status === 'captured' || notice.status === 'cancelled') {
        if (notice.status === 'cancelled') setMessage(notice.text);
        target.current = null; setRecording(null); recordingChange.current(false);
      }
    });
    return () => {
      unsubscribe(); generation.current++; target.current = null;
      window.removeEventListener('keydown', guard, true); window.removeEventListener('keyup', guard, true);
      recordingChange.current(false); void window.deck.cancelShortcutCapture().catch(() => {});
    };
  }, []);
  async function start(direction: 0 | 1) {
    const session = ++generation.current;
    target.current = direction; setRecording(direction); recordingChange.current(true);
    setPreview('');
    setMessage('Preparing keyboard recorder…');
    try {
      await window.deck.startShortcutCapture();
      if (generation.current === session && target.current !== null) setMessage('Ready — press a key or combination on your computer keyboard.');
    }
    catch (error) { if (generation.current !== session) return; target.current = null; setRecording(null); recordingChange.current(false); setMessage(String(error)); }
  }
  async function cancel() {
    generation.current++;
    target.current = null; setRecording(null); recordingChange.current(false); setMessage('Recording cancelled');
    await window.deck.cancelShortcutCapture();
  }
  useEffect(() => {
    if (autoStart && !disabled) { onAutoStart?.(); void start(0); }
  }, [autoStart]);
  return <section className={`shortcut-recorder ${recording !== null ? 'recording' : ''}`} aria-label="Keyboard shortcut recorder">
    <h3>Computer keyboard shortcut</h3>
    <p>Record the key or combination this MIDI control should send to the active application.</p>
    <label>Shortcut (positive | negative)<input required maxLength={4096} aria-label="Shortcut (positive | negative)" value={value} disabled={disabled || recording !== null} placeholder="Cmd+Shift+S or Ctrl+Shift+S" onChange={event => onChange(event.target.value)}/></label>
    <div className="button-row">{recording === null ? <>
      <button type="button" disabled={disabled} onClick={() => void start(0)}>{directional ? 'Record positive shortcut' : 'Record shortcut'}</button>
      {directional && <button type="button" disabled={disabled || !value.split('|')[0].trim()} onClick={() => void start(1)}>Record negative shortcut</button>}
    </> : <>{preview && <button type="button" className="primary" onClick={() => void window.deck.finishShortcutCapture().catch(error => setMessage(String(error)))}>Use captured shortcut</button>}<button type="button" onClick={() => void cancel().catch(error => setMessage(String(error)))}>Cancel recording</button></>}</div>
    {message && <div className="capture-status" role="status">{message}</div>}
    <small>{directional ? 'Optionally record a second shortcut for the opposite direction. ' : ''}Escape, Tab, and Enter can be recorded. Use Cancel recording to stop. OS-reserved combinations may switch apps instead; those can be entered manually.</small>
  </section>;
}
