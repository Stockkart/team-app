/**
 * The worker's photo or, without one, their initial on a disc (design "Design language"): the
 * `brand` variant draws the initial in `textInverse` on `brand`; the `onSoft` variant (for the
 * Home gradient band and the Profile header card) draws it in `brand` on `brandSoft`. The photo is
 * served only behind the Bearer token (R11.5), so it is loaded with the request headers the caller
 * supplies: `source={{ uri, headers }}`; the URL is never fetched bare. TalkBack reads the avatar
 * as an image named after the person.
 */
import { Image, View } from 'react-native';

import { fontFamily, useTheme, type ColorToken } from '../theme';
import { AppText } from './AppText';

export type AvatarVariant = 'brand' | 'onSoft';

export interface AvatarProps {
  /** The authenticated photo URL; omitted → initial. */
  uri?: string;
  /** Request headers for the photo, normally `{ Authorization: 'Bearer …' }`. */
  headers?: Record<string, string>;
  name: string;
  /** Diameter in dp. */
  size: number;
  /** The initial's disc: `brand` (default) or `onSoft` (`brand` initial on `brandSoft`). */
  variant?: AvatarVariant;
  /** TalkBack text; `name` when omitted. For a preview with no name yet (R12.9, R12.11). */
  accessibilityLabel?: string;
  testID?: string;
}

/** The disc and the initial colours of each variant (pairs measured by `contrast.test.ts`). */
const DISC: Record<AvatarVariant, { fill: ColorToken; initial: ColorToken }> = {
  brand: { fill: 'brand', initial: 'textInverse' },
  onSoft: { fill: 'brandSoft', initial: 'brand' },
};

/** The first letter of the first word, upper-cased; `?` for an empty or blank name. */
export function initialOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const letter = Array.from(first)[0];
  return letter ? letter.toLocaleUpperCase() : '?';
}

export function Avatar({
  uri,
  headers,
  name,
  size,
  variant = 'brand',
  accessibilityLabel,
  testID,
}: AvatarProps) {
  const { tokens } = useTheme();
  const shape = { width: size, height: size, borderRadius: size / 2 };
  const label = accessibilityLabel ?? name;
  if (uri) {
    return (
      <Image
        accessibilityRole="image"
        accessibilityLabel={label}
        source={{ uri, headers }}
        style={[shape, { backgroundColor: tokens.color.bgMuted }]}
        testID={testID}
      />
    );
  }
  const disc = DISC[variant];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[
        shape,
        {
          backgroundColor: tokens.color[disc.fill],
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
      testID={testID}
    >
      <AppText
        color={disc.initial}
        style={{ fontSize: size * 0.45, lineHeight: size * 0.5, fontFamily: fontFamily.semiBold }}
      >
        {initialOf(name)}
      </AppText>
    </View>
  );
}
