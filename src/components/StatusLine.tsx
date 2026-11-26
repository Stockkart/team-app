/**
 * The status line of the check-in screen (design "Check-in screen", R7.11, R12.9): one `body` text
 * in `textPrimary` under the clock — "Not checked in yet", "In since 09:12", "Done for today ·
 * 8 h 05 m" or "2 punches waiting to be sent" (`statusLineFor` picks it). Every change is
 * announced to TalkBack (`announceForAccessibility`) and the text is a polite live region, so a
 * punch's effect is heard without moving focus; the first render is not announced (the screen
 * itself is being read then).
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { AppText } from './AppText';

export interface StatusLineProps {
  text: string;
  testID?: string;
}

export function StatusLine({ text, testID }: StatusLineProps) {
  const previous = useRef(text);
  useEffect(() => {
    if (previous.current !== text) {
      previous.current = text;
      AccessibilityInfo.announceForAccessibility(text);
    }
  }, [text]);

  return (
    <AppText
      variant="body"
      color="textPrimary"
      align="center"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      {text}
    </AppText>
  );
}
