import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReactElement } from 'react';
import { Animated } from 'react-native';

import { adjustsFontSizeToFitOf, styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { tokenNameOf } from '../../test-support/tokens';
import { STRINGS_EN } from '../i18n';
import { duration, easing, staticTheme, ThemeContext, TOKENS, typeScale } from '../theme';
import { PunchButton, punchButtonDiameter, RING_SCALE } from './PunchButton';

// The phone: a 360 dp window at the default font scale, "reduce motion" off. Tests that need another
// answer override these on top of the alias (`vite.config.mts`).
const phone = vi.hoisted(() => ({
  width: 360,
  fontScale: 1,
  reduceMotion: false,
}));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../test-support/react-native-dom')>();
  return {
    ...actual,
    useWindowDimensions: () => ({
      width: phone.width,
      height: 800,
      scale: 2,
      fontScale: phone.fontScale,
    }),
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      isReduceMotionEnabled: () => Promise.resolve(phone.reduceMotion),
    },
  };
});

afterEach(() => {
  cleanup();
  phone.width = 360;
  phone.fontScale = 1;
  phone.reduceMotion = false;
  vi.restoreAllMocks();
});

const CHECK_IN = STRINGS_EN['punch.checkIn'];
const CHECK_OUT = STRINGS_EN['punch.checkOut'];

/** The light theme around `ui`, so a `rerender` keeps the same tree and the button is not remounted. */
function themed(ui: ReactElement): ReactElement {
  return <ThemeContext.Provider value={staticTheme('light')}>{ui}</ThemeContext.Provider>;
}

