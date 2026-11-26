/**
 * Join a shop (worker-app design "Screen inventory"; R3.1–R3.4, R3.7, R3.8, R4.12, R6.2): the
 * screen a signed-in account with no shop and no pending request sees. Top to bottom: the greeting
 * with the worker's name and avatar; the rejection card when the last decided request was a
 * rejection the worker has not dismissed ("Sri Ganesh Stores did not accept your request", the
 * approver's reason word for word, **Ask another shop**) as a danger-tinted `StatusCard`; the
 * "Shop owner's email" field; the lookup result as a 20 dp card "Sri Ganesh Stores · owner Ramesh"
 * with a store icon on a `brandSoft` circle, **Yes, this is my shop** and "Not my shop" (a text
 * button), or a list to pick from when the owner has several shops; Log out.
 *
 * One primary button at a time (R6.2, R12.5): **Find shop** until a shop is on the card, then
 * **Yes, this is my shop**. Both server calls are made once and never retried; after a success or a
 * "you already have a request waiting" answer the screen asks the shell to re-read the state, which
 * lands on Waiting (R3.5). Refusals are shown word for word (the rate-limit text, R3.8; "You are
 * already part of a shop. Leave it first.", R3.7); a 401 goes to the shell (R9.3); "not found" is
 * the one sentence of R3.3 whatever the reason.
 *
 * The screen imports no Expo module and no navigator: `deps` (`AppDeps`) and `shell`
 * (`ShellActions`) come as props from `RootNavigator`.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import type { JoinRequestOutcome, ShopLookupRow } from '@stockkart/attendance-protocol';

import { isServerRefusal } from '../api/transport';
import {
  AppText,
  Avatar,
  DangerButton,
  FormField,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StatusCard,
  TextButton,
} from '../components';
import { t } from '../i18n';
import type { ShellScreenProps } from '../app/screenProps';
import type { AccountProfile, StoredWorkerState } from '../state/authStore';
import { useTheme } from '../theme';
import { logOut } from './logOut';
import { errorText, useAvatarSource } from './screenSupport';

export interface JoinShopScreenProps extends ShellScreenProps {
  /** The `NO_SHOP` state: `lastOutcome` is the rejection card (R4.12). */
  state: StoredWorkerState;
  profile: AccountProfile | null;
}

/** Where the lookup is: typing, choosing among several shops, or confirming one. */
type Phase =
  | { kind: 'search' }
  | { kind: 'pick'; shops: ShopLookupRow[] }
  | { kind: 'confirm'; shop: ShopLookupRow; others: ShopLookupRow[] };

/** A line under the field: a refusal or "not found" in `danger`, an information in `textSecondary`. */
interface Notice {
  tone: 'danger' | 'info';
  text: string;
}

const AVATAR_SIZE = 48;

/** A plausible e-mail address; the server is the judge, this only stops an empty or spaced-out field. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The outcome card is shown for a rejection the worker has not dismissed (R4.12). */
export function showsOutcome(
  outcome: JoinRequestOutcome | undefined,
  dismissedId: string | null,
): outcome is JoinRequestOutcome {
  return outcome != null && outcome.status === 'REJECTED' && outcome.id !== dismissedId;
}

