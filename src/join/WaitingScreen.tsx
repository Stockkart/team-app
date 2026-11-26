/**
 * Waiting (worker-app design "Screen inventory"; R3.5, R3.6, R3.10, R6.2, R6.3, R10.1, R10.4): the
 * screen while the worker's one request is pending. Top to bottom: the notification banners
 * (unread, newest first, at most three, "and N more"); a warning-tinted `StatusCard` with an
 * hourglass, "Waiting for Sri Ganesh Stores to accept you" and the requested date, the one large
 * element on the screen, centred vertically; **Withdraw request** (confirms "Withdraw your request
 * to join …?"); Log out. No primary button: waiting has no primary action (R6.2).
 *
 * The request status is read again every 60 seconds while the screen is mounted (`usePolling`),
 * on every return to the foreground and on every focus (both in the shell), all through
 * `shell.refresh()`, which joins a read already in flight so no two reads overlap; the navigator
 * follows the answer at once (approved → Home, rejected → Join with the rejection card). A
 * withdrawal calls `withdraw` once and re-reads; "This request was already handled" means the
 * manager got there first, and the re-read shows which way.
 *
 * The screen imports no Expo module and no navigator: `deps` and `shell` come as props.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { isServerRefusal } from '../api/transport';
import { AppText, Banner, DangerButton, Screen, StatusCard } from '../components';
import { t } from '../i18n';
import type { ShellScreenProps } from '../app/screenProps';
import type { StoredWorkerState } from '../state/authStore';
import { useTheme } from '../theme';
import { logOut } from './logOut';
import { errorText, requestedOnLine } from './screenSupport';
import { useBanners } from './useBanners';
import { usePolling, WAITING_POLL_MS } from './usePolling';

export interface WaitingScreenProps extends ShellScreenProps {
  /** The `PENDING` state: `request` is the open one. */
  state: StoredWorkerState;
}

export function WaitingScreen({ deps, shell, state }: WaitingScreenProps) {
  const { tokens } = useTheme();
  const request = state.request;
  const shopName = request?.shopName ?? '';
  const banners = useBanners(deps, shell);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // R3.10: the status is re-read at least every 60 s while this screen is up; the banners follow.
  usePolling(WAITING_POLL_MS, () => {
    void shell.refresh();
    void banners.sync();
  });

  const withdraw = useCallback(async () => {
    if (!request) {
      return;
    }
    setError(null);
    setWithdrawing(true);
    try {
      await deps.account.withdraw(request.id);
      await shell.refresh();
    } catch (caught) {
      if (shell.handleError(caught)) {
        return;
      }
      if (isServerRefusal(caught) && caught.code === 'HR_REQUEST_ALREADY_HANDLED') {
        // Decided meanwhile: the re-read shows Home or the rejection (R4.10).
        await shell.refresh();
        return;
      }
      setError(errorText(caught));
    } finally {
      setWithdrawing(false);
    }
  }, [deps.account, request, shell]);

  const onBanner = useCallback(
    (item: { id: string }) => {
      // Marks it read and lets the state decide the screen (approved → Home, rejected → Join).
      void banners.markRead(item.id).then(() => shell.refresh());
    },
    [banners, shell],
  );

  return (
    <Screen scroll testID="screen-waiting">
      <Banner items={banners.items} onPress={onBanner} testID="waiting-banners" />

      <View
        style={{ flex: 1, justifyContent: 'center', paddingVertical: tokens.space.lg }}
        testID="waiting-centre"
      >
        <StatusCard
          title={t('waiting.title', { shopName })}
          line={request ? requestedOnLine(request.requestedAt) : undefined}
          tone="warning"
          icon="hourglass"
          testID="waiting-status"
        />
      </View>

      {error ? (
        <AppText
          color="danger"
          accessibilityLiveRegion="polite"
          style={{ marginBottom: tokens.space.md }}
          testID="waiting-error"
        >
          {error}
        </AppText>
      ) : null}

      {request ? (
        <DangerButton
          label={t('waiting.withdraw')}
          question={t('waiting.withdrawQuestion', { shopName })}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void withdraw()}
          loading={withdrawing}
          testID="waiting-withdraw"
        />
      ) : null}

      <DangerButton
        label={t('common.logOut')}
        question={t('common.logOutQuestion')}
        explanation={t('common.logOutExplanation')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void logOut(deps, shell)}
        testID="waiting-log-out"
      />
    </Screen>
  );
}
