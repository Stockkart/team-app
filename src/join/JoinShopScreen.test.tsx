import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TOO_MANY_ATTEMPTS_WORKER, WORKER_SERVER_MESSAGES } from '@stockkart/attendance-protocol';

import { harness, PROFILE, SHOP, SHOP_2, type Harness } from '../../test-support/join-harness';
import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { NotAuthenticated, NotReachable, ServerRefusal } from '../api/transport';
import { inferAccountErrorCode } from '../api/accountClient';
import { STRINGS_EN, t } from '../i18n';
import type { StoredWorkerState } from '../state/authStore';
import { TOKENS, type ColorScheme } from '../theme';
import { JoinShopScreen, showsOutcome } from './JoinShopScreen';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(cleanup);

const NO_SHOP: StoredWorkerState = { state: 'NO_SHOP', modules: [] };

const REJECTED: StoredWorkerState = {
  ...NO_SHOP,
  lastOutcome: {
    id: 'o1',
    status: 'REJECTED',
    shopName: 'Sri Ganesh Stores',
    reason: 'Ask Ramesh to add you',
    decidedAt: '2025-05-11T10:00:00Z',
  },
};

function refusal(status: number, message: string): ServerRefusal {
  return new ServerRefusal(status, message, inferAccountErrorCode);
}

function renderJoin(h: Harness, state: StoredWorkerState = NO_SHOP, scheme: ColorScheme = 'light') {
  return renderThemed(
    <JoinShopScreen deps={h.deps} shell={h.shell} state={state} profile={PROFILE} />,
    scheme,
  );
}

function typeEmail(email: string): void {
  fireEvent.change(screen.getByTestId('join-email-input'), { target: { value: email } });
}

const RESULT = t('join.result', { shopName: SHOP.shopName, ownerFirstName: SHOP.ownerFirstName });

