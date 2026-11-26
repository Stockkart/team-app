import { cleanup, screen } from '@testing-library/react';
import { View } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS, typeScale } from '../theme';
import { EmptyState, illustrationMaxHeight } from './EmptyState';
import { BUTTON_HEIGHT } from './layout';

/** The phone's window, behind the `react-native` test alias; tests set the height they need. */
const window = vi.hoisted(() => ({ height: 800 }));

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    useWindowDimensions: () => ({ width: 360, height: window.height, scale: 2, fontScale: 1 }),
  };
});

afterEach(() => {
  cleanup();
  window.height = 800;
});

describe('illustrationMaxHeight (R12.6)', () => {
  it.each([
    [640, 213],
    [800, 266],
    [900, 300],
    [1000, 333],
  ])('a %d dp window allows at most %d dp, never more than a third', (height, cap) => {
    expect(illustrationMaxHeight(height)).toBe(cap);
    expect(illustrationMaxHeight(height) * 3).toBeLessThanOrEqual(height);
  });
});

describe('EmptyState illustration (R12.6)', () => {
  it.each(SCHEMES)(
    'in %s: the illustration is clipped to a third of the window height, whatever it draws',
    (scheme) => {
      window.height = 900;
      renderThemed(
        <EmptyState
          sentence="No check-ins yet."
          illustration={<View style={{ height: 600 }} testID="picture" />}
          testID="empty"
        />,
        scheme,
      );
      const frame = screen.getByTestId('empty-illustration');
      expect(styleOf(frame).maxHeight).toBe(300);
      expect(styleOf(frame).overflow).toBe('hidden');
      expect(frame.contains(screen.getByTestId('picture'))).toBe(true);
      expect(screen.getByText('No check-ins yet.')).toBeTruthy();
    },
  );

  it('follows the window: a smaller phone gets a smaller cap', () => {
    window.height = 640;
    renderThemed(
      <EmptyState sentence="No notifications." illustration={<View />} testID="empty" />,
    );
    expect(styleOf(screen.getByTestId('empty-illustration')).maxHeight).toBe(213);
  });

  it('draws no illustration frame when none is given (the v1 default)', () => {
    renderThemed(<EmptyState sentence="No notifications." testID="empty" />);
    expect(screen.queryByTestId('empty-illustration')).toBeNull();
    expect(screen.getByRole('summary').getAttribute('aria-label')).toBe('No notifications.');
  });
});

describe('EmptyState look (R12.6, R12.15)', () => {
  it.each(SCHEMES)(
    'in %s: the sentence is secondary textSecondary and the action a 56 dp secondary pill',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(
        <EmptyState
          sentence="No check-ins in the last 31 days"
          action={{ label: 'Check in', onPress: () => undefined }}
          testID="empty"
        />,
        scheme,
      );
      const sentence = styleOf(screen.getByText('No check-ins in the last 31 days'));
      expect(sentence.fontSize).toBe(typeScale.secondary.fontSize);
      expect(tokenNameOf(tokens, sentence.color)).toContain('textSecondary');
      const button = screen.getByRole('button', { name: 'Check in' });
      expect(styleOf(button).minHeight).toBe(BUTTON_HEIGHT);
      expect(radiusNameOf(tokens, styleOf(button).borderRadius)).toContain('pill');
      expect(tokenNameOf(tokens, styleOf(button).borderColor)).toContain('borderStrong');
      expect(tokenNameOf(tokens, styleOf(button).backgroundColor)).toContain('bgElevated');
      expect(screen.getAllByRole('button')).toHaveLength(1);
    },
  );
});
