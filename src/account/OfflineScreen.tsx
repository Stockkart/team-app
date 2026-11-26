/**
 * Offline (worker-app R6.7; design "Screen inventory": Offline): shown when the server is not
 * reachable and the phone has no last state that was `ACTIVE` to open Home from ("Join, Waiting and
 * Sign in need the server"). One warning-tinted `StatusCard`, "Couldn't reach Stockkart. Try again
 * when you have network.", centred on the canvas; **Retry** (`shell.refresh()`: reads the state
 * again and follows the answer) pinned at the bottom; and Log out (confirms first, R12.5;
 * `account/logout.ts`: the pairing and the offline queue stay, D9).
 */
import { View } from 'react-native';

import { DangerButton, PrimaryButton, Screen, StatusCard } from '../components';
import type { ShellScreenProps } from '../app/screenProps';
import { t } from '../i18n';
import { useTheme } from '../theme';
import { logout } from './logout';

export type OfflineScreenProps = ShellScreenProps;

export function OfflineScreen({ deps, shell }: OfflineScreenProps) {
  const { tokens } = useTheme();
  return (
    <Screen
      testID="screen-offline"
      footer={
        <PrimaryButton
          label={t('offline.retry')}
          onPress={() => void shell.refresh()}
          testID="offline-retry"
        />
      }
    >
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <StatusCard title={t('offline.title')} tone="warning" testID="offline-line" />
      </View>
      <View style={{ marginBottom: tokens.space.sm }}>
        <DangerButton
          label={t('common.logOut')}
          question={t('common.logOutQuestion')}
          explanation={t('common.logOutExplanation')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void logout(deps, shell)}
          testID="offline-log-out"
        />
      </View>
    </Screen>
  );
}
