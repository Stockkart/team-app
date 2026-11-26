/**
 * The Home header band (design "Home header", R12.16): a soft gradient from `brandSoft` (top-left)
 * to `accentSoft` (bottom-right), the two token names `tokens.gradient.header` carries, resolved in
 * the current theme. Bottom corners of `radius.card`, 24 dp padding; the caller adds the status-bar
 * inset through `style` when the band sits flush with the top of the screen. The text drawn on it
 * is `textPrimary` / `textSecondary`, which `contrast.test.ts` measures against both ends.
 *
 * This is the only file that may import `expo-linear-gradient` (`eslint.config.mjs`,
 * `no-restricted-imports`); it is a native module, autolinked, with no `app.json` plugin entry
 * (design DD17).
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '../theme';

export interface GradientHeaderProps {
  children?: ReactNode;
  /** Extra outer style, e.g. `paddingTop` for the status-bar inset. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The gradient runs from the top-left corner to the bottom-right one. */
export const GRADIENT_START = { x: 0, y: 0 } as const;
export const GRADIENT_END = { x: 1, y: 1 } as const;

export function GradientHeader({ children, style, testID }: GradientHeaderProps) {
  const { tokens } = useTheme();
  const [from, to] = tokens.gradient.header;
  return (
    <LinearGradient
      colors={[tokens.color[from], tokens.color[to]]}
      start={GRADIENT_START}
      end={GRADIENT_END}
      style={[
        {
          padding: tokens.space.lg,
          borderBottomLeftRadius: tokens.radius.card,
          borderBottomRightRadius: tokens.radius.card,
        },
        style,
      ]}
      testID={testID}
    >
      {children}
    </LinearGradient>
  );
}
