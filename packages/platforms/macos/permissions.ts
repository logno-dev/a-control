import type { PermissionCheck } from '../../shared/schema';
interface PermissionStatus { accessibilityTrusted?: boolean; inputPosting?: boolean; processId?: number; backend?: string; bundleIdentifier?: string }

export function permissionResult(status: PermissionStatus, expectedPid: number, now = Date.now()): PermissionCheck {
  const base = { checkedAt: now, accessibilityTrusted: status.accessibilityTrusted ?? null, inputPosting: status.inputPosting ?? null,
    processId: status.processId ?? null, backend: status.backend ?? 'unknown', bundleIdentifier: status.bundleIdentifier ?? '' };
  if (status.backend !== 'in-process' || status.processId !== expectedPid) return { ...base, status: 'error', message: 'The permission check is not running inside MIDI Deck. Reinstall the current build; the old helper-based integration must not be used for keyboard input.' };
  if (status.inputPosting) return { ...base, status: 'granted', message: 'Keyboard control is enabled for this running MIDI Deck app. Zoom, recorded shortcuts, media keys, and scrolling can now be sent.' };
  if (status.accessibilityTrusted) return { ...base, status: 'restart-required', message: 'Accessibility is enabled, but macOS still denies keyboard posting for this running process. Quit MIDI Deck from its tray menu, reopen this same installed copy, and check again.' };
  return { ...base, status: 'denied', message: 'macOS still denies keyboard access to this running app. Enable the installed MIDI Deck in Privacy & Security → Accessibility. If it is already enabled, remove its old entry and add this copy again, then quit and reopen it.' };
}