describe('PunchButton (R7.10, R7.13, R12.2, R12.9)', () => {
  it('punchButtonDiameter: 200 dp, never under 160, never over 60 % of the width', () => {
    expect(punchButtonDiameter(360)).toBe(200);
    expect(punchButtonDiameter(1000)).toBe(200);
    expect(punchButtonDiameter(300)).toBe(180);
    expect(punchButtonDiameter(250)).toBe(160);
    expect(punchButtonDiameter(0)).toBe(160);
    expect(punchButtonDiameter(Number.NaN)).toBe(160);
  });

  it.each(SCHEMES)(
    'in %s: IN is a success circle labelled "Check in" in textInverse; the label is the accessibility label',
    (scheme) => {
      const tokens = TOKENS[scheme];
      const onPress = vi.fn();
      renderThemed(<PunchButton direction="IN" enabled onPress={onPress} testID="pb" />, scheme);
      const button = screen.getByRole('button', { name: CHECK_IN });
      const style = styleOf(button);
      expect(style.width).toBe(200);
      expect(style.height).toBe(200);
      expect(style.borderRadius).toBe(100);
      expect(tokenNameOf(tokens, style.backgroundColor)).toContain('success');
      expect(button.getAttribute('aria-disabled')).toBe('false');
      const label = screen.getByTestId('pb-label');
      expect(styleOf(label).fontSize).toBe(typeScale.title.fontSize);
      expect(tokenNameOf(tokens, styleOf(label).color)).toContain('textInverse');
      expect(adjustsFontSizeToFitOf(label)).toBe(true);
      expect(label.getAttribute('data-number-of-lines')).toBeNull();
      fireEvent.click(button);
      expect(onPress).toHaveBeenCalledTimes(1);
    },
  );

  it.each(SCHEMES)('in %s: OUT is a danger circle labelled "Check out"', (scheme) => {
    const tokens = TOKENS[scheme];
    renderThemed(<PunchButton direction="OUT" enabled onPress={vi.fn()} testID="pb" />, scheme);
    const button = screen.getByRole('button', { name: CHECK_OUT });
    expect(tokenNameOf(tokens, styleOf(button).backgroundColor)).toContain('danger');
    expect(tokenNameOf(tokens, styleOf(screen.getByTestId('pb-label')).color)).toContain(
      'textInverse',
    );
  });

  it.each(SCHEMES)(
    'in %s: not enabled is a bgMuted circle with a textSecondary label, disabled, no tap',
    (scheme) => {
      const tokens = TOKENS[scheme];
      const onPress = vi.fn();
      renderThemed(
        <PunchButton direction="IN" enabled={false} onPress={onPress} testID="pb" />,
        scheme,
      );
      const button = screen.getByRole('button', { name: CHECK_IN });
      expect(tokenNameOf(tokens, styleOf(button).backgroundColor)).toContain('bgMuted');
      expect(tokenNameOf(tokens, styleOf(screen.getByTestId('pb-label')).color)).toContain(
        'textSecondary',
      );
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
      expect(onPress).not.toHaveBeenCalled();
    },
  );

  it('busy: no second tap, accessibilityState.busy, the fill keeps its direction colour', () => {
    const onPress = vi.fn();
    renderThemed(<PunchButton direction="OUT" enabled busy onPress={onPress} testID="pb" />);
    const button = screen.getByRole('button', { name: CHECK_OUT });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(tokenNameOf(TOKENS.light, styleOf(button).backgroundColor)).toContain('danger');
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('clamps to 60 % of a narrow screen and never under 160 dp', () => {
    phone.width = 300;
    renderThemed(<PunchButton direction="IN" enabled onPress={vi.fn()} testID="pb" />);
    expect(styleOf(screen.getByTestId('pb'))).toMatchObject({ width: 180, height: 180 });
    cleanup();
    phone.width = 200;
    renderThemed(<PunchButton direction="IN" enabled onPress={vi.fn()} testID="pb" />);
    expect(styleOf(screen.getByTestId('pb'))).toMatchObject({ width: 160, height: 160 });
  });

  it('at 200 % font the circle is the same size and the label shrinks to fit (R12.2)', () => {
    phone.fontScale = 2;
    renderThemed(<PunchButton direction="OUT" enabled onPress={vi.fn()} testID="pb" />);
    expect(styleOf(screen.getByTestId('pb'))).toMatchObject({ width: 200, height: 200 });
    const label = screen.getByTestId('pb-label');
    expect(adjustsFontSizeToFitOf(label)).toBe(true);
    expect(JSON.parse(label.getAttribute('data-font-scaling') ?? '{}')).toEqual({
      allowFontScaling: true,
      maxFontSizeMultiplier: 2,
    });
  });

  it('a pulse plays the success ring once: 300 ms, the standard ease, scale to 1.25 (R7.13)', () => {
    const timing = vi.spyOn(Animated, 'timing');
    const { rerender } = renderThemed(
      <PunchButton direction="IN" enabled onPress={vi.fn()} pulse={0} testID="pb" />,
    );
    const ring = screen.getByTestId('pb-ring');
    expect(styleOf(ring).position).toBe('absolute');
    expect(tokenNameOf(TOKENS.light, styleOf(ring).backgroundColor)).toContain('success');
    // Mounting plays nothing: only a change of `pulse` is a stored punch.
    expect(timing).not.toHaveBeenCalled();

    rerender(
      themed(<PunchButton direction="IN" enabled onPress={vi.fn()} pulse={1} testID="pb" />),
    );
    expect(timing).toHaveBeenCalledTimes(1);
    const config = timing.mock.calls[0][1] as {
      duration: number;
      easing: unknown;
      toValue: number;
    };
    expect(config.duration).toBe(duration.max);
    expect(config.duration).toBeLessThanOrEqual(300);
    expect(config.easing).toBe(easing);
    expect(config.toValue).toBe(1);
    expect(RING_SCALE).toBe(1.25);

    // The same pulse again (a re-render for another reason) does not replay it.
    rerender(
      themed(<PunchButton direction="OUT" enabled onPress={vi.fn()} pulse={1} testID="pb" />),
    );
    expect(timing).toHaveBeenCalledTimes(1);
  });

  it('under reduce motion no ring is drawn and nothing animates (R12.7)', async () => {
    phone.reduceMotion = true;
    const timing = vi.spyOn(Animated, 'timing');
    const { rerender } = renderThemed(
      <PunchButton direction="IN" enabled onPress={vi.fn()} pulse={0} testID="pb" />,
    );
    // The setting is read asynchronously; once it has answered, the ring is gone.
    await vi.waitFor(() => expect(screen.queryByTestId('pb-ring')).toBeNull());
    rerender(
      themed(<PunchButton direction="IN" enabled onPress={vi.fn()} pulse={1} testID="pb" />),
    );
    expect(screen.queryByTestId('pb-ring')).toBeNull();
    expect(timing).not.toHaveBeenCalled();
    // The button itself is unchanged.
    expect(styleOf(screen.getByTestId('pb'))).toMatchObject({ width: 200, height: 200 });
  });
});
