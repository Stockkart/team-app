/**
 * A destructive action (Remove this phone, Leave this shop, Log out, Withdraw request): a text
 * button in `danger` that always opens a `ConfirmSheet` first and calls `onConfirm` only when the
 * worker confirms (R12.5). The sheet's confirm button repeats the action's label; cancel is always
 * offered. The button is drawn 44 dp tall and extends its touch area to 48 dp (R12.3).
 */
import { useCallback, useState } from 'react';

import { BaseButton, type ButtonProps } from './Button';
import { ConfirmSheet } from './ConfirmSheet';

export interface DangerButtonProps extends Omit<ButtonProps, 'onPress'> {
  /** Runs after the worker confirms; never on the first tap. */
  onConfirm: () => void;
  /** The question in the sheet, e.g. "Leave Sri Ganesh Stores?". */
  question: string;
  /** One sentence under the question, e.g. "Your attendance here will stop today." */
  explanation?: string;
  /** The sheet's confirm label; `label` when omitted. */
  confirmLabel?: string;
  cancelLabel: string;
}

export function DangerButton({
  onConfirm,
  question,
  explanation,
  confirmLabel,
  cancelLabel,
  label,
  testID,
  ...button
}: DangerButtonProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const confirm = useCallback(() => {
    setOpen(false);
    onConfirm();
  }, [onConfirm]);

  return (
    <>
      <BaseButton
        variant="dangerText"
        label={label}
        onPress={() => setOpen(true)}
        testID={testID}
        {...button}
      />
      <ConfirmSheet
        visible={open}
        question={question}
        explanation={explanation}
        confirmLabel={confirmLabel ?? label}
        cancelLabel={cancelLabel}
        onConfirm={confirm}
        onCancel={close}
        testID={testID ? `${testID}-sheet` : undefined}
      />
    </>
  );
}
