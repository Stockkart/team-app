/**
 * The kit's icons, drawn with plain views so the app needs no icon font and no extra native
 * dependency (`@expo/vector-icons` is not resolvable from this package under pnpm). The module
 * glyphs `fingerprint` (three nested rings), `history` (a clock face), `person` (head and
 * shoulders) and `unknown` (a ring with a dot) sit on the Home tiles; `bell` leads a Banner;
 * `info`, `check`, `warning` and `cross` lead a StatusCard or Chip by tone. The screens of the
 * redesign (task 20.3) add `store` (the Join result card), `hourglass` (Waiting), `camera` (the
 * photo picker's badge), `chevron` (list rows), `document` and `lock` (Complete your profile),
 * `arrowIn` and `arrowOut` (History rows). Each is `size` dp square in the colour token given
 * (`brand` by default; `contrast.test.ts` measures every token pair an icon is drawn in, 3:1).
 *
 * Icons are decoration: the tile, card or chip that holds one carries the TalkBack label, so the
 * glyph itself is hidden from accessibility.
 */
import { View } from 'react-native';

import { useTheme, type ColorToken } from '../theme';

export type IconName =
  | 'fingerprint'
  | 'history'
  | 'person'
  | 'unknown'
  | 'bell'
  | 'info'
  | 'check'
  | 'warning'
  | 'cross'
  | 'store'
  | 'hourglass'
  | 'camera'
  | 'chevron'
  | 'document'
  | 'lock'
  | 'arrowIn'
  | 'arrowOut';

export const ICON_NAMES: readonly IconName[] = [
  'fingerprint',
  'history',
  'person',
  'unknown',
  'bell',
  'info',
  'check',
  'warning',
  'cross',
  'store',
  'hourglass',
  'camera',
  'chevron',
  'document',
  'lock',
  'arrowIn',
  'arrowOut',
];

export interface IconProps {
  name: IconName;
  size: number;
  color?: ColorToken;
  testID?: string;
}

