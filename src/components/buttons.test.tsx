import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hitSlopOf, styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS } from '../theme';
import { ConfirmSheet } from './ConfirmSheet';
import { DangerButton } from './DangerButton';
import { BUTTON_HEIGHT, BUTTON_ICON_SIZE, MIN_TOUCH, TEXT_BUTTON_HEIGHT } from './layout';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

afterEach(cleanup);

describe('PrimaryButton (R12.3, R12.5, R12.9, R12.15)', () => {
  it.each(SCHEMES)(
    'in %s: a 56 dp, full-width brand pill with a textInverse label announced',
    (scheme) => {
      const tokens = TOKENS[scheme];
      const onPress = vi.fn();
      renderThemed(<PrimaryButton label="Find shop" onPress={onPress} />, scheme);
      const button = screen.getByRole('button', { name: 'Find shop' });
      const style = styleOf(button);
      expect(style.minHeight).toBe(BUTTON_HEIGHT);
      expect(style.width).toBe('100%');
      expect(radiusNameOf(tokens, style.borderRadius)).toContain('pill');
      expect(tokenNameOf(tokens, style.backgroundColor)).toContain('brand');
      expect(tokenNameOf(tokens, styleOf(screen.getByText('Find shop')).color)).toContain(
        'textInverse',
      );
      // Already 56 dp tall and full width: no touch-area extension needed.
      expect(hitSlopOf(button)).toBeNull();
      fireEvent.click(button);
      expect(onPress).toHaveBeenCalledTimes(1);
    },
  );

  it.each(SCHEMES)(
    'in %s: disabled is a bgMuted fill with a textSecondary label, announced disabled, no taps',
    (scheme) => {
      const tokens = TOKENS[scheme];
      const onPress = vi.fn();
      renderThemed(<PrimaryButton label="Save" onPress={onPress} disabled />, scheme);
      const button = screen.getByRole('button', { name: 'Save' });
      expect(button).toHaveProperty('disabled', true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(tokenNameOf(tokens, styleOf(button).backgroundColor)).toContain('bgMuted');
      expect(styleOf(button).opacity).toBe(1);
      expect(tokenNameOf(tokens, styleOf(screen.getByText('Save')).color)).toContain(
        'textSecondary',
      );
      fireEvent.click(button);
      expect(onPress).not.toHaveBeenCalled();
    },
  );

  it('loading: a spinner, announced busy, no taps, label still shown', () => {
    const onPress = vi.fn();
    renderThemed(<PrimaryButton label="Create account" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Create account' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('progress')).not.toBeNull();
    expect(screen.getByText('Create account')).toBeTruthy();
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('takes a separate TalkBack label when the visible label is not enough', () => {
    renderThemed(
      <PrimaryButton
        label="Yes"
        accessibilityLabel="Yes, this is my shop"
        onPress={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Yes, this is my shop' })).toBeTruthy();
  });
});

describe('SecondaryButton (R12.15)', () => {
  it.each(SCHEMES)(
    'in %s: a pill outlined 1 dp borderStrong on bgElevated, 56 dp, label in textPrimary',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(<SecondaryButton label="Not my shop" onPress={() => undefined} />, scheme);
      const button = screen.getByRole('button', { name: 'Not my shop' });
      const style = styleOf(button);
      expect(style.minHeight).toBe(BUTTON_HEIGHT);
      expect(radiusNameOf(tokens, style.borderRadius)).toContain('pill');
      expect(style.borderWidth).toBe(1);
      expect(tokenNameOf(tokens, style.borderColor)).toContain('borderStrong');
      expect(tokenNameOf(tokens, style.backgroundColor)).toContain('bgElevated');
      expect(tokenNameOf(tokens, styleOf(screen.getByText('Not my shop')).color)).toContain(
        'textPrimary',
      );
      expect(button.querySelector('[data-testid$="-icon"]')).toBeNull();
    },
  );

  it('draws an optional leading icon in the label colour, hidden from TalkBack', () => {
    renderThemed(
      <SecondaryButton
        label="I have a code"
        icon="fingerprint"
        onPress={() => undefined}
        testID="b"
      />,
    );
    const icon = screen.getByTestId('b-icon');
    expect(styleOf(icon)).toMatchObject({ width: BUTTON_ICON_SIZE, height: BUTTON_ICON_SIZE });
    expect(icon.getAttribute('aria-label')).toBeNull();
    const stroke = styleOf(icon.firstElementChild as Element);
    expect(tokenNameOf(TOKENS.light, stroke.borderColor)).toContain('textPrimary');
    expect(screen.getByRole('button', { name: 'I have a code' })).toBeTruthy();
  });

  it('disabled: half opacity (the outline stays), announced disabled', () => {
    renderThemed(<SecondaryButton label="Later" onPress={() => undefined} disabled />);
    const button = screen.getByRole('button', { name: 'Later' });
    expect(styleOf(button).opacity).toBe(0.5);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('ConfirmSheet (R12.5)', () => {
  it('draws nothing while hidden', () => {
    renderThemed(
      <ConfirmSheet
        visible={false}
        question="Leave Sri Ganesh Stores?"
        confirmLabel="Leave this shop"
        cancelLabel="Cancel"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.queryByText('Leave Sri Ganesh Stores?')).toBeNull();
  });

  it.each(SCHEMES)(
    'in %s: question as a header, explanation, confirm filled danger, cancel secondary; backdrop cancels',
    (scheme) => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      renderThemed(
        <ConfirmSheet
          visible
          question="Leave Sri Ganesh Stores?"
          explanation="Your attendance here will stop today."
          confirmLabel="Leave this shop"
          cancelLabel="Cancel"
          onConfirm={onConfirm}
          onCancel={onCancel}
          testID="sheet"
        />,
        scheme,
      );
      const tokens = TOKENS[scheme];
      expect(screen.getByRole('heading', { name: 'Leave Sri Ganesh Stores?' })).toBeTruthy();
      expect(screen.getByText('Your attendance here will stop today.')).toBeTruthy();
      const panel = styleOf(screen.getByTestId('sheet-panel'));
      expect(tokenNameOf(tokens, panel.backgroundColor)).toContain('bgElevated');
      expect(radiusNameOf(tokens, panel.borderTopLeftRadius)).toContain('card');
      expect(radiusNameOf(tokens, panel.borderTopRightRadius)).toContain('card');
      const confirm = screen.getByTestId('sheet-confirm');
      expect(tokenNameOf(tokens, styleOf(confirm).backgroundColor)).toContain('danger');
      expect(radiusNameOf(tokens, styleOf(confirm).borderRadius)).toContain('pill');
      expect(tokenNameOf(tokens, styleOf(screen.getByText('Leave this shop')).color)).toContain(
        'textInverse',
      );
      expect(
        tokenNameOf(tokens, styleOf(screen.getByTestId('sheet-cancel')).borderColor),
      ).toContain('borderStrong');

      fireEvent.click(screen.getByTestId('sheet-backdrop'));
      expect(onCancel).toHaveBeenCalledTimes(1);
      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId('sheet-cancel'));
      expect(onCancel).toHaveBeenCalledTimes(2);
    },
  );
});

describe('DangerButton (R12.3, R12.5)', () => {
  function renderDanger(onConfirm = vi.fn()) {
    renderThemed(
      <DangerButton
        label="Log out"
        question="Log out of Stockkart?"
        explanation="Your check-ins keep working on this phone."
        cancelLabel="Cancel"
        onConfirm={onConfirm}
        testID="logout"
      />,
    );
    return onConfirm;
  }

  it('is a text button in danger whose touch area is extended to 48 dp', () => {
    renderDanger();
    const button = screen.getByRole('button', { name: 'Log out' });
    expect(styleOf(button).backgroundColor).toBeUndefined();
    expect(styleOf(button).minHeight).toBe(TEXT_BUTTON_HEIGHT);
    expect(tokenNameOf(TOKENS.light, styleOf(screen.getByText('Log out')).color)).toContain(
      'danger',
    );
    const slop = hitSlopOf(button) as { top: number; bottom: number };
    expect(TEXT_BUTTON_HEIGHT + slop.top + slop.bottom).toBe(MIN_TOUCH);
  });

  it('never runs the action on the first tap: it opens the sheet, and confirm runs it once', () => {
    const onConfirm = renderDanger();
    expect(screen.queryByText('Log out of Stockkart?')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Log out of Stockkart?' })).toBeTruthy();
    expect(screen.getByText('Your check-ins keep working on this phone.')).toBeTruthy();

    fireEvent.click(screen.getByTestId('logout-sheet-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Log out of Stockkart?')).toBeNull();
  });

  it('cancel closes the sheet and runs nothing', () => {
    const onConfirm = renderDanger();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    fireEvent.click(screen.getByTestId('logout-sheet-cancel'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText('Log out of Stockkart?')).toBeNull();
    // The button is still there for a second try.
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  });

  it('the sheet confirm repeats the action label unless a confirmLabel is given', () => {
    renderThemed(
      <DangerButton
        label="Remove this phone"
        question="Remove this phone?"
        cancelLabel="Keep it"
        confirmLabel="Remove"
        onConfirm={() => undefined}
        testID="remove"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove this phone' }));
    expect(screen.getByTestId('remove-sheet-confirm').getAttribute('aria-label')).toBe('Remove');
    expect(screen.getByTestId('remove-sheet-cancel').getAttribute('aria-label')).toBe('Keep it');
  });
});
