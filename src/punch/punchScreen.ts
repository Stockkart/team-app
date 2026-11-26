/**
 * The pure rules of the check-in screen (design "Check-in screen", DD17; R7.10–R7.12), each a
 * function of the data the HR-module punch flow already reads (`GET /me`, the sync worker's
 * `QueueState`, the stored location settings, the signer's capability) and the phone clock. Every
 * text comes from the strings file; nothing here draws or fetches.
 *
 * - `statusLineFor(status, queue, now)` — one of the four R7.11 lines; the waiting count wins.
 * - `workedDuration(punches)` — last OUT − first counted IN, floored to the minute, `undefined`
 *   without a pair, never negative.
 * - `todayRows(punches)` — one row per IN with the OUT that follows it, or none ("—").
 * - `clockText(nowMs, reduceMotion)` — `HH:mm:ss`, or `HH:mm` under reduce motion, Asia/Kolkata.
 * - `punchTone(direction, enabled)` — the punch button's fill: `success`, `danger` or `muted`.
 * - `locationChipFor(settings, lastCheck)` and `biometricChipFor(availability)` — the two
 *   read-only chips (R7.12): text, tone and icon.
 *
 * `todayPunchesOf(status)` turns the `/me` answer (first IN, last punch) into the punch list the
 * card and the duration work from, so the screen needs no new server call.
 */
import { waitingToSendLine } from '@stockkart/attendance-protocol';
import type {
  AppLocationSettings,
  AppStatusResponse,
  PunchDirection,
} from '@stockkart/attendance-protocol';

import type { IconName } from '../components/Icon';
import type { ChipTone } from '../components/Chip';
import { KOLKATA_OFFSET_MS, kolkataDate } from '../history/kolkataDates';
import { t } from '../i18n';
import type { QueueState } from '../queue/SyncWorker';
import type { SignerCapability } from '../signer/BiometricSigner';
import type { PunchResult } from './PunchFlow';

/** One counted punch of the day, as the server reports it: a direction and its `HH:mm` (IST). */
export interface TodayPunch {
  direction: PunchDirection;
  /** `HH:mm`; `HH:mm:ss` is accepted and floored to the minute. */
  time: string;
}

/** One row of the Today card: the IN and the OUT that followed it, or `null` for "—". */
export interface TodayRow {
  in: string;
  out: string | null;
}

/** The slice of the `/me` answer the status line and the Today card read. */
export type TodayStatus = Pick<
  AppStatusResponse,
  'today' | 'todayIn' | 'todayOut' | 'nextDirection'
>;

/** What `punchTone` answers; the button maps it to `success` / `danger` / `bgMuted`. */
export type PunchTone = 'success' | 'danger' | 'muted';

/** What the chip helpers answer: a `Chip`'s text, tone and icon, plus its TalkBack label. */
export interface ChipSpec {
  text: string;
  tone: ChipTone;
  icon: IconName;
  accessibilityLabel: string;
}

/** The last location check the screen knows of, from the newest punch's flags or request. */
export type LocationCheck = 'inside' | 'outside';

/**
 * What a punch result says about where the phone was (R7.12): a stored punch's `OUTSIDE_SHOP` flag
 * means outside, no location flag means inside; a queued punch is judged from the distance it
 * carries against the shop radius. `null` when the result says nothing (`NO_LOCATION`, no distance,
 * a refusal, a failed check), so the chip keeps what it knew.
 */
export function locationCheckOf(
  result: PunchResult,
  radiusMetres: number | null | undefined,
): LocationCheck | null {
  if (result.kind === 'stored') {
    const flags = result.response.flags ?? [];
    if (flags.includes('OUTSIDE_SHOP')) {
      return 'outside';
    }
    return flags.includes('NO_LOCATION') ? null : 'inside';
  }
  if (result.kind === 'queued') {
    const { locationChecked, distanceMetres } = result.punch.request;
    if (!locationChecked || distanceMetres == null || radiusMetres == null) {
      return null;
    }
    return distanceMetres <= radiusMetres ? 'inside' : 'outside';
  }
  return null;
}

/** What the biometric chip reads: this phone holds a pairing (so a device key), and the signer's capability. */
export interface SignerAvailability {
  paired: boolean;
  capability: SignerCapability | null;
}

/** `HH:mm` or `HH:mm:ss` → whole minutes since midnight, or `null` when it is not a clock time. */
export function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/** `8 h 05 m` for a count of whole minutes (negative counts read as 0). */
export function formatDuration(totalMinutes: number): string {
  const whole = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  return t('punch.duration', { hours, minutes: minutes < 10 ? `0${minutes}` : minutes });
}

/**
 * The punches of the day as the `/me` answer describes them: `todayIn` is the first counted punch
 * (always an IN); `todayOut`, when present, is the last counted punch, whose direction is the
 * opposite of `nextDirection` (an OUT when the next tap is IN, else an IN). Nothing in between is
 * known, so the list has at most two entries.
 */
export function todayPunchesOf(status: TodayStatus | null | undefined): TodayPunch[] {
  const first = status?.todayIn ?? null;
  if (!status || first == null || first.length === 0) {
    return [];
  }
  const punches: TodayPunch[] = [{ direction: 'IN', time: first }];
  const last = status.todayOut ?? null;
  if (last != null && last.length > 0) {
    punches.push({ direction: status.nextDirection === 'IN' ? 'OUT' : 'IN', time: last });
  }
  return punches;
}

