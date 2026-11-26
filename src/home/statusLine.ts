/**
 * The Attendance tile's status line (R6.5; Property 15), from the `today` section of the worker
 * state (`WorkerStateResponse.today`): "Not checked in" without a first punch, "Checked in 09:12"
 * with one, "Checked in 09:12 · out 18:05" with both. The times are the server's `HH:mm` in
 * Asia/Kolkata, shown as sent. Pure; the texts come from the strings file.
 */
import type { WorkerToday } from '@stockkart/attendance-protocol';

import { t } from '../i18n';

/** The part of `today` the line needs; `null` and `undefined` both mean "no time". */
export type TodayTimes = Pick<WorkerToday, 'in' | 'out'>;

export function statusLine(today: TodayTimes | null | undefined): string {
  const checkedIn = today?.in ?? null;
  if (checkedIn == null || checkedIn.length === 0) {
    return t('home.notCheckedIn');
  }
  const checkedOut = today?.out ?? null;
  if (checkedOut == null || checkedOut.length === 0) {
    return t('home.checkedIn', { in: checkedIn });
  }
  return t('home.checkedInOut', { in: checkedIn, out: checkedOut });
}
