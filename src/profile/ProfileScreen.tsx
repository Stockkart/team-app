/**
 * Profile (worker-app design "Screen inventory"; R8.1, R8.5, R8.7, R5.3, R5.4, R7.7, R7.8, R9.5,
 * R12.5, R12.10, R12.15). Top to bottom: a header card with the 72 dp avatar (`onSoft`), the name,
 * phone and e-mail; a details card with the shop name, employee code and join date; then the
 * controls, in this order:
 *
 * 1. **Edit details** — the one primary button (R12.5) → `EditDetailsScreen`.
 * 2. One 20 dp list card (`ListCard`) of 56 dp rows (`ListRow`) with chevrons:
 *    - Complete your profile → the R8.6 stub, with the badge "Your shop has asked for your
 *      details" as a `warningSoft` `Chip` when the server's `profileRequested` flag is set (R8.7).
 *    - Theme — System / Light / Dark (`ThemeChoice`, R12.10).
 *    - Remove this phone — a `danger` row, only while this phone holds a pairing (R7.7). Confirms,
 *      then runs the HR-module `removePhone` unchanged: the server unpairs first, then the record,
 *      keys and offline queue are wiped; the session stays and the Attendance module shows Not
 *      enabled on the next state read. A "not paired" answer from the server (the manager unpaired
 *      it first, R7.8) is the same from here: wiped, signed in. Not reachable → the HR text, nothing
 *      changes (HR R3.8).
 *    - Leave this shop — a `danger` row. Confirms "Leave Sri Ganesh Stores? Your attendance here
 *      will stop today." (R5.3), then `POST /hr/worker/leave`; the answer is a fresh state and the
 *      shell routes from it (`shell.apply`), which lands on Join a shop (R5.5). Not reachable →
 *      "Couldn't reach Stockkart. Try again when you have network." and nothing changes (R5.4).
 *    - Log out — a `danger` row. Confirms, then `src/account/logout.ts` (R8.5, R9.5): the pairing
 *      stays.
 * 3. The app version.
 *
 * Name, phone, e-mail and photo come from the stored profile (`profile`, kept current by Edit
 * details); shop, code and join date from the state the shell routed on; `profileRequested` and the
 * server's view of the rest from `GET /hr/worker/profile`, read on mount and after every re-route,
 * best effort: without the server the screen draws what the phone knows (R6.7). Every destructive
 * action confirms first (R12.5); a 401 anywhere goes to the shell (R9.3). The screen imports no
 * Expo module and no navigator.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import type { WorkerProfileResponse } from '@stockkart/attendance-protocol';

import { logout } from '../account/logout';
import type { ShellScreenProps } from '../app/screenProps';
import {
  AppText,
  Avatar,
  Chip,
  elevatedCard,
  ListCard,
  ListRow,
  PrimaryButton,
  ROW_HEIGHT,
  Screen,
  talkbackLabel,
} from '../components';
import { t } from '../i18n';
import { errorText, useAvatarSource } from '../join/screenSupport';
import { displayDate } from '../punch/kolkata';
import { removePhone } from '../settings/removePhone';
import type { AccountProfile, StoredWorkerState } from '../state/authStore';
import { useTheme } from '../theme';
import { ThemeChoice } from './ThemeChoice';

export interface ProfileScreenProps extends ShellScreenProps {
  state: StoredWorkerState;
  profile: AccountProfile | null;
  onEditDetails: () => void;
  onCompleteProfile: () => void;
}

/** The avatar on the header card (design: 72 dp, `onSoft`). */
export const PROFILE_AVATAR_SIZE = 72;

/** A refusal or not-reachable line under the action it belongs to. */
interface Notice {
  action: 'remove' | 'leave';
  text: string;
}

