/**
 * Home (worker-app design "Screen inventory", "Home header"; R6.4–R6.7, R10.1, R12.15, R12.16):
 * the screen a worker with an ACTIVE employee lands on. Top to bottom: the `GradientHeader` band
 * (`brandSoft` → `accentSoft`, flush with the status bar) with the worker's avatar (56 dp, `onSoft`),
 * the greeting by the IST hour with the first name ("Good morning, Priya", `greetingFor`), the shop
 * name and today's date (Asia/Kolkata, from the phone clock); the notification banners (unread,
 * newest first, at most three, "and N more"); the module grid on the canvas.
 *
 * The grid is derived from the state and nothing else (Property 15): `tilesFor(state.modules)`
 * gives one tile per server entry in server order, so no module the server did not list is ever
 * shown (D10), and a key this version does not know is the "Update the app to use this." tile
 * (R6.6) on a `warningSoft` circle. The Attendance tile is the first and largest and carries
 * today's status inline (`statusLine(state.today)`: "Not checked in" / "Checked in 09:12" /
 * "Checked in 09:12 · out 18:05", R6.5); the other tiles are half width. Each tile's icon circle
 * takes the tint its module registers (`brandSoft`, `successSoft`, `accent`, R12.15). Tapping a
 * module tile asks the navigator for its route (`onOpenModule`); the update tile only reveals its
 * line.
 *
 * Offline (R6.7): the navigator mounts this screen from the last state stored on the phone with
 * `offline` set; the screen says so in one line and otherwise works the same. The status line is
 * only trusted for the day the server computed it: on a later day without network it reads "Not
 * checked in" rather than yesterday's times.
 *
 * Tapping a banner marks it read (server and cache) and opens the related screen (R10.1): a
 * profile request opens Profile; an approval or rejection re-reads the state, which decides the
 * screen (Home stays Home; a rejection would already have moved the worker to Join).
 *
 * The screen imports no Expo module and no navigator: `deps` and `shell` come as props. The
 * status-bar inset is read here (`useSafeAreaInsets`) and handed to the band, which sits above
 * `Screen`'s padded body.
 */
import { useCallback } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ModuleKey } from '@stockkart/attendance-protocol';

import type { ShellScreenProps } from '../app/screenProps';
import {
  AppText,
  Avatar,
  Banner,
  GradientHeader,
  ModuleTile,
  Screen,
  type BannerItem,
} from '../components';
import { t } from '../i18n';
import { useAvatarSource } from '../join/screenSupport';
import { useBanners } from '../join/useBanners';
import { tilesFor, type Tile } from '../modules/registry';
import { displayDate, kolkataDate } from '../punch/kolkata';
import type { AccountProfile, StoredWorkerState } from '../state/authStore';
import { useTheme } from '../theme';
import { greetingFor, kolkataHour } from './greeting';
import { statusLine } from './statusLine';

export interface WorkerHomeScreenProps extends ShellScreenProps {
  /** The `ACTIVE` state (or the last one stored when `offline`, R6.7). */
  state: StoredWorkerState;
  profile: AccountProfile | null;
  /** The server was not reachable: the screen works from `state` and says so. */
  offline: boolean;
  onOpenModule: (key: ModuleKey) => void;
  /** Phone clock in epoch milliseconds; `Date.now` on the phone. */
  now?: () => number;
}

/** The avatar on the band (design "Home header": 56 dp, `onSoft`). */
export const HOME_AVATAR_SIZE = 56;

/** The notification type whose banner opens Profile (R8.7, R10.1). */
const PROFILE_REQUESTED = 'PROFILE_REQUESTED';

/**
 * The Attendance tile's line for the phone's `today`: the server's times when they are for this
 * day, "Not checked in" otherwise (a stored state read on a later day, R6.7). Pure.
 */
export function todayLine(state: Pick<StoredWorkerState, 'today'>, todayDate: string): string {
  const today = state.today;
  return statusLine(today && today.date === todayDate ? today : null);
}

export function WorkerHomeScreen({
  deps,
  shell,
  state,
  profile,
  offline,
  onOpenModule,
  now = Date.now,
}: WorkerHomeScreenProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const name = profile?.name ?? state.employee?.name ?? '';
  const shopName = state.shop?.shopName ?? '';
  const nowMs = now();
  const todayDate = kolkataDate(new Date(nowMs));
  const greeting = greetingFor(kolkataHour(nowMs), name);
  const avatar = useAvatarSource(deps.account, profile?.photoUrl);
  const banners = useBanners(deps, shell);

  const onBanner = useCallback(
    (item: BannerItem) => {
      void banners.markRead(item.id).then(() => {
        if (item.type === PROFILE_REQUESTED) {
          onOpenModule('PROFILE');
          return;
        }
        return shell.refresh();
      });
    },
    [banners, onOpenModule, shell],
  );

  const tiles = tilesFor(state.modules);
  const large = tiles.filter((tile) => tile.kind === 'module' && tile.def.size === 'large');
  const half = tiles.filter((tile) => !(tile.kind === 'module' && tile.def.size === 'large'));
  const renderTile = (tile: Tile) =>
    tile.kind === 'module' ? (
      <ModuleTile
        key={tile.key}
        icon={tile.def.icon}
        label={t(tile.def.label)}
        statusLine={tile.key === 'ATTENDANCE' ? todayLine(state, todayDate) : undefined}
        size={tile.def.size}
        tint={tile.def.tint}
        onPress={() => onOpenModule(tile.key)}
        testID={`home-module-${tile.key.toLowerCase()}`}
      />
    ) : (
      <ModuleTile
        key={tile.key}
        icon="unknown"
        label={tile.key}
        size="half"
        variant="unknown"
        onPress={() => undefined}
        testID={`home-module-update-${tile.key.toLowerCase()}`}
      />
    );

  const header = (
    <GradientHeader style={{ paddingTop: insets.top + tokens.space.lg }} testID="home-header">
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Avatar
          uri={avatar?.uri}
          headers={avatar?.headers}
          name={name}
          size={HOME_AVATAR_SIZE}
          variant="onSoft"
          testID="home-avatar"
        />
        <View style={{ marginLeft: tokens.space.md, flex: 1 }}>
          <AppText
            variant="title"
            color="textPrimary"
            accessibilityRole="header"
            testID="home-greeting"
          >
            {greeting}
          </AppText>
          <AppText color="textSecondary" testID="home-shop">
            {shopName}
          </AppText>
          <AppText variant="secondary" color="textSecondary" testID="home-date">
            {displayDate(todayDate)}
          </AppText>
        </View>
      </View>
    </GradientHeader>
  );

  return (
    <Screen scroll header={header} testID="screen-home">
      {offline ? (
        <AppText
          variant="secondary"
          color="warning"
          accessibilityLiveRegion="polite"
          style={{ marginBottom: tokens.space.md }}
          testID="home-offline"
        >
          {t('common.notReachable')}
        </AppText>
      ) : null}

      <Banner items={banners.items} onPress={onBanner} testID="home-banners" />

      <View style={{ marginTop: tokens.space.sm }} testID="home-grid">
        {large.map((tile) => (
          <View key={tile.key} style={{ marginBottom: tokens.space.sm }}>
            {renderTile(tile)}
          </View>
        ))}
        {pairs(half).map((row, index) => (
          <View
            key={row.map((tile) => tile.key).join('|')}
            style={{
              flexDirection: 'row',
              gap: tokens.space.sm,
              marginBottom: tokens.space.sm,
            }}
            testID={`home-grid-row-${index}`}
          >
            {row.map(renderTile)}
            {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

/** The half tiles two to a row, in order; an odd last row has one. */
export function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}
