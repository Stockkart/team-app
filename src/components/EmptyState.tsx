/**
 * An empty list, inbox or wait (R12.6): one sentence in `secondary`, centred, and, when the screen
 * has something the worker can do about it, one secondary button. An optional `illustration` sits
 * above the sentence and is clipped to a third of the window height, whatever it draws, so no
 * picture can push the sentence or the button off a small phone; none is drawn in this version.
 */
import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { useTheme } from '../theme';
import { AppText } from './AppText';
import { SecondaryButton } from './SecondaryButton';

export interface EmptyStateProps {
  sentence: string;
  action?: { label: string; onPress: () => void };
  /** A decorative picture above the sentence; never taller than a third of the window (R12.6). */
  illustration?: ReactNode;
  testID?: string;
}

/** The tallest an empty-state illustration may be on a window `windowHeight` dp tall (R12.6). */
export function illustrationMaxHeight(windowHeight: number): number {
  return Math.floor(windowHeight / 3);
}

export function EmptyState({ sentence, action, illustration, testID }: EmptyStateProps) {
  const { tokens } = useTheme();
  const { height } = useWindowDimensions();
  return (
    <View
      style={{ alignItems: 'center', paddingVertical: tokens.space.xl }}
      accessibilityRole="summary"
      accessibilityLabel={sentence}
      testID={testID}
    >
      {illustration ? (
        <View
          style={{
            maxHeight: illustrationMaxHeight(height),
            overflow: 'hidden',
            alignItems: 'center',
            marginBottom: tokens.space.lg,
          }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={testID ? `${testID}-illustration` : undefined}
        >
          {illustration}
        </View>
      ) : null}
      <AppText
        variant="secondary"
        color="textSecondary"
        align="center"
        accessibilityLiveRegion="polite"
      >
        {sentence}
      </AppText>
      {action ? (
        <View style={{ marginTop: tokens.space.lg, width: '100%' }}>
          <SecondaryButton label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
