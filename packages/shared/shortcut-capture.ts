export interface ShortcutInput {
  type: string; key: string; code: string;
  control?: boolean; alt?: boolean; shift?: boolean; meta?: boolean;
  isAutoRepeat?: boolean; isComposing?: boolean;
}
const codes: Record<string, string> = {
  Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Space: 'Space', Escape: 'Escape',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Equal: 'Equals', Minus: 'Minus', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Backslash: '\\', Backquote: '`', Comma: ',', Period: '.', Slash: '/',
  NumpadAdd: 'Add', NumpadSubtract: 'Subtract'
};
/** Serialize one physical key chord into the same syntax accepted by the action engine. */
export function capturedShortcut(input: ShortcutInput, platform: string): string | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing) return null;
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn'].includes(input.key)) return null;
  let key = codes[input.code];
  if (/^Key[A-Z]$/.test(input.code)) key = input.code.slice(3);
  else if (/^Digit[0-9]$/.test(input.code)) key = input.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(input.code)) key = input.code;
  if (!key) throw new Error(`Cannot record ${input.key || input.code}. Use a supported key or enter the shortcut manually.`);
  const modifiers = platform === 'darwin'
    ? [input.meta && 'Cmd', input.control && 'Ctrl', input.alt && 'Option', input.shift && 'Shift']
    : [input.control && 'Ctrl', input.alt && 'Alt', input.shift && 'Shift', input.meta && 'Win'];
  return [...modifiers, key].filter(Boolean).join('+');
}
