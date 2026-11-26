import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { STRINGS_EN } from '../i18n';
import type { TodayPunch } from '../punch/punchScreen';
import { TOKENS, typeScale } from '../theme';
import { TodayCard } from './TodayCard';

afterEach(cleanup);

const IN = (time: string): TodayPunch => ({ direction: 'IN', time });
const OUT = (time: string): TodayPunch => ({ direction: 'OUT', time });

describe('TodayCard (R7.12, R12.15)', () => {
  it.each(SCHEMES)(
    'in %s: an elevated 20 dp card headed "Today"; empty, the one sentence and no footer',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(<TodayCard punches={[]} testID="today" />, scheme);
      const card = styleOf(screen.getByTestId('today'));
      expect(tokenNameOf(tokens, card.backgroundColor)).toContain('bgElevated');
      expect(radiusNameOf(tokens, card.borderRadius)).toContain('card');
      if (scheme === 'dark') {
        expect(card.borderWidth).toBe(1);
        expect(tokenNameOf(tokens, card.borderColor)).toContain('borderDefault');
        expect(card.elevation).toBe(0);
      } else {
        expect(card.borderWidth).toBe(0);
        expect(card.elevation).toBe(tokens.shadow.card.elevation);
      }
      const heading = screen.getByRole('heading', { name: STRINGS_EN['punch.todayTitle'] });
      expect(styleOf(heading).fontSize).toBe(typeScale.heading.fontSize);
      const empty = screen.getByTestId('today-empty');
      expect(empty.textContent).toBe(STRINGS_EN['punch.noCheckInYetToday']);
      expect(tokenNameOf(tokens, styleOf(empty).color)).toContain('textSecondary');
      expect(screen.queryByTestId('today-worked')).toBeNull();
      expect(screen.queryByTestId('today-row-0')).toBeNull();
    },
  );

  it.each(SCHEMES)(
    'in %s: a row reads "IN 09:12 → OUT 18:05" with IN in success, OUT in danger, times in textPrimary; footer "Worked 8 h 53 m"',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(<TodayCard punches={[IN('09:12'), OUT('18:05')]} testID="today" />, scheme);
      const row = screen.getByTestId('today-row-0');
      expect(row.getAttribute('aria-label')).toBe('IN 09:12 → OUT 18:05');
      expect(row.getAttribute('role')).toBe('text');
      const inWord = within(row).getByText('IN');
      const outWord = within(row).getByText('OUT');
      expect(tokenNameOf(tokens, styleOf(inWord).color)).toContain('success');
      expect(tokenNameOf(tokens, styleOf(outWord).color)).toContain('danger');
      expect(tokenNameOf(tokens, styleOf(within(row).getByText('09:12')).color)).toContain(
        'textPrimary',
      );
      expect(tokenNameOf(tokens, styleOf(within(row).getByText('18:05')).color)).toContain(
        'textPrimary',
      );
      expect(within(row).getByText('→')).toBeTruthy();
      const worked = screen.getByTestId('today-worked');
      expect(worked.textContent).toBe('Worked 8 h 53 m');
      expect(tokenNameOf(tokens, styleOf(worked).color)).toContain('textSecondary');
      expect(screen.queryByTestId('today-empty')).toBeNull();
    },
  );

  it('a missing OUT is "—" in textSecondary and the footer is absent without a pair', () => {
    renderThemed(<TodayCard punches={[IN('09:12')]} testID="today" />);
    const row = screen.getByTestId('today-row-0');
    expect(row.getAttribute('aria-label')).toBe('IN 09:12 → OUT —');
    const out = screen.getByTestId('today-row-0-out');
    expect(out.textContent).toBe('—');
    expect(tokenNameOf(TOKENS.light, styleOf(out).color)).toContain('textSecondary');
    expect(screen.queryByTestId('today-worked')).toBeNull();
  });

  it('one row per IN; the footer is last OUT − first IN', () => {
    renderThemed(
      <TodayCard punches={[IN('09:12'), OUT('13:00'), IN('14:00'), OUT('18:05')]} testID="today" />,
    );
    expect(screen.getByTestId('today-row-0').getAttribute('aria-label')).toBe(
      'IN 09:12 → OUT 13:00',
    );
    expect(screen.getByTestId('today-row-1').getAttribute('aria-label')).toBe(
      'IN 14:00 → OUT 18:05',
    );
    expect(screen.queryByTestId('today-row-2')).toBeNull();
    expect(screen.getByTestId('today-worked').textContent).toBe('Worked 8 h 53 m');
    // No text truncates (R12.11).
    expect(document.querySelectorAll('[data-number-of-lines]')).toHaveLength(0);
  });
});
