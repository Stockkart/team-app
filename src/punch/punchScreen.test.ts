import { describe, expect, it } from 'vitest';

import type { AppStatusResponse } from '@stockkart/attendance-protocol';

import type { PunchResult } from './PunchFlow';
import {
  biometricChipFor,
  clockText,
  formatDuration,
  locationCheckOf,
  locationChipFor,
  minutesOf,
  punchTone,
  statusLineFor,
  todayPunchesOf,
  todayRows,
  workedDuration,
  type TodayPunch,
} from './punchScreen';

/** 2025-04-03 09:12:07 IST = 03:42:07 UTC. */
const NOW = Date.UTC(2025, 3, 3, 3, 42, 7);

const ME: AppStatusResponse = {
  employeeName: 'Ravi Kumar',
  shopName: 'Sharma Stores',
  today: '2025-04-03',
  biometricApp: true,
  canPunch: true,
  reason: null,
  nextDirection: 'IN',
  todayIn: null,
  todayOut: null,
  location: { locationCheck: false },
  consent: { latestVersion: 1, reconsentRequired: false, agreedVersion: 1 },
};

const NO_QUEUE = { waiting: 0 };

const IN = (time: string): TodayPunch => ({ direction: 'IN', time });
const OUT = (time: string): TodayPunch => ({ direction: 'OUT', time });

describe('statusLineFor (R7.11)', () => {
  it('"Not checked in yet" without a first punch, without a status, or for another day', () => {
    expect(statusLineFor(ME, NO_QUEUE, NOW)).toBe('Not checked in yet');
    expect(statusLineFor(null, NO_QUEUE, NOW)).toBe('Not checked in yet');
    expect(
      statusLineFor(
        { ...ME, today: '2025-04-02', todayIn: '09:12', todayOut: '18:05', nextDirection: 'IN' },
        NO_QUEUE,
        NOW,
      ),
    ).toBe('Not checked in yet');
  });

  it('"In since 09:12" after the first IN, and again when the last punch is another IN', () => {
    expect(statusLineFor({ ...ME, todayIn: '09:12', nextDirection: 'OUT' }, NO_QUEUE, NOW)).toBe(
      'In since 09:12',
    );
    // IN 09:12, OUT (unknown), IN 14:00: the next direction is OUT, no closing OUT is known.
    expect(
      statusLineFor(
        { ...ME, todayIn: '09:12', todayOut: '14:00', nextDirection: 'OUT' },
        NO_QUEUE,
        NOW,
      ),
    ).toBe('In since 09:12');
  });

  it('"Done for today · 8 h 05 m" when an OUT closed the day: last OUT − first IN, floored', () => {
    expect(
      statusLineFor(
        { ...ME, todayIn: '09:12', todayOut: '17:17', nextDirection: 'IN' },
        NO_QUEUE,
        NOW,
      ),
    ).toBe('Done for today · 8 h 05 m');
    expect(
      statusLineFor(
        { ...ME, todayIn: '09:00', todayOut: '09:00', nextDirection: 'IN' },
        NO_QUEUE,
        NOW,
      ),
    ).toBe('Done for today · 0 h 00 m');
  });

  it('the waiting count takes the line while punches wait (HR-module R6.16 text)', () => {
    expect(statusLineFor({ ...ME, todayIn: '09:12' }, { waiting: 1 }, NOW)).toBe(
      '1 punch waiting to be sent',
    );
    expect(statusLineFor(null, { waiting: 2 }, NOW)).toBe('2 punches waiting to be sent');
  });
});

