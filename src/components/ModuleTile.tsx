/**
 * One tile of the Home module grid (R6.4–R6.6, R12.15): a card (`radius.card`, `shadow.card` in
 * light, a 1 dp `borderDefault` edge in dark) with a 48 dp icon circle tinted by `tint`, a label in
 * `body` / `textPrimary` and an optional status line (the Attendance tile's "Checked in 09:12").
 * The icon takes the colour that reads on its tint: `brand` on `brandSoft`, `success` on
 * `successSoft`, `textOnAccent` on `accent` (peach is a fill only, R12.14), `warning` on
 * `warningSoft`. `large` is the full-width 96 dp band the Attendance tile uses; `half` is a 112 dp
 * square. The tile is a `button` to TalkBack and announces "label. status line".
 *
 * The `unknown` variant is the tile for a module the server lists but this app version does not
 * know (R6.6): it always draws the `warningSoft` circle; tapping it shows "Update the app to use
 * this." as the status line, announces it, and calls `onPress` so the screen can count or log it;
 * it never navigates.
 */
import { useCallback, useState } from 'react';
import { AccessibilityInfo, Pressable, View, type PressableStateCallbackType } from 'react-native';

import { t } from '../i18n';
import { useTheme, type ColorToken } from '../theme';
import { talkbackLabel } from './a11y';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { TILE_HALF_SIZE, TILE_ICON_CIRCLE, TILE_ICON_SIZE, TILE_LARGE_HEIGHT } from './layout';
import { elevatedCard } from './surfaces';

export type ModuleTileSize = 'large' | 'half';

/** The icon circle's tint (design: Attendance, History, Profile, unknown). */
export type ModuleTileTint = 'brandSoft' | 'successSoft' | 'accent' | 'warningSoft';

/** The icon colour that reads on each tint (every pair is measured by `contrast.test.ts`). */
const ICON_ON_TINT: Record<ModuleTileTint, ColorToken> = {
  brandSoft: 'brand',
  successSoft: 'success',
  accent: 'textOnAccent',
  warningSoft: 'warning',
};

/**
 * What a tile for a module this version does not know says when tapped (R6.6):
 * `t('module.updateApp')`. Read once at load: the pseudo-locale switch is fixed at build time.
 */
export const UPDATE_APP_TEXT = t('module.updateApp');

export interface ModuleTileProps {
  icon: IconName;
  label: string;
  statusLine?: string;
  size: ModuleTileSize;
  onPress: () => void;
  /** `module` opens the module; `unknown` shows `UPDATE_APP_TEXT` instead (R6.6). */
  variant?: 'module' | 'unknown';
  /** The icon circle's tint; `brandSoft` by default, always `warningSoft` for `unknown`. */
  tint?: ModuleTileTint;
  testID?: string;
}

/** "label. status line" for TalkBack; the label alone without a status line. */
export function moduleTileLabel(label: string, statusLine?: string): string {
  return talkbackLabel(label, statusLine);
}

const PRESSED_OPACITY = 0.85;

export function ModuleTile({
  icon,
  label,
  statusLine,
  size,
  onPress,
  variant = 'module',
  tint = 'brandSoft',
  testID,
}: ModuleTileProps) {
  const { tokens, scheme } = useTheme();
  const [revealed, setRevealed] = useState(false);
  const line = variant === 'unknown' && revealed ? UPDATE_APP_TEXT : statusLine;
  const circle: ModuleTileTint = variant === 'unknown' ? 'warningSoft' : tint;

  const press = useCallback(() => {
    if (variant === 'unknown') {
      setRevealed(true);
      AccessibilityInfo.announceForAccessibility(UPDATE_APP_TEXT);
    }
    onPress();
  }, [variant, onPress]);

  const large = size === 'large';
  const face = ({ pressed }: PressableStateCallbackType) => [
    {
      ...elevatedCard(tokens, scheme),
      padding: tokens.space.md,
      opacity: pressed ? PRESSED_OPACITY : 1,
    },
    large
      ? {
          width: '100%' as const,
          minHeight: TILE_LARGE_HEIGHT,
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
        }
      : {
          flex: 1,
          minHeight: TILE_HALF_SIZE,
          justifyContent: 'space-between' as const,
        },
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={moduleTileLabel(label, line)}
      onPress={press}
      style={face}
      testID={testID}
    >
      <View
        style={{
          width: TILE_ICON_CIRCLE,
          height: TILE_ICON_CIRCLE,
          borderRadius: TILE_ICON_CIRCLE / 2,
          backgroundColor: tokens.color[circle],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={TILE_ICON_SIZE} color={ICON_ON_TINT[circle]} />
      </View>
      <View
        style={large ? { marginLeft: tokens.space.md, flex: 1 } : { marginTop: tokens.space.sm }}
      >
        <AppText color="textPrimary">{label}</AppText>
        {line ? (
          <AppText
            variant="secondary"
            color={variant === 'unknown' ? 'warning' : 'textSecondary'}
            accessibilityLiveRegion="polite"
            testID={testID ? `${testID}-status` : undefined}
          >
            {line}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}
