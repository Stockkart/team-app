import { cleanup, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KEY_INVALIDATED, SERVER_MESSAGES, flagSentence } from '@stockkart/attendance-protocol';
import type { PunchResponse } from '@stockkart/attendance-protocol';

import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { NotReachable, ServerRefusal } from '../api/appClient';
import type { HistoryEntry } from '../history/HistoryCache';
import { HistoryCache } from '../history/HistoryCache';
import { STRINGS_EN } from '../i18n';
import { MemoryDatabase } from '../queue/memoryDb';
import { BiometricSignerError } from '../signer/BiometricSigner';
import { TOKENS } from '../theme';
import { DUPLICATE_PUNCH, groupByDay, HISTORY_FROM_CACHE, HistoryScreen } from './HistoryScreen';

// jsdom with `react-native` aliased to DOM elements (vite.config.mts). The focus hook is an effect
// that runs once on mount, which is what a focused screen does.
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    useEffect(() => effect(), [effect]);
  },
}));
// The kit's `Screen` (re-exported with the cards and rows this screen draws) reads the safe area
// from a native module.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// 2025-04-03 09:12 IST
const NOW = Date.UTC(2025, 3, 3, 3, 42, 0);

function punch(id: string, at: string, extra: Partial<PunchResponse> = {}): PunchResponse {
  return {
    id,
    employeeId: '5f1a2b3c4d5e6f7081920002',
    at,
    source: 'BIOMETRIC_APP',
    direction: 'IN',
    flags: [],
    counted: true,
    ...extra,
  };
}

