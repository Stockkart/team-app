/**
 * The app mark at the top of Sign in (design "Screen inventory": "a violet circle with a peach
 * dot, no wordmark"): a `brand` disc, 64 dp, with an `accent` dot on its lower right. Peach is a
 * fill here (R12.14). The mark is decoration: the screen's title names the app, so the mark is
 * hidden from TalkBack.
 */
import { View } from 'react-native';

import { useTheme } from '../theme';
import { APP_MARK_SIZE } from './layout';

export interface AppMarkProps {
  /** Diameter in dp; `APP_MARK_SIZE` by default. */
  size?: number;
  testID?: string;
}

export function AppMark({ size = APP_MARK_SIZE, testID }: AppMarkProps) {
  const { tokens } = useTheme();
  const dot = size * 0.3;
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tokens.color.brand,
      }}
      testID={testID}
    >
      <View
        style={{
          position: 'absolute',
          right: size * 0.12,
          bottom: size * 0.12,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: tokens.color.accent,
        }}
        testID={testID ? `${testID}-dot` : undefined}
      />
    </View>
  );
}
