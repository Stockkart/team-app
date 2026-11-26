import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS } from '../theme';
import { AppMark } from './AppMark';
import { Chip } from './Chip';
import { ListCard, ListRow } from './ListRow';
import { TextButton } from './TextButton';

afterEach(cleanup);

const glyphPaint = (scheme: 'light' | 'dark', id: string) => {
  const part = styleOf(screen.getByTestId(id).firstElementChild as Element);
  return tokenNameOf(TOKENS[scheme], part.borderColor ?? part.backgroundColor);
};

describe('ListCard and ListRow (R12.5, R12.15)', () => {
  it.each(SCHEMES)(
    'in %s: a 20 dp bgElevated card of 56 dp rows; a pressable row is a button with a textSecondary chevron and a brand glyph on brandSoft; rows but the last carry a borderDefault divider',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(
        <ListCard testID="card">
          <ListRow
            icon="document"
            label="Edit details"
            line="Name, phone, photo"
            onPress={() => undefined}
            testID="r1"
          />
          <ListRow label="Theme" last testID="r2" />
        </ListCard>,
        scheme,
      );
      const card = screen.getByTestId('card');
      expect(tokenNameOf(tokens, styleOf(card).backgroundColor)).toContain('bgElevated');
      expect(radiusNameOf(tokens, styleOf(card).borderRadius)).toContain('card');
      if (scheme === 'dark') {
        expect(tokenNameOf(tokens, styleOf(card).borderColor)).toContain('borderDefault');
        expect(styleOf(card).elevation).toBe(0);
      } else {
        expect(styleOf(card).elevation).toBe(2);
      }

      const r1 = screen.getByRole('button', { name: 'Edit details. Name, phone, photo' });
      expect(r1.getAttribute('data-testid')).toBe('r1');
      expect(styleOf(r1).minHeight).toBe(56);
      expect(tokenNameOf(tokens, styleOf(r1).borderBottomColor)).toContain('borderDefault');
      expect(
        tokenNameOf(tokens, styleOf(screen.getByTestId('r1-icon-circle')).backgroundColor),
      ).toContain('brandSoft');
      expect(styleOf(screen.getByTestId('r1-icon-circle'))).toMatchObject({
        width: 40,
        height: 40,
      });
      expect(glyphPaint(scheme, 'r1-icon')).toContain('brand');
      expect(glyphPaint(scheme, 'r1-chevron')).toContain('textSecondary');
      expect(tokenNameOf(tokens, styleOf(screen.getByTestId('r1-label')).color)).toContain(
        'textPrimary',
      );
      expect(tokenNameOf(tokens, styleOf(screen.getByTestId('r1-line')).color)).toContain(
        'textSecondary',
      );

      // A plain row: one text element, no chevron, no divider when last.
      const r2 = screen.getByTestId('r2');
      expect(r2.getAttribute('role')).toBe('text');
      expect(r2.getAttribute('aria-label')).toBe('Theme');
      expect(screen.queryByTestId('r2-chevron')).toBeNull();
      expect(styleOf(r2).borderBottomWidth).toBeUndefined();
    },
  );

  it('a danger row draws its label and glyph in danger on dangerSoft and never runs the action before the sheet confirms', () => {
    const onPress = vi.fn();
    renderThemed(
      <ListRow
        tone="danger"
        icon="cross"
        label="Leave this shop"
        confirm={{
          question: 'Leave Sri Ganesh Stores?',
          explanation: 'Your attendance here will stop today.',
          cancelLabel: 'Cancel',
        }}
        onPress={onPress}
        testID="leave"
      />,
    );
    const tokens = TOKENS.light;
    expect(tokenNameOf(tokens, styleOf(screen.getByTestId('leave-label')).color)).toContain(
      'danger',
    );
    expect(glyphPaint('light', 'leave-icon')).toContain('danger');
    expect(
      tokenNameOf(tokens, styleOf(screen.getByTestId('leave-icon-circle')).backgroundColor),
    ).toContain('dangerSoft');

    fireEvent.click(screen.getByTestId('leave'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Leave Sri Ganesh Stores?' })).toBeTruthy();
    // The sheet confirm repeats the row's label unless a confirmLabel is given.
    expect(screen.getByTestId('leave-sheet-confirm').textContent).toBe('Leave this shop');
    fireEvent.click(screen.getByTestId('leave-sheet-cancel'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.queryByTestId('leave-sheet-confirm')).toBeNull();

    fireEvent.click(screen.getByTestId('leave'));
    fireEvent.click(screen.getByTestId('leave-sheet-confirm'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a trailing Chip and a danger line (an error notice, announced) sit inside the row; disabled and loading rows take no taps', () => {
    const onPress = vi.fn();
    renderThemed(
      <>
        <ListRow
          label="Complete your profile"
          trailing={<Chip label="Asked" tone="warning" testID="badge" />}
          onPress={onPress}
          disabled
          testID="complete"
        />
        <ListRow
          label="Remove this phone"
          line="Not reachable"
          lineTone="danger"
          onPress={onPress}
          loading
          testID="remove"
        />
      </>,
    );
    const complete = screen.getByTestId('complete');
    expect(complete.contains(screen.getByTestId('badge'))).toBe(true);
    expect(complete.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(complete);
    const remove = screen.getByTestId('remove');
    expect(remove.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(remove);
    expect(onPress).not.toHaveBeenCalled();
    const line = screen.getByTestId('remove-line');
    expect(tokenNameOf(TOKENS.light, styleOf(line).color)).toContain('danger');
    expect(line.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByTestId('remove-chevron')).toBeNull();
  });
});

describe('AppMark (R12.14)', () => {
  it.each(SCHEMES)('in %s: a brand disc with an accent dot, hidden from TalkBack', (scheme) => {
    const tokens = TOKENS[scheme];
    renderThemed(<AppMark testID="mark" />, scheme);
    const mark = screen.getByTestId('mark');
    expect(styleOf(mark)).toMatchObject({ width: 64, height: 64, borderRadius: 32 });
    expect(tokenNameOf(tokens, styleOf(mark).backgroundColor)).toContain('brand');
    expect(tokenNameOf(tokens, styleOf(screen.getByTestId('mark-dot')).backgroundColor)).toContain(
      'accent',
    );
    expect(mark.getAttribute('aria-label')).toBeNull();
  });
});

describe('TextButton link', () => {
  it.each(SCHEMES)(
    'in %s: a link draws its label in brand, a plain text button in textPrimary',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(
        <>
          <TextButton link label="Forgot password?" onPress={() => undefined} testID="link" />
          <TextButton label="Back" onPress={() => undefined} testID="text" />
        </>,
        scheme,
      );
      expect(
        tokenNameOf(
          tokens,
          styleOf(screen.getByTestId('link').querySelector('span') as Element).color,
        ),
      ).toContain('brand');
      expect(
        tokenNameOf(
          tokens,
          styleOf(screen.getByTestId('text').querySelector('span') as Element).color,
        ),
      ).toContain('textPrimary');
      expect(styleOf(screen.getByTestId('link')).minHeight).toBe(44);
      expect(styleOf(screen.getByTestId('link')).backgroundColor).toBeUndefined();
    },
  );
});