export function Icon({ name, size, color = 'brand', testID }: IconProps) {
  const { tokens } = useTheme();
  const stroke = Math.max(2, Math.round(size / 14));
  const paint = tokens.color[color];
  const ring = (diameter: number) => ({
    position: 'absolute' as const,
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
    borderWidth: stroke,
    borderColor: paint,
  });
  const dot = (diameter: number) => ({
    position: 'absolute' as const,
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
    backgroundColor: paint,
  });
  /** A vertical bar `length` dp tall, centred horizontally, its top at `top`. */
  const bar = (length: number, top: number) => ({
    position: 'absolute' as const,
    width: stroke,
    height: length,
    backgroundColor: paint,
    top,
    left: size / 2 - stroke / 2,
  });
  /** A horizontal bar `length` dp wide, its left edge at `left`, vertically centred at `centreY`. */
  const hbar = (length: number, left: number, centreY: number) => ({
    position: 'absolute' as const,
    width: length,
    height: stroke,
    backgroundColor: paint,
    top: centreY - stroke / 2,
    left,
  });
  /** An outlined box `width` × `height` with its top-left corner at (`left`, `top`). */
  const frame = (width: number, height: number, left: number, top: number, radius = stroke) => ({
    position: 'absolute' as const,
    width,
    height,
    left,
    top,
    borderWidth: stroke,
    borderColor: paint,
    borderRadius: radius,
  });
  /** A chevron pointing right (`rotate` turns it), `span` dp across its diagonal. */
  const chevron = (span: number, left: number, centreY: number, rotate = '45deg') => ({
    position: 'absolute' as const,
    width: span,
    height: span,
    left,
    top: centreY - span / 2,
    borderTopWidth: stroke,
    borderRightWidth: stroke,
    borderColor: paint,
    transform: [{ rotate }],
  });
  const box = {
    width: size,
    height: size,
    alignItems: 'center',
    justifyContent: 'center',
  } as const;

  let glyph;
  switch (name) {
    case 'fingerprint':
      glyph = (
        <>
          <View style={ring(size)} />
          <View style={ring(size * 0.64)} />
          <View style={ring(size * 0.28)} />
        </>
      );
      break;
    case 'history':
      glyph = (
        <>
          <View style={ring(size)} />
          {/* hour hand up, minute hand right */}
          <View style={bar(size * 0.3, size * 0.2)} />
          <View
            style={{
              position: 'absolute',
              width: size * 0.25,
              height: stroke,
              backgroundColor: paint,
              top: size / 2 - stroke / 2,
              left: size / 2 - stroke / 2,
            }}
          />
        </>
      );
      break;
    case 'person':
      glyph = (
        <>
          <View style={{ ...ring(size * 0.4), top: 0 }} />
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              width: size * 0.85,
              height: size * 0.45,
              borderTopLeftRadius: size * 0.45,
              borderTopRightRadius: size * 0.45,
              borderWidth: stroke,
              borderBottomWidth: 0,
              borderColor: paint,
            }}
          />
        </>
      );
      break;
    case 'unknown':
      glyph = (
        <>
          <View style={ring(size)} />
          <View style={dot(size * 0.22)} />
        </>
      );
      break;
    case 'bell':
      glyph = (
        <>
          {/* the dome, open at the bottom */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.1,
              width: size * 0.64,
              height: size * 0.6,
              borderTopLeftRadius: size * 0.32,
              borderTopRightRadius: size * 0.32,
              borderWidth: stroke,
              borderBottomWidth: 0,
              borderColor: paint,
            }}
          />
          {/* the rim */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.7 - stroke / 2,
              width: size * 0.84,
              height: stroke,
              backgroundColor: paint,
            }}
          />
          {/* the clapper */}
          <View style={{ ...dot(size * 0.18), top: size * 0.78 }} />
        </>
      );
      break;
    case 'info':
      glyph = (
        <>
          <View style={ring(size)} />
          <View style={{ ...dot(stroke * 1.5), top: size * 0.24 }} />
          <View style={bar(size * 0.3, size * 0.44)} />
        </>
      );
      break;
    case 'warning':
      glyph = (
        <>
          <View style={ring(size)} />
          <View style={bar(size * 0.3, size * 0.24)} />
          <View style={{ ...dot(stroke * 1.5), top: size * 0.64 }} />
        </>
      );
      break;
    case 'check':
      glyph = (
        <View
          style={{
            position: 'absolute',
            top: size * 0.12,
            width: size * 0.34,
            height: size * 0.6,
            borderBottomWidth: stroke,
            borderRightWidth: stroke,
            borderColor: paint,
            transform: [{ rotate: '45deg' }],
          }}
        />
      );
      break;
    case 'cross':
      glyph = (
        <>
          <View style={{ ...bar(size * 0.7, size * 0.15), transform: [{ rotate: '45deg' }] }} />
          <View style={{ ...bar(size * 0.7, size * 0.15), transform: [{ rotate: '-45deg' }] }} />
        </>
      );
      break;
    case 'store':
      glyph = (
        <>
          {/* the awning */}
          <View style={hbar(size * 0.9, size * 0.05, size * 0.22)} />
          {/* the shop front, open at the top */}
          <View
            style={{
              ...frame(size * 0.76, size * 0.6, size * 0.12, size * 0.3, 0),
              borderTopWidth: 0,
            }}
          />
          {/* the door */}
          <View style={bar(size * 0.3, size * 0.6)} />
        </>
      );
      break;
    case 'hourglass':
      glyph = (
        <>
          <View style={hbar(size * 0.6, size * 0.2, size * 0.1)} />
          <View style={hbar(size * 0.6, size * 0.2, size * 0.9)} />
          {/* the two bulbs, drawn as rotated squares that meet in the middle */}
          <View style={chevron(size * 0.38, size * 0.31, size * 0.3, '135deg')} />
          <View style={chevron(size * 0.38, size * 0.31, size * 0.7, '-45deg')} />
          {/* the sand */}
          <View style={{ ...dot(stroke * 1.5), top: size * 0.68 }} />
        </>
      );
      break;
    case 'camera':
      glyph = (
        <>
          <View style={frame(size * 0.9, size * 0.62, size * 0.05, size * 0.26, size * 0.12)} />
          {/* the viewfinder bump */}
          <View style={hbar(size * 0.3, size * 0.3, size * 0.16)} />
          {/* the lens */}
          <View style={{ ...ring(size * 0.34), top: size * 0.4 }} />
        </>
      );
      break;
    case 'chevron':
      glyph = <View style={chevron(size * 0.45, size * 0.12, size / 2)} />;
      break;
    case 'document':
      glyph = (
        <>
          <View style={frame(size * 0.7, size * 0.9, size * 0.15, size * 0.05, size * 0.1)} />
          <View style={hbar(size * 0.4, size * 0.3, size * 0.38)} />
          <View style={hbar(size * 0.4, size * 0.3, size * 0.56)} />
          <View style={hbar(size * 0.26, size * 0.3, size * 0.74)} />
        </>
      );
      break;
    case 'lock':
      glyph = (
        <>
          {/* the shackle */}
          <View
            style={{
              ...frame(size * 0.5, size * 0.5, size * 0.25, size * 0.04, size * 0.25),
              borderBottomWidth: 0,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
            }}
          />
          {/* the body */}
          <View style={frame(size * 0.76, size * 0.5, size * 0.12, size * 0.46, size * 0.1)} />
          <View style={{ ...dot(stroke * 1.5), top: size * 0.64 }} />
        </>
      );
      break;
    case 'arrowIn':
      glyph = (
        <>
          {/* the arrow into the door */}
          <View style={hbar(size * 0.52, size * 0.06, size / 2)} />
          <View style={chevron(size * 0.3, size * 0.3, size / 2)} />
          {/* the door frame on the right */}
          <View
            style={{
              ...frame(size * 0.26, size * 0.86, size * 0.68, size * 0.07, 0),
              borderLeftWidth: 0,
            }}
          />
        </>
      );
      break;
    case 'arrowOut':
      glyph = (
        <>
          {/* the door frame on the left */}
          <View
            style={{
              ...frame(size * 0.26, size * 0.86, size * 0.06, size * 0.07, 0),
              borderRightWidth: 0,
            }}
          />
          {/* the arrow out of it */}
          <View style={hbar(size * 0.52, size * 0.42, size / 2)} />
          <View style={chevron(size * 0.3, size * 0.56, size / 2)} />
        </>
      );
      break;
  }

  return (
    <View
      style={box}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID={testID}
    >
      {glyph}
    </View>
  );
}
