/**
 * The check-in screen (design "Check-in screen", DD17; R7.1, R7.6, R7.10–R7.13), mounted by
 * `AttendanceModule` in both of its states. Top to bottom: today's date (Asia/Kolkata) and the
 * `LiveClock`; the `StatusLine`; the `PunchButton`; the outcome cards; when attendance is not
 * enabled, the "Enable biometric check-in" card and **I have a code**; the `TodayCard`; the
 * location and biometric `Chip`s. Every colour comes from `useTheme()` through the kit and every
 * text from `t()`, except the HR-module texts the design keeps word for word (the refusal
 * messages, `OFFLINE_NOTICE`, `SAVED_OFFLINE`, the R5.5 sentence, "N punches waiting to be sent",
 * `REFUSAL_OK`).
 *
 * The behaviour is the HR-module `screens/HomeScreen` moved behind the new tree, with the same
 * `HomeScreenDeps` (R7.6): `GET /me` on every focus and after every stored punch (R4.1a–b), each
 * answer refreshing the stored Location check settings (R9.3); the sync worker's `QueueState`
 * subscription, so while punches wait the direction is `nextDirectionFor` (the opposite of the
 * newest queued punch, R6.4) and the status line is the waiting count (R6.16); each refused saved
 * punch as a danger card with OK → `sync.dismissRefused` (R6.13–R6.14); `OFFLINE_NOTICE` as a
 * warning card when `/me` is not reachable, the button still working (R6.1–R6.2); a tap running
 * `punchFlow.run` and showing its outcome as one inline card under the button (R7.13): stored
 * (success, the confirmation lines), saved offline (success, `SAVED_OFFLINE`), refused (danger,
 * word for word), biometric failed (warning, the R5.5 sentence, screen otherwise unchanged),
 * signer error (danger, then `onSignerError`); `HR_APP_NOT_PAIRED` from `/me` wipes the phone and
 * calls `onUnpaired`, from a punch (already wiped by `PunchFlow`) calls `onUnpaired` (R3.2–R3.3).
 *
 * Haptics (R12.8): `punchStored` once after a stored or queued punch, `punchRefused` once after a
 * refusal, `biometricFailed` once after a failed check; nothing else vibrates. A stored punch also
 * plays the button's ring once (`pulse`), skipped under reduce motion (R12.7).
 *
 * Not enabled (`enabled = false`): nothing is read from the server, the signer or the queue (there
 * is no device key to sign with); the button is muted and not pressable, the status line reads
 * "Not checked in yet", the Today card is empty and the chips read "Location off" / "Not set up".
 *
 * The chips (R7.12) read the stored location settings (`pairingStore.load().location`, refreshed
 * by `/me`) and the signer's `capability()`; they never make a network call. The location chip's
 * "Inside shop" / "Outside shop" comes from the newest punch result (`locationCheckOf`), "Checking…"
 * before one is known or while a punch is in flight.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { AppStatusResponse } from '@stockkart/attendance-protocol';

import { isNotReachable, isServerRefusal } from '../api/appClient';
import {
  AppText,
  Chip,
  LiveClock,
  PrimaryButton,
  PunchButton,
  SecondaryButton,
  StatusCard,
  StatusLine,
  TodayCard,
  type StatusTone,
} from '../components';
import { t } from '../i18n';
import { displayDate, kolkataDate } from '../punch/kolkata';
import type { PunchResult } from '../punch/PunchFlow';
import {
  biometricChipFor,
  locationCheckOf,
  locationChipFor,
  statusLineFor,
  todayPunchesOf,
  type LocationCheck,
} from '../punch/punchScreen';
import type { QueuedPunch } from '../queue/PunchQueue';
import type { QueueState } from '../queue/SyncWorker';
import {
  nextDirectionFor,
  OFFLINE_NOTICE,
  REFUSAL_OK,
  refusalHeading,
  type HomeScreenDeps,
} from '../screens/HomeScreen';
import type {
  BiometricSigner,
  BiometricSignerErrorCode,
  SignerCapability,
} from '../signer/BiometricSigner';
import type { PairingRecord } from '../state/pairingStore';
import { useTheme } from '../theme';
import { biometricFailed, punchRefused, punchStored } from '../theme/haptics';

export interface PunchScreenDeps extends HomeScreenDeps {
  /** The signer's capability feeds the biometric chip (R7.12); without it the chip reads "Not set up". */
  signer?: Pick<BiometricSigner, 'capability'>;
}

export interface PunchScreenProps {
  deps: PunchScreenDeps;
  /** This phone holds a pairing (R7.1): the full screen. Otherwise the muted button and the code card. */
  enabled: boolean;
  /** "I have a code" (R7.2). */
  onHaveCode: () => void;
  /** The pairing has ended and the phone is already wiped (R3.3). */
  onUnpaired: () => void;
  /** The signer failed outside the biometric check (`KEY_INVALIDATED`, `NO_KEYS`); the caller wipes. */
  onSignerError?: (code: BiometricSignerErrorCode, message: string) => void;
  testID?: string;
}

