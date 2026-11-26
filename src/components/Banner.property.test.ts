// Task 12.4 — Property 24 (Banner formatting, R10.1): for any list of unread notifications the
// banner stack shows min(3, n) items, newest first, and the line "and k more" iff n > 3 with
// k = n − 3; tapping item i hands exactly that notification to `onPress` (which marks it read).
//
// `formatBanners` is checked against a reference ordering written out independently of the
// component's sort, and the drawn `Banner` is checked against `formatBanners` through the DOM shim
// (`src/components/**` runs in jsdom with `react-native` aliased to plain elements).
import { cleanup, fireEvent, screen } from '@testing-library/react';
import fc from 'fast-check';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderThemed } from '../../test-support/render';
import { Banner, formatBanners, MAX_BANNERS, moreLine, type BannerItem } from './Banner';

const NUM_RUNS = 200;

/** The one property that renders the component `NUM_RUNS` times (a few ms each under jsdom). */
const RENDER_RUNS_TIMEOUT_MS = 30_000;

afterEach(cleanup);

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

// 2025-01-01T00:00:00Z .. 2025-12-31T00:00:00Z
const EPOCH_MIN = Date.UTC(2025, 0, 1);
const EPOCH_MAX = Date.UTC(2025, 11, 31);

/**
 * An ISO-8601 instant. Drawn from a coarse grid (whole minutes) so ties are common enough to
 * exercise the stable-sort rule, with some whole-millisecond instants mixed in.
 */
const createdAt = fc
  .oneof(
    { weight: 3, arbitrary: fc.integer({ min: 0, max: 60 }).map((m) => EPOCH_MIN + m * 60_000) },
    { weight: 1, arbitrary: fc.integer({ min: EPOCH_MIN, max: EPOCH_MAX }) },
  )
  .map((ms) => new Date(ms).toISOString());

/** The words the server puts in a notification; plain so `aria-label` keeps them verbatim. */
const text = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 .,'!-]{0,39}$/);

const notificationType = fc.constantFrom(
  'JOIN_REQUEST_APPROVED',
  'JOIN_REQUEST_REJECTED',
  'PROFILE_REQUESTED',
  undefined,
);

/** One unread notification minus its id; ids are assigned by position so they are unique. */
const bareItem = fc.record({
  text,
  createdAt: fc.option(createdAt, { nil: undefined }),
  type: notificationType,
});

/** A list of unread notifications with unique ids, in the order the store hands them over. */
function items(maxLength: number): fc.Arbitrary<BannerItem[]> {
  return fc
    .array(bareItem, { maxLength })
    .map((list) => list.map((item, i) => ({ id: `n${i + 1}`, ...item })));
}

// ---------------------------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------------------------

/**
 * R10.1 "newest first", written out independently of the component's comparator: dated items by
 * instant, newest first, ties kept in input order; undated items after them, in input order.
 */
function referenceOrder(list: readonly BannerItem[]): BannerItem[] {
  const dated = list
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.createdAt !== undefined)
    .sort((a, b) => {
      const ta = Date.parse(a.item.createdAt as string);
      const tb = Date.parse(b.item.createdAt as string);
      return tb !== ta ? tb - ta : a.index - b.index;
    })
    .map(({ item }) => item);
  const undated = list.filter((item) => item.createdAt === undefined);
  return [...dated, ...undated];
}

// ---------------------------------------------------------------------------------------------
// Property 24
// ---------------------------------------------------------------------------------------------

describe('Feature: HR-module, Property 24: Banner formatting', () => {
  it('for any list of n unread notifications, formatBanners shows the first min(3, n) of the newest-first order and counts the other max(0, n − 3) (R10.1)', () => {
    fc.assert(
      fc.property(items(12), (list) => {
        const n = list.length;
        const { visible, hidden } = formatBanners(list);

        expect(visible).toHaveLength(Math.min(MAX_BANNERS, n));
        expect(hidden).toBe(Math.max(0, n - MAX_BANNERS));
        expect(hidden > 0).toBe(n > MAX_BANNERS);
        expect(visible.length + hidden).toBe(n);

        // Exactly the newest min(3, n), newest first, as the reference says.
        expect(visible).toEqual(referenceOrder(list).slice(0, MAX_BANNERS));

        // Every visible item is one of the inputs, untouched, and no id is drawn twice.
        for (const item of visible) {
          expect(list).toContainEqual(item);
        }
        expect(new Set(visible.map((item) => item.id)).size).toBe(visible.length);

        // Nothing hidden is newer than anything shown.
        const shown = new Set(visible.map((item) => item.id));
        const newest = (item: BannerItem) =>
          item.createdAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(item.createdAt);
        const oldestShown = Math.min(...visible.map(newest));
        for (const item of list) {
          if (!shown.has(item.id)) {
            expect(newest(item)).toBeLessThanOrEqual(oldestShown);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('formatBanners never changes its input and is the same for the same input (R10.1)', () => {
    fc.assert(
      fc.property(items(12), (list) => {
        const copy = structuredClone(list);
        const first = formatBanners(list);
        const second = formatBanners(list);
        expect(list).toEqual(copy);
        expect(second).toEqual(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any k ≥ 1 the "more" line reads "and k more" (R10.1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (k) => {
        expect(moreLine(k)).toBe(`and ${k} more`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it(
    'for any list of n unread notifications, the drawn Banner has min(3, n) buttons labelled newest first, the "and n − 3 more" line iff n > 3, and tapping button i hands exactly notification i to onPress (R10.1)',
    () => {
      fc.assert(
        fc.property(
          items(8).filter((list) => list.length > 0),
          fc.nat({ max: MAX_BANNERS - 1 }),
          (list, tapIndex) => {
            cleanup();
            const n = list.length;
            const { visible, hidden } = formatBanners(list);
            const onPress = vi.fn();
            renderThemed(createElement(Banner, { items: list, onPress, testID: 'b' }));

            const buttons = screen.getAllByRole('button');
            expect(buttons).toHaveLength(Math.min(MAX_BANNERS, n));
            expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(
              visible.map((item) => item.text),
            );
            expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual(
              visible.map((item) => `b-${item.id}`),
            );

            const more = screen.queryByTestId('b-more');
            if (n > MAX_BANNERS) {
              expect(more?.textContent).toBe(`and ${n - MAX_BANNERS} more`);
              expect(hidden).toBe(n - MAX_BANNERS);
            } else {
              expect(more).toBeNull();
            }

            const i = tapIndex % buttons.length;
            fireEvent.click(buttons[i]);
            expect(onPress).toHaveBeenCalledTimes(1);
            expect(onPress).toHaveBeenCalledWith(visible[i]);
            expect((onPress.mock.calls[0][0] as BannerItem).id).toBe(visible[i].id);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    RENDER_RUNS_TIMEOUT_MS,
  );

  it('with no unread notifications the Banner draws nothing (R10.1)', () => {
    const { container } = renderThemed(
      createElement(Banner, { items: [], onPress: () => undefined, testID: 'b' }),
    );
    expect(container.innerHTML).toBe('');
    expect(formatBanners([])).toEqual({ visible: [], hidden: 0 });
  });
});
