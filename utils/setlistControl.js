export const SETLIST_CONTROL_VALUES = ['smallTailoring', 'mediumTailoring', 'largeTailoring'];

export function normalizeSetlistControl(value) {
  const level = typeof value === 'string' ? value.trim() : '';
  return SETLIST_CONTROL_VALUES.includes(level) ? level : '';
}
