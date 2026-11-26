/**
 * The confirmation every destructive action goes through (R12.5): a bottom sheet on `bgElevated`
 * with a 20 dp top radius (`radius.card`), the question, an optional explanation, a `danger`
 * filled pill confirm button (`textInverse` label) and a secondary cancel button. Tapping the
 * dimmed backdrop or pressing hardware back cancels.
 *
 * Built on React Native's `Modal` (no extra dependency). The sheet slides up over
 * `useMotionDuration()` ms: 200 ms by default, 0 when the phone's "reduce motion" is on (R12.7).
 * `Modal`'s own animation is off so this is the only motion.
 */
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';

import { duration, easing, useMotionDuration, useTheme } from '../theme';
import { AppText } from './AppText';
import { BaseButton } from './Button';

export interface ConfirmSheetProps {
  visible: boolean;
  question: string;
  explanation?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

/** How far below the screen's edge the sheet starts its slide, in dp. */
const SHEET_TRAVEL = 320;

export function ConfirmSheet({
  visible,
  question,
  explanation,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  testID,
}: ConfirmSheetProps) {
  const { tokens } = useTheme();
  const motion = useMotionDuration(duration.standard);
  const slide = useRef(new Animated.Value(SHEET_TRAVEL)).current;

  useEffect(() => {
    if (!visible) {
      slide.setValue(SHEET_TRAVEL);
      return;
    }
    const animation = Animated.timing(slide, {
      toValue: 0,
      duration: motion,
      easing,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, motion, slide]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onCancel}
      testID={testID}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          onPress={onCancel}
          style={[styles.backdrop, { backgroundColor: tokens.color.textPrimary }]}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: tokens.color.bgElevated,
              borderTopLeftRadius: tokens.radius.card,
              borderTopRightRadius: tokens.radius.card,
              padding: tokens.space.lg,
              transform: [{ translateY: slide }],
            },
          ]}
          testID={testID ? `${testID}-panel` : undefined}
        >
          <AppText variant="heading" accessibilityRole="header">
            {question}
          </AppText>
          {explanation ? (
            <AppText color="textSecondary" style={{ marginTop: tokens.space.sm }}>
              {explanation}
            </AppText>
          ) : null}
          <View style={{ marginTop: tokens.space.lg }}>
            <BaseButton
              variant="dangerFilled"
              label={confirmLabel}
              onPress={onConfirm}
              testID={testID ? `${testID}-confirm` : undefined}
            />
          </View>
          <View style={{ marginTop: tokens.space.sm }}>
            <BaseButton
              variant="secondary"
              label={cancelLabel}
              onPress={onCancel}
              testID={testID ? `${testID}-cancel` : undefined}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Backdrop dim: dark enough to read as a layer, light enough that the screen behind stays visible. */
const BACKDROP_OPACITY = 0.4;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, opacity: BACKDROP_OPACITY },
  sheet: { width: '100%' },
});
