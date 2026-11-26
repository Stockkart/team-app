// Task 20.2 — the check-in screen's pure rules (design "Check-in screen", R7.11, R7.12), the three
// properties the design marks (P):
//
// - `statusLineFor` yields exactly one of the four R7.11 texts, and the waiting count wins;
// - `workedDuration` is last OUT − first counted IN floored to the minute, never negative and
//   `undefined` without a pair;
// - `todayRows` has one row per IN, carrying the OUT that follows it or none ("—").
//
// The expected texts are literal templates here, not `t()`, so the strings file cannot vouch for
// itself. Reference implementations are written the plain way (a scan, a filter) so a slip in the
// production rule shows up as a counter-example.
//
// **Validates: Requirements 7.11, 7.12**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { kolkataDate } from '../history/kolkataDates';
import {
  minutesOf,
  statusLineFor,
  todayPunchesOf,
  todayRows,
  workedDuration,
  type TodayPunch,
  type TodayStatus,
} from './punchScreen';

const NUM_RUNS = 300;

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

/** A server `HH:mm`, any minute of the day. */
const clockTime: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

/** `HH:mm:ss`: the second is floored away by the rule. */
const clockTimeWithSeconds: fc.Arbitrary<string> = fc
  .tuple(clockTime, fc.integer({ min: 0, max: 59 }))
  .map(([hm, s]) => `${hm}:${String(s).padStart(2, '0')}`);

const punch: fc.Arbitrary<TodayPunch> = fc.record({
  direction: fc.constantFrom<'IN' | 'OUT'>('IN', 'OUT'),
  time: fc.oneof(clockTime, clockTimeWithSeconds),
});

/** Any sequence of counted punches, in order of the day, including sequences no server would send. */
const punches: fc.Arbitrary<TodayPunch[]> = fc.array(punch, { maxLength: 8 });

/** An instant in 2025 in whole seconds. */
const instant: fc.Arbitrary<number> = fc
  .integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2025, 11, 31, 23, 59, 59) })
  .map((ms) => ms - (ms % 1000));

/** A `/me` answer for the day of `nowMs`, or for another day, with any of the four time shapes. */
function statusFor(nowMs: number): fc.Arbitrary<TodayStatus | null> {
  const sameDay = kolkataDate(nowMs);
  const otherDay = fc.constantFrom('2024-12-31', '2026-01-01', '1999-01-01');
  return fc.oneof(
    fc.constant(null),
    fc.record({
      today: fc.oneof({ weight: 3, arbitrary: fc.constant(sameDay) }, otherDay),
      todayIn: fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant(''), clockTime),
      todayOut: fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant(''), clockTime),
      nextDirection: fc.constantFrom<'IN' | 'OUT'>('IN', 'OUT'),
    }),
  );
}

const queue: fc.Arbitrary<{ waiting: number }> = fc.record({
  waiting: fc.oneof({ weight: 2, arbitrary: fc.constant(0) }, fc.integer({ min: 0, max: 50 })),
});

// ---------------------------------------------------------------------------------------------
// Reference rules
// ---------------------------------------------------------------------------------------------

const NOT_CHECKED_IN = /^Not checked in yet$/;
const IN_SINCE = /^In since (\d{2}:\d{2})$/;
const DONE = /^Done for today · (\d+) h (\d{2}) m$/;
const WAITING = /^(\d+) punch(es)? waiting to be sent$/;
const FOUR = [NOT_CHECKED_IN, IN_SINCE, DONE, WAITING];

/** last OUT after the first IN, minus the first IN, in minutes; `undefined` without the pair. */
function referenceWorked(list: readonly TodayPunch[]): number | undefined {
  const firstIn = list.findIndex((p) => p.direction === 'IN');
  if (firstIn < 0) {
    return undefined;
  }
  const outs = list
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i > firstIn && p.direction === 'OUT');
  if (outs.length === 0) {
    return undefined;
  }
  const start = minutesOf(list[firstIn].time);
  const end = minutesOf(outs[outs.length - 1].p.time);
  if (start === null || end === null) {
    return undefined;
  }
  return Math.max(0, end - start);
}

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