function harness(answers: Array<PunchResponse[] | Error>) {
  const getPunches = vi.fn(async (_from: string, _to: string) => {
    const next = answers.shift();
    if (next === undefined) {
      throw new Error('no scripted answer');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  const cache = new HistoryCache(new MemoryDatabase(), { now: () => NOW });
  const wipe = vi.fn(async () => undefined);
  const onUnpaired = vi.fn();
  const deps = { client: { getPunches }, cache, pairingStore: { wipe }, clock: () => NOW };
  return { deps, getPunches, cache, wipe, onUnpaired };
}

afterEach(cleanup);

/** The row elements of the list, top to bottom (not their icon, circle or time parts). */
function rowIds(list: Element): string[] {
  return Array.from(list.querySelectorAll('[data-testid^="history-row-"]'))
    .map((row) => row.getAttribute('data-testid') ?? '')
    .filter((id) => /^history-row-[^-]+$/.test(id));
}

describe('HistoryScreen', () => {
  it('lists the last 31 days newest first with date, time, direction and flags in plain words (R4.10)', async () => {
    const h = harness([
      [
        punch('a', '2025-04-01T04:05:00Z'),
        punch('b', '2025-04-03T03:40:00Z', {
          direction: 'OUT',
          flags: ['OUTSIDE_SHOP', 'RECORDED_OFFLINE'],
        }),
        punch('c', '2025-04-03T03:38:00Z', { counted: false }),
      ],
    ]);
    renderThemed(<HistoryScreen deps={h.deps} onUnpaired={h.onUnpaired} />);

    const list = await screen.findByTestId('history-list');
    expect(h.getPunches).toHaveBeenCalledWith('2025-03-04', '2025-04-03');

    expect(rowIds(list)).toEqual(['history-row-b', 'history-row-c', 'history-row-a']);
    // Grouped by day, newest day first: the 3 April card holds b and c, the 1 April card holds a.
    const today = screen.getByTestId('history-day-2025-04-03');
    const earlier = screen.getByTestId('history-day-2025-04-01');
    expect(today.textContent).toContain('Thu, 3 Apr 2025');
    expect(today.contains(screen.getByTestId('history-row-b'))).toBe(true);
    expect(today.contains(screen.getByTestId('history-row-c'))).toBe(true);
    expect(earlier.textContent).toContain('Tue, 1 Apr 2025');
    expect(earlier.contains(screen.getByTestId('history-row-a'))).toBe(true);

    const rowB = screen.getByTestId('history-row-b');
    expect(rowB.textContent).toContain('09:10');
    expect(rowB.textContent).toContain('Check out');
    expect(rowB.textContent).toContain(flagSentence('OUTSIDE_SHOP'));
    expect(rowB.textContent).toContain('Recorded offline — your manager will see this');
    expect(screen.getByTestId('history-row-c').textContent).toContain(DUPLICATE_PUNCH);
    const rowA = screen.getByTestId('history-row-a');
    expect(rowA.textContent).toContain('09:35');
    expect(rowA.textContent).toContain('Check in');
    expect(screen.queryByTestId('history-notice')).toBeNull();
    expect(screen.queryByTestId('history-empty')).toBeNull();
  });

  it.each(SCHEMES)(
    'in %s: day cards are 20 dp bgElevated cards; IN is a success arrow on successSoft, OUT a danger arrow on dangerSoft, times textPrimary, a duplicate dimmed (R12.15)',
    async (scheme) => {
      const tokens = TOKENS[scheme];
      const h = harness([
        [
          punch('in', '2025-04-03T03:38:00Z'),
          punch('out', '2025-04-03T03:40:00Z', { direction: 'OUT' }),
          punch('dup', '2025-04-03T03:41:00Z', { counted: false }),
        ],
      ]);
      renderThemed(<HistoryScreen deps={h.deps} onUnpaired={h.onUnpaired} />, scheme);
      await screen.findByTestId('history-list');
      const card = screen.getByTestId('history-day-2025-04-03');
      expect(tokenNameOf(tokens, styleOf(card).backgroundColor)).toContain('bgElevated');
      expect(radiusNameOf(tokens, styleOf(card).borderRadius)).toContain('card');
      if (scheme === 'dark') {
        expect(tokenNameOf(tokens, styleOf(card).borderColor)).toContain('borderDefault');
      } else {
        expect(styleOf(card).elevation).toBe(2);
      }

      const glyphPaint = (id: string) => {
        const part = styleOf(screen.getByTestId(`${id}-icon`).firstElementChild as Element);
        return tokenNameOf(tokens, part.borderColor ?? part.backgroundColor);
      };
      expect(glyphPaint('history-row-in')).toContain('success');
      expect(
        tokenNameOf(
          tokens,
          styleOf(screen.getByTestId('history-row-in-icon-circle')).backgroundColor,
        ),
      ).toContain('successSoft');
      expect(glyphPaint('history-row-out')).toContain('danger');
      expect(
        tokenNameOf(
          tokens,
          styleOf(screen.getByTestId('history-row-out-icon-circle')).backgroundColor,
        ),
      ).toContain('dangerSoft');
      for (const id of ['history-row-in-time', 'history-row-out-time']) {
        expect(tokenNameOf(tokens, styleOf(screen.getByTestId(id)).color)).toContain('textPrimary');
      }
      expect(styleOf(screen.getByTestId('history-row-in')).opacity).toBe(1);
      expect(styleOf(screen.getByTestId('history-row-dup')).opacity).toBe(0.5);
    },
  );

  it('shows the one EmptyState sentence when there are no punches in the window (R12.6)', async () => {
    const h = harness([[]]);
    renderThemed(<HistoryScreen deps={h.deps} onUnpaired={h.onUnpaired} />);
    const empty = await screen.findByTestId('history-empty');
    expect(empty.textContent).toBe(STRINGS_EN['history.empty']);
    expect(STRINGS_EN['history.empty']).toBe('No check-ins in the last 31 days');
    expect(empty.querySelector('button')).toBeNull();
  });

  it('when the server is not reachable it shows the cached copy with a notice', async () => {
    const h = harness([new NotReachable('TIMEOUT')]);
    await h.cache.replaceAll(
      [
        {
          punchId: 'cached',
          atMs: Date.UTC(2025, 3, 2, 4, 0, 0),
          localDate: '2025-04-02',
          localTime: '09:30',
          direction: 'IN',
          flags: [],
          counted: true,
        },
      ],
      '2025-03-04',
    );
    renderThemed(<HistoryScreen deps={h.deps} onUnpaired={h.onUnpaired} />);

    const notice = await screen.findByTestId('history-notice');
    expect(notice.textContent).toBe(HISTORY_FROM_CACHE);
    // A warning-tinted card (R12.15).
    expect(tokenNameOf(TOKENS.light, styleOf(notice).backgroundColor)).toContain('warningSoft');
    // The cached copy was stored at NOW (09:12 IST): the "Last updated" line says so (worker-app R6.7).
    expect(screen.getByTestId('history-last-updated').textContent).toBe('Last updated 09:12');
    expect(screen.getByTestId('history-day-2025-04-02').textContent).toContain('Wed, 2 Apr 2025');
    expect(screen.getByTestId('history-row-cached')).toBeTruthy();
    expect(h.wipe).not.toHaveBeenCalled();
  });

  it('a refusal other than not-paired is shown word for word above the cached list', async () => {
    const h = harness([new ServerRefusal(429, SERVER_MESSAGES.HR_TOO_MANY_ATTEMPTS)]);
    renderThemed(<HistoryScreen deps={h.deps} onUnpaired={h.onUnpaired} />);
    expect((await screen.findByTestId('history-notice')).textContent).toBe(
      SERVER_MESSAGES.HR_TOO_MANY_ATTEMPTS,
    );
    expect(screen.getByTestId('history-empty')).toBeTruthy();
  });

  it('HR_APP_NOT_PAIRED wipes the phone and hands over to the pairing screen (R3.2–R3.3)', async () => {
    const h = harness([new ServerRefusal(403, SERVER_MESSAGES.HR_APP_NOT_PAIRED)]);
    renderThemed(<HistoryScreen deps={h.deps} onUnpaired={h.onUnpaired} />);
    await waitFor(() => expect(h.onUnpaired).toHaveBeenCalledTimes(1));
    expect(h.wipe).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('history-list')).toBeNull();
  });

  it('an invalidated key wipes the phone too', async () => {
    const h = harness([new BiometricSignerError('KEY_INVALIDATED')]);
    renderThemed(<HistoryScreen deps={h.deps} onUnpaired={h.onUnpaired} />);
    await waitFor(() => expect(h.onUnpaired).toHaveBeenCalledTimes(1));
    expect(h.wipe).toHaveBeenCalledTimes(1);
    expect(KEY_INVALIDATED).toContain('paired again');
  });

  it('an unexpected error is shown rather than swallowed, as a danger card', async () => {
    const h = harness([new TypeError('boom')]);
    renderThemed(<HistoryScreen deps={h.deps} onUnpaired={h.onUnpaired} />);
    const error = await screen.findByTestId('history-error');
    expect(error.textContent).toBe('boom');
    expect(tokenNameOf(TOKENS.light, styleOf(error).backgroundColor)).toContain('dangerSoft');
  });
});

describe('groupByDay', () => {
  const entry = (punchId: string, localDate: string): HistoryEntry => ({
    punchId,
    atMs: 0,
    localDate,
    localTime: '09:00',
    direction: 'IN',
    flags: [],
    counted: true,
  });

  it('groups consecutive entries of one day, keeps the day order and the entry order', () => {
    expect(
      groupByDay([entry('b', '2025-04-03'), entry('c', '2025-04-03'), entry('a', '2025-04-01')]),
    ).toEqual([
      { date: '2025-04-03', entries: [entry('b', '2025-04-03'), entry('c', '2025-04-03')] },
      { date: '2025-04-01', entries: [entry('a', '2025-04-01')] },
    ]);
  });

  it('gives no day for no entries', () => {
    expect(groupByDay([])).toEqual([]);
  });
});
