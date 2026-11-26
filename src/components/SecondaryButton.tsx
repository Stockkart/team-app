/**
 * Any non-primary, non-destructive action: a pill (`radius.pill`) on `bgElevated` with a 1 dp
 * `borderStrong` outline, label in `textPrimary`, optional leading `icon`, 56 dp tall, full width
 * (design "Design language").
 */
import { BaseButton, type ButtonProps } from './Button';

export type SecondaryButtonProps = ButtonProps;

export function SecondaryButton(props: SecondaryButtonProps) {
  return <BaseButton variant="secondary" {...props} />;
}
