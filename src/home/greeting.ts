/**
 * The Home header's greeting (design "Home header", R12.16): "Good morning" before 12:00 IST,
 * "Good afternoon" before 17:00, "Good evening" from then on, followed by ", Ramesh" from the first
 * word of the worker's name. Pure: the hour comes in (`kolkataHour` gives it from the phone clock),
 * the text goes out through `t()`; no React, Expo or React Native import.
 */
import { t } from '../i18n';
import { KOLKATA_OFFSET_MINUTES } from '../punch/kolkata';

/** The string id of the greeting word for an hour of the day in Asia/Kolkata (0–23). */
export type GreetingId = 'home.goodMorning' | 'home.goodAfternoon' | 'home.goodEvening';

/** First hour (IST) of the afternoon and of the evening greeting. */
export const AFTERNOON_FROM_HOUR = 12;
export const EVENING_FROM_HOUR = 17;

/**
 * Which greeting the hour calls for. An hour outside 0–23 (or `NaN`, from a broken clock) falls
 * through to the evening greeting rather than throwing: a wrong word must never crash Home.
 */
export function greetingIdFor(hourIst: number): GreetingId {
  if (hourIst >= 0 && hourIst < AFTERNOON_FROM_HOUR) {
    return 'home.goodMorning';
  }
  if (hourIst >= AFTERNOON_FROM_HOUR && hourIst < EVENING_FROM_HOUR) {
    return 'home.goodAfternoon';
  }
  return 'home.goodEvening';
}

/** The first word of a name, trimmed; `''` for a blank name. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/**
 * The greeting line: "Good morning, Ramesh" (`home.greeting` with the word and the first name), or
 * the word alone when the name is blank (no dangling comma).
 */
export function greetingFor(hourIst: number, name: string): string {
  const word = t(greetingIdFor(hourIst));
  const first = firstNameOf(name);
  return first ? t('home.greeting', { greeting: word, name: first }) : word;
}

/** The hour of the day (0–23) in Asia/Kolkata for an epoch-millisecond instant. */
export function kolkataHour(nowMs: number): number {
  return new Date(nowMs + KOLKATA_OFFSET_MINUTES * 60_000).getUTCHours();
}
