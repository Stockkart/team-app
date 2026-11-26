/**
 * `t(id, params)`: the only way a text reaches a screen (R12.11). Looks the id up in
 * `strings.en.ts`, fills `{placeholders}` from `params`, and, under the pseudo-locale build,
 * brackets and pads the result (`pseudo.ts`).
 *
 * The id is typed, so a misspelt id fails `typecheck`; `strings.test.ts` also scans the source for
 * every `t('…')` call. A placeholder with no value in `params` is left as written (`{name}`) rather
 * than throwing: a missing word must never crash a screen.
 */
import { isPseudoLocale, pseudo } from './pseudo';
import { STRINGS_EN, type StringId } from './strings.en';

export type TParams = Readonly<Record<string, string | number>>;

/** `{name}` placeholders; the name is letters only, matching the ids in `strings.en.ts`. */
const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

/** Fills `{name}` placeholders in `template` from `params`; unknown ones are left as they are. */
export function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/** The English text for `id` with `params` filled in; pseudo-localised when the build asks for it. */
export function t(id: StringId, params?: TParams): string {
  const text = interpolate(STRINGS_EN[id], params);
  return isPseudoLocale() ? pseudo(text) : text;
}

/** The placeholder names a template declares, in order, without duplicates. */
export function placeholdersOf(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}
