/**
 * TalkBack label helpers (R12.9). A compound control (a card with a title and a line, a tile with
 * a label and a status) is announced as one sentence per part, so TalkBack pauses between them.
 */

/**
 * Joins the given parts into one label, one sentence each: a part that already ends in `.`, `!`
 * or `?` is left as it is, any other part gets a full stop before the next one. Empty or
 * `undefined` parts are skipped.
 */
export function talkbackLabel(...parts: ReadonlyArray<string | undefined>): string {
  const kept = parts.map((p) => p?.trim() ?? '').filter((p) => p.length > 0);
  return kept
    .map((part, index) => (index < kept.length - 1 && !/[.!?]$/.test(part) ? `${part}.` : part))
    .join(' ');
}
