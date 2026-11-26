/**
 * The screen's one primary action (R12.5): a pill (`radius.pill`) filled `brand`, label in
 * `buttonPrimary` / `textInverse`, 56 dp tall, full width; disabled it turns `bgMuted` with a
 * `textSecondary` label. Exactly one per screen (`primaryButtonCount.test.tsx` renders every
 * screen and counts; `PunchButton` is not counted). Use `SecondaryButton` for everything else and
 * `DangerButton` for anything destructive.
 */
import { BaseButton, type ButtonProps } from './Button';

export type PrimaryButtonProps = ButtonProps;

export function PrimaryButton(props: PrimaryButtonProps) {
  return <BaseButton variant="primary" {...props} />;
}
