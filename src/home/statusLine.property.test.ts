// Task 14.6 — Property 15 (Home is derived from the state; R6.5), the status-line half: for any
// `today = {in?, out?}` the Attendance tile's line is "Not checked in" when `in` is absent,
// "Checked in HH:mm" when only `in` is present, and "Checked in HH:mm · out HH:mm" when both are.
//
// The expected text is written out here as a literal template, not through `t()`, so the strings
// file cannot vouch for the line. "Absent" covers everything the server or the stored state can
// hold for a missing time: the key left out, `null`, and the empty string. The times are the
// server's `HH:mm` and must appear in the line exactly as sent.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { statusLine, type TodayTimes } from './statusLine';

const NUM_RUNS = 300;

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

/** A server `HH:mm`, any hour and minute of the day. */
const clockTime: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

/** A time that is not there: key omitted, `null`, or the empty string. */
const noTime: fc.Arbitrary<null | undefined | ''> = fc.constantFrom(null, undefined, '');

/** A `today` with the given `in` and `out` draws, dropping keys drawn as `undefined`. */
function todayOf(
  inArb: fc.Arbitrary<string | null | undefined>,
  outArb: fc.Arbitrary<string | null | undefined>,
): fc.Arbitrary<TodayTimes> {
  return fc.tuple(inArb, outArb).map(([inTime, outTime]) => {
    const today: TodayTimes = {};
    if (inTime !== undefined) today.in = inTime;
    if (outTime !== undefined) today.out = outTime;
    return today;
  });
}

/** No first punch, whatever `out` says (a server never sends `out` alone, but the line must cope). */
const notCheckedIn: fc.Arbitrary<TodayTimes | null | undefined> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  todayOf(noTime, fc.oneof(noTime, clockTime)),
);

const checkedInOnly: fc.Arbitrary<TodayTimes> = todayOf(clockTime, noTime);

const checkedInAndOut: fc.Arbitrary<TodayTimes> = todayOf(clockTime, clockTime);

/** Any `today`, including the ones the server would not send. */
const anyToday: fc.Arbitrary<TodayTimes | null | undefined> = fc.oneof(
  notCheckedIn,
  checkedInOnly,
  checkedInAndOut,
);

// ---------------------------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------------------------

function present(time: string | null | undefined): time is string {
  return time != null && time !== '';
}

/** The line R6.5 spells out, from the times alone. */
function expectedLine(today: TodayTimes | null | undefined): string {
  const inTime = today?.in;
  const outTime = today?.out;
  if (!present(inTime)) return 'Not checked in';
  if (!present(outTime)) return `Checked in ${inTime}`;
  return `Checked in ${inTime} \u00b7 out ${outTime}`;
}

// ---------------------------------------------------------------------------------------------
// Property 15 — status line
// ---------------------------------------------------------------------------------------------

describe('Feature: worker-app, Property 15: Home is derived from the state (status line)', () => {
  it('for any today without a first punch, the line is "Not checked in" and carries no time (R6.5)', () => {
    fc.assert(
      fc.property(notCheckedIn, (today) => {
        const line = statusLine(today);
        expect(line).toBe('Not checked in');
        expect(line).not.toMatch(/\d/);
        if (present(today?.out)) {
          expect(line).not.toContain(today?.out);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any today with a first punch only, the line is "Checked in HH:mm" with the server\u2019s time as sent (R6.5)', () => {
    fc.assert(
      fc.property(checkedInOnly, (today) => {
        const line = statusLine(today);
        expect(line).toBe(`Checked in ${today.in}`);
        expect(line).not.toContain('out');
        expect(line).not.toContain('\u00b7');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any today with both punches, the line is "Checked in HH:mm · out HH:mm", in that order, as sent (R6.5)', () => {
    fc.assert(
      fc.property(checkedInAndOut, (today) => {
        const line = statusLine(today);
        expect(line).toBe(`Checked in ${today.in} \u00b7 out ${today.out}`);
        expect(line.indexOf(today.in as string)).toBeLessThan(
          line.lastIndexOf(today.out as string),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any today, the line is the one R6.5 names for its times and nothing else, and today is not changed', () => {
    fc.assert(
      fc.property(anyToday, (today) => {
        const before = today == null ? today : { ...today };
        expect(statusLine(today)).toBe(expectedLine(today));
        expect(today).toEqual(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
