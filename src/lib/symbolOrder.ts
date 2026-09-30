/**
 * Final display order after the user drags cards.
 * `requested` wins for the symbols it names (unknown / duplicate entries are dropped);
 * anything it does not mention keeps its current relative order after them, so a stale
 * client (e.g. another tab added a symbol meanwhile) can never make a symbol disappear.
 */
export function mergeOrder(current: string[], requested: string[]): string[] {
  const known = new Set(current);
  const head = [...new Set(requested)].filter((s) => known.has(s));
  const placed = new Set(head);
  return [...head, ...current.filter((s) => !placed.has(s))];
}
