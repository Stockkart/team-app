/**
 * A text-only, non-destructive action (design "Screen inventory": "text link", "text button"):
 * label in `textPrimary`, or in `brand` with `link` (the account screens' links: "Forgot
 * password?", "Create account", "Sign in instead"), drawn 44 dp tall and extended to the 48 dp
 * touch minimum with `hitSlop` (R12.3). Anything destructive is a `DangerButton`.
 */
import { BaseButton, type ButtonProps } from './Button';

export interface TextButtonProps extends ButtonProps {
  /** Draw the label in `brand`, as a link. */
  link?: boolean;
}

export function TextButton({ link = false, ...props }: TextButtonProps) {
  return <BaseButton variant={link ? 'link' : 'text'} {...props} />;
}