/** One inline card under the button (R7.13). */
interface Outcome {
  tone: StatusTone;
  title: string;
  line?: string;
  /** Cleared by the next `/me` answer: the offline notice and "saved on your phone". */
  untilOnline: boolean;
}

const EMPTY_QUEUE: QueueState = { waiting: 0, refused: [], newestDirection: null };

export function PunchScreen({
  deps,
  enabled,
  onHaveCode,
  onUnpaired,
  onSignerError,
  testID = 'punch-screen',
}: PunchScreenProps) {
  const { tokens } = useTheme();
  const [status, setStatus] = useState<AppStatusResponse | null>(null);
  const [stored, setStored] = useState<PairingRecord | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);
  const [capability, setCapability] = useState<SignerCapability | null>(null);
  const [lastCheck, setLastCheck] = useState<LocationCheck | null>(null);
  const [pulse, setPulse] = useState(0);
  const mounted = useRef(true);
  const clock = deps.clock ?? Date.now;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // R6.4, R6.13, R6.16: the queue state as the sync worker publishes it (only with a pairing).
  useEffect(() => {
    if (!enabled) {
      setQueue(EMPTY_QUEUE);
      return;
    }
    return deps.sync.subscribe(setQueue);
  }, [deps.sync, enabled]);

  const handleUnpaired = useCallback(async () => {
    try {
      await deps.pairingStore.wipe();
    } finally {
      onUnpaired();
    }
  }, [deps.pairingStore, onUnpaired]);

  /** R4.1b: `GET /me` for the direction and today's times; R9.3: the stored settings follow. */
  const refresh = useCallback(async () => {
    try {
      const me = await deps.client.getMe();
      if (!mounted.current) {
        return;
      }
      setStatus(me);
      setLoading(false);
      setOutcome((current) => (current?.untilOnline ? null : current));
      try {
        await deps.pairingStore.updateLocation(me.location);
      } catch {
        // The stored settings are a convenience for the next tap; the answer itself is what counts.
      }
    } catch (error) {
      if (isServerRefusal(error) && error.notPaired) {
        await handleUnpaired();
        return;
      }
      if (!mounted.current) {
        return;
      }
      setLoading(false);
      setOutcome(
        isNotReachable(error)
          ? { tone: 'warning', title: OFFLINE_NOTICE, untilOnline: true }
          : { tone: 'danger', ...splitMessage(messageOf(error)), untilOnline: false },
      );
    }
  }, [deps.client, deps.pairingStore, handleUnpaired]);

  /** The chips' sources (R7.12): the stored record and the signer's capability; no network. */
  const readChipSources = useCallback(async () => {
    const [record, cap] = await Promise.all([
      deps.pairingStore.load().catch(() => null),
      deps.signer ? deps.signer.capability().catch(() => null) : Promise.resolve(null),
    ]);
    if (mounted.current) {
      setStored(record);
      setCapability(cap);
    }
  }, [deps.pairingStore, deps.signer]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (enabled) {
        void refresh();
        void readChipSources();
      }
      return () => setFocused(false);
    }, [enabled, refresh, readChipSources]),
  );

  const direction = nextDirectionFor(queue, status);
  const settings = status?.location ?? stored?.location ?? null;

  const onPunch = useCallback(async () => {
    if (busy || !enabled) {
      return;
    }
    setBusy(true);
    try {
      const result = await deps.punchFlow.run({ directionGuess: direction });
      if (!mounted.current) {
        return;
      }
      await applyResult(result);
    } catch (error) {
      if (mounted.current) {
        setOutcome({ tone: 'danger', ...splitMessage(messageOf(error)), untilOnline: false });
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }

    async function applyResult(result: PunchResult): Promise<void> {
      const check = locationCheckOf(result, settings?.radiusMetres);
      if (check !== null) {
        setLastCheck(check);
      }
      switch (result.kind) {
        case 'stored': {
          const [title, ...rest] = result.lines;
          setOutcome({
            tone: 'success',
            title: title ?? '',
            line: rest.length > 0 ? rest.join(' ') : undefined,
            untilOnline: false,
          });
          setPulse((n) => n + 1);
          void punchStored();
          setStatus((current) =>
            current == null
              ? current
              : {
                  ...current,
                  todayIn: result.response.todayIn,
                  todayOut: result.response.todayOut,
                  nextDirection: result.response.nextDirection,
                },
          );
          await refresh();
          return;
        }
        case 'queued':
          // R6.3; the direction and the waiting line follow from the worker's published state
          // (R6.4, R6.16). No `/me` read: the server was just found not reachable.
          setOutcome({ tone: 'success', title: result.message, untilOnline: true });
          setPulse((n) => n + 1);
          void punchStored();
          return;
        case 'refused':
          setOutcome({ tone: 'danger', ...splitMessage(result.message), untilOnline: false });
          void punchRefused();
          return;
        case 'biometric_required':
          setOutcome({ tone: 'warning', ...splitMessage(result.message), untilOnline: false });
          void biometricFailed();
          return;
        case 'signer_error':
          setOutcome({ tone: 'danger', ...splitMessage(result.message), untilOnline: false });
          onSignerError?.(result.code, result.message);
          return;
        case 'unpaired':
          // PunchFlow has already wiped the phone.
          onUnpaired();
          return;
      }
    }
  }, [
    busy,
    enabled,
    direction,
    deps.punchFlow,
    refresh,
    onSignerError,
    onUnpaired,
    settings?.radiusMetres,
  ]);

  const dismiss = useCallback(
    (punchId: string) => {
      void deps.sync.dismissRefused(punchId).catch(() => undefined);
    },
    [deps.sync],
  );

  const today = status?.today ?? kolkataDate(new Date(clock()));
  const statusLine = statusLineFor(enabled ? status : null, queue, clock());
  const punches = enabled ? todayPunchesOf(status) : [];
  const location = locationChipFor(
    enabled ? settings : null,
    busy && settings?.locationCheck ? null : lastCheck,
  );
  const biometric = biometricChipFor({ paired: enabled, capability });
  const gap = { marginTop: tokens.space.md };

  return (
    <View testID={testID}>
      <AppText variant="secondary" color="textSecondary" align="center" testID={`${testID}-date`}>
        {displayDate(today)}
      </AppText>
      <LiveClock active={focused} now={clock} testID={`${testID}-clock`} />
      <View style={{ marginTop: tokens.space.sm }}>
        <StatusLine text={statusLine} testID={`${testID}-status-line`} />
      </View>

      <View style={{ marginTop: tokens.space.lg, alignItems: 'center' }}>
        {loading && status == null ? (
          <ActivityIndicator accessibilityLabel={t('common.loading')} color={tokens.color.brand} />
        ) : (
          <PunchButton
            direction={direction}
            enabled={enabled}
            busy={busy}
            onPress={() => void onPunch()}
            pulse={pulse}
            testID="punch-button"
          />
        )}
      </View>

      {status && !status.canPunch && status.reason ? (
        <View style={gap}>
          <StatusCard title={status.reason} tone="warning" testID={`${testID}-reason`} />
        </View>
      ) : null}
      {queue.refused.map((punch) => (
        <View key={punch.punchId} style={gap}>
          <RefusedPunchCard punch={punch} onDismiss={dismiss} />
        </View>
      ))}
      {outcome ? (
        <View style={gap}>
          <StatusCard
            title={outcome.title}
            line={outcome.line}
            tone={outcome.tone}
            testID={`${testID}-outcome`}
          />
        </View>
      ) : null}

      {enabled ? null : (
        <View style={gap}>
          <StatusCard
            title={t('attendance.notEnabledTitle')}
            line={t('attendance.notEnabledLine')}
            testID="attendance-not-enabled"
          />
          <View style={gap}>
            <PrimaryButton
              label={t('attendance.haveCode')}
              onPress={onHaveCode}
              testID="attendance-code"
            />
          </View>
        </View>
      )}

      <View style={gap}>
        <TodayCard punches={punches} testID={`${testID}-today`} />
      </View>

      <View style={{ ...gap, flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm }}>
        <Chip
          label={location.text}
          tone={location.tone}
          icon={location.icon}
          accessibilityLabel={location.accessibilityLabel}
          testID={`${testID}-chip-location`}
        />
        <Chip
          label={biometric.text}
          tone={biometric.tone}
          icon={biometric.icon}
          accessibilityLabel={biometric.accessibilityLabel}
          testID={`${testID}-chip-biometric`}
        />
      </View>
    </View>
  );
}

/**
 * One refused saved punch (R6.13): its date, time and direction as the phone recorded them, the
 * server's refusal word for word, and OK, which deletes it (R6.14). A danger `StatusCard`.
 */
function RefusedPunchCard({
  punch,
  onDismiss,
}: {
  punch: QueuedPunch;
  onDismiss: (punchId: string) => void;
}) {
  return (
    <StatusCard
      tone="danger"
      title={refusalHeading(punch)}
      line={punch.refusalMessage ?? undefined}
      action={
        <SecondaryButton
          label={REFUSAL_OK}
          onPress={() => onDismiss(punch.punchId)}
          testID={`refused-ok-${punch.punchId}`}
        />
      }
      testID={`refused-${punch.punchId}`}
    />
  );
}

/** A multi-line message as a card: the first line is the title, the rest the line under it. */
function splitMessage(message: string): { title: string; line?: string } {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const [title, ...rest] = lines;
  return { title: title ?? message, line: rest.length > 0 ? rest.join(' ') : undefined };
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : t('common.somethingWentWrong');
}