describe('workedDuration and todayRows (R7.11, R7.12)', () => {
  it('is last OUT − first IN in whole minutes, undefined without a pair, never negative', () => {
    expect(workedDuration([IN('09:12'), OUT('17:17')])).toBe(485);
    expect(workedDuration([IN('09:12'), OUT('12:00'), IN('13:00'), OUT('18:05')])).toBe(533);
    expect(workedDuration([IN('09:12:59'), OUT('09:13:00')])).toBe(1);
    expect(workedDuration([])).toBeUndefined();
    expect(workedDuration([IN('09:12')])).toBeUndefined();
    expect(workedDuration([OUT('08:00'), IN('09:00')])).toBeUndefined();
    expect(workedDuration([IN('09:12'), OUT('12:00'), IN('13:00')])).toBe(168);
    // A clock that went backwards reads as 0, not a negative duration.
    expect(workedDuration([IN('10:00'), OUT('09:00')])).toBe(0);
    expect(workedDuration([IN('x'), OUT('09:00')])).toBeUndefined();
  });

  it('formats a duration as "{h} h {mm} m"', () => {
    expect(formatDuration(485)).toBe('8 h 05 m');
    expect(formatDuration(0)).toBe('0 h 00 m');
    expect(formatDuration(61.9)).toBe('1 h 01 m');
    expect(formatDuration(-5)).toBe('0 h 00 m');
  });

  it('one row per IN with the OUT that follows it, or none', () => {
    expect(todayRows([])).toEqual([]);
    expect(todayRows([IN('09:12')])).toEqual([{ in: '09:12', out: null }]);
    expect(todayRows([IN('09:12'), OUT('18:05')])).toEqual([{ in: '09:12', out: '18:05' }]);
    expect(todayRows([IN('09:12'), OUT('12:00'), IN('13:00')])).toEqual([
      { in: '09:12', out: '12:00' },
      { in: '13:00', out: null },
    ]);
    // Two INs in a row: the first stays open; an OUT with no open IN before it has no row.
    expect(todayRows([IN('09:12'), IN('13:00'), OUT('18:05')])).toEqual([
      { in: '09:12', out: null },
      { in: '13:00', out: '18:05' },
    ]);
    expect(todayRows([OUT('08:00'), IN('09:00')])).toEqual([{ in: '09:00', out: null }]);
  });

  it('todayPunchesOf reads the /me answer: first IN, then the last punch by the next direction', () => {
    expect(todayPunchesOf(null)).toEqual([]);
    expect(todayPunchesOf(ME)).toEqual([]);
    expect(todayPunchesOf({ ...ME, todayIn: '09:12', nextDirection: 'OUT' })).toEqual([
      IN('09:12'),
    ]);
    expect(
      todayPunchesOf({ ...ME, todayIn: '09:12', todayOut: '18:05', nextDirection: 'IN' }),
    ).toEqual([IN('09:12'), OUT('18:05')]);
    expect(
      todayPunchesOf({ ...ME, todayIn: '09:12', todayOut: '14:00', nextDirection: 'OUT' }),
    ).toEqual([IN('09:12'), IN('14:00')]);
  });

  it('minutesOf parses HH:mm and HH:mm:ss and rejects anything else', () => {
    expect(minutesOf('09:12')).toBe(552);
    expect(minutesOf('09:12:59')).toBe(552);
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('23:59')).toBe(1439);
    expect(minutesOf('24:00')).toBeNull();
    expect(minutesOf('9:60')).toBeNull();
    expect(minutesOf('—')).toBeNull();
  });
});

describe('clockText (R7.11, R12.7)', () => {
  it('is HH:mm:ss in Asia/Kolkata, HH:mm under reduce motion', () => {
    expect(clockText(NOW, false)).toBe('09:12:07');
    expect(clockText(NOW, true)).toBe('09:12');
    // 18:30 UTC = 00:00 IST the next day: hours wrap and pad.
    expect(clockText(Date.UTC(2025, 3, 3, 18, 30, 0), false)).toBe('00:00:00');
  });
});

describe('punchTone (R7.10)', () => {
  it('is success for IN, danger for OUT, muted when not enabled', () => {
    expect(punchTone('IN', true)).toBe('success');
    expect(punchTone('OUT', true)).toBe('danger');
    expect(punchTone('IN', false)).toBe('muted');
    expect(punchTone('OUT', false)).toBe('muted');
  });
});

