/**
 * A grouped list (design "Screen inventory": Profile's control list, Complete your profile's plain-
 * word list; R8.1, R8.6, R12.5, R12.15): `ListCard` is one 20 dp card (`radius.card`, light shadow
 * / dark edge) and `ListRow` a 56 dp row inside it. A row has an optional leading icon in a 40 dp
 * tinted circle (`brand` on `brandSoft`; `danger` on `dangerSoft` for a destructive row), a label
 * in `textPrimary` (or `danger`), an optional second line in `textSecondary` (or `danger` for an
 * error notice, announced when it appears), an optional trailing
 * element (a `Chip` badge) and, when it is pressable, a chevron in `textSecondary`. Rows are
 * separated by a `borderDefault` divider (decorative, exempt from the gate).
 *
 * A destructive row (`tone="danger"`) always takes a `confirm` and opens a `ConfirmSheet` before
 * `onPress` runs (R12.5), the way `DangerButton` does; the sheet's test id is `${testID}-sheet`.
 * A pressable row is a `button` to TalkBack and announces "label. line"; a plain row is one `text`
 * element.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type PressableStateCallbackType } from 'react-native';

import { useTheme, type ColorToken } from '../theme';
import { talkbackLabel } from './a11y';
import { AppText } from './AppText';
import { ConfirmSheet } from './ConfirmSheet';
import { Icon, type IconName } from './Icon';
import { ROW_CHEVRON_SIZE, ROW_HEIGHT, ROW_ICON_CIRCLE, ROW_ICON_SIZE } from './layout';
import { elevatedCard } from './surfaces';

export type ListRowTone = 'default' | 'danger';

export interface ListRowConfirm {
  question: string;
  explanation?: string;
  /** The sheet's confirm label; the row's label when omitted. */
  confirmLabel?: string;
  cancelLabel: string;
}

interface ListRowBaseProps {
  label: string;
  /** A second line under the label, in `textSecondary`, or in `danger` for an error notice. */
  line?: string;
  lineTone?: 'secondary' | 'danger';
  /** The leading glyph, in a tinted circle. */
  icon?: IconName;
  /** A badge or value at the end of the row, before the chevron. */
  trailing?: ReactNode;
  /** No divider under this row (the last of its card). */
  last?: boolean;
  /** Taps are ignored and the row dims. */
  disabled?: boolean;
  /** A spinner replaces the chevron. */
  loading?: boolean;
  /** TalkBack text; "label. line" when omitted. */
  accessibilityLabel?: string;
  testID?: string;
}

interface DefaultRowProps extends ListRowBaseProps {
  tone?: 'default';
  onPress?: () => void;
  confirm?: ListRowConfirm;
}

interface DangerRowProps extends ListRowBaseProps {
  tone: 'danger';
  /** Runs after the worker confirms; never on the first tap (R12.5). */
  onPress: () => void;
  confirm: ListRowConfirm;
}

export type ListRowProps = DefaultRowProps | DangerRowProps;

/** The icon and label colour by tone, and the icon circle's tint. */
const TONE_INK: Record<ListRowTone, ColorToken> = { default: 'textPrimary', danger: 'danger' };
const TONE_ICON: Record<ListRowTone, ColorToken> = { default: 'brand', danger: 'danger' };
const TONE_CIRCLE: Record<ListRowTone, ColorToken> = {
  default: 'brandSoft',
  danger: 'dangerSoft',
};

const PRESSED_OPACITY = 0.85;
const INACTIVE_OPACITY = 0.5;

export function ListRow(props: ListRowProps) {
  const {
    label,
    line,
    lineTone = 'secondary',
    icon,
    trailing,
    last = false,
    disabled = false,
    loading = false,
    accessibilityLabel,
    testID,
    onPress,
    confirm,
  } = props;
  const tone: ListRowTone = props.tone ?? 'default';
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const inactive = disabled || loading;

  const press = useCallback(() => {
    if (confirm) {
      setOpen(true);
      return;
    }
    onPress?.();
  }, [confirm, onPress]);
  const close = useCallback(() => setOpen(false), []);
  const confirmed = useCallback(() => {
    setOpen(false);
    onPress?.();
  }, [onPress]);

  const content = (
    <>
      {icon ? (
        <View
          style={{
            width: ROW_ICON_CIRCLE,
            height: ROW_ICON_CIRCLE,
            borderRadius: ROW_ICON_CIRCLE / 2,
            backgroundColor: tokens.color[TONE_CIRCLE[tone]],
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: tokens.space.md,
          }}
          testID={testID ? `${testID}-icon-circle` : undefined}
        >
          <Icon
            name={icon}
            size={ROW_ICON_SIZE}
            color={TONE_ICON[tone]}
            testID={testID ? `${testID}-icon` : undefined}
          />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <AppText color={TONE_INK[tone]} testID={testID ? `${testID}-label` : undefined}>
          {label}
        </AppText>
        {line ? (
          <AppText
            variant="secondary"
            color={lineTone === 'danger' ? 'danger' : 'textSecondary'}
            accessibilityLiveRegion={lineTone === 'danger' ? 'polite' : undefined}
            style={{ marginTop: tokens.space.xs }}
            testID={testID ? `${testID}-line` : undefined}
          >
            {line}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View style={{ marginLeft: tokens.space.sm }}>{trailing}</View> : null}
      {loading ? (
        <View style={{ marginLeft: tokens.space.sm }}>
          <ActivityIndicator color={tokens.color[TONE_INK[tone]]} />
        </View>
      ) : onPress ? (
        <View style={{ marginLeft: tokens.space.sm }}>
          <Icon
            name="chevron"
            size={ROW_CHEVRON_SIZE}
            color="textSecondary"
            testID={testID ? `${testID}-chevron` : undefined}
          />
        </View>
      ) : null}
    </>
  );

  const frame = {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: tokens.color.borderDefault }),
  };
  const name = accessibilityLabel ?? talkbackLabel(label, line);

  if (!onPress) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={name}
        style={frame}
        testID={testID}
      >
        {content}
      </View>
    );
  }

  const face = ({ pressed }: PressableStateCallbackType) => ({
    ...frame,
    opacity: inactive ? INACTIVE_OPACITY : pressed ? PRESSED_OPACITY : 1,
  });

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPress={press}
        style={face}
        testID={testID}
      >
        {content}
      </Pressable>
      {confirm ? (
        <ConfirmSheet
          visible={open}
          question={confirm.question}
          explanation={confirm.explanation}
          confirmLabel={confirm.confirmLabel ?? label}
          cancelLabel={confirm.cancelLabel}
          onConfirm={confirmed}
          onCancel={close}
          testID={testID ? `${testID}-sheet` : undefined}
        />
      ) : null}
    </>
  );
}

export interface ListCardProps {
  children?: ReactNode;
  testID?: string;
}

/** The 20 dp card the rows sit in. Rows have no fill of their own, so nothing needs clipping. */
export function ListCard({ children, testID }: ListCardProps) {
  const { tokens, scheme } = useTheme();
  return (
    <View style={elevatedCard(tokens, scheme)} testID={testID}>
      {children}
    </View>
  );
}
