/**
 * The one `Text` the kit and the screens use: a type role from `typeScale` (the `variant`), a
 * colour token from the current theme, and the font-scaling props every text must carry (R12.2).
 * Nothing else in the app should render a bare `Text`, so no label can miss `TEXT_SCALING` or
 * name a colour literal. (`variant`, not `role`: React Native's `Text` already has an ARIA `role`
 * prop.)
 */
import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { TEXT_SCALING, typeScale, useTheme, type ColorToken, type TypeRoleName } from '../theme';

export interface AppTextProps extends Omit<TextProps, 'style' | 'children'> {
  /** Type role from `typeScale`; `body` when omitted. */
  variant?: TypeRoleName;
  /** Colour token; `textPrimary` when omitted. */
  color?: ColorToken;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}

export function AppText({
  variant = 'body',
  color = 'textPrimary',
  align,
  style,
  children,
  ...rest
}: AppTextProps) {
  const { tokens } = useTheme();
  const type = typeScale[variant];
  return (
    <Text
      {...TEXT_SCALING}
      {...rest}
      style={[
        {
          fontSize: type.fontSize,
          lineHeight: type.lineHeight,
          fontFamily: type.fontFamily,
          color: tokens.color[color],
          textAlign: align,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
