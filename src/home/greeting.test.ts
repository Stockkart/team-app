import { describe, expect, it } from 'vitest';

import { STRINGS_EN } from '../i18n';
import {
  AFTERNOON_FROM_HOUR,
  EVENING_FROM_HOUR,
  firstNameOf,
  greetingFor,
  greetingIdFor,
  kolkataHour,
} from './greeting';

describe('greetingIdFor (R12.16)', () => {
  it.each([
    [0, 'home.goodMorning'],
    [5, 'home.goodMorning'],
    [11, 'home.goodMorning'],
    [12, 'home.goodAfternoon'],
    [16, 'home.goodAfternoon'],
    [17, 'home.goodEvening'],
    [21, 'home.goodEvening'],
    [23, 'home.goodEvening'],
  ] as const)('hour %i → %s', (hour, id) => {
    expect(greetingIdFor(hour)).toBe(id);
  });

  it('switches at 12 and at 17 exactly', () => {
    expect(AFTERNOON_FROM_HOUR).toBe(12);
    expect(EVENING_FROM_HOUR).toBe(17);
    expect(greetingIdFor(11.99)).toBe('home.goodMorning');
    expect(greetingIdFor(16.99)).toBe('home.goodAfternoon');
  });

  it('never throws on an hour outside the day: it falls through to the evening word', () => {
    expect(greetingIdFor(-1)).toBe('home.goodEvening');
    expect(greetingIdFor(24)).toBe('home.goodEvening');
    expect(greetingIdFor(Number.NaN)).toBe('home.goodEvening');
  });
});

describe('greetingFor', () => {
  it('joins the word and the first name: "Good morning, Ramesh"', () => {
    expect(greetingFor(9, 'Ramesh Kumar')).toBe('Good morning, Ramesh');
    expect(greetingFor(14, 'Priya Sharma')).toBe('Good afternoon, Priya');
    expect(greetingFor(19, '  Ravi ')).toBe('Good evening, Ravi');
  });

  it('is the word alone when the name is blank (no dangling comma)', () => {
    expect(greetingFor(9, '')).toBe(STRINGS_EN['home.goodMorning']);
    expect(greetingFor(9, '   ')).toBe('Good morning');
  });

  it('uses the three greeting words of the strings file', () => {
    expect(STRINGS_EN['home.goodMorning']).toBe('Good morning');
    expect(STRINGS_EN['home.goodAfternoon']).toBe('Good afternoon');
    expect(STRINGS_EN['home.goodEvening']).toBe('Good evening');
    expect(STRINGS_EN['home.greeting']).toBe('{greeting}, {name}');
  });
});

describe('firstNameOf', () => {
  it.each([
    ['Ramesh Kumar', 'Ramesh'],
    ['  Priya   Sharma ', 'Priya'],
    ['Ravi', 'Ravi'],
    ['', ''],
    ['   ', ''],
  ])('%j → %j', (name, first) => {
    expect(firstNameOf(name)).toBe(first);
  });
});

describe('kolkataHour', () => {
  it('reads the hour in Asia/Kolkata (UTC+05:30) from the phone clock', () => {
    // 2025-05-12 09:00 UTC is 14:30 IST.
    expect(kolkataHour(Date.UTC(2025, 4, 12, 9, 0, 0))).toBe(14);
    // 2025-05-12 18:30 UTC is 00:00 IST the next day.
    expect(kolkataHour(Date.UTC(2025, 4, 12, 18, 30, 0))).toBe(0);
    // 2025-05-12 06:29 UTC is 11:59 IST: still the morning.
    expect(greetingIdFor(kolkataHour(Date.UTC(2025, 4, 12, 6, 29, 0)))).toBe('home.goodMorning');
    expect(greetingIdFor(kolkataHour(Date.UTC(2025, 4, 12, 6, 30, 0)))).toBe('home.goodAfternoon');
  });
});
