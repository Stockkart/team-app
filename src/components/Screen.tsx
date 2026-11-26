/**
 * The frame every screen draws in (design "Design language"): the safe area, `bgCanvas`, 16 dp
 * padding, an optional title (`title` role, a TalkBack header), the content (scrolling when
 * `scroll` is set, so a form stays reachable with the keyboard up) and one `footer` slot pinned to
 * the bottom for the screen's primary button (R12.5).
 *
 * `header` is a full-bleed slot above the padded body for a band that sits flush with the status
 * bar (Home's `GradientHeader`, R12.16): it is drawn edge to edge and carries the top inset
 * itself, so the body below it keeps only its 16 dp padding. Scrolling content fills at least the
 * viewport (`flexGrow`), so a screen may centre a child with `flex: 1` (Waiting's card) and still
 * scroll when the text grows past the window (R12.2).
 */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { AppText } from './AppText';
import { SCREEN_PADDING } from './layout';

export interface ScreenProps {
  title?: string;
  /** Content scrolls (forms, lists). Off by default so a fixed layout cannot scroll by accident. */
  scroll?: boolean;
  /** A full-bleed band above the body, flush with the status bar (it adds the top inset itself). */
  header?: ReactNode;
  /** The primary button slot, pinned to the bottom above the safe area. */
  footer?: ReactNode;
  testID?: string;
  children?: ReactNode;
}

export function Screen({ title, scroll = false, header, footer, testID, children }: ScreenProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: header ? SCREEN_PADDING : insets.top + SCREEN_PADDING,
    paddingLeft: insets.left + SCREEN_PADDING,
    paddingRight: insets.right + SCREEN_PADDING,
  };
  const heading = title ? (
    <AppText variant="title" accessibilityRole="header" style={{ marginBottom: tokens.space.md }}>
      {title}
    </AppText>
  ) : null;

  const body = header ? (
    <>
      {header}
      <View style={[styles.body, padding]} testID={testID ? `${testID}-body` : undefined}>
        {heading}
        {children}
      </View>
    </>
  ) : (
    <>
      {heading}
      {children}
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: tokens.color.bgCanvas }]} testID={testID}>
      {scroll ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            styles.grow,
            header ? null : padding,
            { paddingBottom: SCREEN_PADDING },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={[styles.body, header ? null : padding]}>{body}</View>
      )}
      {footer ? (
        <View
          style={{
            paddingLeft: insets.left + SCREEN_PADDING,
            paddingRight: insets.right + SCREEN_PADDING,
            paddingTop: tokens.space.sm,
            paddingBottom: insets.bottom + SCREEN_PADDING,
          }}
          testID={testID ? `${testID}-footer` : undefined}
        >
          {footer}
        </View>
      ) : (
        <View style={{ height: insets.bottom }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  grow: { flexGrow: 1 },
});
