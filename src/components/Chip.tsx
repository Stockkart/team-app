/**
 * A read-only status chip (design "Design language", R12.15): a 32 dp pill with `secondary` text
 * always in `textPrimary` and an optional leading icon. Filled (default): the tone's soft
 * background (`bgSurface` for neutral, `accentSoft` for accent) with the icon in the tone colour
 * (`textSecondary` for neutral, `accentText` for accent, R12.14); outlined: `bgElevated` with a
 * 1 dp `borderStrong` outline and the same icon colours. The tone shows only in the tint and the
 * icon (3:1); the label never takes the tone colour, so every chip reads at 4.5:1 in both themes
 * (`contrast.test.ts`). It has no `onPress` and is `text` to TalkBack.
 */
import { View } from 'react-native';

import { useTheme, type ColorToken } from '../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { CHIP_HEIGHT, CHIP_ICON_SIZE } from './layout';

export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

export interface ChipProps {
  label: string;
  icon?: IconName;
  tone?: ChipTone;
  /** `borderStrong` outline on `bgElevated` instead of the tone's tint. */
  outlined?: boolean;
  /** TalkBack text; the label when omitted. */
  accessibilityLabel?: string;
  testID?: string;
}

/** The filled chip's background by tone. */
const TONE_TINT: Record<ChipTone, ColorToken> = {
  neutral: 'bgSurface',
  success: 'successSoft',
  warning: 'warningSoft',
  danger: 'dangerSoft',
  accent: 'accentSoft',
};

/** The leading icon's colour by tone (peach text is `accentText`, never `accent`, R12.14). */
const TONE_ICON: Record<ChipTone, ColorToken> = {
  neutral: 'textSecondary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  accent: 'accentText',
};

export function Chip({
  label,
  icon,
  tone = 'neutral',
  outlined = false,
  accessibilityLabel,
  testID,
}: ChipProps) {
  const { tokens } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        minHeight: CHIP_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: tokens.space.sm + tokens.space.xs,
        borderRadius: tokens.radius.pill,
        backgroundColor: outlined ? tokens.color.bgElevated : tokens.color[TONE_TINT[tone]],
        ...(outlined ? { borderWidth: 1, borderColor: tokens.color.borderStrong } : {}),
      }}
      testID={testID}
    >
      {icon ? (
        <View style={{ marginRight: tokens.space.xs }}>
          <Icon
            name={icon}
            size={CHIP_ICON_SIZE}
            color={TONE_ICON[tone]}
            testID={testID ? `${testID}-icon` : undefined}
          />
        </View>
      ) : null}
      <AppText variant="secondary" color="textPrimary">
        {label}
      </AppText>
    </View>
  );
}
