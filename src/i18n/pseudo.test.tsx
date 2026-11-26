// @vitest-environment jsdom
/**
 * The pseudo-locale render pass (R12.11, task 15.2): every worker-app screen is rendered with
 * `EXPO_PUBLIC_PSEUDO_LOCALE=1`, so each text `t()` returns is bracketed and 40 % longer than the
 * English, and the test asserts the layout rules that keep such a text readable:
 *
 * - no rendered text carries `numberOfLines` (a label that truncates hides a longer translation);
 * - no label is empty (a text, a button or an accessibility label with nothing in it);
 * - every text that would have been an English string from `strings.en.ts` went through `t()`:
 *   under the pseudo-locale, no rendered leaf text equals an English value verbatim, and every
 *   screen shows at least one bracketed string.
 *
 * The flag is set in `vi.hoisted`, which runs before the imports (as `vi.mock` does), because
 * `t()` is called at module load in one place (`ModuleTile.UPDATE_APP_TEXT`) and Metro inlines the
 * variable at build time the same way.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderThemed } from '../../test-support/render';
import { SCREEN_CASES } from '../../test-support/screen-catalogue';
import {
  isPseudoLocale,
  PSEUDO_CLOSE,
  PSEUDO_OPEN,
  PSEUDO_PAD_CHAR,
  pseudoPadLength,
} from './pseudo';
import { STRINGS_EN } from './strings.en';

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PSEUDO_LOCALE = '1';
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// `AuthStore` shares its secure-store adapter with `pairingStore`, which binds expo-secure-store and
// expo-crypto at module load; the catalogue injects memory storage instead.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
vi.mock('@react-navigation/native', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
  };
});

afterEach(cleanup);

const ENGLISH = new Set<string>(Object.values(STRINGS_EN));

/**
 * The HR-module history list inside the History module keeps the HR design's texts word for word
 * (`directionWords`, the dates); it is not a worker-app screen and is outside the strings layer.
 */
const HR_MODULE_SUBTREES = ['[data-testid="history-list"]'];

/** Elements that carry a text the worker reads: every `Text` (`span`) with no `Text` inside it. */
function leafTexts(): Array<{ element: Element; text: string }> {
  return Array.from(document.querySelectorAll('span'))
    .filter((span) => span.querySelector('span') === null)
    .map((element) => ({ element, text: element.textContent ?? '' }));
}

function outsideHrModule({ element }: { element: Element }): boolean {
  return !HR_MODULE_SUBTREES.some((selector) => element.closest(selector) !== null);
}

function isBracketed(text: string): boolean {
  return text.startsWith(PSEUDO_OPEN) && text.endsWith(PSEUDO_CLOSE);
}

describe('pseudo-locale render pass (R12.11)', () => {
  beforeAll(() => {
    expect(isPseudoLocale()).toBe(true);
  });

  for (const screenCase of SCREEN_CASES) {
    it(`${screenCase.name}: every label survives 40 %-longer text`, async () => {
      renderThemed(screenCase.element());
      await screenCase.ready();

      // No text truncates (R12.11: layouts wrap and shrink instead).
      expect(
        Array.from(document.querySelectorAll('[data-number-of-lines]')).map(
          (element) => element.textContent,
        ),
      ).toEqual([]);

      // No empty label: every rendered text, every button name and every accessibility label.
      const texts = leafTexts();
      expect(
        texts.filter(({ text }) => text.trim() === '').map(({ element }) => element.outerHTML),
      ).toEqual([]);
      for (const button of Array.from(document.querySelectorAll('button'))) {
        const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
        expect(name.trim(), button.outerHTML).not.toBe('');
      }
      for (const labelled of Array.from(document.querySelectorAll('[aria-label]'))) {
        expect(labelled.getAttribute('aria-label')?.trim(), labelled.outerHTML).not.toBe('');
      }
      for (const input of Array.from(document.querySelectorAll('input'))) {
        const placeholder = input.getAttribute('placeholder');
        if (placeholder !== null) {
          expect(placeholder.trim(), input.outerHTML).not.toBe('');
        }
      }

      // Every English string reached the screen through t(): under the pseudo-locale none of
      // them appears verbatim, and the screen shows pseudo-localised text.
      const verbatim = texts
        .filter(outsideHrModule)
        .filter(({ text }) => ENGLISH.has(text))
        .map(({ text }) => text);
      expect(verbatim).toEqual([]);
      const bracketed = texts.filter(({ text }) => isBracketed(text));
      expect(bracketed.length).toBeGreaterThan(0);
      // Every bracketed text carries the 40 % filler the pseudo-locale adds to the English.
      for (const { text } of bracketed) {
        const inner = Array.from(text.slice(1, -1));
        let padding = 0;
        while (padding < inner.length && inner[inner.length - 1 - padding] === PSEUDO_PAD_CHAR) {
          padding += 1;
        }
        const english = inner.length - padding;
        expect(padding, text).toBeGreaterThanOrEqual(pseudoPadLength(english));
      }
    });
  }
});