describe('the chips (R7.12)', () => {
  it('location: off without a check, else inside / outside / checking', () => {
    expect(locationChipFor(null, null).text).toBe('Location off');
    expect(locationChipFor({ locationCheck: false }, 'inside').text).toBe('Location off');
    expect(locationChipFor({ locationCheck: true }, null)).toMatchObject({
      text: 'Checking…',
      tone: 'neutral',
      accessibilityLabel: 'Location: Checking…',
    });
    expect(locationChipFor({ locationCheck: true }, 'inside')).toMatchObject({
      text: 'Inside shop',
      tone: 'success',
      icon: 'check',
    });
    expect(locationChipFor({ locationCheck: true }, 'outside')).toMatchObject({
      text: 'Outside shop',
      tone: 'warning',
      icon: 'warning',
    });
  });

  it('biometric: ready only with a pairing and a strong biometric enrolled', () => {
    expect(biometricChipFor({ paired: true, capability: 'STRONG_BIOMETRIC_READY' })).toMatchObject({
      text: 'Fingerprint ready',
      tone: 'success',
      icon: 'fingerprint',
      accessibilityLabel: 'Biometric: Fingerprint ready',
    });
    expect(biometricChipFor({ paired: false, capability: 'STRONG_BIOMETRIC_READY' }).text).toBe(
      'Not set up',
    );
    expect(
      biometricChipFor({ paired: true, capability: 'NO_STRONG_BIOMETRIC_ENROLLED' }).text,
    ).toBe('Not set up');
    expect(biometricChipFor({ paired: true, capability: null }).text).toBe('Not set up');
  });

  it('locationCheckOf reads the newest punch result and says nothing when it cannot tell', () => {
    const stored = (flags: Array<'OUTSIDE_SHOP' | 'NO_LOCATION'>): PunchResult => ({
      kind: 'stored',
      lines: ['Checked in at 09:12'],
      response: {
        outcome: 'STORED',
        direction: 'IN',
        at: '2025-04-03T03:42:08Z',
        atLocal: '09:12',
        flags,
        duplicate: false,
        todayIn: '09:12',
        todayOut: null,
        nextDirection: 'OUT',
      },
    });
    expect(locationCheckOf(stored([]), 100)).toBe('inside');
    expect(locationCheckOf(stored(['OUTSIDE_SHOP']), 100)).toBe('outside');
    expect(locationCheckOf(stored(['NO_LOCATION']), 100)).toBeNull();

    const queued = (locationChecked: boolean, distanceMetres: number | null): PunchResult => ({
      kind: 'queued',
      message: 'saved',
      signedOnline: false,
      punch: {
        punchId: 'p',
        request: {
          pairingId: 'a',
          shopId: 's',
          employeeId: 'e',
          punchId: 'p',
          phoneTime: '2025-04-03T03:42:07Z',
          offline: true,
          locationChecked,
          distanceMetres,
          accuracyMetres: distanceMetres === null ? null : 10,
          mock: false,
          signature: 'sig',
        },
        phoneTime: '2025-04-03T03:42:07Z',
        directionGuess: 'IN',
        state: 'WAITING',
        refusalMessage: null,
        attempts: 0,
        nextAttemptAt: 0,
        createdAt: 0,
      },
    });
    expect(locationCheckOf(queued(true, 40), 100)).toBe('inside');
    expect(locationCheckOf(queued(true, 140), 100)).toBe('outside');
    expect(locationCheckOf(queued(true, 40), null)).toBeNull();
    expect(locationCheckOf(queued(false, null), 100)).toBeNull();
    expect(locationCheckOf({ kind: 'refused', message: 'no', code: 'HR_APP_OFF' }, 100)).toBeNull();
  });
});
