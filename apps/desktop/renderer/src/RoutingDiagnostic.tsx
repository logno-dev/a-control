import { actionLabels, type RoutingStatus } from '../../../../packages/shared/schema';

export function RoutingDiagnostic({ route, inspect }: { route: RoutingStatus | null; inspect(): void }) {
  return <div className={`routing-diagnostic ${route?.stage === 'channel-mismatch' || route?.stage === 'unmapped' ? 'attention' : ''}`} role="status">
    <div><span className="tiny-label">LIVE INPUT ROUTING</span>{route ? <>
      <strong>{route.controlName ?? (route.event.type === 'cc' ? `CC ${route.event.number}` : route.event.type)} · CH {route.event.channel} · value {route.event.value}</strong>
      <p>{route.action ? `${route.profileName} → ${actionLabels[route.action]}${route.delta ? ` (${route.delta > 0 ? '+' : ''}${Math.round(route.delta * 100) / 100})` : ''}. ` : ''}{route.detail}</p>
    </> : <p>Move an encoder or touch strip to see its input, resolved profile, and action.</p>}</div>
    <button onClick={inspect}>Open inspector</button>
  </div>;
}
