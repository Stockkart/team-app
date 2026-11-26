/**
 * Blocked (worker-app design "Screen inventory"; R5.6, R12.6): the one sentence that says why this
 * account cannot go on, and the way out. One kind, `staff_no_employee`: a staff account (Owner,
 * Admin, Manager, Cashier) with no linked employee. "This app is for workers. Ask your manager to
 * link your login to your employee record from the Employees page." as a neutral `StatusCard`,
 * centred like an `EmptyState`; Log out is the only control (R5.6, R6.2).
 *
 * No primary button: there is no primary action here. The screen imports no Expo module and no
 * navigator: `deps` and `shell` come as props.
 */
import { View } from 'react-native';

import type { BlockedKind } from '../app/AppStateMachine';
import { DangerButton, Screen, StatusCard } from '../components';
import { t } from '../i18n';
import type { ShellScreenProps } from '../app/screenProps';
import { useTheme } from '../theme';
import { logOut } from './logOut';

export interface BlockedScreenProps extends ShellScreenProps {
  kind: BlockedKind;
}

/** The sentence each kind shows (R5.6). */
export function blockedSentence(kind: BlockedKind): string {
  switch (kind) {
    case 'staff_no_employee':
      return t('blocked.staffNoEmployee');
  }
}

export function BlockedScreen({ deps, shell, kind }: BlockedScreenProps) {
  const { tokens } = useTheme();
  return (
    <Screen testID="screen-blocked">
      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: tokens.space.xl }}>
        <StatusCard title={blockedSentence(kind)} testID="blocked-sentence" />
      </View>
      <View style={{ marginBottom: tokens.space.sm }}>
        <DangerButton
          label={t('common.logOut')}
          question={t('common.logOutQuestion')}
          explanation={t('common.logOutExplanation')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void logOut(deps, shell)}
          testID="blocked-log-out"
        />
      </View>
    </Screen>
  );
}
