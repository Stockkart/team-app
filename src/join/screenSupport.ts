/**
 * Small pieces the screens before Home share (Join, Waiting, Blocked; tasks 14.2) and that Home
 * and Profile may reuse (tasks 14.3, 14.4):
 *
 * - {@link errorText}: the sentence a failed account call shows. Not reachable → the common line;
 *   a server refusal → its text word for word (the rate-limit text, "You already have a request
 *   waiting.", …); anything else → "Something went wrong". A 401 never reaches this: callers hand
 *   the error to `shell.handleError` first (R9.3).
 * - {@link requestedOnLine}: "Requested on Mon, 12 May 2025" from the request's ISO instant, the
 *   calendar day taken in Asia/Kolkata (R6.3).
 * - {@link useAvatarSource}: the authenticated `{uri, headers}` the `Avatar` draws a photo from
 *   (R11.5: never a bare URL), or `undefined` while it resolves or when there is no photo.
 *
 * Pure apart from the hook; no Expo or React Native import.
 */
import { useEffect, useState } from 'react';

import type { AccountClient } from '../api/accountClient';
import { isNotReachable, isServerRefusal } from '../api/transport';
import { kolkataDate, parseInstant } from '../history/kolkataDates';
import { t } from '../i18n';
import { displayDate } from '../punch/kolkata';

export function errorText(error: unknown): string {
  if (isNotReachable(error)) {
    return t('common.notReachable');
  }
  if (isServerRefusal(error)) {
    return error.message;
  }
  return t('common.somethingWentWrong');
}

/** "Requested on {date}" with the request's day in Asia/Kolkata; the raw value when it is not an instant. */
export function requestedOnLine(requestedAt: string): string {
  const ms = parseInstant(requestedAt);
  return t('waiting.requestedOn', {
    date: ms == null ? requestedAt : displayDate(kolkataDate(ms)),
  });
}

export interface AvatarSource {
  uri: string;
  headers: Record<string, string>;
}

export function useAvatarSource(
  account: Pick<AccountClient, 'imageSource'>,
  photoUrl: string | undefined,
): AvatarSource | undefined {
  const [source, setSource] = useState<AvatarSource | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!photoUrl) {
      setSource(undefined);
      return undefined;
    }
    account
      .imageSource(photoUrl)
      .then((resolved) => {
        if (live) {
          setSource(resolved);
        }
      })
      .catch(() => {
        // No session or a bad URL: the initial is drawn instead.
        if (live) {
          setSource(undefined);
        }
      });
    return () => {
      live = false;
    };
  }, [account, photoUrl]);
  return source;
}