describe('Property: statusLineFor is exactly one of the four texts and the waiting count wins (R7.11)', () => {
  it('matches exactly one of the four templates for any status, queue and instant', () => {
    fc.assert(
      fc.property(
        instant.chain((nowMs) => fc.tuple(fc.constant(nowMs), statusFor(nowMs), queue)),
        ([nowMs, status, q]) => {
          const line = statusLineFor(status, q, nowMs);
          const matches = FOUR.filter((re) => re.test(line));
          expect(matches, line).toHaveLength(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('with punches waiting the line is the waiting count, whatever /me says', () => {
    fc.assert(
      fc.property(
        instant.chain((nowMs) => fc.tuple(fc.constant(nowMs), statusFor(nowMs))),
        fc.integer({ min: 1, max: 50 }),
        ([nowMs, status], waiting) => {
          const line = statusLineFor(status, { waiting }, nowMs);
          const match = WAITING.exec(line);
          expect(match, line).not.toBeNull();
          expect(Number(match?.[1])).toBe(waiting);
          expect(match?.[2] ?? '').toBe(waiting === 1 ? '' : 'es');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('without waiting punches the line follows the day: none → not checked in; a closing OUT → done with the worked time; else in since the first IN', () => {
    fc.assert(
      fc.property(
        instant.chain((nowMs) => fc.tuple(fc.constant(nowMs), statusFor(nowMs))),
        ([nowMs, status]) => {
          const line = statusLineFor(status, { waiting: 0 }, nowMs);
          const list = status && status.today === kolkataDate(nowMs) ? todayPunchesOf(status) : [];
          if (list.length === 0) {
            expect(line).toMatch(NOT_CHECKED_IN);
            return;
          }
          const worked = referenceWorked(list);
          if (worked !== undefined && status?.nextDirection === 'IN') {
            const match = DONE.exec(line);
            expect(match, line).not.toBeNull();
            expect(Number(match?.[1]) * 60 + Number(match?.[2])).toBe(worked);
          } else {
            expect(line).toBe(`In since ${list[0].time}`);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property: workedDuration is last OUT − first IN, floored to the minute, never negative, undefined without a pair (R7.11)', () => {
  it('agrees with the reference rule and is never negative', () => {
    fc.assert(
      fc.property(punches, (list) => {
        const worked = workedDuration(list);
        expect(worked).toBe(referenceWorked(list));
        if (worked !== undefined) {
          expect(worked).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(worked)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is undefined exactly when no OUT follows the first IN', () => {
    fc.assert(
      fc.property(punches, (list) => {
        const firstIn = list.findIndex((p) => p.direction === 'IN');
        const hasPair = firstIn >= 0 && list.slice(firstIn + 1).some((p) => p.direction === 'OUT');
        expect(workedDuration(list) === undefined).toBe(!hasPair);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('ignores the seconds: HH:mm:ss and HH:mm of the same minute give the same duration', () => {
    fc.assert(
      fc.property(clockTime, clockTime, fc.integer({ min: 0, max: 59 }), (a, b, s) => {
        const withSeconds = [
          { direction: 'IN' as const, time: `${a}:${String(s).padStart(2, '0')}` },
          { direction: 'OUT' as const, time: `${b}:${String(59 - s).padStart(2, '0')}` },
        ];
        const plain = [
          { direction: 'IN' as const, time: a },
          { direction: 'OUT' as const, time: b },
        ];
        expect(workedDuration(withSeconds)).toBe(workedDuration(plain));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property: todayRows has one row per IN with the following OUT or none (R7.12)', () => {
  it('one row per IN, in order, each carrying that IN time', () => {
    fc.assert(
      fc.property(punches, (list) => {
        const rows = todayRows(list);
        const ins = list.filter((p) => p.direction === 'IN').map((p) => p.time);
        expect(rows.map((r) => r.in)).toEqual(ins);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a row\u2019s OUT is the first OUT after its IN and before the next IN; none when there is none', () => {
    fc.assert(
      fc.property(punches, (list) => {
        const rows = todayRows(list);
        let row = 0;
        for (let i = 0; i < list.length; i += 1) {
          if (list[i].direction !== 'IN') {
            continue;
          }
          let expected: string | null = null;
          for (let j = i + 1; j < list.length && list[j].direction !== 'IN'; j += 1) {
            if (list[j].direction === 'OUT') {
              expected = list[j].time;
              break;
            }
          }
          expect(rows[row].out).toBe(expected);
          row += 1;
        }
        expect(row).toBe(rows.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
