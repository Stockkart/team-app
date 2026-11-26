/**
 * The one punch control (design "Check-in screen", R7.10, R7.13, R12.3, R12.9): a centred circle
 * about 200 dp across, never under 160 dp and never wider than 60 % of the screen
 * (`punchButtonDiameter`), filled by `punchTone`: `success` with "Check in" when the next
 * direction is IN, `danger` with "Check out" when it is OUT, `bgMuted` with a `textSecondary`
 * label and not pressable when attendance is not enabled. The label is `title` in `textInverse`
 * and is also the control's accessibility label; it is the one text in the app that may
 * `adjustsFontSizeToFit` (R12.2: at 200 % the label shrinks, the circle never grows).
 *
 * `pulse` counts stored punches: each change plays the success ring once — an absolutely
 * positioned circle in the fill colour scaling 1 → 1.25 and fading, `duration.max` (300 ms) with
 * the standard ease — and under the phone's "reduce motion" setting the ring is not drawn at all
 * (R12.7). The haptic is the caller's (`punchStored`); the button only animates.
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import type { PunchDirection } from '@stockkart/attendance-protocol';

import { t } from '../i18n';
import { punchTone, type PunchTone } from '../punch/punchScreen';
import { duration, easing, useReducedMotion, useTheme, type ColorToken } from '../theme';
import { AppText } from './AppText';

export interface PunchButtonProps {
  /** The direction the next tap would have; also the label (R7.10). */
  direction: PunchDirection;
  /** Attendance is enabled on this phone; otherwise the button is muted and not pressable. */
  enabled: boolean;
  /** A punch is in flight: no second tap, `accessibilityState.busy`. */
  busy?: boolean;
  onPress: () => void;
  /** Increment once per stored punch to play the success ring (R7.13). */
  pulse?: number;
  testID?: string;
}

/** The design's diameter (dp) and its clamps (R7.10). */
export const PUNCH_DIAMETER = 200;
export const PUNCH_MIN_DIAMETER = 160;
export const PUNCH_MAX_WIDTH_SHARE = 0.6;

/** The ring grows to this scale before it fades. */
export const RING_SCALE = 1.25;

/** The circle's diameter for a screen `width` dp wide: 200, never under 160, never over 60 %. */
export function punchButtonDiameter(width: number): number {
  const share = Number.isFinite(width) && width > 0 ? width * PUNCH_MAX_WIDTH_SHARE : 0;
  return Math.max(PUNCH_MIN_DIAMETER, Math.min(PUNCH_DIAMETER, Math.floor(share)));
}

const FILL: Record<PunchTone, ColorToken> = {
  success: 'success',
  danger: 'danger',
  muted: 'bgMuted',
};

const LABEL: Record<PunchTone, ColorToken> = {
  success: 'textInverse',
  danger: 'textInverse',
  muted: 'textSecondary',
};

/** Pressed: the fill dims, the label still meets its ratio. */
const PRESSED_OPACITY = 0.85;

export function PunchButton({
  direction,
  enabled,
  busy = false,
  onPress,
  pulse = 0,
  testID,
}: PunchButtonProps) {
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const diameter = punchButtonDiameter(width);
  const tone = punchTone(direction, enabled);
  const label = direction === 'IN' ? t('punch.checkIn') : t('punch.checkOut');
  const inactive = !enabled || busy;

  const ring = useRef(new Animated.Value(0)).current;
  const lastPulse = useRef(pulse);
  useEffect(() => {
    if (pulse === lastPulse.current) {
      return;
    }
    lastPulse.current = pulse;
    if (reduceMotion) {
      return;
    }
    ring.setValue(0);
    const animation = Animated.timing(ring, {
      toValue: 1,
      duration: duration.max,
      easing,
      useNativeDriver: true,
    });
    animation.start(() => ring.setValue(0));
    return () => animation.stop();
  }, [pulse, reduceMotion, ring]);

  return (
    <View
      style={[styles.box, { width: diameter, height: diameter }]}
      testID={testID ? `${testID}-box` : undefined}
    >
      {reduceMotion ? null : (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              backgroundColor: tokens.color[FILL[tone]],
              opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
              transform: [
                { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, RING_SCALE] }) },
              ],
            },
          ]}
          testID={testID ? `${testID}-ring` : undefined}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive, busy }}
        disabled={inactive}
        onPress={onPress}
        style={({ pressed }) => ({
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: tokens.space.lg,
          backgroundColor: tokens.color[FILL[tone]],
          opacity: pressed && !inactive ? PRESSED_OPACITY : 1,
        })}
        testID={testID}
      >
        <AppText
          variant="title"
          color={LABEL[tone]}
          align="center"
          adjustsFontSizeToFit
          testID={testID ? `${testID}-label` : undefined}
        >
          {label}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute' },
});
