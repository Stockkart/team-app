/**
 * The card surface rule of the design language (R12.15): a 20 dp radius (`radius.card`); in the
 * light theme a soft shadow (`shadow.card`: Android elevation 2, iOS 8 % / 12 dp) and no border;
 * in the dark theme no shadow (the dark `shadow.card` is zero) and a 1 px `borderDefault` edge.
 * `ModuleTile`, `StatusCard` and `Banner` spread what these return so the rule lives in one place.
 *
 * `borderDefault` is decorative here (a card edge), which R12.4 exempts from the contrast gate.
 */
import type { ViewStyle } from 'react-native';

import type { ColorScheme, ThemeTokens } from '../theme';

/** Radius plus the dark theme's 1 px edge; no fill, no shadow. */
export function cardFrame(tokens: ThemeTokens, scheme: ColorScheme): ViewStyle {
  return {
    borderRadius: tokens.radius.card,
    ...(scheme === 'dark'
      ? { borderWidth: 1, borderColor: tokens.color.borderDefault }
      : { borderWidth: 0 }),
  };
}

/** `cardFrame` on `bgElevated` with the theme's `shadow.card`: a plain card (ModuleTile). */
export function elevatedCard(tokens: ThemeTokens, scheme: ColorScheme): ViewStyle {
  return {
    ...cardFrame(tokens, scheme),
    backgroundColor: tokens.color.bgElevated,
    ...tokens.shadow.card,
  };
}
