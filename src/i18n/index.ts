/**
 * The strings layer (R12.11, R12.12): `t(id, params)` is the only way text reaches a screen;
 * `strings.en.ts` holds every text keyed by id; `pseudo.ts` is the 40 %-longer pseudo-locale a
 * build can be made with to find layouts that truncate.
 */
export { interpolate, placeholdersOf, t, type TParams } from './t';
export { STRING_IDS, STRINGS_EN, type StringId } from './strings.en';
export {
  isPseudoLocale,
  pseudo,
  PSEUDO_CLOSE,
  PSEUDO_OPEN,
  PSEUDO_PAD_CHAR,
  PSEUDO_PAD_RATIO,
  pseudoPadLength,
} from './pseudo';