export function ProfileScreen({
  deps,
  shell,
  state,
  profile,
  onEditDetails,
  onCompleteProfile,
}: ProfileScreenProps) {
  const { tokens, scheme } = useTheme();
  const avatar = useAvatarSource(deps.account, profile?.photoUrl);

  // --- the server's view: `profileRequested`, and the rest as a fallback (R8.1, R8.7) ---
  const [server, setServer] = useState<WorkerProfileResponse | null>(null);
  useEffect(() => {
    let live = true;
    deps.account
      .profile()
      .then((answer) => {
        if (live) {
          setServer(answer);
        }
      })
      .catch((error: unknown) => {
        // Not reachable or refused: the phone's copy is drawn; a 401 is the shell's (R9.3).
        shell.handleError(error);
      });
    return () => {
      live = false;
    };
  }, [deps.account, shell, state]);

  // --- whether this phone holds a pairing (R7.7: Remove this phone is offered only then) ---
  const [paired, setPaired] = useState(false);
  useEffect(() => {
    let live = true;
    deps.pairingStore
      .isPaired()
      .then((value) => {
        if (live) {
          setPaired(value);
        }
      })
      .catch(() => {
        if (live) {
          setPaired(false);
        }
      });
    return () => {
      live = false;
    };
  }, [deps.pairingStore, state]);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<'remove' | 'leave' | null>(null);

  // --- Remove this phone (R7.7, R7.8; HR R3.7–R3.9 unchanged) ---
  const confirmRemovePhone = useCallback(async () => {
    setNotice(null);
    setBusy('remove');
    try {
      const result = await removePhone({ client: deps.client, pairingStore: deps.pairingStore });
      if (result.kind === 'unpaired') {
        setPaired(false);
        // The session is untouched; the next state read says NOT_PAIRED (R7.7).
        await shell.refresh();
        return;
      }
      setNotice({ action: 'remove', text: result.message });
    } catch (error) {
      if (!shell.handleError(error)) {
        setNotice({ action: 'remove', text: errorText(error) });
      }
    } finally {
      setBusy(null);
    }
  }, [deps.client, deps.pairingStore, shell]);

  // --- Leave this shop (R5.3, R5.4) ---
  const confirmLeaveShop = useCallback(async () => {
    setNotice(null);
    setBusy('leave');
    try {
      const fresh = await deps.account.leaveShop();
      await shell.apply(fresh);
    } catch (error) {
      if (!shell.handleError(error)) {
        setNotice({ action: 'leave', text: errorText(error) });
      }
    } finally {
      setBusy(null);
    }
  }, [deps.account, shell]);

  const name = profile?.name ?? server?.name ?? '';
  const phone = profile?.phone ?? server?.phone ?? '';
  const email = profile?.email ?? server?.email ?? '';
  const shopName = state.shop?.shopName ?? server?.shopName ?? '';
  const employeeCode = state.employee?.code ?? server?.employeeCode ?? '';
  const joinDate = state.employee?.joinDate ?? server?.joinDate ?? '';
  const profileRequested = server?.profileRequested === true;

  const badge = profileRequested ? t('profile.profileRequestedBadge') : undefined;
  const cancel = t('common.cancel');

  return (
    <Screen title={t('profile.title')} scroll testID="screen-profile">
      <View
        style={{
          ...elevatedCard(tokens, scheme),
          padding: tokens.space.md,
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: tokens.space.md,
        }}
        testID="profile-header"
      >
        <Avatar
          uri={avatar?.uri}
          headers={avatar?.headers}
          name={name}
          size={PROFILE_AVATAR_SIZE}
          variant="onSoft"
          testID="profile-avatar"
        />
        <View style={{ marginLeft: tokens.space.md, flex: 1 }}>
          <AppText variant="heading" testID="profile-name">
            {name}
          </AppText>
          <Line label={t('profile.phone')} value={phone} testID="profile-phone" />
          <Line label={t('profile.email')} value={email} testID="profile-email" />
        </View>
      </View>

      <View
        style={{
          ...elevatedCard(tokens, scheme),
          paddingHorizontal: tokens.space.md,
          marginBottom: tokens.space.md,
        }}
        testID="profile-fields"
      >
        <Field label={t('profile.shop')} value={shopName} testID="profile-shop" />
        <Field label={t('profile.employeeCode')} value={employeeCode} testID="profile-code" />
        <Field
          label={t('profile.joinDate')}
          value={joinDate ? displayDate(joinDate) : ''}
          last
          testID="profile-join-date"
        />
      </View>

      <View style={{ marginBottom: tokens.space.md }}>
        <PrimaryButton
          label={t('profile.editDetails')}
          onPress={onEditDetails}
          disabled={busy != null}
          testID="profile-edit"
        />
      </View>

      <ListCard testID="profile-list">
        <ListRow
          label={t('profile.completeProfile')}
          accessibilityLabel={talkbackLabel(t('profile.completeProfile'), badge)}
          onPress={onCompleteProfile}
          disabled={busy != null}
          trailing={
            badge ? (
              <Chip label={badge} tone="warning" icon="warning" testID="profile-requested-badge" />
            ) : undefined
          }
          testID="profile-complete"
        />

        <ThemeChoice testID="profile-theme" />

        {paired ? (
          <ListRow
            tone="danger"
            label={t('profile.removePhone')}
            line={notice?.action === 'remove' ? notice.text : undefined}
            lineTone="danger"
            confirm={{
              question: t('profile.removePhoneQuestion'),
              explanation: t('profile.removePhoneExplanation'),
              confirmLabel: t('profile.removePhoneConfirm'),
              cancelLabel: cancel,
            }}
            onPress={() => void confirmRemovePhone()}
            loading={busy === 'remove'}
            disabled={busy === 'leave'}
            testID="profile-remove-phone"
          />
        ) : null}

        <ListRow
          tone="danger"
          label={t('profile.leaveShop')}
          line={notice?.action === 'leave' ? notice.text : undefined}
          lineTone="danger"
          confirm={{
            question: t('profile.leaveShopQuestion', { shopName }),
            explanation: t('profile.leaveShopExplanation'),
            confirmLabel: t('profile.leaveShopConfirm'),
            cancelLabel: cancel,
          }}
          onPress={() => void confirmLeaveShop()}
          loading={busy === 'leave'}
          disabled={busy === 'remove'}
          testID="profile-leave-shop"
        />

        <ListRow
          tone="danger"
          label={t('common.logOut')}
          confirm={{
            question: t('common.logOutQuestion'),
            explanation: t('common.logOutExplanation'),
            cancelLabel: cancel,
          }}
          onPress={() => void logout(deps, shell)}
          disabled={busy != null}
          last
          testID="profile-log-out"
        />
      </ListCard>

      <AppText
        variant="secondary"
        color="textMuted"
        align="center"
        style={{ marginTop: tokens.space.lg, marginBottom: tokens.space.md }}
        testID="profile-version"
      >
        {t('profile.appVersion', { version: deps.appVersion })}
      </AppText>
    </Screen>
  );
}

/** One line of the header card ("Phone: 98765…" to TalkBack), the value in `textSecondary`. */
function Line({ label, value, testID }: { label: string; value: string; testID: string }) {
  const { tokens } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={value ? `${label}: ${value}` : label}
      style={{ marginTop: tokens.space.xs }}
      testID={testID}
    >
      <AppText color="textSecondary" testID={`${testID}-value`}>
        {value}
      </AppText>
    </View>
  );
}

/** One "label: value" row of the details card; TalkBack reads it as one element. */
function Field({
  label,
  value,
  last = false,
  testID,
}: {
  label: string;
  value: string;
  last?: boolean;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={value ? `${label}: ${value}` : label}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        minHeight: ROW_HEIGHT,
        paddingVertical: tokens.space.sm,
        ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: tokens.color.borderDefault }),
      }}
      testID={testID}
    >
      <AppText color="textSecondary" style={{ marginRight: tokens.space.md }}>
        {label}
      </AppText>
      <AppText style={{ flexShrink: 1, textAlign: 'right' }} testID={`${testID}-value`}>
        {value}
      </AppText>
    </View>
  );
}
