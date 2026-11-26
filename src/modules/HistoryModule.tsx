/**
 * The History module (worker-app design "Screen inventory"; R6.7, R7.9, R8.4): the worker's own
 * punches of the last 31 days, newest first, read with the Bearer token from the self-service
 * endpoint (`AccountClient.history` → `GET /hr/worker/punches`), which derives the employee from
 * the token; punches from before the account was linked belong to the same employee and are
 * included. The list itself is the HR-module `HistoryScreen` unchanged: it takes a
 * {@link HistoryClient} with one `getPunches(from, to)` call, so a small adapter over
 * `AccountClient` feeds it, and it keeps the SQLite display cache (`HistoryCache`) in step.
 *
 * Offline (R6.7): the screen shows the cached rows with the HR-module notice and the "Last updated
 * 09:40" line from the cache's `fetchedAt`.
 *
 * Errors: a 401 goes to the shell (`shell.handleError`, R9.3) before the screen sees it; a server
 * refusal is shown word for word above the cached rows by the screen itself. `HR_APP_NOT_PAIRED`
 * cannot come from the Bearer path, so `onUnpaired` only re-reads the state.
 *
 * The screen imports no Expo module and no navigator: `deps` and `shell` come as props.
 */
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import type { PunchResponse } from '@stockkart/attendance-protocol';

import type { AccountClient } from '../api/accountClient';
import type { ShellScreenProps } from '../app/screenProps';
import type { ShellActions } from '../app/useAppState';
import { Screen, TextButton } from '../components';
import type { HistoryClient } from '../history/loadHistory';
import { t } from '../i18n';
import { HistoryScreen, type HistoryScreenDeps } from '../screens/HistoryScreen';

export interface HistoryModuleProps extends ShellScreenProps {
  onBack: () => void;
  /** Phone clock in epoch milliseconds; `Date.now` on the phone. */
  now?: () => number;
}

/**
 * `AccountClient.history` as the {@link HistoryClient} the HR-module screen reads (R7.9). A 401 is
 * handed to the shell first (R9.3); every error is rethrown so the screen's own rules apply (not
 * reachable → cached rows, a refusal → its text).
 */
export function historyClientFor(
  account: Pick<AccountClient, 'history'>,
  shell: Pick<ShellActions, 'handleError'>,
): HistoryClient {
  return {
    async getPunches(from: string, to: string): Promise<PunchResponse[]> {
      try {
        return await account.history(from, to);
      } catch (error) {
        shell.handleError(error);
        throw error;
      }
    },
  };
}

export function HistoryModule({ deps, shell, onBack, now }: HistoryModuleProps) {
  const screenDeps = useMemo<HistoryScreenDeps>(
    () => ({
      client: historyClientFor(deps.account, shell),
      cache: deps.historyCache,
      pairingStore: deps.pairingStore,
      ...(now ? { clock: now } : {}),
    }),
    [deps.account, deps.historyCache, deps.pairingStore, shell, now],
  );
  const onUnpaired = useCallback(() => {
    void shell.refresh();
  }, [shell]);

  return (
    <Screen title={t('history.title')} testID="screen-history">
      <TextButton label={t('common.back')} onPress={onBack} testID="history-back" />
      <View style={{ flex: 1 }}>
        <HistoryScreen deps={screenDeps} onUnpaired={onUnpaired} />
      </View>
    </Screen>
  );
}