describe('JoinShopScreen (R3.1–R3.4)', () => {
  it('greets the worker, offers the e-mail field, Find shop as the one primary button, and Log out', () => {
    const h = harness();
    renderJoin(h);
    expect(screen.getByText('Hello, Priya Sharma')).toBeTruthy();
    expect(screen.getByRole('image', { name: 'Priya Sharma' })).toBeTruthy();
    expect(screen.getByLabelText(STRINGS_EN['join.ownerEmail'])).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      STRINGS_EN['common.logOut'],
      STRINGS_EN['join.findShop'],
    ]);
    expect(screen.queryByTestId('join-outcome')).toBeNull();
  });

  it('refuses an e-mail that is not one before asking the server', () => {
    const h = harness();
    renderJoin(h);
    typeEmail('ramesh');
    fireEvent.click(screen.getByTestId('join-find'));
    expect(screen.getByTestId('join-email-error').textContent).toBe(STRINGS_EN['validation.email']);
    expect(h.account.lookupShops).not.toHaveBeenCalled();
  });

  it('one shop → the result card; "Yes, this is my shop" creates the request and re-reads the state (R3.2, R3.4)', async () => {
    const h = harness();
    renderJoin(h);
    typeEmail(' ramesh@example.in ');
    fireEvent.click(screen.getByTestId('join-find'));

    expect(await screen.findByText(RESULT)).toBeTruthy();
    expect(h.account.lookupShops).toHaveBeenCalledWith('ramesh@example.in');
    // The primary button changed: Yes, this is my shop; Not my shop is secondary.
    expect(screen.getByTestId('join-confirm').textContent).toBe(STRINGS_EN['join.yesMyShop']);
    expect(screen.queryByTestId('join-find')).toBeNull();

    fireEvent.click(screen.getByTestId('join-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.createJoinRequest).toHaveBeenCalledWith(SHOP.shopId);
  });

  it.each(SCHEMES)(
    'in %s: the result is a 20 dp card with a store glyph in brand on a brandSoft circle, "Not my shop" a text button, Yes the one pill primary (R12.15)',
    async (scheme) => {
      const tokens = TOKENS[scheme];
      const h = harness();
      renderJoin(h, NO_SHOP, scheme);
      typeEmail('ramesh@example.in');
      fireEvent.click(screen.getByTestId('join-find'));
      await screen.findByText(RESULT);

      const card = screen.getByTestId('join-result');
      expect(tokenNameOf(tokens, styleOf(card).backgroundColor)).toContain('bgElevated');
      expect(radiusNameOf(tokens, styleOf(card).borderRadius)).toContain('card');
      expect(
        tokenNameOf(tokens, styleOf(screen.getByTestId('join-result-icon-circle')).backgroundColor),
      ).toContain('brandSoft');
      const glyph = styleOf(screen.getByTestId('join-result-icon').firstElementChild as Element);
      expect(tokenNameOf(tokens, glyph.borderColor ?? glyph.backgroundColor)).toContain('brand');
      expect(tokenNameOf(tokens, styleOf(card.querySelector('span') as Element).color)).toContain(
        'textPrimary',
      );

      const notMine = screen.getByTestId('join-not-mine');
      expect(styleOf(notMine).backgroundColor).toBeUndefined();
      expect(styleOf(notMine).borderWidth).toBeUndefined();
      expect(
        tokenNameOf(tokens, styleOf(notMine.querySelector('span') as Element).color),
      ).toContain('textPrimary');
      const confirm = screen.getByTestId('join-confirm');
      expect(tokenNameOf(tokens, styleOf(confirm).backgroundColor)).toContain('brand');
      expect(radiusNameOf(tokens, styleOf(confirm).borderRadius)).toContain('pill');
    },
  );

  it('"Not my shop" returns to the field with Find shop as the primary button', async () => {
    const h = harness();
    renderJoin(h);
    typeEmail('ramesh@example.in');
    fireEvent.click(screen.getByTestId('join-find'));
    await screen.findByText(RESULT);

    fireEvent.click(screen.getByTestId('join-not-mine'));
    expect(screen.queryByTestId('join-result')).toBeNull();
    expect(screen.getByTestId('join-find')).toBeTruthy();
    expect(h.account.createJoinRequest).not.toHaveBeenCalled();
  });

  it('several shops → a list to pick from, then the card for the picked one (R3.2)', async () => {
    const h = harness();
    h.account.lookupShops.mockResolvedValueOnce({ shops: [SHOP, SHOP_2] });
    renderJoin(h);
    typeEmail('ramesh@example.in');
    fireEvent.click(screen.getByTestId('join-find'));

    expect(await screen.findByText(STRINGS_EN['join.pickShop'])).toBeTruthy();
    expect(screen.getByTestId(`join-shop-${SHOP.shopId}`).textContent).toBe(RESULT);
    expect(screen.getByTestId(`join-shop-${SHOP_2.shopId}`).textContent).toBe(
      t('join.result', { shopName: SHOP_2.shopName, ownerFirstName: SHOP_2.ownerFirstName }),
    );
    // Nothing is chosen yet: the primary button waits.
    expect(screen.getByTestId('join-confirm').getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByTestId(`join-shop-${SHOP_2.shopId}`));
    expect(screen.getByTestId('join-result')).toBeTruthy();
    expect(screen.getByTestId('join-confirm').getAttribute('aria-disabled')).toBe('false');

    fireEvent.click(screen.getByTestId('join-confirm'));
    await waitFor(() => expect(h.account.createJoinRequest).toHaveBeenCalledWith(SHOP_2.shopId));
  });

  it('no shop for that e-mail → the one R3.3 sentence', async () => {
    const h = harness();
    h.account.lookupShops.mockResolvedValueOnce({ shops: [] });
    renderJoin(h);
    typeEmail('nobody@example.in');
    fireEvent.click(screen.getByTestId('join-find'));
    expect((await screen.findByTestId('join-notice')).textContent).toBe(
      STRINGS_EN['join.notFound'],
    );
    expect(screen.queryByTestId('join-result')).toBeNull();
  });

  it('the rate limit is shown word for word and nothing is created (R3.8)', async () => {
    const h = harness();
    h.account.lookupShops.mockRejectedValueOnce(refusal(429, TOO_MANY_ATTEMPTS_WORKER));
    renderJoin(h);
    typeEmail('ramesh@example.in');
    fireEvent.click(screen.getByTestId('join-find'));
    expect((await screen.findByTestId('join-notice')).textContent).toBe(TOO_MANY_ATTEMPTS_WORKER);
    expect(h.account.createJoinRequest).not.toHaveBeenCalled();
    expect(h.shell.refresh).not.toHaveBeenCalled();
  });

  it('not reachable → the common line; a 401 goes to the shell and shows nothing (R9.3)', async () => {
    const h = harness();
    h.account.lookupShops.mockRejectedValueOnce(new NotReachable('TIMEOUT'));
    renderJoin(h);
    typeEmail('ramesh@example.in');
    fireEvent.click(screen.getByTestId('join-find'));
    expect((await screen.findByTestId('join-notice')).textContent).toBe(
      STRINGS_EN['common.notReachable'],
    );

    (h.shell.handleError as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    h.account.lookupShops.mockRejectedValueOnce(new NotAuthenticated('Token expired'));
    typeEmail('ramesh@example.in');
    fireEvent.click(screen.getByTestId('join-find'));
    await waitFor(() => expect(h.shell.handleError).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('join-notice')).toBeNull();
  });

  it('"You already have a request waiting." is information, and the state is re-read (R3.5)', async () => {
    const h = harness();
    h.account.createJoinRequest.mockRejectedValueOnce(
      refusal(409, WORKER_SERVER_MESSAGES.HR_WORKER_REQUEST_PENDING),
    );
    renderJoin(h);
    typeEmail('ramesh@example.in');
    fireEvent.click(screen.getByTestId('join-find'));
    await screen.findByText(RESULT);
    fireEvent.click(screen.getByTestId('join-confirm'));

    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('join-notice').textContent).toBe(
      WORKER_SERVER_MESSAGES.HR_WORKER_REQUEST_PENDING,
    );
  });

  it('"You are already part of a shop" is shown word for word and the state is re-read (R3.7)', async () => {
    const h = harness();
    h.account.createJoinRequest.mockRejectedValueOnce(
      refusal(409, WORKER_SERVER_MESSAGES.HR_WORKER_HAS_SHOP),
    );
    renderJoin(h);
    typeEmail('ramesh@example.in');
    fireEvent.click(screen.getByTestId('join-find'));
    await screen.findByText(RESULT);
    fireEvent.click(screen.getByTestId('join-confirm'));

    expect((await screen.findByTestId('join-notice')).textContent).toBe(
      WORKER_SERVER_MESSAGES.HR_WORKER_HAS_SHOP,
    );
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
  });

  describe('the rejection card (R4.12)', () => {
    it('shows the shop, the reason word for word, and "Ask another shop" dismisses it for good', async () => {
      const h = harness();
      renderJoin(h, REJECTED);
      const card = await screen.findByTestId('join-outcome');
      expect(card.textContent).toContain('Sri Ganesh Stores did not accept your request');
      expect(card.textContent).toContain('Ask Ramesh to add you');

      fireEvent.click(screen.getByTestId('join-ask-another'));
      expect(screen.queryByTestId('join-outcome')).toBeNull();
      await waitFor(() => expect(h.authStore.setDismissedOutcomeId).toHaveBeenCalledWith('o1'));
    });

    it.each(SCHEMES)(
      'in %s: it is a danger-tinted StatusCard with a danger glyph and textPrimary title (R12.15)',
      async (scheme) => {
        const tokens = TOKENS[scheme];
        renderJoin(harness(), REJECTED, scheme);
        const card = await screen.findByTestId('join-outcome');
        expect(tokenNameOf(tokens, styleOf(card).backgroundColor)).toContain('dangerSoft');
        expect(radiusNameOf(tokens, styleOf(card).borderRadius)).toContain('card');
        const glyph = styleOf(screen.getByTestId('join-outcome-icon').firstElementChild as Element);
        expect(tokenNameOf(tokens, glyph.borderColor ?? glyph.backgroundColor)).toContain('danger');
        const [title, line] = Array.from(card.querySelectorAll('span'));
        expect(tokenNameOf(tokens, styleOf(title).color)).toContain('textPrimary');
        expect(tokenNameOf(tokens, styleOf(line).color)).toContain('textSecondary');
      },
    );

    it('is not shown again once dismissed, nor for a withdrawal', async () => {
      const h = harness();
      h.authStore.dismissedOutcomeId.mockResolvedValueOnce('o1');
      renderJoin(h, REJECTED);
      await waitFor(() => expect(h.authStore.dismissedOutcomeId).toHaveBeenCalled());
      expect(screen.queryByTestId('join-outcome')).toBeNull();

      expect(
        showsOutcome(
          {
            id: 'o2',
            status: 'WITHDRAWN',
            shopName: 'Sri Ganesh Stores',
            decidedAt: '2025-05-11T10:00:00Z',
          },
          null,
        ),
      ).toBe(false);
      expect(showsOutcome(REJECTED.lastOutcome, null)).toBe(true);
      expect(showsOutcome(REJECTED.lastOutcome, 'o1')).toBe(false);
    });
  });

  it('Log out confirms, ends the session on the server, clears the account set and re-reads', async () => {
    const h = harness();
    renderJoin(h);
    fireEvent.click(screen.getByTestId('join-log-out'));
    expect(screen.getByText(STRINGS_EN['common.logOutQuestion'])).toBeTruthy();
    fireEvent.click(screen.getByTestId('join-log-out-sheet-confirm'));

    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.logout).toHaveBeenCalledTimes(1);
    expect(h.authStore.clearForLogout).toHaveBeenCalledTimes(1);
  });
});
