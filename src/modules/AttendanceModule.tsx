/**
 * The Attendance module (worker-app design "Screen inventory", DD17; R7.1, R7.2, R7.6, R7.8). Two
 * states, decided by whether **this phone** holds a pairing (`pairingStore.load()`, read on every
 * focus), both drawn by the check-in screen (`PunchScreen`):
 *
 * - **Not enabled** (no pairing record): `PunchScreen` with `enabled = false` — the punch button
 *   muted and not pressable, under it the `StatusCard` "Enable biometric check-in. Ask your
 *   manager for a code." and the one primary button **I have a code**, which opens the HR-module
 *   pairing screens over the worker pairing endpoints (`onHaveCode` → `Pair`; the navigator passes
 *   `deps.workerPairingFlow`, built on `WorkerPairingClient`, and the account's own name and shop
 *   for "Yes, this is me", R7.2). When the pairing completes the navigator re-reads the state and
 *   returns here; the focus read then finds the record and the module is Enabled.
 * - **Enabled** (a pairing record): `PunchScreen` with `enabled = true` — the full check-in screen
 *   (R7.10–R7.13) over the HR-module `HomeScreenDeps` (`/me`, the punch flow, the sync worker, the
 *   pairing store) and the signer's capability for the biometric chip (R7.6). History and Profile
 *   are reached from the home grid.
 *
 * The server's `state.pairing` is not what decides: it says whether the *employee* has an active
 * pairing, which may be another phone's. Only a record on this phone can sign a punch.
 *
 * Pairing ended (HR-module R3.2–R3.3, R5.9; worker-app R7.8): when the punch screen learns the
 * pairing is over (`onUnpaired`, after it or `PunchFlow` wiped the phone), when the signer reports
 * the keys gone or invalidated (`onSignerError` → wipe), or when the sync worker finds out while
 * sending (`deps.onPairingEnded`), the module returns to Not enabled with the reason above the
 * screen, the session is kept, and the shell re-reads the state so Home's tile follows.
 *
 * The screen imports no Expo module and no navigator: `deps` and `shell` come as props; the focus
 * hook is the one react-navigation import, as in every HR-module screen.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { ShellScreenProps } from '../app/screenProps';
import { Screen, StatusCard, TextButton } from '../components';
import { t } from '../i18n';
import type { BiometricSignerErrorCode } from '../signer/BiometricSigner';
import type { StoredWorkerState } from '../state/authStore';
import { useTheme } from '../theme';
import { PunchScreen } from './PunchScreen';

export interface AttendanceModuleProps extends ShellScreenProps {
  state: StoredWorkerState;
  /** "I have a code": open the pairing screen with the worker pairing flow (R7.2). */
  onHaveCode: () => void;
  onBack: () => void;
}

/** Whether this phone holds a pairing; `null` while the store is being read. */
type Paired = boolean | null;

export function AttendanceModule({ deps, shell, onHaveCode, onBack }: AttendanceModuleProps) {
  const { tokens } = useTheme();
  const [paired, setPaired] = useState<Paired>(null);
  /** Why the module went back to Not enabled, when a screen or the worker found out (R7.8). */
  const [endedMessage, setEndedMessage] = useState<string | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const readPairing = useCallback(async () => {
    let record: unknown = null;
    try {
      record = await deps.pairingStore.load();
    } catch {
      // An unreadable record is no record: the worker can pair again.
    }
    if (live.current) {
      setPaired(record != null);
    }
  }, [deps.pairingStore]);

  // Every focus: after "I have a code" → Consent → back here, the record exists (R7.1).
  useFocusEffect(
    useCallback(() => {
      void readPairing();
    }, [readPairing]),
  );

  /** The pairing is over and the phone is wiped: Not enabled, session kept, state re-read (R7.8). */
  const ended = useCallback(
    (message: string | null) => {
      if (live.current) {
        setEndedMessage(message);
        setPaired(false);
      }
      void shell.refresh();
    },
    [shell],
  );

  // The sync worker found, while sending a queued punch, that the pairing is over (R3.3).
  useEffect(() => deps.onPairingEnded((event) => ended(event.message)), [deps, ended]);

  const onUnpaired = useCallback(() => ended(null), [ended]);

  const onSignerError = useCallback(
    (code: BiometricSignerErrorCode, message: string) => {
      if (code === 'KEY_INVALIDATED' || code === 'NO_KEYS') {
        void deps.pairingStore
          .wipe()
          .catch(() => undefined)
          .then(() => ended(message));
      }
    },
    [deps.pairingStore, ended],
  );

  const back = <TextButton label={t('common.back')} onPress={onBack} testID="attendance-back" />;

  if (paired === null) {
    return (
      <Screen title={t('attendance.title')} testID="screen-attendance">
        {back}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator accessibilityLabel={t('common.loading')} color={tokens.color.brand} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll testID="screen-attendance">
      {back}
      {!paired && endedMessage ? (
        <View style={{ marginBottom: tokens.space.md }}>
          <StatusCard title={endedMessage} tone="warning" testID="attendance-ended" />
        </View>
      ) : null}
      <View testID={paired ? 'attendance-enabled' : 'attendance-not-enabled-state'}>
        <PunchScreen
          deps={{
            client: deps.client,
            pairingStore: deps.pairingStore,
            punchFlow: deps.punchFlow,
            sync: deps.sync,
            signer: deps.signer,
          }}
          enabled={paired}
          onHaveCode={onHaveCode}
          onUnpaired={onUnpaired}
          onSignerError={onSignerError}
        />
      </View>
    </Screen>
  );
}
