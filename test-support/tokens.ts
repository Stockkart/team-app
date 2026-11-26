/**
 * Reads a rendered style value back to the token name(s) it came from, so a component test asserts
 * "the card is `successSoft`" rather than a hex (design "Design language": tests assert token usage
 * by reading the rendered style props, not snapshots). Several tokens share a value on purpose
 * (`bgMuted` and `brandSoft` are the same tint; `textInverse` and `bgElevated` are both white in
 * light; `radius.lg` and `radius.field` are both 12), so each helper returns **every** matching
 * name and a test asserts with `toContain('successSoft')`. A value that matches no token throws,
 * naming the value, so a stray literal fails loud.
 */
import type { ThemeTokens } from '../src/theme';

function namesOf<G extends Record<string, string | number>>(
  group: G,
  value: unknown,
  what: string,
): Array<keyof G & string> {
  const names = (Object.keys(group) as Array<keyof G & string>).filter(
    (name) => group[name] === value,
  );
  if (names.length === 0) {
    throw new Error(`${String(value)} is not a ${what} token value`);
  }
  return names;
}

/** The colour token name(s) `value` resolves to in `tokens`. */
export function tokenNameOf(tokens: ThemeTokens, value: unknown): string[] {
  return namesOf(tokens.color, value, 'colour');
}

/** The radius token name(s) `value` resolves to in `tokens`. */
export function radiusNameOf(tokens: ThemeTokens, value: unknown): string[] {
  return namesOf(tokens.radius, value, 'radius');
}
