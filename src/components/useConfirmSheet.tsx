/**
 * The shell's confirm sheet (R12.5): one `ConfirmSheet` the navigator mounts above every screen,
 * driven by a promise. `confirm(prompt)` opens it and resolves `true` on confirm, `false` on cancel
 * (the cancel button, the backdrop, hardware back) or when a second question replaces the first or
 * the host unmounts. It is `ShellActions.confirm`, the way a flow with no screen of its own (the
 * account switch, `src/account/switchAccount.ts`) asks the worker a question.
 *
 * `DangerButton` stays the right tool for a destructive action that has a button on a screen; this
 * hook is for questions asked from code that runs between screens.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import type { Confirm, ConfirmPrompt } from '../app/useAppState';
import { ConfirmSheet } from './ConfirmSheet';

interface Pending {
  prompt: ConfirmPrompt;
  resolve: (answer: boolean) => void;
}

export interface UseConfirmSheet {
  confirm: Confirm;
  /** Render this once, anywhere in the tree (it is a `Modal`). */
  sheet: ReactElement;
}

export function useConfirmSheet(testID = 'shell-confirm'): UseConfirmSheet {
  const [pending, setPending] = useState<Pending | null>(null);
  // The ref is the source of truth (callbacks read it without a re-render); the state only draws.
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback<Confirm>(
    (prompt) =>
      new Promise<boolean>((resolve) => {
        // A question asked while another is open replaces it; the first is answered "no".
        pendingRef.current?.resolve(false);
        const next: Pending = { prompt, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  const settle = useCallback((answer: boolean) => {
    const current = pendingRef.current;
    if (current == null) {
      return;
    }
    pendingRef.current = null;
    setPending(null);
    current.resolve(answer);
  }, []);

  // Unmounting with a question open answers it "no", so no caller waits forever.
  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
    },
    [],
  );

  const sheet = (
    <ConfirmSheet
      visible={pending != null}
      question={pending?.prompt.question ?? ''}
      explanation={pending?.prompt.explanation}
      confirmLabel={pending?.prompt.confirmLabel ?? ''}
      cancelLabel={pending?.prompt.cancelLabel ?? ''}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
      testID={testID}
    />
  );

  return { confirm, sheet };
}