export function JoinShopScreen({ deps, shell, state, profile }: JoinShopScreenProps) {
  const { tokens } = useTheme();
  const name = profile?.name ?? '';
  const avatar = useAvatarSource(deps.account, profile?.photoUrl);

  // --- the rejection card (R4.12) ---
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [dismissedLoaded, setDismissedLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    deps.authStore
      .dismissedOutcomeId()
      .then((id) => {
        if (live) {
          setDismissedId(id);
          setDismissedLoaded(true);
        }
      })
      .catch(() => {
        if (live) {
          setDismissedLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, [deps.authStore]);

  const dismissOutcome = useCallback(
    (id: string) => {
      setDismissedId(id);
      void deps.authStore.setDismissedOutcomeId(id).catch(() => {
        // Not stored: the card comes back on the next launch; nothing else is affected.
      });
    },
    [deps.authStore],
  );

  // --- the lookup (R3.2–R3.3) ---
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ kind: 'search' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [joining, setJoining] = useState(false);

  const changeEmail = useCallback((text: string) => {
    setEmail(text);
    setFieldError(undefined);
    setNotice(null);
    setPhase({ kind: 'search' });
  }, []);

  const findShop = useCallback(async () => {
    const trimmed = email.trim();
    if (!EMAIL.test(trimmed)) {
      setFieldError(t('validation.email'));
      return;
    }
    setFieldError(undefined);
    setNotice(null);
    setLookingUp(true);
    try {
      const answer = await deps.account.lookupShops(trimmed);
      const shops = answer.shops ?? [];
      if (shops.length === 0) {
        setPhase({ kind: 'search' });
        setNotice({ tone: 'danger', text: t('join.notFound') });
      } else if (shops.length === 1) {
        setPhase({ kind: 'confirm', shop: shops[0], others: [] });
      } else {
        setPhase({ kind: 'pick', shops });
      }
    } catch (error) {
      if (!shell.handleError(error)) {
        setNotice({ tone: 'danger', text: errorText(error) });
      }
    } finally {
      setLookingUp(false);
    }
  }, [deps.account, email, shell]);

  const pickShop = useCallback((shop: ShopLookupRow, shops: ShopLookupRow[]) => {
    setPhase({ kind: 'confirm', shop, others: shops.filter((s) => s.shopId !== shop.shopId) });
  }, []);

  const notMyShop = useCallback(() => {
    setNotice(null);
    setPhase((current) =>
      current.kind === 'confirm' && current.others.length > 0
        ? { kind: 'pick', shops: [current.shop, ...current.others] }
        : { kind: 'search' },
    );
  }, []);

  // --- the request (R3.4, R3.5, R3.7, R3.8) ---
  const confirmShop = useCallback(async () => {
    if (phase.kind !== 'confirm') {
      return;
    }
    setNotice(null);
    setJoining(true);
    try {
      await deps.account.createJoinRequest(phase.shop.shopId);
      await shell.refresh();
    } catch (error) {
      if (shell.handleError(error)) {
        return;
      }
      if (isServerRefusal(error) && error.code === 'HR_WORKER_REQUEST_PENDING') {
        // Already waiting (a repeated tap, or a request made from another phone): the state read
        // lands on Waiting; the server's sentence is shown as information meanwhile.
        setNotice({ tone: 'info', text: error.message });
        await shell.refresh();
        return;
      }
      setNotice({ tone: 'danger', text: errorText(error) });
      if (isServerRefusal(error) && error.code === 'HR_WORKER_HAS_SHOP') {
        // The account has a shop after all: the next read shows Home.
        await shell.refresh();
      }
    } finally {
      setJoining(false);
    }
  }, [deps.account, phase, shell]);

  const outcome = state.lastOutcome;
  const outcomeCard =
    dismissedLoaded && showsOutcome(outcome, dismissedId) ? (
      <View style={{ marginBottom: tokens.space.md }}>
        <StatusCard
          title={t('join.rejected', { shopName: outcome.shopName })}
          line={outcome.reason ?? undefined}
          tone="danger"
          action={
            <SecondaryButton
              label={t('join.askAnotherShop')}
              onPress={() => dismissOutcome(outcome.id)}
              testID="join-ask-another"
            />
          }
          testID="join-outcome"
        />
      </View>
    ) : null;

  const primary =
    phase.kind === 'search' ? (
      <PrimaryButton
        label={t('join.findShop')}
        onPress={() => void findShop()}
        loading={lookingUp}
        testID="join-find"
      />
    ) : (
      <PrimaryButton
        label={t('join.yesMyShop')}
        onPress={() => void confirmShop()}
        loading={joining}
        disabled={phase.kind !== 'confirm'}
        testID="join-confirm"
      />
    );

  return (
    <Screen title={t('join.title')} scroll footer={primary} testID="screen-join">
      <View
        style={{ flexDirection: 'row', alignItems: 'center', marginBottom: tokens.space.lg }}
        testID="join-greeting"
      >
        <Avatar
          uri={avatar?.uri}
          headers={avatar?.headers}
          name={name}
          size={AVATAR_SIZE}
          testID="join-avatar"
        />
        <AppText variant="heading" style={{ marginLeft: tokens.space.md, flexShrink: 1 }}>
          {t('join.greeting', { name })}
        </AppText>
      </View>

      {outcomeCard}

      <FormField
        label={t('join.ownerEmail')}
        value={email}
        onChangeText={changeEmail}
        onSubmitEditing={() => void findShop()}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        returnKeyType="search"
        error={fieldError}
        editable={!lookingUp && !joining}
        testID="join-email"
      />

      {notice ? (
        <AppText
          color={notice.tone === 'danger' ? 'danger' : 'textSecondary'}
          accessibilityLiveRegion="polite"
          style={{ marginBottom: tokens.space.md }}
          testID="join-notice"
        >
          {notice.text}
        </AppText>
      ) : null}

      {phase.kind === 'pick' ? (
        <View style={{ marginBottom: tokens.space.md }} testID="join-shop-list">
          <AppText color="textSecondary" style={{ marginBottom: tokens.space.sm }}>
            {t('join.pickShop')}
          </AppText>
          {phase.shops.map((shop) => (
            <View key={shop.shopId} style={{ marginBottom: tokens.space.sm }}>
              <SecondaryButton
                label={t('join.result', {
                  shopName: shop.shopName,
                  ownerFirstName: shop.ownerFirstName,
                })}
                onPress={() => pickShop(shop, phase.shops)}
                testID={`join-shop-${shop.shopId}`}
              />
            </View>
          ))}
          <TextButton label={t('join.notMyShop')} onPress={notMyShop} testID="join-not-mine" />
        </View>
      ) : null}

      {phase.kind === 'confirm' ? (
        <View style={{ marginBottom: tokens.space.md }}>
          <StatusCard
            title={t('join.result', {
              shopName: phase.shop.shopName,
              ownerFirstName: phase.shop.ownerFirstName,
            })}
            icon="store"
            action={
              <TextButton
                label={t('join.notMyShop')}
                onPress={notMyShop}
                disabled={joining}
                testID="join-not-mine"
              />
            }
            testID="join-result"
          />
        </View>
      ) : null}

      <DangerButton
        label={t('common.logOut')}
        question={t('common.logOutQuestion')}
        explanation={t('common.logOutExplanation')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void logOut(deps, shell)}
        testID="join-log-out"
      />
    </Screen>
  );
}
