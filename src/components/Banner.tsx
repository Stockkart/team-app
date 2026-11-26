/**
 * The notification banners at the top of Waiting and Home (R10.1): one line per unread
 * notification, newest first, at most three visible, then "and N more". Each banner is a `button`
 * that announces its text; tapping it hands the item to `onPress`, which marks it read and opens
 * the related screen, and tells TalkBack what just changed (`banner.markedRead`, R12.9: the banner
 * disappears, so the state change is announced rather than left silent). Each banner is a
 * `bgMuted` tinted card (`radius.card`, no border, no bar; R12.15) with a leading bell icon in
 * `brand` and the text in `textPrimary`.
 *
 * `formatBanners` is the pure rule (Property 24, tested by task 12.4): it orders, caps and counts;
 * the component only draws what it returns.
 */
import { AccessibilityInfo, Pressable, View, type PressableStateCallbackType } from 'react-native';

import { t } from '../i18n';
import { useTheme } from '../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { BUTTON_ICON_SIZE, MIN_TOUCH, TOUCH_GAP } from './layout';

export interface BannerItem {
  id: string;
  text: string;
  /** ISO-8601 instant; when every item has one the newest comes first. */
  createdAt?: string;
  /** The notification type (`HrNotificationType`), so a tap can open the related screen (R10.1). */
  type?: string;
}

/** The most banners drawn at once (R10.1). */
export const MAX_BANNERS = 3;

export interface FormattedBanners {
  /** The banners to draw, newest first, at most `MAX_BANNERS`. */
  visible: BannerItem[];
  /** How many unread notifications are not drawn; `0` when all fit. */
  hidden: number;
}

/** "and N more" (R10.1), from `t('banner.more')`. */
export function moreLine(hidden: number): string {
  return t('banner.more', { count: hidden });
}

/**
 * Newest first (by `createdAt`, descending; items without one keep their order after those with
 * one; the sort is stable), the first `MAX_BANNERS` visible, the rest counted.
 */
export function formatBanners(items: readonly BannerItem[]): FormattedBanners {
  const ordered = [...items].sort((a, b) => {
    if (a.createdAt === undefined || b.createdAt === undefined) {
      return a.createdAt === b.createdAt ? 0 : a.createdAt === undefined ? 1 : -1;
    }
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
  return {
    visible: ordered.slice(0, MAX_BANNERS),
    hidden: Math.max(0, ordered.length - MAX_BANNERS),
  };
}

export interface BannerProps {
  items: readonly BannerItem[];
  onPress: (item: BannerItem) => void;
  testID?: string;
}

const PRESSED_OPACITY = 0.85;

export function Banner({ items, onPress, testID }: BannerProps) {
  const { tokens } = useTheme();
  const { visible, hidden } = formatBanners(items);
  if (visible.length === 0) {
    return null;
  }
  const face = ({ pressed }: PressableStateCallbackType) => ({
    minHeight: MIN_TOUCH,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: tokens.color.bgMuted,
    borderRadius: tokens.radius.card,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    marginBottom: TOUCH_GAP,
    opacity: pressed ? PRESSED_OPACITY : 1,
  });
  const press = (item: BannerItem) => {
    AccessibilityInfo.announceForAccessibility(t('banner.markedRead'));
    onPress(item);
  };
  return (
    <View testID={testID}>
      {visible.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.text}
          onPress={() => press(item)}
          style={face}
          testID={testID ? `${testID}-${item.id}` : undefined}
        >
          <View style={{ marginRight: tokens.space.sm }}>
            <Icon
              name="bell"
              size={BUTTON_ICON_SIZE}
              color="brand"
              testID={testID ? `${testID}-${item.id}-icon` : undefined}
            />
          </View>
          <AppText color="textPrimary" style={{ flex: 1 }}>
            {item.text}
          </AppText>
        </Pressable>
      ))}
      {hidden > 0 ? (
        <AppText
          variant="secondary"
          color="textSecondary"
          testID={testID ? `${testID}-more` : undefined}
        >
          {moreLine(hidden)}
        </AppText>
      ) : null}
    </View>
  );
}
