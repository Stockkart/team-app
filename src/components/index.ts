/**
 * The Stockkart Team app's component kit (design "Design language", DD15; R10.1, R12.3, R12.5, R12.6,
 * R12.9, R12.14–R12.16), violet & peach (D14). Every component reads colours through `useTheme()`
 * (no colour literal outside `theme/tokens.ts`), spreads `TEXT_SCALING` on its text, carries an
 * `accessibilityRole` and an `accessibilityLabel`, and, when tappable, measures at least
 * 48 × 48 dp to the touch (`layout.ts`). Cards follow `surfaces.ts` (20 dp radius, light shadow /
 * dark edge); buttons are pills; `GradientHeader` is the one place `expo-linear-gradient` is used;
 * `PunchButton`, `LiveClock`, `StatusLine` and `TodayCard` are the check-in screen's parts (DD17).
 */
export { talkbackLabel } from './a11y';
export { AppMark, type AppMarkProps } from './AppMark';
export { AppText, type AppTextProps } from './AppText';
export { Avatar, initialOf, type AvatarProps, type AvatarVariant } from './Avatar';
export {
  Banner,
  formatBanners,
  MAX_BANNERS,
  moreLine,
  type BannerItem,
  type BannerProps,
  type FormattedBanners,
} from './Banner';
export type { ButtonProps, ButtonVariant } from './Button';
export { Chip, type ChipProps, type ChipTone } from './Chip';
export { ConfirmSheet, type ConfirmSheetProps } from './ConfirmSheet';
export { DangerButton, type DangerButtonProps } from './DangerButton';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { FormField, labelFloats, type FormFieldProps } from './FormField';
export {
  GRADIENT_END,
  GRADIENT_START,
  GradientHeader,
  type GradientHeaderProps,
} from './GradientHeader';
export { Icon, ICON_NAMES, type IconName, type IconProps } from './Icon';
export {
  APP_MARK_SIZE,
  BUTTON_HEIGHT,
  BUTTON_ICON_SIZE,
  CHIP_HEIGHT,
  CHIP_ICON_SIZE,
  hitSlopFor,
  INPUT_HEIGHT,
  MIN_TOUCH,
  PHOTO_BADGE_ICON_SIZE,
  PHOTO_BADGE_SIZE,
  PHOTO_PREVIEW_SIZE,
  ROW_CHEVRON_SIZE,
  ROW_HEIGHT,
  ROW_ICON_CIRCLE,
  ROW_ICON_SIZE,
  SCREEN_PADDING,
  STATUS_ICON_CIRCLE,
  STATUS_ICON_SIZE,
  TEXT_BUTTON_HEIGHT,
  TILE_HALF_SIZE,
  TILE_ICON_CIRCLE,
  TILE_ICON_SIZE,
  TILE_LARGE_HEIGHT,
  TOUCH_GAP,
} from './layout';
export {
  ListCard,
  ListRow,
  type ListCardProps,
  type ListRowConfirm,
  type ListRowProps,
  type ListRowTone,
} from './ListRow';
export {
  CLOCK_TICK_MS,
  CLOCK_TICK_REDUCED_MS,
  clockIntervalMs,
  LiveClock,
  type LiveClockProps,
} from './LiveClock';
export {
  ModuleTile,
  moduleTileLabel,
  UPDATE_APP_TEXT,
  type ModuleTileProps,
  type ModuleTileSize,
  type ModuleTileTint,
} from './ModuleTile';
export { PrimaryButton, type PrimaryButtonProps } from './PrimaryButton';
export {
  PUNCH_DIAMETER,
  PUNCH_MAX_WIDTH_SHARE,
  PUNCH_MIN_DIAMETER,
  punchButtonDiameter,
  PunchButton,
  RING_SCALE,
  type PunchButtonProps,
} from './PunchButton';
export { Screen, type ScreenProps } from './Screen';
export { SecondaryButton, type SecondaryButtonProps } from './SecondaryButton';
export { StatusCard, statusCardLabel, type StatusCardProps, type StatusTone } from './StatusCard';
export { StatusLine, type StatusLineProps } from './StatusLine';
export { cardFrame, elevatedCard } from './surfaces';
export { TextButton, type TextButtonProps } from './TextButton';
export { TodayCard, type TodayCardProps } from './TodayCard';
export { useConfirmSheet, type UseConfirmSheet } from './useConfirmSheet';
