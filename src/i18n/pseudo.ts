/**
 * The pseudo-locale (R12.11): with `EXPO_PUBLIC_PSEUDO_LOCALE=1` every string `t()` returns is
 * wrapped in brackets and padded to at least 40 % longer than the English, so a build run under it
 * shows every label that would truncate or overlap in Hindi or a regional language before any
 * translation exists. The release checklist screenshots each screen under it (`TESTING.md`).
 *
 * `EXPO_PUBLIC_*` variables are inlined by Metro, so the switch is fixed at build time; a release
 * build never carries it. Tests toggle it with `vi.stubEnv`.
 */

/** Padding as a fraction of the English length; at least this much is added (R12.11: 40 %). */
export const PSEUDO_PAD_RATIO = 0.4;

/** The filler: a visible, non-letter character so padding is obvious and never reads as a word. */
export const PSEUDO_PAD_CHAR = '~';

export const PSEUDO_OPEN = '[';
export const PSEUDO_CLOSE = ']';

/** True when the build was made with `EXPO_PUBLIC_PSEUDO_LOCALE=1`. */
export function isPseudoLocale(
  flag: string | undefined = process.env.EXPO_PUBLIC_PSEUDO_LOCALE,
): boolean {
  return (flag ?? '').trim() === '1';
}

/** How many filler characters `pseudo` adds to a text of `length` characters. */
export function pseudoPadLength(length: number): number {
  return Math.ceil(length * PSEUDO_PAD_RATIO);
}

/**
 * `"Find shop"` → `"[Find shop~~~~]"`: brackets around the text and `ceil(40 %)` of its length in
 * filler. The text itself is kept intact so a tester can still read it and so filled-in values
 * (names, times) are visible.
 */
export function pseudo(text: string): string {
  const length = Array.from(text).length;
  return `${PSEUDO_OPEN}${text}${PSEUDO_PAD_CHAR.repeat(pseudoPadLength(length))}${PSEUDO_CLOSE}`;
}
