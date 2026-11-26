import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PunchResponse } from '@stockkart/attendance-protocol';

import { renderThemed } from '../../test-support/render';
import { NotAuthenticated, NotReachable } from '../api/transport';
import type { AppDeps } from '../app/deps';
import type { ShellActions } from '../app/useAppState';
import { HistoryCache } from '../history/HistoryCache';
import { STRINGS_EN, t } from '../i18n';
import { MemoryDatabase } from '../queue/memoryDb';
import { HISTORY_FROM_CACHE } from '../screens/HistoryScreen';
import { HistoryModule, historyClientFor } from './HistoryModule';

vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    useEffect(() => effect(), [effect]);
  },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(cleanup);

// 2025-04-03 09:40 IST.
const NOW = Date.UTC(2025, 3, 3, 4, 10, 0);

function punch(id: string, at: string): PunchResponse {
  return {
    id,
    employeeId: 'e1',
    at,
    source: 'BIOMETRIC_APP',
    direction: 'IN',
    flags: [],
    counted: true,
  };
}

function harness(answers: Array<PunchResponse[] | Error>) {
  const history = vi.fn(async (_from: string, _to: string) => {
    const next = answers.shift();
    if (next === undefined) {
      throw new Error('no scripted answer');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  const historyCache = new HistoryCache(new MemoryDatabase(), { now: () => NOW });
  const pairingStore = { wipe: vi.fn(async () => undefined) };
  const deps = { account: { history }, historyCache, pairingStore } as unknown as AppDeps;
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn(() => false),
    confirm: vi.fn(async () => true),
  };
  return { deps, shell, history, historyCache, pairingStore };
}

function renderModule(h: ReturnType<typeof harness>) {
  const onBack = vi.fn();
  renderThemed(<HistoryModule deps={h.deps} shell={h.shell} onBack={onBack} now={() => NOW} />);
  return { onBack };
}

describe('HistoryModule (R6.7, R7.9)', () => {
  it('reads the last 31 days through the Bearer client and lists them newest first', async () => {
    const h = harness([[punch('a', '2025-04-01T04:05:00Z'), punch('b', '2025-04-03T03:40:00Z')]]);
    const { onBack } = renderModule(h);
    const list = await screen.findByTestId('history-list');
    expect(h.history).toHaveBeenCalledWith('2025-03-04', '2025-04-03');
    expect(
      Array.from(list.querySelectorAll('[data-testid^="history-row-"]'))
        .map((row) => row.getAttribute('data-testid') ?? '')
        .filter((id) => /^history-row-[^-]+$/.test(id)),
    ).toEqual(['history-row-b', 'history-row-a']);
    expect(screen.getByText(t('history.title'))).toBeTruthy();
    expect(screen.queryByTestId('history-last-updated')).toBeNull();

    fireEvent.click(screen.getByTestId('history-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('offline: the cached rows with the notice and "Last updated HH:mm" (R6.7)', async () => {
    const h = harness([new NotReachable('TIMEOUT')]);
    // The last server answer was stored at 09:40 IST.
    await h.historyCache.replaceAll(
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
    renderModule(h);
    expect((await screen.findByTestId('history-notice')).textContent).toBe(HISTORY_FROM_CACHE);
    expect(screen.getByTestId('history-last-updated').textContent).toBe(
      t('history.lastUpdated', { time: '09:40' }),
    );
    expect(screen.getByTestId('history-row-cached')).toBeTruthy();
    expect(h.pairingStore.wipe).not.toHaveBeenCalled();
    expect(h.shell.refresh).not.toHaveBeenCalled();
  });

  it('a session that ended goes to the shell (R9.3)', async () => {
    const h = harness([new NotAuthenticated('Token expired')]);
    (h.shell.handleError as ReturnType<typeof vi.fn>).mockReturnValue(true);
    renderModule(h);
    await waitFor(() => expect(h.shell.handleError).toHaveBeenCalledTimes(1));
    expect(h.shell.handleError).toHaveBeenCalledWith(expect.any(NotAuthenticated));
  });

  it('historyClientFor hands every error to the shell first and rethrows it', async () => {
    const error = new NotReachable('CONNECTION');
    const handleError = vi.fn(() => false);
    const client = historyClientFor(
      { history: vi.fn(async () => Promise.reject(error)) },
      { handleError },
    );
    await expect(client.getPunches('2025-03-04', '2025-04-03')).rejects.toBe(error);
    expect(handleError).toHaveBeenCalledWith(error);
    expect(STRINGS_EN['history.lastUpdated']).toContain('{time}');
  });
});
