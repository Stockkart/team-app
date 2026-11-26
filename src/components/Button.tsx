/**
 * The one button the kit's five button faces share (design "Design language", R12.3, R12.5,
 * R12.9, R12.15). Filled and outlined faces are pills (`radius.pill`), 56 dp tall, full width:
 *
 * - `primary`: filled `brand`, label `buttonPrimary` in `textInverse`. `PrimaryButton`.
 * - `secondary`: `bgElevated` with a 1 dp `borderStrong` outline, label in `textPrimary`, optional
 *   leading icon. `SecondaryButton`.
 * - `dangerFilled`: filled `danger`, label in `textInverse`. The confirm button of `ConfirmSheet`.
 * - `dangerText`: text only, in `danger`, drawn 44 dp tall with `hitSlop` to 48. `DangerButton`.
 * - `text`: text only, in `textPrimary`, drawn 44 dp tall with `hitSlop` to 48. `TextButton`:
 *   "Back", "Cancel", "Not my shop".
 * - `link`: text only, in `brand` (design "Screen inventory": "links in brand"), same geometry as
 *   `text`. `TextButton link`: the links of the account screens ("Forgot password?", "Create
 *   account", "Sign in instead").
 *
 * Pressed: the fill or outline dims. Disabled: a filled face turns `bgMuted` with a `textSecondary`
 * label (the design's disabled state); an outlined or text face goes to half opacity; either way
 * `accessibilityState.disabled` and no taps. Loading: a spinner next to the label, half opacity,
 * no taps, `accessibilityState.busy`. Every face is a `button` to TalkBack and announces its label.
 */
import {
  ActivityIndicator,
  Pressable,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme, type ColorToken } from '../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { BUTTON_HEIGHT, BUTTON_ICON_SIZE, TEXT_BUTTON_HEIGHT, hitSlopFor } from './layout';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'dangerFilled'
  | 'dangerText'
  | 'text'
  | 'link';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** A leading icon in the label colour (the design gives it to `SecondaryButton`). */
  icon?: IconName;
  /** TalkBack text; the label when omitted. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface BaseButtonProps extends ButtonProps {
  variant: ButtonVariant;
}

/** Pressed fill / outline opacity: visible, but the label still meets its contrast ratio. */
const PRESSED_OPACITY = 0.85;
/** Loading, and disabled outlined / text faces. */
const INACTIVE_OPACITY = 0.5;

const FILLED: readonly ButtonVariant[] = ['primary', 'dangerFilled'];

export function BaseButton({
  variant,
  label,
  onPress,
  loading = false,
  disabled = false,
  icon,
  accessibilityLabel,
  testID,
  style,
}: BaseButtonProps) {
  const { tokens } = useTheme();
  const inactive = disabled || loading;
  const filled = FILLED.includes(variant);
  /** The design's disabled face: `bgMuted` fill, `textSecondary` label (filled faces only). */
  const mutedFace = filled && disabled && !loading;
  const labelColor: ColorToken = mutedFace
    ? 'textSecondary'
    : filled
    ? 'textInverse'
    : variant === 'dangerText'
    ? 'danger'
    : variant === 'link'
    ? 'brand'
    : 'textPrimary';
  const height =
    variant === 'dangerText' || variant === 'text' || variant === 'link'
      ? TEXT_BUTTON_HEIGHT
      : BUTTON_HEIGHT;

  const faceStyle = ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
    {
      minHeight: height,
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: tokens.space.lg,
      borderRadius: tokens.radius.pill,
      opacity: mutedFace ? 1 : inactive ? INACTIVE_OPACITY : pressed ? PRESSED_OPACITY : 1,
    },
    mutedFace && { backgroundColor: tokens.color.bgMuted },
    !mutedFace && variant === 'primary' && { backgroundColor: tokens.color.brand },
    !mutedFace && variant === 'dangerFilled' && { backgroundColor: tokens.color.danger },
    variant === 'secondary' && {
      backgroundColor: tokens.color.bgElevated,
      borderWidth: 1,
      borderColor: tokens.color.borderStrong,
    },
    style,
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={hitSlopFor({ height })}
      onPress={onPress}
      style={faceStyle}
      testID={testID}
    >
      {loading ? (
        <View style={{ marginRight: tokens.space.sm }}>
          <ActivityIndicator color={tokens.color[labelColor]} />
        </View>
      ) : icon ? (
        <View style={{ marginRight: tokens.space.sm }}>
          <Icon
            name={icon}
            size={BUTTON_ICON_SIZE}
            color={labelColor}
            testID={testID ? `${testID}-icon` : undefined}
          />
        </View>
      ) : null}
      <AppText variant={filled ? 'buttonPrimary' : 'body'} color={labelColor} align="center">
        {label}
      </AppText>
    </Pressable>
  );
}
