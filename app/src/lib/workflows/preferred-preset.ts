/**
 * The preset Generate Image should switch to when the one it opened on cannot
 * run (a saved pick whose files are gone; a fresh browser passes '' — the
 * built-in default is nobody's pick): the first in `order` that can, else
 * `fallback`, the recommended starter whose Download button then takes over.
 * Null to stay. Spec 2026-10-11-first-start-setup-design.md §2.1.
 */
export function preferredPreset(current: string, order: string[], usable: (id: string) => boolean, fallback: string): string | null {
  if (usable(current)) return null
  return order.find(usable) ?? (current === fallback ? null : fallback)
}
