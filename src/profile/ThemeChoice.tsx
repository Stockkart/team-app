/**
 * The Theme row of Profile's list card (R12.10, R12.15): "Theme" and three choices, System / Light
 * / Dark, drawn as a row of pill radio buttons: the selected one filled `brand` with a `textInverse`
 * label, the others `bgElevated` with a `borderStrong` outline and a `textPrimary` label. Choosing
 * one calls `setOverride` on the current theme, which the `ThemeProvider` applies at once and
 * reports to `App.tsx`, where it is written to `authStore.themeOverride`; that key survives log out.
 * Each choice is a `radio` to TalkBack with its selected state, drawn 44 dp tall and extended to the
 * 48 dp touch minimum (R12.3). The row sits inside `ListCard` under a `borderDefault` divider like
 * its neighbours.
 */
import { Pressable, View } from 'react-native';

import { AppText, hitSlopFor, TEXT_BUTTON_HEIGHT, TOUCH_GAP } from '../components';
import { t, type StringId } from '../i18n';
import { THEME_OVERRIDES, useTheme, type ThemeOverride } from '../theme';

/** The label id of each choice, in the order the row shows them. */
export const THEME_LABELS: Record<ThemeOverride, StringId> = {
  system: 'profile.themeSystem',
  light: 'profile.themeLight',
  dark: 'profile.themeDark',
};

export interface ThemeChoiceProps {
  testID?: string;
}

export function ThemeChoice({ testID }: ThemeChoiceProps) {
  const { tokens, override, setOverride } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: tokens.space.md,
        paddingVertical: tokens.space.sm,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.borderDefault,
      }}
      testID={testID}
    >
      <AppText style={{ marginBottom: tokens.space.sm }}>{t('profile.theme')}</AppText>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: TOUCH_GAP }}>
        {THEME_OVERRIDES.map((choice) => {
          const selected = choice === override;
          return (
            <Pressable
              key={choice}
              accessibilityRole="radio"
              accessibilityLabel={t(THEME_LABELS[choice])}
              accessibilityState={{ selected, checked: selected }}
              hitSlop={hitSlopFor({ height: TEXT_BUTTON_HEIGHT })}
              onPress={() => setOverride(choice)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: TEXT_BUTTON_HEIGHT,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: tokens.space.sm,
                borderRadius: tokens.radius.pill,
                borderWidth: 1,
                borderColor: selected ? tokens.color.brand : tokens.color.borderStrong,
                backgroundColor: selected ? tokens.color.brand : tokens.color.bgElevated,
                opacity: pressed ? 0.85 : 1,
              })}
              testID={testID ? `${testID}-${choice}` : undefined}
            >
              <AppText color={selected ? 'textInverse' : 'textPrimary'} align="center">
                {t(THEME_LABELS[choice])}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