/**
 * Worked time (R7.11): the last OUT that follows the first IN, minus that IN, floored to the
 * minute; `undefined` when there is no such pair; never negative (a clock that went backwards
 * reads as 0).
 */
export function workedDuration(punches: readonly TodayPunch[]): number | undefined {
  const firstIn = punches.findIndex((p) => p.direction === 'IN');
  if (firstIn < 0) {
    return undefined;
  }
  let lastOut = -1;
  for (let i = punches.length - 1; i > firstIn; i -= 1) {
    if (punches[i].direction === 'OUT') {
      lastOut = i;
      break;
    }
  }
  if (lastOut < 0) {
    return undefined;
  }
  const start = minutesOf(punches[firstIn].time);
  const end = minutesOf(punches[lastOut].time);
  if (start === null || end === null) {
    return undefined;
  }
  return Math.max(0, end - start);
}

/** The Today card's rows (R7.12): one per IN, with the OUT that follows it or `null` ("—"). */
export function todayRows(punches: readonly TodayPunch[]): TodayRow[] {
  const rows: TodayRow[] = [];
  for (const punch of punches) {
    if (punch.direction === 'IN') {
      rows.push({ in: punch.time, out: null });
    } else if (rows.length > 0 && rows[rows.length - 1].out === null) {
      rows[rows.length - 1].out = punch.time;
    }
    // An OUT with no open IN before it (the day started with an OUT) has no row of its own.
  }
  return rows;
}

/**
 * The status line (R7.11), exactly one of: "N punches waiting to be sent" while punches wait
 * (HR-module R6.16 text); "Not checked in yet" without a first punch today (or with a `/me` answer
 * for another day, R6.7); "Done for today · 8 h 05 m" when an OUT closed the day (the next
 * direction is IN again); "In since 09:12" otherwise.
 */
export function statusLineFor(
  status: TodayStatus | null | undefined,
  queue: Pick<QueueState, 'waiting'>,
  nowMs: number,
): string {
  const waiting = waitingToSendLine(queue.waiting);
  if (waiting !== null) {
    return waiting;
  }
  if (!status || status.today !== kolkataDate(nowMs)) {
    return t('punch.notCheckedInYet');
  }
  const punches = todayPunchesOf(status);
  if (punches.length === 0) {
    return t('punch.notCheckedInYet');
  }
  const worked = workedDuration(punches);
  if (worked !== undefined && status.nextDirection === 'IN') {
    return t('punch.doneForToday', { duration: formatDuration(worked) });
  }
  return t('punch.inSince', { time: punches[0].time });
}

/** `HH:mm:ss` in Asia/Kolkata, or `HH:mm` when motion is reduced (R7.11, R12.7). */
export function clockText(nowMs: number, reduceMotion: boolean): string {
  const shifted = new Date(nowMs + KOLKATA_OFFSET_MS);
  const hh = pad2(shifted.getUTCHours());
  const mm = pad2(shifted.getUTCMinutes());
  return reduceMotion ? `${hh}:${mm}` : `${hh}:${mm}:${pad2(shifted.getUTCSeconds())}`;
}

/** The punch button's fill (R7.10): muted and not pressable when not enabled, else by direction. */
export function punchTone(direction: PunchDirection, enabled: boolean): PunchTone {
  if (!enabled) {
    return 'muted';
  }
  return direction === 'IN' ? 'success' : 'danger';
}

/**
 * The location chip (R7.12): "Location off" when the shop has no location check (or nothing is
 * stored), else the last check the screen knows — "Inside shop", "Outside shop" — or "Checking…"
 * before one is known. Read from the stored settings, never from a new server call.
 */
export function locationChipFor(
  settings: Pick<AppLocationSettings, 'locationCheck'> | null | undefined,
  lastCheck: LocationCheck | null,
): ChipSpec {
  let text: string;
  let tone: ChipTone;
  let icon: IconName;
  if (!settings?.locationCheck) {
    text = t('punch.locationOff');
    tone = 'neutral';
    icon = 'info';
  } else if (lastCheck === 'inside') {
    text = t('punch.locationInside');
    tone = 'success';
    icon = 'check';
  } else if (lastCheck === 'outside') {
    text = t('punch.locationOutside');
    tone = 'warning';
    icon = 'warning';
  } else {
    text = t('punch.locationChecking');
    tone = 'neutral';
    icon = 'info';
  }
  return { text, tone, icon, accessibilityLabel: t('punch.locationChipLabel', { text }) };
}

/**
 * The biometric chip (R7.12): "Fingerprint ready" when this phone holds a pairing (so the device
 * key exists) and the signer reports a strong biometric enrolled; "Not set up" otherwise.
 */
export function biometricChipFor(availability: SignerAvailability): ChipSpec {
  const ready = availability.paired && availability.capability === 'STRONG_BIOMETRIC_READY';
  const text = ready ? t('punch.biometricReady') : t('punch.biometricNotSetUp');
  return {
    text,
    tone: ready ? 'success' : 'neutral',
    icon: ready ? 'fingerprint' : 'info',
    accessibilityLabel: t('punch.biometricChipLabel', { text }),
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
