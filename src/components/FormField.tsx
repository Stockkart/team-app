/**
 * A labelled input (design "Design language", R12.15): a 56 dp input on `bgElevated` with
 * `radius.field` and a 1 dp `borderStrong` outline (2 dp `brand` while focused, 2 dp `danger` on
 * error), its label in `textSecondary` resting inside the field while it is empty and unfocused and
 * floating into the field's top edge (in `secondary`, cutting the outline) once focused or filled.
 * Under it either the error in `danger` or the helper line in `textSecondary`.
 *
 * The input announces the label to TalkBack and the error or helper as its hint; the error line is
 * a live region so a validation message is read when it appears (R12.9). The text follows the
 * phone's font-size setting like every other text (R12.2). The placeholder, if any, shows only
 * while the label has floated, so the two never overlap.
 */
import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { TEXT_SCALING, typeScale, useTheme } from '../theme';
import { AppText } from './AppText';
import { INPUT_HEIGHT } from './layout';

export interface FormFieldProps
  extends Pick<
    TextInputProps,
    | 'value'
    | 'onChangeText'
    | 'onSubmitEditing'
    | 'onFocus'
    | 'onBlur'
    | 'placeholder'
    | 'keyboardType'
    | 'autoCapitalize'
    | 'autoComplete'
    | 'autoCorrect'
    | 'autoFocus'
    | 'secureTextEntry'
    | 'returnKeyType'
    | 'maxLength'
    | 'editable'
    | 'textContentType'
  > {
  label: string;
  /** Shown under the input in `danger`; replaces the helper while present. */
  error?: string;
  /** Shown under the input in `textSecondary` when there is no error. */
  helper?: string;
  testID?: string;
}

/** Outline widths: resting, and focused / error. */
const OUTLINE = 1;
const OUTLINE_ACTIVE = 2;

/** Where the floated label sits: half its line height above the field's top edge. */
const FLOAT_INSET = typeScale.secondary.lineHeight / 2;

/** Whether the label floats into the top edge: focused, or holding text (design "Design language"). */
export function labelFloats(focused: boolean, value: string | undefined): boolean {
  return focused || (value !== undefined && value.length > 0);
}

export function FormField({
  label,
  error,
  helper,
  testID,
  editable = true,
  placeholder,
  onFocus,
  onBlur,
  value,
  ...input
}: FormFieldProps) {
  const { tokens } = useTheme();
  const [focused, setFocused] = useState(false);
  const under = error ?? helper;
  const floating = labelFloats(focused, value);
  const outlineColor = error
    ? tokens.color.danger
    : focused
    ? tokens.color.brand
    : tokens.color.borderStrong;
  const outlineWidth = error || focused ? OUTLINE_ACTIVE : OUTLINE;

  return (
    <View style={{ marginBottom: tokens.space.md, paddingTop: FLOAT_INSET }} testID={testID}>
      <View style={{ position: 'relative' }}>
        <TextInput
          {...TEXT_SCALING}
          {...input}
          value={value}
          editable={editable}
          placeholder={floating ? placeholder : undefined}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          accessibilityLabel={label}
          accessibilityHint={under}
          accessibilityState={{ disabled: !editable }}
          placeholderTextColor={tokens.color.textMuted}
          style={{
            minHeight: INPUT_HEIGHT,
            paddingHorizontal: tokens.space.md,
            borderWidth: outlineWidth,
            borderColor: outlineColor,
            borderRadius: tokens.radius.field,
            backgroundColor: tokens.color.bgElevated,
            color: tokens.color.textPrimary,
            fontSize: typeScale.body.fontSize,
            fontFamily: typeScale.body.fontFamily,
            opacity: editable ? 1 : 0.6,
          }}
          testID={testID ? `${testID}-input` : undefined}
        />
        {/* The visible label; TalkBack reads the input's accessibilityLabel instead. */}
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={
            floating
              ? {
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: -FLOAT_INSET,
                  left: tokens.space.md - tokens.space.xs,
                  paddingHorizontal: tokens.space.xs,
                  backgroundColor: tokens.color.bgElevated,
                }
              : {
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: (INPUT_HEIGHT - typeScale.body.lineHeight) / 2,
                  left: tokens.space.md,
                }
          }
          testID={testID ? `${testID}-label` : undefined}
        >
          <AppText variant={floating ? 'secondary' : 'body'} color="textSecondary">
            {label}
          </AppText>
        </View>
      </View>
      {error ? (
        <AppText
          variant="secondary"
          color="danger"
          accessibilityLiveRegion="polite"
          style={{ marginTop: tokens.space.xs }}
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </AppText>
      ) : helper ? (
        <AppText
          variant="secondary"
          color="textSecondary"
          style={{ marginTop: tokens.space.xs }}
          testID={testID ? `${testID}-helper` : undefined}
        >
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}
