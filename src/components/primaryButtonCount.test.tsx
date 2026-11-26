/**
 * One primary action per screen (R12.5, task 15.2): every worker-app screen of
 * `test-support/screen-catalogue.tsx` is rendered in a representative state and the
 * `PrimaryButton`s on it are counted. The count is the one the design's screen inventory gives
 * that state (0 or 1), so "at most one" holds and a state that loses its primary action is caught
 * too. `PrimaryButton` is wrapped by a marker here so the count is of the component, not of a
 * colour; `ConfirmSheet`'s filled danger button, the module tiles and the punch button
 * (`PunchButton`, the one punch control, R7.10) are not primary buttons.
 */
import { cleanup, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderThemed } from '../../test-support/render';
import { SCREEN_CASES } from '../../test-support/screen-catalogue';
import { staticTheme } from '../theme';
import { PrimaryButton } from './PrimaryButton';
import { PunchButton } from './PunchButton';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
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
vi.mock('./PrimaryButton', async (importOriginal) => {
  const original = await importOriginal<typeof import('./PrimaryButton')>();
  return {
    ...original,
    PrimaryButton: (props: Parameters<typeof original.PrimaryButton>[0]): ReactElement => (
      <div data-primary-button="true">
        <original.PrimaryButton {...props} />
      </div>
    ),
  };
});

afterEach(cleanup);

function primaryButtons(): Element[] {
  return Array.from(document.querySelectorAll('[data-primary-button="true"]'));
}

describe('one PrimaryButton per screen (R12.5)', () => {
  it('the marker wraps the real component', () => {
    renderThemed(<PrimaryButton label="Go" onPress={() => undefined} />);
    const [marker] = primaryButtons();
    expect(marker).toBeTruthy();
    const button = marker.querySelector('button');
    expect(button?.textContent).toBe('Go');
    expect(JSON.parse(button?.getAttribute('data-style') ?? '{}').backgroundColor).toBe(
      staticTheme('light').tokens.color.brand,
    );
  });

  it('the punch button is not a primary button (R12.5, R7.10)', () => {
    renderThemed(<PunchButton direction="IN" enabled onPress={() => undefined} testID="pb" />);
    expect(screen.getByTestId('pb')).toBeTruthy();
    expect(primaryButtons()).toHaveLength(0);
  });

  for (const screenCase of SCREEN_CASES) {
    it(`${screenCase.name}: ${screenCase.primaryButtons} primary button(s)`, async () => {
      renderThemed(screenCase.element());
      await screenCase.ready();
      const found = primaryButtons();
      expect(found.length).toBeLessThanOrEqual(1);
      expect(
        found.map((marker) => marker.querySelector('button')?.textContent),
        'primary buttons on the screen',
      ).toHaveLength(screenCase.primaryButtons);
    });
  }
});
