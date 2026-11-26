import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import type { Confirm } from '../app/useAppState';
import { TOKENS } from '../theme';
import { BUTTON_HEIGHT } from './layout';
import { useConfirmSheet } from './useConfirmSheet';

afterEach(cleanup);

const PROMPT = {
  question: 'Switch account?',
  explanation: '2 punches that were not yet sent will be lost',
  confirmLabel: 'Switch account',
  cancelLabel: 'Cancel',
};

/** Mounts the hook and hands its `confirm` out. */
function Host({ expose }: { expose: (confirm: Confirm) => void }) {
  const { confirm, sheet } = useConfirmSheet('sheet');
  expose(confirm);
  return sheet;
}

function mount() {
  let confirm: Confirm | null = null;
  const view = renderThemed(
    <Host
      expose={(fn) => {
        confirm = fn;
      }}
    />,
  );
  const ask = (prompt = PROMPT) => {
    let promise: Promise<boolean> | null = null;
    act(() => {
      promise = (confirm as Confirm | null)?.(prompt) ?? null;
    });
    if (promise == null) {
      throw new Error('confirm not exposed');
    }
    return promise;
  };
  return { ...view, ask };
}

describe('useConfirmSheet (R12.5; ShellActions.confirm)', () => {
  it('is closed until asked, then shows the prompt and resolves true on confirm', async () => {
    const h = mount();
    expect(screen.queryByTestId('sheet')).toBeNull();

    const answer = h.ask();
    expect(screen.getByRole('heading').textContent).toBe(PROMPT.question);
    expect(screen.getByText(PROMPT.explanation)).toBeTruthy();
    expect(screen.getByTestId('sheet-confirm').getAttribute('aria-label')).toBe(
      PROMPT.confirmLabel,
    );
    expect(screen.getByTestId('sheet-cancel').getAttribute('aria-label')).toBe(PROMPT.cancelLabel);

    fireEvent.click(screen.getByTestId('sheet-confirm'));
    expect(await answer).toBe(true);
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('draws the kit sheet: bgElevated panel with 20 dp top corners, danger confirm pill, outlined cancel', () => {
    const h = mount();
    void h.ask();
    const panel = styleOf(screen.getByTestId('sheet-panel'));
    expect(tokenNameOf(TOKENS.light, panel.backgroundColor)).toContain('bgElevated');
    expect(radiusNameOf(TOKENS.light, panel.borderTopLeftRadius)).toContain('card');
    const confirm = styleOf(screen.getByTestId('sheet-confirm'));
    expect(confirm.minHeight).toBe(BUTTON_HEIGHT);
    expect(radiusNameOf(TOKENS.light, confirm.borderRadius)).toContain('pill');
    expect(tokenNameOf(TOKENS.light, confirm.backgroundColor)).toContain('danger');
    expect(
      tokenNameOf(TOKENS.light, styleOf(screen.getByText(PROMPT.confirmLabel)).color),
    ).toContain('textInverse');
    const cancel = styleOf(screen.getByTestId('sheet-cancel'));
    expect(tokenNameOf(TOKENS.light, cancel.borderColor)).toContain('borderStrong');
    expect(screen.getByTestId('sheet-confirm').getAttribute('role')).toBe('button');
    expect(screen.getByTestId('sheet-cancel').getAttribute('role')).toBe('button');
    fireEvent.click(screen.getByTestId('sheet-cancel'));
  });

  it('resolves false on cancel and on the backdrop', async () => {
    const h = mount();
    const first = h.ask();
    fireEvent.click(screen.getByTestId('sheet-cancel'));
    expect(await first).toBe(false);

    const second = h.ask();
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(await second).toBe(false);
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('a second question replaces the first, which is answered no', async () => {
    const h = mount();
    const first = h.ask();
    const second = h.ask({ ...PROMPT, question: 'Really?' });
    expect(await first).toBe(false);
    expect(screen.getByRole('heading').textContent).toBe('Really?');
    fireEvent.click(screen.getByTestId('sheet-confirm'));
    expect(await second).toBe(true);
  });

  it('unmounting with a question open answers it no, so no caller waits forever', async () => {
    const h = mount();
    const answer = h.ask();
    h.unmount();
    expect(await answer).toBe(false);
  });
});
