import { useState } from 'react';
import type { PermissionCheck } from '../../../../packages/shared/schema';

export function AccessibilityGuide({ applicationPath, allowed, busy, run, result }: {
  applicationPath: string; allowed: boolean | null; busy: boolean; run(operation: () => Promise<unknown>): unknown;
  result: PermissionCheck | null;
}) {
  const [checking, setChecking] = useState(false);
  const [localError, setLocalError] = useState('');
  async function check() {
    setChecking(true); setLocalError('');
    try { await window.deck.recheckAccessibility(); }
    catch (error) { setLocalError(String(error)); }
    finally { setChecking(false); }
  }
  return <section className="accessibility-guide" aria-label="macOS Accessibility setup">
    <h3>{allowed ? 'Keyboard access is enabled' : 'Allow MIDI Deck to send shortcuts'}</h3>
    <p>Zoom, recorded shortcuts, scrolling, and media keys require this macOS permission. Recording a shortcut inside MIDI Deck does not.</p>
    <ol>
      <li>Open <strong>System Settings → Privacy &amp; Security → Accessibility</strong>.</li>
      <li>Turn on <strong>MIDI Deck</strong>. macOS may ask you to authenticate.</li>
      <li>If it is missing, click <strong>+</strong> and add the application shown below. <strong>Show app in Finder</strong> reveals the exact copy running now.</li>
      <li>If an older copy is listed but shortcuts are still blocked, remove that entry and add this copy again. In development, the app may be listed as <strong>Electron</strong> or your terminal.</li>
      <li>Return here and click <strong>Check permission again</strong>. If access is still blocked, quit MIDI Deck from its tray menu and reopen this same app.</li>
    </ol>
    <code className="application-path">{applicationPath}</code>
    <div className="button-row permission-buttons">
      <button type="button" disabled={busy} onClick={() => run(() => window.deck.accessibility())}>Open Accessibility settings</button>
      <button type="button" disabled={busy} onClick={() => run(() => window.deck.revealApplication())}>Show app in Finder</button>
      <button type="button" disabled={busy || checking} onClick={() => void check()}>{checking ? 'Checking permission…' : 'Check permission again'}</button>
    </div>
    {result && <div className={`permission-result ${result.status}`} role="status" aria-live="polite">
      <strong>{({ granted: 'Keyboard control enabled', denied: 'Still blocked by macOS', 'restart-required': 'Restart needed', error: 'Permission check failed' })[result.status]}</strong>
      <p>{result.message}</p>
      <dl><dt>Accessibility</dt><dd>{result.accessibilityTrusted === null ? 'Unknown' : result.accessibilityTrusted ? 'Granted' : 'Not granted'}</dd>
        <dt>Keyboard posting</dt><dd>{result.inputPosting === null ? 'Unknown' : result.inputPosting ? 'Granted' : 'Not granted'}</dd>
        <dt>Delivery test</dt><dd>{result.keyboardTest === 'delivered' ? 'Test key received' : result.keyboardTest === 'not-received' ? 'Test key not received' : 'Not run'}</dd>
        <dt>Checked process</dt><dd>{result.backend} · PID {result.processId ?? 'unknown'} · {result.bundleIdentifier || 'No bundle ID'}</dd></dl>
      <small>Checked {new Date(result.checkedAt).toLocaleTimeString()}</small>
    </div>}
    {localError && <p role="alert">{localError}</p>}
  </section>;
}
