import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isPseudoLocale,
  pseudo,
  PSEUDO_CLOSE,
  PSEUDO_OPEN,
  PSEUDO_PAD_CHAR,
  PSEUDO_PAD_RATIO,
} from './pseudo';
import { STRING_IDS, STRINGS_EN, type StringId } from './strings.en';
import { interpolate, placeholdersOf, t } from './t';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Every `.ts` / `.tsx` under `src/` except tests, this folder and `.d.ts` files. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts') &&
      !relative(SRC, path).startsWith('i18n')
    ) {
      out.push(path);
    }
  }
  return out;
}

/** `t('some.id'` and `t("some.id"` calls, with the file they are in. */
function usedIds(): Array<{ file: string; id: string }> {
  const found: Array<{ file: string; id: string }> = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*(['"])([^'"\n]+)\1/g)) {
      found.push({ file: relative(SRC, file), id: match[2] });
    }
  }
  return found;
}

describe('strings.en (R12.11, R12.12)', () => {
  it('has at least one id and every value is a non-empty, trimmed string', () => {
    expect(STRING_IDS.length).toBeGreaterThan(0);
    for (const id of STRING_IDS) {
      const value = STRINGS_EN[id];
      expect(typeof value, id).toBe('string');
      expect(value.length, id).toBeGreaterThan(0);
      expect(value, id).toBe(value.trim());
    }
  });

  it('ids are `group.element` in camelCase', () => {
    for (const id of STRING_IDS) {
      expect(id).toMatch(/^[a-z][A-Za-z]*\.[a-z][A-Za-z0-9]*$/);
    }
  });

  it('placeholders are `{letters}` and no brace is left unmatched', () => {
    for (const id of STRING_IDS) {
      const value = STRINGS_EN[id];
      const stripped = value.replace(/\{[A-Za-z]+\}/g, '');
      expect(stripped, id).not.toMatch(/[{}]/);
    }
  });

  it('every id used by t() in the source exists', () => {
    const used = usedIds();
    const missing = used.filter(({ id }) => !(id in STRINGS_EN));
    expect(missing).toEqual([]);
  });

  it('the ids the component kit depends on exist', () => {
    const needed: StringId[] = ['module.updateApp', 'banner.more'];
    for (const id of needed) {
      expect(STRINGS_EN[id]).toBeTruthy();
    }
  });

  it('carries the texts the design fixes word for word', () => {
    expect(t('signIn.sessionEnded')).toBe('Your session ended. Sign in again.');
    expect(t('createAccount.phoneHelper')).toBe(
      "We'll use this number for your shop to contact you",
    );
    expect(t('join.notFound')).toBe(
      "We couldn't find a shop for that email. Check it with your manager.",
    );
    expect(t('attendance.notEnabledTitle')).toBe('Enable biometric check-in.');
    expect(t('attendance.notEnabledLine')).toBe('Ask your manager for a code.');
    expect(t('module.updateApp')).toBe('Update the app to use this.');
    expect(t('profile.profileRequestedBadge')).toBe('Your shop has asked for your details');
    expect(t('blocked.staffNoEmployee')).toBe(
      'This app is for workers. Ask your manager to link your login to your employee record from the Employees page.',
    );
    expect(t('editDetails.notReachable')).toBe(
      "Couldn't reach Stockkart. Your details were not changed.",
    );
    expect(t('common.notReachable')).toBe(
      "Couldn't reach Stockkart. Try again when you have network.",
    );
  });
});

describe('t()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fills placeholders from params', () => {
    expect(t('join.result', { shopName: 'Sri Ganesh Stores', ownerFirstName: 'Ramesh' })).toBe(
      'Sri Ganesh Stores · owner Ramesh',
    );
    expect(t('home.checkedInOut', { in: '09:12', out: '18:05' })).toBe(
      'Checked in 09:12 · out 18:05',
    );
    expect(t('banner.more', { count: 2 })).toBe('and 2 more');
    expect(t('switchAccount.lostPunches', { count: 2 })).toBe(
      '2 punches that were not yet sent will be lost',
    );
  });

  it('leaves a placeholder without a value as written and never throws', () => {
    expect(t('join.rejected')).toBe('{shopName} did not accept your request');
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(interpolate('plain')).toBe('plain');
  });

  it('lists the placeholders of a template once each, in order', () => {
    expect(placeholdersOf('Checked in {in} · out {out} · {in}')).toEqual(['in', 'out']);
    expect(placeholdersOf('none')).toEqual([]);
  });

  it('is plain English when the pseudo-locale flag is not set', () => {
    vi.stubEnv('EXPO_PUBLIC_PSEUDO_LOCALE', '');
    expect(isPseudoLocale()).toBe(false);
    expect(t('join.findShop')).toBe('Find shop');
  });

  it('brackets and pads every string when EXPO_PUBLIC_PSEUDO_LOCALE=1', () => {
    vi.stubEnv('EXPO_PUBLIC_PSEUDO_LOCALE', '1');
    expect(isPseudoLocale()).toBe(true);
    const out = t('join.result', { shopName: 'Sri Ganesh Stores', ownerFirstName: 'Ramesh' });
    expect(out.startsWith(PSEUDO_OPEN)).toBe(true);
    expect(out.endsWith(PSEUDO_CLOSE)).toBe(true);
    expect(out).toContain('Sri Ganesh Stores · owner Ramesh');
    expect(out.length).toBeGreaterThanOrEqual(
      Math.ceil('Sri Ganesh Stores · owner Ramesh'.length * (1 + PSEUDO_PAD_RATIO)) + 2,
    );
  });
});

describe('pseudo() (R12.11)', () => {
  it.each([
    '',
    'a',
    'Find shop',
    'Checked in 09:12 · out 18:05',
    STRINGS_EN['blocked.staffNoEmployee'],
  ])('pads %j by at least 40 % and brackets it', (text) => {
    const out = pseudo(text);
    const inner = out.slice(PSEUDO_OPEN.length, out.length - PSEUDO_CLOSE.length);
    expect(out.startsWith(PSEUDO_OPEN)).toBe(true);
    expect(out.endsWith(PSEUDO_CLOSE)).toBe(true);
    expect(inner.startsWith(text)).toBe(true);
    const padding = inner.slice(text.length);
    expect(padding).toMatch(new RegExp(`^\\${PSEUDO_PAD_CHAR}*$`));
    expect(padding.length).toBeGreaterThanOrEqual(Math.ceil(text.length * PSEUDO_PAD_RATIO));
  });

  it('reads the flag as exactly "1"', () => {
    expect(isPseudoLocale('1')).toBe(true);
    expect(isPseudoLocale(' 1 ')).toBe(true);
    expect(isPseudoLocale('true')).toBe(false);
    expect(isPseudoLocale('0')).toBe(false);
    expect(isPseudoLocale(undefined)).toBe(false);
  });
});
