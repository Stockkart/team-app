/**
 * Sizes the component kit is built on (design "Design language", R12.3). Every number here is a
 * dp; the type sizes live in `theme/typography.ts`.
 *
 * `hitSlopFor` is the one rule for touch targets: a control drawn smaller than 48 × 48 dp extends
 * its touch area with `hitSlop` so the target still measures at least 48 dp each way (R12.3).
 */
import type { Insets } from 'react-native';

/** The smallest touch target, each way (R12.3). */
export const MIN_TOUCH = 48;

/** The smallest gap between two adjacent touch targets (R12.3). */
export const TOUCH_GAP = 8;

/** Primary and secondary buttons (design: 56 dp tall, full width). */
export const BUTTON_HEIGHT = 56;

/** The confirm sheet's buttons and the danger text button: drawn at this height, hitSlop fills up. */
export const TEXT_BUTTON_HEIGHT = 44;

/** Form inputs (design: 56 dp). */
export const INPUT_HEIGHT = 56;

/** Module tiles: the large (Attendance) tile is a full-width band, half tiles are squares. */
export const TILE_LARGE_HEIGHT = 96;
export const TILE_HALF_SIZE = 112;

/** Icon size inside a module tile's icon circle. */
export const TILE_ICON_SIZE = 28;

/** The tinted icon circle of a module tile (design "Design language", R12.15). */
export const TILE_ICON_CIRCLE = 48;

/** The `bgElevated` icon circle of a StatusCard and the icon inside it. */
export const STATUS_ICON_CIRCLE = 40;
export const STATUS_ICON_SIZE = 24;

/** A row of a grouped list card (design "Screen inventory": Profile, Complete your profile). */
export const ROW_HEIGHT = 56;
/** The tinted icon circle at the start of a list row and the icon inside it. */
export const ROW_ICON_CIRCLE = 40;
export const ROW_ICON_SIZE = 22;
/** The chevron at the end of a pressable list row. */
export const ROW_CHEVRON_SIZE = 16;

/** The photo picker's preview and the camera badge on its corner (design "Create account"). */
export const PHOTO_PREVIEW_SIZE = 96;
export const PHOTO_BADGE_SIZE = 32;
export const PHOTO_BADGE_ICON_SIZE = 18;

/** The app mark on Sign in: a `brand` circle with an `accent` dot (design "Screen inventory"). */
export const APP_MARK_SIZE = 64;

/** A Chip is a 32 dp pill; its leading icon is 16 dp. It is read-only, so no touch minimum applies. */
export const CHIP_HEIGHT = 32;
export const CHIP_ICON_SIZE = 16;

/** The leading icon of a SecondaryButton. */
export const BUTTON_ICON_SIZE = 20;

/** Screen padding on every side (design: 16 dp). */
export const SCREEN_PADDING = 16;

/**
 * The `hitSlop` that makes a control drawn `width` × `height` dp measure at least `MIN_TOUCH` each
 * way, split evenly between the two sides. A side that is omitted is taken as already wide enough
 * (a full-width button names only its height). `null` when the drawn size already meets the
 * minimum, so React Native receives no insets at all. A non-finite or negative size is treated
 * as `0`.
 */
export function hitSlopFor(size: { width?: number; height?: number }): Insets | null {
  const extraX = size.width === undefined ? 0 : Math.max(0, MIN_TOUCH - clamp(size.width));
  const extraY = size.height === undefined ? 0 : Math.max(0, MIN_TOUCH - clamp(size.height));
  if (extraX === 0 && extraY === 0) {
    return null;
  }
  return {
    left: extraX / 2,
    right: extraX / 2,
    top: extraY / 2,
    bottom: extraY / 2,
  };
}

function clamp(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0;
}
