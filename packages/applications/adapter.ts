import type { Mapping, Profile } from '../shared/schema';

type DirectionalKeys = readonly [positive: string, negative: string];
const shortcuts: Record<Profile['adapter'], Partial<Record<Mapping['action'], DirectionalKeys>>> = {
  generic: { 'canvas.zoom': ['Primary+Plus', 'Primary+Minus'], 'brush.size': [']', '['], 'timeline.seek': ['Right', 'Left'] },
  affinity: { 'canvas.zoom': ['Primary+Plus', 'Primary+Minus'], 'brush.size': [']', '['] },
  opentoonz: { 'canvas.zoom': ['Add', 'Subtract'], 'brush.size': [']', '['], 'timeline.seek': ['Down', 'Up'] }
};

export function applicationShortcut(adapter: Profile['adapter'], action: Mapping['action'], positive: boolean, override = '', platform = process.platform): string {
  const configured = override.trim() ? override.split('|').map(key => key.trim()) : undefined;
  // Affinity resolves the native keypad '+' reliably; a synthesized '+' on the
  // equals key can be ignored even when its Unicode character matches the menu.
  const pair = configured ?? (adapter === 'affinity' && action === 'canvas.zoom' && platform === 'darwin'
    ? ['Primary+Add', 'Primary+Minus'] : shortcuts[adapter][action]);
  if (!pair || !pair[0] || !pair[1]) throw new Error(`Configure positive | negative shortcuts for ${action} in ${adapter}`);
  return pair[positive ? 0 : 1];
}
