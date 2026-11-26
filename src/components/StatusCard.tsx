/**
 * A card that states where the worker is (design "Design language", R12.15): a leading icon, a
 * title, one line under it and an optional action slot. `radius.card`; the background is tinted
 * by `tone` (`bgElevated` for neutral, else the tone's soft token), with no border in the light
 * theme and a 1 dp `borderDefault` edge in the dark one. The icon (24 dp, `icon` or the tone's
 * default) is drawn in the tone colour inside a 40 dp `bgElevated` circle, so the tone shows in
 * the tint and the icon (3:1) while the title stays `textPrimary` and the line `textSecondary`
 * (4.5:1 on every tint, `contrast.test.ts`). The neutral card, having no tone colour, draws a
 * `brand` icon on a `brandSoft` circle. TalkBack reads the card as one element: "title. line".
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme, type ColorToken } from '../theme';
import { talkbackLabel } from './a11y';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { STATUS_ICON_CIRCLE, STATUS_ICON_SIZE } from './layout';
import { cardFrame } from './surfaces';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface StatusCardProps {
  title: string;
  line?: string;
  tone?: StatusTone;
  /** The leading glyph; the tone's default when omitted. */
  icon?: IconName;
  /** A button or link under the text; the kit does not decide which. */
  action?: ReactNode;
  testID?: string;
}

/** The card's background by tone. */
const TONE_TINT: Record<StatusTone, ColorToken> = {
  neutral: 'bgElevated',
  success: 'successSoft',
  warning: 'warningSoft',
  danger: 'dangerSoft',
};

/** The icon colour by tone. */
const TONE_ICON: Record<StatusTone, ColorToken> = {
  neutral: 'brand',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/** The circle behind the icon: `bgElevated` on a tint; `brandSoft` on the neutral (elevated) card. */
const TONE_CIRCLE: Record<StatusTone, ColorToken> = {
  neutral: 'brandSoft',
  success: 'bgElevated',
  warning: 'bgElevated',
  danger: 'bgElevated',
};

const TONE_GLYPH: Record<StatusTone, IconName> = {
  neutral: 'info',
  success: 'check',
  warning: 'warning',
  danger: 'cross',
};

/** "title. line" for TalkBack; the title alone when there is no line. */
export function statusCardLabel(title: string, line?: string): string {
  return talkbackLabel(title, line);
}

export function StatusCard({
  title,
  line,
  tone = 'neutral',
  icon,
  action,
  testID,
}: StatusCardProps) {
  const { tokens, scheme } = useTheme();
  return (
    <View
      style={{
        ...cardFrame(tokens, scheme),
        backgroundColor: tokens.color[TONE_TINT[tone]],
        padding: tokens.space.md,
      }}
      testID={testID}
    >
      {/* The text is one TalkBack element; the action stays a separate, focusable control. */}
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={statusCardLabel(title, line)}
        style={{ flexDirection: 'row', alignItems: 'flex-start' }}
      >
        <View
          style={{
            width: STATUS_ICON_CIRCLE,
            height: STATUS_ICON_CIRCLE,
            borderRadius: STATUS_ICON_CIRCLE / 2,
            backgroundColor: tokens.color[TONE_CIRCLE[tone]],
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: tokens.space.md,
          }}
          testID={testID ? `${testID}-icon-circle` : undefined}
        >
          <Icon
            name={icon ?? TONE_GLYPH[tone]}
            size={STATUS_ICON_SIZE}
            color={TONE_ICON[tone]}
            testID={testID ? `${testID}-icon` : undefined}
          />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="heading" color="textPrimary">
            {title}
          </AppText>
          {line ? (
            <AppText color="textSecondary" style={{ marginTop: tokens.space.xs }}>
              {line}
            </AppText>
          ) : null}
        </View>
      </View>
      {action ? <View style={{ marginTop: tokens.space.md }}>{action}</View> : null}
    </View>
  );
}
