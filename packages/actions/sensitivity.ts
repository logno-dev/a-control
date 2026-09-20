import type { Control, Mapping } from '../shared/schema';

export function defaultActionSensitivity(action: Mapping['action'], mode: Control['mode']): number {
  if (action !== 'canvas.zoom' || mode === 'button') return 1;
  return mode.startsWith('relative-') ? 0.25 : 0.1;
}
